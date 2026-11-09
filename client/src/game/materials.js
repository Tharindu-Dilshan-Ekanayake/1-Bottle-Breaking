import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  LatheGeometry,
  MeshLambertMaterial,
  MeshPhongMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector4,
} from 'three'

import { BOTTLES } from '@shared/balance'

import { useQuality } from './stores/quality'
import { createStudTexture } from './textures'

/**
 * Shared geometries and materials, created once per page and reused by every
 * component. Nothing here is created per frame or per render.
 */

/* ------------------------------------------------------------ Block material */

let studTexture = null
let blockMaterial = null

/** White studded plate; the block colour comes from instance colours. */
function getStudTexture() {
  if (!studTexture) {
    studTexture = createStudTexture({ base: '#ffffff', alt: '#ececec', size: 512 })
  }
  return studTexture
}

const BLOCK_PARS_FRAGMENT = /* glsl */ `
varying vec3 vBWPos;
varying vec3 vBWNormal;
varying vec3 vBLocal;
varying vec3 vBLocalN;
varying vec3 vBScale;
uniform vec2 uWorldUvScale;
// Cheap hash + value noise (no sin, so it stays stable far down the stairs).
float btHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float btNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( btHash( i ), btHash( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( btHash( i + vec2( 0.0, 1.0 ) ), btHash( i + vec2( 1.0, 1.0 ) ), u.x ),
    u.y
  );
}
`

const BLOCK_SHADE_FRAGMENT = /* glsl */ `
vec3 bwA = abs( vBWNormal );
vec2 bwUv = bwA.y > 0.5 ? vBWPos.xz : ( bwA.x > 0.5 ? vBWPos.zy : vBWPos.xy );
#ifdef USE_MAP
  diffuseColor *= texture2D( map, bwUv * uWorldUvScale );
#endif
// Baked shading in world units, so it looks the same on a block of any size.
float bShade = 1.0;
if ( abs( vBLocalN.y ) < 0.5 ) {
  // Side faces: soft occlusion towards the bottom, a lit band along the top edge.
  float bAbove = ( vBLocal.y + 0.5 ) * vBScale.y;
  float bBelow = ( 0.5 - vBLocal.y ) * vBScale.y;
  bShade = mix( 0.72, 1.0, smoothstep( 0.0, 1.2, bAbove ) );
  bShade *= 1.0 + 0.13 * ( 1.0 - smoothstep( 0.0, 0.09, bBelow ) );
} else if ( vBLocalN.y > 0.0 ) {
  // Top faces: a thin bright rim where they meet the sides.
  vec2 bEdge = ( 0.5 - abs( vBLocal.xz ) ) * vBScale.xz;
  bShade = 1.0 + 0.08 * ( 1.0 - smoothstep( 0.0, 0.07, min( bEdge.x, bEdge.y ) ) );
} else {
  bShade = 0.72;
}
// Gentle world-space colour drift, so big flat areas are never one flat colour.
float bVar = btNoise( bwUv * 0.19 ) * 0.65 + btNoise( bwUv * 0.71 + 17.0 ) * 0.35;
diffuseColor.rgb *= bShade * mix( vec3( 0.93, 0.945, 0.97 ), vec3( 1.045, 1.03, 1.0 ), bVar );
`

/**
 * The one material for every brick in the world: Lambert (cheap) with the stud
 * texture mapped by WORLD position, so studs stay the same size on any block of any
 * scale — which is what lets the whole lobby be a single InstancedMesh of unit cubes.
 *
 * On top of the studs it bakes in, per pixel and for a handful of ALU ops: soft
 * occlusion towards the bottom of each side face, a highlight along each block's top
 * edge, and a low-frequency world-space colour variation.
 */
