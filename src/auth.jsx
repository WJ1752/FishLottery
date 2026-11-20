import React, { useEffect, useRef, useState } from 'react'
import { Anchor, Check } from 'lucide-react'
import { api, ApiError } from './api'

function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const run = async (fn) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败，请重试')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function AuthShell({ title, children, footer }) {
  return <div className="auth-shell">
    <div className="auth-card panel">
      <div className="auth-brand">
        <div className="brand-mark"><Anchor size={20} strokeWidth={2.2} /></div>
        <div><strong>深海鱼市</strong></div>
      </div>
      <h1>{title}</h1>
      {children}
      {footer && <div className="auth-footer">{footer}</div>}
    </div>
  </div>
}

export function LoginPage({ notice, onAuthenticated, onSwitchToRegister }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const { busy, error, setError, run } = useSubmit()

  const submit = (event) => {
    event.preventDefault()
    run(async () => {
      const result = await api.login({ username, password })
      if (result.totpRequired) {
        setChallenge(result.challengeId)
        setCode('')
        return
      }
      onAuthenticated(result.user)
    })
  }

  const submitTotp = (event) => {
    event.preventDefault()
    run(async () => {
      const result = await api.submitTotp({ challengeId: challenge, code })
      onAuthenticated(result.user)
    })
  }

  if (challenge) {
    return <AuthShell
      title="两步验证"
      footer={<button className="text-button" disabled={busy} onClick={() => { setChallenge(null); setError('') }}>返回登录</button>}
    >
      <form className="auth-form" onSubmit={submitTotp}>
        <label className="admin-field">
          <span>验证码</span>
          <input className="admin-input auth-code-input" value={code} onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code" inputMode="numeric" autoFocus placeholder="123456 或 ABCD-EFGH" />
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-button wide" disabled={busy || !code.trim()}>{busy ? '验证中…' : '验证并进入'}</button>
      </form>
    </AuthShell>
  }

  return <AuthShell
    title="登录"
    footer={<>还没有账号？<button className="text-button" disabled={busy} onClick={onSwitchToRegister}>注册</button></>}
  >
    <form className="auth-form" onSubmit={submit}>
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      <label className="admin-field">
        <span>用户名或邮箱</span>
        <input className="admin-input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required />
      </label>
      <label className="admin-field">
        <span>密码</span>
        <input className="admin-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
      </label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button wide" disabled={busy || !username || !password}>{busy ? '登录中…' : '登录'}</button>
    </form>
  </AuthShell>
}

export function RegisterPage({ onAuthenticated, onSwitchToLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, setError, run } = useSubmit()

  const submit = (event) => {
    event.preventDefault()
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    run(async () => {
      const result = await api.register({ username, password })
      onAuthenticated(result.user)
    })
  }

  return <AuthShell
    title="注册"
    footer={<>已有账号？<button className="text-button" disabled={busy} onClick={onSwitchToLogin}>登录</button></>}
  >
    <form className="auth-form" onSubmit={submit}>
      <label className="admin-field">
        <span>用户名</span>
        <input className="admin-input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required minLength={3} maxLength={32} pattern={'[A-Za-z0-9_\\-]+'} aria-describedby="register-username-hint" />
        <small id="register-username-hint">3–32 位字母、数字、下划线或连字符</small>
      </label>
      <label className="admin-field">
        <span>密码</span>
        <input className="admin-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} aria-describedby="register-password-hint" required />
        <small id="register-password-hint">至少 8 个字符</small>
      </label>
      <label className="admin-field">
        <span>确认密码</span>
        <input className="admin-input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
      </label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button wide" disabled={busy || !username || !password || !confirm}>{busy ? '创建中…' : '创建账号'}</button>
    </form>
  </AuthShell>
}

// 管理员未绑定 2FA 时的引导页：生成密钥 → 手动录入 → 校验一次 → 展示恢复码。
export function TotpSetupPage({ onDone }) {
  const [secret, setSecret] = useState(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const { busy, error, run } = useSubmit()

  useEffect(() => {
    let cancelled = false
    api.totpSetup().then((result) => { if (!cancelled) setSecret(result) }).catch((err) => {
      if (!cancelled) setSecret({ error: err.message })
    })
    return () => { cancelled = true }
  }, [])

  const confirm = (event) => {
    event.preventDefault()
    run(async () => {
      const result = await api.totpEnable(code.trim())
      setCodes(result.recoveryCodes)
    })
  }

  if (codes) {
    return <AuthShell title="已启用两步验证">
      <div className="auth-codes">{codes.map((item) => <code key={item}>{item}</code>)}</div>
      <button className="primary-button wide" onClick={onDone}><Check size={15} /> 继续</button>
    </AuthShell>
  }

  return <AuthShell title="绑定两步验证">
    {!secret && <p className="auth-subtitle">正在生成…</p>}
    {secret?.error && <p className="auth-error" role="alert">{secret.error}</p>}
    {secret && !secret.error && <>
      <div className="auth-secret">
        <span>密钥</span>
        <code>{secret.secret}</code>
      </div>
      <form className="auth-form" onSubmit={confirm}>
        <label className="admin-field">
          <span>验证码</span>
          <input className="admin-input auth-code-input" value={code} onChange={(event) => setCode(event.target.value)}
            inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus />
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-button wide" disabled={busy || code.trim().length < 6}>{busy ? '校验中…' : '启用'}</button>
      </form>
    </>}
  </AuthShell>
}

// 已绑定 2FA、但当前会话还没过 2FA（例如改了密码换了设备）时的 step-up。
export function StepUpPage({ onDone, onCancel }) {
  const [code, setCode] = useState('')
  const { busy, error, run } = useSubmit()
  const submit = (event) => {
    event.preventDefault()
    run(async () => {
      await api.stepUp(code.trim())
      onDone()
    })
  }
  return <AuthShell title="确认身份"
    footer={onCancel ? <button className="text-button" onClick={onCancel}>返回游戏</button> : null}>
    <form className="auth-form" onSubmit={submit}>
      <label className="admin-field">
        <span>验证码</span>
        <input className="admin-input auth-code-input" value={code} onChange={(event) => setCode(event.target.value)}
          inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="123456" />
      </label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button wide" disabled={busy || code.trim().length < 6}>{busy ? '验证中…' : '进入管理后台'}</button>
    </form>
  </AuthShell>
}
