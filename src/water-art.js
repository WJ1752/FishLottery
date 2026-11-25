export const WATER_WIDTH = 568
export const WATER_HEIGHT = 254
export const BOBBER_X = 369
export const BOBBER_Y = 169
const W = WATER_WIDTH
const H = WATER_HEIGHT

// 水色按由浅到深的图层排列。相同栈桥保留操作方位，地形随当前海域改变。
const WATER_PALETTES = {
  shore: ['#587f68', '#46755e', '#3b6b58', '#69896b', '#7d9b76'],
  shelf: ['#29635c', '#22564f', '#20514e', '#316b5e', '#417967'],
  open: ['#3b696d', '#345d63', '#2d515a', '#477a77', '#588582'],
  deep: ['#2d515e', '#233b50', '#1d3044', '#365d66', '#426b70'],
  rift: ['#414b65', '#31324f', '#282740', '#4a5569', '#5b6575'],
  abyss: ['#243b41', '#192a33', '#121f2b', '#2a4549', '#355254'],
}

function randomFrom(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) | 0
    return (seed >>> 0) / 4294967296
  }
}

function polygon(ctx, fill, points) {
  ctx.beginPath()
  ctx.moveTo(...points[0])
  for (const point of points.slice(1)) ctx.lineTo(...point)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

function line(ctx, color, points, width = 1) {
  ctx.beginPath()
  ctx.moveTo(...points[0])
  for (const point of points.slice(1)) ctx.lineTo(...point)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function blocks(ctx, color, rectangles) {
  ctx.fillStyle = color
  for (const rect of rectangles) ctx.fillRect(...rect)
}

export function createSeaBase(location) {
  const stageBase = document.createElement('canvas')
  stageBase.width = W
  stageBase.height = H
  const base = stageBase.getContext('2d')
  if (!base) return null

  function rock(x, y, size, bright = false) {
    base.save()
    base.translate(x, y)
    base.scale(size, size)
    polygon(base, '#274f49', [[-1, 5], [5, 1], [16, 1], [27, 8], [30, 16], [18, 22], [3, 20], [-4, 16]])
    polygon(base, bright ? '#806e58' : '#596555', [[-1, 7], [5, 3], [9, -2], [17, -3], [25, 3], [27, 10], [19, 16], [4, 16], [-3, 12]])
    polygon(base, bright ? '#a28a69' : '#7b8065', [[3, 5], [10, -2], [17, -3], [24, 3], [20, 8], [10, 9], [6, 12], [-1, 10]])
    polygon(base, '#404f45', [[21, 8], [27, 9], [25, 14], [19, 17], [8, 16], [11, 12], [15, 12]])
    line(base, bright ? '#baa27f' : '#9a9877', [[5, 4], [10, 0], [16, 0], [19, 2]], .9)
    blocks(base, '#626752', [[5, 12, 4, 1], [13, 3, 2, 1], [18, 5, 3, 1]])
    base.restore()
  }

  function tuft(x, y, variant) {
    blocks(base, '#364739', [[x - 2, y, 8, 3], [x, y - 4, 4, 6], [x + 5, y - 2, 2, 4]])
    blocks(base, variant ? '#75845a' : '#606c4b', [[x, y - 3, 2, 3], [x + 4, y - 2, 2, 3], [x - 1, y, 4, 1]])
  }

  function post(x, y) {
    polygon(base, '#152f2b80', [[x - 1, y], [x + 4, y - 2], [x + 11, y + 5], [x + 5, y + 8], [x, y + 6]])
    blocks(base, '#3b3b2d', [[x - 1, y - 6, 5, 10]])
    blocks(base, '#a78d62', [[x - 2, y - 8, 6, 3], [x - 2, y - 4, 1, 5]])
    blocks(base, '#ccab71', [[x - 1, y - 7, 4, 1]])
  }

  function box(x, y) {
    blocks(base, '#3b3a2d90', [[x + 3, y + 5, 17, 12]])
    blocks(base, '#67513a', [[x, y + 2, 16, 12]])
    blocks(base, '#ad8a55', [[x, y, 15, 9]])
    blocks(base, '#857049', [[x + 1, y + 2, 13, 1], [x + 1, y + 6, 13, 1]])
    blocks(base, '#d7ad69', [[x + 1, y + 1, 13, 1], [x + 1, y + 7, 13, 1]])
  }

  function deckSegment(left, top, width, height, vertical, salt) {
    const rand = randomFrom(salt)
    blocks(base, '#163a34a0', [[left + 6, top + 7, width, height + 4]])
    blocks(base, '#544835', [[left, top + 1, width, height + 4]])
    const count = vertical ? height : width
    const planks = ['#8d7551', '#aa8e61', '#907b54', '#b09061', '#a48558', '#917651']
    for (let i = 1; i < count - 1; i += 6) {
      const tone = planks[Math.floor(rand() * planks.length)]
      const length = Math.min(5, count - i - 1)
      if (vertical) {
        blocks(base, tone, [[left + 1, top + i, width - 2, length]])
        blocks(base, '#cfb18565', [[left + 2, top + i, width - 4, 1]])
        blocks(base, '#584c365a', [[left + 3 + Math.floor(rand() * (width - 13)), top + i + 2, 6, 1]])
      } else {
        blocks(base, tone, [[left + i, top + 1, length, height - 2]])
        blocks(base, '#e8c78b4f', [[left + i, top + 3, 1, height - 6]])
        blocks(base, '#513f325a', [[left + i + 2, top + 4 + Math.floor(rand() * (height - 11)), 1, 5]])
      }
    }
    if (vertical) blocks(base, '#bc9a65', [[left, top + 1, 2, height - 2], [left + width - 2, top + 1, 2, height - 2]])
    else blocks(base, '#bc9a65', [[left + 1, top, width - 2, 2], [left + 1, top + height - 3, width - 2, 2]])
  }

  function shed(x, y) {
    base.save()
    base.translate(x, y)
    polygon(base, '#243e2e85', [[0, 6], [47, 6], [54, 46], [40, 53], [-5, 53], [-5, 32]])
    blocks(base, '#544b37', [[4, 21, 40, 27]])
    blocks(base, '#b0895b', [[7, 23, 35, 22]])
    for (let i = 0; i < 5; i += 1) blocks(base, '#896c4c', [[8, 25 + i * 4, 33, 1]])
    blocks(base, '#594935', [[12, 29, 12, 16], [31, 27, 8, 9]])
    blocks(base, '#dac27c', [[32, 28, 6, 7]])
    blocks(base, '#f2d994', [[33, 29, 2, 3]])
    polygon(base, '#4b4432', [[-1, 25], [13, -3], [40, -3], [53, 25], [51, 28], [-1, 28]])
    polygon(base, '#934d3f', [[1, 23], [14, -4], [40, -4], [51, 23], [46, 25], [1, 25]])
    polygon(base, '#b4684d', [[15, -5], [37, -5], [28, 23], [2, 23]])
    for (let i = 0; i < 6; i += 1) line(base, '#713f3680', [[13 - i * 2, i * 4], [41 + i * 2, i * 4]])
    line(base, '#d38a63', [[0, 24], [48, 24], [51, 22]])
    blocks(base, '#756455', [[30, -12, 7, 13], [29, -13, 9, 3]])
    blocks(base, '#4d4c43', [[31, -13, 6, 2]])
    blocks(base, '#be9c64', [[9, 45, 19, 3], [7, 48, 23, 2]])
    base.restore()
  }

  function mooredBoat(x, y, canvas) {
    canvas.save()
    canvas.translate(x, y)
    polygon(canvas, '#326d63', [[-7, 11], [9, 3], [46, 1], [68, 8], [52, 22], [15, 23], [0, 17]])
    polygon(canvas, '#234d43', [[-1, 7], [10, -1], [46, -1], [63, 8], [49, 19], [13, 20], [1, 16]])
    polygon(canvas, '#bfac73', [[0, 5], [10, -4], [45, -4], [60, 5], [47, 16], [12, 17], [1, 12]])
    polygon(canvas, '#987a50', [[5, 5], [13, -1], [43, -1], [55, 5], [45, 13], [13, 14], [5, 10]])
    polygon(canvas, '#d7c38d', [[14, -1], [18, 1], [17, 13], [13, 14]])
    polygon(canvas, '#b25e46', [[36, -1], [44, 0], [47, 12], [40, 14], [34, 12]])
    blocks(canvas, '#5a5741', [[24, 4, 8, 7], [10, 4, 4, 4]])
    line(canvas, '#e4cc92', [[2, 10], [11, 15], [47, 14], [58, 6]])
    line(canvas, '#2d4940', [[8, 6], [0, 15], [-11, 22]])
    blocks(canvas, '#7f7352', [[-11, 20, 3, 5]])
    canvas.restore()
  }

  const shoreOutline = [[0, 0], [158, 0], [164, 12], [151, 21], [163, 33], [152, 41], [153, 57], [132, 66], [127, 81], [111, 89], [108, 104], [95, 114], [99, 129], [82, 138], [78, 148], [65, 155], [65, 175], [50, 186], [51, 202], [39, 217], [47, 232], [40, 254], [0, 254]]

  function beacon(x, y) {
    blocks(base, '#17323c', [[x - 5, y + 5, 14, 3], [x - 2, y - 11, 6, 15]])
    blocks(base, '#d39068', [[x - 2, y - 8, 5, 8]])
    blocks(base, '#a54538', [[x - 4, y - 12, 9, 3], [x - 5, y + 1, 11, 4]])
    blocks(base, '#f2d8a0', [[x - 1, y - 9, 3, 3]])
    line(base, '#a6c1a270', [[x - 12, y + 8], [x - 5, y + 10], [x + 8, y + 10], [x + 13, y + 8]])
  }

  function reeds(x, y) {
    blocks(base, '#345b46', [[x - 3, y, 11, 2], [x, y - 7, 1, 8], [x + 4, y - 10, 1, 11], [x + 7, y - 6, 1, 7]])
    blocks(base, '#b4aa74', [[x, y - 9, 2, 4], [x + 4, y - 11, 2, 4], [x + 7, y - 7, 2, 3]])
  }

  function habitat(location, rand) {
    if (location === 'shore') {
      const shoal = [[285, 207], [306, 192], [324, 195], [338, 185], [359, 194], [356, 208], [396, 220], [434, 254], [282, 254], [298, 236]]
      polygon(base, '#87936d', shoal)
      polygon(base, '#a7a47a', [[290, 254], [305, 233], [294, 216], [313, 202], [332, 204], [345, 196], [350, 209], [378, 217], [401, 236], [427, 254]])
      for (const [x, y] of [[303, 230], [309, 218], [326, 203], [345, 200], [370, 225], [398, 242], [317, 248], [305, 245]]) reeds(x, y)
      mooredBoat(418, 74, base)
    }
    if (location === 'shelf') {
      mooredBoat(454, 70, base)
      mooredBoat(154, 217, base)
    }
    if (location === 'open') {
      for (const [x, y, size] of [[293, 84, .9], [308, 65, 1.45], [348, 72, .9], [336, 91, .6], [319, 101, .75], [390, 67, 1.1], [413, 77, .75], [459, 206, 1.35], [480, 195, .8], [436, 224, .93]]) rock(x, y, size, true)
      beacon(344, 69)
      line(base, '#c1cfb38c', [[279, 105], [309, 118], [347, 111], [384, 90], [420, 94]])
    }
    if (location === 'deep') {
      polygon(base, '#607b7c', [[405, 0], [432, 21], [414, 53], [420, 82], [397, 109], [405, 137], [384, 186], [380, 254], [568, 254], [568, 0]])
      polygon(base, '#263c51', [[426, 0], [450, 26], [433, 57], [438, 84], [419, 114], [424, 141], [404, 191], [404, 254], [568, 254], [568, 0]])
      line(base, '#78918b', [[405, 0], [432, 21], [414, 53], [420, 82], [397, 109], [405, 137], [384, 186], [380, 254]])
      beacon(393, 205)
      mooredBoat(303, 71, base)
    }
    if (location === 'rift') {
      const fracture = [[299, 0], [321, 32], [286, 63], [316, 80], [369, 85], [382, 111], [428, 121], [441, 153], [487, 172], [458, 207], [500, 254]]
      line(base, '#6f7087', fracture, 16)
      line(base, '#25263d', fracture, 11)
      line(base, '#a298b9', fracture, 1.2)
      beacon(346, 102)
    }
    if (location === 'abyss') {
      polygon(base, '#152c34', [[270, 39], [308, 15], [374, 26], [407, 61], [394, 105], [349, 129], [296, 107], [276, 83]])
      polygon(base, '#101e2b', [[287, 47], [314, 29], [368, 40], [391, 63], [381, 95], [344, 114], [308, 98], [289, 80]])
      for (let i = 0; i < 36; i += 1) {
        const x = Math.floor(287 + rand() * 149)
        const y = Math.floor(30 + rand() * 99)
        blocks(base, i % 3 ? '#6b9b9480' : '#a3cbb5', [[x, y, 2, 1]])
      }
      beacon(308, 217)
      beacon(424, 103)
    }
  }

  function seaBase(location) {
    const [sea, deepWater, farWater, nearWater, shallowWater] = WATER_PALETTES[location] || WATER_PALETTES.shore
    const rand = randomFrom(location === 'shelf' ? 192413 : 47323)
    blocks(base, sea, [[0, 0, W, H]])
    polygon(base, deepWater, [[271, 0], [568, 0], [568, 254], [351, 254], [347, 238], [310, 216], [314, 185], [282, 175], [291, 152], [259, 121], [269, 95], [236, 71], [243, 45], [229, 30]])
    polygon(base, farWater, [[480, 0], [568, 0], [568, 254], [410, 254], [428, 235], [438, 211], [421, 194], [439, 175], [435, 145], [458, 113], [446, 94], [482, 73], [469, 44]])
    polygon(base, nearWater, [[0, 0], [232, 0], [222, 16], [232, 36], [204, 49], [211, 62], [180, 79], [183, 103], [148, 119], [153, 142], [135, 156], [139, 183], [114, 194], [118, 223], [107, 254], [0, 254]])
    polygon(base, shallowWater, [[0, 0], [189, 0], [180, 20], [192, 36], [171, 52], [178, 70], [149, 86], [143, 102], [121, 119], [127, 135], [108, 157], [101, 167], [105, 186], [85, 200], [91, 223], [78, 254], [0, 254]])

    const flecks = ['#66a18c43', '#7fb4a153', '#184b473f', '#b0c9a543', '#224c4538', '#81ad905e']
    for (let i = 0; i < 1460; i += 1) {
      const y = Math.floor(rand() * H)
      const x = Math.floor(rand() * W)
      const width = rand() < .14 ? Math.floor(8 + rand() * 11) : Math.floor(1 + rand() * 4)
      blocks(base, flecks[Math.floor(rand() * flecks.length)], [[x, y, width, 1]])
    }
    for (let i = 0; i < 102; i += 1) {
      const x = Math.floor(rand() * W)
      const y = Math.floor(5 + rand() * (H - 8))
      const width = Math.floor(7 + rand() * 23)
      const pale = x < 240 ? '#93bb9577' : '#78aa9066'
      blocks(base, pale, [[x, y, width, 1], [x + width + 2, y + 1, Math.ceil(width / 3), 1]])
      if (i % 4 === 0) blocks(base, '#143f3b65', [[x - 2, y + 3, width + 3, 1]])
    }

    const surf = shoreOutline.map(([x, y]) => [x === 0 ? 0 : x + 11, y])
    const sand = shoreOutline.map(([x, y]) => [x === 0 ? 0 : x + 4, y])
    polygon(base, '#549180', surf)
    polygon(base, '#71816a', sand)
    polygon(base, '#ad9d72', shoreOutline)
    const uplands = [[0, 0], [123, 0], [132, 12], [114, 25], [121, 34], [108, 50], [106, 61], [83, 72], [85, 86], [72, 94], [74, 113], [54, 126], [52, 154], [39, 169], [37, 186], [28, 203], [32, 221], [24, 234], [25, 254], [0, 254]]
    polygon(base, '#6c7654', uplands)
    polygon(base, '#505f42', [[0, 0], [91, 0], [103, 10], [76, 26], [81, 45], [65, 69], [46, 77], [45, 95], [31, 103], [31, 127], [21, 148], [22, 170], [0, 176]])
    polygon(base, '#7f8057', [[31, 2], [82, 2], [68, 15], [53, 16], [47, 39], [27, 44], [16, 63], [12, 79], [0, 84], [0, 47], [18, 30]])
    polygon(base, '#b4a475', [[0, 140], [32, 153], [40, 160], [84, 193], [80, 198], [47, 182], [20, 174], [0, 168]])
    for (let i = 0; i < 480; i += 1) {
      const y = Math.floor(rand() * H)
      const x = Math.floor(rand() * Math.max(28, 117 - y * .41))
      const tone = ['#4552477c', '#bdb6806c', '#d1ba8260', '#43583b6b', '#384a3966'][i % 5]
      blocks(base, tone, [[x, y, i % 6 ? 1 : 4, i % 7 ? 1 : 2]])
    }
    for (let i = 0; i < 65; i += 1) {
      const y = Math.floor(rand() * H)
      tuft(Math.floor(rand() * Math.max(22, 90 - y * .32)), y, i % 3 === 0)
    }

    const rocks = [[139, 4, .73], [150, 27, .76], [122, 45, .88], [142, 51, .5], [94, 69, 1.13], [133, 79, .57], [83, 99, .65], [103, 101, .45], [78, 127, .62], [68, 153, .43], [55, 197, .68], [33, 213, .75], [47, 233, .4], [21, 236, .6], [195, 65, .64], [210, 70, .34], [188, 88, .36], [25, 83, .6], [15, 109, .47], [113, 15, .47]]
    for (const [x, y, size] of rocks) rock(x, y, size, x < 157 && y % 2)
    const foam = '#aec3a371'
    for (const [x, y] of [[169, 14], [170, 34], [159, 63], [141, 69], [125, 101], [117, 125], [104, 134], [85, 154], [72, 179], [65, 193], [58, 209], [59, 229], [50, 245], [208, 69]]) {
      blocks(base, foam, [[x, y, 7, 1], [x + 5, y + 2, 6, 1], [x - 5, y + 4, 4, 1]])
    }

    habitat(location, rand)
    deckSegment(0, 173, 245, 26, false, 892)
    deckSegment(221, 139, 27, 61, true, 7908)
    deckSegment(210, 137, 79, 19, false, 77548)
    deckSegment(56, 144, 34, 44, true, 795)
    shed(42, 111)
    box(101, 169)
    box(124, 172)
    box(192, 175)
    box(214, 158)
    for (const [x, y] of [[10, 195], [54, 195], [94, 195], [132, 195], [172, 195], [217, 195], [245, 195], [224, 164], [246, 164], [213, 140], [244, 140], [285, 140], [286, 153]]) post(x, y)
    line(base, '#c1a774a0', [[10, 191], [30, 195], [54, 191], [74, 195], [94, 191], [112, 194], [132, 191]])
    line(base, '#cfb583ad', [[172, 192], [194, 196], [217, 192]])
    blocks(base, '#b78452', [[154, 174, 8, 11], [148, 175, 5, 8]])
    blocks(base, '#5b694f', [[154, 177, 8, 2], [155, 181, 7, 1], [148, 177, 5, 2]])
    blocks(base, '#dac485', [[155, 174, 6, 2], [149, 175, 3, 1]])
  }

  seaBase(location)
  return stageBase
}

const foamBits = Array.from({length: 44}, (_, index) => {
  const rand = randomFrom(1798 + index * 47)
  return { x: 103 + rand() * 450, y: 14 + rand() * 227, size: 3 + rand() * 12, phase: rand() * 55 }
})

function fisher(ctx, running) {
  const x = 259
  const y = 147
  blocks(ctx, '#353c30a0', [[x - 5, y + 5, 18, 5], [x - 2, y + 9, 20, 3]])
  blocks(ctx, '#333f36', [[x - 3, y, 6, 8], [x + 3, y + 1, 5, 9], [x - 5, y + 7, 8, 3], [x + 4, y + 8, 7, 3]])
  blocks(ctx, '#8a633e', [[x - 5, y - 10, 11, 15], [x + 3, y - 9, 6, 11], [x + 6, y - 8, 8, 4]])
  blocks(ctx, '#cd9e58', [[x - 4, y - 9, 9, 12], [x + 2, y - 8, 4, 10], [x + 5, y - 6, 8, 3]])
  blocks(ctx, '#ead091', [[x - 4, y - 9, 4, 9], [x + 6, y - 6, 6, 1]])
  blocks(ctx, '#7e4939', [[x - 3, y - 17, 11, 8], [x - 5, y - 13, 16, 2]])
  blocks(ctx, '#d57d53', [[x - 1, y - 18, 8, 5], [x + 6, y - 14, 6, 2]])
  blocks(ctx, '#d6ae80', [[x + 5, y - 12, 4, 5], [x + 13, y - 6, 3, 3]])
  line(ctx, '#643e2e', [[x + 9, y - 2], [x + 16, y - 7], [x + 27, y - (running ? 13 : 8)]], 2)
  line(ctx, '#edd099', [[x + 13, y - 6], [x + 21, y - 9], [x + 28, y - (running ? 12 : 7)]])
}

export function drawSea(ctx, stageBase, time, visual) {
  const { running, reeling, event, tensionLevel, reducedMotion } = visual
  const outcome = event === 'landed' || event === 'discovery' || event === 'escape'
  const t = reducedMotion ? 0 : time / 1000
  ctx.drawImage(stageBase, 0, 0)
  for (const bit of foamBits) {
    if (bit.y > 132 && bit.y < 201 && bit.x < 297) continue
    const x = Math.round(bit.x + Math.sin(t / 1.8 + bit.phase) * 3)
    const alpha = .19 + (.5 + Math.sin(t * .66 + bit.phase) / 2) * .37
    ctx.fillStyle = `rgba(163, 191, 153, ${alpha})`
    ctx.fillRect(x, Math.round(bit.y), bit.size, 1)
    if (bit.size > 11) ctx.fillRect(x + bit.size + 3, Math.round(bit.y) + 1, 3, 1)
  }
  fisher(ctx, running)
  const dip = reeling ? tensionLevel === 'critical' ? 4 : 2 : 0
  const y = BOBBER_Y + dip + Math.round(Math.sin(t * 2.5) * (reeling ? 3 : 2))
  const x = BOBBER_X + Math.round(Math.sin(t * 1.35) * 2)
  const lineStart = [286, running ? 136 : 141]
  const lineEnd = event === 'escape' ? [x - 12, y - 6] : [x, y]
  const linePath = reeling ? [lineStart, lineEnd] : [lineStart, [308, 144], [325, 151], [346, 160], lineEnd]
  line(ctx, reeling ? '#f1dcaa' : '#e4ddaa9b', linePath, reeling ? 1.05 : .8)
  ctx.strokeStyle = tensionLevel === 'critical' ? '#e4a48ab8' : '#d2e0b493'
  ctx.lineWidth = .8
  const rings = outcome || event === 'bite' ? [7, 14, 22] : running ? [6, 12] : [7]
  for (const [i, ring] of rings.entries()) {
    const shift = Math.sin(t * 2 + i) * (outcome ? 4 : 2)
    ctx.beginPath()
    ctx.ellipse(x, y + 2, ring + shift, ring * .32, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  blocks(ctx, '#163c35a0', [[x - 3, y + 2, 8, 2]])
  blocks(ctx, '#b9503d', [[x - 1, y - 5 + dip, 3, 7 - dip]])
  blocks(ctx, '#f7dd9b', [[x - 1, y - 5 + dip, 3, 2], [x + 1, y, 1, 2]])
  if (outcome) {
    blocks(ctx, '#e5eac2c7', [[x + 5, y - 5, 3, 1], [x - 7, y - 4, 2, 1], [x, y - 11, 1, 2]])
  }
}

export function drawChart(ctx, points) {
  const rand = randomFrom(554034)
  blocks(ctx, '#d8d9c2', [[0, 0, 568, 280]])
  for (let i = 0; i < 3400; i += 1) blocks(ctx, i % 3 ? '#a8af9254' : '#eeefdb85', [[Math.floor(rand() * 568), Math.floor(rand() * 280), rand() * 3 + 1, 1]])
  const coast = [[0, 0], [183, 0], [179, 17], [155, 39], [178, 63], [131, 66], [127, 90], [95, 117], [85, 144], [91, 170], [75, 193], [58, 220], [57, 253], [69, 280], [0, 280]]
  polygon(ctx, '#bcbd9d', coast)
  line(ctx, '#5b7768', coast.slice(1, -1), 1.6)
  for (let i = 1; i <= 13; i += 1) {
    const off = i * 32
    const points = coast.slice(1, -1).map(([x, y], row) => [x + off + Math.sin(i * .32 + y * .044) * (12 + i / 2), y + row % 2 * 4])
    line(ctx, i % 4 === 0 ? '#809481aa' : '#78907d43', [[186 + off, 0], ...points, [100 + off, 280]])
  }
  for (let i = 1; i < 12; i += 1) line(ctx, '#7e938333', [[i * 49, 0], [i * 49, 280]])
  for (let i = 1; i < 7; i += 1) line(ctx, '#7e938333', [[0, i * 44], [568, i * 44]])
  ctx.save()
  ctx.setLineDash([5, 3])
  const waypoints = points.map(([x, y]) => [x * W / 100, y * 280 / 100])
  const route = waypoints.flatMap(([x, y], index) => {
    if (index === 0) return [[x, y]]
    const [prevX, prevY] = waypoints[index - 1]
    return [[(x + prevX) / 2, prevY * .7 + y * .3 + 9], [x, y]]
  })
  line(ctx, '#8e5146', route, 1.6)
  ctx.restore()
  for (const [x, y] of waypoints) {
    blocks(ctx, '#974b3f', [[x - 4, y - 4, 8, 8]])
    blocks(ctx, '#eeead0', [[x - 2, y - 2, 4, 4]])
  }
  for (const [x, y, z] of [[20, 103, 3], [88, 125, 5], [154, 194, 12], [240, 193, 18], [292, 53, 23], [361, 95, 31], [488, 155, 52], [479, 247, 48], [315, 235, 27], [537, 100, 65]]) {
    ctx.font = '6px monospace'
    ctx.fillStyle = '#596c5e'
    ctx.fillText(z, x, y)
  }
}
