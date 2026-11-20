#!/usr/bin/env node
// 生成 / 检查自签名证书。
// 默认输出到 certs/server.crt 与 certs/server.key，SAN 覆盖 localhost、127.0.0.1 与本机局域网 IP。
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureCertificate, localAddresses } from '../server/lib/tls.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const certPath = process.env.TLS_CERT || resolve(ROOT, 'certs', 'server.crt')
const keyPath = process.env.TLS_KEY || resolve(ROOT, 'certs', 'server.key')
const force = process.argv.includes('--force')

const info = ensureCertificate({ certPath, keyPath, certDir: resolve(ROOT, 'certs'), force })
console.log(info.generated ? '已生成自签名证书。' : '证书已存在，直接复用（加 --force 重新生成）。')
console.log(`  证书：${info.certPath}`)
console.log(`  私钥：${info.keyPath}`)
console.log(`  地址：${(info.san || localAddresses().map((ip) => `IP:${ip}`)).join(', ')}`)
console.log('')
console.log('浏览器首次访问会提示证书不受信任，需要手动信任一次：')
console.log('  - 本机：打开 https://localhost:9000 → 高级 → 继续前往')
console.log('  - 局域网：把 certs/server.crt 装进「受信任的根证书颁发机构」')
