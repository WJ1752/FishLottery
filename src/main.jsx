import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FISHING_TOUR, GuideCard, GuideDeck, GuideNewBadge, pendingGuideCard, STEP_LABELS } from './guide.jsx'
import { createRoot } from 'react-dom/client'
import { Anchor, ArrowLeft, ArrowRight, BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Coins, Compass, Fish, Gift, Hammer, HandCoins, LogOut, Menu, Moon, Package, Pause, Play, Scale, Settings2, ShieldCheck, Skull, SlidersHorizontal, Sparkles, Store, Sun, Ticket, TimerReset, TrendingUp, Unlock, Volume2, VolumeX, Waves, X } from 'lucide-react'
import { BASE_ENERGY_PER_SECOND, COIN, DAILY_CONTRACTS, DEFAULT_THEME, DEPTHS, THEMES, SCRATCH_DEFAULT_SLOTS, SCRATCH_MIN_SLOTS, RECOVERY_MS, autoRepairRestore, autoRepairThreshold, autoStopThreshold, biteProgress, guideTabVisible, normalizeGuideConfig, canEmergencyRepairRod, canRepairRod, durabilityTensionFactor, guideStepCopy, hitDistribution, rewardFor, blackDailyQuota, blackFishEligible, blackFishValue, blackMarketUnlocked, blackOwnsTheme, canUnlockDepth, depthSurvey, depthUnlockCost, depthsFor, fishMatchesExchangeFilter, fxConfig, fxPosition, nextDrawAt, normalizeSettings, scratchGridLayout, scratchPairedSlots, scratchRadius, scratchThreshold, ticketCostFor, upgradeCostAt, warehouseCapacity, warehouseCount, warehouseUpgradeCost, canUpgradeWarehouse, ENERGY_PER_CATCH, MATERIALS, MIN_DURABILITY, TRAITS, formatCountdown, lotteryTypeFor, quoteForFish, quoteLabel, rodConfigFor, scratchTypeFor, sortNumberedTickets, machineDefFor, machineUnlocked, machineStatus, machineShiftHours, machineFeePerItem, machineDepositMax, machineModuleStats, machineModules, machineModulesUnlocked, workshopLocation } from './game'
import { tensionAt } from './traits'
import { api, setUnauthorizedHandler } from './api'
import { LoginPage, RegisterPage, StepUpPage, TotpSetupPage } from './auth'
import { FxCandles, clampNum, decodeCandleRows, fmtPct, fmtPrice, fxGrainLabel } from './fx-chart'
import { depthArt, fishArt, itemArt, locationArt } from './art'
import FishCodex from './fish-codex.jsx'
import { getGameSoundEnabled, playGameCue, primeGameAudio, setGameSoundEnabled } from './game-audio.js'

// 没有蜡烛时返回同一个空数组：稳定引用，避免下游 effect 因引用变化反复触发。
const EMPTY_CANDLES = []
import './styles.css'
import './lottery-effects.css'
import './market-effects.css'
import './game-pages-ui.css'
import './navigation-ui.css'

const AdminPage = lazy(() => import('./admin'))

const NAV = [
  { id: 'fishing', label: '钓鱼', icon: Fish },
  { id: 'npc', label: '潮汐商会', shortLabel: '商会', icon: Waves },
  { id: 'lottery', label: '彩票中心', shortLabel: '彩票', icon: Ticket },
  { id: 'fx', label: '深海FX', shortLabel: '行情', icon: TrendingUp },
  { id: 'scratch', label: '刮刮乐', icon: Gift },
  { id: 'stats', label: '航海日志', shortLabel: '日志', icon: BarChart3 },
  { id: 'admin', label: '管理后台', icon: Settings2 },
  { id: 'settings', label: '设置', icon: SlidersHorizontal },
]

// 黑市与鱼市各自有一组导航，钓鱼始终由服务端推进。
const BLACK_NAV = [
  { id: 'black-buy', label: '收购', icon: HandCoins },
  { id: 'black-super', label: '超级刮刮乐', shortLabel: '超级刮卡', icon: Gift },
  { id: 'black-shop', label: '商店', icon: Store },
  { id: 'black-workshop', label: '工作间', icon: SlidersHorizontal },
]

const BLACK_COIN_ICON = '◉'
const BLACK_COIN_COLOR = '#a06bff'
const isBlackTab = (id) => String(id || '').startsWith('black-')

const cn = (...values) => values.filter(Boolean).join(' ')
const SYNC_MS = 1000
const fmtTime = (at) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

function AuthGate() {
  const [phase, setPhase] = useState('loading')
  const [user, setUser] = useState(null)
  const [authNotice, setAuthNotice] = useState('')
  const [service, setService] = useState(null)

  const checkSession = useCallback(async () => {
    setPhase('loading')
    setAuthNotice('')
    try {
      const result = await api.me()
      setUser(result.user)
      setPhase(result.user ? 'game' : 'login')
    } catch (error) {
      setAuthNotice(error.message)
      setPhase('connection-error')
    }
  }, [])

  useEffect(() => { void checkSession() }, [checkSession])
  useEffect(() => {
    let active = true
    api.status().then((current) => { if (active) setService(current) }).catch(() => {})
    return () => { active = false }
  }, [])

  const endSession = useCallback((message = '') => {
    setAuthNotice(message)
    setUser(null)
    setPhase('login')
  }, [])
  const signIn = (nextUser) => { setAuthNotice(''); setUser(nextUser); setPhase('game') }
  const signOut = useCallback(async () => {
    await api.logout()
    endSession()
  }, [endSession])
  const expireSession = useCallback(() => endSession('登录已过期，请重新登录。'), [endSession])

  if (phase === 'loading') return <div className="auth-shell"><p className="auth-subtitle">正在连接服务器…</p></div>
  if (phase === 'connection-error') return <div className="auth-shell">
    <div className="panel auth-card"><h1>连接失败</h1><p className="auth-subtitle" role="alert">{authNotice}</p>
      <button className="primary-button wide" onClick={checkSession}>重试连接</button></div>
  </div>
  if (phase === 'login') return <LoginPage notice={authNotice} service={service} onAuthenticated={signIn} onSwitchToRegister={() => setPhase('register')} />
  if (phase === 'register') return <RegisterPage service={service} onAuthenticated={signIn} onSwitchToLogin={() => setPhase('login')} />
  return <GameApp user={user} initialService={service} onUserChange={setUser} onSignOut={signOut} onSessionExpired={expireSession} />
}

function GameApp({ user, initialService, onUserChange, onSignOut, onSessionExpired }) {
  const [me, setMe] = useState(null)
  // 深海FX 行情快照：服务端算好的报价 + 档位 + 蜡烛。
  // 客户端不再持有 days/today/bins，也就无法在本地复算价格。
  const [fxSnapshot, setFxSnapshot] = useState(null)
  const [config, setConfig] = useState(null)
  const [configVersion, setConfigVersion] = useState(0)
  const [lottery, setLottery] = useState(null)
  const [clockOffset, setClockOffset] = useState(0)
  const [clientNow, setClientNow] = useState(() => Date.now())
  const [notice, setNotice] = useState(null)
  const [drawer, setDrawer] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [depthOverlay, setDepthOverlay] = useState(false)
  const [activeTab, setActiveTab] = useState('fishing')
  const [bootError, setBootError] = useState('')
  const [busy, setBusy] = useState(false)
  const [disconnected, setDisconnected] = useState(false)
  const [service, setService] = useState(initialService)
  const [soundEnabled, setSoundEnabled] = useState(getGameSoundEnabled)
  // 记住进黑市前停在哪个鱼市页面，品牌锁返回时恢复。
  const lastFishTabRef = useRef('fishing')
  const actionPending = useRef(false)
  const noticeTimer = useRef(null)

  const cursor = useRef({ meVersion: 0, daysVersion: 0, serverTime: 0 })
  const configVersionRef = useRef(0)

  const toggleSound = () => {
    const enabled = !soundEnabled
    setGameSoundEnabled(enabled)
    setSoundEnabled(enabled)
    if (enabled) {
      primeGameAudio()
      playGameCue('sound-preview')
    }
  }

  useEffect(() => {
    // 每次进入游戏注册独立监听，已退出的请求不能影响下一个会话。
    setUnauthorizedHandler(() => onSessionExpired())
    return () => setUnauthorizedHandler(null)
  }, [onSessionExpired])

  const applySnapshot = useCallback((data) => {
    if (data.service) setService((current) => Number(data.service.version) < Number(current?.version) ? current : data.service)
    const previous = cursor.current
    const version = Number(data.meVersion) || 0
    const serverTime = Number(data.serverTime) || 0
    if (version < previous.meVersion || (version === previous.meVersion && serverTime < previous.serverTime)) return false
    cursor.current = { meVersion: version, daysVersion: data.daysVersion ?? previous.daysVersion, serverTime }
    if (data.me || data.fishing) setMe((current) => {
      const snapshot = data.me || current
      if (!snapshot || !data.fishing) return snapshot
      return { ...snapshot, fishing: { ...snapshot.fishing, ...data.fishing } }
    })
    if (data.fx) setFxSnapshot((current) => ({
      ...data.fx,
      candles: data.fx.candles || current?.candles,
    }))
    if (data.lottery) setLottery(data.lottery)
    const receivedAt = Date.now()
    setClientNow(receivedAt)
    setClockOffset(serverTime - receivedAt)
    return true
  }, [])

  // 配置数据与版本一起提交。单独的版本通知留给轮询触发刷新。
  const applySavedConfig = useCallback((version, nextConfig) => {
    const nextVersion = Number(version) || 0
    if (!nextConfig || nextVersion < configVersionRef.current) return
    configVersionRef.current = nextVersion
    setConfig(nextConfig)
    setConfigVersion(nextVersion)
  }, [])

  const applyBootstrap = useCallback((data) => {
    applySavedConfig(data.configVersion, data.config)
    if (applySnapshot(data) && data.user) onUserChange(data.user)
  }, [applySavedConfig, applySnapshot, onUserChange])

  const refresh = useCallback(async () => {
    setBootError('')
    try {
      const data = await api.bootstrap()
      applyBootstrap(data)
      setDisconnected(false)
    } catch (error) {
      if (error.code !== 'UNAUTHORIZED') setBootError(error.message || '无法从服务器加载存档')
    }
  }, [applyBootstrap])

  useEffect(() => { refresh() }, [refresh])

  const hasPlayer = me !== null
  useEffect(() => {
    if (!hasPlayer) return undefined
    let cancelled = false
    let timer = null
    let polling = false
    let failures = 0
    const poll = async () => {
      if (polling || document.hidden) return
      polling = true
      try {
        const data = await api.sync({ v: cursor.current.meVersion, d: cursor.current.daysVersion })
        if (cancelled) return
        applySnapshot(data)
        if (Number(data.configVersion) > configVersionRef.current) {
          const fresh = await api.bootstrap()
          if (cancelled) return
          applyBootstrap(fresh)
        }
        failures = 0
        setDisconnected(false)
        setBootError('')
      } catch (error) {
        if (cancelled || error.code === 'UNAUTHORIZED') return
        failures += 1
        setDisconnected(true)
      } finally {
        polling = false
        if (!cancelled && !document.hidden) timer = window.setTimeout(poll, Math.min(15000, SYNC_MS * 2 ** failures))
      }
    }
    const onVisibility = () => {
      window.clearTimeout(timer)
      if (!document.hidden) void poll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    timer = window.setTimeout(poll, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [hasPlayer, applyBootstrap, applySnapshot])

  useEffect(() => {
    const id = window.setInterval(() => setClientNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const now = clientNow + clockOffset

  const theme = normalizeSettings(me?.settings).theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const themeColor = theme === 'light' ? '#eee8dd' : theme === 'void' ? '#0a0710' : '#101720'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor)
  }, [theme])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [activeTab])

  const blackMode = isBlackTab(activeTab)
  const blackUnlocked = Boolean(me && config && blackMarketUnlocked({ unlockedDepths: me.unlockedDepths }, config))
  const blackIntroSeen = Boolean(me?.blackMarket?.introSeen)
  const maintaining = service?.mode === 'maintenance'
  const flash = useCallback((message, error = false) => {
    if (!message) return
    window.clearTimeout(noticeTimer.current)
    setNotice({ message, error })
    noticeTimer.current = window.setTimeout(() => setNotice(null), error ? 5000 : 2800)
  }, [])
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])
  // 黑市模式中途被禁用/失去解锁条件时退回鱼市，避免卡在一个空壳导航里。
  useEffect(() => {
    if (!blackMode || blackUnlocked) return
    setActiveTab(lastFishTabRef.current || 'fishing')
    flash('黑市已关闭')
  }, [blackMode, blackUnlocked, flash])

  const signOut = async () => {
    try { await onSignOut() } catch (error) { flash(error.message, true) }
  }

  const send = useCallback(async (action, params = {}, message = '') => {
    if (maintaining) {
      flash(service?.message || '游戏维护中，请稍后再试。', true)
      return null
    }
    if (actionPending.current) return null
    actionPending.current = true
    setBusy(true)
    try {
      const data = await api.action(action, params)
      applySnapshot(data)
      flash(typeof message === 'function' ? message(data) : message)
      return data
    } catch (error) {
      if (error.code !== 'UNAUTHORIZED') {
        flash(error.code === 'NETWORK' ? '操作结果暂未确认，连接恢复后请先查看存档。' : error.message || '操作失败', true)
      }
      return null
    } finally {
      actionPending.current = false
      setBusy(false)
    }
  }, [applySnapshot, flash, maintaining, service?.message])

  const setTheme = (id) => send('setTheme', { theme: id })
  const selectPage = (id) => {
    if (!isBlackTab(id)) lastFishTabRef.current = id
    setActiveTab(id)
    setNavigationOpen(false)
  }
  const enterBlack = (nextTab = 'black-buy') => {
    if (!blackUnlocked) return
    if (!isBlackTab(activeTab)) lastFishTabRef.current = activeTab
    selectPage(nextTab)
    // 首次进入才写标记；之后品牌锁不再闪紫光。动作幂等，失败也不阻塞切换。
    if (!blackIntroSeen) send('blackAcknowledge')
  }
  const exitBlack = () => {
    selectPage(lastFishTabRef.current || 'fishing')
  }
  const applyProgressReset = useCallback((data) => {
    if (data?.me && Number(data.version) >= cursor.current.meVersion) {
      cursor.current = { ...cursor.current, meVersion: Number(data.version) }
      setMe(data.me)
    }
    flash('进度已重置')
    refresh()
  }, [flash, refresh])

  // 逐个解锁用到的两个动作与「页签被锁时回退」的守卫。
  // 注意：这些 Hook 必须放在下面 `if (!me || !config) return` 之前——
  // 否则首帧走提前 return 不执行它们、数据到了之后又多执行一次，
  // React 会抛 #310（Rendered more hooks than during the previous render），整页黑屏。
  const markGuideSeen = useCallback((stepId) => send('guideSeen', { stepId }), [send])
  const skipAllGuide = useCallback(() => send('guideSkip', {}), [send])
  const guideStage = me?.guide?.stage
  const guideSkipped = me?.guide?.skipped
  const isAdminUser = user.role === 'admin'
  useEffect(() => {
    if (!me || !config) return
    if (blackMode || activeTab === 'stats') return
    if ((activeTab === 'admin' && !isAdminUser) || !guideTabVisible({ ...me, config }, activeTab)) setActiveTab('fishing')
  }, [blackMode, activeTab, isAdminUser, guideStage, guideSkipped, me, config])

  if (!me || !config) {
    return <div className="auth-shell">
      {bootError
        ? <div className="panel auth-card"><h1>加载失败</h1><p className="auth-subtitle">{bootError}</p>
          <button className="primary-button wide" onClick={refresh}>重试</button></div>
        : <p className="auth-subtitle">正在加载存档…</p>}
    </div>
  }

  const state = {
    ...me,
    config,
    // 行情的「原料」（days / today / bins）不再下发到客户端，这里也不再拼接；
    // me.fx 只保留玩家自己的持仓与成交流水，价格全部走服务端快照。
    fx: { ...(me.fx || {}) },
    settings: normalizeSettings(me.settings),
    activeTab,
    configVersion,
  }
  const readyClaim = (me.tickets || []).filter((ticket) => ticket.status === 'DRAWN' && !ticket.claimed).length
  const isAdmin = user.role === 'admin'
  // 逐个解锁：鱼市导航只露出已解锁的页签（admin 由角色决定，不参与引导）。
  const visibleNav = NAV.filter((item) => (item.id === 'admin' ? isAdmin : item.id === 'stats' || guideTabVisible(state, item.id)))
  const bridgeNav = blackMode ? BLACK_NAV : visibleNav
  const mobileShortcuts = bridgeNav.filter(({ id }) => id !== 'admin' && id !== 'settings').slice(0, 4)
  const settingsNav = visibleNav.find(({ id }) => id === 'settings')
  const navButton = (entry, compact = false) => <BridgeNavButton key={entry.id} entry={entry} active={activeTab === entry.id} compact={compact} state={state} claimCount={entry.id === 'lottery' ? readyClaim : 0} onSelect={selectPage} />
  const marketToggle = (blackUnlocked || blackMode) && <button type="button" className="bridge-route-change" onClick={blackMode ? exitBlack : () => enterBlack()}>
    {blackMode ? <ArrowLeft size={17} aria-hidden="true" /> : <Skull size={17} aria-hidden="true" />}
    <span>{blackMode ? '返回鱼市' : '进入无灯黑市'}</span>
    {!blackMode && !blackIntroSeen && <span className="bridge-new" aria-label="新解锁的功能" />}
  </button>
  const guideCard = pendingGuideCard(state)

  return <div className={cn('app-shell bridge-app', blackMode && 'is-black')}>
    <header className="bridge-header">
      <div className="bridge-line">
        <div className="bridge-brand">
          <span className="bridge-emblem">{blackMode ? <Skull size={21} aria-hidden="true" /> : <Anchor size={22} aria-hidden="true" />}</span>
          <strong>{blackMode ? '无灯黑市' : '深海鱼市'}</strong>
        </div>
        <div className="bridge-utilities">
          {blackMode
            ? <div className="coin-chip coin-chip-black" title="渔币余额"><ItemIllustration item="渔币" fallback={<Coins size={15} />} /><b>{(me.blackMarket?.coins || 0).toLocaleString('zh-CN')}</b><span className="coin-unit">渔币</span></div>
            : <div className="coin-chip" title="鱼币余额"><ItemIllustration item="鱼币" fallback={<Coins size={15} />} /><b>{(me.coins || 0).toLocaleString('zh-CN')}</b><span className="coin-unit">鱼币</span></div>}
          <div className="bridge-time" title="服务器时间"><span className="live-dot" aria-hidden="true" /><time>{fmtTime(now)}</time></div>
          <GameSoundToggle enabled={soundEnabled} onToggle={toggleSound} compact />
          <button type="button" className="bridge-account" aria-label="打开航行菜单" aria-haspopup="dialog" onClick={() => setNavigationOpen(true)}>
            <span className="bridge-profile" aria-hidden="true">{(user.displayName || user.username || '玩家').slice(0, 1)}</span>
            <span>{user.displayName || user.username}</span><ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="bridge-routes">
        <nav className="bridge-route-list" aria-label={blackMode ? '黑市导航' : '鱼市导航'}>{bridgeNav.map((entry) => navButton(entry))}</nav>
        {marketToggle}
      </div>
    </header>
    <nav className="bridge-dock" aria-label="移动端导航">
      {mobileShortcuts.map((entry) => navButton(entry, true))}
      <button type="button" className={cn('bridge-route', !mobileShortcuts.some(({ id }) => id === activeTab) && 'bridge-route-current')} aria-label="打开航行菜单" aria-haspopup="dialog" onClick={() => setNavigationOpen(true)}>
        <Menu size={19} aria-hidden="true" /><span>更多</span>
        {!blackMode && readyClaim > 0 && !mobileShortcuts.some(({ id }) => id === 'lottery') && <span className="bridge-new" aria-label="有彩票待兑奖" />}
      </button>
    </nav>
    <main className="bridge-content">
      <div className="page-wrap">
        {disconnected && <p className="auth-error connection-status" role="status">与服务器的连接中断，正在重连。存档同步后会更新。</p>}
        {(service?.message || maintaining) && <div className={cn('service-bulletin', maintaining && 'service-paused')} role="status"><strong>{maintaining ? '维护中' : '港口公告'}</strong><span>{service.message || '游戏操作已暂停。'}</span></div>}
        {notice && <div className={cn('toast', notice.error && 'toast-error')} role={notice.error ? 'alert' : 'status'}><Sparkles size={16} />{notice.message}</div>}
        {guideCard && <GuideCard
          key={guideCard.stepId}
          title={STEP_LABELS[guideCard.stepId] || '新手指引'}
          body={guideStepCopy(config?.guide, guideCard.stepId)}
          stepId={guideCard.stepId}
          expiresAt={state.guide?.focus?.[guideCard.stepId] ? guideCard.expiresAt : undefined}
          minCloseMs={guideCard.minCloseMs}
          clockOffset={clockOffset}
          onSeen={markGuideSeen}
          onSkip={skipAllGuide}
          icon={<Sparkles size={16} />}
        />}
        {bootError && <div className="toast toast-error" role="alert">{bootError}</div>}
        {activeTab === 'black-buy' && blackMode && <BlackBuyPage state={state} onAction={send} busy={busy} />}
        {activeTab === 'black-super' && blackMode && <BlackSuperPage state={state} onAction={send} busy={busy} />}
        {activeTab === 'black-shop' && blackMode && <BlackShopPage state={state} onAction={send} busy={busy} />}
        {activeTab === 'black-workshop' && blackMode && <Workshop state={state} onAction={send} busy={busy || maintaining} />}
        {activeTab === 'fishing' && <FishingPage state={state} busy={busy || maintaining} now={now} clockOffset={clockOffset} onOpenDrawer={() => setDrawer(true)} onOpenDepths={() => setDepthOverlay(true)} onOpenMerchant={() => selectPage('npc')} onToggle={() => send('toggleFishing')} onGuideSeen={markGuideSeen} onGuideSkip={skipAllGuide} onAction={send} />}
        {activeTab === 'lottery' && <LotteryPage state={state} now={now} onAction={send} lottery={lottery} busy={busy || maintaining} />}
        {activeTab === 'scratch' && <ScratchPage state={state} onAction={send} onGuideSeen={markGuideSeen} busy={busy || maintaining} onOpenWorkshop={blackUnlocked ? () => enterBlack('black-workshop') : null} />}
        {activeTab === 'fx' && <FxPage state={state} onAction={send} fxSnapshot={fxSnapshot} busy={busy || maintaining} />}
        {activeTab === 'npc' && <NpcPage state={state} onAction={send} />}
        {activeTab === 'stats' && <StatsPage state={state} />}
        {activeTab === 'admin' && isAdmin && <Suspense fallback={<p className="panel admin-loading" role="status">正在加载管理后台…</p>}>
          <AdminPage user={user} onUserChange={onUserChange} config={config} configVersion={configVersion} onConfigSaved={applySavedConfig} onSignOut={onSignOut} />
        </Suspense>}
        {activeTab === 'settings' && <SettingsPage state={state} user={user} onSetTheme={setTheme} onUserChange={onUserChange} onProgressReset={applyProgressReset} soundEnabled={soundEnabled} onToggleSound={toggleSound} />}
      </div>
    </main>
    {navigationOpen && <GameDialog title="航行菜单" className="bridge-menu" closeLabel="关闭航行菜单" onClose={() => setNavigationOpen(false)}>
      <div className="bridge-menu-profile">
        <span className="bridge-profile" aria-hidden="true">{(user.displayName || user.username || '玩家').slice(0, 1)}</span>
        <div><strong>{user.displayName || user.username}</strong>{user.displayName && user.displayName !== user.username && <small>{user.username}</small>}</div>
        {user.totpEnabled && <ShieldCheck size={17} aria-label="已启用两步验证" />}
      </div>
      <nav className="bridge-menu-routes" aria-label={blackMode ? '黑市页面' : '鱼市页面'}>
        {bridgeNav.map((entry) => navButton(entry))}
        {blackMode && settingsNav && navButton(settingsNav)}
      </nav>
      <div className="bridge-menu-actions">
        {marketToggle}
        <button type="button" className="secondary-button" onClick={() => {
          setNavigationOpen(false)
          void signOut()
        }}><LogOut size={16} aria-hidden="true" /> 退出登录</button>
      </div>
    </GameDialog>}
    {drawer && <DurabilityDrawer state={state} busy={busy || maintaining} onClose={() => setDrawer(false)} onAction={send} />}
    {depthOverlay && <SeaSelectorOverlay state={state} busy={busy || maintaining} onClose={() => setDepthOverlay(false)} onSelect={async (depthId) => {
      if (await send('selectDepth', { depthId }, '海域已切换')) setDepthOverlay(false)
    }} onUnlock={(depthId) => send('unlockDepth', { depthId }, '海域已解锁')} />}
  </div>
}

