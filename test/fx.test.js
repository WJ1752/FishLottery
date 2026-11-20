import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState,
  exchangeFish,
  fxAppendFlow,
  fxBinCount,
  fxBiteFlow,
  fxBoard,
  fxBuy,
  fxCanTrade,
  fxConfig,
  fxDayIndex,
  fxDayMove,
  fxDayStart,
  fxExchangeFlow,
  fxMinutePath,
  fxPosition,
  fxQuote,
  fxQuotes,
  fxSession,
  fxSessionMinutes,
  fxSell,
  fxSettlementPreview,
  fxHistory,
  fxToday,
  fxTradeBins,
  mergeFxBins,
  settleFxDays,
} from '../src/game.js'
import { diffFlows } from '../server/services/market.js'
import { TRAITS } from '../src/traits.js'

const HOUR = 60 * 60 * 1000
const rich = (state, coins = 1000000) => ({ ...state, coins })
// 交易日开盘后的时刻（默认 10:00，避开 08:00 前的收市段）。
const openAt = (day, offsetHours = 10) => fxDayStart(day) + offsetHours * HOUR

test('每个词条都有报价，且买价高于卖价（价差是成本）', () => {
  const state = createInitialState()
  const quotes = fxQuotes(state, openAt(fxDayIndex(Date.now())))
  assert.equal(quotes.length, TRAITS.length)
  quotes.forEach((quote) => {
    assert.ok(quote.buy > 0 && quote.sell > 0)
    assert.ok(quote.buy > quote.sell, `${quote.name} 买价必须高于卖价`)
    assert.ok(quote.pointSpread >= 1)
  })
})

test('涨跌幅不会越过涨跌停，失衡比也被夹在 ±1', () => {
  const config = fxConfig(createInitialState())
  // 敏感度拉满，让失衡冲击本身超过涨跌停。
  const meta = { price: 100, sensitivity: 5 }
  const up = fxDayMove(1e9, 1, 100, 100, meta, config)
  const down = fxDayMove(-1e9, 1, 100, 100, meta, config)
  assert.equal(up, config.dailyLimit, '再大的净流入也只涨到涨跌停')
  assert.equal(down, -config.dailyLimit, '再大的净流出也只跌到涨跌停')
  // 失衡比被夹在 ±1：净流入超过成交量也不会放大。
  assert.equal(fxDayMove(1000, 1, 100, 100, { price: 100, sensitivity: 1 }, config), fxDayMove(1, 1, 100, 100, { price: 100, sensitivity: 1 }, config))
})

test('只钓不卖推高价格，只卖不钓压低价格', () => {
  const config = fxConfig(createInitialState())
  const meta = { price: 100, sensitivity: 1 }
  const up = fxDayMove(100, 100, 100, 100, meta, config)
  const down = fxDayMove(-100, 100, 100, 100, meta, config)
  assert.ok(up > 0 && down < 0)
  assert.equal(up, -down, '供需模型必须对称')
})

test('涨跌幅只看失衡比，与成交量规模无关', () => {
  const config = fxConfig(createInitialState())
  const meta = { price: 100, sensitivity: 1 }
  const small = fxDayMove(2, 10, 100, 100, meta, config)
  const large = fxDayMove(20000, 100000, 100, 100, meta, config)
  assert.ok(Math.abs(small - large) < 1e-9, '规模不影响涨跌幅')
})

test('钓上来又卖出去，净影响为零', () => {
  const config = fxConfig(createInitialState())
  const meta = { price: 100, sensitivity: 1 }
  assert.equal(fxDayMove(0, 200, 100, 100, meta, config), 0, '完全对冲时价格不动')
})

test('偏离基准价会被均值回归拉回', () => {
  const config = fxConfig(createInitialState())
  const meta = { price: 100, sensitivity: 1 }
  assert.ok(fxDayMove(0, 0, 200, 100, meta, config) < 0, '高于基准价要回落')
  assert.ok(fxDayMove(0, 0, 50, 100, meta, config) > 0, '低于基准价要回升')
})

test('交易日按本地零点切分，08:00 开市 / 24:00 收市', () => {
  const state = createInitialState()
  const day = fxDayIndex(Date.now())
  const start = fxDayStart(day)
  assert.equal(new Date(start).getHours(), 0, '交易日从本地零点开始')
  assert.equal(fxSession(state, start + 7 * HOUR).open, false, '07:00 未开市')
  assert.equal(fxSession(state, start + 8 * HOUR).open, true, '08:00 开市')
  assert.equal(fxSession(state, start + 23 * HOUR).open, true, '23:00 仍在交易')
  assert.equal(fxSession(state, start + 24 * HOUR).open, false, '次日零点已收市')
  assert.equal(fxSession(state, start + 3 * HOUR).phase, 'pre-open')
})

test('收市期间不接受委托，鱼币与持仓都不变', () => {
  const state = rich(createInitialState())
  const closed = fxDayStart(fxDayIndex(Date.now())) + 2 * HOUR
  assert.equal(fxCanTrade(state, closed), false)
  assert.equal(fxBuy(state, 'swift', 5, closed), state, '收市买入无效')
  assert.equal(fxSell(state, 'swift', 5, closed), state, '收市卖出无效')
})

