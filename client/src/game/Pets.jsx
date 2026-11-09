import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, InstancedMesh, MeshLambertMaterial, Object3D, Vector3 } from 'three'

import { MAX_EQUIPPED_PETS, PETS } from '@shared/balance'

import { useGame } from '../store/game'
import { getUnitBox } from './materials'
import { lobbyIsFar, runtime } from './runtime'

const LOCAL = MAX_EQUIPPED_PETS
/** Room for everyone else's pets too: 7 other players x 3. */
const REMOTE = 21
const MAX = LOCAL + REMOTE

/** Where each of your pets trails you (player-local: x across, z behind). */
const SLOT_OFFSETS = [
  [-1.4, 1.3],
  [1.4, 1.3],
  [0, 2.3],
]
const EAR_SHAPES = {
  point: { sx: 0.16, sy: 0.22, sz: 0.1, y: 0.42, x: 0.18, tilt: 0 },
  tall: { sx: 0.12, sy: 0.42, sz: 0.1, y: 0.52, x: 0.13, tilt: 0 },
  flop: { sx: 0.12, sy: 0.3, sz: 0.18, y: 0.18, x: 0.36, tilt: 0.5 },
  none: { sx: 0, sy: 0, sz: 0, y: 0, x: 0, tilt: 0 },
}
const EYE = '#111827'

const _dummy = new Object3D()
const _color = new Color()

function hideSlot(meshes, i) {
  _dummy.scale.setScalar(0)
  _dummy.updateMatrix()
  meshes.body.setMatrixAt(i, _dummy.matrix)
  for (let e = 0; e < 2; e += 1) {
    meshes.ears.setMatrixAt(i * 2 + e, _dummy.matrix)
    meshes.eyes.setMatrixAt(i * 2 + e, _dummy.matrix)
  }
}

/**
 * Draws one pet: a hopping cube with ears and eyes. `hop` is 0..1 through a hop
 * (squash on landing, stretch in the air); `lean` tips it into its run.
 */
function writePet(meshes, i, def, x, y, z, yaw, hop, lean, blink) {
  const air = Math.sin(hop * Math.PI)
  const squash = hop < 0.12 ? 1 - (0.12 - hop) * 2.2 : 1 + air * 0.12
  const baseY = y + 0.35 + air * 0.45
  _dummy.position.set(x, baseY, z)
  _dummy.rotation.set(lean, yaw, 0)
  _dummy.scale.set(0.7 / Math.sqrt(squash), 0.62 * squash, 0.7 / Math.sqrt(squash))
  _dummy.updateMatrix()
  meshes.body.setMatrixAt(i, _dummy.matrix)

  const ear = EAR_SHAPES[def.ears] || EAR_SHAPES.none
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  const top = 0.62 * squash
  for (let e = 0; e < 2; e += 1) {
    const side = e === 0 ? -1 : 1
    // Ears flop back a little while airborne.
    _dummy.position.set(x + side * ear.x * c, baseY + ear.y * (top / 0.62), z - side * ear.x * s)
    _dummy.rotation.set(-air * 0.35, yaw, side * ear.tilt)
    _dummy.scale.set(ear.sx, ear.sy, ear.sz)
    _dummy.updateMatrix()
    meshes.ears.setMatrixAt(i * 2 + e, _dummy.matrix)
    const lx = side * 0.15
    const lz = 0.36 / Math.sqrt(squash)
    _dummy.position.set(x + lx * c + lz * s, baseY + 0.08 * squash, z - lx * s + lz * c)
    _dummy.rotation.set(0, yaw, 0)
    _dummy.scale.set(0.09, blink ? 0.02 : 0.12, 0.02)
    _dummy.updateMatrix()
    meshes.eyes.setMatrixAt(i * 2 + e, _dummy.matrix)
  }
}

/**
 * Every pet in the lobby - yours and other players' - in three instanced meshes
 * (bodies, ears, eyes): three draw calls however many there are.
 */
