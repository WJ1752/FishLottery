import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CONFIG, DEPTHS,
  blackAcknowledge, blackBuy, blackDailyQuota, blackFishEligible, blackFishValue, blackMarketUnlocked,
  blackRefreshOrder, blackSellFish, blackSellMaterial, blackSuperPlan, blackSuperReveal,
  createInitialState, hydrateState, makeScratchCard, normalizeConfig, redactScratchFaces,
  refreshBlackMarketDay, scratchPoolHash, scratchPoolSnapshot, scratchPoolStats, scratchSettlement,
} from '../src/game.js'

const rng = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const unlockedState = (seed = 1) => {
  const config = normalizeConfig(DEFAULT_CONFIG)
  const state = createInitialState(config, rng(seed))
  return {
    ...state,
    unlockedDepths: DEPTHS.slice(0, 4).map((depth) => depth.id),
    blackMarket: { ...state.blackMarket, day: 1 },
  }
}

const withOrder = (state, order = { demand: 'swift', banned: ['armored', 'heavy'] }) => ({
  ...state,
  blackMarket: {
    ...state.blackMarket,
    day: 1,
    order: { depthId: 'shore', acceptance: 0.3, generatedAt: null, ...order },
  },
})

test('黑市配置归一化：非法值回退，锁钥不进回收表', () => {
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    blackMarket: {
      ...DEFAULT_CONFIG.blackMarket,
      unlockDepth: 'nowhere',
      fish: { ...DEFAULT_CONFIG.blackMarket.fish, dailyQuota: -5, traitBonus: 2 },
      super: { ...DEFAULT_CONFIG.blackMarket.super, slots: 99, need: 9, targetEv: 5, baseline: -1 },
      materials: { 浮木纤维: { per: 10, coins: 2 }, 潮汐锁钥: { per: 1, coins: 99 } },
      shop: [{ id: 'bad', kind: 'nope' }, { id: 'rod-shadow', kind: 'rod', price: 10, rodId: 'shadow' }],
    },
  })
  const bm = config.blackMarket
  assert.equal(bm.unlockDepth, 'deep')
  assert.equal(bm.fish.dailyQuota, 0)
  assert.equal(bm.fish.traitBonus, 2)
  assert.ok(bm.super.slots >= 3 && bm.super.slots <= 9)
  assert.ok(bm.super.need <= bm.super.slots)
  assert.ok(bm.super.targetEv >= bm.super.evMin && bm.super.targetEv <= bm.super.evMax)
  assert.ok(bm.super.baseline >= 0)
  assert.deepEqual(Object.keys(bm.materials), ['浮木纤维'])
  assert.equal(bm.materials['浮木纤维'].coins, 2)
  assert.ok(bm.shop.every((item) => item.kind !== 'nope'))
  // 黑市限定钓竿始终存在，老配置也会被补齐。
  assert.ok(config.rods.some((rod) => rod.id === 'shadow'))
})

test('黑市解锁：必须已解锁海沟，停用后一律锁定', () => {
  const config = normalizeConfig(DEFAULT_CONFIG)
  const locked = { ...createInitialState(config, rng(2)), unlockedDepths: ['shore', 'shelf', 'open'] }
  assert.equal(blackMarketUnlocked(locked, config), false)
  assert.equal(blackMarketUnlocked({ ...locked, unlockedDepths: ['shore', 'shelf', 'open', 'deep'] }, config), true)
  const disabled = normalizeConfig({ ...DEFAULT_CONFIG, blackMarket: { ...DEFAULT_CONFIG.blackMarket, enabled: false } })
  assert.equal(blackMarketUnlocked({ ...locked, unlockedDepths: ['shore', 'shelf', 'open', 'deep'] }, disabled), false)
})

