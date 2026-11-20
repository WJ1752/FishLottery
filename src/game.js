import { SAW_THRESHOLD_BASE, TENSION_DEFAULTS, TRAITS, aggregateTraitEffects, biteWeightFor, comboBiteChance, fishPoolFor, normalizeTrait, pickTraitsWeighted, rarityLabel, tensionAt, tensionFillMs } from './traits.js'
import { FX_GRAIN_BY_ID } from './fx-grains.js'

export { TRAITS }

// 服务端权威：浏览器不再持久化，前缀保留只为兼容旧存档迁移脚本。
export const STORAGE_KEY = 'deepwater-lottery-v1'
export const ENERGY_PER_CATCH = 10000
export const BASE_ENERGY_PER_SECOND = 1000
export const STATE_VERSION = 14
// 刮刮乐默认牌面格数：三格里出现任意一对相同奖励即可兑奖。
export const SCRATCH_DEFAULT_SLOTS = 3
export const SCRATCH_MIN_SLOTS = 2
export const SCRATCH_MAX_SLOTS = 10
// 彩票开奖面板默认展示的往期期数；后台可调。
export const LOTTERY_HISTORY_DEFAULT = 7
export const LOTTERY_HISTORY_MIN = 1
export const LOTTERY_HISTORY_MAX = 20
// 自动维修的结算间隔：避免一帧内把材料全烧光。
export const AUTO_REPAIR_COOLDOWN_MS = 8000
// 刮除半径（像素）：裸手基准值，天赋按百分比放大。
export const SCRATCH_BASE_RADIUS = 17


// 鱼类仓库：默认 1000，天赋每级 +100（10%），90 级封顶 10000。
export const WAREHOUSE_BASE_CAPACITY = 1000
export const WAREHOUSE_CAPACITY_STEP = 100
export const WAREHOUSE_MAX_CAPACITY = 10000

// 耐久对「最大张力」的修正：满耐久更敢拉，磨损后张力下限收紧。
// 80% 以上 = 1.2×；60% 及以下到 20% 线性降到 0.8×；20% 以下维持 0.8×。
export const DURABILITY_TENSION_CURVE = [
  { ratio: 0.8, factor: 1.2 },
  { ratio: 0.6, factor: 1 },
  { ratio: 0.2, factor: 0.8 },
]

// 给定耐久比例（0..1）返回最大张力修正系数。
export function durabilityTensionFactor(ratio) {
  const r = Number.isFinite(Number(ratio)) ? Math.max(0, Math.min(1, Number(ratio))) : 1
  const [{ ratio: highR, factor: highF }, { ratio: midR, factor: midF }, { ratio: lowR, factor: lowF }] = DURABILITY_TENSION_CURVE
  if (r >= highR) return highF
  if (r >= midR) return midF + (r - midR) / (highR - midR) * (highF - midF)
  if (r >= lowR) return lowF + (r - lowR) / (midR - lowR) * (midF - lowF)
  return lowF
}

export const COIN = { name: '鱼币', icon: '◉', color: '#c9a227' }
// 渔币：与鱼币同字形，紫色；只存在 blackMarket.coins，不进 state.coins。
export const BLACK_COIN = { name: '渔币', icon: '◉', color: '#a06bff' }

export const THEMES = [
  { id: 'dark', label: '黑', hint: '深色界面，默认' },
  { id: 'light', label: '白', hint: '浅色界面' },
  { id: 'void', label: '无灯', hint: '黑市限定' },
]
export const DEFAULT_THEME = 'dark'

export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const theme = THEMES.some((item) => item.id === source.theme) ? source.theme : DEFAULT_THEME
  return { theme }
}
export const ROD_BALANCE_REV = 2
// 耐久低于该值自动停钓（可手动继续）；耐久 <= 1 时彻底无法继续。
export const LOW_DURABILITY_THRESHOLD = 10
export const MIN_DURABILITY = 1
// 脱钩后停顿时间：进度清空、张力在这段时间里匀速退回 0。
export const RECOVERY_MS = 5000

// 海域不再由钓竿等级限制：花鱼币 + 锁钥材料永久解锁。
export const DEPTHS = [
  { id: 'shore', label: '河口', icon: '⌁', color: '#94a3b8', riskLabel: '低风险', minSpeed: 0, fishRate: 0.32, traitCount: [1, 2], value: 1, pressure: 1.22, unlock: null },
  { id: 'shelf', label: '港湾', icon: '◒', color: '#5eb5b7', riskLabel: '平稳', minSpeed: 0, fishRate: 0.25, traitCount: [2, 3], value: 1.4, pressure: 1.45, unlock: null },
  { id: 'open', label: '礁石', icon: '◉', color: '#478dba', riskLabel: '有风浪', minSpeed: 1, fishRate: 0.2, traitCount: [3, 4], value: 2.1, pressure: 1.79, unlock: { material: '潮汐锁钥', cost: 2, coins: 150 } },
  { id: 'deep', label: '海沟', icon: '◈', color: '#5266ac', riskLabel: '高风险', minSpeed: 2, fishRate: 0.15, traitCount: [4, 5], value: 3.3, pressure: 2.29, unlock: { material: '潮汐锁钥', cost: 5, coins: 420 } },
  { id: 'rift', label: '裂谷', icon: '◇', color: '#6655a7', riskLabel: '极高风险', minSpeed: 3, fishRate: 0.11, traitCount: [5, 6], value: 4.2, pressure: 2.32, unlock: { material: '深渊锁钥', cost: 2, coins: 900 } },
  { id: 'abyss', label: '深渊', icon: '✦', color: '#7d5ca8', riskLabel: '深渊风险', minSpeed: 4, fishRate: 0.08, traitCount: [5, 6], value: 5.2, pressure: 2.96, unlock: { material: '深渊锁钥', cost: 5, coins: 1800 } },
]

export const STARTING_DEPTHS = ['shore', 'shelf']

// 词条没有任何「起始海域」限制：每个海域刷哪些词条、权重多少，完全由后台海域权重表决定。
// defaultTraitWeights 只负责给「还没配过」的词条一个中性默认值（1 = 正常参与抽取）。
export function defaultTraitWeights(traits = TRAITS) {
  return DEPTHS.reduce((map, depth) => ({
    ...map,
    [depth.id]: Object.fromEntries((traits || []).map((trait) => [trait.id, 1])),
  }), {})
}

// 新配置的初始权重表：浅海只刷基础词条，越深词条越全、权重越高。
// 这只是一份初始值，后台「海域」页可以任意修改；词条本身不再带起始海域。
export const DEFAULT_DEPTH_TRAIT_WEIGHTS = {
  shore: { swift: 1, armored: 1, luminous: 1, heavy: 0, ancient: 0, surge: 0, abyssal: 0, prismatic: 0 },
  shelf: { swift: 2, armored: 2, luminous: 2, heavy: 1, ancient: 0, surge: 0, abyssal: 0, prismatic: 0 },
  open: { swift: 3, armored: 3, luminous: 3, heavy: 2, ancient: 1, surge: 1, abyssal: 0, prismatic: 0 },
  deep: { swift: 4, armored: 4, luminous: 4, heavy: 3, ancient: 2, surge: 2, abyssal: 1, prismatic: 0 },
  rift: { swift: 5, armored: 5, luminous: 5, heavy: 4, ancient: 3, surge: 3, abyssal: 2, prismatic: 1 },
  abyss: { swift: 6, armored: 6, luminous: 6, heavy: 5, ancient: 4, surge: 4, abyssal: 3, prismatic: 2 },
}

export const DEPTH_TRAIT_WEIGHTS = DEFAULT_DEPTH_TRAIT_WEIGHTS

// 张力曲线按竿配置，数值由三档目标成功率反推：
// 张力曲线按竿配置：maxRate 越低越安全。
// 词条的脱钩张力预设全部小于 1，整体难度比旧版更高，因此三把竿的
// 基础张力与「最大张力」升级同步上调，维持既定的成功率区间。
const STARTER_TENSION = { ...TENSION_DEFAULTS, maxTension: 1200, maxRate: 87.5 }
const ADVANCED_TENSION = { ...TENSION_DEFAULTS, maxTension: 1380, maxRate: 134 }
const ABYSS_TENSION = { ...TENSION_DEFAULTS, maxTension: 1450, maxRate: 82 }

export const RODS = [
  { id: 'tide', name: '潮痕 · 初阶', rarity: '普通', color: '#91a7b7', maxDurability: 1000, durability: 1000, resistance: 0.08, energyPerSecond: 1000, maxDepth: 0, breakable: false, tension: STARTER_TENSION, text: '轻盈的入门钓竿，适合河口巡游。' },
  { id: 'azure', name: '苍蓝 · 进阶', rarity: '稀有', color: '#4c90a7', maxDurability: 1500, durability: 1500, resistance: 0.18, energyPerSecond: 2000, maxDepth: 2, breakable: true, tension: ADVANCED_TENSION, text: '以深海蓝晶加固，能承受礁石海域拉力。' },
  { id: 'abyss', name: '无光 · 深渊', rarity: '史诗', color: '#7258a3', maxDurability: 2000, durability: 2000, resistance: 0.33, energyPerSecond: 2000, maxDepth: 5, breakable: true, tension: ABYSS_TENSION, text: '从深渊带回的黑曜竿，安静而危险。' },
  // 黑市限定：只通过渔币购买，不进初始钓竿列表。
  { id: 'shadow', name: '无灯 · 黑市', rarity: '史诗', color: '#a06bff', maxDurability: 2200, durability: 2200, resistance: 0.36, energyPerSecond: 2300, maxDepth: 5, breakable: true, tension: ABYSS_TENSION, text: '没有灯，也没有名字；竿身像一段被削薄的夜。' },
]

export const MATERIALS = {
  '浮木纤维': { tier: '低阶', icon: '✳', color: '#c58a57', description: '基础速度强化材料' },
  '潮汐树脂': { tier: '低阶', icon: '●', color: '#61aab1', description: '基础速度强化材料' },
  '深蓝晶片': { tier: '进阶', icon: '◆', color: '#4a8ec0', description: '耐久修复 / 抗损耗' },
  '渊核碎片': { tier: '进阶', icon: '✦', color: '#7657a7', description: '最大耐久 / 抗损耗' },
  '旧日合金': { tier: '进阶', icon: '⬡', color: '#9b8062', description: '深渊钓竿锻造' },
  '潮汐锁钥': { tier: '进阶', icon: '⚿', color: '#3f9fb0', description: '解锁礁石 / 海沟' },
  '深渊锁钥': { tier: '大师', icon: '⚷', color: '#c9a227', description: '解锁裂谷 / 深渊' },
}

// 深海FX 标的：词条。
// 选词条而不是材料，是因为材料的产出来自奖池权重，玩家无法干预，日波动是纯抽样噪声；
// 词条的供给由「海域 × 词条权重表」决定，玩家换海域就能改变供给结构，
// 行情才有可读的基本面，也才有主动交易的空间。
// price 是基准价（也是均值回归的锚），sensitivity 是该词条对超预期的敏感度：
// 越稀有的词条供给越薄，同样程度的超预期推动更大的涨跌幅。
const DEFAULT_FX_TRAITS = {
  swift: { price: 30, sensitivity: 0.9 },
  armored: { price: 34, sensitivity: 0.9 },
  luminous: { price: 40, sensitivity: 1 },
  heavy: { price: 52, sensitivity: 1.05 },
  ancient: { price: 72, sensitivity: 1.1 },
  surge: { price: 88, sensitivity: 1.15 },
  abyssal: { price: 120, sensitivity: 1.25 },
  prismatic: { price: 165, sensitivity: 1.4 },
}

// 词条按 id 建索引：FX 的标的、存档 key、界面显示都用 id。
const TRAITS_BY_ID = TRAITS.reduce((map, trait) => ({ ...map, [trait.id]: trait }), {})

// 命中 0 或 1 个号码只赔鱼币：彩票是升级 / 解锁的主要货币来源。
const coinReward = (qty) => [{ type: 'coin', name: '鱼币', qty }]

const NORMAL_PRIZE_TABLE = [
  coinReward(5),
  coinReward(12),
  [{ type: 'material', name: '浮木纤维', qty: 5 }],
  [{ type: 'material', name: '深蓝晶片', qty: 1 }],
  [{ type: 'material', name: '深蓝晶片', qty: 2 }],
  [{ type: 'material', name: '渊核碎片', qty: 1 }],
  [{ type: 'rod', name: '苍蓝 · 进阶', qty: 1 }],
]

const ADVANCED_PRIZE_TABLE = [
  coinReward(15),
  coinReward(35),
  [{ type: 'material', name: '深蓝晶片', qty: 3 }],
  [{ type: 'material', name: '渊核碎片', qty: 1 }, { type: 'material', name: '潮汐锁钥', qty: 1 }],
  [{ type: 'material', name: '渊核碎片', qty: 2 }, { type: 'material', name: '潮汐锁钥', qty: 2 }],
  [{ type: 'material', name: '旧日合金', qty: 1 }, { type: 'material', name: '潮汐锁钥', qty: 3 }],
  [{ type: 'rod', name: '无光 · 深渊', qty: 1 }, { type: 'material', name: '潮汐锁钥', qty: 4 }],
]

const MASTER_PRIZE_TABLE = [
  coinReward(40),
  coinReward(90),
  [{ type: 'material', name: '深渊锁钥', qty: 1 }],
  [{ type: 'material', name: '深渊锁钥', qty: 2 }, { type: 'material', name: '旧日合金', qty: 1 }],
  [{ type: 'material', name: '深渊锁钥', qty: 3 }, { type: 'material', name: '渊核碎片', qty: 3 }],
  [{ type: 'material', name: '深渊锁钥', qty: 5 }, { type: 'material', name: '旧日合金', qty: 2 }],
  [{ type: 'rod', name: '无光 · 深渊', qty: 1 }, { type: 'material', name: '深渊锁钥', qty: 6 }],
]

export const DEFAULT_CONFIG = {
  tension: { ...TENSION_DEFAULTS },
  traits: TRAITS.map((trait) => normalizeTrait(trait)),
  depthTraitWeights: DEFAULT_DEPTH_TRAIT_WEIGHTS,
  // 深海FX：每个材料一支标的，只做鱼币进出，不产材料。
  // 日线结算：每天零点把「昨天 24h 的刮刮乐 / 彩票净流入」结算成一根日线，当天价格不动。
  fx: {
    // 日线长度（一天）。结算按 UTC+8 的零点切分。
    dayMs: 24 * 60 * 60 * 1000,
    // 波动系数：1 个标准差 = 多少涨跌幅。0.04 表示「今天运气偏离 1 个标准差」涨跌 4%。
    volatility: 0.04,
    // 均值回归：每天把「当前价相对基准价的偏离」拉回多少。
    // 不设涨跌停，所以必须靠它兜底，否则价格是纯随机游走会漂到 0 或无穷。
    reversion: 0.05,
    // 单边手续费（买入和卖出各收一次），往返成本 = 2 × feeRate。
    feeRate: 0.02,
    // 买卖价差：买价在中间价上浮 spread/2，卖价下浮 spread/2。
    spread: 0.02,
    // 单材料持仓上限：防止把 FX 当成无限仓库。
    maxPosition: 200,
    // 保留多少个交易日的历史，供回看。
    historyDays: 7,
    // 单日涨跌停：即使期望模型或出货冲击异常，一天也不会超过这个幅度。
    dailyLimit: 0.1,
    // 交易时段：本地时间 08:00 开市、24:00 收市，零点到开盘留给结算计算。
    openHour: 8,
    closeHour: 24,
    traits: { ...DEFAULT_FX_TRAITS },
  },
  scratchTypes: [
    {
      id: 'scratch-tide', name: '潮汐刮刮乐', cardColor: '#f4fffc', coatColor: '#2f6f76', note: '低阶材料', slots: 3,
      prizes: [
        { id: 'prize-wood', kind: 'material', name: '浮木纤维', qty: 3, weight: 28 },
        { id: 'prize-resin', kind: 'material', name: '潮汐树脂', qty: 3, weight: 28 },
        { id: 'prize-coin', kind: 'coin', name: '鱼币', qty: 10, weight: 24 },
        { id: 'prize-crystal', kind: 'material', name: '深蓝晶片', qty: 1, weight: 20 },
      ],
    },
  ],
  // 刮层直觉：每刮 perLevels 次，两个技能各升一档（静默，不显示）。
  scratchLuck: { perLevels: 10, maxLevel: 20, thresholdBase: 0.45, thresholdStep: -0.0045, radiusBase: SCRATCH_BASE_RADIUS, radiusStep: SCRATCH_BASE_RADIUS * 0.01 },
  // 仓库扩容：纯鱼币升级，入口在潮汐商会右上角的仓库文本旁。
  // 1000 容量起步，每级 +100（+10%），90 级到 10000。
  warehouse: { base: WAREHOUSE_BASE_CAPACITY, step: WAREHOUSE_CAPACITY_STEP, maxLevel: 90, coins: 150, growth: 1 },
  lotteryHistory: LOTTERY_HISTORY_DEFAULT,
  lotteryTypes: [
    { id: 'normal', name: '普通场', min: 0, max: 30, pick: 6, ticketCost: 3, cardColor: '#f4faf9', accentColor: '#247b82', note: '低阶材料 · 普通钓竿', prizes: NORMAL_PRIZE_TABLE },
    { id: 'advanced', name: '高级场', min: 31, max: 99, pick: 6, ticketCost: 6, cardColor: '#f6f4fb', accentColor: '#7258a3', note: '进阶材料 · 潮汐锁钥', prizes: ADVANCED_PRIZE_TABLE },
    { id: 'master', name: '大师场', min: 100, max: 199, pick: 6, ticketCost: 10, cardColor: '#fbf6e6', accentColor: '#c9a227', note: '深渊锁钥 · 顶级钓竿', prizes: MASTER_PRIZE_TABLE },
  ],
  rods: RODS.map((rod) => ({
    ...rod,
    energyPerCatch: ENERGY_PER_CATCH,
    tension: { ...(rod.tension || TENSION_DEFAULTS) },
    repair: { material: '深蓝晶片', amount: 50, cost: 1 },
    upgrades: [
      { id: 'speed', label: '钓鱼速度', stat: 'energyPerSecond', amount: 1, coins: 60, growth: 1, material: '浮木纤维', cost: 3, secondMaterial: '潮汐树脂', secondCost: 2, maxLevel: 99 },
      { id: 'durability', label: '最大耐久', stat: 'maxDurability', amount: 50, coins: 120, growth: 1, material: '渊核碎片', cost: 1, maxLevel: 99 },
      { id: 'tension', label: '最大张力', stat: 'maxTension', amount: 15, coins: 150, growth: 1, material: '渊核碎片', cost: 1, secondMaterial: '深蓝晶片', secondCost: 1, maxLevel: 99 },
      // 自动维修：每根竿独立升级（换竿要重新升）。0 级 = 未开启。
      // 阈值 = thresholdBase + (等级 - 1) × thresholdStep + thresholdStep，即 1 级就有 20 点。
      { id: 'autoRepair', label: '自动维修', stat: 'autoRepair', kind: 'autoRepair', thresholdBase: 10, thresholdStep: 10, restoreBase: 0.9, coins: 120, growth: 1, material: '深蓝晶片', cost: 1, maxLevel: 8 },
    ],
  })),
  quotes: {
    traitQuotes: TRAITS.reduce((map, trait, index) => ({ ...map, [trait.id]: 6 + index * 2 }), {}),
    combos: [
      { id: 'combo-abyss-armor', name: '渊印重甲', traits: ['abyssal', 'armored'], price: 14 },
      { id: 'combo-glow-prism', name: '辉光棱彩', traits: ['luminous', 'prismatic'], price: 16 },
      { id: 'combo-deep-mark', name: '深海三印', traits: ['abyssal', 'armored', 'luminous'], price: 32 },
    ],
    tiers: [
      { id: 'tier-1', min: 0, max: 19, tickets: { qty: 0 }, scratch: { typeId: 'scratch-tide', qty: 1 } },
      { id: 'tier-2', min: 20, max: 39, tickets: { qty: 1 }, scratch: { typeId: 'scratch-tide', qty: 1 } },
      { id: 'tier-3', min: 40, max: 59, tickets: { qty: 2 }, scratch: { typeId: 'scratch-tide', qty: 1 } },
      { id: 'tier-4', min: 60, max: null, tickets: { qty: 3 }, scratch: { typeId: 'scratch-tide', qty: 2 } },
    ],
  },
  // 无灯黑市：第二套经济。配置全部可后台调；代码只保留公式。
  blackMarket: {
    enabled: true,
    unlockDepth: 'deep',
    fish: {
      traitBonus: 1,
      dailyQuota: 40,
      quotaStep: 10,
      quotaMaxBuys: 6,
      quotaPrice: 500,
      quotaPriceGrowth: 150,
      scaleBonus: 0.1,
    },
    order: {
      targetAcceptance: 0.25,
      acceptanceMin: 0.12,
      acceptanceMax: 0.45,
      refreshCost: 25,
      refreshLimit: 3,
      demandCount: 1,
      banCount: 2,
    },
    materials: {
      '浮木纤维': { per: 20, coins: 1 },
      '潮汐树脂': { per: 20, coins: 1 },
      '深蓝晶片': { per: 5, coins: 1 },
      '渊核碎片': { per: 2, coins: 1 },
      '旧日合金': { per: 1, coins: 2 },
    },
    super: {
      enabled: true,
      slots: 9,
      need: 2,
      minInput: 1,
      maxInput: 200,
      sensitivity: 1.2,
      heatMin: 0.25,
      heatMax: 4,
      baseline: 0.05,
      fPower: 2,
      fMax: 10,
      targetEv: 0.975,
      evMin: 0.95,
      evMax: 1,
      calibrationSafety: 0.98,
      calibrationMode: 'auto',
      simSamples: 10000,
      simSamplesExtreme: 50000,
      valueOverrides: { '潮汐锁钥': 3, '深渊锁钥': 8 },
      unknownValue: 0.05,
    },
    shop: [
      { id: 'rod-shadow', kind: 'rod', name: '无灯 · 黑市', price: 2400, once: true, rodId: 'shadow' },      { id: 'repair', kind: 'repair', name: '黑市维修', price: 10, dailyLimit: 10 },
      { id: 'refresh', kind: 'refresh', name: '刷新收购单', price: 25, dailyLimit: 3 },
      { id: 'quota', kind: 'quota', name: '收购配额 +10', price: 500, priceGrowth: 150, maxBuys: 6 },
      { id: 'theme-void', kind: 'theme', name: '主题「无灯」', price: 500, once: true, themeId: 'void' },
      { id: 'scale', kind: 'scale', name: '黑市秤', price: 600, once: true },
      // K 线档位：默认开放 120 分 / 60 分，30 分与 15 分要在这里解锁。
      // 精度越高越贵，因为越细的 K 线越能看清主力的进出节奏。
      { id: 'grain-m30', kind: 'grain', name: '行情档位「30分」', price: 800, once: true, grainId: 'm30' },
      { id: 'grain-m15', kind: 'grain', name: '行情档位「15分」', price: 1800, once: true, grainId: 'm15' },
      // 模块只从黑市商店出售；价格与等级上限以 machines.modules 为准，这里只做上架。
      { id: 'mod-overclock', kind: 'module', name: '模块 · 超频', moduleId: 'overclock' },
      { id: 'mod-cooling', kind: 'module', name: '模块 · 冷却鳍', moduleId: 'cooling' },
      { id: 'mod-twin', kind: 'module', name: '模块 · 双爪', moduleId: 'twin' },
      { id: 'mod-direct', kind: 'module', name: '模块 · 直连', moduleId: 'direct' },
      { id: 'mod-bulk', kind: 'module', name: '模块 · 扩仓', moduleId: 'bulk' },
      { id: 'mod-relay', kind: 'module', name: '模块 · 轮班', moduleId: 'relay' },
      { id: 'mod-spare', kind: 'module', name: '模块 · 备件', moduleId: 'spare' },
      { id: 'mod-silent', kind: 'module', name: '模块 · 静音', moduleId: 'silent' },
    ],
  },
  // 投币机器：鱼是租金、按件投币、时段运转、过热、模块槽。
  // 数值全部可后台调；代码只保留公式。
  machines: {
    // 模块功能本身由「解锁海域」控制，未到该海域时只显示槽位。
    modulesUnlockDepth: 'rift',
    modules: {
      overclock: { name: '超频', price: 1200, maxLevel: 3, load: 2, speed: 0.25, heatPerDay: 0.5 },
      cooling: { name: '冷却鳍', price: 600, maxLevel: 2, load: 1, heatPerDay: -0.3, speed: -0.1 },
      twin: { name: '双爪', price: 1500, maxLevel: 1, load: 2, parallel: 2, feeRate: 0.3 },
      direct: { name: '直连', price: 900, maxLevel: 2, load: 1, feeRate: -0.2 },
      bulk: { name: '扩仓', price: 700, maxLevel: 2, load: 1, depositBonus: 5000 },
      relay: { name: '轮班', price: 1400, maxLevel: 1, load: 2, shiftHours: 2 },
      spare: { name: '备件', price: 800, maxLevel: 1, load: 1, heatPenalty: 0.05 },
      silent: { name: '静音', price: 1600, maxLevel: 1, load: 2, effShift: 1 },
    },
    list: {
      claw: {
        id: 'claw', name: '铁爪 · 投币刮卡机', accent: '#8a7f6a', enabled: true,
        // 唯一条件：亲手刮开 50 张。不绑定黑市、不绑定海域。
        unlock: { kind: 'scratched', value: 50 },
        shift: { startHour: 9, endHour: 17 },
        rate: { msPerItem: 60000 },
        rent: { unit: 'fishKg', daily: 100, overtimePerHour: 10 },
        fee: { unit: 'coins', perItem: 1, overtimeMultiplier: 2 },
        overtime: { fromHour: 17, toHour: 22, maxHours: 5, efficiency: [1, 0.8, 0.6, 0.4, 0.25] },
        overheat: { max: 5, perDayPenalty: 0.1, minSpeed: 0.5 },
        moduleSlots: 2, loadCapacity: 6,
        deposits: [
          { key: 'fishKg', from: 'fish', max: 1000 },
          { key: 'coins', from: 'coins', max: 10000 },
          { key: 'items', from: 'scratch', max: 10000 },
        ],
        settle: { batchMax: 300 },
      },
      scale: {
        id: 'scale', name: '过磅台 · 收购机', accent: '#6a7f8a', enabled: true,
        unlock: { kind: 'blackMarket' },
        shift: { startHour: 9, endHour: 17 },
        rate: { msPerItem: 60000 },
        rent: { unit: 'blackCoins', daily: 5 },
        fee: { unit: 'blackCoins', rateOfProceeds: 0.05, min: 1 },
        overheat: { max: 5, perDayPenalty: 0.1, minSpeed: 0.5 },
        moduleSlots: 2, loadCapacity: 6,
        deposits: [{ key: 'blackCoins', from: 'blackCoins', max: 5000 }],
        settle: { batchMax: 60 },
      },
      wash: {
        id: 'wash', name: '熔洗槽 · 精炼机', accent: '#7a6a5a', enabled: true,
        unlock: { kind: 'blackMarket' },
        shift: { startHour: 9, endHour: 17 },
        rate: { msPerItem: 60000 },
        rent: { unit: 'blackCoins', daily: 3 },
        fee: { unit: 'blackCoins', perItem: 1 },
        overheat: { max: 5, perDayPenalty: 0.1, minSpeed: 0.5 },
        moduleSlots: 2, loadCapacity: 5,
        deposits: [{ key: 'blackCoins', from: 'blackCoins', max: 3000 }],
        settle: { batchMax: 60 },
      },
      watcher: {
        id: 'watcher', name: '盯盘机 · 行情机', accent: '#5a6a7a', enabled: false,
        unlock: { kind: 'blackMarket', also: 'fx' },
        shift: { startHour: 8, endHour: 24 },
        rate: { msPerItem: 60000 },
        rent: { unit: 'coins', daily: 200 },
        fee: { unit: 'coins', perItem: 2, rateOfProceeds: 0.01 },
        orders: { max: 2, ttlMs: 86400000 },
        overheat: { max: 5, perDayPenalty: 0.1, minSpeed: 0.5 },
        moduleSlots: 2, loadCapacity: 6,
        deposits: [{ key: 'coins', from: 'coins', max: 8000 }],
        settle: { batchMax: 60 },
      },
    },
  },
}

// 单条钓竿升级项：数值全部收敛成可计算的形式。
function normalizeRodUpgrade(upgrade) {
  return {
    ...upgrade,
    id: String(upgrade?.id || ''),
    coins: Math.max(0, Number(upgrade?.coins) || 0),
    growth: Math.max(0, Number(upgrade?.growth) || 0),
    cost: Math.max(1, Number(upgrade?.cost) || 1),
    maxLevel: Math.max(1, Math.round(Number(upgrade?.maxLevel) || 99)),
  }
}

// 内置钓竿的升级项以「代码里的默认值」为准补齐：
// world_config 里持久化的是上一次保存时的快照，新版本给内置竿加了升级项
// （例如自动维修）后，老配置里没有它，玩家就永远看不到这个功能。
// 规则：配置里已有的升级项按配置保留（后台可改数值），
// 配置里缺的、但代码默认值里有的项，补进来。
function withBuiltinUpgrades(rod, baseConfig, normalizeUpgrade) {
  const configured = (Array.isArray(rod.upgrades) ? rod.upgrades : []).map(normalizeUpgrade)
  const preset = (baseConfig.rods || []).find((item) => item.id === rod.id)
  if (!preset) return configured
  const byId = new Map(configured.map((upgrade) => [upgrade.id, upgrade]))
  ;(preset.upgrades || []).forEach((upgrade) => {
    if (!byId.has(upgrade.id)) byId.set(upgrade.id, normalizeUpgrade(upgrade))
  })
  // 顺序跟代码默认值走，保证界面上升级项的顺序稳定。
  const order = (preset.upgrades || []).map((upgrade) => upgrade.id)
  return [...byId.values()].sort((a, b) => {
    const ia = order.indexOf(a.id)
    const ib = order.indexOf(b.id)
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
  })
}

const configList = (list, fallback) => (Array.isArray(list) && list.length ? list : fallback)

const finiteNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

export function normalizeTension(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    maxTension: Math.max(50, finiteNumber(source.maxTension, TENSION_DEFAULTS.maxTension)),
    accelMs: Math.max(100, finiteNumber(source.accelMs, TENSION_DEFAULTS.accelMs)),
    maxRate: Math.max(1, finiteNumber(source.maxRate, TENSION_DEFAULTS.maxRate)),
    baseLoss: Math.max(0, finiteNumber(source.baseLoss, TENSION_DEFAULTS.baseLoss)),
    delayMs: Math.max(0, finiteNumber(source.delayMs, TENSION_DEFAULTS.delayMs)),
  }
}

// 刮刮乐奖项：kind 决定兑付到鱼币还是背包材料；旧存档只有材料，按 material 兜底。
export function normalizeScratchPrize(prize, index = 0) {
  const source = prize && typeof prize === 'object' ? prize : {}
  const kind = source.kind === 'coin' || source.type === 'coin' || source.name === COIN.name ? 'coin' : 'material'
  return {
    id: source.id || `prize-${index + 1}`,
    kind,
    name: kind === 'coin' ? COIN.name : (source.name || '浮木纤维'),
    qty: Math.max(1, Math.round(finiteNumber(source.qty, 1))),
    weight: Math.max(1, Math.round(finiteNumber(source.weight, 1))),
    // 这个奖项需要凑够几个相同图案才结算，默认 2（原来的两两配对）。
    need: Math.max(2, Math.min(SCRATCH_MAX_SLOTS, Math.round(finiteNumber(source.need, 2)))),
  }
}

// 海域词条权重：已有配置优先；没配过的词条统一按 1 补默认值。
// 词条本身不再带「起始海域」，除了这张权重表之外没有别的门槛。
export function normalizeDepthTraitWeights(raw, traits) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const ids = new Set((traits || []).map((trait) => trait.id))
  const gradient = defaultTraitWeights(traits)
  return DEPTHS.reduce((map, depth) => {
    const entry = source[depth.id] && typeof source[depth.id] === 'object' ? source[depth.id] : {}
    const weights = {}
    ids.forEach((traitId) => {
      const fallback = gradient[depth.id]?.[traitId] ?? 1
      const value = entry[traitId]
      weights[traitId] = value === undefined ? fallback : Math.max(0, Math.round(finiteNumber(value, fallback)))
    })
    return { ...map, [depth.id]: weights }
  }, {})
}

export function traitWeightFor(config, depthId, traitId) {
  const value = config?.depthTraitWeights?.[depthId]?.[traitId]
  if (value !== undefined) return Math.max(0, Number(value) || 0)
  // 没有单独配置时按 1 参与抽取；0 才是「这个海域不刷该词条」。
  return 1
}

// ---- 深海FX 配置 ----

export const FX_MAX_FEE_RATE = 0.1
export const FX_MAX_SPREAD = 0.1
export const FX_MIN_DAY_MS = 60 * 60 * 1000
export const FX_DAY_MS = 24 * 60 * 60 * 1000
// 交易日按服务器本地时间的零点切分；开市 08:00，收市 24:00。
// 零点到开市之间的八小时留给结算计算：这段时间行情已定但不可交易，
// 玩家看到的是「已公布、待开盘」的价格。
export const FX_OPEN_HOUR = 8
export const FX_CLOSE_HOUR = 24
// 成交时间桶：真实一天切成 5 分钟一格（288 格）。
// 日内走势按这些桶里实际发生买卖的时刻铺开，不再用固定的 U 型曲线。
// 桶只保留最近 30 天，够 5 分钟 / 小时 / 日 K 的回看窗口。
export const FX_BIN_MS = 5 * 60 * 1000
export const FX_BIN_COUNT = Math.ceil(FX_DAY_MS / FX_BIN_MS)
export const FX_BIN_KEEP_DAYS = 30
// 空档容忍窗口：连续这么久没有流水，才认定这段数据是真的缺失、整段丢弃。
// 改成 5 分钟一格之后，1~2 格没成交是正常的冷场（玩家在等咬钩），不能当成脏数据删掉。
export const FX_BIN_GAP_MS = 15 * 60 * 1000
// 上一个版本的桶宽（15 分钟）。老数据按这个宽度存的槽位，读的时候要换算过来。
export const FX_LEGACY_BIN_MS = 15 * 60 * 1000

export function fxBinCount(dayMs = FX_DAY_MS) {
  return Math.max(1, Math.ceil((Number(dayMs) || FX_DAY_MS) / FX_BIN_MS))
}

export function fxBinSlot(at = Date.now(), dayMs = FX_DAY_MS) {
  const ms = Number(at)
  if (!Number.isFinite(ms)) return 0
  const day = fxDayIndex(ms, dayMs)
  const slot = Math.floor((ms - fxDayStart(day, dayMs)) / FX_BIN_MS)
  return Math.max(0, Math.min(fxBinCount(dayMs) - 1, slot))
}

// 时间桶统一成稀疏数组：[slot, net, volume]。
// net 是这一格的净供给变化（钓获为正、卖出为负），volume 是这一格的真实成交量。
// 原始流水 → 价格推导之间唯一的一道闸门。
//
// 一格流水必须同时有成交量和净额才有意义：没有成交量就代表「这一格没有真实成交」，
// 它既不该占据一个时间点，也不该推动价格。旧口径、历史数据、上游 bug 都可能写进
// 这种「只有净额没有量」的格子，所以在这里统一丢弃，后面的推导只认真实成交。
//
// 注意：这条闸门只管「日内路径」。当天净额与成交量的汇总来自 fx_bucket，
// 结算价由那一份决定——过滤时间桶不会改变零点落库的收盘价。
export function fxTradeBins(raw) {
  if (!Array.isArray(raw)) return []
  // 先并成「一格一行」：同一槽位可能被写了多次（多笔流水、重复合并）。
  const map = new Map()
  raw.forEach((bin) => {
    if (!Array.isArray(bin) || bin.length < 2) return
    const slot = Math.max(0, Math.floor(Number(bin[0]) || 0))
    const net = Number(bin[1]) || 0
    const volume = Math.max(0, Number(bin[2]) || 0)
    const prev = map.get(slot)
    map.set(slot, [slot, (prev?.[1] || 0) + net, (prev?.[2] || 0) + volume])
  })
  const merged = [...map.values()].sort((a, b) => a[0] - b[0])

  // 删除规则：只删「真的没有流水」的片段，不再一刀切删掉所有无成交量格子。
  //
  //   有成交量的格子          → 一定保留（这是真实数据）。
  //   没有成交量的格子        → 看它周围：15 分钟内只要还有成交，就说明这是
  //                            正常的冷场（玩家在等咬钩），保留；
  //                            15 分钟内一笔成交都没有，才认定这段数据缺失，丢弃。
  //
  // 为什么放宽：改成 5 分钟一格后，1~3 格空档是常态。一刀切会让行情在日内
  // 出现大量断点，图表和「今天到底有没有交易」的判定都会失真。
  const gapSlots = Math.max(1, Math.round(FX_BIN_GAP_MS / FX_BIN_MS))
  const tradedSlots = merged.filter((bin) => bin[2] > 0).map((bin) => bin[0])
  return merged.filter((bin) => {
    if (bin[2] > 0) return true
    // 最近的成交格有多远？小于空档窗口就保留这一格。
    let nearest = Infinity
    for (const slot of tradedSlots) {
      const distance = Math.abs(slot - bin[0])
      if (distance < nearest) nearest = distance
      if (nearest === 0) break
    }
    return nearest < gapSlots
  })
}

// 兼容旧名：所有调用方都走同一道闸门，不再有第二套归一化逻辑。
export const normalizeFxBins = fxTradeBins

export function mergeFxBins(list, additions) {
  const extra = fxTradeBins(additions)
  if (!extra.length) return fxTradeBins(list)
  const map = new Map(fxTradeBins(list).map((bin) => [bin[0], bin]))
  extra.forEach(([slot, net, volume]) => {
    const prev = map.get(slot)
    map.set(slot, [slot, (prev?.[1] || 0) + net, (prev?.[2] || 0) + volume])
  })
  // 回写时再走一次闸门：两笔量互相抵消成 0 的格子，能不能留下由空档规则决定。
  return fxTradeBins([...map.values()])
}

// 某个已结算日的成交时间桶：state.fx.bins[name][day]。
export function fxDayBins(state, name, day) {
  const map = state?.fx?.bins?.[name]
  if (!map) return []
  return normalizeFxBins(map[day] ?? map[String(day)])
}

export function normalizeFx(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const base = DEFAULT_CONFIG.fx
  const traits = Object.keys(TRAITS_BY_ID).reduce((map, name) => {
    const saved = source.traits?.[name]
    const fallback = DEFAULT_FX_TRAITS[name] || { price: 50, sensitivity: 1 }
    return {
      ...map,
      [name]: {
        price: Math.max(1, Math.round(finiteNumber(saved?.price, fallback.price))),
        // 敏感度：同样超预期程度下，这个标的涨跌得更猛还是更稳。
        sensitivity: clamp(finiteNumber(saved?.sensitivity, fallback.sensitivity ?? 1), 0.1, 5),
      },
    }
  }, {})
  return {
    dayMs: Math.max(FX_MIN_DAY_MS, finiteNumber(source.dayMs, base.dayMs)),
    volatility: clamp(finiteNumber(source.volatility, base.volatility), 0.005, 0.5),
    reversion: clamp(finiteNumber(source.reversion, base.reversion), 0, 0.5),
    feeRate: clamp(finiteNumber(source.feeRate, base.feeRate), 0, FX_MAX_FEE_RATE),
    spread: clamp(finiteNumber(source.spread, base.spread), 0, FX_MAX_SPREAD),
    maxPosition: Math.max(1, Math.round(finiteNumber(source.maxPosition, base.maxPosition))),
    historyDays: clamp(Math.round(finiteNumber(source.historyDays, base.historyDays)), 1, 30),
    // 涨跌停：不设会变成纯随机游走，配合均值回归一起把价格锁在合理区间。
    dailyLimit: clamp(finiteNumber(source.dailyLimit, base.dailyLimit ?? 0.1), 0.01, 1),
    openHour: clamp(Math.round(finiteNumber(source.openHour, base.openHour ?? FX_OPEN_HOUR)), 0, 23),
    closeHour: clamp(Math.round(finiteNumber(source.closeHour, base.closeHour ?? FX_CLOSE_HOUR)), 1, 24),
    traits,
  }
}

export function fxConfig(state) {
  return (state?.config || DEFAULT_CONFIG).fx || normalizeFx(null)
}

// ---- 深海FX 日线行情 ----

// 交易日序号：按服务器本地时间的零点切分，同一天的所有结算归入同一根日线。
// 用 UTC 的年月日做序号，避免夏令时把某天算成 23 或 25 小时。
export function fxDayIndex(at = Date.now(), dayMs = FX_DAY_MS) {
  const ms = Number(at)
  if (!Number.isFinite(ms)) return 0
  if (dayMs === FX_DAY_MS) {
    const date = new Date(ms)
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / FX_DAY_MS)
  }
  return Math.floor(ms / dayMs)
}

// 该交易日的本地零点时刻。
export function fxDayStart(dayIndex, dayMs = FX_DAY_MS) {
  const index = Math.floor(Number(dayIndex) || 0)
  if (dayMs === FX_DAY_MS) {
    const date = new Date(index * FX_DAY_MS)
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime()
  }
  return index * dayMs
}

// 当天这根日线的收盘时刻（下一个零点）。
export function fxDayClose(dayIndex, dayMs = FX_DAY_MS) {
  return fxDayStart(Math.floor(Number(dayIndex) || 0) + 1, dayMs)
}

// 当前交易时段：08:00 开市，24:00 收市，其余时间只展示不交易。
export function fxSession(state, now = Date.now()) {
  const config = fxConfig(state)
  const day = fxDayIndex(now, config.dayMs)
  const start = fxDayStart(day, config.dayMs)
  const openHour = clamp(Math.round(Number(config.openHour ?? FX_OPEN_HOUR)), 0, 23)
  const closeHour = clamp(Math.round(Number(config.closeHour ?? FX_CLOSE_HOUR)), openHour + 1, 24)
  const opensAt = start + openHour * 60 * 60 * 1000
  const closesAt = start + closeHour * 60 * 60 * 1000
  const open = now >= opensAt && now < closesAt
  return {
    day,
    open,
    phase: open ? 'open' : now < opensAt ? 'pre-open' : 'closed',
    opensAt,
    closesAt,
    // 下一次开盘：已经开市就是明天，还没开市就是今天。
    nextOpenAt: open ? opensAt + config.dayMs : now < opensAt ? opensAt : opensAt + config.dayMs,
    openHour,
    closeHour,
  }
}

export function fxCanTrade(state, now = Date.now()) {
  return fxSession(state, now).open
}

// 日涨跌幅 = 超预期冲击 + 均值回归。
// 日涨跌幅只有两个来源：上钩抽走供给、卖出还给供给。
//   失衡比 = (上钩 − 卖出) / (上钩 + 卖出) ∈ [−1, 1]
//            +1 表示这一天钓上来的全都没卖，供给被完全锁死；
//            −1 表示这一天卖出去的量远超新钓获。规模无关，所以 10 条鱼和
//            10 万条鱼只要方向一致，涨跌幅就一样，只有噪声不同。
//   冲击 = 失衡比 × volatility × 敏感度
//   回归 = −reversion × (当前价 / 基准价 − 1)，把价格往基准价拉
//
// 回归是必须的：没有它，价格就是纯随机游走，7 天后会漂到 0 或无穷。
// 涨跌停是第二道闸门，挡住集中出货这类异常日。
export function fxDayMove(net, volume, prevClose, base, meta, config) {
  const sensitivity = Math.max(0.1, Number(meta?.sensitivity) || 1)
  const traded = Math.abs(Number(volume) || 0)
  // 没有成交就没有新信息，价格只受回归影响。
  const imbalance = traded > 0 ? clamp((Number(net) || 0) / traded, -1, 1) : 0
  const shock = imbalance * config.volatility * sensitivity
  const anchor = Number(base) > 0 && Number(prevClose) > 0 ? Number(prevClose) / Number(base) - 1 : 0
  const pull = -config.reversion * anchor
  const limit = Math.max(0.001, Number(config.dailyLimit) || 0.1)
  return clamp(shock + pull, -limit, limit)
}

// ---- 分钟级行情 ----
//
// 30 天 × 960 分钟 × 8 标的 ≈ 23 万根分钟线，直接存要 9 MB，localStorage 装不下。
// 所以分钟线不落库：它由「前收盘 + 当日总涨跌 + 确定的日内路径」推导出来，
// 同一天永远得到同一条路径，刷新页面也不会变。
//
// 当日总涨跌先按 U 型放量曲线（开收盘多、盘中少）分摊到每一分钟，
// 这就是「把一天的数据用队列分布到整天的波动里」：开盘就涨完是线性释放，
// 而真实市场是开盘与收盘放量，盘中安静，所以用 U 型权重。

// 交易时段的分钟数：08:00–24:00 即 960 分钟。
export function fxSessionMinutes(config) {
  const open = clamp(Math.round(Number(config?.openHour ?? FX_OPEN_HOUR)), 0, 23)
  const close = clamp(Math.round(Number(config?.closeHour ?? FX_CLOSE_HOUR)), open + 1, 24)
  return (close - open) * 60
}

// 队列释放曲线：u ∈ [0,1] 是当天进度，返回累计已释放的比例 0..1。
// 权重 w(u) = 1 + a(2u−1)² 是 U 形（两端放量），积分闭式可得，
// 所以任意时刻的累计释放比例都是精确值，不会因为分批计算而漂移。
export function fxReleaseShare(u, profile = 2) {
  const t = clamp(Number(u) || 0, 0, 1)
  const a = Math.max(0, Number(profile) || 0)
  const norm = 1 + a / 3
  // ∫₀ᵘ (2s−1)² ds = [(2u−1)³ + 1] / 6
  return (t + (a * (Math.pow(2 * t - 1, 3) + 1)) / 6) / norm
}

// 日内路径的确定性扰动：以 sin(πu) 为包络，所以 u=0 和 u=1 时扰动为 0，
// 分钟线最后一根的收盘价必然等于日线的收盘价。
function fxBridge(u, amp, seed) {
  if (!amp) return 0
  const wobble = 0.6 * Math.sin(2 * Math.PI * 3 * u + (seed % 360) * Math.PI / 180)
    + 0.4 * Math.sin(2 * Math.PI * 7 * u + ((seed * 7) % 360) * Math.PI / 180)
  return amp * Math.sin(Math.PI * u) * wobble
}

// 名称 + 交易日 → 稳定的扰动相位，保证同一标的同一天形态固定。
function fxDaySeed(name, day) {
  const label = TRAITS_BY_ID[name]?.label || String(name)
  const text = `${label}:${day}`
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

// 单日成交量平滑的峰谷上限：最高分钟成交量 ≤ 最低的 3 倍。
// 放宽到 3 倍是为了保留「大单确实更显眼」的观感——1.5 倍会把所有成交压得
// 几乎一样高，盘中看不出量能差别。
export const FX_VOLUME_RATIO = 3
// 内部目标取 2.9 而不是 3，给分钟级取整留一点余量。
const FX_VOLUME_RATIO_TARGET = 2.9

// 单日成交量平滑：把实际成交形成的尖峰往「均匀铺开」的方向拉，直到
// 最高成交量 ≤ 最低成交量 × 3，并且每一分钟都有成交。
// 这样不同订单的成交会互相重叠，不会出现某几分钟爆量、其余时间零成交。
function fxEvenVolumes(values, total) {
  const n = values.length
  if (!n) return values
  const sum = values.reduce((acc, value) => acc + value, 0)
  if (!(sum > 0) || !(total > 0)) return values.map(() => 0)
  const mean = sum / n
  let min = Math.min(...values)
  let max = Math.max(...values)
  // 混合：v' = mean + (v − mean) × t。t=0 完全均匀，t=1 保持原样。
  // 解 max' ≤ R × min' 得到 t 的上限：t = (R − 1) × mean / (up − R × down)。
  let blend = 1
  if (max > min) {
    const up = max - mean
    const down = min - mean
    const denom = up - FX_VOLUME_RATIO_TARGET * down
    blend = denom > 0 ? Math.min(1, ((FX_VOLUME_RATIO_TARGET - 1) * mean) / denom) : 1
  }
  const out = values.map((value) => Math.max(0, mean + (value - mean) * blend))
  // 保持全天总量不变：混合本身不改总和，这里只修正浮点误差。
  const outSum = out.reduce((acc, value) => acc + value, 0)
  return outSum > 0 ? out.map((value) => value * (total / outSum)) : out
}

// 把真实一天的时间桶映射到交易时段。
// 开市后的成交保持真实钟点（10:00 的成交落在 10:00）；
// 开市前 / 收市后的成交没有对应的交易时刻，均摊到整个开市期间，作为背景流动性。
// 返回每个交易分钟上的净流入与成交量（两者各自的总和等于全天总量）。
function fxSessionFlows(bins, config, total) {
  const net = new Array(total).fill(0)
  const volume = new Array(total).fill(0)
  const dayMs = Number(config.dayMs) || FX_DAY_MS
  const slots = fxBinCount(dayMs)
  const binMinutes = dayMs / slots / 60000
  const openHour = clamp(Math.round(Number(config.openHour ?? FX_OPEN_HOUR)), 0, 23)
  const closeHour = clamp(Math.round(Number(config.closeHour ?? FX_CLOSE_HOUR)), openHour + 1, 24)
  const openMinute = openHour * 60
  const closeMinute = closeHour * 60
  const spread = (value, from, to, perMinute) => {
    if (!value || to <= from) return
    const first = Math.max(0, Math.floor(from))
    const last = Math.min(total, Math.ceil(to))
    const span = to - from
    for (let i = first; i < last; i += 1) {
      const overlap = Math.min(to, i + 1) - Math.max(from, i)
      if (overlap > 0) perMinute(i, value * (overlap / span))
    }
  }
  ;(Array.isArray(bins) ? bins : []).forEach((bin) => {
    const slot = Math.max(0, Math.min(slots - 1, Math.floor(Number(bin?.[0]) || 0)))
    const binNet = Number(bin?.[1]) || 0
    const binVolume = Math.max(0, Number(bin?.[2]) || 0)
    // 没有成交量的格子不推价格：它可能只是被保留下来的冷场格（距成交 < 15 分钟）。
    // 它的净额不会在这里生效，而是落进 fxMinutePath 里的「差额」按 U 型曲线摊开，
    // 避免出现「没有任何成交、价格却单独跳一下」的假波动。
    if (!(binVolume > 0)) return
    const fromMinute = slot * binMinutes
    const toMinute = Math.min(dayMs / 60000, (slot + 1) * binMinutes)
    const windowStart = Math.max(fromMinute, openMinute)
    const windowEnd = Math.min(toMinute, closeMinute)
    const inSession = Math.max(0, windowEnd - windowStart)
    const outside = Math.max(0, (toMinute - fromMinute) - inSession)
    // 开市中的部分：真实钟点直接落到交易时段对应的分钟。
    if (inSession > 0) {
      const share = inSession / (toMinute - fromMinute)
      spread(binNet * share, windowStart - openMinute, windowEnd - openMinute, (i, value) => { net[i] += value })
      spread(binVolume * share, windowStart - openMinute, windowEnd - openMinute, (i, value) => { volume[i] += value })
    }
    // 开市前 / 收市后的部分：成交量均摊到整个交易时段；
    // 净额按「越往后权重越大」的斜坡铺开（累计约 u²），这样开盘第一分钟
    // 不会把整段场外净额一次性砸进价格，避免每天开盘固定出现一根突兀的涨跌。
    if (outside > 0) {
      const share = outside / (toMinute - fromMinute)
      const netAmount = binNet * share
      const volumePerMinute = (binVolume * share) / total
      const weightSum = (total * (total + 1)) / 2
      for (let i = 0; i < total; i += 1) {
        net[i] += (netAmount * (i + 1)) / weightSum
        volume[i] += volumePerMinute
      }
    }
  })
  return { net, volume }
}

// 某一交易日的完整分钟路径。
// 返回 { prevClose, move, minutes: [{ minute, at, open, high, low, close, volume, settled }] }。
// `settledCount` 之前的分钟算已走完；当天则只走到「现在」这一分钟。
export function fxMinutePath(state, name, day, now = Date.now()) {
  const config = fxConfig(state)
  const meta = config.traits[name] || DEFAULT_FX_TRAITS[name]
  if (!meta) return { prevClose: 0, move: 0, minutes: [], settledCount: 0 }
  const history = fxHistory(state, name)
  const bar = history.find((item) => Number(item.day) === Number(day))
  const prevBar = history.filter((item) => Number(item.day) < Number(day)).at(-1)
  const prevClose = prevBar ? Number(prevBar.close) || meta.price : meta.price
  // 当天还没结算时用实时桶估算，已结算则用落库的日线。
  const current = fxDayIndex(now, config.dayMs) === Number(day)
  const bucket = fxToday(state, name, now)
  const net = bar ? Number(bar.net) || 0 : bucket.net
  const volume = bar ? Number(bar.volume) || 0 : bucket.volume
  const move = bar ? Number(bar.move) || 0 : fxDayMove(net, volume, prevClose, meta.price, meta, config)
  const total = fxSessionMinutes(config)
  const minutes = []
  // 没有交易时段配置就没什么可画的；否则即使当天没成交也要返回一条平的路，
  // 让图表在未开盘 / 冷清时显示成一条直线，而不是整块空白。
  if (!total) return { prevClose, move, minutes, settledCount: 0 }
  const seed = fxDaySeed(name, day)
  const openHour = clamp(Math.round(Number(config.openHour ?? FX_OPEN_HOUR)), 0, 23)
  const sessionStart = fxDayStart(Number(day), config.dayMs) + openHour * 60 * 60 * 1000
  // 当天已经走完多少分钟（按分钟向下取整，保证「一分钟动一次」）。
  const elapsed = config.dayMs === FX_DAY_MS
    ? Math.floor((now - sessionStart) / 60000)
    : total
  // 真实成交时间桶：已结算日从历史里取，今天从待结算桶取。
  // 有桶就按桶里的实际成交时刻铺开；旧数据没有桶时退回原来的 U 型释放曲线。
  const bins = bar ? fxDayBins(state, name, day) : bucket.bins
  const hasBins = Array.isArray(bins) && bins.length > 0
  // 日内振幅：由「波动系数 × 成交活跃度」决定，和日线影线是同一套口径。
  //
  // 为什么不能绑在 |move| 上：净额 ≈ 0 的日子成交依然可能很大（钓上来的鱼又被
  // 商会收走，两头都计入 volume，净额却互相抵消）。把振幅绑在净涨跌上，这些
  // 日子——也就是绝大多数日子——的日内图会退化成一条直线，完全看不出盘中波动。
  //
  // 成交量优先用日线汇总，取不到（比如这一天还没结算、也不在待结算桶里）就退回
  // 时间桶自己的总量：否则振幅会算成 0，整条路径又变成一条斜线。
  //
  // 再按往返成本封顶：日内振幅一旦超过「双边手续费 + 价差」，任何人都能稳定地
  // 低买高卖把差价赚走。0.35 的系数保证峰谷差 ≤ 70% 的往返成本，始终套不出利润。
  const volatility = Math.max(0, Number(config.volatility) || 0)
  const binVolumeTotal = hasBins ? bins.reduce((sum, bin) => sum + Math.max(0, Number(bin[2]) || 0), 0) : 0
  const activityVolume = Math.max(Number(volume) || 0, binVolumeTotal)
  const activity = activityVolume > 0 ? Math.min(1, Math.log10(1 + activityVolume) / 4) : 0
  const roundTrip = Math.max(0, Number(config.feeRate) || 0) * 2 + Math.max(0, Number(config.spread) || 0)
  const amp = Math.min(volatility * activity * 0.5, roundTrip > 0 ? roundTrip * 0.35 : Infinity)
  const flows = hasBins ? fxSessionFlows(bins, config, total) : null
  // 时间桶之外可能还有「旧桶」的聚合量（功能上线前已经记下的流水，或口径误差）。
  // 这部分没有真实时刻，按原来的 U 型曲线补成背景量，保证全天总量和日线仍然一致。
  if (flows) {
    const binNet = flows.net.reduce((sum, value) => sum + value, 0)
    const binVolume = flows.volume.reduce((sum, value) => sum + value, 0)
    const restNet = net - binNet
    const restVolume = Math.max(0, volume - binVolume)
    if (Math.abs(restNet) > 1e-9 || restVolume > 1e-9) {
      for (let i = 0; i < total; i += 1) {
        const share = fxReleaseShare((i + 1) / total) - fxReleaseShare(i / total)
        flows.net[i] += restNet * share
        flows.volume[i] += restVolume * share
      }
    }
  }
  // 价格冲击用「累计失衡比」的低通曲线：单笔订单的净额不会在它出现的那一分钟
  // 一次性打满，而是沿时间轴向前铺开；最后把滤波滞后留下的差额沿全天线性补齐，
  // 收盘仍严格等于日线收盘价。这样每天不会再有一根突兀的涨跌柱。
  let ratioSeries = null
  if (flows) {
    const netTotal = flows.net.reduce((sum, value) => sum + value, 0)
    const volumeTotal = flows.volume.reduce((sum, value) => sum + value, 0)
    const target = volumeTotal > 0 ? clamp(netTotal / volumeTotal, -1, 1) : 0
    const raw = new Array(total)
    let cumNet = 0
    let cumVolume = 0
    for (let i = 0; i < total; i += 1) {
      cumNet += flows.net[i]
      cumVolume += flows.volume[i]
      raw[i] = cumVolume > 0 ? clamp(cumNet / cumVolume, -1, 1) : 0
    }
    // 一阶低通：从 0 开始，约 60 分钟追上原始失衡比。
    const alpha = 1 - Math.exp(-1 / 60)
    let smoothed = 0
    ratioSeries = new Array(total)
    for (let i = 0; i < total; i += 1) {
      smoothed += (raw[i] - smoothed) * alpha
      ratioSeries[i] = smoothed
    }
    // 把滤波没追上的差额沿全天线性补齐，避免最后一分钟突然跳到日线收盘。
    const gap = target - smoothed
    for (let i = 0; i < total; i += 1) {
      ratioSeries[i] = clamp(ratioSeries[i] + gap * ((i + 1) / total), -1, 1)
    }
    ratioSeries[total - 1] = target
  }
  // 成交量平滑：把实际成交形成的尖峰摊开，保证每一分钟都有成交，
  // 且单日最高 / 最低成交量不超过 3 倍。价格按上面的平滑失衡比推进。
  const rawDisplayVolumes = flows
    ? flows.volume
    : volume > 0
      ? Array.from({ length: total }, (_, i) => volume * (fxReleaseShare((i + 1) / total) - fxReleaseShare(i / total)))
      : null
  const displayVolumes = rawDisplayVolumes ? fxEvenVolumes(rawDisplayVolumes, volume) : null
  // 已落库的日线整天都算走完；只有「今天」才按当前时刻截断。
  // 过去某天如果没有日线（那天没有成交），它就是空的，不能把整条路径当成已发生。
  const settledCount = bar ? total : current ? clamp(elapsed, 0, total) : 0
  // 用「相对前收的累计倍数」逐分钟推进，而不是拿上一根的收盘价连乘。
  // 后者每根都四舍五入，960 根累积下来会明显偏离日线涨跌幅；
  // 前者只用精确曲线计算，最后一分钟必然落回日线收盘价。
  const lastMinute = total - 1
  // 这一分钟结束时相对前收的精确价格：释放曲线 + 桥接扰动。
  const exactAt = (u) => prevClose * (1 + move * fxReleaseShare(u) + fxBridge(u, amp, seed))
  // 有成交时间桶时，价格只按真实成交的累计失衡走：
  // 没成交的分钟价格不动，成交落在哪一分钟，波动就出现在哪一分钟。
  const sensitivity = Math.max(0.1, Number(meta.sensitivity) || 1)
  const limit = Math.max(0.001, Number(config.dailyLimit) || 0.1)
  const pull = -config.reversion * (prevClose / meta.price - 1)
  let price = prevClose
  let volGiven = 0
  let volCum = 0
  for (let i = 0; i < total; i += 1) {
    const u1 = (i + 1) / total
    const open = price
    let close
    if (hasBins) {
      const shock = ratioSeries[i] * config.volatility * sensitivity
      // 均值回归按当天进度线性释放，开盘价仍等于前收；最后一分钟落回日线涨跌幅。
      //
      // 关键：这里必须补上 fxBridge 的日内摆动。只有「累计失衡 + 线性回归」时，
      // 只要资金整体偏一个方向，整条路径就是单调的——画出来就是一条斜线，
      // 每根蜡烛的变动小到看不见。摆动项让价格在趋势上叠加真实的来回，
      // 并且它在 u=0 与 u=1 处为 0，所以开盘仍等于前收、最后一分钟仍等于结算价。
      const wobble = i === lastMinute ? 0 : fxBridge(u1, amp, seed)
      const moveAt = i === lastMinute ? move : clamp(shock + pull * u1 + wobble, -limit, limit)
      close = Math.max(1, prevClose * (1 + moveAt))
    } else {
      // 最后一分钟直接取日线收盘价，避免任何浮点残差。
      close = i === lastMinute ? prevClose * (1 + move) : Math.max(1, exactAt(u1))
    }
    // 分钟级影线：振幅按布朗缩放，1 分钟的波动应约为全天的 1/√N。
    // 用固定比例（open × amp × 0.12）会让每分钟的影线远长于实体，
    // 960 根画出来就是一排毛刺，和小时线的形态完全对不上。
    const wick = Math.abs(close - open) * 0.28 + open * amp * 0.0009
    const high = Math.max(open, close) + wick
    const low = Math.max(1, Math.min(open, close) - wick)
    let vol = 0
    if (displayVolumes) {
      // 平滑后的成交量每分钟都有；按累计值取整，避免 960 根逐根四舍五入后总量漂移。
      volCum += displayVolumes[i]
      const target = i === lastMinute ? Math.round(volume * 10000) / 10000 : Math.round(volCum * 10000) / 10000
      vol = Math.max(0, target - volGiven)
      volGiven += vol
    }
    minutes.push({
      minute: i,
      at: sessionStart + i * 60000,
      open: Math.round(open * 10000) / 10000,
      high: Math.round(high * 10000) / 10000,
      low: Math.round(low * 10000) / 10000,
      // 保留 4 位：分钟级波动很小，2 位会被四舍五入抹平。
      close: Math.round(close * 10000) / 10000,
      // 本分钟自身涨跌，界面读数直接用（缺了会显示 NaN%）。
      move: open > 0 ? close / open - 1 : 0,
      volume: Math.round(vol * 10000) / 10000,
      settled: i < settledCount,
    })
    price = close
  }
  return { prevClose, move, minutes, settledCount }
}

// 把分钟线按固定根数聚合成 K 线。日 K 用 15 分钟（15 根），周 K 用小时（60 根）。
// 底层始终是分钟路径，所以价格仍然每分钟更新，只是画出来的蜡烛更粗。
export function fxAggregateMinutes(state, name, minutesPerBar, now = Date.now()) {
  const config = fxConfig(state)
  const today = fxDayIndex(now, config.dayMs)
  const span = clamp(Math.floor(Number(minutesPerBar) || 15), 1, 60)
  const out = []
  for (let offset = config.historyDays - 1; offset >= 0; offset -= 1) {
    const day = today - offset
    const path = fxMinutePath(state, name, day, now)
    const settled = path.minutes.filter((item) => item.settled)
    if (!settled.length) continue
    for (let i = 0; i < settled.length; i += span) {
      const chunk = settled.slice(i, i + span)
      const open = chunk[0].open
      const close = chunk[chunk.length - 1].close
      out.push({
        key: `b${span}-${day}-${i}`,
        at: chunk[0].at,
        day,
        // 这根蜡烛覆盖到第几分钟，界面上标出时间区间。
        fromMinute: chunk[0].minute,
        toMinute: chunk[chunk.length - 1].minute,
        open,
        // 聚合后的影线：分钟影线取极值后仍然很短，所以再按「粒度越粗影线越长」
        // 补一段，让 15 分钟线与小时线的形态比例保持一致（影线约为实体的 1/4）。
        high: Math.max(...chunk.map((item) => item.high)) + Math.abs(close - open) * 0.22,
        low: Math.max(1, Math.min(...chunk.map((item) => item.low)) - Math.abs(close - open) * 0.22),
        close,
        volume: Math.round(chunk.reduce((sum, item) => sum + item.volume, 0) * 100) / 100,
        move: open > 0 ? close / open - 1 : 0,
      })
    }
  }
  return out
}

// 周 K 用小时线。
export function fxHourlyBars(state, name, now = Date.now()) {
  return fxAggregateMinutes(state, name, 60, now)
}

// 日 K 用 15 分钟线。
export function fxQuarterHourBars(state, name, now = Date.now()) {
  return fxAggregateMinutes(state, name, 15, now)
}

// ---- 日线紧凑存储 ----
//
// 一年 × 8 个标的 = 2920 根。按对象存约 0.35 MB，仍占掉不小的配额，
// 改用数组：[day, close, net, volume, open, high, low]，一根约 25 字节，总共 70 KB。
// move / imbalance 都能由这几个字段算出来，不用存。
export const FX_KEEP_DAYS = 365

function isAscending(list, keyOf) {
  for (let i = 1; i < list.length; i += 1) {
    if (keyOf(list[i]) < keyOf(list[i - 1])) return false
  }
  return true
}

function decodeBar(row) {
  if (!Array.isArray(row)) return row
  const [day, close, net, volume, open, high, low] = row
  const prevClose = Number(open) || Number(close) || 1
  const closeValue = Number(close) || prevClose
  const volumeValue = Number(volume) || 0
  const netValue = Number(net) || 0
  const openValue = Number(open) || prevClose
  return {
    day: Number(day),
    open: openValue,
    high: Number(high) || Math.max(openValue, closeValue),
    low: Number(low) || Math.min(openValue, closeValue),
    close: closeValue,
    net: netValue,
    volume: volumeValue,
    move: openValue > 0 ? closeValue / openValue - 1 : 0,
    imbalance: volumeValue > 0 ? clamp(netValue / volumeValue, -1, 1) : 0,
  }
}

export function encodeBar(bar) {
  const open = Number(bar.open) || Number(bar.close) || 1
  const close = Number(bar.close) || open
  return [
    Number(bar.day),
    Math.round(close * 100) / 100,
    Math.round((Number(bar.net) || 0) * 100) / 100,
    Math.round(Number(bar.volume) || 0),
    Math.round(open * 100) / 100,
    Math.round((Number(bar.high) || Math.max(open, close)) * 100) / 100,
    Math.round((Number(bar.low) || Math.min(open, close)) * 100) / 100,
  ]
}

// 取某个材料的日线历史（按日序号升序），只保留 historyDays 根。
// 每根日线记：day 序号、net 净流入、volume 当日结算量、move 当日涨跌幅、close 收盘价。
// 全部保留的日线（最多 30 天，由 settleFxDays 裁剪）。
// 显示窗口由调用方按 historyDays 自己截取，这样周 K 能用到比日 K 更长的历史。
export function fxHistory(state, name) {
  const list = state?.fx?.days?.[name]
  if (!Array.isArray(list)) return []
  // 已经是升序的紧凑数组（年线主力形态），直接解码，不做额外的排序分配。
  if (list.length && Array.isArray(list[0])) {
    const sorted = isAscending(list, (row) => Number(row[0]))
    const source = sorted ? list : [...list].sort((a, b) => Number(a[0]) - Number(b[0]))
    return source.map(decodeBar)
  }
  return list
    .filter((bar) => Number.isFinite(Number(bar?.day)))
    .sort((a, b) => Number(a.day) - Number(b.day))
}

// 当日（还没结算的那根）的累计净供给变化与成交总量。
// net > 0 表示这一天抽走的比还回来的多（利多），net < 0 则相反。
export function fxToday(state, name, now = Date.now()) {
  const config = fxConfig(state)
  const today = fxDayIndex(now, config.dayMs)
  const bucket = state?.fx?.today?.[name]
  if (!bucket || Number(bucket.day) !== today) return { day: today, net: 0, volume: 0, bins: [] }
  return {
    day: today,
    net: Number(bucket.net) || 0,
    volume: Number(bucket.volume) || 0,
    bins: normalizeFxBins(bucket.bins),
  }
}

// 单根日线的完整 OHLC：开盘价 = 前收盘，收盘价 = 前收盘 ×（1 + 涨跌幅）。
// 零点结算与后台的「今日结算预览」共用这一段：影线、失衡比、1 的价格地板
// 只能有一份实现，否则预览出来的数字和真正落库的日线会各算一套，管理员对不上账。
// move 由调用方给（有桶走 fxDayMove，没有桶只走均值回归），这里只负责把价格铺开。
export function fxDayBar(prevClose, net, volume, move, config) {
  const open = Number(prevClose) || 1
  const change = Number(move) || 0
  // 价格保留 1 的硬地板，避免极端情况下算出 0 或负数。
  const close = Math.max(1, Math.round(open * (1 + change) * 100) / 100)
  const netValue = Number(net) || 0
  const volumeValue = Math.max(0, Number(volume) || 0)
  // 影线：日内买卖压力不均，价格在开盘与收盘之间来回摸高探低。
  // 用「开盘到收盘这段行程的固定比例 + 成交活跃度」撑出高低点，
  // 保证 low ≤ min(open, close) ≤ max(open, close) ≤ high，K 线不会画反。
  const span = Math.abs(close - open)
  const activity = volumeValue > 0 ? Math.min(1, Math.log10(1 + volumeValue) / 4) : 0
  // 用失衡比的正负决定哪一头影线更长：净抽走时上影更强，净回流时下影更强。
  const imbalance = volumeValue > 0 ? clamp(netValue / volumeValue, -1, 1) : 0
  const volatility = Number(config?.volatility) || 0
  const upWick = span * 0.35 + close * volatility * activity * (0.4 + Math.max(0, imbalance) * 0.6)
  const downWick = span * 0.35 + close * volatility * activity * (0.4 + Math.max(0, -imbalance) * 0.6)
  return {
    open,
    high: Math.round((Math.max(open, close) + upWick) * 100) / 100,
    low: Math.max(1, Math.round((Math.min(open, close) - downWick) * 100) / 100),
    close,
    // 当日供需失衡比，界面直接显示成「抽走 / 还回」的净比例。
    imbalance: Math.round(imbalance * 10000) / 10000,
    move: Math.round(change * 10000) / 10000,
  }
}

// 零点结算：把「昨天及更早」的待结算桶逐日结算成日线。
// 玩家离线几天后再回来，这里会补算出每一天的日线，价格按天连续演进，不会跳空。
// 结算后的日线永久保留 historyDays 天，供界面回看。
export function settleFxDays(state, now = Date.now()) {
  const config = fxConfig(state)
  const today = fxDayIndex(now, config.dayMs)
  const buckets = state?.fx?.today || {}
  const days = { ...(state?.fx?.days || {}) }
  // 已结算日的时间桶单独存放：日线本身仍是紧凑数组，不把 288 格塞进每根日线。
  const binHistory = { ...(state?.fx?.bins || {}) }
  const dueDays = [...new Set(Object.values(buckets).map((bucket) => Number(bucket?.day)).filter((day) => Number.isFinite(day) && day < today))]
  // 没有待结算数据的日期也要推进价格吗？不用：没有结算的日子价格不变，
  // 缺的日线由 fxHistory 按前收盘补平，界面不会出现断档。
  if (!dueDays.length) return state
  dueDays.sort((a, b) => a - b)
  dueDays.forEach((day) => {
    Object.keys(TRAITS_BY_ID).forEach((name) => {
      const bucket = buckets[name]
      const meta = config.traits[name] || DEFAULT_FX_TRAITS[name]
      if (!meta) return
      // 落库格式是紧凑数组，先解码成对象再算，避免混用两种形态。
      const list = Array.isArray(days[name]) ? days[name].map(decodeBar) : []
      // 前收盘：最近一根早于该日的日线，没有就用基准价。
      const prev = list.filter((bar) => Number(bar.day) < day).sort((a, b) => Number(a.day) - Number(b.day)).at(-1)
      const prevClose = prev ? Number(prev.close) || meta.price : meta.price
      const mine = bucket && Number(bucket.day) === day ? bucket : null
      const net = Number(mine?.net) || 0
      const volume = Number(mine?.volume) || 0
      const move = mine ? fxDayMove(net, volume, prevClose, meta.price, meta, config) : -config.reversion * (prevClose / meta.price - 1)
      const bar = {
        day,
        net: Math.round(net * 100) / 100,
        volume,
        ...fxDayBar(prevClose, net, volume, move, config),
      }
      // 把这一天的真实成交时间桶搬到已结算日的历史里。
      const bins = mine ? normalizeFxBins(mine.bins) : []
      if (bins.length) binHistory[name] = { ...(binHistory[name] || {}), [day]: bins }
      const kept = list.filter((item) => Number(item.day) !== day)
      days[name] = [...kept, bar]
        .sort((a, b) => Number(a.day) - Number(b.day))
        .map(encodeBar)
    })
  })
  // 日线保留一年（365 天）。用紧凑数组存，8 个标的 × 365 天 ≈ 70 KB，
  // localStorage 毫无压力；如果按对象存会到 0.35 MB，体积差 5 倍。
  const keepDays = FX_KEEP_DAYS
  Object.keys(days).forEach((name) => {
    // 落库是紧凑数组，第一列就是 day，不能再按 bar.day 读。
    days[name] = days[name]
      .filter((bar) => Number(Array.isArray(bar) ? bar[0] : bar.day) > today - keepDays)
      .sort((a, b) => Number(Array.isArray(a) ? a[0] : a.day) - Number(Array.isArray(b) ? b[0] : b.day))
  })
  // 时间桶只留最近 30 天；更早的日线退回 U 型曲线，不再为图表保存逐格数据。
  Object.keys(binHistory).forEach((name) => {
    const kept = Object.fromEntries(Object.entries(binHistory[name] || {})
      .filter(([day, bins]) => Number(day) > today - FX_BIN_KEEP_DAYS && normalizeFxBins(bins).length))
    if (Object.keys(kept).length) binHistory[name] = kept
    else delete binHistory[name]
  })
  // 只清掉已结算的日期；今天新产生的桶（零点后的成交）必须保留。
  const keptToday = Object.fromEntries(Object.entries(buckets)
    .filter(([, bucket]) => Number(bucket?.day) >= today))
  return { ...state, fx: { ...(state.fx || {}), days, today: keptToday, bins: binHistory } }
}

// 当前价 = 昨天的收盘 + 今天已走完的分钟。
// 日线只在零点落库，但价格要按分钟动，所以这里把当天的分钟路径走到「现在」。
export function fxMidPrice(state, name, now = Date.now()) {
  const config = fxConfig(state)
  const meta = config.traits[name] || DEFAULT_FX_TRAITS[name]
  if (!meta) return 0
  const today = fxDayIndex(now, config.dayMs)
  const history = fxHistory(state, name)
  // 已经落库的日线只取今天之前的，避免和分钟路径重复计算。
  const settled = history.filter((bar) => Number(bar.day) < today)
  const lastClose = settled.length ? Number(settled[settled.length - 1].close) || meta.price : meta.price
  const path = fxMinutePath(state, name, today, now)
  if (!path.minutes.length || !path.settledCount) return lastClose
  const walked = path.minutes[path.settledCount - 1]
  return Number(walked.close) || lastClose
}

// 报价：买价上浮半个价差，卖价下浮半个价差，价差进交易所，不返还玩家。
// 低价材料上四舍五入会把价差抹成 0（买卖同价即可无风险套利），所以买价向上取、卖价向下取，
// 并保证至少留 1 点的点差。
export function fxQuote(state, name, now = Date.now()) {
  const config = fxConfig(state)
  const mid = fxMidPrice(state, name, now)
  const half = config.spread / 2
  const sell = Math.max(1, Math.floor(mid * (1 - half)))
  const buy = Math.max(sell + 1, Math.ceil(mid * (1 + half)))
  const meta = config.traits[name] || DEFAULT_FX_TRAITS[name]
  const base = meta?.price || 0
  const history = fxHistory(state, name)
  const last = history[history.length - 1]
  const today = fxToday(state, name, now)
  return {
    name,
    mid: Math.round(mid * 100) / 100,
    buy,
    sell,
    base,
    // 当日涨跌幅：已结算日线的 move（零点后当天不变）。
    change: last ? Number(last.move) || 0 : 0,
    // 相对基准价的累计涨跌。
    total: base ? (mid - base) / base : 0,
    // 今天还没结算的净流入与结算量，界面显示成「今日待结算」。
    todayNet: Math.round(today.net * 100) / 100,
    todayVolume: today.volume,
    // 成交价差：买价 - 卖价，用作界面上的「点差」提示。
    pointSpread: buy - sell,
    lastCloseAt: last ? fxDayClose(Number(last.day), config.dayMs) : null,
  }
}

export function fxQuotes(state, now = Date.now()) {
  return Object.keys(TRAITS_BY_ID).map((name) => ({ ...fxQuote(state, name, now), meta: TRAITS_BY_ID[name] }))
}

// 持仓按「份」记账：1 份 = 1 个材料等值，买卖都只结算鱼币，永不增减背包材料。
export function fxPosition(state, name) {
  return Math.max(0, Math.floor(Number(state?.fx?.positions?.[name]) || 0))
}

export function fxPortfolioValue(state, now = Date.now()) {
  return Object.keys(TRAITS_BY_ID).reduce((sum, name) => sum + fxPosition(state, name) * fxQuote(state, name, now).sell, 0)
}

// 结算只写进「今天的待结算桶」，不改价格；零点统一结算成一根日线。
// 这样无论玩家一天里兑多少次、什么时候兑，都只影响当天那一根日线，7 天行情始终可回看。
// 买入卖出本身不产生流水，避免自成交拉盘。
// 每一笔流水同时记进 5 分钟时间桶，日内走势据此按真实成交时间铺开。
export function fxAppendFlow(state, entries, now = Date.now()) {
  if (!entries.length) return state
  const config = fxConfig(state)
  const today = fxDayIndex(now, config.dayMs)
  const buckets = { ...(state.fx?.today || {}) }
  entries.forEach(({ name, net, volume, bins }) => {
    if (!Number.isFinite(net)) return
    const existing = buckets[name] && Number(buckets[name].day) === today ? buckets[name] : { day: today, net: 0, volume: 0 }
    const flowVolume = Number.isFinite(Number(volume)) ? Math.max(0, Number(volume)) : Math.abs(Number(net) || 0)
    // 上游（离线补算）可能已经带上精确时间桶；没有就按这次结算的时刻记一格。
    const additions = Array.isArray(bins) && bins.length
      ? bins
      : [[fxBinSlot(now, config.dayMs), Number(net) || 0, flowVolume]]
    buckets[name] = {
      day: today,
      net: Math.round((Number(existing.net) + (Number(net) || 0)) * 100) / 100,
      // volume 记成交总量（上钩 + 卖出），用来算失衡比。
      volume: (Number(existing.volume) || 0) + flowVolume,
      bins: mergeFxBins(existing.bins, additions),
    }
  })
  return { ...state, fx: { ...(state.fx || {}), today: buckets } }
}

// ---- 词条供给：深海FX 的价格信号来源 ----

// 上钩：鱼身上的词条被玩家抽离市场，所以供给减少 → 记正流入。
// 数量就是这条鱼实际带的词条数，没有任何统计模型，也就不存在模型误差。
// 同一条鱼里一个词条最多出现一次，所以这里只可能记 +1。
export function fxBiteFlow(fish) {
  const list = Array.isArray(fish?.traits) ? fish.traits : []
  if (!list.length) return []
  const counts = new Map()
  list.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1))
  return [...counts.entries()].map(([name, qty]) => ({ name, net: qty, volume: qty }))
}

// 卖出：鱼交给商会，身上的词条重新流回市场，所以供给增加 → 记负流入。
// 和 fxBiteFlow 严格对称：同一条鱼钓上来又卖出去，净影响正好是 0。
export function fxExchangeFlow(fish) {
  const list = Array.isArray(fish?.traits) ? fish.traits : []
  if (!list.length) return []
  const counts = new Map()
  list.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1))
  return [...counts.entries()].map(([name, qty]) => ({ name, net: -qty, volume: qty }))
}

// 买入：按买价扣鱼币，得到份数。// 买入：按买价扣鱼币，得到份数。手续费单独扣，所以实际花费 = 价格 + 手续费。
export function fxBuy(state, name, qty, now = Date.now()) {
  // 收市期间不接受委托：价格已定但不可成交，等下一个交易日 08:00 开盘。
  if (!fxCanTrade(state, now)) return state
  const config = fxConfig(state)
  const quote = fxQuote(state, name, now)
  const amount = Math.max(0, Math.floor(Number(qty) || 0))
  if (!amount || !quote.buy) return state
  const held = fxPosition(state, name)
  const affordable = Math.floor(Math.max(0, Number(state.coins) || 0) / (quote.buy * (1 + config.feeRate)))
  const allowed = Math.min(amount, config.maxPosition - held, affordable)
  if (allowed <= 0) return state
  const gross = allowed * quote.buy
  const fee = Math.ceil(gross * config.feeRate)
  return {
    ...state,
    coins: Math.max(0, (Number(state.coins) || 0) - gross - fee),
    fx: {
      ...(state.fx || {}),
      positions: { ...(state.fx?.positions || {}), [name]: held + allowed },
      trades: [{ id: `fx-${now}-${Math.random().toString(36).slice(2, 7)}`, side: 'buy', name, qty: allowed, price: quote.buy, fee, at: stamp() }, ...(state.fx?.trades || [])].slice(0, 60),
    },
  }
}

// 卖出：按卖价结算鱼币，份数扣减。手续费从成交额里扣。
export function fxSell(state, name, qty, now = Date.now()) {
  if (!fxCanTrade(state, now)) return state
  const config = fxConfig(state)
  const quote = fxQuote(state, name, now)
  const held = fxPosition(state, name)
  const amount = Math.min(Math.max(0, Math.floor(Number(qty) || 0)), held)
  if (!amount || !quote.sell) return state
  const gross = amount * quote.sell
  const fee = Math.ceil(gross * config.feeRate)
  return {
    ...state,
    coins: Math.max(0, (Number(state.coins) || 0) + Math.max(0, gross - fee)),
    fx: {
      ...(state.fx || {}),
      positions: { ...(state.fx?.positions || {}), [name]: held - amount },
      trades: [{ id: `fx-${now}-${Math.random().toString(36).slice(2, 7)}`, side: 'sell', name, qty: amount, price: quote.sell, fee, at: stamp() }, ...(state.fx?.trades || [])].slice(0, 60),
    },
  }
}

// 行情走势：直接把日线收盘价铺成曲线，最多 historyDays + 1 个点。
// 日线是零点结算后落库的，所以曲线不会因为刷新页面或晚点开奖而跳变。
export function fxTrend(state, name, now = Date.now(), points = 0) {
  const config = fxConfig(state)
  const meta = config.traits[name] || DEFAULT_FX_TRAITS[name]
  if (!meta) return []
  const history = fxHistory(state, name)
  const bars = points > 0 ? history.slice(-points) : history
  return bars.map((bar) => ({ at: fxDayClose(Number(bar.day), config.dayMs), price: Number(bar.close) || meta.price, move: Number(bar.move) || 0, day: Number(bar.day) }))
}

// 7 天行情表：每个标的的日线序列，附带每日涨跌幅与相对基准价的变化。
// 界面用它画多标的对比图与逐日明细。
// 把日线聚合成周线：同一 ISO 周内的开高低收合并，成交量与净流入累加。
// 周线需要更长的历史，所以这里不裁剪到 historyDays，而是用 fxHistory 的原始日线
// 按周分组，最后取最近的 weeks 根。
function fxWeekBars(dayBars, weeks) {
  const groups = new Map()
  dayBars.forEach((bar) => {
    // 周序号：以本地周一为一周起点。
    const date = new Date(fxDayStart(Number(bar.day)))
    const weekday = (date.getDay() + 6) % 7
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekday)
    const key = Math.floor(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()) / (7 * FX_DAY_MS))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(bar)
  })
  const keys = [...groups.keys()].sort((a, b) => a - b).slice(-weeks)
  return keys.map((key) => {
    const list = groups.get(key).slice().sort((a, b) => Number(a.day) - Number(b.day))
    const open = Number(list[0].open) || Number(list[0].close) || 0
    const close = Number(list[list.length - 1].close) || open
    const high = Math.max(...list.map((bar) => Number(bar.high) || Number(bar.close) || 0))
    const low = Math.min(...list.map((bar) => Number(bar.low) || Number(bar.close) || 0))
    const volume = list.reduce((sum, bar) => sum + (Number(bar.volume) || 0), 0)
    const net = list.reduce((sum, bar) => sum + (Number(bar.net) || 0), 0)
    return {
      week: key,
      from: Number(list[0].day),
      to: Number(list[list.length - 1].day),
      open,
      high,
      low,
      close,
      volume,
      net,
      imbalance: volume > 0 ? clamp(net / volume, -1, 1) : 0,
      move: open > 0 ? close / open - 1 : 0,
      days: list.length,
    }
  })
}

export function fxBoard(state, now = Date.now()) {
  const config = fxConfig(state)
  const today = fxDayIndex(now, config.dayMs)
  const dayList = Array.from({ length: config.historyDays }, (_, index) => today - config.historyDays + index + 1)
  return {
    days: dayList,
    rows: Object.keys(TRAITS_BY_ID).map((name) => {
      const meta = config.traits[name] || DEFAULT_FX_TRAITS[name]
      const history = fxHistory(state, name)
      const byDay = new Map(history.map((bar) => [Number(bar.day), bar]))
      // 今天还没结算：用盘中现价（前收盘 + 已走完的分钟），
      // 绝不能拿基准价补平——那会在图上画出一根瞬间暴跌的假阳线。
      const live = fxMidPrice(state, name, now)
      const livePath = dayList.includes(today) ? fxMinutePath(state, name, today, now) : null
      const liveMinutes = livePath ? livePath.minutes.filter((item) => item.settled) : []
      const bars = dayList.map((day) => {
        const bar = byDay.get(day)
        if (bar) {
          return {
            day,
            move: Number(bar.move) || 0,
            open: Number(bar.open) || Number(bar.close) || meta.price,
            high: Number(bar.high) || Number(bar.close) || meta.price,
            low: Number(bar.low) || Number(bar.close) || meta.price,
            close: Number(bar.close) || meta.price,
            net: Number(bar.net) || 0,
            volume: Number(bar.volume) || 0,
            // 供需失衡比：(上钩 − 卖出) / (上钩 + 卖出)，+1 全是钓获、−1 全是卖出。
            imbalance: Number(bar.imbalance) || 0,
            settled: true,
          }
        }
        if (day === today) {
          // 未结算的今天：开盘取前收盘，高低取已走完分钟的极值，成交量取待结算桶。
          const prev = history.filter((item) => Number(item.day) < day).at(-1)
          const open = prev ? Number(prev.close) || meta.price : meta.price
          const volume = Number(fxToday(state, name, now)?.volume) || 0
          return {
            day,
            move: open > 0 ? live / open - 1 : 0,
            open,
            high: liveMinutes.length ? Math.max(...liveMinutes.map((item) => item.high), live) : Math.max(open, live),
            low: liveMinutes.length ? Math.min(...liveMinutes.map((item) => item.low), live) : Math.min(open, live),
            close: live,
            net: Number(fxToday(state, name, now)?.net) || 0,
            volume,
            imbalance: volume > 0 ? clamp((Number(fxToday(state, name, now)?.net) || 0) / volume, -1, 1) : 0,
            settled: false,
          }
        }
        // 窗口里更早的空白日（那天确实没成交）：平在前收盘上，不留空洞。
        const prev = history.filter((item) => Number(item.day) < day).at(-1)
        const close = prev ? Number(prev.close) || meta.price : meta.price
        return { day, move: 0, open: close, high: close, low: close, close, net: 0, volume: 0, imbalance: 0, settled: false }
      })
      const closes = bars.map((bar) => bar.close)
      const first = closes.find((value) => value > 0) || meta.price
      const last = closes[closes.length - 1] || meta.price
      return {
        name,
        meta: TRAITS_BY_ID[name],
        price: meta.price,
        bars,
        // 日 K 图用完整保留的一年日线，不受「最近 N 天」报价窗口限制，
        // 否则只有 7 根，缩放和拖动都没意义。
        allBars: history.map((bar) => ({
          day: Number(bar.day),
          open: Number(bar.open) || Number(bar.close),
          high: Number(bar.high) || Number(bar.close),
          low: Number(bar.low) || Number(bar.close),
          close: Number(bar.close),
          net: Number(bar.net) || 0,
          volume: Number(bar.volume) || 0,
          imbalance: Number(bar.imbalance) || 0,
          move: Number(bar.move) || 0,
          settled: true,
        })),
        // 周 K 用完整日线聚合：一年能聚出 50 多根，取最近 52 根够看一年。
        weeks: fxWeekBars(history, 52),
        close: last,
        // 7 天累计涨跌。
        weekChange: first ? (last - first) / first : 0,
        // 当天还没结算的量。
        today: fxToday(state, name, now),
      }
    }),
  }
}


// ---- 后台：昨日影响 + 今日结算预览 ----
//
// 后台需要能回答两个问题，而且必须和真正落库的日线对得上：
//   1) 昨天到底发生了什么，它把今天的开盘价推到了哪里；
//   2) 如果现在收市，今天这根日线会结算成什么。
//
// 第 1 个问题只读已结算日线；第 2 个问题复用 fxDayMove + fxDayBar，
// 和 settleFxDays 走同一段代码，所以「预览价」就是零点真正写入 fx_days 的价格。
// 唯一的差别是时间：预览用的是「此刻的待结算桶」，结算用的是零点那一刻的桶。
export function fxSettlementPreview(state, now = Date.now()) {
  const config = fxConfig(state)
  const today = fxDayIndex(now, config.dayMs)
  const yesterday = today - 1
  const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100

  const rows = Object.keys(TRAITS_BY_ID).map((name) => {
    const meta = config.traits[name] || DEFAULT_FX_TRAITS[name]
    const history = fxHistory(state, name)
    const byDay = new Map(history.map((bar) => [Number(bar.day), bar]))
    const todayBar = byDay.get(today) || null
    const yesterdayBar = byDay.get(yesterday) || null
    // 昨收 = 今天之前最后一根日线的收盘价。它同时也是今天的开盘价：
    // 结算公式里 open 永远等于前收，所以「昨日对今日的影响」就是这一根收盘。
    const lastBefore = history.filter((bar) => Number(bar.day) < today).at(-1)
    const todayOpen = Number(lastBefore?.close) || meta.price
    // 昨日自己的开盘价：再往前一根的收盘。没有就用基准价。
    const beforeYesterday = history.filter((bar) => Number(bar.day) < yesterday).at(-1)
    const yesterdayOpen = Number(beforeYesterday?.close) || meta.price

    const bucket = fxToday(state, name, now)
    const net = todayBar ? Number(todayBar.net) || 0 : bucket.net
    const volume = todayBar ? Number(todayBar.volume) || 0 : bucket.volume
    // 已结算的今天（正常不会出现）直接用落库值；否则按此刻的桶预测。
    const rawMove = todayBar ? Number(todayBar.move) || 0 : fxDayMove(net, volume, todayOpen, meta.price, meta, config)
    const projected = todayBar
      ? { open: Number(todayBar.open) || todayOpen, high: Number(todayBar.high) || todayOpen, low: Number(todayBar.low) || todayOpen, close: Number(todayBar.close) || todayOpen, move: Number(todayBar.move) || 0, imbalance: Number(todayBar.imbalance) || 0 }
      : fxDayBar(todayOpen, net, volume, rawMove, config)
    // 昨日影响今天的原始数据：昨天那 288 个 5 分钟格里的净额与成交量。
    // 这是「为什么今天开在这里」的唯一一手证据——日线只是一天的汇总，
    // 后台需要看到资金是早上流入还是尾盘出货，才能判断该不该干预。
    const yesterdayBins = fxDayBins(state, name, yesterday)
    // 把稀疏桶铺成完整时间序列，界面直接画柱状图，不用再补空洞。
    const slots = fxBinCount(config.dayMs)
    const binSeries = Array.from({ length: slots }, (_, slot) => {
      const hit = yesterdayBins.find((bin) => Number(bin[0]) === slot)
      return {
        slot,
        // 该格对应的本地时刻，柱状图的横轴用它。
        at: fxDayStart(yesterday, config.dayMs) + slot * FX_BIN_MS,
        net: Number(hit?.[1]) || 0,
        volume: Number(hit?.[2]) || 0,
      }
    })
    // 逐格数据是后来才加的：更早的流水只有日线汇总，没有时间桶。
    // 这里算出「桶覆盖了日线的多少」，界面据此提示「柱状图不完整」，
    // 而不是让管理员把 953 当成昨天的全部净额（真实是 1953）。
    const binNet = binSeries.reduce((sum, bin) => sum + bin.net, 0)
    const binVolume = binSeries.reduce((sum, bin) => sum + bin.volume, 0)
    const dayNet = Math.abs(Number(yesterdayBar?.net) || 0)
    const dayVolume = Math.abs(Number(yesterdayBar?.volume) || 0)
    // 覆盖率取净额与成交量两项里较小的那个：任一项缺失都说明桶不完整。
    const coverage = dayVolume > 0 || dayNet > 0
      ? Math.min(1, Math.min(dayNet > 0 ? Math.abs(binNet) / dayNet : 1, dayVolume > 0 ? binVolume / dayVolume : 1))
      : 1
    const live = fxMidPrice(state, name, now)
    // 涨跌幅对外统一用「收盘 / 开盘 − 1」：fxHistory 解码紧凑日线时就是这么算的，
    // 直接用 fxDayBar 里那个未取整的 move 会和玩家看到的 K 线差最后一位。
    const move = projected.open > 0 ? projected.close / projected.open - 1 : 0
    // 涨跌停：fxDayMove 会把结果夹在 dailyLimit 内，所以这里单独算一遍「未夹住的涨幅」，
    // 两者不一致就说明今天已经顶到停板，后台需要能一眼看出来。
    const limit = Math.max(0.001, Number(config.dailyLimit) || 0.1)
    const imbalance = volume > 0 ? clamp(net / volume, -1, 1) : 0
    const anchor = meta.price > 0 && todayOpen > 0 ? todayOpen / meta.price - 1 : 0
    const unclamped = imbalance * config.volatility * Math.max(0.1, Number(meta.sensitivity) || 1) - config.reversion * anchor
    return {
      name,
      label: TRAITS_BY_ID[name]?.label || name,
      icon: TRAITS_BY_ID[name]?.icon || '·',
      color: TRAITS_BY_ID[name]?.color || '#65758b',
      base: meta.price,
      // 昨日：结算后的真实记录，以及它给今天留下的开盘价。
      yesterday: {
        day: yesterday,
        settled: Boolean(yesterdayBar),
        net: round2(yesterdayBar?.net),
        volume: Math.max(0, Number(yesterdayBar?.volume) || 0),
        // move / imbalance 不在这里取整：fxHistory 解码紧凑日线时也不取整，
        // 两边保留同一份精度，后台核对时不会出现「差最后一位」的假差异。
        imbalance: Number(yesterdayBar?.imbalance) || 0,
        move: Number(yesterdayBar?.move) || 0,
        open: round2(yesterdayBar?.open ?? yesterdayOpen),
        close: round2(yesterdayBar?.close ?? todayOpen),
        // 相对基准价的偏离：均值回归的拉力来源。
        premium: meta.price > 0 ? (Number(yesterdayBar?.close ?? todayOpen) - meta.price) / meta.price : 0,
        // 昨日逐格的原始流水（5 分钟一格），供后台画柱状图。
        bins: binSeries,
        // 有成交的格数：用来区分「全天没量」和「只在某一格爆量」。
        activeBins: binSeries.filter((bin) => bin.net || bin.volume).length,
        // 桶覆盖率：1 = 逐格数据完整；<1 = 这天有一部分流水没有时间桶（功能上线前的旧数据）。
        // 界面据此把柱状图标成「不完整」，避免管理员把部分当成全部。
        coverage: Math.round(coverage * 1000) / 1000,
        // 没有时间桶的那部分净额：日线汇总减去逐格之和。
        // 柱状图下方用它补一句「另有 N 未记录时刻」，数字才对得上。
        untrackedNet: Math.round(((Number(yesterdayBar?.net) || 0) - binNet) * 100) / 100,
        untrackedVolume: Math.max(0, Math.round(((Number(yesterdayBar?.volume) || 0) - binVolume) * 100) / 100),
      },
      today: {
        day: today,
        open: round2(todayOpen),
        live: round2(live),
        // 今开 = 昨收，所以这一项就是「昨日影响」的落点。
        openGap: yesterdayOpen > 0 ? todayOpen / yesterdayOpen - 1 : 0,
        // 均值回归：昨天留下的偏离会让今天凭空多出这一份涨跌幅（没有成交也会动）。
        // 后台看「今天为什么平白涨/跌」时，答案通常在这一列。
        reversion: -config.reversion * anchor,
        net: round2(net),
        volume: Math.max(0, Number(volume) || 0),
        imbalance,
        move,
        close: round2(projected.close),
        high: round2(projected.high),
        low: round2(projected.low),
        // 距结算还差多少：正数表示收盘还要往上走。
        remaining: live > 0 ? projected.close / live - 1 : 0,
        // 相对基准价的累计涨跌，和 fxQuote.total 同口径。
        total: meta.price > 0 ? (projected.close - meta.price) / meta.price : 0,
        // 顶到涨跌停：说明这一天的供需已经极端，后台可能需要人工干预。
        limitHit: Math.abs(unclamped) > limit + 1e-9,
        settled: Boolean(todayBar),
      },
    }
  })

  const sum = (pick) => rows.reduce((acc, row) => acc + pick(row), 0)
  return {
    day: today,
    yesterday,
    // 结算时刻 = 今天这根日线落库的零点。
    settlesAt: fxDayClose(today, config.dayMs),
    session: fxSession(state, now),
    rows,
    totals: {
      yesterdayNet: round2(sum((row) => row.yesterday.net)),
      yesterdayVolume: Math.max(0, round2(sum((row) => row.yesterday.volume))),
      yesterdayTraded: rows.filter((row) => row.yesterday.volume > 0).length,
      yesterdayUp: rows.filter((row) => row.yesterday.move > 0).length,
      yesterdayDown: rows.filter((row) => row.yesterday.move < 0).length,
      todayNet: round2(sum((row) => row.today.net)),
      todayVolume: Math.max(0, round2(sum((row) => row.today.volume))),
      todayTraded: rows.filter((row) => row.today.volume > 0).length,
      todayUp: rows.filter((row) => row.today.move > 0).length,
      todayDown: rows.filter((row) => row.today.move < 0).length,
      limitHits: rows.filter((row) => row.today.limitHit).length,
    },
  }
}


// 旧版深海词条的默认效果。后台或存档里的效果与它完全一致时，升级到新的预设；
// 只要管理员改过任何一项，就原样保留，避免覆盖自定义配置。
const LEGACY_TRAIT_EFFECTS = {
  swift: [{ type: 'tensionRate', mode: 'multiply', value: 0.88 }],
  armored: [{ type: 'loss', mode: 'add', value: 4 }, { type: 'maxTension', mode: 'multiply', value: 1.08 }],
  heavy: [{ type: 'loss', mode: 'add', value: 6 }, { type: 'tensionJitter', mode: 'add', value: 0.18 }],
  ancient: [{ type: 'maxTension', mode: 'multiply', value: 1.15 }, { type: 'tensionDelay', mode: 'add', value: 180 }],
  surge: [{ type: 'chargeJitter', mode: 'add', value: 0.32 }, { type: 'tensionRate', mode: 'multiply', value: 1.08 }],
  abyssal: [{ type: 'tensionRate', mode: 'multiply', value: 1.12 }, { type: 'tensionJitter', mode: 'add', value: 0.42 }],
  prismatic: [{ type: 'maxTension', mode: 'multiply', value: 0.88 }, { type: 'chargeRate', mode: 'multiply', value: 0.9 }, { type: 'chargeJitter', mode: 'add', value: 0.36 }],
}

function upgradeTraitPreset(trait) {
  const legacy = LEGACY_TRAIT_EFFECTS[trait.id]
  const preset = TRAITS.find((item) => item.id === trait.id)
  if (!legacy || !preset) return trait
  const effects = Array.isArray(trait.effects) ? trait.effects : []
  const same = effects.length === legacy.length && effects.every((effect, index) => (
    effect.type === legacy[index].type
    && effect.mode === legacy[index].mode
    && Math.abs(Number(effect.value) - Number(legacy[index].value)) < 1e-9
  ))
  return same ? { ...trait, effects: preset.effects.map((effect) => ({ ...effect })) } : trait
}

// ───────────────────────── 逐个解锁（新手引导） ─────────────────────────
//
// 设计要点：
// - 只锁「左侧导航页签」的可见性，页内按钮不做门槛；
// - 严格串行：从第一步开始逐层检查，遇到第一个没满足的就停下，不跳级；
// - 判定是纯函数（从 state 里的统计与背包推导），服务端每轮 sync 调一次 advanceGuide，
//   天然幂等，不需要在几十个动作里逐个埋点；
// - 所有提示只显示一次（seen），介绍卡 3 秒后才允许关闭（minCloseMs）；
// - enabled=false 等价于全部解锁，后台可以一键退回旧行为。
export const GUIDE_STEP_IDS = ['tension', 'npc', 'rodUpgrade', 'scratch', 'lottery', 'rodPower', 'fx', 'stats']
// 独立触发的引导卡：不参与串行阶梯，只按自己的条件出现一次。
export const GUIDE_INDEPENDENT_STEPS = ['rodGuide', 'scratchLuck']

// 每张钓竿强化项的「首级实价」之和，就是 L2 要发的材料清单的推导口径。
export const GUIDE_DEFAULT_MIN_CLOSE_MS = 3000
// focus 最多保留几个倒计时锚点（玩家一次跨多级时只留最近的几步）。
const GUIDE_FOCUS_LIMIT = 4

export const DEFAULT_GUIDE = {
  enabled: true,
  minCloseMs: GUIDE_DEFAULT_MIN_CLOSE_MS,
  steps: [
    { id: 'tension', copy: '', card: true },
    { id: 'npc', minCatches: 1, card: false },
    { id: 'rodUpgrade', minSold: 1, grantCoins: 1000, grantMaterials: null, card: true },
    { id: 'scratch', minScratchEarned: 3, card: true },
    { id: 'lottery', minTicketsEarned: 3, card: false },
    // L5 要玩家真的升过一次天赋，而不是「买得起」就过——否则材料一够就会级联全开。
    // L5：真的把钓竿强化过一次（替代原天赋页）。
    { id: 'rodPower', minRodUpgrades: 1, requires: ['scratch', 'lottery'], card: false },
    { id: 'fx', requires: ['rodPower'], grantCoins: 10000, card: true },
    { id: 'stats', requires: ['fx'], card: false },
    // 独立触发：第一次进入某个页签时展示一次，不参与层级串行。
    // 钓竿页已删除：这张说明卡改在第一次进钓鱼页时出现。
    { id: 'rodGuide', trigger: 'enterTab:fishing', card: true },
    // 刮开 10 张后告知「每 10 张升级」：同样独立触发，不参与串行。
    { id: 'scratchLuck', trigger: 'scratchCount:10', card: true },
  ],
}

// 引导里所有可见文案都放在配置里，后台改字不用发版。
export const DEFAULT_GUIDE_COPY = {
  tension: '张力条就是倒计时：进度充满前，上方张力会一直上涨；张力先满就会脱钩——这条鱼跑掉，耐久也会掉一些。想让鱼先到手，就去钓竿页把「钓鱼速度」和「最大张力」升上去。',
  rodUpgrade: '升级用的材料已经放进背包：浮木纤维、潮汐树脂、渊核碎片、深蓝晶片各一份，另外还有 1000 鱼币。先去钓竿页把「钓鱼速度」升一级，再升一级「最大张力」，脱钩会明显变少。',
  scratch: '刮刮乐是材料的主要来源：三格中出现两个相同奖励就能兑奖，产出的浮木纤维、潮汐树脂、深蓝晶片正是钓竿强化的原料。刮到 45% 会自动翻牌，不用刮满。',
  npc: '潮汐商会负责收购鱼获：鱼会占仓库，仓库满了就钓不动了，记得回来卖掉。卖鱼还会附赠刮刮乐和空白彩票。',
  lottery: '彩票是鱼币的主要来源。用空白彩票合成号码票，开奖命中越多奖励越好，高级场还能开出锁钥与更好的钓竿。',
  rodPower: '钓竿才是长期成长：点右侧耐久条打开钓竿面板，速度、耐久、最大张力、自动维修都在那里升级，材料来自刮刮乐与彩票。',
  fx: '深海FX 已开启，并已发放 10000 鱼币。你钓上来的每一个词条都是一个可交易的标的——上钩会让它变少（涨价），卖出会让它变多（跌价）。',
  stats: '中奖统计汇总了你的上钩、兑奖与各奖池命中分布，用来回看运气。',
  rodGuide: '钓竿分三种来路：开局的「潮痕 · 初阶」自带；「苍蓝 · 进阶」「无光 · 深渊」来自彩票；「无灯 · 黑市」要等解锁海沟后用黑市渔币买。点右侧的耐久条可以打开钓竿面板——在那里换竿、强化、维修，材料也列在最下方。',
  scratchLuck: '刮层直觉：每刮开 10 张，自动翻牌阈值会降低、刮除半径会变大，最高 20 级。当前等级和进度就显示在刮刮乐页顶部。',
  seaHint: '越往深处，词条越稀有，需要解锁的材料越高级；更多功能也会随海域一同解锁。',
  seaProduce: '这一片海主要出土：{materials}',
}

const guideClamp = (value, min, max, fallback = min) => {
  const n = Number(value)
  const v = Number.isFinite(n) ? n : fallback
  return Math.min(max, Math.max(min, v))
}

// 引导材料只允许 MATERIALS 白名单里的键，数量 clamp 到 0..9999；未知键丢弃。
export function normalizeGuideMaterials(raw) {
  if (!raw || typeof raw !== 'object') return null
  const entries = Object.entries(raw)
    .filter(([name]) => Object.prototype.hasOwnProperty.call(MATERIALS, name))
    .map(([name, qty]) => [name, Math.round(guideClamp(qty, 0, 9999, 0))])
    .filter(([, qty]) => qty > 0)
  return entries.length ? Object.fromEntries(entries) : null
}

export function normalizeGuideConfig(raw) {
  const base = DEFAULT_GUIDE
  const source = raw && typeof raw === 'object' ? raw : {}
  const rawSteps = Array.isArray(source.steps) ? source.steps : []
  const byId = new Map()
  rawSteps.forEach((step) => {
    if (step && GUIDE_STEP_IDS.includes(step.id)) byId.set(step.id, step)
    // 独立触发的步骤单独按 id 收进来，不参与串行。
    if (GUIDE_INDEPENDENT_STEPS.includes(step?.id)) byId.set(step.id, step)
  })
  // 文案统一收在 copy 表里（后台只改一处），这里先解析出来供每一步回退使用。
  const copyTable = { ...DEFAULT_GUIDE_COPY }
  if (source.copy && typeof source.copy === 'object') {
    Object.keys(DEFAULT_GUIDE_COPY).forEach((key) => {
      if (typeof source.copy[key] === 'string' && source.copy[key].trim()) copyTable[key] = source.copy[key].slice(0, 800)
    })
  }
  // 顺序固定为内置顺序：后台只能改阈值与文案，不能靠乱序让玩家跳级。
  const ordered = [...GUIDE_STEP_IDS.map((id) => id), ...GUIDE_INDEPENDENT_STEPS]
  const steps = ordered.map((id) => {
    const fallback = base.steps.find((step) => step.id === id) || { id }
    const raw = byId.get(id) || {}
    const requires = Array.isArray(raw.requires)
      ? raw.requires.filter((dep) => typeof dep === 'string' && ordered.indexOf(dep) >= 0 && ordered.indexOf(dep) < ordered.indexOf(id))
      : (fallback.requires || [])
    return {
      id,
      // 单步文案留空表示「用 copy 表里的那一份」。
      // 不能在这里回退成默认文案：归一化会把默认值固化进 steps，
      // 后台之后改 copy 表就被这份固化值盖住了。
      copy: (typeof raw.copy === 'string' && raw.copy.trim() ? raw.copy : (fallback.copy || '')).slice(0, 800),
      card: raw.card === undefined ? Boolean(fallback.card) : Boolean(raw.card),
      // null / 缺省 = 沿用全局 minCloseMs（前端用 `??` 回退，所以这里必须保留 null 语义）。
      minCloseMs: raw.minCloseMs === undefined || raw.minCloseMs === null || raw.minCloseMs === '' ? null : guideClamp(raw.minCloseMs, 0, 20000, GUIDE_DEFAULT_MIN_CLOSE_MS),
      minCatches: Math.round(guideClamp(raw.minCatches ?? fallback.minCatches ?? 0, 0, 1e6, 0)),
      minSold: Math.round(guideClamp(raw.minSold ?? fallback.minSold ?? 0, 0, 1e6, 0)),
      minScratchEarned: Math.round(guideClamp(raw.minScratchEarned ?? fallback.minScratchEarned ?? 0, 0, 1e6, 0)),
      minTicketsEarned: Math.round(guideClamp(raw.minTicketsEarned ?? fallback.minTicketsEarned ?? 0, 0, 1e6, 0)),
      minCoinsEarned: Math.round(guideClamp(raw.minCoinsEarned ?? fallback.minCoinsEarned ?? 0, 0, 1e9, 0)),
      minRodUpgrades: Math.round(guideClamp(raw.minRodUpgrades ?? fallback.minRodUpgrades ?? 0, 0, 500, 0)),
      grantCoins: Math.round(guideClamp(raw.grantCoins ?? fallback.grantCoins ?? 0, 0, 1e9, 0)),
      grantMaterials: raw.grantMaterials === undefined ? (fallback.grantMaterials || null) : normalizeGuideMaterials(raw.grantMaterials),
      requires,
    }
  })
  return {
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
    minCloseMs: guideClamp(source.minCloseMs ?? base.minCloseMs, 0, 20000, GUIDE_DEFAULT_MIN_CLOSE_MS),
    steps,
    copy: copyTable,
  }
}

export function createGuideState() {
  return { stage: 0, seen: {}, wonAt: {}, skipped: false, granted: {}, focus: {} }
}

export function normalizeGuideState(raw) {
  const base = createGuideState()
  const source = raw && typeof raw === 'object' ? raw : {}
  const seen = {}
  if (source.seen && typeof source.seen === 'object') Object.keys(source.seen).forEach((key) => { if (source.seen[key]) seen[key] = true })
  const wonAt = {}
  if (source.wonAt && typeof source.wonAt === 'object') {
    Object.keys(source.wonAt).forEach((key) => { const value = Number(source.wonAt[key]); if (Number.isFinite(value) && value > 0) wonAt[key] = value })
  }
  const granted = {}
  if (source.granted && typeof source.granted === 'object') Object.keys(source.granted).forEach((key) => { if (source.granted[key]) granted[key] = true })
  const focus = {}
  if (source.focus && typeof source.focus === 'object') {
    Object.keys(source.focus).forEach((key) => {
      const entry = source.focus[key] || {}
      const remaining = Number(entry.remaining)
      const at = Number(entry.at)
      if (Number.isFinite(remaining) && remaining > 0 && Number.isFinite(at) && at > 0) focus[key] = { at, remaining: Math.min(remaining, 20) }
    })
  }
  return {
    ...base,
    stage: Math.round(guideClamp(source.stage ?? 0, 0, GUIDE_STEP_IDS.length, 0)),
    seen,
    wonAt,
    skipped: Boolean(source.skipped),
    granted,
    focus,
  }
}

export function guideStepIndex(stepId) {
  return GUIDE_STEP_IDS.indexOf(stepId)
}

// 导航页签 → 需要的引导步骤。黑市（black-*）不在这里，由 blackUnlocked 单独控制。
// 页签 id → 需要的引导步骤。钓竿页已删除，钓竿相关高亮都落在钓鱼页。
export const GUIDE_TAB_STEP = {
  fishing: 'tension',
  npc: 'npc',
  scratch: 'scratch',
  lottery: 'lottery',
  fx: 'fx',
  stats: 'stats',
}

export function guideStep(state, stepId) {
  const config = normalizeGuideConfig(state?.config?.guide)
  return config.steps.find((step) => step.id === stepId) || null
}

// 某一步在「不计 requires」时是否满足数值门槛。
function guideStepNumbersMet(state, step) {
  if (!step) return false
  const stats = state?.stats || {}
  const inventory = state?.inventory || {}
  if ((Number(stats.totalCatches) || 0) < (step.minCatches || 0)) return false
  // 卖鱼分「走商会兑换」和「走黑市卖出」两条路，任一发生都算卖过。
  if ((Number(stats.totalSold) || 0) + (Number(state?.blackMarket?.stats?.fishSold) || 0) < (step.minSold || 0)) return false
  if ((Number(stats.totalScratchEarned) || 0) < (step.minScratchEarned || 0)) return false
  if ((Number(stats.totalTicketsEarned) || 0) < (step.minTicketsEarned || 0)) return false
  if ((Number(stats.coinsEarned) || 0) < (step.minCoinsEarned || 0)) return false
  // L5 由「钓竿真的强化过一次」触发（天赋系统已删除）。
  if ((step.minRodUpgrades || 0) > 0 && guideRodUpgradeCount(state) < step.minRodUpgrades) return false
  return true
}

// 玩家已经给钓竿升过多少级（所有竿、所有升级项求和）。
// L5 用它作为「真的动手了」的证据：天赋页没了，成长动作改成了强化钓竿。
export function guideRodUpgradeCount(state) {
  const rods = Array.isArray(state?.rods) ? state.rods : []
  return rods.reduce((sum, rod) => sum + Object.values(rod?.levels || {}).reduce((inner, level) => inner + Math.max(0, Math.floor(Number(level) || 0)), 0), 0)
}

// 严格串行推导「当前应到达的阶段」：从 0 开始，只要下一步的数值门槛满足就前进一步，
// 遇到第一个不满足的立即停下。requires 用来表达「L6 必须 L5 完成」这类依赖，
// 因为串行本身就等价于「前一步已完成」，这里额外检查一遍是为了防止后台把某一步的
// 门槛调成 0 之后跳过它。
export function guideTargetStage(state) {
  const config = normalizeGuideConfig(state?.config?.guide)
  if (!config.enabled || state?.guide?.skipped) return GUIDE_STEP_IDS.length
  return guideProgressStage(state, config)
}

function guideProgressStage(state, config) {
  const reached = new Set()
  let stage = 0
  for (let index = 0; index < GUIDE_STEP_IDS.length; index += 1) {
    const step = config.steps.find((item) => item.id === GUIDE_STEP_IDS[index])
    if (!step) break
    const depsOk = (step.requires || []).every((dep) => reached.has(dep))
    if (!depsOk) break
    if (!guideStepNumbersMet(state, step)) break
    reached.add(step.id)
    stage = index + 1
  }
  return stage
}

// 兼容旧调用：直接给「已解锁到第几步」。
export function guideUnlockedStage(state) {
  const saved = Math.max(0, Math.round(Number(state?.guide?.stage) || 0))
  return Math.max(saved, guideTargetStage(state))
}

export function guideUnlocked(state, stepId) {
  const config = normalizeGuideConfig(state?.config?.guide)
  if (!config.enabled || state?.guide?.skipped) return true
  if (GUIDE_INDEPENDENT_STEPS.includes(stepId)) return true
  const index = guideStepIndex(stepId)
  if (index < 0) return true
  return guideUnlockedStage(state) > index
}

// 页签是否可见：钓鱼/设置永远可见；其余按步骤；admin 由角色单独判断。
export function guideTabVisible(state, tabId) {
  const stepId = GUIDE_TAB_STEP[tabId]
  if (!stepId) return true
  return guideUnlocked(state, stepId)
}

// 推进：把 stage 抬到推导值，并在跨过需要发放奖励的步骤时发放一次。
// 返回 { state, changed }；没有任何变化时返回同一个 state 引用。
export function advanceGuide(state, at = Date.now()) {
  if (!state) return { state, changed: false }
  const config = normalizeGuideConfig(state?.config?.guide)
  const guide = normalizeGuideState(state?.guide)
  const target = guideTargetStage({ ...state, guide })
  let next = state
  let changed = false
  const granted = { ...guide.granted }
  // 跳过说明只解除页签限制，进度赠品仍按实际完成的步骤发放。
  const rewardTarget = guide.skipped ? guideProgressStage(state, config) : target
  for (let index = guide.skipped ? 0 : guide.stage; index < rewardTarget; index += 1) {
    const stepId = GUIDE_STEP_IDS[index]
    const step = config.steps.find((item) => item.id === stepId)
    if (!step || granted[stepId]) continue
    const materials = step.grantMaterials || guideDefaultGrantMaterials(step, state?.config || DEFAULT_CONFIG)
    if (!(step.grantCoins > 0) && !materials) { granted[stepId] = true; continue }
    const coins = Math.max(0, Number(next.coins) || 0) + (step.grantCoins || 0)
    const inventory = { ...(next.inventory || {}) }
    Object.entries(materials || {}).forEach(([name, qty]) => { inventory[name] = (Number(inventory[name]) || 0) + qty })
    next = { ...next, coins, inventory }
    granted[stepId] = true
    changed = true
  }
  const stage = Math.max(guide.stage, target)
  if (stage !== guide.stage) changed = true
  if (!changed) return { state, changed: false }
  return { state: { ...next, guide: { ...guide, stage, granted } }, changed: true }
}

// L2 默认发「首级强化实价」的材料：后台没配 grantMaterials 时按当前配置推导，
// 这样改强化价格后，新玩家的赠品会自动跟随（已发过的不追发）。
export function guideDefaultGrantMaterials(step, worldConfig) {
  if (!step || !step.minSold) return null
  const rods = worldConfig?.rods || DEFAULT_CONFIG.rods
  const first = rods.find((rod) => (rod.upgrades || []).length) || rods[0]
  const upgrades = first?.upgrades || []
  if (!upgrades.length) return null
  const totals = {}
  upgrades.forEach((upgrade) => {
    const price = upgradeCostAt(upgrade, 0)
    if (upgrade.material) totals[upgrade.material] = (totals[upgrade.material] || 0) + price.cost
    if (upgrade.secondMaterial) totals[upgrade.secondMaterial] = (totals[upgrade.secondMaterial] || 0) + price.secondCost
  })
  return Object.keys(totals).length ? totals : null
}

// 标记某条引导已读（只显示一次的实现）。
export function markGuideSeen(state, stepId, at = Date.now()) {
  const guide = normalizeGuideState(state?.guide)
  if (!stepId || guide.seen[stepId]) return state
  return { ...state, guide: { ...guide, seen: { ...guide.seen, [stepId]: true }, wonAt: { ...guide.wonAt, [stepId]: Number(at) || Date.now() } } }
}

// 点「跳过引导」：个人永久全开。
export function skipGuide(state) {
  const guide = normalizeGuideState(state?.guide)
  if (guide.skipped) return state
  return { ...state, guide: { ...guide, skipped: true, stage: GUIDE_STEP_IDS.length } }
}

// 页内高亮：打开某页时，把该页对应的「下一步该点的东西」标记出来。
// 倒计时存服务端，避免玩家刷新页面绕过 3 秒限制。
const GUIDE_FOCUS_SECONDS = 4

// 同步入口：把「下一步该做什么」写进 guide.focus（带服务端时间戳），
// 前端据此显示页内高亮，并用它作为说明卡 3 秒倒计时的起点。
// 已经 seen 的步骤不再设焦点；跳过引导后也不再设。
export function syncGuideFocus(state, at = Date.now()) {
  const config = normalizeGuideConfig(state?.config?.guide)
  const guide = normalizeGuideState(state?.guide)
  if (!config.enabled || guide.skipped) {
    if (!Object.keys(guide.focus).length) return state
    return { ...state, guide: { ...guide, focus: {} } }
  }
  const stage = Math.max(0, Number(guide.stage) || 0)
  // 给「每一步已解锁但还没读过」的步骤各留一个倒计时锚点，而不是只锚一个。
  // 原因：玩家可能同时解锁两三层（一次卖出好几条鱼），前端一次只显示一张卡；
  // 若只锚最新的一步，前一张卡就没有稳定起点，刷新会把它的 3 秒清零。
  const pendingIds = GUIDE_STEP_IDS
    .map((id, index) => ({ id, index }))
    .filter(({ id, index }) => index < stage && !guide.seen[id])
    .map(({ id }) => id)
  const next = {}
  pendingIds.slice(-GUIDE_FOCUS_LIMIT).forEach((id) => {
    const step = config.steps.find((item) => item.id === id)
    if (!step || !guideStepCopy(config, step)) return
    const previous = guide.focus[id]
    // 同一步骤只起一次倒计时：刷新页面不会把 3 秒清零。
    next[id] = previous && Number(previous.at) > 0
      ? previous
      : { at: Number(at) || Date.now(), remaining: Math.ceil(Math.max(0, Number(step.minCloseMs ?? config.minCloseMs) || 0) / 1000) }
  })
  const same = JSON.stringify(next) === JSON.stringify(guide.focus)
  return same ? state : { ...state, guide: { ...guide, focus: next } }
}

// 某一步的最终文案：单步覆盖优先，否则用 copy 表（后台实际编辑的就是 copy 表）。
// 传进来的既可以是引导配置（normalizeGuideConfig 的产物），也可以是整份 config。
export function guideStepCopy(guideConfig, stepOrId) {
  const source = guideConfig && Array.isArray(guideConfig.steps) ? guideConfig : (guideConfig?.guide || guideConfig)
  const steps = Array.isArray(source?.steps) ? source.steps : []
  const step = typeof stepOrId === 'string' ? steps.find((item) => item.id === stepOrId) : stepOrId
  if (!step) return ''
  return (step.copy && step.copy.trim()) || source?.copy?.[step.id] || ''
}

// 前端说明卡的选取逻辑（纯函数，便于单测）。
// L0 的钓鱼页导览由钓鱼页自己渲染（它是多页导览），这里排除，避免重复出现。
const GUIDE_SELF_RENDERED = new Set(['tension'])

export function guidePendingCard(state, at = Date.now()) {
  const config = normalizeGuideConfig(state?.config?.guide)
  const guide = normalizeGuideState(state?.guide)
  if (!config.enabled || guide.skipped) return null
  const focus = guide.focus || {}
  // 1) 正在倒计时的焦点优先：倒计时起点来自服务端，刷新不会清零。
  for (const stepId of Object.keys(focus)) {
    const entry = focus[stepId]
    if (!entry || guide.seen[stepId] || GUIDE_SELF_RENDERED.has(stepId)) continue
    const step = config.steps.find((item) => item.id === stepId)
    if (!step?.card || !guideStepCopy(config, step)) continue
    const minCloseMs = Math.max(0, Number(step.minCloseMs ?? config.minCloseMs) || 0)
    return { stepId, step, minCloseMs, expiresAt: Number(entry.at) + minCloseMs }
  }
  // 2) 没有焦点时，退回「已解锁但还没读过」的说明卡；起点按当前时刻算。
  const stage = guideUnlockedStage({ ...state, guide })
  const pending = config.steps.find((step) => {
    const index = guideStepIndex(step.id)
    return index >= 0 && index < stage && !guide.seen[step.id] && step.card && !GUIDE_SELF_RENDERED.has(step.id)
  })
  if (!pending) return null
  const minCloseMs = Math.max(0, Number(pending.minCloseMs ?? config.minCloseMs) || 0)
  return { stepId: pending.id, step: pending, minCloseMs, expiresAt: Number(at) + minCloseMs }
}

export function guideFocusFor(state, at = Date.now()) {
  const config = normalizeGuideConfig(state?.config?.guide)
  const stage = guideUnlockedStage(state)
  const stepId = GUIDE_STEP_IDS[stage]
  const step = stepId ? config.steps.find((item) => item.id === stepId) : null
  const seen = normalizeGuideState(state?.guide).seen
  if (!step || !step.copy || seen[step.id]) return null
  const target = GUIDE_FOCUS_TARGET[step.id]
  if (!target) return null
  return { stepId: step.id, tab: target.tab, anchor: target.anchor, remaining: GUIDE_FOCUS_SECONDS, copy: step.copy }
}

const GUIDE_FOCUS_TARGET = {
  npc: { tab: 'npc', anchor: 'exchange' },
  rodUpgrade: { tab: 'fishing', anchor: 'durability' },
  scratch: { tab: 'scratch', anchor: 'cards' },
  lottery: { tab: 'lottery', anchor: 'pool' },
  rodPower: { tab: 'fishing', anchor: 'durability' },
  fx: { tab: 'fx', anchor: 'quotes' },
}


const BLACK_SHOP_KINDS = new Set(['rod', 'repair', 'refresh', 'quota', 'theme', 'scale', 'grain', 'module'])
// ---- 无灯黑市：配置归一化 ----
//
// 黑市的公式全部写死在领域层，后台只调参数。这里做两件事：
// 1) 把任意脏输入收敛成可计算的数字（clamp / 回退默认）；
// 2) 过滤掉指向已删除钓竿、主题、材料的条项，避免运行期出现 undefined。
const blackNumber = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

const blackClamp = (value, min, max, fallback = min) => {
  const n = Number(value)
  const v = Number.isFinite(n) ? n : fallback
  return Math.min(max, Math.max(min, v))
}

export function normalizeBlackMarketConfig(raw) {
  const base = DEFAULT_CONFIG.blackMarket
  const source = raw && typeof raw === 'object' ? raw : {}
  const fishSource = source.fish && typeof source.fish === 'object' ? source.fish : {}
  const orderSource = source.order && typeof source.order === 'object' ? source.order : {}
  const superSource = source.super && typeof source.super === 'object' ? source.super : {}

  // 费率不是概率：>1 很常见（稀有奖励的 E[f] 很小），所以只限制数量级。
  const evMin = blackClamp(superSource.evMin, 0.9, 1, base.super.evMin)
  const evMax = Math.max(evMin, blackClamp(superSource.evMax, 0.95, 1.05, base.super.evMax))
  const targetEv = blackClamp(superSource.targetEv, evMin, evMax, blackClamp(base.super.targetEv, evMin, evMax))
  const slots = clamp(Math.round(blackNumber(superSource.slots, base.super.slots)), 3, 9)
  const need = clamp(Math.round(blackNumber(superSource.need, base.super.need)), 2, Math.min(3, slots))
  const heatMin = blackClamp(superSource.heatMin, 0, 10, base.super.heatMin)
  const heatMax = Math.max(heatMin, blackClamp(superSource.heatMax, heatMin, 100, base.super.heatMax))
  const baseline = blackClamp(superSource.baseline, 0, 0.9, base.super.baseline)
  const simSamples = Math.round(blackClamp(superSource.simSamples, 1000, 100000, base.super.simSamples))
  const simSamplesExtreme = Math.round(blackClamp(superSource.simSamplesExtreme, simSamples, 200000, Math.max(simSamples, base.super.simSamplesExtreme)))
  const valueOverrides = Object.fromEntries(Object.entries(superSource.valueOverrides && typeof superSource.valueOverrides === 'object' ? superSource.valueOverrides : base.super.valueOverrides)
    .map(([key, value]) => [String(key).slice(0, 80), blackClamp(value, 0, 1e6, 0)])
    .filter(([, value]) => Number.isFinite(value)))
  const calibrationMode = ['auto', 'analytic', 'simulate'].includes(superSource.calibrationMode) ? superSource.calibrationMode : base.super.calibrationMode
  const minInput = Math.round(blackClamp(superSource.minInput, 1, 200, base.super.minInput))
  const maxInput = Math.max(minInput, Math.round(blackClamp(superSource.maxInput, 1, 200, base.super.maxInput)))

  // 只回收固定材料表里的可再生产材料：锁钥是进度钥匙，后台也加不进回收表。
  const materialKeys = new Set(Object.keys(DEFAULT_CONFIG.blackMarket.materials))
  const materialSource = source.materials && typeof source.materials === 'object' ? source.materials : base.materials
  const materials = Object.fromEntries(Object.entries(materialSource)
    .filter(([name]) => materialKeys.has(name))
    .map(([name, entry]) => [name, {
      per: Math.max(1, Math.round(blackNumber(entry?.per, 1))),
      coins: Math.max(0, blackNumber(entry?.coins, 0)),
    }])
    .filter(([, entry]) => entry.coins > 0))

  const depthIds = new Set(DEPTHS.map((depth) => depth.id))
  const unlockDepth = depthIds.has(String(source.unlockDepth)) ? String(source.unlockDepth) : base.unlockDepth
  const rodIds = new Set((Array.isArray(base.rods) ? base.rods : RODS).map((rod) => rod.id))
  const themeIds = new Set(THEMES.map((theme) => theme.id))
  // 内置商品补齐：world_config 里存的是上一次保存时的快照。
  // 新版本给商店加了内置商品（例如模块）后，老配置里没有它们，玩家就永远看不到。
  // 规则与钓竿升级项一致：配置里已有的按 id 保留（后台可改价格），
  // 配置里缺的、但代码默认值里有的，补进来。
  const shopSource = Array.isArray(source.shop) ? [...source.shop] : [...base.shop]
  if (Array.isArray(source.shop)) {
    ;(base.shop || []).forEach((item) => {
      if (!item?.id) return
      if (shopSource.some((entry) => String(entry?.id) === String(item.id))) return
      shopSource.push(item)
    })
  }
  const seenShopIds = new Set()
  const shop = shopSource.map((item, index) => {
    const kind = String(item?.kind || '')
    if (!BLACK_SHOP_KINDS.has(kind)) return null
    const id = String(item?.id || `${kind}-${index + 1}`).slice(0, 60)
    if (!id || seenShopIds.has(id)) return null
    seenShopIds.add(id)
    const entry = {
      id,
      kind,
      name: String(item?.name || id).slice(0, 60),
      price: Math.max(0, blackNumber(item?.price, 0)),
      once: Boolean(item?.once),
      dailyLimit: item?.dailyLimit === undefined ? 0 : Math.max(0, Math.round(blackNumber(item.dailyLimit, 0))),
      maxBuys: item?.maxBuys === undefined ? 0 : Math.max(0, Math.round(blackNumber(item.maxBuys, 0))),
      priceGrowth: Math.max(0, blackNumber(item?.priceGrowth, 0)),
    }
    if (kind === 'rod') {
      if (!rodIds.has(String(item?.rodId))) return null
      entry.rodId = String(item.rodId)
    }
    if (kind === 'theme') {
      if (!themeIds.has(String(item?.themeId))) return null
      entry.themeId = String(item.themeId)
    }
    // K 线档位解锁：grainId 必须指向真实存在的档位，否则这条商品永远买不出效果。
    if (kind === 'grain') {
      if (!FX_GRAIN_BY_ID[String(item?.grainId)]) return null
      entry.grainId = String(item.grainId)
    }
    // 模块：只认代码里存在的模块 id；价格与等级上限以 machines.modules 为准。
    if (kind === 'module') {
      const moduleId = String(item?.moduleId || '')
      if (!DEFAULT_CONFIG.machines.modules[moduleId]) return null
      entry.moduleId = moduleId
    }
    return entry
  }).filter(Boolean)

  return {
    enabled: source.enabled === undefined ? base.enabled : Boolean(source.enabled),
    unlockDepth,
    fish: {
      traitBonus: blackClamp(fishSource.traitBonus, 0, 1000, base.fish.traitBonus),
      dailyQuota: Math.round(blackClamp(fishSource.dailyQuota, 0, 100000, base.fish.dailyQuota)),
      quotaStep: Math.round(blackClamp(fishSource.quotaStep, 0, 10000, base.fish.quotaStep)),
      quotaMaxBuys: Math.round(blackClamp(fishSource.quotaMaxBuys, 0, 1000, base.fish.quotaMaxBuys)),
      quotaPrice: Math.max(0, blackNumber(fishSource.quotaPrice, base.fish.quotaPrice)),
      quotaPriceGrowth: Math.max(0, blackNumber(fishSource.quotaPriceGrowth, base.fish.quotaPriceGrowth)),
      scaleBonus: blackClamp(fishSource.scaleBonus, 0, 10, base.fish.scaleBonus),
    },
    order: {
      targetAcceptance: blackClamp(orderSource.targetAcceptance, 0.01, 1, base.order.targetAcceptance),
      acceptanceMin: blackClamp(orderSource.acceptanceMin, 0, 1, base.order.acceptanceMin),
      acceptanceMax: Math.max(
        blackClamp(orderSource.acceptanceMin, 0, 1, base.order.acceptanceMin),
        blackClamp(orderSource.acceptanceMax, 0, 1, base.order.acceptanceMax),
      ),
      refreshCost: Math.max(0, blackNumber(orderSource.refreshCost, base.order.refreshCost)),
      refreshLimit: Math.round(blackClamp(orderSource.refreshLimit, 0, 1000, base.order.refreshLimit)),
      // 订单形状固定：1 个收购词条 + 2 个禁用词条。不是后台参数。
      demandCount: 1,
      banCount: 2,
    },
    materials,
    super: {
      enabled: superSource.enabled === undefined ? base.super.enabled : Boolean(superSource.enabled),
      slots,
      need,
      minInput,
      maxInput,
      sensitivity: blackClamp(superSource.sensitivity, 0, 3, base.super.sensitivity),
      heatMin,
      heatMax,
      baseline,
      fPower: blackClamp(superSource.fPower, 1, 2.5, base.super.fPower),
      fMax: Math.max(1, blackClamp(superSource.fMax, 1, 100, base.super.fMax)),
      targetEv,
      evMin,
      evMax,
      calibrationSafety: blackClamp(superSource.calibrationSafety, 0.8, 1.1, base.super.calibrationSafety),
      calibrationMode,
      simSamples,
      simSamplesExtreme,
      valueOverrides,
      unknownValue: blackClamp(superSource.unknownValue, 0, 1e6, base.super.unknownValue),
    },
    shop,
  }
}

// 仓库扩容：纯鱼币，越升越贵。
export function normalizeWarehouseConfig(raw) {
  const base = DEFAULT_CONFIG.warehouse
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    base: clamp(Math.round(finiteNumber(source.base, base.base)), 1, 1e6),
    step: clamp(Math.round(finiteNumber(source.step, base.step)), 1, 1e5),
    maxLevel: clamp(Math.round(finiteNumber(source.maxLevel, base.maxLevel)), 0, 999),
    coins: Math.max(0, Math.round(finiteNumber(source.coins, base.coins))),
    growth: Math.max(0, finiteNumber(source.growth, base.growth)),
  }
}

// 刮层直觉：每 perLevels 次刮开，阈值与半径各升一档（静默，不进任何 UI）。
// 用累计刮开数推导等级，因此不需要额外的存档字段，读档/重置都自动正确。
export function normalizeScratchLuckConfig(raw) {
  const base = DEFAULT_CONFIG.scratchLuck
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    perLevels: clamp(Math.round(finiteNumber(source.perLevels, base.perLevels)), 1, 1000),
    maxLevel: clamp(Math.round(finiteNumber(source.maxLevel, base.maxLevel)), 0, 999),
    thresholdBase: clamp(finiteNumber(source.thresholdBase, base.thresholdBase), 0.01, 1),
    thresholdStep: finiteNumber(source.thresholdStep, base.thresholdStep),
    radiusBase: clamp(finiteNumber(source.radiusBase, base.radiusBase), 1, 500),
    radiusStep: Math.max(0, finiteNumber(source.radiusStep, base.radiusStep)),
  }
}

// 机器的存款来源白名单：决定「交什么」能换成哪个池。
export const MACHINE_DEPOSIT_SOURCES = ['fish', 'coins', 'blackCoins', 'scratch']

const normalizeMachineModule = (raw, fallback) => {
  const item = raw && typeof raw === 'object' ? raw : {}
  const next = { ...fallback }
  Object.keys(fallback).forEach((key) => {
    const fallbackValue = fallback[key]
    const value = item[key]
    if (typeof fallbackValue === 'number') next[key] = finiteNumber(value, fallbackValue)
    else if (typeof fallbackValue === 'string') next[key] = typeof value === 'string' && value.trim() ? value.slice(0, 32) : fallbackValue
    else next[key] = value === undefined ? fallbackValue : value
  })
  if (next.price !== undefined) next.price = Math.max(0, Math.round(next.price))
  if (next.maxLevel !== undefined) next.maxLevel = clamp(Math.round(next.maxLevel), 0, 99)
  if (next.load !== undefined) next.load = Math.max(0, Math.round(next.load))
  return next
}

const normalizeMachineDeposits = (raw, fallback) => {
  const list = Array.isArray(raw) && raw.length ? raw : fallback
  return list.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : {}
    const from = MACHINE_DEPOSIT_SOURCES.includes(item.from) ? item.from : (fallback[index]?.from || 'coins')
    return {
      key: String(item.key || fallback[index]?.key || `pool-${index + 1}`).slice(0, 24),
      from,
      max: Math.max(0, Math.round(finiteNumber(item.max, fallback[index]?.max ?? 0))),
    }
  })
}

const normalizeEfficiency = (raw, fallback) => {
  const list = Array.isArray(raw) && raw.length ? raw : fallback
  const values = list.slice(0, 24).map((value) => clamp(finiteNumber(value, 1), 0.05, 1))
  // 长度不足用最后一项补齐，保证「第 h 个连续加班小时」永远查得到。
  while (values.length < fallback.length) values.push(values.at(-1) ?? 1)
  return values
}

// 机器配置：数值全部可后台改；这里只做 clamp 与结构归一。
export function normalizeMachinesConfig(raw) {
  const base = DEFAULT_CONFIG.machines
  const source = raw && typeof raw === 'object' ? raw : {}
  const modulesSource = source.modules && typeof source.modules === 'object' ? source.modules : {}
  const modules = Object.keys(base.modules).reduce((map, id) => ({
    ...map,
    [id]: normalizeMachineModule(modulesSource[id], base.modules[id]),
  }), {})
  const listSource = source.list && typeof source.list === 'object' ? source.list : {}
  const list = Object.keys(base.list).reduce((map, id) => {
    const fallback = base.list[id]
    const item = listSource[id] && typeof listSource[id] === 'object' ? listSource[id] : {}
    const shift = item.shift && typeof item.shift === 'object' ? item.shift : {}
    const startHour = clamp(Math.round(finiteNumber(shift.startHour, fallback.shift.startHour)), 0, 23)
    const endHour = clamp(Math.round(finiteNumber(shift.endHour, fallback.shift.endHour)), startHour + 1, 24)
    const rent = item.rent && typeof item.rent === 'object' ? item.rent : {}
    const fee = item.fee && typeof item.fee === 'object' ? item.fee : {}
    const overheat = item.overheat && typeof item.overheat === 'object' ? item.overheat : {}
    const unlock = item.unlock && typeof item.unlock === 'object' ? item.unlock : {}
    const settle = item.settle && typeof item.settle === 'object' ? item.settle : {}
    const overtimeFallback = fallback.overtime || { fromHour: 17, toHour: 22, maxHours: 5, efficiency: [1] }
    const overtimeSource = item.overtime && typeof item.overtime === 'object' ? item.overtime : {}
    const overtimeFrom = clamp(Math.round(finiteNumber(overtimeSource.fromHour, overtimeFallback.fromHour)), 0, 23)
    const overtimeTo = clamp(Math.round(finiteNumber(overtimeSource.toHour, overtimeFallback.toHour)), overtimeFrom + 1, 24)
    const maxHours = clamp(Math.round(finiteNumber(overtimeSource.maxHours, overtimeFallback.maxHours)), 0, overtimeTo - overtimeFrom)
    return {
      ...map,
      [id]: {
        ...fallback,
        id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name.slice(0, 32) : fallback.name,
        accent: typeof item.accent === 'string' && item.accent.trim() ? item.accent.slice(0, 16) : fallback.accent,
        // 盯盘机的挂单与撤单入口尚未开放。保留定义供旧存档读档和结算。
        enabled: id !== 'watcher' && (item.enabled === undefined ? fallback.enabled !== false : Boolean(item.enabled)),
        unlock: {
          kind: ['scratched', 'blackMarket', 'depth', 'always'].includes(unlock.kind) ? unlock.kind : fallback.unlock.kind,
          value: Math.max(0, Math.round(finiteNumber(unlock.value, fallback.unlock.value ?? 0))),
          also: typeof unlock.also === 'string' && unlock.also ? unlock.also.slice(0, 16) : (fallback.unlock.also || null),
        },
        shift: { startHour, endHour },
        rate: { msPerItem: clamp(Math.round(finiteNumber(item.rate?.msPerItem, fallback.rate.msPerItem)), 1000, 3600000) },
        rent: {
          unit: ['fishKg', 'blackCoins', 'coins'].includes(rent.unit) ? rent.unit : fallback.rent.unit,
          daily: Math.max(0, finiteNumber(rent.daily, fallback.rent.daily)),
          overtimePerHour: Math.max(0, finiteNumber(rent.overtimePerHour, fallback.rent.overtimePerHour ?? 0)),
        },
        fee: {
          unit: ['coins', 'blackCoins'].includes(fee.unit) ? fee.unit : fallback.fee.unit,
          perItem: Math.max(0, finiteNumber(fee.perItem, fallback.fee.perItem ?? 0)),
          overtimeMultiplier: Math.max(1, finiteNumber(fee.overtimeMultiplier, fallback.fee.overtimeMultiplier ?? 1)),
          rateOfProceeds: clamp(finiteNumber(fee.rateOfProceeds, fallback.fee.rateOfProceeds ?? 0), 0, 1),
          min: Math.max(0, finiteNumber(fee.min, fallback.fee.min ?? 0)),
        },
        overtime: {
          fromHour: overtimeFrom,
          toHour: overtimeTo,
          maxHours,
          efficiency: normalizeEfficiency(overtimeSource.efficiency, overtimeFallback.efficiency),
        },
        overheat: {
          max: clamp(finiteNumber(overheat.max, fallback.overheat.max), 0, 99),
          perDayPenalty: clamp(finiteNumber(overheat.perDayPenalty, fallback.overheat.perDayPenalty), 0, 1),
          minSpeed: clamp(finiteNumber(overheat.minSpeed, fallback.overheat.minSpeed), 0.05, 1),
        },
        moduleSlots: clamp(Math.round(finiteNumber(item.moduleSlots, fallback.moduleSlots)), 0, 8),
        loadCapacity: Math.max(0, Math.round(finiteNumber(item.loadCapacity, fallback.loadCapacity))),
        deposits: normalizeMachineDeposits(item.deposits, fallback.deposits),
        settle: { batchMax: clamp(Math.round(finiteNumber(settle.batchMax, fallback.settle.batchMax)), 1, 500) },
        ...(fallback.orders ? {
          orders: {
            max: clamp(Math.round(finiteNumber(item.orders?.max, fallback.orders.max)), 0, 10),
            ttlMs: clamp(Math.round(finiteNumber(item.orders?.ttlMs, fallback.orders.ttlMs)), 60000, 30 * 24 * 3600000),
          },
        } : {}),
      },
    }
  }, {})
  return {
    modulesUnlockDepth: DEPTHS.some((depth) => depth.id === source.modulesUnlockDepth) ? source.modulesUnlockDepth : base.modulesUnlockDepth,
    modules,
    list,
  }
}

export function normalizeConfig(raw) {
  const base = DEFAULT_CONFIG
  const config = raw && typeof raw === 'object' ? raw : {}
  let legacyTraitPreset = false
  const traits = (Array.isArray(config.traits) && config.traits.length ? config.traits : base.traits).map((trait) => {
    const upgraded = upgradeTraitPreset(trait)
    if (upgraded !== trait) legacyTraitPreset = true
    return upgraded
  }).map(normalizeTrait)
  const traitIds = new Set(traits.map((trait) => trait.id))
  const tension = normalizeTension(config.tension ?? base.tension)
  const depthTraitWeights = normalizeDepthTraitWeights(config.depthTraitWeights, traits)
  const depthUnlocks = DEPTHS.reduce((map, depth) => {
    const raw = config.depthUnlocks?.[depth.id]
    const fallback = depth.unlock
    const entry = raw && typeof raw === 'object' ? raw : fallback
    if (!entry) return map
    return { ...map, [depth.id]: { material: entry.material || '潮汐锁钥', cost: Math.max(0, Number(entry.cost) || 0), coins: Math.max(0, Number(entry.coins) || 0) } }
  }, {})
  const scratchTypes = configList(config.scratchTypes, base.scratchTypes).map((type, index) => ({
    ...type,
    id: type.id || `scratch-${index + 1}`,
    name: type.name || `刮刮乐 ${index + 1}`,
    cardColor: type.cardColor || '#f4fffc',
    coatColor: type.coatColor || '#2f6f76',
    note: type.note || '低阶材料',
    slots: clamp(Math.round(Number(type.slots) || SCRATCH_DEFAULT_SLOTS), SCRATCH_MIN_SLOTS, SCRATCH_MAX_SLOTS),
    prizes: Array.isArray(type.prizes) && type.prizes.length ? type.prizes.map((prize, prizeIndex) => normalizeScratchPrize(prize, prizeIndex)) : base.scratchTypes[0].prizes,
  }))
  const lotteryTypes = configList(config.lotteryTypes, base.lotteryTypes).map((type, index) => {
    const min = clamp(Math.round(finiteNumber(type.min, 0)), 0, 198)
    const max = clamp(Math.round(finiteNumber(type.max, 30)), min + 1, 199)
    return {
      ...type,
      id: type.id || `lottery-${index + 1}`,
      name: type.name || `彩票 ${index + 1}`,
      min, max,
      pick: clamp(Math.round(finiteNumber(type.pick, 6)), 1, Math.min(10, max - min + 1)),
      ticketCost: clamp(Math.round(finiteNumber(type.ticketCost, 3)), 1, 50),
      cardColor: type.cardColor || '#f4faf9',
      accentColor: type.accentColor || '#247b82',
      note: type.note || '',
      prizes: Array.isArray(type.prizes) && type.prizes.length ? type.prizes : base.lotteryTypes[0].prizes,
    }
  })
  const rods = configList(config.rods, base.rods).map((rod, index) => ({
    ...rod,
    id: rod.id || `rod-${index + 1}`,
    name: rod.name || `钓竿 ${index + 1}`,
    rarity: rod.rarity || '普通',
    color: rod.color || '#91a7b7',
    maxDurability: Math.max(1, Number(rod.maxDurability) || 100),
    durability: Math.max(0, Number(rod.durability) || Number(rod.maxDurability) || 100),
    resistance: clamp(Number(rod.resistance) || 0, 0, 0.95),
    energyPerSecond: Math.max(1, Number(rod.energyPerSecond) || BASE_ENERGY_PER_SECOND),
    energyPerCatch: Math.max(100, Number(rod.energyPerCatch) || ENERGY_PER_CATCH),
    tension: normalizeTension(rod.tension),
    maxDepth: clamp(Number(rod.maxDepth) || 0, 0, DEPTHS.length - 1),
    breakable: Boolean(rod.breakable),
    repair: { material: rod.repair?.material || '深蓝晶片', amount: Math.max(1, Number(rod.repair?.amount) || 50), cost: Math.max(1, Number(rod.repair?.cost) || 1) },
    upgrades: withBuiltinUpgrades(rod, base, normalizeRodUpgrade),
  }))
  // 旧词条预设翻转了难度方向；同步把默认钓竿的基础张力与升级幅度抬到新基准，
  // 避免老世界更新后河口直接变成 0% 上钩率。只迁移仍是旧默认值的竿。
  const ROD_TENSION_BASE = { tide: 1200, azure: 1380, abyss: 1450 }
  const balancedRods = legacyTraitPreset ? rods.map((rod) => {
    const target = ROD_TENSION_BASE[rod.id]
    if (!target || Number(rod.tension?.maxTension) !== 1000) return rod
    return {
      ...rod,
      tension: { ...rod.tension, maxTension: target },
      upgrades: rod.upgrades.map((upgrade) => upgrade.id === 'tension' && Number(upgrade.amount) === 10 ? { ...upgrade, amount: 15 } : upgrade),
    }
  }) : rods
  const traitQuotes = { ...base.quotes.traitQuotes, ...(config.quotes?.traitQuotes || {}) }
  const combos = Array.isArray(config.quotes?.combos) ? config.quotes.combos : base.quotes.combos
  const tiers = Array.isArray(config.quotes?.tiers) && config.quotes.tiers.length ? config.quotes.tiers : base.quotes.tiers
  // 仓库扩容：纯鱼币升级，不再走天赋。
  const warehouse = normalizeWarehouseConfig(config.warehouse)
  // 刮层直觉：每刮十次静默升级一档，玩家看不到这个系统，只在数值上生效。
  const scratchLuck = normalizeScratchLuckConfig(config.scratchLuck)
  // 黑市限定钓竿：老世界配置里没有 shadow，补上但不自动发给玩家。
  const rodsWithShop = balancedRods.some((rod) => rod.id === 'shadow')
    ? balancedRods
    : [...balancedRods, ...base.rods.filter((rod) => rod.id === 'shadow')]
  return {
    tension,
    depthUnlocks,
    traits,
    depthTraitWeights,
    scratchTypes,
    lotteryHistory: clamp(Math.round(Number(config.lotteryHistory) || LOTTERY_HISTORY_DEFAULT), LOTTERY_HISTORY_MIN, LOTTERY_HISTORY_MAX),
    lotteryTypes,
    rods: rodsWithShop,
    warehouse,
    scratchLuck,
    blackMarket: normalizeBlackMarketConfig(config.blackMarket),
    machines: normalizeMachinesConfig(config.machines),
    guide: normalizeGuideConfig(config.guide),
    fx: normalizeFx(config.fx ?? base.fx),
    quotes: {
      traitQuotes: traits.reduce((map, trait) => ({ ...map, [trait.id]: Math.max(0, Number(traitQuotes[trait.id]) || 0) }), {}),
      combos: combos
        .map((combo, index) => ({
          id: combo.id || `combo-${index + 1}`,
          name: combo.name || `组合 ${index + 1}`,
          traits: (Array.isArray(combo.traits) ? combo.traits : []).filter((id) => traitIds.has(id)),
          price: Math.max(0, Number(combo.price) || 0),
        }))
        .filter((combo) => combo.traits.length > 0),
      tiers: tiers.map((tier, index) => ({
        id: tier.id || `tier-${index + 1}`,
        min: Math.max(0, Number(tier.min) || 0),
        max: tier.max === null || tier.max === '' || tier.max === undefined ? null : Math.max(0, Number(tier.max) || 0),
        tickets: { qty: Math.max(0, Number(tier.tickets?.qty) || 0) },
        scratch: { typeId: tier.scratch?.typeId || scratchTypes[0].id, qty: Math.max(0, Number(tier.scratch?.qty) || 0) },
      })),
    },
  }
}

export function lotteryTypeFor(config, tierId) {
  const list = (config || DEFAULT_CONFIG).lotteryTypes
  return list.find((type) => type.id === tierId) || list[0]
}

export function scratchTypeFor(config, typeId) {
  const list = (config || DEFAULT_CONFIG).scratchTypes
  return list.find((type) => type.id === typeId) || list[0]
}

export function rodConfigFor(config, rod) {
  const list = (config || DEFAULT_CONFIG).rods
  const id = String(rod?.id || '')
  const matched = list.reduce((best, item) => {
    const instanceId = `rod-${item.id}`
    const match = id === instanceId || id.startsWith(`${instanceId}-`)
    return match && item.id.length > (best?.id.length ?? 0) ? item : best
  }, null)
  return matched || list.find((item) => item.id === id || item.name === rod?.name) || list[0]
}

// 这根竿的某个升级项定义（来自全服配置，不含等级）。
export function rodUpgrade(rod, upgradeId) {
  return (rod?.upgrades || []).find((upgrade) => upgrade.id === upgradeId) || null
}

// 这根竿某个升级项的当前等级。
export function upgradeLevel(rod, upgradeId) {
  return Math.max(0, Math.floor(Number(rod?.levels?.[upgradeId]) || 0))
}

// 这根竿的耐久上限：溢出维修初始自带，所以「上限」不封顶；
// 维修的唯一前提是「当前耐久还没到上限」，而判定用的是标称 maxDurability —— 见 canRepairRod。
export function rodRepairCap(rod) {
  return Math.max(1, Number(rod?.maxDurability) || 1)
}

// 是否可以维修：只要耐久没满就能修（溢出部分不设上限，但未满即未满）。
export function canRepairRod(state, rod = state?.rod) {
  const repair = (rodConfigFor(state?.config, rod) || {}).repair || { material: '深蓝晶片', amount: 50, cost: 1 }
  const material = repair.material || '深蓝晶片'
  const cost = Math.max(1, Number(repair.cost) || 1)
  if ((state?.inventory?.[material] || 0) < cost) return false
  // 标称上限就是「满」的界：达到或超过它就不再允许维修。
  return Math.max(0, Number(rod?.durability) || 0) < rodRepairCap(rod)
}

export function fishQuotePrice(state, fish) {
  const config = state.config || DEFAULT_CONFIG
  const quotes = config.quotes
  const traitLines = fish.traits.map((id) => ({ id, price: quotes.traitQuotes[id] || 0 }))
  const combos = quotes.combos
    .filter((combo) => combo.traits.length > 0 && combo.traits.every((trait) => fish.traits.includes(trait)))
  // 组合加成只取配置里的基础价，不再有任何额外百分比修正。
  const comboLines = combos.map((combo) => ({ id: combo.id, name: combo.name, traits: combo.traits, price: combo.price, bonus: 0, total: combo.price, boosted: false }))
  const traitTotal = traitLines.reduce((sum, line) => sum + line.price, 0)
  const comboTotal = comboLines.reduce((sum, line) => sum + line.total, 0)
  return { traitLines, comboLines, traitTotal, comboTotal, comboBonus: comboTotal - combos.reduce((sum, combo) => sum + combo.price, 0), total: traitTotal + comboTotal }
}

export function tierForPrice(config, price) {
  const tiers = (config || DEFAULT_CONFIG).quotes.tiers
  const sorted = [...tiers].sort((a, b) => a.min - b.min)
  const match = sorted.find((tier) => price >= tier.min && (tier.max === null || price <= tier.max))
  if (match) return match
  // 档位之间可能有空档（例如 19–20、39–40、59–60）。落在空档里时应该归到
  // 「下限不超过它的最高档」，而不是兜底到最后一档——否则 19.1 会被当成 60+ 结算。
  const below = sorted.filter((tier) => price >= tier.min).at(-1)
  return below || sorted[0]
}

// 彩票奖励统一发放空白票：场次由玩家自己在彩票中心决定。
export function quoteForFish(state, fish) {
  const config = state.config || DEFAULT_CONFIG
  const pricing = fishQuotePrice(state, fish)
  const tier = tierForPrice(config, pricing.total)
  const scratchType = tier?.scratch?.qty ? scratchTypeFor(config, tier.scratch.typeId) : null
  return {
    pricing,
    tier,
    tickets: tier?.tickets?.qty ? { qty: tier.tickets.qty, name: '空白彩票' } : null,
    scratch: scratchType ? { typeId: scratchType.id, qty: tier.scratch.qty, name: scratchType.name, color: scratchType.coatColor } : null,
  }
}

export function quoteLabel(quote) {
  const parts = []
  if (quote.tickets) parts.push(`空白彩票 ×${quote.tickets.qty}`)
  if (quote.scratch) parts.push(`${quote.scratch.name} ×${quote.scratch.qty}`)
  return parts.join(' + ') || '无报价'
}

const upgradeAmount = (def, id) => {
  const upgrade = (def.upgrades || []).find((item) => item.id === id)
  return upgrade ? Math.max(0, Number(upgrade.amount) || 0) : 0
}

// 钓竿的实际数值 = 配置基础值 + 已购升级等级 × 每级提升。
export function rodStatsFrom(def, levels = {}) {
  const baseTension = normalizeTension(def.tension)
  const level = (id) => Math.max(0, Math.floor(Number(levels?.[id]) || 0))
  return {
    energyPerSecond: Math.max(1, def.energyPerSecond + level('speed') * upgradeAmount(def, 'speed')),
    maxDurability: Math.max(1, def.maxDurability + level('durability') * upgradeAmount(def, 'durability')),
    resistance: clamp(def.resistance + level('resistance') * upgradeAmount(def, 'resistance'), 0, 0.95),
    tension: { ...baseTension, maxTension: Math.max(50, baseTension.maxTension + level('tension') * upgradeAmount(def, 'tension')) },
  }
}

export function applyConfig(state, config) {
  const next = normalizeConfig(config)
  const syncRod = (rod) => {
    const def = rodConfigFor(next, rod)
    const floor = def.breakable ? 0 : 1
    const levels = rod?.levels || {}
    const stats = rodStatsFrom(def, levels)
    return {
      ...rod,
      name: def.name,
      rarity: def.rarity,
      color: def.color,
      text: def.text,
      levels,
      tension: stats.tension,
      maxDurability: stats.maxDurability,
      resistance: stats.resistance,
      baseEnergyPerSecond: def.energyPerSecond,
      energyPerSecond: stats.energyPerSecond,
      energyPerCatch: def.energyPerCatch,
      maxDepth: def.maxDepth,
      breakable: def.breakable,
      repair: def.repair,
      upgrades: def.upgrades,
      durability: Math.max(floor, finiteNumber(rod?.durability, floor)),
      status: def.breakable && (Number(rod?.durability) || 0) <= 0 ? 'broken' : rod?.status || 'stored',
    }
  }
  const rod = syncRod(state.rod)
  const rods = state.rods.map((item) => item.id === rod.id ? { ...syncRod(item), ...rod } : syncRod(item))
  const reachable = depthsFor(state)
  const selectedDepthId = reachable.some((depth) => depth.id === state.fishing.selectedDepthId) ? state.fishing.selectedDepthId : reachable[0].id
  const lowDurability = rod.durability <= autoStopThreshold(state)
  // 天赋等级按轨道重建：新加轨道从 0 开始，已删轨道的等级丢弃。
  const warehouseLevelNext = normalizeWarehouseLevel(state.warehouseLevel, state.talents)
  return {
    ...state,
    config: next,
    warehouseLevel: warehouseLevelNext,
    rod,
    rods,
    fishing: {
      ...state.fishing,
      selectedDepthId,
      progress: clamp(Number(state.fishing.progress) || 0, 0, rod.energyPerCatch),
      running: state.fishing.running && rod.status !== 'broken' && rod.durability > 0,
      lowDurability,
    },
  }
}

// 仓库升级等级：老存档把它存在天赋「仓库扩容」里，迁移时读出来；
// 新存档直接用 state.warehouseLevel。
export function normalizeWarehouseLevel(raw, legacyTalents = null) {
  const direct = Math.floor(Number(raw) || 0)
  if (direct > 0) return direct
  // 兼容：旧存档的 talents['talent-warehouse'].capacity
  const legacy = legacyTalents && typeof legacyTalents === 'object' ? legacyTalents['talent-warehouse'] : null
  return Math.max(0, Math.floor(Number(legacy?.capacity) || 0))
}

export function addScratchType(config, name) {
  const list = [...(config?.scratchTypes || [])]
  return { ...(config || {}), scratchTypes: [...list, { id: `scratch-${Date.now()}`, name: name || `新刮刮乐 ${list.length + 1}`, cardColor: '#f4fffc', coatColor: '#2f6f76', note: '低阶材料', slots: SCRATCH_DEFAULT_SLOTS, prizes: [{ id: `prize-${Date.now()}`, kind: 'material', name: '浮木纤维', qty: 3, weight: 1 }] }] }
}

export function addLotteryType(config, name) {
  const list = [...(config?.lotteryTypes || [])]
  return { ...(config || {}), lotteryTypes: [...list, { id: `lottery-${Date.now()}`, name: name || `新彩票 ${list.length + 1}`, min: 0, max: 30, pick: 6, ticketCost: 3, cardColor: '#f4faf9', accentColor: '#247b82', note: '', prizes: [[{ type: 'material', name: '浮木纤维', qty: 1 }]] }] }
}

export function addRod(config, name) {
  const list = [...(config?.rods || [])]
  return { ...(config || {}), rods: [...list, { id: `rod-${Date.now()}`, name: name || `新钓竿 ${list.length + 1}`, rarity: '普通', color: '#91a7b7', maxDurability: 200, durability: 200, resistance: 0.1, energyPerSecond: 1000, energyPerCatch: ENERGY_PER_CATCH, maxDepth: 0, breakable: true, tension: { ...ADVANCED_TENSION }, text: '', repair: { material: '深蓝晶片', amount: 50, cost: 1 }, upgrades: [] }] }
}


const stamp = () => new Date().toISOString()
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

function getBatchId(date = new Date()) {
  const d = new Date(date)
  const hours = Math.floor(d.getUTCHours() / 6) * 6
  d.setUTCHours(hours, 0, 0, 0)
  return d.toISOString()
}

export function nextDrawAt(date = new Date()) {
  const d = new Date(date)
  const next = new Date(d)
  next.setUTCHours(Math.floor(d.getUTCHours() / 6) * 6 + 6, 0, 0, 0)
  return next
}

function emptyStats() {
  // hits 是总命中分布；hitsByPool 按奖池拆开，两者同时展示。
  // claimedPrizes 是总兑奖数；claimedTickets / claimedScratch 分开计，
  // 因为兑奖后票据会从背包移除，页面只能靠统计显示历史。
  return { totalCatches: 0, totalEscapes: 0, totalExchanged: 0, totalSold: 0, fishByDepth: { 河口: 0, 港湾: 0, 礁石: 0, 海沟: 0, 裂谷: 0, 深渊: 0 }, totalDurabilityLoss: 0, totalTickets: 0, totalTicketsEarned: 0, totalScratch: 0, totalScratchEarned: 0, scratchPairs: 0, scratchCoins: 0, claimedPrizes: 0, claimedTickets: 0, claimedScratch: 0, hits: [0, 0, 0, 0, 0, 0, 0], hitsByPool: {}, comboSeen: {} }
}

function makeTicket(id, status = 'BLANK', tier = null) {
  return { id, status, tier, numbers: [], batchId: null, drawnNumbers: [], hits: null, rewards: [], claimed: false, createdAt: stamp() }
}

// 刮刮乐卡面在发卡时就定好：face 是每一格的奖项，涂层只是盖住图标，
// 刮开只翻牌，不会再抽一次。服务端发卡时传入 crypto RNG。
//
// pool 是发卡时的奖池快照：黑市超级卡只认这份快照，后台之后改奖池/删卡种
// 都不影响已发出的卡。快照存 normalizeScratchPrize 之后的有效值，
// 与 drawScratchFace / scratchSettlement 实际使用的值完全一致。
export function scratchPoolSnapshot(type) {
  const prizes = (Array.isArray(type?.prizes) ? type.prizes : []).map((prize, index) => normalizeScratchPrize(prize, index))
  if (!prizes.length) return null
  const slots = clamp(Math.round(Number(type?.slots) || SCRATCH_DEFAULT_SLOTS), SCRATCH_MIN_SLOTS, SCRATCH_MAX_SLOTS)
  return {
    slots,
    prizes: prizes.map((prize) => ({ kind: prize.kind, name: prize.name, qty: prize.qty, weight: prize.weight, need: prize.need })),
  }
}

// 稳定哈希：同一份奖池快照永远得到同一个 key，用于 μ/σ² 与校准缓存。
export function scratchPoolHash(pool) {
  if (!pool || !Array.isArray(pool.prizes) || !pool.prizes.length) return ''
  const text = JSON.stringify([
    pool.slots,
    pool.prizes.map((prize) => [prize.kind || 'material', prize.name, prize.qty, prize.weight, prize.need]),
  ])
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function makeScratchCard(id, typeId, type = null, random = Math.random) {
  const face = type ? drawScratchFace(type, random) : []
  const pool = type ? scratchPoolSnapshot(type) : null
  return { id, status: 'ready', typeId, face, pool, poolHash: scratchPoolHash(pool), poolSource: pool ? 'exact' : 'missing', payout: null, reward: null, revealedAt: null, createdAt: stamp() }
}

const normalizePoolSnapshot = (raw) => {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.prizes) || !raw.prizes.length) return null
  const prizes = raw.prizes
    .map((prize, index) => normalizeScratchPrize(prize, index))
    .map((prize) => ({ kind: prize.kind, name: prize.name, qty: prize.qty, weight: prize.weight, need: prize.need }))
  if (!prizes.length) return null
  return { slots: clamp(Math.round(Number(raw.slots) || SCRATCH_DEFAULT_SLOTS), SCRATCH_MIN_SLOTS, SCRATCH_MAX_SLOTS), prizes }
}

const normalizeFaceSlot = (slot) => {
  if (!slot || typeof slot !== 'object' || !slot.name) return null
  return {
    id: slot.id,
    kind: slot.kind === 'coin' ? 'coin' : 'material',
    name: String(slot.name),
    qty: Math.max(1, Math.round(Number(slot.qty) || 1)),
    need: clamp(Math.round(Number(slot.need) || 2), 2, SCRATCH_MAX_SLOTS),
  }
}

// 旧卡迁移：
// - 有 pool 快照的原样保留（之后改配置也不影响）；
// - 没有的用当前卡种补一份快照，标记 migrated；卡种已删则 pool=null / missing；
// - 卡面里出现快照没有的奖励时补进快照（reconstructed），保证 μ>0；
// - 没有卡面的 ready 卡用补出的快照抽一次并落盘。
function migrateScratchCard(card, config, random = Math.random) {
  const source = card && typeof card === 'object' ? card : {}
  const savedTypeId = String(source.typeId || '')
  const knownType = (config.scratchTypes || []).find((type) => type.id === savedTypeId)
  const typeId = knownType ? savedTypeId : config.scratchTypes[0].id
  const savedFace = (Array.isArray(source.face) ? source.face : []).map(normalizeFaceSlot).filter(Boolean)
  let pool = normalizePoolSnapshot(source.pool)
  let poolSource = pool ? String(source.poolSource || 'exact') : ''
  if (!pool && knownType) {
    pool = scratchPoolSnapshot(knownType)
    poolSource = 'migrated'
  }
  let face = savedFace
  if (pool && face.length) {
    // 实际抽了几格是已知事实，快照格数跟着卡面走。
    if (face.length !== pool.slots) pool = { ...pool, slots: clamp(face.length, SCRATCH_MIN_SLOTS, SCRATCH_MAX_SLOTS) }
    const known = new Set(pool.prizes.map((prize) => `${prize.kind}:${prize.name}`))
    const extra = []
    face.forEach((slot) => {
      const key = `${slot.kind}:${slot.name}`
      if (known.has(key)) return
      known.add(key)
      // 卡面已经带着 qty/need，按实际值补比按 1/2 补更接近这张卡真实的结算分布。
      extra.push({ kind: slot.kind, name: slot.name, qty: slot.qty, weight: 1, need: slot.need })
    })
    if (extra.length) {
      pool = { ...pool, prizes: [...pool.prizes, ...extra] }
      poolSource = 'reconstructed'
    }
  }
  if (!face.length && source.status === 'ready') {
    const drawType = pool ? { slots: pool.slots, prizes: pool.prizes } : knownType
    face = drawType ? drawScratchFace(drawType, random) : []
  }
  if (!pool) poolSource = 'missing'
  return {
    ...source,
    typeId,
    face,
    pool,
    poolHash: scratchPoolHash(pool),
    poolSource,
    payout: Array.isArray(source.payout) ? source.payout : source.reward ? [{ kind: source.reward.kind || 'material', name: source.reward.name, qty: Number(source.reward.qty) || 0 }] : null,
  }
}

// HTTP 响应层专用：未刮开的卡不下发 face/payout，否则玩家可以只挑高产出卡
// 喂给超级刮刮乐，把期望从 97.5% 拉高。落库仍用 extractPlayerState（保留 face）。
export function redactScratchFaces(state) {
  if (!state || !Array.isArray(state.scratchCards)) return state
  let touched = false
  const scratchCards = state.scratchCards.map((card) => {
    if (!card || card.status !== 'ready') return card
    touched = true
    return {
      id: card.id,
      typeId: card.typeId,
      status: card.status,
      createdAt: card.createdAt,
      poolHash: card.poolHash || scratchPoolHash(card.pool),
      slots: card.pool?.slots ?? card.slots ?? null,
    }
  })
  const redacted = touched ? { ...state, scratchCards } : state
  // 机器卡池里的 f 是「每格奖项下标」，等于卡面本身；下发时只给张数汇总。
  const owned = redacted.machines?.owned
  if (!owned) return redacted
  let machineTouched = false
  const nextOwned = {}
  Object.entries(owned).forEach(([id, machine]) => {
    const items = machine?.deposit?.items
    if (!items || !Array.isArray(items.queue) || !items.queue.length) { nextOwned[id] = machine; return }
    machineTouched = true
    const counts = {}
    items.queue.forEach((card) => { counts[card.t] = (counts[card.t] || 0) + 1 })
    nextOwned[id] = {
      ...machine,
      deposit: { ...machine.deposit, items: { pools: {}, queue: [], counts } },
    }
  })
  return machineTouched ? { ...redacted, machines: { ...redacted.machines, owned: nextOwned } } : redacted
}

// 新账号的初始存档。config 由服务端传入（全服共享一套配置）；
// random 由服务端传入 crypto 随机源，保证首抽刮刮乐卡面不可预测。
export function createInitialState(worldConfig = null, random = Math.random) {
  const config = normalizeConfig(worldConfig || DEFAULT_CONFIG)
  const blankTickets = Array.from({ length: 3 }, (_, i) => makeTicket(`ticket-${i + 1}`))
  return {
    version: STATE_VERSION,
    balanceRev: ROD_BALANCE_REV,
    updatedAt: Date.now(),
    activeTab: 'fishing',
    settings: { theme: DEFAULT_THEME },
    coins: 0,
    unlockedDepths: [...STARTING_DEPTHS],
    config,
    fishing: { running: true, phase: 'charging', progress: 6200, tension: 0, bite: null, lastTickAt: Date.now(), lastCatch: null, lastOutcome: null, sessionCount: 0, selectedDepthId: 'shore', recoverUntil: 0, recoverFrom: 0, lowDurability: false, autoRepairAt: 0, autoStopped: false },
    rod: { ...config.rods[0], id: `rod-${config.rods[0].id}`, levels: {}, status: 'active' },
    rods: [{ ...config.rods[0], id: `rod-${config.rods[0].id}`, levels: {}, status: 'active' }],
    inventory: { '浮木纤维': 18, '潮汐树脂': 11, '深蓝晶片': 6, '渊核碎片': 2, '旧日合金': 0 },
    fish: [],
    escapes: [],
    tickets: blankTickets,
    scratchCards: [
      makeScratchCard('scratch-1', config.scratchTypes[0].id, config.scratchTypes[0], random),
      makeScratchCard('scratch-2', config.scratchTypes[0].id, config.scratchTypes[0], random),
    ],
    warehouseLevel: 0,
    draws: {},
    npc: { quotes: {}, lastExchange: null },
    // 无灯黑市：第二套货币与订单。黑市未解锁时整块保持初始值，不影响鱼市。
    blackMarket: createBlackMarketState(),
    // 投币机器：未开机时为空壳，不产生任何产出。
    machines: createMachinesState(),
    // 逐个解锁：只推进 stage，不改任何经济数值。
    guide: createGuideState(),
    // 深海FX：positions 记份数，days / today 由服务端注入全服行情，不落玩家快照。
    fx: { positions: {}, days: {}, today: {}, bins: {}, trades: [] },
    stats: emptyStats(),
  }
}

function migrateRod(rod, config, legacyBalance) {
  const base = rodConfigFor(config, rod)
  const legacySpeed = Number(rod?.speed)
  const rawRate = Number(rod?.energyPerSecond)
  const energyPerSecond = Number.isFinite(rawRate) ? Math.max(1, rawRate) : Number.isFinite(legacySpeed) ? Math.max(1, legacySpeed) * BASE_ENERGY_PER_SECOND : base.energyPerSecond
  const floor = base.breakable ? 0 : 1
  const storedMax = Math.max(1, Number(rod?.maxDurability) || base.maxDurability)
  const storedDurability = Number.isFinite(Number(rod?.durability)) ? Number(rod.durability) : storedMax
  const breakable = base.breakable
  const legacyDepth = Number(rod?.depth)
  const maxDepth = Number.isFinite(Number(rod?.maxDepth)) ? Number(rod.maxDepth) : Number.isFinite(legacyDepth) ? Math.max(0, legacyDepth - 1) : base.maxDepth
  const { speed: _legacy, depth: _legacyDepth, ...withoutLegacySpeed } = rod || {}
  const levels = { ...(rod?.levels || {}) }
  // 旧存档里速度强化是直接改 energyPerSecond 的，换算成 speed 等级继续生效。
  if (!Object.keys(levels).length && Number.isFinite(rawRate)) {
    const speedStep = Math.max(1, upgradeAmount(base, 'speed'))
    const gained = Math.max(0, rawRate - base.energyPerSecond)
    if (gained > 0) levels.speed = Math.round(gained / speedStep)
  }
  const stats = rodStatsFrom(base, levels)
  // 只有旧平衡版本按耐久比例迁移；新存档的升级上限和维修溢出需原样保留。
  const durability = Math.max(floor, legacyBalance ? storedDurability / storedMax * stats.maxDurability : storedDurability)
  const status = breakable && durability <= 0 ? 'broken' : rod?.status === 'active' ? 'active' : 'stored'
  return { ...base, ...withoutLegacySpeed, upgrades: base.upgrades, levels, ...stats, maxDepth: clamp(maxDepth, 0, DEPTHS.length - 1), breakable, durability, status }
}

// 4 版把初始钓竿耐久改成 1000、进阶竿同步上调；旧存档里被持久化的 config.rods 需要一次性对齐。
// 平衡版本变更时把内置钓竿的张力曲线与升级步长拉回默认，
// 避免老存档继续用旧数值；玩家自建的竿（id 不匹配）原样保留。
function upgradeRodBalance(config, applied) {
  if (applied || !config || typeof config !== 'object') return config
  const list = Array.isArray(config.rods) ? config.rods : []
  return {
    ...config,
    rods: list.map((rod) => {
      const def = RODS.find((item) => item.id === rod.id)
      if (!def) return rod
      const previousMax = Math.max(1, Number(rod.maxDurability) || def.maxDurability)
      const previousDurability = Number.isFinite(Number(rod.durability)) ? Number(rod.durability) : previousMax
      const defaults = DEFAULT_CONFIG.rods.find((item) => item.id === def.id)
      const upgrades = (Array.isArray(rod.upgrades) ? rod.upgrades : []).map((upgrade) => {
        const target = defaults?.upgrades?.find((item) => item.id === upgrade.id)
        return target ? { ...upgrade, amount: target.amount } : upgrade
      })
      return {
        ...rod,
        maxDurability: def.maxDurability,
        durability: Math.round(previousDurability / previousMax * def.maxDurability),
        tension: { ...normalizeTension(rod.tension), maxRate: def.tension.maxRate, maxTension: def.tension.maxTension },
        upgrades,
      }
    }),
  }
}

// 新增奖池后，老存档的 config 里没有它；按 id 补齐缺失的默认场次，避免升级后看不到新内容。
function mergeNewPools(config) {
  if (!config || typeof config !== 'object') return config
  const existing = Array.isArray(config.lotteryTypes) ? config.lotteryTypes : []
  const ids = new Set(existing.map((type) => type.id))
  const missing = DEFAULT_CONFIG.lotteryTypes.filter((type) => !ids.has(type.id))
  if (!missing.length) return config
  return { ...config, lotteryTypes: [...existing, ...missing.map((type) => ({ ...type, prizes: type.prizes.map((tier) => [...tier]) }))] }
}

// 天赋系统已删除：迁移时把老存档里的 talents 字段剥掉，
// 否则它会原样带进新存档（解析遗留数据）。
function stripLegacyTalents(state) {
  if (!state || typeof state !== 'object') return state
  const { talents: _talents, ...rest } = state
  return rest
}

function migrateState(parsed, worldConfig = null) {
  const fresh = createInitialState(worldConfig)
  const version = Number(parsed?.version || 1)
  const balanceRev = Number(parsed?.balanceRev || 0)
  const config = normalizeConfig(mergeNewPools(upgradeRodBalance(parsed?.config, balanceRev >= ROD_BALANCE_REV)))
  // 天赋系统已整体移除：老存档里的这些等级全部丢弃。
  // 仓库等级从旧的「仓库扩容」天赋迁移出来，其余（自动维修/刮层/组合溢价）不再保留。
  const warehouseLevel = normalizeWarehouseLevel(parsed?.warehouseLevel, parsed?.talents)

  const rawProgress = Number(parsed?.fishing?.progress)
  const progress = version < 2 ? (rawProgress <= 1 ? rawProgress * ENERGY_PER_CATCH : rawProgress) : rawProgress
  const legacyBalance = balanceRev < ROD_BALANCE_REV
  const rods = (Array.isArray(parsed?.rods) && parsed.rods.length ? parsed.rods : fresh.rods).map((rod) => migrateRod(rod, config, legacyBalance))
  const activeRod = parsed?.rod
    ? migrateRod(parsed.rod, config, legacyBalance)
    : rods.find((rod) => rod.status === 'active') || rods[0]
  const legacyLabels = { 近岸: '河口', 浅海: '港湾', 外海: '礁石', 深海: '海沟' }
  const fishByDepth = { ...fresh.stats.fishByDepth }
  Object.entries(parsed?.stats?.fishByDepth || {}).forEach(([label, count]) => { const nextLabel = legacyLabels[label] || label; fishByDepth[nextLabel] = (fishByDepth[nextLabel] || 0) + count })
  const savedSeen = parsed?.stats?.comboSeen && typeof parsed.stats.comboSeen === 'object' ? parsed.stats.comboSeen : null
  // 老存档没有掉落记录：按背包里已有的鱼和各组合的历史统计反推一次。
  const derivedSeen = savedSeen ? { ...savedSeen } : (config.quotes.combos || []).reduce((map, combo) => {
    const hits = (parsed?.fish || []).filter((fish) => Array.isArray(fish.traits) && combo.traits.length > 0 && combo.traits.every((trait) => fish.traits.includes(trait))).length
    return hits > 0 ? { ...map, [combo.id]: hits } : map
  }, {})
  const stats = { ...fresh.stats, ...(parsed?.stats || {}), comboSeen: derivedSeen, fishByDepth, hits: Array.isArray(parsed?.stats?.hits) ? parsed.stats.hits : fresh.stats.hits, hitsByPool: parsed?.stats?.hitsByPool && typeof parsed.stats.hitsByPool === 'object' ? parsed.stats.hitsByPool : fresh.stats.hitsByPool, claimedTickets: Math.max(0, Number(parsed?.stats?.claimedTickets) || 0), claimedScratch: Math.max(0, Number(parsed?.stats?.claimedScratch) || 0) }
  // 老存档没有「累计获得」字段：按下注/刮开历史一次性补齐，避免解锁条件被误判为未达成。
  stats.totalTicketsEarned = Math.max(0, Math.round(Number(parsed?.stats?.totalTicketsEarned) || Number(parsed?.stats?.totalTickets) || 0))
  stats.totalScratchEarned = Math.max(0, Math.round(Number(parsed?.stats?.totalScratchEarned) || Number(parsed?.stats?.totalScratch) || 0))
  stats.totalExchanged = Math.max(0, Math.round(Number(parsed?.stats?.totalExchanged) || 0))
  stats.totalSold = Math.max(0, Math.round(Number(parsed?.stats?.totalSold) || 0))
  // 老存档按旧钓竿 maxDepth 反推已解锁海域，避免降级掉档。
  const legacyUnlocked = Array.isArray(parsed?.unlockedDepths) ? [] : depthForRod(activeRod).map((depth) => depth.id)
  const savedUnlocked = Array.isArray(parsed?.unlockedDepths) ? parsed.unlockedDepths.filter((id) => DEPTHS.some((depth) => depth.id === id)) : []
  const migratedUnlocked = DEPTHS.map((depth) => depth.id).filter((id) => STARTING_DEPTHS.includes(id) || savedUnlocked.includes(id) || legacyUnlocked.includes(id))
  const reachable = DEPTHS.filter((depth) => migratedUnlocked.includes(depth.id))
  const savedDepth = parsed?.fishing?.selectedDepthId
  const selectedDepthId = reachable.some((depth) => depth.id === savedDepth) ? savedDepth : reachable[0].id
  // 停钓线跟着自动维修阈值走：升级后阈值可能是 50，而老逻辑只认「低于 10」。
  // 读档时直接按真实停钓线推导 autoStopped，既不会丢掉维修标记，
  // 也能把旧版本存下来的「已经停钓但标记被抹掉」的存档重新捡回来。
  const stopLine = autoRepairThreshold({ config, rod: activeRod }) || LOW_DURABILITY_THRESHOLD
  const manualResume = Boolean(parsed?.fishing?.manualResume)
  const belowStopLine = activeRod.durability < stopLine
  const blackMarket = normalizeBlackMarket(parsed?.blackMarket, config)
  const settings = normalizeSettings(parsed?.settings)
  // 逐个解锁：老存档按已有进度一次性点亮，不重新引导。
  // 没有 guide 字段的存档（本版本之前）视为「已经过了引导」，
  // 否则老玩家会被锁在钓鱼页；新号为 false，从第一步开始。
  const legacyGuide = parsed?.guide === undefined || parsed?.guide === null
  const guide = legacyGuide
    ? { ...createGuideState(), stage: GUIDE_STEP_IDS.length, skipped: false, seen: Object.fromEntries([...GUIDE_STEP_IDS, ...GUIDE_INDEPENDENT_STEPS].map((id) => [id, true])) }
    : normalizeGuideState(parsed?.guide)
  // 「无灯」主题是黑市购买项：购买记录被清空（重置/改档）时回退默认主题。
  if (settings.theme === 'void' && !(Number(blackMarket.purchases?.['theme-void']) > 0)) settings.theme = DEFAULT_THEME
  return {
    ...fresh,
    ...stripLegacyTalents(parsed),
    version: STATE_VERSION,
    balanceRev: ROD_BALANCE_REV,
    settings,
    coins: Math.max(0, Number(parsed?.coins) || 0),
    unlockedDepths: migratedUnlocked,
    config,
    blackMarket,
    guide,
    warehouseLevel,
    rod: activeRod,
    rods: rods.map((rod) => rod.id === activeRod.id ? { ...rod, ...activeRod, status: activeRod.status } : rod),
    stats,
    // FX 存档：份数取整且不超过上限，避免改档刷出负库存。
    // days 是已结算日线（价格与 7 天回看的唯一来源），today 是当天还没结算的桶。
    fx: {
      positions: Object.keys(TRAITS_BY_ID).reduce((map, name) => {
        const held = Math.max(0, Math.min(config.fx.maxPosition, Math.floor(Number(parsed?.fx?.positions?.[name]) || 0)))
        return held > 0 ? { ...map, [name]: held } : map
      }, {}),
      days: Object.keys(TRAITS_BY_ID).reduce((map, name) => {
        const list = Array.isArray(parsed?.fx?.days?.[name]) ? parsed.fx.days[name] : []
        // 存档是紧凑数组 [day, close, net, volume, open, high, low]，老存档才是对象。
        // 两种形态都要能读：decodeBar 对数组按列解，对对象直接透传，
        // 之前按 bar.day 取会把所有数组行判成 NaN 全部丢掉，等于每次刷新清空行情。
        const kept = list
          .map(decodeBar)
          .filter((bar) => Number.isFinite(Number(bar?.day)))
          .map((bar) => ({
            day: Number(bar.day),
            net: Number(bar.net) || 0,
            volume: Number(bar.volume) || 0,
            imbalance: Number(bar.imbalance) || 0,
            move: Number(bar.move) || 0,
            open: Math.max(1, Number(bar.open) || Number(bar.close) || config.fx.traits[name]?.price || 1),
            high: Math.max(1, Number(bar.high) || Number(bar.close) || config.fx.traits[name]?.price || 1),
            low: Math.max(1, Number(bar.low) || Number(bar.close) || config.fx.traits[name]?.price || 1),
            close: Math.max(1, Number(bar.close) || config.fx.traits[name]?.price || 1),
          }))
          .sort((a, b) => a.day - b.day)
          // 与 settleFxDays 一致：保留一年，不再按 7 天回看窗口截断。
          .slice(-FX_KEEP_DAYS)
        return kept.length ? { ...map, [name]: kept.map(encodeBar) } : map
      }, {}),
      // 待结算桶只保留当前词条标的：老存档里是材料名，语义也不同，直接丢弃。
      today: Object.keys(TRAITS_BY_ID).reduce((map, name) => {
        const bucket = parsed?.fx?.today?.[name]
        if (!bucket || !Number.isFinite(Number(bucket.day))) return map
        const bins = normalizeFxBins(bucket.bins)
        return { ...map, [name]: { day: Number(bucket.day), net: Number(bucket.net) || 0, volume: Math.max(0, Number(bucket.volume) || 0), bins } }
      }, {}),
      // 已结算日的成交时间桶，只保留最近 30 天。
      bins: Object.keys(TRAITS_BY_ID).reduce((map, name) => {
        const days = parsed?.fx?.bins?.[name]
        if (!days || typeof days !== 'object') return map
        const kept = Object.entries(days)
          .map(([day, bins]) => [Number(day), normalizeFxBins(bins)])
          .filter(([day, bins]) => Number.isFinite(day) && bins.length)
        return kept.length ? { ...map, [name]: Object.fromEntries(kept) } : map
      }, {}),
      // 成交记录同理：只保留能对上词条标的的那些，老的备料成交没有意义。
      trades: (Array.isArray(parsed?.fx?.trades) ? parsed.fx.trades : [])
        .filter((trade) => trade && TRAITS_BY_ID[trade.name])
        .slice(0, 60),
    },
    fish: compactFishHistory((parsed?.fish || []).map((fish) => { const depth = DEPTHS.find((item) => item.id === fish.depthId) || DEPTHS.find((item) => item.label === fish.depth) ; return depth ? { ...fish, depthId: depth.id, depth: depth.label, depthColor: depth.color } : fish })),
    escapes: (Array.isArray(parsed?.escapes) ? parsed.escapes : []).map((fish) => { const depth = DEPTHS.find((item) => item.id === fish.depthId) || DEPTHS.find((item) => item.label === fish.depth) ; return depth ? { ...fish, depthId: depth.id, depth: depth.label, depthColor: depth.color } : fish }),
    // 老存档里兑过奖的票 / 卡已经结算过，直接清掉，避免又出现在背包里。
    // 旧卡的 reward 是单一奖项，迁移成一面重复的牌，保证兑奖逻辑统一走 payout；
    // 没卡面的待刮卡（老版本发卡时不生成）按当前奖池补一张，之后刮开只翻牌。
    scratchCards: (parsed?.scratchCards || fresh.scratchCards).filter((card) => card.status !== 'claimed').map((card) => migrateScratchCard(card, config)),
    tickets: (parsed?.tickets || fresh.tickets).filter((ticket) => !ticket.claimed && ticket.status !== 'CLAIMED'),
    fishing: {
      ...fresh.fishing,
      ...(parsed?.fishing || {}),
      selectedDepthId,
      phase: parsed?.fishing?.phase === 'reeling' && parsed?.fishing?.bite ? 'reeling' : 'charging',
      bite: parsed?.fishing?.phase === 'reeling' ? parsed.fishing.bite || null : null,
      tension: Math.max(0, Number(parsed?.fishing?.tension) || 0),
      progress: clamp(Number.isFinite(progress) ? progress : 0, 0, activeRod.energyPerCatch || ENERGY_PER_CATCH),
      recoverUntil: Math.max(0, Number(parsed?.fishing?.recoverUntil) || 0),
      recoverFrom: Math.max(0, Number(parsed?.fishing?.recoverFrom) || 0),
      lowDurability: belowStopLine,
      manualResume,
      // 低于停钓线且玩家没有手动续钓 = 系统停钓，等自动维修来救。
      // 玩家手动续钓过的低耐久竿不算 autoStopped，暂停时不会偷偷烧材料。
      autoStopped: belowStopLine && !manualResume,
      autoRepairAt: Math.max(0, Number(parsed?.fishing?.autoRepairAt) || 0),
      running: activeRod.durability > 0 && activeRod.status !== 'broken' && (!belowStopLine || manualResume) && Boolean(parsed?.fishing?.running),
    },
    machines: migrateMachinesState(parsed?.machines, config),
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createInitialState()
    // 打开页面时先补结算跨过的零点，价格才是「今天」的。
    return hydrateState(JSON.parse(raw))
  } catch {
    return createInitialState()
  }
}

// 把一份旧存档（任意历史版本）升级成当前结构并补结算跨过的日线。
// 服务端在首次导入浏览器存档时调用；domain 测试也走这条路径。
export function hydrateState(parsed, now = Date.now(), worldConfig = null) {
  return settleFxDays(migrateState(parsed, worldConfig), now)
}

// ---- 玩家快照 / 世界行情分离 ----
//
// 服务端权威模式下，深海FX 的日线与当日桶是全服共享的一份数据（fx_days / fx_bucket 表），
// 不能跟着每个玩家的存档一起落库，否则 N 个玩家就有 N 份互相矛盾的行情。
// 这两个函数就是「注入」与「剥离」的唯一入口，服务端读取时注入、写回前剥离。

export function mergeFxWorld(state, { days = {}, today = {}, bins = {} } = {}) {
  return { ...state, fx: { ...(state?.fx || {}), days, today, bins } }
}

export function extractPlayerState(state) {
  const { days: _days, today: _today, bins: _bins, ...fx } = state?.fx || {}
  return { ...state, fx: { positions: fx.positions || {}, trades: fx.trades || [] } }
}

export function saveState(state) {
  const next = { ...state, updatedAt: Date.now() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

// 当前账号已解锁的海域，替代原来的「钓竿 maxDepth」门禁。
export function depthsFor(state) {
  const unlocked = Array.isArray(state?.unlockedDepths) && state.unlockedDepths.length ? state.unlockedDepths : STARTING_DEPTHS
  return DEPTHS.filter((depth) => unlocked.includes(depth.id))
}

// 每个海域主要出土什么：海域选择面板用它给玩家交代「解锁这片海能拿到什么材料」。
// 只是展示用的提示，不影响掉落——掉落仍由海域 × 词条权重表决定。
export const DEPTH_PRODUCE = {
  shore: ['浮木纤维', '潮汐树脂'],
  shelf: ['浮木纤维', '潮汐树脂', '深蓝晶片'],
  open: ['潮汐锁钥', '深蓝晶片', '渊核碎片'],
  deep: ['潮汐锁钥', '渊核碎片', '旧日合金'],
  rift: ['深渊锁钥', '渊核碎片', '旧日合金'],
  abyss: ['深渊锁钥', '旧日合金', '渊核碎片'],
}

// 材料从哪来：写在海域卡片和刮刮乐说明里，避免玩家不知道该刷哪个系统。
export const MATERIAL_SOURCE = {
  浮木纤维: '刮刮乐 · 彩票',
  潮汐树脂: '刮刮乐 · 彩票',
  深蓝晶片: '刮刮乐 · 彩票',
  渊核碎片: '刮刮乐 · 彩票',
  潮汐锁钥: '彩票 · 黑市',
  深渊锁钥: '彩票 · 黑市',
  旧日合金: '彩票 · 黑市',
}

export function depthUnlockCost(state, depthId) {
  const config = state?.config || DEFAULT_CONFIG
  return config.depthUnlocks?.[depthId] ?? DEPTHS.find((depth) => depth.id === depthId)?.unlock ?? null
}

// 升级费用随等级递增：鱼币用 growth；主材料 / 副材料各自用 materialGrowth / secondMaterialGrowth，
// 缺省时沿用 growth，旧配置（如钓竿升级）的行为保持不变。
export function upgradeCostAt(upgrade, level = 0) {
  const step = Math.max(0, Math.floor(Number(level) || 0))
  const growth = Math.max(0, Number(upgrade?.growth) || 0)
  const growthOf = (value, fallback) => (value === undefined || value === null || value === ''
    ? fallback
    : Math.max(0, Number(value) || 0))
  const materialGrowth = growthOf(upgrade?.materialGrowth, growth)
  const secondMaterialGrowth = growthOf(upgrade?.secondMaterialGrowth, growth)
  const coinScale = 1 + growth * step
  const materialScale = 1 + materialGrowth * step
  const secondScale = 1 + secondMaterialGrowth * step
  const coins = Math.ceil(Math.max(0, Number(upgrade?.coins) || 0) * coinScale)
  const cost = Math.max(1, Math.ceil(Math.max(1, Number(upgrade?.cost) || 1) * materialScale))
  const secondCost = upgrade?.secondMaterial ? Math.max(1, Math.ceil(Math.max(1, Number(upgrade?.secondCost) || 1) * secondScale)) : 0
  return { coins, cost, secondCost, scale: coinScale, materialScale, secondScale }
}

export function canUnlockDepth(state, depthId) {
  const depth = DEPTHS.find((item) => item.id === depthId)
  if (!depth) return false
  if (depthsFor(state).some((item) => item.id === depthId)) return false
  const unlock = depthUnlockCost(state, depthId)
  if (!unlock) return true
  return (state.coins || 0) >= unlock.coins && (state.inventory?.[unlock.material] || 0) >= unlock.cost
}

export function unlockDepth(state, depthId) {
  const depth = DEPTHS.find((item) => item.id === depthId)
  if (!depth) return state
  const unlock = depthUnlockCost(state, depthId)
  if (!unlock) return state
  const unlocked = Array.isArray(state.unlockedDepths) && state.unlockedDepths.length ? state.unlockedDepths : [...STARTING_DEPTHS]
  if (unlocked.includes(depthId)) return state
  if ((state.coins || 0) < unlock.coins) return state
  if ((state.inventory?.[unlock.material] || 0) < unlock.cost) return state
  return {
    ...state,
    coins: state.coins - unlock.coins,
    inventory: { ...state.inventory, [unlock.material]: state.inventory[unlock.material] - unlock.cost },
    unlockedDepths: DEPTHS.map((item) => item.id).filter((id) => unlocked.includes(id) || id === depthId),
    fishing: { ...state.fishing, selectedDepthId: depthId },
  }
}

export function depthForRod(rod) {
  return DEPTHS.slice(0, clamp(Number(rod?.maxDepth ?? 0) + 1, 1, DEPTHS.length))
}

function rodEnergyPerSecond(state) {
  return Number.isFinite(Number(state.rod?.energyPerSecond)) ? Math.max(1, Number(state.rod.energyPerSecond)) : BASE_ENERGY_PER_SECOND
}

function rodEnergyPerCatch(state) {
  return Number.isFinite(Number(state.rod?.energyPerCatch)) ? Math.max(1, Number(state.rod.energyPerCatch)) : ENERGY_PER_CATCH
}

// 张力参数现在挂在钓竿上：换竿即换张力曲线，词条只做倍率修正。
// 钓竿张力曲线：耐久越低，最大张力越紧。耐久修正只作用在 maxTension 上，
// 不碰 maxRate / accelMs —— 加速与斜率是竿的固有属性，磨损只影响「能撑多久」。
export function rodTension(state) {
  const base = normalizeTension(state.rod?.tension ?? state.config?.tension)
  const maxDurability = Math.max(1, Number(state.rod?.maxDurability) || 1)
  const durability = Math.max(0, Number(state.rod?.durability) || 0)
  const factor = durabilityTensionFactor(durability / maxDurability)
  return { ...base, maxTension: Math.max(1, Math.round(base.maxTension * factor)) }
}

// 界面要展示「耐久修正」时用这个：和 rodTension 读同一份数据。
export function rodTensionDurabilityFactor(state) {
  const maxDurability = Math.max(1, Number(state.rod?.maxDurability) || 1)
  const durability = Math.max(0, Number(state.rod?.durability) || 0)
  return durabilityTensionFactor(durability / maxDurability)
}

function pickTraitCount(depth, random) {
  const [min, max] = depth.traitCount
  return min + Math.floor(random() * (max - min + 1))
}

export function rollBite(state, random = Math.random) {
  const available = depthsFor(state)
  const depth = available.find((item) => item.id === state.fishing.selectedDepthId) || available[0]
  const pool = fishPoolFor(depth.id)
  const config = state.config || DEFAULT_CONFIG
  const traits = config.traits || TRAITS
  const tensionCfg = rodTension(state)
  const count = Math.min(traits.length, pickTraitCount(depth, random))
  // 海域压强：越深的地方鱼挣扎越猛，同样钓竿的张力充得更快。
  const pressure = Math.max(0.1, Number(depth.pressure) || 1)
  const weights = config.depthTraitWeights?.[depth.id] || {}
  const candidates = pool.map((species) => {
    const picked = pickTraitsWeighted(traits, weights, count, random)
    const comboWeight = comboBiteChance(picked)
    return {
      species,
      picked,
      weight: biteWeightFor(species, comboWeight),
      comboWeight,
      maxTension: Math.max(10, aggregateTraitEffects(picked, 'maxTension', tensionCfg.maxTension)),
      tensionRate: Math.max(0.05, aggregateTraitEffects(picked, 'tensionRate', 1) * pressure),
      tensionDelay: Math.max(0, aggregateTraitEffects(picked, 'tensionDelay', tensionCfg.delayMs)),
      chargeRate: clamp(aggregateTraitEffects(picked, 'chargeRate', 1), 0.05, 5),
      lossBase: Math.max(0, aggregateTraitEffects(picked, 'loss', tensionCfg.baseLoss)),
    }
  })
  const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0)
  let roll = random() * totalWeight
  let chosen = candidates[candidates.length - 1]
  for (const item of candidates) {
    roll -= item.weight
    if (roll <= 0) { chosen = item; break }
  }
  const { species, picked } = chosen
  const tensionRate = Math.max(0.05, chosen.tensionRate)
  const chargeRate = clamp(chosen.chargeRate, 0.05, 5)
  const weight = Math.round((depth.value * 2 + random() * 4) * 10) / 10
  const fishRecord = {
    id: `fish-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: species.name,
    latin: species.latin,
    speciesClass: species.speciesClass,
    depth: depth.label,
    depthId: depth.id,
    depthColor: depth.color,
    traits: picked.map((trait) => trait.id),
    rarity: rarityLabel(species.rarity),
    rarityValue: Math.round(species.rarity),
    weight,
    status: 'fresh',
    caughtAt: stamp(),
  }
  return {
    fish: fishRecord,
    maxTension: chosen.maxTension,
    tensionRate,
    tensionDelay: chosen.tensionDelay,
    chargeRate,
    lossBase: chosen.lossBase,
    comboWeight: chosen.comboWeight,
    startedAt: Date.now(),
    biteWeight: Math.round(chosen.weight * 100) / 100,
  }
}

// 咬钩期间的实际充能速率：钓竿基础速度 × 该鱼的充能倍率。
// 结算、脱钩判定和 UI 展示都读这一个函数。
export function biteChargeRate(state, bite) {
  const factor = clamp(Number(bite?.chargeRate) || 1, 0.05, 5)
  return rodEnergyPerSecond(state) * factor
}

export function biteTension(state, bite, elapsedMs) {
  return tensionAt(elapsedMs, bite.tensionRate, bite.maxTension, rodTension(state), bite.tensionDelay)
}

// 咬钩的起始值：进度从 chargeAtBite 起算，张力从 0 起算，两者共用同一个时间原点
// （state.fishing.bite.startedAt）。结算与界面都必须从这两个值出发，不能用「当前快照 + 本帧增量」，
// 否则客户端手里的快照比服务端慢几百毫秒时，两条条就会错位。
export function biteStartCharge(state, bite) {
  const required = Math.max(1, Number(bite?.chargeRequired) || rodEnergyPerCatch(state))
  return clamp(Number(bite?.chargeAtBite) || 0, 0, required)
}

// 两条进度赛跑：钓鱼进度和张力都只增不减，谁先充满谁结算。
// escaped 的判定是 fillMs <= chargeMs：恰好同时充满算脱钩（对玩家更保守的一侧），
// 界面上的「谁先满」必须沿用同一个比较方向，不能写成严格小于。
export function biteTiming(state, bite) {
  const chargeRate = biteChargeRate(state, bite)
  const required = Math.max(1, Number(bite.chargeRequired) || rodEnergyPerCatch(state))
  const chargeMs = Math.max(1, (required - biteStartCharge(state, bite)) / chargeRate * 1000)
  const fillMs = tensionFillMs(bite.tensionRate, bite.maxTension, rodTension(state), bite.tensionDelay)
  const escaped = fillMs <= chargeMs
  return { fillMs, chargeMs, escaped, resolvedAtMs: escaped ? fillMs : chargeMs }
}

// 咬钩进行中的「权威」画面状态：给定当前时刻，两条条各自走到哪、以及谁先满。
// UI 外推和测试都走这里，保证屏幕上的两根条与结算规则出自同一段计算。
export function biteProgress(state, bite, at = Date.now()) {
  const startedAtRaw = Number(bite?.startedAt)
  const startedAt = Number.isFinite(startedAtRaw) ? startedAtRaw : Number(at)
  const required = Math.max(1, Number(bite?.chargeRequired) || rodEnergyPerCatch(state))
  const chargeRate = biteChargeRate(state, bite)
  const timing = biteTiming(state, bite)

  // 进度以「快照里的 progress」为基准，只把快照之后流逝的时间按当前速率外推。
  // 为什么不能用「咬钩起点 + 整个咬钩时长 × 当前速率」：速率会随竿、天赋中途变化，
  // 那样会让「此刻速率」追溯重算整段历史 —— 换竿或升级后进度条瞬间跳跃。
  // 以 lastTickAt 为锚只向前推进，进度天然单调，不会因为改倍率而回头。
  const anchorRaw = Number(state.fishing?.lastTickAt)
  const anchorProgressRaw = Number(state.fishing?.progress)
  const hasAnchor = Number.isFinite(anchorRaw) && Number.isFinite(anchorProgressRaw)
  const anchor = hasAnchor ? anchorRaw : startedAt
  const anchorProgress = Math.max(0, hasAnchor ? anchorProgressRaw : biteStartCharge(state, bite))
  const chargeAt = (stamp) => Math.min(required, anchorProgress + Math.max(0, Number(stamp) - anchor) / 1000 * chargeRate)

  const tensionCap = Math.max(1, Number(bite?.maxTension) || rodTension(state).maxTension)
  const tensionAt_ = (stamp) => clamp(biteTension(state, bite, Number(stamp) - startedAt), 0, tensionCap)

  // 两根条各自的终点时刻：进度看「还差多少能量」，张力看「曲线什么时候到顶」。
  // 两者都是绝对时刻，谁更早谁结算；同时到按脱钩（与服务端 fillMs <= chargeMs 一致）。
  const chargeFullAt = anchor + Math.max(0, required - anchorProgress) / chargeRate * 1000
  const tensionFullAt = startedAt + timing.fillMs
  const escaped = tensionFullAt <= chargeFullAt
  const settleAt = Math.min(chargeFullAt, tensionFullAt)
  const resolved = Number(at) >= settleAt
  // 到点后画面冻结在结算那一刻：另一根不会被继续推着涨，
  // 否则就会出现「两根都满」或「满了还在等」。
  const stamp = resolved ? settleAt : at

  // 到点时直接取上限：张力曲线按浮点数逐段积分，恰好落在结算时刻可能差 1e-13，
  // 直接判等会出现「显示 100% 却 ratio 0.9999999」这种抖动。
  const charge = stamp >= chargeFullAt ? required : chargeAt(stamp)
  const tension = stamp >= tensionFullAt ? tensionCap : tensionAt_(stamp)
  return {
    elapsedMs: Math.max(0, Number(at) - startedAt),
    progress: charge,
    required,
    chargeRate,
    tension,
    tensionMax: tensionCap,
    // 100% = 已到结算点。两条条在同一时刻只会有一条到 100%，另一条必然还没满。
    progressRatio: clamp(charge / required, 0, 1),
    tensionRatio: clamp(tension / tensionCap, 0, 1),
    timing,
    settleInMs: Math.max(0, settleAt - Number(at)),
    resolved,
    winner: escaped ? 'tension' : 'charge',
  }
}

// 拉锯磨损：只在该鱼带「拉锯损耗」时生效。拉锯阈值默认 80%，词条可继续压低；
// 超过阈值的每 100 点张力 × 损耗倍率 = 本次结算额外扣掉的耐久。
function sawWear(state, fish, tension, maxTension) {
  const traits = state.config?.traits || TRAITS
  let threshold = SAW_THRESHOLD_BASE
  let multiplier = 1
  let active = false
  ;(fish?.traits || []).forEach((id) => {
    const trait = traits.find((item) => item.id === id)
    ;(trait?.effects || []).forEach((effect) => {
      if (effect.type === 'sawThreshold') threshold += Number(effect.value) || 0
      if (effect.type === 'sawLoss') {
        active = true
        multiplier *= Math.max(0, Number(effect.value) || 0)
      }
    })
  })
  threshold = clamp(threshold, 0, SAW_THRESHOLD_BASE)
  if (!active) return { loss: 0, threshold, excess: 0 }
  const limit = Math.max(1, Number(maxTension) || 1)
  const excess = Math.max(0, (Number(tension) || 0) - threshold * limit)
  return { loss: Math.round((excess / 100) * multiplier * 10) / 10, threshold, excess }
}

// 结算一次咬钩：
// - 钓鱼进度先满 → 收杆入库，溢出量结转到下一条鱼；
// - 张力先满 → 脱钩扣耐久、清空钓鱼进度，随后停顿 recoveryMs 并把张力匀速退回 0。
export function resolveBite(state, bite, resolved, now = Date.now()) {
  const fish = bite.fish
  const resolvedAt = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const at = new Date(resolvedAt).toISOString()
  const chargeRequired = Math.max(1, Number(bite.chargeRequired) || rodEnergyPerCatch(state))
  const chargeNow = Math.max(0, Number(state.fishing.progress) || 0)
  // 判负方是哪一根，由 biteTiming 统一决定（同一时刻充满按脱钩处理）。
  const escaped = typeof resolved?.escaped === 'boolean' ? resolved.escaped : biteTiming(state, bite).escaped
  const baseFishing = { ...state.fishing, phase: 'charging', bite: null, sessionCount: (state.fishing.sessionCount || 0) + 1 }
  // 仓库满时钓鱼就应停止；这里再兜底一次，确保不会出现「鱼入库但没有售出记录」。
  if (!escaped && warehouseFull(state)) {
    return {
      ...state,
      fishing: {
        ...baseFishing,
        progress: 0,
        tension: 0,
        recoverUntil: 0,
        lowDurability: state.rod.durability < autoStopThreshold(state),
        running: false,
        autoStopped: false,
        lastTickAt: resolvedAt,
      },
    }
  }
  // 结算瞬间的张力：脱钩时就是张力上限，上钩时是当前张力条。
  const settleTension = escaped ? Math.max(0, Number(bite.maxTension) || 0) : clamp(Number(state.fishing.tension) || 0, 0, Number(bite.maxTension) || 0)
  const saw = sawWear(state, fish, settleTension, bite.maxTension)
  if (escaped) {
    const resistance = clamp(Number(state.rod.resistance) || 0, 0, 0.95)
    const baseDamage = Math.max(1, Math.round((Number(bite.lossBase) || 0) * (1 - resistance)))
    const requested = baseDamage + saw.loss
    const floor = state.rod.breakable ? 0 : 1
    const applied = Math.min(requested, Math.max(0, state.rod.durability - floor))
    const durability = Math.max(floor, state.rod.durability - applied)
    const status = state.rod.breakable && durability <= 0 ? 'broken' : state.rod.status
    const rod = { ...state.rod, durability, status }
    const record = {
      ...fish,
      escapedAt: at,
      loss: applied,
      prevented: requested - applied,
      lossBase: Number(bite.lossBase) || 0,
      sawLoss: saw.loss,
      sawThreshold: saw.threshold,
      resistance,
      maxTension: bite.maxTension,
      tensionRate: bite.tensionRate,
    }
    const lowDurability = durability < autoStopThreshold(state)
    const escapedState = {
      ...state,
      rod,
      rods: state.rods.map((item) => item.id === rod.id ? rod : item),
      escapes: [record, ...(state.escapes || [])].slice(0, 30),
      stats: {
        ...state.stats,
        totalEscapes: (state.stats.totalEscapes || 0) + 1,
        totalDurabilityLoss: (state.stats.totalDurabilityLoss || 0) + applied,
      },
      fishing: {
        ...baseFishing,
        progress: 0,
        tension: Math.min(bite.maxTension, Math.max(0, Number(state.fishing.tension) || 0)),
        recoverUntil: resolvedAt + RECOVERY_MS,
        recoverFrom: Math.min(bite.maxTension, Math.max(0, Number(state.fishing.tension) || bite.maxTension)),
        lowDurability,
        lastOutcome: { escaped: true, fish: record, loss: applied, lossBase: Number(bite.lossBase) || 0, sawLoss: saw.loss, resistance, at },
        running: durability > 0 && status !== 'broken' && (!lowDurability || Boolean(state.fishing.manualResume)),
        autoStopped: lowDurability && !state.fishing.manualResume,
      },
    }
    // 脱钩不影响市场：只有上钩和卖出才改变供给，跑掉的鱼从未进入过市场。
    return escapedState
  }
  const fishRecord = { ...fish, status: 'fresh' }
  // 仓库只统计 fresh 鱼；已兑换的记录只留最近 30 条做历史，避免存档无限膨胀。
  const capacity = warehouseCapacity(state)
  const previousFish = Array.isArray(state.fish) ? state.fish : []
  const freshFish = [fishRecord, ...previousFish.filter((item) => item.status === 'fresh')].slice(0, capacity)
  const fishHistory = previousFish.filter((item) => item.status !== 'fresh').slice(0, 30)
  const warehouseIsFull = freshFish.length >= capacity
  // 拉锯损耗在上钩时也结算：张力条超过阈值的部分会磨损钓竿。
  const floor = state.rod.breakable ? 0 : 1
  const sawApplied = Math.min(saw.loss, Math.max(0, state.rod.durability - floor))
  const durability = Math.max(floor, state.rod.durability - sawApplied)
  const status = state.rod.breakable && durability <= 0 ? 'broken' : state.rod.status
  const rod = { ...state.rod, durability, status }
  const lowDurability = durability < autoStopThreshold(state)
  // 记录「掉落过的词条组合」：组合溢价天赋只允许升级见过的组合。
  const comboSeen = { ...(state.stats.comboSeen || {}) }
  ;(state.config?.quotes?.combos || []).forEach((combo) => {
    if (combo.traits.length > 0 && combo.traits.every((trait) => fish.traits.includes(trait))) {
      comboSeen[combo.id] = (comboSeen[combo.id] || 0) + 1
    }
  })
  const caughtState = {
    ...state,
    rod,
    rods: state.rods.map((item) => item.id === rod.id ? rod : item),
    fish: [...freshFish, ...fishHistory],
    stats: {
      ...state.stats,
      totalCatches: (state.stats.totalCatches || 0) + 1,
      totalDurabilityLoss: (state.stats.totalDurabilityLoss || 0) + sawApplied,
      fishByDepth: { ...state.stats.fishByDepth, [fish.depth]: (state.stats.fishByDepth?.[fish.depth] || 0) + 1 },
      comboSeen,
    },
    fishing: {
      ...baseFishing,
      progress: Math.max(0, chargeNow - chargeRequired),
      tension: 0,
      recoverUntil: 0,
      lowDurability,
      lastCatch: { fishId: fish.id, fish: fishRecord, finalLoss: sawApplied, sawLoss: saw.loss, at },
      lastOutcome: { escaped: false, fish: fishRecord, loss: sawApplied, sawLoss: saw.loss, at },
      running: !warehouseIsFull && durability > 0 && status !== 'broken' && (!lowDurability || Boolean(state.fishing.manualResume)),
      autoStopped: lowDurability && !state.fishing.manualResume,
    },
  }
  // 上钩把鱼身上的词条抽离市场，供给减少 → 当日记正流入。
  return fxAppendFlow(caughtState, fxBiteFlow(fishRecord), resolvedAt)
}

// 每个循环开始时鱼即咬钩：钓鱼进度从当前值继续上涨，张力从 0 开始上涨。
function startBite(state, at, random = Math.random) {
  const required = rodEnergyPerCatch(state)
  const progress = Math.min(required, Math.max(0, Number(state.fishing.progress) || 0))
  return {
    ...rollBite(state, random),
    startedAt: at,
    chargeRequired: required,
    chargeAtBite: progress,
  }
}

const isReeling = (fishing) => fishing.phase === 'reeling' && Boolean(fishing.bite)

// 停钓线：普通情况是 10 点保护线；一旦升级了自动维修阈值，
// 就由天赋阈值接管（阈值 20 时钓到 20 就交给自动维修，低等级也不会被 10 线挡住）。
export function autoStopThreshold(state) {
  const threshold = autoRepairThreshold(state)
  return threshold > 0 ? threshold : LOW_DURABILITY_THRESHOLD
}
// 时间戳可能是 0（测试里从 0 起算），不能直接用 `||` 兜底。
const timeOf = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

// 两条进度独立累积：钓鱼进度按充能速率上涨，张力只在咬钩后按曲线上涨。
// 脱钩后清空进度并进入 recoverUntil 的停顿，期间张力从满值匀速退回 0。
// options.maxSteps：一次推进最多结算几条鱼。在线同步用默认 4；服务端离线追算传大值。
// options.random：随机源，服务端传入 crypto 派生的 RNG，避免玩家预测咬钩结果。
export function advanceFishing(state, now = Date.now(), options = {}) {
  const { maxSteps = 4, random = Math.random } = options
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  // 跨过零点就先结算日线：这样价格在新的一天开始前就定好了，和彩票开奖一致。
  // settleFxDays 在不需要结算时原样返回，所以这里的引用比较仍然有效。
  const settled = settleFxDays(state, timestamp)
  // 仓库满后立刻停钓：不再产生新鱼，也不会出现只有入库没有售出的流水。
  if (settled.fishing.running && warehouseFull(settled)) {
    return { ...settled, fishing: { ...settled.fishing, running: false, lastTickAt: timestamp } }
  }
  // 天赋自动维修先于停钓判定：耐久被补回阈值以上就不用打断挂机。
  const repaired = autoRepairRod(settled, timestamp)
  if (repaired !== settled) {
    // 维修后仍在阈值以下（材料只够补一点）就按停钓处理，不继续累积进度。
    if (!repaired.fishing.running) return repaired
    return advanceFishingCore(repaired, timestamp, { maxSteps, random })
  }
  if (!settled.fishing.running || settled.rod.durability <= MIN_DURABILITY || settled.rod.status === 'broken') return settled
  // 耐久跌破停钓线自动停钓，除非玩家手动点过继续。
  if (settled.rod.durability < autoStopThreshold(settled) && !settled.fishing.manualResume) {
    return { ...settled, fishing: { ...settled.fishing, running: false, lowDurability: true, autoStopped: true } }
  }
  return advanceFishingCore(settled, timestamp, { maxSteps, random })
}

function advanceFishingCore(state, timestamp, { maxSteps = 4, random = Math.random } = {}) {
  const lastTickAt = Number.isFinite(Number(state.fishing.lastTickAt)) ? Number(state.fishing.lastTickAt) : timestamp
  let cursor = lastTickAt
  let current = state

  if (isReeling(state.fishing)) {
    const bite = state.fishing.bite
    const timing = biteTiming(state, bite)
    const elapsed = timestamp - timeOf(bite.startedAt, cursor)
    if (elapsed < timing.resolvedAtMs) {
      // 进度从「已落库的 progress」按本段时间累加，不能用「咬钩起点 + 整个咬钩时长 × 当前速率」：
      // 速率会中途变化，追溯重算会让进度无端跳一大截。
      // 以 cursor 为锚只累加 [cursor, timestamp]，与 catchUp 的分段推进保持一致。
      const current = Math.max(0, Number(state.fishing.progress) || 0)
      return {
        ...state,
        fishing: {
          ...state.fishing,
          progress: current + Math.max(0, timestamp - cursor) / 1000 * biteChargeRate(state, bite),
          tension: biteTension(state, bite, elapsed),
          lastTickAt: timestamp,
        },
      }
    }
  }

  // 从「上一次结算时刻」开始重放。在线一次最多结算 4 条，避免长时间挂机后卡死；
  // 服务端离线追算会传入更大的 maxSteps。
  let progress = Math.max(0, Number(state.fishing.progress) || 0)
  let tension = Math.max(0, Number(state.fishing.tension) || 0)
  let recoverUntil = Math.max(0, Number(state.fishing.recoverUntil) || 0)
  let recoverFrom = Math.max(0, Number(state.fishing.recoverFrom) || 0)
  let bite = isReeling(state.fishing) ? state.fishing.bite : null
  current = state

  const steps = Math.max(1, Math.floor(Number(maxSteps) || 4))
  for (let step = 0; step < steps; step += 1) {
    if (warehouseFull(current)) {
      return { ...current, fishing: { ...current.fishing, running: false, lastTickAt: timestamp } }
    }
    if (recoverUntil > cursor) {
      // 停顿期：进度不动，张力从满值匀速退回 0。
      const end = Math.min(timestamp, recoverUntil)
      const ratio = clamp((end - (recoverUntil - RECOVERY_MS)) / RECOVERY_MS, 0, 1)
      tension = recoverFrom * (1 - ratio)
      cursor = end
      if (end < recoverUntil) {
        return { ...current, fishing: { ...current.fishing, phase: 'charging', bite: null, progress: 0, tension, recoverUntil, recoverFrom, lastTickAt: timestamp } }
      }
      tension = 0
      recoverFrom = 0
      recoverUntil = 0
      bite = null
    }

    if (!bite) {
      bite = startBite(current, cursor, random)
      current = { ...current, fishing: { ...current.fishing, phase: 'reeling', bite } }
    }

    const timing = biteTiming(current, bite)
    const biteStartedAt = timeOf(bite.startedAt, cursor)
    const resolvedAt = biteStartedAt + timing.resolvedAtMs
    if (resolvedAt > timestamp) {
      // 与上面一样：进度从已有 progress 累加本段，张力用咬钩起点做原点。
      const charged = progress + Math.max(0, timestamp - cursor) / 1000 * biteChargeRate(current, bite)
      return {
        ...current,
        fishing: {
          ...current.fishing,
          phase: 'reeling',
          bite,
          progress: charged,
          tension: biteTension(current, bite, timestamp - biteStartedAt),
          recoverUntil,
          recoverFrom,
          lastTickAt: timestamp,
        },
      }
    }

    const charged = progress + Math.max(0, resolvedAt - cursor) / 1000 * biteChargeRate(current, bite)
    current = resolveBite(
      { ...current, fishing: { ...current.fishing, progress: charged, tension: biteTension(current, bite, resolvedAt - biteStartedAt) } },
      bite,
      { escaped: timing.escaped },
      resolvedAt,
    )
    // 结算必须让时间前进，否则上面的循环会原地打转。
    if (resolvedAt <= cursor) break
    cursor = resolvedAt
    progress = Math.max(0, Number(current.fishing.progress) || 0)
    tension = Math.max(0, Number(current.fishing.tension) || 0)
    recoverUntil = Math.max(0, Number(current.fishing.recoverUntil) || 0)
    recoverFrom = Math.max(0, Number(current.fishing.recoverFrom) || 0)
    bite = null
    // 上钩/脱钩可能把耐久打进停钓线以内：自动维修天赋要在这里接住，
    // 否则这次结算会直接把钓鱼停掉，玩家得手动点「继续钓鱼」才能等到下一次维修。
    if (!current.fishing.running) current = autoRepairRod(current, resolvedAt)
    // 上钩也可能触发拉锯损耗把竿磨断，不能再咬下一条。
    if (!current.fishing.running || current.rod.status === 'broken' || current.rod.durability <= MIN_DURABILITY) break
  }

  return { ...current, fishing: { ...current.fishing, phase: 'charging', bite: null, progress, tension, recoverUntil, recoverFrom, lastTickAt: timestamp } }
}

export function toggleFishing(state, now = Date.now()) {
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  if (state.fishing.running) {
    const accrued = advanceFishing(state, timestamp)
    return { ...accrued, fishing: { ...accrued.fishing, running: false, autoStopped: false, lastTickAt: timestamp } }
  }
  if (state.rod.durability <= MIN_DURABILITY || state.rod.status === 'broken') return state
  // 仓库满时无法开始钓鱼；先去潮汐商会出售。
  if (warehouseFull(state)) return state
  const pausedFor = Math.max(0, timestamp - timeOf(state.fishing.lastTickAt, timestamp))
  const bite = state.fishing.bite ? { ...state.fishing.bite, startedAt: timeOf(state.fishing.bite.startedAt, timestamp) + pausedFor } : null
  const recoverUntil = Number(state.fishing.recoverUntil) > 0 ? Number(state.fishing.recoverUntil) + pausedFor : 0
  return { ...state, fishing: { ...state.fishing, running: true, bite, recoverUntil, lowDurability: false, manualResume: true, autoStopped: false, lastTickAt: timestamp } }
}

function drawForBatch(state, batchId) {
  return state.draws[batchId] || { batchId, status: 'open', drawnAt: null, numbers: [], commitment: 'commit-' + batchId.slice(0, 10), pools: { normal: 'WOD-N-' + batchId.slice(0, 10), advanced: 'WOD-A-' + batchId.slice(0, 10) } }
}

export function chooseLottery(state, ticketId, tier) {
  const ticket = state.tickets.find((t) => t.id === ticketId)
  if (!ticket || ticket.status !== 'BLANK') return state
  return chooseLotteryBatch(state, 1, tier, [ticketId])
}

// 合成一张彩票需要消耗多张空白票：普通 3 / 高级 6 / 大师 10，数量在后台可配。
export function ticketCostFor(config, tierId) {
  const type = lotteryTypeFor(config, tierId)
  return Math.max(1, Number(type?.ticketCost) || 3)
}

// 按「能合成几张」把空白票消耗掉，返回新彩票。
export function chooseLotteryBatch(state, quantity, tier, ticketIds = null, random = Math.random, at = Date.now(), types = state.config?.lotteryTypes || DEFAULT_CONFIG.lotteryTypes) {
  const type = types.find((item) => item.id === tier)
  if (!type) return state
  const cost = Math.max(1, type.ticketCost)
  const blankTickets = state.tickets.filter((ticket) => ticket.status === 'BLANK')
  const affordable = Math.floor(blankTickets.length / cost)
  const safeQuantity = clamp(Math.floor(Number(quantity) || 0), 0, affordable)
  if (safeQuantity === 0) return state
  const need = safeQuantity * cost
  // 指定了号码票时优先用它，再用其余空白票补足合成所需的数量。
  const preferred = ticketIds?.length ? blankTickets.filter((ticket) => ticketIds.includes(ticket.id)).map((ticket) => ticket.id).slice(0, need) : []
  const rest = blankTickets.map((ticket) => ticket.id).filter((id) => !preferred.includes(id))
  const selectedIds = [...preferred, ...rest].slice(0, need)
  if (selectedIds.length < need) return state
  const assignedAt = new Date(at).toISOString()
  const batchId = getBatchId(new Date(at))
  const existingDraw = drawForBatch(state, batchId)
  const consumed = new Set(selectedIds)
  // 每 cost 张空白票合成一张号码票；优先让玩家指定的那张当号码票。
  const groups = new Set()
  for (let i = 0; i < selectedIds.length; i += cost) {
    const chunk = selectedIds.slice(i, i + cost)
    groups.add(chunk.find((id) => preferred.includes(id)) || chunk[chunk.length - 1])
  }
  const tickets = state.tickets.map((ticket) => {
    if (!consumed.has(ticket.id)) return ticket
    if (!groups.has(ticket.id)) return null
    return { ...ticket, status: 'ASSIGNED', tier, numbers: drawPoolNumbers(type, random), batchId, assignedAt }
  }).filter(Boolean)
  return { ...state, draws: { ...state.draws, [batchId]: existingDraw }, tickets, stats: { ...state.stats, totalTickets: state.stats.totalTickets + safeQuantity } }
}

// 「我的彩票」排序：命中数多的在前；命中数相同则后下注的在前。
// 待开奖的票还没有命中数，按 0 参与排序，用下注时间区分先后。
// 老存档没有 assignedAt，退回批次时间与建票时间，顺序仍然稳定。
export function sortNumberedTickets(tickets) {
  const betAt = (ticket) => Date.parse(ticket.assignedAt || ticket.batchId || ticket.createdAt || '') || 0
  return [...tickets].sort((a, b) => (Number(b.hits) || 0) - (Number(a.hits) || 0) || betAt(b) - betAt(a))
}

// 抽一个奖池的号码。服务端开奖也走这里，随机源由调用方注入 crypto。
export function drawPoolNumbers(type, random = Math.random) {
  const pool = []
  for (let n = type.min; n <= type.max; n += 1) pool.push(n)
  const count = Math.max(1, Math.min(type.pick, pool.length))
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count).sort((a, b) => a - b)
}

// 把开奖号码应用到该批次的号码票上。
// 服务端在批次关闭时生成一次号码，然后对每个玩家调用这个函数结算。
export function applyDrawNumbers(state, batchId, numbers, config = state.config || DEFAULT_CONFIG) {
  if (!batchId || !numbers) return state
  const hitStats = [...state.stats.hits]
  const hitsByPool = { ...(state.stats.hitsByPool || {}) }
  let touched = false
  const tickets = state.tickets.map((ticket) => {
    if (ticket.batchId !== batchId || ticket.status !== 'ASSIGNED') return ticket
    const drawnNumbers = numbers[ticket.tier]
    if (!Array.isArray(drawnNumbers)) return ticket
    touched = true
    const hits = ticket.numbers.filter((n) => drawnNumbers.includes(n)).length
    const rewards = rewardFor(ticket.tier, hits, config)
    hitStats[hits] = (hitStats[hits] || 0) + 1
    const pool = hitsByPool[ticket.tier] ? [...hitsByPool[ticket.tier]] : Array(7).fill(0)
    pool[hits] = (pool[hits] || 0) + 1
    hitsByPool[ticket.tier] = pool
    return { ...ticket, status: 'DRAWN', drawnNumbers, hits, rewards, claimed: false }
  })
  return touched ? { ...state, tickets, stats: { ...state.stats, hits: hitStats, hitsByPool } } : state
}

// 演示用开奖：把当前批次的号码用本地随机源抽一遍并写进 draws。
// 服务端权威模式下不再由浏览器调用，保留给 domain 测试。
export function simulateDraw(state, random = Math.random) {
  const config = state.config || DEFAULT_CONFIG
  const batchId = getBatchId()
  const draw = state.draws[batchId] || { batchId, status: 'open', pools: { normal: 'WOD-N-' + batchId.slice(0, 10), advanced: 'WOD-A-' + batchId.slice(0, 10) } }
  const numbers = {}
  config.lotteryTypes.forEach((type) => { numbers[type.id] = drawPoolNumbers(type, random) })
  const drawRecord = { ...draw, status: 'drawn', drawnAt: stamp(), numbers }
  const settled = applyDrawNumbers(state, batchId, numbers, config)
  return { ...settled, draws: { ...settled.draws, [batchId]: drawRecord } }
}

// 命中分布：超几何分布 P(k) = C(pick,k)·C(N-pick,pick-k)/C(N,pick)。
function choose(n, k) {
  if (k < 0 || k > n) return 0n
  let result = 1n
  for (let i = 1; i <= k; i += 1) result = (result * BigInt(n - k + i)) / BigInt(i)
  return result
}

export function hitDistribution(type) {
  const min = Math.max(0, Number(type?.min) || 0)
  const max = Math.max(min, Number(type?.max) || min)
  const pick = Math.max(1, Number(type?.pick) || 1)
  const total = max - min + 1
  const denominator = choose(total, pick)
  return Array.from({ length: pick + 1 }, (_, hit) => {
    const ways = choose(pick, hit) * choose(total - pick, pick - hit)
    return { hit, chance: denominator === 0n ? 0 : Number(ways) / Number(denominator) }
  })
}

export function rewardFor(tier, hits, config) {
  const type = lotteryTypeFor(config, tier)
  const table = type.prizes || []
  return table[hits] || table[table.length - 1] || []
}

// 兑奖即出库：奖励入账后，这些号码票从「我的彩票」里移除，不再占列表。
// 开奖结果同时写进深海FX 流水：实际材料产出高于开奖前的期望就拉涨，反之压跌。
export function claimAll(state, now = Date.now()) {
  const config = state.config || DEFAULT_CONFIG
  const claimable = state.tickets.filter((t) => t.status === 'DRAWN' && !t.claimed)
  if (!claimable.length) return state
  const inventory = { ...state.inventory }
  let coins = Math.max(0, Number(state.coins) || 0)
  let rods = [...state.rods]
  const lines = []
  claimable.forEach((ticket) => ticket.rewards.forEach((reward) => {
    if (reward.type === 'coin') coins += Math.max(0, Number(reward.qty) || 0)
    if (reward.type === 'material') inventory[reward.name] = (inventory[reward.name] || 0) + reward.qty
    if (reward.type === 'rod') {
      const base = config.rods.find((rod) => rod.id === reward.rodId) || config.rods.find((rod) => rod.name === reward.name) || config.rods[config.rods.length - 1]
      rods = [...rods, { ...base, id: `rod-${base.id}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, durability: base.maxDurability, status: 'stored' }]
    }
    lines.push(`${reward.name}${reward.qty > 1 ? ` ×${reward.qty}` : ''}`)
  }))
  const claimedIds = new Set(claimable.map((ticket) => ticket.id))
  const settled = {
    ...state,
    inventory,
    coins,
    rods,
    tickets: state.tickets.filter((ticket) => !claimedIds.has(ticket.id)),
    stats: {
      ...state.stats,
      claimedPrizes: (state.stats.claimedPrizes || 0) + claimable.length,
      claimedTickets: (state.stats.claimedTickets || 0) + claimable.length,
    },
  }
  return settled
}

// 刮刮乐兑奖按「相同图案凑够所需数量」结算：一组 n 个相同奖励能凑出 C(n, k) 次，
// k 是该奖项配置的所需数量（默认 2，即原来的两两结算）。
const combination = (n, k) => {
  if (k < 1 || n < k) return 0
  let result = 1
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i
  return Math.round(result)
}

const scratchGroupKey = (slot) => `${slot.kind || 'material'}:${slot.name}:${slot.qty || 1}:${scratchNeedOf(slot)}`
const scratchNeedOf = (slot) => clamp(Math.round(Number(slot?.need) || 2), 2, SCRATCH_MAX_SLOTS)

// 按图案分组：同一 key 的格子共享所需数量，凑够才算一次结算。
function groupScratchFace(face) {
  const groups = new Map()
  ;(Array.isArray(face) ? face : []).forEach((slot) => {
    if (!slot?.name) return
    const key = scratchGroupKey(slot)
    const entry = groups.get(key) || { kind: slot.kind || 'material', name: slot.name, qty: Math.max(1, Number(slot.qty) || 1), count: 0, need: scratchNeedOf(slot) }
    entry.count += 1
    groups.set(key, entry)
  })
  return groups
}

export function scratchSettlement(face) {
  const lines = [...groupScratchFace(face).values()].map((line) => ({ ...line, combos: combination(line.count, line.need) }))
  const pairs = lines.reduce((sum, line) => sum + line.combos, 0)
  const payouts = lines
    .filter((line) => line.combos > 0)
    .map((line) => ({ kind: line.kind, name: line.name, qty: line.qty * line.combos, count: line.count, need: line.need }))
  return { lines, pairs, payouts }
}

// 高亮直接由卡面分组得出，不经过 payout：
// payout 里的数量是「合并后的总奖励」，三连时会翻倍，按它反推永远对不上格子。
export function scratchPairedSlots(face) {
  const list = Array.isArray(face) ? face : []
  const flags = list.map(() => false)
  groupScratchFace(face).forEach((line) => {
    if (line.count < line.need) return
    list.forEach((slot, index) => { if (slot?.name && scratchGroupKey(slot) === scratchGroupKey(line)) flags[index] = true })
  })
  return flags
}

export const scratchHasPair = (face) => scratchSettlement(face).pairs > 0

// 牌面布局：质数格数一排铺开；否则按 2 / 3 的倍数分成 2 / 3 行，
// 保证横向比纵向长（6 格 = 3 列 × 2 行，9 格 = 3 × 3）。
const isPrime = (value) => {
  if (value < 2) return false
  for (let divisor = 2; divisor * divisor <= value; divisor += 1) if (value % divisor === 0) return false
  return true
}

export function scratchGridLayout(slots) {
  const count = clamp(Math.round(Number(slots) || SCRATCH_DEFAULT_SLOTS), SCRATCH_MIN_SLOTS, SCRATCH_MAX_SLOTS)
  if (isPrime(count)) return { cols: count, rows: 1 }
  if (count % 2 === 0) return { cols: count / 2, rows: 2 }
  if (count % 3 === 0) return { cols: count / 3, rows: 3 }
  return { cols: count, rows: 1 }
}

// 从奖池按权重发牌；每格独立抽取，所以可能重复（重复才兑奖）。
export function drawScratchFace(type, random = Math.random) {
  const prizes = Array.isArray(type?.prizes) && type.prizes.length ? type.prizes : DEFAULT_CONFIG.scratchTypes[0].prizes
  const slots = clamp(Math.round(Number(type?.slots) || SCRATCH_DEFAULT_SLOTS), SCRATCH_MIN_SLOTS, SCRATCH_MAX_SLOTS)
  const totalWeight = prizes.reduce((sum, prize) => sum + Math.max(1, Number(prize.weight) || 1), 0)
  return Array.from({ length: slots }, () => {
    let roll = random() * totalWeight
    let picked = prizes[prizes.length - 1]
    for (const prize of prizes) {
      roll -= Math.max(1, Number(prize.weight) || 1)
      if (roll <= 0) { picked = prize; break }
    }
    return { id: picked.id, kind: picked.kind || 'material', name: picked.name, qty: Math.max(1, Number(picked.qty) || 1), need: Math.max(2, Math.min(SCRATCH_MAX_SLOTS, Math.round(Number(picked.need) || 2))) }
  })
}

// ---- 自动维修 / 刮层直觉 / 仓库扩容 ----
//
// 天赋系统整体删除。三条线各自换成更简单、更好理解的形式：
// - 自动维修：每根钓竿自带的升级项（见 DEFAULT_CONFIG.rods[].upgrades）；
// - 刮层直觉：每刮 10 次静默升一档，不显示、不花费；
// - 仓库扩容：纯鱼币升级，入口在潮汐商会右上角。

// 自动维修的触发阈值（耐久低于它就修）。取值来自这根竿自己的 autoRepair 升级等级。
// 0 级 = 未开启自动维修。
export function autoRepairThreshold(state, rod = state?.rod) {
  const upgrade = rodUpgrade(rod, 'autoRepair')
  if (!upgrade) return 0
  const level = upgradeLevel(rod, 'autoRepair')
  if (level <= 0) return 0
  const base = Math.max(0, Number(upgrade.thresholdBase) || 0)
  const step = Math.max(0, Number(upgrade.thresholdStep) || 0)
  return Math.max(0, base + (level - 1) * step + step)
}

// 自动维修一次回多少耐久（比例）。
export function autoRepairRestore(rod = null) {
  const upgrade = rodUpgrade(rod, 'autoRepair')
  const base = Number(upgrade?.restoreBase)
  return clamp(Number.isFinite(base) ? base : 0.9, 0.1, 2)
}

// 溢出维修是初始自带的：耐久上限本身开放到「无限」，维修只受「当前未满」约束。
// 因此这里不再提供固定额度，语义改成「是否允许溢出」。
export const ROD_OVERFLOW_UNLIMITED = Infinity

// 当前这根竿的耐久上限：`maxDurability` 是标称值，溢出后可以继续往上修。
// 只要耐久低于当前上限就可以修；上限在「已溢出」时取耐久本身，避免无限循环。
export function rodDurabilityCap(state, rod = state?.rod) {
  const base = Math.max(1, Number(rod?.maxDurability) || 1)
  const current = Math.max(0, Number(rod?.durability) || 0)
  // 溢出维修初始自带：允许超过标称上限，所以上限始终比当前耐久高一点点。
  return Math.max(base, current)
}

// 仓库扩容：纯鱼币升级，等级存在 state.warehouseLevel。
export function warehouseLevel(state) {
  const config = (state?.config || DEFAULT_CONFIG).warehouse || DEFAULT_CONFIG.warehouse
  return clamp(Math.floor(Number(state?.warehouseLevel) || 0), 0, config.maxLevel)
}

export function warehouseCapacity(state) {
  const config = (state?.config || DEFAULT_CONFIG).warehouse || DEFAULT_CONFIG.warehouse
  const value = config.base + warehouseLevel(state) * config.step
  return clamp(Math.round(value), config.base, config.base + config.step * config.maxLevel)
}

// 下一级仓库扩容的鱼币价格；已满级返回 null。
export function warehouseUpgradeCost(state) {
  const config = (state?.config || DEFAULT_CONFIG).warehouse || DEFAULT_CONFIG.warehouse
  const level = warehouseLevel(state)
  if (level >= config.maxLevel) return null
  return { coins: Math.ceil(config.coins * (1 + config.growth * level)), level, next: level + 1 }
}

export function canUpgradeWarehouse(state) {
  const cost = warehouseUpgradeCost(state)
  if (!cost) return false
  return (Number(state?.coins) || 0) >= cost.coins
}

// 升级仓库：只扣鱼币，不消耗材料。
export function upgradeWarehouse(state) {
  const cost = warehouseUpgradeCost(state)
  if (!cost || (Number(state?.coins) || 0) < cost.coins) return state
  return { ...state, coins: Math.max(0, (Number(state.coins) || 0) - cost.coins), warehouseLevel: cost.next }
}

// 刮层直觉：每刮 perLevels 次，阈值与半径各升一档；等级由累计刮开次数推导，
// 所以不需要额外存档字段，读档与重置都自动正确。
export function scratchLuckConfig(state) {
  return (state?.config || DEFAULT_CONFIG).scratchLuck || DEFAULT_CONFIG.scratchLuck
}

export function scratchLuckLevel(state) {
  const config = scratchLuckConfig(state)
  const total = Math.max(0, Math.floor(Number(state?.stats?.totalScratch) || 0))
  return clamp(Math.floor(total / config.perLevels), 0, config.maxLevel)
}

// 刮开阈值：45% 起，每档 -0.45%（20 档到 36%）。静默生效，不在任何界面展示。
export function scratchThreshold(state) {
  const config = scratchLuckConfig(state)
  const level = scratchLuckLevel(state)
  return clamp(config.thresholdBase + level * config.thresholdStep, 0.02, 1)
}

// 刮除半径：17px 起，每档 +1%。
export function scratchRadius(state) {
  const config = scratchLuckConfig(state)
  const level = scratchLuckLevel(state)
  return Math.max(1, config.radiusBase + level * config.radiusStep)
}

export function warehouseCount(state) {
  return (Array.isArray(state?.fish) ? state.fish : []).filter((fish) => fish?.status === 'fresh').length
}

export function warehouseFull(state) {
  return warehouseCount(state) >= warehouseCapacity(state)
}

// 仓库只保留待售的 fresh 鱼；已兑换记录只留最近 30 条，避免长期挂机把存档撑大。
function compactFishHistory(fish) {
  const list = Array.isArray(fish) ? fish : []
  return [...list.filter((item) => item?.status === 'fresh'), ...list.filter((item) => item?.status !== 'fresh').slice(0, 30)]
}

// 揭示只翻牌：卡面在发卡时就已经生成，这里不再抽奖，
// 只结算一次对子并写回 payout。老存档没有卡面的，按当前奖池补抽一次。
export function revealScratch(state, cardId, random = Math.random) {
  const card = state.scratchCards.find((c) => c.id === cardId)
  if (!card || card.status !== 'ready') return state
  const config = state.config || DEFAULT_CONFIG
  const type = scratchTypeFor(config, card.typeId)
  const face = Array.isArray(card.face) && card.face.length ? card.face : drawScratchFace(type, random)
  const settlement = scratchSettlement(face)
  const payout = settlement.payouts.length ? settlement.payouts : null
  return {
    ...state,
    scratchCards: state.scratchCards.map((c) => c.id === cardId ? { ...c, status: 'revealed', face, payout, pairs: settlement.pairs, reward: payout, revealedAt: stamp() } : c),
    stats: { ...state.stats, totalScratch: (state.stats.totalScratch || 0) + 1, scratchPairs: (state.stats.scratchPairs || 0) + settlement.pairs },
  }
}

// 一键兑奖：把已刮开的卡片按结算结果入账（鱼币进余额，材料进背包）。
// 同时把「实得 - 期望」写进深海FX 流水：出对子拉涨，没凑齐则压跌。
export function claimAllScratch(state, now = Date.now()) {
  const revealed = state.scratchCards.filter((card) => card.status === 'revealed')
  if (!revealed.length) return state
  const config = state.config || DEFAULT_CONFIG
  const inventory = { ...state.inventory }
  let coins = Math.max(0, Number(state.coins) || 0)
  let coinsWon = 0
  revealed.forEach((card) => {
    const payouts = Array.isArray(card.payout) ? card.payout : card.reward ? [card.reward] : []
    payouts.forEach((reward) => {
      const qty = Math.max(0, Number(reward.qty) || 0)
      if (reward.kind === 'coin') { coins += qty; coinsWon += qty }
      else inventory[reward.name] = (inventory[reward.name] || 0) + qty
    })
  })
  // 兑奖后卡片直接移出背包，只留下统计数字。
  const settled = {
    ...state,
    coins,
    inventory,
    scratchCards: state.scratchCards.filter((card) => card.status !== 'revealed'),
    stats: {
      ...state.stats,
      claimedPrizes: (state.stats.claimedPrizes || 0) + revealed.length,
      claimedScratch: (state.stats.claimedScratch || 0) + revealed.length,
      scratchCoins: (state.stats.scratchCoins || 0) + coinsWon,
    },
  }
  return settled
}

// 单张兑奖：只结算指定卡片，规则与一键兑奖一致（鱼币进余额，材料进背包）。
export function claimScratch(state, cardId, now = Date.now()) {
  const card = state.scratchCards.find((item) => item.id === cardId && item.status === 'revealed')
  if (!card) return state
  const config = state.config || DEFAULT_CONFIG
  const inventory = { ...state.inventory }
  let coins = Math.max(0, Number(state.coins) || 0)
  let coinsWon = 0
  const payouts = Array.isArray(card.payout) ? card.payout : card.reward ? [card.reward] : []
  payouts.forEach((reward) => {
    const qty = Math.max(0, Number(reward.qty) || 0)
    if (reward.kind === 'coin') { coins += qty; coinsWon += qty }
    else inventory[reward.name] = (inventory[reward.name] || 0) + qty
  })
  const settled = {
    ...state,
    coins,
    inventory,
    scratchCards: state.scratchCards.filter((item) => item.id !== cardId),
    stats: {
      ...state.stats,
      claimedPrizes: (state.stats.claimedPrizes || 0) + 1,
      claimedScratch: (state.stats.claimedScratch || 0) + 1,
      scratchCoins: (state.stats.scratchCoins || 0) + coinsWon,
    },
  }
  return settled
}

export function discardRevealedScratch(state) {
  const revealedCount = state.scratchCards.filter((card) => card.status === 'revealed').length
  if (!revealedCount) return state
  return { ...state, scratchCards: state.scratchCards.filter((card) => card.status !== 'revealed') }
}

// ======================================================================
// 无灯黑市
// ======================================================================
//
// 黑市是第二套经济：渔币存在 blackMarket.coins，不碰 state.coins；
// 卖鱼不写 FX 流水（等价于把鱼永久留在仓库），因此有每日收购配额。
// 超级刮刮乐的期望控制全部在服务端：投入卡的底池、期望、方差、热度、
// payoutRate 都由 card.pool 快照计算，客户端只传 cardIds。

const BLACK_STAT_KEYS = ['fishSold', 'materialsSold', 'coinsEarned', 'coinsSpent', 'superConsumed', 'superPayouts', 'superBestCombo', 'superJackpots']
const BLACK_SUPER_EPSILON = 1e-4
// 单次开局最多做多少次「卡 × 奖励」抽样，避免 200 张 × 50k 次把请求拖死。
const BLACK_SIM_WORK = 4_000_000

export function createBlackMarketState() {
  return {
    coins: 0,
    introSeen: false,
    day: null,
    order: null,
    soldToday: 0,
    quotaBonus: 0,
    rerolls: 0,
    purchases: {},
    dailyBuys: {},
    super: null,
    lastSuper: null,
    lastSale: null,
    superDust: {},
    stats: BLACK_STAT_KEYS.reduce((map, key) => ({ ...map, [key]: 0 }), {}),
  }
}

const blackConfigOf = (config) => (config?.blackMarket && typeof config.blackMarket === 'object'
  ? config.blackMarket
  : DEFAULT_CONFIG.blackMarket)

const blackKey = (kind, name) => `${kind === 'coin' ? 'coin' : 'material'}:${name}`

const normalizeBlackCountMap = (raw) => Object.fromEntries(
  Object.entries(raw && typeof raw === 'object' ? raw : {})
    .map(([key, value]) => [String(key).slice(0, 60), Math.max(0, Math.floor(Number(value) || 0))])
    .filter(([key, value]) => key && value > 0),
)

function normalizeBlackOrder(order, config) {
  if (!order || typeof order !== 'object') return null
  const traitIds = new Set((config?.traits || []).map((trait) => trait.id))
  const demand = String(order.demand || '')
  if (!traitIds.has(demand)) return null
  const banned = (Array.isArray(order.banned) ? order.banned : []).map(String)
  if (banned.length !== 2 || new Set(banned).size !== 2 || banned.includes(demand)) return null
  if (!banned.every((id) => traitIds.has(id))) return null
  const acceptance = Number(order.acceptance)
  if (!Number.isFinite(acceptance) || acceptance < 0 || acceptance > 1) return null
  return {
    demand,
    banned,
    depthId: DEPTHS.some((depth) => depth.id === order.depthId) ? order.depthId : null,
    acceptance,
    forced: Boolean(order.forced),
    generatedAt: typeof order.generatedAt === 'string' ? order.generatedAt : null,
  }
}

const normalizeBlackRewardList = (list, withHeat = false) => (Array.isArray(list) ? list : [])
  .map((item) => ({
    kind: item?.kind === 'coin' ? 'coin' : 'material',
    name: String(item?.name || ''),
    qty: Math.max(0, Number(item?.qty) || 0),
    ...(withHeat ? { heat: blackClamp(item?.heat, 0, 100, 1) } : {}),
  }))
  .filter((item) => item.name)

function normalizeBlackSuper(raw, config, allowRevealed = false) {
  if (!raw || typeof raw !== 'object') return null
  const status = raw.status === 'revealed' ? 'revealed' : raw.status === 'ready' ? 'ready' : null
  if (!status) return null
  if (status === 'revealed' && !allowRevealed) return null
  const shapeRaw = raw.shape && typeof raw.shape === 'object' ? raw.shape : null
  if (!shapeRaw) return null
  const shape = {
    slots: clamp(Math.round(blackNumber(shapeRaw.slots, 9)), 3, 9),
    need: clamp(Math.round(blackNumber(shapeRaw.need, 2)), 2, 3),
    baseline: blackClamp(shapeRaw.baseline, 0, 0.9, 0.05),
    fPower: blackClamp(shapeRaw.fPower, 1, 2.5, 2),
    fMax: Math.max(1, blackNumber(shapeRaw.fMax, 10)),
  }
  const face = (Array.isArray(raw.face) ? raw.face : [])
    .map((slot) => ({ kind: slot?.kind === 'coin' ? 'coin' : 'material', name: String(slot?.name || ''), heat: blackClamp(slot?.heat, 0, 100, 1) }))
    .filter((slot) => slot.name)
  if (status === 'ready' && face.length !== shape.slots) return null
  const base = normalizeBlackRewardList(raw.base)
  const expected = normalizeBlackRewardList(raw.expected)
  const pool = (Array.isArray(raw.pool) ? raw.pool : [])
    .map((item) => ({
      kind: item?.kind === 'coin' ? 'coin' : 'material',
      name: String(item?.name || ''),
      p: blackClamp(item?.p, 0, 1, 0),
      heat: blackClamp(item?.heat, 0, 100, 1),
    }))
    .filter((item) => item.name && item.p > 0)
  const heat = {}
  Object.entries(raw.heat && typeof raw.heat === 'object' ? raw.heat : {}).forEach(([key, value]) => {
    const n = Number(value)
    if (Number.isFinite(n) && key) heat[String(key).slice(0, 120)] = blackClamp(n, 0, 100, 1)
  })
  const payoutRate = Number(raw.payoutRate)
  const expectedValue = Math.max(0, Number(raw.expectedValue) || 0)
  if (status === 'ready' && (!pool.length || !Number.isFinite(payoutRate) || payoutRate < 0.01 || payoutRate > 1e6)) return null
  return {
    id: String(raw.id || ''),
    at: typeof raw.at === 'string' ? raw.at : null,
    input: (Array.isArray(raw.input) ? raw.input : []).map((item) => ({
      typeId: String(item?.typeId || ''),
      poolHash: String(item?.poolHash || ''),
      count: Math.max(0, Math.floor(Number(item?.count) || 0)),
    })).slice(0, 64),
    totalCount: Math.max(0, Math.floor(Number(raw.totalCount) || 0)),
    base,
    expected,
    heat,
    pool,
    face,
    shape,
    combos: raw.combos && typeof raw.combos === 'object' ? raw.combos : null,
    payouts: Array.isArray(raw.payouts) ? raw.payouts.slice(0, 64) : null,
    payoutRate: Number.isFinite(payoutRate) ? payoutRate : 0,
    expectedValue,
    paidValue: Math.max(0, Number(raw.paidValue) || 0),
    status,
    revealedAt: typeof raw.revealedAt === 'string' ? raw.revealedAt : null,
  }
}

export function normalizeBlackMarket(raw, config = DEFAULT_CONFIG) {
  const cfg = blackConfigOf(config)
  const base = createBlackMarketState()
  if (!raw || typeof raw !== 'object') return base
  const purchases = normalizeBlackCountMap(raw.purchases)
  const dailyBuys = normalizeBlackCountMap(raw.dailyBuys)
  const statsSource = raw.stats && typeof raw.stats === 'object' ? raw.stats : {}
  const stats = BLACK_STAT_KEYS.reduce((map, key) => ({ ...map, [key]: Math.max(0, Math.floor(Number(statsSource[key]) || 0)) }), {})
  const rawDay = Number(raw.day)
  const introKnown = raw.introSeen !== undefined && raw.introSeen !== null
  const introSeen = introKnown
    ? Boolean(raw.introSeen)
    // 旧存档没有这个字段：有任何黑市痕迹就当作已经进过，避免老玩家再被扫光。
    : Boolean((Number(raw.coins) || 0) > 0 || Object.keys(purchases).length || raw.order || raw.super || raw.lastSuper)
  return {
    ...base,
    coins: Math.max(0, Math.floor(Number(raw.coins) || 0)),
    introSeen,
    day: Number.isFinite(rawDay) ? Math.floor(rawDay) : null,
    order: normalizeBlackOrder(raw.order, config),
    soldToday: Math.max(0, Math.floor(Number(raw.soldToday) || 0)),
    quotaBonus: blackQuotaBonus(purchases, cfg),
    rerolls: Math.max(0, Math.floor(Number(raw.rerolls) || 0)),
    purchases,
    dailyBuys,
    super: normalizeBlackSuper(raw.super, config, false),
    lastSuper: normalizeBlackSuper(raw.lastSuper, config, true),
    lastSale: raw.lastSale && typeof raw.lastSale === 'object' ? raw.lastSale : null,
    superDust: Object.fromEntries(Object.entries(raw.superDust && typeof raw.superDust === 'object' ? raw.superDust : {})
      .map(([key, value]) => [String(key).slice(0, 120), Number(value)])
      .filter(([key, value]) => key && Number.isFinite(value) && value > 0 && value < 1)),
    stats,
  }
}

function blackShopItems(cfg, kind) {
  return (cfg.shop || []).filter((item) => item.kind === kind)
}

function blackOwnsKind(state, cfg, kind) {
  const purchases = state?.blackMarket?.purchases || {}
  return blackShopItems(cfg, kind).some((item) => Number(purchases[item.id]) > 0)
}

export function blackOwnsTheme(state, themeId, config = state?.config) {
  const cfg = blackConfigOf(config)
  const purchases = state?.blackMarket?.purchases || {}
  return blackShopItems(cfg, 'theme').some((item) => item.themeId === themeId && Number(purchases[item.id]) > 0)
}

function blackQuotaBonus(purchases, cfg) {
  const items = blackShopItems(cfg, 'quota')
  const owned = items.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(purchases?.[item.id]) || 0)), 0)
  const cap = items.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.maxBuys) || 0)), 0)
  return Math.max(0, Math.min(cap || owned, owned) * Math.max(0, Number(cfg.fish.quotaStep) || 0))
}

export function blackMarketUnlocked(state, config = state?.config) {
  const cfg = blackConfigOf(config)
  if (!cfg.enabled) return false
  const unlocked = Array.isArray(state?.unlockedDepths) && state.unlockedDepths.length ? state.unlockedDepths : STARTING_DEPTHS
  return unlocked.includes(cfg.unlockDepth)
}

export function blackDailyQuota(state, config = state?.config) {
  const cfg = blackConfigOf(config)
  const purchases = state?.blackMarket?.purchases || {}
  return Math.max(0, Math.round(Number(cfg.fish.dailyQuota) || 0) + blackQuotaBonus(purchases, cfg))
}

export function blackFishValue(state, fish, config = state?.config) {
  const cfg = blackConfigOf(config)
  const traits = Array.isArray(fish?.traits) ? fish.traits : []
  const count = traits.length
  let value = Math.max(1, Math.round(count * Math.max(0, Number(cfg.fish.traitBonus) || 0)))
  if (blackOwnsKind(state, cfg, 'scale')) {
    value = Math.max(1, Math.round(value * (1 + Math.max(0, Number(cfg.fish.scaleBonus) || 0))))
  }
  return value
}

export function blackFishEligible(state, fish, config = state?.config) {
  const order = state?.blackMarket?.order
  if (!order || !fish || fish.status !== 'fresh') return false
  const traits = Array.isArray(fish.traits) ? fish.traits : []
  if (!traits.includes(order.demand)) return false
  return order.banned.every((id) => !traits.includes(id))
}

// 当天订单在「当前海域」的接受率：先按海域抽词条数 k，再按无放回加权抽值。
// 用位掩码 DP 枚举所有 k 元子集，比逐个候选枚举排列快得多（8 个词条时 256 个状态）。
function blackDrawMaskDistribution(traits, weights, count) {
  const n = traits.length
  if (n > 24 || count < 1) return null
  const raw = traits.map((trait) => Math.max(0, Number(weights?.[trait.id]) || 0))
  const total = raw.reduce((sum, weight) => sum + weight, 0)
  // 当前海域权重全 0 时，rollBite 的 pickTraitsWeighted 会退化为均匀抽取，这里保持一致。
  const w = total > 0 ? raw : traits.map(() => 1)
  let dist = new Map([[0, 1]])
  for (let step = 0; step < count; step += 1) {
    const next = new Map()
    dist.forEach((prob, mask) => {
      let denominator = 0
      for (let i = 0; i < n; i += 1) if (!(mask & (1 << i))) denominator += w[i]
      if (denominator <= 0) return
      for (let i = 0; i < n; i += 1) {
        if (mask & (1 << i) || w[i] <= 0) continue
        const nextMask = mask | (1 << i)
        next.set(nextMask, (next.get(nextMask) || 0) + prob * w[i] / denominator)
      }
    })
    dist = next
  }
  return dist
}

function blackOrderAcceptanceTable(state, traits, config) {
  const unlocked = depthsFor(state)
  const depth = unlocked.find((item) => item.id === state?.fishing?.selectedDepthId) || unlocked[0] || DEPTHS[0]
  const weights = config?.depthTraitWeights?.[depth.id] || {}
  const [rawMin, rawMax] = Array.isArray(depth.traitCount) ? depth.traitCount : [1, 1]
  const kmin = Math.max(1, Math.round(Number(rawMin) || 1))
  const kmax = Math.max(kmin, Math.round(Number(rawMax) || kmin))
  const byK = []
  for (let k = kmin; k <= kmax; k += 1) {
    const dist = blackDrawMaskDistribution(traits, weights, Math.min(k, traits.length))
    if (dist) byK.push(dist)
  }
  if (!byK.length) return null
  const weightValues = traits.map((trait) => Math.max(0, Number(weights?.[trait.id]) || 0))
  const maxWeight = Math.max(1e-9, ...weightValues)
  return {
    depthId: depth.id,
    weights: weightValues,
    maxWeight,
    probability(indexDemand, indexBanned) {
      let total = 0
      byK.forEach((dist) => {
        dist.forEach((prob, mask) => {
          if (!(mask & (1 << indexDemand))) return
          if (indexBanned.some((index) => mask & (1 << index))) return
          total += prob
        })
      })
      return total / byK.length
    },
  }
}

function generateBlackOrder(state, config, random = Math.random) {
  const cfg = blackConfigOf(config)
  const traitList = Array.isArray(config?.traits) ? config.traits : []
  const unlocked = depthsFor(state)
  const depthWeights = config?.depthTraitWeights || {}
  // 可用词条：至少在一个已解锁海域里权重 > 0。少于 3 个说明配置残缺，退化为全部词条。
  const usable = traitList.filter((trait) => unlocked.some((depth) => Number(depthWeights[depth.id]?.[trait.id]) > 0))
  const traits = usable.length >= 3 ? usable : traitList
  if (traits.length < 3) return null
  const table = blackOrderAcceptanceTable(state, traits, config)
  if (!table) return null
  const candidates = []
  for (let demandIndex = 0; demandIndex < traits.length; demandIndex += 1) {
    for (let a = 0; a < traits.length; a += 1) {
      if (a === demandIndex) continue
      for (let b = a + 1; b < traits.length; b += 1) {
        if (b === demandIndex) continue
        candidates.push({
          demandIndex,
          bannedIndexes: [a, b],
          acceptance: table.probability(demandIndex, [a, b]),
        })
      }
    }
  }
  if (!candidates.length) return null
  const min = Math.max(0, Number(cfg.order.acceptanceMin) || 0)
  const max = Math.min(1, Number(cfg.order.acceptanceMax) || 1)
  const target = Math.max(0.0001, Number(cfg.order.targetAcceptance) || 0.25)
  let pool = candidates.filter((candidate) => candidate.acceptance >= min && candidate.acceptance <= max)
  let forced = false
  if (!pool.length) {
    // 带内没有候选（配置极端）时取最接近目标的那个，并标记 forced 供后台排查。
    let best = Infinity
    candidates.forEach((candidate) => { best = Math.min(best, Math.abs(candidate.acceptance - target)) })
    pool = candidates.filter((candidate) => Math.abs(candidate.acceptance - target) <= best + 1e-12)
    forced = true
  }
  const scored = pool.map((candidate) => {
    const rarity = 1 - table.weights[candidate.demandIndex] / table.maxWeight
    const common = candidate.bannedIndexes.reduce((sum, index) => sum + table.weights[index], 0) / (2 * table.maxWeight)
    const closeness = 1 - Math.abs(candidate.acceptance - target) / target
    return { ...candidate, score: Math.max(0.0001, closeness + 0.15 * rarity + 0.15 * common) }
  }).sort((left, right) => right.score - left.score).slice(0, 8)
  const totalScore = scored.reduce((sum, candidate) => sum + candidate.score, 0)
  let roll = random() * totalScore
  let chosen = scored[scored.length - 1]
  for (const candidate of scored) {
    roll -= candidate.score
    if (roll <= 0) { chosen = candidate; break }
  }
  return {
    demand: traits[chosen.demandIndex].id,
    banned: chosen.bannedIndexes.map((index) => traits[index].id),
    depthId: table.depthId,
    acceptance: Math.round(chosen.acceptance * 1e4) / 1e4,
    forced,
    generatedAt: stamp(),
  }
}

// 日切：与 FX 同一个本地零点。只生成当天订单，不补历史、不累积配额。
export function refreshBlackMarketDay(state, at = Date.now(), config = state?.config || DEFAULT_CONFIG, random = Math.random) {
  const cfg = blackConfigOf(config)
  const today = fxDayIndex(at, config?.fx?.dayMs || FX_DAY_MS)
  const current = state?.blackMarket && typeof state.blackMarket === 'object' ? state.blackMarket : null
  if (!current) {
    const next = createBlackMarketState()
    const order = blackMarketUnlocked(state, config) ? generateBlackOrder(state, config, random) : null
    return {
      state: { ...state, blackMarket: { ...next, day: today, order } },
      changed: true,
    }
  }
  let bm = current
  let changed = false
  if (!Number.isFinite(Number(bm.day)) || Number(bm.day) !== today) {
    bm = { ...bm, day: today, order: null, soldToday: 0, rerolls: 0, dailyBuys: {}, lastSale: null }
    changed = true
  }
  // 后台删了词条：旧订单失效，等下一段重新生成。
  if (bm.order) {
    const traitIds = new Set((config?.traits || []).map((trait) => trait.id))
    const valid = traitIds.has(bm.order.demand)
      && Array.isArray(bm.order.banned)
      && bm.order.banned.length === 2
      && new Set(bm.order.banned).size === 2
      && bm.order.banned.every((id) => traitIds.has(id) && id !== bm.order.demand)
    if (!valid) {
      bm = { ...bm, order: null }
      changed = true
    }
  }
  if (blackMarketUnlocked(state, config) && !bm.order) {
    const order = generateBlackOrder(state, config, random)
    if (order) {
      bm = { ...bm, order }
      changed = true
    }
  }
  const quotaBonus = blackQuotaBonus(bm.purchases, cfg)
  if (Number(bm.quotaBonus) !== quotaBonus) {
    bm = { ...bm, quotaBonus }
    changed = true
  }
  return changed ? { state: { ...state, blackMarket: bm }, changed: true } : { state, changed: false }
}

export function blackAcknowledge(state) {
  if (!state?.blackMarket || state.blackMarket.introSeen) return state
  return { ...state, blackMarket: { ...state.blackMarket, introSeen: true } }
}

// 卖鱼：按客户端顺序处理，卖到配额为止。不调用 fxAppendFlow / fxExchangeFlow。
export function blackSellFish(state, fishIds, now = Date.now(), config = state?.config) {
  const bm = state?.blackMarket
  if (!bm || !blackMarketUnlocked(state, config)) return { state, code: 'BLACK_LOCKED' }
  if (!bm.order) return { state, code: 'BLACK_INELIGIBLE' }
  const cfg = blackConfigOf(config)
  const quota = blackDailyQuota(state, config)
  if (Number(bm.soldToday) >= quota) return { state, code: 'BLACK_QUOTA' }
  const ids = (Array.isArray(fishIds) ? fishIds : []).map(String)
  if (!ids.length) return { state, code: 'BLACK_INELIGIBLE' }
  const fishById = new Map((state.fish || []).map((fish) => [fish.id, fish]))
  const soldIds = new Set()
  let sold = 0
  let coins = 0
  let skipped = 0
  let hitQuota = false
  for (const id of ids) {
    if (soldIds.has(id)) continue
    const fish = fishById.get(id)
    if (!fish || !blackFishEligible(state, fish, config)) { skipped += 1; continue }
    if (Number(bm.soldToday) + sold >= quota) { hitQuota = true; break }
    const value = blackFishValue(state, fish, config)
    soldIds.add(id)
    sold += 1
    coins += value
  }
  if (!sold) return { state, code: hitQuota ? 'BLACK_QUOTA' : 'BLACK_INELIGIBLE' }
  // 卖完这一批后配额正好用尽也算触顶：前端需要提示「今天不能再卖了」。
  const quotaReached = hitQuota || Number(bm.soldToday) + sold >= quota
  const at = stamp()
  const fish = compactFishHistory((state.fish || []).map((item) => soldIds.has(item.id)
    ? { ...item, status: 'black', blackValue: blackFishValue(state, item, config), soldAt: at }
    : item))
  const nextBm = {
    ...bm,
    coins: Math.max(0, Number(bm.coins) || 0) + coins,
    soldToday: Math.max(0, Number(bm.soldToday) || 0) + sold,
    lastSale: { at, kind: 'fish', accepted: sold, coins, skipped, quotaReached },
    stats: {
      ...bm.stats,
      fishSold: (Number(bm.stats?.fishSold) || 0) + sold,
      coinsEarned: (Number(bm.stats?.coinsEarned) || 0) + coins,
    },
  }
  return { state: { ...state, fish, blackMarket: nextBm }, code: null, result: { accepted: sold, coins, skipped, quotaReached } }
}

// 材料回收：units 是「想要的组数」，按 per 个一组换 coins 渔币。
export function blackSellMaterial(state, name, units, now = Date.now(), config = state?.config) {
  const bm = state?.blackMarket
  if (!bm || !blackMarketUnlocked(state, config)) return { state, code: 'BLACK_LOCKED' }
  const cfg = blackConfigOf(config)
  const entry = cfg.materials?.[name]
  if (!entry) return { state, code: 'BLACK_INELIGIBLE' }
  const per = Math.max(1, Math.round(Number(entry.per) || 1))
  const coinsPer = Math.max(0, Number(entry.coins) || 0)
  const held = Math.max(0, Math.floor(Number(state.inventory?.[name]) || 0))
  const affordable = Math.floor(held / per)
  const wanted = Math.max(0, Math.min(1000, Math.floor(Number(units) || 0)))
  const groups = Math.min(wanted, affordable)
  if (!groups || coinsPer <= 0) return { state, code: 'BLACK_INELIGIBLE' }
  const coins = groups * coinsPer
  const at = stamp()
  const nextBm = {
    ...bm,
    coins: Math.max(0, Number(bm.coins) || 0) + coins,
    lastSale: { at, kind: 'material', name, units: groups, spent: groups * per, coins },
    stats: {
      ...bm.stats,
      materialsSold: (Number(bm.stats?.materialsSold) || 0) + groups * per,
      coinsEarned: (Number(bm.stats?.coinsEarned) || 0) + coins,
    },
  }
  return {
    state: { ...state, inventory: { ...state.inventory, [name]: held - groups * per }, blackMarket: nextBm },
    code: null,
    result: { groups, coins, spent: groups * per },
  }
}

export function blackRefreshOrder(state, config = state?.config, random = Math.random) {
  const bm = state?.blackMarket
  if (!bm || !blackMarketUnlocked(state, config)) return { state, code: 'BLACK_LOCKED' }
  const cfg = blackConfigOf(config)
  if (Number(bm.rerolls) >= Number(cfg.order.refreshLimit)) return { state, code: 'BLACK_LIMIT' }
  if (Number(bm.coins) < Number(cfg.order.refreshCost)) return { state, code: 'BLACK_FUNDS' }
  const order = generateBlackOrder(state, config, random)
  if (!order) return { state, code: 'BLACK_INELIGIBLE' }
  // 收购页和商店页的刷新是同一个每日次数：两边的记录一起递增，避免互相绕过。
  const dailyBuys = { ...(bm.dailyBuys || {}) }
  blackShopItems(cfg, 'refresh').forEach((item) => {
    if (item.dailyLimit > 0) dailyBuys[item.id] = Math.min(item.dailyLimit, (Number(dailyBuys[item.id]) || 0) + 1)
  })
  return {
    state: {
      ...state,
      blackMarket: {
        ...bm,
        coins: Math.max(0, Number(bm.coins) - Number(cfg.order.refreshCost)),
        rerolls: Math.max(0, Number(bm.rerolls) || 0) + 1,
        dailyBuys,
        order,
        lastSale: { at: stamp(), kind: 'refresh', coins: -Number(cfg.order.refreshCost) },
        stats: { ...bm.stats, coinsSpent: (Number(bm.stats?.coinsSpent) || 0) + Number(cfg.order.refreshCost) },
      },
    },
    code: null,
  }
}

export function blackBuy(state, itemId, config = state?.config, now = Date.now(), random = Math.random) {
  const bm = state?.blackMarket
  if (!bm || !blackMarketUnlocked(state, config)) return { state, code: 'BLACK_LOCKED' }
  const cfg = blackConfigOf(config)
  const item = (cfg.shop || []).find((entry) => entry.id === String(itemId))
  if (!item) return { state, code: 'BLACK_INELIGIBLE' }
  // 模块：价格与等级上限以机器配置为准，商店条目只负责上架。
  const moduleDef = item.kind === 'module' ? machinesConfigOf(config).modules[item.moduleId] : null
  if (item.kind === 'module' && !moduleDef) return { state, code: 'BLACK_INELIGIBLE' }
  if (moduleDef && !machineModulesUnlocked(state, config)) return { state, code: 'MODULE_LOCKED' }
  const purchases = bm.purchases || {}
  const dailyBuys = bm.dailyBuys || {}
  const owned = Math.max(0, Math.floor(Number(purchases[item.id]) || 0))
  if (item.once && owned > 0) return { state, code: 'BLACK_LIMIT' }
  if (moduleDef) {
    const fitted = Math.max(0, Math.floor(Number(state.machines?.warehouse?.[item.moduleId]) || 0))
    // 仓库存量 + 已装机量不能超过等级上限。
    const installed = Object.values(state.machines?.owned || {}).reduce((sum, machine) => sum + (Number(machine?.modules?.[item.moduleId]) || 0), 0)
    if (fitted + installed >= moduleDef.maxLevel) return { state, code: 'BLACK_LIMIT' }
  } else if (item.maxBuys > 0 && owned >= item.maxBuys) return { state, code: 'BLACK_LIMIT' }
  // 刷新服务与收购页共用 rerolls，下面按 order.refreshLimit 再校验一次。
  if (item.kind !== 'refresh' && item.dailyLimit > 0 && Math.max(0, Math.floor(Number(dailyBuys[item.id]) || 0)) >= item.dailyLimit) return { state, code: 'BLACK_LIMIT' }
  const price = moduleDef
    ? Math.max(0, Number(moduleDef.price) || 0)
    : item.kind === 'quota'
      ? Math.max(0, Number(item.price) || 0) + Math.max(0, Number(item.priceGrowth) || 0) * owned
      : Math.max(0, Number(item.price) || 0)
  if (Number(bm.coins) < price) return { state, code: 'BLACK_FUNDS' }

  // 每个 kind 先算出「买了以后的状态」，维修满耐久这类无效购买会直接返回。
  let rods = state.rods
  let rod = state.rod
  let inventory = state.inventory
  let fishing = state.fishing
  let nextPurchases = { ...purchases }
  let nextDaily = { ...dailyBuys }
  let nextOrder = bm.order
  let nextRerolls = Number(bm.rerolls) || 0

  if (item.kind === 'rod') {
    const def = (config?.rods || DEFAULT_CONFIG.rods).find((entry) => entry.id === item.rodId)
    if (!def) return { state, code: 'BLACK_INELIGIBLE' }
    const already = (state.rods || []).some((entry) => rodConfigFor(config, entry).id === item.rodId)
    if (already) return { state, code: 'BLACK_LIMIT' }
    const instance = { ...def, id: `rod-${def.id}`, levels: {}, status: 'stored' }
    rods = [...(state.rods || []), instance]
    nextPurchases[item.id] = owned + 1
  } else if (item.kind === 'repair') {
    const target = rod
    if (!target || Number(target.durability) >= Number(target.maxDurability)) return { state, code: 'NO_EFFECT' }
    const repaired = { ...target, durability: Number(target.maxDurability), status: target.status === 'broken' ? 'active' : target.status }
    rods = (state.rods || []).map((entry) => entry.id === repaired.id ? { ...entry, ...repaired } : entry)
    rod = { ...target, ...repaired }
    fishing = {
      ...state.fishing,
      lowDurability: false,
      autoStopped: false,
      manualResume: false,
      running: true,
    }
    nextDaily[item.id] = Math.max(0, Math.floor(Number(dailyBuys[item.id]) || 0)) + 1
  } else if (item.kind === 'refresh') {
    if (nextRerolls >= Number(cfg.order.refreshLimit)) return { state, code: 'BLACK_LIMIT' }
    const order = generateBlackOrder(state, config, random)
    if (!order) return { state, code: 'BLACK_INELIGIBLE' }
    nextOrder = order
    nextRerolls += 1
    nextDaily[item.id] = Math.max(0, Math.floor(Number(dailyBuys[item.id]) || 0)) + 1
  } else if (item.kind === 'quota') {
    nextPurchases[item.id] = owned + 1
  } else if (item.kind === 'theme' || item.kind === 'scale' || item.kind === 'grain' || item.kind === 'module') {
    nextPurchases[item.id] = owned + 1
  }

  const nextBm = {
    ...bm,
    coins: Math.max(0, Number(bm.coins) - price),
    purchases: nextPurchases,
    dailyBuys: nextDaily,
    order: nextOrder,
    rerolls: nextRerolls,
    quotaBonus: blackQuotaBonus(nextPurchases, cfg),
    stats: { ...bm.stats, coinsSpent: (Number(bm.stats?.coinsSpent) || 0) + price },
  }
  const nextMachines = moduleDef
    ? { ...(state.machines || createMachinesState()), warehouse: { ...(state.machines?.warehouse || {}), [item.moduleId]: Math.max(0, Math.floor(Number(state.machines?.warehouse?.[item.moduleId]) || 0)) + 1 } }
    : state.machines
  return {
    state: { ...state, rods, rod, inventory, fishing, blackMarket: nextBm, machines: nextMachines },
    code: null,
    result: { itemId: item.id, price, moduleId: item.moduleId || null },
  }
}

// ---- 超级刮刮乐 ----

const blackPoolStatsCache = new Map()
const BLACK_POOL_CACHE_LIMIT = 200

const blackFactorial = (() => {
  const table = [1]
  for (let i = 1; i <= SCRATCH_MAX_SLOTS; i += 1) table[i] = table[i - 1] * i
  return table
})()

const blackBinom = (n, k) => {
  if (k < 0 || k > n || n < 0) return 0
  return blackFactorial[n] / (blackFactorial[k] * blackFactorial[n - k])
}

const blackBinomPmf = (n, p, k) => blackBinom(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k)

const blackRound = (value, digits = 6) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function blackGroupCovariance(groupA, groupB, slots) {
  let cross = 0
  const other = Math.max(0, 1 - groupA.p - groupB.p)
  for (let a = 0; a <= slots; a += 1) {
    for (let b = 0; b <= slots - a; b += 1) {
      const c = slots - a - b
      const coefficient = blackFactorial[slots] / (blackFactorial[a] * blackFactorial[b] * blackFactorial[c])
      cross += coefficient
        * Math.pow(groupA.p, a)
        * Math.pow(groupB.p, b)
        * Math.pow(other, c)
        * blackBinom(a, groupA.need)
        * blackBinom(b, groupB.need)
    }
  }
  return groupA.qty * groupB.qty * (cross - groupA.M * groupB.M)
}

// 单张卡按 pool 快照的精确 μ/σ²：
// - 同一结算组（kind:name:qty:need）的 count 服从 Binomial(slots, p)；
// - 同一 kind:name 的多个组之间用 Multinomial 求协方差，不能直接把方差相加。
export function scratchPoolStats(pool) {
  const normalized = normalizePoolSnapshot(pool)
  if (!normalized) return null
  const hash = scratchPoolHash(normalized)
  const cached = blackPoolStatsCache.get(hash)
  if (cached) {
    // LRU：命中后挪到队尾。
    blackPoolStatsCache.delete(hash)
    blackPoolStatsCache.set(hash, cached)
    return cached
  }
  const slots = normalized.slots
  const totalWeight = normalized.prizes.reduce((sum, prize) => sum + Math.max(1, Number(prize.weight) || 1), 0)
  const groups = new Map()
  normalized.prizes.forEach((prize) => {
    const key = `${prize.kind}:${prize.name}:${prize.qty}:${prize.need}`
    const group = groups.get(key) || { kind: prize.kind, name: prize.name, qty: prize.qty, need: prize.need, weight: 0 }
    group.weight += Math.max(1, Number(prize.weight) || 1)
    groups.set(key, group)
  })
  const groupList = [...groups.values()].map((group) => {
    const p = group.weight / totalWeight
    return { ...group, p, M: blackBinom(slots, group.need) * Math.pow(p, group.need) }
  })
  const rewards = new Map()
  groupList.forEach((group) => {
    const key = blackKey(group.kind, group.name)
    const reward = rewards.get(key) || { kind: group.kind, name: group.name, E: 0, Var: 0, weight: 0, groups: [] }
    reward.E += group.qty * group.M
    reward.weight += group.weight
    reward.groups.push(group)
    rewards.set(key, reward)
  })
  rewards.forEach((reward) => {
    let variance = 0
    reward.groups.forEach((group) => {
      let second = 0
      for (let n = 0; n <= slots; n += 1) {
        second += blackBinomPmf(slots, group.p, n) * blackBinom(n, group.need) ** 2
      }
      const mean = group.qty * group.M
      variance += Math.max(0, group.qty * group.qty * second - mean * mean)
    })
    for (let i = 0; i < reward.groups.length; i += 1) {
      for (let j = i + 1; j < reward.groups.length; j += 1) {
        variance += 2 * blackGroupCovariance(reward.groups[i], reward.groups[j], slots)
      }
    }
    reward.Var = Math.max(0, variance)
  })
  const stats = { hash, slots, prizes: normalized.prizes, rewards }
  blackPoolStatsCache.set(hash, stats)
  if (blackPoolStatsCache.size > BLACK_POOL_CACHE_LIMIT) {
    const oldest = blackPoolStatsCache.keys().next().value
    blackPoolStatsCache.delete(oldest)
  }
  return stats
}

// 奖励价值：coin=1；先看 overrides 的精确键/名字，再看回收表，最后 unknownValue。
export function blackSuperValue(kind, name, config = null) {
  const cfg = blackConfigOf(config)
  if (kind === 'coin') return 1
  const overrides = cfg.super.valueOverrides || {}
  const exact = Number(overrides[`${kind}:${name}`])
  if (Number.isFinite(exact)) return Math.max(0, Math.min(1e6, exact))
  const byName = Number(overrides[name])
  if (Number.isFinite(byName)) return Math.max(0, Math.min(1e6, byName))
  const recycle = cfg.materials?.[name]
  if (recycle && Number(recycle.per) > 0) return Math.max(0, Number(recycle.coins) / Number(recycle.per))
  return Math.max(0, Number(cfg.super.unknownValue) || 0)
}

// 9 格面与投入卡独立，E[f] 可以按二项分布精确算，不需要模拟。
function blackExpectedFactor(p, shape) {
  const expectedCombos = Math.max(BLACK_SUPER_EPSILON, blackBinom(shape.slots, shape.need) * Math.pow(p, shape.need))
  let expected = 0
  for (let n = 0; n <= shape.slots; n += 1) {
    const combos = blackBinom(n, shape.need)
    const factor = clamp(shape.baseline + (1 - shape.baseline) * Math.pow(combos / expectedCombos, shape.fPower), shape.baseline, shape.fMax)
    expected += blackBinomPmf(shape.slots, p, n) * factor
  }
  return { expectedCombos, expected }
}

// 单卡单个奖励的结算量分布（同一 kind:name 的多个结算组合并后的边际分布）。
// 组数太多时返回 null，让模拟退回逐格抽取。
function blackRewardDistribution(reward, slots) {
  const groups = (reward.groups || []).filter((group) => group.p > 0)
  if (!groups.length) return null
  if (groups.length > 6) return null
  const acc = new Map()
  const add = (qty, prob) => {
    if (!(prob > 0)) return
    const key = blackRound(qty, 6)
    acc.set(key, (acc.get(key) || 0) + prob)
  }
  // 条件二项式递归：每一步在剩余概率质量里抽该组，等价于 Multinomial。
  const walk = (index, remaining, mass, prob, qty) => {
    if (index >= groups.length || remaining <= 0 || mass <= 0) {
      add(qty, prob)
      return
    }
    const group = groups[index]
    const conditional = Math.max(0, Math.min(1, group.p / mass))
    for (let n = 0; n <= remaining; n += 1) {
      const term = blackBinom(remaining, n) * Math.pow(conditional, n) * Math.pow(1 - conditional, remaining - n)
      if (!(term > 0)) continue
      walk(index + 1, remaining - n, mass - group.p, prob * term, qty + group.qty * blackBinom(n, group.need))
    }
  }
  walk(0, slots, 1, 1, 0)
  const entries = [...acc.entries()].sort((a, b) => a[0] - b[0])
  let cumulative = 0
  const outcomes = entries.map(([qty, prob]) => {
    cumulative = Math.min(1, cumulative + prob)
    return { qty, cum: cumulative }
  })
  return { outcomes, cumulative }
}

function blackSampleDistribution(distribution, random) {
  const { outcomes, cumulative } = distribution
  const roll = random() * cumulative
  // 结果很少（≤ 11 档），线性扫描比二分更快。
  for (let i = 0; i < outcomes.length; i += 1) {
    if (roll <= outcomes[i].cum) return outcomes[i].qty
  }
  return outcomes[outcomes.length - 1]?.qty || 0
}

// 分布组数过多时逐格抽：用快照权重抽 slots 格，再按原结算键算这个奖励的量。
function blackSampleRewardBySlots(reward, stats, random) {
  const prizes = stats.prizes
  const total = prizes.reduce((sum, prize) => sum + Math.max(1, Number(prize.weight) || 1), 0)
  const counts = new Map()
  for (let i = 0; i < stats.slots; i += 1) {
    let roll = random() * total
    let picked = prizes[prizes.length - 1]
    for (const prize of prizes) {
      roll -= Math.max(1, Number(prize.weight) || 1)
      if (roll <= 0) { picked = prize; break }
    }
    const key = `${picked.kind}:${picked.name}:${picked.qty}:${picked.need}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return (reward.groups || []).reduce((sum, group) => {
    const key = `${group.kind}:${group.name}:${group.qty}:${group.need}`
    return sum + group.qty * blackBinom(counts.get(key) || 0, group.need)
  }, 0)
}

const blackErf = (x) => {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax)
  return sign * y
}

const blackNormalCdf = (x) => 0.5 * (1 + blackErf(x / Math.SQRT2))

function blackHashSeed(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const blackMulberry32 = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function blackDrawFace(pool, slots, random) {
  const total = pool.reduce((sum, reward) => sum + reward.p, 0)
  return Array.from({ length: slots }, () => {
    let roll = random() * total
    let picked = pool[pool.length - 1]
    for (const reward of pool) {
      roll -= reward.p
      if (roll <= 0) { picked = reward; break }
    }
    return { kind: picked.kind, name: picked.name, heat: picked.heat }
  })
}

// 模拟 E[B×h]（clamp 已在模拟里）。只模拟底池与热度；9 格面与底池独立，
// 所以 f 用精确 E[f]，比把脸也模拟一遍噪声更小。
function blackSimulateMeanBH(cards, pool, cfg, maxVarRatio, random = Math.random) {
  const shape = cfg.super
  // 种子只由「奖池组合 + 张数 + 形状」派生会让同一种投向永远复用同一次模拟误差，
  // 万一那次抽样偏低，实际期望就会长期高于目标。这里混入一次本次请求的随机数，
  // 让误差在多次开局之间互相抵消（长期仍是无偏蒙特卡洛）。
  const nonce = Math.floor(random() * 0x7fffffff)
  const randomStream = blackMulberry32(blackHashSeed(`${cards.map((entry) => entry.card.poolHash).sort().join('|')}#${cards.length}#${shape.slots}/${shape.need}/${shape.baseline}/${shape.fPower}/${shape.fMax}#${nonce}`))
  const distributions = cards.map(({ card, stats }) => {
    const map = new Map()
    pool.forEach((reward) => {
      const key = blackKey(reward.kind, reward.name)
      const source = stats.rewards.get(key)
      map.set(key, source ? blackRewardDistribution(source, stats.slots) : null)
    })
    return { stats, map }
  })
  const baseSamples = cards.length < 5 || maxVarRatio > 2 ? shape.simSamplesExtreme : shape.simSamples
  const samples = Math.max(1000, Math.min(baseSamples, Math.floor(BLACK_SIM_WORK / Math.max(1, cards.length * pool.length))))
  const sums = new Map(pool.map((reward) => [blackKey(reward.kind, reward.name), 0]))
  for (let sample = 0; sample < samples; sample += 1) {
    pool.forEach((reward) => {
      const key = blackKey(reward.kind, reward.name)
      let base = 0
      distributions.forEach(({ stats, map }) => {
        const distribution = map.get(key)
        if (distribution) base += blackSampleDistribution(distribution, randomStream)
        else {
          const source = stats.rewards.get(key)
          if (source) base += blackSampleRewardBySlots(source, stats, randomStream)
        }
      })
      const heat = clamp(1 + shape.sensitivity * ((base + 1) / (reward.E + 1) - 1), shape.heatMin, shape.heatMax)
      sums.set(key, sums.get(key) + base * heat)
    })
  }
  const means = new Map()
  sums.forEach((sum, key) => means.set(key, sum / samples))
  return means
}

export function blackSuperPlan(state, cardIds, config = state?.config, random = Math.random) {
  const bm = state?.blackMarket
  if (!bm || !blackMarketUnlocked(state, config)) return { state, code: 'BLACK_LOCKED' }
  const cfg = blackConfigOf(config)
  if (!cfg.super.enabled) return { state, code: 'BLACK_LOCKED' }
  if (bm.super && bm.super.status === 'ready') return { state, code: 'SUPER_PENDING' }
  const ids = [...new Set((Array.isArray(cardIds) ? cardIds : []).map((id) => String(id || '')).filter(Boolean))]
  if (ids.length < Math.max(1, Number(cfg.super.minInput) || 1)) return { state, code: 'SUPER_EMPTY' }
  if (ids.length > Math.max(1, Number(cfg.super.maxInput) || 200)) return { state, code: 'SUPER_TOO_MANY' }
  const cardMap = new Map((state.scratchCards || []).map((card) => [card.id, card]))
  const cards = []
  for (const id of ids) {
    const card = cardMap.get(id)
    if (!card || card.status !== 'ready') return { state, code: 'SUPER_UNSUPPORTED_CARD' }
    const pool = normalizePoolSnapshot(card.pool)
    const stats = pool ? scratchPoolStats(pool) : null
    if (!pool || !stats) return { state, code: 'SUPER_UNSUPPORTED_CARD' }
    if (!Array.isArray(card.face) || card.face.length !== pool.slots) return { state, code: 'SUPER_UNSUPPORTED_CARD' }
    const known = new Set(stats.prizes.map((prize) => blackKey(prize.kind, prize.name)))
    if (card.face.some((slot) => !slot?.name || !known.has(blackKey(slot.kind, slot.name)))) return { state, code: 'SUPER_UNSUPPORTED_CARD' }
    // 卡池里必须至少有一个「能中且有价值」的奖励，否则这张卡对超级卡是空投入。
    const payable = [...stats.rewards.values()].filter((reward) => reward.E > 0 && blackSuperValue(reward.kind, reward.name, config) > 0)
    if (!payable.length) return { state, code: 'SUPER_EMPTY_BASE' }
    cards.push({ card, pool, stats })
  }

  const rewards = new Map()
  const ensure = (kind, name) => {
    const key = blackKey(kind, name)
    let reward = rewards.get(key)
    if (!reward) {
      reward = { key, kind, name, base: 0, E: 0, Var: 0, weight: 0, value: 0, payable: false }
      rewards.set(key, reward)
    }
    return reward
  }
  cards.forEach(({ card, stats }) => {
    const settlement = scratchSettlement(card.face)
    settlement.payouts.forEach((payout) => {
      ensure(payout.kind, payout.name).base += Math.max(0, Number(payout.qty) || 0)
    })
    const payable = [...stats.rewards.values()]
      .map((reward) => ({ reward, value: blackSuperValue(reward.kind, reward.name, config) }))
      .filter(({ reward, value }) => reward.E > 0 && value > 0)
    if (!payable.length) return
    const totalWeight = payable.reduce((sum, { reward }) => sum + Math.max(0, reward.weight), 0)
    if (!(totalWeight > 0)) return
    payable.forEach(({ reward, value }) => {
      const target = ensure(reward.kind, reward.name)
      target.E += reward.E
      target.Var += reward.Var
      target.value = value
      target.payable = true
      target.weight += Math.max(0, reward.weight) / totalWeight
    })
  })
  const pool = [...rewards.values()].filter((reward) => reward.payable && reward.E > 0 && reward.value > 0)
  if (!pool.length) return { state, code: 'SUPER_EMPTY_BASE' }
  const totalP = pool.reduce((sum, reward) => sum + reward.weight, 0)
  if (!(totalP > 0)) return { state, code: 'SUPER_EMPTY_BASE' }
  const shape = {
    slots: cfg.super.slots,
    need: cfg.super.need,
    baseline: cfg.super.baseline,
    fPower: cfg.super.fPower,
    fMax: cfg.super.fMax,
  }
  pool.forEach((reward) => {
    reward.p = reward.weight / totalP
    const ratio = (reward.base + 1) / (reward.E + 1)
    reward.heat = clamp(1 + cfg.super.sensitivity * (ratio - 1), cfg.super.heatMin, cfg.super.heatMax)
    const expected = blackExpectedFactor(reward.p, shape)
    reward.expectedCombos = expected.expectedCombos
    reward.expF = expected.expected
  })
  const expectedValue = pool.reduce((sum, reward) => sum + reward.E * reward.value, 0)
  if (!(expectedValue > 0) || !Number.isFinite(expectedValue)) return { state, code: 'SUPER_EMPTY_BASE' }

  // 极端分布保险：小批量 / 高相对方差 / 热度会被 clamp 截断时强制模拟。
  const maxVarRatio = Math.max(0, ...pool.map((reward) => reward.Var / Math.max(reward.E * reward.E, 1e-9)))
  let clampRisk = 0
  if (cfg.super.sensitivity > 1e-9) {
    pool.forEach((reward) => {
      const sd = Math.sqrt(reward.Var)
      if (!(sd > 0)) return
      const upper = reward.E + (cfg.super.heatMax - 1) * (reward.E + 1) / cfg.super.sensitivity
      const lower = Math.max(0, reward.E - (1 - cfg.super.heatMin) * (reward.E + 1) / cfg.super.sensitivity)
      clampRisk = Math.max(clampRisk, (1 - blackNormalCdf((upper - reward.E) / sd)) + blackNormalCdf((lower - reward.E) / sd))
    })
  }
  const mode = cfg.super.calibrationMode
  const useSimulation = mode === 'simulate' || (mode === 'auto' && (ids.length < 20 || maxVarRatio > 0.5 || clampRisk > 0.01))
  let meanBH = null
  if (useSimulation) {
    meanBH = blackSimulateMeanBH(cards, pool, cfg, maxVarRatio, random)
  }
  let denominator = 0
  const calibrationTerms = {}
  pool.forEach((reward) => {
    const bh = useSimulation ? Number(meanBH.get(reward.key)) || 0 : reward.E + cfg.super.sensitivity * reward.Var / Math.max(reward.E + 1, 1)
    calibrationTerms[reward.key] = {
      E: blackRound(reward.E, 6),
      Var: blackRound(reward.Var, 6),
      meanBH: blackRound(bh, 6),
      expF: blackRound(reward.expF, 6),
      value: reward.value,
    }
    denominator += bh * reward.expF * reward.value
  })
  if (!(denominator > 0) || !Number.isFinite(denominator)) return { state, code: 'SUPER_TOO_VOLATILE' }
  const safety = useSimulation ? 1 : cfg.super.calibrationSafety
  const payoutRate = cfg.super.targetEv * expectedValue / denominator * safety
  if (!Number.isFinite(payoutRate) || payoutRate < 0.01 || payoutRate > 1e6) return { state, code: 'SUPER_TOO_VOLATILE' }

  pool.forEach((reward) => {
    reward.base = Math.max(0, reward.base)
    reward.heat = blackRound(reward.heat, 4)
    reward.p = blackRound(reward.p, 8)
  })
  const face = blackDrawFace(pool, shape.slots, random)
  const inputGroups = new Map()
  cards.forEach(({ card }) => {
    const key = `${card.typeId}:${card.poolHash}`
    const group = inputGroups.get(key) || { typeId: card.typeId, poolHash: card.poolHash, count: 0 }
    group.count += 1
    inputGroups.set(key, group)
  })
  const now = Date.now()
  const superCard = {
    id: `super-${now}-${Math.floor(random() * 1e6).toString(36)}`,
    at: stamp(),
    input: [...inputGroups.values()],
    totalCount: cards.length,
    base: pool.map((reward) => ({ kind: reward.kind, name: reward.name, qty: blackRound(reward.base, 6) })),
    expected: pool.map((reward) => ({ kind: reward.kind, name: reward.name, qty: blackRound(reward.E, 6) })),
    heat: Object.fromEntries(pool.map((reward) => [reward.key, reward.heat])),
    pool: pool.map((reward) => ({ kind: reward.kind, name: reward.name, p: reward.p, heat: reward.heat })),
    face,
    shape,
    combos: null,
    payouts: null,
    payoutRate,
    expectedValue,
    calibration: { mode: useSimulation ? 'simulate' : 'analytic', maxVarRatio, clampRisk, terms: calibrationTerms },
    status: 'ready',
    revealedAt: null,
  }
  const consumed = new Set(ids)
  return {
    state: {
      ...state,
      scratchCards: (state.scratchCards || []).filter((card) => !consumed.has(card.id)),
      blackMarket: {
        ...bm,
        super: superCard,
        stats: { ...bm.stats, superConsumed: (Number(bm.stats?.superConsumed) || 0) + cards.length },
      },
    },
    code: null,
    super: superCard,
  }
}

// 不消耗卡片的预览：后台兼容性检查/玩家确认页都可以用。
export function blackSuperPreview(state, cardIds, config = state?.config) {
  const snapshot = JSON.parse(JSON.stringify({
    ...state,
    blackMarket: { ...(state.blackMarket || createBlackMarketState()), super: null },
  }))
  const result = blackSuperPlan(snapshot, cardIds, config, blackMulberry32(1))
  return result.code ? { code: result.code } : { code: null, super: result.super }
}

export function blackSuperStart(state, cardIds, config = state?.config, random = Math.random) {
  return blackSuperPlan(state, cardIds, config, random).state
}

export function blackSuperReveal(state, now = Date.now(), config = state?.config) {
  const bm = state?.blackMarket
  const superCard = bm?.super
  if (!superCard || superCard.status !== 'ready') return { state, code: 'SUPER_NOT_READY' }
  const shape = superCard.shape
  const counts = new Map()
  ;(superCard.face || []).forEach((slot) => {
    const key = blackKey(slot.kind, slot.name)
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  let coins = Math.max(0, Number(state.coins) || 0)
  const inventory = { ...(state.inventory || {}) }
  const dust = { ...(bm.superDust || {}) }
  const payouts = []
  let bestCombo = 0
  let jackpot = false
  let paidValue = 0
  ;(superCard.pool || []).forEach((reward) => {
    const key = blackKey(reward.kind, reward.name)
    const count = counts.get(key) || 0
    const combos = blackBinom(count, shape.need)
    bestCombo = Math.max(bestCombo, combos)
    if (count >= shape.slots) jackpot = true
    const expectedCombos = Math.max(BLACK_SUPER_EPSILON, blackBinom(shape.slots, shape.need) * Math.pow(reward.p, shape.need))
    const factor = clamp(shape.baseline + (1 - shape.baseline) * Math.pow(combos / expectedCombos, shape.fPower), shape.baseline, shape.fMax)
    const baseItem = (superCard.base || []).find((item) => item.kind === reward.kind && item.name === reward.name)
    const base = Math.max(0, Number(baseItem?.qty) || 0)
    const heat = Number(superCard.heat?.[key]) || Number(reward.heat) || 1
    const raw = base * heat * factor * superCard.payoutRate
    const total = (Number.isFinite(raw) ? raw : 0) + Math.max(0, Number(dust[key]) || 0)
    const whole = Math.max(0, Math.floor(total + 1e-9))
    dust[key] = Math.max(0, total - whole)
    if (!(Number(dust[key]) > 0)) delete dust[key]
    const value = blackSuperValue(reward.kind, reward.name, config)
    if (whole > 0) {
      if (reward.kind === 'coin') coins += whole
      else inventory[reward.name] = (Number(inventory[reward.name]) || 0) + whole
      paidValue += whole * value
    }
    payouts.push({
      kind: reward.kind,
      name: reward.name,
      qty: whole,
      base: blackRound(base, 4),
      heat: blackRound(heat, 4),
      combos,
      factor: blackRound(factor, 4),
    })
  })
  const lastSuper = {
    ...superCard,
    status: 'revealed',
    combos: Object.fromEntries([...counts.entries()].map(([key, count]) => [key, count])),
    payouts,
    bestCombo,
    jackpot,
    paidValue,
    revealedAt: stamp(),
  }
  return {
    state: {
      ...state,
      coins,
      inventory,
      blackMarket: {
        ...bm,
        super: null,
        lastSuper,
        superDust: dust,
        stats: {
          ...bm.stats,
          superPayouts: (Number(bm.stats?.superPayouts) || 0) + 1,
          superBestCombo: Math.max(Number(bm.stats?.superBestCombo) || 0, bestCombo),
          superJackpots: (Number(bm.stats?.superJackpots) || 0) + (jackpot ? 1 : 0),
        },
      },
    },
    code: null,
    result: { payouts, coins, paidValue, jackpot, bestCombo },
  }
}

export function exchangeFish(state, fishId, now = Date.now()) {
  const fish = state.fish.find((f) => f.id === fishId && f.status === 'fresh')
  if (!fish) return state
  const quote = quoteForFish(state, fish)
  const tickets = [...state.tickets]
  if (quote.tickets) for (let i = 0; i < quote.tickets.qty; i += 1) tickets.push(makeTicket(`ticket-${now}-${i}-${Math.random().toString(36).slice(2, 5)}`))
  const scratchCards = [...state.scratchCards]
  if (quote.scratch) for (let i = 0; i < quote.scratch.qty; i += 1) scratchCards.push(makeScratchCard(`scratch-${now}-${i}`, quote.scratch.typeId, scratchTypeFor(state.config || DEFAULT_CONFIG, quote.scratch.typeId)))
  const text = `${fish.name} 已交给潮汐商会，获得 ${quoteLabel(quote)}。`
  const at = Number(now)
  const gainedTickets = Math.max(0, Number(quote.tickets?.qty) || 0)
  const gainedScratch = Math.max(0, Number(quote.scratch?.qty) || 0)
  const next = {
    ...state,
    fish: compactFishHistory(state.fish.map((f) => f.id === fishId ? { ...f, status: 'exchanged', exchangedAt: stamp() } : f)),
    tickets,
    scratchCards,
    npc: { ...state.npc, lastExchange: { fish, quote, at: stamp() } },
    // 「累计获得」只增不减：玩家刮掉/兑掉之后仍算进解锁条件，条件不会回退。
    stats: {
      ...state.stats,
      totalExchanged: (Number(state.stats?.totalExchanged) || 0) + 1,
      totalSold: (Number(state.stats?.totalSold) || 0) + 1,
      totalTicketsEarned: (Number(state.stats?.totalTicketsEarned) || 0) + gainedTickets,
      totalScratchEarned: (Number(state.stats?.totalScratchEarned) || 0) + gainedScratch,
    },
  }
  // 卖出把词条还回市场，和上钩严格对称：钓上来再卖掉，净影响为 0。
  return fxAppendFlow(next, fxExchangeFlow(fish), at)
}

// 商会列表与一键兑换共用这套筛选口径，避免前后端各写一套条件后对不上。
// filter 走的是鱼类存档里的 depth 展示名（label），不是 depthId。
export function fishMatchesExchangeFilter(state, fish, filter = '全部') {
  if (!filter || filter === '全部') return true
  if (filter === '组合加成') return fishQuotePrice(state, fish).comboLines.length > 0
  return fish.depth === filter
}

// 批量兑换：一次把多箱鱼交给商会，累加所有报价后统一发奖。
export function exchangeFishBatch(state, fishIds, now = Date.now()) {
  const ids = new Set(Array.isArray(fishIds) ? fishIds : [])
  const targets = state.fish.filter((fish) => fish.status === 'fresh' && ids.has(fish.id))
  return exchangeFishTargets(state, targets, now)
}

// 一键兑换：仓库可能上千条鱼，逐条传 fishId 会超过请求体上限（还会被服务端截断）。
// 因此只传筛选范围，由服务端按同一套口径从存档里自己挑鱼。
export function exchangeFishBatchByFilter(state, filter, now = Date.now()) {
  const targets = state.fish.filter((fish) => fish.status === 'fresh' && fishMatchesExchangeFilter(state, fish, filter))
  return exchangeFishTargets(state, targets, now)
}

function exchangeFishTargets(state, targets, now = Date.now()) {
  if (!targets.length) return state
  const tickets = [...state.tickets]
  const scratchCards = [...state.scratchCards]
  let lastQuote = null
  targets.forEach((fish, index) => {
    const quote = quoteForFish(state, fish)
    lastQuote = quote
    if (quote.tickets) {
      for (let i = 0; i < quote.tickets.qty; i += 1) tickets.push(makeTicket(`ticket-${now}-${index}-${i}-${Math.random().toString(36).slice(2, 5)}`))
    }
    if (quote.scratch) {
      for (let i = 0; i < quote.scratch.qty; i += 1) scratchCards.push(makeScratchCard(`scratch-${now}-${index}-${i}`, quote.scratch.typeId, scratchTypeFor(state.config || DEFAULT_CONFIG, quote.scratch.typeId)))
    }
  })
  const exchanged = new Set(targets.map((fish) => fish.id))
  const gainedTickets = targets.reduce((sum, fish) => sum + Math.max(0, Number(quoteForFish(state, fish).tickets?.qty) || 0), 0)
  const gainedScratch = targets.reduce((sum, fish) => sum + Math.max(0, Number(quoteForFish(state, fish).scratch?.qty) || 0), 0)
  const next = {
    ...state,
    fish: compactFishHistory(state.fish.map((fish) => exchanged.has(fish.id) ? { ...fish, status: 'exchanged', exchangedAt: stamp() } : fish)),
    tickets,
    scratchCards,
    npc: { ...state.npc, lastExchange: { fish: targets[targets.length - 1], quote: lastQuote, count: targets.length, at: stamp() } },
    stats: {
      ...state.stats,
      totalExchanged: (Number(state.stats?.totalExchanged) || 0) + targets.length,
      totalSold: (Number(state.stats?.totalSold) || 0) + targets.length,
      totalTicketsEarned: (Number(state.stats?.totalTicketsEarned) || 0) + gainedTickets,
      totalScratchEarned: (Number(state.stats?.totalScratchEarned) || 0) + gainedScratch,
    },
  }
  return fxAppendFlow(next, targets.flatMap((fish) => fxExchangeFlow(fish)), Number(now))
}

export function repairRod(state, rodId, amount) {
  const config = state.config || DEFAULT_CONFIG
  const target = state.rods.find((r) => r.id === rodId)
  if (!target) return state
  const def = rodConfigFor(config, target)
  const repair = def.repair || DEFAULT_CONFIG.rods[0].repair
  const restore = Math.max(1, Number(amount) || Number(repair.amount) || 50)
  const material = repair.material || '深蓝晶片'
  const cost = Math.max(1, Number(repair.cost) || 1)
  if ((state.inventory[material] || 0) < cost) return state
  const active = state.rod.id === rodId
  // 溢出维修初始自带：判据只是「耐久未满」，没有等级门槛。
  // 修复量本身仍是 repair.amount（溢出额度不限，但一次只加这么多）。
  if (!canRepairRod(state, target)) return state
  const durability = Math.max(0, target.durability + restore)
  const next = { ...target, durability, status: active ? 'active' : target.status === 'broken' ? 'stored' : target.status }
  const rods = state.rods.map((r) => r.id === rodId ? next : r)
  const rod = active ? next : state.rod
  const selectedDepthId = active && !depthsFor(state).some((depth) => depth.id === state.fishing.selectedDepthId) ? depthsFor(state)[0].id : state.fishing.selectedDepthId
  return {
    ...state,
    rods,
    rod,
    inventory: { ...state.inventory, [material]: (state.inventory[material] || 0) - cost },
    fishing: active ? { ...state.fishing, selectedDepthId, lowDurability: durability < LOW_DURABILITY_THRESHOLD, autoStopped: durability < LOW_DURABILITY_THRESHOLD ? Boolean(state.fishing.autoStopped) : false, manualResume: durability < LOW_DURABILITY_THRESHOLD ? state.fishing.manualResume : false, running: durability >= LOW_DURABILITY_THRESHOLD || Boolean(state.fishing.manualResume) } : state.fishing,
  }
}

// 通用强化：读取配置里的升级项，累加等级后重算该竿的全部数值。
export function upgradeRod(state, rodId, upgradeId) {
  const config = state.config || DEFAULT_CONFIG
  const target = state.rods.find((r) => r.id === rodId)
  if (!target || target.durability <= MIN_DURABILITY || target.status === 'broken') return state
  const def = rodConfigFor(config, target)
  const upgrade = (def.upgrades || []).find((item) => item.id === upgradeId)
  if (!upgrade) return state
  const level = Math.max(0, Math.floor(Number(target.levels?.[upgrade.id]) || 0))
  const maxLevel = Math.max(0, Number(upgrade.maxLevel) || 99)
  if (level >= maxLevel) return state
  const material = upgrade.material || '浮木纤维'
  const secondMaterial = upgrade.secondMaterial
  // 鱼币与材料都按当前等级递增，第 N 级比第 1 级贵。
  const price = upgradeCostAt(upgrade, level)
  const cost = price.cost
  const secondCost = price.secondCost
  if ((state.coins || 0) < price.coins) return state
  const costs = { [material]: cost }
  if (secondMaterial) costs[secondMaterial] = (costs[secondMaterial] || 0) + secondCost
  if (Object.entries(costs).some(([name, required]) => (state.inventory[name] || 0) < required)) return state
  const levels = { ...(target.levels || {}), [upgrade.id]: level + 1 }
  const stats = rodStatsFrom(def, levels)
  const next = {
    ...target,
    levels,
    ...stats,
    // 升级抬高耐久上限时同步补上新增的那部分耐久。
    durability: target.durability + Math.max(0, stats.maxDurability - target.maxDurability),
  }
  const rods = state.rods.map((r) => r.id === rodId ? next : r)
  const rod = state.rod.id === rodId ? next : state.rod
  const inventory = { ...state.inventory }
  Object.entries(costs).forEach(([name, required]) => { inventory[name] = (inventory[name] || 0) - required })
  return { ...state, rods, rod, inventory, coins: Math.max(0, (state.coins || 0) - price.coins) }
}

export const speedUpgrade = (state, rodId, upgradeId = 'speed') => upgradeRod(state, rodId, upgradeId)

// 自动维修：耐久低于这根竿自己的阈值时，消耗修复材料补耐久，受冷却限制。
// 「自动维修」现在是钓竿自带的升级项：换一把竿就要重新升，阈值取这把竿的等级。
export function autoRepairRod(state, now = Date.now()) {
  const rod = state.rod
  if (!rod) return state
  const threshold = autoRepairThreshold(state, rod)
  const restoreRatio = autoRepairRestore(rod)
  const broken = rod?.status === 'broken'
  // 0 级 = 未开启自动维修。
  if (threshold <= 0 || !(state.fishing?.running || state.fishing?.autoStopped || broken)) return state
  // 溢出维修初始自带：上限不再有固定额度，只要没修到「当前上限」就能继续修。
  const cap = rodDurabilityCap(state, rod)
  if (rod.durability >= cap) return state
  if (rod.durability >= threshold) return state
  const last = Number(state.fishing?.autoRepairAt) || 0
  if (now - last < AUTO_REPAIR_COOLDOWN_MS) return state
  const def = rodConfigFor(state.config || DEFAULT_CONFIG, rod)
  const repair = def.repair || DEFAULT_CONFIG.rods[0].repair
  const material = repair.material || '深蓝晶片'
  const cost = Math.max(1, Number(repair.cost) || 1)
  if ((state.inventory[material] || 0) < cost) return state
  // 恢复量 = 单次修复量 × 恢复比例（默认 90%）。
  const restore = Math.max(1, Math.round((Number(repair.amount) || 50) * restoreRatio))
  // 溢出维修初始自带且无上限：直接加到当前耐久上，可以超过标称 maxDurability。
  const durability = Math.max(0, rod.durability + restore)
  // 修好后损坏状态一并解除，钓竿可以直接继续用。
  const nextRod = { ...rod, durability, status: durability > 0 ? 'active' : rod.status }
  const lowDurability = durability < autoStopThreshold(state)
  return {
    ...state,
    rod: nextRod,
    rods: state.rods.map((item) => item.id === nextRod.id ? nextRod : item),
    inventory: { ...state.inventory, [material]: (state.inventory[material] || 0) - cost },
    fishing: {
      ...state.fishing,
      autoRepairAt: now,
      lowDurability,
      // 修到阈值以上就恢复自动钓鱼，玩家不用再手动点继续。
      running: durability > 0 && !lowDurability,
      autoStopped: lowDurability,
      manualResume: lowDurability ? state.fishing.manualResume : false,
    },
    stats: {
      ...state.stats,
      autoRepairs: (state.stats.autoRepairs || 0) + 1,
      autoRepairDurability: (state.stats.autoRepairDurability || 0) + (durability - rod.durability),
    },
  }
}

export function selectRod(state, rodId, at = Date.now()) {
  const target = state.rods.find((r) => r.id === rodId)
  if (!target || target.id === state.rod.id || target.durability <= MIN_DURABILITY || target.status === 'broken') return state
  const rod = { ...target, status: 'active' }
  const lowDurability = rod.durability < autoStopThreshold({ ...state, rod })
  return {
    ...state,
    rod,
    rods: state.rods.map((item) => item.id === rodId ? rod : item.status === 'active' ? { ...item, status: 'stored' } : item),
    fishing: {
      ...state.fishing,
      phase: 'charging',
      bite: null,
      progress: 0,
      tension: 0,
      recoverUntil: 0,
      recoverFrom: 0,
      running: state.fishing.running && !lowDurability,
      lowDurability,
      manualResume: false,
      autoStopped: state.fishing.running && lowDurability,
      lastTickAt: at,
    },
  }
}

export function formatCountdown(ms) {
  const safe = Math.max(0, ms)
  const h = Math.floor(safe / 3600000)
  const m = Math.floor((safe % 3600000) / 60000)
  const s = Math.floor((safe % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export { getBatchId }

// ======================================================================
// 投币机器（铁爪刮卡机 + 后期机器）
// ======================================================================
//
// 三条铁律：
// 1. 鱼/币/卡一旦交付就不可取出（没有取出动作）。
// 2. 机器只改变「怎么处理」，绝不改变「处理出什么」：
//    刮卡仍走 drawScratchFace + scratchSettlement，卖鱼仍走 blackFishEligible/blackSellFish。
// 3. 结算全部是纯函数，注入 now/config；不新增定时器，挂在 syncPlayerLocked 上懒结算。

const MACHINE_MODULE_IDS = () => Object.keys(DEFAULT_CONFIG.machines.modules)

export function machinesConfigOf(config) {
  const raw = config?.machines
  if (!raw || typeof raw !== 'object') return normalizeMachinesConfig(DEFAULT_CONFIG.machines)
  if (raw.list && raw.modules) return raw
  return normalizeMachinesConfig(raw)
}

export function createMachinesState() {
  return { owned: {}, warehouse: {}, orders: [], workshopMovedAt: null }
}

function migrateMachinesState(raw, config) {
  const fresh = createMachinesState()
  if (!raw || typeof raw !== 'object') return fresh
  const cfg = machinesConfigOf(config)
  const owned = {}
  Object.keys(raw.owned || {}).forEach((id) => {
    const def = cfg.list[id]
    const item = raw.owned[id]
    if (!def || !item || typeof item !== 'object') return
    const deposits = {}
    def.deposits.forEach((entry) => {
      const value = item.deposit?.[entry.key]
      if (entry.key === 'items') {
        deposits[entry.key] = { pools: value?.pools && typeof value.pools === 'object' ? value.pools : {}, queue: Array.isArray(value?.queue) ? value.queue.filter((card) => card && card.t) : [] }
      } else {
        deposits[entry.key] = Math.max(0, Number(value) || 0)
      }
    })
    owned[id] = {
      on: Boolean(item.on),
      startedAt: typeof item.startedAt === 'string' ? item.startedAt : null,
      lastSettledAt: Math.max(0, Number(item.lastSettledAt) || 0),
      lastClaimedAt: typeof item.lastClaimedAt === 'string' ? item.lastClaimedAt : null,
      deposit: deposits,
      fishTraits: item.fishTraits && typeof item.fishTraits === 'object'
        ? Object.fromEntries(Object.entries(item.fishTraits).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]))
        : {},
      spent: item.spent && typeof item.spent === 'object' ? { ...item.spent } : {},
      day: Math.max(0, Math.floor(Number(item.day) || 0)),
      dayItems: Math.max(0, Math.floor(Number(item.dayItems) || 0)),
      dayFee: Math.max(0, Number(item.dayFee) || 0),
      dayRent: Math.max(0, Number(item.dayRent) || 0),
      shiftCarry: clamp(finiteNumber(item.shiftCarry, 0), 0, 1),
      overtime: {
        wantOn: Boolean(item.overtime?.wantOn),
        forDay: Math.max(0, Math.floor(Number(item.overtime?.forDay) || 0)),
        streak: Math.max(0, Math.floor(Number(item.overtime?.streak) || 0)),
        lastHour: Number.isInteger(item.overtime?.lastHour) ? item.overtime.lastHour : -1,
        carry: clamp(finiteNumber(item.overtime?.carry, 0), 0, 1),
        carryHour: Number.isInteger(item.overtime?.carryHour) ? item.overtime.carryHour : -1,
      },
      overheat: Math.max(0, Number(item.overheat) || 0),
      // 熔洗槽的「保留量」：低于该数量的材料不卖。
      keep: item.keep && typeof item.keep === 'object'
        ? Object.fromEntries(Object.entries(item.keep).map(([name, value]) => [String(name).slice(0, 32), Math.max(0, Math.floor(Number(value) || 0))]).filter(([, value]) => value > 0))
        : {},
      modules: item.modules && typeof item.modules === 'object'
        ? Object.fromEntries(Object.entries(item.modules)
          .filter(([moduleId, level]) => def && cfg.modules[moduleId] && Number(level) > 0)
          .map(([moduleId, level]) => [moduleId, clamp(Math.round(Number(level)), 0, cfg.modules[moduleId].maxLevel)]))
        : {},
      basket: {
        coins: Math.max(0, Number(item.basket?.coins) || 0),
        materials: item.basket?.materials && typeof item.basket.materials === 'object'
          ? Object.fromEntries(Object.entries(item.basket.materials).map(([key, value]) => [key, Math.max(0, Math.floor(Number(value) || 0))]).filter(([, value]) => value > 0))
          : {},
      },
      stats: item.stats && typeof item.stats === 'object' ? { ...item.stats } : {},
      // machineId 必须从键上重建：它是「查这台机器的配置」的唯一依据，
      // 存档往返时丢了它，所有上限/速度/过热都会算成 0 或默认值。
      machineId: id,
    }
  })
  return {
    owned,
    warehouse: raw.warehouse && typeof raw.warehouse === 'object'
      ? Object.fromEntries(Object.entries(raw.warehouse)
        .filter(([id, level]) => cfg.modules[id] && Number(level) > 0)
        .map(([id, level]) => [id, clamp(Math.round(Number(level)), 0, cfg.modules[id].maxLevel)]))
      : {},
    orders: Array.isArray(raw.orders) ? raw.orders.filter((order) => order && typeof order === 'object').slice(0, 10) : [],
    workshopMovedAt: typeof raw.workshopMovedAt === 'string' ? raw.workshopMovedAt : null,
  }
}

// ---- 解锁与位置 ----

export function machineDefFor(config, machineId) {
  const cfg = machinesConfigOf(config)
  return cfg.list[machineId] || null
}

export function machineEnabled(config, machineId) {
  const def = machineDefFor(config, machineId)
  return Boolean(def && def.enabled)
}

// 铁爪只有一个条件：亲手刮开 50 张。不绑定黑市、不绑定海域。
export function machineUnlocked(state, machineId, config = state?.config) {
  const def = machineDefFor(config, machineId)
  if (!def || !def.enabled) return false
  const unlock = def.unlock || { kind: 'always' }
  if (unlock.kind === 'always') return true
  if (unlock.kind === 'scratched') return (Number(state?.stats?.totalScratch) || 0) >= Math.max(0, Number(unlock.value) || 0)
  const unlocked = Array.isArray(state?.unlockedDepths) && state.unlockedDepths.length ? state.unlockedDepths : STARTING_DEPTHS
  if (unlock.kind === 'blackMarket') {
    if (!blackMarketUnlocked(state, config)) return false
    if (unlock.also === 'fx') return unlocked.includes('open') || unlocked.includes('deep') || unlocked.includes('rift') || unlocked.includes('abyss')
    return true
  }
  if (unlock.kind === 'depth') {
    const cfg = machinesConfigOf(config)
    return unlocked.includes(cfg.modulesUnlockDepth)
  }
  return false
}

// 模块功能本身由海域解锁；未到该海域时只显示槽位，不能装。
export function machineModulesUnlocked(state, config = state?.config) {
  const cfg = machinesConfigOf(config)
  const unlocked = Array.isArray(state?.unlockedDepths) && state.unlockedDepths.length ? state.unlockedDepths : STARTING_DEPTHS
  return unlocked.includes(cfg.modulesUnlockDepth)
}

// 工作间位置：拥有任一「收渔币」的机器后，整个工作间搬进黑市，且不可回退。
export function workshopLocation(state, config = state?.config) {
  const owned = state?.machines?.owned || {}
  const moved = Object.keys(owned).some((id) => {
    const def = machineDefFor(config, id)
    return Boolean(def && def.rent.unit === 'blackCoins')
  })
  return moved || state?.machines?.workshopMovedAt ? 'black' : 'fish'
}

export function ownsRentUnit(state, unit, config = state?.config) {
  return Object.keys(state?.machines?.owned || {}).some((id) => {
    const def = machineDefFor(config, id)
    return Boolean(def && def.rent.unit === unit)
  })
}

// ---- 模块 ----

export function machineModules(config) {
  return machinesConfigOf(config).modules
}

// 已装模块的合计效果。每个模块只管一个维度，这里只做汇总，不做交叉推算。
export function machineModuleStats(owned, config) {
  const modules = machineModules(config)
  const fitted = owned?.modules || {}
  const out = { speedMul: 1, feeMul: 1, parallel: 1, heatDelta: 0, heatPenalty: null, shiftHours: 0, depositBonus: 0, effShift: 0, load: 0, slots: 0 }
  Object.entries(fitted).forEach(([id, level]) => {
    const def = modules[id]
    if (!def || !(level > 0)) return
    out.load += def.load * level
    out.slots += 1
    if (def.speed) out.speedMul *= Math.pow(1 + def.speed, level)
    if (def.feeRate) out.feeMul *= Math.pow(1 + def.feeRate, level)
    if (def.parallel) out.parallel = Math.max(out.parallel, def.parallel)
    if (def.heatPerDay) out.heatDelta += def.heatPerDay * level
    if (def.heatPenalty !== undefined) out.heatPenalty = def.heatPenalty
    if (def.shiftHours) out.shiftHours += def.shiftHours * level
    if (def.depositBonus) out.depositBonus += def.depositBonus * level
    if (def.effShift) out.effShift += def.effShift * level
  })
  return out
}

export function moduleFits(owned, config, moduleId, level) {
  const def = machineDefFor(config, owned?.machineId)
  const mods = machineModules(config)
  const target = mods[moduleId]
  if (!def || !target) return { ok: false, code: 'MODULE_LOCKED' }
  const current = machineModuleStats(owned, config)
  const fittedIds = Object.keys(owned?.modules || {})
  const already = fittedIds.includes(moduleId)
  if (!already && current.slots + 1 > def.moduleSlots) return { ok: false, code: 'MODULE_NO_SLOT' }
  const nextLoad = current.load - ((owned?.modules?.[moduleId] || 0) * target.load) + (level * target.load)
  if (nextLoad > def.loadCapacity) return { ok: false, code: 'MODULE_NO_LOAD' }
  return { ok: true, code: null }
}

// ---- 运行速度与班次 ----

// 过热只拖慢白班，不叠加到加班效率（避免两层乘法算不清）。
export function machineDaySpeed(owned, config) {
  const def = machineDefFor(config, owned?.machineId)
  const st = machineModuleStats(owned, config)
  if (!def) return 1
  const penalty = st.heatPenalty !== null ? st.heatPenalty : def.overheat.perDayPenalty
  const heat = Math.max(0, Number(owned?.overheat) || 0)
  return Math.max(def.overheat.minSpeed, 1 - penalty * heat) * st.speedMul
}

// 加班第 h 小时（1 基）的效率：静音模块把序列右移。
export function machineOvertimeEff(owned, config, hour) {
  const def = machineDefFor(config, owned?.machineId)
  if (!def?.overtime) return 0
  const st = machineModuleStats(owned, config)
  const list = def.overtime.efficiency
  const index = clamp(Math.floor(hour) - 1 - st.effShift, 0, list.length - 1)
  return list[index] * st.speedMul
}

export function machineShiftHours(owned, config) {
  const def = machineDefFor(config, owned?.machineId)
  const st = machineModuleStats(owned, config)
  if (!def) return { startHour: 9, endHour: 17 }
  return { startHour: def.shift.startHour, endHour: Math.min(24, def.shift.endHour + st.shiftHours) }
}

export function machineFeePerItem(owned, config, overtime = false) {
  const def = machineDefFor(config, owned?.machineId)
  const st = machineModuleStats(owned, config)
  if (!def) return 0
  const base = Math.max(0, Number(def.fee.perItem) || 0) * (overtime ? Math.max(1, Number(def.fee.overtimeMultiplier) || 1) : 1)
  return base * st.feeMul
}

export function machineDepositMax(owned, config, key) {
  const def = machineDefFor(config, owned?.machineId)
  const st = machineModuleStats(owned, config)
  if (!def) return 0
  const entry = def.deposits.find((item) => item.key === key)
  if (!entry) return 0
  // 扩仓只加在「件数/重量」池上，渔币池也一起放宽，方便后期跑满吞吐。
  return Math.max(0, Number(entry.max) || 0) + st.depositBonus
}

// ---- 派生状态 ----

function localHour(now) {
  return new Date(Number(now) || 0).getHours()
}

export function machineStatus(state, machineId, now = Date.now(), config = state?.config) {
  const def = machineDefFor(config, machineId)
  const owned = state?.machines?.owned?.[machineId]
  if (!def || !owned) return 'off'
  if (!owned.on) return 'off'
  if (machineDepositSize(def, owned.deposit) <= 0) return 'empty'
  const rent = Math.max(0, Number(def.rent.daily) || 0)
  if (def.rent.unit === 'fishKg' && rent > 0 && (Number(owned.deposit.fishKg) || 0) < rent) return 'starving'
  const feeKey = def.fee.unit === 'blackCoins' ? 'blackCoins' : 'coins'
  if (def.fee.perItem > 0 && (Number(owned.deposit[feeKey]) || 0) < machineFeePerItem(owned, config, false)) return 'broke'
  const hour = localHour(now)
  const shift = machineShiftHours(owned, config)
  const inShift = hour >= shift.startHour && hour < shift.endHour
  const canOvertime = Boolean(def.overtime) && owned.overtime?.wantOn && Number(owned.overtime?.forDay) === fxDayIndex(now, fxConfig(state).dayMs)
  const inOvertime = Boolean(def.overtime) && hour >= def.overtime.fromHour && hour < def.overtime.toHour && (owned.overtime?.streak || 0) < def.overtime.maxHours
  if (canOvertime && inOvertime && (Number(owned.deposit[feeKey]) || 0) >= machineFeePerItem(owned, config, true)) return 'overtime'
  return inShift ? 'running' : 'off_duty'
}

function machineDepositSize(def, deposit) {
  return def.deposits.reduce((sum, entry) => sum + (entry.key === 'items' ? (deposit?.items?.queue?.length || 0) : (Number(deposit?.[entry.key]) || 0)), 0)
}

// ---- 存取 ----

export function machineStart(state, machineId, now = Date.now(), config = state?.config) {
  if (!machineUnlocked(state, machineId, config)) return { state, code: 'MACHINE_LOCKED' }
  const def = machineDefFor(config, machineId)
  if (!def) return { state, code: 'MACHINE_LOCKED' }
  const existing = state?.machines?.owned?.[machineId]
  if (existing?.on) return { state, code: 'MACHINE_ALREADY_ON' }
  // 关机后再开机：一切照旧（池子、模块、过热、篮子全部保留），
  // 只把结算游标推到当下，避免把停机时间当成在岗时间补产出。
  if (existing) {
    return {
      state: {
        ...state,
        machines: { ...state.machines, owned: { ...state.machines.owned, [machineId]: { ...existing, on: true, lastSettledAt: Number(now) || Date.now() } } },
      },
      code: null,
    }
  }
  const owned = {
    on: true,
    startedAt: stamp(),
    lastSettledAt: Number(now) || Date.now(),
    lastClaimedAt: null,
    deposit: def.deposits.reduce((map, entry) => ({
      ...map,
      [entry.key]: entry.key === 'items' ? { pools: {}, queue: [] } : 0,
    }), {}),
    fishTraits: {},
    spent: {},
    day: fxDayIndex(now, fxConfig(state).dayMs),
    dayItems: 0, dayFee: 0, dayRent: 0, shiftCarry: 0,
    overtime: { wantOn: false, forDay: 0, streak: 0, lastHour: -1, carry: 0, carryHour: -1 },
    overheat: 0,
    modules: {},
    basket: { coins: 0, materials: {} },
    stats: { totalItems: 0, totalCoins: 0, totalFee: 0, totalRent: 0 },
    machineId,
  }
  return { state: { ...state, machines: { ...state.machines, owned: { ...state.machines.owned, [machineId]: owned } } }, code: null }
}

// 关机：先结算到当下，再把 on 置 false。预付池、模块、过热、篮子全部保留。
export function machineStop(state, machineId, now = Date.now(), config = state?.config) {
  const owned = state?.machines?.owned?.[machineId]
  if (!owned || !owned.on) return { state, code: 'MACHINE_NOT_ON' }
  const settled = settleMachine(state, machineId, now, config)
  const cur = settled.machines.owned[machineId]
  return {
    state: {
      ...settled,
      machines: {
        ...settled.machines,
        owned: { ...settled.machines.owned, [machineId]: { ...cur, on: false, lastSettledAt: Math.max(Number(cur.lastSettledAt) || 0, Number(now) || 0) } },
      },
    },
    code: null,
  }
}

export function machineDepositFish(state, machineId, fishIds, now = Date.now(), config = state?.config) {
  const def = machineDefFor(config, machineId)
  const owned = state?.machines?.owned?.[machineId]
  if (!def || !owned) return { state, code: 'MACHINE_NOT_ON' }
  const entry = def.deposits.find((item) => item.from === 'fish')
  if (!entry) return { state, code: 'MACHINE_DEPOSIT_LIMIT' }
  const ids = (Array.isArray(fishIds) ? fishIds : []).map(String)
  if (!ids.length) return { state, code: 'MACHINE_DEPOSIT_EMPTY' }
  const byId = new Map((state.fish || []).map((fish) => [fish.id, fish]))
  const picked = []
  let kg = 0
  for (const id of ids) {
    const fish = byId.get(id)
    if (!fish || fish.status !== 'fresh') continue
    picked.push(fish)
    kg += Math.max(0, Number(fish.weight) || 0)
  }
  if (!picked.length) return { state, code: 'MACHINE_DEPOSIT_EMPTY' }
  const cap = machineDepositMax(owned, config, entry.key)
  if ((Number(owned.deposit[entry.key]) || 0) + kg > cap) return { state, code: 'MACHINE_DEPOSIT_LIMIT' }
  // 词条分布只存整数计数，按重量比例分摊后计入 FX（§8.6）。
  const traits = { ...(owned.fishTraits || {}) }
  picked.forEach((fish) => {
    ;(fish.traits || []).forEach((name) => { traits[name] = (traits[name] || 0) + 1 })
  })
  const spentIds = new Set(picked.map((fish) => fish.id))
  return {
    state: {
      ...state,
      fish: compactFishHistory((state.fish || []).map((fish) => spentIds.has(fish.id) ? { ...fish, status: 'machine', soldAt: stamp() } : fish)),
      machines: {
        ...state.machines,
        owned: {
          ...state.machines.owned,
          [machineId]: { ...owned, fishTraits: traits, deposit: { ...owned.deposit, [entry.key]: (Number(owned.deposit[entry.key]) || 0) + kg } },
        },
      },
    },
    code: null,
    result: { kg, count: picked.length },
  }
}

export function machineDepositCoins(state, machineId, amount, config = state?.config) {
  const def = machineDefFor(config, machineId)
  const owned = state?.machines?.owned?.[machineId]
  if (!def || !owned) return { state, code: 'MACHINE_NOT_ON' }
  const entry = def.deposits.find((item) => item.from === 'coins')
  if (!entry) return { state, code: 'MACHINE_DEPOSIT_LIMIT' }
  const value = Math.floor(Number(amount) || 0)
  if (value <= 0) return { state, code: 'MACHINE_DEPOSIT_EMPTY' }
  if ((Number(state.coins) || 0) < value) return { state, code: 'MACHINE_DEPOSIT_EMPTY' }
  const cap = machineDepositMax(owned, config, entry.key)
  if ((Number(owned.deposit[entry.key]) || 0) + value > cap) return { state, code: 'MACHINE_DEPOSIT_LIMIT' }
  return {
    state: {
      ...state,
      coins: Math.max(0, (Number(state.coins) || 0) - value),
      machines: { ...state.machines, owned: { ...state.machines.owned, [machineId]: { ...owned, deposit: { ...owned.deposit, [entry.key]: (Number(owned.deposit[entry.key]) || 0) + value } } } },
    },
    code: null,
  }
}

export function machineDepositBlackCoins(state, machineId, amount, config = state?.config) {
  const def = machineDefFor(config, machineId)
  const owned = state?.machines?.owned?.[machineId]
  if (!def || !owned) return { state, code: 'MACHINE_NOT_ON' }
  const entry = def.deposits.find((item) => item.from === 'blackCoins')
  if (!entry) return { state, code: 'MACHINE_DEPOSIT_LIMIT' }
  const value = Math.floor(Number(amount) || 0)
  if (value <= 0) return { state, code: 'MACHINE_DEPOSIT_EMPTY' }
  const bm = state.blackMarket || createBlackMarketState()
  if ((Number(bm.coins) || 0) < value) return { state, code: 'MACHINE_DEPOSIT_EMPTY' }
  const cap = machineDepositMax(owned, config, entry.key)
  if ((Number(owned.deposit[entry.key]) || 0) + value > cap) return { state, code: 'MACHINE_DEPOSIT_LIMIT' }
  return {
    state: {
      ...state,
      blackMarket: { ...bm, coins: Math.max(0, (Number(bm.coins) || 0) - value) },
      machines: { ...state.machines, owned: { ...state.machines.owned, [machineId]: { ...owned, deposit: { ...owned.deposit, [entry.key]: (Number(owned.deposit[entry.key]) || 0) + value } } } },
    },
    code: null,
  }
}

// 交付刮刮乐：只收未刮开的卡，刮开即结算、不保留已刮卡。
export function machineDepositCards(state, machineId, typeId, qty, config = state?.config) {
  const def = machineDefFor(config, machineId)
  const owned = state?.machines?.owned?.[machineId]
  if (!def || !owned) return { state, code: 'MACHINE_NOT_ON' }
  const entry = def.deposits.find((item) => item.from === 'scratch')
  if (!entry) return { state, code: 'MACHINE_DEPOSIT_LIMIT' }
  const want = Math.max(1, Math.floor(Number(qty) || 0))
  const pool = owned.deposit[entry.key] || { pools: {}, queue: [] }
  const cards = (state.scratchCards || []).filter((card) => card.status === 'ready' && (!typeId || card.typeId === typeId)).slice(0, want)
  if (!cards.length) return { state, code: 'MACHINE_DEPOSIT_EMPTY' }
  const cap = machineDepositMax(owned, config, entry.key)
  if ((pool.queue?.length || 0) + cards.length > cap) return { state, code: 'MACHINE_DEPOSIT_LIMIT' }
  const pools = { ...(pool.pools || {}) }
  const queue = [...(pool.queue || [])]
  for (const card of cards) {
    const snapshot = card.pool || scratchPoolSnapshot(scratchTypeFor(config, card.typeId))
    if (!snapshot) return { state, code: 'MACHINE_UNSUPPORTED_CARD' }
    pools[card.typeId] = pools[card.typeId] || snapshot
    // 压缩成「卡种 + 每格奖项下标」，10000 张也只要几百 KB。
    const face = Array.isArray(card.face) && card.face.length ? card.face : drawScratchFace(scratchTypeFor(config, card.typeId), Math.random)
    const f = face.map((slot) => {
      const index = (snapshot.prizes || []).findIndex((prize) => prize.kind === slot.kind && prize.name === slot.name && Number(prize.qty) === Number(slot.qty))
      return Math.max(0, index)
    }).join(',')
    queue.push({ t: card.typeId, f })
  }
  const movedIds = new Set(cards.map((card) => card.id))
  return {
    state: {
      ...state,
      scratchCards: (state.scratchCards || []).filter((card) => !movedIds.has(card.id)),
      machines: {
        ...state.machines,
        owned: { ...state.machines.owned, [machineId]: { ...owned, deposit: { ...owned.deposit, [entry.key]: { pools, queue } } } },
      },
    },
    code: null,
    result: { count: cards.length },
  }
}

// 熔洗槽的保留量：某种材料低于这个数量就不卖。0 表示不保留。
export function machineSetKeep(state, machineId, name, qty, config = state?.config) {
  const def = machineDefFor(config, machineId)
  const owned = state?.machines?.owned?.[machineId]
  if (!def || !owned) return { state, code: 'MACHINE_NOT_ON' }
  const key = String(name || '').slice(0, 32)
  if (!key || !blackConfigOf(config).materials?.[key]) return { state, code: 'MACHINE_DEPOSIT_EMPTY' }
  const keep = { ...(owned.keep || {}) }
  const value = Math.max(0, Math.floor(Number(qty) || 0))
  if (value > 0) keep[key] = value
  else delete keep[key]
  return {
    state: { ...state, machines: { ...state.machines, owned: { ...state.machines.owned, [machineId]: { ...owned, keep } } } },
    code: null,
  }
}

export function machineSetOvertime(state, machineId, on, now = Date.now(), config = state?.config) {
  const owned = state?.machines?.owned?.[machineId]
  if (!owned) return { state, code: 'MACHINE_NOT_ON' }
  const day = fxDayIndex(now, fxConfig(state).dayMs)
  return {
    state: {
      ...state,
      machines: {
        ...state.machines,
        owned: { ...state.machines.owned, [machineId]: { ...owned, overtime: { ...owned.overtime, wantOn: Boolean(on), forDay: Boolean(on) ? day : 0 } } },
      },
    },
    code: null,
  }
}

export function machineClaim(state, machineId, now = Date.now()) {
  const owned = state?.machines?.owned?.[machineId]
  if (!owned) return { state, code: 'MACHINE_NOT_ON' }
  const basket = owned.basket || { coins: 0, materials: {} }
  const coins = Math.max(0, Number(basket.coins) || 0)
  const materials = basket.materials || {}
  const hasMaterial = Object.values(materials).some((qty) => Number(qty) > 0)
  if (coins <= 0 && !hasMaterial) return { state, code: 'MACHINE_BASKET_EMPTY' }
  const inventory = { ...(state.inventory || {}) }
  Object.entries(materials).forEach(([name, qty]) => {
    const value = Math.max(0, Math.floor(Number(qty) || 0))
    if (value > 0) inventory[name] = (Number(inventory[name]) || 0) + value
  })
  return {
    state: {
      ...state,
      coins: Math.max(0, Number(state.coins) || 0) + coins,
      inventory,
      machines: {
        ...state.machines,
        owned: { ...state.machines.owned, [machineId]: { ...owned, basket: { coins: 0, materials: {} }, lastClaimedAt: stamp() } },
      },
    },
    code: null,
    result: { coins, materials },
  }
}

export function machineInstallModule(state, machineId, moduleId, config = state?.config) {
  const owned = state?.machines?.owned?.[machineId]
  if (!owned) return { state, code: 'MACHINE_NOT_ON' }
  if (!machineModulesUnlocked(state, config)) return { state, code: 'MODULE_LOCKED' }
  const def = machineDefFor(config, machineId)
  const mod = machineModules(config)[moduleId]
  if (!def || !mod) return { state, code: 'MODULE_LOCKED' }
  const level = Math.max(0, Math.floor(Number(owned.modules?.[moduleId]) || 0))
  if (level >= mod.maxLevel) return { state, code: 'MODULE_NO_SLOT' }
  const warehouse = { ...(state.machines.warehouse || {}) }
  if (!(Number(warehouse[moduleId]) > 0)) return { state, code: 'MODULE_NOT_OWNED' }
  const nextLevel = level + 1
  const fit = moduleFits({ ...owned, machineId }, config, moduleId, nextLevel)
  if (!fit.ok) return { state, code: fit.code }
  return {
    state: {
      ...state,
      machines: {
        ...state.machines,
        warehouse: { ...warehouse, [moduleId]: Number(warehouse[moduleId]) - 1 },
        owned: { ...state.machines.owned, [machineId]: { ...owned, modules: { ...(owned.modules || {}), [moduleId]: nextLevel } } },
      },
    },
    code: null,
  }
}

export function machineRemoveModule(state, machineId, moduleId) {
  const owned = state?.machines?.owned?.[machineId]
  const level = Math.max(0, Math.floor(Number(owned?.modules?.[moduleId]) || 0))
  if (!owned || level <= 0) return { state, code: 'MODULE_NOT_OWNED' }
  const modules = { ...(owned.modules || {}) }
  delete modules[moduleId]
  const warehouse = { ...(state.machines.warehouse || {}) }
  warehouse[moduleId] = (Number(warehouse[moduleId]) || 0) + level
  return {
    state: {
      ...state,
      machines: {
        ...state.machines,
        warehouse,
        owned: { ...state.machines.owned, [machineId]: { ...owned, modules } },
      },
    },
    code: null,
  }
}

// ---- 结算 ----

const MACHINE_HOUR_MS = 3600000

function machineWindowMinutes(fromMs, toMs, startHour, endHour, dayStart) {
  const start = Math.max(fromMs, dayStart + startHour * MACHINE_HOUR_MS)
  const end = Math.min(toMs, dayStart + endHour * MACHINE_HOUR_MS)
  return Math.max(0, end - start) / 60000
}

// 鱼按「售出」计 FX：净额 ×2、量不变（只放大 net，否则失衡比不变、2 倍会被吃掉）。
function payMachineFish(state, id, owned, kg, now) {
  const need = Math.max(0, Number(kg) || 0)
  if (need <= 0) return { state, paid: true }
  const total = Number(owned.deposit?.fishKg) || 0
  if (total < need) return { state, paid: false }
  const fraction = need / total
  const traits = { ...(owned.fishTraits || {}) }
  const entries = []
  Object.keys(traits).forEach((name) => {
    const count = Number(traits[name]) || 0
    if (!(count > 0)) return
    const used = count * fraction
    if (!(used > 0)) return
    const left = count - used
    if (left > 1e-9) traits[name] = left
    else delete traits[name]
    entries.push({ name, net: -used * 2, volume: used })
  })
  const nextOwned = { ...owned, deposit: { ...owned.deposit, fishKg: total - need }, fishTraits: traits }
  const withMachines = { ...state, machines: { ...state.machines, owned: { ...state.machines.owned, [id]: nextOwned } } }
  // 没有词条记录的旧存档：只扣鱼、不产生流水，不凭空造数据。
  return { state: entries.length ? fxAppendFlow(withMachines, entries, now) : withMachines, paid: true }
}

function payMachineRent(state, id, owned, def, now, config) {
  const unit = def.rent.unit
  const amount = Math.max(0, Number(def.rent.daily) || 0)
  if (amount <= 0) return { state, paid: true }
  if (unit === 'fishKg') {
    const paid = payMachineFish(state, id, owned, amount, now)
    if (!paid.paid) return paid
    const next = paid.state.machines.owned[id]
    const withRent = { ...paid.state, machines: { ...paid.state.machines, owned: { ...paid.state.machines.owned, [id]: { ...next, dayRent: amount } } } }
    return { state: withRent, paid: true }
  }
  // 渔币 / 鱼币租金一律从机器的预付池扣：交付即不可取出，租金也只能吃池子。
  const key = unit === 'blackCoins' ? 'blackCoins' : 'coins'
  const held = Number(owned.deposit?.[key]) || 0
  if (held < amount) return { state, paid: false }
  const nextOwned = { ...owned, dayRent: amount, deposit: { ...owned.deposit, [key]: held - amount } }
  return {
    state: { ...state, machines: { ...state.machines, owned: { ...state.machines.owned, [id]: nextOwned } } },
    paid: true,
  }
}

// 一台机器的结算主体。返回新 state。
export function settleMachine(state, id, now = Date.now(), config = state?.config) {
  const def = machineDefFor(config, id)
  const owned = state?.machines?.owned?.[id]
  if (!def || !owned?.on) return state
  const at = Number(now) || Date.now()
  const last = Number(owned.lastSettledAt) || 0
  // 时钟回拨：不产出、不回退游标。
  if (at <= last) return state
  const dayMs = fxConfig(state).dayMs
  const cap = 12 * 60 * 60 * 1000
  let cursor = Math.max(last, at - cap)
  let current = state
  let guard = 0
  while (cursor < at && guard < 400) {
    guard += 1
    const day = fxDayIndex(cursor, dayMs)
    let cur = current.machines.owned[id]
    // 日切：结算过热、清零当日计数、加班连续计数归零。
    if (Number(cur.day) !== day) {
      const st = machineModuleStats(cur, config)
      const usedHours = Number(cur.overtime?.streak) || 0
      const delta = st.heatDelta + (usedHours > 0 ? 1 : -1)
      const overheat = clamp((Number(cur.overheat) || 0) + delta, 0, def.overheat.max)
      cur = {
        ...cur,
        day,
        dayItems: 0, dayFee: 0, dayRent: 0, shiftCarry: 0,
        overheat,
        overtime: { ...cur.overtime, streak: 0, lastHour: -1, carry: 0, carryHour: -1 },
      }
      current = { ...current, machines: { ...current.machines, owned: { ...current.machines.owned, [id]: cur } } }
    }
    const dayStart = fxDayStart(day, dayMs)
    const dayClose = fxDayClose(day, dayMs)
    const nextHour = dayStart + (Math.floor((cursor - dayStart) / MACHINE_HOUR_MS) + 1) * MACHINE_HOUR_MS
    const segEnd = Math.min(at, dayClose, nextHour)
    current = runMachineSegment(current, id, cursor, segEnd, dayStart, day, config, def)
    cursor = segEnd
    cur = current.machines.owned[id]
    const nextCursor = Math.max(Number(cur.lastSettledAt) || 0, segEnd)
    current = { ...current, machines: { ...current.machines, owned: { ...current.machines.owned, [id]: { ...cur, lastSettledAt: nextCursor } } } }
  }
  return current
}

function runMachineSegment(state, id, fromMs, toMs, dayStart, day, config, def) {
  let owned = state.machines.owned[id]
  if (!machineHasWork(state, owned, def, config)) return state

  const shift = machineShiftHours(owned, config)
  const hour = Math.floor((fromMs - dayStart) / MACHINE_HOUR_MS)
  const overtime = owned.overtime
  const paidHour = overtime.lastHour === hour
  const extra = def.overtime
  const inOvertime = extra && overtime.wantOn && overtime.forDay === day &&
    hour >= Math.max(shift.endHour, extra.fromHour) && hour < Math.min(extra.toHour, extra.fromHour + extra.maxHours) &&
    (paidHour || overtime.streak < extra.maxHours)
  const speed = inOvertime
    ? machineOvertimeEff(owned, config, overtime.streak + (paidHour ? 0 : 1))
    : machineDaySpeed(owned, config)
  const minutes = inOvertime ? (toMs - fromMs) / 60000 : machineWindowMinutes(fromMs, toMs, shift.startHour, shift.endHour, dayStart)
  if (!(minutes > 0)) return state

  // 没有足够的预付池就不积攒工时。日租、时租与首条费用必须都付得起。
  const feeKey = def.fee.unit === 'blackCoins' ? 'blackCoins' : 'coins'
  const dailyRent = !(Number(owned.dayRent) > 0) ? def.rent.daily : 0
  const overtimeKg = inOvertime && !paidHour ? extraRentFish(def) : 0
  const rentKey = def.rent.unit
  const fee = machineFeePerItem(owned, config, inOvertime) + (rentKey === feeKey ? dailyRent : 0)
  if ((Number(owned.deposit?.[feeKey]) || 0) < fee) return state
  if (rentKey !== feeKey && (Number(owned.deposit?.[rentKey]) || 0) < dailyRent + (rentKey === 'fishKg' ? overtimeKg : 0)) return state
  if (rentKey !== 'fishKg' && (Number(owned.deposit?.fishKg) || 0) < overtimeKg) return state

  // 轮询会推进游标；未完成的一份工作需随存档继续积累。
  const carry = inOvertime ? (overtime.carryHour === hour ? overtime.carry : 0) : owned.shiftCarry
  const cycles = (Number(carry) || 0) + minutes * speed
  const completed = Math.floor(cycles + 1e-9)
  const remainder = Math.max(0, cycles - completed)
  const withCarry = inOvertime
    ? { ...owned, overtime: { ...overtime, carry: remainder, carryHour: hour } }
    : { ...owned, shiftCarry: remainder }
  state = { ...state, machines: { ...state.machines, owned: { ...state.machines.owned, [id]: withCarry } } }
  if (!completed) return state

  const unpaid = state
  if (dailyRent > 0) {
    const paid = payMachineRent(state, id, withCarry, def, fromMs, config)
    if (!paid.paid) return unpaid
    state = paid.state
  }
  if (inOvertime && !paidHour) {
    const paid = payMachineFish(state, id, state.machines.owned[id], overtimeKg, fromMs)
    if (!paid.paid) return unpaid
    state = paid.state
    const machine = state.machines.owned[id]
    owned = { ...machine, overtime: { ...machine.overtime, lastHour: hour, streak: overtime.streak + 1 } }
    state = { ...state, machines: { ...state.machines, owned: { ...state.machines.owned, [id]: owned } } }
  }
  owned = state.machines.owned[id]
  const items = completed * Math.max(1, machineModuleStats(owned, config).parallel)
  const result = runMachineItems(state, id, owned, def, inOvertime ? 0 : items, inOvertime ? items : 0, fromMs, config)
  return result === state ? unpaid : result
}

function extraRentFish(def) {
  return Math.max(0, Number(def.rent.overtimePerHour) || 0)
}

// 这台机器现在有没有活可干。没有活就不收租金、不产出。
function machineHasWork(state, owned, def, config) {
  if (!def) return false
  if (def.deposits.some((entry) => entry.from === 'scratch')) {
    return (owned.deposit?.items?.queue?.length || 0) > 0
  }
  if (def.id === 'scale') {
    const quota = blackDailyQuota(state, config)
    if ((Number(state.blackMarket?.soldToday) || 0) >= quota) return false
    if (!blackMarketUnlocked(state, config)) return false
    return (state.fish || []).some((fish) => fish.status === 'fresh' && blackFishEligible(state, fish, config))
  }
  if (def.id === 'wash') {
    const recycle = blackConfigOf(config).materials || {}
    const keep = owned.keep && typeof owned.keep === 'object' ? owned.keep : {}
    return Object.keys(recycle).some((name) => {
      const per = Math.max(1, Math.round(Number(recycle[name]?.per) || 1))
      const held = Math.floor(Number(state.inventory?.[name]) || 0)
      return Math.floor(Math.max(0, held - (Number(keep[name]) || 0)) / per) > 0
    })
  }
  if (def.id === 'watcher') return (state.machines?.orders?.length || 0) > 0
  return false
}

// 按机器种类处理具体条目。所有分支都只调用既有的领域函数，不重写规则。
function runMachineItems(state, id, owned, def, workItems, overtimeItems, at, config) {
  if (id === 'claw') return runClawItems(state, id, owned, def, workItems, overtimeItems, at, config)
  if (id === 'scale') return runScaleItems(state, id, owned, def, workItems + overtimeItems, config)
  if (id === 'wash') return runWashItems(state, id, owned, def, workItems + overtimeItems, config)
  if (id === 'watcher') return runWatcherItems(state, id, owned, def, workItems + overtimeItems, at, config)
  return state
}

function runClawItems(state, id, owned, def, workItems, overtimeItems, at, config) {
  const pool = owned.deposit?.items || { pools: {}, queue: [] }
  const queue = [...(pool.queue || [])]
  const pools = pool.pools || {}
  let feeCoins = Number(owned.deposit?.coins) || 0
  const basket = { coins: Number(owned.basket?.coins) || 0, materials: { ...(owned.basket?.materials || {}) } }
  let done = 0
  let feeSpent = 0
  let bestCombo = Number(owned.stats?.bestCombo) || 0

  const consume = (count, overtime) => {
    const fee = machineFeePerItem(owned, config, overtime)
    let made = 0
    while (made < count && queue.length) {
      if (feeCoins < fee) break
      const card = queue.shift()
      const snap = pools[card?.t]
      if (!snap || !Array.isArray(snap.prizes) || !snap.prizes.length) continue
      const indexes = String(card.f || '').split(',')
      const face = indexes.map((index) => snap.prizes[clamp(Math.round(Number(index) || 0), 0, snap.prizes.length - 1)])
      const settlement = scratchSettlement(face)
      settlement.payouts.forEach((payout) => {
        const qty = Math.max(0, Number(payout.qty) || 0)
        if (!(qty > 0)) return
        if (payout.kind === 'coin') basket.coins += qty
        else basket.materials[payout.name] = (basket.materials[payout.name] || 0) + qty
      })
      bestCombo = Math.max(bestCombo, settlement.pairs)
      feeCoins -= fee
      feeSpent += fee
      made += 1
    }
    return made
  }

  const workDone = consume(workItems, false)
  const otDone = consume(overtimeItems, true)
  done = workDone + otDone
  if (!done) return state

  const nextOwned = {
    ...owned,
    deposit: { ...owned.deposit, items: { pools, queue }, coins: feeCoins },
    basket,
    dayItems: (Number(owned.dayItems) || 0) + done,
    dayFee: (Number(owned.dayFee) || 0) + feeSpent,
    stats: {
      ...owned.stats,
      totalItems: (Number(owned.stats?.totalItems) || 0) + done,
      totalFee: (Number(owned.stats?.totalFee) || 0) + feeSpent,
      totalCoins: (Number(owned.stats?.totalCoins) || 0) + done,
      bestCombo,
    },
  }
  return { ...state, machines: { ...state.machines, owned: { ...state.machines.owned, [id]: nextOwned } } }
}

// 过磅台：只处理符合今日黑市订单且未超配额的鱼，逐条走既有估值与资格判定。
function runScaleItems(state, id, owned, def, count, config) {
  if (count <= 0) return state
  const bm = state.blackMarket
  if (!bm?.order || !blackMarketUnlocked(state, config)) return state
  const quota = blackDailyQuota(state, config)
  let soldToday = Number(bm.soldToday) || 0
  let feePool = Number(owned.deposit?.blackCoins) || 0
  const rate = Math.max(0, Number(def.fee.rateOfProceeds) || 0)
  const minFee = Math.max(0, Number(def.fee.min) || 0)
  const soldIds = []
  let proceeds = 0
  let feeSpent = 0
  for (const fish of (state.fish || [])) {
    if (soldIds.length >= count) break
    if (fish.status !== 'fresh') continue
    if (soldToday + soldIds.length >= quota) break
    if (!blackFishEligible(state, fish, config)) continue
    const value = blackFishValue(state, fish, config)
    const fee = Math.max(minFee, Math.ceil(value * rate))
    if (feePool < fee) break
    feePool -= fee
    feeSpent += fee
    proceeds += value
    soldIds.push(fish.id)
  }
  if (!soldIds.length) return state
  const set = new Set(soldIds)
  const at = stamp()
  const nextBm = {
    ...bm,
    coins: (Number(bm.coins) || 0) + proceeds,
    soldToday: soldToday + soldIds.length,
    lastSale: { at, kind: 'fish', accepted: soldIds.length, coins: proceeds, skipped: 0, quotaReached: false },
    stats: { ...bm.stats, fishSold: (Number(bm.stats?.fishSold) || 0) + soldIds.length, coinsEarned: (Number(bm.stats?.coinsEarned) || 0) + proceeds },
  }
  const nextOwned = {
    ...owned,
    deposit: { ...owned.deposit, blackCoins: feePool },
    dayItems: (Number(owned.dayItems) || 0) + soldIds.length,
    dayFee: (Number(owned.dayFee) || 0) + feeSpent,
    stats: { ...owned.stats, totalItems: (Number(owned.stats?.totalItems) || 0) + soldIds.length, totalFee: (Number(owned.stats?.totalFee) || 0) + feeSpent },
  }
  const fish = compactFishHistory((state.fish || []).map((item) => set.has(item.id) ? { ...item, status: 'black', blackValue: blackFishValue(state, item, config), soldAt: at } : item))
  return { ...state, fish, blackMarket: nextBm, machines: { ...state.machines, owned: { ...state.machines.owned, [id]: nextOwned } } }
}

// 熔洗槽：只卖超过「保留量」的材料，价格严格走黑市回收表。
function runWashItems(state, id, owned, def, count, config) {
  if (count <= 0) return state
  const cfg = machinesConfigOf(config)
  const recycle = blackConfigOf(config).materials || {}
  const keep = owned.keep && typeof owned.keep === 'object' ? owned.keep : {}
  let feePool = Number(owned.deposit?.blackCoins) || 0
  const feePer = Math.max(0, Number(def.fee.perItem) || 0)
  const inventory = { ...(state.inventory || {}) }
  let bmCoins = Number(state.blackMarket?.coins) || 0
  let processed = 0
  let feeSpent = 0
  let earned = 0
  for (const name of Object.keys(recycle)) {
    if (processed >= count) break
    const entry = recycle[name]
    const per = Math.max(1, Math.round(Number(entry?.per) || 1))
    const coinsPer = Math.max(0, Number(entry?.coins) || 0)
    if (!coinsPer) continue
    const held = Math.floor(Number(inventory[name]) || 0)
    const floor = Math.max(0, Math.floor(Number(keep[name]) || 0))
    const sellable = Math.floor(Math.max(0, held - floor) / per)
    if (sellable <= 0) continue
    if (feePool < feePer) break
    feePool -= feePer
    feeSpent += feePer
    inventory[name] = held - sellable * per
    bmCoins += sellable * coinsPer
    earned += sellable * coinsPer
    processed += 1
  }
  if (!processed) return state
  const nextOwned = {
    ...owned,
    deposit: { ...owned.deposit, blackCoins: feePool },
    dayItems: (Number(owned.dayItems) || 0) + processed,
    dayFee: (Number(owned.dayFee) || 0) + feeSpent,
    stats: { ...owned.stats, totalItems: (Number(owned.stats?.totalItems) || 0) + processed, totalFee: (Number(owned.stats?.totalFee) || 0) + feeSpent, totalCoins: (Number(owned.stats?.totalCoins) || 0) + earned },
  }
  return {
    ...state,
    inventory,
    blackMarket: { ...state.blackMarket, coins: bmCoins },
    machines: { ...state.machines, owned: { ...state.machines.owned, [id]: nextOwned } },
  }
}

// 盯盘机：只读服务端报价，触价即调用既有的 fxBuy / fxSell，不接触任何未来价格。
function runWatcherItems(state, id, owned, def, count, at, config) {
  if (count <= 0) return state
  const orders = Array.isArray(state.machines?.orders) ? state.machines.orders : []
  if (!orders.length) return state
  let current = state
  let feePool = Number(owned.deposit?.coins) || 0
  let processed = 0
  const remaining = []
  for (const order of orders) {
    if (processed >= count || feePool < Math.max(0, Number(def.fee.perItem) || 0)) { remaining.push(order); continue }
    if (Number(order.expireAt) && at > Number(order.expireAt)) continue
    const quote = fxQuote(current, order.name, at)
    if (!quote) { remaining.push(order); continue }
    const hit = order.side === 'buy' ? quote.buy <= Number(order.price) : quote.sell >= Number(order.price)
    if (!hit) { remaining.push(order); continue }
    const next = order.side === 'buy' ? fxBuy(current, order.name, order.qty, at) : fxSell(current, order.name, order.qty, at)
    if (next === current) { remaining.push(order); continue }
    current = next
    feePool -= Math.max(0, Number(def.fee.perItem) || 0)
    processed += 1
  }
  if (!processed) return state
  const cur = current.machines.owned[id]
  const nextOwned = {
    ...cur,
    deposit: { ...cur.deposit, coins: feePool },
    dayItems: (Number(cur.dayItems) || 0) + processed,
    dayFee: (Number(cur.dayFee) || 0) + processed * Math.max(0, Number(def.fee.perItem) || 0),
    stats: { ...cur.stats, totalItems: (Number(cur.stats?.totalItems) || 0) + processed },
  }
  return { ...current, machines: { ...current.machines, orders: remaining, owned: { ...current.machines.owned, [id]: nextOwned } } }
}

// 一次同步里结算所有已开机的机器。纯函数，注入时钟。
export function settleMachines(state, now = Date.now(), config = state?.config) {
  const owned = state?.machines?.owned
  if (!owned || !Object.keys(owned).length) return state
  let current = state
  Object.keys(owned).forEach((id) => {
    if (!current.machines.owned[id]?.on) return
    current = settleMachine(current, id, now, config)
  })
  return current
}
