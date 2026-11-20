import { createServer } from 'node:https'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { openDatabase, all, run, transaction } from './db/index.js'
import { getConfig } from './services/config.js'
import { settleWorld } from './services/market.js'
import { backfillDraws, drawBatch, dueBatches, markBatchDrawn } from './services/lottery.js'
import { ensureCertificate } from './lib/tls.js'
import { log } from './lib/logger.js'
import { now } from './lib/clock.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOUR = 60 * 60 * 1000

export function readEnv(env = process.env) {
  const dataDir = resolve(env.DATA_DIR || join(ROOT, 'data'))
  const port = Number(env.PORT || 9000)
  const cap = Number(env.OFFLINE_CAP_HOURS ?? 12)
  const trustProxyHops = Number(env.TRUST_PROXY_HOPS || 0)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 之间的整数')
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) throw new Error('TRUST_PROXY_HOPS 必须是非负整数')
  const selfSigned = env.TLS_SELF_SIGNED === '1'
  const hasCustomTls = Boolean(env.TLS_CERT || env.TLS_KEY)
  if (env.NODE_ENV === 'production' && !selfSigned && !(env.TLS_CERT && env.TLS_KEY)) {
    throw new Error('生产环境需同时配置 TLS_CERT 与 TLS_KEY')
  }
  return {
    port,
    host: env.HOST || '127.0.0.1',
    dataDir,
    dbFile: resolve(env.DB_FILE || join(dataDir, 'app.db')),
    certPath: resolve(env.TLS_CERT || join(ROOT, 'certs', 'server.crt')),
    keyPath: resolve(env.TLS_KEY || join(ROOT, 'certs', 'server.key')),
    staticDir: resolve(env.STATIC_DIR || join(ROOT, 'dist')),
    offlineCapMs: Number.isFinite(cap * HOUR) && cap >= 0 ? cap * HOUR : 12 * HOUR,
    trustProxyHops,
    hsts: !selfSigned && (env.HSTS === '1' || (env.HSTS !== '0' && hasCustomTls)),
    allowGenerateTls: !hasCustomTls && (selfSigned || env.NODE_ENV !== 'production'),
  }
}

// 后台定时任务：开奖 + 行情结算。单实例部署，用 setInterval 就够。
export function startJobs(db, { intervalMs = 30 * 1000 } = {}) {
  let nextCleanupAt = 0
  const tick = () => {
    const at = now()
    try {
      const { config } = getConfig(db)
      // 已结束的批次统一开奖；applyDrawNumbers 由各玩家在 sync 时完成。
      dueBatches(db, at).forEach((batchId) => {
        drawBatch(db, config, batchId)
        markBatchDrawn(db, batchId)
        log.info('lottery drawn', { batchId })
      })
      // 往期号码不依赖是否有人买票：最近几期按发行时间补齐，列表始终有内容。
      backfillDraws(db, config, at)
      // 零点结算：即使没人在线，行情也会跨日推进。
      settleWorld(db, config, at)
    } catch (error) {
      log.error('job failed', { message: error?.message })
    }
    if (at >= nextCleanupAt) {
      try {
        transaction(db, () => {
          run(db, 'DELETE FROM sessions WHERE expires_at <= ?', at)
          run(db, 'DELETE FROM login_challenges WHERE expires_at <= ?', at)
          run(db, 'DELETE FROM email_tokens WHERE created_at <= ?', at - HOUR)
          run(db, 'DELETE FROM reset_tokens WHERE created_at <= ?', at - HOUR)
        })
        nextCleanupAt = at + HOUR
      } catch (error) {
        log.error('cleanup failed', { message: error?.message })
      }
    }
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

export function createGameServer(options = {}) {
  const env = { ...readEnv(), ...options }
  const tls = options.tls || ensureCertificate({
    certPath: env.certPath,
    keyPath: env.keyPath,
    certDir: dirname(env.certPath),
    allowGenerate: env.allowGenerateTls,
  })
  const db = options.db || openDatabase(env.dbFile)
  try {
    const app = createApp({ db, config: { hsts: env.hsts, trustProxyHops: env.trustProxyHops }, offlineCapMs: env.offlineCapMs, staticDir: env.staticDir })
    const server = createServer({ cert: tls.cert, key: tls.key, requestTimeout: 30_000, headersTimeout: 10_000 }, app)
    return { db, server, env, tls }
  } catch (error) {
    if (!options.db) db.close()
    throw error
  }
}

async function main() {
  const env = readEnv()
  log.info('starting', { port: env.port, dataDir: env.dataDir, staticDir: env.staticDir })
  if (!existsSync(join(env.staticDir, 'index.html'))) {
    log.warn('未找到前端构建产物，请先运行 npm run build', { staticDir: env.staticDir })
  }
  const { db, server, tls } = createGameServer(env)

  if (tls.generated) {
    log.warn('已生成自签名证书，首次访问需在浏览器中手动信任', { cert: tls.certPath })
  }

  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(env.port, env.host, () => {
        server.off('error', rejectListen)
        resolveListen()
      })
    })
  } catch (error) {
    db.close()
    throw error
  }
  const stopJobs = startJobs(db)
  server.on('error', (error) => log.error('server failed', { message: error?.message }))
  log.info(`深海鱼市已启动: https://localhost:${env.port}`)

  let stopping = false
  const shutdown = (signal) => {
    if (stopping) return
    stopping = true
    log.info('shutting down', { signal })
    stopJobs()
    const timer = setTimeout(() => server.closeAllConnections(), 5000)
    timer.unref()
    server.close(() => {
      clearTimeout(timer)
      db.close()
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

// 只有直接执行时才启动（被测试 import 时不监听端口）。
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    log.error('启动失败', { message: error?.message, stack: String(error?.stack || '').split('\n').slice(0, 6) })
    process.exit(1)
  })
}

export { all, run }
