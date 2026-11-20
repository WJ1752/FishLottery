import test from 'node:test'
import assert from 'node:assert/strict'
import { BASE_ENERGY_PER_SECOND, DEPTHS, ENERGY_PER_CATCH, RECOVERY_MS, RODS, advanceFishing, biteProgress, biteTiming, canUnlockDepth, chooseLottery, chooseLotteryBatch, createInitialState, depthForRod, depthsFor, discardRevealedScratch, exchangeFish, exchangeFishBatchByFilter, fishMatchesExchangeFilter, hitDistribution, loadState, quoteForFish, repairRod, revealScratch, rewardFor, rodStatsFrom, rollBite, scratchTypeFor, selectRod, speedUpgrade, toggleFishing, unlockDepth, upgradeCostAt, upgradeRod, warehouseCount } from '../src/game.js'
import { TENSION_DEFAULTS, aggregateTraitEffects, biteWeightFor, normalizeTrait, rarityLabel, tensionAt, tensionFillMs } from '../src/traits.js'

// 合成一张彩票要消耗多张空白票（普通 3 / 高级 6 / 大师 10），
// 这些用例只关心号码与状态，先补足空白票库存。
const withBlanks = (state, count = 30) => {
  const template = state.tickets[0]
  const extra = Array.from({ length: Math.max(0, count - state.tickets.length) }, (_, index) => ({
    ...template, id: `blank-bulk-${index}`, status: 'BLANK', tier: null, numbers: [], batchId: null, drawnNumbers: [], hits: null, rewards: [], claimed: false,
  }))
  return { ...state, tickets: [...state.tickets, ...extra] }
}
const blankCount = (state) => state.tickets.filter((ticket) => ticket.status === 'BLANK').length
const numberedCount = (state) => state.tickets.filter((ticket) => ticket.status === 'ASSIGNED').length

test('blank ticket becomes assigned with six numbers in normal range', () => {
  const state = withBlanks(createInitialState())
  const next = chooseLottery(state, 'ticket-1', 'normal')
  const ticket = next.tickets.find((item) => item.id === 'ticket-1')
  assert.equal(ticket.status, 'ASSIGNED')
  assert.equal(ticket.numbers.length, 6)
  assert.equal(new Set(ticket.numbers).size, 6)
  assert.ok(ticket.numbers.every((number) => number >= 0 && number <= 30))
  assert.ok(ticket.batchId)
})

test('crafting consumes 3 / 6 / 10 blanks per normal / advanced / master ticket', () => {
  const state = withBlanks(createInitialState(), 40)
  for (const [tier, cost] of [['normal', 3], ['advanced', 6], ['master', 10]]) {
    const before = blankCount(state)
    const next = chooseLotteryBatch(state, 2, tier)
    assert.equal(numberedCount(next), 2, `${tier} 应产出 2 张号码票`)
    assert.equal(blankCount(next), before - cost * 2, `${tier} 每张应消耗 ${cost} 张空白票`)
  }
})

test('crafting quantity is clamped by blanks and never over-spends', () => {
  const state = withBlanks(createInitialState(), 10)
  const next = chooseLotteryBatch(state, 99, 'advanced')
  assert.equal(numberedCount(next), 1)
  assert.equal(blankCount(next), 4)
  // 大师场 10 张才合 1 张，剩 4 张不够，直接不消耗
  assert.equal(chooseLotteryBatch(next, 1, 'master'), next)
})

test('advanced ticket numbers stay inside 31-99', () => {
  const state = withBlanks(createInitialState())
  const next = chooseLottery(state, 'ticket-1', 'advanced')
  const ticket = next.tickets.find((item) => item.id === 'ticket-1')
  assert.equal(ticket.numbers.length, 6)
  assert.ok(ticket.numbers.every((number) => number >= 31 && number <= 99))
})

test('batch assignment invests the requested quantity and preserves blank stock', () => {
  const state = withBlanks(createInitialState(), 9)
  const next = chooseLotteryBatch(state, 2, 'normal')
  const numbered = next.tickets.filter((ticket) => ticket.status === 'ASSIGNED')
  assert.equal(numbered.length, 2)
  assert.equal(blankCount(next), 3)
  assert.equal(next.stats.totalTickets, 2)
  assert.equal(new Set(numbered.map((ticket) => ticket.batchId)).size, 1)
  assert.ok(numbered.every((ticket) => ticket.numbers.every((number) => number >= 0 && number <= 30)))
})

test('batch assignment clamps quantity to available blanks', () => {
  const state = withBlanks(createInitialState(), 30)
  const next = chooseLotteryBatch(state, 99, 'advanced')
  assert.equal(numberedCount(next), 5)
  assert.equal(blankCount(next), 0)
})

test('reward table escalates advanced six-hit reward to abyss rod', () => {
  const rewards = rewardFor('advanced', 6)
  assert.deepEqual(rewards, [{ type: 'rod', name: '无光 · 深渊', qty: 1 }, { type: 'material', name: '潮汐锁钥', qty: 4 }])
})

test('zero and one hits only pay coins, never materials', () => {
  const state = createInitialState()
  for (const type of state.config.lotteryTypes) {
    for (const hits of [0, 1]) {
      const rewards = rewardFor(type.id, hits, state.config)
      assert.ok(rewards.length > 0, `${type.id} ${hits} 命中应有奖励`)
      assert.deepEqual(rewards.map((reward) => reward.type), ['coin'])
      assert.equal(rewards[0].name, '鱼币')
    }
  }
})

test('master pool draws six numbers between 100 and 199', () => {
  const state = createInitialState()
  const master = state.config.lotteryTypes.find((type) => type.id === 'master')
  assert.ok(master, '应存在大师场')
  assert.equal(master.min, 100)
  assert.equal(master.max, 199)
  assert.equal(master.pick, 6)
  const ticket = { ...state.tickets[0] }
  const next = chooseLotteryBatch(withBlanks({ ...state, tickets: [ticket] }, 10), 1, 'master')
  const assigned = next.tickets[0]
  assert.equal(assigned.numbers.length, 6)
  assigned.numbers.forEach((number) => assert.ok(number >= 100 && number <= 199, `${number} 超出 100-199`))
})

test('hit distribution sums to one for every pool', () => {
  const state = createInitialState()
  state.config.lotteryTypes.forEach((type) => {
    const rows = hitDistribution(type)
    assert.equal(rows.length, type.pick + 1)
    const total = rows.reduce((sum, row) => sum + row.chance, 0)
    assert.ok(Math.abs(total - 1) < 1e-9, `${type.id} 概率合计 ${total}`)
    assert.ok(rows[0].chance > rows[type.pick].chance)
  })
})

test('upgrade costs grow with level and require coins', () => {
  const seed = createInitialState()
  const upgrade = seed.rod.upgrades.find((item) => item.id === 'speed')
  const first = upgradeCostAt(upgrade, 0)
  const second = upgradeCostAt(upgrade, 1)
  assert.ok(second.coins > first.coins)
  assert.ok(second.cost > first.cost)
  // 没鱼币时无法升级
  assert.equal(speedUpgrade(seed, seed.rod.id), seed)
  const rich = { ...seed, coins: 5000, inventory: { ...seed.inventory, '浮木纤维': 500, '潮汐树脂': 500 } }
  const once = speedUpgrade(rich, rich.rod.id)
  const twice = speedUpgrade(once, once.rod.id)
  assert.equal(once.coins - twice.coins > rich.coins - once.coins, true, '第二级应更贵')
  assert.equal(twice.rod.levels.speed, 2)
})

test('upgrade costs can grow coins and each material separately', async () => {
  const { normalizeConfig, DEFAULT_CONFIG } = await import('../src/game.js')
  // 鱼币不涨、主材料每级 +50%、副材料不涨：三条曲线互不影响。
  const upgrade = { coins: 100, growth: 0, material: '浮木纤维', cost: 3, materialGrowth: 0.5, secondMaterial: '潮汐树脂', secondCost: 2, secondMaterialGrowth: 0 }
  const first = upgradeCostAt(upgrade, 0)
  const third = upgradeCostAt(upgrade, 2)
  assert.deepEqual([first.coins, first.cost, first.secondCost], [100, 3, 2])
  assert.deepEqual([third.coins, third.cost, third.secondCost], [100, 6, 2])
  // 旧配置没有 materialGrowth 时沿用 growth，行为保持不变。
  const legacy = upgradeCostAt({ coins: 100, growth: 1, cost: 2, secondMaterial: '潮汐树脂', secondCost: 1 }, 1)
  assert.deepEqual([legacy.coins, legacy.cost, legacy.secondCost], [200, 4, 2])
  // 钓竿升级项会把这四条曲线持久化下来（天赋已删除，升级项是唯一使用方）。
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    rods: DEFAULT_CONFIG.rods.map((rod, index) => index ? rod : {
      ...rod,
      upgrades: [{ id: 'speed', label: '钓鱼速度', amount: 1, coins: 100, growth: 0.2, material: '浮木纤维', materialGrowth: 0.4, cost: 2, secondMaterial: '潮汐树脂', secondCost: 1, secondMaterialGrowth: 0.1 }],
    }),
  })
  const track = config.rods[0].upgrades[0]
  assert.equal(track.growth, 0.2)
  assert.equal(track.materialGrowth, 0.4)
  assert.equal(track.secondMaterialGrowth, 0.1)
})

test('unlocking a sea spends coins and keys, repair never spends coins', () => {
  const seed = createInitialState()
  assert.deepEqual(seed.unlockedDepths, ['shore', 'shelf'])
  const poor = { ...seed, coins: 10 }
  assert.equal(unlockDepth(poor, 'open'), poor)
  const rich = { ...seed, coins: 1000, inventory: { ...seed.inventory, '潮汐锁钥': 5 } }
  assert.equal(canUnlockDepth(rich, 'open'), true)
  const unlocked = unlockDepth(rich, 'open')
  assert.ok(unlocked.unlockedDepths.includes('open'))
  assert.equal(unlocked.coins, 850)
  assert.equal(unlocked.inventory['潮汐锁钥'], 3)
  // 解锁后该海域可选
  assert.deepEqual(depthsFor(unlocked).map((depth) => depth.id), ['shore', 'shelf', 'open'])
  // 耐久修复只吃材料，不动鱼币
  const damaged = { ...rich, rod: { ...rich.rod, durability: 400 }, rods: [{ ...rich.rods[0], durability: 400 }] }
  const repaired = repairRod(damaged, damaged.rod.id)
  assert.equal(repaired.coins, rich.coins)
  assert.ok(repaired.rod.durability > 400)
})

test('scratch cards never pay keys or coins', () => {
  const state = createInitialState()
  state.config.scratchTypes.forEach((type) => type.prizes.forEach((prize) => {
    assert.ok(!['潮汐锁钥', '深渊锁钥'].includes(prize.name), `${type.id} 不应产出锁钥`)
    assert.ok(!['潮汐锁钥', '深渊锁钥'].includes(prize.bonus || ''), `${type.id} 附赠不应产出锁钥`)
  }))
})

test('scratch pools always contain a coin prize', () => {
  const state = createInitialState()
  state.config.scratchTypes.forEach((type) => {
    assert.ok(type.prizes.some((prize) => prize.kind === 'coin' && prize.name === '鱼币'), `${type.id} 应包含鱼币奖励`)
  })
})

test('scratch settlement pays one reward per pair and three for a triple', async () => {
  const { scratchSettlement } = await import('../src/game.js')
  const pair = scratchSettlement([{ kind: 'material', name: '浮木纤维', qty: 3 }, { kind: 'material', name: '浮木纤维', qty: 3 }, { kind: 'material', name: '深蓝晶片', qty: 1 }])
  assert.equal(pair.pairs, 1)
  assert.deepEqual(pair.payouts, [{ kind: 'material', name: '浮木纤维', qty: 3, count: 2, need: 2 }])
  const triple = scratchSettlement(Array.from({ length: 3 }, () => ({ kind: 'material', name: '浮木纤维', qty: 3 })))
  assert.equal(triple.pairs, 3)
  assert.deepEqual(triple.payouts, [{ kind: 'material', name: '浮木纤维', qty: 9, count: 3, need: 2 }])
  // 不同数量的同名奖励不算一对
  const mismatch = scratchSettlement([{ kind: 'material', name: '浮木纤维', qty: 3 }, { kind: 'material', name: '浮木纤维', qty: 5 }, { kind: 'coin', name: '鱼币', qty: 10 }])
  assert.equal(mismatch.pairs, 0)
  assert.equal(mismatch.payouts.length, 0)
})

test('scratch settlement respects a per-prize required match count', async () => {
  const { scratchSettlement } = await import('../src/game.js')
  const crystal = (need) => ({ kind: 'material', name: '深蓝晶片', qty: 1, need })
  // 默认 2 个即兑
  assert.equal(scratchSettlement([crystal(2), crystal(2), crystal(2)]).pairs, 3)
  // 需要 3 个时，两个不够
  const two = scratchSettlement([crystal(3), crystal(3), { kind: 'coin', name: '鱼币', qty: 10 }])
  assert.equal(two.pairs, 0)
  assert.equal(two.payouts.length, 0)
  // 三个刚好一组，四个则是 C(4,3) = 4 组
  assert.equal(scratchSettlement([crystal(3), crystal(3), crystal(3)]).pairs, 1)
  assert.equal(scratchSettlement(Array.from({ length: 4 }, () => crystal(3))).pairs, 4)
  assert.equal(scratchSettlement(Array.from({ length: 4 }, () => crystal(3))).payouts[0].qty, 4)
  // 所需数量不同的同名奖励各自分组
  const mixed = scratchSettlement([crystal(2), crystal(2), crystal(3), crystal(3)])
  assert.equal(mixed.pairs, 1)
})

