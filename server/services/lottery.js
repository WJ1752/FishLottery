import { all, get, metaGet, metaSet, run, transaction } from '../db/index.js'
import { getBatchId, drawPoolNumbers, LOTTERY_HISTORY_DEFAULT, LOTTERY_HISTORY_MAX, LOTTERY_HISTORY_MIN } from '../../src/game.js'
import { cryptoRandom } from '../lib/rng.js'
import { now } from '../lib/clock.js'

// 全服彩票：批次按 UTC 6 小时切分（00/06/12/18），号码只在服务端生成一次。
//
// 之前前端有个「模拟开奖」按钮，等于把 RNG 交给玩家；现在改成定时器在批次关闭后统一开奖，
// 玩家下次同步时用 applyDrawNumbers 结算自己手上的号码票。
//
// 期号从第一期（最早登记或最早开奖的批次）开始按发行时间顺延，起点落在 meta 里。
// 展示期数由后台 config.lotteryHistory 控制（默认 7）。

const BATCH_MS = 6 * 60 * 60 * 1000
const ISSUE_ORIGIN_KEY = 'lotteryIssueOrigin'

// 后台配置可能被改坏或来自旧版本，统一在这里收口。
const historyLimit = (value) => Math.max(LOTTERY_HISTORY_MIN, Math.min(LOTTERY_HISTORY_MAX, Math.round(Number(value) || LOTTERY_HISTORY_DEFAULT)))

export const batchStart = (at = now()) => Math.floor(Number(at) / BATCH_MS) * BATCH_MS
export const batchEnd = (at = now()) => batchStart(at) + BATCH_MS
export const batchIdAt = (at = now()) => getBatchId(new Date(at))

export function batchRules(db, batchId) {
  const row = get(db, 'SELECT rules FROM lottery_batches WHERE batch_id = ?', batchId)
  return row?.rules ? JSON.parse(row.rules) : null
}

// 对某个批次开奖：每个奖池抽一组号码写库，返回 { typeId: number[] }。
// 幂等：已有号码直接复用，所以定时器重复跑、或管理员手动触发都不会重新抽。
// drawnAt 只在首次落库时生效：补绘往期时传批次结束时间，历史时间线才顺。
export function drawBatch(db, config, batchId, drawnAt = now()) {
  return transaction(db, () => {
    const existing = batchNumbers(db, batchId)
    const frozen = batchRules(db, batchId)
    if (existing && !frozen) return existing
    const pools = frozen || config.lotteryTypes
    const numbers = new Map(Object.entries(existing || {}))
    pools.forEach((type) => {
      if (numbers.has(type.id)) return
      const drawn = drawPoolNumbers(type, cryptoRandom)
      numbers.set(type.id, drawn)
      run(db, 'INSERT INTO lottery_draws(batch_id, type_id, numbers, drawn_at) VALUES(?, ?, ?, ?)', batchId, type.id, JSON.stringify(drawn), drawnAt)
    })
    return Object.fromEntries(numbers)
  })
}

// 某批次已开奖的号码；未开奖返回 null。
export function batchNumbers(db, batchId) {
  const rows = all(db, 'SELECT type_id, numbers FROM lottery_draws WHERE batch_id = ?', batchId)
  if (!rows.length) return null
  return Object.fromEntries(rows.map((row) => [row.type_id, JSON.parse(row.numbers)]))
}

// 第一期的起点：已登记批次和已开奖批次里最早的那个。
// 旧版本只取 lottery_batches，补绘更早的往期后会把它们算成第 0 期 / 第 -1 期；
// 这里发现起点比实际最早开奖还晚就自动回退并改写 meta。
export function issueOrigin(db) {
  const stored = Number(metaGet(db, ISSUE_ORIGIN_KEY, '0'))
  const firstBatch = Number(get(db, 'SELECT MIN(start_at) AS at FROM lottery_batches')?.at || 0)
  const firstDraw = Date.parse(get(db, 'SELECT batch_id FROM lottery_draws ORDER BY batch_id ASC LIMIT 1')?.batch_id || '')
  const candidates = [firstBatch, firstDraw].filter((at) => Number.isFinite(at) && at > 0)
  if (!candidates.length) return Number.isFinite(stored) && stored > 0 ? stored : 0
  const first = Math.min(...candidates)
  if (!(stored > 0) || stored > first) {
    metaSet(db, ISSUE_ORIGIN_KEY, first)
    return first
  }
  return stored
}

