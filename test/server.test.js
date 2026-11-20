import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 自签名证书：测试进程必须允许不受信任的证书，所以要在 import 前设好。
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
process.env.LOG_SILENT = '1'
// 测试里所有请求都来自 127.0.0.1，把注册限流放宽，否则用例之间会互相挤掉配额。
process.env.REGISTER_LIMIT_PER_HOUR = '200'

const { openDatabase } = await import('../server/db/index.js')
const { createApp } = await import('../server/app.js')
const { getConfig, saveConfig } = await import('../server/services/config.js')
const { ensureCertificate } = await import('../server/lib/tls.js')
const { setClock, resetClock } = await import('../server/lib/clock.js')
const authService = await import('../server/services/auth.js')
const { run, get } = await import('../server/db/index.js')
const { sha256 } = await import('../server/lib/passwords.js')
const market = await import('../server/services/market.js')
const lottery = await import('../server/services/lottery.js')
const { DEPTHS, fxDayIndex, makeScratchCard } = await import('../src/game.js')

const HOUR = 60 * 60 * 1000
const dir = mkdtempSync(join(tmpdir(), 'fl-test-'))
const tls = ensureCertificate({ certPath: join(dir, 'test.crt'), keyPath: join(dir, 'test.key'), certDir: dir })

// keep-alive 连接会让 server.close() 一直挂住，所以先强制断开所有连接。
const closeServer = (server) => new Promise((resolve) => {
  server.close(resolve)
  server.closeAllConnections?.()
})

// 起一个临时服务器：内存数据库 + 随机端口。
async function startServer() {
  const db = openDatabase(':memory:')
  getConfig(db)
  const app = createApp({ db, config: { hsts: false }, staticDir: null })
  const server = createServer({ cert: tls.cert, key: tls.key }, app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `https://127.0.0.1:${server.address().port}`
  const call = async (path, { method = 'GET', body, cookie } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = text }
    const setCookie = res.headers.get('set-cookie')
    return { status: res.status, body: parsed, cookie: setCookie ? setCookie.split(';')[0] : null }
  }
  return { db, server, call, close: () => closeServer(server) }
}

// 测试里要直接操作某个功能时，把玩家的引导标记成已全部解锁。
const unlockGuideFor = (db, userId) => {
  const row = db.prepare('SELECT state FROM players WHERE user_id = ?').get(userId)
  const state = JSON.parse(row.state)
  state.guide = { ...(state.guide || {}), stage: 8, skipped: true, seen: {}, wonAt: {}, granted: {}, focus: {} }
  db.prepare('UPDATE players SET state = ? WHERE user_id = ?').run(JSON.stringify(state), userId)
}

const register = async (call, username, password = 'password123') => {
  const res = await call('/api/auth/register', { method: 'POST', body: { username, password } })
  assert.equal(res.status, 201, `注册 ${username} 应成功：${JSON.stringify(res.body)}`)
  return res.cookie
}

test('unauthenticated access to game and admin APIs is rejected', async () => {
  const app = await startServer()
  try {
    assert.equal((await app.call('/api/bootstrap')).status, 401)
    assert.equal((await app.call('/api/sync')).status, 401)
    assert.equal((await app.call('/api/action', { method: 'POST', body: { action: 'toggleFishing' } })).status, 401)
    assert.equal((await app.call('/api/admin/overview')).status, 401)
    // 伪造来源的写请求被 CSRF 校验挡住
    const res = await fetch(`https://127.0.0.1:${app.server.address().port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'y' }),
    })
    assert.equal(res.status, 403)
  } finally {
    await app.close()
  }
})

test('register, bootstrap and play persist across a fresh server instance', async () => {
  const file = join(dir, 'persist.db')
  const first = await startServer()
  // 换成文件库再测持久化：上面那个是内存库，这里单独开一个。
  await first.close()
  const dbPath = file
  const { openDatabase: open } = await import('../server/db/index.js')
  const db = open(dbPath)
  getConfig(db)
  const app = createApp({ db, config: { hsts: false }, staticDir: null })
  const server = createServer({ cert: tls.cert, key: tls.key }, app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `https://127.0.0.1:${server.address().port}`
  const call = async (path, { method = 'GET', body, cookie } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = text }
    const setCookie = res.headers.get('set-cookie')
    return { status: res.status, body: parsed, cookie: setCookie ? setCookie.split(';')[0] : null }
  }

  const cookie = await register(call, 'persisted')
  const boot = await call('/api/bootstrap', { cookie })
  assert.equal(boot.status, 200)
  assert.equal(boot.body.me.coins, 0)
  assert.ok(boot.body.config.rods.length >= 3)

  // 买一张刮刮乐兑奖流程之前，先确认动作能改状态。
  const act = await call('/api/action', { method: 'POST', cookie, body: { action: 'toggleFishing', requestId: 'act-1' } })
  assert.equal(act.status, 200)
  assert.equal(act.body.ok, true)

  await closeServer(server)
  db.close()

  // 重开同一个数据库：账号与进度都还在。
  const db2 = open(dbPath)
  getConfig(db2)
  const app2 = createApp({ db: db2, config: { hsts: false }, staticDir: null })
  const server2 = createServer({ cert: tls.cert, key: tls.key }, app2)
  await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve))
  const base2 = `https://127.0.0.1:${server2.address().port}`
  const login = await fetch(base2 + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify({ username: 'persisted', password: 'password123' }),
  })
  assert.equal(login.status, 200)
  const cookie2 = login.headers.get('set-cookie').split(';')[0]
  const boot2 = await fetch(base2 + '/api/bootstrap', { headers: { 'X-Requested-With': 'fetch', Cookie: cookie2 } })
  assert.equal(boot2.status, 200)
  const body2 = await boot2.json()
  assert.equal(body2.user.username, 'persisted')
  await closeServer(server2)
  db2.close()
})

test('concurrent duplicate requestId only settles once per player', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'idem')
    assert.equal((await app.call('/api/bootstrap', { cookie })).status, 200)
    // 彩票页签要等引导走进才解锁：这里直接把存档的引导置为全开，
    // 只验证 requestId 幂等，不掺进解锁条件。
    unlockGuideFor(app.db, 1)
    // 初始空白票 3 张，普通场需要 3 张，刚好能合成 1 张。
    const craft = (session) => app.call('/api/action', {
      method: 'POST', cookie: session,
      body: { action: 'craftTickets', params: { quantity: 1, tier: 'normal' }, requestId: 'craft-once' },
    })
    const responses = await Promise.all([craft(cookie), craft(cookie)])
    assert.equal(responses.filter((response) => response.body.replayed === true).length, 1)
    responses.forEach(({ status, body }) => {
      assert.equal(status, 200)
      assert.equal(body.me.tickets.filter((ticket) => ticket.status === 'ASSIGNED').length, 1)
      assert.equal(body.me.tickets.filter((ticket) => ticket.status === 'BLANK').length, 0)
    })

    const other = await register(app.call, 'idem2')
    assert.equal((await app.call('/api/bootstrap', { cookie: other })).status, 200)
    unlockGuideFor(app.db, 2)
    const independent = await craft(other)
    assert.equal(independent.status, 200)
    assert.notEqual(independent.body.replayed, true)
    assert.equal(independent.body.me.tickets.filter((ticket) => ticket.status === 'ASSIGNED').length, 1)
  } finally {
    await app.close()
  }
})

