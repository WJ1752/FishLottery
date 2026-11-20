import {
  blackAcknowledge, blackBuy, blackOwnsTheme, blackRefreshOrder, blackSellFish, blackSellMaterial,
  blackSuperPlan, blackSuperReveal,
  chooseLotteryBatch, claimAll, claimAllScratch, claimScratch, depthsFor, discardRevealedScratch,
  advanceDepthSurveys, advanceGuide, claimDailyContract, exchangeFish, exchangeFishBatch, exchangeFishBatchByFilter, fxBuy, fxSell, guideTabVisible, markGuideSeen, normalizeSettings, repairRod, revealScratch,
  machineClaim, machineDepositBlackCoins, machineDepositCards, machineDepositCoins,
  machineDepositFish, machineInstallModule, machineOrderCancel, machineOrderPlace, machineRemoveModule, machineSetKeep, machineSetOvertime, machineStart, machineStop,
  selectRod, skipGuide, syncGuideFocus, toggleFishing, unlockDepth, upgradeRod, upgradeWarehouse,
} from '../src/game.js'
import { HttpError, badRequest } from './http-util.js'
import { cryptoRandom, randomId } from './lib/rng.js'
import { now } from './lib/clock.js'
import { appendFlow, diffFlows } from './services/market.js'
import { batchEnd, batchIdAt, batchNumbers, batchRules, batchStart, registerBatch } from './services/lottery.js'

// 动作白名单：浏览器只能提交这里列出的意图，参数逐个校验。
//
// 每一项的签名是 (state, params, ctx) => state。
// 返回同一个 state 引用表示「没生效」（例如余额不足），路由层据此回 409，
// 而不是静默成功——前端才能把真实原因告诉玩家。

const int = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

const str = (value, max = 64) => String(value ?? '').slice(0, max)

const requireString = (value, field) => {
  const text = str(value)
  if (!text) throw badRequest('INVALID_ARGUMENT', `缺少参数 ${field}`)
  return text
}

// 黑市领域函数用 code 表达原因（不依赖 HTTP 层），这里翻译成玩家能看懂的提示。
const BLACK_ERROR_TEXT = {
  BLACK_LOCKED: '黑市尚未解锁',
  BLACK_QUOTA: '今日收购配额已用完',
  BLACK_INELIGIBLE: '没有符合条件的物品',
  BLACK_FUNDS: '渔币不足',
  BLACK_LIMIT: '已达购买或刷新上限',
  NO_EFFECT: '当前状态无需执行',
  SUPER_EMPTY: '请选择未刮开的刮刮乐',
  SUPER_TOO_MANY: '一次最多投入 200 张',
  SUPER_PENDING: '还有一张超级刮刮乐没有刮开',
  SUPER_UNSUPPORTED_CARD: '有卡片缺少可用的奖池快照，无法投入',
  SUPER_EMPTY_BASE: '这批卡没有可结算的奖励',
  SUPER_TOO_VOLATILE: '这批卡的奖励太偏，请多投几张或换组合',
  SUPER_NOT_READY: '没有等待结算的超级刮刮乐',
}

const blackFail = (code) => new HttpError(409, code, BLACK_ERROR_TEXT[code] || '操作未生效')

const MACHINE_ERROR_TEXT = {
  MACHINE_LOCKED: '机器还没解锁',
  MACHINE_ALREADY_ON: '这台机器已经开机了',
  MACHINE_NOT_ON: '这台机器还没开机',
  MACHINE_ORDER_INVALID: '请选择有效的标的、方向、整数限价和份数',
  MACHINE_ORDER_LIMIT: '已达到盯盘机的待处理委托上限',
  MACHINE_ORDER_MISSING: '该委托已成交、到期或撤销',
  MACHINE_DEPOSIT_LIMIT: '超过该机器的预付上限',
  MACHINE_DEPOSIT_EMPTY: '没有可交付的东西',
  MACHINE_CARD_NOT_READY: '只能交付未刮开的刮刮乐',
  MACHINE_UNSUPPORTED_CARD: '有卡片缺少奖池快照，无法交付',
  MACHINE_BASKET_EMPTY: '还没有可领取的产出',
  MACHINE_NO_FISH: '鱼池空了',
  MODULE_LOCKED: '模块功能尚未解锁（需解锁裂谷）',
  MODULE_NOT_OWNED: '模块不够或渔币不足',
  MODULE_NO_SLOT: '槽位或等级已达上限',
  MODULE_NO_LOAD: '负荷不足，装不下这个模块',
}

