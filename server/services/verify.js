import { get, run, transaction } from '../db/index.js'
import { HttpError, badRequest, tooMany } from '../http-util.js'
import { sha256 } from '../lib/passwords.js'
import { randomInt } from 'node:crypto'
import { now } from '../lib/clock.js'
import { log } from '../lib/logger.js'
import { mailConfigFromEnv, sendMail, verificationMail } from './mail.js'

// 邮箱验证：可选功能。已验证的地址作为账号的固定登录标识。
// 设计要点：
// - 验证码只存哈希，一次性，10 分钟过期，错 5 次作废；
// - 已验证的邮箱全服唯一（唯一索引在 schema.sql）；
// - 开发环境可把验证码写日志。生产需要 SMTP 才能发码。

export const CODE_TTL_MS = 10 * 60 * 1000
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_ATTEMPTS = 5
const MAX_SENDS_PER_HOUR = 8

const EMAIL_PATTERN = /^[^\s@,;:<>()[\]\\]+@[^\s@,;:<>()[\]\\]+\.[^\s@,;:<>()[\]\\]{2,}$/

export function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase()
}

export function validateEmail(raw) {
  const email = String(raw || '').trim()
  if (!email) return { ok: false, message: '请输入邮箱' }
  if (email.length > 254) return { ok: false, message: '邮箱过长' }
  if (!EMAIL_PATTERN.test(email)) return { ok: false, message: '邮箱格式不正确' }
  return { ok: true, email, emailKey: normalizeEmail(email) }
}

// 6 位数字验证码：空间 10^6，配合 5 次尝试上限和 10 分钟有效期足够。
function generateCode() {
  return String(randomInt(1_000_000)).padStart(6, '0')
}

export function verificationMailConfig() {
  const config = mailConfigFromEnv()
  if (process.env.NODE_ENV === 'production') {
    const canDeliver = config?.rejectUnauthorized && (!config.user || config.secure || config.starttls)
    if (!canDeliver) throw new HttpError(503, 'MAIL_UNAVAILABLE', '邮件验证暂未开放，请联系管理员')
  }
  return config
}

const hashCode = (userId, emailKey, code) => sha256(`${userId}:${emailKey}:${code}`)

function assertEmailAvailable(db, userId, emailKey) {
  const taken = get(
    db,
    `SELECT id FROM users WHERE email_key = ? AND email_verified_at IS NOT NULL AND id <> ?`,
    emailKey,
    Number(userId),
  )
  if (taken) throw new HttpError(409, 'EMAIL_TAKEN', '这个邮箱已被其它账号验证')
}