test('scratch paired slots come from the face, not the merged payout', async () => {
  const { scratchPairedSlots } = await import('../src/game.js')
  // 三连：payout 数量是 9，但三格都应高亮
  const triple = Array.from({ length: 3 }, () => ({ kind: 'material', name: '浮木纤维', qty: 3 }))
  assert.deepEqual(scratchPairedSlots(triple), [true, true, true])
  // 深蓝晶片 ×1 成对也要高亮（曾因 payout 合并对不上而不亮）
  const crystal = [{ kind: 'material', name: '深蓝晶片', qty: 1 }, { kind: 'material', name: '深蓝晶片', qty: 1 }, { kind: 'coin', name: '鱼币', qty: 10 }]
  assert.deepEqual(scratchPairedSlots(crystal), [true, true, false])
  // 需要 3 个但只有 2 个时不亮
  const short = [{ kind: 'material', name: '深蓝晶片', qty: 1, need: 3 }, { kind: 'material', name: '深蓝晶片', qty: 1, need: 3 }, { kind: 'coin', name: '鱼币', qty: 10 }]
  assert.deepEqual(scratchPairedSlots(short), [false, false, false])
  // 无对子全不亮
  assert.deepEqual(scratchPairedSlots([{ kind: 'coin', name: '鱼币', qty: 10 }, { kind: 'material', name: '深蓝晶片', qty: 1 }]), [false, false])
})

test('scratch grid layout keeps prime counts on one row and others wider than tall', async () => {
  const { scratchGridLayout } = await import('../src/game.js')
  const expected = { 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [5, 1], 6: [3, 2], 7: [7, 1], 8: [4, 2], 9: [3, 3], 10: [5, 2] }
  Object.entries(expected).forEach(([slots, [cols, rows]]) => {
    const layout = scratchGridLayout(Number(slots))
    assert.deepEqual(layout, { cols, rows }, `${slots} 格布局`)
  })
  // 上限 10 格
  assert.deepEqual(scratchGridLayout(99), scratchGridLayout(10))
})

test('scratch face has the configured slot count and only uses pool prizes', () => {
  const state = createInitialState()
  const type = state.config.scratchTypes[0]
  const names = new Set(type.prizes.map((prize) => `${prize.kind}:${prize.name}:${prize.qty}`))
  for (let i = 0; i < 60; i += 1) {
    const card = revealScratch({ ...state, scratchCards: [state.scratchCards[0]] }, state.scratchCards[0].id)
    const revealed = card.scratchCards[0]
    assert.equal(revealed.face.length, type.slots)
    revealed.face.forEach((slot) => assert.ok(names.has(`${slot.kind}:${slot.name}:${slot.qty}`), `${slot.name} 不在奖池中`))
  }
})

test('scratch face is generated when the card is issued, before scratching', async () => {
  const { makeScratchCard, drawScratchFace, exchangeFish } = await import('../src/game.js')
  const state = createInitialState()
  const type = state.config.scratchTypes[0]
  // 初始卡在发卡时就有完整卡面
  state.scratchCards.forEach((card) => {
    assert.equal(card.status, 'ready')
    assert.equal(card.face.length, type.slots, '待刮卡也应有卡面')
    assert.ok(card.face.every((slot) => slot.name), '卡面每一格都应是具体奖励')
  })
  // 直接发卡同样带卡面
  const issued = makeScratchCard('scratch-issued', type.id, type)
  assert.equal(issued.face.length, type.slots)
  // 揭示不重抽：刮开后卡面与发卡时完全一致
  const seeded = { ...state, scratchCards: [{ ...state.scratchCards[0], face: drawScratchFace(type, () => 0.1) }] }
  const before = seeded.scratchCards[0].face
  const after = revealScratch(seeded, seeded.scratchCards[0].id).scratchCards[0]
  assert.deepEqual(after.face, before)
  // 商会兑换出的卡也预先生成卡面
  const fish = { id: 'fish-quote', name: '测试鱼', traits: [], depth: '河口', depthId: 'shore', depthColor: '#000', weight: 1, rarity: '普通', status: 'fresh' }
  const exchanged = exchangeFish({ ...state, fish: [fish] }, fish.id)
  const newCards = exchanged.scratchCards.filter((card) => !state.scratchCards.some((old) => old.id === card.id))
  assert.ok(newCards.length > 0, '兑换应产出刮刮乐')
  newCards.forEach((card) => assert.equal(card.face.length, scratchTypeFor(exchanged.config, card.typeId).slots))
})

test('a single scratch card can be claimed on its own', async () => {
  const { claimScratch } = await import('../src/game.js')
  const state = createInitialState()
  const coinCard = {
    id: 'scratch-single', typeId: 'scratch-tide', status: 'revealed', pairs: 3,
    face: Array.from({ length: 3 }, () => ({ kind: 'coin', name: '鱼币', qty: 10 })),
    payout: [{ kind: 'coin', name: '鱼币', qty: 30, count: 3 }],
  }
  const materialCard = {
    id: 'scratch-other', typeId: 'scratch-tide', status: 'revealed', pairs: 1,
    face: [], payout: [{ kind: 'material', name: '浮木纤维', qty: 3, count: 2 }],
  }
  const base = { ...state, scratchCards: [coinCard, materialCard] }
  const afterOne = claimScratch(base, coinCard.id)
  assert.equal(afterOne.coins, state.coins + 30)
  assert.equal(afterOne.stats.scratchCoins, 30)
  assert.equal(afterOne.stats.claimedScratch, 1)
  assert.deepEqual(afterOne.scratchCards.map((card) => card.id), [materialCard.id], '只出库被兑的那张')
  assert.equal(afterOne.inventory['浮木纤维'], state.inventory['浮木纤维'], '另一张的奖励还没入账')
  // 未刮开 / 不存在的卡不能兑
  const ready = { ...base, scratchCards: [{ ...coinCard, status: 'ready' }, materialCard] }
  assert.equal(claimScratch(ready, coinCard.id), ready)
  assert.equal(claimScratch(base, 'nope'), base)
  // 空卡也能单张清掉
  const blank = { ...base, scratchCards: [{ ...coinCard, id: 'blank-card', payout: null, pairs: 0 }] }
  const cleared = claimScratch(blank, 'blank-card')
  assert.equal(cleared.scratchCards.length, 0)
  assert.equal(cleared.coins, state.coins)
  assert.equal(cleared.stats.claimedScratch, 1)
})

test('revealing is deterministic once and never re-rolls', () => {
  const state = createInitialState()
  const revealed = revealScratch(state, 'scratch-1')
  const card = revealed.scratchCards.find((item) => item.id === 'scratch-1')
  assert.equal(card.status, 'revealed')
  assert.equal(revealed.scratchCards.filter((item) => item.status === 'revealed').length, 1)
  // 再揭示一次不应改变卡面或统计
  assert.equal(revealScratch(revealed, 'scratch-1'), revealed)
})

test('claiming scratch pays coins into balance and materials into the bag', async () => {
  const { claimAllScratch } = await import('../src/game.js')
  const state = createInitialState()
  const card = {
    id: 'scratch-fixed', typeId: 'scratch-tide', status: 'revealed', pairs: 3,
    face: Array.from({ length: 3 }, () => ({ kind: 'coin', name: '鱼币', qty: 10 })),
    payout: [{ kind: 'coin', name: '鱼币', qty: 30, count: 3 }],
  }
  const next = claimAllScratch({ ...state, scratchCards: [card] })
  assert.equal(next.coins, state.coins + 30)
  assert.equal(next.stats.scratchCoins, 30)
  assert.equal(next.scratchCards.length, 0)
})

test('claiming removes settled tickets and scratch cards from the bag', async () => {
  const { claimAll, claimAllScratch } = await import('../src/game.js')
  const seed = createInitialState()
  const drawn = { ...seed.tickets[0], status: 'DRAWN', tier: 'normal', numbers: [1, 2, 3, 4, 5, 6], batchId: 'b1', drawnNumbers: [1, 2, 3], hits: 3, rewards: [{ type: 'coin', name: '鱼币', qty: 12 }], claimed: false }
  const pending = { ...seed.tickets[1], status: 'ASSIGNED', tier: 'normal', numbers: [7, 8, 9, 10, 11, 12], batchId: 'b1' }
  const before = { ...seed, tickets: [drawn, pending], scratchCards: [
    { id: 's1', typeId: 'scratch-tide', status: 'revealed', pairs: 1, face: [], payout: [{ kind: 'material', name: '浮木纤维', qty: 3, count: 2 }] },
    { id: 's2', typeId: 'scratch-tide', status: 'ready', face: [], payout: null },
  ] }
  const claimed = claimAll(before)
  assert.equal(claimed.tickets.length, 1, '兑奖后号码票应出库')
  assert.equal(claimed.tickets[0].id, pending.id, '未开奖的票应保留')
  assert.equal(claimed.coins, seed.coins + 12)
  assert.equal(claimed.stats.claimedTickets, 1)

  const scratched = claimAllScratch(claimed)
  assert.equal(scratched.scratchCards.length, 1, '兑奖后刮刮乐应出库')
  assert.equal(scratched.scratchCards[0].id, 's2', '未刮开的卡应保留')
  assert.equal(scratched.inventory['浮木纤维'], (claimed.inventory['浮木纤维'] || 0) + 3)
  assert.equal(scratched.stats.claimedScratch, 1)
  // 再点一次兑奖不应重复发放
  assert.equal(claimAll(scratched), scratched)
  assert.equal(claimAllScratch(scratched), scratched)
})

test('legacy saves drop already-claimed tickets and scratch cards', async () => {
  const { loadState, STORAGE_KEY } = await import('../src/game.js')
  const seed = createInitialState()
  const legacy = {
    ...seed,
    tickets: [
      { ...seed.tickets[0], status: 'CLAIMED', claimed: true, tier: 'normal', numbers: [1, 2, 3, 4, 5, 6] },
      { ...seed.tickets[1], status: 'BLANK' },
    ],
    scratchCards: [
      { id: 'old-claimed', typeId: 'scratch-tide', status: 'claimed', reward: { name: '浮木纤维', qty: 3 } },
      { id: 'old-ready', typeId: 'scratch-tide', status: 'ready', reward: null },
    ],
  }
  const store = new Map([[STORAGE_KEY, JSON.stringify(legacy)]])
  const original = globalThis.localStorage
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) }
  try {
    const loaded = loadState()
    assert.equal(loaded.tickets.length, 1)
    assert.equal(loaded.tickets[0].status, 'BLANK')
    assert.deepEqual(loaded.scratchCards.map((card) => card.id), ['old-ready'])
  } finally {
    if (original) globalThis.localStorage = original
    else delete globalThis.localStorage
  }
})

test('sea areas are ordered and rods gate the farthest area', () => {
  assert.deepEqual(DEPTHS.map((depth) => depth.label), ['河口', '港湾', '礁石', '海沟', '裂谷', '深渊'])
  const state = createInitialState()
  assert.equal(state.fishing.selectedDepthId, 'shore')
  assert.deepEqual(depthForRod(RODS[0]).map((depth) => depth.id), ['shore'])
  assert.deepEqual(depthForRod(RODS[1]).map((depth) => depth.id), ['shore', 'shelf', 'open'])
  assert.equal(depthForRod(RODS[2]).length, 6)
})

test('fresh fishing state uses a 10000 energy cycle and a 1000 durability starter rod', () => {
  const state = createInitialState()
  assert.equal(state.fishing.progress, 6200)
  assert.equal(ENERGY_PER_CATCH, 10000)
  assert.equal(BASE_ENERGY_PER_SECOND, 1000)
  assert.equal(state.rod.maxDurability, 1000)
  assert.equal(state.rod.durability, 1000)
  assert.equal(RODS[0].breakable, false)
  assert.equal(RODS[1].breakable, true)
  assert.ok(RODS[1].maxDurability > RODS[0].maxDurability)
  assert.ok(RODS[2].maxDurability > RODS[1].maxDurability)
  assert.equal(state.fishing.phase, 'charging')
  assert.equal(state.fishing.bite, null)
})

test('tension accelerates for one second then fills to the cap', () => {
  assert.equal(Math.round(tensionAt(0)), 0)
  assert.equal(Math.round(tensionAt(500)), 13)
  assert.equal(Math.round(tensionAt(1000)), 50)
  assert.equal(Math.round(tensionAt(10500)), 1000)
  assert.equal(Math.round(tensionAt(50000)), 1000)
  assert.equal(Math.round(tensionFillMs()), 10500)
  assert.equal(Math.round(tensionFillMs(2)), 5500)
  assert.equal(TENSION_DEFAULTS.maxTension, 1000)
  assert.equal(TENSION_DEFAULTS.baseLoss, 10)
})

test('trait effects aggregate additions first and multipliers after', () => {
  const traits = [
    { effects: [{ type: 'loss', mode: 'add', value: 4 }, { type: 'loss', mode: 'multiply', value: 2 }] },
    { effects: [{ type: 'loss', mode: 'add', value: 6 }] },
  ]
  assert.equal(aggregateTraitEffects(traits, 'loss', 10), 40)
  assert.equal(aggregateTraitEffects([], 'tensionRate', 1), 1)
  assert.equal(rarityLabel(10), '普通')
  assert.equal(rarityLabel(30), '稀有')
  assert.equal(rarityLabel(60), '史诗')
  assert.equal(rarityLabel(90), '传说')
})

test('rarer fish bite less often than common fish in the same pool', () => {
  const common = biteWeightFor({ rarity: 6, baseWeight: 100 }, 1)
  const rare = biteWeightFor({ rarity: 60, baseWeight: 100 }, 1)
  assert.ok(common > rare * 4)
  const boosted = biteWeightFor({ rarity: 60, baseWeight: 100 }, 2)
  assert.ok(boosted > rare)
})

