import { FX_GRAIN_BY_ID, FX_GRAINS, encodeCandleRows, fxLockedGrains, decodeCandleRows } from '../../src/fx-grains.js'
import { fxBoard, fxConfig, fxDayIndex, fxDayStart, fxHistory, fxMidPrice, fxMinutePath, fxPosition, fxQuotes, fxSession, fxToday } from '../../src/game.js'
import { now as clockNow } from '../lib/clock.js'

// 深海FX 行情快照：**所有价格计算都在这里完成**，客户端只拿结果。
//
// 为什么要有这一层：行情算法（fxDayMove 的涨跌幅、fxMinutePath 的日内路径、
// fxBridge 的摆动、fxReleaseShare 的释放曲线、fxEvenVolumes 的量能平滑）
// 原本跟着 src/game.js 被打进了前端 bundle。任何人打开 devtools 都能读到常量，
// 进而用同一套公式外推当天收盘价。把计算搬到这里之后，bundle 里只剩下
// 「把数字画成蜡烛」的代码，公式彻底离开客户端。
//
// 设计取舍：
//   1) 报价（fxQuotes）也必须一起搬 —— 报价公式比图表更能直接指导交易，
//      只搬图表等于没搬。
//   2) 蜡烛按档位下发，且遵守解锁规则；锁着的档位服务端根本不算、不下发，
//      而不是前端藏起来。否则改一下前端就能白嫖。
//   3) 只下发「已走完」的蜡烛用于展示；今天的未走完部分单独作为一根实时柱，
//      避免把推演值伪装成已发生的事实。

const CACHE_TTL_MS = 800

// 同一秒内的多次请求（1 秒轮询 + 切页）复用同一份快照。
// 7200 根蜡烛的算法对单次请求只要几毫秒，但并发时不该每个请求都跑一遍。
let snapshotCache = { key: '', at: 0, value: null }

export function invalidateFxSnapshot() {
  snapshotCache = { key: '', at: 0, value: null }
}

// 单个标的在某个档位下的蜡烛序列。
// 只算「已结算日 + 今天的已走完分钟」，未走完的部分由 quote 里的实时价补一根。
function candlesFor(state, name, grainId, at, { withForecast = false } = {}) {
  const grain = FX_GRAIN_BY_ID[grainId]
  if (!grain) return { cols: [], rows: [] }
  const config = fxConfig(state)
  const today = fxDayIndex(at, config.dayMs)
  const span = grain.minutes
  const bars = []
  // 与玩家页原逻辑一致：回看最近 30 个交易日。
  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = today - offset
    const path = fxMinutePath(state, name, day, at)
    // 未走完的日子（今天）只取已走完的分钟，推演值不冒充事实。
    const settledMinutes = path.minutes.filter((item) => item.settled)
    if (!settledMinutes.length) continue
    for (let i = 0; i < settledMinutes.length; i += span) {
      const chunk = settledMinutes.slice(i, i + span)
      if (!chunk.length) continue
      const open = chunk[0].open
      const close = chunk[chunk.length - 1].close
      const body = Math.abs(close - open)
      bars.push({
        at: chunk[0].at,
        open,
        // 与前端原聚合口径一致：分钟影线很短，聚合后按实体补一点，形态比例才对得上。
        high: Math.max(...chunk.map((item) => item.high)) + body * 0.22,
        low: Math.max(1, Math.min(...chunk.map((item) => item.low)) - body * 0.22),
        close,
        volume: chunk.reduce((sum, item) => sum + (Number(item.volume) || 0), 0),
        settled: true,
        projected: false,
      })
    }
  }
  // 今天的「进行中」蜡烛：就是上面循环产出的最后一根（如果它属于今天）。
  //
  // 这里原来额外补过一根「实时柱」，但它的 at 取了 liveMinutes[0].at（今天开盘第一分钟），
  // 于是被画成一根时间戳 08:00、却排在 17:00 之后的柱子，成交量还等于当天全部成交——
  // 看起来就像「一根带预测样式的异常流水柱」。实际上今天的已走完部分已经在循环里聚合好了，
  // 只需要把它标成「未走完」，不需要再补一根。
  const todayPath = fxMinutePath(state, name, today, at)
  const liveMinutes = todayPath.minutes.filter((item) => item.settled)
  if (liveMinutes.length && bars.length) {
    const last = bars[bars.length - 1]
    const startOfToday = fxDayStart(today, config.dayMs)
    if (Number(last.at) >= startOfToday) {
      // 保留真实成交（这不是预测），只标记「本格还没走完」，读数里显示「预计成交」。
      last.settled = false
      // running = 这一格还在走（真实成交）；projected = 未来推演。
      // 两者必须分开：只有推演才该画虚线，进行中的柱子是真实数据。
      last.projected = false
      last.running = true
    }
  }

  // 预测段（仅管理端）：把今天剩下的分钟也铺出来，直到零点收盘。
  //
  // 为什么这段必须留在服务端：它是一条「未来价格路径」，拿到它就等于提前知道
  // 今天会收在哪。玩家侧永远不下发（withForecast 只由管理端接口传 true），
  // 所以即使有人改了前端代码，也拿不到这段数据。
  if (withForecast) {
    const rest = todayPath.minutes.filter((item) => !item.settled)
    for (let i = 0; i < rest.length; i += span) {
      const chunk = rest.slice(i, i + span)
      if (!chunk.length) continue
      const open = chunk[0].open
      const close = chunk[chunk.length - 1].close
      const body = Math.abs(close - open)
      bars.push({
        at: chunk[0].at,
        open,
        high: Math.max(...chunk.map((item) => item.high)) + body * 0.22,
        low: Math.max(1, Math.min(...chunk.map((item) => item.low)) - body * 0.22),
        close,
        volume: chunk.reduce((sum, item) => sum + (Number(item.volume) || 0), 0),
        settled: false,
        projected: true,
      })
    }
  }
  return encodeCandleRows(bars)
}

