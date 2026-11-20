import { all, get, run, transaction } from '../db/index.js'
import { HttpError, badRequest, notFound } from '../http-util.js'
import { now } from '../lib/clock.js'
import { publicUser, requireAdmin, resetTotp } from '../services/auth.js'
import { archivedConfig, getConfig, recentConfigHistory, saveConfig } from '../services/config.js'
import { daysVersion, readDayBins, resetWorld, settleWorld, worldState } from '../services/market.js'
import { buildFxSnapshot } from '../services/fx-snapshot.js'
import { batchNumbers, drawBatch, dueBatches, markBatchDrawn } from '../services/lottery.js'
import { getServiceStatus, saveServiceStatus } from '../services/operations.js'
import { fxSettlementPreview, getBatchId } from '../../src/game.js'

const audit = (db, userId, action, detail, ip) => {
  run(db, 'INSERT INTO admin_audit(user_id, action, detail, ip, created_at) VALUES(?, ?, ?, ?, ?)',
    userId, action, String(detail || '').slice(0, 500), ip || '', now())
}

const USER_PAGE_SIZE = 40

function listAccounts(db, { q, cursor } = {}) {
  const needle = String(q || '').trim().toLowerCase().slice(0, 100)
  const before = cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(cursor)
  if (!Number.isSafeInteger(before) || before < 1) throw badRequest('INVALID_CURSOR', '账号列表页码无效')
  const rows = all(db, `SELECT u.id, u.username, u.role, u.display_name, u.email, u.email_verified_at, u.totp_enabled_at,
      u.created_at, u.last_login_at, u.disabled, p.state
    FROM users u LEFT JOIN players p ON p.user_id = u.id
    WHERE u.id < ? AND (? = '' OR instr(u.username_key, ?) > 0 OR instr(lower(u.display_name), ?) > 0
      OR (u.email_verified_at IS NOT NULL AND instr(u.email_key, ?) > 0))
    ORDER BY u.id DESC LIMIT ?`, before, needle, needle, needle, needle, USER_PAGE_SIZE + 1)
  const users = rows.slice(0, USER_PAGE_SIZE).map((row) => ({
    ...publicUser(row),
    disabled: Boolean(row.disabled),
    ...playerStatsFromState(row.state),
  }))
  return { users, nextCursor: rows.length > USER_PAGE_SIZE ? users.at(-1).id : null }
}

// 用户列表要展示的玩家快照字段：鱼币、未刮开的刮刮乐、空白彩票。
// 快照是整份 JSON，解析失败时按 0 处理，不能让一条坏存档拖垮整个后台。
function playerStatsFromState(raw) {
  const empty = { coins: 0, scratchCards: 0, blankTickets: 0 }
  if (!raw) return empty
  try {
    const state = JSON.parse(raw)
    return {
      coins: Math.max(0, Math.floor(Number(state.coins) || 0)),
      scratchCards: (Array.isArray(state.scratchCards) ? state.scratchCards : []).filter((card) => card.status === 'ready').length,
      blankTickets: (Array.isArray(state.tickets) ? state.tickets : []).filter((ticket) => ticket.status === 'BLANK').length,
    }
  } catch {
    return empty
  }
}

