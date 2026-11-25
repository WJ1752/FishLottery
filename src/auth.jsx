import React, { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { api, ApiError } from './api'
import { WaterScene } from './water-scene.jsx'
import './auth-ui.css'

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

function AuthShell({ title, description, children, footer, service = null, embedded = false }) {
  const titleId = useId()
  const maintaining = service?.mode === 'maintenance'
  const card = <section className="auth-portal-card" aria-labelledby={titleId}>
    <header className="auth-portal-heading">
      <h1 id={titleId}>{embedded && <ShieldCheck size={23} aria-hidden="true" />}{title}</h1>
      {description && <p>{description}</p>}
    </header>
    {(service?.message || maintaining) && <div className={`service-bulletin${maintaining ? ' service-paused' : ''}`} role="status">
      <strong>{maintaining ? '维护中' : '港口公告'}</strong>
      <span>{service.message || '游戏操作已暂停。'}</span>
    </div>}
    {children}
    {footer && <div className="auth-footer">{footer}</div>}
  </section>

  if (embedded) return <div className="auth-portal-gate">{card}</div>

  return <div className="auth-portal">
    <header className="auth-portal-brand">
      <span className="signal-flag" aria-hidden="true" />
      <strong>深海鱼市</strong>
    </header>
    <main className="auth-portal-layout">
      <div className="auth-portal-art" aria-hidden="true"><WaterScene depthId="shelf" running still /></div>
      {card}
    </main>
  </div>
}

export function LoginPage({ notice, service, onAuthenticated, onSwitchToRegister }) {
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
      service={service}
      title="两步验证"
      description="输入验证器中的验证码，或使用一条备用恢复码。"
      footer={<button className="text-button" disabled={busy} onClick={() => { setChallenge(null); setError('') }}>返回登录</button>}
    >
      <form className="auth-form" onSubmit={submitTotp}>
        <label className="admin-field">
          <span>验证码或恢复码</span>
          <input className="admin-input auth-code-input" value={code} onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} autoFocus />
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-button wide" disabled={busy || !code.trim()}>{busy ? '验证中…' : '验证并进入'}</button>
      </form>
    </AuthShell>
  }

  return <AuthShell
    service={service}
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
      <button className="primary-button wide" disabled={busy || !username || !password}>{busy ? '登录中…' : '登录'}<ArrowRight size={17} aria-hidden="true" /></button>
    </form>
  </AuthShell>
}

export function RegisterPage({ service, onAuthenticated, onSwitchToLogin }) {
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
    service={service}
    title="注册"
    description="创建账号后，鱼获和航海进度会随账号保存。"
    footer={<>已有账号？<button className="text-button" disabled={busy} onClick={onSwitchToLogin}>登录</button></>}
  >
    <form className="auth-form" onSubmit={submit}>
      <label className="admin-field">
        <span id="register-username-label">用户名</span>
        <input className="admin-input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required minLength={3} maxLength={32} pattern={'[A-Za-z0-9_\\-]+'} aria-labelledby="register-username-label" aria-describedby="register-username-hint" />
        <small id="register-username-hint">3–32 位字母、数字、下划线或连字符</small>
      </label>
      <label className="admin-field">
        <span id="register-password-label">密码</span>
        <input className="admin-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} aria-labelledby="register-password-label" aria-describedby="register-password-hint" required />
        <small id="register-password-hint">至少 8 个字符</small>
      </label>
      <label className="admin-field">
        <span>确认密码</span>
        <input className="admin-input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
      </label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button wide" disabled={busy || !username || !password || !confirm}>{busy ? '创建中…' : '创建账号'}<ArrowRight size={17} aria-hidden="true" /></button>
    </form>
  </AuthShell>
}

// 管理员未绑定 2FA 时的引导页：生成密钥 → 手动录入 → 校验一次 → 展示恢复码。
export function TotpSetupPage({ onDone, onCancel }) {
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
    return <AuthShell title="已启用两步验证" description="请妥善保存这些一次性恢复码，无法使用验证器时可以用它们登录。" embedded>
      <div className="auth-codes">{codes.map((item) => <code key={item}>{item}</code>)}</div>
      <button className="primary-button wide" onClick={onDone}><Check size={15} /> 继续</button>
    </AuthShell>
  }

  return <AuthShell title="绑定两步验证" description="在验证器中手动添加密钥，然后输入生成的 6 位验证码。" embedded
    footer={onCancel ? <button className="text-button" type="button" disabled={busy} onClick={onCancel}>返回游戏</button> : null}>
    {!secret && <p className="auth-subtitle" role="status">正在生成…</p>}
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
  return <AuthShell title="确认身份" description="输入验证器中的验证码或一条备用恢复码，以进入管理后台。" embedded
    footer={onCancel ? <button className="text-button" type="button" disabled={busy} onClick={onCancel}>返回游戏</button> : null}>
    <form className="auth-form" onSubmit={submit}>
      <label className="admin-field">
        <span>验证码或恢复码</span>
        <input className="admin-input auth-code-input" value={code} onChange={(event) => setCode(event.target.value)}
          autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} autoFocus />
      </label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button wide" disabled={busy || code.trim().length < 6}>{busy ? '验证中…' : '进入管理后台'}</button>
    </form>
  </AuthShell>
}
