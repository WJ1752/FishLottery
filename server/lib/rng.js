import { randomBytes } from 'node:crypto'

// 服务端随机源：包装 crypto.randomBytes，供领域函数注入。
// 领域代码只依赖 random() → [0,1)，所以这里返回等价的均匀分布。
// readUIntBE 最多支持 6 字节，2^48 的分辨率远高于领域逻辑所需（权重都是整数）。
export function cryptoRandom() {
  const buffer = randomBytes(6)
  return buffer.readUIntBE(0, 6) / 2 ** 48
}

export const randomId = (bytes = 16) => randomBytes(bytes).toString('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