test('日切生成个人订单：词条合法、禁用词条不重复，且当天稳定', () => {
  const state = unlockedState(3)
  const config = state.config
  const at = Date.UTC(2026, 0, 2, 4, 0, 0)
  const first = refreshBlackMarketDay(state, at, config, rng(10))
  assert.equal(first.changed, true)
  const order = first.state.blackMarket.order
  assert.ok(order)
  const traitIds = new Set(config.traits.map((trait) => trait.id))
  assert.ok(traitIds.has(order.demand))
  assert.equal(order.banned.length, 2)
  assert.equal(new Set(order.banned).size, 2)
  assert.ok(!order.banned.includes(order.demand))
  assert.ok(order.banned.every((id) => traitIds.has(id)))
  assert.ok(order.acceptance >= 0 && order.acceptance <= 1)
  // 同一天再刷新不会重新生成订单。
  const second = refreshBlackMarketDay(first.state, at + 60000, config, rng(11))
  assert.equal(second.changed, false)
  assert.deepEqual(second.state.blackMarket.order, order)
  // 跨天：订单、已售、刷新次数、当日购买次数全部清零。
  const nextDay = refreshBlackMarketDay({
    ...second.state,
    blackMarket: { ...second.state.blackMarket, soldToday: 5, rerolls: 2, dailyBuys: { repair: 3 } },
  }, at + 24 * 60 * 60 * 1000, config, rng(12))
  assert.equal(nextDay.changed, true)
  assert.equal(nextDay.state.blackMarket.soldToday, 0)
  assert.equal(nextDay.state.blackMarket.rerolls, 0)
  assert.deepEqual(nextDay.state.blackMarket.dailyBuys, {})
  assert.ok(nextDay.state.blackMarket.order)
})

test('鱼价只看词条数，黑市秤只作用于卖鱼', () => {
  const state = unlockedState(4)
  const config = state.config
  const fish = (count) => ({ id: `f-${count}`, status: 'fresh', traits: config.traits.slice(0, count).map((trait) => trait.id) })
  assert.equal(blackFishValue(state, fish(0), config), 1)
  assert.equal(blackFishValue(state, fish(1), config), 1)
  assert.equal(blackFishValue(state, fish(3), config), 3)
  assert.equal(blackFishValue(state, fish(6), config), 6)
  const scaleItem = config.blackMarket.shop.find((item) => item.kind === 'scale')
  const scaled = { ...state, blackMarket: { ...state.blackMarket, purchases: { [scaleItem.id]: 1 } } }
  // 5 词条 ×1.1 = 5.5 → 6。
  assert.equal(blackFishValue(scaled, fish(5), config), 6)
})

test('卖鱼：加渔币、鱼转 black、不写 FX 流水，配额用完即停', () => {
  const base = withOrder(unlockedState(5))
  const config = normalizeConfig({
    ...base.config,
    blackMarket: { ...base.config.blackMarket, fish: { ...base.config.blackMarket.fish, dailyQuota: 1 } },
  })
  const matching = { id: 'fish-a', status: 'fresh', name: '银鳞鲹', traits: ['swift', 'luminous'] }
  const banned = { id: 'fish-b', status: 'fresh', name: '玄甲石斑', traits: ['swift', 'armored'] }
  const state = {
    ...base,
    config,
    fish: [matching, banned],
    blackMarket: { ...base.blackMarket, order: { ...base.blackMarket.order, demand: 'swift', banned: ['armored', 'heavy'] } },
  }
  assert.equal(blackFishEligible(state, matching, config), true)
  assert.equal(blackFishEligible(state, banned, config), false)
  assert.equal(blackDailyQuota(state, config), 1)
  const beforeFx = JSON.stringify(state.fx.today)
  const sold = blackSellFish(state, ['fish-a', 'fish-b'], Date.now(), config)
  assert.equal(sold.code, null)
  assert.equal(sold.state.blackMarket.coins, 2)
  assert.equal(sold.state.blackMarket.soldToday, 1)
  assert.equal(sold.state.blackMarket.lastSale.accepted, 1)
  assert.equal(sold.state.blackMarket.lastSale.quotaReached, true)
  assert.equal(sold.state.fish.find((fish) => fish.id === 'fish-a').status, 'black')
  assert.equal(sold.state.fish.find((fish) => fish.id === 'fish-a').blackValue, 2)
  // 黑市卖鱼等价于把鱼留在仓库：不产生任何 FX 负流入。
  assert.equal(JSON.stringify(sold.state.fx.today), beforeFx)
  const again = blackSellFish(sold.state, ['fish-a'], Date.now(), config)
  assert.equal(again.code, 'BLACK_QUOTA')
  assert.equal(again.state, sold.state)
})

