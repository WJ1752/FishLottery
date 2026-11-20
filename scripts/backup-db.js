#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export function databasePath(env = process.env) {
  return resolve(env.DB_FILE || join(env.DATA_DIR || join(ROOT, 'data'), 'app.db'))
}

export async function backupDatabase(source, output) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = resolve(output || join(dirname(source), 'backups', `fishlottery-${stamp}.db`))
  const db = new DatabaseSync(source, { readOnly: true })
  try {
    mkdirSync(dirname(target), { recursive: true })
    closeSync(openSync(target, 'wx', 0o600))
    try {
      await backup(db, target)
      const snapshot = new DatabaseSync(target, { readOnly: true })
      try {
        if (snapshot.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') {
          throw new Error('备份未通过 SQLite 完整性检查')
        }
      } finally {
        snapshot.close()
      }
      return target
    } catch (error) {
      unlinkSync(target)
      throw error
    }
  } finally {
    db.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  backupDatabase(databasePath(), process.argv[2]).then((file) => {
    console.log(`备份完成：${file}`)
  }).catch((error) => {
    console.error(`备份失败：${error.message}`)
    process.exitCode = 1
  })
}