test('买入卖出只结算鱼币，永不改动背包材料', () => {
  const state = rich(createInitialState())
  const at = openAt(fxDayIndex(Date.now()))
  const before = { ...state.inventory }
  const bought = fxBuy(state, 'swift', 10, at)
  assert.equal(fxPosition(bought, 'swift'), 10)
  assert.ok(bought.coins < state.coins)
  const sold = fxSell(bought, 'swift', 10, at)
  assert.equal(fxPosition(sold, 'swift'), 0)
  assert.deepEqual(sold.inventory, before, '背包材料必须原封不动')
  assert.ok(sold.coins > 0)
})

test('往返一次必定亏损（价差 + 双边手续费）', () => {
  const state = rich(createInitialState())
  const at = openAt(fxDayIndex(Date.now()))
  const sold = fxSell(fxBuy(state, 'prismatic', 20, at), 'prismatic', 20, at)
  assert.ok(sold.coins < state.coins, '无风险套利必须不存在')
})

test('买入受鱼币与持仓上限约束，零份不成交', () => {
  const at = openAt(fxDayIndex(Date.now()))
  const poor = fxBuy({ ...createInitialState(), coins: 50 }, 'abyssal', 10, at)
  assert.ok(fxPosition(poor, 'abyssal') < 10)
  assert.ok(poor.coins >= 0)
  const state = rich(createInitialState())
  assert.equal(fxBuy(state, 'swift', 0, at), state)
  const config = fxConfig(state)
  const whale = fxBuy(rich(createInitialState(), 1e9), 'swift', config.maxPosition + 50, at)
  assert.equal(fxPosition(whale, 'swift'), config.maxPosition)
})

test('卖出超过持仓被夹住，空仓不会凭空生钱', () => {
  const at = openAt(fxDayIndex(Date.now()))
  const state = rich(createInitialState())
  const sold = fxSell(fxBuy(state, 'heavy', 5, at), 'heavy', 999, at)
  assert.equal(fxPosition(sold, 'heavy'), 0)
  assert.equal(fxSell(createInitialState(), 'heavy', 5, at).coins, 0)
})

test('自成交不写入行情，买卖无法拉盘', () => {
  const at = openAt(fxDayIndex(Date.now()))
  const state = rich(createInitialState())
  const traded = fxSell(fxBuy(state, 'surge', 30, at), 'surge', 30, at)
  const quote = fxQuote(traded, 'surge', at)
  assert.equal(quote.todayNet, 0, '买卖不产生供给变化')
  assert.equal(quote.todayVolume, 0)
  assert.equal(quote.mid, quote.base, '价格不动')
})

test('上钩把词条抽离市场，记正流入', () => {
  const flow = fxBiteFlow({ traits: ['swift', 'swift', 'prismatic'] })
  assert.equal(flow.find((line) => line.name === 'swift').net, 2)
  assert.equal(flow.find((line) => line.name === 'prismatic').net, 1)
  assert.ok(flow.every((line) => line.net > 0), '上钩只会减少供给')
})

test('卖出把词条还回市场，与上钩严格对冲', () => {
  const fish = { traits: ['swift', 'swift', 'abyssal'] }
  const bite = fxBiteFlow(fish)
  const sold = fxExchangeFlow(fish)
  assert.equal(sold.find((line) => line.name === 'swift').net, -2)
  assert.equal(sold.find((line) => line.name === 'abyssal').net, -1)
  bite.forEach((line) => {
    const back = sold.find((item) => item.name === line.name)
    assert.equal(line.net + back.net, 0, `${line.name} 钓获与卖出必须完全对冲`)
  })
})

test('初始没有待结算流入，只有上钩与卖出会写入', () => {
  const state = createInitialState()
  assert.equal(typeof state.fx.today, 'object')
  assert.equal(Object.keys(state.fx.today).length, 0)
})

test('把鱼交给商会后写入当日负向流入', () => {
  const state = createInitialState()
  const at = openAt(fxDayIndex(Date.now()))
  const fish = { ...state.fish[0], status: 'fresh', traits: ['swift', 'swift'] }
  const next = exchangeFish({ ...state, fish: [fish] }, fish.id)
  const quote = fxQuote(next, 'swift', at)
  assert.ok(quote.todayNet < 0, '出货应让今日净流入转负')
  assert.ok(quote.todayVolume > 0)
})

test('零点结算成日线，7 天历史可回看', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  for (let i = 6; i >= 0; i -= 1) {
    // 每天只钓不卖：净流入等于成交量，失衡比 = +1。
    state = { ...state, fx: { ...state.fx, today: { swift: { day: day - i, net: 400, volume: 400 } } } }
    state = { ...state, fx: { ...state.fx, today: {} } }
  }
  const board = fxBoard(state, openAt(day))
  assert.equal(board.days.length, fxConfig(state).historyDays)
  assert.equal(board.rows.length, TRAITS.length)
  board.rows.forEach((row) => {
    assert.equal(row.bars.length, board.days.length)
    row.bars.forEach((bar) => assert.ok(Math.abs(bar.move) <= fxConfig(state).dailyLimit + 1e-9))
  })
})

