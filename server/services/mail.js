import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

// 最小 SMTP 客户端。两种用途：
//   1. 本地开发：Mailpit / MailHog 这类明文收信服务（无 TLS、无认证）；
//   2. 真实投递：QQ / 163 / Gmail 等（465 隐式 TLS 或 587 STARTTLS + AUTH）。
//
// 为什么不用 nodemailer：项目坚持零运行时依赖（Windows 上不编译原生模块），
// 而验证码邮件只需要 EHLO → AUTH → MAIL FROM → RCPT TO → DATA → QUIT。
//
// 环境变量（见 mailConfigFromEnv）：
//   SMTP_HOST      留空时仅开发环境可把验证码写日志
//   SMTP_PORT      默认 1025；465 自动按隐式 TLS 处理
//   SMTP_SECURE    ssl | starttls | none，留空时按端口推断
//   SMTP_USER      需要认证时填（QQ 邮箱填完整地址）
//   SMTP_PASS      密码 / 授权码（QQ 必须用「授权码」，不是登录密码）
//   SMTP_FROM      发件人；默认等于 SMTP_USER
//   SMTP_HELO      EHLO 用的域名；默认取发件人域名
//   SMTP_TLS_INSECURE=1  跳过证书校验（仅自签名测试用）

const DEFAULT_TIMEOUT_MS = 15_000

// SMTP 应答读取器：从 socket 建立那一刻就开始缓冲，避免「监听器挂上之前
// 220 问候语已经到达」这类时序问题——服务端往往在 accept 后立刻发问候语。
function createReader(socket) {
  let buffer = ''
  let pending = null // { resolve, reject }
  let failure = null

  const settle = (kind, value) => {
    const waiter = pending
    pending = null
    if (!waiter) return
    if (kind === 'resolve') waiter.resolve(value)
    else waiter.reject(value)
  }

  // 从缓冲区里取出一条完整应答：多行应答以「状态码 + 空格」结尾，
  // 形如 "250-foo\r\n250 bar\r\n"。
  const drain = () => {
    if (!pending) return
    const lines = buffer.split('\r\n')
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^\d{3} /.test(lines[i])) {
        const consumed = lines.slice(0, i + 1).join('\r\n')
        buffer = lines.slice(i + 1).join('\r\n')
        settle('resolve', { code: Number(lines[i].slice(0, 3)), text: consumed.trim() })
        return
      }
    }
  }

  const onData = (chunk) => {
    buffer += chunk.toString('utf8')
    if (buffer.length > 64 * 1024) {
      socket.destroy(new Error('SMTP 应答过大'))
      return
    }
    drain()
  }
  const onError = (error) => {
    failure = error
    settle('reject', error)
  }
  const onClose = () => {
    failure = failure || new Error('SMTP 连接已被服务器关闭')
    settle('reject', failure)
  }

  socket.on('data', onData)
  socket.on('error', onError)
  socket.on('close', onClose)

  return {
    // 每次调用返回下一条应答；已经到达的直接从缓冲区取，没有则等。
    read: () => new Promise((resolve, reject) => {
      if (failure) { reject(failure); return }
      pending = { resolve, reject }
      drain()
    }),
    // STARTTLS 升级前必须摘掉监听，否则旧 socket 的 data 会串到新会话里。
    detach: () => {
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    },
  }
}

// 建连：secure=true 走隐式 TLS（465），否则明文（必要时再 STARTTLS 升级）。
function openSocket({ host, port, secure, rejectUnauthorized, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tlsConnect({ host, port, servername: host, rejectUnauthorized })
      : netConnect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`连接 ${host}:${port} 超时`))
    }, timeoutMs)
    const ready = () => { clearTimeout(timer); socket.off('error', failed); resolve(socket) }
    const failed = (error) => { clearTimeout(timer); reject(error) }
    socket.once(secure ? 'secureConnect' : 'connect', ready)
    socket.once('error', failed)
  })
}

const write = (socket, text, debug, summary) => new Promise((resolve, reject) => {
  if (debug) console.error('C:', summary || text.replace(/\r\n$/, '').slice(0, 200))
  socket.write(text, (error) => (error ? reject(error) : resolve()))
})

