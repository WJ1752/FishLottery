import React, { useEffect, useRef, useState } from 'react'
import { BookOpen, Fish, Unlink, Waves } from 'lucide-react'
import { fishArt } from './art.js'
import { playGameCue, primeGameAudio } from './game-audio.js'
import './fishing-feedback.css'

const LIVE_SYNC_WINDOW = 3500
const presentation = {
  bite: { label: '有鱼咬钩', Icon: Waves, duration: 1450 },
  landed: { label: '起鱼入库', Icon: Fish, duration: 1950 },
  escape: { label: '鱼已脱钩', Icon: Unlink, duration: 2100 },
  discovery: { label: '首次发现 · 已登记图鉴', Icon: BookOpen, duration: 4600 },
}

function observeFishing(state, at) {
  const { fishing, stats } = state
  const bite = fishing.running && fishing.phase === 'reeling' ? fishing.bite : null
  const outcome = fishing.lastOutcome
  return {
    at,
    bite,
    biteId: bite?.fish?.id,
    outcome,
    outcomeId: outcome?.fish?.id,
    species: stats?.speciesSeen || {},
    catches: Number(stats?.totalCatches) || 0,
  }
}

function fishingEvent(previous, current, fish) {
  const changedOutcome = current.outcomeId && current.outcomeId !== previous.outcomeId
  const resolvedAt = current.outcome?.at
  const outcomeAt = typeof resolvedAt === 'number' ? resolvedAt : Date.parse(resolvedAt)
  const freshOutcome = changedOutcome && outcomeAt >= previous.at && outcomeAt <= current.at
  const discovered = Object.keys(current.species).filter((id) => Number(current.species[id]) > 0 && !(Number(previous.species[id]) > 0))
  if (current.catches > previous.catches && discovered.length > 0) {
    const latest = current.outcome?.fish
    const discoveredFish = freshOutcome && !current.outcome.escaped && discovered.includes(latest.speciesClass)
      ? latest
      : fish?.find((item) => discovered.includes(item.speciesClass))
    if (discoveredFish) return { kind: 'discovery', id: discoveredFish.id, fish: discoveredFish, others: discovered.length - 1 }
  }
  if (freshOutcome) return { kind: current.outcome.escaped ? 'escape' : 'landed', id: current.outcomeId, fish: current.outcome.fish }
  const biteAt = Number(current.bite?.startedAt)
  if (current.biteId && current.biteId !== previous.biteId && biteAt >= previous.at && biteAt <= current.at) {
    return { kind: 'bite', id: current.biteId }
  }
  return null
}

// 在游戏壳上持续跟踪快照。切换页签、后台补算和登录前的存档只更新基线。
export function useFishingFeedback(state, { active, snapshotAt, suppress = false }) {
  const observed = useRef(null)
  const resumeAfterHidden = useRef(false)
  const discoveryUntil = useRef(0)
  const [event, setEvent] = useState(null)

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return
      resumeAfterHidden.current = true
      discoveryUntil.current = 0
      setEvent(null)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (!active) return undefined
    window.addEventListener('pointerup', primeGameAudio)
    window.addEventListener('keydown', primeGameAudio)
    return () => {
      window.removeEventListener('pointerup', primeGameAudio)
      window.removeEventListener('keydown', primeGameAudio)
    }
  }, [active])

  useEffect(() => {
    if (!active || suppress) {
      discoveryUntil.current = 0
      setEvent(null)
    }
    if (!state?.fishing || !snapshotAt) return
    const current = observeFishing(state, snapshotAt)
    const previous = observed.current
    if (previous && current.at === previous.at && current.biteId === previous.biteId && current.outcomeId === previous.outcomeId && current.catches === previous.catches) return
    observed.current = current
    const skipResumed = resumeAfterHidden.current
    if (!document.hidden) resumeAfterHidden.current = false
    if (!previous || !active || suppress || document.hidden || skipResumed || current.at < previous.at || current.at - previous.at > LIVE_SYNC_WINDOW || current.catches < previous.catches) return

    const next = fishingEvent(previous, current, state.fish)
    if (!next) return
    const now = Date.now()
    if (next.kind !== 'discovery' && now < discoveryUntil.current) return
    if (next.kind === 'discovery') discoveryUntil.current = now + presentation.discovery.duration
    setEvent(next)
    playGameCue(`fishing-${next.kind}`)
  }, [active, snapshotAt, state, suppress])

  useEffect(() => {
    if (!event) return undefined
    const id = window.setTimeout(() => setEvent(null), presentation[event.kind].duration)
    return () => window.clearTimeout(id)
  }, [event])

  return active && !suppress ? event : null
}

export function FishingFeedback({ event, running, reeling, tensionLevel }) {
  const card = event && presentation[event.kind]
  const discovery = event?.kind === 'discovery'
  const fishName = event?.fish?.name
  const otherSpecies = event?.others ? ` · 另 ${event.others} 种` : ''
  return <>
    {(running || event) && <div className="fishing-feedback" aria-hidden="true">
      <span className="fishing-feedback-pointer" />
      <div className="fishing-feedback-card" data-kind={event?.kind} data-tension={tensionLevel} data-specimen={Boolean(fishName)}>
        {discovery ? <img src={fishArt(event.fish)} alt="" width="34" height="30" decoding="async" /> : card && <card.Icon size={14} />}
        <span>
          <span>{card?.label || (reeling ? '鱼线绷紧' : '等待咬钩')}</span>
          {fishName && <strong>{fishName}{otherSpecies}</strong>}
        </span>
      </div>
    </div>}
    <div className="sr-only" role="status">{card ? `${card.label}${fishName ? ` · ${fishName}${otherSpecies}` : ''}` : ''}</div>
  </>
}
