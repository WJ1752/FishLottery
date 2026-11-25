import React, { useState } from 'react'
import { BookOpen, Check } from 'lucide-react'
import { fishArt } from './art.js'
import { DEPTHS } from './game.js'
import { FISH_POOLS } from './traits.js'
import './fish-codex.css'

const catalog = new Map()
for (const depth of DEPTHS) {
  for (const fish of FISH_POOLS[depth.id] || []) {
    const entry = catalog.get(fish.speciesClass) || { ...fish, waters: [] }
    entry.waters.push(depth.label)
    catalog.set(fish.speciesClass, entry)
  }
}
const species = Array.from(catalog.values())

export default function FishCodex({ state }) {
  const catches = state?.stats?.speciesSeen || {}
  const [filter, setFilter] = useState('all')
  const isRegistered = (fish) => Number(catches[fish.speciesClass]) > 0
  const discovered = species.filter(isRegistered).length
  const visible = filter === 'all' ? species : species.filter((fish) => isRegistered(fish) === (filter === 'registered'))
  const filters = [
    ['all', '全部', species.length],
    ['registered', '已登记', discovered],
    ['pending', '待登记', species.length - discovered],
  ]

  return <section className="panel fish-codex" aria-label="鱼类图鉴">
    <header className="fish-codex-heading">
      <h2><BookOpen size={18} aria-hidden="true" /> 鱼类图鉴</h2>
      <div className="fish-codex-progress">
        <span>已登记 <strong>{discovered}</strong> / {species.length}</span>
        <progress value={discovered} max={species.length} aria-label="鱼类图鉴登记进度" />
      </div>
    </header>
    <div className="fish-codex-filters" role="group" aria-label="筛选鱼种">
      {filters.map(([id, title, count]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
        {title} <span>{count}</span>
      </button>)}
    </div>
    {!visible.length && <p className="fish-codex-empty">{filter === 'registered' ? '钓到第一条鱼后，就能在这里看到登记。' : '图鉴已经全部登记。'}</p>}
    <ul className="fish-codex-list">
      {visible.map((fish) => {
        const count = Number(catches[fish.speciesClass]) || 0
        return <li className="fish-codex-card" key={fish.id}>
          <div className="fish-codex-plate">
            <img src={fishArt(fish)} alt="" width="72" height="48" loading="lazy" decoding="async" />
            {count > 0 && <span className="fish-codex-check"><Check size={14} aria-hidden="true" /></span>}
          </div>
          <div className="fish-codex-record">
            <h3>{fish.name}</h3>
            <p className="fish-codex-latin" lang="la">{fish.latin}</p>
            <p>{fish.waters.join(' · ')}</p>
          </div>
          <div className="fish-codex-tally">
            {count > 0 ? <><strong>{count.toLocaleString('zh-CN')}</strong><span>钓获次数</span></> : <span>待登记</span>}
          </div>
        </li>
      })}
    </ul>
  </section>
}
