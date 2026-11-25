import React, { useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react'

// 深海FX 图表渲染层（只画，不算）。
//
// 重要：这个文件里**不能出现任何价格公式**。蜡烛的开高低收、成交量、
// 甚至「哪些分钟算已走完」都由服务端算好后下发（server/services/fx-snapshot.js），
// 前端只负责把数字画成图形。此前这里 import 了 fxMinutePath / fxDayMove 等
// 纯函数，那些算法会跟着 bundle 一起发到浏览器，等于把公式公开。

// 档位定义与蜡烛解码都在 fx-grains.js（纯配置与格式转换，不含价格算法）。
export { FX_GRAINS, FX_GRAIN_BY_ID, FX_DEFAULT_GRAIN, decodeCandleRows, encodeCandleRows, fxGrainLabel, fxLockedGrains } from './fx-grains.js'

export const cn = (...values) => values.filter(Boolean).join(' ')

export const fmtPrice = (value) => (Math.round(Number(value) * 100) / 100).toLocaleString('zh-CN')
export const fmtPct = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
export const clampNum = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0))

// 可缩放拖动的 K 线图：主图蜡烛（红涨绿跌）+ 底部成交量。
// Alt+滚轮缩放、拖动平移，也可用按钮操作。
export function FxCandles({ bars, height = 200, labelOf, defaultZoom = 1, splitIndex = -1, splitLabel = '预测' }) {
  const wrapRef = useRef(null)
  const readoutId = useId()
  const [view, setView] = useState({ start: 0, count: 0 })
  const [hover, setHover] = useState(null)
  const [drag, setDrag] = useState(null)
  const [keyboardActive, setKeyboardActive] = useState(false)
  const total = bars.length

  useEffect(() => {
    if (!total) { setView({ start: 0, count: 0 }); return }
    setView(() => {
      const count = Math.max(1, Math.min(total, Math.round(defaultZoom)))
      return { start: Math.max(0, total - count), count }
    })
  }, [total, defaultZoom])

  const count = view.count || total
  const start = Math.min(Math.max(0, view.start), Math.max(0, total - count))
  const visible = bars.slice(start, start + count)
  // 注意：这里不能提前 return —— 后面还有 useEffect（滚轮监听）。
  // 提前 return 会让 Hook 数量随「有没有数据」变化，触发 React #310。
  const empty = visible.length === 0

  const priceH = height - 46
  // 没有数据时用 0 兜底：空数组上的 Math.max/min 会得到 ±Infinity，
  // 后面算比例会变成 NaN，虽然最终会走 empty 分支，但提前算干净更安全。
  const max = visible.length ? Math.max(...visible.map((bar) => bar.high)) : 0
  const min = visible.length ? Math.min(...visible.map((bar) => bar.low)) : 0
  const padding = max > min ? (max - min) * 0.12 : Math.max(0.02, Math.abs(max) * 0.01)
  const priceMin = Math.max(0, min - padding)
  const priceMax = max + padding
  const span = priceMax - priceMin
  const priceGuides = [1, 0.5, 0].map((ratio) => priceMin + span * ratio)
  const maxVol = Math.max(...visible.map((bar) => bar.volume), 1)
  const yOf = (price) => priceH - ((price - priceMin) / span) * (priceH - 10) - 5
  const slotW = 100 / visible.length
  const bodyW = slotW * 0.62
  const inspected = visible.findIndex((bar) => bar.key === hover)
  const active = visible[inspected] || visible.at(-1)
  const inspectionX = inspected >= 0 ? (inspected + 0.5) * slotW : null

  // 历史段与预测段之间的分界线：只有落在可见窗口里时才画。
  const splitX = splitIndex > start && splitIndex < start + count ? (splitIndex - start) * slotW : null
  const separator = splitX != null ? <>
    <line x1={splitX} x2={splitX} y1={3} y2={height - 26} className="fx-k-split" vectorEffect="non-scaling-stroke" />
    <text x={splitX + 1.2} y={11} className="fx-k-split-label">{splitLabel}</text>
  </> : null

  // React 的 onWheel 是 passive 的，preventDefault 不会生效，页面照样滚。
  useEffect(() => {
    const node = wrapRef.current
    if (!node) return undefined
    const handle = (event) => {
      if (!event.altKey) return
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      if (!rect.width) return
      const ratio = clampNum((event.clientX - rect.left) / rect.width, 0, 1)
      const factor = event.deltaY > 0 ? 1.25 : 0.8
      setView((current) => {
        const size = current.count || total
        const nextCount = Math.round(clampNum(size * factor, 1, Math.max(1, total)))
        const anchor = current.start + Math.round(ratio * size)
        const nextStart = Math.round(anchor - ratio * nextCount)
        return { start: Math.round(clampNum(nextStart, 0, Math.max(0, total - nextCount))), count: nextCount }
      })
    }
    node.addEventListener('wheel', handle, { passive: false })
    return () => node.removeEventListener('wheel', handle)
  }, [total])

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    inspectAt(event.clientX)
    setDrag({ x: event.clientX, start })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event) => {
    if (!drag) { inspectAt(event.clientX); return }
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    const moved = Math.round(((drag.x - event.clientX) / rect.width) * count)
    if (!moved) return
    setHover(null)
    setView({ start: clampNum(drag.start + moved, 0, Math.max(0, total - count)), count })
  }
  function inspectAt(clientX) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect?.width || !visible.length) return
    const index = clampNum(Math.floor((clientX - rect.left) / rect.width * visible.length), 0, visible.length - 1)
    setHover(visible[index].key)
  }
  const inspectByKey = (event) => {
    const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
    if (!direction) return
    event.preventDefault()
    setKeyboardActive(true)
    const index = visible.findIndex((bar) => bar.key === active?.key)
    const next = visible[clampNum(index + direction, 0, visible.length - 1)]
    if (next) setHover(next.key)
  }
  const onPointerUp = () => setDrag(null)
  const reset = () => {
    const nextCount = Math.max(1, Math.min(total, Math.round(defaultZoom)))
    setView({ start: total - nextCount, count: nextCount })
  }
  const panBy = (direction) => {
    setHover(null)
    setView({ start: clampNum(start + direction * Math.max(1, Math.floor(count / 4)), 0, Math.max(0, total - count)), count })
  }
  const zoomBy = (factor) => {
    const nextCount = clampNum(Math.round(count * factor), 1, total)
    setHover(null)
    setView({ count: nextCount, start: clampNum(start + count - nextCount, 0, total - nextCount) })
  }

  if (empty) return <p className="fx-k-empty">暂无 K 线数据</p>

  return <>
    <div className="fx-chart-controls" role="group" aria-label="K 线图控制">
      <button className="icon-button" onClick={() => panBy(-1)} disabled={start <= 0} aria-label="查看更早行情" title="查看更早行情"><ChevronLeft size={17} /></button>
      <button className="icon-button" onClick={() => panBy(1)} disabled={start + count >= total} aria-label="查看较新行情" title="查看较新行情"><ChevronRight size={17} /></button>
      <button className="icon-button" onClick={() => zoomBy(.72)} disabled={count <= 1} aria-label="放大图表" title="放大图表"><Plus size={16} /></button>
      <button className="icon-button" onClick={() => zoomBy(1.4)} disabled={count >= total} aria-label="缩小图表" title="缩小图表"><Minus size={16} /></button>
      <button className="icon-button" onClick={reset} aria-label="返回最新行情" title="返回最新行情"><RotateCcw size={15} /></button>
    </div>
    <div className="fx-k-plot">
      <div
        ref={wrapRef}
        className={cn('fx-k-wrap', drag && 'is-dragging')}
        role="group"
        tabIndex={0}
        aria-label="K 线图，按左右方向键查看价格"
        aria-describedby={readoutId}
        onKeyDown={inspectByKey}
        onBlur={() => setKeyboardActive(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { setDrag(null); setHover(null) }}
        onDoubleClick={reset}
      >
        <svg className="fx-k" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {priceGuides.map((price) => <line key={price} x1="0" x2="100" y1={yOf(price)} y2={yOf(price)} className="fx-k-grid" vectorEffect="non-scaling-stroke" />)}
          <line x1="0" x2="100" y1={height - 27} y2={height - 27} className="fx-k-grid" vectorEffect="non-scaling-stroke" />
          {inspectionX !== null && <line x1={inspectionX} x2={inspectionX} y1="0" y2={height} className="fx-k-inspection" vectorEffect="non-scaling-stroke" />}
          {visible.map((bar, index) => {
            const center = (index + 0.5) * slotW
            const direction = bar.close > bar.open ? 'is-up' : bar.close < bar.open ? 'is-down' : 'is-flat'
            const bodyTop = yOf(Math.max(bar.open, bar.close))
            const bodyBottom = yOf(Math.min(bar.open, bar.close))
            const bodyH = Math.max(0.5, bodyBottom - bodyTop)
            const volH = Math.max(0.6, (bar.volume / maxVol) * 24)
            return <g key={bar.key} className={cn('fx-k-candle', direction, hover === bar.key && 'is-active', bar.projected && 'is-projected', bar.running && 'is-running')}>
              <line x1={center} x2={center} y1={yOf(bar.high)} y2={yOf(bar.low)} className="fx-k-wick" vectorEffect="non-scaling-stroke" />
              <rect x={center - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} className="fx-k-body" vectorEffect="non-scaling-stroke" />
              {bar.volume > 0 && <rect x={center - bodyW / 2} y={height - volH} width={bodyW} height={volH} className="fx-k-vol" />}
            </g>
          })}
          {separator}
        </svg>
      </div>
      <div className="fx-k-ruler" aria-hidden="true">
        {priceGuides.map((price) => <span key={price} style={{ '--fx-guide-y': `${yOf(price) / height * 100}%` }}>{fmtPrice(price)}</span>)}
      </div>
    </div>
    {labelOf && visible.length > 1 && <div className="fx-k-time-range" aria-hidden="true"><span>{labelOf(visible[0])}</span><span>{labelOf(visible[visible.length - 1])}</span></div>}
    {splitIndex > 0 && splitIndex < total && <div className="fx-k-split-note"><span className="fx-k-split-dash" />{splitLabel}段<span className="fx-k-split-hint">虚线左侧为已结算历史，右侧为推演</span></div>}
    {active && <div className="fx-k-readout" id={readoutId} aria-live={keyboardActive ? 'polite' : 'off'} aria-atomic={keyboardActive || undefined}>
      <strong>{labelOf ? labelOf(active) : ''}</strong>
      <span>开 <b>{fmtPrice(active.open)}</b></span>
      <span>高 <b className="is-up">{fmtPrice(active.high)}</b></span>
      <span>低 <b className="is-down">{fmtPrice(active.low)}</b></span>
      <span>收 <b>{fmtPrice(active.close)}</b></span>
      <span className={cn('fx-k-chg', active.move > 0 ? 'is-up' : active.move < 0 ? 'is-down' : 'is-flat')}>{fmtPct(active.move)}</span>
      {active.volume > 0 && <span className="fx-k-meta">{active.projected ? '推演' : active.running ? '进行中' : ''}{Math.round(active.volume)} 份</span>}
      <span className="fx-k-zoom">{Math.min(count, total)} / {total} 根</span>
    </div>}
  </>
}