test('bite rolls a fish from the selected sea and carries tension stats', () => {
  const seed = createInitialState()
  const state = { ...seed, fishing: { ...seed.fishing, selectedDepthId: 'shore' } }
  const bite = rollBite(state, () => 0)
  assert.equal(bite.fish.depthId, 'shore')
  assert.equal(bite.fish.depth, '河口')
  assert.ok(bite.fish.traits.length >= 1)
  assert.ok(bite.maxTension >= 10)
  assert.ok(bite.tensionRate > 0)
  assert.ok(bite.chargeRate > 0)
})

test('a plain fish fills the fishing bar before tension and lands', () => {
  const seed = createInitialState()
  const plainTrait = normalizeTrait({ id: 'plain', label: '素净', icon: '·', color: '#888888', value: 1, effects: [] })
  const state = {
    ...seed,
    config: { ...seed.config, traits: [plainTrait] },
    // 钓竿 10000 能量/秒：1 秒就填满钓鱼进度，快过 1.5 秒才满的张力。
    rod: { ...seed.rod, energyPerSecond: 10000 },
    fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 },
  }
  // 钓鱼进度先满，鱼入库且不掉耐久。
  const next = advanceFishing(state, 2100)
  assert.equal(next.stats.totalCatches, 1)
  assert.equal(next.stats.totalEscapes, 0)
  assert.equal(next.fish.length, 1)
  assert.equal(next.rod.durability, 1000)
  assert.equal(next.fishing.lastOutcome.escaped, false)
})

test('tension filling first causes an escape and durability loss', () => {
  const seed = createInitialState()
  const slowTrait = normalizeTrait({ id: 'sluggish', label: '滞重', icon: '!', color: '#b45e5d', value: 1, effects: [{ type: 'chargeRate', mode: 'multiply', value: 0.05 }] })
  const state = {
    ...seed,
    config: { ...seed.config, traits: [slowTrait] },
    // 显式给一条 1000/秒 的张力曲线：1.5 秒就满，必然快过收杆。
    rod: { ...seed.rod, tension: { ...seed.rod.tension, maxRate: 1000 } },
    fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 },
  }
  // 第一次脱钩在 1.5 秒，取 2 秒只结算这一次。
  const next = advanceFishing(state, 3000)
  assert.equal(next.stats.totalCatches, 0)
  assert.equal(next.stats.totalEscapes, 1)
  assert.equal(next.fish.length, 0)
  assert.equal(next.escapes.length, 1)
  assert.equal(next.rod.durability, 991)
  assert.equal(next.fishing.lastOutcome.escaped, true)
  assert.equal(next.fishing.lastOutcome.loss, 9)
  assert.equal(next.stats.totalDurabilityLoss, 9)
})

// ---- 进度条 / 张力条与结算的一致性 ----
// 线上问题：①进度条到 100% 后不马上结算，等张力追上反而判脱钩；②张力条略早到达却判成功。
// 两者的共同根因是「界面和结算用了不同的时间原点 / 不同的终点」。

test('both bars share one time origin, so the bar that fills first is the one that decides', () => {
  const seed = createInitialState()
  const slowTrait = normalizeTrait({ id: 'sluggish', label: '滞重', icon: '!', color: '#b45e5d', value: 1, effects: [{ type: 'chargeRate', mode: 'multiply', value: 0.05 }] })
  // 进度要 200 秒、张力 1.5 秒：张力先满，必然脱钩。
  const state = {
    ...seed,
    config: { ...seed.config, traits: [slowTrait] },
    rod: { ...seed.rod, tension: { ...seed.rod.tension, maxRate: 1000 } },
    fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 },
  }
  const bite = { ...rollBite(state, () => 0), chargeRequired: state.rod.energyPerCatch, chargeAtBite: 0, startedAt: 1000 }
  const timing = biteTiming(state, bite)
  assert.equal(timing.escaped, true)
  // 结算前一刻：张力恰好到顶，进度远未到顶；且只有一根条在 100%。
  const justBefore = biteProgress(state, bite, 1000 + timing.resolvedAtMs - 1)
  assert.equal(justBefore.resolved, false)
  assert.ok(justBefore.tensionRatio < 1)
  assert.ok(justBefore.progressRatio < justBefore.tensionRatio)
  // 结算时刻：赢的那根到 100%，输的那根没到 —— 不会出现「两根都满」。
  const atSettle = biteProgress(state, bite, 1000 + timing.resolvedAtMs)
  assert.equal(atSettle.resolved, true)
  assert.equal(atSettle.tensionRatio, 1)
  assert.ok(atSettle.progressRatio < 1)
})

test('progress extrapolates forward from the snapshot anchor', () => {
  // 界面从最近一次快照的 (progress, lastTickAt) 向前外推：
  // 快照之前的时间已经算进 progress，不能再重复计入。
  const seed = createInitialState()
  const state = { ...seed, rod: { ...seed.rod, energyPerSecond: 2000 }, fishing: { ...seed.fishing, progress: 1000, lastTickAt: 3500 } }
  const bite = { ...rollBite(state, () => 0), chargeRequired: state.rod.energyPerCatch, chargeAtBite: 0, startedAt: 1000 }
  // 快照时刻：就是快照里的值，不多不少。
  assert.equal(biteProgress(state, bite, 3500).progress, 1000)
  // 再过 1 秒：2000/秒 × 1 秒。
  assert.equal(biteProgress(state, bite, 4500).progress, 3000)
  // 张力始终是「咬钩起点起算」的绝对曲线，与快照锚点无关。
  const shifted = { ...state, fishing: { ...state.fishing, lastTickAt: 3000, progress: 800 } }
  assert.equal(biteProgress(state, bite, 4500).tension, biteProgress(shifted, bite, 4500).tension)
})

test('a full fishing bar never waits for tension to catch up', () => {
  const seed = createInitialState()
  const plainTrait = normalizeTrait({ id: 'plain', label: '素净', icon: '·', color: '#888888', value: 1, effects: [] })
  const state = {
    ...seed,
    config: { ...seed.config, traits: [plainTrait] },
    rod: { ...seed.rod, energyPerSecond: 10000 },
    fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 },
  }
  const bite = { ...rollBite(state, () => 0), chargeRequired: state.rod.energyPerCatch, chargeAtBite: 0, startedAt: 1000 }
  const timing = biteTiming(state, bite)
  assert.equal(timing.escaped, false)
  // 进度先满的那一刻就是结算时刻；此刻张力还没满，界面不会「满了还在钓」。
  const atSettle = biteProgress(state, bite, 1000 + timing.resolvedAtMs)
  assert.equal(atSettle.winner, 'charge')
  assert.equal(atSettle.progressRatio, 1)
  assert.ok(atSettle.tensionRatio < 1)
})

test('simultaneous fill counts as an escape, both in the verdict and on screen', () => {
  const seed = createInitialState()
  // 进度 10 秒（1000/秒，充能倍率 1）。张力曲线 maxRate 120 / accel 1 秒时无延迟只需
  // 8.8333 秒，所以用 tensionDelay 把整条曲线后推 1.1667 秒，构造「同时充满」。
  const delayMs = 10000 - tensionFillMs(1, 1000, { ...seed.rod.tension, maxTension: 1000, maxRate: 120 }, 0)
  const state = {
    ...seed,
    rod: { ...seed.rod, energyPerSecond: 1000, tension: { ...seed.rod.tension, maxTension: 1000, maxRate: 120 } },
    fishing: { ...seed.fishing, progress: 0, lastTickAt: 0 },
  }
  // tensionDelay 会被归一化（见 normalizeTrait），所以这里直接构造咬钩对象，
  // 不经过 rollBite —— 否则词条会把时序改掉。
  const bite = { fish: seed.config.traits[0] && { id: 'f', name: '测试鱼', traits: [], status: 'fresh' }, chargeRate: 1, tensionRate: 1, maxTension: 1000, lossBase: 10, chargeRequired: 10000, chargeAtBite: 0, startedAt: 0, tensionDelay: delayMs }
  const timing = biteTiming(state, bite)
  assert.ok(Math.abs(timing.fillMs - timing.chargeMs) < 1e-6, `fillMs=${timing.fillMs} chargeMs=${timing.chargeMs}`)
  // 恰好同时：判定为脱钩（与界面的「谁先到」方向一致——不会界面显示上钩、服务端判脱钩）。
  assert.equal(timing.escaped, true)
  const view = biteProgress(state, bite, timing.resolvedAtMs)
  assert.equal(view.winner, 'tension')
  // 浮点误差内到顶（0.9999999999999999 也算到顶）。
  assert.ok(Math.abs(view.tensionRatio - 1) < 1e-9, `tensionRatio=${view.tensionRatio}`)
})

test('advanceFishing settles on the same instant that the bars predict', () => {
  // 端到端：界面预测「谁先满」，必须与服务端真正结算出的结果一致；
  // 且结算不会发生在任何一根条到 100% 之前。
  const seed = createInitialState()
  let state = { ...seed, coins: 0, fishing: { ...seed.fishing, progress: 0, running: true, lastTickAt: 0 } }
  const random = seededRandom(4242)
  let checked = 0
  for (let t = 1000; t <= 400000; t += 1000) {
    const before = state
    const next = advanceFishing(state, t, { random })
    const settled = (next.stats.totalCatches + next.stats.totalEscapes) > (before.stats.totalCatches + before.stats.totalEscapes)
    const bite = before.fishing.bite
    if (settled && bite && before.fishing.running) {
      checked += 1
      const timing = biteTiming(before, bite)
      const resolvedAt = Number(bite.startedAt) + timing.resolvedAtMs
      // 结算发生在前一秒之内（同步间隔），不会晚于两根条中先满的那一刻之后一个周期。
      assert.ok(resolvedAt > before.fishing.lastTickAt && resolvedAt <= t)
      // 结算那一刻（+1ms 避开浮点边界）：赢的那根恰好到 100%，输的那根还在下面。
      const predicted = biteProgress(before, bite, resolvedAt + 1)
      // 结算那一刻：赢的那根恰好到 100%（浮点误差内），输的那根还在下面。
      assert.ok(predicted.resolved, `resolvedAt=${resolvedAt} should be the settle instant`)
      const actual = next.fishing.lastOutcome?.escaped ? 'tension' : 'charge'
      assert.equal(predicted.winner, actual)
      const winnerRatio = predicted.winner === 'charge' ? predicted.progressRatio : predicted.tensionRatio
      const loserRatio = predicted.winner === 'charge' ? predicted.tensionRatio : predicted.progressRatio
      assert.ok(Math.abs(winnerRatio - 1) < 1e-9, `winner ratio ${winnerRatio}`)
      assert.ok(loserRatio < 1 - 1e-9, `loser ratio ${loserRatio}`)
    }
    state = next
  }
  assert.ok(checked > 20, `expected several settlements, got ${checked}`)
})

test('an escape clears the fishing bar and starts a five second recovery', () => {
  const seed = createInitialState()
  const slowTrait = normalizeTrait({ id: 'sluggish', label: '滞重', icon: '!', color: '#b45e5d', value: 1, effects: [{ type: 'chargeRate', mode: 'multiply', value: 0.05 }] })
  const state = {
    ...seed,
    config: { ...seed.config, traits: [slowTrait] },
    rod: { ...seed.rod, tension: { ...seed.rod.tension, maxRate: 1000 } },
    fishing: { ...seed.fishing, progress: 4000, lastTickAt: 1000 },
  }
  const afterEscape = advanceFishing(state, 3000)
  assert.equal(afterEscape.stats.totalEscapes, 1)
  // 脱钩后进度清零，并进入 5 秒停顿。
  assert.equal(afterEscape.fishing.progress, 0)
  const escapeAt = afterEscape.fishing.recoverUntil - RECOVERY_MS
  assert.ok(escapeAt > 1000 && escapeAt <= 3000)
  // 停顿期内进度不动，张力从满值匀速退回。
  const mid = advanceFishing(afterEscape, escapeAt + RECOVERY_MS / 2)
  assert.equal(mid.fishing.progress, 0)
  assert.ok(mid.fishing.tension > 0 && mid.fishing.tension < 1000, `半程张力应在 0 与满值之间，实际 ${mid.fishing.tension}`)
  // 停顿结束后立刻重新咬钩，张力从 0 重新涨；进度也开始重新累积。
  const after = advanceFishing(mid, escapeAt + RECOVERY_MS + 1000)
  assert.ok(after.fishing.progress > 0)
  assert.ok(after.fishing.tension < 1000)
  assert.ok(after.fishing.tension >= 0)
})

test('tension is only tracked while a fish is on the hook', () => {
  const seed = createInitialState()
  const state = { ...seed, fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 } }
  const early = advanceFishing(state, 1500)
  assert.equal(early.fishing.phase, 'reeling')
  assert.ok(early.fishing.bite)
  assert.ok(early.fishing.tension > 0)
  const later = advanceFishing(early, 1600)
  assert.ok(later.fishing.tension >= early.fishing.tension)
})

test('starter rod never drops below one durability and cannot break', () => {
  const seed = createInitialState()
  const slowTrait = normalizeTrait({ id: 'sluggish', label: '滞重', icon: '!', color: '#b45e5d', value: 1, effects: [{ type: 'chargeRate', mode: 'multiply', value: 0.02 }] })
  const state = {
    ...seed,
    config: { ...seed.config, traits: [slowTrait] },
    rod: { ...seed.rod, durability: 1 },
    rods: [{ ...seed.rod, durability: 1 }],
    fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 },
  }
  const next = advanceFishing(state, 5000)
  assert.equal(next.rod.durability, 1)
  assert.equal(next.rod.status, 'active')
})

