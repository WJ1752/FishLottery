import { get, run, transaction } from '../db/index.js'
import { HttpError, badRequest, forbidden, tooMany, unauthorized } from '../http-util.js'
import { hashPassword, hashToken, sha256, validatePassword, validateUsername, verifyPassword } from '../lib/passwords.js'
import { generateRecoveryCodes, generateTotpSecret, recoveryCodeHash, verifyTotp } from '../lib/totp.js'
import { randomToken } from '../lib/rng.js'
import { now } from '../lib/clock.js'

export const SESSION_COOKIE = 'fl_sid'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MFA_TTL_MS = 12 * 60 * 60 * 1000
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_FAILURES = 10
const LOGIN_MAX_FAILURES_PER_IP = 50
const TOTP_MAX_FAILURES = 5
const REGISTER_WINDOW_MS = 60 * 60 * 1000
// 注册限流默认每 IP 每小时 5 个；集成测试 / 内网小规模部署可通过环境变量放宽。
const REGISTER_MAX_PER_IP = Math.max(1, Number(process.env.REGISTER_LIMIT_PER_HOUR) || 5)

// 进程内失败计数：单实例部署足够；重启清零不会造成实际风险。
const failures = new Map()
let sweepAt = 0
const dummyPassword = hashPassword('dummy-password-for-timing')

function bumpFailure(key, windowMs = LOGIN_WINDOW_MS) {
  const at = now()
  if (at >= sweepAt) {
    for (const [name, item] of failures) {
      if (at - item.since >= item.windowMs) failures.delete(name)
    }
    sweepAt = at + CHALLENGE_TTL_MS
  }
  const entry = failures.get(key)
  if (!entry || at - entry.since >= windowMs) {
    failures.set(key, { since: at, count: 1, windowMs })
    return 1
  }
  entry.count += 1
  return entry.count
}

function failureCount(key, windowMs = LOGIN_WINDOW_MS) {
  const entry = failures.get(key)
  if (!entry || now() - entry.since >= windowMs) return 0
  return entry.count
}

function clearFailures(key) {
  failures.delete(key)
}

export function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    // 只有「确认绑定」才算启用：只写 secret 而未验证的账号仍然是未启用状态。
    totpEnabled: Boolean(row.totp_enabled_at),
    // 邮箱是可选验证：未验证时对外只显示 null，不泄漏用户填过什么。
    email: row.email_verified_at ? row.email : null,
    emailVerified: Boolean(row.email_verified_at),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }
}

export function findUserByUsername(db, username) {
  const key = String(username || '').trim().toLowerCase()
  if (!key) return null
  return get(db, 'SELECT * FROM users WHERE username_key = ?', key) || null
}

// 邮箱登录：只有验证过的邮箱才算登录标识。
// 未验证的 email_key 只是「填过但没确认」，不能凭它登录，否则知道别人邮箱就能顶替。
export function findUserByEmail(db, email) {
  const key = String(email || '').trim().toLowerCase()
  if (!key) return null
  return get(db, 'SELECT * FROM users WHERE email_key = ? AND email_verified_at IS NOT NULL', key) || null
}

export function findUserById(db, id) {
  return get(db, 'SELECT * FROM users WHERE id = ?', Number(id)) || null
}

// 注册：新账号一律 player；管理员只能由 CLI 或已登录管理员提升。
export function registerUser(db, { username, password, displayName }, { ip = '' } = {}) {
  const name = validateUsername(username)
  if (!name.ok) throw badRequest('INVALID_USERNAME', name.message)
  const pass = validatePassword(password)
  if (!pass.ok) throw badRequest('INVALID_PASSWORD', pass.message)
  const ipKey = `register:${ip}`
  if (failureCount(ipKey, REGISTER_WINDOW_MS) >= REGISTER_MAX_PER_IP) throw tooMany('注册过于频繁，请稍后再试')
  if (findUserByUsername(db, name.username)) throw badRequest('USERNAME_TAKEN', '该用户名已被注册')

  const at = now()
  run(db, 'INSERT INTO users(username, username_key, password_hash, role, display_name, created_at, last_login_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
    name.username, name.username.toLowerCase(), hashPassword(pass.password), 'player', String(displayName || name.username).slice(0, 40), at, at)
  bumpFailure(ipKey, REGISTER_WINDOW_MS)
  return findUserByUsername(db, name.username)
}

