export const TENSION_DEFAULTS = {
  maxTension: 1000,
  accelMs: 1000,
  // 与「单次 10000 能量 / 1000 能量每秒」的 10 秒进度同一量级，
  // 否则脱钩清空进度后永远追不上张力。
  maxRate: 100,
  baseLoss: 10,
  delayMs: 0,
}

export const TRAIT_EFFECT_TYPES = [
  { id: 'loss', label: '脱钩损耗', unit: '点', base: 0, hint: '张力满时额外增加的耐久损耗' },
  { id: 'tensionRate', label: '张力积累率', unit: '×', base: 1, hint: '加快或减缓张力累积；预设应大于 1' },
  { id: 'tensionDelay', label: '张力生效延迟', unit: 'ms', base: 0, hint: '延后张力开始累积的时间' },
  { id: 'maxTension', label: '脱钩张力', unit: '×', base: 1, hint: '修正脱钩所需的张力上限；预设应小于 1，越低越早脱钩' },
  { id: 'chargeRate', label: '充能速率', unit: '×', base: 1, hint: '降低该鱼咬钩期间的钓竿充能' },
  // 拉锯：结算时按张力条超过阈值的部分磨损钓竿。只支持乘算，多个词条连乘。
  { id: 'sawLoss', label: '拉锯损耗', unit: '×', base: 1, mode: 'multiply', hint: '超过阈值的张力每 100 点 × 该倍率，直接扣耐久；只支持乘算' },
  // 阈值：把默认 80% 往下压。只支持加算，数值为负百分比（-0.05 = 降至 75%）。
  { id: 'sawThreshold', label: '拉锯阈值', unit: '%', base: 0, mode: 'add', hint: '降低拉锯损耗生效的张力比例（80% → 更低）；只支持加算' },
]

const EFFECT_BASE = TRAIT_EFFECT_TYPES.reduce((map, type) => ({ ...map, [type.id]: type.base }), {})

export const SAW_THRESHOLD_BASE = 0.8

// biteChance 是同词条组合的权重因子：组合权重 = 各词条咬钩几率相乘。
// 每个海域刷哪些词条、权重多少，全部由后台「海域」页的词条权重表决定。
export const TRAITS = [
  { id: 'swift', label: '迅游', color: '#4299a7', icon: '↗', biteChance: 1.15, effects: [{ type: 'tensionRate', mode: 'multiply', value: 1.12 }] },
  { id: 'armored', label: '重甲', color: '#65758b', icon: '⬡', biteChance: 1.35, effects: [{ type: 'loss', mode: 'add', value: 4 }, { type: 'maxTension', mode: 'multiply', value: 0.94 }] },
  { id: 'luminous', label: '辉光', color: '#d19a3d', icon: '✦', biteChance: 1.5, effects: [{ type: 'chargeRate', mode: 'multiply', value: 0.94 }] },
  { id: 'heavy', label: '巨型', color: '#4e6476', icon: '◆', biteChance: 1.6, effects: [{ type: 'loss', mode: 'add', value: 6 }, { type: 'sawLoss', mode: 'multiply', value: 3 }] },
  { id: 'ancient', label: '远古', color: '#8e6b9d', icon: '◌', biteChance: 1.75, effects: [{ type: 'maxTension', mode: 'multiply', value: 0.9 }, { type: 'tensionDelay', mode: 'add', value: 180 }] },
  { id: 'surge', label: '深涌', color: '#3f7f9e', icon: '≋', biteChance: 1.9, effects: [{ type: 'tensionRate', mode: 'multiply', value: 1.08 }, { type: 'sawThreshold', mode: 'add', value: -0.05 }] },
  { id: 'abyssal', label: '渊印', color: '#6250a5', icon: '◇', biteChance: 2.05, effects: [{ type: 'tensionRate', mode: 'multiply', value: 1.12 }, { type: 'sawLoss', mode: 'multiply', value: 4 }] },
  { id: 'prismatic', label: '棱彩', color: '#be6b87', icon: '◈', biteChance: 2.3, effects: [{ type: 'maxTension', mode: 'multiply', value: 0.82 }, { type: 'chargeRate', mode: 'multiply', value: 0.9 }, { type: 'sawThreshold', mode: 'add', value: -0.1 }] },
]