test('pausing freezes the bite clock so tension does not keep climbing', () => {
  const seed = createInitialState()
  const state = { ...seed, fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 } }
  const running = advanceFishing(state, 2500)
  const frozenTension = running.fishing.tension
  const paused = toggleFishing(running, 2500)
  assert.equal(paused.fishing.running, false)
  assert.equal(advanceFishing(paused, 60000), paused)
  const resumed = toggleFishing(paused, 60000)
  assert.equal(resumed.fishing.running, true)
  // 恢复后继续咬钩，张力从暂停时的值接着涨，不会因为挂机 60 秒直接爆表。
  const next = advanceFishing(resumed, 60100)
  assert.ok(next.fishing.tension >= frozenTension)
  assert.ok(next.fishing.tension < 1000)
})

test('fishing progress grows at 1000 per second and carries overflow into the next fish', () => {
  const seed = createInitialState()
  const plainTrait = normalizeTrait({ id: 'plain', label: '素净', icon: '·', color: '#888888', value: 1, effects: [] })
  // 把张力上限抬到不可能是先满，只看进度条的充能速度。
  const rod = { ...seed.rod, tension: { ...seed.rod.tension, maxTension: 1e7 } }
  const state = { ...seed, rod, config: { ...seed.config, traits: [plainTrait] }, fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 } }
  const partial = advanceFishing(state, 6000)
  assert.equal(Math.round(partial.fishing.progress), 5000)
  const landed = advanceFishing(partial, 11200)
  assert.equal(landed.stats.totalCatches, 1)
  // 10000 能量收杆，剩下的 200 结转给下一条鱼。
  assert.equal(Math.round(landed.fishing.progress), 200)
  assert.equal(landed.fishing.lastTickAt, 11200)
})

test('a faster rod reaches the fishing bar sooner', () => {
  const seed = createInitialState()
  const plainTrait = normalizeTrait({ id: 'plain', label: '素净', icon: '·', color: '#888888', value: 1, effects: [] })
  const base = { ...seed, config: { ...seed.config, traits: [plainTrait] }, fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 } }
  // 张力上限抬高到不可能先满，只看钓鱼进度。
  const roomyTension = { ...seed.rod.tension, maxTension: 1e6 }
  const slow = advanceFishing({ ...base, rod: { ...seed.rod, energyPerSecond: 1000, tension: roomyTension } }, 4000)
  const fast = advanceFishing({ ...base, rod: { ...seed.rod, energyPerSecond: 2000, tension: roomyTension } }, 4000)
  assert.ok(fast.fishing.progress > slow.fishing.progress)
  assert.equal(slow.stats.totalCatches, 0)
})

test('trait effects drive escape risk through the charge multiplier', () => {
  const seed = createInitialState()
  const slow = normalizeTrait({ id: 'slow', label: '凝滞', icon: '~', color: '#5aa6a1', value: 1, effects: [{ type: 'chargeRate', mode: 'multiply', value: 0.05 }] })
  const state = { ...seed, config: { ...seed.config, traits: [slow] }, rod: { ...seed.rod, tension: { ...seed.rod.tension, maxRate: 1000 } }, fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 } }
  const next = advanceFishing(state, 12000)
  assert.ok(next.stats.totalEscapes >= 1)
  assert.ok(next.rod.durability < 1000)
})

test('tension delay postpones the first tension build-up', () => {
  const seed = createInitialState()
  const delayed = normalizeTrait({ id: 'delayed', label: '迟缓', icon: '◌', color: '#8e6b9d', value: 1, effects: [{ type: 'tensionDelay', mode: 'add', value: 800 }] })
  const state = { ...seed, config: { ...seed.config, traits: [delayed] }, fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 } }
  const early = advanceFishing(state, 1400)
  assert.equal(early.fishing.tension, 0)
  const later = advanceFishing(state, 2000)
  assert.ok(later.fishing.tension > 0)
})

test('depth trait weights steer which traits appear in that sea', async () => {
  const { pickTraitsWeighted } = await import('../src/traits.js')
  const traits = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  // b 权重为 0 时永远不会被抽中
  for (let i = 0; i < 20; i += 1) {
    const picked = pickTraitsWeighted(traits, { b: 0 }, 1, () => i / 20)
    assert.notEqual(picked[0].id, 'b')
  }
  const heavy = pickTraitsWeighted(traits, { a: 10 }, 1, () => 0.01)
  assert.equal(heavy[0].id, 'a')
})

test('depth trait weights keep explicit values and default the rest to 1', async () => {
  const { normalizeConfig, DEFAULT_CONFIG, traitWeightFor, defaultTraitWeights } = await import('../src/game.js')
  const config = normalizeConfig({ ...DEFAULT_CONFIG, depthTraitWeights: { shore: { swift: 3, ghost: 5 }, unknown: { swift: 2 } } })
  assert.equal(traitWeightFor(config, 'shore', 'swift'), 3)
  // 词条不再有「起始海域」：没单独配置的海域/词条统一按 1 参与抽取。
  assert.equal(traitWeightFor(config, 'shore', 'armored'), 1)
  assert.equal(traitWeightFor(config, 'shelf', 'swift'), 1)
  assert.equal(traitWeightFor(config, 'shore', 'ghost'), 1)
  assert.deepEqual(Object.keys(config.depthTraitWeights).sort(), ['abyss', 'deep', 'open', 'rift', 'shelf', 'shore'])
  const defaults = defaultTraitWeights(config.traits)
  Object.values(defaults).forEach((weights) => Object.values(weights).forEach((value) => assert.equal(value, 1)))
  // 权重是整数步进，0 就是禁用。
  Object.values(config.depthTraitWeights).forEach((weights) => Object.values(weights).forEach((value) => assert.ok(Number.isInteger(value))))
})

test('speed upgrade adds exactly one energy per second', () => {
  const state = { ...createInitialState(), coins: 500 }
  const next = speedUpgrade(state, state.rod.id)
  assert.equal(next.rod.energyPerSecond, 1001)
  assert.equal(next.rods[0].energyPerSecond, 1001)
  assert.equal(next.rod.speed, undefined)
  assert.equal(next.inventory['浮木纤维'], 15)
  assert.equal(next.inventory['潮汐树脂'], 9)
  assert.equal(next.coins, 440)
})

test('paused fishing does not gain energy and broken rods cannot be selected', () => {
  const seed = createInitialState()
  const paused = { ...seed, fishing: { ...seed.fishing, running: false, progress: 1000, lastTickAt: 1000 } }
  assert.equal(advanceFishing(paused, 9000).fishing.progress, 1000)
  const broken = { ...seed, rods: [{ ...RODS[1], id: 'rod-azure-1', durability: 0, status: 'broken' }], rod: { ...RODS[1], id: 'rod-azure-1', durability: 0, status: 'broken' } }
  assert.equal(selectRod(broken, 'rod-azure-1'), broken)
})

test('repairing an active rod preserves active status and resumes it', () => {
  const seed = createInitialState()
  const state = { ...seed, rod: { ...RODS[1], id: 'rod-azure-1', durability: 0, status: 'active' }, rods: [{ ...RODS[1], id: 'rod-azure-1', durability: 0, status: 'active' }], inventory: { ...seed.inventory, '深蓝晶片': 1 }, fishing: { ...seed.fishing, running: false } }
  const next = repairRod(state, 'rod-azure-1')
  assert.equal(next.rod.status, 'active')
  // 修到 50 耐久已经回到 10 点停钓线上，可以继续钓鱼。
  assert.equal(next.rod.durability, 50)
  assert.equal(next.fishing.running, true)
  // 只修到 5（停钓线以下）则保持停钓，等玩家手动继续。
  const low = repairRod({ ...state, rod: { ...state.rod, durability: 0 }, rods: [{ ...state.rod, durability: 0 }], config: { ...state.config, rods: state.config.rods.map((rod) => ({ ...rod, repair: { ...rod.repair, amount: 5 } })) } }, 'rod-azure-1')
  assert.equal(low.rod.durability, 5)
  assert.equal(low.fishing.running, false)
})

test('one-click reveal is gone: only per-card reveal exists', () => {
  const state = createInitialState()
  const next = revealScratch(state, 'scratch-1')
  assert.equal(next.scratchCards.find((card) => card.id === 'scratch-1').status, 'revealed')
  // 其余卡保持未刮开：没有批量翻牌的入口。
  assert.equal(next.scratchCards.filter((card) => card.id !== 'scratch-1' && card.status === 'ready').length, state.scratchCards.length - 1)
  assert.equal(next.stats.totalScratch, state.stats.totalScratch + 1)
})

test('discard removes revealed scratch cards but preserves ready cards', () => {
  const state = createInitialState()
  const revealed = revealScratch(state, 'scratch-1')
  const readyId = revealed.scratchCards.find((card) => card.status === 'ready').id
  const inventory = { ...revealed.inventory }
  const totalScratch = revealed.stats.totalScratch
  const next = discardRevealedScratch(revealed)
  assert.equal(next.scratchCards.length, 1)
  assert.equal(next.scratchCards[0].id, readyId)
  assert.equal(next.scratchCards[0].status, 'ready')
  assert.deepEqual(next.inventory, inventory)
  assert.equal(next.stats.totalScratch, totalScratch)
})

test('discard with no revealed cards leaves ready scratch cards intact', () => {
  const state = createInitialState()
  assert.equal(discardRevealedScratch(state), state)
  assert.equal(state.scratchCards.every((card) => card.status === 'ready'), true)
})

test('legacy save scales rod durability to the new maximum and adds bite state', () => {
  const seed = createInitialState()
  const legacy = {
    version: 3,
    config: seed.config,
    fishing: { running: true, progress: 6200, lastTickAt: 1000, selectedDepthId: 'shore' },
    rod: { ...RODS[0], id: 'rod-tide', durability: 74, maxDurability: 100, status: 'active' },
    rods: [{ ...RODS[0], id: 'rod-tide', durability: 74, maxDurability: 100, status: 'active' }],
    inventory: {}, fish: [], tickets: [], scratchCards: [], draws: {}, stats: { totalCatches: 0, totalDurabilityLoss: 0 },
  }
  const original = globalThis.localStorage
  globalThis.localStorage = { getItem: () => JSON.stringify(legacy), setItem: () => {} }
  try {
    const migrated = loadState()
    assert.equal(migrated.rod.maxDurability, 1000)
    assert.equal(migrated.rod.durability, 740)
    assert.equal(migrated.fishing.phase, 'charging')
    assert.equal(migrated.fishing.bite, null)
    assert.deepEqual(migrated.escapes, [])
    assert.equal(migrated.stats.totalEscapes, 0)
  } finally {
    globalThis.localStorage = original
  }
})

test('fish price sums trait prices plus matching combo prices', async () => {
  const { fishQuotePrice, DEFAULT_CONFIG, normalizeConfig } = await import('../src/game.js')
  const config = normalizeConfig(DEFAULT_CONFIG)
  const state = { config }
  const fish = { traits: ['abyssal', 'armored', 'luminous'], depthId: 'abyss' }
  const pricing = fishQuotePrice(state, fish)
  const expectedTraits = config.quotes.traitQuotes.abyssal + config.quotes.traitQuotes.armored + config.quotes.traitQuotes.luminous
  assert.equal(pricing.traitTotal, expectedTraits)
  assert.equal(pricing.comboTotal, 14 + 32)
  assert.equal(pricing.total, expectedTraits + 46)
})

test('combo without all traits does not add price', async () => {
  const { fishQuotePrice, DEFAULT_CONFIG, normalizeConfig } = await import('../src/game.js')
  const state = { config: normalizeConfig(DEFAULT_CONFIG) }
  const pricing = fishQuotePrice(state, { traits: ['abyssal', 'armored'], depthId: 'abyss' })
  assert.deepEqual(pricing.comboLines.map((line) => line.name), ['渊印重甲'])
  assert.equal(pricing.comboTotal, 14)
})

test('price tiers map total price to reward tier', async () => {
  const { DEFAULT_CONFIG, normalizeConfig, tierForPrice, quoteForFish } = await import('../src/game.js')
  const config = normalizeConfig(DEFAULT_CONFIG)
  const state = { config }
  assert.equal(tierForPrice(config, 0).id, 'tier-1')
  assert.equal(tierForPrice(config, 19).id, 'tier-1')
  // 19.1 落在 19–20 的空档里，应归到第一档，不能兜底到最后一档（60+）。
  assert.equal(tierForPrice(config, 19.1).id, 'tier-1')
  assert.equal(tierForPrice(config, 39.5).id, 'tier-2')
  assert.equal(tierForPrice(config, 59.5).id, 'tier-3')
  assert.equal(tierForPrice(config, 20).id, 'tier-2')
  assert.equal(tierForPrice(config, 45).id, 'tier-3')
  assert.equal(tierForPrice(config, 999).id, 'tier-4')
  const quote = quoteForFish(state, { traits: ['swift'], depthId: 'shore' })
  assert.equal(quote.pricing.total, config.quotes.traitQuotes.swift)
  assert.ok(quote.tier)
})

test('rod energyPerCatch is configurable and gates the bite threshold', async () => {
  const { createInitialState, advanceFishing, applyConfig } = await import('../src/game.js')
  const state = createInitialState()
  const configured = applyConfig(state, { ...state.config, rods: state.config.rods.map((rod, index) => index === 0 ? { ...rod, energyPerCatch: 2000 } : rod) })
  assert.equal(configured.rod.energyPerCatch, 2000)
  const running = { ...configured, fishing: { ...configured.fishing, progress: 0, lastTickAt: 1000 } }
  const after = advanceFishing(running, 3000)
  assert.equal(after.fishing.phase, 'reeling')
  assert.ok(after.fishing.bite)
})

