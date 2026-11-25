import React, { memo } from 'react'
import { ArrowRight, Check, ChevronRight, Fish, Unlock } from 'lucide-react'
import { DEPTHS, canUnlockDepth, depthSurvey, depthUnlockCost, guideRodUpgradeCount, rodConfigFor } from './game.js'
import { fishPoolFor } from './traits.js'
import './first-voyage.css'

const FIRST_SURVEY_DEPTH = DEPTHS.find((depth) => depth.unlock)?.id

export function firstVoyageSteps(state) {
  return [
    { id: 'catch', title: '首次钓获', complete: state.stats?.totalCatches > 0 },
    { id: 'sell', title: '首次商会兑换', complete: state.stats?.totalSold > 0 },
    { id: 'upgrade', title: '首次强化', complete: guideRodUpgradeCount(state) > 0 },
  ]
}

export function showFirstVoyage(steps, nextDepth, guideEnabled) {
  return guideEnabled && (nextDepth?.id === FIRST_SURVEY_DEPTH || steps.some(({ complete }) => !complete))
}

export const FirstVoyageContract = memo(function FirstVoyageContract({ steps, running, merchantAvailable, canStart, onToggle, onOpenMerchant, onOpenDrawer }) {
  const current = steps.find(({ complete }) => !complete)?.id
  const actions = {
    catch: !running && { label: '首次钓获，开始垂钓', onClick: onToggle, disabled: !canStart },
    sell: merchantAvailable && { label: '首次商会兑换，前往潮汐商会', onClick: onOpenMerchant },
    upgrade: { label: '首次强化，打开钓竿与强化', onClick: onOpenDrawer },
  }
  return <section className="first-voyage-slip" aria-labelledby="first-voyage-title">
    <header className="first-voyage-head">
      <h2 id="first-voyage-title">首航委托</h2>
      <span>{steps.filter(({ complete }) => complete).length} / {steps.length}</span>
    </header>
    <ol className="first-voyage-checkpoints">
      {steps.map(({ id, title, complete }) => {
        const action = current === id && actions[id]
        return <li key={id} data-complete={complete} aria-current={id === current ? 'step' : undefined}>
          <span className="first-voyage-step-mark" aria-hidden="true">{complete ? <Check size={13} /> : id === current ? <ChevronRight size={13} /> : '·'}</span>
          {action
            ? <button type="button" aria-label={action.label} disabled={action.disabled} onClick={action.onClick}>{title}<ArrowRight size={12} aria-hidden="true" /></button>
            : <span>{title}{complete && <span className="sr-only">，已完成</span>}</span>}
        </li>
      })}
    </ol>
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
  return <section className="first-voyage-route" aria-label={`${depth.label}调查与物资`}>
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