const expect = (reply, allowed, stage, debug) => {
  if (debug) console.error(`S: ${reply.text.split('\r\n')[0]}`)
  if (allowed.includes(reply.code)) return reply
  throw new Error(`SMTP ${stage} 失败：${reply.text.split('\r\n')[0]}`)
}

// 把主题里的非 ASCII 用 RFC 2047 编码，避免客户端乱码。
const encodeHeader = (value) => (/^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`)

// 正文按 base64 传输，省掉 8bit / 引号转义的边界情况。
const encodeBody = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')

// 邮件头里的地址需要挡掉换行，否则等于开放了头部注入。
const safeAddress = (value, label) => {
  const address = String(value || '').trim()
  if (!address || /[\r\n]/.test(address)) throw new Error(`${label} 地址无效`)
  return address
}

// 从 EHLO 应答里读服务器支持的扩展。
function parseCapabilities(text) {
  const upper = text.toUpperCase()
  const authLine = upper.split('\r\n').find((line) => /^\d{3}[- ]AUTH[ =]/.test(line)) || ''
  const mechanisms = authLine.replace(/^\d{3}[- ]AUTH[ =]?/, '').trim().split(/\s+/).filter(Boolean)
  return {
    starttls: /\bSTARTTLS\b/.test(upper),
    auth: mechanisms,
  }
}

const b64 = (value) => Buffer.from(String(value), 'utf8').toString('base64')

/**
 * 通过 SMTP 投递一封信。
 * @param {object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {boolean} [options.secure]   隐式 TLS（465）
 * @param {boolean} [options.starttls] 明文连接后用 STARTTLS 升级（587）
 * @param {string} [options.user]      需要认证时的账号
 * @param {string} [options.pass]      密码 / 授权码
 * @param {string} [options.helo]      EHLO 域名
 * @param {string} options.from
 * @param {string} options.to
 * @param {string} options.subject
 * @param {string} options.text
 * @param {boolean} [options.rejectUnauthorized]
 * @param {boolean} [options.debug]   把 SMTP 对话打到 stderr
 * @param {number} [options.timeoutMs]
 */
export async function sendMail({
  host,
  port,
  secure = false,
  starttls = false,
  user = '',
  pass = '',
  helo = '',
  from,
  to,
  subject,
  text,
  rejectUnauthorized = true,
  debug = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const sender = safeAddress(from, '发件人')
  const recipient = safeAddress(to, '收件人')
  let socket = await openSocket({ host, port, secure, rejectUnauthorized, timeoutMs })
  let reader = createReader(socket)
  const deadline = setTimeout(() => socket.destroy(new Error('SMTP 投递超时')), timeoutMs)

  try {
    expect(await reader.read(), [220], '握手', debug)

    const ehloName = helo || sender.split('@')[1] || 'localhost'
    await write(socket, `EHLO ${ehloName}\r\n`, debug)
    let caps = parseCapabilities(expect(await reader.read(), [250], 'EHLO', debug).text)

    // 587 端口：先 EHLO，再 STARTTLS，升级后必须重新 EHLO。
    if (starttls && !secure) {
      if (!caps.starttls) throw new Error('服务器未提供 STARTTLS')
      await write(socket, 'STARTTLS\r\n', debug)
      expect(await reader.read(), [220], 'STARTTLS', debug)
      reader.detach()
      socket = tlsConnect({ socket, servername: host, rejectUnauthorized })
      reader = createReader(socket)
      await new Promise((resolve, reject) => {
        socket.once('secureConnect', resolve)
        socket.once('error', reject)
      })
      await write(socket, `EHLO ${ehloName}\r\n`, debug)
      caps = parseCapabilities(expect(await reader.read(), [250], 'EHLO(SSL)', debug).text)
    }

    if (user) {
      // 优先 AUTH PLAIN，其次 AUTH LOGIN；两者都是 base64，不涉及加密以外的处理。
      if (caps.auth.includes('PLAIN')) {
        await write(socket, `AUTH PLAIN ${b64(`\0${user}\0${pass}`)}\r\n`, debug, 'AUTH PLAIN [已隐藏]')
        expect(await reader.read(), [235], 'AUTH PLAIN', debug)
      } else {
        await write(socket, 'AUTH LOGIN\r\n', debug)
        expect(await reader.read(), [334], 'AUTH LOGIN', debug)
        await write(socket, `${b64(user)}\r\n`, debug, '[SMTP 用户名已隐藏]')
        expect(await reader.read(), [334], 'AUTH 用户名', debug)
        await write(socket, `${b64(pass)}\r\n`, debug, '[SMTP 密码已隐藏]')
        expect(await reader.read(), [235], 'AUTH 密码', debug)
      }
    }

    await write(socket, `MAIL FROM:<${sender}>\r\n`, debug)
    expect(await reader.read(), [250], 'MAIL FROM', debug)

    await write(socket, `RCPT TO:<${recipient}>\r\n`, debug)
    expect(await reader.read(), [250, 251], 'RCPT TO', debug)

    await write(socket, 'DATA\r\n', debug)
    expect(await reader.read(), [354], 'DATA', debug)

    const headers = [
      `From: ${encodeHeader('深海鱼市')} <${sender}>`,
      `To: <${recipient}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${ehloName}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      `Date: ${new Date().toUTCString()}`,
      '',
    ].join('\r\n')
    // 只对正文做 dot-stuffing：以 "." 开头的行前面补一个点。
    // 结束符 "." 必须单独一行且不能被转义，所以要放在转义之后拼接。
    const body = encodeBody(text).replace(/^\./gm, '..')
    await write(socket, `${headers}\r\n${body}\r\n.\r\n`, debug, '[邮件内容已隐藏]')
    expect(await reader.read(), [250], 'DATA 结束', debug)

    if (debug) console.error('C: QUIT')
    socket.end('QUIT\r\n', () => socket.destroy())
    return { ok: true }
  } catch (error) {
    socket.destroy()
    throw error
  } finally {
    clearTimeout(deadline)
  }
}