// 批次键是 UTC 6 小时整点，按起点折算成第 N 期。
export function issueNumber(origin, batchId) {
  const at = Date.parse(batchId)
  if (!origin || !Number.isFinite(at)) return 0
  return Math.round((at - origin) / BATCH_MS) + 1
}

// 最近几期按发行时间连续开奖：即使没人买票也补上号码，
// 往期列表才有内容可看，期号也不会因为空场次断档。
export function backfillDraws(db, config, at = now(), limit = config?.lotteryHistory) {
  const count = historyLimit(limit)
  const current = batchStart(at)
  for (let i = count; i >= 1; i -= 1) {
    const start = current - i * BATCH_MS
    drawBatch(db, config, getBatchId(new Date(start)), start + BATCH_MS)
  }
}

// 每个奖池最近 limit 期，最新的排前面；期号按第一期起算。
export function recentDraws(db, limit = LOTTERY_HISTORY_DEFAULT, poolIds = null, origin = issueOrigin(db)) {
  const ids = poolIds || all(db, 'SELECT DISTINCT type_id FROM lottery_draws').map((row) => row.type_id)
  const count = historyLimit(limit)
  const query = db.prepare('SELECT batch_id, numbers FROM lottery_draws WHERE type_id = ? ORDER BY batch_id DESC LIMIT ?')
  return Object.fromEntries([...new Set(ids)].flatMap((id) => {
    const draws = query.all(id, count).map((row) => ({
      batchId: row.batch_id,
      startAt: Date.parse(row.batch_id),
      issue: issueNumber(origin, row.batch_id),
      numbers: JSON.parse(row.numbers),
    }))
    return draws.length ? [[id, draws]] : []
  }))
}

// 玩家手上还有哪些批次在等开奖（只算 ASSIGNED 的号码票）。
export function playerBatches(player) {
  const set = new Set()
  ;(player?.tickets || []).forEach((ticket) => {
    if (ticket?.batchId && ticket.status === 'ASSIGNED') set.add(ticket.batchId)
  })
  return [...set].sort()
}

// 当前批次的展示信息：批次键、期号、起止时间、是否已开奖、号码，
// 以及每个奖池最近 lotteryHistory 期的往期号码（开奖面板用）。
export function currentBatchInfo(db, at = now(), config = null) {
  const batchId = batchIdAt(at)
  const numbers = batchNumbers(db, batchId)
  const origin = issueOrigin(db)
  const rules = batchRules(db, batchId)
  const pools = rules || config?.lotteryTypes
  return {
    batchId,
    issue: issueNumber(origin, batchId),
    startAt: batchStart(at),
    endAt: batchEnd(at),
    drawn: Boolean(numbers),
    numbers,
    history: recentDraws(db, config?.lotteryHistory, pools?.map((pool) => pool.id), origin),
    ...(rules && JSON.stringify(rules) !== JSON.stringify(config?.lotteryTypes) ? { types: rules } : {}),
  }
}

// 待开奖的批次：已被玩家引用、且批次已结束、但还没落库号码的批次。
// 定时器用它兜底扫描，避免依赖「只有玩家在线时才开奖」。
export function dueBatches(db, at = now()) {
  const current = batchStart(at)
  const batches = all(db, 'SELECT batch_id FROM lottery_batches WHERE start_at < ? AND drawn = 0', current)
  return batches.map((row) => row.batch_id)
}

export function markBatchDrawn(db, batchId) {
  run(db, 'UPDATE lottery_batches SET drawn = 1 WHERE batch_id = ?', batchId)
}

// 玩家合成号码票时登记批次，让定时器知道有票需要开奖。
export function registerBatch(db, batchId, startAt, endAt, rules = null) {
  run(db, `INSERT INTO lottery_batches(batch_id, start_at, end_at, drawn, rules) VALUES(?, ?, ?, 0, ?)
    ON CONFLICT(batch_id) DO UPDATE SET rules = excluded.rules
    WHERE lottery_batches.rules IS NULL AND excluded.rules IS NOT NULL`,
  batchId, startAt, endAt, rules ? JSON.stringify(rules) : null)
}
