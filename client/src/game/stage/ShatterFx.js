import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Mesh,
  Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
} from 'three'

import { stairIndexAtZ, stairTopY } from '@shared/world'

import { gelColor, getGelGeometry, getGelMaterial } from '../materials'

/*
 * The bottle's smash: a fountain of gel balls in the bottle's own gel colours, a burst of
 * glass shards that tumble and glint, and a flash + shockwave ring in the liquid colour.
 *
 *  - gels:   one InstancedMesh (the shared gel geometry and glossy material), fixed pool;
 *  - shards: one InstancedMesh of flat triangles with a tiny shader that fakes glass: a
 *            sun glint, a mirror flash when a shard faces the camera, a rim, translucent;
 *  - flash:  one 8-vertex mesh (a camera-facing starburst + a ring lying on the step),
 *            additive, alive for ~0.5 s.
 *
 * Three draw calls at most, none while nothing is alive. No lights. Everything is a
 * fixed-size typed array rewritten in place; nothing is allocated after creation.
 */

const GEL_G = 20
const GEL_BOUNCE = 0.55
const GEL_LANE = 4.6
const SHARD_G = 22
const SHARD_BOUNCE = 0.4

const _dummy = new Object3D()
const _c = new Color()
const _tint = new Color()
const _white = new Color('#ffffff')

/** Set by stepBody: did the body end the step resting on a step? */
let _rest = false

/**
 * Gravity, lane rails, the stair below and the riser of the stair above, for one body at
 * `ix` (x, y, z) with velocity `v`. Returns the speed it hit the floor with (0 if it
 * didn't); `_rest` says whether it's on the floor.
 */
function stepBody(p, v, ix, r, delta, g, bounce, drag) {
  const oz = p[ix + 2]
  v[ix + 1] -= g * delta
  p[ix] += v[ix] * delta
  p[ix + 1] += v[ix + 1] * delta
  p[ix + 2] += v[ix + 2] * delta
  const lim = GEL_LANE - r
  if (p[ix] > lim) {
    p[ix] = lim
    v[ix] = -Math.abs(v[ix]) * 0.45
  } else if (p[ix] < -lim) {
    p[ix] = -lim
    v[ix] = Math.abs(v[ix]) * 0.45
  }
  let floor = stairTopY(Math.max(0, stairIndexAtZ(p[ix + 2]))) + r
  // Rolled back into the next stair up: bounce off its riser, don't pop up onto it.
  if (floor > p[ix + 1] + 0.3 && stairIndexAtZ(oz) !== stairIndexAtZ(p[ix + 2])) {
    p[ix + 2] = oz
    v[ix + 2] = -v[ix + 2] * 0.4
    floor = stairTopY(Math.max(0, stairIndexAtZ(oz))) + r
  }
  _rest = false
  if (p[ix + 1] <= floor) {
    p[ix + 1] = floor
    const impact = -v[ix + 1]
    if (impact > 1.3) {
      v[ix + 1] = impact * bounce
      v[ix] *= 0.82
      v[ix + 2] *= 0.82
      return impact
    }
    v[ix + 1] = 0
    const k = Math.max(0, 1 - drag * delta)
    v[ix] *= k
    v[ix + 2] *= k
    _rest = true
  }
  return 0
}

const wrapFlat = (a) => a - Math.round(a / Math.PI) * Math.PI

const SHARD_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vN = normalize(mat3(m) * vec3(0.0, 1.0, 0.0));
  vV = cameraPosition - wp.xyz;
  vCol = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const SHARD_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
