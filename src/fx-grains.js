// 深海FX 的 K 线档位定义 —— 客户端与服务端共用，但**不含任何算法**。
//
// 这里只有「有哪些档位、叫什么、要几分钟、需不需要解锁」这类配置信息。
// 蜡烛怎么算（fxMinutePath / fxDayMove / fxBridge …）全部留在服务端，
// 客户端只负责把算好的结果画出来，源码里不出现任何价格公式。
//
// 档位从上到下由粗到细：默认开放 120 分与 60 分，30 分与 15 分要在黑市
// 用渔币解锁。日K 与 5 分已下线（日K 由后台单独使用，5 分精度收益低且数据量大）。

export const FX_GRAINS = [
  { id: 'm120', label: '120分', minutes: 120, unlock: null },
  { id: 'm60', label: '60分', minutes: 60, unlock: null },
  { id: 'm30', label: '30分', minutes: 30, unlock: { shopItem: 'grain-m30' } },
  { id: 'm15', label: '15分', minutes: 15, unlock: { shopItem: 'grain-m15' } },
]

export const FX_GRAIN_BY_ID = FX_GRAINS.reduce((map, grain) => ({ ...map, [grain.id]: grain }), {})

export const FX_DEFAULT_GRAIN = 'm60'

// 某个档位是否需要解锁、对应的黑市商品是什么。
export function fxGrainLock(grainId) {
  return FX_GRAIN_BY_ID[grainId]?.unlock || null
}

// 玩家锁上的档位列表（用于界面把按钮画成「锁定」）。
export function fxLockedGrains(purchases = {}) {
  return FX_GRAINS
    .filter((grain) => grain.unlock && !(Number(purchases?.[grain.unlock.shopItem]) > 0))
    .map((grain) => grain.id)
}

// 蜡烛的时间轴标签。只是日期格式化，不含任何价格逻辑。
export function fxGrainLabel(grainId) {
  return (bar) => {
    const at = Number(bar?.at) || 0
    if (!at) return ''
    const day = new Date(at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    const time = new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    return `${day} ${time}`
  }
}

// 蜡烛序列的紧凑传输格式：对象数组在 15 分粒度下会膨胀 2 倍，
// 用「列名 + 行数组」能省掉每根重复的键名。
export function encodeCandleRows(bars) {
  return {
    cols: ['at', 'open', 'high', 'low', 'close', 'volume', 'settled', 'projected', 'running'],
    rows: (Array.isArray(bars) ? bars : []).map((bar) => [
      Number(bar.at) || 0,
      Number(bar.open) || 0,
      Number(bar.high) || 0,
      Number(bar.low) || 0,
      Number(bar.close) || 0,
      Math.round((Number(bar.volume) || 0) * 100) / 100,
      bar.settled === false ? 0 : 1,
      bar.projected ? 1 : 0,
      // running：这一格还在走（真实成交，只是没走完）；projected：未来推演。
      bar.running ? 1 : 0,
    ]),
  }
}

export function decodeCandleRows(payload) {
  if (!payload || !Array.isArray(payload.rows)) return []
  return payload.rows.map((row, index) => ({
    key: `c${index}`,
    at: Number(row[0]) || 0,
    open: Number(row[1]) || 0,
    high: Number(row[2]) || 0,
    low: Number(row[3]) || 0,
    close: Number(row[4]) || 0,
    volume: Number(row[5]) || 0,
    settled: Number(row[6]) !== 0,
    projected: Number(row[7]) !== 0,
    running: Number(row[8]) !== 0,
    move: Number(row[1]) > 0 ? (Number(row[4]) || 0) / Number(row[1]) - 1 : 0,
  }))
}
