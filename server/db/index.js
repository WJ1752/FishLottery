import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA = readFileSync(join(HERE, 'schema.sql'), 'utf8')

export function initializeSchema(db) {
  db.exec(SCHEMA)
}

// 保留旧服务器的动作回执，升级成按玩家隔离的幂等键。
function migrateActionLog(db) {
  const userColumn = all(db, 'PRAGMA table_info(action_log)').find((column) => column.name === 'user_id')
  if (userColumn?.pk === 1) return
  db.exec(`
    CREATE TABLE action_log_per_player (
      request_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      response TEXT NOT NULL,
      PRIMARY KEY (user_id, request_id)
    );
    INSERT INTO action_log_per_player SELECT request_id, user_id, created_at, response FROM action_log
      WHERE request_id IS NOT NULL;
    DROP TABLE action_log;
    ALTER TABLE action_log_per_player RENAME TO action_log;
    CREATE INDEX idx_action_log_created ON action_log(created_at);
  `)
}

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA synchronous = FULL')
    transaction(db, () => {
      initializeSchema(db)
      migrateActionLog(db)
      if (!all(db, 'PRAGMA table_info(lottery_batches)').some((column) => column.name === 'rules')) {
        db.exec('ALTER TABLE lottery_batches ADD COLUMN rules TEXT')
      }
    })
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

// node:sqlite 的绑定只接受 null/number/string/bigint/Buffer，
// undefined 与 NaN 会直接抛错。统一在这里兜底，避免每处调用都手动转换。
const bindable = (value) => {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

// 单条语句查询的薄封装，省掉每处 prepare/get 噪音。
export function get(db, sql, ...params) {
  return db.prepare(sql).get(...params.map(bindable))
}

export function all(db, sql, ...params) {
  return db.prepare(sql).all(...params.map(bindable))
}

export function run(db, sql, ...params) {
  return db.prepare(sql).run(...params.map(bindable))
}

// 事务包装：node:sqlite 没有内置 helper，手写 BEGIN/COMMIT/ROLLBACK。
// 注意 node:sqlite 是同步 API，所以事务体内不允许 await。
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 已经回滚 */ }
    throw error
  }
}

export function metaGet(db, key, fallback = null) {
  const row = get(db, 'SELECT value FROM meta WHERE key = ?', key)
  return row ? row.value : fallback
}

export function metaSet(db, key, value) {
  run(db, 'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value))
}
