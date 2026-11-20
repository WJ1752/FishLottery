import { get, run, transaction } from '../db/index.js'
import { MIN_DURABILITY, advanceDepthSurveys, advanceFishing, advanceGuide, syncGuideFocus, applyConfig, applyDrawNumbers, autoRepairRod, createInitialState, extractPlayerState, fxDayClose, fxDayIndex, getBatchId, hydrateState, mergeFxWorld, redactScratchFaces, refreshBlackMarketDay, refreshDailyContracts, settleFxDays, settleMachines, warehouseFull } from '../../src/game.js'
import { cryptoRandom } from '../lib/rng.js'
import { now } from '../lib/clock.js'
import { appendFlowInTransaction, diffFlows, readToday, readWorld, settleWorld } from './market.js'
import { batchIdAt, batchNumbers, batchRules } from './lottery.js'

// 每个玩家一份 JSON 快照，配一个 version 做乐观并发。
// 同一玩家的请求在进程内串行化：单实例部署下这就够了，不需要数据库行锁。

const locks = new Map()
const DEFAULT_OFFLINE_CAP_MS = 12 * 60 * 60 * 1000
const FISHING_RETURN_MIN_MS = 60 * 1000

export function withPlayerLock(userId, fn) {
  const key = String(userId)
  const previous = locks.get(key) || Promise.resolve()
  const next = previous.then(fn, fn)
  // 链尾永远是可继续的 resolve，避免一次失败把后续请求也带挂。
  const tail = next.catch(() => {})
  locks.set(key, tail)
  tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key)
  })
  return next
}

export function readPlayerRow(db, userId) {
  return get(db, 'SELECT state, version, updated_at FROM players WHERE user_id = ?', Number(userId)) || null
}

export function loadPlayer(db, userId, config) {
  const row = readPlayerRow(db, userId)
  if (!row) {
    const fresh = createInitialState(config, cryptoRandom)
    fresh.fishing.lastTickAt = now()
    return { state: fresh, version: 0 }
  }
  let parsed = null
  try {
    parsed = JSON.parse(row.state)
  } catch {
    parsed = null
  }
  // 快照里没有 config（配置是全服共享的），用当前世界配置补齐后再规范化一次。
  const state = parsed ? hydrateState({ ...parsed, config }, now(), config) : createInitialState(config, cryptoRandom)
  return { state, version: Number(row.version) || 0 }
}

export function savePlayer(db, userId, state, version) {
  const snapshot = extractPlayerState({ ...state, updatedAt: now() })
  const payload = JSON.stringify(snapshot)
  const at = now()
  if (!version) {
    run(db, 'INSERT INTO players(user_id, state, version, updated_at) VALUES(?, ?, 1, ?)', Number(userId), payload, at)
    return 1
  }
  const nextVersion = Number(version) + 1
  run(db, 'UPDATE players SET state = ?, version = ?, updated_at = ? WHERE user_id = ?', payload, nextVersion, at, Number(userId))
  return nextVersion
}

