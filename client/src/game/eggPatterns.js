import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

/**
 * The egg patterns: one 512x512 texture with a strip per egg, in ALL_EGGS order (World
 * 1's five, then World 2's three), top to bottom. Each strip tiles left to right, so it
 * wraps the egg without a seam. Drawn once.
 */

/** Pattern strips in the texture (ALL_EGGS.length). */
export const EGG_PATTERN_ROWS = 8

let eggPatterns = null

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  draw(canvas.getContext('2d'), size)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

export function getEggPatternTexture() {
  if (eggPatterns) return eggPatterns
  eggPatterns = canvasTexture(512, (ctx, size) => {
    const H = size / EGG_PATTERN_ROWS
    const rand = mulberry(7)
    /** Draws `fn(x)` at x and its wrapped copies, so strips tile across the seam. */
    const wrap = (x, r, fn) => {
      fn(x)
      if (x - r < 0) fn(x + size)
      if (x + r > size) fn(x - size)
    }
    const dot = (x, y, r, color) =>
      wrap(x, r, (cx) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(cx, y, r, 0, Math.PI * 2)
        ctx.fill()
      })
    const star = (x, y, r, color) =>
      wrap(x, r, (cx) => {
        ctx.fillStyle = color
        ctx.beginPath()
        for (let k = 0; k < 8; k += 1) {
          const a = (k / 8) * Math.PI * 2
          const rr = k % 2 ? r * 0.32 : r
          ctx.lineTo(cx + Math.cos(a) * rr, y + Math.sin(a) * rr)
        }
        ctx.closePath()
        ctx.fill()
      })
    const band = (y0, top, bottom) => {
      const g = ctx.createLinearGradient(0, y0, 0, y0 + H)
      g.addColorStop(0, top)
      g.addColorStop(1, bottom)
      ctx.fillStyle = g
      ctx.fillRect(0, y0, size, H)
    }
    const zigzag = (y, amp, teeth, width, color) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineJoin = 'round'
      ctx.beginPath()
      for (let k = 0; k <= teeth; k += 1) ctx.lineTo((k / teeth) * size, y + (k % 2 ? amp : -amp))
      ctx.stroke()
    }

    // Sprout: fresh green with darker spots and a leafy zigzag.
    let y0 = 0
    band(y0, '#d9ffd8', '#3fbf5f')
    zigzag(y0 + H * 0.55, H * 0.07, 16, 7, '#eaffd8')
    for (let i = 0; i < 26; i += 1) dot(rand() * size, y0 + H * (0.12 + rand() * 0.76), 3 + rand() * 7, i % 3 ? '#2f9e4c' : '#9be7a3')

    // Frost: icy white to sky blue, snowflakes and a frosty edge.
    y0 = H
    band(y0, '#ffffff', '#5cb8f0')
    zigzag(y0 + H * 0.78, H * 0.06, 22, 6, '#ffffff')
    for (let i = 0; i < 18; i += 1) star(rand() * size, y0 + H * (0.12 + rand() * 0.6), 4 + rand() * 7, i % 2 ? '#ffffff' : '#c7ecff')

    // Sunset: yellow to orange to pink, with warm waves.
    y0 = H * 2
    {
      const g = ctx.createLinearGradient(0, y0, 0, y0 + H)
      g.addColorStop(0, '#ffe680')
      g.addColorStop(0.5, '#ff9a3d')
      g.addColorStop(1, '#ff5f8a')
      ctx.fillStyle = g
      ctx.fillRect(0, y0, size, H)
    }
    for (let w = 0; w < 3; w += 1) {
      ctx.strokeStyle = w === 1 ? 'rgba(255,255,255,0.65)' : 'rgba(214,72,40,0.55)'
      ctx.lineWidth = 5
      ctx.beginPath()
      const wy = y0 + H * (0.3 + w * 0.2)
      for (let x = 0; x <= size; x += 8) ctx.lineTo(x, wy + Math.sin((x / size) * Math.PI * 8) * H * 0.05)
      ctx.stroke()
    }
    for (let i = 0; i < 10; i += 1) star(rand() * size, y0 + H * (0.1 + rand() * 0.8), 3 + rand() * 4, '#fff6c8')

    // Unicorn: pastel pearl with rainbow polka dots.
    y0 = H * 3
    band(y0, '#fff6ff', '#e7c8ff')
    const RAINBOW = ['#ff8ad8', '#8ad4ff', '#ffe27a', '#9cf5c6', '#c9a7ff']
    for (let i = 0; i < 30; i += 1) dot(rand() * size, y0 + H * (0.1 + rand() * 0.8), 4 + rand() * 6, RAINBOW[i % RAINBOW.length])
    for (let i = 0; i < 8; i += 1) star(rand() * size, y0 + H * (0.1 + rand() * 0.8), 5, '#ffffff')

    // Cosmic: deep space with nebula clouds and stars.
    y0 = H * 4
    band(y0, '#4c1d95', '#1e1b4b')
    for (let i = 0; i < 7; i += 1) {
      const x = rand() * size
      const y = y0 + H * (0.2 + rand() * 0.6)
      const r = H * (0.25 + rand() * 0.3)
      wrap(x, r, (cx) => {
        const g = ctx.createRadialGradient(cx, y, 0, cx, y, r)
        g.addColorStop(0, i % 2 ? 'rgba(244,114,182,0.55)' : 'rgba(96,165,250,0.5)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(cx - r, y - r, r * 2, r * 2)
      })
    }
    for (let i = 0; i < 46; i += 1) dot(rand() * size, y0 + H * (0.06 + rand() * 0.88), 0.8 + rand() * 1.8, '#ffffff')
    for (let i = 0; i < 9; i += 1) star(rand() * size, y0 + H * (0.1 + rand() * 0.8), 4 + rand() * 4, '#fdf4ff')

    // --- World 2 -----------------------------------------------------------------
    // Candy: pink frosting with rainbow sprinkles and a cream drip.
    y0 = H * 5
    band(y0, '#ffe4f1', '#f472b6')
    {
      ctx.fillStyle = '#fff7fb'
      ctx.beginPath()
      ctx.moveTo(0, y0)
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y0 + H * (0.28 + 0.12 * Math.sin((x / size) * Math.PI * 10)))
      ctx.lineTo(size, y0)
      ctx.closePath()
      ctx.fill()
    }
    const SPRINKLES = ['#60a5fa', '#facc15', '#34d399', '#f87171', '#a78bfa', '#ffffff']
    for (let i = 0; i < 40; i += 1) {
      const x = rand() * size
      const y = y0 + H * (0.35 + rand() * 0.55)
      const a = rand() * Math.PI
      wrap(x, 6, (cx) => {
        ctx.save()
        ctx.translate(cx, y)
        ctx.rotate(a)
        ctx.fillStyle = SPRINKLES[i % SPRINKLES.length]
        ctx.fillRect(-5, -1.5, 10, 3)
        ctx.restore()
      })
    }

    // Lava: dark rock with glowing orange cracks.
    y0 = H * 6
    band(y0, '#3f1d10', '#1c0a05')
    ctx.lineCap = 'round'
    for (let k = 0; k < 9; k += 1) {
      let x = rand() * size
      let y = y0 + H * (0.1 + rand() * 0.3)
      ctx.strokeStyle = k % 3 ? 'rgba(255,140,40,0.95)' : 'rgba(255,220,90,0.95)'
      ctx.lineWidth = 2.5 + rand() * 2.5
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let step = 0; step < 6; step += 1) {
        x += (rand() - 0.5) * 40
        y += H * (0.08 + rand() * 0.08)
        ctx.lineTo(x, Math.min(y0 + H * 0.95, y))
      }
      ctx.stroke()
    }
    for (let i = 0; i < 14; i += 1) dot(rand() * size, y0 + H * (0.1 + rand() * 0.8), 1.5 + rand() * 2.5, 'rgba(255,170,60,0.9)')

    // Void: black with violet swirls and pin-point stars.
    y0 = H * 7
    band(y0, '#2e1065', '#020617')
    for (let k = 0; k < 5; k += 1) {
      ctx.strokeStyle = k % 2 ? 'rgba(192,132,252,0.7)' : 'rgba(129,140,248,0.6)'
      ctx.lineWidth = 4
      ctx.beginPath()
      const wy = y0 + H * (0.2 + k * 0.15)
      for (let x = 0; x <= size; x += 8) ctx.lineTo(x, wy + Math.sin((x / size) * Math.PI * 6 + k) * H * 0.07)
      ctx.stroke()
    }
    for (let i = 0; i < 40; i += 1) dot(rand() * size, y0 + H * (0.05 + rand() * 0.9), 0.7 + rand() * 1.4, '#ffffff')
  })
  eggPatterns.wrapS = RepeatWrapping
  return eggPatterns
}

/** Small seeded random numbers, so the patterns look the same every load. */
function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