test('材料回收按组结算，数量不足不生效', () => {
  const state = withOrder(unlockedState(6))
  const config = state.config
  const rich = { ...state, inventory: { ...state.inventory, 浮木纤维: 45 } }
  const sold = blackSellMaterial(rich, '浮木纤维', 2, Date.now(), config)
  assert.equal(sold.code, null)
  assert.equal(sold.state.inventory['浮木纤维'], 5)
  assert.equal(sold.state.blackMarket.coins, 2)
  assert.equal(sold.state.blackMarket.lastSale.kind, 'material')
  const empty = blackSellMaterial({ ...rich, inventory: { ...rich.inventory, 浮木纤维: 5 } }, '浮木纤维', 1, Date.now(), config)
  assert.equal(empty.code, 'BLACK_INELIGIBLE')
  // 锁钥不能回收。
  assert.equal(blackSellMaterial(rich, '潮汐锁钥', 1, Date.now(), config).code, 'BLACK_INELIGIBLE')
})

test('刷新收购单扣渔币并受每日次数限制', () => {
  const state = withOrder(unlockedState(7))
  const config = state.config
  const poor = { ...state, blackMarket: { ...state.blackMarket, coins: 0 } }
  assert.equal(blackRefreshOrder(poor, config, rng(20)).code, 'BLACK_FUNDS')
  const rich = { ...state, blackMarket: { ...state.blackMarket, coins: 100 } }
  const refreshed = blackRefreshOrder(rich, config, rng(21))
  assert.equal(refreshed.code, null)
  assert.equal(refreshed.state.blackMarket.coins, 75)
  assert.equal(refreshed.state.blackMarket.rerolls, 1)
  const capped = { ...rich, blackMarket: { ...rich.blackMarket, rerolls: config.blackMarket.order.refreshLimit } }
  assert.equal(blackRefreshOrder(capped, config, rng(22)).code, 'BLACK_LIMIT')
})

test('商店：一次性钓竿只能买一次，配额涨价按已购次数累加', () => {
  const state = unlockedState(8)
  const config = state.config
  const rich = { ...state, blackMarket: { ...state.blackMarket, coins: 5000 } }
  const bought = blackBuy(rich, 'rod-shadow', config, Date.now(), rng(30))
  assert.equal(bought.code, null)
  assert.ok(bought.state.rods.some((rod) => rod.id === 'rod-shadow'))
  assert.equal(bought.state.blackMarket.coins, 2600)
  assert.equal(blackBuy(bought.state, 'rod-shadow', config, Date.now(), rng(31)).code, 'BLACK_LIMIT')
  const quota = config.blackMarket.shop.find((item) => item.kind === 'quota')
  const first = blackBuy(rich, quota.id, config, Date.now(), rng(32))
  assert.equal(first.code, null)
  assert.equal(first.state.blackMarket.coins, 5000 - quota.price)
  const second = blackBuy(first.state, quota.id, config, Date.now(), rng(33))
  assert.equal(second.state.blackMarket.coins, 5000 - quota.price - (quota.price + quota.priceGrowth))
  assert.equal(second.state.blackMarket.quotaBonus, config.blackMarket.fish.quotaStep * 2)
})

test('未刮卡面不下发，已刮开的卡保留卡面', () => {
  const state = unlockedState(9)
  const ready = state.scratchCards.find((card) => card.status === 'ready')
  const revealed = { ...ready, id: 'revealed', status: 'revealed', face: [{ kind: 'coin', name: '鱼币', qty: 1, need: 2 }], payout: [] }
  const redacted = redactScratchFaces({ ...state, scratchCards: [ready, revealed] })
  const hidden = redacted.scratchCards[0]
  assert.equal(hidden.face, undefined)
  assert.equal(hidden.payout, undefined)
  assert.ok(hidden.id)
  assert.ok(hidden.poolHash)
  assert.ok(hidden.slots >= 2)
  assert.ok(Array.isArray(redacted.scratchCards[1].face))
})

test('奖池快照精确计算 μ/σ²，旧卡迁移补快照', () => {
  const config = normalizeConfig(DEFAULT_CONFIG)
  const type = config.scratchTypes[0]
  const pool = scratchPoolSnapshot(type)
  const stats = scratchPoolStats(pool)
  const wood = stats.rewards.get('material:浮木纤维')
  // 3 格、need=2、p=0.28、qty=3：3 × C(3,2) × 0.28² = 0.7056。
  assert.ok(Math.abs(wood.E - 0.7056) < 1e-9)
  assert.ok(wood.Var > 0)
  const coin = stats.rewards.get('coin:鱼币')
  assert.ok(Math.abs(coin.E - 1.728) < 1e-9)

  const fresh = createInitialState(config, rng(40))
  const legacy = { id: 'legacy', status: 'ready', typeId: type.id, face: [{ kind: 'material', name: '浮木纤维', qty: 3, need: 2 }], createdAt: new Date().toISOString() }
  const migrated = hydrateState({ ...fresh, scratchCards: [legacy] }, Date.now(), config)
  const card = migrated.scratchCards[0]
  assert.ok(card.pool)
  assert.equal(card.poolSource, 'migrated')
  assert.equal(card.poolHash, scratchPoolHash(card.pool))
  assert.equal(card.face.length, 1)
  assert.equal(card.pool.slots, 2)
  // 卡种被删除：没有快照可补，标记 missing，超级卡拒绝。
  const missing = hydrateState({ ...fresh, scratchCards: [{ ...legacy, typeId: 'deleted-type' }] }, Date.now(), config)
  assert.equal(missing.scratchCards[0].pool, null)
  assert.equal(missing.scratchCards[0].poolSource, 'missing')
})

