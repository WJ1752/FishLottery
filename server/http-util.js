import { createReadStream, realpathSync, statSync } from 'node:fs'
import { isIP } from 'node:net'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

const MAX_BODY = 256 * 1024

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export const badRequest = (code, message) => new HttpError(400, code, message)
export const unauthorized = (message = '请先登录') => new HttpError(401, 'UNAUTHORIZED', message)
export const forbidden = (code = 'FORBIDDEN', message = '没有权限') => new HttpError(403, code, message)
export const notFound = (message = '未找到') => new HttpError(404, 'NOT_FOUND', message)
export const tooMany = (message = '请求过于频繁') => new HttpError(429, 'RATE_LIMITED', message)

export function parseCookies(header) {
  const out = Object.create(null)
  if (!header) return out
  header.split(';').forEach((part) => {
    const index = part.indexOf('=')
    if (index < 0) return
    const key = part.slice(0, index).trim()
    if (!key) return
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim())
    } catch { /* 忽略格式无效的单个 cookie */ }
  })
  return out
}

export function clientIp(req, proxyHops = 0) {
  if (proxyHops > 0) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')
    const candidate = forwarded.at(-proxyHops)?.trim()
    if (candidate && isIP(candidate)) return candidate
  }
  return req.socket?.remoteAddress || ''
}

// 读取并解析 JSON 请求体，带大小上限。
export function readJson(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      if (size > MAX_BODY) return
      size += chunk.length
      if (size > MAX_BODY) {
        chunks.length = 0
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体过大'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > MAX_BODY) return
      if (!chunks.length) return resolveBody({})
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        const value = text.trim() ? JSON.parse(text) : {}
        resolveBody(value && typeof value === 'object' ? value : {})
      } catch {
        reject(badRequest('INVALID_JSON', '请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function acceptsGzip(req) {
  return String(req.headers['accept-encoding'] || '').split(',').some((item) => {
    const [encoding, quality] = item.trim().toLowerCase().split(/\s*;\s*/)
    return encoding === 'gzip' && (quality === undefined || Number(quality.replace(/^q=/, '')) > 0)
  })
}

// 统一的 JSON 响应：安全头、无缓存、可选 gzip。
export function sendJson(req, res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload))
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Accept-Encoding',
    ...extraHeaders,
  }
  if (body.length > 1024 && acceptsGzip(req)) {
    const zipped = gzipSync(body)
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': zipped.length })
    res.end(zipped)
    return
  }
  res.writeHead(status, { ...headers, 'Content-Length': body.length })
  res.end(body)
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

// 静态文件：路径必须落在 root 内，防止 ../ 穿越。
// 找不到就返回 false，由调用方决定 SPA fallback。
export function sendStatic(req, res, root, pathname) {
  let target
  let stat
  const name = decodeURIComponent(pathname).replace(/^[/\\]+/, '')
  if (name.split(/[/\\]/).some((part) => part.startsWith('.'))) return false
  try {
    const rootPath = realpathSync(root)
    target = realpathSync(resolve(rootPath, name))
    const fromRoot = relative(rootPath, target)
    if (fromRoot === '..' || fromRoot.startsWith('..' + sep) || isAbsolute(fromRoot)) return false
    stat = statSync(target)
  } catch {
    return false
  }
  if (!stat.isFile()) return false
  const ext = extname(target).toLowerCase()
  const immutable = /\/assets\/.+-[A-Za-z0-9_]{8,}\./.test(pathname)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  createReadStream(target).on('error', (error) => res.destroy(error)).pipe(res)
  return true
}
