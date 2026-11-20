import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createApp } from '../server/app.js'
import { openDatabase, run } from '../server/db/index.js'
import { createSession } from '../server/services/auth.js'
import { getConfig } from '../server/services/config.js'

async function startService(t) {
  const db = openDatabase(':memory:')
  const { config } = getConfig(db)
  const at = Date.now()
  const session = (username, role) => {
    const { lastInsertRowid } = run(db, `INSERT INTO users
      (username, username_key, password_hash, role, totp_enabled_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    username, username, 'test-fixture', role, role === 'admin' ? at : null, at)
    return `fl_sid=${createSession(db, lastInsertRowid, { mfa: role === 'admin' })}`
  }
  const admin = session('operator', 'admin')
  const player = session('player', 'player')
  const server = createServer(createApp({ db }))
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
  t.after(async () => {
    await new Promise((closed) => { server.close(closed); server.closeAllConnections() })
    db.close()
  })
  const url = `http://127.0.0.1:${server.address().port}`
  async function request(path, { method = 'GET', body, cookie = '' } = {}) {
    const res = await fetch(`${url}${path}`, {
      method,
      body: JSON.stringify(body),
      headers: { cookie, 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    })
    return { status: res.status, body: await res.json() }
  }
  return { admin, config, player, request }
}

test('maintenance publishes to players and pauses actions until the operator reopens them', async (t) => {
  const { admin, player, request } = await startService(t)
  const publish = (body, cookie = admin) => request('/api/admin/service', { method: 'PUT', cookie, body })
  const action = () => request('/api/action', { method: 'POST', cookie: player, body: { action: 'guideSkip' } })
  const update = { mode: 'maintenance', message: '维护验收', version: 0 }

  assert.equal((await publish(update, player)).status, 403)
  assert.equal((await publish(update)).status, 200)
  const status = (await request('/api/status')).body
  assert.equal(status.mode, 'maintenance')
  assert.equal(status.message, update.message)
  assert.equal((await request('/api/bootstrap', { cookie: player })).body.service.version, status.version)
  const blocked = await action()
  assert.equal(blocked.status, 503)
  assert.equal(blocked.body.error, 'MAINTENANCE')
  assert.equal((await publish({ mode: 'open', message: '', version: 0 })).status, 409)
  assert.equal((await publish({ mode: 'open', message: '', version: status.version })).status, 200)
  assert.equal((await action()).body.me.guide.skipped, true)
})

test('configuration rollback publishes a new version and rejects a stale operator view', async (t) => {
  const { admin, config, request } = await startService(t)
  const update = {
    method: 'PUT', cookie: admin, body: { config: { ...config, lotteryHistory: 4 }, configVersion: 1 },
  }
  assert.equal((await request('/api/admin/config', update)).body.configVersion, 2)
  const overview = (await request('/api/admin/overview', { cookie: admin })).body
  assert.equal(overview.configHistory[0].version, 1)

  const rollback = (configVersion) => request('/api/admin/config/rollback', {
    method: 'POST', cookie: admin, body: { version: 1, configVersion },
  })
  assert.equal((await rollback(1)).status, 409)
  const restored = await rollback(2)
  assert.equal(restored.status, 200)
  assert.equal(restored.body.configVersion, 3)
  assert.equal(restored.body.config.lotteryHistory, config.lotteryHistory)
})