export function getBlockMaterial() {
  if (blockMaterial) return blockMaterial
  blockMaterial = new MeshLambertMaterial({ color: '#ffffff', map: getStudTexture() })
  const uvScale = { value: new Vector2(0.5, 0.5) } // one texture repeat per 2 world units
  blockMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uWorldUvScale = uvScale
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBWPos;
        varying vec3 vBWNormal;
        varying vec3 vBLocal;
        varying vec3 vBLocalN;
        varying vec3 vBScale;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 bwPos = vec4( transformed, 1.0 );
        vec3 bwN = objectNormal;
        vBScale = vec3( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ), length( modelMatrix[ 2 ].xyz ) );
        #ifdef USE_INSTANCING
          bwPos = instanceMatrix * bwPos;
          bwN = mat3( instanceMatrix ) * bwN;
          vBScale *= vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
        #endif
        vBWPos = ( modelMatrix * bwPos ).xyz;
        vBWNormal = normalize( mat3( modelMatrix ) * bwN );
        vBLocal = transformed;
        vBLocalN = objectNormal;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BLOCK_PARS_FRAGMENT}`)
      .replace('#include <map_fragment>', BLOCK_SHADE_FRAGMENT)
  }
  // Distinct program cache key so three never reuses a plain Lambert program for it.
  blockMaterial.customProgramCacheKey = () => 'bt-block-v2'
  return blockMaterial
}

/** Anisotropic filtering follows the quality preset. */
export function setBlockAnisotropy(level) {
  const tex = getStudTexture()
  if (tex.anisotropy !== level) {
    tex.anisotropy = level
    tex.needsUpdate = true
  }
}

/* --------------------------------------------------------------- Geometries */

let unitBox = null
/** 1x1x1 cube centred on the origin; instances scale it into any block. */
export function getUnitBox() {
  if (!unitBox) unitBox = new BoxGeometry(1, 1, 1)
  return unitBox
}

let unitCone = null
/** Unit-height cone, base at y=0. Used for pines and crystals. */
export function getUnitCone() {
  if (!unitCone) {
    unitCone = new ConeGeometry(0.5, 1, 7)
    unitCone.translate(0, 0.5, 0)
  }
  return unitCone
}

let eggGeo = null
/**
 * A real egg: rounder at the bottom, narrower at the top, about 2.6 units tall with its
 * centre at the origin. UV u runs around it and v from the bottom (0) to the top (1),
 * so a pattern strip wraps it.
 */
export function getEggGeometry() {
  if (!eggGeo) {
    const points = []
    const STEPS = 14
    for (let i = 0; i <= STEPS; i += 1) {
      const t = i / STEPS
      const angle = t * Math.PI
      // Wider below the middle, tapered towards the top.
      const r = Math.sin(angle) * (1 - 0.18 * (t - 0.45))
      const y = -Math.cos(angle) * 1.3
      points.push(new Vector2(Math.max(r, i === 0 || i === STEPS ? 0 : 0.0001), y))
    }
    eggGeo = new LatheGeometry(points, 20)
    eggGeo.computeVertexNormals()
  }
  return eggGeo
}

/** Pattern strips in the egg texture, top to bottom (EGG_ORDER). */
export const EGG_PATTERN_ROWS = 5

let eggPatterns = null
/**
 * One 512x512 texture with a pattern strip per egg (EGG_ORDER, top to bottom): sprout
 * spots, frost snowflakes, sunset waves, unicorn rainbow dots, cosmic stars. Each strip
 * tiles left to right, so it wraps the egg without a seam.
 */
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

/* ---------------------------------------------------------- Bottle geometry */

/*
 * Every bottle belongs to a shape FAMILY (classic, soda, jar, potion, flask, gourd,
 * crystal). A family is pure data: a glass lathe profile, how high its liquid can go,
 * where its label sits, its cap/stopper pieces and how many gel balls it holds.
 *
 * Conventions, all in bottle units (about 1 tall, base at y=0, body radius ~0.21-0.24):
 *  - every cap/stopper covers the glass lip with clearance: no coplanar or coincident
 *    surfaces between parts anywhere, so nothing z-fights;
 *  - labels follow the glass profile LABEL_GAP outside it, with the same facets.
 *
 * Each family is drawn with two meshes that share module-level materials:
 *  - SHELL (transparent): the liquid's back faces, the liquid, then the glass, in that
 *    order inside one draw, so they always blend correctly. Per bottle colours and the
 *    liquid level come from a uniform table indexed by the bottle's look index, which
 *    rides in instanceColor.r. The vertex shader cuts the liquid off at the bottle's fill
 *    height and flattens what's above into the surface, so one geometry serves every
 *    fill level of every bottle in the family.
 *  - PARTS (opaque): cap/stopper, label, cork and gold trim; tinted by instanceColor
 *    (the bottle's cap colour), the label lightened from it like printed paper.
 * Plus small instanced gel balls inside the liquid (see createGelLayout).
 */

/** Shell part ids (attribute aPart). */
const SHELL_LIQUID_BACK = 0
const SHELL_LIQUID = 1
const SHELL_GLASS = 2
/** Parts ids (attribute aPart). */
const PART_CAP = 0
const PART_LABEL = 1
const PART_CORK = 2
const PART_GOLD = 3

/** Labels sit this far outside the glass (bottle units). */
const LABEL_GAP = 0.005
/** Liquid rings sampled evenly between base and max (plus every glass vertex there). */
const LIQUID_STEPS = 4
const LIQUID_SEGMENTS = 12

/** Points on a sphere of radius `R` centred at height `c`, at these angles from the bottom. */
const arc = (R, c, degrees) =>
  degrees.map((d) => {
    const a = (d * Math.PI) / 180
    return [Math.round(R * Math.sin(a) * 1e4) / 1e4, Math.round((c - R * Math.cos(a)) * 1e4) / 1e4]
  })

const BOTTLE_FAMILIES = {
  /** Plain bottle with a knurled screw cap. */
  classic: {
    segments: 16,
    glass: [
      [0, 0], [0.165, 0], [0.2, 0.01], [0.218, 0.035], [0.224, 0.09], [0.224, 0.5], [0.218, 0.56],
      [0.198, 0.62], [0.16, 0.68], [0.118, 0.73], [0.092, 0.77], [0.086, 0.8], [0.086, 0.872],
      [0.095, 0.878], [0.095, 0.9], [0.084, 0.905], [0, 0.905],
    ],
    liquid: { base: 0.025, max: 0.6, inset: 0.016 },
    label: [0.13, 0.29],
    parts: [
      {
        part: PART_CAP, segments: 24, ridges: [0.879, 0.957, 0.0045],
        points: [[0, 0.856], [0.103, 0.856], [0.119, 0.861], [0.119, 0.873], [0.113, 0.879], [0.113, 0.957], [0.108, 0.974], [0.095, 0.983], [0, 0.985]],
      },
    ],
    gel: { count: 6, radius: 0.034 },
  },
  /** Contoured soda bottle: hips, a pinched waist, a long neck and a crimped crown cap. */
  soda: {
    segments: 16,
    glass: [
      [0, 0], [0.15, 0], [0.19, 0.012], [0.21, 0.04], [0.222, 0.1], [0.222, 0.16], [0.206, 0.235],
      [0.19, 0.3], [0.2, 0.37], [0.214, 0.44], [0.212, 0.5], [0.19, 0.56], [0.15, 0.63], [0.108, 0.7],
      [0.08, 0.76], [0.071, 0.8], [0.068, 0.858], [0.078, 0.864], [0.078, 0.886], [0.066, 0.892], [0, 0.892],
    ],
    liquid: { base: 0.025, max: 0.62, inset: 0.016 },
    label: [0.25, 0.35],
    parts: [
      {
        part: PART_CAP, segments: 32, ridges: [0.85, 0.874, 0.006],
        points: [[0, 0.85], [0.086, 0.85], [0.097, 0.853], [0.097, 0.874], [0.093, 0.879], [0.09, 0.898], [0.083, 0.904], [0, 0.905]],
      },
    ],
    gel: { count: 7, radius: 0.03 },
  },
  /** Wide jar with a big ribbed lid. */
  jar: {
    segments: 20,
    glass: [
      [0, 0], [0.18, 0], [0.214, 0.012], [0.232, 0.045], [0.236, 0.1], [0.236, 0.58], [0.229, 0.625],
      [0.213, 0.655], [0.198, 0.668], [0.192, 0.68], [0.192, 0.735], [0.2, 0.74], [0.2, 0.765],
      [0.188, 0.771], [0, 0.771],
    ],
    liquid: { base: 0.025, max: 0.64, inset: 0.016 },
    label: [0.27, 0.43],
    parts: [
      {
        part: PART_CAP, segments: 32, ridges: [0.752, 0.815, 0.004],
        points: [[0, 0.722], [0.206, 0.722], [0.222, 0.727], [0.222, 0.745], [0.215, 0.752], [0.215, 0.815], [0.21, 0.83], [0.196, 0.84], [0.17, 0.846], [0, 0.849]],
      },
    ],
    gel: { count: 9, radius: 0.036 },
  },
  /** Round potion bulb, open lip, a mushroom cork over it and a wax seal round the neck. */
  potion: {
    segments: 16,
    glass: [
      [0, 0], [0.06, 0], [0.072, 0.012],
      ...arc(0.25, 0.258, [17, 30, 45, 60, 75, 90, 105, 120, 135, 148]),
      [0.09, 0.505], [0.074, 0.53], [0.07, 0.56], [0.07, 0.7], [0.084, 0.708], [0.088, 0.722],
      [0.08, 0.73], [0.064, 0.73], [0.06, 0.712],
    ],
    liquid: { base: 0.025, max: 0.47, inset: 0.018 },
    label: [0.2, 0.3],
    parts: [
      {
        // Plug inside the neck, a skirt that comes down round the lip, a rounded top.
        part: PART_CORK, segments: 16,
        points: [[0, 0.66], [0.05, 0.66], [0.053, 0.675], [0.053, 0.738], [0.093, 0.738], [0.095, 0.727], [0.1, 0.73], [0.1, 0.81], [0.093, 0.82], [0, 0.823]],
      },
      {
        part: PART_CAP, segments: 16,
        points: [[0.064, 0.598], [0.081, 0.602], [0.086, 0.615], [0.086, 0.645], [0.081, 0.658], [0.064, 0.662]],
      },
    ],
    gel: { count: 7, radius: 0.036 },
  },
  /** Round-bottom flask with a long neck and a ground stopper with a knob. */
  flask: {
    segments: 16,
    glass: [
      [0, 0], [0.05, 0], [0.06, 0.008],
      ...arc(0.235, 0.243, [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 160]),
      [0.064, 0.48], [0.06, 0.5], [0.06, 0.84], [0.073, 0.845], [0.076, 0.858], [0.069, 0.865],
      [0.055, 0.865], [0.052, 0.848],
    ],
    liquid: { base: 0.022, max: 0.46, inset: 0.016 },
    label: [0.19, 0.28],
    parts: [
      {
        part: PART_CAP, segments: 16,
        points: [
          [0, 0.8], [0.045, 0.8], [0.047, 0.83], [0.047, 0.874], [0.08, 0.874], [0.082, 0.862], [0.088, 0.864],
          [0.09, 0.876], [0.09, 0.896], [0.07, 0.906], [0.042, 0.91], [0.042, 0.924], [0.062, 0.938],
          [0.068, 0.958], [0.06, 0.976], [0.034, 0.987], [0, 0.99],
        ],
      },
    ],
    gel: { count: 6, radius: 0.034 },
  },
  /** Double-bulb gourd: a ribbon round the waist, a gold collar and an ornate finial. */
  gourd: {
    segments: 16,
    glass: [
      [0, 0], [0.12, 0], [0.17, 0.02], [0.212, 0.075], [0.234, 0.15], [0.236, 0.24], [0.222, 0.33],
      [0.19, 0.405], [0.148, 0.462], [0.124, 0.5], [0.134, 0.535], [0.16, 0.585], [0.171, 0.635],
      [0.164, 0.685], [0.138, 0.732], [0.098, 0.77], [0.072, 0.79], [0.064, 0.808], [0.064, 0.85],
      [0.074, 0.855], [0.074, 0.872], [0.062, 0.877], [0, 0.877],
    ],
    liquid: { base: 0.025, max: 0.67, inset: 0.016 },
    label: [0.474, 0.528],
    parts: [
      {
        part: PART_GOLD, segments: 16,
        points: [[0, 0.838], [0.083, 0.838], [0.092, 0.843], [0.092, 0.878], [0.084, 0.885], [0, 0.887]],
      },
      {
        part: PART_CAP, segments: 16,
        points: [[0, 0.88], [0.04, 0.882], [0.045, 0.898], [0.07, 0.914], [0.08, 0.94], [0.07, 0.966], [0.042, 0.982], [0.024, 0.994], [0.012, 1.012], [0, 1.035]],
      },
    ],
    gel: { count: 8, radius: 0.034 },
  },
  /** Faceted crystal bottle (8 flat sides), a gold collar and a big cut-gem stopper. */
  crystal: {
    segments: 8,
    flat: true,
    glass: [
      [0, 0], [0.17, 0], [0.205, 0.02], [0.24, 0.075], [0.24, 0.5], [0.205, 0.575], [0.13, 0.64],
      [0.088, 0.665], [0.088, 0.72], [0.098, 0.726], [0.098, 0.75], [0.086, 0.755], [0, 0.755],
    ],
    liquid: { base: 0.028, max: 0.56, inset: 0.02 },
    label: [0.2, 0.33],
    parts: [
      {
        part: PART_GOLD, segments: 8, flat: true,
        points: [[0, 0.708], [0.104, 0.708], [0.116, 0.714], [0.116, 0.752], [0.108, 0.759], [0, 0.761]],
      },
      {
        // Turned half a facet against the bottle, so its facets catch the light apart.
        part: PART_CAP, segments: 8, phi: Math.PI / 8, flat: true,
        points: [[0, 0.745], [0.07, 0.762], [0.15, 0.845], [0.15, 0.862], [0.105, 0.935], [0.06, 0.955], [0, 0.956]],
      },
    ],
    gel: { count: 7, radius: 0.032 },
  },
}

/** Which family each bottle is drawn as: the line-up goes from plain to fancy. */
const BOTTLE_FAMILY_OF = {
  glass: 'classic',
  lemon: 'soda',
  mint: 'soda',
  berry: 'classic',
  beads: 'jar',
  slime: 'potion',
  honey: 'jar',
  magma: 'jar',
  frost: 'flask',
  aurora: 'flask',
  gold: 'gourd',
  rainbow: 'gourd',
  diamond: 'crystal',
  lava: 'potion',
  nebula: 'gourd',
  infinity: 'crystal',
}

/** The family id a bottle is drawn with ('classic' for anything unknown). */
export function bottleFamilyId(bottle) {
  return BOTTLE_FAMILY_OF[bottle?.id] || 'classic'
}

/** Index of a bottle in the shader's look table (its place in BOTTLES; 0 if unknown). */
export function bottleLookIndex(bottle) {
  const i = BOTTLES.indexOf(bottle)
  if (i >= 0) return i
  const j = BOTTLES.findIndex((b) => b.id === bottle?.id)
  return Math.max(0, j)
}

/* --- Profile maths (pure data, no geometry) */

/** Radius of a lathe profile at height y: the first segment, from the bottom, spanning y. */
function profileRadiusAt(profile, y) {
  for (let i = 0; i < profile.length - 1; i += 1) {
    const [r0, y0] = profile[i]
    const [r1, y1] = profile[i + 1]
    if (y0 === y1) continue
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0)
  }
  return 0
}

/** `steps` even heights from a to b, plus every profile vertex in between. */
function sampleHeights(profile, a, b, steps) {
  const ys = []
  for (let i = 0; i <= steps; i += 1) ys.push(a + ((b - a) * i) / steps)
  for (const [, y] of profile) if (y > a + 1e-4 && y < b - 1e-4) ys.push(y)
  ys.sort((p, q) => p - q)
  return ys.filter((y, i) => i === 0 || y - ys[i - 1] > 1e-4)
}

/** Radius of the liquid at height y (its lathe vertices; the corners on faceted ones). */
function liquidRadiusAt(fam, y) {
  return Math.max(0.01, profileRadiusAt(fam.glass, y) - fam.liquid.inset)
}

/** Height of the liquid surface for a fill level (0..1 of the family's max). */
function liquidTop(fam, fillLevel) {
  const { base, max } = fam.liquid
  return base + (max - base) * Math.min(1, Math.max(0.05, fillLevel))
}

const CAVITY_STEPS = 48
/** Inner radius a gel ball may use at each height (inscribed in the liquid's facets). */
function familyCavity(fam) {
  if (!fam.cavity) {
    const { base, max } = fam.liquid
    const segments = fam.flat ? fam.segments : LIQUID_SEGMENTS
    const inscribe = Math.cos(Math.PI / segments)
    fam.cavity = new Float32Array(CAVITY_STEPS + 1)
    for (let s = 0; s <= CAVITY_STEPS; s += 1) fam.cavity[s] = liquidRadiusAt(fam, base + ((max - base) * s) / CAVITY_STEPS) * inscribe
  }
  return fam.cavity
}

function cavityRadius(fam, y) {
  const table = familyCavity(fam)
  const { base, max } = fam.liquid
  const t = Math.min(1, Math.max(0, (y - base) / (max - base))) * CAVITY_STEPS
  const i = Math.min(CAVITY_STEPS - 1, Math.floor(t))
  return table[i] + (table[i + 1] - table[i]) * (t - i)
}

/* --- Geometry builders (run once per family, cached) */

function lathe(points, segments, phi = 0) {
  return new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    segments,
    phi,
  )
}

/** Same surface with flat (faceted) normals. */
function toFlat(geometry) {
  const flat = geometry.toNonIndexed()
  flat.computeVertexNormals()
  geometry.dispose()
  return flat
}

/**
 * Pushes every other lathe column out by `depth` between heights yMin and yMax:
 * knurled grips and crimped crown caps.
 */
function addRidges(geometry, pointCount, [yMin, yMax, depth]) {
  const pos = geometry.attributes.position
  for (let v = 0; v < pos.count; v += 1) {
    if (Math.floor(v / pointCount) % 2 === 0) continue
    const y = pos.getY(v)
    if (y < yMin - 1e-6 || y > yMax + 1e-6) continue
    const x = pos.getX(v)
    const z = pos.getZ(v)
    const r = Math.hypot(x, z)
    if (r < 1e-6) continue
    const k = (r + depth) / r
    pos.setXYZ(v, x * k, y, z * k)
  }
  geometry.computeVertexNormals()
}

/**
 * Merges [geometry, partId, flip] entries into one indexed geometry with an aPart
 * attribute. `flip` reverses winding and normals (the liquid seen from inside).
 */
function mergeParts(entries) {
  let vertexCount = 0
  let indexCount = 0
  for (const [g] of entries) {
    vertexCount += g.attributes.position.count
    indexCount += g.index ? g.index.count : g.attributes.position.count
  }
  const position = new Float32Array(vertexCount * 3)
  const normal = new Float32Array(vertexCount * 3)
  const uv = new Float32Array(vertexCount * 2)
  const part = new Float32Array(vertexCount)
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount)
  let vo = 0
  let io = 0
  for (const [g, id, flip] of entries) {
    const n = g.attributes.position.count
    position.set(g.attributes.position.array, vo * 3)
    const src = g.attributes.normal.array
    for (let k = 0; k < n * 3; k += 1) normal[vo * 3 + k] = flip ? -src[k] : src[k]
    uv.set(g.attributes.uv.array, vo * 2)
    part.fill(id, vo, vo + n)
    const count = g.index ? g.index.count : n
    for (let k = 0; k < count; k += 3) {
      const a = g.index ? g.index.array[k] : k
      const b = g.index ? g.index.array[k + 1] : k + 1
      const c = g.index ? g.index.array[k + 2] : k + 2
      index[io + k] = vo + a
      index[io + k + 1] = vo + (flip ? c : b)
      index[io + k + 2] = vo + (flip ? b : c)
    }
    vo += n
    io += count
  }
  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(position, 3))
  out.setAttribute('normal', new BufferAttribute(normal, 3))
  out.setAttribute('uv', new BufferAttribute(uv, 2))
  out.setAttribute('aPart', new BufferAttribute(part, 1))
  out.setIndex(new BufferAttribute(index, 1))
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

function buildFamily(fam) {
  const { glass: profile, segments, flat = false } = fam
  const facet = (g) => (flat ? toFlat(g) : g)

  // Shell: liquid (back faces, then front) and the glass.
  const glass = facet(lathe(profile, segments))
  const { base, max } = fam.liquid
  const liquidPoints = [
    [0, base],
    ...sampleHeights(profile, base, max, LIQUID_STEPS).map((y) => [liquidRadiusAt(fam, y), y]),
    [0, max],
  ]
  const liquid = facet(lathe(liquidPoints, flat ? segments : LIQUID_SEGMENTS))
  const shell = mergeParts([
    [liquid, SHELL_LIQUID_BACK, true],
    [liquid, SHELL_LIQUID, false],
    [glass, SHELL_GLASS, false],
  ])

  // Parts: caps/stoppers/trim and the label band (same facets as the glass).
  const [labelFrom, labelTo] = fam.label
  const label = facet(lathe(sampleHeights(profile, labelFrom, labelTo, 1).map((y) => [profileRadiusAt(profile, y) + LABEL_GAP, y]), segments))
  const pieces = fam.parts.map(({ part, points, segments: s = 16, phi = 0, ridges, flat: pieceFlat }) => {
    let g = lathe(points, s, phi)
    if (ridges) addRidges(g, points.length, ridges)
    if (pieceFlat) g = toFlat(g)
    return [g, part, false]
  })
  const parts = mergeParts([...pieces, [label, PART_LABEL, false]])

  for (const g of [glass, liquid, label, ...pieces.map(([g]) => g)]) g.dispose()
  return { shell, parts }
}

const familyGeos = {}
/** The shell + parts geometries of a family (built on first use, then shared). */
export function getBottleFamily(id) {
  const fam = BOTTLE_FAMILIES[id] || BOTTLE_FAMILIES.classic
  const key = BOTTLE_FAMILIES[id] ? id : 'classic'
  if (!familyGeos[key]) familyGeos[key] = { id: key, gelCount: fam.gel.count, ...buildFamily(fam) }
  return familyGeos[key]
}

let bottleGeos = null
/**
 * The plain glass of the default (classic) bottle, for simple silhouettes like other
 * players' tumbling bottles.
 */
export function getBottleGeometries() {
  if (!bottleGeos) bottleGeos = { glass: lathe(BOTTLE_FAMILIES.classic.glass, 16) }
  return bottleGeos
}

/* --- Materials (one each, shared by the shop and every BottleModel) */

const SHELL_PARS_VERTEX = /* glsl */ `
attribute float aPart;
uniform vec4 uBottleLook[ ${BOTTLES.length * 3} ];
varying float vBPart;
varying float vBLiq;
varying float vBGlow;
`

const SHELL_LOOK_VERTEX = /* glsl */ `
#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
  int bLook = int( instanceColor.r + 0.5 ) * 3;