// 原始流水柱状图：一天若干格，向上是净抽走（利多），向下是净回流（利空）。
// bins 由服务端下发（已按「连续 15 分钟无流水才删」的规则过滤过），前端不参与判定。
export function FxFlowBars({ bins, height = 120, labelOf, dayLabel }) {
  const [hover, setHover] = useState(null)
  // 与 FxCandles 一致：不在 Hook 之前 return，改用标记 + 末尾分支，
  // 以后往这里加 useEffect 也不会触发 React #310。
  const empty = !Array.isArray(bins) || bins.length === 0
  const active = hover != null && !empty ? bins[hover] : null
  const maxNet = Math.max(...bins.map((bin) => Math.abs(bin.net)), 1)
  const maxVol = Math.max(...bins.map((bin) => bin.volume), 1)
  const priceH = height - 30
  const zeroY = priceH / 2
  const slotW = 100 / bins.length
  const bodyW = slotW * 0.72
  if (empty) return <p className="fx-k-empty">无流水</p>

  return <>
    <div className="fx-flow-wrap">
      <svg className="fx-flow" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label="昨日资金流柱状图">
        <line x1="0" x2="100" y1={zeroY} y2={zeroY} className="fx-flow-zero" vectorEffect="non-scaling-stroke" />
        {bins.map((bin, index) => {
          const center = (index + 0.5) * slotW
          const magnitude = (Math.abs(bin.net) / maxNet) * (priceH / 2 - 4)
          const h = Math.max(bin.net ? 0.8 : 0, magnitude)
          const y = bin.net >= 0 ? zeroY - h : zeroY
          const volH = Math.max(bin.volume ? 0.6 : 0, (bin.volume / maxVol) * 12)
          const up = bin.net >= 0
          return <g key={bin.slot} className={cn('fx-flow-bar', up ? 'is-up' : 'is-down', hover === index && 'is-active')} onMouseEnter={() => setHover(index)}>
            {h > 0 && <rect x={center - bodyW / 2} y={y} width={bodyW} height={h} className="fx-flow-net" vectorEffect="non-scaling-stroke" />}
            {volH > 0 && <rect x={center - bodyW / 2} y={height - volH} width={bodyW} height={volH} className="fx-flow-vol" />}
          </g>
        })}
      </svg>
    </div>
    <div className="fx-k-axis">
      <span>{fmtPrice(maxNet)}</span>
      <span>{dayLabel ? dayLabel(bins[0]?.at) : '00:00'}</span>
      <span>−{fmtPrice(maxNet)}</span>
    </div>
    <div className="fx-k-readout">
      {active ? <>
        <strong>{labelOf ? labelOf(active) : `${active.slot}`}</strong>
        <span>净额 <b className={cn(active.net > 0 ? 'is-up' : active.net < 0 ? 'is-down' : 'is-flat')}>{active.net > 0 ? '+' : ''}{fmtPrice(active.net)}</b></span>
        <span>成交 <b>{Math.round(active.volume).toLocaleString('zh-CN')}</b></span>
      </> : <>
        <strong>昨日资金流</strong>
        <span>净额 <b className={cn(bins.reduce((sum, bin) => sum + bin.net, 0) > 0 ? 'is-up' : 'is-down')}>{bins.reduce((sum, bin) => sum + bin.net, 0) > 0 ? '+' : ''}{fmtPrice(bins.reduce((sum, bin) => sum + bin.net, 0))}</b></span>
        <span>成交 <b>{Math.round(bins.reduce((sum, bin) => sum + bin.volume, 0)).toLocaleString('zh-CN')}</b></span>
      </>}
      <span className="fx-k-meta">{bins.filter((bin) => bin.net || bin.volume).length} / {bins.length} 格有成交</span>
    </div>
  </>
}
