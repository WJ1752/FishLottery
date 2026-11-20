import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { hashToken } from './passwords.js'

// RFC 6238 TOTP：SHA-1 / 30 秒 / 6 位，与 Google Authenticator、Microsoft Authenticator 兼容。
export const TOTP_PERIOD = 30
export const TOTP_DIGITS = 6
export const TOTP_WINDOW = 1 // ±1 个步长，容忍客户端时钟偏差

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes = []
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// 生成新密钥：160 位，标准推荐长度。
export function generateTotpSecret() {
  return base32Encode(randomBytes(20))
}

export const totpStep = (atMs = Date.now()) => Math.floor(Number(atMs) / 1000 / TOTP_PERIOD)

export function totpCode(secret, step) {
  const key = base32Decode(secret)
  if (!key.length) return ''
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

// 校验并返回命中的步长（用于防重放）；失败返回 null。
export function verifyTotp(secret, code, atMs = Date.now(), window = TOTP_WINDOW) {
  const input = String(code || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(input)) return null
  const current = totpStep(atMs)
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset
    const expected = totpCode(secret, step)
    if (expected.length === input.length
      && timingSafeEqual(Buffer.from(expected), Buffer.from(input))) {
      return step
    }
  }
  return null
}

export function otpauthUri({ secret, account, issuer = '深海鱼市' }) {
  const label = `${issuer}:${account}`
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD) })
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}

// 恢复码：8 组，形如 ABCD-EFGH，明文只返回一次，库里只存哈希。
export function generateRecoveryCodes(count = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const codes = []
  for (let i = 0; i < count; i += 1) {
    const chars = [...randomBytes(8)].map((byte) => alphabet[byte % alphabet.length])
    codes.push(`${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`)
  }
  return codes
}

export const normalizeRecoveryCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const recoveryCodeHash = (code) => hashToken(normalizeRecoveryCode(code))