// 邮箱是账号的登录标识之一，一旦验证就固定下来：不能换绑、不能解绑。
// 这样「一个邮箱只对应一个账号」才是真的，否则解绑后别人可以立刻抢注同一邮箱，
// 再用它登录一个本该属于原主人的身份。
export async function requestEmailVerification(db, userId, rawEmail) {
  const check = validateEmail(rawEmail)
  if (!check.ok) throw badRequest('INVALID_EMAIL', check.message)
  const user = get(db, 'SELECT * FROM users WHERE id = ?', Number(userId))
  if (!user) throw badRequest('NO_USER', '账号不存在')
  if (user.email_verified_at) {
    throw new HttpError(409, 'EMAIL_LOCKED', '邮箱一旦验证就不能更换或解绑')
  }
  assertEmailAvailable(db, userId, check.emailKey)

  const at = now()
  const recent = get(
    db,
    `SELECT created_at FROM email_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    Number(userId),
  )
  if (recent && at - Number(recent.created_at) < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (at - Number(recent.created_at))) / 1000)
    throw tooMany(`请 ${wait} 秒后再获取验证码`)
  }
  const hourly = Number(get(
    db,
    'SELECT COUNT(*) AS n FROM email_tokens WHERE user_id = ? AND created_at > ?',
    Number(userId),
    at - 60 * 60 * 1000,
  )?.n) || 0
  if (hourly >= MAX_SENDS_PER_HOUR) throw tooMany('验证码发送过于频繁，请稍后再试')

  const config = verificationMailConfig()
  const code = generateCode()
  // 保留已发记录计算小时限额，旧码同时作废。
  const tokenId = transaction(db, () => {
    run(db, 'UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', at, Number(userId))
    return run(
      db,
      `INSERT INTO email_tokens(user_id, email_key, code_hash, created_at, expires_at)
       VALUES(?, ?, ?, ?, ?)`,
      Number(userId),
      check.emailKey,
      hashCode(userId, check.emailKey, code),
      at,
      at + CODE_TTL_MS,
    ).lastInsertRowid
  })

  const mail = verificationMail({ username: user.username, code, minutes: CODE_TTL_MS / 60000 })
  if (!config) {
    // 没有 SMTP：把验证码写到日志里，本地开发照样能完成验证。
    log.warn('未配置 SMTP，验证码只写日志', { email: check.emailKey, code })
    return { sent: true, delivered: false, email: check.email, expiresAt: at + CODE_TTL_MS }
  }
  try {
    await sendMail({ ...config, to: check.email, subject: mail.subject, text: mail.text })
    return { sent: true, delivered: true, email: check.email, expiresAt: at + CODE_TTL_MS }
  } catch (error) {
    // 发信失败要把刚写的码删掉，否则用户拿不到码却要等 60 秒冷却。
    run(db, 'DELETE FROM email_tokens WHERE id = ? AND used_at IS NULL', tokenId)
    log.error('验证码邮件发送失败', { userId, message: error?.message })
    throw new HttpError(502, 'MAIL_FAILED', '验证码邮件发送失败，请稍后重试')
  }
}

// 校验：成功即把 email 写进 users 并打上 verified 时间。
export function confirmEmailVerification(db, userId, rawCode) {
  const code = String(rawCode || '').trim()
  if (!/^\d{6}$/.test(code)) throw badRequest('INVALID_CODE', '请输入 6 位验证码')
  const user = get(db, 'SELECT * FROM users WHERE id = ?', Number(userId))
  if (!user) throw badRequest('NO_USER', '账号不存在')
  // 发码之后、输码之前账号可能已经在别处完成了验证：这里再挡一次，避免覆盖已有绑定。
  if (user.email_verified_at) {
    throw new HttpError(409, 'EMAIL_LOCKED', '邮箱一旦验证就不能更换或解绑')
  }
  const token = get(
    db,
    'SELECT * FROM email_tokens WHERE user_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1',
    Number(userId),
  )
  if (!token) throw badRequest('NO_PENDING_CODE', '请先获取验证码')
  if (Number(token.expires_at) <= now()) {
    run(db, 'UPDATE email_tokens SET used_at = ? WHERE id = ?', now(), token.id)
    throw badRequest('CODE_EXPIRED', '验证码已过期，请重新获取')
  }
  if (Number(token.attempts) >= MAX_ATTEMPTS) {
    throw badRequest('TOO_MANY_ATTEMPTS', '尝试次数过多，请重新获取验证码')
  }
  if (token.code_hash !== hashCode(userId, token.email_key, code)) {
    run(db, 'UPDATE email_tokens SET attempts = attempts + 1 WHERE id = ?', token.id)
    const left = MAX_ATTEMPTS - (Number(token.attempts) + 1)
    throw badRequest('INVALID_CODE', left > 0 ? `验证码错误，还可尝试 ${left} 次` : '验证码错误次数过多，请重新获取')
  }
  assertEmailAvailable(db, userId, token.email_key)

  const at = now()
  transaction(db, () => {
    run(
      db,
      'UPDATE users SET email = ?, email_key = ?, email_verified_at = ? WHERE id = ?',
      token.email_key,
      token.email_key,
      at,
      Number(userId),
    )
    run(db, 'UPDATE email_tokens SET used_at = ? WHERE id = ?', at, token.id)
  })
  return { email: token.email_key, verifiedAt: at }
}

// 邮箱不做解绑：它是账号的登录标识，解绑会让「一个邮箱只对应一个账号」失效。
// 需要换邮箱只能换一个账号——游戏进度本来就可以重置，账号身份不应该跟着邮箱漂移。

// 掩码：ab***@example.com。前端只展示这个，避免完整地址出现在响应里。
export function maskEmail(email) {
  const [name, domain] = String(email || '').split('@')
  if (!domain) return ''
  const visible = name.slice(0, Math.min(2, name.length))
  return `${visible}${'*'.repeat(Math.max(1, name.length - visible.length))}@${domain}`
}

// 管理员视角：待验证的邮箱（未验证但填过）不算占用。
export function emailStatus(user) {
  return {
    email: user.email_verified_at ? user.email : null,
    emailVerified: Boolean(user.email_verified_at),
    emailVerifiedAt: user.email_verified_at || null,
  }
}