test('trait effects drive escape risk through the tension multiplier', () => {
  const seed = createInitialState()
  const mild = normalizeTrait({ id: 'mild', label: '微澜', icon: '~', color: '#5aa6a1', value: 1, effects: [{ type: 'tensionRate', mode: 'multiply', value: 1.6 }] })
  const state = { ...seed, config: { ...seed.config, traits: [mild] }, rod: { ...seed.rod, tension: { ...seed.rod.tension, maxRate: 1000 } }, fishing: { ...seed.fishing, progress: 0, lastTickAt: 1000 } }
  // 1.6× 张力约 1.1 秒充满，早于 10 秒的钓鱼进度，因此必定脱钩。
  const next = advanceFishing(state, 3000)
  assert.ok(next.stats.totalEscapes >= 1)
  assert.equal(next.stats.totalCatches, 0)
  assert.ok(next.rod.durability < 1000)
})

test('legacy config rods are rebalanced to the new durability scale', () => {
  const seed = createInitialState()
  const legacyConfig = { ...seed.config, rods: seed.config.rods.map((rod) => rod.id === 'tide' ? { ...rod, maxDurability: 100, durability: 74 } : rod) }
  const legacy = {
    version: 3,
    config: legacyConfig,
    fishing: { running: true, progress: 6200, lastTickAt: 1000, selectedDepthId: 'shore' },
    rod: { ...RODS[0], id: 'rod-tide', durability: 74, maxDurability: 100, status: 'active' },
    rods: [{ ...RODS[0], id: 'rod-tide', durability: 74, maxDurability: 100, status: 'active' }],
    inventory: {}, fish: [], tickets: [], scratchCards: [], draws: {}, stats: { totalCatches: 0, totalDurabilityLoss: 0 },
  }
  const original = globalThis.localStorage
  globalThis.localStorage = { getItem: () => JSON.stringify(legacy), setItem: () => {} }
  try {
    const migrated = loadState()
    assert.equal(migrated.config.rods[0].maxDurability, 1000)
    assert.equal(migrated.rod.maxDurability, 1000)
    assert.equal(migrated.rod.durability, 740)
  } finally {
    globalThis.localStorage = original
  }
})

test('trait bite chance multiplies into the combo weight and drives bite probability', async () => {
  const { comboBiteChance, TRAITS } = await import('../src/traits.js')
  const swift = TRAITS.find((trait) => trait.id === 'swift')
  const heavy = TRAITS.find((trait) => trait.id === 'heavy')
  assert.equal(comboBiteChance([swift]), swift.biteChance)
  assert.ok(Math.abs(comboBiteChance([swift, heavy]) - swift.biteChance * heavy.biteChance) < 1e-9)
  assert.equal(comboBiteChance([]), 1)
})

test('combination bite table covers every trait combination in the sea', async () => {
  const { combinationBiteTable } = await import('../src/traits.js')
  const traits = [{ id: 'a', biteChance: 1 }, { id: 'b', biteChance: 2 }, { id: 'c', biteChance: 3 }]
  const single = combinationBiteTable({ traits, weights: {}, minCount: 1, maxCount: 1 })
  assert.equal(single.length, 3)
  const share = single.reduce((sum, row) => sum + row.biteShare, 0)
  assert.ok(Math.abs(share - 1) < 1e-9)
  const pairs = combinationBiteTable({ traits, weights: {}, minCount: 2, maxCount: 2 })
  assert.equal(pairs.length, 3)
  // 咬钩几率更高的组合在池中占比更高
  assert.ok(pairs[0].weight >= pairs[pairs.length - 1].weight)
  // 权重为 0 的词条不会出现在任何组合里
  const blocked = combinationBiteTable({ traits, weights: { b: 0 }, minCount: 1, maxCount: 2 })
  assert.ok(blocked.every((row) => !row.ids.includes('b')))
})

test('fishing stops automatically below 10 durability and cannot resume at 1', () => {
  const seed = createInitialState()
  const state = {
    ...seed,
    rod: { ...seed.rod, durability: 5 },
    rods: [{ ...seed.rod, durability: 5 }],
    fishing: { ...seed.fishing, running: true, lastTickAt: 1000 },
  }
  // 耐久已低于阈值：本轮开始时就自动停钓，不再继续结算。
  const stopped = advanceFishing(state, 3000)
  assert.equal(stopped.rod.durability, 5)
  assert.equal(stopped.fishing.running, false)
  assert.equal(stopped.fishing.lowDurability, true)
  const dead = { ...stopped, rod: { ...stopped.rod, durability: 1 }, rods: [{ ...stopped.rod, durability: 1 }], fishing: { ...stopped.fishing, running: false } }
  assert.equal(toggleFishing(dead, 5000).fishing.running, false)
})

test('tension settings live on the rod and can be upgraded', () => {
  const seed = { ...createInitialState(), coins: 500 }
  assert.equal(seed.rod.tension.maxTension, 1200)
  const upgraded = upgradeRod(seed, seed.rod.id, 'tension')
  assert.equal(upgraded.rod.tension.maxTension, 1215)
  assert.equal(upgraded.rod.levels.tension, 1)
  // 换一把钓竿就是换一条张力曲线：咬钩时按当前竿的张力上限结算。
  const other = { ...seed.rod, id: 'rod-x', tension: { ...seed.rod.tension, maxTension: 3000 } }
  const otherState = { ...seed, rod: other }
  const baseBite = { ...rollBite(seed, () => 0), chargeRequired: 10000, chargeAtBite: 0 }
  const otherBite = { ...rollBite(otherState, () => 0), chargeRequired: 10000, chargeAtBite: 0 }
  assert.ok(otherBite.maxTension > baseBite.maxTension)
  assert.ok(biteTiming(otherState, otherBite).fillMs > biteTiming(seed, baseBite).fillMs)
})

test('merchant tiers pay blank tickets that can be assigned to any pool', () => {
  const seed = createInitialState()
  const fish = { ...seed.config && {}, id: 'fish-test', name: '测试鱼', traits: seed.config.traits.slice(0, 4).map((trait) => trait.id), status: 'fresh' }
  const quote = quoteForFish(seed, fish)
  assert.ok(quote.tickets)
  assert.equal(quote.tickets.name, '空白彩票')
  assert.ok(quote.tickets.qty > 0)
  assert.equal(quote.tickets.typeId, undefined)
  const next = exchangeFish({ ...seed, fish: [fish] }, fish.id)
  assert.ok(next.tickets.length > seed.tickets.length)
  const blank = next.tickets[next.tickets.length - 1]
  assert.equal(blank.status, 'BLANK')
  assert.equal(blank.tier, null)
  // 合成要消耗多张空白票，商会换来的票需要攒够才能投入。
  const stocked = withBlanks(next, blankCount(next) + 6)
  const assigned = chooseLottery(stocked, blank.id, 'advanced')
  assert.equal(assigned.tickets.find((ticket) => ticket.id === blank.id).status, 'ASSIGNED')
})

// 潮汐商会一键兑换：仓库超过 60 条时也必须全部结算并清空，不能只处理前 60 条。
// 大部分用例验证的是玩法本身，而不是逐个解锁：把引导直接置为全开，
// 避免每个用例都要先"攒够进度"。引导自身的串行/赠币逻辑另有专门用例覆盖。
const guideReady = (state) => ({ ...state, guide: { ...state.guide, skipped: true, stage: 8 } })

const freshFishFixture = (count, overrides = {}) => Array.from({ length: count }, (_, index) => ({
  id: `fresh-${index}`,
  name: `测试鱼${index}`,
  latin: 'Testus',
  depth: '河口',
  depthId: 'shore',
  depthColor: '#000',
  traits: [],
  rarity: '普通',
  weight: 1,
  status: 'fresh',
  caughtAt: index,
  ...overrides,
}))

test('one-click exchange settles every fish when the warehouse holds more than 60', () => {
  const seed = { ...createInitialState(), fish: freshFishFixture(240) }
  const next = exchangeFishBatchByFilter(seed, '全部')
  assert.equal(warehouseCount(next), 0, '兑换后仓库不应剩下任何鱼')
  assert.equal(next.npc.lastExchange.count, 240)
  assert.equal(next.fish.filter((fish) => fish.status === 'exchanged').length, 30, '兑换记录只保留最近 30 条')
  assert.equal(next.scratchCards.length, seed.scratchCards.length + 240, '每条鱼的低价档奖励都应入账')
})

test('one-click exchange only takes fish matching the current filter', () => {
  const seed = createInitialState()
  const combo = seed.config.quotes.combos[0]
  const fish = [
    freshFishFixture(1, { id: 'shore-fish' })[0],
    freshFishFixture(1, { id: 'abyss-fish', depth: '深渊', depthId: 'abyss' })[0],
    freshFishFixture(1, { id: 'combo-fish', traits: combo.traits })[0],
  ]
  assert.equal(fishMatchesExchangeFilter(seed, fish[0], '深渊'), false)
  assert.equal(fishMatchesExchangeFilter(seed, fish[1], '深渊'), true)
  assert.equal(fishMatchesExchangeFilter(seed, fish[2], '组合加成'), true)

  const abyssOnly = exchangeFishBatchByFilter({ ...seed, fish }, '深渊')
  assert.equal(abyssOnly.npc.lastExchange.count, 1)
  assert.deepEqual(abyssOnly.fish.filter((item) => item.status === 'fresh').map((item) => item.id), ['shore-fish', 'combo-fish'])

  const combosOnly = exchangeFishBatchByFilter({ ...seed, fish }, '组合加成')
  assert.equal(combosOnly.npc.lastExchange.count, 1)
  assert.deepEqual(combosOnly.fish.filter((item) => item.status === 'fresh').map((item) => item.id), ['shore-fish', 'abyss-fish'])
})

test('batch exchange action no longer truncates explicit fish ids at 60', async () => {
  const { applyAction } = await import('../server/actions.js')
  const seed = guideReady({ ...createInitialState(), fish: freshFishFixture(120) })
  const result = applyAction('exchangeFishBatch', seed, { fishIds: seed.fish.map((fish) => fish.id) })
  assert.equal(result.applied, true)
  assert.equal(result.state.npc.lastExchange.count, 120)
  assert.equal(warehouseCount(result.state), 0)
})

test('batch exchange action accepts a filter scope instead of thousands of ids', async () => {
  const { applyAction } = await import('../server/actions.js')
  const seed = guideReady({ ...createInitialState(), fish: freshFishFixture(120) })
  const result = applyAction('exchangeFishBatch', seed, { filter: '全部' })
  assert.equal(result.applied, true)
  assert.equal(result.state.npc.lastExchange.count, 120)
  assert.equal(warehouseCount(result.state), 0)
})

test('no state transition writes to the activity feed', () => {
  const seed = createInitialState()
  assert.equal(seed.activity, undefined)
  const revealed = revealScratch(seed, 'scratch-1')
  assert.equal(revealed.activity, undefined)
  const exchanged = exchangeFish({ ...seed, fish: [{ id: 'f1', name: '鱼', traits: [], status: 'fresh' }] }, 'f1')
  assert.equal(exchanged.activity, undefined)
})

