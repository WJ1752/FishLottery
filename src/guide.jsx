import { useEffect, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { guidePendingCard, guideStepIndex, guideUnlockedStage } from './game.js'

// 逐个解锁的展示层。
//
// 规则：
// 1) 每条引导只显示一次：读过就落 seen（服务端），刷新/重登/换设备都不再出现；
// 2) 介绍卡必须停留 minCloseMs（默认 3 秒）才允许关闭；倒计时用服务端记下的起点，
//    刷新页面不会把 3 秒清零；
// 3) 多页导览共用同一个倒计时，可以逐页阅读或关闭。

export const STEP_LABELS = {
  tension: '钓鱼',
  npc: '潮汐商会',
  rodUpgrade: '钓竿强化',
  scratch: '刮刮乐',
  lottery: '彩票中心',
  rodPower: '钓竿成长',
  fx: '深海FX',
  stats: '航海日志',
  rodGuide: '钓竿与背包',
}

// 步骤 → 页内锚点（与页面的 data-guide-anchor 对应）。
// 页内锚点：钓竿相关的高亮都落在钓鱼页（钓竿面板从那里唤出）。
export const GUIDE_ANCHOR_MAP = {
  npc: ['exchange'],
  rodUpgrade: ['durability'],
  scratch: ['cards'],
  lottery: ['pool'],
  rodPower: ['durability'],
  fx: ['quotes'],
}

export const GUIDE_TAB_OF = { npc: 'npc', rodUpgrade: 'fishing', scratch: 'scratch', lottery: 'lottery', rodPower: 'fishing', fx: 'fx' }

const guideOf = (state) => state?.guide || {}
const seenOf = (state) => guideOf(state).seen || {}

// 说明卡的选取逻辑放在 game.js（纯函数、可单测），这里只负责渲染。
export const pendingGuideCard = guidePendingCard

// 页内高亮：某一步解锁后，把「下一步该点的东西」标出来。
export function GuideSpotlight({ state, anchor }) {
  const guide = guideOf(state)
  const hits = Object.keys(guide.focus || {}).filter((stepId) => !seenOf(state)[stepId] && guide.focus[stepId])
  if (!hits.length) return null
  const stepId = hits[0]
  if (!(GUIDE_ANCHOR_MAP[stepId] || []).includes(anchor)) return null
  return <div className="guide-spotlight" data-step={stepId} aria-hidden="true"><ChevronRight size={14} /></div>
}

// 导航红点：该页签已解锁、但对应引导还没读过时显示。
export function GuideNewBadge({ state, tabId }) {
  if (state.config?.guide?.enabled === false || guideOf(state).skipped) return null
  const stepId = Object.keys(GUIDE_TAB_OF).find((id) => GUIDE_TAB_OF[id] === tabId)
  if (!stepId || seenOf(state)[stepId]) return null
  if (guideStepIndex(stepId) >= guideUnlockedStage(state)) return null
  return <span className="nav-new" aria-label="新解锁的功能">新</span>
}

// 开场只讲当前操作、得到鱼获后的去处与后续升级。
export const FISHING_TOUR = [
  {
    anchor: 'progress',
    title: '等待首条鱼获',
    text: '钓鱼会自动进行。进度充满后，鱼获会放入仓库。点「暂停钓鱼」可以收竿休息。',
  },
  {
    anchor: 'tension',
    title: '张力与钓竿',
    text: '张力先到上限时，鱼会挣脱。用「钓竿与强化」提升速度和最大张力，也可以维修、换竿。',
  },
  {
    anchor: 'result',
    title: '把鱼带回商会',
    text: '钓获首条鱼后，点击「去商会兑换」领取票券与材料。航海日志会记录你发现的鱼种。',
  },
]

// 把每页的停留时间统一为 minCloseMs；「下一步」在倒计时结束前不可点。
export function GuideDeck({ title, pages, stepId, minCloseMs = 0, expiresAt, clockOffset = 0, onSeen, onSkip, icon }) {
  const [index, setIndex] = useState(0)
  const [localDeadline] = useState(() => Date.now() + minCloseMs)
  const deadline = Number(expiresAt) > 0 ? expiresAt - clockOffset : localDeadline
  const [left, setLeft] = useState(() => secondsLeft(deadline))
  useEffect(() => {
    const tick = () => setLeft(secondsLeft(deadline))
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [deadline])
  const page = pages[Math.min(index, pages.length - 1)] || { title: '', text: '' }
  const last = index >= pages.length - 1
  const ready = left <= 0
  const finish = () => { if (ready) onSeen?.(stepId) }
  const next = () => { if (!ready) return; if (last) finish(); else setIndex((value) => value + 1) }
  return <section className="guide-card guide-deck" role="region" aria-label={title} data-step={stepId}>
    <div className="guide-card-head">
      <div className="guide-card-title">{icon}<h3>{title}</h3></div>
      <button className="guide-card-close" onClick={finish} disabled={!ready}
        aria-label={!ready ? `还需 ${left} 秒才能关闭` : '关闭说明'}
        title={!ready ? `${left} 秒后可关闭` : '关闭'}>
        {ready ? <X size={15} /> : <span>{left}</span>}
      </button>
    </div>
    <div className="guide-card-body">
      {page.title && <p className="guide-deck-title">{page.title}</p>}
      <p className="guide-deck-text">{page.text}</p>
    </div>
    <div className="guide-card-foot">
      <span className="guide-card-tip">{pages.length > 1 ? `${index + 1} / ${pages.length}` : ''}{!ready && ` · ${left} 秒后可继续`}</span>
      <div className="guide-card-actions">
        <button className="secondary-button tiny" onClick={next} disabled={!ready}>{last ? '知道了' : '下一步'}</button>
        {onSkip && <button className="text-button" onClick={onSkip}>跳过全部</button>}
      </div>
    </div>
    <p className="sr-only" aria-live="polite">{ready ? '现在可以继续了' : `还需 ${left} 秒`}</p>
  </section>
}

// 单页说明卡（L2 赠币、L3 材料来源、L6、钓竿页等）。
export function GuideCard({ title, body, stepId, expiresAt, minCloseMs, clockOffset, onSeen, onSkip, icon }) {
  return <GuideDeck
    title={title}
    pages={[{ title: '', text: body }]}
    stepId={stepId}
    minCloseMs={minCloseMs}
    expiresAt={expiresAt}
    clockOffset={clockOffset}
    onSeen={onSeen}
    onSkip={onSkip}
    icon={icon}
  />
}

// 每页共用同一个服务端起点：到点后每一页都可以继续，刷新也不会把倒计时清零。
function secondsLeft(expiresAt) {
  return Math.max(0, Math.ceil(((Number(expiresAt) || 0) - Date.now()) / 1000))
}
