import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
} from 'three'

import { getGlowTexture } from './materials'

/*
 * Shared pieces for glowing effects (shop and egg auras, the player ring, sparkles):
 * an additive material, a flat disc, an open beam, and a fixed pool of sparkle points
 * rewritten in place every frame. Nothing here allocates per frame.
 */

export function glowMaterial(map, extra) {
  return new MeshBasicMaterial({
    map, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, ...extra,
  })
}

let discGeometry = null
/** A flat unit quad facing up (shared, never disposed - like the unit box). */
export function getDiscGeometry() {
  if (!discGeometry) {
    discGeometry = new PlaneGeometry(1, 1)
    discGeometry.rotateX(-Math.PI / 2)
  }
  return discGeometry
}

let beamGeometry = null
/** An open unit cylinder standing on the origin. */
export function getBeamGeometry() {
  if (!beamGeometry) {
    beamGeometry = new CylinderGeometry(1, 1, 1, 18, 1, true)
    beamGeometry.translate(0, 0.5, 0)
  }
  return beamGeometry
}

/** A fixed pool of additive sparkle points. Positions and colours are rewritten in place. */
export function createSparkles(count, size) {
  const geometry = new BufferGeometry()
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  geometry.setAttribute('position', new BufferAttribute(pos, 3))
  geometry.setAttribute('color', new BufferAttribute(col, 3))
  const material = new PointsMaterial({
    size, map: getGlowTexture(), vertexColors: true, transparent: true, blending: AdditiveBlending,
    depthWrite: false, toneMapped: false, sizeAttenuation: true,
  })
  const points = new Points(geometry, material)
  points.frustumCulled = false
  const seed = new Float32Array(count)
  for (let i = 0; i < count; i += 1) seed[i] = (i * 0.618034) % 1
  return { points, pos, col, seed, count }
}

/**
 * Moves sparkle j of `sp` around an anchor: it spirals up from `y` over `rise` units
 * and fades in and out on the way. `color` is the base colour.
 */
export function placeSparkle(sp, j, t, x, y, z, radius, rise, color) {
  const s = sp.seed[j]
  const life = (t * 0.55 + s) % 1
  const angle = s * 6.2832 + t * 0.9
  const r = radius * (0.55 + 0.45 * ((s * 7.31) % 1))
  const ix = j * 3
  sp.pos[ix] = x + Math.cos(angle) * r
  sp.pos[ix + 1] = y + life * rise
  sp.pos[ix + 2] = z + Math.sin(angle) * r
  const k = Math.sin(life * Math.PI)
  sp.col[ix] = color.r * k
  sp.col[ix + 1] = color.g * k
  sp.col[ix + 2] = color.b * k
}

export function disposeSparkles(sp) {
  sp.points.geometry.dispose()
  sp.points.material.dispose()
}