#else
  int bLook = 0;
#endif
vec4 bGlass = uBottleLook[ bLook ];
vec4 bFill = uBottleLook[ bLook + 1 ];
vec4 bLevel = uBottleLook[ bLook + 2 ]; // surface height, surface radius, liquid base
bool bLiquid = aPart < 1.5;
bool bCut = bLiquid && position.y > bLevel.x;
#ifdef USE_INSTANCING_COLOR
  vColor = vec4( bLiquid ? bFill.rgb : bGlass.rgb, 1.0 );
#endif
vBPart = aPart;
vBGlow = bLiquid ? bFill.a : 0.0;
vBLiq = clamp( ( min( position.y, bLevel.x ) - bLevel.z ) / max( bLevel.x - bLevel.z, 0.01 ), 0.0, 1.0 );
`

const SHELL_PARS_FRAGMENT = /* glsl */ `
varying float vBPart;
varying float vBLiq;
varying float vBGlow;
`

const SHELL_ALPHA_FRAGMENT = /* glsl */ `
float bRim = 1.0 - abs( dot( normal, normalize( vViewPosition ) ) );
if ( vBPart > 1.5 ) {
  // Glass: clear face-on, denser and brighter towards the silhouette, and never
  // so transparent that its highlights disappear.
  float bRim3 = bRim * bRim * bRim;
  diffuseColor.a = mix( 0.1, 0.62, bRim3 );
  outgoingLight += vec3( 0.3 ) * bRim3 * bRim;
  diffuseColor.a = clamp( max( diffuseColor.a, dot( reflectedLight.directSpecular, vec3( 0.4 ) ) ), 0.0, 1.0 );
} else {
  diffuseColor.a = mix( 0.68, 0.93, bRim );
}
#include <opaque_fragment>
`

let shellMaterial = null
/** Glass + liquid of every bottle (transparent). Per bottle look via setBottleLookAt. */
export function getBottleShellMaterial() {
  if (shellMaterial) return shellMaterial
  const look = []
  const c = new Color()
  for (const b of BOTTLES) {
    const fam = BOTTLE_FAMILIES[bottleFamilyId(b)]
    const top = liquidTop(fam, b.fillLevel)
    c.set(b.glass)
    look.push(new Vector4(c.r, c.g, c.b, 0))
    c.set(b.fill)
    look.push(new Vector4(c.r, c.g, c.b, b.glow))
    look.push(new Vector4(top, liquidRadiusAt(fam, top), fam.liquid.base, 0))
  }
  const uniform = { value: look }
  shellMaterial = new MeshPhongMaterial({
    color: '#ffffff', transparent: true, depthWrite: false, shininess: 110, specular: '#ffffff',
  })
  shellMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uBottleLook = uniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SHELL_PARS_VERTEX}`)
      .replace('#include <color_vertex>', SHELL_LOOK_VERTEX)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        if ( bCut ) objectNormal = vec3( 0.0, aPart < 0.5 ? -1.0 : 1.0, 0.0 );`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        if ( bCut ) {
          // Above the fill line: flatten onto the surface ring.
          float bR = length( transformed.xz );
          transformed.xz *= bR > 1e-5 ? bLevel.y / bR : 0.0;
          transformed.y = bLevel.x;
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SHELL_PARS_FRAGMENT}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if ( vBPart < 1.5 ) diffuseColor.rgb *= mix( 0.62, 1.12, vBLiq );`,
      )
      .replace(
        '#include <specularmap_fragment>',
        `#include <specularmap_fragment>
        specularStrength = vBPart < 1.5 ? 0.3 : 1.0;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Glowing liquids trade some lit colour for emitted colour, so they glow
        // without washing out to white.
        totalEmissiveRadiance += diffuseColor.rgb * vBGlow * 0.6;
        diffuseColor.rgb *= 1.0 - 0.5 * vBGlow;`,
      )
      .replace('#include <opaque_fragment>', SHELL_ALPHA_FRAGMENT)
  }
  shellMaterial.customProgramCacheKey = () => 'bt-bottle-shell-v1'
  return shellMaterial
}