test('全钓日涨幅等于 volatility，全卖等于 −volatility', () => {
  const config = fxConfig(createInitialState())
  const meta = { price: 100, sensitivity: 1 }
  const buy = fxDayMove(50, 50, 100, 100, meta, config)
  const sell = fxDayMove(-50, 50, 100, 100, meta, config)
  assert.ok(Math.abs(buy - config.volatility) < 1e-9, '全钓满仓应等于 volatility')
  assert.ok(Math.abs(sell + config.volatility) < 1e-9, '全卖应为 −volatility')
})

test('行情历史只保留 historyDays 天，不会无限增长', () => {
  const state = createInitialState()
  const config = fxConfig(state)
  const day = fxDayIndex(Date.now())
  const bars = Array.from({ length: 60 }, (_, i) => ({ day: day - i, net: 1, volume: 1, imbalance: 1, move: 0.01, close: 100 }))
  const padded = { ...state, fx: { ...state.fx, days: { swift: bars } } }
  assert.equal(fxBoard(padded, openAt(day)).days.length, config.historyDays)
})

test('报价字段完整，能支撑界面与回看', () => {
  const state = createInitialState()
  const quote = fxQuote(state, 'luminous', openAt(fxDayIndex(Date.now())))
  ;['name', 'mid', 'buy', 'sell', 'base', 'change', 'total', 'todayNet', 'todayVolume', 'pointSpread', 'lastCloseAt'].forEach((key) => {
    assert.ok(key in quote, `报价缺少 ${key}`)
  })
  assert.equal(quote.change, 0, '没有历史时日涨跌为 0')
})

test('fx 配置被归一化并夹在合法区间', () => {
  const config = fxConfig(createInitialState())
  assert.ok(config.feeRate > 0 && config.feeRate <= 0.1)
  assert.ok(config.spread >= 0 && config.spread <= 0.1)
  assert.ok(config.dailyLimit >= 0.01 && config.dailyLimit <= 1)
  assert.ok(config.openHour >= 0 && config.openHour <= 23)
  assert.ok(config.closeHour >= config.openHour + 1 && config.closeHour <= 24)
  assert.ok(config.historyDays >= 1 && config.historyDays <= 30)
  assert.ok(config.traits.swift.price > 0)
})

test('日线带完整 OHLC，且 high/low 把开收盘包住', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  for (let i = 0; i < 5; i += 1) {
    const d = day - 5 + i
    // 交替只钓 / 只卖，让开收盘有正有负。
    state = { ...state, fx: { ...state.fx, today: { swift: { day: d, net: i % 2 ? -120 : 150, volume: 200 } } } }
    state = settleFxDays(state, openAt(d + 1, 1))
  }
  const bars = fxHistory(state, 'swift')
  assert.ok(bars.length >= 4, '应落库多根日线')
  bars.forEach((bar) => {
    assert.ok(Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close))
    assert.ok(bar.high >= Math.max(bar.open, bar.close) - 1e-9, `${bar.day} 最高价必须不低于实体`)
    assert.ok(bar.low <= Math.min(bar.open, bar.close) + 1e-9, `${bar.day} 最低价必须不高于实体`)
    assert.ok(bar.low >= 1, '价格不会低于 1')
    // 开盘价接上一根收盘价，不留跳空。
  })
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].day === bars[i - 1].day + 1) {
      assert.equal(bars[i].open, bars[i - 1].close, '开盘价应等于前收盘')
    }
  }
})

test('周 K 由日线聚合：开取首日开、收取末日收，高低取区间极值', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  // 造 16 天数据，至少跨 3 个自然周。
  for (let i = 0; i < 16; i += 1) {
    const d = day - 16 + i
    state = { ...state, fx: { ...state.fx, today: { swift: { day: d, net: i % 2 ? -90 : 130, volume: 220 } } } }
    state = settleFxDays(state, openAt(d + 1, 1))
  }
  const row = fxBoard(state, openAt(day, 9)).rows.find((item) => item.name === 'swift')
  const bars = fxHistory(state, 'swift')
  assert.ok(row.weeks.length >= 2, `应聚出多根周 K，实际 ${row.weeks.length}`)
  row.weeks.forEach((week) => {
    assert.ok(week.high >= Math.max(week.open, week.close) - 1e-9)
    assert.ok(week.low <= Math.min(week.open, week.close) + 1e-9)
    assert.ok(week.days >= 1)
    // 周 K 的开盘必须来自本周第一根日线。
    const firstDay = bars.find((bar) => bar.day === week.from)
    assert.equal(week.open, firstDay.open)
  })
  // 周成交量是本周日线成交量之和。
  const totalVolume = row.weeks.reduce((sum, week) => sum + week.volume, 0)
  const barVolume = bars.reduce((sum, bar) => sum + bar.volume, 0)
  assert.equal(totalVolume, barVolume, '周成交量应等于日成交量之和')
})

test('日线按一年保留，日 K 显示窗口仍由 historyDays 决定', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  for (let i = 0; i < 45; i += 1) {
    const d = day - 45 + i
    state = { ...state, fx: { ...state.fx, today: { swift: { day: d, net: 100, volume: 200 } } } }
    state = settleFxDays(state, openAt(d + 1, 1))
  }
  const kept = fxHistory(state, 'swift')
  // 一年上限远大于这 45 天，所以全部应被保留。
  assert.equal(kept.length, 45, `应保留全部 45 天，实际 ${kept.length}`)
  const board = fxBoard(state, openAt(day, 9))
  assert.equal(board.days.length, fxConfig(state).historyDays, '日 K 窗口仍按配置')
})

