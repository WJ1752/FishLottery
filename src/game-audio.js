const STORAGE_KEY = 'fishlottery.sound'
const TAU = Math.PI * 2

const tone = (start, duration, pitch, level, endPitch = pitch) => ({ start, duration, pitch, endPitch, level })
const click = (start, duration, level) => ({ start, duration, level })

const FISH_LANDING = {
  tones: [tone(0, 0.14, 285, 0.17, 118), tone(0.054, 0.105, 465, 0.09, 218)],
  spray: [click(0, 0.15, 0.23), click(0.064, 0.065, 0.1)],
}

// 用短音效区分水花、鱼线、机械和铃声，音频在浏览器内合成。
const CUES = {
  'sound-preview': {
    tones: [tone(0, 0.15, 440, 0.2), tone(0.07, 0.17, 587, 0.16)],
  },
  'fishing-bite': {
    tones: [tone(0.008, 0.072, 760, 0.13, 410), tone(0.044, 0.056, 610, 0.085, 335)],
    spray: [click(0, 0.07, 0.17)],
  },
  'fishing-landed': FISH_LANDING,
  'fishing-escape': {
    tones: [tone(0, 0.073, 295, 0.14, 580), tone(0.057, 0.15, 430, 0.13, 115)],
    clicks: [click(0.049, 0.035, 0.22)],
  },
  'fishing-discovery': {
    tones: [
      ...FISH_LANDING.tones,
      tone(0.13, 0.24, 523.25, 0.13),
      tone(0.235, 0.24, 659.25, 0.12),
      tone(0.35, 0.38, 783.99, 0.13),
    ],
    spray: FISH_LANDING.spray,
  },
  'ticket-print': {
    tones: [tone(0, 0.085, 153, 0.19, 102), tone(0.068, 0.14, 392, 0.15)],
    clicks: [click(0, 0.042, 0.26), click(0.068, 0.04, 0.16)],
  },
  'lottery-draw': {
    tones: [tone(0, 0.08, 294, 0.15), tone(0.09, 0.08, 370, 0.15), tone(0.18, 0.19, 494, 0.19)],
    clicks: [click(0, 0.035, 0.15), click(0.09, 0.03, 0.14), click(0.18, 0.04, 0.16)],
  },
  'lottery-claim': {
    tones: [tone(0, 0.18, 392, 0.21), tone(0.071, 0.21, 494, 0.18), tone(0.148, 0.29, 659, 0.18)],
  },
  'fx-buy': {
    tones: [tone(0, 0.08, 330, 0.18), tone(0.043, 0.14, 495, 0.2)],
    clicks: [click(0, 0.035, 0.14)],
  },
  'fx-sell': {
    tones: [tone(0, 0.083, 495, 0.17), tone(0.047, 0.14, 311, 0.21)],
    clicks: [click(0, 0.035, 0.12)],
  },
  'fx-order': {
    tones: [tone(0, 0.055, 225, 0.13), tone(0.058, 0.095, 353, 0.16)],
    clicks: [click(0, 0.029, 0.2), click(0.058, 0.028, 0.16)],
  },
  'fx-cancel': {
    tones: [tone(0, 0.14, 330, 0.19, 190)],
    clicks: [click(0, 0.05, 0.18)],
  },
}

let soundEnabled
let context
let resuming = false
let pendingCue = null
let activeCue = null
const buffers = new Map()

export function getGameSoundEnabled() {
  if (soundEnabled === undefined) {
    try { soundEnabled = globalThis.localStorage?.getItem(STORAGE_KEY) === '1' }
    catch { soundEnabled = false }
  }
  return soundEnabled
}

function stopActiveCue() {
  const source = activeCue
  activeCue = null
  if (!source) return
  source.onended = null
  try { source.stop() } catch { /* 可能刚刚播完 */ }
  source.disconnect()
}

export function setGameSoundEnabled(enabled) {
  soundEnabled = Boolean(enabled)
  try { globalThis.localStorage?.setItem(STORAGE_KEY, soundEnabled ? '1' : '0') }
  catch { /* 隐私模式下在当前页保留设置 */ }
  if (!soundEnabled) {
    pendingCue = null
    stopActiveCue()
  }
  return soundEnabled
}

function resumeFinished(target, succeeded) {
  if (context !== target) return
  resuming = false
  const name = pendingCue
  pendingCue = null
  if (name && succeeded) playGameCue(name)
}

// 要在按钮的点击或键盘操作中调用，浏览器才允许打开音频设备。
export function primeGameAudio() {
  if (!getGameSoundEnabled() || globalThis.document?.hidden) return
  try {
    if (!context || context.state === 'closed') {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext
      if (!Audio) return
      context = new Audio()
      buffers.clear()
      resuming = false
    }
    if (context.state === 'running' || resuming) return
    const target = context
    resuming = true
    Promise.resolve(target.resume()).then(
      () => resumeFinished(target, true),
      () => resumeFinished(target, false),
    )
  } catch {
    // 浏览器可能禁止或无法开启音频。游戏操作照常完成。
    resuming = false
    pendingCue = null
  }
}

function mix(samples, sampleRate, segment, wave) {
  const start = Math.round(segment.start * sampleRate)
  const count = Math.ceil(segment.duration * sampleRate)
  for (let index = 0; index < count && start + index < samples.length; index += 1) {
    const time = index / sampleRate
    const progress = index / count
    const envelope = Math.min(1, time / 0.006) * (1 - progress) ** 2
    samples[start + index] += wave(time, progress) * envelope * segment.level
  }
}

function getCueBuffer(name) {
  const cached = buffers.get(name)
  if (cached) return cached

  const { tones, clicks = [], spray = [] } = CUES[name]
  const sampleRate = context.sampleRate
  const duration = Math.max(...[...tones, ...clicks, ...spray].map((part) => part.start + part.duration))
  const buffer = context.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate)
  const samples = buffer.getChannelData(0)

  for (const part of tones) {
    mix(samples, sampleRate, part, (time, progress) => {
      const phase = TAU * time * (part.pitch + (part.endPitch - part.pitch) * progress / 2)
      return Math.sin(phase) * 0.82 + Math.sin(phase * 2) * 0.13 + Math.sin(phase * 3) * 0.05
    })
  }
  let seed = 703
  const noiseSample = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 31 - 1
  }
  let filtered = 0
  for (const part of clicks) {
    mix(samples, sampleRate, part, () => {
      const noise = noiseSample()
      filtered = 0.72 * filtered + 0.28 * noise
      return (noise - filtered) * 0.42
    })
  }
  for (const part of spray) {
    let texture = 0
    let drift = 0
    mix(samples, sampleRate, part, () => {
      texture = 0.65 * texture + 0.35 * noiseSample()
      drift = 0.94 * drift + 0.06 * texture
      return (texture - drift) * 0.7
    })
  }
  buffers.set(name, buffer)
  return buffer
}

export function playGameCue(name) {
  if (!Object.hasOwn(CUES, name) || !getGameSoundEnabled() || globalThis.document?.hidden) return
  if (context?.state !== 'running') {
    // 只保留最近一个事件，且仅等待已经由用户操作启动的音频。
    if (resuming) pendingCue = name
    return
  }
  try {
    stopActiveCue()
    const source = context.createBufferSource()
    source.buffer = getCueBuffer(name)
    source.onended = () => {
      if (activeCue === source) activeCue = null
      source.disconnect()
    }
    source.connect(context.destination)
    activeCue = source
    source.start()
  } catch {
    stopActiveCue()
  }
}
