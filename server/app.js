import { statSync } from 'node:fs'
import { join } from 'node:path'
import { createRouter } from './router.js'
import { HttpError, badRequest, clientIp, notFound, parseCookies, readJson, sendJson, sendStatic } from './http-util.js'
import { SESSION_COOKIE, readSession } from './services/auth.js'
import { authRoutes } from './routes/auth.js'
import { gameRoutes } from './routes/game.js'
import { adminRoutes } from './routes/admin.js'
import { log } from './lib/logger.js'
import { now } from './lib/clock.js'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // 字体走 Google Fonts；其余一律同源。style-src 需要 unsafe-inline：
  // 组件大量使用内联 style（进度条宽度、颜色令牌）。
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
}

// 简单的滑动窗口限流：按 key 记时间戳队列。
function createLimiter({ limit, windowMs }) {
  const hits = new Map()
  let sweepAt = 0
  return (key) => {
    const at = Date.now()
    if (at >= sweepAt) {
      for (const [client, stamps] of hits) {
        if (at - stamps.at(-1) >= windowMs) hits.delete(client)
      }
      sweepAt = at + windowMs
    }
    const list = (hits.get(key) || []).filter((stamp) => at - stamp < windowMs)
    if (list.length >= limit) {
      hits.set(key, list)
      return false
    }
    list.push(at)
    hits.set(key, list)
    return true
  }
}

// CSRF：SameSite=Strict 已经挡住跨站表单，这里再加两道：
// 1) 写请求必须是 fetch 发起的（自定义头无法被表单伪造）；
// 2) Origin / Referer 存在时其 host 必须与 Host 一致。
function checkCsrf(req) {
  if (req.headers['x-requested-with'] !== 'fetch') return false
  const host = req.headers.host
  if (!host) return false
  const source = req.headers.origin || req.headers.referer
  if (!source) return true
  try {
    return new URL(source).host === host
  } catch {
    return false
  }
}

export function createApp({ db, config = {}, offlineCapMs = 12 * 60 * 60 * 1000, staticDir = null }) {
  const router = createRouter()
  authRoutes(router)
  gameRoutes(router, { offlineCapMs })
  adminRoutes(router)

  router.get('/api/health', () => {
    try {
      const world = db.prepare('SELECT version FROM world_config WHERE id = 1').get()
      if (staticDir && (!world || !statSync(join(staticDir, 'index.html')).isFile())) return { status: 503, body: { ok: false } }
      return { status: 200, body: { ok: true } }
    } catch {
      return { status: 503, body: { ok: false } }
    }
  })

  const actionLimiter = createLimiter({ limit: 20, windowMs: 1000 })
  const generalLimiter = createLimiter({ limit: 120, windowMs: 1000 })
  const credentialLimiter = createLimiter({ limit: 15, windowMs: 1000 })

  const handler = async (req, res) => {
    const started = Date.now()
    let pathname = ''
    const headers = { ...SECURITY_HEADERS }
    if (config.hsts) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'

    const finish = (status, extra = {}) => {
      Object.entries({ ...headers, ...extra }).forEach(([key, value]) => res.setHeader(key, value))
      if (process.env.LOG_REQUESTS !== '0' && pathname.startsWith('/api/')) {
        log.info('request', { method: req.method, path: pathname, status, ms: Date.now() - started })
      }
    }

    try {
      let url
      try {
        const requestTarget = req.url || '/'
        if (!requestTarget.startsWith('/') || requestTarget.startsWith('//')) throw new TypeError('invalid request target')
        url = new URL(`https://localhost${requestTarget}`)
        pathname = url.pathname
        decodeURIComponent(pathname)
      } catch {
        throw badRequest('INVALID_URL', '请求路径格式无效')
      }

      if (!pathname.startsWith('/api/')) {
        if (staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
          Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value))
          if (sendStatic(req, res, staticDir, pathname === '/' ? '/index.html' : pathname)) return
          if (!pathname.includes('.') && sendStatic(req, res, staticDir, '/index.html')) return
        }
        finish(404)
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not Found')
        return
      }

      const ip = clientIp(req, config.trustProxyHops)
      if (!generalLimiter(ip)) throw new HttpError(429, 'RATE_LIMITED', '请求过于频繁')

      const match = router.match(req.method, pathname)
      if (!match) throw notFound('接口不存在')
      if (match.methodMismatch) {
        res.setHeader('Allow', match.allow.join(', '))
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', '方法不允许')
      }

      if (WRITE_METHODS.has(req.method)) {
        if (!checkCsrf(req)) throw new HttpError(403, 'CSRF', '请求来源校验失败')
        if (pathname === '/api/action' && !actionLimiter(`${ip}:${pathname}`)) {
          throw new HttpError(429, 'RATE_LIMITED', '操作过于频繁')
        }
        if (pathname.startsWith('/api/auth/') && !credentialLimiter(ip)) {
          throw new HttpError(429, 'RATE_LIMITED', '认证操作过于频繁')
        }
      }

      const body = WRITE_METHODS.has(req.method) ? await readJson(req) : {}
      const cookies = parseCookies(req.headers.cookie)
      const token = cookies[SESSION_COOKIE]
      const auth = readSession(db, token)
      const ctx = {
        db,
        req,
        res,
        url,
        pathname,
        query: Object.fromEntries(url.searchParams),
        params: match.params,
        body,
        ip,
        userAgent: String(req.headers['user-agent'] || ''),
        token,
        auth,
        config,
      }
      const result = await match.handler(ctx)
      finish(result?.status || 200, result?.headers || {})
      return sendJson(req, res, result?.status || 200, result?.body ?? {}, result?.headers || {})
    } catch (error) {
      if (res.destroyed) return
      if (error instanceof HttpError) {
        finish(error.status)
        return sendJson(req, res, error.status, { error: error.code, message: error.message, ...error.extra })
      }
      log.error('unhandled', { path: pathname, message: error?.message, stack: String(error?.stack || '').split('\n').slice(0, 4) })
      finish(500)
      return sendJson(req, res, 500, { error: 'INTERNAL', message: '服务器内部错误' })
    }
  }

  return handler
}

export { now, notFound }
