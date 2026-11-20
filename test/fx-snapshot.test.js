import test from 'node:test'
import assert from 'node:assert/strict'
import { FX_GRAINS, decodeCandleRows, fxLockedGrains } from '../src/fx-grains.js'
import { buildFxCandles, buildFxSnapshot, invalidateFxSnapshot } from '../server/services/fx-snapshot.js'
import { blackBuy, createInitialState, fxDayStart, fxDayIndex, normalizeBlackMarketConfig, DEFAULT_CONFIG, fxAppendFlow } from '../src/game.js'

const HOUR = 60 * 60 * 1000
// 造一份「有几天行情」的状态，让蜡烛不为空。
function seeded(now) {
  const day = fxDayIndex(now)
  let state = createInitialState()
  for (let i = 3; i >= 1; i -= 1) {
    state = fxAppendFlow(state, [{ name: 'swift', net: i * 10, volume: i * 15 }], fxDayStart(day - i) + 10 * HOUR)
  }
  state = fxAppendFlow(state, [{ name: 'swift', net: 5, volume: 9 }], fxDayStart(day) + 10 * HOUR)
  return state
}

test('档位只剩 120/60/30/15，日K 与 5 分已下线', () => {
  assert.deepEqual(FX_GRAINS.map((g) => g.id), ['m120', 'm60', 'm30', 'm15'])
  assert.deepEqual(FX_GRAINS.map((g) => g.label), ['120分', '60分', '30分', '15分'])
})

test('默认只开放 120 分与 60 分，30 分与 15 分需要解锁', () => {
  const locked = fxLockedGrains({})
  assert.deepEqual(locked, ['m30', 'm15'])
  const unlocked = fxLockedGrains({ 'grain-m30': 1, 'grain-m15': 1 })
  assert.deepEqual(unlocked, [])
})

test('未解锁档位服务端根本不下发蜡烛', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const snap = buildFxSnapshot(state, { purchases: {}, at: now })
  // grains 元信息里有全部档位，但 locked 标记区分可见性。
  assert.deepEqual(snap.grains.map((g) => g.id), ['m120', 'm60', 'm30', 'm15'])
  assert.deepEqual(snap.grains.filter((g) => g.locked).map((g) => g.id), ['m30', 'm15'])
  // candles 里只算开放的档位。
  Object.values(snap.candles).forEach((byGrain) => {
    assert.deepEqual(Object.keys(byGrain).sort(), ['m120', 'm60'])
  })
})

test('解锁后服务端才开始下发对应档位的蜡烛', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const snap = buildFxSnapshot(state, { purchases: { 'grain-m30': 1 }, at: now })
  assert.deepEqual(snap.grains.filter((g) => g.locked).map((g) => g.id), ['m15'])
  Object.values(snap.candles).forEach((byGrain) => {
    assert.deepEqual(Object.keys(byGrain).sort(), ['m120', 'm30', 'm60'])
  })
})

test('单标的按需拉取会拒绝未解锁档位', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const denied = buildFxCandles(state, { name: 'swift', grain: 'm15', purchases: {}, at: now })
  assert.equal(denied.locked, true)
  assert.equal(denied.candles.rows.length, 0, '锁着的档位不能返回任何蜡烛')

  const ok = buildFxCandles(state, { name: 'swift', grain: 'm60', purchases: {}, at: now })
  assert.equal(ok.locked, false)
  assert.ok(ok.candles.rows.length > 0, '开放档位应有蜡烛')
})

test('黑市解锁档位：扣渔币、幂等、不可重复购买', () => {
  const base = createInitialState()
  const cfg = normalizeBlackMarketConfig(DEFAULT_CONFIG.blackMarket)
  assert.equal(cfg.shop.filter((i) => i.kind === 'grain').length, 2)
  const state = {
    ...base,
    unlockedDepths: [...base.unlockedDepths, cfg.unlockDepth],
    blackMarket: { ...base.blackMarket, coins: 5000 },
  }
  const first = blackBuy(state, 'grain-m30')
  assert.equal(first.code, null)
  assert.equal(first.state.blackMarket.coins, 5000 - 800)
  assert.equal(first.state.blackMarket.purchases['grain-m30'], 1)
  // once=true：再买一次被拒。
  assert.equal(blackBuy(first.state, 'grain-m30').code, 'BLACK_LIMIT')
  // 渔币不足时被拒。
  const poor = { ...state, blackMarket: { ...state.blackMarket, coins: 10 } }
  assert.equal(blackBuy(poor, 'grain-m15').code, 'BLACK_FUNDS')
})

