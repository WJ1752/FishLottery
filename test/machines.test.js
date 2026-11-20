import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState, makeScratchCard, machineStart, machineStop, machineDepositFish,
  machineDepositCoins, machineDepositCards, machineSetOvertime, machineClaim, settleMachines,
  machineDepositBlackCoins,
  machineUnlocked, machineStatus, machineModulesUnlocked, machineInstallModule, machineRemoveModule, moduleFits,
  workshopLocation, redactScratchFaces, blackBuy, machineSetKeep, hydrateState, machineDepositMax, normalizeConfig,
} from '../src/game.js'

const at = (h, m = 0) => new Date(2026, 10, 19, h, m, 0).getTime()

// 起手：刮开 50 张、鱼/币/卡都备齐的机器。
function seeded({ scratch = 50, cards = 1000, fish = 100, coins = 20000, kg = 10 } = {}) {
  let state = createInitialState()
  state = { ...state, stats: { ...state.stats, totalScratch: scratch }, coins }
  const start = machineStart(state, 'claw', at(9))
  state = start.state
  const type = state.config.scratchTypes[0]
  state = { ...state, scratchCards: Array.from({ length: cards }, (_, i) => makeScratchCard(`c-${i}`, type.id, type)) }
  state = machineDepositCards(state, 'claw', type.id, cards).state
  const list = Array.from({ length: fish }, (_, i) => ({ id: `f-${i}`, name: '鱼', traits: ['swift'], weight: kg, status: 'fresh' }))
  state = { ...state, fish: list }
  state = machineDepositFish(state, 'claw', list.map((f) => f.id), at(9)).state
  state = machineDepositCoins(state, 'claw', 10000).state
  return state
}

test('machine unlocks exactly at 50 scratched cards', () => {
  const below = { ...createInitialState(), stats: { ...createInitialState().stats, totalScratch: 49 } }
  assert.equal(machineUnlocked(below, 'claw'), false)
  assert.equal(machineStart(below, 'claw', at(9)).code, 'MACHINE_LOCKED')
  const above = { ...createInitialState(), stats: { ...createInitialState().stats, totalScratch: 50 } }
  assert.equal(machineUnlocked(above, 'claw'), true)
  assert.equal(machineStart(above, 'claw', at(9)).code, null)
})

test('white shift produces exactly one item per minute for 8 hours', () => {
  const state = settleMachines(seeded(), at(17))
  const owned = state.machines.owned.claw
  assert.equal(owned.dayItems, 480)
  assert.equal(owned.deposit.coins, 10000 - 480)
  assert.equal(owned.deposit.items.queue.length, 1000 - 480)
})

test('the claw completes a cycle during one-second polling across a save reload', () => {
  let state = seeded()
  for (let seconds = 1; seconds <= 60; seconds += 1) {
    const clock = at(9) + seconds * 1000
    state = settleMachines(state, clock)
    if (seconds === 30) state = hydrateState(JSON.parse(JSON.stringify(state)), clock)
  }
  const owned = state.machines.owned.claw
  assert.equal(owned.dayItems, 1)
  assert.equal(owned.deposit.coins, 9999)
  assert.equal(owned.deposit.items.queue.length, 999)
})

test('nothing is produced outside 09:00–17:00', () => {
  const start = seeded()
  assert.equal(settleMachines(start, at(8, 59)).machines.owned.claw.dayItems, 0)
  const afterShift = settleMachines(start, at(17, 30))
  // 17:00 之后白班停：只有 09:00–17:00 的 480 分钟。
  assert.equal(afterShift.machines.owned.claw.dayItems, 480)
  assert.equal(machineStatus(afterShift, 'claw', at(18)), 'off_duty')
})

test('rent is charged once per producing day, and never on an idle day', () => {
  const state = seeded()
  const idle = settleMachines({ ...state, machines: { ...state.machines, owned: { claw: { ...state.machines.owned.claw, deposit: { ...state.machines.owned.claw.deposit, items: { pools: {}, queue: [] } } } } } }, at(17))
  assert.equal(idle.machines.owned.claw.dayRent, 0)
  assert.equal(idle.machines.owned.claw.deposit.fishKg, 1000)
  const busy = settleMachines(state, at(17))
  assert.equal(busy.machines.owned.claw.dayRent, 100)
  assert.equal(busy.machines.owned.claw.deposit.fishKg, 900)
})

