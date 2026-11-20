// 服务器时钟：所有结算时间点都由这里给出，测试可注入固定时钟。
// 注入值可以是数字（固定时刻）或函数（随时间推进），now() 两种都支持。
let override = null

export function now() {
  if (override === null) return Date.now()
  return typeof override === 'function' ? Number(override()) : Number(override)
}

export function setClock(value) {
  override = value === null || value === undefined ? null : value
}

export function resetClock() {
  override = null
}

// 目标时间点推迟到「下一个整分钟」，让分钟级行情与开奖倒计时对齐。
export const minuteFloor = (ms) => Math.floor(ms / 60000) * 60000