test('周 K 的涨跌幅由周开收盘决定', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  // 走真实结算路径攒够 30 天：交替净流入净流出，涨跌都有。
  for (let i = 0; i < 30; i += 1) {
    const d = day - 30 + i
    const net = Math.round(Math.sin(i / 2.4) * 150)
    state = { ...state, fx: { ...state.fx, today: { swift: { day: d, net, volume: 200 + Math.abs(net) } } } }
    state = settleFxDays(state, openAt(d + 1, 1))
  }
  const board = fxBoard(state, openAt(day, 9))
  board.rows.forEach((row) => {
    row.weeks.forEach((week) => {
      const expected = week.open > 0 ? week.close / week.open - 1 : 0
      assert.ok(Math.abs(week.move - expected) < 1e-9, '周涨跌幅应等于收盘/开盘 − 1')
    })
  })
})

test('成交时间桶按实际成交的 5 分钟格子记录', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  const start = fxDayStart(day)
  // 09:20 上钩 3 条、09:50 卖出 1 条：两笔落在相邻但不同的时间格里。
  state = fxAppendFlow(state, [{ name: 'swift', net: 3, volume: 3 }], start + 9 * HOUR + 20 * 60000)
  state = fxAppendFlow(state, [{ name: 'swift', net: -1, volume: 1 }], start + 9 * HOUR + 50 * 60000)
  const bucket = fxToday(state, 'swift', start + 12 * HOUR)
  assert.equal(bucket.net, 2)
  assert.equal(bucket.volume, 4)
  assert.deepEqual(bucket.bins, [[112, 3, 3], [118, -1, 1]])
  assert.equal(fxBinCount(), 288, '一天切成 288 个 5 分钟格')

  // diffFlows 要把新增的时间桶一起带出来，服务端才能按真实时刻落库。
  const next = fxAppendFlow(state, [{ name: 'swift', net: 2, volume: 2 }], start + 10 * HOUR + 5 * 60000)
  const flows = diffFlows(state.fx.today, next.fx.today)
  assert.equal(flows.length, 1)
  assert.deepEqual(flows[0].bins, [[121, 2, 2]])
})

test('订单分散后每分钟都有成交，最高/最低成交量不超过 3 倍', () => {
  // 注意：分钟路径里叠加了按「交易日」确定的扰动相位 fxBridge(u, amp, seed)，
  // 所以同一天的绝对斜率会随日期变化。要验证「10:00 的卖出真的让涨势放缓」，
  // 必须用同一天的「有这笔卖出 / 没有这笔卖出」做对照，
  // 否则测试会随运行日期时好时坏（2026-11-19 就是这样暴露的）。
  const build = (day, withTenAmSale) => {
    let state = createInitialState()
    const start = fxDayStart(day)
    state = fxAppendFlow(state, [{ name: 'swift', net: 40, volume: 40 }], start + 9 * HOUR)
    if (withTenAmSale) state = fxAppendFlow(state, [{ name: 'swift', net: -4, volume: 4 }], start + 10 * HOUR)
    state = fxAppendFlow(state, [{ name: 'swift', net: -4, volume: 4 }], start + 20 * HOUR)
    state = settleFxDays(state, start + 25 * HOUR)
    return { state, start }
  }
  const day = fxDayIndex(Date.now()) - 1
  const withSale = build(day, true)
  const withoutSale = build(day, false)
  const path = fxMinutePath(withSale.state, 'swift', day, withSale.start + 26 * HOUR)
  const bar = fxHistory(withSale.state, 'swift').find((item) => item.day === day)
  assert.ok(bar, '应结算出日线')
  assert.ok(Array.isArray(withSale.state.fx.bins.swift[day]), '时间桶应随日线保留')

  // 成交量平滑：每一分钟都有成交，峰谷差不超过 3 倍。
  assert.equal(path.settledCount, fxSessionMinutes(fxConfig(withSale.state)))
  const volumes = path.minutes.map((item) => item.volume)
  assert.ok(volumes.every((value) => value > 0), '每一分钟都要有成交')
  assert.ok(Math.max(...volumes) <= Math.min(...volumes) * 3.01, '最高不应超过最低的 3 倍')
  const totalVolume = volumes.reduce((sum, value) => sum + value, 0)
  assert.ok(Math.abs(totalVolume - bar.volume) < 0.02, `成交量总和应等于日线，实际 ${totalVolume} vs ${bar.volume}`)

  // 价格响应真实成交时刻：同一天里，10:00 的那笔卖出必须让 10:00–13:30 的斜率明显放缓。
  const slope = (p) => (p.minutes[209].close - p.minutes[134].close) / (209 - 134)
  const withSaleSlope = slope(path)
  const controlPath = fxMinutePath(withoutSale.state, 'swift', day, withoutSale.start + 26 * HOUR)
  assert.ok(
    withSaleSlope < slope(controlPath) * 0.9,
    `10:00 的卖出应让涨势放缓：有卖出 ${withSaleSlope} vs 无卖出 ${slope(controlPath)}`,
  )

  // 20:00 的成交应压低当日收盘价（与同一天的无卖出对照）。
  assert.ok(path.minutes[809].close < controlPath.minutes[809].close, '20:00 的成交应压低价格')
  // 最后一分钟必须落回日线收盘价，日 K 和分钟 K 不能对不上。
  assert.equal(path.minutes.at(-1).close, bar.close)
})

