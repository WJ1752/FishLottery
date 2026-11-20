#!/usr/bin/env node
// 管理员命令行：提升 / 降级 / 重置 2FA / 改密码 / 列出账号。
//
// 用法（在项目根目录）：
//   npm run admin -- promote <username>
//   npm run admin -- demote <username>
//   npm run admin -- list
//   npm run admin -- reset-2fa <username>
//   npm run admin -- set-password <username>
//   npm run admin -- unban <username>
//
// 这是唯一可以把账号变成管理员的入口之一（另一个是已登录管理员在后台操作）。

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { openDatabase, all, get, run, transaction } from '../server/db/index.js'
import { hashPassword, validatePassword } from '../server/lib/passwords.js'
import { resetTotp } from '../server/services/auth.js'
import { databasePath } from './backup-db.js'

const dbFile = databasePath()

const usage = () => {
  console.log(`深海鱼市 · 管理员命令

  node scripts/admin.js list
  node scripts/admin.js promote <username>
  node scripts/admin.js demote <username>
  node scripts/admin.js reset-2fa <username>
  node scripts/admin.js set-password <username>
  node scripts/admin.js disable <username>     禁用账号并踢下线
  node scripts/admin.js enable <username>      恢复被禁用的账号

数据库：${dbFile}
`)
}

const findUser = (db, username) => {
  if (!username) throw new Error('缺少用户名')
  const user = get(db, 'SELECT * FROM users WHERE username_key = ?', String(username).trim().toLowerCase())
  if (!user) throw new Error(`用户不存在：${username}`)
  return user
}

async function promptPassword() {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const password = await rl.question('新密码（至少 8 位）：')
    const again = await rl.question('再输入一次：')
    if (password !== again) throw new Error('两次输入不一致')
    const validation = validatePassword(password)
    if (!validation.ok) throw new Error(validation.message)
    return password
  } finally {
    rl.close()
  }
}

async function main() {
  const [command, username] = process.argv.slice(2)
  if (!command || command === 'help' || command === '--help') {
    usage()
    return
  }
  const db = openDatabase(dbFile)
  try {
    switch (command) {
      case 'list': {
        const users = all(db, 'SELECT id, username, role, totp_enabled_at, disabled, created_at, last_login_at FROM users ORDER BY id')
        if (!users.length) { console.log('还没有任何账号。'); break }
        console.log('ID   用户名               角色      2FA    状态    最后登录')
        users.forEach((user) => {
          const twofa = user.totp_enabled_at ? '是' : '否'
          const state = user.disabled ? '已禁用' : '正常'
          const last = user.last_login_at ? new Date(Number(user.last_login_at)).toLocaleString('zh-CN') : '—'
          console.log(`${String(user.id).padEnd(4)} ${String(user.username).padEnd(20)} ${user.role === 'admin' ? '管理员  ' : '玩家    '} ${twofa.padEnd(6)} ${state.padEnd(6)} ${last}`)
        })
        break
      }
      case 'promote': {
        const user = findUser(db, username)
        run(db, 'UPDATE users SET role = ? WHERE id = ?', 'admin', user.id)
        console.log(`已把 ${user.username} 提升为管理员。首次进入管理后台需要绑定两步验证。`)
        break
      }
      case 'demote': {
        const user = findUser(db, username)
        transaction(db, () => {
          run(db, 'UPDATE users SET role = ? WHERE id = ?', 'player', user.id)
          resetTotp(db, user.id)
        })
        console.log(`已把 ${user.username} 降为玩家，并清除其 2FA 与登录会话。`)
        break
      }
      case 'reset-2fa': {
        const user = findUser(db, username)
        transaction(db, () => resetTotp(db, user.id))
        console.log(`已清除 ${user.username} 的两步验证，下次登录后需重新绑定。`)
        break
      }
      case 'set-password': {
        const user = findUser(db, username)
        const password = await promptPassword()
        const hash = hashPassword(password)
        transaction(db, () => {
          run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id)
          run(db, 'DELETE FROM sessions WHERE user_id = ?', user.id)
          run(db, 'DELETE FROM login_challenges WHERE user_id = ?', user.id)
          run(db, 'DELETE FROM reset_tokens WHERE user_id = ? AND used_at IS NULL', user.id)
        })
        console.log(`已重置 ${user.username} 的密码，旧会话全部失效。`)
        break
      }
      case 'disable': {
        const user = findUser(db, username)
        transaction(db, () => {
          run(db, 'UPDATE users SET disabled = 1 WHERE id = ?', user.id)
          run(db, 'DELETE FROM sessions WHERE user_id = ?', user.id)
          run(db, 'DELETE FROM login_challenges WHERE user_id = ?', user.id)
          run(db, 'DELETE FROM reset_tokens WHERE user_id = ? AND used_at IS NULL', user.id)
        })
        console.log(`已禁用 ${user.username} 并踢下线。`)
        break
      }
      case 'enable': {
        const user = findUser(db, username)
        run(db, 'UPDATE users SET disabled = 0 WHERE id = ?', user.id)
        console.log(`已恢复 ${user.username}。`)
        break
      }
      default:
        usage()
        process.exitCode = 1
    }
  } finally {
    db.close()
  }
}

main().catch((error) => {
  console.error(`错误：${error.message}`)
  process.exit(1)
})
