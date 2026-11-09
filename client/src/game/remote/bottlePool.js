import { Color, Group, InstancedMesh, Matrix4, Vector3 } from 'three'

import { BOTTLES } from '@shared/balance'

import {
  bottleFamilyId,
  createGelLayout,
  gelBallAt,
  gelColor,
  getBottleFamily,
  getBottlePartsMaterial,
  getBottleShellMaterial,
  getGelGeometry,
  getGelMaterial,
  setBottleLookAt,
} from '../materials'

/**
 * Other players' bottles - on their backs, in their hands, bouncing down a training pit
 * - drawn exactly like BottleModel (same family geometry, shared materials, per-bottle
 * look by instance) but pooled: one InstancedMesh each for shell, parts and gel balls
 * per bottle family, shared by every remote player. Only the families someone is
 * carrying draw (2-3 calls each, no shadow casting), however many players there are;
 * nothing is allocated after creation.
 */

const _m = new Matrix4()
const _s = new Matrix4()
const _v = new Vector3()
const WHITE = new Color('#ffffff')

/** A pool holding up to `capacity` bottles of every family. */
export function createBottlePool(capacity) {
  const group = new Group()
  const families = new Map()
  const looks = new Map()
  for (const bottle of BOTTLES) {
    const id = bottleFamilyId(bottle)
    let fam = families.get(id)
    if (!fam) {
      const geo = getBottleFamily(id)
      const shell = new InstancedMesh(geo.shell, getBottleShellMaterial(), capacity)
      const parts = new InstancedMesh(geo.parts, getBottlePartsMaterial(), capacity)
      const gel = new InstancedMesh(getGelGeometry(), getGelMaterial(), capacity * geo.gelCount)
      // Instance attributes exist before the first draw, so the shaders compile with them.
      setBottleLookAt(shell, 0, bottle)
      parts.setColorAt(0, WHITE)
      gel.setColorAt(0, WHITE)
      for (const mesh of [shell, parts, gel]) {
        mesh.frustumCulled = false
        mesh.count = 0
        mesh.visible = false
        group.add(mesh)
      }
      // No shadows: a bottle on someone's back sits in their own shadow anyway, and
      // with every family in use that's 14 draw calls saved on the shadow pass.
      shell.renderOrder = 1
      fam = { shell, parts, gel, n: 0, g: 0, capacity, gelCapacity: capacity * geo.gelCount }
      families.set(id, fam)
    }
    const layout = createGelLayout(bottle)
    looks.set(bottle.id, {
      bottle,
      fam,
      cap: new Color(bottle.cap),
      gels: Array.from({ length: layout.count }, (_, k) => gelColor(bottle, k, new Color())),
      layout,
    })
  }
  return { group, families, looks, fallback: looks.get(BOTTLES[0].id) }
}

/** Starts a frame: every slot free. */
export function beginBottles(pool) {
  for (const fam of pool.families.values()) {
    fam.n = 0
    fam.g = 0
  }
}

/**
 * Draws bottle `bottleId` with its base at `base` (a world matrix; the model is ~1 unit
 * tall, base at the origin, like BottleModel), gel balls swirling at time `t` if `gel`.
 */
export function addBottle(pool, bottleId, base, t, gel) {
  const look = pool.looks.get(bottleId) || pool.fallback
  const fam = look.fam
  if (fam.n >= fam.capacity) return
  const [w, h] = look.bottle.shape
  _m.copy(base).multiply(_s.makeScale(w, h, w))
  fam.shell.setMatrixAt(fam.n, _m)
  setBottleLookAt(fam.shell, fam.n, look.bottle)
  fam.parts.setMatrixAt(fam.n, _m)
  fam.parts.setColorAt(fam.n, look.cap)
  fam.n += 1
  if (!gel) return
  const layout = look.layout
  for (let k = 0; k < layout.count && fam.g < fam.gelCapacity; k += 1) {
    // As BottleModel.placeGel: outside the shape scale, so the balls stay round.
    const size = gelBallAt(layout, k, t, _v) * w
    _v.set(_v.x * w, _v.y * h, _v.z * w)
    _s.makeScale(size, size, size).setPosition(_v)
    _m.multiplyMatrices(base, _s)
    fam.gel.setMatrixAt(fam.g, _m)
    fam.gel.setColorAt(fam.g, look.gels[k])
    fam.g += 1
  }
}

/** Ends a frame: only families in use draw. */
export function endBottles(pool) {
  for (const fam of pool.families.values()) {
    fam.shell.count = fam.n
    fam.parts.count = fam.n
    fam.gel.count = fam.g
    fam.shell.visible = fam.n > 0
    fam.parts.visible = fam.n > 0
    fam.gel.visible = fam.g > 0
    if (fam.n > 0) {
      fam.shell.instanceMatrix.needsUpdate = true
      fam.parts.instanceMatrix.needsUpdate = true
      fam.parts.instanceColor.needsUpdate = true
    }
    if (fam.g > 0) {
      fam.gel.instanceMatrix.needsUpdate = true
      fam.gel.instanceColor.needsUpdate = true
    }
  }
}

/**
 * Frees the pool's GPU instance buffers (geometry and materials are shared, and stay).
 * The meshes stay in the pool's group: if it's drawn again (React re-running effects),
 * three uploads the buffers again.
 */
export function disposeBottlePool(pool) {
  for (const fam of pool.families.values()) {
    fam.shell.dispose()
    fam.parts.dispose()
    fam.gel.dispose()
  }
}