test('没有时间桶的旧日线仍能回放，成交量同样满足平滑约束', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now()) - 1
  const start = fxDayStart(day)
  // 模拟旧数据：桶里只有聚合值，没有 bins。
  state = { ...state, fx: { ...state.fx, today: { swift: { day, net: 40, volume: 80 } } } }
  state = settleFxDays(state, start + 25 * HOUR)
  const path = fxMinutePath(state, 'swift', day, start + 26 * HOUR)
  const volumes = path.minutes.map((item) => item.volume)
  assert.ok(volumes.every((value) => value > 0), '旧数据也应铺满整个交易时段')
  assert.ok(Math.max(...volumes) <= Math.min(...volumes) * 3.01, '旧数据的成交量也要满足 3 倍约束')
})

test('开市前的成交均摊到整个开市期间，不会在开盘堆出一根巨量', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now()) - 1
  const start = fxDayStart(day)
  // 凌晨 03:00 的 320 份成交：开市前没有对应交易时刻，应摊到全天。
  state = fxAppendFlow(state, [{ name: 'swift', net: 32, volume: 320 }], start + 3 * HOUR)
  state = settleFxDays(state, start + 25 * HOUR)
  const path = fxMinutePath(state, 'swift', day, start + 26 * HOUR)
  const volumes = path.minutes.map((item) => item.volume)
  assert.ok(volumes.every((value) => value > 0), '开市前的量应均摊到每一分钟')
  // 不能出现「开盘第一分钟吃掉全部成交量」的情况。
  assert.ok(Math.max(...volumes) < 1, `单分钟成交量应很小，实际 ${Math.max(...volumes)}`)
  assert.equal(Math.round(volumes.reduce((sum, value) => sum + value, 0) * 100) / 100, 320)
})

// ---- 后台：昨日影响 + 今日结算预览 ----

test('结算预览覆盖每个标的，字段完整且能支撑后台两张表', () => {
  const state = createInitialState()
  const preview = fxSettlementPreview(state, openAt(fxDayIndex(Date.now())))
  assert.equal(preview.rows.length, TRAITS.length)
  assert.equal(preview.yesterday, preview.day - 1)
  assert.ok(preview.settlesAt > 0, '必须给出结算时刻')
  preview.rows.forEach((row) => {
    ;['name', 'label', 'base', 'yesterday', 'today'].forEach((key) => assert.ok(key in row, `${row.name} 缺少 ${key}`))
    ;['day', 'settled', 'net', 'volume', 'move', 'open', 'close'].forEach((key) => assert.ok(key in row.yesterday, `${row.name} 昨日缺少 ${key}`))
    ;['day', 'open', 'live', 'net', 'volume', 'move', 'close', 'high', 'low', 'remaining', 'limitHit'].forEach((key) => assert.ok(key in row.today, `${row.name} 今日缺少 ${key}`))
    // 没有历史时，开盘价与预计收盘都落在基准价上，不会凭空造出涨跌。
    assert.equal(row.today.open, row.base)
    assert.equal(row.today.close, row.base)
    assert.equal(row.today.move, 0)
    assert.equal(row.today.limitHit, false)
  })
  assert.equal(preview.totals.todayVolume, 0)
  assert.equal(preview.totals.yesterdayVolume, 0)
})

test('昨收就是今开：昨日日线的收盘价直接成为今天的开盘价', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  // 昨天只钓不卖：净流入等于成交量，失衡比 +1，收盘价被推高。
  state = { ...state, fx: { ...state.fx, today: { swift: { day: day - 1, net: 60, volume: 60 } } } }
  state = settleFxDays(state, openAt(day, 1))
  const preview = fxSettlementPreview(state, openAt(day, 10))
  const row = preview.rows.find((item) => item.name === 'swift')
  const bar = fxHistory(state, 'swift').find((item) => Number(item.day) === day - 1)
  assert.ok(bar, '昨日应结算出一根日线')
  assert.equal(row.yesterday.settled, true)
  assert.equal(row.yesterday.close, bar.close, '昨日收盘价应来自落库日线')
  assert.equal(row.today.open, bar.close, '今开必须等于昨收')
  assert.ok(row.yesterday.move > 0, '只钓不卖应上涨')
  assert.ok(row.yesterday.net > 0)
})

test('今日结算预览与零点真正结算出的日线完全一致', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  // 先给昨天留一根日线，让今天的开盘价不是基准价。
  state = { ...state, fx: { ...state.fx, today: { swift: { day: day - 1, net: 40, volume: 50 } } } }
  state = settleFxDays(state, openAt(day, 1))
  // 今天再记一笔待结算流水，然后先预览、再结算。
  state = fxAppendFlow(state, [{ name: 'swift', net: -18, volume: 30 }], openAt(day, 11))
  const preview = fxSettlementPreview(state, openAt(day, 12))
  const row = preview.rows.find((item) => item.name === 'swift')
  const settled = settleFxDays(state, openAt(day + 1, 1))
  const bar = fxHistory(settled, 'swift').find((item) => Number(item.day) === day)
  assert.ok(bar, '今天应结算出一根日线')
  assert.equal(row.today.close, bar.close, '预览收盘价必须等于真正落库的收盘价')
  assert.equal(row.today.move, bar.move, '预览涨跌幅必须等于落库涨跌幅')
  assert.equal(row.today.open, bar.open)
  assert.equal(row.today.high, bar.high, '影线也要一致')
  assert.equal(row.today.low, bar.low)
})

