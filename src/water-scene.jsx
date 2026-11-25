import React, { useLayoutEffect, useRef, useState } from 'react'
import { BOBBER_X, BOBBER_Y, WATER_HEIGHT, WATER_WIDTH, createSeaBase, drawChart, drawSea } from './water-art.js'
import './water-scene.css'

const CAMERA_X = .56
const CAMERA_Y = .52

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
    const locateFloat = () => {
      const { width, height } = water.getBoundingClientRect()
      const scale = Math.max(width / WATER_WIDTH, height / WATER_HEIGHT)
      const x = BOBBER_X * scale - (WATER_WIDTH * scale - width) * CAMERA_X
      const y = BOBBER_Y * scale - (WATER_HEIGHT * scale - height) * CAMERA_Y
      water.style.setProperty('--float-x', `${x}px`)
      water.style.setProperty('--float-y', `${y}px`)
    }
    locateFloat()
    const observer = new ResizeObserver(locateFloat)
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
      drawSea(ctx, image, time, { running, reeling, tensionLevel, event: kind, reducedMotion: reduced() })
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

  return <div className="water-scene" ref={waterRef} style={{ '--camera-x': `${CAMERA_X * 100}%`, '--camera-y': `${CAMERA_Y * 100}%` }}>
    <canvas ref={canvasRef} width={WATER_WIDTH} height={WATER_HEIGHT} aria-hidden="true" />
    {unavailable && !still && <span className="water-render-note" role="status">海面画面暂不可用</span>}
    {children}
  </div>
}

const CHART_POINTS = {
  shore: [15, 55],
  shelf: [29, 28],
  open: [43, 65],
  deep: [56, 38],
  rift: [70, 63],
  abyss: [84, 34],
}

export function SeaChart({ stops, inspectedId, onInspect }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const ctx = contextFor(ref.current)
    if (ctx) drawChart(ctx, Object.values(CHART_POINTS))
  }, [])

  return <div className="water-chart" role="group" aria-label="海图站点">
    <canvas ref={ref} width={WATER_WIDTH} height={280} aria-hidden="true" />
    {stops.map(({ depth, status, current, unlocked }) => {
      const [x, y] = CHART_POINTS[depth.id]
      return <button key={depth.id} type="button" className="water-chart-stop" style={{ '--map-x': `${x}%`, '--map-y': `${y}%` }}
        aria-pressed={depth.id === inspectedId} aria-current={current ? 'location' : undefined}
        data-unlocked={unlocked} onClick={() => onInspect(depth.id)}>
        <strong>{depth.label}</strong><small>{status}</small>
      </button>
    })}
  </div>
}