// 把离线时间追算成真实产出。返回 { state, flows, changed }。
//
// 为什么要分段：FX 的日线按自然日结算，如果一口气把 12 小时算完，
// 跨过零点的那部分流水会被算到错误的交易日上。所以按天切开，逐段推进，
// 每段结束就把该段产生的流水合并进全服待结算桶。
export function catchUp(db, state, config, capMs = DEFAULT_OFFLINE_CAP_MS, at = now()) {
  const last = Number(state.fishing?.lastTickAt)
  if (!Number.isFinite(last) || at <= last) return { state, flows: [], changed: false }

  const limit = Number(capMs)
  const target = Math.min(at, last + Math.max(0, Number.isFinite(limit) ? limit : DEFAULT_OFFLINE_CAP_MS))
  // 停钓不等于停机：耐久跌破停钓线后 auto-stop 会把 running 置 false，
  // 但自动维修天赋仍可能把竿补回来。先试一次，修好了就照常追算；
  // 修不起来（冷却 / 材料不足 / 没点天赋）才按停机跳过这段时间。
  let activeState = state
  if (!activeState.fishing?.running || activeState.rod?.status === 'broken' || (Number(activeState.rod?.durability) || 0) <= MIN_DURABILITY) {
    // 修了就算数（材料已经花掉），即使这次还没修过停钓线也把结果留下，
    // 下次同步够冷却后继续修，而不是把这次维修悄悄丢掉。
    const repaired = autoRepairRod(activeState, at)
    if (repaired !== activeState) activeState = repaired
  }
  // 完全停机（没在钓鱼 / 竿已损坏 / 耐久见底）时不需要逐段重放，直接把时钟推到现在：
  // 停钓期间本来就不产出，重放一遍只是白烧 CPU，而且每次同步都会重复算同一个区间。
  const idle = !activeState.fishing?.running || activeState.rod?.status === 'broken' || (Number(activeState.rod?.durability) || 0) <= MIN_DURABILITY
  if (idle) {
    return { state: { ...activeState, fishing: { ...activeState.fishing, lastTickAt: at } }, flows: [], changed: activeState !== state }
  }

  const dayMs = config.fx.dayMs || 24 * 60 * 60 * 1000
  let cursor = last
  let current = activeState
  let changed = false
  const flows = []

  while (cursor < target) {
    const day = fxDayIndex(cursor, dayMs)
    const nextDay = fxDayClose(day, dayMs)
    // 在零点之前读出这一日的增量，再推进下一段。
    const segmentEnd = Math.min(target, nextDay - 1)
    const before = current.fx?.today || {}
    const caught = advanceFishing(current, segmentEnd, { maxSteps: 20000, random: cryptoRandom })
    current = caught
    flows.push(...diffFlows(before, current.fx?.today || {}))
    // 进度本身也算变化：客户端要靠它把进度条画出来。
    changed = true
    cursor = segmentEnd < target ? nextDay : target
  }

  if (cursor === target && current.fishing.lastTickAt < target && fxDayIndex(target, dayMs) > fxDayIndex(current.fishing.lastTickAt, dayMs) && current.fishing.running) {
    const before = current.fx?.today || {}
    current = advanceFishing(current, target, { maxSteps: 1, random: cryptoRandom })
    flows.push(...diffFlows(before, current.fx?.today || {}))
  }
  // 离线额度用完后丢弃超出的间隔，避免每次刷新都再次追算同一段。
  if (current.fishing.lastTickAt < at) {
    const shift = Math.max(0, at - Math.max(last, Number(current.fishing.lastTickAt) || 0))
    const fishing = current.fishing
    current = { ...current, fishing: {
      ...fishing,
      lastTickAt: at,
      bite: fishing.bite ? { ...fishing.bite, startedAt: fishing.bite.startedAt + shift } : null,
      recoverUntil: fishing.recoverUntil ? fishing.recoverUntil + shift : 0,
    } }
  }
  return { state: current, flows, changed, cappedMs: target < at ? target - last : null }
}

function fishingReturn(before, after, at, cappedMs) {
  const elapsedMs = at - before.fishing.lastTickAt
  if (!(elapsedMs >= FISHING_RETURN_MIN_MS)) return null
  const landed = Math.max(0, after.stats.totalCatches - before.stats.totalCatches)
  const escaped = Math.max(0, after.stats.totalEscapes - before.stats.totalEscapes)
  let stopReason = null
  if (after.rod.status === 'broken') stopReason = 'broken'
  else if (after.rod.durability <= MIN_DURABILITY || (!after.fishing.running && after.fishing.autoStopped)) stopReason = 'durability'
  else if (!after.fishing.running && warehouseFull(after)) stopReason = 'warehouse'
  if (!before.fishing.running && !landed && !escaped && !stopReason) return null
  return { at, elapsedMs, cappedMs: cappedMs ?? null, landed, escaped, stopReason }
}

