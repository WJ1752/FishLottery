import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// 本机非回环 IPv4：自签名证书的 SAN 要带上它，局域网里的其它机器才不会额外报错。
export function localAddresses() {
  const out = new Set(['127.0.0.1'])
  Object.values(networkInterfaces()).forEach((list) => {
    ;(list || []).forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) out.add(entry.address)
    })
  })
  return [...out]
}

export function ensureCertificate({ certPath, keyPath, certDir, force = false, allowGenerate = true }) {
  const cert = resolve(certPath)
  const key = resolve(keyPath)
  if (!force && existsSync(cert) && existsSync(key)) {
    return { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8'), certPath: cert, keyPath: key, generated: false }
  }
  if (!allowGenerate || (!force && (existsSync(cert) || existsSync(key)))) {
    throw new Error('TLS 证书与私钥必须同时存在，请检查 TLS_CERT 与 TLS_KEY')
  }
  mkdirSync(dirname(cert), { recursive: true })
  mkdirSync(dirname(key), { recursive: true })
  mkdirSync(certDir || dirname(cert), { recursive: true })

  const sanEntries = ['DNS:localhost', ...localAddresses().map((ip) => `IP:${ip}`)]
  const args = [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert,
    '-days', '825',
    '-subj', '/CN=localhost/O=Deepwater Fish Market',
    '-addext', `subjectAltName=${sanEntries.join(',')}`,
    '-addext', 'basicConstraints=critical,CA:FALSE',
    '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
    '-addext', 'extendedKeyUsage=serverAuth',
  ]

  generateCertificate(args)

  const info = {
    cert: readFileSync(cert, 'utf8'),
    key: readFileSync(key, 'utf8'),
    certPath: cert,
    keyPath: key,
    generated: true,
    san: sanEntries,
  }
  writeFileSync(join(certDir || dirname(cert), 'san.txt'), `${sanEntries.join('\n')}\n`)
  return info
}

function generateCertificate(args) {
  // Git for Windows 可用的原生版本优先于需要 MSYS 环境的版本。
  const candidates = [
    'C:/Program Files/Git/mingw64/bin/openssl.exe',
    'C:/Program Files/Git/usr/bin/openssl.exe',
    'C:/Program Files (x86)/Git/mingw32/bin/openssl.exe',
    'C:/Program Files (x86)/Git/usr/bin/openssl.exe',
  ]
  let cause
  for (const command of ['openssl', ...candidates.filter((path) => existsSync(path))]) {
    try {
      execFileSync(command, args, { stdio: 'ignore' })
      return
    } catch (error) {
      cause ??= error
    }
  }
  throw new Error('无法生成自签名证书。请安装 OpenSSL 或提供 TLS_CERT 与 TLS_KEY。', { cause })
}
