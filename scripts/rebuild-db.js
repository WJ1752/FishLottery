#!/usr/bin/env node
// 停服后从空库重建游戏数据，保留全服配置。
import { existsSync } from 'node:fs'
import { openDatabase, initializeSchema, get, run, transaction } from '../server/db/index.js'
import { backupDatabase, databasePath } from './backup-db.js'

const tables = [
  'email_tokens', 'reset_tokens', 'sessions', 'recovery_codes', 'login_challenges', 'players',
  'users', 'world_config', 'world_config_history', 'fx_days', 'fx_bucket', 'fx_bucket_bins', 'fx_day_bins',
  'lottery_batches', 'lottery_draws', 'action_log', 'admin_audit', 'meta',
]

async function rebuild() {
  const file = databasePath()
  if (!existsSync(file)) {
    openDatabase(file).close()
    console.log(`已创建空数据库：${file}`)
    return
  }

  if (!process.argv.includes('--confirm')) {
    throw new Error('重建会清空账号与游戏进度。停止游戏服务器后使用 npm run db:rebuild -- --confirm 执行。')
  }

  const backup = await backupDatabase(file)
  console.log(`已备份：${backup}`)
  const db = openDatabase(file)
  try {
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    transaction(db, () => {
      const saved = get(db, 'SELECT config, version FROM world_config WHERE id = 1')
      tables.forEach((name) => db.exec(`DROP TABLE IF EXISTS ${name}`))
      initializeSchema(db)
      if (saved) {
        run(db, 'INSERT INTO world_config(id, config, version, updated_at) VALUES(1, ?, ?, ?)',
          saved.config, Number(saved.version) + 1, Date.now())
      }
    })
    console.log(`重建完成：${file}`)
  } finally {
    db.close()
  }
}

rebuild().catch((error) => {
  console.error(`重建失败：${error.message}`)
  process.exitCode = 1
})
