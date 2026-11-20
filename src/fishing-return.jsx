import React, { useState } from 'react'
import { Anchor, ArrowRight, X } from 'lucide-react'
import './fishing-return.css'

const REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor(minutes / 60) % 24
  if (days) return `${days} 天${hours ? ` ${hours} 小时` : ''}`
  return [hours && `${hours} 小时`, minutes % 60 && `${minutes % 60} 分钟`].filter(Boolean).join(' ') || '不足 1 分钟'
}

const STOP_REASONS = {
  broken: '钓竿已损坏。修复或更换钓竿后可以继续。',
  durability: '钓竿耐久过低，已停止垂钓。修复或更换钓竿后可以继续。',
  warehouse: '仓库已满，已停止垂钓。兑换鱼获后可以继续。',
}

export function useFishingReturn(userId, report, now) {
  const key = `fishlottery.dismissed-return.${userId}`
  const [dismissedAt, setDismissedAt] = useState(() => {
    try { return Number(localStorage.getItem(key)) || 0 }
    catch { return 0 }
  })
  const dismiss = () => {
    setDismissedAt(report.at)
    try { localStorage.setItem(key, String(report.at)) }
    catch { /* 隐私模式下只记在本次会话。 */ }
  }
  const visible = report && report.at > dismissedAt && now - report.at < REPORT_MAX_AGE_MS
  return { report: visible ? report : null, dismiss }
}

export function FishingReturn({ report, onDismiss, onWarehouse, onRod }) {
  const reason = STOP_REASONS[report.stopReason]
  return <section className="fishing-return" aria-label="离线收获">
    <Anchor size={21} aria-hidden="true" />
    <div className="fishing-return-summary">
      <h2>欢迎回港</h2>
      <p>离开 {formatDuration(report.elapsedMs)}，鱼获入库 <strong>{report.landed.toLocaleString('zh-CN')} 条</strong>{report.escaped > 0 && `，脱钩 ${report.escaped.toLocaleString('zh-CN')} 条`}。</p>
      {reason && <p>{reason}</p>}
      {report.cappedMs !== null && <p>{report.cappedMs ? `已按 ${formatDuration(report.cappedMs)} 的离线时长上限补算。` : '本次未补算离线时长。'}</p>}
    </div>
    {reason && <button type="button" className="secondary-button fishing-return-action" onClick={report.stopReason === 'warehouse' ? onWarehouse : onRod}>
      {report.stopReason === 'warehouse' ? '查看仓库' : '查看钓竿'}<ArrowRight size={15} aria-hidden="true" />
    </button>}
    <button type="button" className="icon-button fishing-return-dismiss" aria-label="关闭离线收获" onClick={onDismiss}><X size={18} aria-hidden="true" /></button>
  </section>
}
