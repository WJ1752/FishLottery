import { transaction } from '../db/index.js'
import {
  SESSION_COOKIE, SESSION_TTL_MS, changePassword, completeTotpLogin, createSession, destroySession,
  enableTotp, findUserById, publicUser, readSession, registerUser, requireAdmin, resetTotp, setupTotp, startLogin, stepUp,
} from '../services/auth.js'
import { HttpError, badRequest, unauthorized } from '../http-util.js'
import { otpauthUri } from '../lib/totp.js'
import { now } from '../lib/clock.js'
import { getConfig } from '../services/config.js'
import { confirmEmailVerification, requestEmailVerification } from '../services/verify.js'
import { confirmProgressReset, requestProgressReset } from '../services/reset.js'

const cookieOptions = (maxAgeSeconds) => [
  `${SESSION_COOKIE}=`,
  'Path=/',
  'HttpOnly',
  'Secure',
  'SameSite=Strict',
  maxAgeSeconds === 0 ? 'Max-Age=0' : `Max-Age=${maxAgeSeconds}`,
].join('; ')

export const setSessionCookie = (token) => `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
export const clearSessionCookie = () => cookieOptions(0)

// 认证相关路由。全部返回 JSON；会话 cookie 由这里统一设置。
export function authRoutes(router) {
  router.post('/api/auth/register', async (ctx) => {
    const { username, password, displayName } = ctx.body
    const user = registerUser(ctx.db, { username, password, displayName }, { ip: ctx.ip })
    const token = createSession(ctx.db, user.id, { ip: ctx.ip, userAgent: ctx.userAgent })
    return { status: 201, body: { user: publicUser(user) }, headers: { 'Set-Cookie': setSessionCookie(token) } }
  })

  router.post('/api/auth/login', async (ctx) => {
    const { username, password } = ctx.body
    if (!username || !password) throw badRequest('MISSING_CREDENTIALS', '请输入用户名与密码')
    const result = startLogin(ctx.db, { username, password }, { ip: ctx.ip, userAgent: ctx.userAgent })
    if (result.totpRequired) return { status: 200, body: { totpRequired: true, challengeId: result.challengeId, expiresAt: result.expiresAt } }
    return { status: 200, body: { user: result.user, totpRequired: false }, headers: { 'Set-Cookie': setSessionCookie(result.token) } }
  })

  router.post('/api/auth/totp', async (ctx) => {
    const { challengeId, code } = ctx.body
    const result = completeTotpLogin(ctx.db, { challengeId, code }, { ip: ctx.ip, userAgent: ctx.userAgent })
    return { status: 200, body: { user: result.user, totpRequired: false }, headers: { 'Set-Cookie': setSessionCookie(result.token) } }
  })

  router.post('/api/auth/logout', async (ctx) => {
    destroySession(ctx.db, ctx.token)
    return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': clearSessionCookie() } }
  })

  router.get('/api/auth/me', async (ctx) => {
    if (!ctx.auth) return { status: 200, body: { user: null, serverTime: now() } }
    return {
      status: 200,
      body: {
        user: publicUser(ctx.auth.user),
        mfaActive: Boolean(ctx.auth.mfaAt) && now() - ctx.auth.mfaAt < 12 * 60 * 60 * 1000,
        serverTime: now(),
      },
    }
  })

  // 生成 TOTP 密钥（未绑定状态）。返回 base32 与 otpauth:// 文本，前端展示给玩家手动录入。
  router.post('/api/auth/totp/setup', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    const { secret } = setupTotp(ctx.db, ctx.auth.user.id)
    return { status: 200, body: { secret, uri: otpauthUri({ secret, account: ctx.auth.user.username }) } }
  })

  // 校验一次验证码后正式启用，并一次性返回恢复码。
  router.post('/api/auth/totp/enable', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    const result = enableTotp(ctx.db, ctx.auth, ctx.body.code)
    return { status: 200, body: result }
  })

  // 已登录会话的 step-up：管理员进后台前补一次 2FA。
  router.post('/api/auth/step-up', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    const result = stepUp(ctx.db, ctx.auth, ctx.body.code)
    return { status: 200, body: result }
  })

  router.post('/api/auth/password', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    return { status: 200, body: changePassword(ctx.db, ctx.auth, ctx.body) }
  })

  // 邮箱验证（可选功能）：发码 → 校验 → 解绑。
  // 验证码只发到邮箱，响应里不回传，避免前端/日志泄漏。
  router.post('/api/auth/email/send', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    const result = await requestEmailVerification(ctx.db, ctx.auth.user.id, ctx.body.email)
    return { status: 200, body: result }
  })

  router.post('/api/auth/email/verify', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    const result = confirmEmailVerification(ctx.db, ctx.auth.user.id, ctx.body.code)
    return { status: 200, body: { ...result, user: publicUser(findUserById(ctx.db, ctx.auth.user.id)) } }
  })

  // 邮箱是登录标识，一旦验证就锁定：不提供解绑/换绑接口。
  // 保留这个路径只为返回明确原因，老版本前端点到时会看到文字而不是 404。
  router.post('/api/auth/email/remove', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    throw new HttpError(409, 'EMAIL_LOCKED', '邮箱绑定后不能解绑')
  })

  // 重置进度：密码 → 邮箱验证码 → 清空快照。两步都在这两个接口里，不走 /api/action。
  router.post('/api/auth/progress-reset/send', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    const result = await requestProgressReset(ctx.db, ctx.auth.user.id, { password: ctx.body.password })
    return { status: 200, body: result }
  })

  router.post('/api/auth/progress-reset/confirm', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    const { config } = getConfig(ctx.db)
    const result = await confirmProgressReset(ctx.db, ctx.auth.user.id, { code: ctx.body.code }, config)
    return { status: 200, body: result }
  })

  // 管理员重置自己的 2FA 后结束会话，重新登录才能绑定。
  router.post('/api/auth/totp/reset', async (ctx) => {
    if (!ctx.auth) throw unauthorized()
    requireAdmin(ctx.db, ctx.auth)
    transaction(ctx.db, () => resetTotp(ctx.db, ctx.auth.user.id))
    return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': clearSessionCookie() } }
  })

  return router
}

export { readSession }
