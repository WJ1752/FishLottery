#!/usr/bin/env node
// 邮件配置诊断：发一封真信，把 SMTP 对话全打出来。
//
//   npm run mail:test -- you@qq.com
//
// 会依次检查：环境变量是否齐全 → 能否连上 → TLS 是否成功 → 认证是否通过 →
// 收件人是否被拒 → 邮件是否被服务器接受。任何一步失败都会指出具体是哪一步。
//
// 特意不做「静默成功」：邮件投递失败最常见的原因就是配置看起来对、实际被拒，
// 所以这里把服务器的原始应答全部打印出来。

import { sendMail, mailConfigFromEnv, verificationMail } from '../server/services/mail.js'

const to = process.argv[2]
if (!to) {
  console.error('用法：npm run mail:test -- <收件邮箱>')
  process.exit(1)
}

const config = mailConfigFromEnv()
if (!config) {
  console.error('✗ 没有配置 SMTP_HOST。')
  console.error('')
  console.error('  本地调试（邮件只进 Mailpit，不真的发出去）：')
  console.error('    $env:SMTP_HOST="127.0.0.1"; $env:SMTP_PORT="1025"')
  console.error('')
  console.error('  QQ 邮箱真实投递：')
  console.error('    $env:SMTP_HOST="smtp.qq.com"; $env:SMTP_PORT="465"')
  console.error('    $env:SMTP_USER="你的QQ号@qq.com"; $env:SMTP_PASS="授权码（不是登录密码）"')
  process.exit(1)
}

const mask = (value) => (value ? `${value.slice(0, 3)}***${value.slice(-2)}` : '（未设置）')
console.log('配置：')
console.log(`  服务器    ${config.host}:${config.port}`)
console.log(`  加密      ${config.secure ? '隐式 TLS' : config.starttls ? 'STARTTLS' : '明文（仅本地）'}`)
console.log(`  认证账号  ${mask(config.user)}`)
console.log(`  密码      ${config.pass ? '已设置' : '（未设置）'}`)
console.log(`  发件人    ${config.from}`)
console.log(`  收件人    ${to}`)
console.log('')

if (!config.secure && !config.starttls && !['127.0.0.1', 'localhost'].includes(config.host)) {
  console.warn('⚠ 明文 SMTP 连接外部服务器，密码会以明文传输。请改用 465 或 587。')
  console.warn('')
}

const mail = verificationMail({ username: '测试', code: '000000', minutes: 10 })
const started = Date.now()
try {
  await sendMail({ ...config, to, subject: mail.subject, text: mail.text, debug: true, timeoutMs: 30_000 })
  console.log('')
  console.log(`✓ 服务器已接受这封邮件（${Date.now() - started}ms）`)
  console.log('')
  console.log('注意：「服务器接受」不等于「收件箱收到」。若邮箱里仍然没有：')
  console.log('  1. 看垃圾箱 / 垃圾邮件文件夹；新域名首次发信很容易被判为垃圾邮件。')
  console.log('  2. QQ 邮箱 → 设置 → 反垃圾 → 白名单，把发件人加进去。')
  console.log('  3. 确认 SMTP_PASS 用的是「授权码」而不是 QQ 登录密码。')
  console.log('  4. 自建域名的发件人需要配置 SPF / DKIM，否则大厂会直接丢弃。')
} catch (error) {
  console.log('')
  console.error(`✗ 失败：${error.message}`)
  console.error('')
  const hint = {
    EAUTH: '认证失败：QQ 邮箱必须用「授权码」，不是登录密码。设置 → 账户 → POP3/SMTP服务 → 生成授权码。',
    ECONNECTION: '连不上服务器：检查网络、端口是否被防火墙拦、SMTP_HOST 是否写错。',
    ETIMEDOUT: '连接超时：可能被运营商或防火墙阻断，试试换端口（465 / 587）。',
    ESOCKET: '连接被重置：常见于服务端要求 TLS 但客户端用了明文。',
    ERR_TLS_CERT: '证书校验失败：服务器证书与主机名不符。',
  }[error.code]
  if (hint) console.error(`  ${hint}`)
  if (/5\d\d/.test(error.message)) {
    console.error('  5xx 是永久性错误，重试没用：多半是发件人被拒（SPF/发件人伪造）或收件人不存在。')
  }
  process.exit(1)
}