test('今日净额与成交量来自待结算桶，没有成交时预览是一条平线', () => {
  const state = createInitialState()
  const day = fxDayIndex(Date.now())
  const flat = fxSettlementPreview(state, openAt(day, 10))
  flat.rows.forEach((row) => {
    assert.equal(row.today.net, 0)
    assert.equal(row.today.volume, 0)
    assert.equal(row.today.imbalance, 0)
  })
  // 同一份 state 加一笔流水后再预览，只有这个标的动了。
  const moved = fxAppendFlow(state, [{ name: 'luminous', net: 12, volume: 20 }], openAt(day, 10))
  const preview = fxSettlementPreview(moved, openAt(day, 10))
  const row = preview.rows.find((item) => item.name === 'luminous')
  assert.equal(row.today.net, 12)
  assert.equal(row.today.volume, 20)
  assert.ok(Math.abs(row.today.imbalance - 0.6) < 1e-9)
  assert.ok(row.today.move > 0, '净抽走应推高预计收盘')
  assert.ok(row.today.close > row.today.open)
  // 其余标的仍然没有成交。
  preview.rows.filter((item) => item.name !== 'luminous').forEach((item) => {
    assert.equal(item.today.volume, 0)
    assert.equal(item.today.move, 0)
  })
  assert.equal(preview.totals.todayTraded, 1)
  assert.equal(preview.totals.todayUp, 1)
})

test('触板标记：失衡冲击超过涨跌停时 limitHit 为真，且收盘价被夹住', () => {
  let state = createInitialState()
  const config = fxConfig(state)
  const day = fxDayIndex(Date.now())
  // 敏感度拉满 + 极端失衡，未夹住的涨幅必然越过涨跌停。
  state = { ...state, config: { ...state.config, fx: { ...config, traits: { ...config.traits, swift: { ...config.traits.swift, sensitivity: 5 } } } } }
  state = fxAppendFlow(state, [{ name: 'swift', net: 1000, volume: 1000 }], openAt(day, 10))
  const row = fxSettlementPreview(state, openAt(day, 11)).rows.find((item) => item.name === 'swift')
  assert.equal(row.today.limitHit, true, '越过涨跌停应标记触板')
  assert.ok(Math.abs(row.today.move) <= config.dailyLimit + 1e-9, '预测涨跌幅仍被夹在涨跌停内')
  // 温和的失衡不触板。
  const calm = fxSettlementPreview(fxAppendFlow(createInitialState(), [{ name: 'swift', net: 1, volume: 100 }], openAt(day, 10)), openAt(day, 11))
  assert.equal(calm.rows.find((item) => item.name === 'swift').today.limitHit, false)
})

test('结算预览的汇总口径与逐行数据一致', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  state = { ...state, fx: { ...state.fx, today: { swift: { day: day - 1, net: 30, volume: 40 } } } }
  state = settleFxDays(state, openAt(day, 1))
  state = fxAppendFlow(state, [
    { name: 'swift', net: 10, volume: 20 },
    { name: 'heavy', net: -8, volume: 16 },
  ], openAt(day, 10))
  const preview = fxSettlementPreview(state, openAt(day, 11))
  const sumOf = (pick) => Math.round(preview.rows.reduce((acc, row) => acc + pick(row), 0) * 100) / 100
  assert.equal(preview.totals.todayNet, sumOf((row) => row.today.net))
  assert.equal(preview.totals.todayVolume, sumOf((row) => row.today.volume))
  assert.equal(preview.totals.todayTraded, preview.rows.filter((row) => row.today.volume > 0).length)
  assert.equal(preview.totals.todayUp, preview.rows.filter((row) => row.today.move > 0).length)
  assert.equal(preview.totals.todayDown, preview.rows.filter((row) => row.today.move < 0).length)
  assert.equal(preview.totals.yesterdayTraded, preview.rows.filter((row) => row.yesterday.volume > 0).length)
  assert.equal(preview.totals.limitHits, preview.rows.filter((row) => row.today.limitHit).length)
})

test('昨日原始流水按 288 个 5 分钟格铺开，供后台画柱状图', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  const start = fxDayStart(day - 1)
  // 昨天 09:20 与 14:50 各一笔，落在不同的 15 分钟格里。
  state = fxAppendFlow(state, [{ name: 'swift', net: 5, volume: 8 }], start + 9 * HOUR + 20 * 60000)
  state = fxAppendFlow(state, [{ name: 'swift', net: -3, volume: 6 }], start + 14 * HOUR + 50 * 60000)
  state = settleFxDays(state, openAt(day, 1))
  const row = fxSettlementPreview(state, openAt(day, 10)).rows.find((item) => item.name === 'swift')
  assert.equal(row.yesterday.bins.length, 288, '一天切成 288 个 5 分钟格')
  assert.equal(row.yesterday.activeBins, 2, '只有两格有成交')
  const filled = row.yesterday.bins.filter((bin) => bin.net || bin.volume)
  assert.equal(filled.length, 2)
  // 桶里的净额与成交量原样保留，方向不能反。
  assert.deepEqual(filled.map((bin) => [bin.net, bin.volume]), [[5, 8], [-3, 6]])
  // 每格都带本地时刻，横轴直接用。
  filled.forEach((bin) => assert.ok(bin.at > 0))
  // 铺开后的总量必须等于日线汇总，否则柱状图和上面的表格对不上。
  assert.equal(filled.reduce((sum, bin) => sum + bin.net, 0), row.yesterday.net)
  assert.equal(filled.reduce((sum, bin) => sum + bin.volume, 0), row.yesterday.volume)
})