// 平衡目标：初阶竿未升级在河口 60–70%、升满在海沟 ≥80%；
// 进阶竿未升级在礁石 60–70%、升满在裂谷 ≥85%；
// 深渊竿未升级在裂谷 60–70%、升满在深渊 ≥90%。
// 固定种子的 LCG：平衡用例必须可复现，不能靠 Math.random 抖动。
const seededRandom = (seed) => {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const successRate = (rodId, depthId, level, samples = 4000) => {
  const seed = createInitialState()
  const def = seed.config.rods.find((rod) => rod.id === rodId)
  const levels = { speed: level, durability: level, tension: level }
  const stats = rodStatsFrom(def, levels)
  const rod = {
    ...seed.rod, ...def, levels,
    // 基准曲线按「耐久修正 1.0×」测量：即 60% 耐久。满耐久会吃到 1.2× 的加成，
    // 那是刻意留的上浮空间，不应作为平衡基准。
    maxDurability: 1e9, durability: 6e8,
    energyPerSecond: stats.energyPerSecond, energyPerCatch: def.energyPerCatch,
    resistance: 0, tension: stats.tension, status: 'active',
  }
  const state = { ...seed, rod, rods: [rod], fishing: { ...seed.fishing, selectedDepthId: depthId }, unlockedDepths: DEPTHS.map((depth) => depth.id) }
  const random = seededRandom(2024)
  let wins = 0
  for (let i = 0; i < samples; i += 1) {
    const bite = { ...rollBite(state, random), startedAt: 0, chargeRequired: rod.energyPerCatch, chargeAtBite: 0 }
    if (!biteTiming(state, bite).escaped) wins += 1
  }
  return wins / samples
}

test('rods hit the agreed success-rate curve at their intended seas', () => {
  const cases = [
    ['tide', 'shore', 0, 0.6, 0.7],
    ['tide', 'deep', 99, 0.8, 1],
    ['azure', 'open', 0, 0.6, 0.7],
    ['azure', 'rift', 99, 0.85, 1],
    ['abyss', 'rift', 0, 0.6, 0.7],
    ['abyss', 'abyss', 99, 0.9, 1],
  ]
  cases.forEach(([rod, depth, level, min, max]) => {
    const rate = successRate(rod, depth, level)
    assert.ok(rate >= min, `${rod} lv${level} @${depth} 成功率 ${(rate * 100).toFixed(1)}% 低于 ${min * 100}%`)
    assert.ok(rate <= max, `${rod} lv${level} @${depth} 成功率 ${(rate * 100).toFixed(1)}% 高于 ${max * 100}%`)
  })
})

test('trait distribution is controlled only by the per-depth weight table', async () => {
  const { defaultTraitWeights, traitWeightFor, normalizeConfig, DEFAULT_CONFIG } = await import('../src/game.js')
  const seed = createInitialState()
  const weights = defaultTraitWeights(seed.config.traits)
  // 词条本身没有「起始海域」：未配置时每个海域权重都是 1。
  Object.values(weights).forEach((entry) => Object.values(entry).forEach((value) => assert.equal(value, 1)))
  // 海域配置里的 0 才是「该海域不刷这个词条」。
  const config = normalizeConfig({ ...DEFAULT_CONFIG, depthTraitWeights: { shore: { abyssal: 0 }, abyss: { abyssal: 7 } } })
  assert.equal(traitWeightFor(config, 'shore', 'abyssal'), 0)
  assert.equal(traitWeightFor(config, 'shelf', 'abyssal'), 1)
  assert.equal(traitWeightFor(config, 'abyss', 'abyssal'), 7)
})

test('deep-sea trait presets use the new tension and saw semantics', async () => {
  const { TRAITS, TRAIT_EFFECT_TYPES, normalizeEffect } = await import('../src/traits.js')
  // 抖动效果已整体移除，旧配置里残留的也会在 normalize 时被丢弃。
  assert.equal(TRAIT_EFFECT_TYPES.some((type) => /Jitter/.test(type.id)), false)
  assert.equal(normalizeEffect({ type: 'tensionJitter', mode: 'add', value: 0.2 }), null)
  // 最大张力修正的是脱钩阈值，预设应小于 1；张力积累率预设应大于 1。
  TRAITS.forEach((trait) => {
    ;(trait.effects || []).forEach((effect) => {
      if (effect.type === 'maxTension') assert.ok(effect.value < 1, `${trait.id} 的脱钩张力应小于 1`)
      if (effect.type === 'tensionRate') assert.ok(effect.value > 1, `${trait.id} 的张力积累率应大于 1`)
    })
  })
  assert.ok(TRAITS.some((trait) => trait.effects.some((effect) => effect.type === 'sawLoss')))
  assert.ok(TRAITS.some((trait) => trait.effects.some((effect) => effect.type === 'sawThreshold')))
  // 拉锯损耗只允许乘算，拉锯阈值只允许加算（并且只接受负值）。
  assert.deepEqual(normalizeEffect({ type: 'sawLoss', mode: 'add', value: 2 }), { type: 'sawLoss', mode: 'multiply', value: 2 })
  assert.deepEqual(normalizeEffect({ type: 'sawThreshold', mode: 'multiply', value: -0.05 }), { type: 'sawThreshold', mode: 'add', value: -0.05 })
  assert.equal(normalizeEffect({ type: 'sawThreshold', mode: 'add', value: 0.2 }).value, 0)
})

test('saw loss wears the rod after both a catch and an escape', async () => {
  const { resolveBite } = await import('../src/game.js')
  const { normalizeTrait } = await import('../src/traits.js')
  const seed = createInitialState()
  const saw = normalizeTrait({ id: 'saw', label: '锯鳞', icon: '≋', color: '#888888', effects: [{ type: 'sawLoss', mode: 'multiply', value: 2 }, { type: 'sawThreshold', mode: 'add', value: -0.1 }] })
  const rod = { ...seed.rod, durability: 100, resistance: 0, breakable: false, tension: { ...seed.rod.tension, maxTension: 1000 } }
  const base = {
    ...seed,
    rod,
    rods: [rod],
    config: { ...seed.config, traits: [saw] },
    fish: [],
    fishing: { ...seed.fishing, tension: 900, progress: 10000, running: true },
  }
  const fish = { id: 'fish-saw', name: '锯鳞鱼', latin: 'Saw fish', speciesClass: 'saw', depth: '河口', depthId: 'shore', depthColor: '#888888', traits: ['saw'], rarity: '普通', rarityValue: 6, weight: 1 }
  const bite = { fish, maxTension: 1000, lossBase: 10, tensionRate: 1, chargeRate: 1, chargeRequired: 10000, chargeAtBite: 0, startedAt: 0 }
  // 上钩：阈值降到 70%，张力 900 → 超出 200 点，每 100 点 ×2 = 4 耐久。
  const caught = resolveBite(base, bite, { escaped: false }, 1000)
  assert.equal(caught.fish.length, 1)
  assert.equal(caught.rod.durability, 96)
  assert.equal(caught.fishing.lastOutcome.loss, 4)
  assert.equal(caught.stats.totalDurabilityLoss, 4)
  // 脱钩：张力满 1000 → 超出 300 点，拉锯 6 + 基础损耗 10。
  const escaped = resolveBite({ ...base, fish: [] }, bite, { escaped: true }, 1000)
  assert.equal(escaped.rod.durability, 84)
  assert.equal(escaped.fishing.lastOutcome.loss, 16)
  assert.equal(escaped.escapes[0].sawLoss, 6)
})

test('warehouse capacity starts at 1000, grows by 100 per level, and upgrades with coins only', async () => {
  const { createInitialState: makeState, warehouseCapacity, warehouseCount, warehouseFull, warehouseUpgradeCost, upgradeWarehouse, canUpgradeWarehouse } = await import('../src/game.js')
  const seed = makeState()
  assert.equal(seed.config.warehouse.base, 1000)
  assert.equal(seed.config.warehouse.step, 100)
  assert.equal(seed.config.warehouse.maxLevel, 90)
  const at = (level) => ({ ...seed, warehouseLevel: level })
  assert.equal(warehouseCapacity(seed), 1000)
  assert.equal(warehouseCapacity(at(1)), 1100)
  assert.equal(warehouseCapacity(at(90)), 10000)
  // 只吃鱼币，不消耗任何材料
  const rich = { ...seed, coins: 99999, inventory: {} }
  assert.equal(canUpgradeWarehouse(rich), true)
  const next = upgradeWarehouse(rich)
  assert.equal(next.warehouseLevel, 1)
  assert.ok(next.coins < rich.coins)
  assert.deepEqual(next.inventory, rich.inventory, '仓库扩容不消耗材料')
  // 越升越贵
  assert.ok(warehouseUpgradeCost(next).coins > warehouseUpgradeCost(rich).coins)
  // 没钱升不动：返回同一个引用（服务端据此回 409）
  const broke = { ...seed, coins: 0 }
  assert.equal(upgradeWarehouse(broke), broke)
  // 满级后返回 null
  assert.equal(warehouseUpgradeCost(at(90)), null)
  const full = { ...seed, fish: Array.from({ length: 1000 }, (_, index) => ({ id: `fish-${index}`, status: 'fresh' })) }
  assert.equal(warehouseCount(full), 1000)
  assert.equal(warehouseFull(full), true)
  assert.equal(warehouseFull({ ...full, fish: full.fish.slice(0, 999) }), false)
})

test('a full warehouse stops fishing and adds no fish or market flow', async () => {
  const { advanceFishing, toggleFishing } = await import('../src/game.js')
  const seed = createInitialState()
  const full = {
    ...seed,
    fish: Array.from({ length: 1000 }, (_, index) => ({ id: `fish-${index}`, status: 'fresh' })),
    fishing: { ...seed.fishing, running: true, progress: 0, lastTickAt: 1000 },
  }
  const stopped = advanceFishing(full, 5000)
  assert.equal(stopped.fishing.running, false)
  assert.equal(stopped.fish.length, 1000)
  assert.equal(stopped.fx, full.fx)
  assert.equal(toggleFishing(stopped, 6000).fishing.running, false)
})

test('upgraded rods keep their own faster tension curve', () => {
  const seed = createInitialState()
  const azure = seed.config.rods.find((rod) => rod.id === 'azure')
  const tide = seed.config.rods.find((rod) => rod.id === 'tide')
  assert.ok(azure.tension.maxRate > tide.tension.maxRate)
})

// ---- 自动维修 / 仓库扩容 / 刮层直觉（天赋系统已删除） ----

// 给某根竿设置升级等级的小工具。
const withRodLevels = (state, levels, rodId = null) => {
  const target = rodId || state.rod.id
  const apply = (rod) => rod.id === target ? { ...rod, levels: { ...(rod.levels || {}), ...levels } } : rod
  const rods = state.rods.map(apply)
  return { ...state, rods, rod: state.rod.id === target ? apply(state.rod) : state.rod }
}

test('durability scales max tension: 1.2x at full, 1.0x at 60%, 0.8x at 20% and below', async () => {
  const { durabilityTensionFactor, rodTension } = await import('../src/game.js')
  assert.equal(durabilityTensionFactor(1), 1.2)
  assert.equal(durabilityTensionFactor(0.8), 1.2)
  assert.equal(durabilityTensionFactor(0.6), 1)
  assert.equal(durabilityTensionFactor(0.2), 0.8)
  assert.equal(durabilityTensionFactor(0), 0.8)
  // 80%..60% 与 60%..20% 之间线性过渡
  assert.ok(Math.abs(durabilityTensionFactor(0.7) - 1.1) < 1e-9)
  assert.ok(Math.abs(durabilityTensionFactor(0.4) - 0.9) < 1e-9)
  // 只乘 maxTension，不改 maxRate
  const seed = createInitialState()
  const base = seed.rod.tension.maxTension
  const full = rodTension(seed)
  assert.equal(full.maxTension, Math.round(base * 1.2))
  assert.equal(full.maxRate, seed.rod.tension.maxRate)
  const worn = rodTension({ ...seed, rod: { ...seed.rod, durability: seed.rod.maxDurability * 0.6 } })
  assert.equal(worn.maxTension, base)
  const spent = rodTension({ ...seed, rod: { ...seed.rod, durability: 1 } })
  assert.equal(spent.maxTension, Math.round(base * 0.8))
})

test('auto repair is a per-rod upgrade: 0 by default, +10 threshold per level', async () => {
  const { autoRepairThreshold, autoRepairRestore, upgradeRod, rodUpgrade, upgradeLevel } = await import('../src/game.js')
  const seed = createInitialState()
  assert.ok(rodUpgrade(seed.rod, 'autoRepair'), '每根竿都应带自动维修升级项')
  assert.equal(upgradeLevel(seed.rod, 'autoRepair'), 0)
  assert.equal(autoRepairThreshold(seed, seed.rod), 0, '0 级 = 未开启')
  assert.equal(autoRepairRestore(seed.rod), 0.9, '恢复比例固定 90%')
  // 1 级阈值 20、2 级 30
  const one = withRodLevels(seed, { autoRepair: 1 })
  assert.equal(autoRepairThreshold(one, one.rod), 20)
  const two = withRodLevels(seed, { autoRepair: 2 })
  assert.equal(autoRepairThreshold(two, two.rod), 30)
  // 升级要花鱼币 + 材料，且等级落在这根竿自己身上
  const rich = { ...seed, coins: 99999, inventory: { ...seed.inventory, '深蓝晶片': 99 } }
  const next = upgradeRod(rich, rich.rod.id, 'autoRepair')
  assert.equal(upgradeLevel(next.rod, 'autoRepair'), 1)
  assert.ok(next.coins < rich.coins)
})

test('auto repair does not carry across rods: a new rod starts at level 0', async () => {
  const { autoRepairThreshold, selectRod, upgradeRod } = await import('../src/game.js')
  const seed = createInitialState()
  // 造一把备用竿（苍蓝），主竿升到 3 级自动维修
  const azure = seed.config.rods.find((rod) => rod.id === 'azure')
  const spare = { ...azure, id: 'rod-azure-test', durability: azure.maxDurability, status: 'stored' }
  const withSpare = { ...seed, rods: [seed.rod, spare], coins: 99999, inventory: { ...seed.inventory, '深蓝晶片': 99 } }
  const leveled = upgradeRod(upgradeRod(withSpare, seed.rod.id, 'autoRepair'), seed.rod.id, 'autoRepair')
  assert.equal(autoRepairThreshold(leveled, leveled.rod) > 0, true)
  // 切到备用竿：阈值必须归零（每根竿各自升级）
  const switched = selectRod(leveled, spare.id)
  assert.equal(switched.rod.id, spare.id)
  assert.equal(autoRepairThreshold(switched, switched.rod), 0, '换竿后自动维修要重新升')
})

test('auto repair only fires when enabled, below threshold, and affordable', async () => {
  const { autoRepairRod } = await import('../src/game.js')
  const seed = createInitialState()
  const at = (durability, level) => withRodLevels({ ...seed, rod: { ...seed.rod, durability }, rods: [{ ...seed.rod, durability }] }, { autoRepair: level })
  // 0 级不维修
  const off = at(5, 0)
  assert.equal(autoRepairRod(off, 10000), off)
  // 1 级阈值 20：耐久 5 会被修
  const on = at(5, 1)
  const repaired = autoRepairRod(on, 10000)
  assert.ok(repaired.rod.durability > 5)
  assert.ok(repaired.inventory['深蓝晶片'] < seed.inventory['深蓝晶片'])
  // 冷却期内不重复维修
  assert.equal(autoRepairRod(repaired, 10001), repaired)
  // 材料不够时不维修
  const empty = { ...on, inventory: { ...seed.inventory, '深蓝晶片': 0 } }
  assert.equal(autoRepairRod(empty, 10000), empty)
})

test('auto repair keeps a damaged rod fishing without a manual resume', async () => {
  const { advanceFishing } = await import('../src/game.js')
  const seed = createInitialState()
  const state = {
    ...withRodLevels({ ...seed, rod: { ...seed.rod, durability: 12 }, rods: [{ ...seed.rod, durability: 12 }] }, { autoRepair: 2 }),
    fishing: { ...seed.fishing, running: true, progress: 0, lastTickAt: 1000, autoRepairAt: 0 },
  }
  const next = advanceFishing(state, 10000)
  assert.ok(next.rod.durability > 12)
  assert.equal(next.fishing.running, true)
  assert.equal(next.fishing.lowDurability, false)
})

test('auto repair catches the rod when a bite trips the stop line mid-tick', async () => {
  const { advanceFishing } = await import('../src/game.js')
  const seed = createInitialState()
  const rod = { ...seed.rod, durability: 51 }
  const state = {
    ...withRodLevels({ ...seed, rod, rods: [rod] }, { autoRepair: 5 }),
    fishing: {
      ...seed.fishing,
      running: true,
      phase: 'reeling',
      progress: 0,
      tension: 80,
      lastTickAt: 10000,
      autoRepairAt: 0,
      bite: {
        fish: { id: 'fish-stop-test', name: '测试鱼', latin: 'testus', depthId: 'shore', depth: '河口', depthColor: '#94a3b8', traits: [], rarity: '普通', rarityValue: 1, weight: 1 },
        maxTension: 100,
        tensionRate: 10,
        tensionDelay: 0,
        chargeRate: 1,
        lossBase: 20,
        comboWeight: 1,
        biteWeight: 1,
        startedAt: 10000,
        chargeRequired: 1e9,
        chargeAtBite: 0,
      },
    },
  }
  // 5 级阈值 = 60；脱钩扣耐久后跌破停钓线，自动维修要在同一段模拟里接住。
  const next = advanceFishing(state, 11000, { maxSteps: 1, random: () => 0.5 })
  assert.equal(next.fishing.autoStopped, false)
  assert.equal(next.fishing.running, true, '修好后应继续钓鱼，而不是停在停钓线')
  assert.ok(next.rod.durability > 51, `耐久应被补回：${next.rod.durability}`)
})

test('auto repair can revive a broken rod so it resumes fishing', async () => {
  const { autoRepairRod } = await import('../src/game.js')
  const seed = createInitialState()
  const brokenRod = { ...seed.rod, durability: 0, status: 'broken' }
  const state = {
    ...withRodLevels({ ...seed, rod: brokenRod, rods: [brokenRod] }, { autoRepair: 1 }),
    fishing: { ...seed.fishing, running: false, autoStopped: false, autoRepairAt: 0 },
  }
  const next = autoRepairRod(state, 10000)
  assert.ok(next.rod.durability > 0, '损坏的钓竿应被自动修好')
  assert.equal(next.rod.status, 'active')
  assert.equal(next.fishing.running, true, '修好后应自动恢复钓鱼')
  // 玩家手动暂停（非损坏、非系统停钓）时不烧材料
  const pausedRod = { ...brokenRod, status: 'active', durability: 20 }
  const paused = { ...withRodLevels({ ...seed, rod: pausedRod, rods: [pausedRod] }, { autoRepair: 1 }), fishing: { ...seed.fishing, running: false, autoStopped: false, autoRepairAt: 0 } }
  assert.equal(autoRepairRod(paused, 10000), paused)
})

test('overflow repair is built in: repair whenever durability is not full, with no cap', async () => {
  const { repairRod, canRepairRod, rodRepairCap } = await import('../src/game.js')
  const seed = createInitialState()
  const max = seed.rod.maxDurability
  // 未满就能修
  const damaged = { ...seed, rod: { ...seed.rod, durability: max - 10 }, rods: [{ ...seed.rod, durability: max - 10 }] }
  assert.equal(canRepairRod(damaged, damaged.rod), true)
  // 溢出维修初始自带且额度不限：从 max-10 修 100，会直接越过标称上限
  const once = repairRod(damaged, damaged.rod.id, 100)
  assert.equal(once.rod.durability, max + 90, '允许修到标称上限之上，且不截断')
  // 越过上限后就不算「未满」了，不能再继续叠（这是「仅在耐久未满时允许维修」的含义）
  assert.equal(canRepairRod(once, once.rod), false)
  assert.equal(repairRod(once, once.rod.id, 100), once)
  // 掉回上限以下之后又能修
  const worn = { ...once, rod: { ...once.rod, durability: max - 1 }, rods: once.rods.map((rod) => ({ ...rod, durability: max - 1 })) }
  assert.equal(canRepairRod(worn, worn.rod), true)
  assert.equal(rodRepairCap(once.rod), max, '标称上限不变')
  // 溢出部分计入耐久比例：满耐久以上仍然是 1.2×
  const { rodTensionDurabilityFactor } = await import('../src/game.js')
  assert.equal(rodTensionDurabilityFactor(once), 1.2)
})

test('scratch luck levels up silently every 10 scratches, boosting both threshold and radius', async () => {
  const { scratchThreshold, scratchRadius, scratchLuckLevel } = await import('../src/game.js')
  const seed = createInitialState()
  const at = (total) => ({ ...seed, stats: { ...seed.stats, totalScratch: total } })
  // 0–9 次：0 级
  assert.equal(scratchLuckLevel(at(0)), 0)
  assert.equal(scratchLuckLevel(at(9)), 0)
  assert.equal(scratchThreshold(at(9)), 0.45)
  assert.equal(scratchRadius(at(9)), 17)
  // 第 10 次：1 级，两个技能各升一档
  assert.equal(scratchLuckLevel(at(10)), 1)
  assert.ok(Math.abs(scratchThreshold(at(10)) - 0.4455) < 1e-9)
  assert.ok(Math.abs(scratchRadius(at(10)) - 17.17) < 1e-9)
  // 第 100 次：10 级
  assert.equal(scratchLuckLevel(at(100)), 10)
  // 上限 20 级（200 次），不再继续变
  assert.equal(scratchLuckLevel(at(1000)), 20)
  assert.ok(Math.abs(scratchThreshold(at(1000)) - 0.36) < 1e-9)
  assert.ok(Math.abs(scratchRadius(at(1000)) - 20.4) < 1e-9)
})

test('combo bonuses keep their base price and have no extra multiplier', async () => {
  const { fishQuotePrice } = await import('../src/game.js')
  const seed = createInitialState()
  const combo = seed.config.quotes.combos[0]
  const fish = { id: 'c1', name: '鱼', traits: [...combo.traits], status: 'fresh' }
  const quote = fishQuotePrice(seed, fish)
  const line = quote.comboLines.find((item) => item.id === combo.id)
  assert.ok(line, '组合应被命中')
  assert.equal(line.price, combo.price)
  assert.equal(line.bonus, 0, '不再有任何组合加价')
  assert.equal(line.total, combo.price)
  assert.equal(line.boosted, false)
  assert.equal(quote.comboBonus, 0)
})

test('admin config keeps scratch slots and per-rod upgrades intact', async () => {
  const { normalizeConfig, DEFAULT_CONFIG, applyConfig, createInitialState } = await import('../src/game.js')
  const config = normalizeConfig({ ...DEFAULT_CONFIG, scratchTypes: [{ ...DEFAULT_CONFIG.scratchTypes[0], slots: 9 }] })
  assert.equal(config.scratchTypes[0].slots, 9)
  const over = normalizeConfig({ ...DEFAULT_CONFIG, scratchTypes: [{ ...DEFAULT_CONFIG.scratchTypes[0], slots: 15 }] })
  assert.equal(over.scratchTypes[0].slots, 10)
  // 天赋已删除，配置里不应再有 talents
  assert.equal(config.talents, undefined)
  // 钓竿升级项（含自动维修）保留
  const autoRepair = config.rods[0].upgrades.find((upgrade) => upgrade.id === 'autoRepair')
  assert.ok(autoRepair, '钓竿配置应带自动维修升级项')
  const custom = {
    ...DEFAULT_CONFIG,
    rods: DEFAULT_CONFIG.rods.map((rod, index) => index === 0
      ? { ...rod, upgrades: rod.upgrades.map((upgrade) => upgrade.id === 'autoRepair' ? { ...upgrade, maxLevel: 5 } : upgrade) }
      : rod),
  }
  const state = applyConfig(createInitialState(), { ...custom, scratchTypes: [{ ...DEFAULT_CONFIG.scratchTypes[0], slots: 2 }] })
  assert.equal(state.config.scratchTypes[0].slots, 2)
  assert.equal(state.config.rods[0].upgrades.find((upgrade) => upgrade.id === 'autoRepair').maxLevel, 5)
})

test('a persisted world config without the new upgrade still exposes auto repair', async () => {
  // 线上 world_config 存的是上次保存时的快照：内置钓竿还只有旧的三条升级项。
  // normalizeConfig 必须以代码默认值补齐，否则所有玩家都拿不到自动维修。
  const { normalizeConfig } = await import('../src/game.js')
  const legacy = {
    rods: [{
      id: 'tide', name: '潮痕 · 初阶',
      upgrades: [
        { id: 'speed', coins: 60, cost: 3 },
        { id: 'durability', coins: 120, cost: 1 },
        { id: 'tension', coins: 150, cost: 1 },
      ],
    }],
  }
  const config = normalizeConfig(legacy)
  const ids = config.rods[0].upgrades.map((upgrade) => upgrade.id)
  assert.deepEqual(ids, ['speed', 'durability', 'tension', 'autoRepair'])
  const autoRepair = config.rods[0].upgrades.find((upgrade) => upgrade.id === 'autoRepair')
  assert.equal(autoRepair.thresholdBase, 10)
  assert.equal(autoRepair.maxLevel, 8)
  // 后台改过的旧升级项数值要保留，不能被默认值覆盖
  assert.equal(config.rods[0].upgrades.find((upgrade) => upgrade.id === 'speed').coins, 60)
  // 玩家自建竿（配置里没有同名 id）不补内置项
  const custom = normalizeConfig({ rods: [{ id: 'rod-custom', name: '自定义竿', upgrades: [] }] })
  assert.equal(custom.rods[0].upgrades.length, 0)
})

test('legacy rod snapshots pick up newly added upgrades such as auto repair', async () => {
  const { hydrateState, createInitialState: make } = await import('../src/game.js')
  const seed = make()
  // 线上老存档：钓竿上持久化的是旧版三条升级项，没有 autoRepair。
  const legacyRod = {
    ...seed.rod,
    upgrades: seed.rod.upgrades.filter((upgrade) => upgrade.id !== 'autoRepair'),
  }
  const migrated = hydrateState({ ...seed, version: 12, rod: legacyRod, rods: [legacyRod] })
  const ids = migrated.rods[0].upgrades.map((upgrade) => upgrade.id)
  assert.deepEqual(ids, ['speed', 'durability', 'tension', 'autoRepair'], '旧钓竿也要拿到新升级项')
  // 存档里残留的、配置里已删除的旧升级项要丢掉
  const withStale = { ...legacyRod, upgrades: [...legacyRod.upgrades, { id: 'ghost', label: '已删除项', coins: 1, cost: 1 }] }
  const cleaned = hydrateState({ ...seed, version: 12, rod: withStale, rods: [withStale] })
  assert.equal(cleaned.rods[0].upgrades.some((upgrade) => upgrade.id === 'ghost'), false)
  // 已经升过的自动维修等级要保留
  const leveled = { ...legacyRod, levels: { ...(legacyRod.levels || {}), autoRepair: 3 } }
  const kept = hydrateState({ ...seed, version: 12, rod: leveled, rods: [leveled] })
  assert.equal(kept.rods[0].levels.autoRepair, 3)
})

test('legacy saves migrate warehouse level out of the old talent tree', async () => {
  const { hydrateState } = await import('../src/game.js')
  const seed = createInitialState()
  const legacy = {
    ...seed,
    version: 12,
    talents: { 'talent-warehouse': { capacity: 7 }, 'talent-repair': { threshold: 3, restore: 4 } },
    warehouseLevel: undefined,
  }
  const migrated = hydrateState(legacy)
  assert.equal(migrated.warehouseLevel, 7, '旧天赋等级要迁成仓库等级')
  assert.equal(migrated.talents, undefined, '天赋字段整体消失')
  assert.equal(migrated.config.talents, undefined)
})

test('my tickets sort by hits first, then by most recent bet', async () => {
  const { sortNumberedTickets } = await import('../src/game.js')
  const base = { tier: 'normal', numbers: [1, 2, 3, 4, 5, 6], drawnNumbers: [], rewards: [], claimed: false }
  const tickets = [
    { ...base, id: 'old-3hits', status: 'DRAWN', hits: 3, batchId: '2026-11-17T00:00:00.000Z', assignedAt: '2026-11-17T00:00:00.000Z' },
    { ...base, id: 'new-3hits', status: 'DRAWN', hits: 3, batchId: '2026-11-17T06:00:00.000Z', assignedAt: '2026-11-17T06:00:00.000Z' },
    { ...base, id: 'newest-1hit', status: 'DRAWN', hits: 1, batchId: '2026-11-17T12:00:00.000Z', assignedAt: '2026-11-17T12:00:00.000Z' },
    { ...base, id: 'pending', status: 'ASSIGNED', hits: null, batchId: '2026-11-17T18:00:00.000Z', assignedAt: '2026-11-17T18:00:00.000Z' },
    { ...base, id: 'legacy', status: 'DRAWN', hits: 5, batchId: '2026-11-16T18:00:00.000Z' },
  ]
  assert.deepEqual(sortNumberedTickets(tickets).map((ticket) => ticket.id), ['legacy', 'new-3hits', 'old-3hits', 'newest-1hit', 'pending'])
  // 不修改原数组
  assert.equal(tickets[0].id, 'old-3hits')
})


// ───────────────────────── 逐个解锁 ─────────────────────────

const GUIDE_STEP_ORDER = ['tension', 'npc', 'rodUpgrade', 'scratch', 'lottery', 'talent', 'fx', 'stats']
// patch.stats 里给了 totalExchanged 就同步算作 totalSold（商会卖鱼两条统计一起走）。
const withProgress = (state, patch) => {
  const stats = { ...state.stats, ...(patch.stats || {}) }
  if (patch.stats?.totalExchanged !== undefined && patch.stats.totalSold === undefined) stats.totalSold = patch.stats.totalExchanged
  return { ...state, ...patch, stats }
}

// 新号的引导判定基线：stats 清零（仓库里预置的初始材料/刮刮乐不计入进度）。
const blankStats = (state) => ({ ...state, coins: 0, stats: { ...state.stats, totalCatches: 0, totalExchanged: 0, totalSold: 0, totalScratchEarned: 0, totalTicketsEarned: 0 } })

test('a brand-new save has only 钓鱼/钓竿/设置 visible', async () => {
  const { guideTargetStage, guideTabVisible, guideUnlocked } = await import('../src/game.js')
  const seed = blankStats(createInitialState())
  // stage 记「已完成的步数」：第一步（钓鱼页教学）没有门槛，开局即完成。
  assert.equal(seed.guide.stage, 0)
  assert.equal(guideTargetStage(seed), 1)
  assert.equal(guideTabVisible(seed, 'fishing'), true)
  assert.equal(guideTabVisible(seed, 'rod'), true)
  assert.equal(guideTabVisible(seed, 'settings'), true)
  assert.equal(guideTabVisible(seed, 'npc'), false)
  assert.equal(guideTabVisible(seed, 'lottery'), false)
  assert.equal(guideTabVisible(seed, 'fx'), false)
  assert.equal(guideUnlocked(seed, 'tension'), true)
})

test('unlocks are strictly serial: stage stops at the first unmet step', async () => {
  const { guideTargetStage } = await import('../src/game.js')
  const seed = blankStats(createInitialState())
  // 钓到了鱼但还没卖：完成 tension + npc = 2
  let state = withProgress(seed, { stats: { totalCatches: 5 } })
  assert.equal(guideTargetStage(state), 2)
  // 卖过鱼，但刮刮乐只有 2 张：停在 rodUpgrade 之后 = 3
  state = withProgress(seed, { stats: { totalCatches: 5, totalExchanged: 1, totalScratchEarned: 2 } })
  assert.equal(guideTargetStage(state), 3, '没满足「3 张刮刮乐」时必须停在 rodUpgrade，不能跳到 scratch')
  // 凑到 3 张刮刮乐 → 完成 scratch = 4
  state = withProgress(seed, { stats: { totalCatches: 5, totalExchanged: 1, totalScratchEarned: 3 } })
  assert.equal(guideTargetStage(state), 4)
  // 彩票不足 3 张 → 停在 scratch，L4 不开
  state = withProgress(seed, { stats: { totalCatches: 5, totalExchanged: 1, totalScratchEarned: 3, totalTicketsEarned: 2 } })
  assert.equal(guideTargetStage(state), 4)
})

test('rod power needs L3+L4 done and one real rod upgrade before fx unlocks', async () => {
  const { guideTargetStage, guideTabVisible, guideRodUpgradeCount } = await import('../src/game.js')
  const seed = blankStats(createInitialState())
  const stats = { totalCatches: 30, totalExchanged: 5, totalScratchEarned: 3, totalTicketsEarned: 3 }
  // 钱和材料都够、但一次都没升过钓竿：停在彩票之后
  const rich = withProgress(seed, { stats, coins: 5000, inventory: { 浮木纤维: 10, 潮汐树脂: 10 } })
  assert.equal(guideTargetStage(rich), 5)
  assert.equal(guideTabVisible(rich, 'fx'), false, '没升过钓竿就不该开 FX')
  assert.equal(guideRodUpgradeCount(rich), 0)
  // 真的升过一级钓竿 → L5 完成，L6/L7 随之解锁
  const upgraded = { ...rich, rods: rich.rods.map((rod) => rod.id === rich.rod.id ? { ...rod, levels: { ...(rod.levels || {}), speed: 1 } } : rod) }
  assert.equal(guideRodUpgradeCount(upgraded), 1)
  assert.equal(guideTargetStage(upgraded), 8)
  assert.equal(guideTabVisible(upgraded, 'fx'), true)
  // L3+L4 缺一不可：只有刮刮乐时仍然锁着（即使已经升过竿）
  const noLottery = { ...upgraded, stats: { ...upgraded.stats, totalTicketsEarned: 0 } }
  assert.equal(guideTabVisible(noLottery, 'fx'), false)
  assert.equal(guideTargetStage(noLottery), 4)
})
test('L2 grants 1000 coins and one set of first-level upgrade materials, exactly once', async () => {
  const { advanceGuide, guideDefaultGrantMaterials, normalizeGuideConfig, DEFAULT_CONFIG } = await import('../src/game.js')
  const seed = createInitialState()
  const steps = normalizeGuideConfig(DEFAULT_CONFIG.guide).steps
  const rodUpgrade = steps.find((step) => step.id === 'rodUpgrade')
  assert.equal(rodUpgrade.grantCoins, 1000)
  const materials = guideDefaultGrantMaterials(rodUpgrade, seed.config)
  // 初始竿三条强化的首级材料之和
  // 三条强化（速度 / 最大张力 / 自动维修）的首级材料之和
  assert.deepEqual(materials, { 浮木纤维: 3, 潮汐树脂: 2, 渊核碎片: 2, 深蓝晶片: 2 })
  // 从「还没卖鱼」的空存档出发，材料才会按新手的背包计算差额。
  const empty = { ...seed, inventory: {}, coins: 0 }
  const promoted = withProgress(empty, { stats: { totalCatches: 1, totalExchanged: 1 } })
  const once = advanceGuide(promoted)
  assert.equal(once.state.coins, 1000)
  Object.entries(materials).forEach(([name, qty]) => assert.equal(once.state.inventory[name], qty))
  // 再推进一次不会再发
  const twice = advanceGuide({ ...once.state, fishing: { ...once.state.fishing } })
  assert.equal(twice.state.coins, 1000)
})

test('L6 grants 10000 coins once when FX unlocks', async () => {
  const { advanceGuide } = await import('../src/game.js')
  const seed = blankStats(createInitialState())
  const state = withProgress(seed, {
    stats: { totalCatches: 30, totalExchanged: 5, totalScratchEarned: 3, totalTicketsEarned: 3 },
    coins: 5000,
    inventory: { 浮木纤维: 10, 潮汐树脂: 10 },
    // L5 要求真的升过一次钓竿，这里补上那条记录
    rods: seed.rods.map((rod) => rod.id === seed.rod.id ? { ...rod, levels: { ...(rod.levels || {}), speed: 1 } } : rod),
  })
  const result = advanceGuide(state)
  assert.ok(result.state.guide.stage >= 6)
  // L2 是 1000、L6 是 10000：一次性从 5000 涨到 16000
  assert.equal(result.state.coins, 5000 + 1000 + 10000)
})

test('legacy saves without guide are treated as fully unlocked', async () => {
  const { hydrateState } = await import('../src/game.js')
  const seed = createInitialState()
  const { guide, ...legacy } = seed
  const migrated = hydrateState(legacy)
  assert.equal(migrated.guide.stage, 8)
  assert.equal(migrated.guide.seen.tension, true)
})

test('guide.enabled = false unlocks everything immediately', async () => {
  const { guideTargetStage, guideTabVisible } = await import('../src/game.js')
  const seed = createInitialState()
  const off = { ...seed, config: { ...seed.config, guide: { ...seed.config.guide, enabled: false } } }
  assert.equal(guideTargetStage(off), 8)
  assert.equal(guideTabVisible(off, 'fx'), true)
  assert.equal(guideTabVisible(off, 'stats'), true)
})

test('markGuideSeen only records once and skipGuide opens everything', async () => {
  const { markGuideSeen, skipGuide, guideTabVisible } = await import('../src/game.js')
  const seed = createInitialState()
  const seen = markGuideSeen(seed, 'tension', 1000)
  assert.equal(seen.guide.seen.tension, true)
  assert.equal(seen.guide.wonAt.tension, 1000)
  assert.equal(markGuideSeen(seen, 'tension', 2000), seen, '重复标记应返回同一个引用')
  const skipped = skipGuide(seed)
  assert.equal(skipped.guide.skipped, true)
  assert.equal(guideTabVisible(skipped, 'fx'), true)
})

test('earned counters increase on exchange and never go back down', async () => {
  const { createInitialState, exchangeFish } = await import('../src/game.js')
  const seed = createInitialState()
  const fish = { id: 'g1', name: '鱼', traits: [{ id: 'swift' }], status: 'fresh', depthId: 'shore', depth: '河口' }
  const state = guideReady({ ...seed, fish: [fish] })
  const before = state.stats.totalScratchEarned || 0
  const after = exchangeFish(state, 'g1', 1000)
  assert.equal(after.stats.totalExchanged, 1)
  assert.ok(after.stats.totalScratchEarned >= before, '商会兑换会产出刮刮乐，累计值只能往上走')
})


// ─────────────────── 耐久对最大张力的修正 / 溢出维修 ───────────────────

test('guidePendingCard picks the focused step and honours the server countdown', async () => {
  const { guidePendingCard, syncGuideFocus, advanceGuide } = await import('../src/game.js')
  const seed = blankStats(createInitialState())
  // 新号：焦点在钓鱼页导览上，但那张卡由钓鱼页自己渲染，这里不应返回。
  const focused = syncGuideFocus(advanceGuide(seed, 1000).state, 1000)
  assert.equal(focused.guide.focus.tension.remaining, 3)
  assert.equal(guidePendingCard(focused, 1000), null, '钓鱼页导览不由通用说明卡渲染')
  // 跨到 L2（要发赠礼的那一步）：说明卡应指向 rodUpgrade，且倒计时起点是服务端时间戳
  const l2 = withProgress(focused, { stats: { totalCatches: 1, totalExchanged: 1 } })
  const stepped = syncGuideFocus(advanceGuide(l2, 5000).state, 5000)
  const card = guidePendingCard(stepped, 6000)
  assert.ok(card, '应有一张说明卡')
  assert.equal(card.stepId, 'rodUpgrade')
  assert.equal(card.expiresAt, 5000 + 3000, '3 秒从服务端时间戳起算')
  // 刷新（换一个新的 at）不会把倒计时起点改掉
  const refreshed = syncGuideFocus(stepped, 9000)
  assert.equal(refreshed.guide.focus.rodUpgrade.at, 5000, '刷新不能重置倒计时')
  // 已读之后不再返回
  const { markGuideSeen } = await import('../src/game.js')
  assert.equal(guidePendingCard(markGuideSeen(stepped, 'rodUpgrade', 5000), 6000), null)
})

test('every guided step carries copy so the card is never empty', async () => {
  const { normalizeGuideConfig, guideStepCopy, GUIDE_STEP_IDS } = await import('../src/game.js')
  const config = normalizeGuideConfig(createInitialState().config.guide)
  GUIDE_STEP_IDS.forEach((id) => {
    const copy = guideStepCopy(config, id)
    assert.ok(copy && copy.length > 10, `${id} 应有引导文案`)
  })
  assert.ok(guideStepCopy(config, 'rodGuide').length > 10)
  // 刮刮乐那一步必须说清它是材料的主要来源
  assert.match(guideStepCopy(config, 'scratch'), /材料的主要来源/)
})

test('admin edits to the copy table win over the builtin text', async () => {
  const { normalizeConfig, DEFAULT_CONFIG, guideStepCopy } = await import('../src/game.js')
  const base = normalizeConfig(DEFAULT_CONFIG)
  const edited = normalizeConfig({
    ...base,
    guide: { ...base.guide, copy: { ...base.guide.copy, tension: '后台改过的张力说明' } },
  })
  assert.equal(guideStepCopy(edited, 'tension'), '后台改过的张力说明')
  assert.equal(guideStepCopy(edited.guide, 'tension'), '后台改过的张力说明')
  // 单步覆盖优先于 copy 表
  const perStep = normalizeConfig({
    ...base,
    guide: { ...base.guide, steps: base.guide.steps.map((step) => step.id === 'tension' ? { ...step, copy: '单步覆盖' } : step) },
  })
  assert.equal(guideStepCopy(perStep, 'tension'), '单步覆盖')
})

test('guide config clamps dumb input and keeps the builtin order', async () => {
  const { normalizeGuideConfig } = await import('../src/game.js')
  const config = normalizeGuideConfig({
    enabled: true,
    minCloseMs: 999999,
    steps: [
      { id: 'fx', minSold: -5, grantCoins: -100 },
      { id: 'unknown-step', minCatches: 99 },
      { id: 'npc', minCatches: 'abc', requires: ['fx'] },
    ],
    copy: { tension: '自定义张力说明', bogus: 'nope' },
  })
  assert.equal(config.minCloseMs, 20000, 'minCloseMs 上限 20s')
  // 顺序固定为内置顺序
  assert.deepEqual(config.steps.slice(0, 3).map((step) => step.id), ['tension', 'npc', 'rodUpgrade'])
  const npc = config.steps.find((step) => step.id === 'npc')
  assert.equal(npc.minCatches, 0)
  // requires 不能指向更靠后的步骤（防环/防跳级）
  assert.deepEqual(npc.requires, [])
  const fx = config.steps.find((step) => step.id === 'fx')
  assert.equal(fx.minSold, 0)
  assert.equal(fx.grantCoins, 0)
  assert.equal(config.copy.tension, '自定义张力说明')
  assert.equal(config.copy.bogus, undefined)
})
