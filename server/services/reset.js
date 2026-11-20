import { get, run, transaction } from '../db/index.js'
import { HttpError, badRequest, tooMany } from '../http-util.js'
import { sha256, verifyPasswordAsync } from '../lib/passwords.js'
import { randomInt } from 'node:crypto'
import { now } from '../lib/clock.js'
import { log } from '../lib/logger.js'
import { createInitialState } from '../../src/game.js'
import { cryptoRandom } from '../lib/rng.js'
import { extractPlayerState, loadPlayer, redactScratchFaces, savePlayer, withPlayerLock } from './players.js'
import { maskEmail, verificationMailConfig } from './verify.js'
import { resetProgressMail, sendMail } from './mail.js'

// 重置进度：必须「密码 + 邮箱验证码」两步。
//
// 为什么不复用 ACTION_NAMES 里的 resetProgress：那个动作只需要一个已登录的会话，
// 会话被 XSS 或共用设备拿到就能清空存档。这里把重置拆成两条独立请求：
//   1) 提交密码，通过后往已验证邮箱发一次性验证码；
//   2) 提交验证码，校验通过才真正清空玩家快照。
// 两步之间不签发任何「已授权」令牌——验证码本身就是凭证，且只能消费一次。

export const RESET_CODE_TTL_MS = 10 * 60 * 1000
export const RESET_RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_SENDS_PER_HOUR = 5

const hashCode = (userId, code) => sha256(`reset:${userId}:${code}`)

// 密码错误计数：重置接口能验证密码，不能让它变成不限速的密码爆破入口。
// 15 分钟内错 5 次就锁住重置，登录接口有自己的计数，互不影响。
const PASSWORD_WINDOW_MS = 15 * 60 * 1000
const PASSWORD_MAX_FAILURES = 5
const passwordFailures = new Map()
let sweepAt = 0

function assertNotLocked(userId) {
  const at = now()
  if (at >= sweepAt) {
    for (const [key, item] of passwordFailures) {
      if (at - item.since >= PASSWORD_WINDOW_MS) passwordFailures.delete(key)
    }
    sweepAt = at + PASSWORD_WINDOW_MS
  }
  const entry = passwordFailures.get(Number(userId))
  if (!entry) return
  if (at - entry.since >= PASSWORD_WINDOW_MS) {
    passwordFailures.delete(Number(userId))
    return
  }
  if (entry.count >= PASSWORD_MAX_FAILURES) throw tooMany('密码错误次数过多，请 15 分钟后再试')
}

function bumpPasswordFailure(userId) {
  const key = Number(userId)
  const at = now()
  const entry = passwordFailures.get(key)
  if (!entry || at - entry.since > PASSWORD_WINDOW_MS) {
    passwordFailures.set(key, { since: at, count: 1 })
    return
  }
  entry.count += 1
}

function generateCode() {
  return String(randomInt(1_000_000)).padStart(6, '0')
}

