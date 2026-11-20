import React, { memo } from 'react'
import { ArrowRight, Check, ClipboardList, Compass, Fish, Unlock } from 'lucide-react'
import { DEPTHS, canUnlockDepth, depthSurvey, depthUnlockCost, guideRodUpgradeCount, rodConfigFor } from './game.js'
import { fishPoolFor } from './traits.js'
import './first-voyage.css'

const FIRST_SURVEY_DEPTH = DEPTHS.find((depth) => depth.unlock)?.id

export function firstVoyageSteps(state) {
  return [
    { id: 'catch', title: '钓到第一条鱼', complete: state.stats?.totalCatches > 0 },
    { id: 'sell', title: '兑换一次鱼获', complete: state.stats?.totalSold > 0 },
    { id: 'upgrade', title: '强化一次钓竿', complete: guideRodUpgradeCount(state) > 0 },
  ]
}

export function showFirstVoyage(steps, nextDepth, guideEnabled) {
  return guideEnabled && (nextDepth?.id === FIRST_SURVEY_DEPTH || steps.some(({ complete }) => !complete))
}

export const FirstVoyageContract = memo(function FirstVoyageContract({ steps, running, merchantAvailable, canStart, onToggle, onOpenMerchant, onOpenDrawer }) {
  const current = steps.find(({ complete }) => !complete)?.id
  const actions = {
    catch: {
      hint: running ? '等待鱼获入库，回来就能看到这一步完成。' : '开始垂钓，第一条鱼入库后即可带去兑换。',
      label: running ? null : '开始垂钓',
      onClick: onToggle,
      disabled: !canStart,
    },
    sell: {
      hint: merchantAvailable ? '把鱼获交给潮汐商会，换取票券和材料。' : '继续垂钓，等潮汐商会开放后就能兑换。',
      label: merchantAvailable ? '去潮汐商会' : null,
      onClick: onOpenMerchant,
    },
    upgrade: { hint: '选择一项可用的强化，为下一片海域做准备。', label: '去强化钓竿', onClick: onOpenDrawer },
  }
  const action = actions[current]
  return <section className="panel first-voyage-panel" aria-labelledby="first-voyage-title">
    <header className="first-voyage-head">
      <h2 id="first-voyage-title"><ClipboardList size={18} aria-hidden="true" />首航委托</h2>
      {current ? <span>完成 {steps.filter(({ complete }) => complete).length} / {steps.length}</span> : <span className="first-voyage-complete"><Check size={15} aria-hidden="true" />首航完成</span>}
    </header>
    <ol className="first-voyage-checkpoints">
      {steps.map(({ id, title, complete }, index) => <li key={id} data-complete={complete} aria-current={id === current ? 'step' : undefined}>
        <span className="first-voyage-step-mark" aria-hidden="true">{complete ? <Check size={13} /> : index + 1}</span>
        <span>{title}{complete && <span className="sr-only">，已完成</span>}</span>
      </li>)}
    </ol>
    {action && <div className="first-voyage-action">
      <p>{action.hint}</p>
      {action.label && <button type="button" className="primary-button" disabled={action.disabled} onClick={action.onClick}>{action.label}<ArrowRight size={15} aria-hidden="true" /></button>}
    </div>}
  </section>
})

export const NextVoyage = memo(function NextVoyage({ state, depth, busy, canStart, onToggle, onAction }) {
  const survey = depthSurvey(state, depth.id)
  const source = DEPTHS.find(({ id }) => id === survey?.fromId)
  const price = depthUnlockCost(state, depth.id)
  const canUnlock = canUnlockDepth(state, depth.id)
  const investigating = source?.id === state.fishing.selectedDepthId
  const surveyRod = state.config?.rods?.find(({ id }) => id === survey?.rodId)
  const earnsRod = surveyRod && !state.rods?.some((rod) => rodConfigFor(state.config, rod).id === surveyRod.id)
  const owned = price ? state.inventory?.[price.material] || 0 : 0
  const coins = state.coins || 0
  return <section className="panel first-voyage-panel first-voyage-route" aria-labelledby="next-voyage-title">
    <header className="first-voyage-head">
      <h2 id="next-voyage-title"><Compass size={18} aria-hidden="true" />下一站 · {depth.label}</h2>
      <span>{depth.riskLabel}</span>
    </header>
    {survey && source && <div className="first-voyage-survey">
      <div>
        <span>{survey.rewarded ? `${source.label}调查已完成` : `在${source.label}钓获 ${survey.target} 条鱼`}</span>
        <strong>{Math.min(survey.caught, survey.target)} / {survey.target}</strong>
      </div>
      <progress aria-label={`${source.label}调查进度`} value={Math.min(survey.caught, survey.target)} max={survey.target} />
      {!survey.rewarded && price && <p>完成调查可获得 {price.material} ×{price.cost}{earnsRod && ` 和「${surveyRod.name}」`}。</p>}
    </div>}
    {price && <p className="first-voyage-cost">解锁物资 {price.material} {Math.min(owned, price.cost)}/{price.cost} · 鱼币 {Math.min(coins, price.coins).toLocaleString('zh-CN')}/{price.coins.toLocaleString('zh-CN')}</p>}
    <div className="first-voyage-species"><span><Fish size={14} aria-hidden="true" />可钓鱼种</span>
      <ul aria-label={`${depth.label}可钓鱼种`}>{fishPoolFor(depth.id).map((fish) => <li key={fish.id}>{fish.name}</li>)}</ul>
    </div>
    {canUnlock ? <button type="button" className="primary-button first-voyage-route-button" disabled={busy} onClick={() => onAction('unlockDepth', { depthId: depth.id }, `已解锁${depth.label}`)}><Unlock size={15} aria-hidden="true" />解锁{depth.label}</button>
      : source && !survey.rewarded && (!investigating || !state.fishing.running) && <button type="button" className="secondary-button first-voyage-route-button" disabled={investigating ? !canStart : busy} onClick={() => investigating ? onToggle() : onAction('selectDepth', { depthId: source.id }, `已切换至${source.label}`)}>
        {investigating ? '开始调查' : `前往${source.label}调查`}<ArrowRight size={15} aria-hidden="true" />
      </button>}
  </section>
})
