import { metaGet, metaSet } from '../db/index.js'
import { HttpError, badRequest } from '../http-util.js'
import { now } from '../lib/clock.js'

const SERVICE_STATUS = 'serviceStatus'
const OPEN_STATUS = Object.freeze({ mode: 'open', message: '', updatedAt: 0, version: 0 })
const MINUTE = 60_000
const WINDOW_MINUTES = 5

export function getServiceStatus(db) {
  const saved = metaGet(db, SERVICE_STATUS)
  return saved === null ? OPEN_STATUS : JSON.parse(saved)
}

export function saveServiceStatus(db, { mode, message, version }) {
  if (!['open', 'maintenance'].includes(mode) || typeof message !== 'string' || message.trim().length > 240) {
    throw badRequest('INVALID_SERVICE_STATUS', '请选择服务状态，并将公告控制在 240 字以内')
  }
  if (mode === 'maintenance' && !message.trim()) {
    throw badRequest('MAINTENANCE_MESSAGE_REQUIRED', '暂停操作时请填写玩家可见的说明')
  }
  const current = getServiceStatus(db)
  if (!Number.isSafeInteger(version) || version !== current.version) {
    throw new HttpError(409, 'SERVICE_CONFLICT', '服务状态已更新，请读取最新状态后再发布')
  }
  const service = { mode, message: message.trim(), updatedAt: now(), version: current.version + 1 }
  metaSet(db, SERVICE_STATUS, JSON.stringify(service))
  return service
}

export function createTelemetry(intervalMs = 30_000) {
  const startedAt = Date.now()
  const buckets = Array.from({ length: WINDOW_MINUTES }, () => ({ minute: -1 }))
  const jobs = {
    world: { lastSuccessAt: 0, lastFailureAt: 0, failures: 0 },
    cleanup: { lastSuccessAt: 0, lastFailureAt: 0, failures: 0 },
  }
  const minuteAt = () => Math.floor(Date.now() / MINUTE)
  return {
    recordRequest(status, elapsedMs) {
      const minute = minuteAt()
      const bucket = buckets[minute % WINDOW_MINUTES]
      if (bucket.minute !== minute) Object.assign(bucket, { minute, total: 0, failed: 0, limited: 0, slow: 0 })
      bucket.total += 1
      if (status >= 500 && status !== 503) bucket.failed += 1
      if (status === 429) bucket.limited += 1
      if (elapsedMs >= 250) bucket.slow += 1
    },
    recordJob(name, ok) {
      const job = jobs[name]
      if (ok) {
        job.lastSuccessAt = Date.now()
        job.failures = 0
      } else {
        job.lastFailureAt = Date.now()
        job.failures += 1
      }
    },
    ready() {
      return jobs.world.lastSuccessAt > 0 && Date.now() - jobs.world.lastSuccessAt <= intervalMs * 3
    },
    snapshot() {
      const minute = minuteAt()
      const requests = { total: 0, failed: 0, limited: 0, slow: 0 }
      for (const bucket of buckets) {
        if (bucket.minute <= minute - WINDOW_MINUTES || bucket.minute > minute) continue
        for (const key of Object.keys(requests)) requests[key] += bucket[key]
      }
      return {
        startedAt,
        minutes: WINDOW_MINUTES,
        requests,
        jobs: { world: { ...jobs.world }, cleanup: { ...jobs.cleanup } },
      }
    },
  }
}