// 「经济状态」签名：金币、背包、鱼、票、刮刮乐、钓竿、统计、天赋。
// 钓鱼进度与张力不参与签名——它们每秒都在变，不值得触发整份状态下发。
function economySignature(state) {
  return JSON.stringify([
    state.coins,
    state.inventory,
    state.fish?.length,
    state.escapes?.length,
    state.tickets?.length,
    state.scratchCards?.length,
    state.unlockedDepths,
    state.rod?.id,
    state.rod?.durability,
    state.rods?.map((rod) => [rod.id, rod.durability, rod.levels, rod.status]),
    state.warehouseLevel,
    state.stats,
    state.daily,
    state.depthSurveys,
    state.fishingReturn?.at,
    state.settings,
    // 逐个解锁：层级变化要推一次完整 me，导航才会出现新页签。
    state.guide?.stage,
    state.guide?.skipped,
    state.fx?.positions,
    state.fx?.trades?.length,
    // 黑市：渔币、订单、配额、购买记录、超级卡都参与签名；
    // 未刮卡的 face 不进签名，只有长度已经够了。
    state.blackMarket?.coins,
    state.blackMarket?.introSeen,
    state.blackMarket?.day,
    state.blackMarket?.order,
    state.blackMarket?.soldToday,
    state.blackMarket?.quotaBonus,
    state.blackMarket?.purchases,
    state.blackMarket?.dailyBuys,
    state.blackMarket?.super,
    state.blackMarket?.lastSuper,
    // 机器：只放离散、低频字段。lastSettledAt 每分钟都在动，放进来会导致每秒下发整份存档。
    state.machines ? Object.entries(state.machines.owned || {}).map(([id, m]) => [id, m.on, m.deposit?.fishKg, m.deposit?.coins, m.deposit?.blackCoins, m.deposit?.items?.queue?.length, m.basket?.coins, m.basket?.materials, m.dayItems, m.overheat, m.modules, m.overtime?.wantOn]) : null,
    state.machines?.warehouse,
    state.machines?.orders?.length,
    state.machines?.workshopMovedAt,
  ])
}

// 一次完整的读取流程：结算世界行情 → 追算离线收益 → 结算已开奖的彩票 → 应用新配置 → 落库。
// 返回 { state, version, changed }，changed 表示「经济状态变了，需要下发整份 me」。
//
// 注意：这个函数自己会拿玩家锁。调用方如果已经持锁，必须用 syncPlayerLocked，
// 否则 promise 链会等自己，直接死锁。
export function syncPlayer(db, userId, config, options = {}) {
  return withPlayerLock(userId, () => syncPlayerLocked(db, userId, config, options))
}

export function syncPlayerLocked(db, userId, config, { configVersion = 0, capMs, forceChanged = false, at = now() } = {}) {
  const world = settleWorld(db, config, at)
  return transaction(db, () => reconcilePlayer(db, userId, config, world, { configVersion, capMs, forceChanged, at }))
}

