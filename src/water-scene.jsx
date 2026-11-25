import React, { useLayoutEffect, useRef, useState } from 'react'
import { BOBBER_X, BOBBER_Y, FISHER_X, WATER_HEIGHT, WATER_WIDTH, createSeaBase, drawChart, drawSea } from './water-art.js'
import './water-scene.css'

function contextFor(canvas) {
  try { return canvas.getContext('2d') }
  catch { return null }
}

export function WaterScene({ depthId = 'shore', running = false, reeling = false, tensionLevel = 'safe', event, still = false, children }) {
  const waterRef = useRef(null)
  const canvasRef = useRef(null)
  const baseRef = useRef(null)
  const [unavailable, setUnavailable] = useState(false)
  const kind = event?.kind

  useLayoutEffect(() => {
    const water = waterRef.current
    const frameScene = () => {
      const { width, height } = water.getBoundingClientRect()
      const scale = Math.max(width / WATER_WIDTH, height / WATER_HEIGHT)
      const sceneWidth = WATER_WIDTH * scale
      const sceneHeight = WATER_HEIGHT * scale
      const actionCenter = (FISHER_X + BOBBER_X) / 2
      const left = Math.max(0, Math.min(sceneWidth - width, actionCenter * scale - width / 2))
      const top = Math.max(0, (sceneHeight - height) * .65)
      water.style.setProperty('--scene-width', `${sceneWidth}px`)
      water.style.setProperty('--scene-height', `${sceneHeight}px`)
      water.style.setProperty('--scene-left', `${-left}px`)
      water.style.setProperty('--scene-top', `${-top}px`)
      water.style.setProperty('--float-x', `${BOBBER_X * scale - left}px`)
      water.style.setProperty('--float-y', `${BOBBER_Y * scale - top}px`)
    }
    frameScene()
    const observer = new ResizeObserver(frameScene)
    observer.observe(water)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = contextFor(canvas)
    if (ctx && baseRef.current?.depthId !== depthId) baseRef.current = { depthId, image: createSeaBase(depthId) }
    const image = baseRef.current?.image
    if (!ctx || !image) {
      setUnavailable(true)
      return undefined
    }
    setUnavailable(false)

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = true
    let frame = 0
    let lastPaint = -Infinity

    const reduced = () => !running || still || motion.matches
    const paint = (time) => {
      lastPaint = time
      drawSea(ctx, image, time, { depthId, running, reeling, tensionLevel, event: kind, reducedMotion: reduced() })
    }
    const tick = (time) => {
      if (time - lastPaint >= 68) paint(time)
      frame = window.requestAnimationFrame(tick)
    }
    const refresh = () => {
      window.cancelAnimationFrame(frame)
      if (!visible || document.hidden) return
      paint(performance.now())
      if (!reduced()) frame = window.requestAnimationFrame(tick)
    }

    if (still) {
      paint(0)
      return undefined
    }
    refresh()

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      refresh()
    })
    observer.observe(canvas)
    document.addEventListener('visibilitychange', refresh)
    motion.addEventListener('change', refresh)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', refresh)
      motion.removeEventListener('change', refresh)
    }
  }, [depthId, kind, reeling, running, still, tensionLevel])

  return <div className="water-scene" ref={waterRef}>
    <canvas ref={canvasRef} width={WATER_WIDTH} height={WATER_HEIGHT} aria-hidden="true" />
    {unavailable && !still && <span className="water-render-note" role="status">海面画面暂不可用</span>}
    {children}
  </div>
}

const CHART_POINTS = {
  shore: [15, 58],
  shelf: [29, 32],
  open: [43, 67],
  deep: [56, 41],
  rift: [70, 72],
  abyss: [85, 42],
}

function stationRoute({ unlocked, canUnlock, status }) {
  if (unlocked) return 'open'
  return canUnlock || status === '调查中' ? 'survey' : 'locked'
}

export function SeaChart({ stops, inspectedId, onInspect }) {
  const ref = useRef(null)
  const route = stops.map(stationRoute).join(' ')
  useLayoutEffect(() => {
    const ctx = contextFor(ref.current)
    if (!ctx) return undefined
    const root = document.documentElement
    const paint = () => drawChart(ctx, Object.values(CHART_POINTS), route.split(' '), root.dataset.theme)
    paint()
    const observer = new MutationObserver(paint)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [route])

  return <div className="water-chart" role="group" aria-label="海图站点">
    <canvas ref={ref} width={WATER_WIDTH} height={280} aria-hidden="true" />
    {stops.map((stop) => {
      const { depth, status, current } = stop
      const [x, y] = CHART_POINTS[depth.id]
      return <button key={depth.id} type="button" className="water-chart-stop" style={{ '--map-x': `${x}%`, '--map-y': `${y}%` }}
        aria-pressed={depth.id === inspectedId} aria-current={current ? 'location' : undefined}
        data-route={stationRoute(stop)} onClick={() => onInspect(depth.id)}>
        <strong>{depth.label}</strong><small>{status}</small>
      </button>
    })}
    <div className="water-chart-key" aria-label="航线图例">
      <span data-route="open">已通航</span><span data-route="survey">调查／解锁</span><span data-route="locked">待解锁</span>
    </div>
  </div>
}
