import { all, metaGet, metaSet, run, transaction } from '../db/index.js'
import { FX_BIN_MS, FX_BIN_KEEP_DAYS, FX_KEEP_DAYS, FX_LEGACY_BIN_MS, TRAITS, encodeBar, fxBinSlot, fxDayIndex, mergeFxBins, normalizeFxBins, settleFxDays } from '../../src/game.js'
import { now } from '../lib/clock.js'

// 全服共享行情。
//
// 为什么放在这里而不是玩家快照里：价格必须只有一份，否则每个玩家看到的报价不一样，
// 「钓获推高价格、出货压低价格」就不再是市场信号，而是各人自己的单机数值。
//
// 结算规则完全复用 src/game.js 的 settleFxDays（日涨跌幅、影线、365 天裁剪都在里面），
// 本文件只负责把那份纯函数的状态从 SQLite 里读出来、再写回去。
//
// 成交时间桶（15 分钟一格）是这次新增的：当日桶写在 fx_bucket_bins，
// 结算后搬到 fx_day_bins，供日内走势按实际成交时间铺开。

const SYMBOLS = TRAITS.map((trait) => trait.id)

function parseBins(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw || '[]')
  } catch {
    return []
  }
  // 旧格式（没有格宽信息）只有一个裸数组，槽位按上一版的 15 分钟一格；
  // 新格式写成 { ms, v }，把自己的格宽一起存下来，将来再改宽度也不用猜。
  if (Array.isArray(parsed)) return normalizeFxBins(scaleBins(parsed, FX_LEGACY_BIN_MS, FX_BIN_MS))
  if (parsed && Array.isArray(parsed.v)) return normalizeFxBins(scaleBins(parsed.v, Number(parsed.ms) || FX_BIN_MS, FX_BIN_MS))
  return []
}

// 把一种格宽的槽位换算成另一种：槽位是「当天第几格」，格宽变了就必须重排，
// 否则昨天 10:00 的流水会被读成今天凌晨 03:00 的流水。
function scaleBins(bins, fromMs, toMs) {
  if (!Array.isArray(bins)) return []
  const from = Number(fromMs) > 0 ? Number(fromMs) : toMs
  const to = Number(toMs) > 0 ? Number(toMs) : from
  if (from === to) return bins
  const ratio = from / to
  return bins.map((bin) => (Array.isArray(bin) ? [Math.round((Number(bin[0]) || 0) * ratio), bin[1], bin[2]] : bin))
}

// 落库统一带上格宽，读取端据此换算，不再依赖「全局常量就是历史宽度」这个隐含假设。
function encodeBins(bins) {
  return JSON.stringify({ ms: FX_BIN_MS, v: bins })
}

// 从 fx_days / fx_bucket 还原成领域函数认识的紧凑结构。
export function readWorld(db) {
  const days = {}
  const rows = all(db, 'SELECT symbol, day, open, high, low, close, net, volume FROM fx_days ORDER BY symbol, day')
  rows.forEach((row) => {
    const list = days[row.symbol] || (days[row.symbol] = [])
    list.push([Number(row.day), Number(row.close), Number(row.net), Number(row.volume), Number(row.open), Number(row.high), Number(row.low)])
  })
  return { days, today: readToday(db) }
}

export function readToday(db) {
  const today = {}
  // 当日时间桶只有 8 行，和 fx_bucket 一起读不会增加同步轮询的负担。
  const bucketBins = new Map(all(db, 'SELECT symbol, day, bins FROM fx_bucket_bins').map((row) => [row.symbol, row]))
  all(db, 'SELECT symbol, day, net, volume FROM fx_bucket').forEach((row) => {
    const binsRow = bucketBins.get(row.symbol)
    const day = Number(row.day)
    const bins = binsRow && Number(binsRow.day) === day ? parseBins(binsRow.bins) : []
    today[row.symbol] = { day, net: Number(row.net) || 0, volume: Number(row.volume) || 0, bins }
  })
  return today
}

export function worldState(world, config) {
  // bins 是已结算日的 15 分钟成交桶（state.fx.bins[name][day]）。
  // 后台要画「昨天的原始流水」，所以把它一起塞进领域状态；
  // 玩家侧的 fx.days/today 不需要它，只有显式传了才带上，避免同步包变大。
  return { config, fx: { days: world.days, today: world.today, ...(world.bins ? { bins: world.bins } : {}) } }
}

