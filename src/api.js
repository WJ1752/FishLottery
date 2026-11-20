// 浏览器 → 服务端的唯一通道。
// 写操作带 X-Requested-With: fetch，游戏动作另外携带幂等键。

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }

export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message || code || `HTTP ${status}`)
    this.status = status
    this.code = code
    this.body = body
  }
}

let onUnauthorized = null
// 由 AuthGate 注册：会话失效时返回登录页。
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

async function request(path, { method = 'GET', body } = {}) {
  const sessionHandler = onUnauthorized
  const signal = AbortSignal.timeout(10000)
  let response, text
  try {
    response = await fetch(path, {
      method,
      headers: method === 'GET' ? { Accept: 'application/json' } : JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    })
    text = await response.text()
  } catch {
    throw new ApiError(0, 'NETWORK', '无法连接服务器')
  }
  let payload = null
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = null }
  }
  if (!response.ok) {
    const error = new ApiError(response.status, payload?.error, payload?.message, payload)
    // 仅响应当前会话的失效通知，旧请求返回时可能已经登录了其他账号。
    if (response.status === 401 && error.code === 'UNAUTHORIZED' && sessionHandler === onUnauthorized) {
      sessionHandler?.()
    }
    throw error
  }
  if (!payload) throw new ApiError(0, 'NETWORK', '服务器返回异常，请稍后重试')
  return payload
}

const uid = () => (globalThis.crypto?.randomUUID?.() || `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)

export const api = {
  me: () => request('/api/auth/me'),
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  submitTotp: (payload) => request('/api/auth/totp', { method: 'POST', body: payload }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: {} }),
  stepUp: (code) => request('/api/auth/step-up', { method: 'POST', body: { code } }),
  totpSetup: () => request('/api/auth/totp/setup', { method: 'POST', body: {} }),
  totpEnable: (code) => request('/api/auth/totp/enable', { method: 'POST', body: { code } }),
  changePassword: (payload) => request('/api/auth/password', { method: 'POST', body: payload }),
  sendEmailCode: (email) => request('/api/auth/email/send', { method: 'POST', body: { email } }),
  verifyEmail: (code) => request('/api/auth/email/verify', { method: 'POST', body: { code } }),
  // 重置进度：先密码换验证码，再凭验证码清空存档。
  sendResetCode: (password) => request('/api/auth/progress-reset/send', { method: 'POST', body: { password } }),
  confirmReset: (code) => request('/api/auth/progress-reset/confirm', { method: 'POST', body: { code } }),

  bootstrap: () => request('/api/bootstrap'),
  sync: (query) => request(`/api/sync?${new URLSearchParams(query)}`),
  // 响应在传输中丢失时，用原来的幂等键重试一次。
  action: async (action, params = {}) => {
    const options = { method: 'POST', body: { action, params, requestId: uid() } }
    try {
      return await request('/api/action', options)
    } catch (error) {
      if (error.code !== 'NETWORK') throw error
      return request('/api/action', options)
    }
  },
  fx: () => request('/api/fx'),
  // 按标的 + 档位拉 K 线蜡烛。锁着的档位服务端会返回 locked=true。
  fxCandles: (name, grain) => request(`/api/fx/candles?${new URLSearchParams({ name, grain })}`),

  adminOverview: () => request('/api/admin/overview'),
  adminSaveConfig: (config, configVersion) => request('/api/admin/config', { method: 'PUT', body: { config, configVersion } }),
  adminSetRole: (userId, role) => request(`/api/admin/users/${userId}/role`, { method: 'POST', body: { role } }),
  adminReset2fa: (userId) => request(`/api/admin/users/${userId}/reset-2fa`, { method: 'POST', body: {} }),
  adminLogoutUser: (userId) => request(`/api/admin/users/${userId}/logout`, { method: 'POST', body: {} }),
  adminResetFx: () => request('/api/admin/fx/reset', { method: 'POST', body: {} }),
  // 后台底部的两张只读表：昨日影响 + 今日结算预览。不写库，可以反复拉。
  adminFxPreview: () => request('/api/admin/fx/preview'),
  adminDrawNow: () => request('/api/admin/lottery/draw-now', { method: 'POST', body: {} }),
}
