// 7 天行情模拟：每天 10 万条鱼，验证供需失衡模型在真实量级下的表现。
// 只有上钩与卖出影响行情：上钩抽走供给、卖出还回供给。
// 用法：node scripts/fx-sim.js [天数] [每日鱼数]
import {
  createInitialState,
  fxBiteFlow,
  fxExchangeFlow,
  fxAppendFlow,
  fxBoard,
  fxConfig,
  fxDayIndex,
  fxDayStart,
  fxQuote,
  rollBite,
  settleFxDays,
} from '../src/game.js'
import { TRAITS } from '../src/traits.js'

const DAYS = Number(process.argv[2]) || 7
const PER_DAY = Number(process.argv[3]) || 100000
const HOUR = 60 * 60 * 1000
const UNLOCKED = ['shore', 'shelf', 'open', 'deep', 'rift', 'abyss']

// 玩家分布：多数在中层海域，少量在深渊。
const depthMix = [
  { id: 'shelf', share: 0.3 },
  { id: 'open', share: 0.3 },
  { id: 'deep', share: 0.25 },
  { id: 'rift', share: 0.1 },
  { id: 'abyss', share: 0.05 },
]

// 每天玩家行为不同：有时囤鱼（少卖），有时清仓（全卖）。
// 卖出比例在 0.55~1.0 之间逐日浮动，这才是行情日间波动的来源。
const sellRatioOf = (day) => {
  const noise = Math.abs(Math.sin(day * 12.9898) * 43758.5453) % 1
  return 0.55 + 0.45 * noise
}

const seeded = (seed) => {
  let value = seed >>> 0
  return () => {
    value ^= value << 13; value >>>= 0
    value ^= value >>> 17
    value ^= value << 5; value >>>= 0
    return value / 4294967296
  }
}

const random = seeded(20261116)
const pickDepth = () => {
  let roll = random()
  for (const item of depthMix) {
    roll -= item.share
    if (roll <= 0) return item.id
  }
  return depthMix[depthMix.length - 1].id
}

let state = { ...createInitialState(), unlockedDepths: UNLOCKED }
const startDay = fxDayIndex(Date.now()) - DAYS
const rows = []

for (let d = 0; d < DAYS; d += 1) {
  const day = startDay + d
  const at = fxDayStart(day) + 10 * HOUR
  const sellRatio = sellRatioOf(day)
  for (let i = 0; i < PER_DAY; i += 1) {
    const depthId = pickDepth()
    const view = { ...state, fishing: { ...state.fishing, selectedDepthId: depthId } }
    const fish = rollBite(view, random).fish
    // 上钩：词条被抽离市场。
    state = fxAppendFlow(state, fxBiteFlow(fish), at)
    // 卖回商会：词条还给市场。没卖掉的就被玩家锁在仓库里。
    if (random() < sellRatio) state = fxAppendFlow(state, fxExchangeFlow(fish), at)
  }
  // 次日零点结算成一根日线。
  state = settleFxDays(state, fxDayStart(day + 1))
  const snapshot = {}
  TRAITS.forEach((trait) => { snapshot[trait.id] = fxQuote(state, trait.id, fxDayStart(day + 1) + 9 * HOUR) })
  rows.push({ day, snapshot })
}

const fmtPct = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
const pad = (text, width) => String(text).padEnd(width)
const padStart = (text, width) => String(text).padStart(width)

console.log(`
7 日行情模拟 · 每日 ${PER_DAY.toLocaleString('en-US')} 条鱼 · 卖出比例逐日浮动
`)
console.log(pad('词条', 8) + padStart('基准', 6) + rows.map((row) => padStart(`D${row.day - startDay + 1}`, 9)).join('') + padStart('7日累计', 10) + padStart('最终价', 10))
console.log('-'.repeat(8 + 6 + rows.length * 9 + 20))

TRAITS.forEach((trait) => {
  const first = rows[0].snapshot[trait.id]
  const last = rows[rows.length - 1].snapshot[trait.id]
  const moves = rows.map((row) => fmtPct(row.snapshot[trait.id].change))
  const total = (last.mid - first.base) / first.base
  console.log(pad(trait.label, 8) + padStart(String(first.base), 6) + moves.map((move) => padStart(move, 9)).join('') + padStart(fmtPct(total), 10) + padStart(String(last.mid), 10))
})

const config = fxConfig(state)
const board = fxBoard(state, fxDayStart(fxDayIndex(Date.now())) + 9 * HOUR)
const boardDays = board.days
console.log(`\n失衡比（上钩−卖出）/（上钩+卖出），样本 ${boardDays.length} 天：`)
const sample = board.rows.find((row) => row.name === 'prismatic')
console.log(`  棱彩 ${sample.bars.map((bar) => (bar.settled ? bar.imbalance.toFixed(2) : '—')).join('  ')}`)

let maxMove = 0
let limitHits = 0
let worstRatio = 1
rows.forEach((row) => {
  TRAITS.forEach((trait) => {
    const quote = row.snapshot[trait.id]
    maxMove = Math.max(maxMove, Math.abs(quote.change))
    if (Math.abs(quote.change) >= config.dailyLimit - 1e-9) limitHits += 1
    worstRatio = Math.max(worstRatio, quote.mid / quote.base, quote.base / quote.mid)
  })
})
const total = rows.length * TRAITS.length
console.log(`\n最大单日涨跌 ${fmtPct(maxMove)} · 涨跌停 ±${(config.dailyLimit * 100).toFixed(0)}% · 触顶 ${limitHits} / ${total}`)
console.log(`最大价格偏离基准 ${worstRatio.toFixed(2)}×`)

const checks = [
  ['单日涨跌不越涨跌停', maxMove <= config.dailyLimit + 1e-9],
  ['价格不脱离基准 3 倍以上', worstRatio <= 3],
  ['触顶次数不超过 20%', limitHits <= total * 0.2],
]
checks.forEach(([label, ok]) => console.log(`${ok ? '✔' : '✖'} ${label}`))
if (checks.some(([, ok]) => !ok)) process.exitCode = 1