function BridgeNavButton({ entry, active, compact, state, claimCount, onSelect }) {
  const { id, label, shortLabel, icon: Icon } = entry
  return <button type="button" className={cn('bridge-route', active && 'bridge-route-current')} aria-current={active ? 'page' : undefined} onClick={() => onSelect(id)}>
    <Icon size={compact ? 19 : 17} aria-hidden="true" />
    <span>{compact ? shortLabel || label : label}</span>
    {claimCount > 0 ? <span className="bridge-claims" aria-label={`${claimCount} 张待兑奖`}>{claimCount}</span> : <GuideNewBadge state={state} tabId={id} />}
  </button>
}


// 通用分页：列表页数据量大时只渲染当前页，页码过多时用省略号折叠。
const PAGE_SIZE = 9
function usePaged(items, pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const slice = items.slice(safePage * pageSize, safePage * pageSize + pageSize)
  return { page: safePage, pageCount, slice, setPage, total: items.length, pageSize }
}

function Pager({ page, pageCount, setPage, total, pageSize }) {
  if (pageCount <= 1) return null
  const pages = []
  for (let i = 0; i < pageCount; i += 1) {
    if (i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 1) pages.push(i)
    else if (pages[pages.length - 1] !== '…') pages.push('…')
  }
  return <nav className="pager" aria-label="分页">
    <span className="pager-info">{page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} / {total}</span>
    <button className="pager-button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="上一页"><ChevronLeft size={14} /></button>
    {pages.map((item, index) => item === '…'
      ? <span className="pager-ellipsis" key={`gap-${index}`}>…</span>
      : <button key={item} className={cn('pager-button', item === page && 'is-active')} aria-current={item === page ? 'page' : undefined} onClick={() => setPage(item)}>{item + 1}</button>)}
    <button className="pager-button" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} aria-label="下一页"><ChevronRight size={14} /></button>
  </nav>
}

function PageHeader({ title, description, art, action }) {
  return <header className={cn('page-header voyage-page-heading', art && 'voyage-page-heading-art')}>
    {art && <img className="voyage-page-art" alt="" src={locationArt(art)} loading="lazy" decoding="async" />}
    <div className="page-heading"><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action && <div className="page-header-action">{action}</div>}
  </header>
}

function ItemIllustration({ item, fallback = null }) {
  const src = itemArt(item)
  return <span className="item-illustration" aria-hidden="true">{src ? <img alt="" src={src} loading="lazy" decoding="async" /> : fallback}</span>
}

function FishPortrait({ fish, large = false }) {
  const src = fishArt(fish)
  return <span className={cn('fish-portrait', large && 'fish-portrait-large')} aria-hidden="true">
    {src ? <img alt="" src={src} loading="lazy" decoding="async" /> : <Fish size={large ? 26 : 18} />}
  </span>
}

function GameDialog({ title, onClose, className = '', closeLabel = '关闭', children }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])

  return <dialog ref={ref} className={cn('game-dialog', className)} aria-label={title} onCancel={(event) => {
    event.preventDefault()
    onClose()
  }} onClick={(event) => {
    if (event.target !== event.currentTarget || event.detail === 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
  }}>
    <header className="game-dialog-head">
      <h2>{title}</h2>
      <button className="icon-button" type="button" onClick={onClose} aria-label={closeLabel}><X size={19} /></button>
    </header>
    {children}
  </dialog>
}
function Metric({ label, value, helper, tone = 'default', onClick, chevron = false }) {
  const content = <>
    <span className="metric-label">{label}{chevron && <ChevronRight size={14} aria-hidden="true" />}</span>
    <strong>{value}</strong>
    {helper && <small>{helper}</small>}
  </>
  if (onClick) return <button type="button" className={cn('metric-card', 'metric-action', `metric-${tone}`)} onClick={onClick}>{content}</button>
  return <div className={cn('metric-card', `metric-${tone}`)}>{content}</div>
}
function StatusPill({ children, tone = 'neutral' }) { return <span className={cn('status-pill', `status-${tone}`)}>{children}</span> }
function EmptyState({ icon: Icon = Package, title }) { return <div className="empty-state"><div className="empty-icon"><Icon size={23} /></div><strong>{title}</strong></div> }

// 服务端每秒同步一次进度；两次同步之间按当前速率插值，进度条才不会一秒跳一格。
function useFrameClock(active) {
  const [at, setAt] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    let raf = 0
    let last = 0
    const loop = () => {
      const ms = Date.now()
      if (ms - last >= 32) { last = ms; setAt(ms) }
      raf = window.requestAnimationFrame(loop)
    }
    raf = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(raf)
  }, [active])
  return at
}

// 把服务端快照外推到当前时刻：进度与张力都从「咬钩起始值」出发按咬钩时长推导，
// 与结算用同一套函数（biteProgress → biteTiming）。不能各自用 lastTickAt 做增量外推：
// 那样进度会先撞上 100% 被夹住、张力还在继续涨，画面就变成了「满了却还在等」。
//
// 结算时刻之后（服务端的答案还在路上）不继续外推：两根条一起冻结在结算前的那一帧。
// 如果这时还让落后那根继续涨，就会出现「两根都满」「满了却判失败」——
// 谁赢由服务端决定并随后由 sync 纠正，界面不能自己编一个结局。
function fishingFrame(state, at) {
  const fishing = state.fishing
  const bite = fishing.bite
  const required = Math.max(1, Number(state.rod?.energyPerCatch) || ENERGY_PER_CATCH)
  const baseProgress = Math.min(required, Math.max(0, Number(fishing.progress) || 0))
  const recoverUntil = Number(fishing.recoverUntil) || 0
  if (recoverUntil > at) {
    const from = Math.max(0, Number(fishing.recoverFrom) || 0)
    const ratio = Math.min(1, Math.max(0, (at - (recoverUntil - RECOVERY_MS)) / RECOVERY_MS))
    return { progress: 0, tension: from * (1 - ratio), tensionMax: from, required, recovering: true }
  }
  if (bite && fishing.running) {
    // biteProgress 到点后会自己把两根条冻结在结算那一刻。
    // resolved=true 表示结算时刻已到、但服务端结果还在路上（最多一个轮询周期）。
    // 这时把「谁赢了」一并交给界面：escaped 由 fillMs <= chargeMs 决定，
    // 客户端与服务端输入相同、判定相同，可以在本地立刻收尾，不必干等 sync。
    const view = biteProgress(state, bite, at)
    return {
      progress: view.progress,
      tension: view.tension,
      tensionMax: view.tensionMax,
      required: view.required,
      recovering: false,
      awaitingOutcome: view.resolved,
      // 本地预测的结局：'caught' | 'escaped' | null（还没到结算时刻）
      predicted: view.resolved ? (view.winner === 'tension' ? 'escaped' : 'caught') : null,
      settleInMs: view.settleInMs,
    }
  }
  return {
    progress: baseProgress,
    tension: Math.max(0, Number(fishing.tension) || 0),
    tensionMax: Math.max(1, Number(state.rod?.tension?.maxTension) || 1000),
    required,
    recovering: false,
    awaitingOutcome: false,
  }
}