export function Pets() {
  const pets = useGame((s) => s.profile.pets)
  const equipped = useGame((s) => s.profile.equippedPets)
  const localIds = useMemo(() => equipped.map((uid) => pets.find((p) => p.uid === uid)?.id).filter(Boolean), [pets, equipped])

  const meshes = useMemo(() => {
    const make = (n) => {
      const m = new InstancedMesh(getUnitBox(), new MeshLambertMaterial({ color: '#ffffff' }), n)
      m.frustumCulled = false
      m.castShadow = true
      for (let i = 0; i < n; i += 1) m.setColorAt(i, _color.set('#ffffff'))
      return m
    }
    const m = { body: make(MAX), ears: make(MAX * 2), eyes: make(MAX * 2) }
    for (let i = 0; i < MAX * 2; i += 1) m.eyes.setColorAt(i, _color.set(EYE))
    m.eyes.castShadow = false
    return m
  }, [])

  /** Pet id painted into each slot, so colours change only when a slot's pet does. */
  const painted = useMemo(() => new Array(MAX).fill(''), [])

  useEffect(
    () => () => {
      for (const m of Object.values(meshes)) {
        m.material.dispose()
        m.dispose()
      }
    },
    [meshes],
  )

  // Follow state for your own pets, allocated once.
  const follow = useMemo(
    () => Array.from({ length: LOCAL }, (_, i) => ({ pos: new Vector3(runtime.playerPos.x, 0, runtime.playerPos.z), yaw: 0, phase: i * 0.33 })),
    [],
  )

  const paint = (i, id) => {
    if (painted[i] === id) return false
    painted[i] = id
    const def = PETS[id]
    meshes.body.setColorAt(i, _color.set(def.body))
    meshes.ears.setColorAt(i * 2, _color.set(def.ear))
    meshes.ears.setColorAt(i * 2 + 1, _color.set(def.ear))
    return true
  }

  useFrame(({ clock, camera }, rawDelta) => {
    const far = lobbyIsFar(camera)
    meshes.body.visible = !far
    meshes.ears.visible = !far
    meshes.eyes.visible = !far
    if (far) return
    const delta = Math.min(rawDelta, 0.05)
    const t = clock.elapsedTime
    const p = runtime.playerPos
    const yaw = runtime.playerYaw
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    const moving = runtime.playerSpeed > 0.5
    let colors = false
    let shown = 0

    for (let i = 0; i < LOCAL; i += 1) {
      const id = localIds[i]
      if (!id) {
        hideSlot(meshes, i)
        continue
      }
      colors = paint(i, id) || colors
      const st = follow[i]
      const [ox, oz] = SLOT_OFFSETS[i]
      const tx = p.x + ox * cos - oz * sin
      const tz = p.z - ox * sin - oz * cos
      const dx = tx - st.pos.x
      const dz = tz - st.pos.z
      const k = 1 - Math.pow(0.02, delta)
      st.pos.x += dx * k
      st.pos.z += dz * k
      if (dx * dx + dz * dz > 0.01) st.yaw = Math.atan2(dx, dz)
      else st.yaw += (yaw - st.yaw) * k * 0.3
      // Hops while following; a slow bounce while waiting.
      st.phase = (st.phase + delta * (moving ? 2.4 : 0.8)) % 1
      const blink = (t + i * 1.7) % 3.4 < 0.12
      shown += 1
      writePet(meshes, i, PETS[id], st.pos.x, p.y, st.pos.z, st.yaw, st.phase, moving ? 0.18 : 0, blink)
    }

    // Other players' pets, positioned by RemotePlayers this frame (or the last).
    const remote = runtime.remotePets
    for (let r = 0; r < REMOTE; r += 1) {
      const slot = LOCAL + r
      const pet = remote[r]
      if (!pet || !PETS[pet.id]) {
        hideSlot(meshes, slot)
        continue
      }
      colors = paint(slot, pet.id) || colors
      const blink = (t + r * 0.9) % 3.1 < 0.12
      shown += 1
      writePet(meshes, slot, PETS[pet.id], pet.position.x, pet.position.y, pet.position.z, pet.yaw, pet.hop, pet.hop > 0 ? 0.15 : 0, blink)
    }

    // No pets at all: three fewer draw calls.
    meshes.body.visible = shown > 0
    meshes.ears.visible = shown > 0
    meshes.eyes.visible = shown > 0
    meshes.body.instanceMatrix.needsUpdate = true
    meshes.ears.instanceMatrix.needsUpdate = true
    meshes.eyes.instanceMatrix.needsUpdate = true
    if (colors) {
      meshes.body.instanceColor.needsUpdate = true
      meshes.ears.instanceColor.needsUpdate = true
    }
  })

  return (
    <>
      <primitive object={meshes.body} />
      <primitive object={meshes.ears} />
      <primitive object={meshes.eyes} />
    </>
  )
}

export default Pets