// 邮件配置从环境变量读；没配 SMTP_HOST 时返回 null，调用方降级成「把验证码写日志」。
export function mailConfigFromEnv(env = process.env) {
  const host = String(env.SMTP_HOST || '').trim()
  if (!host) return null
  const port = Number(env.SMTP_PORT) || 1025
  const user = String(env.SMTP_USER || '').trim()
  const pass = String(env.SMTP_PASS || '')
  // 没显式指定时按端口推断：465 = 隐式 TLS，其它保持明文（本地 Mailpit）。
  const mode = String(env.SMTP_SECURE || '').trim().toLowerCase()
  const secure = mode ? mode === 'ssl' || mode === 'true' : port === 465
  const starttls = mode === 'starttls' || (!mode && port === 587)
  return {
    host,
    port,
    secure,
    starttls,
    user,
    pass,
    // 没填发件人就用认证账号：QQ / 163 都要求 From 与登录账号一致。
    from: String(env.SMTP_FROM || user || 'no-reply@fishmarket.local').trim(),
    helo: String(env.SMTP_HELO || '').trim(),
    rejectUnauthorized: env.SMTP_TLS_INSECURE !== '1',
  }
}

// 重置进度的验证码。和绑定邮箱的验证码分开写，避免玩家把两种码搞混。
export function resetProgressMail({ username, code, minutes }) {
  return {
    subject: `深海鱼市 · 重置进度验证码 ${code}`,
    text: [
      `${username}，你好：`,
      '',
      `你正在重置游戏进度。验证码是：${code}`,
      '',
      `${minutes} 分钟内有效，且只能使用一次。重置会清空鱼、票、钓竿与材料，账号与设置保留。`,
      '如果不是你本人操作，请立即修改密码，并忽略这封邮件。',
      '',
      '—— 深海鱼市',
    ].join('\n'),
  }
}

// 验证码邮件正文。纯文本，够用且不会有 HTML 渲染差异。
export function verificationMail({ username, code, minutes }) {
  return {
    subject: `深海鱼市 · 邮箱验证码 ${code}`,
    text: [
      `${username}，你好：`,
      '',
      `你的邮箱验证码是：${code}`,
      '',
      `${minutes} 分钟内有效，且只能使用一次。`,
      '如果不是你本人操作，忽略这封邮件即可，你的账号没有任何变化。',
      '',
      '—— 深海鱼市',
    ].join('\n'),
  }
}