function writeDays(db, days) {
  db.exec('DELETE FROM fx_days')
  const insert = db.prepare('INSERT INTO fx_days(symbol, day, open, high, low, close, net, volume) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
  Object.entries(days || {}).forEach(([symbol, list]) => {
    ;(Array.isArray(list) ? list : []).forEach((bar) => {
      // 落库既可能是紧凑数组也可能是对象（settleFxDays 返回的是紧凑数组）。
      const row = Array.isArray(bar)
        ? { day: bar[0], close: bar[1], net: bar[2], volume: bar[3], open: bar[4], high: bar[5], low: bar[6] }
        : bar
      if (!row || !Number.isFinite(Number(row.day))) return
      insert.run(symbol, Number(row.day), Number(row.open) || Number(row.close) || 1, Number(row.high) || Number(row.close) || 1,
        Number(row.low) || Number(row.close) || 1, Number(row.close) || 1, Number(row.net) || 0, Number(row.volume) || 0)
    })
  })
}

function writeToday(db, today) {
  db.exec('DELETE FROM fx_bucket')
  db.exec('DELETE FROM fx_bucket_bins')
  const insert = db.prepare('INSERT INTO fx_bucket(symbol, day, net, volume) VALUES(?, ?, ?, ?)')
  const insertBins = db.prepare('INSERT INTO fx_bucket_bins(symbol, day, bins) VALUES(?, ?, ?)')
  Object.entries(today || {}).forEach(([symbol, bucket]) => {
    if (!bucket || !Number.isFinite(Number(bucket.day))) return
    insert.run(symbol, Number(bucket.day), Number(bucket.net) || 0, Math.max(0, Number(bucket.volume) || 0))
    const bins = normalizeFxBins(bucket.bins)
    if (bins.length) insertBins.run(symbol, Number(bucket.day), encodeBins(bins))
  })
}

// 结算后的成交时间桶：同一天同标的只有一行，覆盖写。
function writeDayBins(db, binHistory, at, config) {
  const upsert = db.prepare(`INSERT INTO fx_day_bins(symbol, day, bins) VALUES(?, ?, ?)
    ON CONFLICT(symbol, day) DO UPDATE SET bins = excluded.bins`)
  Object.entries(binHistory || {}).forEach(([symbol, days]) => {
    Object.entries(days || {}).forEach(([day, bins]) => {
      const list = normalizeFxBins(bins)
      if (list.length) upsert.run(symbol, Number(day), encodeBins(list))
    })
  })
  // 只保留最近 30 天的逐格数据，和领域层的裁剪保持一致。
  const today = fxDayIndex(at, config.fx.dayMs)
  run(db, 'DELETE FROM fx_day_bins WHERE day <= ?', today - FX_BIN_KEEP_DAYS)
}

// 持仓与成交不进全服表：它们本来就是「谁买了多少」的私有数据。
// 这里只负责结算与流水，其余由玩家快照承担。

export const daysVersion = (db) => Number(metaGet(db, 'fxDaysVersion', '0')) || 0

// 零点结算：把昨天及更早的待结算桶结算成日线，写回全服表。
// 没有到期桶时直接返回，不发无用的写事务。
export function settleWorld(db, config, at = now()) {
  const world = readWorld(db)
  const today = fxDayIndex(at, config.fx.dayMs)
  const due = Object.values(world.today).some((bucket) => Number(bucket?.day) < today)
  if (!due) return world
  const settled = settleFxDays(worldState(world, config), at)
  transaction(db, () => {
    writeDays(db, settled.fx.days)
    writeToday(db, settled.fx.today)
    // settled.fx.bins 里只有这次刚结算的日期；旧日期已在库里，不必每次重写。
    writeDayBins(db, settled.fx.bins, at, config)
    metaSet(db, 'fxDaysVersion', daysVersion(db) + 1)
  })
  return { days: settled.fx.days, today: settled.fx.today }
}

// 把玩家动作产生的净流水合并进全服待结算桶。
// entries: [{ name, net, volume, bins? }] —— 由 diffFlows 给出，已经是增量。
// bins 是这次流水实际发生的时间桶；没有就按同步时刻记一格。
export function appendFlow(db, entries, config, at = now()) {
  return transaction(db, () => appendFlowInTransaction(db, entries, config, at))
}

export function appendFlowInTransaction(db, entries, config, at) {
  const list = (Array.isArray(entries) ? entries : []).filter((entry) => entry && SYMBOLS.includes(entry.name) && Number.isFinite(Number(entry.net)))
  if (!list.length) return
  const day = fxDayIndex(at, config.fx.dayMs)
  const upsert = db.prepare(`
    INSERT INTO fx_bucket(symbol, day, net, volume) VALUES(?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      net = CASE WHEN fx_bucket.day = excluded.day THEN fx_bucket.net + excluded.net ELSE excluded.net END,
      volume = CASE WHEN fx_bucket.day = excluded.day THEN fx_bucket.volume + excluded.volume ELSE excluded.volume END,
      day = excluded.day
  `)
  const readBins = db.prepare('SELECT day, bins FROM fx_bucket_bins WHERE symbol = ?')
  const upsertBins = db.prepare(`INSERT INTO fx_bucket_bins(symbol, day, bins) VALUES(?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET day = excluded.day, bins = excluded.bins`)
  list.forEach((entry) => {
    const net = Number(entry.net) || 0
    const volume = Math.max(0, Number(entry.volume) || Math.abs(net))
    // 旧交易日已经结算；迟到的离线流水以本次同步时间进入当日行情。
    const useOriginalBins = entry.day == null || Number(entry.day) === day
    const rawBins = useOriginalBins && Array.isArray(entry.bins) && entry.bins.length
      ? entry.bins
      : [[fxBinSlot(at, config.fx.dayMs), net, volume]]
    const existing = readBins.get(entry.name)
    const base = existing && Number(existing.day) === day ? parseBins(existing.bins) : []
    const bins = mergeFxBins(base, rawBins)
    if (bins.length) upsertBins.run(entry.name, day, encodeBins(bins))
    upsert.run(entry.name, day, Math.round(net * 100) / 100, volume)
  })
}

// 两次「当日待结算桶」的差：领域函数只会往里累加，所以增量就是玩家的真实影响。
// 时间桶也要一起做差：增量里带着真实成交时刻，结算后才能按实际时间画日内走势。
export function diffFlows(before = {}, after = {}) {
  const out = []
  Object.keys(after).forEach((name) => {
    const next = after[name]
    const prev = before[name]
    if (!next) return
    const sameDay = Number(prev?.day) === Number(next.day)
    const net = (Number(next.net) || 0) - (sameDay ? Number(prev?.net) || 0 : 0)
    const volume = (Number(next.volume) || 0) - (sameDay ? Number(prev?.volume) || 0 : 0)
    const nextBins = new Map((Array.isArray(next.bins) ? next.bins : []).map((bin) => [Number(bin[0]), bin]))
    const prevBins = new Map(sameDay && Array.isArray(prev?.bins) ? prev.bins.map((bin) => [Number(bin[0]), bin]) : [])
    const bins = []
    nextBins.forEach((bin, slot) => {
      const old = prevBins.get(slot)
      const binNet = (Number(bin[1]) || 0) - (Number(old?.[1]) || 0)
      const binVolume = (Number(bin[2]) || 0) - (Number(old?.[2]) || 0)
      // 只有真的发生了成交才记一格：没有成交量的增量不是交易，
      // 落库后在价格推导里会被 fxTradeBins 丢掉，所以源头上就别写。
      if (binVolume > 0) bins.push([slot, Math.round(binNet * 100) / 100, Math.max(0, Math.round(binVolume * 100) / 100)])
    })
    if (!net && !volume && !bins.length) return
    out.push({
      name,
      day: next.day,
      net: Math.round(net * 100) / 100,
      volume: Math.max(0, Math.round(volume * 100) / 100),
      ...(bins.length ? { bins } : {}),
    })
  })
  return out
}

// 已结算日的成交时间桶（最近 30 天），随完整行情包下发。
export function readDayBins(db, at = now(), config = null) {
  const dayMs = config?.fx?.dayMs || 24 * 60 * 60 * 1000
  const today = fxDayIndex(at, dayMs)
  const out = {}
  all(db, 'SELECT symbol, day, bins FROM fx_day_bins WHERE day > ? ORDER BY symbol, day', today - FX_BIN_KEEP_DAYS).forEach((row) => {
    const bins = parseBins(row.bins)
    if (!bins.length) return
    const days = out[row.symbol] || (out[row.symbol] = {})
    days[Number(row.day)] = bins
  })
  return out
}

// 管理后台「清空行情历史」：回到基准价，持仓与鱼币不受影响。
export function resetWorld(db) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('DELETE FROM fx_days')
    db.exec('DELETE FROM fx_bucket')
    db.exec('DELETE FROM fx_bucket_bins')
    db.exec('DELETE FROM fx_day_bins')
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 已回滚 */ }
    throw error
  }
  metaSet(db, 'fxDaysVersion', daysVersion(db) + 1)
}

// 给客户端的历史窗口：只发最近 FX_KEEP_DAYS 根，和领域层的裁剪保持一致。
export function compactWorld(world) {
  const days = {}
  Object.entries(world.days || {}).forEach(([symbol, list]) => {
    days[symbol] = (Array.isArray(list) ? list : []).slice(-FX_KEEP_DAYS)
  })
  return { days, today: world.today || {}, ...(world.bins ? { bins: world.bins } : {}) }
}

export { SYMBOLS }