// 登录第一步：密码正确后，如果已绑定 2FA 就返回一次性挑战而非会话。
// 标识符可以是用户名，也可以是已验证的邮箱——有 @ 就当邮箱处理。
export function startLogin(db, { username, password }, { ip = '', userAgent = '' } = {}) {
  const identifier = typeof username === 'string' ? username.trim() : ''
  if (!identifier || identifier.length > 254 || typeof password !== 'string') {
    throw new HttpError(401, 'BAD_CREDENTIALS', '用户名、邮箱或密码错误')
  }
  const key = `login:${ip}:${identifier.toLowerCase()}`
  const ipKey = `login-ip:${ip}`
  if (failureCount(key) >= LOGIN_MAX_FAILURES || failureCount(ipKey) >= LOGIN_MAX_FAILURES_PER_IP) {
    throw tooMany('登录失败次数过多，请 15 分钟后再试')
  }
  const user = identifier.includes('@') ? findUserByEmail(db, identifier) : findUserByUsername(db, identifier)
  // 账号不存在也走一遍 scrypt，避免用响应时间枚举账号。
  const stored = user ? user.password_hash : dummyPassword
  const ok = verifyPassword(password, stored)
  if (!user || !ok || user.disabled) {
    bumpFailure(key)
    bumpFailure(ipKey)
    throw new HttpError(401, 'BAD_CREDENTIALS', '用户名、邮箱或密码错误')
  }
  clearFailures(key)
  // 只有「已确认绑定」的账号才走第二因子；只生成过密钥不算，否则用户会被锁在
  // 一个自己从未验证过的密钥外面。
  if (!user.totp_enabled_at) {
    return transaction(db, () => {
      const at = now()
      run(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', at, user.id)
      const token = createSession(db, user.id, { ip, userAgent, mfa: false })
      return { user: publicUser({ ...user, last_login_at: at }), token }
    })
  }
  const challengeId = randomToken(24)
  const at = now()
  run(db, 'INSERT INTO login_challenges(id, user_id, created_at, expires_at, ip) VALUES(?, ?, ?, ?, ?)',
    challengeId, user.id, at, at + CHALLENGE_TTL_MS, ip)
  return { totpRequired: true, challengeId, expiresAt: at + CHALLENGE_TTL_MS }
}

// 登录第二步：TOTP 或恢复码。
export function completeTotpLogin(db, { challengeId, code }, { ip = '', userAgent = '' } = {}) {
  const challenge = get(db, 'SELECT * FROM login_challenges WHERE id = ?', String(challengeId || ''))
  if (!challenge) throw unauthorized('验证已过期，请重新登录')
  if (Number(challenge.expires_at) <= now()) {
    run(db, 'DELETE FROM login_challenges WHERE id = ?', challenge.id)
    throw unauthorized('验证已过期，请重新登录')
  }
  const user = findUserById(db, challenge.user_id)
  if (!user || !user.totp_enabled_at || !user.totp_secret || user.disabled) throw unauthorized('账号不可用')
  const key = `totp-login:${user.id}`
  if (failureCount(key) >= TOTP_MAX_FAILURES) throw tooMany('验证码错误次数过多，请 15 分钟后再试')
  return transaction(db, () => {
    if (consumeCode(db, user, code) === null) {
      bumpFailure(key)
      throw unauthorized('验证码错误')
    }
    clearFailures(key)
    run(db, 'DELETE FROM login_challenges WHERE id = ?', challenge.id)
    run(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id)
    const token = createSession(db, user.id, { ip: ip || challenge.ip, userAgent, mfa: true })
    return { user: publicUser(findUserById(db, user.id)), token }
  })
}

// 校验并消费一个 TOTP 或恢复码；同一步长只能成功一次（防重放）。
export function consumeCode(db, user, code) {
  const raw = String(code || '').trim()
  if (!raw) return null
  if (/^\d{6}$/.test(raw)) {
    const step = verifyTotp(user.totp_secret, raw, now())
    if (step === null) return null
    if (Number(user.totp_last_step) >= step) return null
    const result = run(db, 'UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?', step, user.id, step)
    return result.changes ? step : null
  }
  const hash = recoveryCodeHash(raw)
  const row = get(db, 'SELECT * FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', user.id, hash)
  if (!row) return null
  const result = run(db, 'UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', now(), row.id)
  return result.changes ? Number(user.totp_last_step) || 0 : null
}

export function createSession(db, userId, { ip = '', userAgent = '', mfa = false } = {}) {
  const token = randomToken(32)
  const at = now()
  run(db, 'INSERT INTO sessions(id, user_id, created_at, expires_at, mfa_at, ip, user_agent) VALUES(?, ?, ?, ?, ?, ?, ?)',
    hashToken(token), userId, at, at + SESSION_TTL_MS, mfa ? at : 0, String(ip).slice(0, 64), String(userAgent).slice(0, 200))
  return token
}

// 读取会话：滑动续期，返回 { user, mfaAt }。
export function readSession(db, token) {
  if (!token) return null
  const id = hashToken(token)
  const session = get(db, 'SELECT * FROM sessions WHERE id = ?', id)
  if (!session) return null
  const at = now()
  if (Number(session.expires_at) < at) {
    run(db, 'DELETE FROM sessions WHERE id = ?', id)
    return null
  }
  const user = findUserById(db, session.user_id)
  if (!user || user.disabled) {
    run(db, 'DELETE FROM sessions WHERE id = ?', id)
    return null
  }
  // 每天最多续期一次，避免每次请求都写库。
  if (Number(session.expires_at) - at < SESSION_TTL_MS - 24 * 60 * 60 * 1000) {
    run(db, 'UPDATE sessions SET expires_at = ? WHERE id = ?', at + SESSION_TTL_MS, id)
  }
  return { user, mfaAt: Number(session.mfa_at) || 0, sessionId: id }
}

export function destroySession(db, token) {
  if (!token) return
  run(db, 'DELETE FROM sessions WHERE id = ?', hashToken(token))
}

export function destroyUserSessions(db, userId) {
  run(db, 'DELETE FROM sessions WHERE user_id = ?', Number(userId))
}

// 管理员门禁：角色 + 12 小时内的 2FA。未绑定返回带 code 的 403，前端据此引导绑定。
// 注意用 totp_enabled_at 判断「已绑定」：只生成过 secret 但没验证的账号还没有真正启用 2FA。
export function requireAdmin(db, auth) {
  if (!auth) throw unauthorized()
  if (auth.user.role !== 'admin') throw forbidden('FORBIDDEN', '需要管理员权限')
  if (!auth.user.totp_enabled_at) throw new HttpError(403, 'TOTP_SETUP_REQUIRED', '管理员必须先绑定两步验证')
  if (!auth.mfaAt || now() - auth.mfaAt > MFA_TTL_MS) throw new HttpError(403, 'MFA_REQUIRED', '请先完成两步验证')
  return auth
}

export function setupTotp(db, userId) {
  const user = findUserById(db, userId)
  // 并行页面共用同一待确认密钥，刷新页面后仍可完成绑定。
  if (user.totp_enabled_at) throw badRequest('TOTP_ALREADY_ENABLED', '两步验证已绑定')
  const secret = user.totp_secret || generateTotpSecret()
  if (!user.totp_secret) run(db, 'UPDATE users SET totp_secret = ? WHERE id = ?', secret, user.id)
  return { secret }
}

export function enableTotp(db, auth, code) {
  const user = findUserById(db, auth.user.id)
  if (!user.totp_secret) throw badRequest('TOTP_NOT_SETUP', '请先生成密钥')
  if (user.totp_enabled_at) throw badRequest('TOTP_ALREADY_ENABLED', '两步验证已绑定')
  const step = verifyTotp(user.totp_secret, code, now())
  if (step === null) throw badRequest('TOTP_INVALID', '验证码错误')
  const at = now()
  const codes = generateRecoveryCodes()
  return transaction(db, () => {
    run(db, 'UPDATE users SET totp_enabled_at = ?, totp_last_step = ? WHERE id = ?', at, step, user.id)
    run(db, 'DELETE FROM recovery_codes WHERE user_id = ?', user.id)
    codes.forEach((raw) => run(db, 'INSERT INTO recovery_codes(user_id, code_hash) VALUES(?, ?)', user.id, recoveryCodeHash(raw)))
    run(db, 'DELETE FROM sessions WHERE user_id = ? AND id <> ?', user.id, auth.sessionId)
    run(db, 'UPDATE sessions SET mfa_at = ? WHERE id = ?', at, auth.sessionId)
    return { recoveryCodes: codes, secret: user.totp_secret }
  })
}

// 已登录会话升级为 2FA（管理员进后台时的 step-up 验证）。
export function stepUp(db, auth, code) {
  const user = findUserById(db, auth.user.id)
  if (!user.totp_enabled_at) throw new HttpError(403, 'TOTP_SETUP_REQUIRED', '请先绑定两步验证')
  const key = `totp-stepup:${user.id}`
  if (failureCount(key) >= TOTP_MAX_FAILURES) throw tooMany('验证码错误次数过多，请 15 分钟后再试')
  return transaction(db, () => {
    if (consumeCode(db, user, code) === null) {
      bumpFailure(key)
      throw badRequest('TOTP_INVALID', '验证码错误')
    }
    clearFailures(key)
    const at = now()
    run(db, 'UPDATE sessions SET mfa_at = ? WHERE id = ?', at, auth.sessionId)
    return { mfaAt: at }
  })
}

export function changePassword(db, auth, { currentPassword, newPassword }) {
  const user = findUserById(db, auth.user.id)
  if (!verifyPassword(currentPassword, user.password_hash)) throw badRequest('BAD_CREDENTIALS', '当前密码错误')
  const pass = validatePassword(newPassword)
  if (!pass.ok) throw badRequest('INVALID_PASSWORD', pass.message)
  const hash = hashPassword(pass.password)
  transaction(db, () => {
    run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id)
    // 改密码踢掉其它会话，也作废用旧密码申请的验证。
    run(db, 'DELETE FROM sessions WHERE user_id = ? AND id <> ?', user.id, auth.sessionId)
    run(db, 'DELETE FROM login_challenges WHERE user_id = ?', user.id)
    run(db, 'DELETE FROM reset_tokens WHERE user_id = ? AND used_at IS NULL', user.id)
  })
  return { ok: true }
}

export function resetTotp(db, userId) {
  run(db, 'UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = 0 WHERE id = ?', Number(userId))
  run(db, 'DELETE FROM recovery_codes WHERE user_id = ?', Number(userId))
  run(db, 'DELETE FROM sessions WHERE user_id = ?', Number(userId))
  run(db, 'DELETE FROM login_challenges WHERE user_id = ?', Number(userId))
  clearFailures(`totp-login:${userId}`)
  clearFailures(`totp-stepup:${userId}`)
}

export { sha256 }