/** Points slot `slot` of a shell InstancedMesh at a bottle's look (colours, fill level). */
export function setBottleLookAt(mesh, slot, bottle) {
  if (!mesh.instanceColor) mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3)
  mesh.instanceColor.setXYZ(slot, bottleLookIndex(bottle), 0, 0)
  mesh.instanceColor.needsUpdate = true
}

const PARTS_FRAGMENT = /* glsl */ `
#ifdef USE_COLOR
  vec3 bTint = vColor.rgb;
#else
  vec3 bTint = vec3( 1.0 );
#endif
float bSpec = 0.55;
if ( vBPart > 2.5 ) {
  bTint = vec3( 0.91, 0.56, 0.07 ); // gold trim
  bSpec = 1.5;
} else if ( vBPart > 1.5 ) {
  // Natural cork, with a little grain.
  float bGrain = fract( sin( dot( floor( vBLocal * 260.0 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
  bTint = vec3( 0.57, 0.33, 0.13 ) * ( 0.82 + 0.3 * bGrain );
  bSpec = 0.04;
} else if ( vBPart > 0.5 ) {
  bTint = mix( bTint, vec3( 1.0 ), 0.35 ); // paper label, lightened from the cap
  bSpec = 0.05;
}
diffuseColor.rgb *= bTint;
`

