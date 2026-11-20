import { randomBytes, scrypt, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { HttpError } from '../http-util.js'

// scrypt 参数：N=2^15 约 32 MB 内存，单次 ~60ms，能挡住离线爆破又不会拖慢登录。
// maxmem 必须显式给：Node 默认 32 MB，正好卡在 N=2^15 的边界上会直接报错。
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 }
const derive = promisify(scrypt)
const MAX_PENDING_HASHES = 8
let pendingHashes = 0

async function derivePassword(password, salt, length, options) {
  // 有界队列让 HTTP 校验在工作线程执行，避免登录高峰阻塞玩家轮询或耗尽内存。
  if (pendingHashes >= MAX_PENDING_HASHES) throw new HttpError(503, 'AUTH_BUSY', '登录服务繁忙，请稍后重试')
  pendingHashes += 1
  try {
    return await derive(String(password), salt, length, options)
  } finally {
    pendingHashes -= 1
  }
}

const hashOptions = ({ N, r, p }) => ({ N, r, p, maxmem: PARAMS.maxmem })
const encodePasswordHash = (salt, hash) => `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(password), salt, PARAMS.keylen, hashOptions(PARAMS))
  return encodePasswordHash(salt, hash)
}

export async function hashPasswordAsync(password) {
  const salt = randomBytes(16)
  const hash = await derivePassword(password, salt, PARAMS.keylen, hashOptions(PARAMS))
  return encodePasswordHash(salt, hash)
}

function decodePasswordHash(stored) {
  if (typeof stored !== 'string') return null
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [, rawN, rawR, rawP, saltB64, hashB64] = parts
  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return null
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  if (!salt.length || !expected.length) return null
  return { salt, expected, options: hashOptions({ N, r, p }) }
}

export function verifyPassword(password, stored) {
  const parsed = decodePasswordHash(stored)
  if (!parsed) return false
  try {
    const actual = scryptSync(String(password), parsed.salt, parsed.expected.length, parsed.options)
    return timingSafeEqual(actual, parsed.expected)
  } catch {
    return false
  }
}

export async function verifyPasswordAsync(password, stored) {
  const parsed = decodePasswordHash(stored)
  if (!parsed) return false
  try {
    const actual = await derivePassword(password, parsed.salt, parsed.expected.length, parsed.options)
    return timingSafeEqual(actual, parsed.expected)
  } catch (error) {
    if (error instanceof HttpError) throw error
    return false
  }
}

// 令牌只以哈希落库：即使数据库泄漏也拿不到可用会话。
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex')

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')

export function validateUsername(raw) {
  const username = String(raw || '').trim()
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
    return { ok: false, message: '用户名需为 3–32 位字母、数字、下划线或连字符' }
  }
  return { ok: true, username }
}

export function validatePassword(raw) {
  const password = typeof raw === 'string' ? raw : ''
  if (password.length < 8) return { ok: false, message: '密码至少 8 位' }
  if (password.length > 200) return { ok: false, message: '密码过长' }
  return { ok: true, password }
}