// 给定玩家的黑市购买记录，算出他能看哪些档位。
export function visibleGrains(purchases) {
  const locked = new Set(fxLockedGrains(purchases || {}))
  return FX_GRAINS.map((grain) => grain.id).filter((id) => !locked.has(id))
}

// 行情数据指纹：当日桶的净额/成交量 + 已结算日线的最后一天。
// 只要这些变了，缓存的报价就必须失效，否则同一时间桶内会下发过期的 todayNet。
function fxDataFingerprint(state) {
  const today = state?.fx?.today || {}
  const parts = Object.keys(today).sort().map((name) => {
    const bucket = today[name] || {}
    return `${name}:${Number(bucket.day) || 0}:${Number(bucket.net) || 0}:${Number(bucket.volume) || 0}`
  })
  const days = state?.fx?.days || {}
  const dayKeys = Object.keys(days).map(Number).filter(Number.isFinite)
  const lastDay = dayKeys.length ? Math.max(...dayKeys) : 0
  return `${parts.join('|')}#${lastDay}#${Object.keys(days).length}`
}

// 全量行情快照：报价 + 每个标的每个可用档位的蜡烛。
//
// withCandles=false 时只给报价（每秒轮询用），蜡烛由 /api/fx/candles 按需拉，
// 避免每秒把几万根蜡烛重新下发一遍。
export function buildFxSnapshot(state, { purchases = {}, withCandles = true, withForecast = false, at = clockNow() } = {}) {
  const config = fxConfig(state)
  // 管理端（withForecast）要能核对全部档位，包括玩家还没解锁的，
  // 否则后台切到「15分」只会是一片空白，没法确认解锁后玩家会看到什么。
  const grains = withForecast ? FX_GRAINS.map((grain) => grain.id) : visibleGrains(purchases)
  // 缓存键必须同时包含「行情数据指纹」：同一个 800ms 时间桶内可能刚写入新的净流入
  // （例如 A 刚上钩、B 紧随其后同步），只按时间分桶会把旧净额发给后一个玩家。
  const dataFingerprint = fxDataFingerprint(state)
  // withForecast 进缓存键：管理端要预测段，玩家端不要，两者不能共用同一份缓存。
  const key = `${withCandles}:${withForecast}:${grains.join(',')}:${Math.floor(at / CACHE_TTL_MS)}:${dataFingerprint}`
  if (snapshotCache.key === key && snapshotCache.value) return snapshotCache.value

  const quotes = fxQuotes(state, at)
  // 持仓由玩家快照决定，不参与缓存键，所以缓存的只是全服公共部分。
  const body = {
    serverTime: at,
    session: fxSession(state, at),
    quotes: quotes.map((quote) => ({
      name: quote.name,
      label: quote.meta?.label || quote.name,
      icon: quote.meta?.icon || '',
      color: quote.meta?.color || '#65758b',
      base: quote.base,
      buy: quote.buy,
      sell: quote.sell,
      mid: quote.mid,
      pointSpread: quote.pointSpread,
      change: quote.change,
      total: quote.total,
      todayNet: quote.todayNet,
      todayVolume: quote.todayVolume,
    })),
    // 档位元信息：客户端据此画按钮、判断是否上锁。
    grains: FX_GRAINS.map((grain) => ({
      id: grain.id,
      label: grain.label,
      minutes: grain.minutes,
      locked: !grains.includes(grain.id),
      shopItem: grain.unlock?.shopItem || null,
    })),
    defaultGrain: grains.includes('m60') ? 'm60' : grains[0] || 'm60',
  }
  if (withCandles) {
    // candles[name][grain] = { cols, rows }
    body.candles = quotes.reduce((map, quote) => ({
      ...map,
      [quote.name]: grains.reduce((byGrain, grainId) => ({
        ...byGrain,
        [grainId]: candlesFor(state, quote.name, grainId, at, { withForecast }),
      }), {}),
    }), {})
  }
  snapshotCache = { key, at, value: body }
  return body
}

// 单个标的的 K 线（切档位时按需拉，避免整包重传）。
export function buildFxCandles(state, { name, grain, purchases = {}, withForecast = false, at = clockNow() } = {}) {
  const allowed = visibleGrains(purchases)
  if (!allowed.includes(String(grain))) return { locked: true, grain: String(grain), candles: { cols: [], rows: [] } }
  const config = fxConfig(state)
  const symbols = new Set(Object.keys(config.traits || {}))
  if (!symbols.has(String(name))) return { locked: false, unknown: true, candles: { cols: [], rows: [] } }
  return {
    locked: false,
    grain: String(grain),
    minutes: FX_GRAIN_BY_ID[String(grain)]?.minutes || 60,
    candles: candlesFor(state, String(name), String(grain), at, { withForecast }),
    serverTime: at,
  }
}

export { decodeCandleRows }
