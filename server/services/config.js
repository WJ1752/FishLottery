import { get, run } from '../db/index.js'
import { DEFAULT_CONFIG, normalizeConfig } from '../../src/game.js'
import { now } from '../lib/clock.js'
import { HttpError } from '../http-util.js'

// 全服配置：后台保存后版本 +1，玩家在下一次同步时懒应用。
export function getConfig(db) {
  const row = get(db, 'SELECT config, version, updated_at FROM world_config WHERE id = 1')
  if (!row) {
    const at = now()
    const config = normalizeConfig(DEFAULT_CONFIG)
    run(db, 'INSERT INTO world_config(id, config, version, updated_at) VALUES(1, ?, 1, ?)', JSON.stringify(config), at)
    return { config, version: 1 }
  }
  let parsed = null
  try {
    parsed = JSON.parse(row.config)
  } catch {
    parsed = DEFAULT_CONFIG
  }
  // 每次读取都过一遍 normalizeConfig：后台少填字段也不会把玩家状态弄坏。
  return { config: normalizeConfig(parsed), version: Number(row.version) || 1 }
}

export function saveConfig(db, rawConfig, { expectedVersion } = {}) {
  const config = normalizeConfig(rawConfig)
  const at = now()
  const existing = get(db, 'SELECT version FROM world_config WHERE id = 1')
  const currentVersion = Number(existing?.version) || 0
  if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
    throw new HttpError(409, 'CONFIG_CONFLICT', '配置已被更新。请核对最新配置后再保存。', { configVersion: currentVersion })
  }
  const version = currentVersion + 1
  if (existing) {
    run(db, 'UPDATE world_config SET config = ?, version = ?, updated_at = ? WHERE id = 1', JSON.stringify(config), version, at)
  } else {
    run(db, 'INSERT INTO world_config(id, config, version, updated_at) VALUES(1, ?, ?, ?)', JSON.stringify(config), version, at)
  }
  return { config, version }
}