function reconcilePlayer(db, userId, config, world, { configVersion, capMs, forceChanged, at }) {
  const { state: loaded, version } = loadPlayer(db, userId, config)
  const before = economySignature(loaded)
  let state = mergeFxWorld(loaded, world)

  const configChanged = configVersion > 0 && Number(state.configVersion || 0) !== Number(configVersion)
  if (configChanged) state = { ...applyConfig(state, config), configVersion: Number(configVersion) }

  const caught = catchUp(db, state, config, capMs, at)
  const returned = fishingReturn(state, caught.state, at, caught.cappedMs)
  // 保留最近一次报告，避免浏览器重试或另一设备先同步时吞掉离线回执。
  state = returned ? { ...caught.state, fishingReturn: returned } : caught.state
  if (caught.flows.length) appendFlowInTransaction(db, caught.flows, config, at)
  const today = caught.flows.length ? readToday(db) : world.today
  state = mergeFxWorld(state, { ...world, today })

  // 机器结算：和离线钓鱼同一个懒结算通道，不新增定时器。
  // 它自己会把租金鱼按 2 倍写进 fx.today，所以要在 appendFlow 之后跑，
  // 再用一次 diff 把这段流水补进全服桶。
  const beforeMachines = state.fx?.today || {}
  const settledMachines = settleMachines(state, at, config)
  if (settledMachines !== state) {
    state = settledMachines
    const machineFlows = diffFlows(beforeMachines, state.fx?.today || {})
    if (machineFlows.length) appendFlowInTransaction(db, machineFlows, config, at)
    state = mergeFxWorld(state, { ...world, today: machineFlows.length ? readToday(db) : today })
  }

  // 结算已经开奖的批次。
  const settledDraws = settlePlayerDraws(db, state, config)
  const settledChanged = settledDraws !== state
  state = settledDraws

  // 黑市日切：和 FX 同一个本地零点。只生成当天订单，不补历史、不累积配额。
  const refreshed = refreshBlackMarketDay(state, at, config, cryptoRandom)
  state = refreshed.state

  // 逐个解锁：每轮同步推进一次，跨过需要赠币/赠材料的步骤时在这里发放一次。
  const guided = advanceGuide(advanceDepthSurveys(refreshDailyContracts(state, at)), at)
  state = syncGuideFocus(guided.state, at)
  const guideChanged = guided.changed || state !== guided.state

  const changed = !version || forceChanged || configChanged || refreshed.changed || settledChanged || guideChanged || economySignature(state) !== before
  const nextVersion = changed ? savePlayer(db, userId, state, version) : version
  // 进度每秒都在动，所以即使经济状态没变也要把时间戳落库，保证离线追算的起点准确。
  const clocksChanged = state.fishing?.lastTickAt !== loaded.fishing?.lastTickAt ||
    Object.entries(state.machines?.owned || {}).some(([id, machine]) => machine.lastSettledAt !== loaded.machines?.owned?.[id]?.lastSettledAt)
  if (!changed && clocksChanged) {
    run(db, 'UPDATE players SET state = ?, updated_at = ? WHERE user_id = ?', JSON.stringify(extractPlayerState({ ...state, updatedAt: at })), at, Number(userId))
  }
  return { state, version: nextVersion, changed }
}

// 玩家手上的号码票：批次已开奖就结算成 DRAWN。
export function settlePlayerDraws(db, state, config) {
  const batches = new Set((state.tickets || []).filter((ticket) => ticket.status === 'ASSIGNED' && ticket.batchId).map((ticket) => ticket.batchId))
  if (!batches.size) return state
  let current = state
  let touched = false
  batches.forEach((batchId) => {
    const numbers = batchNumbers(db, batchId)
    if (!numbers) return
    const rules = batchRules(db, batchId)
    const next = applyDrawNumbers(current, batchId, numbers, rules ? { ...config, lotteryTypes: rules } : config)
    if (next !== current) touched = true
    current = next
  })
  return touched ? current : state
}

// 客户端要的最小时间态：进度、张力、相位、停钓标记。
export function fishingTick(state) {
  const fishing = state.fishing || {}
  return {
    progress: fishing.progress || 0,
    tension: fishing.tension || 0,
    phase: fishing.phase || 'charging',
    running: Boolean(fishing.running),
    bite: fishing.bite || null,
    recoverUntil: fishing.recoverUntil || 0,
    recoverFrom: fishing.recoverFrom || 0,
    lowDurability: Boolean(fishing.lowDurability),
    autoStopped: Boolean(fishing.autoStopped),
    manualResume: Boolean(fishing.manualResume),
    lastOutcome: fishing.lastOutcome || null,
    lastTickAt: fishing.lastTickAt || 0,
    selectedDepthId: fishing.selectedDepthId || 'shore',
  }
}

export { createInitialState, mergeFxWorld, extractPlayerState, redactScratchFaces, readWorld, getBatchId, batchIdAt, settleFxDays, batchNumbers }
