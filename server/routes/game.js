import { get, run, transaction } from '../db/index.js'
import { HttpError, badRequest, unauthorized } from '../http-util.js'
import { now } from '../lib/clock.js'
import { applyAction } from '../actions.js'
import { getConfig } from '../services/config.js'
import { appendFlowInTransaction, daysVersion, readToday } from '../services/market.js'
import { buildFxCandles, buildFxSnapshot } from '../services/fx-snapshot.js'
import { currentBatchInfo } from '../services/lottery.js'
import { extractPlayerState, fishingTick, redactScratchFaces, savePlayer, syncPlayer, syncPlayerLocked, withPlayerLock } from '../services/players.js'
import { publicUser } from '../services/auth.js'

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000

const requireAuth = (ctx) => {
  if (!ctx.auth) throw unauthorized()
  return ctx.auth
}

// 进 HTTP 层的玩家状态统一剥掉未刮卡面：落库用 extractPlayerState（保留 face），
// 下发前用这里，避免玩家挑高产出卡喂超级刮刮乐。
const publicState = (state) => redactScratchFaces(extractPlayerState(state))

// 读一下玩家的轻量时间态，供 1 秒一次的同步轮询使用。
function tickPayload(state) {
  return { fishing: fishingTick(state) }
}

export function gameRoutes(router, { offlineCapMs }) {
  // 登录后的首屏：账号、全服配置、玩家状态、行情历史一次取齐。
  router.get('/api/bootstrap', async (ctx) => {
    const auth = requireAuth(ctx)
    const { config, version: configVersion } = getConfig(ctx.db)
    const synced = await syncPlayer(ctx.db, auth.user.id, config, { configVersion, capMs: offlineCapMs })
    return {
      status: 200,
      body: {
        user: publicUser(auth.user),
        me: publicState(synced.state),
        config,
        configVersion,
        meVersion: synced.version,
        // 行情的「算」全部在服务端完成：这里只下发算好的报价与蜡烛。
        // 客户端拿到的是数字，不是公式——bundle 里不再有日内路径算法。
        fx: buildFxSnapshot(synced.state, { purchases: synced.state?.blackMarket?.purchases || {}, withCandles: false, at: now() }),
        daysVersion: daysVersion(ctx.db),
        lottery: currentBatchInfo(ctx.db, now(), config),
        serverTime: now(),
      },
    }
  })

  // 1 秒轮询：只回时间态与（可选）经济状态，避免每秒下发整份存档。
  // v 是客户端手上的 meVersion；changed=true 时才带完整 me。
  router.get('/api/sync', async (ctx) => {
    const auth = requireAuth(ctx)
    const { config, version: configVersion } = getConfig(ctx.db)
    const clientVersion = Math.max(0, Math.trunc(Number(ctx.query.v) || 0))
    const synced = await syncPlayer(ctx.db, auth.user.id, config, { configVersion, capMs: offlineCapMs })
    const at = now()
    const worldDays = daysVersion(ctx.db)
    const body = {
      serverTime: at,
      meVersion: synced.version,
      changed: synced.changed || synced.version !== clientVersion,
      configVersion,
      daysVersion: worldDays,
      ...tickPayload(synced.state),
      lottery: currentBatchInfo(ctx.db, at, config),
    }
    if (body.changed) body.me = publicState(synced.state)
    // 行情历史只在新增日线时下发，一天最多一次。
    // 报价每秒都可能变（当前价在走），所以每次都带；蜡烛只在切档位/切标的时按需拉。
    body.fx = buildFxSnapshot(synced.state, { purchases: synced.state?.blackMarket?.purchases || {}, withCandles: false, at })
    return { status: 200, body }
  })

  // 所有会改变游戏状态的意图都走这里。
  router.post('/api/action', async (ctx) => {
    const auth = requireAuth(ctx)
    const { action, params = {}, requestId } = ctx.body || {}
    if (typeof action !== 'string' || !action) throw badRequest('MISSING_ACTION', '缺少动作名')
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw badRequest('INVALID_ARGUMENT', '动作参数格式无效')
    if (requestId != null && (typeof requestId !== 'string' || requestId.length > 80)) throw badRequest('INVALID_ARGUMENT', '请求标识格式无效')

    const userId = auth.user.id
    return withPlayerLock(userId, () => {
      const at = now()
      const expiresBefore = at - IDEMPOTENCY_TTL_MS
      if (requestId) {
        const cached = get(ctx.db, 'SELECT response FROM action_log WHERE user_id = ? AND request_id = ? AND created_at >= ?',
          userId, requestId, expiresBefore)
        if (cached) return { status: 200, body: { ...JSON.parse(cached.response), replayed: true } }
      }

      const { config, version: configVersion } = getConfig(ctx.db)
      const synced = syncPlayerLocked(ctx.db, userId, config, { configVersion, capMs: offlineCapMs, at })

      return transaction(ctx.db, () => {
        const applied = applyAction(action, synced.state, params, { db: ctx.db, config, at })
        if (!applied.applied) throw new HttpError(409, 'NO_EFFECT', '操作未生效，请检查余额、材料和可用数量')
        if (applied.flows.length) appendFlowInTransaction(ctx.db, applied.flows, config, at)
        const meVersion = savePlayer(ctx.db, userId, applied.state, synced.version)
        const body = {
          ok: true,
          me: publicState(applied.state),
          meVersion,
          configVersion,
          serverTime: at,
          daysVersion: daysVersion(ctx.db),
          fxToday: readToday(ctx.db),
          fishing: fishingTick(applied.state),
          lottery: currentBatchInfo(ctx.db, at, config),
          ...(applied.receipt ? { receipt: applied.receipt } : {}),
        }
        if (requestId) {
          run(ctx.db, 'DELETE FROM action_log WHERE created_at < ?', expiresBefore)
          run(ctx.db, 'INSERT INTO action_log(request_id, user_id, created_at, response) VALUES(?, ?, ?, ?)',
            requestId, userId, at, JSON.stringify(body))
        }
        return { status: 200, body }
      })
    })
  })

  // K 线蜡烛按需拉取：切标的 / 切档位时才请求，避免整包重传。
  // 锁着的档位服务端直接拒绝（locked=true），不给前端「藏起来」的机会。
  router.get('/api/fx/candles', async (ctx) => {
    const auth = requireAuth(ctx)
    const { config, version: configVersion } = getConfig(ctx.db)
    const synced = await syncPlayer(ctx.db, auth.user.id, config, { configVersion, capMs: offlineCapMs })
    const result = buildFxCandles(synced.state, {
      name: String(ctx.query.name || ''),
      grain: String(ctx.query.grain || ''),
      purchases: synced.state?.blackMarket?.purchases || {},
      at: now(),
    })
    return { status: 200, body: result }
  })

  // 全量行情快照（含全部可用档位的蜡烛），切到 FX 页时用。
  router.get('/api/fx', async (ctx) => {
    const auth = requireAuth(ctx)
    const { config, version: configVersion } = getConfig(ctx.db)
    const synced = await syncPlayer(ctx.db, auth.user.id, config, { configVersion, capMs: offlineCapMs })
    return { status: 200, body: buildFxSnapshot(synced.state, { purchases: synced.state?.blackMarket?.purchases || {}, at: now() }) }
  })

  return router
}

export { tickPayload }