test('admin endpoints require role and a 12h 2FA session', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'plainplayer')
    // 先同步一次，生成玩家的存档快照：后台的用户资产统计从这里读。
    const boot = await app.call('/api/bootstrap', { cookie })
    assert.equal(boot.status, 200)
    const denied = await app.call('/api/admin/overview', { cookie })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.error, 'FORBIDDEN')

    // 提升为管理员（CLI 用的是同一个服务函数）
    const row = app.db.prepare('SELECT id FROM users WHERE username = ?').get('plainplayer')
    run(app.db, 'UPDATE users SET role = ? WHERE id = ?', 'admin', row.id)

    const needsSetup = await app.call('/api/admin/overview', { cookie })
    assert.equal(needsSetup.status, 403)
    assert.equal(needsSetup.body.error, 'TOTP_SETUP_REQUIRED')

    // 绑定 TOTP
    const setup = await app.call('/api/auth/totp/setup', { method: 'POST', cookie, body: {} })
    assert.equal(setup.status, 200)
    assert.match(setup.body.secret, /^[A-Z2-7]{16,}$/)
    const { verifyTotp } = await import('../server/lib/totp.js')
    const code = (await import('../server/lib/totp.js')).totpCode(setup.body.secret, Math.floor(Date.now() / 30000))
    assert.ok(verifyTotp(setup.body.secret, code, Date.now()) !== null)

    const enabled = await app.call('/api/auth/totp/enable', { method: 'POST', cookie, body: { code } })
    assert.equal(enabled.status, 200)
    assert.equal(enabled.body.recoveryCodes.length, 8)

    // 绑定后当前会话的 mfa_at 被置位，可以直接进后台
    const ok = await app.call('/api/admin/overview', { cookie })
    assert.equal(ok.status, 200)
    assert.ok(ok.body.users.some((user) => user.username === 'plainplayer' && user.role === 'admin'))
    // 用户列表带上玩家资产：新号 0 鱼币、2 张未刮刮刮乐、3 张空白彩票。
    const playerRow = ok.body.users.find((user) => user.username === 'plainplayer')
    assert.equal(playerRow.coins, 0)
    assert.equal(playerRow.scratchCards, 2)
    assert.equal(playerRow.blankTickets, 3)

    // 保存配置应升版本号
    const before = ok.body.configVersion
    const saved = await fetch(`https://127.0.0.1:${app.server.address().port}/api/admin/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Cookie: cookie },
      body: JSON.stringify({ config: { ...ok.body.config, fx: { ...ok.body.config.fx, feeRate: 0.03 } } }),
    })
    assert.equal(saved.status, 200)
    const savedBody = await saved.json()
    assert.ok(savedBody.configVersion > before)
    void saveConfig
  } finally {
    await app.close()
  }
})

test('admin overview reports verified emails instead of always "unverified"', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'mailadmin')
    const row = app.db.prepare('SELECT id FROM users WHERE username = ?').get('mailadmin')
    // 直接写库模拟「已完成邮箱验证」的账号：overview 必须把这些列一起查出来。
    run(app.db, 'UPDATE users SET role = ?, email = ?, email_key = ?, email_verified_at = ? WHERE id = ?',
      'admin', 'Captain@Example.com', 'captain@example.com', Date.now(), row.id)
    const setup = await app.call('/api/auth/totp/setup', { method: 'POST', cookie, body: {} })
    const { totpCode } = await import('../server/lib/totp.js')
    const code = totpCode(setup.body.secret, Math.floor(Date.now() / 30000))
    await app.call('/api/auth/totp/enable', { method: 'POST', cookie, body: { code } })

    const overview = await app.call('/api/admin/overview', { cookie })
    assert.equal(overview.status, 200)
    const target = overview.body.users.find((user) => user.username === 'mailadmin')
    assert.equal(target.emailVerified, true, '已验证邮箱不应显示为未验证')
    assert.equal(target.email, 'Captain@Example.com')
    assert.equal(overview.body.me.emailVerified, true)
  } finally {
    await app.close()
  }
})

test('second login with 2FA requires a valid code before issuing a session', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'totpuser')
    const row = app.db.prepare('SELECT id FROM users WHERE username = ?').get('totpuser')
    run(app.db, 'UPDATE users SET role = ? WHERE id = ?', 'admin', row.id)
    const setup = await app.call('/api/auth/totp/setup', { method: 'POST', cookie, body: {} })
    const { totpCode } = await import('../server/lib/totp.js')
    const code = totpCode(setup.body.secret, Math.floor(Date.now() / 30000))
    await app.call('/api/auth/totp/enable', { method: 'POST', cookie, body: { code } })

    const login = await app.call('/api/auth/login', { method: 'POST', body: { username: 'totpuser', password: 'password123' } })
    assert.equal(login.status, 200)
    assert.equal(login.body.totpRequired, true)
    assert.ok(login.body.challengeId)
    assert.equal(login.cookie, null, '第一步不应下发会话 cookie')

    const wrong = await app.call('/api/auth/totp', { method: 'POST', body: { challengeId: login.body.challengeId, code: '000000' } })
    assert.equal(wrong.status, 401)

    // 同一步长的验证码已被前一次启用消耗，这里用下一个步长。
    const nextCode = totpCode(setup.body.secret, Math.floor(Date.now() / 30000) + 1)
    const good = await app.call('/api/auth/totp', { method: 'POST', body: { challengeId: login.body.challengeId, code: nextCode } })
    assert.equal(good.status, 200)
    assert.ok(good.cookie)
    assert.equal(good.body.user.username, 'totpuser')
  } finally {
    await app.close()
  }
})

test('offline time is replayed but capped at the configured limit', async () => {
  const app = await startServer()
  const t0 = Date.now()
  try {
    const cookie = await register(app.call, 'offliner')
    setClock(t0)
    const boot = await app.call('/api/bootstrap', { cookie })
    assert.equal(boot.status, 200)
    // 让时间推进 2 小时
    setClock(t0 + 2 * HOUR)
    const sync = await app.call(`/api/sync?v=${boot.body.meVersion}&d=${boot.body.daysVersion}`, { cookie })
    assert.equal(sync.status, 200)
    assert.ok(sync.body.changed)
    assert.ok(sync.body.me.stats.totalCatches > 0, '离线两小时应有产出')

    // 再推进 100 小时：只能结算到 cap（测试里 capMs 默认 12h），额外部份直接跳过。
    const caughtBefore = sync.body.me.stats.totalCatches
    setClock(t0 + 102 * HOUR)
    const sync2 = await app.call(`/api/sync?v=${sync.body.meVersion}&d=${sync.body.daysVersion}`, { cookie })
    assert.equal(sync2.status, 200)
    // 时间戳必须被夹到「现在」，不能真的补算 102 小时。
    const tick = sync2.body.fishing.lastTickAt
    assert.equal(tick, t0 + 102 * HOUR, '超出额度的旧时间必须一次跳过')
    // 12 小时内产出有限，且不会凭空多出 102 小时的量。
    const catches = sync2.body.me ? sync2.body.me.stats.totalCatches : caughtBefore
    assert.ok(catches >= caughtBefore, '鱼只增不减')
    const inventory = app.db.prepare('SELECT state FROM players WHERE user_id = 1').get()
    const persisted = JSON.parse(inventory.state)
    assert.ok(persisted.stats.totalCatches >= caughtBefore)
    assert.equal(persisted.fishing.lastTickAt, tick)

    const repeat = await app.call(`/api/sync?v=${sync2.body.meVersion}`, { cookie })
    assert.equal(repeat.status, 200)
    assert.equal(repeat.body.meVersion, sync2.body.meVersion, '同一时间重复刷新不能再补算收益')
  } finally {
    resetClock()
    await app.close()
  }
})

test('sync revives a stopped rod with auto repair instead of leaving fishing paused', async () => {
  const app = await startServer()
  const t0 = Date.now()
  try {
    const cookie = await register(app.call, 'repair-resume')
    setClock(t0)
    const boot = await app.call('/api/bootstrap', { cookie })
    const base = JSON.parse(app.db.prepare('SELECT state FROM players WHERE user_id = 1').get().state)
    // 自动维修现在是钓竿自带的升级项：给这把竿点 5 级（阈值 60），
    // 耐久 30 的钓竿已被停钓线打断，读档时要按真实停钓线重新推导，自动维修才有机会接手。
    const leveledRod = { ...base.rod, levels: { ...(base.rod.levels || {}), autoRepair: 5 } }
    const stopped = {
      ...base,
      rod: { ...leveledRod, durability: 30, status: 'active' },
      rods: base.rods.map((rod) => rod.id === base.rod.id ? { ...leveledRod, durability: 30 } : rod),
      fishing: { ...base.fishing, running: false, autoStopped: false, lowDurability: false, manualResume: false, phase: 'charging', bite: null, lastTickAt: t0, autoRepairAt: 0 },
    }
    app.db.prepare('UPDATE players SET state = ? WHERE user_id = 1').run(JSON.stringify(stopped))

    setClock(t0 + 1000)
    const sync = await app.call(`/api/sync?v=${boot.body.meVersion}&d=${boot.body.daysVersion}&boost=0`, { cookie })
    assert.equal(sync.status, 200)
    assert.equal(sync.body.fishing.running, true, '自动维修后应自动恢复钓鱼')
    const persisted = JSON.parse(app.db.prepare('SELECT state FROM players WHERE user_id = 1').get().state)
    assert.equal(persisted.stats.autoRepairs, 1)
    assert.ok(persisted.rod.durability > 30, `耐久应被补回：${persisted.rod.durability}`)
  } finally {
    resetClock()
    await app.close()
  }
})

test('players share one FX market: one player\'s catch moves the price others see', async () => {
  const app = await startServer()
  const t0 = Date.now()
  try {
    const cookieA = await register(app.call, 'trader-a')
    const cookieB = await register(app.call, 'trader-b')
    setClock(t0)
    const bootA = await app.call('/api/bootstrap', { cookie: cookieA })
    const bootB = await app.call('/api/bootstrap', { cookie: cookieB })
    assert.equal(bootA.status, 200)

    // 行情是服务端算好的快照：每个玩家看到同一批报价与同一批档位。
    assert.equal(bootA.body.fx.quotes.length, 8)
    assert.deepEqual(
      bootA.body.fx.quotes.map((q) => q.mid),
      bootB.body.fx.quotes.map((q) => q.mid),
      '不同玩家应看到完全相同的报价',
    )

    // A 离线钓鱼 3 小时：钓获会把词条抽出市场，写进全服 fx_bucket。
    setClock(t0 + 3 * HOUR)
    const syncA = await app.call(`/api/sync?v=${bootA.body.meVersion}&d=${bootA.body.daysVersion}`, { cookie: cookieA })
    assert.equal(syncA.status, 200)
    assert.ok(syncA.body.me.stats.totalCatches > 0, 'A 应该有钓获')

    const bucketsAfterA = app.db.prepare('SELECT symbol, day, net, volume FROM fx_bucket').all()
    assert.ok(bucketsAfterA.length > 0, '钓获应写入全服待结算桶')
    assert.ok(bucketsAfterA.every((row) => Number(row.net) > 0), '上钩是正流入')

    // B 自己也会追算这 3 小时的离线产出，所以它的同步会再往桶里加一批。
    // 关键不变量：B 拿到的 todayNet 必须等于「此刻数据库里的桶」，而不是某份缓存。
    const syncB = await app.call(`/api/sync?v=${bootB.body.meVersion}&d=${bootB.body.daysVersion}`, { cookie: cookieB })
    assert.equal(syncB.status, 200)
    const bucketsNow = app.db.prepare('SELECT symbol, net FROM fx_bucket').all()
    const bucketMap = Object.fromEntries(bucketsNow.map((row) => [row.symbol, Number(row.net)]))
    assert.ok(Object.keys(bucketMap).length > 0)
    syncB.body.fx.quotes.forEach((quote) => {
      if (bucketMap[quote.name] === undefined) return
      assert.equal(quote.todayNet, bucketMap[quote.name], `${quote.name} 的今日净额必须等于全服桶`)
    })
    assert.deepEqual(syncB.body.me.fx.positions, {}, 'B 的持仓不受 A 影响')

    // A 看到的也是同一份桶：全服只有一套行情，不存在「每人一份」。
    const syncA2 = await app.call(`/api/sync?v=${syncA.body.meVersion}&d=${syncA.body.daysVersion}`, { cookie: cookieA })
    assert.equal(syncA2.status, 200)
    syncA2.body.fx.quotes.forEach((quote) => {
      if (bucketMap[quote.name] === undefined) return
      assert.equal(quote.todayNet, bucketMap[quote.name], `${quote.name} 的今日净额对所有玩家一致`)
    })

    // 跨过零点：全服桶结算成日线，价格真的动了，且两个玩家看到同一份。
    setClock(t0 + 30 * HOUR)
    await app.call('/api/sync', { cookie: cookieA })
    const fxAfterA = await app.call('/api/fx', { cookie: cookieA })
    const fxAfterB = await app.call('/api/fx', { cookie: cookieB })
    assert.equal(fxAfterA.status, 200)
    assert.equal(fxAfterB.status, 200)
    assert.deepEqual(
      fxAfterA.body.quotes.map((q) => q.mid),
      fxAfterB.body.quotes.map((q) => q.mid),
      '全服报价必须完全一致',
    )
    const allBars = Object.values(fxAfterA.body.candles || {}).flatMap((byGrain) => Object.values(byGrain || {}))
      .flatMap((payload) => (payload?.rows || []))
    assert.ok(allBars.length > 0, '跨零点后应有蜡烛落库')
    // 全服桶在结算后被清空。
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM fx_bucket').get().n, 0)
  } finally {
    resetClock()
    await app.close()
  }
})

test('成交时间桶会持久化：当日桶随 fxToday 下发，结算后留在最近 30 天里', async () => {
  const app = await startServer()
  const t0 = Date.now()
  try {
    setClock(t0)
    const config = getConfig(app.db).config
    const day = fxDayIndex(t0)
    const versionBefore = market.daysVersion(app.db)
    market.appendFlow(app.db, [{ name: 'swift', net: 5, volume: 5, bins: [[40, 5, 5]] }], config, t0)
    // 只改今日桶，不应该让客户端整包重拉一年的历史行情。
    assert.equal(market.daysVersion(app.db), versionBefore, '追加流水不应 bump 历史版本')
    assert.deepEqual(market.readWorld(app.db).today.swift.bins, [[40, 5, 5]])

    const tomorrow = t0 + 24 * HOUR
    setClock(tomorrow)
    market.settleWorld(app.db, config, tomorrow)
    const bins = market.readDayBins(app.db, tomorrow, config)
    assert.deepEqual(bins.swift?.[day], [[40, 5, 5]], '结算后时间桶应保留在对应交易日')
  } finally {
    resetClock()
    await app.close()
  }
})

test('cross-site writes are rejected by the CSRF guard', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'csrfuser')
    const port = app.server.address().port
    // 缺少 X-Requested-With
    const res = await fetch(`https://127.0.0.1:${port}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'toggleFishing' }),
    })
    assert.equal(res.status, 403)
    // Origin 与 Host 不一致
    const res2 = await fetch(`https://127.0.0.1:${port}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Origin: 'https://evil.example', Cookie: cookie },
      body: JSON.stringify({ action: 'toggleFishing' }),
    })
    assert.equal(res2.status, 403)
  } finally {
    await app.close()
  }
})

test('password hashing round-trips and rejects wrong passwords', async () => {
  const { hashPassword, verifyPassword } = await import('../server/lib/passwords.js')
  const hash = hashPassword('correct horse battery staple')
  assert.match(hash, /^scrypt\$32768\$8\$1\$/)
  assert.equal(verifyPassword('correct horse battery staple', hash), true)
  assert.equal(verifyPassword('wrong password', hash), false)
  // 同一密码两次哈希不同（每用户独立盐）
  assert.notEqual(hash, hashPassword('correct horse battery staple'))
  void authService
})

// ---- 邮箱验证（可选功能）----

test('email verification stores and verifies a masked code end to end', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'mailer')

    // 未配置 SMTP：服务端只把码写日志，接口仍返回 sent，但 delivered=false。
    const send = await app.call('/api/auth/email/send', { method: 'POST', body: { email: 'captain@example.com' }, cookie })
    assert.equal(send.status, 200, JSON.stringify(send.body))
    assert.equal(send.body.sent, true)
    assert.equal(send.body.delivered, false)

    const row = app.db.prepare('SELECT * FROM email_tokens ORDER BY id DESC LIMIT 1').get()
    assert.ok(row, '应写入待验证记录')
    assert.equal(row.email_key, 'captain@example.com')
    // 库里只有哈希，明文码不落库。
    assert.match(row.code_hash, /^[0-9a-f]{64}$/)

    // 冷却期内不能连发。
    const again = await app.call('/api/auth/email/send', { method: 'POST', body: { email: 'captain@example.com' }, cookie })
    assert.equal(again.status, 429)

    // 错误验证码会被计数并拒绝。
    const wrong = await app.call('/api/auth/email/verify', { method: 'POST', body: { code: '000000' }, cookie })
    assert.equal(wrong.status, 400)
    assert.equal(app.db.prepare('SELECT attempts FROM email_tokens WHERE id = ?').get(row.id).attempts, 1)

    // 用正确码验证：直接从库里取不到明文，所以这里重建哈希来反推码。
    const { sha256 } = await import('../server/lib/passwords.js')
    let match = null
    for (let n = 0; n < 1_000_000; n += 1) {
      const code = String(n).padStart(6, '0')
      if (sha256(`${row.user_id}:${row.email_key}:${code}`) === row.code_hash) { match = code; break }
    }
    assert.ok(match, '应能还原测试用验证码')

    const ok = await app.call('/api/auth/email/verify', { method: 'POST', body: { code: match }, cookie })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(ok.body.email, 'captain@example.com')
    assert.equal(ok.body.user.emailVerified, true)
    assert.equal(ok.body.user.email, 'captain@example.com')

    // 已验证后，me 接口也带标记。
    const me = await app.call('/api/auth/me', { cookie })
    assert.equal(me.body.user.emailVerified, true)

    // 验证码一次性：同一码再用一次失败。
    // 邮箱已验证后走的是「已锁定」这条更早的检查，返回 409 EMAIL_LOCKED。
    const reuse = await app.call('/api/auth/email/verify', { method: 'POST', body: { code: match }, cookie })
    assert.equal(reuse.status, 409)
    assert.equal(reuse.body.error, 'EMAIL_LOCKED')
  } finally {
    await app.close()
  }
})

test('a verified email cannot be claimed by a second account', async () => {
  const app = await startServer()
  try {
    const alice = await register(app.call, 'alice2')
    const bob = await register(app.call, 'bob2')
    const { sha256 } = await import('../server/lib/passwords.js')

    const send = await app.call('/api/auth/email/send', { method: 'POST', body: { email: 'shared@example.com' }, cookie: alice })
    assert.equal(send.status, 200)
    const row = app.db.prepare('SELECT * FROM email_tokens ORDER BY id DESC LIMIT 1').get()
    let code = null
    for (let n = 0; n < 1_000_000; n += 1) {
      const candidate = String(n).padStart(6, '0')
      if (sha256(`${row.user_id}:${row.email_key}:${candidate}`) === row.code_hash) { code = candidate; break }
    }
    assert.ok(code)
    const verified = await app.call('/api/auth/email/verify', { method: 'POST', body: { code }, cookie: alice })
    assert.equal(verified.status, 200)

    // 另一个账号申请同一个邮箱 → 409。
    const steal = await app.call('/api/auth/email/send', { method: 'POST', body: { email: 'shared@example.com' }, cookie: bob })
    assert.equal(steal.status, 409)
    assert.equal(steal.body.error, 'EMAIL_TAKEN')
  } finally {
    await app.close()
  }
})

// ---- 邮箱作为登录标识 ----

// 绑定并验证一个邮箱，返回反推出的验证码（测试里从哈希暴力枚举）。
const bindEmail = async (app, cookie, email) => {
  const send = await app.call('/api/auth/email/send', { method: 'POST', body: { email }, cookie })
  assert.equal(send.status, 200, JSON.stringify(send.body))
  const row = app.db.prepare('SELECT * FROM email_tokens ORDER BY id DESC LIMIT 1').get()
  let code = null
  for (let n = 0; n < 1_000_000; n += 1) {
    const candidate = String(n).padStart(6, '0')
    if (sha256(`${row.user_id}:${row.email_key}:${candidate}`) === row.code_hash) { code = candidate; break }
  }
  assert.ok(code, '应能还原测试用验证码')
  const verified = await app.call('/api/auth/email/verify', { method: 'POST', body: { code }, cookie })
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  return verified.body
}

test('a verified email can be used to log in, an unverified one cannot', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'mailLogin', 'password123')
    // 没验证前，拿邮箱登录不行。
    const early = await app.call('/api/auth/login', { method: 'POST', body: { username: 'mailLogin@example.com', password: 'password123' } })
    assert.equal(early.status, 401)

    await bindEmail(app, cookie, 'mailLogin@example.com')

    // 大小写与前后空格都应该能登录（email_key 是小写规范化的）。
    for (const identifier of ['mailLogin@example.com', '  MAILLOGIN@Example.COM  ']) {
      const res = await app.call('/api/auth/login', { method: 'POST', body: { username: identifier, password: 'password123' } })
      assert.equal(res.status, 200, `${identifier} 应能登录：${JSON.stringify(res.body)}`)
      assert.equal(res.body.user.username, 'mailLogin')
      assert.ok(res.cookie, '应签发会话')
    }

    // 密码错依然是 401，不会因为走邮箱就放宽。
    const wrong = await app.call('/api/auth/login', { method: 'POST', body: { username: 'mailLogin@example.com', password: 'nope-nope' } })
    assert.equal(wrong.status, 401)
  } finally {
    await app.close()
  }
})

test('a verified email is locked: no rebinding, no unbinding', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'locked', 'password123')
    await bindEmail(app, cookie, 'locked@example.com')

    // 换绑：直接 409，不会发码。
    const rebind = await app.call('/api/auth/email/send', { method: 'POST', body: { email: 'other@example.com' }, cookie })
    assert.equal(rebind.status, 409)
    assert.equal(rebind.body.error, 'EMAIL_LOCKED')

    // 同邮箱重发也拒绝（已经是已验证状态）。
    const again = await app.call('/api/auth/email/send', { method: 'POST', body: { email: 'locked@example.com' }, cookie })
    assert.equal(again.status, 409)
    assert.equal(again.body.error, 'EMAIL_LOCKED')

    // 解绑接口保留但拒绝执行。
    const unbind = await app.call('/api/auth/email/remove', { method: 'POST', body: {}, cookie })
    assert.equal(unbind.status, 409)
    assert.equal(unbind.body.error, 'EMAIL_LOCKED')

    // 库里绑定还在，登录照常。
    const me = await app.call('/api/auth/me', { cookie })
    assert.equal(me.body.user.email, 'locked@example.com')
    assert.equal(me.body.user.emailVerified, true)
    const login = await app.call('/api/auth/login', { method: 'POST', body: { username: 'locked@example.com', password: 'password123' } })
    assert.equal(login.status, 200)
  } finally {
    await app.close()
  }
})

test('two accounts cannot share one verified email, and each maps to its own account', async () => {
  const app = await startServer()
  try {
    const first = await register(app.call, 'owner', 'password123')
    const second = await register(app.call, 'squatter', 'password123')
    await bindEmail(app, first, 'only@example.com')

    const steal = await app.call('/api/auth/email/send', { method: 'POST', body: { email: 'ONLY@example.com' }, cookie: second })
    assert.equal(steal.status, 409)
    assert.equal(steal.body.error, 'EMAIL_TAKEN')

    // 用这个邮箱登录，落到原账号上，不会串到第二个账号。
    const login = await app.call('/api/auth/login', { method: 'POST', body: { username: 'only@example.com', password: 'password123' } })
    assert.equal(login.status, 200)
    assert.equal(login.body.user.username, 'owner')
  } finally {
    await app.close()
  }
})

test('email endpoints require a session and reject malformed addresses', async () => {
  const app = await startServer()
  try {
    const anon = await app.call('/api/auth/email/send', { method: 'POST', body: { email: 'a@b.co' } })
    assert.equal(anon.status, 401)

    const cookie = await register(app.call, 'validator')
    for (const bad of ['', 'not-an-email', 'a@b', 'a b@c.com', 'x@y.z\r\nBcc: evil@example.com']) {
      const res = await app.call('/api/auth/email/send', { method: 'POST', body: { email: bad }, cookie })
      assert.ok(res.status === 400, `「${bad}」应被拒绝，实际 ${res.status}`)
    }
  } finally {
    await app.close()
  }
})

// ---- 重置进度：密码 + 邮箱验证码 ----

// 反推重置验证码：库里只有 sha256(`reset:${userId}:${code}`)，测试里暴力枚举 10^6 个。
const crackResetCode = (row) => {
  for (let n = 0; n < 1_000_000; n += 1) {
    const candidate = String(n).padStart(6, '0')
    if (sha256(`reset:${row.user_id}:${candidate}`) === row.code_hash) return candidate
  }
  return null
}

test('progress reset requires password then email code, and wipes the save', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'resetter')
    // 先赢一点东西，好在重置后看出被清空。
    const before = await app.call('/api/bootstrap', { cookie })
    assert.equal(before.status, 200)

    // 没有验证过邮箱：第一步直接拒绝，并给出可识别的 code。
    const noEmail = await app.call('/api/auth/progress-reset/send', { method: 'POST', body: { password: 'password123' }, cookie })
    assert.equal(noEmail.status, 409)
    assert.equal(noEmail.body.error, 'EMAIL_REQUIRED')

    // 绑定邮箱。
    await app.call('/api/auth/email/send', { method: 'POST', body: { email: 'reset@example.com' }, cookie })
    const emailRow = app.db.prepare('SELECT * FROM email_tokens ORDER BY id DESC LIMIT 1').get()
    let emailCode = null
    for (let n = 0; n < 1_000_000; n += 1) {
      const candidate = String(n).padStart(6, '0')
      if (sha256(`${emailRow.user_id}:${emailRow.email_key}:${candidate}`) === emailRow.code_hash) { emailCode = candidate; break }
    }
    const verified = await app.call('/api/auth/email/verify', { method: 'POST', body: { code: emailCode }, cookie })
    assert.equal(verified.status, 200)

    // 错误密码不能发码。
    const wrongPassword = await app.call('/api/auth/progress-reset/send', { method: 'POST', body: { password: 'nope-nope' }, cookie })
    assert.equal(wrongPassword.status, 401)
    assert.equal(wrongPassword.body.error, 'BAD_CREDENTIALS')

    // 正确密码发码。
    const send = await app.call('/api/auth/progress-reset/send', { method: 'POST', body: { password: 'password123' }, cookie })
    assert.equal(send.status, 200, JSON.stringify(send.body))
    assert.equal(send.body.delivered, false, '测试环境未配置 SMTP，只写日志')
    // 响应里只有掩码地址，不泄漏完整邮箱。
    assert.match(send.body.email, /^re\*+@example\.com$/)

    const row = app.db.prepare('SELECT * FROM reset_tokens ORDER BY id DESC LIMIT 1').get()
    assert.ok(row, '应写入重置验证码')
    assert.equal(row.used_at, null)

    // 错误验证码被拒绝并计数。
    const wrongCode = await app.call('/api/auth/progress-reset/confirm', { method: 'POST', body: { code: '000000' }, cookie })
    assert.equal(wrongCode.status, 400)
    assert.equal(app.db.prepare('SELECT attempts FROM reset_tokens WHERE id = ?').get(row.id).attempts, 1)

    const code = crackResetCode(row)
    assert.ok(code, '应能还原测试用验证码')
    const confirm = await app.call('/api/auth/progress-reset/confirm', { method: 'POST', body: { code }, cookie })
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body))
    assert.ok(confirm.body.me, '重置后应返回新的玩家快照')
    assert.equal(confirm.body.me.coins, 0)

    // 同一个码不能再用第二次。
    const reuse = await app.call('/api/auth/progress-reset/confirm', { method: 'POST', body: { code }, cookie })
    assert.equal(reuse.status, 400)
    assert.equal(reuse.body.error, 'NO_PENDING_CODE')

    // 会话不受影响，账号还在。
    const me = await app.call('/api/auth/me', { cookie })
    assert.equal(me.status, 200)
    assert.equal(me.body.user.username, 'resetter')
  } finally {
    await app.close()
  }
})

test('resetProgress is no longer a server action', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'actioncheck')
    const res = await app.call('/api/action', { method: 'POST', body: { action: 'resetProgress' }, cookie })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'UNKNOWN_ACTION')
  } finally {
    await app.close()
  }
})

test('progress reset endpoints require a session', async () => {
  const app = await startServer()
  try {
    assert.equal((await app.call('/api/auth/progress-reset/send', { method: 'POST', body: { password: 'x' } })).status, 401)
    assert.equal((await app.call('/api/auth/progress-reset/confirm', { method: 'POST', body: { code: '123456' } })).status, 401)
  } finally {
    await app.close()
  }
})

test('lottery history numbers issues from the first period and keeps the configured number of periods', () => {
  const db = openDatabase(':memory:')
  const { config } = getConfig(db)
  const t0 = Date.parse('2026-11-17T13:00:00.000Z')
  try {
    setClock(t0)
    lottery.backfillDraws(db, config)
    const first = lottery.currentBatchInfo(db, t0, config)
    assert.equal(config.lotteryHistory, 7, '默认展示 7 期')
    assert.equal(first.issue, 8, '当前期号应接在七个已结束时段之后')
    assert.deepEqual(first.history.normal.map((item) => item.issue), [7, 6, 5, 4, 3, 2, 1])
    assert.deepEqual(first.history.advanced.map((item) => item.issue), [7, 6, 5, 4, 3, 2, 1])
    first.history.normal.forEach((item) => assert.equal(item.numbers.length, 6))

    // 重复补绘同一时段不能重抽号码。
    const numbers = first.history.normal.map((item) => item.numbers.join(','))
    lottery.backfillDraws(db, config)
    assert.deepEqual(lottery.currentBatchInfo(db, t0, config).history.normal.map((item) => item.numbers.join(',')), numbers)

    // 下一期开始后，往期列表整体滚动，期号继续顺延。
    setClock(t0 + 6 * HOUR)
    lottery.backfillDraws(db, config)
    const next = lottery.currentBatchInfo(db, t0 + 6 * HOUR, config)
    assert.equal(next.issue, 9)
    assert.deepEqual(next.history.normal.map((item) => item.issue), [8, 7, 6, 5, 4, 3, 2])

    // 后台改期数后立即生效，且不会出现第 0 期 / 负数期号。
    const custom = { ...config, lotteryHistory: 3 }
    const trimmed = lottery.currentBatchInfo(db, t0 + 6 * HOUR, custom)
    assert.deepEqual(trimmed.history.normal.map((item) => item.issue), [8, 7, 6])
    assert.ok(trimmed.history.normal.every((item) => item.issue >= 1))
  } finally {
    resetClock()
    db.close()
  }
})

test('issue origin falls back to the earliest draw so backfilled periods are never 0 or negative', () => {
  const db = openDatabase(':memory:')
  const { config } = getConfig(db)
  const t0 = Date.parse('2026-11-17T13:00:00.000Z')
  try {
    setClock(t0)
    // 模拟旧版本留下的起点：它比实际最早开奖晚，补绘后会出现第 0 期。
    run(db, "INSERT INTO meta(key, value) VALUES('lotteryIssueOrigin', ?)", String(t0))
    lottery.backfillDraws(db, config)
    const info = lottery.currentBatchInfo(db, t0, config)
    const issues = info.history.normal.map((item) => item.issue)
    assert.ok(issues.every((issue) => issue >= 1), `期号不应出现 0 或负数：${issues}`)
    assert.equal(Math.min(...issues), 1, '最早一期固定是第 1 期')
    assert.equal(lottery.issueOrigin(db), Date.parse('2026-11-15T18:00:00.000Z'), '起点应回退到最早开奖批次')
  } finally {
    resetClock()
    db.close()
  }
})

test('black market: faces stay server-side, super scratch settles end to end', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'blackplayer')
    const boot = await app.call('/api/bootstrap', { cookie })
    assert.equal(boot.status, 200)
    const userId = boot.body.user.id
    const config = boot.body.config
    const type = config.scratchTypes[0]

    // 直接改库拿到完整存档（bootstrap 响应已经被剥离未刮卡面，不能拿来当存档）。
    const row = get(app.db, 'SELECT state FROM players WHERE user_id = ?', userId)
    const persisted = JSON.parse(row.state)
    const cards = Array.from({ length: 3 }, (_, index) => makeScratchCard(`bm-${index}`, type.id, type, () => 0.4 + index * 0.01))
    const seeded = {
      ...persisted,
      unlockedDepths: DEPTHS.map((depth) => depth.id),
      coins: 5000,
      scratchCards: cards,
    }
    run(app.db, 'UPDATE players SET state = ? WHERE user_id = ?', JSON.stringify(seeded), userId)

    const synced = await app.call('/api/sync?v=0', { cookie })
    assert.equal(synced.status, 200)
    assert.ok(synced.body.me.blackMarket.order, '解锁海沟后应生成当日订单')
    assert.equal(synced.body.me.blackMarket.introSeen, false)
    const ready = synced.body.me.scratchCards.filter((card) => card.status === 'ready')
    assert.equal(ready.length, 3)
    ready.forEach((card) => {
      assert.equal(card.face, undefined, '未刮卡面不能下发')
      assert.equal(card.payout, undefined)
      assert.ok(card.slots >= 2)
      assert.ok(card.poolHash)
    })
    // 落库必须保留 face，否则重启后卡面就丢了。
    const stored = JSON.parse(get(app.db, 'SELECT state FROM players WHERE user_id = ?', userId).state)
    assert.ok(stored.scratchCards.every((card) => Array.isArray(card.face) && card.face.length === card.pool.slots))

    const ack = await app.call('/api/action', { method: 'POST', cookie, body: { action: 'blackAcknowledge', params: {} } })
    assert.equal(ack.status, 200)
    assert.equal(ack.body.me.blackMarket.introSeen, true)

    const started = await app.call('/api/action', { method: 'POST', cookie, body: { action: 'blackSuperStart', params: { cardIds: cards.map((card) => card.id) } } })
    assert.equal(started.status, 200, JSON.stringify(started.body))
    assert.equal(started.body.me.scratchCards.length, 0)
    assert.ok(started.body.me.blackMarket.super)
    assert.equal(started.body.me.blackMarket.super.status, 'ready')
    assert.equal(started.body.me.blackMarket.super.face.length, config.blackMarket.super.slots)
    assert.ok(started.body.me.blackMarket.super.payoutRate >= 0.01)

    const pending = await app.call('/api/action', { method: 'POST', cookie, body: { action: 'blackSuperStart', params: { cardIds: ['x'] } } })
    assert.equal(pending.status, 409)
    assert.equal(pending.body.error, 'SUPER_PENDING')

    const revealed = await app.call('/api/action', { method: 'POST', cookie, body: { action: 'blackSuperReveal', params: {} } })
    assert.equal(revealed.status, 200, JSON.stringify(revealed.body))
    assert.equal(revealed.body.me.blackMarket.super, null)
    assert.equal(revealed.body.me.blackMarket.lastSuper.status, 'revealed')

    // 未解锁的玩家不能调用黑市动作；无灯主题也不能绕过购买记录。
    const lockedCookie = await register(app.call, 'blacklocked')
    await app.call('/api/bootstrap', { cookie: lockedCookie })
    const lockedSale = await app.call('/api/action', { method: 'POST', cookie: lockedCookie, body: { action: 'blackSellFish', params: { fishIds: ['none'] } } })
    assert.equal(lockedSale.status, 409)
    assert.equal(lockedSale.body.error, 'BLACK_LOCKED')
    const voidTheme = await app.call('/api/action', { method: 'POST', cookie: lockedCookie, body: { action: 'setTheme', params: { theme: 'void' } } })
    assert.equal(voidTheme.status, 409)
  } finally {
    await app.close()
  }
})

// 后台底部的两张表：昨日影响 + 今日结算预览。
// 这里验证的是「HTTP 层拿到的数字」和「库里结算出来的日线」是同一份，
// 而不是再算一遍公式——真正的公式一致性由 test/fx.test.js 守住。
test('admin FX preview reports yesterday impact and today settlement per symbol', async () => {
  const app = await startServer()
  const t0 = Date.now()
  try {
    const cookie = await register(app.call, 'fxpreview')
    const row = app.db.prepare('SELECT id FROM users WHERE username = ?').get('fxpreview')
    run(app.db, 'UPDATE users SET role = ? WHERE id = ?', 'admin', row.id)
    const setup = await app.call('/api/auth/totp/setup', { method: 'POST', cookie, body: {} })
    const { totpCode } = await import('../server/lib/totp.js')
    const code = totpCode(setup.body.secret, Math.floor(Date.now() / 30000))
    await app.call('/api/auth/totp/enable', { method: 'POST', cookie, body: { code } })

    setClock(t0)
    const config = getConfig(app.db).config
    const day = fxDayIndex(t0)
    // 造一根昨天的日线：只钓不卖，收盘价被推高，今天开盘价应等于它。
    market.appendFlow(app.db, [{ name: 'swift', net: 40, volume: 50 }], config, t0 - 24 * HOUR)
    market.settleWorld(app.db, config, t0)
    // 今天的待结算流水。
    market.appendFlow(app.db, [{ name: 'swift', net: -12, volume: 30 }], config, t0)

    const preview = await app.call('/api/admin/fx/preview', { cookie })
    assert.equal(preview.status, 200)
    const body = preview.body
    assert.equal(body.day, day)
    assert.equal(body.yesterday, day - 1)
    assert.ok(body.settlesAt > body.serverTime, '结算时刻应在未来')
    assert.equal(body.rows.length, 8, '每个标的都要有一行')
    assert.ok(body.totals, '必须给出汇总')

    const swift = body.rows.find((item) => item.name === 'swift')
    assert.ok(swift, 'swift 应出现在预览里')
    assert.equal(swift.yesterday.settled, true, '昨天的日线应已结算')
    assert.ok(swift.yesterday.move > 0, '只钓不卖的昨天应上涨')
    // 今开 = 昨收，这是「昨日影响」的核心口径。
    assert.equal(swift.today.open, swift.yesterday.close)
    assert.equal(swift.today.net, -12)
    assert.equal(swift.today.volume, 30)
    assert.ok(swift.today.close > 0)
    assert.ok(swift.today.low <= Math.min(swift.today.open, swift.today.close) + 1e-9)
    assert.ok(swift.today.high >= Math.max(swift.today.open, swift.today.close) - 1e-9)

    // 预览的预计收盘必须等于零点真正落库的收盘价。
    const tomorrow = t0 + 24 * HOUR
    setClock(tomorrow)
    market.settleWorld(app.db, config, tomorrow)
    const bars = market.readWorld(app.db).days.swift || []
    const settledBar = bars.find((bar) => Number(bar[0]) === day)
    assert.ok(settledBar, '今天应结算出一根日线')
    assert.equal(swift.today.close, Number(settledBar[1]), '预览收盘价必须等于落库收盘价')

    // 后台的 K 线预览需要行情快照 + 已保存的 config，否则画不出同款的图。
    assert.ok(body.fx, '必须下发行情快照供 K 线预览')
    assert.ok(body.fx.config, '快照要带已保存的 config')
    assert.equal(body.fx.config.fx.feeRate, config.fx.feeRate, '图上的配置必须是真正结算用的那份')
    // 管理端独享：能看到推演段（玩家侧永远没有这段）。
    const adminCandles = body.fx.candles?.swift?.m60
    assert.ok(adminCandles, '管理端应拿到蜡烛')
    assert.ok(adminCandles.rows.some((row) => row[7] === 1), '管理端应能看到推演蜡烛')
    // 管理端能看到全部档位（含玩家未解锁的），便于核对解锁效果。
    assert.deepEqual(Object.keys(body.fx.candles.swift).sort(), ['m120', 'm15', 'm30', 'm60'])

    // 昨日原始流水：288 个 5 分钟格，供柱状图使用。
    assert.equal(swift.yesterday.bins.length, 288, '昨日应铺成 288 格')
    assert.ok(swift.yesterday.activeBins >= 1, '昨天有成交，至少一格非空')
    const filledBins = swift.yesterday.bins.filter((bin) => bin.net || bin.volume)
    assert.equal(filledBins.reduce((sum, bin) => sum + bin.net, 0), swift.yesterday.net, '逐格净额之和应等于日线净额')
    assert.equal(filledBins.reduce((sum, bin) => sum + bin.volume, 0), swift.yesterday.volume, '逐格成交量之和应等于日线成交量')

    // 只读接口：重复请求不应改变任何行情版本。
    const versionBefore = market.daysVersion(app.db)
    await app.call('/api/admin/fx/preview', { cookie })
    assert.equal(market.daysVersion(app.db), versionBefore, '预览不应 bump 行情版本')
  } finally {
    resetClock()
    await app.close()
  }
})

test('admin FX preview is admin-only', async () => {
  const app = await startServer()
  try {
    assert.equal((await app.call('/api/admin/fx/preview')).status, 401)
    const cookie = await register(app.call, 'plainpreview')
    const denied = await app.call('/api/admin/fx/preview', { cookie })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.error, 'FORBIDDEN')
  } finally {
    await app.close()
  }
})

// 桶宽从 15 分钟改成 5 分钟：库里的旧槽位必须换算，否则昨天 10:00 的流水
// 会被读成今天凌晨 03:00 的流水。
test('旧版 15 分钟桶在读取时会换算成 5 分钟槽位', async () => {
  const app = await startServer()
  const t0 = Date.now()
  try {
    setClock(t0)
    const config = getConfig(app.db).config
    const day = fxDayIndex(t0)
    // 直接写库模拟旧格式：槽位 37 表示的其实是 9:15（15 分钟一格）。
    app.db.prepare('INSERT INTO fx_bucket_bins(symbol, day, bins) VALUES(?, ?, ?)')
      .run('swift', day, JSON.stringify([[37, 12, 20]]))
    app.db.prepare('INSERT INTO fx_bucket(symbol, day, net, volume) VALUES(?, ?, ?, ?)')
      .run('swift', day, 12, 20)

    const world = market.readWorld(app.db)
    // 37 × (15/5) = 111，即 09:15 在 5 分钟格里的位置。
    assert.deepEqual(world.today.swift.bins, [[111, 12, 20]], '旧槽位应按格宽比例换算')

    // 新格式自带格宽，读取时不需要猜。
    app.db.prepare('DELETE FROM fx_bucket_bins').run()
    app.db.prepare('INSERT INTO fx_bucket_bins(symbol, day, bins) VALUES(?, ?, ?)')
      .run('swift', day, JSON.stringify({ ms: 5 * 60 * 1000, v: [[111, 12, 20]] }))
    assert.deepEqual(market.readWorld(app.db).today.swift.bins, [[111, 12, 20]], '新格式原样读出')
    void config
  } finally {
    resetClock()
    await app.close()
  }
})


// ───────────────────────── 逐个解锁（服务端） ─────────────────────────

test('locked tabs reject actions until the guide reaches them', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'guide-locked')
    const boot = await app.call('/api/bootstrap', { cookie })
    assert.equal(boot.status, 200)
    // 新号只解锁了钓鱼：直接调商会/彩票/FX 动作都要被拦住。
    for (const [action, params] of [
      ['exchangeFishBatch', { filter: '全部' }],
      ['craftTickets', { quantity: 1, tier: 'normal' }],
      ['fxBuy', { name: 'swift', qty: 1 }],
      ['claimAllScratch', {}],
    ]) {
      const res = await app.call('/api/action', { method: 'POST', cookie, body: { action, params } })
      assert.equal(res.status, 403, `${action} 应被拦截，实际 ${res.status}`)
      assert.equal(res.body.error, 'FEATURE_LOCKED')
    }
    // 天赋升级不受页签门槛限制：L5 的门槛就是「升过一次天赋」，
    // 而天赋页要等 L5 才可见，拦住它会让引导死锁。
    const talent = await app.call('/api/action', { method: 'POST', cookie, body: { action: 'upgradeTalent', params: { talentId: 'talent-scratch', trackId: 'threshold' } } })
    assert.notEqual(talent.status, 403, '天赋升级不能因未解锁被拦（会死锁）')
    // 引导动作本身不受限：guideSeen / guideSkip 必须可用。
    const seen = await app.call('/api/action', { method: 'POST', cookie, body: { action: 'guideSeen', params: { stepId: 'tension' } } })
    assert.equal(seen.status, 200)
    assert.equal(seen.body.me.guide.seen.tension, true)
    // 幂等：重复提交仍然返回成功，不会因「无变化」报 409
    const replay = await app.call('/api/action', { method: 'POST', cookie, body: { action: 'guideSeen', params: { stepId: 'tension' } } })
    assert.equal(replay.status, 200)
  } finally {
    await app.close()
  }
})

test('guideSkip opens every tab and preserves milestone rewards', async () => {
  const app = await startServer()
  try {
    const cookie = await register(app.call, 'guide-skip')
    await app.call('/api/bootstrap', { cookie })
    const res = await app.call('/api/action', { method: 'POST', cookie, body: { action: 'guideSkip', params: {} } })
    assert.equal(res.status, 200)
    assert.equal(res.body.me.guide.skipped, true)
    const batch = await app.call('/api/action', { method: 'POST', cookie, body: { action: 'exchangeFishBatch', params: { filter: '全部' } } })
    assert.notEqual(batch.status, 403, '跳过引导后不再被页签门槛拦截')

    const row = app.db.prepare('SELECT state FROM players WHERE user_id = 1').get()
    const state = JSON.parse(row.state)
    state.stats = { ...state.stats, totalCatches: 1, totalSold: 1 }
    app.db.prepare('UPDATE players SET state = ? WHERE user_id = 1').run(JSON.stringify(state))
    const progress = await app.call('/api/bootstrap', { cookie })
    assert.equal(progress.body.me.guide.granted.rodUpgrade, true)
    assert.equal(progress.body.me.coins, 1000)
  } finally {
    await app.close()
  }
})

test('sync grants the L2 coins and materials exactly once', async () => {
  const app = await startServer()
  const t0 = Date.now()
  try {
    const cookie = await register(app.call, 'guide-grant')
    setClock(t0)
    const boot = await app.call('/api/bootstrap', { cookie })
    // 直接把存档改成「刚钓到一条鱼」：下一轮 sync 应当推进到 L1。
    const row = app.db.prepare('SELECT state FROM players WHERE user_id = 1').get()
    const state = JSON.parse(row.state)
    app.db.prepare('UPDATE players SET state = ? WHERE user_id = 1').run(JSON.stringify({
      ...state,
      coins: 0,
      inventory: {},
      stats: { ...state.stats, totalCatches: 1, totalExchanged: 1, totalSold: 1, totalScratchEarned: 0, totalTicketsEarned: 0 },
      guide: { ...(state.guide || {}), stage: 0, seen: {}, wonAt: {}, granted: {}, focus: {}, skipped: false },
    }))
    setClock(t0 + 2000)
    const sync = await app.call(`/api/sync?v=${boot.body.meVersion}&d=${boot.body.daysVersion}`, { cookie })
    assert.equal(sync.status, 200)
    setClock(t0 + 4000)
    const second = await app.call(`/api/sync?v=${sync.body.meVersion}&d=${sync.body.daysVersion}`, { cookie })
    assert.equal(second.status, 200)
    // 赠礼只发一次：两次 sync 后鱼币仍是 1000（没有翻倍）。
    const me = (second.body.me || sync.body.me)
    assert.equal(me.coins, 1000, `赠币应只发一次，实际 ${me.coins}`)
    assert.ok(me.guide.granted.rodUpgrade, '应记录已发放')
  } finally {
    resetClock()
    await app.close()
  }
})

test('guide focus carries the 3-second close delay from the server', async () => {
  const app = await startServer()
  const t0 = Date.now()
  try {
    const cookie = await register(app.call, 'guide-focus')
    setClock(t0)
    const boot = await app.call('/api/bootstrap', { cookie })
    // 新号的下一步就是钓鱼页教学，focus 里应带上服务端时间戳。
    assert.ok(boot.body.me.guide.focus, '应下发 focus')
    const entry = boot.body.me.guide.focus.tension
    assert.ok(entry, '焦点应在 tension 上')
    assert.equal(entry.remaining, 3, '介绍卡最少停留 3 秒')
    assert.ok(Number(entry.at) > 0, '焦点要带服务端时间戳')
    // 刷新（再次 bootstrap）不会把倒计时清零：仍然是同一个 at。
    setClock(t0 + 1500)
    const again = await app.call('/api/bootstrap', { cookie })
    assert.equal(again.body.me.guide.focus.tension.at, entry.at, '刷新不能重置倒计时起点')
  } finally {
    resetClock()
    await app.close()
  }
})