let partsMaterial = null
/** Caps, stoppers, corks, trim and labels of every bottle (opaque, cap colour per instance). */
export function getBottlePartsMaterial() {
  if (partsMaterial) return partsMaterial
  partsMaterial = new MeshPhongMaterial({ color: '#ffffff', map: getBottleLabelTexture(), shininess: 60, specular: '#ffffff' })
  partsMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying float vBPart;\nvarying vec3 vBLocal;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvBPart = aPart;\nvBLocal = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBPart;\nvarying vec3 vBLocal;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          if ( vBPart > 0.5 && vBPart < 1.5 ) diffuseColor *= texture2D( map, vMapUv );
        #endif`,
      )
      .replace('#include <color_fragment>', PARTS_FRAGMENT)
      .replace('#include <specularmap_fragment>', '#include <specularmap_fragment>\nspecularStrength = bSpec;')
  }
  partsMaterial.customProgramCacheKey = () => 'bt-bottle-parts-v1'
  return partsMaterial
}

/* --- Gel balls */

const gelGeos = {}
/**
 * One low-poly gel ball (radius 1) with smooth normals. LOW gets the 20-triangle
 * icosahedron, the other presets the 80-triangle one.
 */
export function getGelGeometry() {
  const detail = useQuality.getState().preset === 'LOW' ? 0 : 1
  if (!gelGeos[detail]) {
    const g = new IcosahedronGeometry(1, detail)
    g.setAttribute('normal', g.attributes.position.clone())
    gelGeos[detail] = g
  }
  return gelGeos[detail]
}