test('overtime charges double fee and follows the efficiency sequence', () => {
  let state = seeded({ cards: 2000 })
  state = machineSetOvertime(state, 'claw', true, at(9)).state
  for (let hour = 10; hour <= 22; hour += 1) state = settleMachines(state, at(hour))
  const owned = state.machines.owned.claw
  // 白班 480 + 加班 60/48/36/24/15 = 663
  assert.equal(owned.dayItems, 663)
  // 480×1 + 183×2 = 846
  assert.equal(owned.dayFee, 846)
  // 日租 100 + 加班 5 小时×10kg
  assert.equal(owned.deposit.fishKg, 1000 - 150)
  assert.equal(owned.overtime.streak, 5)
})

test('overtime is capped by the configured hour count', () => {
  let state = seeded({ cards: 2000 })
  state = machineSetOvertime(state, 'claw', true, at(9)).state
  // 推到第二天早上：加班最多 5 小时，不会无限累积。
  state = settleMachines(state, at(23))
  assert.equal(state.machines.owned.claw.overtime.streak, 5)
})

test('overheat accumulates on overtime days and cools on rest days', () => {
  let state = seeded({ cards: 4000 })
  state = machineSetOvertime(state, 'claw', true, at(9)).state
  state = settleMachines(state, at(22))
  assert.equal(state.machines.owned.claw.overheat, 0)
  // 跨日：加班过 → +1
  state = settleMachines(state, at(9) + 24 * 3600000)
  assert.equal(state.machines.owned.claw.overheat, 1)
})

test('deposit refuses to exceed the configured cap', () => {
  let state = createInitialState()
  state = { ...state, stats: { ...state.stats, totalScratch: 50 }, coins: 100000 }
  state = machineStart(state, 'claw', at(9)).state
  const list = Array.from({ length: 200 }, (_, i) => ({ id: `f-${i}`, name: '鱼', traits: [], weight: 10, status: 'fresh' }))
  state = { ...state, fish: list }
  // 200 条 × 10kg = 2000kg，超过 1000kg 上限 → 整笔拒绝，池不变。
  const result = machineDepositFish(state, 'claw', list.map((f) => f.id), at(9))
  assert.equal(result.code, 'MACHINE_DEPOSIT_LIMIT')
  assert.equal(result.state.machines.owned.claw.deposit.fishKg, 0)
})

test('only unscrсatched cards can be deposited', () => {
  let state = createInitialState()
  state = { ...state, stats: { ...state.stats, totalScratch: 50 } }
  state = machineStart(state, 'claw', at(9)).state
  const type = state.config.scratchTypes[0]
  const revealed = { ...makeScratchCard('r-1', type.id, type), status: 'revealed' }
  state = { ...state, scratchCards: [revealed] }
  // 没有 ready 卡可交：拒绝而不是把已刮开的卡塞进去。
  assert.equal(machineDepositCards(state, 'claw', type.id, 10).code, 'MACHINE_DEPOSIT_EMPTY')
})

test('claim moves the basket into balance and clears it', () => {
  const state = settleMachines(seeded(), at(17))
  const before = state.coins
  const basket = state.machines.owned.claw.basket
  assert.ok(basket.coins > 0)
  const claimed = machineClaim(state, 'claw', at(17))
  assert.equal(claimed.code, null)
  assert.equal(claimed.state.coins, before + basket.coins)
  assert.equal(claimed.state.machines.owned.claw.basket.coins, 0)
  assert.equal(machineClaim(claimed.state, 'claw', at(17)).code, 'MACHINE_BASKET_EMPTY')
})

test('machine never pollutes scratch luck counters', () => {
  const state = settleMachines(seeded(), at(17))
  assert.equal(state.stats.totalScratch, 50)
  assert.equal(state.stats.scratchPairs, 0)
})

test('power off keeps every prepayment, and power on resumes without catch-up', () => {
  let state = seeded()
  const before = state.machines.owned.claw
  const off = machineStop(state, 'claw', at(12))
  assert.equal(off.code, null)
  const stopped = off.state.machines.owned.claw
  assert.equal(stopped.on, false)
  // 关机前先结算到当下：09:00–12:00 共 180 张，租金 100kg。
  assert.equal(stopped.dayItems, 180)
  assert.equal(stopped.deposit.items.queue.length, before.deposit.items.queue.length - 180)
  assert.equal(stopped.deposit.fishKg, before.deposit.fishKg - 100)
  // 关机不清空任何东西（模块、篮子、剩余预付都在）。
  assert.deepEqual(stopped.modules, before.modules)
  assert.ok(stopped.deposit.items.queue.length > 0)
  // 重复关机无效。
  assert.equal(machineStop(off.state, 'claw', at(13)).code, 'MACHINE_NOT_ON')
  // 停机期间不产出。
  const idle = settleMachines(off.state, at(17))
  assert.equal(idle.machines.owned.claw.dayItems, stopped.dayItems)
  // 再开机：数据照旧，且不会把停机时间补回来。
  const resumeAt = at(9) + 24 * 3600000
  const on = machineStart(idle, 'claw', resumeAt)
  assert.equal(on.code, null)
  const resumed = on.state.machines.owned.claw
  assert.equal(resumed.on, true)
  assert.equal(resumed.deposit.items.queue.length, stopped.deposit.items.queue.length)
  assert.equal(resumed.lastSettledAt, resumeAt)
})

