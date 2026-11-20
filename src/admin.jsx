import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, ChevronDown, CirclePlus, Coins, Copy, Gift, Hammer, Plus, RotateCcw, Save, Skull, Flag, SlidersHorizontal, Sparkles, Ticket, Trash2, TrendingUp, Users, Waves } from 'lucide-react'
import { COIN, DEPTHS, GUIDE_STEP_IDS, LOTTERY_HISTORY_DEFAULT, LOTTERY_HISTORY_MAX, LOTTERY_HISTORY_MIN, MATERIALS, SCRATCH_DEFAULT_SLOTS, SCRATCH_MAX_SLOTS, SCRATCH_MIN_SLOTS, TRAITS, addLotteryType, addRod, addScratchType, blackSuperValue, fishQuotePrice, fxDayStart, hitDistribution, normalizeFx, scratchGridLayout, scratchPoolSnapshot, scratchPoolStats, tierForPrice } from './game'
import { TRAIT_EFFECT_TYPES, combinationBiteTable, effectSummary, normalizeTrait } from './traits'
import { FxCandles, FxFlowBars, FX_GRAINS, decodeCandleRows, fxGrainLabel } from './fx-chart'
import { api } from './api'
import { StepUpPage, TotpSetupPage } from './auth'

const MATERIAL_NAMES = Object.keys(MATERIALS)
const cn = (...values) => values.filter(Boolean).join(' ')
const StatusPill = ({ children, tone = 'neutral' }) => <span className={`status-pill status-${tone}`}>{children}</span>

const SECTIONS = [
  { id: 'scratch', label: '刮刮乐', icon: Gift },
  { id: 'lottery', label: '彩票', icon: Ticket },
  { id: 'rod', label: '钓竿', icon: Hammer },
  { id: 'trait', label: '词条', icon: Sparkles },
  { id: 'depth', label: '海域', icon: Waves },
  { id: 'merchant', label: '商会', icon: BarChart3 },
  { id: 'fx', label: '深海FX', icon: TrendingUp },
  { id: 'black', label: '黑市', icon: Skull },
  { id: 'machine', label: '机器', icon: SlidersHorizontal },
  { id: 'guide', label: '新手引导', icon: Flag },
]

const TENSION_FIELDS = [
  { key: 'maxTension', label: '最大张力', hint: '默认 1000', min: 50, step: 10 },
  { key: 'accelMs', label: '加速时间 (ms)', hint: '从 0 加速到满速', min: 100, step: 100 },
  { key: 'maxRate', label: '最大张力速率', hint: '张力/秒', min: 1, step: 10 },
  { key: 'baseLoss', label: '基础损耗', hint: '张力满时扣耐久', min: 0, step: 1 },
  { key: 'delayMs', label: '张力生效时间 (ms)', hint: '咬钩后多久开始施加张力', min: 0, step: 50 },
]

function Field({ label, hint, children }) {
  return <label className="admin-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function TextInput({ value, onChange, placeholder, type = 'text', min, max, step }) {
  return <input className="admin-input" type={type} value={value} placeholder={placeholder} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} />
}

function NumberInput({ value, onChange, min = 0, max, step = 1 }) {
  return <TextInput type="number" value={value} min={min} max={max} step={step} onChange={(next) => onChange(Number(next))} />
}

function ColorInput({ value, onChange, label }) {
  return <span className="admin-color"><input type="color" value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} /><code>{value}</code></span>
}

function SectionHead({ title, count, onAdd, addLabel }) {
  return <div className="admin-section-head"><div><h2>{title}</h2><span>{count}</span></div>{onAdd && <button className="primary-button" onClick={onAdd}><Plus size={15} /> {addLabel}</button>}</div>
}

function DeleteButton({ onClick, label }) {
  return <button className="admin-delete" onClick={onClick} aria-label={label} title={label}><Trash2 size={14} /></button>
}

function CopyButton({ onClick, label }) {
  return <button className="admin-copy" onClick={onClick} aria-label={label} title={label}><Copy size={14} /></button>
}

// 复制一份配置：新 id + 「副本」后缀，其余字段深拷贝，改副本不会影响原条目。
const copyOf = (item, fields) => ({ ...item, ...fields, id: `${item.id}-copy-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: `${item.name} 副本` })

// 与真实页面同构的预览：后台改了颜色 / 名称 / 奖池，保存前就能看到最终卡面。
function ScratchCardPreview({ type }) {
  const slots = Math.max(SCRATCH_MIN_SLOTS, Math.round(Number(type.slots) || SCRATCH_DEFAULT_SLOTS))
  const layout = scratchGridLayout(slots)
  // 预览用奖池前几项铺满格子，直观看到「几个格子、每格显示什么」。
  const face = Array.from({ length: slots }, (_, index) => type.prizes?.[index % Math.max(1, type.prizes?.length || 1)])
  return <div className="preview-stage">
    <div className="scratch-card preview-card" style={{ '--card-color': type.cardColor, '--coat': type.coatColor }}>
      <div className="scratch-stage">
        <div className="scratch-face" style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` }}>
          {face.map((prize, index) => <div className="scratch-slot" key={index} title={prize ? `${prize.name} ×${prize.qty}` : '待揭晓'}>
            {prize ? <i style={{ color: prize.kind === 'coin' ? COIN.color : MATERIALS[prize.name]?.color }}>{prize.kind === 'coin' ? COIN.icon : MATERIALS[prize.name]?.icon || '✳'}</i> : <span className="scratch-slot-empty">?</span>}
          </div>)}
        </div>
      </div>
    </div>
  </div>
}

function TicketPreview({ type }) {
  const sample = Array.from({ length: type.pick }, (_, index) => type.min + index * 3).filter((n) => n <= type.max)
  const hitSet = new Set(sample.slice(0, 3))
  return <div className="preview-stage">
    <article className="numbered-ticket-card preview-card" style={{ '--card-color': type.cardColor, '--ticket-accent': type.accentColor }}>
      <div className="numbered-ticket-top"><div><strong>{type.name}</strong></div><span className="status-pill status-success">可领取</span></div>
      <div className="numbered-ticket-sub"><span>本期开奖</span><span>{type.min} — {type.max}</span></div>
      <div className="numbered-ticket-numbers">{sample.map((number) => <span key={number} className={hitSet.has(number) ? 'number-hit' : ''}>{number}</span>)}</div>
      <div className="numbered-ticket-result"><strong>3 <small>命中</small></strong><span>{(type.prizes?.[3] || []).map((reward) => `${reward.name}${reward.qty > 1 ? ` ×${reward.qty}` : ''}`).join('、') || '未中奖'}</span></div>
      <div className="numbered-ticket-foot"><span>{type.note}</span><Ticket size={14} /></div>
    </article>
  </div>
}

function ScratchAdmin({ config, patch }) {
  const update = (id, recipe) => patch((current) => ({ ...current, scratchTypes: current.scratchTypes.map((type) => type.id === id ? recipe(type) : type) }))
  const updatePrize = (typeId, index, recipe) => update(typeId, (type) => ({ ...type, prizes: type.prizes.map((prize, i) => i === index ? recipe(prize) : prize) }))
  const copyType = (type) => patch((current) => ({
    ...current,
    scratchTypes: [...current.scratchTypes, copyOf(type, { prizes: (type.prizes || []).map((prize) => ({ ...prize })) })],
  }))
  return <>
    <SectionHead title="刮刮乐奖池" count={`${config.scratchTypes.length} 种`} onAdd={() => patch((current) => addScratchType(current))} addLabel="新增刮刮乐" />
    <div className="admin-stack">
      {config.scratchTypes.map((type) => <section className="panel admin-card" key={type.id}>
        <div className="admin-card-head">
          <div className="admin-card-title"><span className="admin-swatch" style={{ background: type.coatColor }} /><strong>{type.name}</strong><small>{type.slots} 格</small></div>
          <div className="admin-card-actions">
            <CopyButton label={`复制 ${type.name}`} onClick={() => copyType(type)} />
            <DeleteButton label={`删除 ${type.name}`} onClick={() => patch((current) => ({ ...current, scratchTypes: current.scratchTypes.filter((item) => item.id !== type.id) }))} />
          </div>
        </div>
        <div className="admin-grid">
          <Field label="名称"><TextInput value={type.name} onChange={(value) => update(type.id, (item) => ({ ...item, name: value }))} /></Field>
          <Field label="涂层颜色"><ColorInput label="涂层颜色" value={type.coatColor} onChange={(value) => update(type.id, (item) => ({ ...item, coatColor: value }))} /></Field>
          <Field label="牌面格数" hint={`${SCRATCH_MIN_SLOTS} — ${SCRATCH_MAX_SLOTS} 格，每格独立抽奖`}><NumberInput value={type.slots} min={SCRATCH_MIN_SLOTS} max={SCRATCH_MAX_SLOTS} onChange={(value) => update(type.id, (item) => ({ ...item, slots: Math.min(SCRATCH_MAX_SLOTS, Math.max(SCRATCH_MIN_SLOTS, Math.round(value))) }))} /></Field>
          <Field label="备注"><TextInput value={type.note} onChange={(value) => update(type.id, (item) => ({ ...item, note: value }))} /></Field>
        </div>
        <div className="admin-subhead"><span>奖池</span><button className="text-button" onClick={() => update(type.id, (item) => ({ ...item, prizes: [...item.prizes, { id: `prize-${Date.now()}`, kind: 'material', name: MATERIAL_NAMES[0], qty: 1, weight: 1 }] }))}><CirclePlus size={14} /> 添加奖项</button></div>
        <div className="admin-table scratch-pool-table">
          <div className="admin-table-head"><span>奖励</span><span>数量</span><span>权重</span><span>所需相同</span><span>类型</span><span /></div>
          {type.prizes.map((prize, index) => <div className="admin-table-row" key={`${type.id}-${index}`}>
            <select className="admin-input" value={prize.name} aria-label="奖励" onChange={(event) => updatePrize(type.id, index, (item) => ({ ...item, name: event.target.value }))}>{prize.kind === 'coin' ? <option value={COIN.name}>{COIN.name}</option> : MATERIAL_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <NumberInput value={prize.qty} min={1} onChange={(value) => updatePrize(type.id, index, (item) => ({ ...item, qty: Math.max(1, value) }))} />
            <NumberInput value={prize.weight} min={1} onChange={(value) => updatePrize(type.id, index, (item) => ({ ...item, weight: Math.max(1, value) }))} />
            <NumberInput value={prize.need || 2} min={2} max={type.slots} onChange={(value) => updatePrize(type.id, index, (item) => ({ ...item, need: Math.min(type.slots, Math.max(2, Math.round(value))) }))} />
            <select className="admin-input" value={prize.kind || 'material'} aria-label="奖励类型" onChange={(event) => updatePrize(type.id, index, (item) => { const kind = event.target.value; return { ...item, kind, name: kind === 'coin' ? COIN.name : (MATERIAL_NAMES.includes(item.name) ? item.name : MATERIAL_NAMES[0]) } })}><option value="material">材料</option><option value="coin">鱼币</option></select>
            <DeleteButton label="删除奖项" onClick={() => update(type.id, (item) => ({ ...item, prizes: item.prizes.filter((_, i) => i !== index) }))} />
          </div>)}
        </div>
        <div className="admin-preview-block"><small>卡面预览</small><ScratchCardPreview type={type} /></div>
      </section>)}
    </div>
  </>
}

function LotteryAdmin({ config, patch }) {
  const update = (id, recipe) => patch((current) => ({ ...current, lotteryTypes: current.lotteryTypes.map((type) => type.id === id ? recipe(type) : type) }))
  const rodNames = config.rods.map((rod) => rod.name)
  const copyType = (type) => patch((current) => ({
    ...current,
    lotteryTypes: [...current.lotteryTypes, copyOf(type, {
      prizes: (type.prizes || []).map((tier) => (Array.isArray(tier) ? tier.map((reward) => ({ ...reward })) : tier)),
    })],
  }))
  const setTier = (type, hit, rewards) => {
    const prizes = Array.from({ length: type.pick + 1 }, (_, index) => type.prizes[index] || [])
    prizes[hit] = rewards
    return { ...type, prizes }
  }
  return <>
    <SectionHead title="开奖设置" count="往期号码" />
    <section className="panel admin-card">
      <div className="admin-grid">
        <Field label="展示期数" hint="彩票中心开奖面板显示最近几期"><NumberInput value={config.lotteryHistory ?? LOTTERY_HISTORY_DEFAULT} min={LOTTERY_HISTORY_MIN} max={LOTTERY_HISTORY_MAX} onChange={(value) => patch((current) => ({ ...current, lotteryHistory: Math.min(LOTTERY_HISTORY_MAX, Math.max(LOTTERY_HISTORY_MIN, Math.round(value))) }))} /></Field>
      </div>
    </section>
    <SectionHead title="彩票奖池" count={`${config.lotteryTypes.length} 种`} onAdd={() => patch((current) => addLotteryType(current))} addLabel="新增彩票" />
    <div className="admin-stack">
      {config.lotteryTypes.map((type) => <section className="panel admin-card" key={type.id}>
        <div className="admin-card-head">
          <div className="admin-card-title"><span className="admin-swatch" style={{ background: type.accentColor }} /><strong>{type.name}</strong><small>{type.min} — {type.max} · {type.pick}</small></div>
          <div className="admin-card-actions">
            <CopyButton label={`复制 ${type.name}`} onClick={() => copyType(type)} />
            <DeleteButton label={`删除 ${type.name}`} onClick={() => patch((current) => ({ ...current, lotteryTypes: current.lotteryTypes.filter((item) => item.id !== type.id) }))} />
          </div>
        </div>
        <div className="admin-grid">
          <Field label="名称"><TextInput value={type.name} onChange={(value) => update(type.id, (item) => ({ ...item, name: value }))} /></Field>
          <Field label="号码下限"><NumberInput value={type.min} min={0} max={198} onChange={(value) => update(type.id, (item) => ({ ...item, min: Math.min(value, item.max - 1) }))} /></Field>
          <Field label="号码上限"><NumberInput value={type.max} min={1} max={199} onChange={(value) => update(type.id, (item) => ({ ...item, max: Math.max(value, item.min + 1) }))} /></Field>
          <Field label="抽取个数"><NumberInput value={type.pick} min={1} max={10} onChange={(value) => update(type.id, (item) => ({ ...item, pick: Math.min(10, Math.max(1, value)), prizes: Array.from({ length: Math.min(10, Math.max(1, value)) + 1 }, (_, i) => item.prizes[i] || []) }))} /></Field>
          <Field label="号码颜色"><ColorInput label="号码颜色" value={type.accentColor} onChange={(value) => update(type.id, (item) => ({ ...item, accentColor: value }))} /></Field>
          <Field label="备注"><TextInput value={type.note} onChange={(value) => update(type.id, (item) => ({ ...item, note: value }))} /></Field>
        </div>
        <div className="admin-subhead"><span>命中奖励</span><small>命中 0 — {type.pick} 个号码</small></div>
        <div className="admin-tier-list">
          {Array.from({ length: type.pick + 1 }, (_, hit) => {
            const rewards = type.prizes[hit] || []
            return <div className="admin-tier" key={hit}>
              <span className="admin-tier-hit">{hit}<small>命中</small></span>
              <div className="admin-tier-rewards">
                {rewards.map((reward, index) => <div className="admin-tier-reward" key={`${hit}-${index}`}>
                  <select className="admin-input" value={reward.type} aria-label="奖励类型" onChange={(event) => { const nextType = event.target.value; update(type.id, (item) => setTier(item, hit, rewards.map((entry, i) => i === index ? { ...entry, type: nextType, name: nextType === 'rod' ? rodNames[0] : nextType === 'coin' ? '鱼币' : MATERIAL_NAMES[0] } : entry))) }}><option value="material">材料</option><option value="rod">钓竿</option><option value="coin">鱼币</option></select>
                  {reward.type === 'coin' ? <span className="admin-coin-fixed"><Coins size={13} /> 鱼币</span> : <select className="admin-input" value={reward.name} aria-label="奖励名称" onChange={(event) => update(type.id, (item) => setTier(item, hit, rewards.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry)))}>{(reward.type === 'rod' ? rodNames : MATERIAL_NAMES).map((name) => <option key={name} value={name}>{name}</option>)}</select>}
                  <NumberInput value={reward.qty} min={1} onChange={(value) => update(type.id, (item) => setTier(item, hit, rewards.map((entry, i) => i === index ? { ...entry, qty: Math.max(1, value) } : entry)))} />
                  <DeleteButton label="删除奖励" onClick={() => update(type.id, (item) => setTier(item, hit, rewards.filter((_, i) => i !== index)))} />
                </div>)}
                <button className="text-button" onClick={() => update(type.id, (item) => setTier(item, hit, [...rewards, { type: 'material', name: MATERIAL_NAMES[0], qty: 1 }]))}><CirclePlus size={13} /> 奖励</button>
              </div>
            </div>
          })}
        </div>
        <div className="admin-subhead"><span>命中概率</span><small>共 {type.max - type.min + 1} 个号码 · 抽 {type.pick} 个</small></div>
        <div className="hit-prob-grid">
          {hitDistribution(type).map(({ hit, chance }) => <div className="hit-prob-cell" key={hit}><span>{hit} 命中</span><b>{(chance * 100).toFixed(6)}%</b><i><em style={{ width: `${Math.min(100, chance * 100)}%` }} /></i></div>)}
        </div>
        <div className="admin-preview-block"><small>卡面预览</small><TicketPreview type={type} /></div>
      </section>)}
    </div>
  </>
}