const SPECIES = {
  jack: ['银鳞鲹', 'Silver jack', 'silver'],
  bream: ['暮光鲷', 'Twilight bream', 'twilight'],
  tuna: ['蓝脊鲔', 'Bluefin tuna', 'blue'],
  grouper: ['玄甲石斑', 'Obsidian grouper', 'obsidian'],
  eel: ['虹膜鳗', 'Iris eel', 'iris'],
  lantern: ['深渊灯笼鱼', 'Abyss lanternfish', 'lantern'],
  marlin: ['星痕旗鱼', 'Star-marked marlin', 'star'],
  spear: ['苍白矛吻鱼', 'Pale spearfish', 'pale'],
  ray: ['渊影鳐', 'Abyss ray', 'abyss'],
  angler: ['熔核鮟鱇', 'Ember angler', 'ember'],
  jelly: ['静海幽灵水母', 'Still-sea jelly', 'jelly'],
}

const fish = (id, key, baseWeight, rarity) => ({ id, name: SPECIES[key][0], latin: SPECIES[key][1], speciesClass: SPECIES[key][2], baseWeight, rarity })

export const FISH_POOLS = {
  shore: [fish('jack', 'jack', 100, 6), fish('bream', 'bream', 58, 12), fish('tuna', 'tuna', 24, 22), fish('marlin', 'marlin', 7, 34)],
  shelf: [fish('bream', 'bream', 60, 12), fish('tuna', 'tuna', 36, 22), fish('grouper', 'grouper', 18, 30), fish('eel', 'eel', 8, 40)],
  open: [fish('tuna', 'tuna', 40, 22), fish('grouper', 'grouper', 26, 32), fish('eel', 'eel', 15, 42), fish('marlin', 'marlin', 7, 52), fish('lantern', 'lantern', 3, 62)],
  deep: [fish('grouper', 'grouper', 30, 34), fish('eel', 'eel', 20, 44), fish('marlin', 'marlin', 12, 54), fish('lantern', 'lantern', 6, 64), fish('spear', 'spear', 2, 74)],
  rift: [fish('eel', 'eel', 22, 46), fish('marlin', 'marlin', 16, 54), fish('lantern', 'lantern', 12, 62), fish('ray', 'ray', 7, 70), fish('angler', 'angler', 3, 78)],
  abyss: [fish('lantern', 'lantern', 22, 60), fish('ray', 'ray', 16, 70), fish('spear', 'spear', 11, 74), fish('angler', 'angler', 7, 78), fish('jelly', 'jelly', 3, 86)],
}

export function fishPoolFor(depthId) {
  return FISH_POOLS[depthId] || FISH_POOLS.shore
}

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const fmtNumber = (value) => String(Math.round(finite(value) * 100) / 100)

export function normalizeEffect(effect) {
  const meta = TRAIT_EFFECT_TYPES.find((type) => type.id === effect?.type)
  if (!meta) return null
  // 拉锯损耗只允许乘算，拉锯阈值只允许加算；后台改方式也不会破坏语义。
  const mode = meta.mode || (effect.mode === 'multiply' ? 'multiply' : 'add')
  let value = finite(effect.value, 0)
  if (meta.id === 'sawLoss') value = Math.max(0, value)
  if (meta.id === 'sawThreshold') value = Math.min(0, value)
  return { type: meta.id, mode, value }
}