test('没有成交的昨日也会给出 288 格空桶，界面不用自己补空洞', () => {
  const state = createInitialState()
  const row = fxSettlementPreview(state, openAt(fxDayIndex(Date.now()), 10)).rows.find((item) => item.name === 'swift')
  assert.equal(row.yesterday.bins.length, 288)
  assert.equal(row.yesterday.activeBins, 0)
  assert.ok(row.yesterday.bins.every((bin) => bin.net === 0 && bin.volume === 0))
})

test('时间桶不完整时给出覆盖率与未记录部分，不让部分冒充全部', () => {
  const state = createInitialState()
  const day = fxDayIndex(Date.now())
  // 模拟旧数据：日线有汇总，但时间桶只记了很小一部分。
  const bars = [[day - 1, 30.2, 1953, 10297, 30, 30.5, 29.8]]
  const padded = {
    ...state,
    fx: {
      ...state.fx,
      days: { swift: bars },
      bins: { swift: { [day - 1]: [[60, 24, 24], [61, 39, 39]] } },
    },
  }
  const row = fxSettlementPreview(padded, openAt(day, 10)).rows.find((item) => item.name === 'swift')
  assert.equal(row.yesterday.net, 1953, '日线汇总仍然是完整的')
  assert.equal(row.yesterday.bins.reduce((sum, bin) => sum + bin.net, 0), 63, '逐格只覆盖了一小部分')
  assert.ok(row.yesterday.coverage < 0.01, `覆盖率应很低，实际 ${row.yesterday.coverage}`)
  assert.equal(row.yesterday.untrackedNet, 1890, '未记录部分 = 日线 − 逐格')
  assert.ok(row.yesterday.untrackedVolume > 0)
  // 逐格 + 未记录必须精确等于日线，界面上的两个数字才对得上。
  assert.equal(row.yesterday.bins.reduce((sum, bin) => sum + bin.net, 0) + row.yesterday.untrackedNet, row.yesterday.net)
})

test('时间桶完整时覆盖率为 1、未记录部分为 0', () => {
  let state = createInitialState()
  const day = fxDayIndex(Date.now())
  state = fxAppendFlow(state, [{ name: 'swift', net: 5, volume: 8 }], fxDayStart(day - 1) + 9 * HOUR)
  state = settleFxDays(state, openAt(day, 1))
  const row = fxSettlementPreview(state, openAt(day, 10)).rows.find((item) => item.name === 'swift')
  assert.equal(row.yesterday.coverage, 1)
  assert.equal(row.yesterday.untrackedNet, 0)
  assert.equal(row.yesterday.untrackedVolume, 0)
})

// ---- 原始流水 → 价格 的第一道闸门：没有成交量的格子必须先被删除 ----

test('只有连续 15 分钟以上没有流水才删，短暂冷场保留', () => {
  // 5 分钟一格 ⇒ 15 分钟 = 3 格。距最近一笔成交 < 3 格的无量格算正常冷场。
  const raw = [
    [10, 50, 100],   // 有成交
    [11, 0, 0],      // 距 10 号格 1 格 → 冷场，保留
    [12, 0, 0],      // 距 10 号格 2 格 → 冷场，保留
    [13, 0, 0],      // 距 10 号格正好 3 格 → 超过容忍窗口，丢弃
    [20, 0, 0],      // 两边都没有成交 → 大片空档，丢弃
    [30, -30, 15],   // 有成交
  ]
  const bins = fxTradeBins(raw)
  assert.deepEqual(bins.map((bin) => bin[0]), [10, 11, 12, 30], '只删掉连续 15 分钟无流水的部分')
})

test('无量格携带的净额落在冷场窗口内时保留，由结算差额吸收', () => {
  const raw = [
    [10, 50, 100],
    [11, 999, 0],
    [40, 0, 0],   // 孤立空档 → 丢弃
  ]
  const bins = fxTradeBins(raw)
  assert.deepEqual(bins.map((bin) => bin[0]), [10, 11])
  assert.deepEqual(bins.find((bin) => bin[0] === 11), [11, 999, 0])
})

test('同一格子多次写入会合并，合并后无量格按空档规则处理', () => {
  const merged = mergeFxBins([[10, 20, 30]], [[10, -20, 30]])
  // 净额抵消但成交量仍在：这是真实成交（一买一卖），保留。
  assert.deepEqual(merged, [[10, 0, 60]])
  // 量也抵消成 0 且周围没有成交：认定为空档，丢弃。
  const cancelled = mergeFxBins([[10, 20, 0]], [[10, 5, 0]])
  assert.deepEqual(cancelled, [])
  // 但有另一格真实成交在 15 分钟内，这个 0 量格就属于冷场，保留。
  const kept = mergeFxBins([[10, 20, 0], [12, 9, 9]], [[10, 5, 0]])
  assert.deepEqual(kept.map((bin) => bin[0]), [10, 12])
})

