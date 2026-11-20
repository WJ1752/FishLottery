// 用自签证书起一个假的 SMTP 服务器，验证客户端的 TLS / AUTH / 多行应答处理。
// 这不是单元测试，是手工验证脚本：npm run mail:selftest
import { createServer as createTlsServer, TLSSocket, createSecureContext } from 'node:tls'
import { createServer as createNetServer } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sendMail } from '../server/services/mail.js'
import { ensureCertificate } from '../server/lib/tls.js'

const dir = mkdtempSync(join(tmpdir(), 'smtp-selftest-'))
const certPath = join(dir, 'c.crt')
const keyPath = join(dir, 'c.key')
const { cert, key } = ensureCertificate({ certPath, keyPath, certDir: dir })

const transcript = []

// 处理一封邮件的 SMTP 会话；secure 表示这条连接本身已经是 TLS。
// greet=false 用于 STARTTLS 升级后的连接：真实服务器不会重新发 220 问候。
function session(socket, { requireStartTls, authPlain, greet = true }) {
  let inData = false
  let buffer = ''
  let awaitingUser = false
  let awaitingPass = false
  let upgraded = false

  const send = (line) => { transcript.push(`S: ${line}`); socket.write(`${line}\r\n`) }
  if (greet) send('220 selftest ESMTP')

  socket.on('data', (chunk) => {
    if (inData) {
      buffer += chunk.toString('utf8')
      if (buffer.includes('\r\n.\r\n')) {
        inData = false
        const body = buffer.slice(0, buffer.indexOf('\r\n.\r\n'))
        transcript.push(`[body ${body.length} bytes, has code: ${/MTIzNDU2|123456/.test(body) || body.includes('MTIzNDU2')}]`)
        send('250 OK queued')
        buffer = ''
      }
      return
    }
    buffer += chunk.toString('utf8')
    let index = buffer.indexOf('\r\n')
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      handle(line)
      index = buffer.indexOf('\r\n')
    }
  })

  function handle(line) {
    transcript.push(`C: ${line.slice(0, 120)}`)
    const upper = line.toUpperCase()
    if (upper.startsWith('EHLO')) {
      if (requireStartTls && !upgraded && !socket.encrypted) {
        send('250-selftest')
        send('250-STARTTLS')
        send('250 SIZE 1000000')
        return
      }
      send('250-selftest')
      if (authPlain) send('250-AUTH PLAIN LOGIN')
      else send('250-AUTH LOGIN')
      send('250 SIZE 1000000')
      return
    }
    if (upper === 'STARTTLS') {
      send('220 Go ahead')
      // 直接把当前 socket 升级成 TLS。
      const upgradedSocket = new TLSSocket(socket, { isServer: true, secureContext: tlsContext })
      upgraded = true
      socket.removeAllListeners('data')
      session(upgradedSocket, { requireStartTls: false, authPlain, greet: false })
      return
    }
    if (upper.startsWith('AUTH PLAIN')) {
      const payload = Buffer.from(line.split(' ')[2] || '', 'base64').toString('utf8')
      const parts = payload.split('\0')
      transcript.push(`[AUTH PLAIN user=${parts[1]} pass=${parts[2] ? '***' : 'missing'}]`)
      if (parts[1] && parts[2]) { send('235 Auth OK'); return }
      send('535 Auth failed')
      return
    }
    if (upper === 'AUTH LOGIN') { send('334 VXNlcm5hbWU6'); awaitingUser = true; return }
    if (awaitingUser) {
      const user = Buffer.from(line, 'base64').toString('utf8')
      transcript.push(`[AUTH LOGIN user=${user}]`)
      awaitingUser = false
      awaitingPass = true
      send('334 UGFzc3dvcmQ6')
      return
    }
    if (awaitingPass) {
      const pass = Buffer.from(line, 'base64').toString('utf8')
      transcript.push(`[AUTH LOGIN pass=${pass ? '***' : 'missing'}]`)
      awaitingPass = false
      send(pass ? '235 Auth OK' : '535 Auth failed')
      return
    }
    if (upper.startsWith('MAIL FROM')) { send('250 OK'); return }
    if (upper.startsWith('RCPT TO')) { send('250 OK'); return }
    if (upper === 'DATA') { inData = true; send('354 End with .'); return }
    if (upper === 'QUIT') { send('221 Bye'); socket.end(); return }
    send('250 OK')
  }
}

const tlsContext = createSecureContext({ cert, key })
const mail = { from: 'me@example.com', to: 'you@example.com', subject: '测试主题', text: '你的验证码是 123456' }

async function run(name, { secure, starttls, port, expectAuth }) {
  transcript.length = 0
  const handler = (socket) => session(socket, { requireStartTls: starttls, authPlain: expectAuth === 'plain' })
  const server = secure ? createTlsServer({ cert, key }, handler) : createNetServer(handler)
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  try {
    await sendMail({
      host: '127.0.0.1', port, secure, starttls,
      user: 'me@example.com', pass: 'authcode', rejectUnauthorized: false,
      ...mail,
    })
    const authSteps = transcript.filter((l) => l.startsWith('[AUTH'))
    const okTls = transcript.some((l) => l.includes('STARTTLS')) || secure
    console.log(`✓ ${name}`)
    console.log(`  TLS: ${secure ? 'implicit' : 'starttls'} -> ${okTls ? '使用' : '未使用'}`)
    console.log(`  AUTH: ${authSteps.join(' / ') || '（无）'}`)
    console.log(`  行数: ${transcript.length}`)
  } catch (error) {
    console.log(`✗ ${name}: ${error.message}`)
    console.log(transcript.slice(-8).map((l) => '  ' + l).join('\n'))
    process.exitCode = 1
  } finally {
    await new Promise((r) => server.close(r))
  }
}

await run('隐式 TLS + AUTH PLAIN（对应 465）', { secure: true, starttls: false, port: 1465, expectAuth: 'plain' })
await run('STARTTLS + AUTH LOGIN（对应 587）', { secure: false, starttls: true, port: 1587, expectAuth: 'login' })