// 横向对比表里可以直接改的钓竿字段（张力和基础项分两段渲染）。
const ROD_COMPARE_FIELDS = [
  { key: 'energyPerCatch', label: '单次能量', min: 100, step: 100 },
  { key: 'energyPerSecond', label: '速度/秒', min: 1, step: 1 },
  { key: 'maxDurability', label: '最大耐久', min: 1, step: 1 },
  { key: 'resistance', label: '抗损耗 %', min: 0, max: 95, step: 1, percent: true },
]

function RodAdmin({ config, patch }) {
  const update = (id, recipe) => patch((current) => ({ ...current, rods: current.rods.map((rod) => rod.id === id ? recipe(rod) : rod) }))
  const updateUpgrade = (rodId, index, recipe) => update(rodId, (rod) => ({ ...rod, upgrades: rod.upgrades.map((item, i) => i === index ? recipe(item) : item) }))
  const setTension = (rodId, key, value) => update(rodId, (rod) => ({ ...rod, tension: { ...rod.tension, [key]: value } }))
  // 默认全部展开；点标题收起，方便在长列表里来回对照。
  const [collapsed, setCollapsed] = useState(() => new Set())
  const toggle = (id) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return <>
    <SectionHead title="钓竿配置" count={`${config.rods.length} 把`} onAdd={() => patch((current) => addRod(current))} addLabel="新增钓竿" />
    <div className="admin-stack">
      {config.rods.map((rod) => <section className="panel admin-card" key={rod.id}>
        <div className="admin-card-head">
          <button type="button" className="rod-card-toggle" aria-expanded={!collapsed.has(rod.id)} onClick={() => toggle(rod.id)}>
            <ChevronDown size={15} className={cn('rod-card-chevron', collapsed.has(rod.id) && 'is-collapsed')} />
            <span className="admin-swatch" style={{ background: rod.color }} />
            <strong>{rod.name}</strong>
            <small>{rod.rarity} · 最远 {DEPTHS[rod.maxDepth]?.label}</small>
          </button>
          <DeleteButton label={`删除 ${rod.name}`} onClick={() => patch((current) => ({ ...current, rods: current.rods.filter((item) => item.id !== rod.id) }))} />
        </div>
        {!collapsed.has(rod.id) && <>
        <div className="admin-grid">
          <Field label="名称"><TextInput value={rod.name} onChange={(value) => update(rod.id, (item) => ({ ...item, name: value }))} /></Field>
          <Field label="稀有度"><TextInput value={rod.rarity} onChange={(value) => update(rod.id, (item) => ({ ...item, rarity: value }))} /></Field>
          <Field label="主色"><ColorInput label="主色" value={rod.color} onChange={(value) => update(rod.id, (item) => ({ ...item, color: value }))} /></Field>
          <Field label="单次所需能量" hint="进度条充满所需能量"><NumberInput value={rod.energyPerCatch} min={100} step={100} onChange={(value) => update(rod.id, (item) => ({ ...item, energyPerCatch: Math.max(100, value) }))} /></Field>
          <Field label="最大耐久"><NumberInput value={rod.maxDurability} min={1} onChange={(value) => update(rod.id, (item) => ({ ...item, maxDurability: Math.max(1, value) }))} /></Field>
          <Field label="抗损耗" hint="0 — 95%"><NumberInput value={Math.round(rod.resistance * 100)} min={0} max={95} onChange={(value) => update(rod.id, (item) => ({ ...item, resistance: Math.min(0.95, Math.max(0, value / 100)) }))} /></Field>
          <Field label="初始速度" hint="能量/秒"><NumberInput value={rod.energyPerSecond} min={1} onChange={(value) => update(rod.id, (item) => ({ ...item, energyPerSecond: Math.max(1, value) }))} /></Field>
          <Field label="最高海域"><select className="admin-input" value={rod.maxDepth} onChange={(event) => update(rod.id, (item) => ({ ...item, maxDepth: Number(event.target.value) }))}>{DEPTHS.map((depth, index) => <option key={depth.id} value={index}>{depth.label}</option>)}</select></Field>
          <Field label="会损坏"><select className="admin-input" value={rod.breakable ? 'yes' : 'no'} onChange={(event) => update(rod.id, (item) => ({ ...item, breakable: event.target.value === 'yes' }))}><option value="yes">是</option><option value="no">否</option></select></Field>
        </div>

        <div className="admin-subhead"><span>张力参数</span><small>每把钓竿独立</small></div>
        <div className="admin-grid admin-grid-tight">
          {TENSION_FIELDS.map((field) => <Field key={field.key} label={field.label} hint={field.hint}>
            <NumberInput value={rod.tension?.[field.key] ?? 0} min={field.min} step={field.step} onChange={(value) => setTension(rod.id, field.key, Math.max(field.min, value))} />
          </Field>)}
        </div>

        <div className="admin-subhead"><span>修补材料</span></div>
        <div className="admin-grid admin-grid-tight">
          <Field label="材料"><select className="admin-input" value={rod.repair?.material || MATERIAL_NAMES[0]} onChange={(event) => update(rod.id, (item) => ({ ...item, repair: { ...item.repair, material: event.target.value } }))}>{MATERIAL_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}</select></Field>
          <Field label="消耗数量"><NumberInput value={rod.repair?.cost || 1} min={1} onChange={(value) => update(rod.id, (item) => ({ ...item, repair: { ...item.repair, cost: Math.max(1, value) } }))} /></Field>
          <Field label="恢复耐久"><NumberInput value={rod.repair?.amount || 50} min={1} onChange={(value) => update(rod.id, (item) => ({ ...item, repair: { ...item.repair, amount: Math.max(1, value) } }))} /></Field>
        </div>

        <div className="admin-subhead"><span>可用升级</span><button className="text-button" onClick={() => update(rod.id, (item) => ({ ...item, upgrades: [...item.upgrades, { id: `upgrade-${Date.now()}`, label: '钓鱼速度', stat: 'energyPerSecond', amount: 1, coins: 50, growth: 1, material: MATERIAL_NAMES[0], cost: 1, maxLevel: 99 }] }))}><CirclePlus size={14} /> 添加升级</button></div>
        {rod.upgrades.length ? <div className="admin-upgrade-list">{rod.upgrades.map((upgrade, index) => <div className="admin-upgrade" key={upgrade.id}>
          <div className="admin-grid admin-grid-tight">
            <Field label="名称"><TextInput value={upgrade.label} onChange={(value) => updateUpgrade(rod.id, index, (item) => ({ ...item, label: value }))} /></Field>
            <Field label="提升属性"><select className="admin-input" value={upgrade.stat} onChange={(event) => updateUpgrade(rod.id, index, (item) => ({ ...item, stat: event.target.value }))}><option value="energyPerSecond">钓鱼速度</option><option value="maxDurability">最大耐久</option><option value="resistance">抗损耗</option><option value="maxTension">最大张力</option></select></Field>
            <Field label="每次提升"><NumberInput value={upgrade.amount} min={1} step={upgrade.stat === 'resistance' ? 0.01 : 1} onChange={(value) => updateUpgrade(rod.id, index, (item) => ({ ...item, amount: Math.max(0.01, value) }))} /></Field>
            <Field label="等级上限"><NumberInput value={upgrade.maxLevel || 99} min={1} onChange={(value) => updateUpgrade(rod.id, index, (item) => ({ ...item, maxLevel: Math.max(1, value) }))} /></Field>
            <Field label="基础鱼币"><NumberInput value={upgrade.coins || 0} min={0} step={10} onChange={(value) => updateUpgrade(rod.id, index, (item) => ({ ...item, coins: Math.max(0, value) }))} /></Field>
            <Field label="每级递增" hint="1 = 每级 +1 倍基础价"><NumberInput value={upgrade.growth ?? 1} min={0} step={0.1} onChange={(value) => updateUpgrade(rod.id, index, (item) => ({ ...item, growth: Math.max(0, value) }))} /></Field>
            <Field label="材料"><select className="admin-input" value={upgrade.material} onChange={(event) => updateUpgrade(rod.id, index, (item) => ({ ...item, material: event.target.value }))}>{MATERIAL_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}</select></Field>
            <Field label="消耗"><NumberInput value={upgrade.cost} min={1} onChange={(value) => updateUpgrade(rod.id, index, (item) => ({ ...item, cost: Math.max(1, value) }))} /></Field>
            <Field label="副材料"><select className="admin-input" value={upgrade.secondMaterial || ''} onChange={(event) => updateUpgrade(rod.id, index, (item) => ({ ...item, secondMaterial: event.target.value || undefined }))}><option value="">无</option>{MATERIAL_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}</select></Field>
            <Field label="副消耗"><NumberInput value={upgrade.secondCost || 1} min={1} onChange={(value) => updateUpgrade(rod.id, index, (item) => ({ ...item, secondCost: Math.max(1, value) }))} /></Field>
          </div>
          <DeleteButton label="删除升级" onClick={() => update(rod.id, (item) => ({ ...item, upgrades: item.upgrades.filter((_, i) => i !== index) }))} />
        </div>)}</div> : <p className="admin-empty-line">暂无升级</p>}
        </>}
      </section>)}
    </div>

    <SectionHead title="钓竿横向对比" count={`${config.rods.length} 把`} />
    <section className="panel admin-card">
      <div className="rod-compare-scroll">
        <table className="rod-compare">
          <thead>
            <tr>
              <th>名称</th><th>稀有度</th><th>最高海域</th>
              {ROD_COMPARE_FIELDS.map((field) => <th key={field.key}>{field.label}</th>)}
              <th>会损坏</th>
              {TENSION_FIELDS.map((field) => <th key={field.key}>{field.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {config.rods.map((rod) => <tr key={rod.id}>
              <td><TextInput value={rod.name} onChange={(value) => update(rod.id, (item) => ({ ...item, name: value }))} /></td>
              <td><TextInput value={rod.rarity} onChange={(value) => update(rod.id, (item) => ({ ...item, rarity: value }))} /></td>
              <td><select className="admin-input" value={rod.maxDepth} aria-label={`${rod.name} 最高海域`} onChange={(event) => update(rod.id, (item) => ({ ...item, maxDepth: Number(event.target.value) }))}>{DEPTHS.map((depth, index) => <option key={depth.id} value={index}>{depth.label}</option>)}</select></td>
              {ROD_COMPARE_FIELDS.map((field) => <td key={field.key}>
                <NumberInput
                  value={field.percent ? Math.round(rod.resistance * 100) : rod[field.key]}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  onChange={(value) => update(rod.id, (item) => (field.percent
                    ? { ...item, resistance: Math.min(0.95, Math.max(0, value / 100)) }
                    : { ...item, [field.key]: Math.max(field.min, value) }))}
                />
              </td>)}
              <td><select className="admin-input" value={rod.breakable ? 'yes' : 'no'} aria-label={`${rod.name} 会损坏`} onChange={(event) => update(rod.id, (item) => ({ ...item, breakable: event.target.value === 'yes' }))}><option value="yes">是</option><option value="no">否</option></select></td>
              {TENSION_FIELDS.map((field) => <td key={field.key}>
                <NumberInput value={rod.tension?.[field.key] ?? 0} min={field.min} step={field.step} onChange={(value) => setTension(rod.id, field.key, Math.max(field.min, value))} />
              </td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </>
}

// 轨道的 kind 决定它在游戏里怎么生效；起始值/每级变化都按轨道单独配置。
const TRACK_KINDS = [
  { id: 'threshold', label: '维修阈值', base: 0, amount: 10, maxLevel: 8 },
  { id: 'restore', label: '维修恢复', base: 0.9, amount: 0.01, maxLevel: 20 },
  { id: 'scrapeThreshold', label: '刮开阈值', base: 0.45, amount: -0.01, maxLevel: 20 },
  { id: 'scrapeRadius', label: '刮除范围', base: 17, amount: 0.4, maxLevel: 20 },
  { id: 'combo', label: '组合溢价', base: 0, amount: 0.03, maxLevel: 10 },
  { id: 'progressBoost', label: '助推幅度', base: 0.01, amount: 0.001, maxLevel: 20 },
  { id: 'progressBoostReach', label: '加速判定范围', base: 22, amount: 0.22, maxLevel: 20 },
  { id: 'warehouse', label: '仓库容量', base: 1000, amount: 100, maxLevel: 90 },
]

const trackKindLabel = (kind) => TRACK_KINDS.find((item) => item.id === kind)?.label || kind


const TRAIT_MODES = [
  { id: 'add', label: '加法' },
  { id: 'multiply', label: '乘法' },
]

function TraitAdmin({ config, patch }) {
  const traits = config.traits
  const updateTrait = (id, recipe) => patch((current) => ({ ...current, traits: current.traits.map((trait) => trait.id === id ? recipe(trait) : trait) }))
  const updateEffect = (traitId, index, recipe) => updateTrait(traitId, (trait) => ({ ...trait, effects: trait.effects.map((effect, i) => i === index ? recipe(effect) : effect) }))
  const addTrait = () => patch((current) => {
    const next = normalizeTrait({ id: `trait-${Date.now()}`, label: `新词条 ${current.traits.length + 1}`, icon: '✦', color: '#65758b', biteChance: 1.2, effects: [{ type: 'loss', mode: 'add', value: 2 }] }, current.traits.length)
    return { ...current, traits: [...current.traits, next] }
  })
  return <>
    <SectionHead title="词条效果" count={`${traits.length} 个词条`} onAdd={addTrait} addLabel="新增词条" />
    <div className="admin-stack">
      {traits.map((trait) => <section className="panel admin-card" key={trait.id}>
        <div className="admin-card-head">
          <div className="admin-card-title"><span className="admin-swatch" style={{ background: trait.color }} /><strong>{trait.label}</strong><small>×{trait.biteChance} · {trait.effects.length} 条效果</small></div>
          <DeleteButton label={`删除 ${trait.label}`} onClick={() => patch((current) => ({ ...current, traits: current.traits.filter((item) => item.id !== trait.id) }))} />
        </div>
        <div className="admin-grid">
          <Field label="名称"><TextInput value={trait.label} onChange={(value) => updateTrait(trait.id, (item) => ({ ...item, label: value }))} /></Field>
          <Field label="图标"><TextInput value={trait.icon} onChange={(value) => updateTrait(trait.id, (item) => ({ ...item, icon: value }))} /></Field>
          <Field label="颜色"><ColorInput label="词条颜色" value={trait.color} onChange={(value) => updateTrait(trait.id, (item) => ({ ...item, color: value }))} /></Field>
          <Field label="咬钩几率" hint="组合权重 = 各词条相乘"><NumberInput value={trait.biteChance} min={0.05} max={10} step={0.05} onChange={(value) => updateTrait(trait.id, (item) => ({ ...item, biteChance: Math.min(10, Math.max(0.05, value)) }))} /></Field>
        </div>
        <div className="admin-subhead"><span>实际效果</span><button className="text-button" onClick={() => updateTrait(trait.id, (item) => ({ ...item, effects: [...item.effects, { type: 'loss', mode: 'add', value: 1 }] }))}><CirclePlus size={14} /> 添加效果</button></div>
        {trait.effects.length ? <div className="admin-table trait-effect-table">
          <div className="admin-table-head"><span>效果</span><span>方式</span><span>数值</span><span /></div>
          {trait.effects.map((effect, index) => {
            const meta = TRAIT_EFFECT_TYPES.find((type) => type.id === effect.type)
            const lockedMode = Boolean(meta?.mode)
            const min = effect.type === 'sawLoss' ? 0 : effect.mode === 'multiply' ? 0.01 : -100
            const step = effect.type === 'sawThreshold' ? 0.01 : effect.type === 'sawLoss' ? 0.1 : effect.mode === 'multiply' ? 0.05 : 1
            return <div className="admin-table-row trait-effect-row" key={`${trait.id}-${index}`}>
              <select className="admin-input" value={effect.type} aria-label="效果类型" onChange={(event) => {
                const nextId = event.target.value
                const nextMeta = TRAIT_EFFECT_TYPES.find((type) => type.id === nextId)
                const nextMode = nextMeta?.mode || 'add'
                const nextValue = nextId === 'sawLoss' ? 1.5 : nextId === 'sawThreshold' ? -0.05 : effect.value
                updateEffect(trait.id, index, (item) => ({ ...item, type: nextId, mode: nextMode, value: nextValue }))
              }}>{TRAIT_EFFECT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select>
              <select className="admin-input" value={effect.mode} aria-label="效果方式" disabled={lockedMode} onChange={(event) => updateEffect(trait.id, index, (item) => ({ ...item, mode: event.target.value }))}>{TRAIT_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select>
              <NumberInput value={effect.value} min={min} step={step} onChange={(value) => updateEffect(trait.id, index, (item) => ({ ...item, value }))} />
              <DeleteButton label="删除效果" onClick={() => updateTrait(trait.id, (item) => ({ ...item, effects: item.effects.filter((_, i) => i !== index) }))} />
            </div>
          })}
        </div> : <p className="admin-empty-line">暂无效果</p>}
        <div className="admin-preview-row"><small>效果预览</small><span className="trait-effect-preview" style={{ '--trait-color': trait.color }}>{trait.icon} {trait.label}<b>{trait.effects.length ? trait.effects.map(effectSummary).filter(Boolean).join(' · ') : '无效果'}</b></span></div>
      </section>)}
    </div>
  </>
}

function DepthAdmin({ config, patch }) {
  const [openDepth, setOpenDepth] = useState(DEPTHS[0].id)
  const setWeight = (depthId, traitId, value) => patch((current) => ({
    ...current,
    depthTraitWeights: {
      ...current.depthTraitWeights,
      [depthId]: { ...(current.depthTraitWeights?.[depthId] || {}), [traitId]: Math.max(0, Math.round(value)) },
    },
  }))
  // 快捷禁用：直接在 0 与 1 之间切换，禁用后该词条不再出现在这个海域。
  const toggleTrait = (depthId, traitId) => setWeight(depthId, traitId, (config.depthTraitWeights?.[depthId]?.[traitId] ?? 1) > 0 ? 0 : 1)
  const setUnlock = (depthId, recipe) => patch((current) => {
    const base = current.depthUnlocks?.[depthId] || DEPTHS.find((item) => item.id === depthId)?.unlock || { material: MATERIAL_NAMES[0], cost: 1, coins: 0 }
    return { ...current, depthUnlocks: { ...(current.depthUnlocks || {}), [depthId]: recipe(base) } }
  })
  const depth = DEPTHS.find((item) => item.id === openDepth) || DEPTHS[0]
  const weights = config.depthTraitWeights?.[depth.id] || {}
  const [minCount, maxCount] = depth.traitCount
  const table = combinationBiteTable({ traits: config.traits, weights, minCount, maxCount })
  const totalWeight = config.traits.reduce((sum, trait) => sum + (weights[trait.id] ?? 1), 0)
  return <>
    <SectionHead title="海域词条权重" count={`${DEPTHS.length} 个海域`} />
    <section className="panel admin-card">
      <div className="admin-card-head"><div className="admin-card-title"><strong>海域解锁</strong></div></div>
      <div className="admin-table">
        <div className="admin-table-head depth-unlock-head"><span>海域</span><span>材料</span><span>数量</span><span>鱼币</span></div>
        {DEPTHS.map((item) => {
          const unlock = config.depthUnlocks?.[item.id] ?? item.unlock
          const free = !unlock
          return <div className="admin-table-row depth-unlock-row" key={item.id}>
            <span className="depth-unlock-name"><b style={{ color: item.color }}>{item.icon}</b> {item.label}</span>
            {free ? <span className="admin-empty-line">默认开放</span> : <>
              <select className="admin-input" value={unlock.material} aria-label={`${item.label} 解锁材料`} onChange={(event) => setUnlock(item.id, (entry) => ({ ...entry, material: event.target.value }))}>{MATERIAL_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}</select>
              <NumberInput value={unlock.cost} min={0} onChange={(value) => setUnlock(item.id, (entry) => ({ ...entry, cost: Math.max(0, value) }))} />
              <NumberInput value={unlock.coins} min={0} step={10} onChange={(value) => setUnlock(item.id, (entry) => ({ ...entry, coins: Math.max(0, value) }))} />
            </>}
          </div>
        })}
      </div>
    </section>
    <div className="admin-tabs admin-tabs-inline" role="tablist">{DEPTHS.map((item) => <button key={item.id} role="tab" aria-selected={depth.id === item.id} className={cn('admin-tab', depth.id === item.id && 'admin-tab-active')} onClick={() => setOpenDepth(item.id)}><span style={{ color: item.color }}>{item.icon}</span> {item.label}</button>)}</div>
    <section className="panel admin-card">
      <div className="admin-card-head">
        <div className="admin-card-title"><span className="admin-swatch" style={{ background: depth.color }} /><strong>{depth.icon} {depth.label}</strong><small>{depth.riskLabel} · {minCount}–{maxCount} · {totalWeight}</small></div>
      </div>
      <div className="depth-weight-grid">
        {config.traits.map((trait) => {
          const value = weights[trait.id] ?? 1
          const off = value <= 0
          return <div className={cn('depth-weight-row', off && 'is-off')} key={trait.id} style={{ '--trait-color': trait.color }}>
            <button className={cn('trait-toggle', !off && 'is-on')} onClick={() => toggleTrait(depth.id, trait.id)} aria-pressed={!off} title={off ? '启用该词条' : '禁用该词条'} aria-label={`${depth.label} ${trait.label} ${off ? '已禁用，点击启用' : '已启用，点击禁用'}`}><span>{trait.icon} {trait.label}</span><i /></button>
            <input className="admin-input depth-weight-input" type="number" min="0" step="1" value={value} disabled={off} aria-label={`${depth.label} ${trait.label} 权重`} onChange={(event) => setWeight(depth.id, trait.id, Number(event.target.value) || 0)} />
            <span className={cn('depth-weight-bar', off && 'is-off')}><i style={{ width: `${Math.min(100, totalWeight > 0 ? (value / totalWeight) * 100 : 0)}%`, background: trait.color }} /></span>
          </div>
        })}
      </div>
    </section>

    <SectionHead title="组合咬钩概率" count={`${table.length} 种组合`} />
    <section className="panel admin-card">
      <div className="combo-prob-head"><span>词条组合</span><span>出现概率</span><span>咬钩权重</span><span>池内占比</span></div>
      <div className="combo-prob-list">
        {table.map((row) => <div className="combo-prob-row" key={row.ids.join('+')}>
          <span className="combo-prob-traits">{row.traits.map((trait) => <b key={trait.id} style={{ color: trait.color }}>{trait.icon} {trait.label}</b>)}</span>
          <span>{(row.drawChance * 100).toFixed(2)}%</span>
          <span>×{Math.round(row.weight * 1000) / 1000}</span>
          <span className="combo-prob-share"><span className="combo-share-track"><i style={{ width: `${Math.min(100, row.biteShare * 100)}%` }} /></span><b>{(row.biteShare * 100).toFixed(2)}%</b></span>
        </div>)}
        {!table.length && <p className="admin-empty-line">该海域没有可用组合</p>}
      </div>
    </section>
  </>
}

function MerchantAdmin({ config, patch }) {
  const update = (recipe) => patch((current) => ({ ...current, quotes: recipe(current.quotes) }))
  const scratchOptions = config.scratchTypes
  const traitDefs = config.traits
  const maxTrait = Math.max(...traitDefs.map((trait) => config.quotes.traitQuotes[trait.id] || 0), 1)
  const maxCombo = Math.max(...config.quotes.combos.map((combo) => combo.price || 0), 1)

  const addCombo = () => update((quotes) => ({ ...quotes, combos: [...quotes.combos, { id: `combo-${Date.now()}`, name: `组合 ${quotes.combos.length + 1}`, traits: [], price: 10 }] }))
  const updateCombo = (id, recipe) => update((quotes) => ({ ...quotes, combos: quotes.combos.map((combo) => combo.id === id ? recipe(combo) : combo) }))
  const addTier = () => update((quotes) => {
    const last = [...quotes.tiers].sort((a, b) => a.min - b.min).at(-1)
    const min = last ? (last.max === null ? last.min + 20 : last.max + 1) : 0
    return { ...quotes, tiers: [...quotes.tiers, { id: `tier-${Date.now()}`, min, max: min + 19, tickets: { qty: 1 }, scratch: { typeId: scratchOptions[0]?.id, qty: 1 } }] }
  })
  const updateTier = (id, recipe) => update((quotes) => ({ ...quotes, tiers: quotes.tiers.map((tier) => tier.id === id ? recipe(tier) : tier) }))

  return <>
    <div className="admin-sync"><BarChart3 size={15} /><span>草稿模式 · 保存后生效</span><b>{config.quotes.combos.length} 组组合</b><b>{scratchOptions.length} 种刮刮乐</b></div>

    <SectionHead title="单条词条报价" count={`${traitDefs.length} 条词条`} />
    <section className="panel admin-card">
      <div className="admin-chart-head"><h2>词条单价</h2><span>鱼每带一条词条，就累加对应价格</span></div>
      <div className="trait-bars">
        {traitDefs.map((trait) => { const value = config.quotes.traitQuotes[trait.id] || 0; return <div className="trait-bar-row" key={trait.id}>
          <span className="trait-bar-label" style={{ color: trait.color }}>{trait.icon} {trait.label}</span>
          <div className="trait-bar-track"><i style={{ width: `${Math.max(3, (value / maxTrait) * 100)}%`, background: trait.color }} /></div>
          <input className="admin-input trait-bar-input" type="number" min="0" step="1" value={value} aria-label={`${trait.label} 单价`} onChange={(event) => update((quotes) => ({ ...quotes, traitQuotes: { ...quotes.traitQuotes, [trait.id]: Math.max(0, Number(event.target.value) || 0) } }))} />
        </div> })}
      </div>
    </section>

    <SectionHead title="组合词条报价" count={`${config.quotes.combos.length} 组`} onAdd={addCombo} addLabel="新增组合" />
    <div className="admin-stack">
      {config.quotes.combos.map((combo) => <section className="panel admin-card" key={combo.id}>
        <div className="admin-card-head">
          <div className="admin-card-title"><span className="admin-swatch" style={{ background: '#7d5ca8' }} /><strong>{combo.name}</strong><small>附加 +{combo.price}</small></div>
          <DeleteButton label={`删除 ${combo.name}`} onClick={() => update((quotes) => ({ ...quotes, combos: quotes.combos.filter((item) => item.id !== combo.id) }))} />
        </div>
        <div className="admin-grid admin-grid-tight">
          <Field label="组合名称"><TextInput value={combo.name} onChange={(value) => updateCombo(combo.id, (item) => ({ ...item, name: value }))} /></Field>
          <Field label="附加价格" hint="在单条词条价之上叠加"><NumberInput value={combo.price} min={0} onChange={(value) => updateCombo(combo.id, (item) => ({ ...item, price: Math.max(0, value) }))} /></Field>
        </div>
        <div className="admin-subhead"><span>组合词条</span><small>全部命中才叠加</small></div>
        <div className="admin-trait-picks">{traitDefs.map((trait) => { const active = combo.traits.includes(trait.id); return <button key={trait.id} className={cn('admin-trait-pick', active && 'is-active')} style={{ '--trait-color': trait.color }} onClick={() => updateCombo(combo.id, (item) => ({ ...item, traits: active ? item.traits.filter((id) => id !== trait.id) : [...item.traits, trait.id] }))}>{trait.icon} {trait.label}</button> })}</div>
      </section>)}
      {!config.quotes.combos.length && <p className="admin-empty-line">暂无组合</p>}
    </div>

    <SectionHead title="总价奖励档" count={`${config.quotes.tiers.length} 档`} onAdd={addTier} addLabel="新增档位" />
    <div className="admin-stack">
      {[...config.quotes.tiers].sort((a, b) => a.min - b.min).map((tier) => <section className="panel admin-card" key={tier.id}>
        <div className="admin-card-head">
          <div className="admin-card-title"><span className="admin-swatch" style={{ background: '#247b82' }} /><strong>{tier.max === null ? `${tier.min} 以上` : `${tier.min} — ${tier.max}`}</strong><small>总价区间</small></div>
          <DeleteButton label="删除档位" onClick={() => update((quotes) => ({ ...quotes, tiers: quotes.tiers.filter((item) => item.id !== tier.id) }))} />
        </div>
        <div className="admin-grid admin-grid-tight">
          <Field label="总价下限"><NumberInput value={tier.min} min={0} onChange={(value) => updateTier(tier.id, (item) => ({ ...item, min: Math.max(0, value) }))} /></Field>
          <Field label="总价上限" hint="留空表示无上限"><input className="admin-input" type="number" min="0" placeholder="无上限" value={tier.max ?? ''} onChange={(event) => updateTier(tier.id, (item) => ({ ...item, max: event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0) }))} /></Field>
          <Field label="空白彩票"><NumberInput value={tier.tickets.qty} min={0} onChange={(value) => updateTier(tier.id, (item) => ({ ...item, tickets: { qty: Math.max(0, value) } }))} /></Field>
          <Field label="刮刮乐奖励"><select className="admin-input" value={tier.scratch.typeId} onChange={(event) => updateTier(tier.id, (item) => ({ ...item, scratch: { ...item.scratch, typeId: event.target.value } }))}>{scratchOptions.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
          <Field label="刮刮乐数量"><NumberInput value={tier.scratch.qty} min={0} onChange={(value) => updateTier(tier.id, (item) => ({ ...item, scratch: { ...item.scratch, qty: Math.max(0, value) } }))} /></Field>
        </div>
      </section>)}
    </div>

    <MerchantChart config={config} maxTrait={maxTrait} maxCombo={maxCombo} />
  </>
}

const combinations = (list) => {
  const result = []
  const walk = (start, acc) => {
    if (acc.length) result.push(acc)
    for (let i = start; i < list.length; i += 1) walk(i + 1, [...acc, list[i]])
  }
  walk(0, [])
  return result
}

// 逐个解锁：只暴露「开关、每一步的阈值与文案、赠币额度、关闭延迟」。
// 步骤顺序与增删固定在代码里（GUIDE_STEP_IDS），后台调阈值不会让玩家跳级。
function GuideAdmin({ config, patch }) {
  const guide = config.guide || {}
  const steps = guide.steps || []
  const copy = guide.copy || {}
  const update = (recipe) => patch((current) => ({ ...current, guide: recipe(current.guide || {}) }))
  const setStep = (id, key, value) => update((cur) => ({ ...cur, steps: (cur.steps || []).map((step) => step.id === id ? { ...step, [key]: value } : step) }))
  const setCopy = (key, value) => update((cur) => ({ ...cur, copy: { ...(cur.copy || {}), [key]: value } }))
  const unlocked = steps.filter((step) => GUIDE_STEP_IDS.includes(step.id))
  return <>
    <div className="admin-sync"><Flag size={15} /><span>逐个解锁 · 只锁左侧页签</span><b>{guide.enabled === false ? '已全开' : `${unlocked.length} 步`}</b></div>
    <SectionHead title="总开关" count={guide.enabled === false ? '关：所有功能直接可用' : '开：按进度逐个解锁'} />
    <section className="panel admin-card">
      <div className="admin-grid admin-grid-tight">
        <Field label="启用逐个解锁" hint="关闭后等价于全部解锁，退回旧行为">
          <select className="admin-input" value={guide.enabled === false ? '0' : '1'} onChange={(event) => update((cur) => ({ ...cur, enabled: event.target.value === '1' }))}>
            <option value="1">启用</option>
            <option value="0">关闭（全开）</option>
          </select>
        </Field>
        <Field label="说明卡最少停留 (ms)" hint="倒计时结束前玩家关不掉介绍卡；默认 3000">
          <NumberInput value={guide.minCloseMs ?? 3000} min={0} max={20000} step={500} onChange={(value) => update((cur) => ({ ...cur, minCloseMs: Number(value) }))} />
        </Field>
      </div>
    </section>
    <SectionHead title="每一步的门槛与赠礼" count="按顺序逐个解锁，遇到第一个没满足的就停下" />
    {unlocked.map((step, index) => <section className="panel admin-card" key={step.id}>
      <div className="panel-topline"><div><h2>{index + 1}. {step.id}</h2></div><span className="draw-pool">{step.requires?.length ? `需要先完成 ${step.requires.join(' + ')}` : '无前置'}</span></div>
      <div className="admin-grid admin-grid-tight">
        <Field label="累计上钩" hint="stats.totalCatches ≥"><NumberInput value={step.minCatches || 0} onChange={(value) => setStep(step.id, 'minCatches', Number(value))} /></Field>
        <Field label="累计卖鱼" hint="stats.totalExchanged ≥"><NumberInput value={step.minSold || 0} onChange={(value) => setStep(step.id, 'minSold', Number(value))} /></Field>
        <Field label="累计获得刮刮乐" hint="totalScratchEarned ≥"><NumberInput value={step.minScratchEarned || 0} onChange={(value) => setStep(step.id, 'minScratchEarned', Number(value))} /></Field>
        <Field label="累计获得彩票" hint="totalTicketsEarned ≥"><NumberInput value={step.minTicketsEarned || 0} onChange={(value) => setStep(step.id, 'minTicketsEarned', Number(value))} /></Field>
        <Field label="赠送鱼币" hint="解锁这一步时一次性发放"><NumberInput value={step.grantCoins || 0} onChange={(value) => setStep(step.id, 'grantCoins', Number(value))} /></Field>
        <Field label="介绍卡" hint="需要玩家读完并手动关闭">
          <select className="admin-input" value={step.card ? '1' : '0'} onChange={(event) => setStep(step.id, 'card', event.target.value === '1')}>
            <option value="1">显示</option>
            <option value="0">不显示</option>
          </select>
        </Field>
      </div>
      {step.grantMaterials ? <p className="admin-empty-line">赠礼材料：{Object.entries(step.grantMaterials).map(([name, qty]) => `${name} ×${qty}`).join('、')}</p> : null}
    </section>)}
    <SectionHead title="文案" count="改字不用发版" />
    <section className="panel admin-card">
      {Object.keys(copy).map((key) => <Field key={key} label={key} hint={key === 'seaProduce' ? '可用 {materials} 占位' : undefined}>
        <textarea className="admin-input" rows={key === 'tension' || key === 'scratch' ? 4 : 2} value={copy[key] || ''} onChange={(event) => setCopy(key, event.target.value)} />
      </Field>)}
    </section>
  </>
}

// 深海FX：日涨跌幅 = z × volatility × 敏感度 − 回归，夹在日涨跌停内。
// 费率与价差是往返成本，交易时段决定什么时候能下单。
// 投币机器：租金、使用费、时段、加班、过热、槽位负荷、存款上限、模块价格全部在这里调。
// 代码里只保留公式，任何数值都不写死在业务里。
function MachineAdmin({ config, patch }) {
  const mc = config.machines || {}
  const list = mc.list || {}
  const modules = mc.modules || {}
  const update = (recipe) => patch((current) => ({ ...current, machines: recipe(current.machines || {}) }))
  const setMachine = (id, path, value) => update((cur) => {
    const machines = { ...(cur.list || {}) }
    const def = { ...(machines[id] || {}) }
    const keys = Array.isArray(path) ? path : [path]
    let cursor = def
    keys.slice(0, -1).forEach((key) => { cursor[key] = { ...(cursor[key] || {}) }; cursor = cursor[key] })
    cursor[keys[keys.length - 1]] = value
    machines[id] = def
    return { ...cur, list: machines }
  })
  const setModule = (id, key, value) => update((cur) => ({ ...cur, modules: { ...(cur.modules || {}), [id]: { ...(cur.modules?.[id] || {}), [key]: value } } }))
  const parseEff = (text) => String(text).split(/[,，\s]+/).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0).slice(0, 24)
  const ids = Object.keys(list).filter((id) => id !== 'watcher')

  return <>
    <div className="admin-sync"><SlidersHorizontal size={15} /><span>投币机器 · 保存后全服生效</span><b>{ids.length} 台机器</b><b>{Object.keys(modules).length} 个模块</b></div>

    <SectionHead title="模块解锁" count={`海域：${DEPTHS.find((d) => d.id === mc.modulesUnlockDepth)?.label || mc.modulesUnlockDepth || '裂谷'}`} />
    <section className="panel admin-card">
      <div className="admin-grid admin-grid-tight">
        <Field label="模块解锁海域" hint="玩家解锁该海域后才能买/装模块">
          <select className="admin-input" value={mc.modulesUnlockDepth || 'rift'} onChange={(event) => update((cur) => ({ ...cur, modulesUnlockDepth: event.target.value }))}>
            {DEPTHS.map((depth) => <option key={depth.id} value={depth.id}>{depth.label}</option>)}
          </select>
        </Field>
      </div>
    </section>

    {ids.map((id) => {
      const m = list[id] || {}
      const rent = m.rent || {}
      const fee = m.fee || {}
      const ot = m.overtime || {}
      const oh = m.overheat || {}
      const deposits = m.deposits || []
      return <React.Fragment key={id}>
        <SectionHead title={`${m.name || id}`} count={`${rent.unit === 'fishKg' ? `${rent.daily ?? 0} kg 鱼/天` : `${rent.daily ?? 0} ${rent.unit === 'blackCoins' ? '渔币' : '鱼币'}/天`} · ${m.shift?.startHour ?? 9}–${m.shift?.endHour ?? 17} 点`} />
        <section className="panel admin-card">
          <div className="admin-grid admin-grid-tight">
            <Field label="启用"><select className="admin-input" value={m.enabled === false ? '0' : '1'} onChange={(e) => setMachine(id, 'enabled', e.target.value === '1')}><option value="1">启用</option><option value="0">停用</option></select></Field>
            <Field label="显示名"><TextInput value={m.name || ''} onChange={(v) => setMachine(id, 'name', v)} /></Field>
            <Field label="解锁方式"><select className="admin-input" value={m.unlock?.kind || 'blackMarket'} onChange={(e) => setMachine(id, 'unlock', { ...(m.unlock || {}), kind: e.target.value })}>
              <option value="scratched">累计刮开张数</option>
              <option value="blackMarket">黑市解锁</option>
              <option value="depth">指定海域</option>
              <option value="always">始终可用</option>
            </select></Field>
            <Field label="解锁阈值" hint="解锁方式为「累计刮开张数」时生效"><NumberInput value={m.unlock?.value ?? 50} min={0} onChange={(v) => setMachine(id, 'unlock', { ...(m.unlock || {}), value: v })} /></Field>
            <Field label="白班开始（时）"><NumberInput value={m.shift?.startHour ?? 9} min={0} max={23} onChange={(v) => setMachine(id, 'shift', { ...(m.shift || {}), startHour: v })} /></Field>
            <Field label="白班结束（时）"><NumberInput value={m.shift?.endHour ?? 17} min={1} max={24} onChange={(v) => setMachine(id, 'shift', { ...(m.shift || {}), endHour: v })} /></Field>
            <Field label="每件耗时 (ms)" hint="60000 = 一分钟一件"><NumberInput value={m.rate?.msPerItem ?? 60000} min={1000} step={1000} onChange={(v) => setMachine(id, 'rate', { ...(m.rate || {}), msPerItem: v })} /></Field>
            <Field label="每日租金"><NumberInput value={rent.daily ?? 0} min={0} step={1} onChange={(v) => setMachine(id, 'rent', { ...rent, daily: v })} /></Field>
            <Field label="租金货币"><select className="admin-input" value={rent.unit || 'coins'} onChange={(e) => setMachine(id, 'rent', { ...rent, unit: e.target.value })}>
              <option value="fishKg">鱼（kg）</option>
              <option value="coins">鱼币</option>
              <option value="blackCoins">渔币</option>
            </select></Field>
            <Field label="加班鱼 (kg/小时)" hint="只对鱼租金机器有意义"><NumberInput value={rent.overtimePerHour ?? 0} min={0} onChange={(v) => setMachine(id, 'rent', { ...rent, overtimePerHour: v })} /></Field>
            <Field label="每件使用费"><NumberInput value={fee.perItem ?? 0} min={0} step={0.5} onChange={(v) => setMachine(id, 'fee', { ...fee, perItem: v })} /></Field>
            <Field label="使用费货币"><select className="admin-input" value={fee.unit || 'coins'} onChange={(e) => setMachine(id, 'fee', { ...fee, unit: e.target.value })}>
              <option value="coins">鱼币</option>
              <option value="blackCoins">渔币</option>
            </select></Field>
            <Field label="加班倍数" hint="2 = 加班每件收两倍"><NumberInput value={fee.overtimeMultiplier ?? 2} min={1} step={0.5} onChange={(v) => setMachine(id, 'fee', { ...fee, overtimeMultiplier: v })} /></Field>
            <Field label="抽成比例" hint="0.05 = 成交额 5%，0 = 不按比例"><NumberInput value={fee.rateOfProceeds ?? 0} min={0} max={1} step={0.01} onChange={(v) => setMachine(id, 'fee', { ...fee, rateOfProceeds: v })} /></Field>
            <Field label="抽成下限"><NumberInput value={fee.min ?? 0} min={0} onChange={(v) => setMachine(id, 'fee', { ...fee, min: v })} /></Field>
            <Field label="过热上限"><NumberInput value={oh.max ?? 5} min={0} onChange={(v) => setMachine(id, 'overheat', { ...oh, max: v })} /></Field>
            <Field label="过热惩罚/点" hint="0.1 = 每点拖慢 10% 白班"><NumberInput value={oh.perDayPenalty ?? 0.1} min={0} max={1} step={0.01} onChange={(v) => setMachine(id, 'overheat', { ...oh, perDayPenalty: v })} /></Field>
            <Field label="最低手速"><NumberInput value={oh.minSpeed ?? 0.5} min={0.05} max={1} step={0.05} onChange={(v) => setMachine(id, 'overheat', { ...oh, minSpeed: v })} /></Field>
            <Field label="模块槽数"><NumberInput value={m.moduleSlots ?? 2} min={0} max={8} onChange={(v) => setMachine(id, 'moduleSlots', v)} /></Field>
            <Field label="负荷上限"><NumberInput value={m.loadCapacity ?? 6} min={0} onChange={(v) => setMachine(id, 'loadCapacity', v)} /></Field>
            <Field label="单次结算上限" hint="防止一次同步卡太久"><NumberInput value={m.settle?.batchMax ?? 300} min={1} max={500} onChange={(v) => setMachine(id, 'settle', { ...(m.settle || {}), batchMax: v })} /></Field>
          </div>
          {ot.maxHours !== undefined && <div className="admin-grid admin-grid-tight">
            <Field label="加班开始（时）"><NumberInput value={ot.fromHour ?? 17} min={0} max={23} onChange={(v) => setMachine(id, 'overtime', { ...ot, fromHour: v })} /></Field>
            <Field label="加班结束（时）"><NumberInput value={ot.toHour ?? 22} min={1} max={24} onChange={(v) => setMachine(id, 'overtime', { ...ot, toHour: v })} /></Field>
            <Field label="最多加班小时"><NumberInput value={ot.maxHours ?? 5} min={0} max={12} onChange={(v) => setMachine(id, 'overtime', { ...ot, maxHours: v })} /></Field>
            <Field label="加班效率序列" hint="逗号分隔，第 N 个是第 N 个连续加班小时"><TextInput value={(ot.efficiency || []).join(',')} onChange={(v) => setMachine(id, 'overtime', { ...ot, efficiency: parseEff(v) })} /></Field>
          </div>}
          <div className="admin-grid admin-grid-tight">
            {deposits.map((entry, index) => <Field key={entry.key} label={`${entry.key} 上限`} hint={`来源：${entry.from}`}>
              <NumberInput value={entry.max ?? 0} min={0} onChange={(v) => setMachine(id, 'deposits', deposits.map((item, i) => i === index ? { ...item, max: v } : item))} />
            </Field>)}
          </div>
        </section>
      </React.Fragment>
    })}

    <SectionHead title="模块" count={`${Object.keys(modules).length} 个`} />
    <section className="panel admin-card">
      <div className="admin-grid admin-grid-tight">
        {Object.keys(modules).map((id) => {
          const mod = modules[id] || {}
          return <React.Fragment key={id}>
            <Field label={`${mod.name || id} · 价格`} hint={`负荷 ${mod.load ?? 0}/级`}>
              <NumberInput value={mod.price ?? 0} min={0} step={50} onChange={(v) => setModule(id, 'price', v)} />
            </Field>
            <Field label={`${mod.name || id} · 上限等级`}>
              <NumberInput value={mod.maxLevel ?? 1} min={0} max={99} onChange={(v) => setModule(id, 'maxLevel', v)} />
            </Field>
          </React.Fragment>
        })}
      </div>
    </section>
  </>
}

function BlackMarketAdmin({ config, patch }) {
  const bm = config.blackMarket || {}
  const fish = bm.fish || {}
  const order = bm.order || {}
  const sup = bm.super || {}
  const materials = bm.materials || {}
  const shop = bm.shop || []
  const [overrideText, setOverrideText] = useState(() => JSON.stringify(sup.valueOverrides || {}))
  const [overrideError, setOverrideError] = useState('')
  const [addMaterial, setAddMaterial] = useState('')
  useEffect(() => { setOverrideText(JSON.stringify(sup.valueOverrides || {})) }, [JSON.stringify(sup.valueOverrides || {})])

  const update = (recipe) => patch((current) => ({ ...current, blackMarket: recipe(current.blackMarket || {}) }))
  const setFish = (key, value) => update((cur) => ({ ...cur, fish: { ...(cur.fish || {}), [key]: value } }))
  const setOrder = (key, value) => update((cur) => ({ ...cur, order: { ...(cur.order || {}), [key]: value } }))
  const setSuper = (key, value) => update((cur) => ({ ...cur, super: { ...(cur.super || {}), [key]: value } }))
  const setMaterial = (name, key, value) => update((cur) => ({ ...cur, materials: { ...(cur.materials || {}), [name]: { per: 10, coins: 1, ...(cur.materials?.[name] || {}), [key]: value } } }))
  const removeMaterial = (name) => update((cur) => {
    const next = { ...(cur.materials || {}) }
    delete next[name]
    return { ...cur, materials: next }
  })
  const setShop = (id, key, value) => update((cur) => ({ ...cur, shop: (cur.shop || []).map((item) => item.id === id ? { ...item, [key]: value } : item) }))
  const commitOverrides = () => {
    try {
      const parsed = JSON.parse(overrideText || '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      const next = Object.fromEntries(Object.entries(parsed)
        .map(([key, value]) => [String(key), Number(value)])
        .filter(([, value]) => Number.isFinite(value) && value >= 0))
      update((cur) => ({ ...cur, super: { ...(cur.super || {}), valueOverrides: next } }))
      setOverrideError('')
    } catch {
      setOverrideError('需要 JSON 对象，例如 {"潮汐锁钥": 3}')
    }
  }
  // 兼容性检查：后台改奖池后，先看每个卡种有没有「能中且有价值」的奖励。
  const checks = useMemo(() => (config.scratchTypes || []).map((type) => {
    const pool = scratchPoolSnapshot(type)
    const stats = pool ? scratchPoolStats(pool) : null
    if (!stats) return { id: type.id, name: type.name, ok: false, text: '奖池为空' }
    const rewards = [...stats.rewards.values()]
    const payable = rewards.filter((reward) => reward.E > 0 && blackSuperValue(reward.kind, reward.name, config) > 0)
    const dead = rewards.filter((reward) => !(reward.E > 0))
    const needTooHigh = Number(sup.need) > Number(type.slots)
    return {
      id: type.id,
      name: type.name,
      ok: payable.length > 0,
      text: `${payable.length} 种可支付${dead.length ? ` · ${dead.length} 种永不中奖` : ''}${needTooHigh ? ' · need 超过格数' : ''}`,
    }
  }), [config, sup.need])

  return <>
    <div className="admin-sync"><Skull size={15} /><span>第二套经济 · 保存后全服生效</span><b>{materials ? Object.keys(materials).length : 0} 种回收</b><b>{shop.length} 件商品</b></div>

    <SectionHead title="入口与货币" count={`解锁海域：${DEPTHS.find((depth) => depth.id === bm.unlockDepth)?.label || bm.unlockDepth || '海沟'}`} />
    <section className="panel admin-card">
      <div className="admin-grid admin-grid-tight">
        <Field label="启用黑市" hint="关闭后只允许结算已生成的超级卡">
          <select className="admin-input" value={bm.enabled === false ? '0' : '1'} onChange={(event) => update((cur) => ({ ...cur, enabled: event.target.value === '1' }))}>
            <option value="1">启用</option>
            <option value="0">停用</option>
          </select>
        </Field>
        <Field label="解锁海域" hint="玩家解锁该海域后出现入口">
          <select className="admin-input" value={bm.unlockDepth || 'deep'} onChange={(event) => update((cur) => ({ ...cur, unlockDepth: event.target.value }))}>
            {DEPTHS.map((depth) => <option key={depth.id} value={depth.id}>{depth.label}</option>)}
          </select>
        </Field>
      </div>
    </section>

    <SectionHead title="鱼价与配额" count={`${fish.dailyQuota ?? 40} 条/天`} />
    <section className="panel admin-card">
      <div className="admin-grid admin-grid-tight">
        <Field label="每条词条渔币" hint="鱼价 = max(1, 词条数 × 该值)"><NumberInput value={fish.traitBonus ?? 1} min={0} step={0.1} onChange={(value) => setFish('traitBonus', value)} /></Field>
        <Field label="每日收购配额"><NumberInput value={fish.dailyQuota ?? 40} min={0} onChange={(value) => setFish('dailyQuota', value)} /></Field>
        <Field label="配额每档 +N"><NumberInput value={fish.quotaStep ?? 10} min={0} onChange={(value) => setFish('quotaStep', value)} /></Field>
        <Field label="配额最多购买次数"><NumberInput value={fish.quotaMaxBuys ?? 6} min={0} onChange={(value) => setFish('quotaMaxBuys', value)} /></Field>
        <Field label="黑市秤加成" hint="0.1 = +10%，只作用于卖鱼"><NumberInput value={fish.scaleBonus ?? 0.1} min={0} step={0.01} onChange={(value) => setFish('scaleBonus', value)} /></Field>
      </div>
    </section>

    <SectionHead title="收购单" count={`每天 1 个收购词条 + 2 个禁用词条`} />
    <section className="panel admin-card">
      <div className="admin-grid admin-grid-tight">
        <Field label="目标接受率" hint="生成订单时优先挑接近这个概率的组合"><NumberInput value={order.targetAcceptance ?? 0.25} min={0} max={1} step={0.01} onChange={(value) => setOrder('targetAcceptance', value)} /></Field>
        <Field label="接受率下限"><NumberInput value={order.acceptanceMin ?? 0.12} min={0} max={1} step={0.01} onChange={(value) => setOrder('acceptanceMin', value)} /></Field>
        <Field label="接受率上限"><NumberInput value={order.acceptanceMax ?? 0.45} min={0} max={1} step={0.01} onChange={(value) => setOrder('acceptanceMax', value)} /></Field>
        <Field label="刷新价格"><NumberInput value={order.refreshCost ?? 25} min={0} onChange={(value) => setOrder('refreshCost', value)} /></Field>
        <Field label="每日刷新次数"><NumberInput value={order.refreshLimit ?? 3} min={0} onChange={(value) => setOrder('refreshLimit', value)} /></Field>
      </div>
    </section>

    <SectionHead title="材料回收" count={`${Object.keys(materials).length} 种`} />
    <section className="panel admin-card">
      <div className="admin-table">
        <div className="admin-table-head admin-black-material-head"><span>材料</span><span>每 N 个</span><span>换渔币</span><span /></div>
        {Object.entries(materials).map(([name, rate]) => <div className="admin-table-row admin-black-material-row" key={name}>
          <span className="admin-black-material-name"><i style={{ background: MATERIALS[name]?.color || '#666' }} />{name}</span>
          <NumberInput value={rate.per} min={1} onChange={(value) => setMaterial(name, 'per', Math.max(1, value))} />
          <NumberInput value={rate.coins} min={0} onChange={(value) => setMaterial(name, 'coins', Math.max(0, value))} />
          <DeleteButton label={`停止回收 ${name}`} onClick={() => removeMaterial(name)} />
        </div>)}
        {!Object.keys(materials).length && <p className="admin-empty-line">暂不回收材料</p>}
      </div>
      <div className="admin-black-add-row">
        <select className="admin-input" value={addMaterial} onChange={(event) => setAddMaterial(event.target.value)}>
          <option value="">选择材料…</option>
          {MATERIAL_NAMES.filter((name) => !materials[name]).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <button className="secondary-button" disabled={!addMaterial} onClick={() => { setMaterial(addMaterial, 'per', 10); setAddMaterial('') }}><Plus size={13} /> 加入回收</button>
      </div>
    </section>

    <SectionHead title="超级刮刮乐" count={`${sup.slots ?? 9} 格 / need ${sup.need ?? 2}`} />
    <section className="panel admin-card">
      <div className="admin-grid admin-grid-tight">
        <Field label="启用"><select className="admin-input" value={sup.enabled === false ? '0' : '1'} onChange={(event) => setSuper('enabled', event.target.value === '1')}><option value="1">启用</option><option value="0">停用</option></select></Field>
        <Field label="格数" hint="3–9；9 = 3×3"><NumberInput value={sup.slots ?? 9} min={3} max={9} onChange={(value) => setSuper('slots', value)} /></Field>
        <Field label="匹配数 need" hint="2–3"><NumberInput value={sup.need ?? 2} min={2} max={3} onChange={(value) => setSuper('need', value)} /></Field>
        <Field label="最少投入"><NumberInput value={sup.minInput ?? 1} min={1} onChange={(value) => setSuper('minInput', value)} /></Field>
        <Field label="最多投入"><NumberInput value={sup.maxInput ?? 200} min={1} max={200} onChange={(value) => setSuper('maxInput', value)} /></Field>
        <Field label="热度灵敏度" hint="0 = 关闭热度"><NumberInput value={sup.sensitivity ?? 1.2} min={0} max={3} step={0.1} onChange={(value) => setSuper('sensitivity', value)} /></Field>
        <Field label="热度下限"><NumberInput value={sup.heatMin ?? 0.25} min={0} step={0.05} onChange={(value) => setSuper('heatMin', value)} /></Field>
        <Field label="热度上限"><NumberInput value={sup.heatMax ?? 4} min={0} step={0.1} onChange={(value) => setSuper('heatMax', value)} /></Field>
        <Field label="保底倍率 baseline"><NumberInput value={sup.baseline ?? 0.05} min={0} max={0.9} step={0.01} onChange={(value) => setSuper('baseline', value)} /></Field>
        <Field label="倍率指数 fPower"><NumberInput value={sup.fPower ?? 2} min={1} max={2.5} step={0.1} onChange={(value) => setSuper('fPower', value)} /></Field>
        <Field label="倍率上限 fMax"><NumberInput value={sup.fMax ?? 10} min={1} max={100} onChange={(value) => setSuper('fMax', value)} /></Field>
        <Field label="目标期望 targetEv" hint="0.95–1.0"><NumberInput value={sup.targetEv ?? 0.975} min={0.9} max={1} step={0.005} onChange={(value) => setSuper('targetEv', value)} /></Field>
        <Field label="期望下限 evMin"><NumberInput value={sup.evMin ?? 0.95} min={0.9} max={1} step={0.005} onChange={(value) => setSuper('evMin', value)} /></Field>
        <Field label="期望上限 evMax"><NumberInput value={sup.evMax ?? 1} min={0.95} max={1.05} step={0.005} onChange={(value) => setSuper('evMax', value)} /></Field>
        <Field label="解析保守系数" hint="仅解析模式使用"><NumberInput value={sup.calibrationSafety ?? 0.98} min={0.8} max={1.1} step={0.005} onChange={(value) => setSuper('calibrationSafety', value)} /></Field>
        <Field label="校准模式"><select className="admin-input" value={sup.calibrationMode || 'auto'} onChange={(event) => setSuper('calibrationMode', event.target.value)}><option value="auto">自动</option><option value="simulate">强制模拟</option><option value="analytic">强制解析（仅预览）</option></select></Field>
        <Field label="模拟次数"><NumberInput value={sup.simSamples ?? 10000} min={1000} max={100000} step={1000} onChange={(value) => setSuper('simSamples', value)} /></Field>
        <Field label="极端模拟次数"><NumberInput value={sup.simSamplesExtreme ?? 50000} min={1000} max={200000} step={1000} onChange={(value) => setSuper('simSamplesExtreme', value)} /></Field>
        <Field label="未知物品价值"><NumberInput value={sup.unknownValue ?? 0.05} min={0} step={0.01} onChange={(value) => setSuper('unknownValue', value)} /></Field>
      </div>
      <div className="admin-subhead"><span>价值覆盖</span><small>JSON；未列出的材料按回收价，coin 恒为 1</small></div>
      <textarea className="admin-input admin-json" rows={3} value={overrideText} onChange={(event) => setOverrideText(event.target.value)} onBlur={commitOverrides} aria-label="超级刮刮乐价值覆盖" />
      {overrideError && <p className="auth-error" role="alert">{overrideError}</p>}
    </section>

    <SectionHead title="商店" count={`${shop.length} 件`} />
    <div className="admin-stack">
      {shop.map((item) => <section className="panel admin-card" key={item.id}>
        <div className="admin-card-head">
          <div className="admin-card-title"><span className="admin-swatch" style={{ background: '#a06bff' }} /><strong>{item.name}</strong><small>{item.kind}</small></div>
        </div>
        <div className="admin-grid admin-grid-tight">
          <Field label="价格"><NumberInput value={item.price} min={0} onChange={(value) => setShop(item.id, 'price', value)} /></Field>
          {item.kind === 'grain' && <Field label="解锁档位" hint="玩家买下后即可查看该档 K 线"><select className="admin-input" value={item.grainId || ''} onChange={(event) => setShop(item.id, 'grainId', event.target.value)}>{FX_GRAINS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></Field>}
          {item.kind === 'quota' && <Field label="每档涨价"><NumberInput value={item.priceGrowth || 0} min={0} onChange={(value) => setShop(item.id, 'priceGrowth', value)} /></Field>}
          {item.maxBuys > 0 && <Field label="最多购买"><NumberInput value={item.maxBuys} min={0} onChange={(value) => setShop(item.id, 'maxBuys', value)} /></Field>}
          {item.dailyLimit > 0 && <Field label="每日次数"><NumberInput value={item.dailyLimit} min={0} onChange={(value) => setShop(item.id, 'dailyLimit', value)} /></Field>}
          {item.once && <Field label="一次性"><select className="admin-input" value={item.once ? '1' : '0'} onChange={(event) => setShop(item.id, 'once', event.target.value === '1')}><option value="1">是</option><option value="0">否</option></select></Field>}
        </div>
      </section>)}
    </div>

    <SectionHead title="兼容性检查" count={`${checks.length} 种刮刮乐`} />
    <section className="panel admin-card">
      <div className="admin-table">
        {checks.map((check) => <div className="admin-table-row admin-black-check-row" key={check.id}>
          <span>{check.name}</span>
          <StatusPill tone={check.ok ? 'success' : 'danger'}>{check.ok ? '可投入' : '不可投入'}</StatusPill>
          <span className="admin-black-check-text">{check.text}</span>
        </div>)}
      </div>
    </section>
  </>
}

function FxAdmin({ config, patch, onRefresh, onGateError }) {
  const [resetting, setResetting] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [resetVersion, setResetVersion] = useState(0)
  const clear = async () => {
    if (resetting || !window.confirm('清空全服行情历史，将所有标的恢复到基准价？')) return
    setResetting(true)
    setFeedback(null)
    try {
      await api.adminResetFx()
      setResetVersion((value) => value + 1)
      setFeedback({ text: '已清空行情历史' })
      onRefresh?.()
    } catch (err) {
      if (!onGateError(err)) setFeedback({ error: true, text: err.message || '清空行情失败' })
    } finally {
      setResetting(false)
    }
  }
  const fx = config.fx || normalizeFx(null)
  const update = (recipe) => patch((current) => ({ ...current, fx: recipe(current.fx || normalizeFx(null)) }))
  const updateTrait = (name, recipe) => update((current) => ({ ...current, traits: { ...current.traits, [name]: recipe(current.traits?.[name]) } }))
  const maxPrice = Math.max(...Object.values(fx.traits).map((entry) => entry.price || 0), 1)
  return <>
    <div className="admin-sync"><TrendingUp size={15} /><span>行情由钓获与商会出货驱动</span><b>{Object.keys(fx.traits).length} 个标的</b><b>{(fx.feeRate * 100).toFixed(1)}% 单边费</b></div>

    <SectionHead title="交易规则" count={`${Object.keys(fx.traits).length} 个标的`} />
    <section className="panel admin-card">
      <div className="admin-grid">
        <Field label="手续费率" hint="买入与卖出各收一次"><NumberInput value={Math.round(fx.feeRate * 1000) / 10} min={0} max={10} step={0.1} onChange={(value) => update((current) => ({ ...current, feeRate: Math.min(0.1, Math.max(0, value / 100)) }))} /></Field>
        <Field label="买卖价差" hint="买价与卖价之间的差额"><NumberInput value={Math.round(fx.spread * 1000) / 10} min={0} max={10} step={0.1} onChange={(value) => update((current) => ({ ...current, spread: Math.min(0.1, Math.max(0, value / 100)) }))} /></Field>
        <Field label="日涨跌停" hint="单日最大涨跌幅"><NumberInput value={Math.round(fx.dailyLimit * 100)} min={1} max={100} onChange={(value) => update((current) => ({ ...current, dailyLimit: Math.min(1, Math.max(0.01, value / 100)) }))} /></Field>
        <Field label="单标的持仓上限" hint="防止把 FX 当仓库"><NumberInput value={fx.maxPosition} min={1} onChange={(value) => update((current) => ({ ...current, maxPosition: Math.max(1, Math.round(value)) }))} /></Field>
        <Field label="开市时间" hint="本地时间整点"><NumberInput value={fx.openHour} min={0} max={23} onChange={(value) => update((current) => ({ ...current, openHour: Math.min(23, Math.max(0, Math.round(value))) }))} /></Field>
        <Field label="收市时间" hint="24 表示当天结束"><NumberInput value={fx.closeHour} min={1} max={24} onChange={(value) => update((current) => ({ ...current, closeHour: Math.min(24, Math.max(1, Math.round(value))) }))} /></Field>
        <Field label="波动系数" hint="供需完全失衡时的涨跌幅"><NumberInput value={Math.round(fx.volatility * 1000) / 10} min={0.5} max={50} step={0.5} onChange={(value) => update((current) => ({ ...current, volatility: Math.min(0.5, Math.max(0.005, value / 100)) }))} /></Field>
        <Field label="均值回归" hint="每天拉回基准价的比例"><NumberInput value={Math.round(fx.reversion * 1000) / 10} min={0} max={50} step={0.5} onChange={(value) => update((current) => ({ ...current, reversion: Math.min(0.5, Math.max(0, value / 100)) }))} /></Field>
        <Field label="历史天数" hint="可回看的交易日数量"><NumberInput value={fx.historyDays} min={1} max={30} onChange={(value) => update((current) => ({ ...current, historyDays: Math.min(30, Math.max(1, Math.round(value))) }))} /></Field>
      </div>
      <div className="pricing-formula">日涨跌幅由当日供需失衡与价格向基准值的回归共同决定，最终被夹在涨跌停范围内。失衡比看的是「钓获抽走的量」与「出货还回的量」谁占上风，与成交规模无关——方向一致时，10 条鱼和 10 万条鱼推动的幅度相同。{fx.openHour}:00 开市，{fx.closeHour}:00 收市。</div>
    </section>

    <SectionHead title="行情维护" count="真实数据" />
    <section className="panel admin-card">
      <div className="admin-actions">
        <button className="secondary-button" disabled={resetting} onClick={clear}><RotateCcw size={14} /> {resetting ? '清空中…' : '清空行情历史'}</button>
      </div>
      {feedback && <p className={feedback.error ? 'auth-error' : 'auth-notice'} role="status">{feedback.text}</p>}
      <div className="pricing-formula">行情只由玩家上钩与商会出货生成，后台不提供任何模拟填充。清空后所有标的回到基准价，不影响持仓与鱼币。</div>
    </section>

    <SectionHead title="词条标的" count={`${Object.keys(fx.traits).length} 个`} />
    <div className="admin-stack">
      {TRAITS.map((trait) => {
        const entry = fx.traits[trait.id] || { price: 50, sensitivity: 1 }
        return <section className="panel admin-card" key={trait.id}>
          <div className="admin-card-head">
            <div className="admin-card-title"><span className="admin-swatch" style={{ background: trait.color }} /><strong>{trait.icon} {trait.label}</strong><small>{trait.id}</small></div>
            <small className="trait-bar-value">±{(fx.volatility * entry.sensitivity * 100).toFixed(1)}% / 1σ</small>
          </div>
          <div className="admin-grid admin-grid-tight">
            <Field label="基准价"><NumberInput value={entry.price} min={1} onChange={(value) => updateTrait(trait.id, (item) => ({ ...item, price: Math.max(1, Math.round(value)) }))} /></Field>
            <Field label="敏感度" hint="越大越波动"><NumberInput value={Math.round(entry.sensitivity * 100) / 100} min={0.1} max={5} step={0.05} onChange={(value) => updateTrait(trait.id, (item) => ({ ...item, sensitivity: Math.min(5, Math.max(0.1, value)) }))} /></Field>
          </div>
          <div className="trait-bar-row fx-admin-bar">
            <span className="trait-bar-label">基准价</span>
            <div className="trait-bar-track"><i style={{ width: `${Math.max(3, (entry.price / maxPrice) * 100)}%`, background: trait.color }} /></div>
            <b className="trait-bar-value">{entry.price}</b>
          </div>
        </section>
      })}
    </div>

    <FxSettlementAdmin config={config} resetVersion={resetVersion} onGateError={onGateError} />
  </>
}

// 后台底部的两张表：昨日留下的影响 + 今日的结算预览，都按标的逐行列出。
//
// 为什么放在后台而不是玩家页：这两张表回答的是「今天这根日线会怎么结算」，
// 属于运营视角的核对工具。数据全部来自服务端全服表，后台不参与任何计算，
// 所以它看到的价格和零点真正写进 fx_days 的价格是同一份。
function FxSettlementAdmin({ config, resetVersion, onGateError }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const [onlyMoved, setOnlyMoved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.adminFxPreview())
      // 倒计时以 serverTime 为基准，拿到新数据就把本地秒数归零，
      // 否则 tick 会一直累加，刷新后倒计时反而越走越偏。
      setTick(0)
      setError('')
    } catch (err) {
      if (!onGateError(err)) setError(err.message || '无法读取结算预览')
    } finally {
      setLoading(false)
    }
  }, [onGateError])

  useEffect(() => { load() }, [load, resetVersion])
  // 结算预览要跟着待结算桶走，30 秒拉一次；同时用本地 tick 走倒计时，
  // 不必为了跳秒去请求服务端。
  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    const id = window.setInterval(() => { load() }, 30000)
    return () => window.clearInterval(id)
  }, [load])

  const rows = data?.rows || []
  // K 线预览要一份「玩家页同款」的 state：config + fx.days/today/bins。
  // 服务端已经把 compactWorld、逐格桶和已保存的 config 一起下发，
  // 这里只做形状拼装，不重算任何价格。
  // 后台也直接用服务端算好的蜡烛（data.fx.candles），不再本地推导。
  const chartRows = useMemo(() => rows.map((row) => ({ ...row, candles: data?.fx?.candles?.[row.name] || null })), [rows, data])
  // 后台不再需要 grains 白名单：管理端本来就是全档位可见（含锁定档），
  // 这样能直接核对「解锁前后玩家看到什么」。
  void config
  // 两张表各看各的：昨日影响里「昨天没成交」的行是空行，今日预览里「今天没成交」的行是空行。
  const yesterdayRows = onlyMoved ? rows.filter((row) => row.yesterday.volume > 0) : rows
  const todayRows = onlyMoved ? rows.filter((row) => row.today.volume > 0) : rows
  const totals = data?.totals
  const pct = (value) => `${value > 0 ? '+' : ''}${(Number(value) * 100).toFixed(2)}%`
  const tone = (value) => (value > 0 ? 'is-up' : value < 0 ? 'is-down' : 'is-flat')
  const num = (value) => Number(value || 0).toLocaleString('zh-CN')
  // 倒计时用 serverTime 做基准：客户端时钟可能偏，服务端给的时间才是结算口径。
  const remainMs = data ? Math.max(0, Number(data.settlesAt) - (Number(data.serverTime) + tick * 1000)) : 0
  const remainText = (() => {
    if (!data) return '—'
    const total = Math.floor(remainMs / 1000)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  })()
  const dayLabel = (day) => (Number.isFinite(Number(day)) ? new Date(fxDayStart(Number(day))).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—')

  return <>
    <SectionHead title="昨日影响" count={data ? `${dayLabel(data.yesterday)} 已结算` : '读取中'} />
    <section className="panel admin-card">
      <div className="admin-sync">
        <TrendingUp size={15} />
        <span>昨日成交把今天的开盘价推到了这里</span>
        <b>{totals ? `${totals.yesterdayTraded} 个标的有成交` : '—'}</b>
        <b>{totals ? `净额 ${totals.yesterdayNet > 0 ? '+' : ''}${num(totals.yesterdayNet)}` : '—'}</b>
        <b>{totals ? `涨 ${totals.yesterdayUp} / 跌 ${totals.yesterdayDown}` : '—'}</b>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="admin-table fx-settle-table">
        <div className="admin-table-head fx-settle-head">
          <span>标的</span><span>昨收</span><span>昨日涨跌</span><span>昨日净额</span><span>昨日成交</span><span>今开</span><span>昨日影响</span>
        </div>
        {yesterdayRows.map((row) => <div className="admin-table-row fx-settle-row" key={row.name}>
          <span className="fx-settle-name"><i style={{ background: row.color }} />{row.icon} {row.label}<small>{row.name}</small></span>
          <b className="fx-settle-num">{row.yesterday.close}</b>
          <span className={cn('fx-settle-num', tone(row.yesterday.move))}>{row.yesterday.settled ? pct(row.yesterday.move) : '—'}</span>
          <span className={cn('fx-settle-num', tone(row.yesterday.net))}>{row.yesterday.net > 0 ? '+' : ''}{num(row.yesterday.net)}</span>
          <span className="fx-settle-num">{num(row.yesterday.volume)}</span>
          <b className="fx-settle-num">{row.today.open}</b>
          <span className={cn('fx-settle-num', tone(row.today.reversion))}>{pct(row.today.reversion)}</span>
        </div>)}
        {!yesterdayRows.length && <p className="admin-empty-line">{rows.length ? '昨日没有成交过的标的' : '暂无昨日行情'}</p>}
      </div>
      <div className="pricing-formula">昨收即今日开盘价：每日开盘价总是承接前一日收盘，所以昨日那根日线的收盘就是今天价格的起点，不会留跳空。「昨日影响」是昨日偏离给今天留下的那部分影响，即使今天没有成交也会生效。</div>
    </section>

    <SectionHead title="昨日影响明细" count="逐标的原始数据" />
    <FxPerSymbolCharts rows={chartRows} loading={loading} now={data?.serverTime} />

    <SectionHead title="今日结算预览" count={data ? `${dayLabel(data.day)} · 距结算 ${remainText}` : '读取中'} />
    <section className="panel admin-card">
      <div className="admin-sync">
        <TrendingUp size={15} />
        <span>{data?.session?.open ? '交易中，数字随待结算桶实时变化' : '休市中，数字是下次开盘前的预测'}</span>
        <b>{totals ? `${totals.todayTraded} 个标的有成交` : '—'}</b>
        <b>{totals ? `净额 ${totals.todayNet > 0 ? '+' : ''}${num(totals.todayNet)}` : '—'}</b>
        <b>{totals ? `涨 ${totals.todayUp} / 跌 ${totals.todayDown}` : '—'}</b>
        {totals?.limitHits > 0 && <b className="fx-settle-alert">{totals.limitHits} 个触板</b>}
      </div>
      <div className="filter-row fx-settle-filter">
        <button className={cn('filter-button', !onlyMoved && 'filter-active')} onClick={() => setOnlyMoved(false)}>全部标的</button>
        <button className={cn('filter-button', onlyMoved && 'filter-active')} onClick={() => setOnlyMoved(true)}>只看有成交</button>
        <button className="secondary-button" disabled={loading} onClick={load}><RotateCcw size={13} /> {loading ? '刷新中…' : '刷新'}</button>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="admin-table fx-settle-table">
        <div className="admin-table-head fx-settle-head fx-settle-head-today">
          <span>标的</span><span>今开</span><span>现价</span><span>预计收盘</span><span>预计涨跌</span><span>今日净额</span><span>今日成交</span><span>失衡比</span><span>距结算</span>
        </div>
        {todayRows.map((row) => <div className="admin-table-row fx-settle-row fx-settle-row-today" key={row.name}>
          <span className="fx-settle-name"><i style={{ background: row.color }} />{row.icon} {row.label}<small>{row.name}</small></span>
          <b className="fx-settle-num">{row.today.open}</b>
          <b className="fx-settle-num">{row.today.live}</b>
          <b className={cn('fx-settle-num', tone(row.today.move))}>{row.today.close}</b>
          <span className={cn('fx-settle-num', tone(row.today.move))}>{pct(row.today.move)}{row.today.limitHit && <em className="fx-settle-limit">触板</em>}</span>
          <span className={cn('fx-settle-num', tone(row.today.net))}>{row.today.net > 0 ? '+' : ''}{num(row.today.net)}</span>
          <span className="fx-settle-num">{num(row.today.volume)}</span>
          <span className="fx-settle-num">{row.today.volume > 0 ? row.today.imbalance.toFixed(2) : '—'}</span>
          <span className={cn('fx-settle-num', tone(row.today.remaining))}>{pct(row.today.remaining)}</span>
        </div>)}
        {!todayRows.length && <p className="admin-empty-line">{rows.length ? '今日还没有成交过的标的' : '暂无今日行情'}</p>}
      </div>
      <div className="pricing-formula">「预计收盘」与零点真正写入日线的收盘价采用同一套结算逻辑，不是另算的参考值。「距结算」表示从现在到收市，价格还需要走多少；「触板」表示当日供需已极端到顶住涨跌停，需要人工关注。</div>
    </section>
  </>
}

// 逐标的的原始数据图：左边是昨日 288 格（5 分钟一格）资金流柱状图，右边是 K 线图。
//
// 为什么两种图都要：
//   柱状图回答「昨天几点在流入、几点在出货」——这是日线汇总里看不到的一手证据；
//   K 线图回答「这段流水把价格推成了什么形态」——和玩家页是同一份实现。
// 两者并排，管理员能直接把「资金」和「价格」对上，判断该不该干预。
function FxPerSymbolCharts({ rows, loading, now }) {
  // 日K 已从前台下线；后台沿用分钟档位（默认 60 分），与管理端配置一致。
  const [grain, setGrain] = useState('m60')
  const [expanded, setExpanded] = useState(null)
  const fmtPct = (value) => `${value > 0 ? '+' : ''}${(Number(value) * 100).toFixed(2)}%`
  const tone = (value) => (value > 0 ? 'is-up' : value < 0 ? 'is-down' : 'is-flat')
  const clockOf = (at) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  // K 线数据全部来自服务端下发的行情快照：后台不自己造价格。
  // 这里用一个最小的 state 形状喂给 fxPredictionSeries，和玩家页走同一条代码路径；
  // forecast 用结算预览的 today（零点会真正落库的那组 OHLC），所以预测段不是另算的。
  // 时间基准用服务端的 serverTime：客户端时钟偏了会让「已走完多少分钟」算错，
  // 分界线和预测段的起点就都跟着错。
  // 蜡烛由服务端算好下发，后台只解码展示，不参与任何价格计算。
  //
  // 序列结构：已结算历史 → 一根「进行中」（真实成交，这一格还没走完）→ 若干「推演」。
  // 虚线画在「进行中」之前，所以左侧历史、右侧是还没发生的部分。
  // 玩家页拿不到后半段：服务端只在管理端接口传 withForecast。
  const seriesOf = (row) => {
    const payload = row?.candles?.[grain]
    if (!payload) return { bars: [], splitIndex: 0 }
    const bars = decodeCandleRows(payload)
    const splitIndex = bars.findIndex((bar) => bar.running || bar.projected)
    return { bars, splitIndex: splitIndex < 0 ? bars.length : splitIndex }
  }
  if (!rows.length) return <section className="panel admin-card"><p className="admin-empty-line">暂无数据</p></section>
  return <div className="admin-stack">
    <div className="filter-row fx-settle-filter">
      <span className="fx-grain-label">K 线粒度</span>
      <div className="fx-grain-switch" role="tablist" aria-label="K 线粒度">
        {FX_GRAINS.map((item) => <button key={item.id} role="tab" aria-selected={grain === item.id} className={cn('fx-grain', grain === item.id && 'is-active')} onClick={() => setGrain(item.id)}>{item.label}</button>)}
      </div>
      {loading && <span className="fx-k-hint">刷新中…</span>}
    </div>
    {rows.map((row) => {
      const open = expanded === row.name
      const series = open ? seriesOf(row) : { bars: [], splitIndex: 0 }
      const candles = series.bars
      const labelOf = fxGrainLabel(grain)
      const yesterdayNet = row.yesterday.net
      return <section className="panel admin-card fx-symbol-card" key={row.name}>
        <div className="admin-card-head fx-symbol-head">
          <button className="fx-symbol-toggle" onClick={() => setExpanded(open ? null : row.name)} aria-expanded={open}>
            <span className="fx-settle-name"><i style={{ background: row.color }} />{row.icon} {row.label}<small>{row.name}</small></span>
            <span className="fx-symbol-stats">
              <span>昨收 <b>{row.yesterday.close}</b></span>
              <span className={tone(row.yesterday.move)}>昨日 {fmtPct(row.yesterday.move)}</span>
              <span className={tone(yesterdayNet)}>净额 {yesterdayNet > 0 ? '+' : ''}{yesterdayNet.toLocaleString('zh-CN')}</span>
              <span>成交 {row.yesterday.volume.toLocaleString('zh-CN')}</span>
              <span>今开 <b>{row.today.open}</b></span>
              <span className={tone(row.today.move)}>预计 {fmtPct(row.today.move)}</span>
            </span>
            <span className={cn('fx-symbol-chevron', open && 'is-open')}>▾</span>
          </button>
        </div>
        {open && <div className="fx-symbol-charts">
          <div className="fx-symbol-pane">
            <div className="fx-k-head"><strong>昨日资金流</strong><span>5 分钟 · {row.yesterday.activeBins} 格有成交</span></div>
            <FxFlowBars bins={row.yesterday.bins} height={130} labelOf={(bin) => clockOf(bin.at)} dayLabel={(at) => clockOf(at)} />
            {row.yesterday.coverage < 0.999 && <p className="fx-coverage-warn">
              逐格数据只覆盖 {Math.round(row.yesterday.coverage * 100)}%（{row.yesterday.untrackedNet > 0 ? '+' : ''}{row.yesterday.untrackedNet.toLocaleString('zh-CN')} 净额没有时间桶）。
              这部分是逐格桶上线前的旧流水，日线汇总仍是完整的 {row.yesterday.net.toLocaleString('zh-CN')}。
            </p>}
          </div>
          <div className="fx-symbol-pane">
            <div className="fx-k-head">
              <strong>K 线预测</strong>
              <span>{candles.length ? `${candles.length} 根 · 预测 ${candles.length - series.splitIndex} 根` : '—'}</span>
            </div>
            {candles.length
              ? <FxCandles bars={candles} height={190} labelOf={labelOf} splitIndex={series.splitIndex} defaultZoom={grain === 'm120' ? 30 : grain === 'm60' ? 50 : 60} />
              : <p className="fx-k-empty">无行情数据</p>}
          </div>
        </div>}
      </section>
    })}
  </div>
}

function MerchantChart({ config, maxTrait, maxCombo }) {
  const comboRows = combinations(config.traits).map((combo) => {
    const fish = { traits: combo.map((trait) => trait.id) }
    const pricing = fishQuotePrice({ config }, fish)
    const tier = tierForPrice(config, pricing.total)
    return { combo, total: pricing.total, tier }
  }).sort((a, b) => b.total - a.total)
  // 组合对照按「总价 → 奖励档」的区间分组，默认全部折叠，点区间标题展开。
  const tierGroups = [...config.quotes.tiers]
    .sort((a, b) => a.min - b.min)
    .map((tier) => ({
      key: tier.id,
      label: tier.max === null ? `${tier.min}+` : `${tier.min}–${tier.max}`,
      rows: comboRows.filter((row) => row.tier?.id === tier.id),
    }))
  const noTier = comboRows.filter((row) => !row.tier)
  if (noTier.length) tierGroups.push({ key: 'no-tier', label: '无档位', rows: noTier })
  return <div className="merchant-chart">
    <section className="panel admin-chart">
      <div className="admin-chart-head"><h2>组合报价</h2><span>命中组合时在单价之上叠加</span></div>
      <div className="trait-bars">
        {config.quotes.combos.map((combo) => <div className="trait-bar-row" key={combo.id}>
          <span className="trait-bar-label combo-bar-label">{combo.traits.map((id) => config.traits.find((t) => t.id === id)?.icon).join('')} {combo.name}</span>
          <div className="trait-bar-track"><i style={{ width: `${Math.max(3, (combo.price / maxCombo) * 100)}%`, background: '#7d5ca8' }} /></div>
          <b className="trait-bar-value">+{combo.price}</b>
        </div>)}
        {!config.quotes.combos.length && <p className="admin-empty-line">暂无组合</p>}
      </div>
    </section>
    <section className="panel admin-chart">
      <div className="admin-chart-head"><h2>总价 → 奖励对照</h2><span>按总价落入对应区间</span></div>
      <div className="tier-ladder">
        {[...config.quotes.tiers].sort((a, b) => a.min - b.min).map((tier) => {
          const scratch = config.scratchTypes.find((type) => type.id === tier.scratch.typeId)
          return <div className="tier-row" key={tier.id}>
            <span className="tier-range">{tier.max === null ? `${tier.min}+` : `${tier.min}–${tier.max}`}</span>
            <div className="tier-rewards">
              {tier.tickets.qty > 0 && <span className="tier-chip" style={{ '--chip-color': '#247b82' }}>空白彩票 ×{tier.tickets.qty}</span>}
              {tier.scratch.qty > 0 && <span className="tier-chip" style={{ '--chip-color': scratch?.coatColor || '#2f6f76' }}>{scratch?.name} ×{tier.scratch.qty}</span>}
              {!tier.tickets.qty && !tier.scratch.qty && <span className="tier-chip tier-chip-muted">无奖励</span>}
            </div>
          </div>
        })}
        {!config.quotes.tiers.length && <p className="admin-empty-line">暂无档位</p>}
      </div>
      <div className="pricing-formula">鱼价 = Σ 词条单价 + Σ 命中的组合价</div>
    </section>
    <section className="panel admin-chart">
      <div className="admin-chart-head"><h2>总价 → 词条组合对照</h2><span>{comboRows.length} 种组合 · 按奖励区间折叠</span></div>
      <div className="combo-tier-groups">
        {tierGroups.map((group) => <details className="combo-tier-group" key={group.key}>
          <summary><span className="tier-range">{group.label}</span><small>{group.rows.length} 种组合</small></summary>
          <div className="combo-price-list">
            {group.rows.map((row) => <div className="combo-price-row" key={row.combo.map((trait) => trait.id).join('+')}>
              <span className="combo-prob-traits">{row.combo.map((trait) => <b key={trait.id} style={{ color: trait.color }}>{trait.icon} {trait.label}</b>)}</span>
              <span className="combo-price-total">{row.total}</span>
              <span className="tier-chip" style={{ '--chip-color': '#247b82' }}>{row.tier ? (row.tier.max === null ? `${row.tier.min}+` : `${row.tier.min}–${row.tier.max}`) : '无档位'}</span>
            </div>)}
            {!group.rows.length && <p className="admin-empty-line">该区间暂无组合</p>}
          </div>
        </details>)}
        {!tierGroups.length && <p className="admin-empty-line">暂无档位</p>}
      </div>
    </section>
  </div>
}

export default function AdminPage({ config: savedConfig, configVersion, onConfigSaved }) {
  const [section, setSection] = useState('scratch')
  // 草稿模式：所有编辑只写本地 draft，点「保存配置」才提交到服务端并让所有玩家生效。
  const [draft, setDraft] = useState(() => savedConfig)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // 门禁用错误码而不是文案：AdminGate 需要区分「未绑定 2FA」和「需要再验证一次」。
  const [gate, setGate] = useState('')
  const [notice, setNotice] = useState('')
  const [overview, setOverview] = useState(null)
  const [loadError, setLoadError] = useState('')
  const latestRef = useRef({ config: savedConfig, version: Number(configVersion) || 0 })
  const draftVersionRef = useRef(latestRef.current.version)
  const overviewRequest = useRef(0)

  useEffect(() => {
    for (const [config, version] of [[savedConfig, Number(configVersion)], [overview?.config, overview?.configVersion]]) {
      if (config && version > latestRef.current.version) latestRef.current = { config, version }
    }
    if (!dirty && draftVersionRef.current !== latestRef.current.version) {
      draftVersionRef.current = latestRef.current.version
      setDraft(latestRef.current.config)
    }
  }, [savedConfig, dirty, configVersion, overview])

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const handleGateError = useCallback((err) => {
    if (err.code !== 'TOTP_SETUP_REQUIRED' && err.code !== 'MFA_REQUIRED') return false
    setGate(err.code)
    return true
  }, [])

  const loadOverview = useCallback(async () => {
    const requestId = ++overviewRequest.current
    try {
      const result = await api.adminOverview()
      if (requestId !== overviewRequest.current) return
      setOverview(result)
      setLoadError('')
      setGate('')
    } catch (err) {
      if (requestId !== overviewRequest.current) return
      if (!handleGateError(err)) setLoadError(err.message || '无法读取管理数据')
    }
  }, [handleGateError])

  useEffect(() => { loadOverview() }, [loadOverview, configVersion])

  const patch = (recipe) => {
    setDraft((current) => recipe(current))
    setDirty(true)
    setNotice('')
  }
  const discard = () => {
    draftVersionRef.current = latestRef.current.version
    setDraft(latestRef.current.config)
    setDirty(false)
    setError('')
  }
  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await api.adminSaveConfig(draft, draftVersionRef.current)
      if (result.configVersion >= latestRef.current.version) {
        latestRef.current = { config: result.config, version: result.configVersion }
      }
      draftVersionRef.current = result.configVersion
      setDraft(result.config)
      setDirty(false)
      setNotice('已保存')
      // 把保存后的配置一起回传给父组件：父组件持有同一份状态，
      // 只更新版本号会让它继续拿旧配置覆盖这份草稿。
      onConfigSaved?.(result.configVersion, result.config)
    } catch (err) {
      if (handleGateError(err)) return
      if (err.code === 'CONFIG_CONFLICT') {
        await loadOverview()
        setError('另一处已保存更新。草稿仍保留，点击「载入最新配置」可重新编辑。')
      } else {
        setError(err.message || '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  // 2FA 门禁：服务端已经拦了三层（未登录 / 非管理员 / 未绑定或未验证 2FA），
  // 这里按返回的 code 给出对应界面，避免玩家看到一堆 403。
  if (gate) return gate === 'TOTP_SETUP_REQUIRED' ? <TotpSetupPage onDone={loadOverview} /> : <StepUpPage onDone={loadOverview} />
  if (!overview) return <div className="panel admin-card">
    {loadError ? <>
      <p className="auth-error" role="alert">{loadError}</p>
      <button className="secondary-button" onClick={loadOverview}>重新读取</button>
    </> : <p className="admin-empty-line" role="status">读取中…</p>}
  </div>

  const conflict = dirty && Math.max(Number(configVersion) || 0, overview.configVersion) > draftVersionRef.current
  return <>
    <div className="page-header"><div><h1>管理后台</h1></div></div>
    <div className={cn('admin-savebar', dirty && 'is-dirty')}>
      <span className="admin-savebar-state">{dirty ? '未保存' : '已同步'}</span>
      <div className="admin-savebar-actions">
        <button className="secondary-button" disabled={!dirty || saving} onClick={discard}><RotateCcw size={14} /> {conflict ? '载入最新配置' : '撤销'}</button>
        <button className="primary-button" disabled={!dirty || saving || conflict} onClick={save}><Save size={14} /> {saving ? '保存中…' : '保存配置'}</button>
      </div>
    </div>
    {conflict && !error && <p className="auth-error" role="status">全服配置已有更新。载入后可继续编辑。</p>}
    {(error || loadError || notice) && <p className={error || loadError ? 'auth-error' : 'auth-notice'} role="status">{error || loadError || notice}</p>}
    <div className="admin-tabs" role="tablist">
      {SECTIONS.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={section === id} className={cn('admin-tab', section === id && 'admin-tab-active')} onClick={() => setSection(id)}><Icon size={16} /> {label}</button>)}
      <button role="tab" aria-selected={section === 'users'} className={cn('admin-tab', section === 'users' && 'admin-tab-active')} onClick={() => setSection('users')}><Users size={16} /> 用户</button>
    </div>
    <fieldset disabled={saving} style={{ display: 'contents' }}>
      {section === 'scratch' && <ScratchAdmin config={draft} patch={patch} />}
      {section === 'lottery' && <LotteryAdmin config={draft} patch={patch} />}
      {section === 'rod' && <RodAdmin config={draft} patch={patch} />}
      {section === 'trait' && <TraitAdmin config={draft} patch={patch} />}
      {section === 'depth' && <DepthAdmin config={draft} patch={patch} />}
      {section === 'merchant' && <MerchantAdmin config={draft} patch={patch} />}
      {section === 'fx' && <FxAdmin config={draft} patch={patch} onRefresh={loadOverview} onGateError={handleGateError} />}
      {section === 'black' && <BlackMarketAdmin config={draft} patch={patch} />}
      {section === 'machine' && <MachineAdmin config={draft} patch={patch} />}
      {section === 'guide' && <GuideAdmin config={draft} patch={patch} />}
      {section === 'users' && <UsersAdmin overview={overview} me={overview.me} onRefresh={loadOverview} onGateError={handleGateError} />}
    </fieldset>
  </>
}

// 用户管理：角色、重置 2FA、强制下线，以及最近的审计记录。
function UsersAdmin({ overview, me, onRefresh, onGateError }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const act = async (id, fn, confirmation) => {
    if (busyId !== null || (confirmation && !window.confirm(confirmation))) return
    setBusyId(id)
    setError('')
    try {
      await fn()
      await onRefresh()
    } catch (err) {
      if (!onGateError(err)) setError(err.message || '操作失败')
    } finally {
      setBusyId(null)
    }
  }
  return <>
    <SectionHead title="用户" count={`${overview.users.length} 个账号`} />
    <section className="panel admin-card">
      <div className="admin-sync">
        <Users size={15} /><span>角色变更 / 重置 2FA / 强制下线</span>
        <b>{overview.stats.players} 玩家</b><b>{overview.stats.sessions} 在线会话</b>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="admin-user-list">
        {overview.users.map((item) => <div className="admin-user-row" key={item.id}>
          <div>
            <strong>{item.username}{item.id === me.id ? '（我）' : ''}</strong>
            <small>{item.role === 'admin' ? '管理员' : '玩家'} · {item.totpEnabled ? '2FA 已启用' : '2FA 未启用'} · {item.emailVerified ? `邮箱 ${item.email}` : '邮箱未验证'} · 注册 {new Date(item.createdAt).toLocaleDateString('zh-CN')}</small>
            <small className="admin-user-stats">鱼币 {Number(item.coins || 0).toLocaleString('zh-CN')} · 未刮刮刮乐 {item.scratchCards || 0} 张 · 空白彩票 {item.blankTickets || 0} 张</small>
          </div>
          <StatusPill tone={item.role === 'admin' ? 'warning' : 'neutral'}>{item.role === 'admin' ? '管理员' : '玩家'}</StatusPill>
          <div className="auth-actions">
            {item.role === 'admin'
              ? <button className="secondary-button" disabled={item.id === me.id || busyId !== null} onClick={() => act(item.id, () => api.adminSetRole(item.id, 'player'), `将 ${item.username} 降为玩家并结束其所有会话？`)}>降为玩家</button>
              : <button className="secondary-button" disabled={busyId !== null} onClick={() => act(item.id, () => api.adminSetRole(item.id, 'admin'), `将 ${item.username} 提升为管理员？`)}>提升为管理员</button>}
            <button className="secondary-button" disabled={!item.totpEnabled || busyId !== null} onClick={() => act(item.id, () => api.adminReset2fa(item.id), `重置 ${item.username} 的两步验证并结束其所有会话？`)}>重置 2FA</button>
            <button className="secondary-button danger" disabled={item.id === me.id || busyId !== null} onClick={() => act(item.id, () => api.adminLogoutUser(item.id), `结束 ${item.username} 的所有会话？`)}>强制下线</button>
          </div>
        </div>)}
      </div>
    </section>

    <SectionHead title="最近操作" count={`${overview.audit.length} 条`} />
    <section className="panel admin-card">
      <div className="admin-table">
        <div className="admin-table-head admin-audit-head"><span>操作</span><span>账号</span><span>时间</span></div>
        {overview.audit.map((row) => <div className="admin-table-row admin-audit-row" key={row.id}>
          <span>{row.action}{row.detail ? ` · ${row.detail}` : ''}</span>
          <span>{row.username || '—'}</span>
          <span>{new Date(row.at).toLocaleString('zh-CN')}</span>
        </div>)}
        {!overview.audit.length && <p className="admin-empty-line">暂无操作记录</p>}
      </div>
    </section>
  </>
}
