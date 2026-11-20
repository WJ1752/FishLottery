import React from 'react'
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
  const discovered = species.filter((fish) => catches[fish.speciesClass] > 0).length

  return <section className="panel fish-codex" aria-label="鱼类图鉴">
    <header className="fish-codex-heading">
      <div>
        <h2><BookOpen size={18} aria-hidden="true" /> 鱼类图鉴</h2>
        <p>查看鱼种栖息的海域，亲手钓获后即可登记。</p>
      </div>
      <span className="fish-codex-count">已登记 <strong>{discovered}</strong> / {species.length}</span>
    </header>
    <ul className="fish-codex-list">
      {species.map((fish) => {
        const count = Number(catches[fish.speciesClass]) || 0
        return <li className="fish-codex-card" key={fish.id}>
          <div className="fish-codex-plate">
            <img src={fishArt(fish)} alt="" width="400" height="270" loading="lazy" decoding="async" />
            {count > 0 && <Check className="fish-codex-check" size={18} aria-hidden="true" />}
          </div>
          <div className="fish-codex-record">
            <h3>{fish.name}</h3>
            <p>{fish.waters.join(' · ')}</p>
            <span>{count > 0 ? `已钓获 ${count.toLocaleString('zh-CN')} 次` : '待登记'}</span>
          </div>
        </li>
      })}
    </ul>
  </section>
}