const vec3 L = vec3(0.4472, 0.7155, 0.5401);
void main() {
  vec3 v = normalize(vV);
  vec3 n = normalize(vN);
  if (dot(n, v) < 0.0) n = -n;
  float d = dot(n, v);
  float rim = pow(1.0 - d, 2.0);
  float glint = pow(max(dot(reflect(-v, n), L), 0.0), 18.0);
  float flash = smoothstep(0.9, 1.0, d);
  float lit = 0.62 + 0.38 * dot(n, L);
  vec3 col = vCol * lit * 0.85 + vCol * rim * 0.6 + vec3(1.0) * (glint * 1.6 + flash * 1.2);
  float a = clamp(0.62 + rim * 0.3 + glint + flash, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`

const FLASH_VERT = /* glsl */ `
attribute float aKind;
uniform vec3 uCenter;
uniform float uBurst;
uniform float uRing;
varying vec2 vUv;
varying float vKind;
void main() {
  vUv = position.xy;
  vKind = aKind;
  if (aKind < 0.5) {
    // Camera-facing, nudged towards the camera so the step doesn't slice through it.
    vec4 mv = viewMatrix * vec4(uCenter, 1.0);
    mv.xy += position.xy * uBurst;
    mv.z += uBurst * 0.55;
    gl_Position = projectionMatrix * mv;
  } else {
    vec3 w = uCenter + vec3(position.x, 0.04, position.y) * uRing;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
}
`

const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uT;
varying vec2 vUv;
varying float vKind;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float e = 1.0 - pow(1.0 - uT, 2.4);
  float fadeOut = pow(1.0 - uT, 1.6);
  vec3 rgb;
  if (vKind < 0.5) {
    float glow = exp(-r * r * 7.0) * pow(1.0 - uT, 2.4);
    float ang = atan(vUv.y, vUv.x);
    float rays = pow(abs(cos(ang * 4.0 + uT * 2.0)), 30.0) * exp(-r * 3.6) * pow(1.0 - uT, 1.8);
    float ring = exp(-pow((r - (0.2 + 0.75 * e)) * 10.0, 2.0)) * fadeOut;
    rgb = uColor * (glow * 0.95 + ring * 0.8) + vec3(1.0) * (glow * glow * 0.5 + rays * 0.55);
  } else {
    float ring = exp(-pow((r - (0.1 + 0.9 * e)) * 9.0, 2.0)) * fadeOut;
    rgb = uColor * ring * 0.9 + vec3(1.0) * ring * ring * 0.2;
  }
  gl_FragColor = vec4(rgb, 1.0);
  #include <colorspace_fragment>
}
`

/**
 * `gels` / `shards`: pool sizes (24 / 24 on LOW; ~64 / ~72 where particles are on).
 * `flash`: the burst flash and ring.
 */
export function createShatterFx({ gels = 24, shards = 24, flash = true } = {}) {
  const G = gels
  const S = shards

  // --- Gel balls: the shared glossy material, a colour per instance.
  const gelMesh = new InstancedMesh(getGelGeometry(), getGelMaterial(), G)
  gelMesh.frustumCulled = false
  const gp = new Float32Array(G * 3)
  const gv = new Float32Array(G * 3)
  const gAge = new Float32Array(G)
  const gLife = new Float32Array(G)
  const gR = new Float32Array(G)
  const gSq = new Float32Array(G)
  let gLive = 0

  // --- Shards: flat triangles in the XZ plane (rotation 0 = lying on the step).
  const tri = new BufferGeometry()
  tri.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, -0.62, -0.42, 0, 0.36, 0.46, 0, 0.3]), 3),
  )
  const shardMat = new ShaderMaterial({
    vertexShader: SHARD_VERT,
    fragmentShader: SHARD_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  })
  const shardMesh = new InstancedMesh(tri, shardMat, S)
  shardMesh.frustumCulled = false
  shardMesh.renderOrder = 2
  const sp = new Float32Array(S * 3)
  const sv = new Float32Array(S * 3)
  const sa = new Float32Array(S * 3) // euler angles
  const sw = new Float32Array(S * 3) // angular velocity
  const sAge = new Float32Array(S)
  const sLife = new Float32Array(S)
  const sSize = new Float32Array(S * 3) // x, y, z scale
  const sSettled = new Uint8Array(S)
  let sLive = 0

  for (const mesh of [gelMesh, shardMesh]) {
    const n = mesh.count
    _dummy.scale.set(0, 0, 0)
    _dummy.position.set(0, 0, 0)
    _dummy.rotation.set(0, 0, 0)
    _dummy.updateMatrix()
    for (let i = 0; i < n; i += 1) {
      mesh.setMatrixAt(i, _dummy.matrix)
      mesh.setColorAt(i, _white)
    }
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  }

  // --- Flash: a camera-facing starburst (kind 0) and a ring on the step (kind 1).
  let flashMesh = null
  let flashMat = null
  let flashGeo = null
  let flashT = -1
  let flashScale = 1
  if (flash) {
    flashGeo = new BufferGeometry()
    flashGeo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    )
    flashGeo.setAttribute('aKind', new BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]), 1))
    flashGeo.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]), 1))
    flashMat = new ShaderMaterial({
      uniforms: {
        uCenter: { value: gelMesh.position.clone() },
        uColor: { value: new Color('#ffffff') },
        uT: { value: 0 },
        uBurst: { value: 1 },
        uRing: { value: 1 },
      },
      vertexShader: FLASH_VERT,
      fragmentShader: FLASH_FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    })
    flashMesh = new Mesh(flashGeo, flashMat)
    flashMesh.frustumCulled = false
    flashMesh.renderOrder = 3
    flashMesh.matrixAutoUpdate = false
  }

  /** Hides the pools and the flash (the next burst re-seeds everything). */
  function clear() {
    gAge.fill(0)
    gLife.fill(0)
    sAge.fill(0)
    sLife.fill(0)
    gLive = 0
    sLive = 0
    flashT = -1
    gelMesh.visible = false
    shardMesh.visible = false
    if (flashMesh) flashMesh.visible = false
  }

  return {
    gels: gelMesh,
    shards: shardMesh,
    flash: flashMesh,
    clear,

    /**
     * The smash at (x, y, z) of a bottle of liquid/glass colours and `radius` (world
     * units): all of both pools fly at once. `view` is the camera's distance from it:
     * the chase camera trails a fast bottle by 20 units, so the pieces are drawn bigger
     * (and fly wider) the further away it is, to read as clearly.
     */
    burst(x, y, z, bottle, radius, view = 12) {
      const near = Math.min(2.4, Math.max(1, view / 11))
      const s = Math.max(0.6, radius / 0.35) * near
      const fly = 0.8 + 0.2 * near
      // Gel balls: an arc outward and up, a little downhill (-Z) so they tumble on down.
      for (let k = 0; k < G; k += 1) {
        const ix = k * 3
        const a = Math.random() * Math.PI * 2
        const o = Math.random() * radius * 0.5
        gp[ix] = x + Math.cos(a) * o
        gp[ix + 1] = y + (Math.random() - 0.3) * radius * 0.5
        gp[ix + 2] = z + Math.sin(a) * o
        const sp2 = 1.4 + Math.pow(Math.random(), 0.7) * 5.8
        gv[ix] = Math.cos(a) * sp2 * fly
        gv[ix + 1] = (4.5 + Math.random() * 7) * fly
        gv[ix + 2] = Math.sin(a) * sp2 * fly - 1.8
        gAge[k] = 0
        gLife[k] = 3.2 + Math.random() * 1.1
        gR[k] = (0.11 + Math.random() * Math.random() * 0.12 + Math.random() * 0.05) * (0.85 + 0.15 * s) * near
        gSq[k] = 0
        gelMesh.setColorAt(k, gelColor(bottle, k, _c))
      }
      gelMesh.instanceColor.needsUpdate = true
      gLive = G
      gelMesh.visible = true

      // Shards: glass-white with a hint of the liquid colour, flying out fast, spinning.
      _tint.set(bottle.fill)
      for (let k = 0; k < S; k += 1) {
        const ix = k * 3
        const a = Math.random() * Math.PI * 2
        const o = Math.random() * radius * 0.6
        sp[ix] = x + Math.cos(a) * o
        sp[ix + 1] = y + (Math.random() - 0.2) * radius
        sp[ix + 2] = z + Math.sin(a) * o
        const fast = Math.random() < 0.3
        const speed = (fast ? 6 : 2.2) + Math.random() * (fast ? 5 : 4.5)
        sv[ix] = Math.cos(a) * speed * fly
        sv[ix + 1] = (3.5 + Math.random() * 7.5) * fly
        sv[ix + 2] = Math.sin(a) * speed * fly - 1.2
        for (let j = 0; j < 3; j += 1) {
          sa[ix + j] = Math.random() * 6.28
          sw[ix + j] = (Math.random() - 0.5) * 2 * (8 + Math.random() * 14)
        }
        sAge[k] = 0
        sLife[k] = 1.7 + Math.random() * 0.9
        sSettled[k] = 0
        const size = (0.22 + Math.random() * Math.random() * 0.5 + Math.random() * 0.12) * (0.8 + 0.2 * s) * near
        sSize[ix] = size * (0.6 + Math.random() * 0.8)
        sSize[ix + 1] = size
        sSize[ix + 2] = size * (0.6 + Math.random() * 0.8)
        // Mostly clear glass; a few pieces carry more of the liquid colour.
        const t = Math.random() < 0.2 ? 0.55 + Math.random() * 0.3 : 0.18 + Math.random() * 0.22
        _c.set(bottle.glass).lerp(_tint, t)
        shardMesh.setColorAt(k, _c)
      }
      shardMesh.instanceColor.needsUpdate = true
      sLive = S
      shardMesh.visible = true

      if (flashMesh) {
        flashMat.uniforms.uCenter.value.set(x, y, z)
        flashMat.uniforms.uColor.value.set(bottle.fill).lerp(_white, 0.1)
        flashScale = Math.max(0.6, radius / 0.35) * Math.sqrt(near)
        flashT = 0
        flashMesh.visible = true
      }
    },

    /** Advances everything by `delta` seconds. */
    update(delta) {
      // --- Gel balls.
      if (gLive > 0) {
        let live = 0
        for (let i = 0; i < G; i += 1) {
          const life = gLife[i]
          if (gAge[i] >= life) continue
          const age = (gAge[i] += delta)
          if (age >= life) {
            _dummy.scale.set(0, 0, 0)
            _dummy.updateMatrix()
            gelMesh.setMatrixAt(i, _dummy.matrix)
            continue
          }
          live += 1
          const ix = i * 3
          const r = gR[i]
          const impact = stepBody(gp, gv, ix, r, delta, GEL_G, GEL_BOUNCE, 1.6)
          if (impact > 0) gSq[i] = Math.min(1, impact / 7)
          const sq = gSq[i]
          gSq[i] = Math.max(0, sq - delta * 6)
          const k = Math.min(1, age / 0.06) * Math.min(1, (life - age) / 0.5)
          const sy = r * k * (1 - sq * 0.35)
          const sxz = r * k * (1 + sq * 0.25)
          // Keep the (squashed) ball sitting on its contact point.
          _dummy.position.set(gp[ix], gp[ix + 1] - r + sy, gp[ix + 2])
          _dummy.rotation.set(0, 0, 0)
          _dummy.scale.set(sxz, sy, sxz)
          _dummy.updateMatrix()
          gelMesh.setMatrixAt(i, _dummy.matrix)
        }
        gLive = live
        gelMesh.instanceMatrix.needsUpdate = true
      }
      gelMesh.visible = gLive > 0

      // --- Shards.
      if (sLive > 0) {
        let live = 0
        const flatten = Math.min(1, delta * 14)
        for (let i = 0; i < S; i += 1) {
          const life = sLife[i]
          if (sAge[i] >= life) continue
          const age = (sAge[i] += delta)
          if (age >= life) {
            _dummy.scale.set(0, 0, 0)
            _dummy.updateMatrix()
            shardMesh.setMatrixAt(i, _dummy.matrix)
            continue
          }
          live += 1
          const ix = i * 3
          if (!sSettled[i]) {
            const impact = stepBody(sp, sv, ix, 0.05, delta, SHARD_G, SHARD_BOUNCE, 4)
            sa[ix] += sw[ix] * delta
            sa[ix + 1] += sw[ix + 1] * delta
            sa[ix + 2] += sw[ix + 2] * delta
            if (impact > 0) {
              // A tumbling piece knocks and loses most of its spin.
              sw[ix] *= 0.45
              sw[ix + 1] *= 0.6
              sw[ix + 2] *= 0.45
            }
            if (_rest && Math.abs(sv[ix]) + Math.abs(sv[ix + 2]) < 1.2) sSettled[i] = 1
          } else {
            // Lying on the step: ease flat and stop.
            sa[ix] += (0 - wrapFlat(sa[ix])) * flatten
            sa[ix + 2] += (0 - wrapFlat(sa[ix + 2])) * flatten
            sa[ix] = wrapFlat(sa[ix])
            sa[ix + 2] = wrapFlat(sa[ix + 2])
          }
          const k = Math.min(1, age / 0.05) * Math.min(1, (life - age) / 0.45)
          _dummy.position.set(sp[ix], sp[ix + 1], sp[ix + 2])
          _dummy.rotation.set(sa[ix], sa[ix + 1], sa[ix + 2])
          _dummy.scale.set(sSize[ix] * k, sSize[ix + 1] * k, sSize[ix + 2] * k)
          _dummy.updateMatrix()
          shardMesh.setMatrixAt(i, _dummy.matrix)
        }
        sLive = live
        shardMesh.instanceMatrix.needsUpdate = true
      }
      shardMesh.visible = sLive > 0

      // --- Flash.
      if (flashMesh) {
        if (flashT >= 0) {
          flashT += delta / 0.5
          if (flashT >= 1) {
            flashT = -1
          } else {
            const u = flashMat.uniforms
            const e = 1 - Math.pow(1 - flashT, 2)
            u.uT.value = flashT
            u.uBurst.value = (1.0 + 2.0 * e) * flashScale
            u.uRing.value = (0.8 + 3.4 * e) * flashScale
          }
        }
        flashMesh.visible = flashT >= 0
      }
    },

    /** True while anything of the smash is still on screen. */
    get active() {
      return gLive > 0 || sLive > 0 || flashT >= 0
    },

    /** Frees what this effect owns (the gel geometry and material are shared). */
    dispose() {
      gelMesh.dispose()
      shardMesh.dispose()
      tri.dispose()
      shardMat.dispose()
      if (flashMesh) {
        flashGeo.dispose()
        flashMat.dispose()
      }
    },
  }
}
