import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'

import { bottleFamilyId } from '../materials'

/*
 * The thrown bottle's trail: one smooth, tapered ribbon (a single draw call) that
 * follows the bottle's real path - the parabola of every hop, the sharp corner of every
 * bounce - with a hot white core inside a soft band of the bottle's liquid colour that
 * shifts hue and fades along its length. On MEDIUM / HIGH a small pool of twinkling
 * star glints is shed along it (one more draw call).
 *
 * Fixed-size ring buffers, rewritten in place: nothing is allocated after creation.
 * The ribbon faces the camera in the vertex shader and keeps a minimum on-screen width,
 * so it still reads when the chase camera falls far behind a fast bottle. Blending is
 * premultiplied (colour * alpha + glow): the colour covers bright skies and pale stairs
 * instead of washing out to white the way a purely additive trail does.
 */

/** Seconds a trail point lives (scaled per bottle family). */
const LIFE = 0.42
/** Minimum spacing between committed points; closer samples move the newest one. */
const MIN_STEP = 0.07
/** Trail length in world units at rest and at full speed (the chase camera falls further behind a faster bottle). */
const LEN_MIN = 4
const LEN_MAX = 13
/** Half-width (world units) for a size-1 bottle. */
const HALF_WIDTH = 0.5
/** The ribbon never gets thinner than this on screen (CSS px, half-width). */
const MIN_HALF_PX = 3.2
/** Seconds the whole trail takes to vanish once the bottle shatters. */
const KILL_FADE = 0.16
/** Glints: lifetime range (s) and how far apart they're shed along the path. */
const GLINT_LIFE = 0.55
const GLINT_SPACING = 0.55
/** Most glints a second, whatever the speed (so the pool isn't recycled mid-twinkle). */
const GLINT_RATE = 75

/**
 * How each bottle family's trail differs: `width`/`life` scale the ribbon, `shift` is the
 * hue drift head -> tail, `white` pulls the tail towards white (frosty), `rainbow` blends
 * in a hue cycle along the trail, `glints` scales how many glints are shed.
 */
const FAMILY_LOOK = {
  classic: { width: 1, life: 1, shift: 0.06, white: 0.1, rainbow: 0, glints: 0.8 },
  soda: { width: 0.92, life: 0.95, shift: -0.05, white: 0.2, rainbow: 0, glints: 1.3 },
  jar: { width: 1.25, life: 0.85, shift: 0.05, white: 0.05, rainbow: 0, glints: 0.6 },
  potion: { width: 1.05, life: 1.15, shift: 0.16, white: 0.05, rainbow: 0, glints: 1 },
  flask: { width: 0.9, life: 1.15, shift: -0.07, white: 0.45, rainbow: 0, glints: 1.1 },
  gourd: { width: 1.1, life: 1.1, shift: 0.08, white: 0.15, rainbow: 0, glints: 1.15 },
  crystal: { width: 1, life: 1.25, shift: 0, white: 0.25, rainbow: 0.7, glints: 1.5 },
}
/** Per-bottle touches on top of the family look. */
const BOTTLE_LOOK = {
  rainbow: { rainbow: 1 },
  aurora: { rainbow: 0.35 },
  nebula: { shift: -0.14 },
  infinity: { rainbow: 0.9 },
  magma: { shift: 0.07 },
}

const RIBBON_VERT = /* glsl */ `
attribute vec3 aTangent;
attribute vec4 aData; // side (-1/1), u (0 head .. 1 tail), alpha, half-width
uniform float uMinHalf;
uniform float uViewH;
uniform vec3 uHead;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec3 c = position;
  vec3 toCam = cameraPosition - c;
  vec3 s = cross(aTangent, toCam);
  float l = length(s);
  s = l > 1e-5 ? s / l : vec3(1.0, 0.0, 0.0);
  float u = aData.y;
  // A comet: full width at the bottle, tapering to a point at the tail. The chase camera
  // looks down the trail, so parts nearer the camera than the bottle are thinned to keep
  // the taper on screen (otherwise it fans out like a spotlight).
  float taper = pow(1.0 - u, 1.15);
  float depth = max(0.1, -(viewMatrix * vec4(c, 1.0)).z);
  float headDepth = max(0.1, -(viewMatrix * vec4(uHead, 1.0)).z);
  float w = aData.w * taper * clamp(depth / headDepth, 0.2, 1.0);
  // Keep a minimum on-screen width (world size of a pixel at this depth).
  float px = 2.0 * depth / (projectionMatrix[1][1] * uViewH);
  w = max(w, uMinHalf * px * taper);
  c += s * (aData.x * w);
  vUv = vec2(u, aData.x);
  vAlpha = aData.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0);
}
`