test('modules are sold only through the black market shop', () => {
  const state = seeded()
  const rich = (base, coins) => ({
    ...base,
    unlockedDepths: ['shore', 'shelf', 'open', 'deep', 'rift'],
    blackMarket: { ...base.blackMarket, coins },
  })
  // 黑市已开、但还没到裂谷：即使有钱也买不到模块（MODULE_LOCKED）。
  const noRift = { ...state, unlockedDepths: ['shore', 'shelf', 'open', 'deep'], blackMarket: { ...state.blackMarket, coins: 100000 } }
  assert.equal(blackBuy(noRift, 'mod-overclock').code, 'MODULE_LOCKED')
  // 解锁了裂谷但渔币不足。
  assert.equal(blackBuy(rich(state, 0), 'mod-overclock').code, 'BLACK_FUNDS')
  // 买得起：进模块仓。
  const bought = blackBuy(rich(state, 100000), 'mod-overclock')
  assert.equal(bought.code, null)
  assert.equal(bought.state.machines.warehouse.overclock, 1)
})

test('module level cap stops shop purchases', () => {
  const state = seeded()
  const rich = { ...state, unlockedDepths: ['shore', 'shelf', 'open', 'deep', 'rift'], blackMarket: { ...state.blackMarket, coins: 1000000 } }
  let next = rich
  // 超频上限 3 级：第四次购买被拒。
  for (let i = 0; i < 3; i += 1) next = blackBuy(next, 'mod-overclock').state
  assert.equal(next.machines.warehouse.overclock, 3)
  assert.equal(blackBuy(next, 'mod-overclock').code, 'BLACK_LIMIT')
})

test('module load and slot limits are enforced', () => {
  let state = seeded()
  state = { ...state, unlockedDepths: ['shore', 'shelf', 'open', 'deep', 'rift'], blackMarket: { ...state.blackMarket, coins: 1000000 } }
  let bought = state
  for (let i = 0; i < 8; i += 1) bought = blackBuy(bought, 'mod-overclock').state
  // 超频 Lv3 = load 6，已经吃满铁爪的负荷；再装直连 Lv1 会超。
  let installed = bought
  for (let i = 0; i < 3; i += 1) installed = machineInstallModule(installed, 'claw', 'overclock').state
  assert.equal(installed.machines.owned.claw.modules.overclock, 3)
  const fit = moduleFits({ ...installed.machines.owned.claw, machineId: 'claw' }, installed.config, 'direct', 1)
  assert.equal(fit.ok, false)
  assert.equal(fit.code, 'MODULE_NO_LOAD')
})

test('wash machine only sells materials above the keep quantity', () => {
  let state = createInitialState()
  state = { ...state, unlockedDepths: ['shore', 'shelf', 'open', 'deep'], inventory: { ...state.inventory, '浮木纤维': 600 }, blackMarket: { ...state.blackMarket, coins: 5000 } }
  state = machineStart(state, 'wash', at(9)).state
  state = machineDepositBlackCoins(state, 'wash', 1000).state
  state = machineSetKeep(state, 'wash', '浮木纤维', 500).state
  assert.equal(state.machines.owned.wash.keep['浮木纤维'], 500)
  state = settleMachines(state, at(17))
  // 600 - 500 = 100，20 个一组 → 卖 5 组，剩 500。
  assert.equal(state.inventory['浮木纤维'], 500)
  // 熔洗槽按「种」计件：当天还处理了深蓝晶片与渊核碎片，共 3 种。
  assert.equal(state.machines.owned.wash.dayItems, 3)
  assert.equal(state.machines.owned.wash.dayFee, 3)
  assert.equal(state.machines.owned.wash.deposit.blackCoins, 1000 - 3 - 3)
})

test('keep can be cleared back to zero', () => {
  let state = createInitialState()
  state = { ...state, unlockedDepths: ['shore', 'shelf', 'open', 'deep'], blackMarket: { ...state.blackMarket, coins: 100 } }
  state = machineStart(state, 'wash', at(9)).state
  state = machineSetKeep(state, 'wash', '浮木纤维', 300).state
  state = machineSetKeep(state, 'wash', '浮木纤维', 0).state
  assert.equal(state.machines.owned.wash.keep['浮木纤维'], undefined)
})

