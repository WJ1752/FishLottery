import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

// scrypt 参数：N=2^15 约 32 MB 内存，单次 ~60ms，能挡住离线爆破又不会拖慢登录。
// maxmem 必须显式给：Node 默认 32 MB，正好卡在 N=2^15 的边界上会直接报错。
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 }

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(password), salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: PARAMS.maxmem })
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, rawN, rawR, rawP, saltB64, hashB64] = parts
  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false
  const expected = Buffer.from(hashB64, 'base64')
  let actual
  try {
    actual = scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N, r, p, maxmem: PARAMS.maxmem })
  } catch {
    return false
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
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
  const password = String(raw || '')
  if (password.length < 8) return { ok: false, message: '密码至少 8 位' }
  if (password.length > 200) return { ok: false, message: '密码过长' }
  return { ok: true, password }
}