const RIBBON_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uCore;
uniform float uRainbow;
uniform float uGlow;
uniform float uTime;
uniform float uFade;
varying vec2 vUv;
varying float vAlpha;
vec3 hue(float h) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return k * k * (3.0 - 2.0 * k);
}
void main() {
  float u = vUv.x;
  float d = abs(vUv.y);
  float edge = 1.0 - smoothstep(0.82, 1.0, d);
  // A saturated body, a soft halo round it and a white-hot core near the bottle.
  float body = exp(-d * d * 4.5) * edge;
  float halo = exp(-d * d * 1.3) * edge;
  float core = exp(-d * d * 26.0);
  float fade = vAlpha * uFade * pow(1.0 - u, 1.2);
  vec3 col = mix(uColA, uColB, smoothstep(0.0, 0.9, u));
  col = mix(col, hue(fract(u * 0.85 - uTime * 0.55)), uRainbow);
  // Faint energy ripples running back along the trail.
  float ripple = 0.84 + 0.16 * sin(u * 34.0 - uTime * 24.0);
  float a = (body * 0.86 + halo * 0.22) * fade * ripple;
  float hot = core * pow(1.0 - u, 0.8) * (0.75 + uGlow * 0.6);
  vec3 rgb = col * a + (uCore * hot + col * halo * 0.3 * uGlow) * fade;
  gl_FragColor = vec4(rgb, min(1.0, a + hot * 0.15 * fade));
  #include <colorspace_fragment>
}
`

const GLINT_VERT = /* glsl */ `
attribute vec4 aGlint; // rgb, alpha
attribute vec2 aSizeRot; // world size, rotation
uniform float uViewH;
uniform float uMinPx;
varying vec4 vGlint;
varying float vRot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = aSizeRot.x * projectionMatrix[1][1] * uViewH * 0.5 / max(0.1, -mv.z);
  gl_PointSize = aGlint.a > 0.002 ? clamp(px, uMinPx, uMinPx * 14.0) : 0.0;
  vGlint = aGlint;
  vRot = aSizeRot.y;
  gl_Position = projectionMatrix * mv;
}
`

const GLINT_FRAG = /* glsl */ `
varying vec4 vGlint;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float cs = cos(vRot);
  float sn = sin(vRot);
  p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 14.0);
  float rays = exp(-abs(p.x) * 22.0 - abs(p.y) * 2.8) + exp(-abs(p.y) * 22.0 - abs(p.x) * 2.8);
  float i = (core * 1.1 + rays * 0.9) * (1.0 - r2) * vGlint.a;
  gl_FragColor = vec4(vGlint.rgb * i, min(1.0, i * 0.3));
  #include <colorspace_fragment>
}
`

const _hsl = { h: 0, s: 0, l: 0 }
const _c = new Color()
const WHITE = new Color('#ffffff')

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Creates a trail. `points` is the ribbon's ring-buffer size, `glints` the glint pool
 * (0 = no glints, no second draw call - LOW).
 */
export function createBottleTrail({ points = 48, glints = 0 } = {}) {
  const N = points
  // Ring buffer of committed points (newest at `head`).
  const px = new Float32Array(N)
  const py = new Float32Array(N)
  const pz = new Float32Array(N)
  const age = new Float32Array(N)
  const pow = new Float32Array(N)
  let head = -1
  let count = 0

  // Ribbon: two vertices per point.
  const V = N * 2
  const pos = new Float32Array(V * 3)
  const tan = new Float32Array(V * 3)
  const dat = new Float32Array(V * 4)
  const geometry = new BufferGeometry()
  const posAttr = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage)
  const tanAttr = new BufferAttribute(tan, 3).setUsage(DynamicDrawUsage)
  const datAttr = new BufferAttribute(dat, 4).setUsage(DynamicDrawUsage)
  geometry.setAttribute('position', posAttr)
  geometry.setAttribute('aTangent', tanAttr)
  geometry.setAttribute('aData', datAttr)
  const index = new Uint16Array((N - 1) * 6)
  for (let i = 0; i < N - 1; i += 1) {
    const a = i * 2
    const o = i * 6
    index[o] = a
    index[o + 1] = a + 1
    index[o + 2] = a + 2
    index[o + 3] = a + 1
    index[o + 4] = a + 3
    index[o + 5] = a + 2
  }
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.setDrawRange(0, 0)

  const uniforms = {
    uColA: { value: new Color('#38bdf8') },
    uColB: { value: new Color('#7dd3fc') },
    uCore: { value: new Color('#ffffff') },
    uRainbow: { value: 0 },
    uGlow: { value: 0.2 },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uMinHalf: { value: MIN_HALF_PX },
    uViewH: { value: 720 },
    uHead: { value: new Vector3() },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  })
  const ribbon = new Mesh(geometry, material)
  ribbon.frustumCulled = false
  ribbon.matrixAutoUpdate = false
  // Before the bottle's glass (renderOrder 1), after the blob shadow (0).
  ribbon.renderOrder = 0.5

  // Glints (MEDIUM / HIGH).
  const G = glints
  let glintPoints = null
  let gPos = null
  let gCol = null
  let gSize = null
  const gVel = new Float32Array(G * 3)
  const gBase = new Float32Array(G * 3)
  const gAge = new Float32Array(G).fill(9)
  const gLife = new Float32Array(G).fill(1)
  const gWorld = new Float32Array(G)
  const gSeed = new Float32Array(G)
  const glintUniforms = { uViewH: { value: 720 }, uMinPx: { value: 3 } }
  let gNext = 0
  let gAcc = 0
  let gBudget = 0
  if (G > 0) {
    const gg = new BufferGeometry()
    gPos = new Float32Array(G * 3)
    gCol = new Float32Array(G * 4)
    gSize = new Float32Array(G * 2)
    gg.setAttribute('position', new BufferAttribute(gPos, 3).setUsage(DynamicDrawUsage))
    gg.setAttribute('aGlint', new BufferAttribute(gCol, 4).setUsage(DynamicDrawUsage))
    gg.setAttribute('aSizeRot', new BufferAttribute(gSize, 2).setUsage(DynamicDrawUsage))
    const gm = new ShaderMaterial({
      uniforms: glintUniforms,
      vertexShader: GLINT_VERT,
      fragmentShader: GLINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    })
    glintPoints = new Points(gg, gm)
    glintPoints.frustumCulled = false
    glintPoints.matrixAutoUpdate = false
    glintPoints.renderOrder = 0.6
    for (let i = 0; i < G; i += 1) gSeed[i] = (i * 0.618034) % 1
  }

  const look = { width: HALF_WIDTH, life: LIFE, glints: 1, rainbow: 0 }
  let maxLen = LEN_MIN
  let fade = 1
  let killed = false
  let anyGlint = false

  function spawnGlint(x, y, z) {
    if (!G || gBudget < 1) return
    gBudget -= 1
    const i = gNext
    gNext = (gNext + 1) % G
    const ix = i * 3
    const r = look.width * 0.9
    gPos[ix] = x + (Math.random() - 0.5) * r * 2
    gPos[ix + 1] = y + (Math.random() - 0.5) * r * 2
    gPos[ix + 2] = z + (Math.random() - 0.5) * r * 2
    gVel[ix] = (Math.random() - 0.5) * 1.6
    gVel[ix + 1] = 0.3 + Math.random() * 1.2
    gVel[ix + 2] = (Math.random() - 0.5) * 1.6
    gAge[i] = 0
    gLife[i] = GLINT_LIFE * (0.65 + Math.random() * 0.7)
    gWorld[i] = 0.2 + Math.random() * 0.22
    // White-hot with a tint of the trail colour (any hue at all on rainbow bottles).
    if (look.rainbow > 0.5) _c.setHSL(Math.random(), 0.9, 0.7)
    else _c.copy(Math.random() < 0.5 ? uniforms.uColA.value : uniforms.uColB.value)
    _c.lerp(WHITE, 0.5 + Math.random() * 0.3)
    gBase[ix] = _c.r
    gBase[ix + 1] = _c.g
    gBase[ix + 2] = _c.b
  }

  return {
    ribbon,
    glints: glintPoints,

    /** Colours and proportions from a bottle (its liquid colour and family). No allocation. */
    setLook(bottle) {
      const fam = FAMILY_LOOK[bottleFamilyId(bottle)] || FAMILY_LOOK.classic
      const over = BOTTLE_LOOK[bottle?.id] || {}
      const shift = over.shift ?? fam.shift
      const rainbow = over.rainbow ?? fam.rainbow
      const white = fam.white
      const glow = Math.min(1, Math.max(0, bottle?.glow ?? 0.2))
      look.width = HALF_WIDTH * fam.width * (bottle?.shape?.[0] ?? 1)
      look.life = LIFE * fam.life
      look.glints = fam.glints * (0.75 + glow * 0.5)
      look.rainbow = rainbow
      // Head: the liquid colour, kept vivid and bright enough to glow (dark liquids too).
      // (A saturated, mid-light colour reads on pale stairs and bright skies alike.)
      _c.set(bottle?.fill || '#38bdf8').getHSL(_hsl)
      const s = Math.max(0.82, _hsl.s)
      const l = Math.min(0.58, Math.max(0.46, _hsl.l))
      uniforms.uColA.value.setHSL(_hsl.h, s, l)
      // Tail: drifted hue, a little lighter, optionally frosted towards white.
      uniforms.uColB.value.setHSL((_hsl.h + shift + 1) % 1, s, Math.min(0.66, l + 0.05)).lerp(WHITE, white * 0.7)
      uniforms.uCore.value.copy(uniforms.uColA.value).lerp(WHITE, 0.85)
      uniforms.uRainbow.value = rainbow
      uniforms.uGlow.value = glow
    },

    /** Empties the trail for a new throw. */
    reset() {
      head = -1
      count = 0
      fade = 1
      killed = false
      maxLen = LEN_MIN
      gAcc = 0
      for (let i = 0; i < G; i += 1) gAge[i] = 9
      geometry.setDrawRange(0, 0)
      ribbon.visible = false
      if (glintPoints) glintPoints.visible = false
    },

    /** The bottle smashed: the ribbon fades out in a blink and stops taking points. */
    kill() {
      killed = true
    },

    /** World units between samples the caller should emit along the path. */
    get spacing() {
      return Math.max(MIN_STEP * 1.5, maxLen / (N * 0.75))
    },
    get maxLen() {
      return maxLen
    },

    /** Bottle speed (units/s) this frame: a faster bottle leaves a longer trail. */
    setSpeed(speed) {
      const target = Math.min(LEN_MAX, LEN_MIN + speed * 0.06)
      maxLen += (target - maxLen) * (target > maxLen ? 0.35 : 0.08)
    },

    /** Adds a point at the bottle's position; `power` 0..1 is how bright it is. */
    push(x, y, z, power) {
      if (killed) return
      if (count > 0) {
        const dx = x - px[head]
        const dy = y - py[head]
        const dz = z - pz[head]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (G) {
          gAcc += d * power
          const step = GLINT_SPACING / look.glints
          while (gAcc >= step) {
            gAcc -= step
            spawnGlint(x - dx * Math.random(), y - dy * Math.random(), z - dz * Math.random())
          }
        }
        if (d < MIN_STEP) {
          px[head] = x
          py[head] = y
          pz[head] = z
          pow[head] = Math.max(pow[head], power)
          return
        }
      }
      head = (head + 1) % N
      px[head] = x
      py[head] = y
      pz[head] = z
      age[head] = 0
      pow[head] = power
      if (count < N) count += 1
    },

    /**
     * Ages everything and rewrites the buffers. `viewH` is the drawing buffer height in
     * pixels and `dpr` the pixel ratio (for the minimum on-screen width).
     */
    update(delta, time, viewH, dpr) {
      uniforms.uTime.value = time
      uniforms.uViewH.value = viewH
      uniforms.uMinHalf.value = MIN_HALF_PX * dpr
      if (killed) fade = Math.max(0, fade - delta / KILL_FADE)
      uniforms.uFade.value = fade

      // --- Ribbon, newest point first.
      let n = 0
      if (count > 0) uniforms.uHead.value.set(px[head], py[head], pz[head])
      if (count > 1 && fade > 0) {
        const life = look.life
        const width = look.width
        let i = head
        let dist = 0
        let lx = 0
        let ly = 0
        let lz = 0
        let lu = 0
        for (let k = 0; k < count; k += 1) {
          age[i] += delta
          let x = px[i]
          let y = py[i]
          let z = pz[i]
          if (k > 0) {
            const dx = x - lx
            const dy = y - ly
            const dz = z - lz
            dist += Math.sqrt(dx * dx + dy * dy + dz * dz)
          }
          const uLen = dist / maxLen
          const uAge = age[i] / life
          let u = uLen > uAge ? uLen : uAge
          const last = u >= 1 || k === count - 1
          if (u >= 1 && k > 0) {
            // End exactly where u reaches 1, so the tail slides in smoothly.
            const t = (1 - lu) / Math.max(1e-5, u - lu)
            x = lx + (x - lx) * t
            y = ly + (y - ly) * t
            z = lz + (z - lz) * t
            u = 1
          }
          const p = pow[i]
          const w = width * (0.55 + 0.45 * p)
          for (let s = 0; s < 2; s += 1) {
            const v = n * 2 + s
            pos[v * 3] = x
            pos[v * 3 + 1] = y
            pos[v * 3 + 2] = z
            dat[v * 4] = s === 0 ? -1 : 1
            dat[v * 4 + 1] = u
            dat[v * 4 + 2] = p
            dat[v * 4 + 3] = w
          }
          n += 1
          lx = x
          ly = y
          lz = z
          lu = u
          if (last) break
          i = (i - 1 + N) % N
        }
        // Points past the end are dead: forget them.
        if (n < count) count = n
        // Tangents (central differences; one-sided at the ends).
        for (let k = 0; k < n; k += 1) {
          const a = (k > 0 ? k - 1 : k) * 6
          const b = (k < n - 1 ? k + 1 : k) * 6
          let tx = pos[a] - pos[b]
          let ty = pos[a + 1] - pos[b + 1]
          let tz = pos[a + 2] - pos[b + 2]
          const l = Math.sqrt(tx * tx + ty * ty + tz * tz)
          if (l > 1e-6) {
            tx /= l
            ty /= l
            tz /= l
          } else {
            tx = 0
            ty = 0
            tz = -1
          }
          const o = k * 6
          tan[o] = tx
          tan[o + 1] = ty
          tan[o + 2] = tz
          tan[o + 3] = tx
          tan[o + 4] = ty
          tan[o + 5] = tz
        }
        posAttr.needsUpdate = true
        tanAttr.needsUpdate = true
        datAttr.needsUpdate = true
      } else if (count > 0) {
        for (let k = 0, i = head; k < count; k += 1, i = (i - 1 + N) % N) age[i] += delta
      }
      geometry.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0)
      ribbon.visible = n > 1

      // --- Glints.
      if (G) {
        gBudget = Math.min(4, gBudget + delta * GLINT_RATE)
        glintUniforms.uViewH.value = viewH
        glintUniforms.uMinPx.value = 2.5 * dpr
        const drag = Math.max(0, 1 - 2.2 * delta)
        anyGlint = false
        for (let i = 0; i < G; i += 1) {
          const ix = i * 3
          const ic = i * 4
          const a = gAge[i]
          if (a >= gLife[i]) {
            gCol[ic + 3] = 0
            continue
          }
          const ag = (gAge[i] = a + delta)
          const k = ag / gLife[i]
          if (k >= 1) {
            gCol[ic + 3] = 0
            continue
          }
          anyGlint = true
          gVel[ix] *= drag
          gVel[ix + 1] = gVel[ix + 1] * drag - 0.6 * delta
          gVel[ix + 2] *= drag
          gPos[ix] += gVel[ix] * delta
          gPos[ix + 1] += gVel[ix + 1] * delta
          gPos[ix + 2] += gVel[ix + 2] * delta
          const twinkle = 0.55 + 0.45 * Math.sin(ag * 30 + gSeed[i] * 40)
          const alpha = Math.sin(Math.PI * k) * twinkle
          gCol[ic] = gBase[ix]
          gCol[ic + 1] = gBase[ix + 1]
          gCol[ic + 2] = gBase[ix + 2]
          gCol[ic + 3] = alpha
          gSize[i * 2] = gWorld[i] * (0.6 + 0.4 * twinkle)
          gSize[i * 2 + 1] = gSeed[i] * 6.28 + ag * 2.5
        }
        if (anyGlint) {
          const gg = glintPoints.geometry
          gg.attributes.position.needsUpdate = true
          gg.attributes.aGlint.needsUpdate = true
          gg.attributes.aSizeRot.needsUpdate = true
        }
        glintPoints.visible = anyGlint
      }
    },

    /** True while anything is still on screen. */
    get active() {
      return ribbon.visible || anyGlint
    },

    dispose() {
      geometry.dispose()
      material.dispose()
      if (glintPoints) {
        glintPoints.geometry.dispose()
        glintPoints.material.dispose()
      }
    },
  }
}

/** Speed (units/s) -> trail brightness 0..1: a slow roll leaves only a faint wisp. */
export const trailPower = (speed) => 0.15 + 0.85 * smooth(1.5, 18, speed)