const machineFail = (code) => new HttpError(409, code, MACHINE_ERROR_TEXT[code] || '操作未生效')

const blackConfig = (state, ctx) => ctx.config || state.config

// 逐个解锁只锁页签：页签没解锁时直接拒绝，前端隐藏只是表现。
const assertTabUnlocked = (state, tabId) => {
  if (!guideTabVisible(state, tabId)) throw new HttpError(403, 'FEATURE_LOCKED', '该功能尚未解锁，先完成前面的引导')
}

const ACTIONS = {
  toggleFishing: (state) => toggleFishing(state, now()),

  selectDepth: (state, params) => {
    const depthId = requireString(params.depthId, 'depthId')
    if (!depthsFor(state).some((depth) => depth.id === depthId)) throw badRequest('DEPTH_LOCKED', '该海域尚未解锁')
    return { ...state, fishing: { ...state.fishing, selectedDepthId: depthId } }
  },

  unlockDepth: (state, params) => unlockDepth(state, requireString(params.depthId, 'depthId')),

  craftTickets: (state, params, ctx) => {
    assertTabUnlocked(state, 'lottery')
    const quantity = int(params.quantity ?? 1)
    const tier = requireString(params.tier, 'tier')
    const at = ctx.at ?? now()
    const batchId = batchIdAt(at)
    const pools = batchRules(ctx.db, batchId) || state.config.lotteryTypes
    if (quantity < 1 || !pools.some((type) => type.id === tier)) {
      throw badRequest('INVALID_ARGUMENT', '请选择有效的彩票奖池和数量')
    }
    if (batchNumbers(ctx.db, batchId)) throw new HttpError(409, 'LOTTERY_CLOSED', '本期已开奖，请等待下一期')
    const next = chooseLotteryBatch(state, quantity, tier, null, cryptoRandom, at, pools)
    if (next !== state) registerBatch(ctx.db, batchId, batchStart(at), batchEnd(at), pools)
    return next
  },

  claimTickets: (state) => { assertTabUnlocked(state, 'lottery'); return claimAll(state, now()) },

  revealScratch: (state, params, ctx) => { assertTabUnlocked(state, 'scratch'); return revealScratch(state, requireString(params.cardId, 'cardId'), cryptoRandom, ctx.at ?? now()) },

  claimScratch: (state, params) => { assertTabUnlocked(state, 'scratch'); return claimScratch(state, requireString(params.cardId, 'cardId'), now()) },

  claimAllScratch: (state) => { assertTabUnlocked(state, 'scratch'); return claimAllScratch(state, now()) },

  discardScratch: (state) => { assertTabUnlocked(state, 'scratch'); return discardRevealedScratch(state) },

  exchangeFish: (state, params, ctx) => { assertTabUnlocked(state, 'npc'); return exchangeFish(state, requireString(params.fishId, 'fishId'), ctx.at ?? now(), cryptoRandom) },

  exchangeFishBatch: (state, params, ctx) => {
    assertTabUnlocked(state, 'npc')
    // 一键兑换只收筛选范围：整仓库的 fishId 会撑爆请求体，截断又会导致「只兑换了一部分」。
    if (params.filter !== undefined) {
      return exchangeFishBatchByFilter(state, str(params.filter, 16) || '全部', ctx.at ?? now(), cryptoRandom)
    }
    // 兼容显式 id 列表，但不再静默截断：要么全部结算，要么报错。
    const ids = Array.isArray(params.fishIds) ? params.fishIds.map((id) => str(id, 80)).filter(Boolean) : []
    if (!ids.length) throw badRequest('INVALID_ARGUMENT', '请选择要兑换的鱼')
    return exchangeFishBatch(state, ids, ctx.at ?? now(), cryptoRandom)
  },

  claimDailyContract: (state, params, ctx) => {
    const result = claimDailyContract(state, requireString(params.contractId, 'contractId'), ctx.at ?? now())
    if (result.code === 'CONTRACT_CLAIMED') throw new HttpError(409, result.code, '今日这项委托奖励已领取')
    if (result.code === 'CONTRACT_INCOMPLETE') throw new HttpError(409, result.code, '请先完成今日这项航务委托')
    if (result.code) throw badRequest(result.code, '该航务委托已更新或不可用')
    return result.state
  },

  repairRod: (state, params, ctx) => repairRod(state, requireString(params.rodId, 'rodId'), undefined, ctx.at ?? now()),

  upgradeRod: (state, params) => upgradeRod(state, requireString(params.rodId, 'rodId'), requireString(params.upgradeId, 'upgradeId')),

  selectRod: (state, params, ctx) => selectRod(state, requireString(params.rodId, 'rodId'), ctx.at ?? now()),

  fxBuy: (state, params) => { assertTabUnlocked(state, 'fx'); return fxBuy(state, requireString(params.name, 'name'), Math.max(0, int(params.qty, 0)), now()) },

  fxSell: (state, params) => { assertTabUnlocked(state, 'fx'); return fxSell(state, requireString(params.name, 'name'), Math.max(0, int(params.qty, 0)), now()) },

  upgradeWarehouse: (state) => upgradeWarehouse(state),

  setTheme: (state, params, ctx) => {
    const theme = str(params.theme, 16)
    // 「无灯」是黑市商品：只靠前端隐藏不够，服务端也要校验购买记录。
    if (theme === 'void' && !blackOwnsTheme(state, 'void', blackConfig(state, ctx))) return state
    return { ...state, settings: normalizeSettings({ theme }) }
  },

  // ---- 逐个解锁 ----
  // 只锁页签：这些动作在对应页签未解锁时会被拒绝，避免手搓请求跳过引导。
  // 这两个动作是「标记已读」而非经济操作：重复调用必须返回成功（幂等），
  // 否则前端会因为 409 把「已读过」当成错误弹提示。
  guideSeen: (state, params) => {
    const stepId = str(params.stepId, 32)
    if (!stepId) throw badRequest('INVALID_ARGUMENT', '缺少参数 stepId')
    const next = markGuideSeen(state, stepId, now())
    return next === state ? { ...state, guide: { ...state.guide } } : next
  },

  guideSkip: (state) => {
    const next = skipGuide(state)
    return next === state ? { ...state, guide: { ...state.guide } } : next
  },

  // ---- 无灯黑市 ----
  // blackAcknowledge 是唯一不要求已解锁的动作：它只写 UI 标记，不解锁任何东西。
  blackAcknowledge: (state) => blackAcknowledge(state),

  blackSellFish: (state, params, ctx) => {
    const ids = Array.isArray(params.fishIds) ? params.fishIds.map((id) => str(id, 80)).filter(Boolean).slice(0, 100) : []
    if (!ids.length) throw badRequest('INVALID_ARGUMENT', '请选择要出售的鱼')
    const result = blackSellFish(state, ids, now(), blackConfig(state, ctx))
    if (result.code) throw blackFail(result.code)
    return result.state
  },

  blackSellMaterial: (state, params, ctx) => {
    const name = requireString(params.name, 'name')
    const units = Math.max(1, Math.min(1000, int(params.units, 1)))
    const result = blackSellMaterial(state, name, units, now(), blackConfig(state, ctx))
    if (result.code) throw blackFail(result.code)
    return result.state
  },

  blackRefreshOrder: (state, params, ctx) => {
    const result = blackRefreshOrder(state, blackConfig(state, ctx), cryptoRandom)
    if (result.code) throw blackFail(result.code)
    return result.state
  },

  blackSuperStart: (state, params, ctx) => {
    const ids = Array.isArray(params.cardIds) ? params.cardIds.map((id) => str(id, 80)).filter(Boolean).slice(0, 200) : []
    if (!ids.length) throw badRequest('INVALID_ARGUMENT', '请选择要投入的刮刮乐')
    const result = blackSuperPlan(state, ids, blackConfig(state, ctx), cryptoRandom)
    if (result.code) throw blackFail(result.code)
    return result.state
  },

  blackSuperReveal: (state, params, ctx) => {
    const result = blackSuperReveal(state, now(), blackConfig(state, ctx))
    if (result.code) throw blackFail(result.code)
    return result.state
  },

  blackBuy: (state, params, ctx) => {
    const result = blackBuy(state, requireString(params.itemId, 'itemId'), blackConfig(state, ctx), now(), cryptoRandom)
    if (result.code) throw blackFail(result.code)
    return result.state
  },

  // ---- 投币机器 ----
  // 结算不是动作：它挂在 syncPlayerLocked 上懒推进，玩家点完交付时响应里已经算完。

  machineStart: (state, params, ctx) => {
    const result = machineStart(state, requireString(params.machineId, 'machineId'), now(), blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineStop: (state, params, ctx) => {
    const result = machineStop(state, requireString(params.machineId, 'machineId'), now(), blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineOrderPlace: (state, params, ctx) => {
    const order = {
      id: randomId(12),
      name: str(params.name, 64),
      side: params.side,
      price: params.price,
      qty: params.qty,
    }
    const result = machineOrderPlace(state, order, ctx.at ?? now(), blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineOrderCancel: (state, params) => {
    const result = machineOrderCancel(state, requireString(params.orderId, 'orderId'))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineDepositFish: (state, params, ctx) => {
    const ids = Array.isArray(params.fishIds) ? params.fishIds.map((id) => str(id, 80)).filter(Boolean).slice(0, 500) : []
    if (!ids.length) throw badRequest('INVALID_ARGUMENT', '请选择要交付的鱼')
    const result = machineDepositFish(state, requireString(params.machineId, 'machineId'), ids, now(), blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineDepositCoins: (state, params, ctx) => {
    const amount = Math.max(1, int(params.amount, 0))
    const result = machineDepositCoins(state, requireString(params.machineId, 'machineId'), amount, blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineDepositBlackCoins: (state, params, ctx) => {
    const amount = Math.max(1, int(params.amount, 0))
    const result = machineDepositBlackCoins(state, requireString(params.machineId, 'machineId'), amount, blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineDepositCards: (state, params, ctx) => {
    const qty = Math.min(500, Math.max(1, int(params.qty, 0)))
    const result = machineDepositCards(state, requireString(params.machineId, 'machineId'), str(params.typeId, 64), qty, blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineSetKeep: (state, params, ctx) => {
    const result = machineSetKeep(state, requireString(params.machineId, 'machineId'), requireString(params.name, 'name'), int(params.qty, 0), blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineSetOvertime: (state, params, ctx) => {
    const result = machineSetOvertime(state, requireString(params.machineId, 'machineId'), Boolean(params.on), now(), blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineClaim: (state, params) => {
    const result = machineClaim(state, requireString(params.machineId, 'machineId'), now())
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineInstallModule: (state, params, ctx) => {
    const result = machineInstallModule(state, requireString(params.machineId, 'machineId'), requireString(params.moduleId, 'moduleId'), blackConfig(state, ctx))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  machineRemoveModule: (state, params) => {
    const result = machineRemoveModule(state, requireString(params.machineId, 'machineId'), requireString(params.moduleId, 'moduleId'))
    if (result.code) throw machineFail(result.code)
    return result.state
  },

  // 注意：重置进度不在这里。它需要「密码 + 邮箱验证码」两步，
  // 走 /api/auth/progress-reset/*，避免只拿到会话就能清空存档。
}

export const ACTION_NAMES = Object.keys(ACTIONS)

function claimReceipt(name, state, next) {
  const lottery = name === 'claimTickets'
  if (!lottery && name !== 'claimScratch' && name !== 'claimAllScratch') return null
  const before = lottery ? state.tickets : state.scratchCards
  const remainingIds = new Set((lottery ? next.tickets : next.scratchCards).map((item) => item.id))
  const claimed = before.filter((item) => !remainingIds.has(item.id))
  const rewards = new Map()
  for (const item of claimed) {
    const payouts = lottery ? item.rewards : item.payout ?? (item.reward ? [item.reward] : [])
    for (const reward of payouts || []) {
      const key = JSON.stringify([reward.type || reward.kind, reward.name, reward.rodId])
      const qty = Number(reward.qty) || 0
      rewards.set(key, { ...reward, qty: qty + (rewards.get(key)?.qty || 0) })
    }
  }
  return { count: claimed.length, rewards: [...rewards.values()] }
}

// 执行一个动作，返回 { state, applied, flows }。
// flows 是玩家动作引起的全服行情增量，由调用方合并进 fx_bucket。
export function applyAction(name, state, params = {}, ctx = {}) {
  const handler = ACTIONS[name]
  if (!Object.hasOwn(ACTIONS, name)) throw new HttpError(400, 'UNKNOWN_ACTION', `未知操作：${name}`)
  const before = state.fx?.today || {}
  const next = handler(state, params, ctx)
  if (!next || next === state) return { state, applied: false, flows: [] }
  // 动作本身可能刚好跨过一个解锁门槛（例如升了第一次天赋）。这里同步推进一次引导，
  // 让赠币/赠材料与页签在同一个响应里到位，不必等下一秒的 sync。
  const at = ctx.at ?? now()
  const guided = advanceGuide(advanceDepthSurveys(next), at)
  const focused = syncGuideFocus(guided.state, at)
  return { state: focused, applied: true, flows: diffFlows(before, focused.fx?.today || {}), receipt: claimReceipt(name, state, focused) }
}

export { appendFlow, batchStart, batchEnd, registerBatch, cryptoRandom }
