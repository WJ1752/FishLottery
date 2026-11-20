import { FISH_POOLS } from './traits.js'

const art = (folder, name) => `${import.meta.env?.BASE_URL ?? '/'}art/${folder}/${name}.webp`
const scenes = new Set(['shore', 'shelf', 'open', 'deep', 'rift', 'abyss'])
const locations = new Map([
  ['npc', 'exchange'],
  ['scratch', 'tickets'],
  ['lottery', 'tickets'],
  ['fx', 'exchange-station'],
  ['black-buy', 'hidden-dock'],
  ['black-super', 'hidden-dock'],
  ['black-shop', 'hidden-dock'],
  ['black-workshop', 'workshop'],
  ['stats', 'logbook'],
])

export const harborArt = art('scenes', 'harbor')
export const depthArt = (id) => art('scenes', scenes.has(id) ? id : 'shore')
export const locationArt = (page) => locations.has(page) ? art('scenes', locations.get(page)) : harborArt

const fishNames = new Map()
for (const fish of Object.values(FISH_POOLS).flat()) {
  for (const key of [fish.id, fish.name, fish.speciesClass, fish.latin]) fishNames.set(key, fish.id)
}

export function fishArt(fish) {
  const key = typeof fish === 'string'
    ? fishNames.get(fish)
    : fishNames.get(fish?.speciesClass) || fishNames.get(fish?.name) || fishNames.get(fish?.id)
  return art('fish', key || 'unknown')
}

const items = new Map([
  ['浮木纤维', 'driftwood'],
  ['潮汐树脂', 'tide-resin'],
  ['深蓝晶片', 'blue-crystal'],
  ['渊核碎片', 'core-fragment'],
  ['旧日合金', 'ancient-alloy'],
  ['潮汐锁钥', 'tide-key'],
  ['深渊锁钥', 'abyss-key'],
  ['鱼币', 'coin'],
  ['coin', 'coin'],
  ['coins', 'coin'],
  ['渔币', 'black-coin'],
  ['blackCoins', 'black-coin'],
  ['scratch', 'scratch'],
  ['scratch-tide', 'scratch'],
  ['潮汐刮刮乐', 'scratch'],
  ['超级刮刮乐', 'scratch'],
  ['ticket', 'ticket'],
  ['lottery', 'ticket'],
  ['彩票', 'ticket'],
  ['普通场', 'ticket'],
  ['高级场', 'ticket'],
  ['大师场', 'ticket'],
  ['normal', 'ticket'],
  ['advanced', 'ticket'],
  ['master', 'ticket'],
  ['tide', 'rod-tide'],
  ['azure', 'rod-azure'],
  ['abyss', 'rod-abyss'],
  ['shadow', 'rod-shadow'],
  ['潮痕 · 初阶', 'rod-tide'],
  ['苍蓝 · 进阶', 'rod-azure'],
  ['无光 · 深渊', 'rod-abyss'],
  ['无灯 · 黑市', 'rod-shadow'],
  ['claw', 'claw'],
  ['scale', 'scale'],
  ['wash', 'wash'],
  ['watcher', 'watcher'],
  ['module', 'module'],
])

export function itemArt(item) {
  const id = typeof item === 'string' ? item : String(item?.id ?? '')
  const name = typeof item === 'object' ? item?.name : ''
  let key = items.get(id) || items.get(name)
  if (!key && id?.startsWith('rod-')) key = items.get(id.split('-')[1])
  if (!key && id?.startsWith('scratch-')) key = 'scratch'
  if (!key && id?.startsWith('lottery-')) key = 'ticket'
  if (!key && (item?.kind === 'module' || id?.startsWith('mod-'))) key = 'module'
  return key ? art('items', key) : null
}