test('幽灵流水不会推动日内价格', () => {
  const day = fxDayIndex(Date.now())
  const start = fxDayStart(day - 1)
  // 两天的流水完全相同，唯一区别是 B 多了一格「只有净额没有成交量」。
  const build = (withGhost) => {
    let state = createInitialState()
    state = fxAppendFlow(state, [{ name: 'swift', net: 20, volume: 40, bins: [[40, 20, 40]] }], start + 10 * HOUR)
    if (withGhost) {
      // 直接写进桶：模拟上游灌进来的脏数据（appendFlow 本身会补量，绕不过）
      state = { ...state, fx: { ...state.fx, today: { swift: { ...state.fx.today.swift, bins: [...state.fx.today.swift.bins, [41, 5000, 0]] } } } }
    }
    // 走真实路径：零点结算后再回看那一天的日内走势。
    return fxMinutePath(settleFxDays(state, openAt(day, 1)), 'swift', day - 1, openAt(day, 12))
  }
  const clean = build(false)
  const ghost = build(true)
  assert.deepEqual(
    ghost.minutes.map((m) => m.close),
    clean.minutes.map((m) => m.close),
    '幽灵流水不应让任何一分钟的价格发生变化',
  )
})

// ---- 日内路径的形状：不能是一条斜线 ----

test('有成交的交易日，日内价格必须有涨有跌，而不是单调一条线', () => {
  const day = fxDayIndex(Date.now())
  const start = fxDayStart(day - 1)
  let state = createInitialState()
  // 全天一边倒的净流入：旧实现会画出严格单调的斜线。
  for (const slot of [40, 48, 56, 64]) {
    state = fxAppendFlow(state, [{ name: 'swift', net: 30, volume: 40 }], start + slot * 15 * 60000)
  }
  // 走真实路径：先零点结算，再回看那一天的日内走势（那时才有成交量）。
  const settled = settleFxDays(state, openAt(day, 1))
  const path = fxMinutePath(settled, 'swift', day - 1, openAt(day, 12))
  const closes = path.minutes.map((m) => m.close)
  let up = 0
  let down = 0
  for (let i = 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 1e-9) up += 1
    else if (diff < -1e-9) down += 1
  }
  assert.ok(up > 0, '必须有上涨的分钟')
  assert.ok(down > 0, '必须有下跌的分钟')
  const hi = Math.max(...closes)
  const lo = Math.min(...closes)
  assert.ok(hi / lo - 1 > 0.005, `日内振幅应可见，实际 ${((hi / lo - 1) * 100).toFixed(2)}%`)
})

test('日内摆动不影响开盘价与结算价：首分钟开=前收，末分钟收=结算价', () => {
  const day = fxDayIndex(Date.now())
  const start = fxDayStart(day - 1)
  let state = createInitialState()
  for (const slot of [40, 52, 68]) {
    state = fxAppendFlow(state, [{ name: 'swift', net: 25, volume: 35 }], start + slot * 15 * 60000)
  }
  const settled = settleFxDays(state, openAt(day, 1))
  const bar = fxHistory(settled, 'swift').find((item) => item.day === day - 1)
  const path = fxMinutePath(settled, 'swift', day - 1, openAt(day, 1))
  assert.equal(path.minutes[0].open, bar.open, '开盘价必须等于前收')
  assert.ok(Math.abs(path.minutes.at(-1).close - bar.close) < 0.005, `末分钟应落在结算价，实际 ${path.minutes.at(-1).close} vs ${bar.close}`)
})

test('日内摆动被往返成本封顶：峰值差永远套不出利润', () => {
  const day = fxDayIndex(Date.now())
  const start = fxDayStart(day - 1)
  // 净额取 0，把当天趋势摘掉，单独测「摆动」这一项。
  // 波动系数拉到上限 50%，摆动也不应突破 70% 的往返成本。
  let state = createInitialState()
  const config = state.config
  state = { ...state, config: { ...config, fx: { ...config.fx, volatility: 0.5 } } }
  state = fxAppendFlow(state, [{ name: 'swift', net: 0, volume: 200 }], start + 48 * 15 * 60000)
  const settled = settleFxDays(state, openAt(day, 1))
  const path = fxMinutePath(settled, 'swift', day - 1, openAt(day, 12))
  const closes = path.minutes.map((m) => m.close)
  const swing = Math.max(...closes) / Math.min(...closes) - 1
  const roundTrip = config.fx.feeRate * 2 + config.fx.spread
  assert.ok(swing > 0, '即使净额为 0，有成交也应有日内摆动')
  assert.ok(swing <= roundTrip * 0.7 + 1e-6, `日内摆动 ${(swing * 100).toFixed(2)}% 不应超过往返成本 ${(roundTrip * 100).toFixed(0)}% 的 70%`)
})

test('没有任何成交时日内仍是一条平线（无成交就不该凭空波动）', () => {
  const state = createInitialState()
  const day = fxDayIndex(Date.now())
  const path = fxMinutePath(state, 'swift', day, openAt(day, 12))
  const closes = path.minutes.map((m) => m.close)
  assert.equal(new Set(closes.map((v) => v.toFixed(6))).size, 1, '无成交时价格恒定')
})