// 第一步：校验密码，然后把验证码发到账号已验证的邮箱。
export async function requestProgressReset(db, userId, { password }) {
  const before = get(db, 'SELECT password_hash FROM users WHERE id = ?', Number(userId))
  if (!before) throw badRequest('NO_USER', '账号不存在')
  assertNotLocked(userId)
  if (typeof password !== 'string' || password.length > 200 || !await verifyPasswordAsync(password, before.password_hash)) {
    bumpPasswordFailure(userId)
    throw new HttpError(401, 'BAD_CREDENTIALS', '密码错误')
  }
  const user = get(db, 'SELECT * FROM users WHERE id = ?', Number(userId))
  if (!user || user.disabled || user.password_hash !== before.password_hash) {
    throw new HttpError(409, 'CREDENTIAL_CHANGED', '账号状态已更新，请重新登录')
  }
  passwordFailures.delete(Number(userId))
  // 没有已验证邮箱就没法完成第二步：明确告诉前端去绑定，而不是静默失败。
  if (!user.email_verified_at || !user.email_key) {
    throw new HttpError(409, 'EMAIL_REQUIRED', '重置进度需要先绑定并验证邮箱')
  }

  const at = now()
  const recent = get(db, 'SELECT created_at FROM reset_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1', Number(userId))
  if (recent && at - Number(recent.created_at) < RESET_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESET_RESEND_COOLDOWN_MS - (at - Number(recent.created_at))) / 1000)
    throw tooMany(`请 ${wait} 秒后再获取验证码`)
  }
  const hourly = Number(get(
    db,
    'SELECT COUNT(*) AS n FROM reset_tokens WHERE user_id = ? AND created_at > ?',
    Number(userId),
    at - 60 * 60 * 1000,
  )?.n) || 0
  if (hourly >= MAX_SENDS_PER_HOUR) throw tooMany('验证码发送过于频繁，请稍后再试')

  const config = verificationMailConfig()
  const code = generateCode()
  const tokenId = transaction(db, () => {
    run(db, 'UPDATE reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', at, Number(userId))
    return run(
      db,
      'INSERT INTO reset_tokens(user_id, code_hash, created_at, expires_at) VALUES(?, ?, ?, ?)',
      Number(userId),
      hashCode(userId, code),
      at,
      at + RESET_CODE_TTL_MS,
    ).lastInsertRowid
  })

  const mail = resetProgressMail({ username: user.username, code, minutes: RESET_CODE_TTL_MS / 60000 })
  if (!config) {
    // 未配置 SMTP：验证码写日志，和邮箱验证保持同一套本地调试方式。
    log.warn('未配置 SMTP，重置进度验证码只写日志', { email: user.email_key, code })
    return { sent: true, delivered: false, email: maskEmail(user.email_key), expiresAt: at + RESET_CODE_TTL_MS }
  }
  try {
    await sendMail({ ...config, to: user.email_key, subject: mail.subject, text: mail.text })
    return { sent: true, delivered: true, email: maskEmail(user.email_key), expiresAt: at + RESET_CODE_TTL_MS }
  } catch (error) {
    // 发信失败就删掉刚写的码，否则玩家拿不到码还要等冷却。
    run(db, 'DELETE FROM reset_tokens WHERE id = ? AND used_at IS NULL', tokenId)
    log.error('重置进度验证码发送失败', { userId, message: error?.message })
    throw new HttpError(502, 'MAIL_FAILED', '验证码邮件发送失败，请稍后重试')
  }
}

function assertCode(db, userId, rawCode) {
  const code = String(rawCode || '').trim()
  if (!/^\d{6}$/.test(code)) throw badRequest('INVALID_CODE', '请输入 6 位验证码')
  const token = get(
    db,
    'SELECT * FROM reset_tokens WHERE user_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1',
    Number(userId),
  )
  if (!token) throw badRequest('NO_PENDING_CODE', '请先获取验证码')
  if (Number(token.expires_at) <= now()) {
    run(db, 'UPDATE reset_tokens SET used_at = ? WHERE id = ?', now(), token.id)
    throw badRequest('CODE_EXPIRED', '验证码已过期，请重新获取')
  }
  if (Number(token.attempts) >= MAX_ATTEMPTS) {
    throw badRequest('TOO_MANY_ATTEMPTS', '尝试次数过多，请重新获取验证码')
  }
  if (token.code_hash !== hashCode(userId, code)) {
    run(db, 'UPDATE reset_tokens SET attempts = attempts + 1 WHERE id = ?', token.id)
    const left = MAX_ATTEMPTS - (Number(token.attempts) + 1)
    throw badRequest('INVALID_CODE', left > 0 ? `验证码错误，还可尝试 ${left} 次` : '验证码错误次数过多，请重新获取')
  }
  return token
}

// 第二步：校验验证码，然后清空玩家快照。返回重置后的状态与版本。
export async function confirmProgressReset(db, userId, { code }, config) {
  const result = await withPlayerLock(userId, () => {
    const token = assertCode(db, userId, code)
    const at = now()
    return transaction(db, () => {
      const update = run(db, 'UPDATE reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', at, token.id)
      if (!update.changes) throw badRequest('NO_PENDING_CODE', '请先获取验证码')
      const { state: previous, version } = loadPlayer(db, userId, config)
      const fresh = createInitialState(config, cryptoRandom)
      fresh.fishing.lastTickAt = at
      // 「无灯」是黑市购买项，重置后购买记录已清空，主题回退默认。
      fresh.settings = previous.settings?.theme === 'void'
        ? { ...previous.settings, theme: 'dark' }
        : previous.settings
      const nextVersion = savePlayer(db, userId, fresh, version)
      return { state: fresh, version: nextVersion }
    })
  })
  return { ok: true, version: result.version, me: redactScratchFaces(extractPlayerState(result.state)) }
}