function FishingPage({ state, busy, now, clockOffset, onOpenDrawer, onOpenDepths, onOpenMerchant, onToggle, onGuideSeen, onGuideSkip, onAction }) {
  const rod = state.rod
  const bite = state.fishing.bite
  const rate = Math.round(Number.isFinite(Number(rod.energyPerSecond)) ? Math.max(1, Number(rod.energyPerSecond)) : BASE_ENERGY_PER_SECOND)
  // 服务端一秒同步一次；这里按当前速率把两条进度外推到这一帧，画面才是连续充能。
  const frameNow = useFrameClock(state.fishing.running)
  const at = frameNow + (Number(clockOffset) || 0)
  const view = fishingFrame(state, at)
  // 分母一律取自同一份外推结果：咬钩期间是这条鱼自己的张力上限，静止时是钓竿基础张力。
  // 界面和结算读同一个数，才不会出现「显示 100% 但服务端认为还没满」。
  const requiredEnergy = Math.max(1, Number(view.required) || ENERGY_PER_CATCH)
  const progress = Math.min(requiredEnergy, Math.max(0, view.progress))
  const progressPercent = Math.floor((progress / requiredEnergy) * 100)
  const progressWidth = (progress / requiredEnergy) * 100
  const recovering = view.recovering
  // 结算时刻已到、但服务端结果还没随 sync 回来（最多一个轮询周期，实测平均 ~0.5 秒）。
  // 这段时间画面原本会停在 100% 干等，看起来就是「卡一下」。
  // 结局本身客户端算得出来（biteTiming 是确定性的，实测与服务端 100% 一致），
  // 所以先用本地预测收尾动画；摘要卡里的鱼名/重量/耐久损失来自服务端 RNG，仍等 sync 到达后再填。
  const predicted = view.predicted
  const awaiting = Boolean(view.awaitingOutcome) && Boolean(predicted)
  // 服务端结果是否已经追上本地预测（追上后就不再需要本地收尾）。
  // 注意 lastOutcome.at 是 ISO 字符串（resolveBite 里用 stamp() 生成），不是毫秒数，
  // 直接 Number() 会得到 NaN，导致收尾状态永远退不出去 —— 这里统一按时间戳解析。
  const outcomeAt = (() => {
    const raw = state.fishing.lastOutcome?.at
    if (raw === undefined || raw === null) return 0
    const parsed = typeof raw === 'number' ? raw : Date.parse(raw)
    return Number.isFinite(parsed) ? parsed : 0
  })()
  const predictedAt = awaiting ? Number(bite?.startedAt || 0) + Number(view.settleInMs || 0) : 0
  const outcomeArrived = Boolean(state.fishing.lastOutcome) && outcomeAt >= predictedAt - 1
  // 结果到账前先完成进度动画，鱼获状态等服务端同步后再显示。
  const localPending = awaiting && !outcomeArrived
  // 本地收尾期间不再算「咬钩中」：这一杆已经出结果了，张力条应该退场，
  // 否则会出现「已经判了脱钩、张力条还在动」。等 sync 回来由 recovering 接管。
  const reeling = state.fishing.running && Boolean(bite) && !recovering && !localPending
  const maxTension = Math.max(1, Number(view.tensionMax) || Number(bite?.maxTension) || Number(rod.tension?.maxTension) || 1000)
  const tension = Math.max(0, Math.min(maxTension, view.tension))
  const tensionPercent = Math.floor((tension / maxTension) * 100)
  const tensionWidth = (tension / maxTension) * 100
  const tensionLevel = tensionPercent >= 80 ? 'critical' : tensionPercent >= 50 ? 'warning' : 'safe'
  const last = state.fishing.lastOutcome
  const recentEscapes = (state.escapes || []).slice(0, 5)
  const traits = state.config?.traits || TRAITS
  const traitOf = (id) => traits.find((trait) => trait.id === id)
  const availableDepth = depthsFor(state)
  const selectedDepth = availableDepth.find((depth) => depth.id === state.fishing.selectedDepthId) || availableDepth[0]
  const broken = rod.status === 'broken' || rod.durability <= MIN_DURABILITY
  const lowDurability = rod.durability <= autoStopThreshold(state)
  const fishCount = warehouseCount(state)
  const fishCapacity = warehouseCapacity(state)
  const warehouseIsFull = fishCount >= fishCapacity
  const recoverSeconds = recovering ? Math.ceil((state.fishing.recoverUntil - at) / 1000) : 0
  const autoRepairTrigger = autoRepairThreshold(state, rod)
  const autoRepairAmount = autoRepairRestore(rod)
  const statusText = localPending
    ? '结算中'
    : broken ? '钓竿损坏' : warehouseIsFull && !state.fishing.running ? '仓库已满' : lowDurability && !state.fishing.running ? '耐久不足' : recovering ? '鱼已脱钩' : reeling ? '咬钩中' : state.fishing.running ? '自动进行中' : '已暂停'
  const statusTone = localPending
    ? (predicted === 'escaped' ? 'warning' : 'success')
    : broken || (warehouseIsFull && !state.fishing.running) || (lowDurability && !state.fishing.running) ? 'warning' : recovering ? 'warning' : reeling ? 'warning' : state.fishing.running ? 'live' : 'neutral'
  const toggleLabel = state.fishing.running ? '暂停钓鱼' : broken ? '钓竿损坏' : warehouseIsFull ? '仓库已满' : last ? '继续钓鱼' : '开始钓鱼'
  const trackRef = useRef(null)
  const guideConfig = useMemo(() => normalizeGuideConfig(state.config?.guide), [state.config?.guide])
  const guideState = state?.guide || {}
  const showGuide = guideConfig.enabled && !guideState.skipped
  const tourStep = guideConfig.steps.find((step) => step.id === 'tension')
  const rodGuideStep = guideConfig.steps.find((step) => step.id === 'rodGuide')
  const tourOpen = showGuide && tourStep?.card && !guideState.seen?.tension
  const rodGuideOpen = showGuide && rodGuideStep?.card && !guideState.seen?.rodGuide
  const tourMinCloseMs = tourStep?.minCloseMs ?? guideConfig.minCloseMs
  const tourFocusAt = Number(guideState.focus?.tension?.at)
  const merchantAvailable = guideTabVisible(state, 'npc')
  const reelDisabled = busy || broken || (warehouseIsFull && !state.fishing.running)
  return <>
    <div className={cn('voyage-deck', (tourOpen || rodGuideOpen) && 'voyage-deck-guided')}>
      <header className="voyage-scene">
        <img src={depthArt(selectedDepth.id)} alt="" fetchPriority="high" decoding="async" />
        <div className="voyage-scene-copy">
          <span className="voyage-sea-risk"><Waves size={16} aria-hidden="true" />{selectedDepth.riskLabel}</span>
          <h1>钓鱼</h1>
          <button type="button" className="voyage-location-control" onClick={onOpenDepths} aria-label={`选择钓鱼海域，当前为${selectedDepth.label}`} aria-haspopup="dialog">
            <Compass size={19} aria-hidden="true" /><span>{selectedDepth.label}</span><ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <section className="panel voyage-instruments" aria-label="垂钓实况">
        <div className="voyage-panel-head"><h2>垂钓实况</h2><StatusPill tone={statusTone}>{statusText}</StatusPill></div>
        <div className="voyage-gauge" data-guide-anchor="tension">
          <div className="voyage-gauge-label"><span>钓鱼进度</span><strong>{progressPercent}<small>%</small></strong></div>
          <div ref={trackRef} className={cn('progress-track', reeling && 'progress-track-reel', localPending && (predicted === 'caught' ? 'is-settled-catch' : 'is-settled-escape'))} role="progressbar" aria-label="钓鱼进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressPercent}>
            <div className="progress-fill" style={{ width: `${progressWidth}%` }}><span /></div>
            {(reeling || recovering) && <div className={cn('tension-overlay', `overlay-${tensionLevel}`, recovering && 'overlay-decay')} aria-hidden="true" style={{ width: `${tensionWidth}%` }} />}
          </div>
          {reeling || recovering ? <div className="tension-caption"><span>张力 <b className={`tension-${tensionLevel}`}>{Math.round(tension)}</b> / {Math.round(maxTension)}</span>{recovering && <span>{recoverSeconds} 秒后重新开始</span>}</div> : <div className="progress-caption"><span>钓鱼速度 {rate} 能量/秒</span></div>}
        </div>
        {lowDurability && !broken && !state.fishing.running && <div className="durability-warning"><Hammer size={15} /><span>耐久 {Math.round(rod.durability)} · 低于 {Math.round(autoStopThreshold(state))} 自动停钓</span><button className="text-button" onClick={onOpenDrawer}>修复钓竿</button></div>}
        {broken && <div className="durability-warning danger"><Hammer size={15} /><span>耐久耗尽</span><button className="text-button" onClick={onOpenDrawer}>修复钓竿</button></div>}
        {autoRepairTrigger > 0 && <div className="durability-warning auto"><Hammer size={15} /><span>自动维修 · 低于 {Math.round(autoRepairTrigger)} · +{Math.round(autoRepairAmount * 100)}%</span></div>}
        <div className="voyage-instrument-actions">
          <button type="button" className="voyage-rod-control" onClick={onOpenDrawer} data-guide-anchor="durability" aria-haspopup="dialog">
            <ItemIllustration item={rod} fallback={<Hammer size={18} />} />
            <span><strong>钓竿与强化</strong><small>{rod.name}</small></span>
            <b>{Math.round(rod.durability / rod.maxDurability * 100)}%</b>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button type="button" className={cn('primary-button voyage-control', state.fishing.running && 'voyage-control-running')} disabled={reelDisabled} onClick={onToggle}>
            {state.fishing.running ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}{toggleLabel}
          </button>
        </div>
      </section>
      {(tourOpen || rodGuideOpen) && <div className="voyage-guide">
        {tourOpen ? <GuideDeck
          title="钓鱼页导览"
          pages={FISHING_TOUR.map((page) => page.anchor === 'tension' ? { ...page, text: guideStepCopy(guideConfig, tourStep) || page.text } : page)}
          stepId="tension"
          minCloseMs={tourMinCloseMs}
          expiresAt={tourFocusAt > 0 ? tourFocusAt + tourMinCloseMs : undefined}
          clockOffset={clockOffset}
          onSeen={onGuideSeen}
          onSkip={onGuideSkip}
          icon={<Sparkles size={16} />}
        /> : <GuideCard
          title="钓竿与材料"
          body={guideStepCopy(state?.config?.guide, 'rodGuide')}
          stepId="rodGuide"
          minCloseMs={rodGuideStep?.minCloseMs ?? guideConfig.minCloseMs}
          onSeen={onGuideSeen}
          icon={<Anchor size={16} />}
        />}
      </div>}
      <section className="panel voyage-catch">
        <div className="voyage-panel-head">
          <h2>最近鱼获</h2>
          {merchantAvailable && <button type="button" className="secondary-button voyage-trade" onClick={onOpenMerchant}>
            <Package size={15} aria-hidden="true" />去商会兑换 <b>{fishCount}/{fishCapacity}</b>
          </button>}
        </div>
        {localPending ? <p className="voyage-catch-empty" role="status">确认鱼获中…</p> : last ? <div className="voyage-catch-body">
          <div className="voyage-specimen"><FishPortrait fish={last.fish} large /></div>
          <div className="voyage-catch-record">
            <div className="voyage-catch-title">
              <div><h3>{last.fish.name}</h3><span>{last.fish.latin}</span></div>
              <StatusPill tone={last.escaped ? 'warning' : 'success'}>{last.escaped ? '脱钩' : '已入库'}</StatusPill>
            </div>
            <dl className="voyage-catch-facts">
              <div><dt>海域</dt><dd>{last.fish.depth}</dd></div>
              <div><dt>鱼重</dt><dd>{last.fish.weight} kg</dd></div>
              <div><dt>耐久损失</dt><dd className={last.loss > 0 ? 'danger-text' : 'success-text'}>{last.loss > 0 ? `-${last.loss}` : '无'}</dd></div>
            </dl>
            {last.fish.traits?.length > 0 && <div className="voyage-catch-traits">{last.fish.traits.map((id) => {
              const trait = traitOf(id)
              return trait && <span key={id}>{trait.icon} {trait.label}</span>
            })}</div>}
          </div>
        </div> : <p className="voyage-catch-empty"><Fish size={24} aria-hidden="true" />首次钓到鱼后，即可去潮汐商会兑换奖励。</p>}
      </section>
      <DailyContracts daily={state.daily} now={now} busy={busy} onAction={onAction} />
    </div>
    <details className="catch-log panel">
      <summary>脱钩记录<span>{recentEscapes.length} 条</span></summary>
      <div className="catch-table">{recentEscapes.map((fish) => <div className="catch-row" key={`${fish.id}-${fish.escapedAt}`}><FishPortrait fish={fish} /><div className="catch-name"><strong>{fish.name}</strong><span>{fish.latin} · {fish.depth}</span></div><div className="trait-tags">{fish.traits.slice(0, 4).map((id) => { const trait = traitOf(id); return <span key={id} style={{ color: trait?.color }}>{trait?.icon} {trait?.label}</span> })}</div><div className="catch-rarity">{fish.rarity}</div><div className="catch-loss">-{fish.loss}</div><div className="catch-time">{fmtTime(fish.escapedAt || fish.caughtAt)}</div></div>)}{!recentEscapes.length && <EmptyState icon={Fish} title="还没有脱钩记录" />}</div>
    </details>
  </>
}

function DailyContracts({ daily, now, busy, onAction }) {
  if (!daily) return null
  const remaining = (daily.day + 1) * 86400000 - now
  return <aside className="panel daily-panel voyage-contracts" aria-label="航务委托">
    <div className="daily-head"><ClipboardList size={18} aria-hidden="true" /><h2>航务委托</h2><span>{remaining > 0 ? `距刷新 ${formatCountdown(remaining)}` : '等待同步'}</span></div>
    {DAILY_CONTRACTS.map(({ id, label, target, reward }) => {
      const progress = Math.min(target, daily.progress?.[id] || 0)
      const claimed = daily.claimed?.[id]
      return <div className="daily-contract" key={id}>
        <div className="daily-contract-head"><strong>{label}</strong><b>{progress}/{target}</b></div>
        <progress value={progress} max={target} aria-label={label} />
        <div className="daily-contract-foot">
          <span className="daily-reward"><Coins size={13} aria-hidden="true" />{reward.coins} 鱼币{Object.entries(reward.materials || {}).map(([name, qty]) => <span key={name}><ItemIllustration item={name} />{name} ×{qty}</span>)}</span>
          {claimed ? <span className="daily-claimed"><Check size={13} /> 已领取</span>
            : <button className="secondary-button tiny" disabled={busy || progress < target || remaining <= 0} onClick={() => onAction('claimDailyContract', { contractId: id }, '航务委托奖励已领取')}>领取</button>}
        </div>
      </div>
    })}
  </aside>
}

function SeaSelectorOverlay({ state, onClose, onSelect, onUnlock, busy }) {
  const reachable = new Set(depthsFor(state).map((depth) => depth.id))
  const selectedId = state.fishing.selectedDepthId
  return <GameDialog title="航区海图" className="sea-atlas-dialog" onClose={onClose} closeLabel="关闭海域选择">
    <div className="sea-atlas-grid">
      {DEPTHS.map((depth) => {
        const unlocked = reachable.has(depth.id)
        const selected = depth.id === selectedId
        const requirement = depthUnlockCost(state, depth.id)
        const survey = depthSurvey(state, depth.id)
        const priorDepth = DEPTHS.find((item) => item.id === survey?.fromId)?.label
        const surveyRod = state.config.rods.find((item) => item.id === survey?.rodId)
        return <article className={cn('atlas-card', selected && 'atlas-current', !unlocked && 'atlas-locked')} key={depth.id}>
          <div className="atlas-card-image"><img src={depthArt(depth.id)} alt="" loading="lazy" decoding="async" /><StatusPill tone={selected ? 'live' : 'neutral'}>{selected ? '当前海域' : unlocked ? '已解锁' : '未解锁'}</StatusPill></div>
          <div className="atlas-card-copy">
            <div className="atlas-heading"><h3>{depth.label}</h3><span>{depth.riskLabel}</span></div>
            {!unlocked && survey && <p className="atlas-survey">{survey.rewarded ? '踏勘完成，钥匙已发放。' : `在${priorDepth}钓获 ${survey.caught}/${survey.target} 条鱼，可获得解锁材料。`}</p>}
            {!unlocked && surveyRod && <p className="atlas-loot"><ItemIllustration item={surveyRod} />{survey.rewarded ? `换上「${surveyRod.name}」再前往` : `踏勘完成可获得「${surveyRod.name}」`}</p>}
            {!unlocked && requirement && <p className="atlas-cost"><ItemIllustration item={requirement.material} />{requirement.material} ×{requirement.cost} · {requirement.coins.toLocaleString('zh-CN')} 鱼币</p>}
            {unlocked
              ? <button className="secondary-button" disabled={selected || busy} onClick={() => onSelect(depth.id)}>{selected ? '垂钓中' : '前往垂钓'}<ArrowRight size={15} /></button>
              : <button className="secondary-button" disabled={busy || !canUnlockDepth(state, depth.id)} onClick={() => onUnlock(depth.id)}><Unlock size={15} /> 解锁{depth.label}</button>}
          </div>
        </article>
      })}
    </div>
  </GameDialog>
}

function RewardReportModal({ title, rewards, onClose, extra }) {
  const merged = useMemo(() => {
    const map = new Map()
    ;(rewards || []).forEach((reward) => {
      if (!reward?.name) return
      const kind = reward.kind || reward.type || 'material'
      const key = `${kind}:${reward.name}`
      const entry = map.get(key) || { name: reward.name, kind, qty: 0 }
      entry.qty += Number(reward.qty) || 0
      map.set(key, entry)
    })
    return [...map.values()].sort((a, b) => b.qty - a.qty)
  }, [rewards])
  return <GameDialog title={title} className="reward-report-dialog" onClose={onClose}>
      {extra && <p className="report-extra">{extra}</p>}
      <div className="report-list">
        {merged.map((item) => <div className="report-row" key={`${item.kind}-${item.name}`}>
          <ItemIllustration item={item.name} fallback={<span className="material-dot" style={{ background: item.kind === 'coin' ? COIN.color : MATERIALS[item.name]?.color || 'var(--accent)' }} />} />
          <span>{item.name}</span>
          <b>×{item.qty}</b>
        </div>)}
        {!merged.length && <p className="admin-empty-line">无奖励</p>}
      </div>
      <button className="primary-button wide" onClick={onClose}>完成</button>
  </GameDialog>
}

function LotteryPage({ state, now, onAction, lottery, busy }) {
  const config = state.config
  const lotteryTypes = lottery?.types || config.lotteryTypes
  const [quantity, setQuantity] = useState(1)
  const [selectedTier, setSelectedTier] = useState(lotteryTypes[0].id)
  const tierId = lotteryTypes.some((type) => type.id === selectedTier) ? selectedTier : lotteryTypes[0].id
  const tier = lotteryTypeFor({ lotteryTypes }, tierId)
  const blankTickets = state.tickets.filter((ticket) => ticket.status === 'BLANK')
  const assigned = state.tickets.filter((ticket) => ticket.status === 'ASSIGNED')
  const claimable = state.tickets.filter((ticket) => ticket.status === 'DRAWN' && !ticket.claimed)
  // 我的彩票：命中多的在前，命中相同则后下注的在前。
  const numberedTickets = sortNumberedTickets(state.tickets.filter((ticket) => ticket.numbers.length > 0))
  const pagedTickets = usePaged(numberedTickets, 6)
  // 开奖面板显示当前选中奖池的往期号码，期数由后台配置。
  const history = lottery?.history?.[tierId] || []
  const issueLabel = lottery?.issue ? `第${lottery.issue}期` : '本期'
  // 合成一张该场彩票要消耗的空白票数（后台可配），玩家按「可合成张数」投入。
  const ticketCost = ticketCostFor({ lotteryTypes }, tierId)
  const craftable = Math.floor(blankTickets.length / ticketCost)
  const safeQuantity = Math.min(Math.max(Math.floor(Number(quantity) || 0), 0), craftable)
  const setSafeQuantity = (value) => setQuantity(Math.min(Math.max(Math.floor(Number(value) || 0), 0), craftable))
  const drawEnd = lottery?.endAt || nextDrawAt(new Date(now)).getTime()
  const entriesClosed = Boolean(lottery?.drawn) || drawEnd <= now
  const [report, setReport] = useState(null)
  const [printCycle, setPrintCycle] = useState(0)
  const [drawReplay, setDrawReplay] = useState(null)
  // 开奖面板两种视图：往期号码（默认）与奖池预览；不落库，每次进页面回到默认。
  const [drawView, setDrawView] = useState('history')
  const claim = async () => {
    if (!claimable.length || busy) return
    primeGameAudio()
    const data = await onAction('claimTickets')
    if (!data?.receipt) return
    setDrawReplay(null)
    setReport(data.receipt)
    if (data.receipt.rewards?.length) playGameCue('lottery-claim')
  }
  const assign = async () => {
    if (!safeQuantity || entriesClosed || busy) return
    primeGameAudio()
    const data = await onAction('craftTickets', { quantity: safeQuantity, tier: tierId }, '号码票已合成，可在下方查看。')
    if (!data) return
    setQuantity(1)
    setPrintCycle((cycle) => cycle + 1)
    playGameCue('ticket-print')
  }
  const replayDraw = () => {
    const draw = history[0]
    if (!draw?.numbers?.length) return
    primeGameAudio()
    setDrawReplay({ issue: draw.issue, numbers: draw.numbers, poolName: tier.name })
    playGameCue('lottery-draw')
  }
  return <>
    <PageHeader title="彩票中心" art="lottery" description="选择奖池，合成号码票。" action={<div className="draw-countdown"><TimerReset size={16} /><b>{entriesClosed ? '本期已截止' : `距开奖 ${formatCountdown(drawEnd - now)}`}</b></div>} />
    <div className="lottery-register">
      <dl>
        <div><dt>空白票</dt><dd>{blankTickets.length}</dd></div>
        <div><dt>待开奖</dt><dd>{assigned.length}</dd></div>
        <div className={cn(claimable.length > 0 && 'has-claim')}><dt>待兑奖</dt><dd>{claimable.length}</dd></div>
        <div><dt>已兑奖</dt><dd>{state.stats.claimedTickets || 0}</dd></div>
      </dl>
      <button className="secondary-button" disabled={busy || !claimable.length} onClick={claim}><Gift size={15} aria-hidden="true" /> 一键兑奖 {claimable.length || ''}</button>
    </div>
    <div className="lottery-layout lottery-desk">
      <section className="panel ticket-panel">
        <div className="feature-section-head">
          <h2><Ticket size={18} aria-hidden="true" /> 合成号码票</h2>
          <StatusPill tone="neutral">{issueLabel}</StatusPill>
        </div>
        <div className="pool-options" role="group" aria-label="选择奖池">
          {lotteryTypes.map((type) => <button key={type.id} type="button" className={cn('pool-card', tierId === type.id && 'pool-selected')} aria-pressed={tierId === type.id} onClick={() => setSelectedTier(type.id)}>
            <strong>{type.name}</strong>
            <span>{type.min}–{type.max} · {type.pick} 个号码</span>
            <span className="pool-cost">{type.ticketCost || 3} 张空白票</span>
          </button>)}
        </div>
        <div className="lottery-order">
          <div className="quantity-head">
            <label htmlFor="lottery-quantity">合成数量</label>
            <div className="quantity-rest">消耗 {safeQuantity * ticketCost} / {blankTickets.length} 张</div>
          </div>
          <div className="quantity-control">
            <input className="quantity-range" type="range" min="0" max={craftable} value={safeQuantity} disabled={!craftable || entriesClosed} aria-label="合成彩票数量滑动条" style={{ '--range-progress': craftable ? `${(safeQuantity / craftable) * 100}%` : '0%' }} onChange={(event) => setSafeQuantity(event.target.value)} />
            <input id="lottery-quantity" className="quantity-input" type="number" min="0" max={craftable} value={safeQuantity} disabled={!craftable || entriesClosed} aria-label="合成彩票数量" onChange={(event) => setSafeQuantity(event.target.value)} />
          </div>
          <div className="lottery-print-action">
            <button className="primary-button wide" disabled={busy || !safeQuantity || entriesClosed} onClick={assign}><Ticket size={16} aria-hidden="true" /> {entriesClosed ? '等待下一期' : `合成 ${safeQuantity} 张`}</button>
            {printCycle > 0 && <div key={printCycle} className="lottery-print-slip" aria-hidden="true">
              <ItemIllustration item="彩票" fallback={<Ticket size={22} />} />
              <span><Check size={13} /></span>
            </div>}
          </div>
          {!craftable && !entriesClosed && <p className="player-hint">在潮汐商会兑换鱼获可以获得空白票。</p>}
        </div>
      </section>
      <section className="panel draw-panel" data-guide-anchor="pool">
        <div className="feature-section-head"><h2>开奖记录</h2><span>{tier.name}</span></div>
        <div className="draw-tabs" role="tablist" aria-label="开奖面板视图">
          <button type="button" role="tab" aria-selected={drawView === 'history'} className={cn('draw-tab', drawView === 'history' && 'is-active')} onClick={() => setDrawView('history')}>往期号码</button>
          <button type="button" role="tab" aria-selected={drawView === 'pool'} className={cn('draw-tab', drawView === 'pool' && 'is-active')} onClick={() => setDrawView('pool')}>奖池预览</button>
        </div>
        {drawView === 'history'
          ? (history.length ? <div className="draw-board lottery-results">
            <div className="lottery-current-result">
              <span>第 {history[0].issue} 期</span>
              <div aria-label="最近开奖号码">{history[0].numbers.map((number) => <b key={number}>{number}</b>)}</div>
              <button type="button" className="secondary-button lottery-replay-button" aria-haspopup="dialog" onClick={replayDraw}><Play size={14} aria-hidden="true" /> 回看最近期开奖</button>
            </div>
            {history.length > 1 && <details className="lottery-archive">
              <summary>更早的开奖 <span>{history.length - 1} 期</span></summary>
              {history.slice(1).map((item) => <div className="draw-lane" key={item.batchId} title={new Date(item.startAt).toLocaleString('zh-CN')}><span>第 {item.issue} 期</span><div>{item.numbers.map((number) => <b key={number}>{number}</b>)}</div></div>)}
            </details>}
          </div> : <div className="draw-placeholder"><strong>暂无开奖记录</strong></div>)
          : <LotteryPoolPreview tier={tier} />}
      </section>
    </div>
    <div className="section-row lottery-book-heading"><div><h2>我的号码票</h2></div><span>{numberedTickets.length} 张</span></div>
    <div className="numbered-ticket-grid">
      {pagedTickets.slice.map((ticket) => {
        const currentIssue = ticket.batchId === lottery?.batchId
        return <NumberedTicketCard key={ticket.id} ticket={ticket} pools={currentIssue ? lotteryTypes : config.lotteryTypes} currentIssue={currentIssue} />
      })}
      {!numberedTickets.length && <div className="panel numbered-empty"><EmptyState icon={Ticket} title="暂无号码票" /></div>}
    </div>
    <Pager {...pagedTickets} />
    {drawReplay && <LotteryDrawReplay draw={drawReplay} onClose={() => setDrawReplay(null)} />}
    {report && <RewardReportModal title="彩票兑奖" extra={<span className="lottery-report-summary"><Check size={16} aria-hidden="true" /> 已结算 {report.count} 张彩票</span>} rewards={report.rewards} onClose={() => setReport(null)} />}
  </>
}