let gelMaterial = null
/** Glossy, slightly self-lit, so the balls read through the liquid. */
export function getGelMaterial() {
  if (!gelMaterial) {
    gelMaterial = new MeshPhongMaterial({ color: '#ffffff', shininess: 90, specular: '#ffffff' })
    gelMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.3;',
      )
    }
    gelMaterial.customProgramCacheKey = () => 'bt-gel-v1'
  }
  return gelMaterial
}

const GEL_STRIDE = 6

function seedOf(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Where a bottle's gel balls float: per ball a start angle, swirl speed, how far out,
 * height in the liquid, bob phase and size. Same every load (seeded by the bottle id).
 * Positions come from gelBallAt.
 */
export function createGelLayout(bottle) {
  const fam = BOTTLE_FAMILIES[bottleFamilyId(bottle)]
  const count = fam.gel.count
  const rand = mulberry(seedOf(bottle?.id || 'bottle'))
  const data = new Float32Array(count * GEL_STRIDE)
  for (let k = 0; k < count; k += 1) {
    const o = k * GEL_STRIDE
    data[o] = rand() * Math.PI * 2
    data[o + 1] = (rand() < 0.5 ? -1 : 1) * (0.12 + rand() * 0.22)
    data[o + 2] = 0.15 + rand() * 0.85
    data[o + 3] = (k + 0.3 + rand() * 0.4) / count
    data[o + 4] = rand() * Math.PI * 2
    data[o + 5] = fam.gel.radius * (0.75 + rand() * 0.5)
  }
  const [w, h] = bottle?.shape || [1, 1]
  return { fam, count, data, base: fam.liquid.base, top: liquidTop(fam, bottle?.fillLevel ?? 0.7), w, h }
}

/**
 * Ball k's centre at time t, in the bottle's own units (before its [w, h, w] shape
 * scale), written to `out`. Returns the ball's radius (scale it by w). Drifts in a slow
 * swirl and bob, always inside the liquid; the top one floats at the surface.
 */
export function gelBallAt(layout, k, t, out) {
  const d = layout.data
  const o = k * GEL_STRIDE
  const size = d[o + 5]
  const v = (size * layout.w) / layout.h
  const lo = layout.base + v
  const hi = Math.max(lo, layout.top - v * 0.35)
  const y = Math.min(hi, Math.max(lo, lo + (hi - lo) * d[o + 3] + Math.sin(t * 0.8 + d[o + 4]) * 0.02))
  const r = Math.max(0, cavityRadius(layout.fam, y) - size - 0.005) * d[o + 2]
  const a = d[o] + t * d[o + 1]
  out.set(Math.sin(a) * r, y, Math.cos(a) * r)
  return size
}

const _hsl = { h: 0, s: 0, l: 0 }
/** Ball k's colour from the bottle's fill: lighter, darker and a hue-shifted accent. */
export function gelColor(bottle, k, target) {
  target.set(bottle.fill)
  const kind = k % 3
  if (kind === 0) return target.lerp(_white, 0.5)
  if (kind === 1) return target.multiplyScalar(0.45)
  target.getHSL(_hsl)
  return target.setHSL((_hsl.h + 0.14) % 1, Math.min(1, Math.max(0.6, _hsl.s + 0.15)), Math.min(0.68, Math.max(0.5, _hsl.l)))
}

let labelTexture = null
/**
 * The paper label's print, in grey so the per-bottle colour tints it: a light centre
 * band with a star repeated around, darker trim top and bottom.
 */
export function getBottleLabelTexture() {
  if (!labelTexture) {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 128, 32)
    ctx.fillStyle = '#9aa0aa'
    ctx.fillRect(0, 0, 128, 4)
    ctx.fillRect(0, 28, 128, 4)
    ctx.fillStyle = '#d9dce2'
    ctx.fillRect(0, 5, 128, 2)
    ctx.fillRect(0, 25, 128, 2)
    // Two stars around the bottle, so one always faces you.
    for (const cx of [32, 96]) {
      ctx.fillStyle = '#7d8592'
      ctx.beginPath()
      for (let k = 0; k < 10; k += 1) {
        const a = -Math.PI / 2 + (k / 10) * Math.PI * 2
        const r = k % 2 ? 3.4 : 8
        ctx.lineTo(cx + Math.cos(a) * r, 16 + Math.sin(a) * r)
      }
      ctx.closePath()
      ctx.fill()
    }
    labelTexture = new CanvasTexture(canvas)
    labelTexture.colorSpace = SRGBColorSpace
    labelTexture.wrapS = RepeatWrapping
  }
  return labelTexture
}