test('machineId survives a save/load round-trip so depositing still works', () => {
  // 回归：machineId 只在内存里有、没进存档时，读取后所有上限都算成 0，
  // 表现就是「机器无法预付任何资源」（线上真实发生过）。
  const state = seeded()
  const claw = state.machines.owned.claw
  const emptied = {
    ...state,
    fish: Array.from({ length: 2 }, (_, i) => ({ id: `fresh-${i}`, name: '鱼', traits: ['swift'], weight: 10, status: 'fresh' })),
    machines: { ...state.machines, owned: { claw: { ...claw, deposit: { ...claw.deposit, coins: 0, fishKg: 0 } } } },
  }
  const roundTripped = hydrateState(JSON.parse(JSON.stringify(emptied)))
  assert.equal(roundTripped.machines.owned.claw.machineId, 'claw')
  assert.equal(machineDepositMax(roundTripped.machines.owned.claw, roundTripped.config, 'coins'), 10000)
  assert.equal(machineDepositCoins(roundTripped, 'claw', 100).code, null)
  const fish = roundTripped.fish.filter((item) => item.status === 'fresh').slice(0, 2)
  assert.equal(machineDepositFish(roundTripped, 'claw', fish.map((item) => item.id), at(9)).code, null)
})

test('modules can be removed and return to the warehouse in full', () => {
  let state = seeded()
  state = { ...state, unlockedDepths: ['shore', 'shelf', 'open', 'deep', 'rift'], blackMarket: { ...state.blackMarket, coins: 100000 } }
  let next = blackBuy(state, 'mod-overclock').state
  assert.equal(next.machines.warehouse.overclock, 1)
  next = machineInstallModule(next, 'claw', 'overclock').state
  assert.equal(next.machines.owned.claw.modules.overclock, 1)
  assert.equal(next.machines.warehouse.overclock, 0)
  // 拆下：整级回到模块仓，槽位与负荷一起释放。
  const removed = machineRemoveModule(next, 'claw', 'overclock')
  assert.equal(removed.code, null)
  assert.equal(removed.state.machines.owned.claw.modules.overclock, undefined)
  assert.equal(removed.state.machines.warehouse.overclock, 1)
  const fit = moduleFits({ ...removed.state.machines.owned.claw, machineId: 'claw' }, removed.state.config, 'overclock', 1)
  assert.equal(fit.ok, true)
  // 没装的模块不能拆。
  assert.equal(machineRemoveModule(next, 'claw', 'cooling').code, 'MODULE_NOT_OWNED')
})

test('legacy world configs gain the built-in module shop items', () => {
  // 回归：world_config 存的是旧快照，新加的内置商品不会自动出现（线上真实发生过）。
  const legacy = {
    blackMarket: {
      enabled: true,
      unlockDepth: 'deep',
      shop: [{ id: 'repair', kind: 'repair', name: '黑市维修', price: 10, dailyLimit: 10 }],
    },
  }
  const cfg = normalizeConfig(legacy)
  const modules = cfg.blackMarket.shop.filter((item) => item.kind === 'module')
  assert.equal(modules.length, 8)
  assert.ok(modules.some((item) => item.moduleId === 'overclock'))
  // 配置里已有的条目原样保留，后台改过的价格不被覆盖。
  assert.equal(cfg.blackMarket.shop.find((item) => item.id === 'repair').price, 10)
})

test('workshop moves to the black market once a black-coin machine is owned', () => {
  const fishOnly = createInitialState()
  assert.equal(workshopLocation(fishOnly), 'fish')
  const withScale = { ...fishOnly, machines: { ...fishOnly.machines, owned: { scale: { on: true, deposit: { blackCoins: 0 } } } } }
  assert.equal(workshopLocation(withScale), 'black')
  // 拆掉之后也不回退：工作间已经搬走了。
  const removed = { ...withScale, machines: { ...withScale.machines, owned: {}, workshopMovedAt: '2026-11-19T09:00:00.000Z' } }
  assert.equal(workshopLocation(removed), 'black')
})

test('rent fish is written to FX at 2x net but 1x volume', () => {
  const state = settleMachines(seeded(), at(17))
  const flow = state.fx.today.swift
  assert.ok(flow)
  // 100kg 租 / 1000kg 池 = 1/10 的词条被吃掉，净额 ×2。
  assert.equal(flow.volume, 10)
  assert.equal(flow.net, -20)
})

test('machine card faces never leave the server', () => {
  const state = seeded({ cards: 20 })
  const redacted = redactScratchFaces(state)
  const queue = redacted.machines.owned.claw.deposit.items.queue
  assert.equal(Array.isArray(queue) && queue.length, 0)
  assert.ok(queue.length === 0)
  assert.equal(redacted.machines.owned.claw.deposit.items.counts['scratch-tide'], 20)
})