function LotteryDrawReplay({ draw, onClose }) {
  return <GameDialog title={`第 ${draw.issue} 期开奖回看`} className="lottery-replay-dialog" onClose={onClose}>
    <div className="lottery-replay-meta"><ItemIllustration item="彩票" fallback={<Ticket size={21} />} /><span>{draw.poolName}</span></div>
    <ul className="lottery-replay-numbers" aria-label="开奖号码">
      {draw.numbers.map((number, index) => <li key={number} style={{ '--lottery-reveal-delay': `${Math.min(index, 10) * 55}ms` }}>{number}</li>)}
    </ul>
    <button className="secondary-button wide" onClick={onClose}>完成</button>
  </GameDialog>
}

// 奖池预览：按命中个数列出这一场的奖励与精确概率（概率由 hitDistribution 的
// 组合数直接算，不写死），让玩家在投入前就知道每个场次值不值得押。
function LotteryPoolPreview({ tier }) {
  const rows = useMemo(() => hitDistribution(tier).map(({ hit, chance }) => ({
    hit,
    chance: chance * 100,
    rewards: rewardFor(tier.id, hit, { lotteryTypes: [tier] }) || [],
  })).reverse(), [tier])
  return <div className="pool-preview">

    <table className="pool-preview-table">
      <caption className="sr-only">{tier.name} 奖池：按命中个数兑奖</caption>
      <thead><tr><th scope="col">命中</th><th scope="col">概率</th><th scope="col">奖励</th></tr></thead>
      <tbody>
        {rows.map((row) => <tr key={row.hit} className={row.hit === tier.pick ? 'is-top' : undefined}>
          <td>{row.hit}</td>
          <td><code>{formatChance(row.chance)}</code></td>
          <td>{row.rewards.length ? row.rewards.map((reward, index) => <span key={`${reward.name}-${index}`} className="pool-preview-prize"><b>{reward.qty > 1 ? `${reward.name} ×${reward.qty}` : reward.name}</b>{reward.type === 'rod' && <i>竿</i>}</span>) : <span className="pool-preview-empty">—</span>}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}

const formatChance = (percent) => {
  if (!Number.isFinite(percent)) return '—'
  if (percent === 0) return '0%'
  if (percent >= 10) return `${percent.toFixed(1)}%`
  if (percent >= 0.01) return `${percent.toFixed(2)}%`
  return `${percent.toPrecision(3)}%`
}

function NumberedTicketCard({ ticket, pools, currentIssue }) {
  const poolIndex = pools.findIndex((item) => item.id === ticket.tier)
  const type = pools[poolIndex]
  const drawn = ticket.status === 'DRAWN'
  const batchLabel = ticket.batchId ? new Date(ticket.batchId).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '本期'
  const numberLabel = currentIssue && type ? `${type.min} — ${type.max}` : `${ticket.numbers.length} 个号码`
  const rewards = (ticket.rewards || []).map((reward) => `${reward.name}${reward.qty > 1 ? ` ×${reward.qty}` : ''}`).join('、')
  return <article className={cn('numbered-ticket-card', poolIndex > 0 && 'advanced')} style={{ '--card-color': type?.cardColor, '--ticket-accent': type?.accentColor }}>
    <div className="numbered-ticket-top">
      <div><ItemIllustration item="彩票" fallback={<Ticket size={20} />} /><strong>{type?.name || '号码票'}</strong></div>
      <StatusPill tone={drawn ? 'success' : 'live'}>{drawn ? '待兑奖' : '待开奖'}</StatusPill>
    </div>
    <div className="numbered-ticket-sub"><span>{batchLabel}</span><span>{numberLabel}</span></div>
    <div className="numbered-ticket-numbers">{ticket.numbers.map((number) => <span key={number} className={ticket.drawnNumbers?.includes(number) ? 'number-hit' : ''}>{number}</span>)}</div>
    {drawn
      ? <div className="numbered-ticket-result"><strong>{ticket.hits ?? 0}</strong><span>{rewards || '无奖励'}</span></div>
      : <div className="numbered-ticket-result pending"><span>待开奖</span></div>}
    <div className="numbered-ticket-foot"><span /></div>
  </article>
}

function FxQuotePrice({ value }) {
  const label = useRef(null)
  const previous = useRef(value)
  useEffect(() => {
    const last = previous.current
    previous.current = value
    if (!Number.isFinite(last) || !Number.isFinite(value) || last === value || document.hidden ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    // 初次加载或无变化的轮询不提示，只给新报价一次短暂的颜色提示。
    const tint = value > last ? 'var(--success-line)' : 'var(--danger-line)'
    const pulse = label.current?.animate?.([{ backgroundColor: tint }, { backgroundColor: 'transparent' }], {
      duration: 410, easing: 'ease-out',
    })
    return () => pulse?.cancel()
  }, [value])
  return <b ref={label} className="market-quote-price">{fmtPrice(value)}</b>
}

function FxQuoteList({ rows, state, selected, onSelect }) {
  return <div className="fx-table market-watchlist" aria-label="行情标的">
    {rows.map((row) => {
      const position = fxPosition(state, row.name)
      const open = selected === row.name
      return <button type="button" key={row.name} className={cn('market-symbol', open && 'is-active')} onClick={() => onSelect(row.name)} aria-pressed={open}>
        <span className="market-symbol-mark" style={{ color: row.color }} aria-hidden="true">{row.icon}</span>
        <span className="market-symbol-name"><strong>{row.label}</strong>{position > 0 && <small>{position} 份</small>}</span>
        <span className="market-symbol-price"><FxQuotePrice value={row.mid} /><small className={cn(row.change > 0 && 'is-up', row.change < 0 && 'is-down')}>{fmtPct(row.change)}</small></span>
      </button>
    })}
    {!rows.length && <p className="admin-empty-line">暂无标的</p>}
  </div>
}

function FxTradeReceipt({ fill }) {
  const { label, side, qty, price, fee, requested } = fill
  const selling = side === 'sell'
  const subtotal = qty * price
  return <div className="market-confirm market-receipt" data-tone={side}>
    <div className="market-confirm-heading">
      <span className="market-confirm-mark" aria-hidden="true"><Check size={15} /></span>
      <strong>{selling ? '卖出' : '买入'} {label}</strong>
      <span className={cn('market-fill-status', qty < requested && 'is-partial')}>{qty < requested ? '部分成交' : '已成交'}</span>
    </div>
    <dl className="market-receipt-values">
      <div><dt>成交数量</dt><dd>{qty < requested ? `${qty} / ${requested}` : qty} 份</dd></div>
      <div><dt>成交单价</dt><dd>{fmtPrice(price)} 鱼币</dd></div>
      <div><dt>手续费</dt><dd>{fmtPrice(fee)} 鱼币</dd></div>
      <div><dt>{selling ? '实际到账' : '实际支付'}</dt><dd>{fmtPrice(selling ? Math.max(0, subtotal - fee) : subtotal + fee)} 鱼币</dd></div>
    </dl>
  </div>
}

function FxPage({ state, onAction, fxSnapshot, busy }) {
  // 行情全部是服务端算好的：这里只做展示与下单，不再本地推导任何价格。
  // fxSnapshot 来自 /api/bootstrap 或 /api/sync（含报价、档位、可选蜡烛）。
  const config = fxConfig(state)
  const quotes = fxSnapshot?.quotes || []
  const grains = fxSnapshot?.grains || []
  const session = fxSnapshot?.session || { open: false, phase: 'closed', opensAt: 0, closesAt: 0, nextOpenAt: 0 }
  const [selected, setSelected] = useState('')
  const [qty, setQty] = useState(10)
  const [side, setSide] = useState('buy')
  const [filter, setFilter] = useState('all')
  const [fill, setFill] = useState(null)
  // 每个标的各记一个档位；档位被锁定时回退到默认档。
  const [grainChoice, setGrainChoice] = useState({})
  const [candleCache, setCandleCache] = useState({})
  const openGrains = grains.filter((item) => !item.locked).map((item) => item.id)
  const grainOf = (name) => {
    const picked = grainChoice[name]
    if (picked && openGrains.includes(picked)) return picked
    return fxSnapshot?.defaultGrain || openGrains[0] || ''
  }
  const selectSymbol = (name) => setSelected(name)
  const quote = quotes.find((item) => item.name === selected) || quotes[0]
  const held = quote ? fxPosition(state, quote.name) : 0
  const coins = Math.max(0, Number(state.coins) || 0)
  // 持仓市值 = 持仓份数 × 服务端给的卖价，客户端不参与定价。
  const portfolio = quotes.reduce((sum, item) => sum + fxPosition(state, item.name) * item.sell, 0)
  const netFlow = quotes.reduce((sum, item) => sum + item.todayNet, 0)
  const gainers = quotes.filter((item) => item.change > 0).length
  const trades = Array.isArray(state.fx?.trades) ? state.fx.trades : []
  const visible = quotes.filter((item) => filter === 'all' || (filter === 'held' ? fxPosition(state, item.name) > 0 : item.change !== 0))
  const safeQty = Math.max(0, Math.floor(Number(qty) || 0))
  const unitPrice = quote ? (side === 'buy' ? quote.buy : quote.sell) : 0
  const gross = safeQty * unitPrice
  const fee = Math.ceil(gross * config.feeRate)
  const affordable = side === 'buy'
    ? Math.max(0, Math.min(config.maxPosition - held, Math.floor(coins / (unitPrice * (1 + config.feeRate) || 1))))
    : held
  const overCap = side === 'buy' && held + safeQty > config.maxPosition
  const canTrade = session.open && Boolean(quote) && safeQty > 0 && !overCap && (side === 'buy' ? gross + fee <= coins : safeQty <= held)
  const clock = (at) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const submit = async () => {
    if (!canTrade || busy) return
    primeGameAudio()
    const verb = side === 'buy' ? '买入' : '卖出'
    const result = await onAction(side === 'buy' ? 'fxBuy' : 'fxSell', { name: quote.name, qty: safeQty }, ({ receipt }) => (
      receipt ? '' : `${verb} ${quote.label} 已成交`
    ))
    if (!result) return
    setQty(1)
    const receipt = result.receipt
    if (!receipt) return
    setFill((previous) => ({ ...receipt, label: quote.label, requested: safeQty, sequence: (previous?.sequence || 0) + 1 }))
    playGameCue(receipt.side === 'sell' ? 'fx-sell' : 'fx-buy')
  }
  const candleName = quote?.name
  const candleGrain = candleName ? grainOf(candleName) : ''
  const candleKey = `${candleName}:${candleGrain}`
  const candleRows = candleCache[candleKey] || fxSnapshot?.candles?.[candleName]?.[candleGrain]
  const candles = useMemo(() => candleRows ? decodeCandleRows(candleRows) : EMPTY_CANDLES, [candleRows])
  // 只定时更新当前标的与档位，离开页面后停止请求。
  useEffect(() => {
    if (!candleName || !candleGrain) return undefined
    let cancelled = false
    let timer = null
    const update = async () => {
      try {
        if (document.hidden) return
        const data = await api.fxCandles(candleName, candleGrain)
        if (!cancelled && !data.locked && !data.unknown && data.candles) {
          setCandleCache((current) => ({ ...current, [candleKey]: data.candles }))
        }
      } catch {
        /* 保留上次成功加载的数据，下次定时更新时再试。 */
      } finally {
        if (!cancelled) timer = window.setTimeout(update, 30000)
      }
    }
    void update()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [candleName, candleGrain, candleKey])

  const chooseGrain = (name, grainId) => {
    const grain = grains.find((item) => item.id === grainId)
    if (!grain || grain.locked) return
    setGrainChoice((current) => ({ ...current, [name]: grainId }))
  }
  return <>
    <PageHeader title="深海 FX" art="fx" description="以鱼币交易海域词条。" action={<div className="market-session">
      <StatusPill tone={session.open ? 'live' : 'idle'}>{session.open ? '交易中' : session.phase === 'pre-open' ? '待开盘' : '已收市'}</StatusPill>
      <span>{session.open ? `${clock(session.opensAt)}–${clock(session.closesAt)}` : (session.nextOpenAt ? `下次开盘 ${clock(session.nextOpenAt)}` : '等待行情')}</span>
    </div>} />
    <dl className="market-ledger">
      <div><dt>持仓市值</dt><dd>{fmtPrice(portfolio)}</dd></div>
      <div><dt>可用鱼币</dt><dd>{coins.toLocaleString('zh-CN')}</dd></div>
      <div><dt>今日净供给</dt><dd>{netFlow >= 0 ? `+${netFlow.toFixed(0)}` : netFlow.toFixed(0)}</dd></div>
      <div><dt>上涨标的</dt><dd>{gainers} / {quotes.length}</dd></div>
    </dl>
    <div className="market-terminal">
      <section className="panel market-watch">
        <div className="feature-section-head"><h2>行情</h2><span>{quotes.length} 个标的</span></div>
        <div className="filter-row fx-filter-row">
          {[['all', '全部'], ['held', '持仓'], ['moved', '有波动']].map(([id, label]) => <button type="button" key={id} className={cn('filter-button', filter === id && 'filter-active')} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
        <FxQuoteList rows={visible} state={state} selected={quote?.name} onSelect={selectSymbol} />
      </section>
      <section className="panel market-chart" aria-label="行情图">
        {quote ? <>
          <div className="market-chart-heading">
            <div><h2>{quote.label}</h2><p>基准 {fmtPrice(quote.base)} · 涨跌幅限制 ±{(config.dailyLimit * 100).toFixed(0)}%</p></div>
            <div className="market-chart-quote"><FxQuotePrice value={quote.mid} /><span className={cn('fx-badge', quote.change > 0 ? 'is-up' : quote.change < 0 ? 'is-down' : 'is-flat')}>{fmtPct(quote.change)}</span></div>
          </div>
          <div className="fx-grain-switch" role="tablist" aria-label={`${quote.label} 的 K 线档位`}>
            {grains.map((item) => item.locked
              ? <button type="button" key={item.id} className="fx-grain is-locked" title="在黑市解锁更详细的行情档位" disabled>{item.label} · 锁定</button>
              : <button type="button" key={item.id} role="tab" aria-selected={candleGrain === item.id} className={cn('fx-grain', candleGrain === item.id && 'is-active')} onClick={() => chooseGrain(quote.name, item.id)}>{item.label}</button>)}
          </div>
          <FxCandles key={candleKey} bars={candles} height={238} labelOf={fxGrainLabel(candleGrain)} defaultZoom={candleGrain === 'm15' ? 60 : 50} />
        </> : <EmptyState icon={TrendingUp} title="等待行情" />}
      </section>
      <aside className="panel fx-ticket market-order">
        <div className="feature-section-head"><h2>下单</h2>{quote && <span>{quote.label}</span>}</div>
        {quote && <>
          <div className="fx-price-grid">
            <div><span>卖出</span><b className="is-down">{fmtPrice(quote.sell)}</b></div>
            <div><span>中间</span><b>{fmtPrice(quote.mid)}</b></div>
            <div><span>买入</span><b className="is-up">{fmtPrice(quote.buy)}</b></div>
          </div>
          <div className="fx-ticket-meta">
            <span>基准 {quote.base}</span><span>点差 {quote.pointSpread}</span>
            <span>净额 {quote.todayNet >= 0 ? '−' : '+'}{Math.abs(quote.todayNet).toFixed(0)}</span>
            {quote.todayVolume > 0 && <span className="fx-pending">成交 {quote.todayVolume}</span>}
          </div>
          <div className="fx-side-switch" role="tablist" aria-label="交易方向">
            <button role="tab" aria-selected={side === 'buy'} className={cn('fx-side', side === 'buy' && 'is-active-buy')} onClick={() => setSide('buy')}>买入</button>
            <button role="tab" aria-selected={side === 'sell'} className={cn('fx-side', side === 'sell' && 'is-active-sell')} onClick={() => setSide('sell')}>卖出</button>
          </div>
          <div className="quantity-head fx-qty-head"><div><span className="field-label">数量</span><strong>{safeQty} <small>/ {affordable}</small></strong></div><div className="quantity-rest">持仓 <b>{held}</b> / {config.maxPosition}</div></div>
          <div className="quantity-control">
            <input className="quantity-range" type="range" min="0" max={Math.max(1, affordable)} value={Math.min(safeQty, Math.max(1, affordable))} aria-label="交易数量滑动条" disabled={!affordable} style={{ '--range-progress': affordable ? `${(Math.min(safeQty, affordable) / affordable) * 100}%` : '0%' }} onChange={(event) => setQty(event.target.value)} />
            <input className="quantity-input" type="number" min="0" max={Math.max(1, affordable)} value={safeQty} aria-label="交易数量" onChange={(event) => setQty(event.target.value)} />
          </div>
          <div className="fx-summary">
            <div><span>金额</span><b>{fmtPrice(gross)}</b></div>
            <div><span>费用</span><b>{fmtPrice(fee)}</b></div>
            <div><span>{side === 'buy' ? '预计需付' : '预计到账'}</span><b className={side === 'buy' ? 'is-down' : 'is-up'}>{fmtPrice(side === 'buy' ? gross + fee : Math.max(0, gross - fee))}</b></div>
          </div>
          {overCap && <p className="fx-warn">上限 {config.maxPosition}</p>}
          {!session.open && <p className="fx-warn">下次开盘 {clock(session.nextOpenAt)}</p>}
          <button className={cn('primary-button wide', side === 'sell' && 'fx-sell-button')} disabled={busy || !canTrade} onClick={submit}>{session.open ? (side === 'buy' ? `买入 ${safeQty || ''}` : `卖出 ${safeQty || ''}`) : '休市中'}</button>
        </>}
        {!quote && <p className="admin-empty-line">无标的</p>}
        <div role="status" aria-atomic="true">
          {fill && <FxTradeReceipt key={fill.sequence} fill={fill} />}
        </div>
      </aside>
    </div>
    <div className="section-row"><div><h2>成交</h2></div><span className="muted-copy">{trades.length}</span></div>
    <div className="panel fx-trades">
      {trades.map((trade) => <div className="fx-trade-row" key={trade.id}>
        <span className={cn('fx-trade-side', trade.side === 'buy' ? 'is-buy' : 'is-sell')}>{trade.side === 'buy' ? '买入' : '卖出'}</span>
        <strong>{TRAITS.find((trait) => trait.id === trade.name)?.label || trade.name}</strong>
        <span>{trade.qty}</span>
        <span>@ {fmtPrice(trade.price)}</span>
        <span className="fx-trade-fee">{trade.fee}</span>
        <span className="fx-trade-time">{new Date(trade.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>)}
      {!trades.length && <EmptyState icon={TrendingUp} title="暂无成交" />}
    </div>
  </>
}

const MACHINE_STATUS_TEXT = {
  off: '已关机', running: '运转中', overtime: '加班中',
  starving: '拖欠租金', broke: '余额不足', empty: '无事可做', off_duty: '停机时段',
}

// 交付鱼：由玩家自己挑，按重量累计，不替玩家做选择。
function MachineFishPicker({ state, machineId, limitKg, onClose, onAction }) {
  const fresh = (state.fish || []).filter((fish) => fish.status === 'fresh')
  const [picked, setPicked] = useState(() => new Set())
  const totalKg = fresh.reduce((sum, fish) => sum + (picked.has(fish.id) ? Math.max(0, Number(fish.weight) || 0) : 0), 0)
  const toggle = (id) => setPicked((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const submit = async () => {
    const ids = fresh.filter((fish) => picked.has(fish.id)).map((fish) => fish.id)
    if (!ids.length) return
    if (await onAction('machineDepositFish', { machineId, fishIds: ids }, '鱼获已交付')) onClose()
  }
  return <GameDialog title="交付鱼" className="machine-picker" onClose={onClose}>
      <div className="machine-pick-head">
        <strong>交付鱼</strong>
        <span>{picked.size} 条 · {totalKg.toFixed(1)} / {limitKg} kg</span>
      </div>
      <div className="machine-pick-list">
        {fresh.map((fish) => <button key={fish.id} className={cn('machine-pick-row', picked.has(fish.id) && 'is-picked')} onClick={() => toggle(fish.id)} aria-pressed={picked.has(fish.id)}>
          <span className="machine-pick-name">{fish.name}</span>
          <span className="machine-pick-meta">{fish.depth} · {fish.weight} kg</span>
          <span className="machine-pick-value">◉ {quoteForFish(state, fish).pricing.total}</span>
        </button>)}
        {!fresh.length && <EmptyState icon={Fish} title="暂无鱼类" />}
      </div>
      <div className="machine-pick-actions">
        <button className="secondary-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={!picked.size || totalKg > limitKg} onClick={submit}>交付 {picked.size}</button>
      </div>
  </GameDialog>
}

// 机器卡：一格一台。数值全部从 config 读，前端不写死任何平衡数字。
function MachineCard({ state, machineId, onAction, busy = false }) {
  const config = state.config
  const def = machineDefFor(config, machineId)
  const owned = state.machines?.owned?.[machineId]
  const [cardQty, setCardQty] = useState(0)
  const [scratchTypeId, setScratchTypeId] = useState('')
  const [fishOpen, setFishOpen] = useState(false)
  if (!def) return null
  if (!machineUnlocked(state, machineId, config)) {
    const requirement = def.unlock?.kind === 'scratched'
      ? `累计刮开 ${def.unlock.value} 张刮刮乐后可用`
      : def.unlock?.kind === 'depth'
        ? `解锁${DEPTHS.find((zone) => zone.id === config.machines.modulesUnlockDepth)?.label || '指定海域'}后可用`
        : '解锁无灯黑市后可用'
    return <div className="machine-tile is-locked">
      <div className="machine-tile-head"><ItemIllustration item={def.id} fallback={<SlidersHorizontal size={19} />} /><strong>{def.name}</strong><StatusPill tone="neutral">锁定</StatusPill></div>
      <div className="machine-tile-lock">{requirement}</div>
    </div>
  }
  const at = Date.now()
  const status = owned ? machineStatus(state, machineId, at, config) : 'off'
  const shift = machineShiftHours(owned || { machineId }, config)
  const feeUnit = def.fee.unit === 'blackCoins' ? '渔币' : '鱼币'
  const rentUnit = def.rent.unit === 'fishKg' ? 'kg' : (def.rent.unit === 'blackCoins' ? '渔币' : '鱼币')
  const rentKey = def.deposits.find((entry) => entry.from === 'fish') ? 'fishKg' : (def.deposits.find((entry) => entry.from === 'blackCoins') ? 'blackCoins' : 'coins')
  const rentHeld = Number(owned?.deposit?.[rentKey]) || 0
  const rentMax = owned ? machineDepositMax(owned, config, rentKey) : 0
  const feeKey = def.fee.unit === 'blackCoins' ? 'blackCoins' : 'coins'
  const feeHeld = Number(owned?.deposit?.[feeKey]) || 0
  const cards = owned?.deposit?.items?.queue?.length || 0
  const scratchGroups = config.scratchTypes.map((type) => ({
    ...type,
    available: (state.scratchCards || []).filter((card) => card.typeId === type.id && card.status === 'ready').length,
  })).filter((type) => type.available > 0)
  const currentScratchType = scratchGroups.find((type) => type.id === scratchTypeId) || scratchGroups[0]
  const basket = owned?.basket || { coins: 0, materials: {} }
  const basketMaterials = Object.entries(basket.materials || {}).filter(([, qty]) => qty > 0)
  const hasBasket = (basket.coins || 0) > 0 || basketMaterials.length > 0
  const st = owned ? machineModuleStats(owned, config) : { slots: 0, load: 0 }
  const mods = machineModules(config)
  const modsUnlocked = machineModulesUnlocked(state, config)
  const otOn = Boolean(owned?.overtime?.wantOn)
  const scratchDeposit = def.deposits.some((entry) => entry.from === 'scratch')
  const cardMax = Math.max(0, Math.min(currentScratchType?.available || 0, machineDepositMax(owned || {}, config, 'items') - cards))
  const cardTake = Math.max(0, Math.min(cardQty, cardMax))
  const fishLimitKg = def.deposits.find((entry) => entry.from === 'fish')
    ? Math.max(0, machineDepositMax(owned || {}, config, rentKey) - rentHeld)
    : 0

  const powerOn = () => onAction('machineStart', { machineId }, `${def.name} 已开机`)
  const powerOff = () => onAction('machineStop', { machineId }, `${def.name} 已关机`)
  const balance = feeKey === 'blackCoins' ? state.blackMarket?.coins : state.coins
  const depositAmount = Math.max(0, Math.floor(Math.min(100, Number(balance) || 0, machineDepositMax(owned || {}, config, feeKey) - feeHeld)))
  const depositCoins = () => {
    const action = feeKey === 'blackCoins' ? 'machineDepositBlackCoins' : 'machineDepositCoins'
    if (depositAmount) onAction(action, { machineId, amount: depositAmount }, `已交付 ${depositAmount} ${feeUnit}`)
  }
  const depositCards = async () => {
    const typeId = currentScratchType?.id
    if (!typeId || !cardTake) return
    if (await onAction('machineDepositCards', { machineId, typeId, qty: cardTake }, `已交付 ${cardTake} 张刮刮乐`)) setCardQty(0)
  }

  return <div className={cn('machine-tile', owned?.on && 'is-on')}>
    <div className="machine-tile-head">
      <ItemIllustration item={def.id} fallback={<SlidersHorizontal size={19} />} />
      <strong>{def.name}</strong>
      <StatusPill tone={status === 'running' || status === 'overtime' ? 'live' : status === 'starving' || status === 'broke' ? 'warning' : 'neutral'}>{MACHINE_STATUS_TEXT[status] || status}</StatusPill>
      <span className="machine-tile-shift">{shift.startHour}–{shift.endHour}</span>
    </div>

    {!owned && <div className="machine-tile-body">
      <button className="primary-button wide" disabled={busy} onClick={powerOn}>开机</button>
    </div>}

    {owned && <>
      <div className="machine-meters">
        {rentKey === feeKey
          // 租金与使用费同池（渔币机器）：只显示一行，避免重复。
          ? <div><span>池</span><b>{Math.floor(rentHeld)} / {rentMax} {rentUnit}</b></div>
          : <>
            <div><span>租金</span><b>{Math.floor(rentHeld)} / {rentMax} {rentUnit}</b></div>
            <div><span>使用费</span><b>{Math.floor(feeHeld)} {feeUnit}</b></div>
          </>}
        {scratchDeposit && <div><span>待刮</span><b>{cards} 张</b></div>}
        <div><span>今日</span><b>{owned.dayItems || 0}</b></div>
        {owned.overheat > 0 && <div><span>过热</span><b>{Math.round(owned.overheat * 10) / 10}</b></div>}
      </div>

      <div className="machine-basket">
        <span>待领取</span>
        <b>{Math.floor(basket.coins || 0)} 鱼币</b>
        {basketMaterials.map(([name, qty]) => <i key={name}>{name} ×{qty}</i>)}
        <button className="secondary-button tiny" disabled={busy || !hasBasket} onClick={() => onAction('machineClaim', { machineId }, '已领取产出')}>领取</button>
      </div>

      <div className="machine-actions">
        {def.deposits.some((entry) => entry.from === 'fish') && <button className="secondary-button tiny" disabled={busy || !owned.on || !fishLimitKg} onClick={() => setFishOpen(true)}>交付鱼</button>}
        {(def.deposits.some((entry) => entry.from === 'coins') || def.deposits.some((entry) => entry.from === 'blackCoins')) && <button className="secondary-button tiny" disabled={busy || !depositAmount} onClick={depositCoins}>{depositAmount ? `交付 ${depositAmount} ${feeUnit}` : `无法交付${feeUnit}`}</button>}
        {def.overtime && <button className={cn('secondary-button tiny', otOn && 'is-on')} aria-pressed={otOn} disabled={busy || !owned.on} onClick={() => onAction('machineSetOvertime', { machineId, on: !otOn }, otOn ? '已取消今晚加班' : '今晚加班已开启')}>今晚加班</button>}
        {owned.on
          ? <button className="secondary-button tiny" disabled={busy} onClick={powerOff}>关机</button>
          : <button className="primary-button tiny" disabled={busy} onClick={powerOn}>开机</button>}
      </div>

      {scratchDeposit && <div className="machine-qty">
        <div className="quantity-head"><div><span className="field-label">交付刮刮乐</span><strong>{cardTake} <small>/ {cardMax}</small></strong></div></div>
        {scratchGroups.length > 1 && <label className="admin-field"><span>卡片类型</span><select className="admin-input" value={currentScratchType?.id || ''} onChange={(event) => { setScratchTypeId(event.target.value); setCardQty(0) }}>
          {scratchGroups.map((type) => <option key={type.id} value={type.id}>{type.name}（{type.available} 张）</option>)}
        </select></label>}
        <div className="quantity-control">
          <input className="quantity-range" type="range" min="0" max={Math.max(0, cardMax)} value={cardTake} disabled={!cardMax} aria-label="交付刮刮乐数量"
            style={{ '--range-progress': cardMax ? `${(cardTake / cardMax) * 100}%` : '0%' }}
            onChange={(event) => setCardQty(Number(event.target.value))} />
          <input className="quantity-input" type="number" min="0" max={cardMax} value={cardTake} disabled={!cardMax} aria-label="交付刮刮乐数量输入" onChange={(event) => setCardQty(Number(event.target.value))} />
        </div>
        <button className="secondary-button tiny" disabled={busy || !cardTake} onClick={depositCards}>交付 {cardTake}</button>
      </div>}

      {def.id === 'watcher' && <WatcherOrders def={def} state={state} busy={busy} onAction={onAction} />}

      <div className="machine-modules">
        <span>模块 {st.slots}/{def.moduleSlots} · 负荷 {st.load}/{def.loadCapacity}</span>
        {Object.entries(owned.modules || {}).map(([id, level]) => <span className="machine-mod-chip" key={id}>
          {mods[id]?.name || id} Lv{level}
          <button className="machine-mod-remove" aria-label={`拆下 ${mods[id]?.name || id}`} title="拆下" onClick={() => onAction('machineRemoveModule', { machineId, moduleId: id }, `已拆下 ${mods[id]?.name || id}`)}>×</button>
        </span>)}
        {!modsUnlocked && <em>裂谷解锁</em>}
        {modsUnlocked && Object.entries(state.machines?.warehouse || {}).filter(([, n]) => n > 0).map(([id, n]) => <button key={id} className="secondary-button tiny" onClick={() => onAction('machineInstallModule', { machineId, moduleId: id }, `已装 ${mods[id]?.name || id}`)}>装 {mods[id]?.name || id} ×{n}</button>)}
      </div>

      {def.id === 'wash' && <div className="machine-keep">
        <span>保留量</span>
        {Object.keys(state.config.blackMarket?.materials || {}).map((name) => <label key={name}>{name}
          <input type="number" min="0" defaultValue={owned.keep?.[name] || 0} aria-label={`${name} 保留量`} onBlur={(event) => onAction('machineSetKeep', { machineId, name, qty: Math.max(0, Math.floor(Number(event.target.value) || 0)) }, '')} />
        </label>)}
      </div>}
    </>}

    {fishOpen && <MachineFishPicker state={state} machineId={machineId} limitKg={fishLimitKg} onClose={() => setFishOpen(false)} onAction={onAction} />}
  </div>
}

function WatcherOrders({ def, state, busy, onAction }) {
  const traits = state.config.traits || TRAITS
  const [symbol, setSymbol] = useState('')
  const [side, setSide] = useState('buy')
  const [limit, setLimit] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [confirmation, setConfirmation] = useState(null)
  const orders = state.machines?.orders || []
  const symbolId = traits.some((item) => item.id === symbol) ? symbol : traits[0]?.id
  const price = Number(limit)
  const qty = Number(quantity)
  const full = orders.length >= (def.orders?.max || 2)
  const canSubmit = Boolean(symbolId && Number.isFinite(price) && price > 0 && Number.isInteger(qty) && qty > 0 && !full && !busy)
  const confirm = (kind, orderSide, orderName) => {
    const label = traits.find((item) => item.id === orderName)?.label || orderName
    setConfirmation((previous) => ({ kind, side: orderSide, label, sequence: (previous?.sequence || 0) + 1 }))
    playGameCue(kind === 'place' ? 'fx-order' : 'fx-cancel')
  }
  const submit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return
    primeGameAudio()
    if (await onAction('machineOrderPlace', { name: symbolId, side, price, qty })) {
      setLimit('')
      confirm('place', side, symbolId)
    }
  }
  const cancel = async (order) => {
    if (busy) return
    primeGameAudio()
    if (await onAction('machineOrderCancel', { orderId: order.id })) confirm('cancel', order.side, order.name)
  }
  return <section className="watcher-orders" aria-label="盯盘机限价委托">
    <div className="watcher-head"><h3>限价委托</h3><span>{orders.length}/{def.orders?.max || 2} 单</span></div>
    <p>交易时段同步时检查。达到限价且鱼币、持仓和机器预付充足时整笔成交。未成交的委托可撤销，提交时无需冻结资产。</p>
    <form className="watcher-form" onSubmit={submit}>
      <label className="admin-field"><span>标的</span><select className="admin-input" value={symbolId || ''} onChange={(event) => setSymbol(event.target.value)}>{traits.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label className="admin-field"><span>方向</span><select className="admin-input" value={side} onChange={(event) => setSide(event.target.value)}><option value="buy">买入</option><option value="sell">卖出</option></select></label>
      <label className="admin-field"><span>限价（鱼币）</span><input className="admin-input" type="number" required min="0.01" step="0.01" inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} /></label>
      <label className="admin-field"><span>份数</span><input className="admin-input" type="number" required min="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
      <button className="secondary-button wide" disabled={!canSubmit}>{full ? '委托已满' : '提交委托'}</button>
    </form>
    <div role="status" aria-atomic="true">
      {confirmation && <div className="market-confirm market-order-confirm" data-tone={confirmation.kind === 'cancel' ? 'cancel' : confirmation.side} key={confirmation.sequence}>
        <div className="market-confirm-heading">
          <span className="market-confirm-mark" aria-hidden="true"><Check size={14} /></span>
          <strong>{confirmation.kind === 'place' ? '限价委托已提交' : '委托已撤销'}</strong>
        </div>
        <span>{confirmation.side === 'sell' ? '卖出' : '买入'} {confirmation.label}</span>
      </div>}
    </div>
    {orders.length > 0 && <ul className="watcher-list">
      {orders.map((order) => <li key={order.id}>
        <div><strong>{order.side === 'buy' ? '买入' : '卖出'} {traits.find((item) => item.id === order.name)?.label || order.name}</strong><span>{fmtPrice(order.price)} 鱼币 · {order.qty} 份</span>
          {order.expireAt > 0 && <small>{new Date(order.expireAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 到期</small>}
        </div>
        <button className="secondary-button tiny" disabled={busy} onClick={() => cancel(order)}>撤单</button>
      </li>)}
    </ul>}
  </section>
}

function Workshop({ state, onAction, busy }) {
  const list = state.config?.machines?.list || {}
  const ids = Object.keys(list).filter((id) => list[id].enabled !== false)
  return <>
    <PageHeader title="工作间" art="black-workshop" description="为机器准备材料和费用，再领取累计产出。" />
    <div className="machine-grid workshop-benches">
      {ids.map((id) => <MachineCard key={id} state={state} machineId={id} onAction={onAction} busy={busy} />)}
    </div>
  </>
}
function ScratchPage({ state, onAction, onGuideSeen, busy, onOpenWorkshop }) {
  const config = state.config
  const readyCards = state.scratchCards.filter((card) => card.status === 'ready')
  const revealedCards = state.scratchCards.filter((card) => card.status === 'revealed')
  const paged = usePaged(revealedCards)
  const [report, setReport] = useState(null)
  const [picking, setPicking] = useState(false)
  const [stage, setStage] = useState(null)
  const [autoFill, setAutoFill] = useState(false)
  const cardsById = useMemo(() => new Map(state.scratchCards.map((card) => [card.id, card])), [state.scratchCards])
  // 每张已刮开的卡按对子结算，待兑奖奖励是所有 payout 的合计。
  const pendingPayouts = revealedCards.flatMap((card) => (Array.isArray(card.payout) ? card.payout : []))
  const totalReward = pendingPayouts.reduce((sum, reward) => sum + (Number(reward.qty) || 0), 0)
  const pendingPairs = revealedCards.reduce((sum, card) => sum + (Number(card.pairs) || 0), 0)
  const threshold = scratchThreshold(state)
  const radius = scratchRadius(state)
  const luckCfg = config.scratchLuck || { perLevels: 10, maxLevel: 20 }
  const totalScratch = Math.max(0, Math.floor(Number(state.stats?.totalScratch) || 0))
  const luckPerLevels = Math.max(1, Math.round(Number(luckCfg.perLevels) || 10))
  const luckMaxLevel = Math.max(0, Math.round(Number(luckCfg.maxLevel) || 20))
  const luckLevel = Math.min(luckMaxLevel, Math.floor(totalScratch / luckPerLevels))
  const workshopAt = workshopLocation(state)
  // 刮开 10 张后告知「每 10 张升级」：只出现一次，走引导系统的已读标记。
  const guideConfig = normalizeGuideConfig(config.guide)
  const luckStep = guideConfig.steps.find((step) => step.id === 'scratchLuck')
  const luckGuideOpen = totalScratch >= 10 && guideConfig.enabled && luckStep?.card && !state.guide?.skipped && !state.guide?.seen?.scratchLuck

  const openStage = (typeId) => {
    const ids = state.scratchCards.filter((card) => card.status === 'ready' && card.typeId === typeId).map((card) => card.id)
    if (!ids.length) return
    setPicking(false)
    setStage({ typeId, ids, index: 0 })
  }
  const currentId = stage ? stage.ids[stage.index] : null
  const currentCard = cardsById.get(currentId)
  const nextIndex = stage ? stage.ids.findIndex((id, index) => index > stage.index && cardsById.get(id)?.status === 'ready') : -1
  // 当前卡确认刮开后再装入下一张。其他页面领走的卡直接略过。
  useEffect(() => {
    if (!stage || nextIndex < 0 || (currentCard && (!autoFill || currentCard.status !== 'revealed'))) return undefined
    const timer = window.setTimeout(() => {
      setStage((current) => current === stage ? { ...current, index: nextIndex } : current)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [stage, autoFill, currentCard, nextIndex])
  const revealCurrent = () => onAction('revealScratch', { cardId: currentId })
  const claimAllCards = async () => {
    if (!revealedCards.length || busy) return
    const data = await onAction('claimAllScratch')
    if (data?.receipt) setReport(data.receipt)
  }
  const claimOne = async (card) => {
    const data = await onAction('claimScratch', { cardId: card.id })
    if (data?.receipt) setReport(data.receipt)
  }

  return <>
    <PageHeader title="刮刮乐" art="scratch" description="刮开卡片后兑奖。" />
    {luckGuideOpen && <GuideCard
      title="刮层直觉"
      body={guideStepCopy(config?.guide, 'scratchLuck')}
      stepId="scratchLuck"
      minCloseMs={luckStep?.minCloseMs ?? guideConfig.minCloseMs}
      onSeen={() => onGuideSeen('scratchLuck')}
      icon={<Sparkles size={16} />}
    />}
    <div className="scratch-desk">
      <section className="panel scratch-desk-ready" data-guide-anchor="cards">
        <ItemIllustration item="刮刮乐" fallback={<Gift size={42} />} />
        <div><h2>待刮卡片</h2><strong>{readyCards.length.toLocaleString('zh-CN')} <small>张</small></strong></div>
        <button className="primary-button" disabled={!readyCards.length} onClick={() => setPicking(true)}>开始刮卡 <ArrowRight size={15} /></button>
      </section>
      <section className="panel scratch-desk-claim">
        <dl className="scratch-receipt-strip">
          <div><dt>待兑奖</dt><dd>{revealedCards.length.toLocaleString('zh-CN')}</dd></div>
          <div><dt>待领组合</dt><dd>{pendingPairs.toLocaleString('zh-CN')} 对</dd></div>
          <div><dt>待领奖励</dt><dd>{totalReward.toLocaleString('zh-CN')} 份</dd></div>
          <div><dt>已兑奖</dt><dd>{(state.stats.claimedScratch || 0).toLocaleString('zh-CN')}</dd></div>
          <div><dt>累计鱼币</dt><dd>{(state.stats.scratchCoins || 0).toLocaleString('zh-CN')}</dd></div>
        </dl>
        <button className="secondary-button" disabled={busy || !revealedCards.length} onClick={claimAllCards}>一键兑奖</button>
      </section>
    </div>
    <div className="scratch-luck-strip">
      <span>刮层直觉 Lv.{luckLevel}</span>
      <span>翻牌 {Math.round(threshold * 100)}%</span>
      <span>半径 {radius.toFixed(1)}px</span>
      <span>{luckLevel >= luckMaxLevel ? '已满级' : `再刮 ${luckPerLevels - (totalScratch % luckPerLevels)} 张升级`}</span>
    </div>
    <div className="feature-section-head scratch-results-head">
      <h2>已刮开的卡片</h2>
      <span>{revealedCards.length.toLocaleString('zh-CN')} 张</span>
    </div>
    <div className="scratch-grid">
      {paged.slice.map((card) => <ScratchCard key={card.id} card={card} type={scratchTypeFor(config, card.typeId)} busy={busy} onClaim={() => claimOne(card)} />)}
      {!revealedCards.length && <div className="panel numbered-empty"><EmptyState icon={Gift} title={readyCards.length ? '刮开的卡片会在这里兑奖' : '在潮汐商会兑换鱼获可以获得刮刮乐'} /></div>}
    </div>
    <Pager {...paged} />
    {state.config.machines?.list?.claw?.enabled !== false && <section className="dock-workshop">
      <div className="section-row"><h2>码头工作间</h2></div>
      {workshopAt === 'fish'
        ? <MachineCard state={state} machineId="claw" onAction={onAction} busy={busy} />
        : onOpenWorkshop && <button className="secondary-button" onClick={onOpenWorkshop}>前往黑市工作间 <ArrowRight size={16} /></button>}
    </section>}
    {picking && <ScratchPickerOverlay state={state} onClose={() => setPicking(false)} onPick={openStage} />}
    {stage && (() => {
      const type = scratchTypeFor(config, stage.typeId)
      const under = stage.ids.slice(Math.max(0, stage.index - 3), stage.index).map((id) => cardsById.get(id)).filter(Boolean)
      return <GameDialog title={type.name} className="scratch-stage-dialog" onClose={() => setStage(null)} closeLabel="关闭刮刮乐">
          {currentCard && <div className="scratch-stack">
            {under.map((card, layer) => <div className="scratch-stack-layer" key={card.id} style={{ '--layer': under.length - layer }} aria-hidden="true">
              <ScratchCard card={card} type={scratchTypeFor(config, card.typeId)} showClaim={false} />
            </div>)}
            <div className="scratch-stack-top"><ScratchCard key={currentCard.id} card={currentCard} type={type} threshold={threshold} radius={radius} onReveal={revealCurrent} busy={busy} showClaim={false} /></div>
          </div>}
          <div className="scratch-stage-actions">
            <label className="scratch-autofill"><input type="checkbox" checked={autoFill} onChange={(event) => setAutoFill(event.target.checked)} /><span>自动装入下一张</span></label>
            {currentCard?.status !== 'ready' && (nextIndex >= 0
              ? <button className="secondary-button" onClick={() => setStage({ ...stage, index: nextIndex })}>下一张</button>
              : <button className="secondary-button" onClick={() => setStage(null)}>返回兑奖</button>)}
          </div>
      </GameDialog>
    })()}
    {report && <RewardReportModal title="刮刮乐兑奖" extra={`已结算 ${report.count} 张刮刮乐`} rewards={report.rewards} onClose={() => setReport(null)} />}
  </>
}

function ScratchPickerOverlay({ state, onClose, onPick }) {
  const types = state.config.scratchTypes
  const counts = useMemo(() => {
    const result = new Map()
    state.scratchCards.forEach((card) => {
      if (card.status === 'ready') result.set(card.typeId, (result.get(card.typeId) || 0) + 1)
    })
    return result
  }, [state.scratchCards])
  return <GameDialog title="选择刮刮乐" className="scratch-picker-dialog" onClose={onClose} closeLabel="关闭刮刮乐选择">
    <div className="scratch-picker-list">
      {types.map((type) => {
        const count = counts.get(type.id) || 0
        return <button className="scratch-picker-option" key={type.id} disabled={!count} onClick={() => onPick(type.id)}>
          <ItemIllustration item={type.name} fallback={<Gift size={25} />} />
          <span><strong>{type.name}</strong><small>{count > 0 ? `待刮 ${count} 张` : '暂无卡片'}</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      })}
    </div>
  </GameDialog>
}

// 真刮刮乐：涂层用 canvas 覆盖，鼠标/手指擦除到一定比例才算刮开。
function ScratchCard({ card, onReveal, onClaim, type, threshold = 0.45, radius = 17, showClaim = true, busy = false }) {
  const canvasRef = useRef(null)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const drawing = useRef(false)
  const finished = useRef(false)
  const previousPoint = useRef(null)

  const revealed = card.status !== 'ready'

  useEffect(() => {
    if (revealed) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.fillStyle = type.coatColor || '#2f6f76'
    ctx.fillRect(0, 0, rect.width, rect.height)
    // 涂层上的斜向纹理，刮开后才有“刮过”的实感
    ctx.strokeStyle = 'rgba(255,255,255,.12)'
    ctx.lineWidth = 6
    for (let x = -rect.height; x < rect.width; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + rect.height, rect.height); ctx.stroke()
    }
    ctx.strokeStyle = '#000'
  }, [revealed, type.coatColor])

  const reveal = async () => {
    if (revealed || busy || finished.current || !onReveal) return
    finished.current = true
    setDone(true)
    if (!await onReveal()) {
      finished.current = false
      setDone(false)
    }
  }

  // 整张卡都能下手：坐标按涂层矩形换算后夹到边界，
  // 在标题 / 底部按住拖动也会从最近的边缘开始刮。
  const scratchAt = (event) => {
    const canvas = canvasRef.current
    if (!canvas || finished.current || busy || revealed) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left))
    const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    if (previousPoint.current) {
      ctx.lineWidth = radius * 2
      ctx.lineCap = 'round'
      ctx.moveTo(previousPoint.current.x, previousPoint.current.y)
      ctx.lineTo(x, y)
      ctx.stroke()
    } else {
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    previousPoint.current = { x, y }
    // 按 8px 网格统计已刮开比例，避免每帧读整张位图
    const step = 8
    let cleared = 0
    let total = 0
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      for (let py = 0; py < canvas.height; py += step) {
        for (let px = 0; px < canvas.width; px += step) {
          total += 1
          if (data[(py * canvas.width + px) * 4 + 3] < 40) cleared += 1
        }
      }
    } catch {
      return
    }
    const ratio = total ? cleared / total : 0
    setProgress(ratio)
    if (ratio >= threshold) void reveal()
  }

  // 指针捕获让手指/鼠标拖出卡片也继续刮，松手才算结束。
  const start = (event) => {
    if (revealed || busy || !onReveal || event.button !== 0 || event.target.closest('button')) return
    event.preventDefault()
    drawing.current = true
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 部分浏览器不支持 */ }
    scratchAt(event)
  }
  const move = (event) => { if (!drawing.current) return; event.preventDefault(); scratchAt(event) }
  const end = () => { drawing.current = false; previousPoint.current = null }

  const style = { '--card-color': type.cardColor, '--coat': type.coatColor }
  const face = Array.isArray(card.face) ? card.face : []
  // 未刮开的卡从服务端拿不到 face，必须优先用卡片自己的快照格数；
  // 卡种被后台删掉时 type 会回退到第一个卡种，用 type.slots 会画错格数。
  const slots = Math.max(SCRATCH_MIN_SLOTS, Math.round(Number(card.slots ?? type.slots) || SCRATCH_DEFAULT_SLOTS))
  const layout = scratchGridLayout(slots)
  // 高亮直接看卡面分组（凑够该奖项所需数量才亮），不从 payout 反推：
  // payout 里存的是合并后的总奖励，三连时会翻倍，按它对不上格子。
  const pairedFlags = scratchPairedSlots(face)
  const payoutLabel = (Array.isArray(card.payout) ? card.payout : []).map((reward) => `${reward.name} ×${reward.qty}`).join(' + ')
  const iconOf = (slot) => slot.kind === 'coin' ? COIN.icon : MATERIALS[slot.name]?.icon || '✳'
  const colorOf = (slot) => slot.kind === 'coin' ? COIN.color : MATERIALS[slot.name]?.color
  return <div
    className={cn('scratch-card', !revealed && onReveal && 'is-scratchable', done && 'scratch-flash', revealed && !card.payout?.length && 'is-blank')}
    style={style}
    onPointerDown={start}
    onPointerMove={move}
    onPointerUp={end}
    onPointerCancel={end}
    onLostPointerCapture={end}
    onDragStart={(event) => event.preventDefault()}
  >
    <div className="scratch-card-head"><span><ItemIllustration item="刮刮乐" fallback={<Gift size={16} />} />{type.name}</span><span>{revealed ? (card.pairs ? `${card.pairs} 组` : '—') : `${Math.round(progress * 100)}%`}</span></div>
    <div className="scratch-stage">
      <div className="scratch-face" style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` }} aria-hidden={revealed ? undefined : 'true'}>
        {Array.from({ length: slots }, (_, index) => {
          const slot = face[index]
          const paired = pairedFlags[index]
          return <div className={cn('scratch-slot', paired && 'is-paired')} key={index} title={slot ? `${slot.name} ×${slot.qty}${slot.need > 2 ? ` · ${slot.need}` : ''}` : undefined}>
            {slot ? <ItemIllustration item={slot.kind === 'coin' ? '鱼币' : slot.name} fallback={<i style={{ color: colorOf(slot) }}>{iconOf(slot)}</i>} /> : <span className="scratch-slot-empty">?</span>}
          </div>
        })}
      </div>
      {!revealed && <canvas ref={canvasRef} className="scratch-canvas" aria-label={`刮开 ${type.name}`} />}
      {!revealed && <div className="scratch-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, progress / threshold * 100)}%` }} /></div>}
    </div>
    <div className="scratch-card-foot">
      <span className={cn(revealed && card.payout?.length && 'has-reward')}>{revealed ? payoutLabel || '未中奖' : `刮开 ${Math.round(threshold * 100)}% 即可翻牌`}</span>
      {!revealed && onReveal && <button className="secondary-button tiny" disabled={busy || done} onClick={reveal}>{done ? '翻牌中…' : '直接翻牌'}</button>}
      {revealed && showClaim && <button className="scratch-claim" disabled={busy} onClick={onClaim} aria-label={card.payout?.length ? '兑奖这张刮刮乐' : '清掉这张空卡'}><Gift size={14} /></button>}
    </div>
  </div>
}


// ---- 无灯黑市 ----

function TraitTag({ trait, tone }) {
  if (!trait) return null
  return <span className={cn('black-trait', tone && `is-${tone}`)} style={{ '--trait-color': trait.color }}><i aria-hidden="true">{trait.icon}</i>{trait.label}</span>
}

function BlackBuyPage({ state, onAction, busy }) {
  const config = state.config
  const cfg = config.blackMarket
  const bm = state.blackMarket || {}
  const order = bm.order
  const quota = blackDailyQuota(state, config)
  const sold = Number(bm.soldToday) || 0
  const traitById = (id) => (config.traits || []).find((trait) => trait.id === id)
  const eligible = state.fish.filter((fish) => fish.status === 'fresh' && blackFishEligible(state, fish, config))
  const [selected, setSelected] = useState(() => new Set())
  const [armed, setArmed] = useState(false)
  const paged = usePaged(eligible)
  const orderKey = `${order?.demand || ''}:${(order?.banned || []).join(',')}`
  useEffect(() => { setSelected(new Set()) }, [orderKey, eligible.length])
  useEffect(() => {
    if (!armed) return undefined
    const timer = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(timer)
  }, [armed])
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const picked = eligible.filter((fish) => selected.has(fish.id))
  const pickedValue = picked.reduce((sum, fish) => sum + blackFishValue(state, fish, config), 0)
  const sell = async () => {
    if (!picked.length) return
    const data = await onAction('blackSellFish', { fishIds: picked.map((fish) => fish.id) }, (data) => {
      const sale = data.me?.blackMarket?.lastSale
      return sale ? `卖出 ${sale.accepted} 条 · +${sale.coins} 渔币` : '已出售'
    })
    if (data) setSelected(new Set())
  }
  const refresh = () => {
    if (!armed) { setArmed(true); return }
    setArmed(false)
    onAction('blackRefreshOrder', {}, '收购单已刷新')
  }
  const canRefresh = Number(bm.rerolls) < Number(cfg.order.refreshLimit) && Number(bm.coins) >= Number(cfg.order.refreshCost)

  return <>
    <PageHeader title="黑市收购" art="black-buy" description="优先交付今日合约需要的鱼获。" />
    <section className="panel black-order black-contract">
      <div className="feature-section-head"><h2>今日合约</h2><span>{sold} / {quota} 条已交付</span></div>
      <div className="black-order-line">
        <span className="black-order-label">需求</span>
        <TraitTag trait={traitById(order?.demand)} tone="demand" />
        {Boolean(order?.banned?.length) && <>
          <span className="black-order-label">拒收</span>
          {order.banned.map((id) => <TraitTag key={id} trait={traitById(id)} tone="ban" />)}
        </>}
        <span className="black-order-accept">预计接收 ≈{Math.round((Number(order?.acceptance) || 0) * 100)}%</span>
        <button className={cn('secondary-button', armed && 'is-confirm')} disabled={busy || !canRefresh} onClick={refresh}>
          {armed ? `确认刷新 ${cfg.order.refreshCost} ◉` : `刷新 ${cfg.order.refreshCost} ◉`}
        </button>
      </div>
      <dl className="black-desk-ledger">
        <div><dt>渔币余额</dt><dd>{(Number(bm.coins) || 0).toLocaleString('zh-CN')}</dd></div>
        <div><dt>符合条件</dt><dd>{eligible.length} 条</dd></div>
        <div><dt>已刷新</dt><dd>{Number(bm.rerolls) || 0} / {cfg.order.refreshLimit}</dd></div>
      </dl>
    </section>
    <div className="section-row">
      <div><h2>仓库里的鱼</h2></div>
      <div className="section-actions">
        <button className="secondary-button" disabled={!eligible.length} onClick={() => setSelected(new Set(paged.slice.map((fish) => fish.id)))}>全选本页</button>
        <button className="primary-button" disabled={busy || !picked.length} onClick={sell}>卖出 {picked.length ? `${picked.length} 条 · ${pickedValue} ◉` : ''}</button>
      </div>
    </div>
    <div className="black-fish-list">
      {paged.slice.map((fish) => <button key={fish.id} className={cn('black-fish-row', selected.has(fish.id) && 'is-picked')} onClick={() => toggle(fish.id)} aria-pressed={selected.has(fish.id)}>
        <span className="black-fish-check" aria-hidden="true">{selected.has(fish.id) && <Check size={13} />}</span>
        <span className="black-fish-main"><strong>{fish.name}</strong><small>{fish.depth} · {(fish.traits || []).map((id) => traitById(id)?.label).filter(Boolean).join(' / ')}</small></span>
        <span className="black-fish-value">◉ {blackFishValue(state, fish, config)}</span>
      </button>)}
      {!eligible.length && <div className="panel"><EmptyState icon={Fish} title="今天没有符合条件的鱼" /></div>}
    </div>
    <Pager {...paged} />
    <div className="section-row"><div><h2>材料回收</h2></div></div>
    <div className="black-material-list">
      {Object.entries(cfg.materials).map(([name, rate]) => {
        const held = Math.max(0, Math.floor(Number(state.inventory[name]) || 0))
        const groups = Math.floor(held / Math.max(1, rate.per))
        return <div className="black-material-row" key={name}>
          <span className="black-material-name"><i style={{ color: MATERIALS[name]?.color }} aria-hidden="true">{MATERIALS[name]?.icon || '✳'}</i>{name}</span>
          <span className="black-material-held">{held}</span>
          <span className="black-material-rate">{rate.per} → {rate.coins} ◉</span>
          <div className="black-material-actions">
            <button className="secondary-button" disabled={busy || groups < 1} onClick={() => onAction('blackSellMaterial', { name, units: 1 }, `回收 ${rate.per} 个${name}`)}>1 组</button>
            <button className="secondary-button" disabled={busy || groups < 10} onClick={() => onAction('blackSellMaterial', { name, units: 10 }, `回收 ${rate.per * 10} 个${name}`)}>10 组</button>
            <button className="secondary-button" disabled={busy || groups < 1} onClick={() => onAction('blackSellMaterial', { name, units: groups }, `回收 ${name} ×${groups * rate.per}`)}>全部</button>
          </div>
        </div>
      })}
      {!Object.keys(cfg.materials).length && <div className="panel"><EmptyState icon={Package} title="暂不回收材料" /></div>}
    </div>
  </>
}

function BlackSuperPage({ state, onAction, busy }) {
  const config = state.config
  const cfg = config.blackMarket.super
  const bm = state.blackMarket || {}
  const superCard = bm.super
  const ready = state.scratchCards.filter((card) => card.status === 'ready')
  const groups = useMemo(() => {
    const map = new Map()
    ready.forEach((card) => {
      const entry = map.get(card.typeId) || { id: card.typeId, type: scratchTypeFor(config, card.typeId), ids: [] }
      entry.ids.push(card.id)
      map.set(card.typeId, entry)
    })
    return [...map.values()].filter((group) => group.ids.length)
  }, [state.scratchCards, config])
  const [counts, setCounts] = useState({})
  const [flipped, setFlipped] = useState(() => new Set())
  useEffect(() => { setFlipped(new Set()) }, [superCard?.id])
  const countOf = (group) => Math.min(group.ids.length, Math.max(0, Number(counts[group.id]) || 0))
  const total = groups.reduce((sum, group) => sum + countOf(group), 0)
  const start = async () => {
    const ids = groups.flatMap((group) => group.ids.slice(0, countOf(group)))
    if (!ids.length) return
    if (await onAction('blackSuperStart', { cardIds: ids }, `投入 ${ids.length} 张刮刮乐`)) setCounts({})
  }
  // 滑动条选数量：单卡种上限是可用张数，多种卡一起投时总量不超过 maxInput。
  const setCount = (group, value) => setCounts((prev) => {
    const others = groups.reduce((sum, item) => item.id === group.id ? sum : sum + Math.min(item.ids.length, Math.max(0, Number(prev[item.id]) || 0)), 0)
    const cap = Math.min(group.ids.length, cfg.maxInput - others)
    return { ...prev, [group.id]: Math.max(0, Math.min(cap, Math.round(value))) }
  })
  const selectAll = () => setCounts(() => {
    let room = cfg.maxInput
    return Object.fromEntries(groups.map((group) => {
      const take = Math.min(group.ids.length, room)
      room -= take
      return [group.id, take]
    }))
  })
  const allFlipped = superCard ? flipped.size >= superCard.shape.slots : false
  const iconOf = (slot) => slot.kind === 'coin' ? COIN.icon : MATERIALS[slot.name]?.icon || '✳'
  const colorOf = (slot) => slot.kind === 'coin' ? COIN.color : MATERIALS[slot.name]?.color
  const last = bm.lastSuper

  return <>
    <PageHeader title="超级刮刮乐" art="black-super" description="用待刮卡片组合卡面，开刮前可核对消耗。" />
    {superCard ? <section className="panel black-super-desk black-super-active" aria-label="超级刮刮乐卡面">
      <dl className="black-desk-ledger">
        <div><dt>投入</dt><dd>{superCard.totalCount} 张</dd></div>
        <div><dt>格数</dt><dd>{superCard.shape.slots} 格</dd></div>
        <div><dt>匹配</dt><dd>{superCard.shape.need} 连</dd></div>
      </dl>
      <div className="black-super-grid" style={{ '--cols': Math.round(Math.sqrt(superCard.shape.slots)) || 3 }}>
        {(superCard.face || []).map((slot, index) => {
          const open = flipped.has(index)
          return <button
            key={index}
            className={cn('black-super-cell', open && 'is-open')}
            aria-label={open ? `${slot.name} 热度 ${slot.heat}` : `第 ${index + 1} 格`}
            onClick={() => { if (open) return; setFlipped((prev) => new Set(prev).add(index)) }}
          >
            {open
              ? <><ItemIllustration item={slot.kind === 'coin' ? '鱼币' : slot.name} fallback={<i style={{ color: colorOf(slot) }}>{iconOf(slot)}</i>} /><small>×{Number(slot.heat).toFixed(2)}</small></>
              : <span aria-hidden="true">?</span>}
          </button>
        })}
      </div>
      <div className="black-super-actions">
        <span className="black-super-progress">{flipped.size} / {superCard.shape.slots}</span>
        <button className="secondary-button" disabled={allFlipped} onClick={() => setFlipped(new Set(superCard.face.map((_, index) => index)))}>全部刮开</button>
        <button className="primary-button" disabled={busy || !allFlipped} onClick={() => onAction('blackSuperReveal', {}, (data) => {
          const result = data.me?.blackMarket?.lastSuper
          const paid = (result?.payouts || []).filter((item) => item.qty > 0)
          return paid.length ? `结算：${paid.map((item) => `${item.name}×${item.qty}`).join('、')}` : '结算完成'
        })}>结算</button>
      </div>
      <div className="black-base-list">
        {(superCard.base || []).map((item) => <span key={`${item.kind}:${item.name}`} className={cn('black-base-item', !item.qty && 'is-empty')}>
          <i style={{ color: item.kind === 'coin' ? COIN.color : MATERIALS[item.name]?.color }} aria-hidden="true">{item.kind === 'coin' ? COIN.icon : MATERIALS[item.name]?.icon || '✳'}</i>
          {item.name} <b>{item.qty}</b>
        </span>)}
      </div>
    </section> : <section className="panel black-super-desk black-super-entry" aria-label="选择投入的卡片">
      <div className="black-super-intro">
        <span>未刮开的刮刮乐</span>
        <b>{ready.length} 张</b>
        <span>每次 {cfg.minInput}–{cfg.maxInput} 张</span>
      </div>
      <div className="black-pick-list">
        {groups.map((group) => {
          const count = countOf(group)
          const max = Math.min(group.ids.length, cfg.maxInput)
          return <div className={cn('black-pick-row', count > 0 && 'is-picked')} key={group.id}>
            <span className="black-pick-icon" style={{ color: group.type.coatColor }} aria-hidden="true">◇</span>
            <div className="black-pick-copy"><strong>{group.type.name}</strong><small>可用 {group.ids.length}</small></div>
            <b className="black-pick-count">{count}</b>
            <input className="quantity-range black-pick-slider" type="range" min="0" max={max} value={count}
              aria-label={`${group.type.name} 投入数量`}
              style={{ '--range-progress': max ? `${(count / max) * 100}%` : '0%' }}
              onChange={(event) => setCount(group, Number(event.target.value))} />
          </div>
        })}
        {!groups.length && <div className="panel"><EmptyState icon={Gift} title="没有未刮开的刮刮乐" /></div>}
      </div>
      <div className="black-super-actions">
        <span className="black-super-progress">投入 {total} 张</span>
        <button className="secondary-button" disabled={!groups.length || busy} onClick={selectAll}>全选</button>
        <button className="primary-button" disabled={busy || total < cfg.minInput || total > cfg.maxInput} onClick={start}>开始</button>
      </div>
    </section>}
    {last && <section className="panel black-last-super">
      <div className="black-last-head"><strong>上次结算</strong><span>{last.totalCount} 张 · {last.bestCombo || 0} 连</span></div>
      <div className="black-last-rows">
        {(last.payouts || []).filter((item) => item.qty > 0).map((item, index) => <div className="black-last-row" key={`${item.kind}:${item.name}:${index}`}>
          <span><i style={{ color: item.kind === 'coin' ? COIN.color : MATERIALS[item.name]?.color }} aria-hidden="true">{item.kind === 'coin' ? COIN.icon : MATERIALS[item.name]?.icon || '✳'}</i>{item.name}</span>
          <b>×{item.qty}</b>
        </div>)}
        {!(last.payouts || []).some((item) => item.qty > 0) && <span className="black-last-empty">无产出</span>}
      </div>
    </section>}
  </>
}

function BlackShopPage({ state, onAction, busy }) {
  const cfg = state.config.blackMarket
  const bm = state.blackMarket || {}
  const coins = Number(bm.coins) || 0
  const purchases = bm.purchases || {}
  const daily = bm.dailyBuys || {}
  return <>
    <PageHeader title="黑市商店" art="black-shop" description="使用渔币兑换装备、补给和工作间模块。" />
    <dl className="panel black-desk-ledger black-shop-ledger">
      <div><dt>渔币余额</dt><dd>{coins.toLocaleString('zh-CN')}</dd></div>
      <div><dt>今日收购</dt><dd>{Number(bm.soldToday) || 0} / {blackDailyQuota(state, state.config)}</dd></div>
      <div><dt>配额加成</dt><dd>+{Number(bm.quotaBonus) || 0}</dd></div>
    </dl>
    <div className="black-shop-list market-shelves">
      {cfg.shop.map((item) => {
        const owned = Math.max(0, Math.floor(Number(purchases[item.id]) || 0))
        const used = Math.max(0, Math.floor(Number(daily[item.id]) || 0))
        // 模块的价格与等级上限以机器配置为准，商店条目只负责上架。
        const modDef = item.kind === 'module' ? state.config.machines?.modules?.[item.moduleId] : null
        const price = modDef
          ? Number(modDef.price) || 0
          : item.kind === 'quota' ? Number(item.price) + Number(item.priceGrowth) * owned : Number(item.price)
        let note = ''
        let disabled = busy || coins < price
        const refreshUsed = Number(bm.rerolls) || 0
        const heldModules = Math.max(0, Math.floor(Number(state.machines?.warehouse?.[item.moduleId]) || 0))
        const installedModules = Object.values(state.machines?.owned || {}).reduce((sum, machine) => sum + (Number(machine?.modules?.[item.moduleId]) || 0), 0)
        if (item.kind === 'module' && !modDef) { note = '不可用'; disabled = true }
        else if (item.kind === 'module' && heldModules + installedModules >= Number(modDef.maxLevel)) { note = `已满 ${installedModules + heldModules}/${modDef.maxLevel}`; disabled = true }
        else if (item.once && owned > 0) { note = '已拥有'; disabled = true }
        else if (!modDef && item.maxBuys > 0 && owned >= item.maxBuys) { note = '已满'; disabled = true }
        else if (item.kind === 'refresh') {
          note = `${refreshUsed}/${cfg.order.refreshLimit}`
          if (refreshUsed >= cfg.order.refreshLimit) disabled = true
        }
        else if (item.dailyLimit > 0 && used >= item.dailyLimit) { note = `今日 ${used}/${item.dailyLimit}`; disabled = true }
        else if (item.kind === 'module') note = `${installedModules + heldModules}/${modDef.maxLevel}`
        else if (item.maxBuys > 0) note = `${owned}/${item.maxBuys}`
        else if (item.dailyLimit > 0) note = `今日 ${used}/${item.dailyLimit}`
        if (item.kind === 'repair' && Number(state.rod.durability) >= Number(state.rod.maxDurability)) { note = '耐久已满'; disabled = true }
        return <div className={cn('black-shop-row', disabled && 'is-disabled')} key={item.id}>
          <div className="black-shop-icon" aria-hidden="true"><ItemIllustration item={item} fallback={item.kind === 'rod' ? <Anchor size={18} /> : item.kind === 'theme' ? <Moon size={18} /> : item.kind === 'scale' ? <Scale size={18} /> : item.kind === 'quota' ? <TrendingUp size={18} /> : item.kind === 'repair' ? <Hammer size={18} /> : item.kind === 'module' ? <SlidersHorizontal size={18} /> : item.kind === 'grain' ? <TrendingUp size={18} /> : <TimerReset size={18} />} /></div>
          <div className="black-shop-copy"><strong>{item.name}</strong>{note && <small>{note}</small>}</div>
          <span className="black-price">◉ {price.toLocaleString('zh-CN')}</span>
          <button className="secondary-button" disabled={disabled} onClick={() => onAction('blackBuy', { itemId: item.id }, `已购买 ${item.name}`)}>购买</button>
        </div>
      })}
      {!cfg.shop.length && <div className="panel"><EmptyState icon={Store} title="商店暂无商品" /></div>}
    </div>
  </>
}

// 仓库扩容：纯鱼币升级，入口就在商会右上角的「仓库 x / y」旁边。
// 不再占用天赋页——那个页面已经整体删除。
function WarehouseUpgrade({ state, onAction }) {
  const cost = warehouseUpgradeCost(state)
  const capacity = warehouseCapacity(state)
  const affordable = canUpgradeWarehouse(state)
  if (!cost) return <span className="warehouse-upgrade is-maxed">仓库已满级 · {capacity}</span>
  return <button
    className={cn('warehouse-upgrade', !affordable && 'is-locked')}
    disabled={!affordable}
    title={`仓库上限 ${capacity} → ${capacity + (state.config?.warehouse?.step ?? 100)}`}
    onClick={() => onAction('upgradeWarehouse', {}, `仓库扩容至 ${capacity + (state.config?.warehouse?.step ?? 100)}`)}
  >
    <TrendingUp size={13} />
    <span>扩容</span>
    <b><Coins size={11} />{cost.coins.toLocaleString('zh-CN')}</b>
  </button>
}

function NpcPage({ state, onAction }) {
  const freshFish = state.fish.filter((f) => f.status === 'fresh')
  const capacity = warehouseCapacity(state)
  const full = freshFish.length >= capacity
  const [filter, setFilter] = useState('全部')
  const options = ['全部', '深海', '深渊', '组合加成']
  const traits = state.config?.traits || TRAITS
  const filtered = freshFish.filter((fish) => fishMatchesExchangeFilter(state, fish, filter))
  const paged = usePaged(filtered)
  const exchangeAll = () => {
    if (!filtered.length) return
    // 只传筛选范围：整仓库的 fishId 会超过请求体上限，服务端按同一口径自己挑鱼。
    onAction('exchangeFishBatch', { filter }, (data) => `已兑换 ${Number(data?.me?.npc?.lastExchange?.count) || 0} 条鱼，奖励已入账`)
  }
  return <>
    <PageHeader title="潮汐商会" art="npc" description="把仓库鱼获兑换成票券与材料。" />
    <section className="panel merchant-workbench" aria-label="仓库和兑换">
      <div className="merchant-storage">
        <div><strong>鱼获仓库</strong><span>{freshFish.length.toLocaleString('zh-CN')} / {capacity.toLocaleString('zh-CN')}</span></div>
        <progress max={capacity} value={Math.min(freshFish.length, capacity)} aria-label="仓库占用" />
      </div>
      {full && <StatusPill tone="warning">仓库已满</StatusPill>}
      <WarehouseUpgrade state={state} onAction={onAction} />
    </section>
    <div className="filter-row merchant-filters">
      <div className="merchant-filter-options" aria-label="鱼获筛选" role="group">
        {options.map((item) => <button key={item} className={cn('filter-button', filter === item && 'filter-active')} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}
      </div>
      <span className="filter-count">{filtered.length.toLocaleString('zh-CN')} 条</span>
      <button className="primary-button" disabled={!filtered.length} onClick={exchangeAll}>全部兑换 <ArrowRight size={15} /></button>
    </div>
    <div className="fish-exchange-list merchant-cabinet">
      {paged.slice.map((fish) => <FishExchangeRow key={fish.id} fish={fish} traits={traits} quote={quoteForFish(state, fish)} onExchange={() => onAction('exchangeFish', { fishId: fish.id }, `${fish.name} 已兑换，奖励已入账`)} />)}
      {!filtered.length && <div className="panel merchant-empty"><EmptyState icon={Fish} title="暂无符合条件的鱼获" /></div>}
    </div>
    <Pager {...paged} />
  </>
}

function FishExchangeRow({ fish, quote, onExchange, traits }) {
  const { pricing, tier } = quote
  return <article className="panel fish-exchange-row">
    <FishPortrait fish={fish} />
    <div className="exchange-fish-main">
      <div className="exchange-name"><strong>{fish.name}</strong><StatusPill tone={fish.rarity === '传说' ? 'lottery' : 'neutral'}>{fish.rarity}</StatusPill><span className="exchange-meta">{fish.latin} · {fish.depth} · {fish.weight} kg</span></div>
      <div className="trait-tags">{fish.traits.map((id) => { const trait = traits.find((item) => item.id === id); return <span key={id} style={{ color: trait?.color }}>{trait?.icon} {trait?.label} <small>{pricing.traitLines.find((line) => line.id === id)?.price ?? 0}</small></span> })}</div>
      {pricing.comboLines.length > 0 && <div className="price-combos">{pricing.comboLines.map((combo) => <span key={combo.id} className={combo.boosted ? 'is-boosted' : ''}>✦ {combo.name} <b>+{combo.total}</b>{combo.boosted && <small>+{Math.round(combo.bonus * 10) / 10}</small>}</span>)}</div>}
    </div>
    <div className="exchange-bonus"><small>估值 {pricing.total}{tier ? ` · ${tier.max === null ? `${tier.min}+` : `${tier.min}–${tier.max}`}` : ''}</small><strong>{quoteLabel(quote)}</strong></div>
    <button className="secondary-button" onClick={onExchange}>兑换 <ChevronRight size={14} /></button>
  </article>
}


function GameSoundToggle({ enabled, onToggle, compact = false }) {
  const Icon = enabled ? Volume2 : VolumeX
  return <button type="button" className={compact ? 'icon-button top-sound' : 'secondary-button sound-toggle'} aria-label="游戏音效" aria-pressed={enabled} title={enabled ? '关闭游戏音效' : '开启游戏音效'} onClick={onToggle}>
    <Icon size={18} aria-hidden="true" />
    {!compact && <span>{enabled ? '已开启' : '已静音'}</span>}
  </button>
}

function SettingsPage({ state, user, onSetTheme, onUserChange, onProgressReset, soundEnabled, onToggleSound }) {
  const theme = normalizeSettings(state.settings).theme
  const displayNames = { dark: '深色', light: '浅色', void: '无灯' }
  const displayName = user.displayName || user.username
  return <>
    <PageHeader title="设置" />
    <div className="settings-grid">
      <div className="settings-column">
        <section className="panel settings-panel theme-panel">
          <div className="panel-topline"><h2>界面主题</h2></div>
          <div className="theme-options" role="radiogroup" aria-label="主题">
            {THEMES.filter((item) => item.id !== 'void' || blackOwnsTheme(state, 'void', state.config)).map((item) => {
              const Icon = item.id === 'dark' ? Moon : item.id === 'void' ? Skull : Sun
              const active = item.id === theme
              return <label key={item.id} className={cn('theme-card', `theme-card-${item.id}`, active && 'is-active')}>
                <input className="sr-only" type="radio" name="game-theme" value={item.id} checked={active} onChange={() => onSetTheme(item.id)} />
                <span className="theme-swatch" aria-hidden="true"><i /><i /><i /></span>
                <span className="theme-copy"><b><Icon size={16} aria-hidden="true" />{displayNames[item.id]}</b></span>
                {active && <Check className="theme-check" size={17} aria-hidden="true" />}
              </label>
            })}
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="panel-topline"><h2>声音</h2></div>
          <div className="settings-row">
            <div><strong>游戏音效</strong><small>此浏览器中的合票、开奖回看、兑奖和行情提示音。</small></div>
            <GameSoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
          </div>
        </section>
      </div>
      <div className="settings-column">
        <section className="panel settings-panel settings-save">
          <div className="panel-topline"><h2>存档</h2></div>
          <div className="settings-row">
            <div><strong>{displayName}</strong>{displayName !== user.username && <small>{user.username}</small>}</div>
            <span className="mono-value">{state.stats.totalCatches} 条鱼 · {state.tickets.length} 张票</span>
          </div>
          <ResetSection user={user} onReset={onProgressReset} />
        </section>
        <SecuritySection user={user} />
        <EmailSection user={user} onUserChange={onUserChange} />
      </div>
    </div>
  </>
}

// 重置进度：密码 + 邮箱验证码两步。密码只用来换验证码，不签发任何长期凭证。
function ResetSection({ user, onReset }) {
  const [stage, setStage] = useState('idle') // idle | code
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [masked, setMasked] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setStage('idle')
    setPassword('')
    setCode('')
    setFeedback(null)
  }

  const send = async (event) => {
    event.preventDefault()
    setBusy(true)
    setFeedback(null)
    try {
      const result = await api.sendResetCode(password)
      setPassword('')
      setMasked(result.email)
      setStage('code')
      setFeedback({ tone: 'ok', text: result.delivered ? '已发送' : '验证码已写入日志' })
    } catch (error) {
      setFeedback({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event) => {
    event.preventDefault()
    setBusy(true)
    setFeedback(null)
    try {
      const result = await api.confirmReset(code)
      close()
      onReset?.(result)
    } catch (error) {
      setFeedback({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  if (stage === 'code') {
    return <form className="auth-form settings-form settings-reset" onSubmit={confirm}>
      <div className="settings-row"><div><strong>重置进度</strong>{masked && <small>{masked}</small>}</div><button className="secondary-button" type="button" disabled={busy} onClick={close}>取消</button></div>
      <label className="admin-field"><span>邮箱验证码</span>
        <input className="admin-input auth-code-input" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
      </label>
      {feedback && <p className={feedback.tone === 'ok' ? 'auth-notice' : 'auth-error'} role="status">{feedback.text}</p>}
      <button className="primary-button" disabled={busy || code.trim().length < 6}>{busy ? '重置中…' : '确认重置'}</button>
    </form>
  }

  return <form className="auth-form settings-form settings-reset" onSubmit={send}>
    <div className="settings-row"><div><strong>重置进度</strong>{!user.emailVerified && <small>先验证邮箱</small>}</div></div>
    <label className="admin-field"><span>账号密码</span>
      <input className="admin-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" disabled={!user.emailVerified} />
    </label>
    {feedback && <p className={feedback.tone === 'ok' ? 'auth-notice' : 'auth-error'} role="status">{feedback.text}</p>}
    <button className="primary-button" disabled={busy || !user.emailVerified || !password}>{busy ? '发送中…' : '发送验证码'}</button>
  </form>
}

// 邮箱验证：可选功能。未验证时只显示输入框；发码后进入输码态。
function EmailSection({ user, onUserChange }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('idle') // idle | code
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)

  const send = async (event) => {
    event.preventDefault()
    setBusy(true)
    setFeedback(null)
    try {
      const result = await api.sendEmailCode(email)
      setStage('code')
      setCode('')
      setFeedback({ tone: 'ok', text: result.delivered ? `已发送至 ${result.email}` : '验证码已写入日志' })
    } catch (error) {
      setFeedback({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event) => {
    event.preventDefault()
    setBusy(true)
    setFeedback(null)
    try {
      const result = await api.verifyEmail(code)
      onUserChange?.(result.user)
      setStage('idle')
      setEmail('')
      setCode('')
      setFeedback({ tone: 'ok', text: '邮箱已验证，之后可用它登录' })
    } catch (error) {
      setFeedback({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  // 邮箱一旦验证就锁定：不提供解绑/换绑，避免同一邮箱在账号之间漂移。
  if (user.emailVerified) {
    return <section className="panel settings-panel">
      <div className="panel-topline"><div><h2>邮箱</h2></div>
        <StatusPill tone="success">已验证</StatusPill>
      </div>
      <div className="settings-row"><div><strong>{user.email}</strong></div></div>
    </section>
  }

  return <section className="panel settings-panel">
    <div className="panel-topline"><div><h2>邮箱</h2></div>
      <StatusPill tone="neutral">未验证</StatusPill>
    </div>
    {stage === 'idle'
      ? <form className="auth-form settings-form" onSubmit={send}>
        <label className="admin-field"><span>邮箱地址</span>
          <input className="admin-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" />
        </label>
        {feedback && <p className={feedback.tone === 'ok' ? 'auth-notice' : 'auth-error'} role="status">{feedback.text}</p>}
        <button className="primary-button" disabled={busy || !email}> {busy ? '发送中…' : '发送验证码'}</button>
      </form>
      : <form className="auth-form settings-form" onSubmit={confirm}>
        <label className="admin-field"><span>验证码</span>
          <input className="admin-input auth-code-input" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
        </label>
        {feedback && <p className={feedback.tone === 'ok' ? 'auth-notice' : 'auth-error'} role="status">{feedback.text}</p>}
        <div className="settings-confirm">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => { setStage('idle'); setFeedback(null) }}>返回</button>
          <button className="primary-button" disabled={busy || code.trim().length < 6}>{busy ? '验证中…' : '验证'}</button>
        </div>
      </form>}
  </section>
}

// 账号安全：改密码 + 2FA 状态。2FA 绑定入口在管理后台，这里只展示。
// 退出登录只在侧栏底部，设置页不再重复一个按钮。
function SecuritySection({ user }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (next !== confirm) { setFeedback({ tone: 'error', text: '两次输入的新密码不一致' }); return }
    setBusy(true)
    try {
      await api.changePassword({ currentPassword: current, newPassword: next })
      setCurrent(''); setNext(''); setConfirm('')
      setFeedback({ tone: 'ok', text: '密码已更新' })
    } catch (error) {
      setFeedback({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }
  return <section className="panel settings-panel">
    <div className="panel-topline"><div><h2>账号</h2></div>
      <StatusPill tone={user.totpEnabled ? 'success' : 'neutral'}>{user.totpEnabled ? '两步验证开' : '两步验证关'}</StatusPill>
    </div>
    <div className="settings-row"><div><strong>{user.username}</strong><small>{user.role === 'admin' ? '管理员' : '玩家'}</small></div></div>
    <form className="auth-form settings-form" onSubmit={submit}>
      <label className="admin-field"><span>当前密码</span><input className="admin-input" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" /></label>
      <label className="admin-field"><span>新密码</span><input className="admin-input" type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" /></label>
      <label className="admin-field"><span>确认新密码</span><input className="admin-input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" /></label>
      {feedback && <p className={feedback.tone === 'ok' ? 'auth-notice' : 'auth-error'} role="status">{feedback.text}</p>}
      <button className="primary-button" disabled={busy || !current || !next}>{busy ? '保存中…' : '修改密码'}</button>
    </form>
  </section>
}

function StatsPage({ state }) {
  const totalHits = state.stats.hits.reduce((a, b) => a + b, 0)
  const topDepth = [...DEPTHS].reverse().find((depth) => state.stats.fishByDepth[depth.label] > 0)
  const poolStats = state.stats.hitsByPool || {}
  const poolPeak = Math.max(...state.stats.hits, 1)
  return <>
    <PageHeader title="航海日志" art="stats" description="查看发现的鱼种、各海域鱼获和累计兑奖记录。" />
    <dl className="logbook-summary" aria-label="航行总览">
      <div><dt>累计钓获</dt><dd>{state.stats.totalCatches.toLocaleString('zh-CN')} <small>条</small></dd></div>
      <div><dt>最深鱼获海域</dt><dd>{topDepth?.label || '暂无'}</dd></div>
      <div><dt>已兑奖彩票</dt><dd>{(state.stats.claimedTickets || 0).toLocaleString('zh-CN')} <small>张</small></dd></div>
    </dl>
    <FishCodex state={state} />
    <div className="section-row"><h2>航行记录</h2></div>
    <div className="metric-grid four logbook-metrics">
      <Metric label="累计脱钩" value={state.stats.totalEscapes || 0} helper={`耐久 −${state.stats.totalDurabilityLoss}`} tone="warning" />
      <Metric label="刮刮乐对子" value={state.stats.scratchPairs || 0} helper={`/${state.stats.totalScratch || 0}`} tone="warning" />
      <Metric label="刮刮乐鱼币" value={state.stats.scratchCoins || 0} tone="lottery" />
      <Metric label="自动维修" value={state.stats.autoRepairs || 0} helper={`+${state.stats.autoRepairDurability || 0}`} tone="success" />
    </div>
    <div className="stats-grid">
      <section className="panel hit-chart">
        <div className="panel-topline"><div><h2>命中分布</h2></div><StatusPill tone="neutral">{totalHits} 张</StatusPill></div>
        <div className="bars">{state.stats.hits.map((count, index) => <div className="bar-col" key={index}><span>{count}</span><div className="bar-track"><i style={{ height: `${count ? Math.max(10, (count / poolPeak) * 100) : 3}%` }} /></div><small>{index} 命中</small></div>)}</div>
      </section>
      <section className="panel depth-chart">
        <div className="panel-topline"><div><h2>海域</h2></div></div>
        {Object.entries(state.stats.fishByDepth).map(([depth, count]) => {
          const d = DEPTHS.find((item) => item.label === depth)
          const ratio = state.stats.totalCatches ? count / state.stats.totalCatches * 100 : 0
          return <div className="depth-stat" key={depth}><span>{d?.icon} {depth}</span><div><i style={{ width: `${ratio}%`, background: d?.color }} /></div><b>{count}</b></div>
        })}
      </section>
    </div>
    <section className="panel pool-hit-chart">
      <div className="panel-topline"><div><h2>奖池</h2></div></div>
      <div className="pool-hit-grid">
        {(state.config.lotteryTypes || []).map((type) => {
          const counts = poolStats[type.id] || []
          const total = counts.reduce((a, b) => a + b, 0)
          const peak = Math.max(...counts, 1)
          return <article className="pool-hit-card" key={type.id} style={{ '--pool-color': type.accentColor }}>
            <header><strong>{type.name}</strong><span>{total} 张</span></header>
            <div className="pool-hit-bars">{Array.from({ length: type.pick + 1 }, (_, hit) => {
              const count = counts[hit] || 0
              return <div className="pool-bar-col" key={hit}><span>{count}</span><div className="pool-bar-track"><i style={{ height: `${count ? Math.max(8, (count / peak) * 100) : 2}%` }} /></div><small>{hit}</small></div>
            })}</div>
            <footer>{type.min} — {type.max} · 抽 {type.pick}</footer>
          </article>
        })}
      </div>
    </section>
  </>
}

// 钓竿工作台从垂钓页打开，集中显示当前竿、维修条件与强化成本。
function DurabilityDrawer({ state, onClose, onAction, busy }) {
  const rod = state.rod
  const def = rodConfigFor(state.config, rod)
  const repair = def.repair || { material: '深蓝晶片', amount: 50, cost: 1 }
  const upgrades = def.upgrades || []
  const levels = rod.levels || {}
  const tension = rod.tension || {}
  // 点竿名/图标展开全部可选钓竿，再点一次选择切换。
  const [rodPickerOpen, setRodPickerOpen] = useState(false)
  const overflow = Math.max(0, Math.round(rod.durability) - Math.max(1, Number(rod.maxDurability) || 1))
  const stats = [
    { label: '耐久', value: `${Math.round(rod.durability)} / ${rod.maxDurability}${overflow > 0 ? ` (+${overflow})` : ''}` },
    { label: '抗损耗', value: `${Math.round((rod.resistance || 0) * 100)}%` },
    { label: '钓鱼速度', value: `${rod.energyPerSecond} 能量/秒` },
    { label: '最大张力', value: Math.round(tension.maxTension || 0) },
    { label: '张力速率', value: `${Math.round(tension.maxRate || 0)}/秒` },
    { label: '基础损耗', value: `${Math.round(tension.baseLoss || 0)} 点` },
  ]
  // 溢出维修初始自带：只要耐久没满就能修，修多少不设上限。
  const emergencyRepair = canEmergencyRepairRod(state, rod)
  const canRepair = canRepairRod(state, rod) || emergencyRepair
  const canUpgrade = rod.durability > MIN_DURABILITY && rod.status !== 'broken'
  return <GameDialog title="钓竿与强化" className="equipment-workbench" onClose={onClose}>
    <div className="equipment-grid">
      <section className="equipment-pane" aria-label="当前钓竿">
        <button
          className={cn('drawer-hero', 'drawer-hero-button', rodPickerOpen && 'is-open')}
          onClick={() => setRodPickerOpen((open) => !open)}
          aria-expanded={rodPickerOpen}
          aria-label={rodPickerOpen ? '收起钓竿列表' : '展开全部钓竿'}
          title={rodPickerOpen ? '收起' : '点击切换钓竿'}
        >
          <div className="rod-emblem" style={{ color: rod.color }}><ItemIllustration item={rod} fallback={<Anchor size={22} />} /></div>
          <div className="equipment-rod-caption"><span>当前钓竿</span><strong>{rod.name}</strong><span>{rod.rarity} · 最远 {DEPTHS[rod.maxDepth]?.label}</span></div>
          <ChevronDown className={cn('drawer-hero-caret', rodPickerOpen && 'is-open')} size={16} aria-hidden="true" />
        </button>
        {rodPickerOpen && <div className="rod-picker-list" role="listbox" aria-label="选择钓竿">
          {state.rods.map((item) => {
            const active = item.id === rod.id
            const broken = item.status === 'broken' || Number(item.durability) <= 0
            return <button
              key={item.id}
              role="option"
              aria-selected={active}
              className={cn('rod-picker-item', active && 'is-active')}
              disabled={busy || (broken && !active)}
              onClick={async () => { if (active || await onAction('selectRod', { rodId: item.id }, `已切换至 ${item.name}`)) setRodPickerOpen(false) }}
            >
              <ItemIllustration item={item} fallback={<Anchor size={19} />} />
              <div className="rod-picker-copy">
                <strong>{item.name}</strong>
                <span>{item.rarity}{broken ? ' · 已损坏' : ''}</span>
                <div className="mini-bar"><i style={{ width: `${Math.min(100, (item.durability / Math.max(1, item.maxDurability)) * 100)}%`, background: item.color }} /></div>
              </div>
              <span className="rod-picker-durability"><b>{Math.round(item.durability)}</b><small>/ {item.maxDurability}</small></span>
              {active && <StatusPill tone="live">使用中</StatusPill>}
            </button>
          })}
        </div>}

        <div className="rod-stat-grid">{stats.map((item) => <div key={item.label}><span>{item.label}</span><b>{item.value}</b></div>)}</div>
        <div className="equipment-repair">
          <div className="upgrade-head"><div><strong>耐久修复</strong></div><span className="cost"><span className="material-dot" style={{ background: MATERIALS[repair.material]?.color }} /> {repair.material} ×{repair.cost}</span></div>
          {emergencyRepair && <p className="player-hint">免费补缀入门竿，回到河口重整。</p>}
          <button className="secondary-button wide" disabled={busy || !canRepair} onClick={() => onAction('repairRod', { rodId: rod.id }, emergencyRepair ? '港口应急维修完成' : '钓竿已修复')}>{emergencyRepair ? '港口应急维修' : rod.durability >= rod.maxDurability ? '耐久已满' : `修复 +${repair.amount}`}</button>
        </div>
      </section>
      <section className="equipment-pane equipment-upgrades">
        <h3>强化</h3>
        {upgrades.map((upgrade) => {
          const level = Math.max(0, Math.floor(Number(levels[upgrade.id]) || 0))
          const maxLevel = Math.max(0, Number(upgrade.maxLevel) || 99)
          const price = upgradeCostAt(upgrade, level)
          const affordable = (state.coins || 0) >= price.coins && (state.inventory[upgrade.material] || 0) >= price.cost && (!upgrade.secondMaterial || (state.inventory[upgrade.secondMaterial] || 0) >= price.secondCost)
          const statValue = Number(upgrade.amount) < 1 ? `${Math.round(Number(upgrade.amount) * 100)}%` : Number(upgrade.amount)
          // 自动维修这一项讲的是阈值，不是 +N 的数值，单独给一行说明。
          const isAutoRepair = upgrade.kind === 'autoRepair'
          const threshold = isAutoRepair ? autoRepairThreshold(state, rod) : 0
          return <div className="upgrade-block" key={upgrade.id}>
            <div className="upgrade-head"><div><strong>{upgrade.label}</strong></div><span className="cost">Lv.{level} / {maxLevel}</span></div>
            <span className="cost cost-price"><Coins size={11} /> {price.coins.toLocaleString('zh-CN')} · {isAutoRepair ? `阈值 ${level > 0 ? Math.round(threshold) : '未开启'}` : `每次 +${statValue}`} · {upgrade.material} ×{price.cost}{upgrade.secondMaterial ? ` · ${upgrade.secondMaterial} ×${price.secondCost}` : ''}</span>
            <button className="secondary-button wide" disabled={busy || !canUpgrade || !affordable || level >= maxLevel} onClick={() => onAction('upgradeRod', { rodId: rod.id, upgradeId: upgrade.id }, `${upgrade.label} 已提升`)}>{level >= maxLevel ? '已满级' : '升级'}</button>
          </div>
        })}

        {!upgrades.length && <p className="player-hint">这把钓竿没有可强化的项目。</p>}
      </section>
    </div>
    <section className="drawer-materials equipment-inventory">
      <h3>材料</h3>
      <div className="drawer-material-list">
        {Object.entries(MATERIALS).map(([name, meta]) => <div className="drawer-material-item" key={name} title={name}>
          <ItemIllustration item={name} fallback={<span style={{ color: meta.color }}>{meta.icon}</span>} />
          <span className="drawer-material-name">{name}</span>
          <b className="drawer-material-qty">{state.inventory[name] || 0}</b>
        </div>)}
      </div>
    </section>
  </GameDialog>
}

createRoot(document.getElementById('root')).render(<AuthGate />)