export function normalizeTrait(trait, index = 0) {
  const source = trait && typeof trait === 'object' ? trait : {}
  return {
    id: String(source.id || `trait-${index + 1}`),
    label: String(source.label || `词条 ${index + 1}`),
    icon: String(source.icon || '✦'),
    color: String(source.color || '#65758b'),
    biteChance: Math.max(0.05, Math.min(10, finite(source.biteChance, 1) || 1)),
    effects: (Array.isArray(source.effects) ? source.effects : []).map(normalizeEffect).filter(Boolean),
  }
}

export function aggregateTraitEffects(traits, type, base) {
  let value = Number.isFinite(Number(base)) ? Number(base) : EFFECT_BASE[type] ?? 0
  let multiplier = 1
  ;(Array.isArray(traits) ? traits : []).forEach((trait) => {
    ;(Array.isArray(trait?.effects) ? trait.effects : []).forEach((effect) => {
      if (effect?.type !== type) return
      const amount = finite(effect.value)
      if (effect.mode === 'multiply') multiplier *= amount
      else value += amount
    })
  })
  return value * multiplier
}

// 多词条组合的咬钩权重 = 各词条咬钩几率相乘。
export function comboBiteChance(traits) {
  return (Array.isArray(traits) ? traits : []).reduce((product, trait) => product * Math.max(0.05, finite(trait?.biteChance, 1)), 1)
}

export function biteWeightFor(fishRecord, comboWeight = 1) {
  const rarity = Math.max(0, finite(fishRecord?.rarity))
  const base = Math.max(0.0001, finite(fishRecord?.baseWeight, 1))
  return base * Math.pow(2, -rarity / 25) * Math.max(0.0001, finite(comboWeight, 1))
}

// 按海域配置的词条权重，无放回加权抽取；权重全为 0 时退化为均匀抽取。
export function pickTraitsWeighted(traits, weights, count, random = Math.random) {
  const pool = (Array.isArray(traits) ? traits : []).map((trait) => ({ trait, weight: Math.max(0, finite(weights?.[trait.id], 1)) }))
  const picked = []
  const target = Math.min(Math.max(0, Math.floor(finite(count))), pool.length)
  while (picked.length < target) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0)
    let index = pool.length - 1
    if (total <= 0) {
      index = Math.floor(random() * pool.length)
    } else {
      let roll = random() * total
      for (let i = 0; i < pool.length; i += 1) {
        roll -= pool[i].weight
        if (roll <= 0) { index = i; break }
      }
    }
    picked.push(pool[index].trait)
    pool.splice(index, 1)
  }
  return picked
}

export function tensionAt(elapsedMs, multiplier = 1, maxTension = TENSION_DEFAULTS.maxTension, tension = TENSION_DEFAULTS, delayMs = 0) {
  const cfg = { ...TENSION_DEFAULTS, ...(tension || {}) }
  const delay = Math.max(0, finite(delayMs))
  const accelSeconds = Math.max(0.001, finite(cfg.accelMs, TENSION_DEFAULTS.accelMs) / 1000)
  const maxRate = Math.max(0, finite(cfg.maxRate, TENSION_DEFAULTS.maxRate))
  const seconds = Math.max(0, finite(elapsedMs) - delay) / 1000
  const raw = seconds <= accelSeconds
    ? 0.5 * maxRate * seconds * seconds / accelSeconds
    : 0.5 * maxRate * accelSeconds + maxRate * (seconds - accelSeconds)
  const cap = Math.max(1, finite(maxTension, TENSION_DEFAULTS.maxTension))
  return Math.min(cap, raw * Math.max(0, finite(multiplier, 1)))
}