// 管理后台：全部接口都要求 admin 角色 + 12 小时内的 2FA。
// 未绑定 TOTP 时 requireAdmin 会抛 TOTP_SETUP_REQUIRED，前端据此引导绑定。
export function adminRoutes(router) {
  const guard = (ctx) => requireAdmin(ctx.db, ctx.auth)

  router.get('/api/admin/overview', async (ctx) => {
    const auth = guard(ctx)
    const accounts = listAccounts(ctx.db)
    const { config, version } = getConfig(ctx.db)
    const auditRows = all(ctx.db, 'SELECT a.id, a.action, a.detail, a.created_at, u.username FROM admin_audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 50')
    const stats = {
      players: Number(get(ctx.db, 'SELECT COUNT(*) AS n FROM users WHERE role = ?', 'player')?.n) || 0,
      admins: Number(get(ctx.db, 'SELECT COUNT(*) AS n FROM users WHERE role = ?', 'admin')?.n) || 0,
      sessions: Number(get(ctx.db, 'SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', now())?.n) || 0,
    }
    const online = all(ctx.db, `SELECT u.username, s.created_at, s.mfa_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 20`, now())
    return {
      status: 200,
      body: {
        me: publicUser(auth.user),
        ...accounts,
        config,
        configVersion: version,
        configHistory: recentConfigHistory(ctx.db),
        service: getServiceStatus(ctx.db),
        telemetry: ctx.telemetry?.snapshot() || null,
        stats,
        online: online.map((row) => ({ username: row.username, signedInAt: Number(row.created_at), mfaAt: Number(row.mfa_at) })),
        audit: auditRows.map((row) => ({ id: Number(row.id), action: row.action, detail: row.detail, at: Number(row.created_at), username: row.username })),
        serverTime: now(),
      },
    }
  })

  router.get('/api/admin/users', (ctx) => {
    guard(ctx)
    return { status: 200, body: listAccounts(ctx.db, ctx.query) }
  })

  router.put('/api/admin/service', (ctx) => {
    const auth = guard(ctx)
    return transaction(ctx.db, () => {
      const service = saveServiceStatus(ctx.db, ctx.body)
      audit(ctx.db, auth.user.id, 'service.update', service.mode, ctx.ip)
      return { status: 200, body: { service } }
    })
  })

  router.put('/api/admin/config', async (ctx) => {
    const auth = guard(ctx)
    const raw = ctx.body.config
    const expectedVersion = ctx.body.configVersion
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('INVALID_CONFIG', '缺少配置对象')
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
      throw badRequest('INVALID_CONFIG_VERSION', '配置版本无效')
    }
    return transaction(ctx.db, () => {
      const { config, version } = saveConfig(ctx.db, raw, { expectedVersion })
      audit(ctx.db, auth.user.id, 'config.update', `version=${version}`, ctx.ip)
      return { status: 200, body: { config, configVersion: version } }
    })
  })

  router.post('/api/admin/config/rollback', (ctx) => {
    const auth = guard(ctx)
    const { version: sourceVersion, configVersion: expectedVersion } = ctx.body
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw badRequest('INVALID_CONFIG_VERSION', '配置版本无效')
    }
    return transaction(ctx.db, () => {
      const raw = archivedConfig(ctx.db, sourceVersion)
      if (!raw) throw notFound('此配置版本已超出回滚范围')
      const { config, version } = saveConfig(ctx.db, raw, { expectedVersion })
      audit(ctx.db, auth.user.id, 'config.rollback', `source=${sourceVersion} new=${version}`, ctx.ip)
      return { status: 200, body: { config, configVersion: version } }
    })
  })

  router.post('/api/admin/users/:id/availability', (ctx) => {
    const auth = guard(ctx)
    const targetId = Number(ctx.params.id)
    const { disabled } = ctx.body
    if (typeof disabled !== 'boolean') throw badRequest('INVALID_AVAILABILITY', '账号状态无效')
    if (targetId === auth.user.id) throw badRequest('SELF_DISABLE', '不能更改自己的账号状态')
    return transaction(ctx.db, () => {
      const target = get(ctx.db, 'SELECT username, disabled FROM users WHERE id = ?', targetId)
      if (!target) throw notFound('用户不存在')
      if (Boolean(target.disabled) === disabled) return { status: 200, body: { ok: true } }
      run(ctx.db, 'UPDATE users SET disabled = ? WHERE id = ?', disabled, targetId)
      if (disabled) {
        run(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', targetId)
        run(ctx.db, 'DELETE FROM login_challenges WHERE user_id = ?', targetId)
      }
      audit(ctx.db, auth.user.id, disabled ? 'user.disable' : 'user.enable', target.username, ctx.ip)
      return { status: 200, body: { ok: true } }
    })
  })

  // 改动角色同样受 2FA 保护，并写审计。
  router.post('/api/admin/users/:id/role', async (ctx) => {
    const auth = guard(ctx)
    const targetId = Number(ctx.params.id)
    const { role } = ctx.body
    if (role !== 'admin' && role !== 'player') throw badRequest('INVALID_ROLE', '角色无效')
    const target = get(ctx.db, 'SELECT * FROM users WHERE id = ?', targetId)
    if (!target) throw badRequest('USER_NOT_FOUND', '用户不存在')
    if (target.id === auth.user.id && role !== 'admin') throw badRequest('SELF_DEMOTE', '不能撤销自己的管理员权限')
    if (target.role === role) return { status: 200, body: { ok: true } }
    transaction(ctx.db, () => {
      run(ctx.db, 'UPDATE users SET role = ? WHERE id = ?', role, targetId)
      if (role === 'player') resetTotp(ctx.db, targetId)
      audit(ctx.db, auth.user.id, 'user.role', `${target.username} → ${role}`, ctx.ip)
    })
    return { status: 200, body: { ok: true } }
  })

  router.post('/api/admin/users/:id/reset-2fa', async (ctx) => {
    const auth = guard(ctx)
    const targetId = Number(ctx.params.id)
    const target = get(ctx.db, 'SELECT username FROM users WHERE id = ?', targetId)
    if (!target) throw badRequest('USER_NOT_FOUND', '用户不存在')
    transaction(ctx.db, () => {
      resetTotp(ctx.db, targetId)
      audit(ctx.db, auth.user.id, 'user.reset_2fa', target.username, ctx.ip)
    })
    return { status: 200, body: { ok: true } }
  })

  router.post('/api/admin/users/:id/logout', async (ctx) => {
    const auth = guard(ctx)
    const targetId = Number(ctx.params.id)
    const target = get(ctx.db, 'SELECT username FROM users WHERE id = ?', targetId)
    if (!target) throw badRequest('USER_NOT_FOUND', '用户不存在')
    transaction(ctx.db, () => {
      run(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', targetId)
      run(ctx.db, 'DELETE FROM login_challenges WHERE user_id = ?', targetId)
      audit(ctx.db, auth.user.id, 'user.force_logout', target.username, ctx.ip)
    })
    return { status: 200, body: { ok: true } }
  })

  router.post('/api/admin/fx/reset', async (ctx) => {
    const auth = guard(ctx)
    if (getServiceStatus(ctx.db).mode !== 'maintenance') {
      throw new HttpError(409, 'MAINTENANCE_REQUIRED', '请先进入维护状态再重置行情')
    }
    if (ctx.body.confirmation !== 'RESET_FX') throw badRequest('CONFIRMATION_REQUIRED', '需要确认重置行情')
    resetWorld(ctx.db)
    audit(ctx.db, auth.user.id, 'fx.reset', '', ctx.ip)
    return { status: 200, body: { ok: true, daysVersion: daysVersion(ctx.db) } }
  })

  // 后台底部的两张表：昨日影响（已结算日线）+ 今日结算预览（此刻的待结算桶）。
  // 只读，但仍然是全服口径：先把到期的桶结算掉，再读一次世界，
  // 否则管理员在零点后打开后台会看到「今天」还挂着昨天的桶。
  router.get('/api/admin/fx/preview', async (ctx) => {
    guard(ctx)
    const { config } = getConfig(ctx.db)
    const at = now()
    const world = settleWorld(ctx.db, config, at)
    // 已结算日的 5 分钟桶要一起交给领域层：后台的「昨日原始流水」柱状图靠它。
    const bins = readDayBins(ctx.db, at, config)
    const worldWithBins = worldState({ ...world, bins }, config)
    // K 线蜡烛由服务端算好下发——**并且只有这里传 withForecast: true**。
    // 预测段是一条「未来价格路径」，等于提前知道今天会收在哪；
    // 玩家接口（/api/fx、/api/fx/candles）永远不传这个开关，所以拿不到。
    // 这是服务端强制的边界，不是前端隐藏。
    const fx = buildFxSnapshot(worldWithBins, {
      purchases: {},
      withForecast: true,
      at,
    })
    return {
      status: 200,
      body: {
        ...fxSettlementPreview(worldWithBins, at),
        // 逐格成交时间桶：后台按 5 分钟看今天的资金流向，和日内 K 线同源。
        bins,
        todayBins: world.today || {},
        // 管理端要看全部档位（含锁定的），否则没法核对「解锁前后玩家能看到什么」。
        fx: { config, ...fx },
        daysVersion: daysVersion(ctx.db),
        serverTime: at,
      },
    }
  })

  // 仅补处理已到开奖时间的批次，防止运营操作提前关停在售期次。
  router.post('/api/admin/lottery/draw-now', async (ctx) => {
    const auth = guard(ctx)
    const { config } = getConfig(ctx.db)
    const batchIds = dueBatches(ctx.db, now())
    const batches = batchIds.map((batchId) => {
      const numbers = drawBatch(ctx.db, config, batchId)
      markBatchDrawn(ctx.db, batchId)
      audit(ctx.db, auth.user.id, 'lottery.draw', batchId, ctx.ip)
      return { batchId, numbers }
    })
    return { status: 200, body: { batches } }
  })

  // 供后台核对当前批次是否已开奖。
  router.get('/api/admin/lottery', async (ctx) => {
    guard(ctx)
    const { config } = getConfig(ctx.db)
    const batchId = getBatchId(new Date(now()))
    return { status: 200, body: { batchId, numbers: batchNumbers(ctx.db, batchId), lotteryTypes: config.lotteryTypes.map((type) => type.id) } }
  })

  return router
}