test('超级刮刮乐：消耗卡片、生成待刮卡、禁止并行、结算入账', () => {
  const state = unlockedState(10)
  const config = state.config
  const cards = Array.from({ length: 4 }, (_, index) => makeScratchCard(`super-card-${index}`, config.scratchTypes[0].id, config.scratchTypes[0], rng(100 + index)))
  const withCards = { ...state, scratchCards: cards }
  const plan = blackSuperPlan(withCards, cards.map((card) => card.id), config, rng(50))
  assert.equal(plan.code, null)
  assert.ok(plan.super)
  assert.equal(plan.super.status, 'ready')
  assert.equal(plan.super.totalCount, 4)
  assert.equal(plan.super.face.length, config.blackMarket.super.slots)
  assert.ok(plan.super.payoutRate >= 0.01 && plan.super.payoutRate <= 1e6)
  assert.equal(plan.state.scratchCards.length, 0)
  assert.equal(plan.state.blackMarket.stats.superConsumed, 4)
  // 待刮的超级卡没结算前不能开下一张。
  assert.equal(blackSuperPlan(plan.state, ['x'], config, rng(51)).code, 'SUPER_PENDING')
  const revealed = blackSuperReveal(plan.state, Date.now(), config)
  assert.equal(revealed.code, null)
  assert.equal(revealed.state.blackMarket.super, null)
  assert.ok(revealed.state.blackMarket.lastSuper)
  assert.equal(revealed.state.blackMarket.lastSuper.status, 'revealed')
  assert.equal(revealed.state.blackMarket.stats.superPayouts, 1)
  assert.equal(blackSuperReveal(revealed.state, Date.now(), config).code, 'SUPER_NOT_READY')
})

test('超级刮刮乐拒绝没有可支付奖励的卡池', () => {
  const state = unlockedState(11)
  const config = state.config
  const deadType = {
    id: 'dead-type',
    name: '死池',
    slots: 3,
    prizes: [{ kind: 'material', name: '浮木纤维', qty: 1, weight: 1, need: 5 }],
  }
  const card = makeScratchCard('dead-card', deadType.id, deadType, rng(60))
  const result = blackSuperPlan({ ...state, scratchCards: [card] }, [card.id], config, rng(61))
  assert.equal(result.code, 'SUPER_EMPTY_BASE')
  assert.equal(result.state.scratchCards.length, 1)
})

test('超级刮刮乐 payoutRate 不是概率：稀有奖励允许 >1，但拒绝非有限值', () => {
  const state = unlockedState(12)
  const config = normalizeConfig({
    ...state.config,
    scratchTypes: [{
      id: 'rare',
      name: '稀有池',
      slots: 3,
      prizes: [
        { kind: 'material', name: '旧日合金', qty: 500, weight: 1, need: 2 },
        { kind: 'material', name: '浮木纤维', qty: 1, weight: 999, need: 2 },
      ],
    }],
  })
  const type = config.scratchTypes[0]
  const cards = Array.from({ length: 20 }, (_, index) => makeScratchCard(`rare-${index}`, type.id, type, rng(200 + index)))
  const result = blackSuperPlan({ ...state, config, scratchCards: cards }, cards.map((card) => card.id), config, rng(70))
  assert.equal(result.code, null)
  assert.ok(result.super.payoutRate >= 0.01)
})

test('黑市确认动作幂等且不要求解锁', () => {
  const config = normalizeConfig(DEFAULT_CONFIG)
  const fresh = createInitialState(config, rng(80))
  assert.equal(fresh.blackMarket.introSeen, false)
  const acked = blackAcknowledge(fresh)
  assert.equal(acked.blackMarket.introSeen, true)
  assert.equal(blackAcknowledge(acked), acked)
})