export function tensionFillMs(multiplier = 1, maxTension = TENSION_DEFAULTS.maxTension, tension = TENSION_DEFAULTS, delayMs = 0) {
  const cfg = { ...TENSION_DEFAULTS, ...(tension || {}) }
  const delay = Math.max(0, finite(delayMs))
  const accelSeconds = Math.max(0.001, finite(cfg.accelMs, TENSION_DEFAULTS.accelMs) / 1000)
  const maxRate = Math.max(0.001, finite(cfg.maxRate, TENSION_DEFAULTS.maxRate))
  const mult = Math.max(0.0001, finite(multiplier, 1))
  const cap = Math.max(1, finite(maxTension, TENSION_DEFAULTS.maxTension))
  const accelPoints = 0.5 * maxRate * accelSeconds * mult
  const seconds = cap <= accelPoints
    ? Math.sqrt(2 * cap * accelSeconds / (mult * maxRate))
    : accelSeconds + (cap / mult - 0.5 * maxRate * accelSeconds) / maxRate
  return delay + seconds * 1000
}

export function rarityLabel(rarity) {
  const value = Math.max(0, finite(rarity))
  if (value < 25) return '普通'
  if (value < 45) return '稀有'
  if (value < 70) return '史诗'
  return '传说'
}

export function effectSummary(effect) {
  const meta = TRAIT_EFFECT_TYPES.find((type) => type.id === effect?.type)
  if (!meta) return ''
  const value = finite(effect.value)
  const formatted = effect.type === 'sawThreshold'
    ? `${value >= 0 ? '+' : ''}${fmtNumber(value * 100)}%`
    : effect.mode === 'multiply' ? `×${fmtNumber(value)}` : `${value >= 0 ? '+' : ''}${fmtNumber(value)}`
  return `${meta.label} ${formatted}`
}

export function traitSummary(trait) {
  return (Array.isArray(trait?.effects) ? trait.effects : []).map(effectSummary).filter(Boolean).join(' · ')
}

const combinationsOf = (list, size) => {
  const result = []
  const walk = (start, acc) => {
    if (acc.length === size) { result.push(acc); return }
    for (let i = start; i < list.length; i += 1) walk(i + 1, [...acc, list[i]])
  }
  walk(0, [])
  return result
}

const weightOf = (trait, weights) => Math.max(0, finite(weights?.[trait.id], 1))

// 无放回加权抽取下，恰好抽到某一组词条的概率（对组内所有顺序求和）。
// 黑市订单用同一套概率估算「一条鱼符合收购条件」的几率，所以导出。
export function subsetDrawChance(combo, traits, weights) {
  const total = traits.reduce((sum, trait) => sum + weightOf(trait, weights), 0)
  if (total <= 0) return 1 / Math.max(1, combinationsOf(traits, combo.length).length)
  let chance = 0
  const walk = (remaining, used, acc) => {
    if (!remaining.length) { chance += acc; return }
    const denominator = total - used
    if (denominator <= 0) return
    remaining.forEach((trait, index) => {
      const weight = weightOf(trait, weights)
      if (weight <= 0) return
      walk([...remaining.slice(0, index), ...remaining.slice(index + 1)], used + weight, acc * weight / denominator)
    })
  }
  walk(combo, 0, 1)
  return chance
}

// 某海域内所有可能词条组合的咬钩概率对照表。
export function combinationBiteTable({ traits, weights, minCount = 1, maxCount = 1 }) {
  const list = Array.isArray(traits) ? traits : []
  const sizes = []
  for (let size = Math.max(1, minCount); size <= Math.min(list.length, maxCount); size += 1) sizes.push(size)
  if (!sizes.length) return []
  const rows = []
  sizes.forEach((size) => {
    combinationsOf(list, size).forEach((combo) => {
      rows.push({
        ids: combo.map((trait) => trait.id),
        traits: combo,
        weight: comboBiteChance(combo),
        drawChance: subsetDrawChance(combo, list, weights) / sizes.length,
      })
    })
  })
  // 抽不到的组合（权重为 0）不进入对照表。
  const reachable = rows.filter((row) => row.drawChance > 0)
  const total = reachable.reduce((sum, row) => sum + row.drawChance * row.weight, 0)
  return reachable
    .map((row) => ({ ...row, biteShare: total > 0 ? row.drawChance * row.weight / total : 0 }))
    .sort((a, b) => b.biteShare - a.biteShare)
}