test('蜡烛序列用列名+行数组编码，解码后字段完整', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const payload = buildFxCandles(state, { name: 'swift', grain: 'm60', purchases: {}, at: now }).candles
  assert.ok(Array.isArray(payload.cols) && Array.isArray(payload.rows))
  const bars = decodeCandleRows(payload)
  assert.ok(bars.length > 0)
  bars.forEach((bar) => {
    assert.ok(Number.isFinite(bar.open) && Number.isFinite(bar.close))
    assert.ok(bar.high >= Math.max(bar.open, bar.close) - 1e-9, '最高价必须不低于实体')
    assert.ok(bar.low <= Math.min(bar.open, bar.close) + 1e-9, '最低价必须不高于实体')
    assert.equal(typeof bar.settled, 'boolean')
  })
})

test('快照只含数字，不含任何算法字段', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const snap = buildFxSnapshot(state, { purchases: {}, at: now })
  const text = JSON.stringify(snap)
  // 客户端不能再拿到 days/today/bins 这类「原料」，否则可以本地复算。
  assert.ok(!('days' in snap) && !('today' in snap) && !('bins' in snap))
  assert.ok(!text.includes('fxMinutePath') && !text.includes('volatility') && !text.includes('reversion'))
})

test('withCandles=false 时不带蜡烛，用于每秒轮询', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const full = buildFxSnapshot(state, { purchases: {}, at: now })
  const light = buildFxSnapshot(state, { purchases: {}, withCandles: false, at: now })
  assert.ok(full.candles)
  assert.equal(light.candles, undefined)
  assert.ok(JSON.stringify(light).length < JSON.stringify(full).length / 2, '轻量快照应显著更小')
})

// ---- 预测段的安全边界 ----

test('玩家快照永远不含推演段，管理端快照才有', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const player = buildFxSnapshot(state, { purchases: {}, at: now })
  const admin = buildFxSnapshot(state, { purchases: {}, withForecast: true, at: now })

  const projected = (snap) => {
    const sw = snap.candles?.swift?.m60
    return sw ? sw.rows.filter((row) => row[7] === 1).length : 0
  }
  assert.equal(projected(player), 0, '玩家侧不允许出现任何推演蜡烛')
  assert.ok(projected(admin) > 0, '管理端应能看到推演段')
})

test('玩家蜡烛时间单调递增，且「进行中」不是预测样式', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const sw = buildFxSnapshot(state, { purchases: {}, at: now }).candles.swift.m60
  const times = sw.rows.map((row) => row[0])
  times.forEach((t, i) => {
    if (i > 0) assert.ok(t >= times[i - 1], `时间必须单调递增，第 ${i} 根乱了`)
  })
  // 进行中的那根是真实成交：settled=false 但 projected=false。
  const running = sw.rows.filter((row) => row[8] === 1)
  assert.ok(running.length <= 1, '最多一根进行中的蜡烛')
  running.forEach((row) => assert.equal(row[7], 0, '进行中不应被标成推演'))
})

test('进行中的那根成交量不会吞掉全天成交', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const sw = buildFxSnapshot(state, { purchases: {}, at: now }).candles.swift.m60
  const volumes = sw.rows.map((row) => row[5]).filter((v) => v > 0)
  const max = Math.max(...volumes)
  const sum = volumes.reduce((a, b) => a + b, 0)
  // 原来那根「实时柱」把当天全部成交塞进一根，会出现 max ≈ sum 的异常。
  assert.ok(max < sum * 0.9, `单根成交量 ${max} 不应接近全天总量 ${sum}`)
})

test('管理端能看到全部档位（含玩家未解锁的）', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  const admin = buildFxSnapshot(state, { purchases: {}, withForecast: true, at: now })
  assert.deepEqual(Object.keys(admin.candles.swift).sort(), ['m120', 'm15', 'm30', 'm60'])
  const player = buildFxSnapshot(state, { purchases: {}, at: now })
  assert.deepEqual(Object.keys(player.candles.swift).sort(), ['m120', 'm60'])
})

test('withForecast 进缓存键，玩家与管理端不会互相串数据', () => {
  const now = fxDayStart(fxDayIndex(Date.now())) + 12 * HOUR
  const state = seeded(now)
  invalidateFxSnapshot()
  const first = buildFxSnapshot(state, { purchases: {}, at: now })
  const second = buildFxSnapshot(state, { purchases: {}, withForecast: true, at: now })
  const playerBars = first.candles.swift.m60.rows.length
  const adminBars = second.candles.swift.m60.rows.length
  assert.ok(adminBars > playerBars, `管理端蜡烛应多于玩家：${adminBars} vs ${playerBars}`)
})