/** The label's colour for a bottle: its cap colour, lightened like printed paper. */
export function bottleLabelColor(bottle, target) {
  return target.set(bottle.cap).lerp(_white, 0.35)
}
const _white = new Color('#ffffff')

/* ------------------------------------------------------------ Glow textures */

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  draw(canvas.getContext('2d'), size)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

let glowTexture = null
/** Soft round glow, white to transparent. Tinted by material / instance colour. */
export function getGlowTexture() {
  if (!glowTexture) {
    glowTexture = canvasTexture(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.25, 'rgba(255,255,255,0.75)')
      g.addColorStop(0.6, 'rgba(255,255,255,0.2)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    })
  }
  return glowTexture
}

let ringTexture = null
/** A glowing ring: bright edge, soft inside, clear centre. */
export function getRingTexture() {
  if (!ringTexture) {
    ringTexture = canvasTexture(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.55, 'rgba(255,255,255,0.18)')
      g.addColorStop(0.82, 'rgba(255,255,255,1)')
      g.addColorStop(0.9, 'rgba(255,255,255,0.5)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    })
  }
  return ringTexture
}

let beamTexture = null
/** A vertical light beam: bright at the bottom, fading out upwards and at the sides. */
export function getBeamTexture() {
  if (!beamTexture) {
    beamTexture = canvasTexture(64, (ctx, s) => {
      const v = ctx.createLinearGradient(0, s, 0, 0)
      v.addColorStop(0, 'rgba(255,255,255,0.95)')
      v.addColorStop(0.5, 'rgba(255,255,255,0.35)')
      v.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = v
      ctx.fillRect(0, 0, s, s)
      // Thin bright streaks running up the beam.
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 5; i += 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect((i * 13) % s, 0, 3, s)
      }
    })
  }
  return beamTexture
}

let stripeTexture = null
/** Diagonal warning stripes for locked barriers. */
export function getStripeTexture() {
  if (!stripeTexture) {
    stripeTexture = canvasTexture(64, (ctx, s) => {
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(0, 0, s, s)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      for (let i = -s; i < s * 2; i += 16) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i + 8, 0)
        ctx.lineTo(i + 8 - s, s)
        ctx.lineTo(i - s, s)
        ctx.fill()
      }
    })
    stripeTexture.wrapS = RepeatWrapping
    stripeTexture.wrapT = RepeatWrapping
  }
  return stripeTexture
}

/* ----------------------------------------------------------- Label textures */

export const GAME_FONT = '"Fredoka One", "Arial Rounded MT Bold", system-ui, sans-serif'

/**
 * Draws stacked lines of outlined text into a canvas texture for a billboard.
 * 512x128 keeps every label inside the mobile texture budget.
 *
 * @param {{ text: string, size: number, color: string }[]} lines
 */
export function drawLabel(canvas, lines) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const total = lines.reduce((h, l) => h + l.size * 1.08, 0)
  let y = (canvas.height - total) / 2
  for (const line of lines) {
    y += (line.size * 1.08) / 2
    ctx.font = `${line.size}px ${GAME_FONT}`
    ctx.lineWidth = Math.max(4, line.size * 0.2)
    ctx.strokeStyle = 'rgba(20, 16, 40, 0.92)'
    ctx.strokeText(line.text, canvas.width / 2, y)
    ctx.fillStyle = line.color
    ctx.fillText(line.text, canvas.width / 2, y)
    y += (line.size * 1.08) / 2
  }
}

export function createLabelTexture(lines, width = 512, height = 128) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  drawLabel(canvas, lines)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
