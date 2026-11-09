import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, DoubleSide, InstancedMesh, Object3D } from 'three'

import { BOTTLES, PADS } from '@shared/balance'
import { bottleById } from '@shared/logic'
import { groundHeightAt, PAD_HEIGHT, padCenterZ, PEDESTALS, PIT } from '@shared/world'

import { useGame } from '../store/game'
import BottleModel from './BottleModel'
import { createSparkles, disposeSparkles, getBeamGeometry, getDiscGeometry, glowMaterial, placeSparkle } from './glow'
import { getBeamTexture, getGlowTexture, getRingTexture } from './materials'
import { BURST_SECONDS, EQUIPPED, LOCKED, NEXT, NEXT_AFFORDABLE, OWNED, shopBursts, shopKey } from './shopState'
import { sfx } from './audio'
import { PLAYER_SCALE } from './playerSize'
import { lobbyIsFar, runtime } from './runtime'
import { PRESETS, useQuality } from './stores/quality'

/*
 * Auras: the light that says "this one matters".
 *  - ShopAura: a glow pool and a light beam on every shop pedestal, coloured by what
 *    the bottle is to you (equipped / next to buy / owned / locked). Two draw calls for
 *    all 16, plus one for sparkles on MEDIUM / HIGH.
 *  - PlayerAura: a glowing ring under you in your bottle's colour (one draw call), with
 *    sparkles on MEDIUM / HIGH.
 *  - BackBottle: your equipped bottle slung on your back while you walk around.
 * Everything is instanced or a single mesh, and nothing allocates per frame.
 */

const _dummy = new Object3D()
const _color = new Color()
const GOLD = new Color('#ffc93c')
const DIM = new Color('#8b93a7')

/* ------------------------------------------------------------------ Shop */


const SHOP_SPARKLES = 36

export function ShopAura() {
  const key = useGame(shopKey)
  const particles = useQuality((s) => PRESETS[s.preset].particles)

  const fx = useMemo(() => {
    const n = BOTTLES.length
    const discs = new InstancedMesh(getDiscGeometry(), glowMaterial(getGlowTexture(), { polygonOffset: true, polygonOffsetFactor: -2 }), n)
    const beams = new InstancedMesh(getBeamGeometry(), glowMaterial(getBeamTexture(), { side: DoubleSide }), n)
    for (const m of [discs, beams]) {
      m.frustumCulled = false
      m.renderOrder = 3
      for (let i = 0; i < n; i += 1) m.setColorAt(i, DIM)
    }
    return { discs, beams, state: new Uint8Array(n), sparkles: particles ? createSparkles(SHOP_SPARKLES, 0.26) : null, sparkleAt: [-1, -1], equippedColor: new Color() }
  }, [particles])

  useEffect(
    () => () => {
      for (const m of [fx.discs, fx.beams]) {
        m.material.dispose()
        m.dispose()
      }
      if (fx.sparkles) disposeSparkles(fx.sparkles)
    },
    [fx],
  )

  // Recolour only when what you own / can afford changes - never per frame.
  useEffect(() => {
    fx.sparkleAt[0] = -1
    fx.sparkleAt[1] = -1
    for (let i = 0; i < BOTTLES.length; i += 1) {
      const st = key.charCodeAt(i) - 48
      // Just unlocked (it was the one to buy, now it's yours): the burst and a fanfare.
      const was = fx.state[i]
      if ((was === NEXT || was === NEXT_AFFORDABLE) && (st === OWNED || st === EQUIPPED)) {
        shopBursts[i] = performance.now()
        sfx.unlock()
      }
      fx.state[i] = st
      const b = BOTTLES[i]
      if (st === EQUIPPED) {
        _color.set(b.fill)
        fx.equippedColor.copy(_color)
        fx.sparkleAt[0] = i
      } else if (st === NEXT_AFFORDABLE || st === NEXT) {
        _color.copy(GOLD).multiplyScalar(st === NEXT ? 0.5 : 0.8)
        fx.sparkleAt[1] = i
      } else if (st === OWNED) _color.set(b.fill).multiplyScalar(0.5)
      else _color.copy(DIM).multiplyScalar(0.16)
      fx.discs.setColorAt(i, _color)
      fx.beams.setColorAt(i, _color)
    }
    fx.discs.instanceColor.needsUpdate = true
    fx.beams.instanceColor.needsUpdate = true
  }, [key, fx])

  useFrame(({ clock, camera }) => {
    const far = lobbyIsFar(camera)
    fx.discs.visible = !far
    fx.beams.visible = !far
    if (fx.sparkles) fx.sparkles.points.visible = !far
    if (far) return
    const t = clock.elapsedTime
    const now = performance.now()
    for (let i = 0; i < BOTTLES.length; i += 1) {
      const st = fx.state[i]
      const p = PEDESTALS[i]
      // 0..1 through an unlock burst, or 1 when there's none.
      const burst = shopBursts[i] ? Math.min(1, (now - shopBursts[i]) / 1000 / BURST_SECONDS) : 1
      const flare = burst < 1 ? Math.sin(burst * Math.PI) : 0
      const pulse = (st === NEXT_AFFORDABLE ? 0.82 + Math.sin(t * 4.5 + i) * 0.18 : st === EQUIPPED ? 0.94 + Math.sin(t * 2 + i) * 0.06 : 1) * (1 + flare * 0.9)
      const disc = (st === LOCKED ? 2.2 : st === OWNED ? 2.9 : 3.8) * pulse
      _dummy.position.set(p.x, 0.05, p.z)
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.set(disc, 1, disc)
      _dummy.updateMatrix()
      fx.discs.setMatrixAt(i, _dummy.matrix)

      const h = st === LOCKED ? 0.001 : st === OWNED ? 1.5 : st === NEXT ? 2.2 : 3.1
      const r = st === LOCKED ? 0.001 : 0.74
      _dummy.position.set(p.x, 1.16, p.z)
      _dummy.rotation.set(0, t * 0.6 + i, 0)
      _dummy.scale.set(r, h * pulse, r)
      _dummy.updateMatrix()
      fx.beams.setMatrixAt(i, _dummy.matrix)
    }
    fx.discs.instanceMatrix.needsUpdate = true
    fx.beams.instanceMatrix.needsUpdate = true

    const sp = fx.sparkles
    if (sp) {
      const half = sp.count / 2
      for (let j = 0; j < sp.count; j += 1) {
        const at = fx.sparkleAt[j < half ? 0 : 1]
        if (at < 0) {
          sp.col[j * 3] = sp.col[j * 3 + 1] = sp.col[j * 3 + 2] = 0
          continue
        }
        const p = PEDESTALS[at]
        const color = j < half ? fx.equippedColor : GOLD
        placeSparkle(sp, j, t, p.x, 1.2, p.z, 0.9, 2.8, color)
      }
      sp.points.geometry.attributes.position.needsUpdate = true
      sp.points.geometry.attributes.color.needsUpdate = true
    }
  })

  return (
    <>
      <primitive object={fx.discs} />
      <primitive object={fx.beams} />
      {fx.sparkles && <primitive object={fx.sparkles.points} />}
    </>
  )
}

/* ------------------------------------------------------------ Training pads */

const PAD_SPARKLES_EACH = 8
const PAD_X = PIT.topX + PIT.plateDepth / 2

/**
 * An aura on every unlocked training plate: a slow-turning column of light in the pit's
 * colour, and on MEDIUM/HIGH sparkles rising from it. The pad you're training on flares:
 * taller, brighter, more sparkles. One instanced mesh for the columns (one draw call);
 * the sparkle pool is fixed. Nothing is allocated per frame.
 */
export function PadAura() {
  const rebirths = useGame((s) => s.profile.rebirths)
  const particles = useQuality((s) => PRESETS[s.preset].particles)

  const fx = useMemo(() => {
    const beams = new InstancedMesh(getBeamGeometry(), glowMaterial(getBeamTexture(), { side: DoubleSide }), PADS.length)
    beams.frustumCulled = false
    beams.renderOrder = 3
    const colors = PADS.map((p) => new Color(p.color))
    return {
      beams,
      colors,
      on: new Uint8Array(PADS.length),
      level: new Float32Array(PADS.length),
      sparkles: particles ? createSparkles(PAD_SPARKLES_EACH * PADS.length, 0.28) : null,
    }
  }, [particles])

  useEffect(
    () => () => {
      fx.beams.material.dispose()
      fx.beams.dispose()
      if (fx.sparkles) disposeSparkles(fx.sparkles)
    },
    [fx],
  )

  useEffect(() => {
    PADS.forEach((pad, i) => {
      fx.on[i] = rebirths >= pad.rebirths ? 1 : 0
    })
  }, [rebirths, fx])

  useFrame(({ clock, camera }, delta) => {
    const far = lobbyIsFar(camera)
    fx.beams.visible = !far
    if (fx.sparkles) fx.sparkles.points.visible = !far
    if (far) return
    const t = clock.elapsedTime
    const k = 1 - Math.pow(0.002, Math.min(delta, 0.1))
    for (let i = 0; i < PADS.length; i += 1) {
      // Eases towards 1 while you train on this pad, back to 0 after.
      fx.level[i] += ((runtime.trainingPad === i ? 1 : 0) - fx.level[i]) * k
      const lit = fx.on[i]
      const flare = fx.level[i]
      const h = lit ? (2.6 + flare * 2.4) * (0.94 + Math.sin(t * 2.4 + i) * 0.06) : 0.001
      const r = lit ? 1.5 + flare * 0.25 : 0.001
      _dummy.position.set(PAD_X, PAD_HEIGHT, padCenterZ(i))
      _dummy.rotation.set(0, t * (0.5 + flare) + i, 0)
      _dummy.scale.set(r, h, r)
      _dummy.updateMatrix()
      fx.beams.setMatrixAt(i, _dummy.matrix)
      _color.copy(fx.colors[i]).multiplyScalar(0.5 + flare * 0.5)
      fx.beams.setColorAt(i, _color)
    }
    fx.beams.instanceMatrix.needsUpdate = true
    if (fx.beams.instanceColor) fx.beams.instanceColor.needsUpdate = true

    const sp = fx.sparkles
    if (sp) {
      for (let j = 0; j < sp.count; j += 1) {
        const i = Math.floor(j / PAD_SPARKLES_EACH)
        if (!fx.on[i]) {
          sp.col[j * 3] = sp.col[j * 3 + 1] = sp.col[j * 3 + 2] = 0
          continue
        }
        const flare = fx.level[i]
        placeSparkle(sp, j, t * (1 + flare * 0.8), PAD_X, PAD_HEIGHT + 0.1, padCenterZ(i), 1.7 + flare * 0.3, 2.6 + flare * 1.8, fx.colors[i])
      }
      sp.points.geometry.attributes.position.needsUpdate = true
      sp.points.geometry.attributes.color.needsUpdate = true
    }
  })

  return (
    <>
      <primitive object={fx.beams} />
      {fx.sparkles && <primitive object={fx.sparkles.points} />}
    </>
  )
}

/* ---------------------------------------------------------------- Player */

const PLAYER_SPARKLES = 18

export function PlayerAura() {
  const bottleId = useGame((s) => s.profile.equippedBottle)
  const particles = useQuality((s) => PRESETS[s.preset].particles)
  const ringRef = useRef(null)

  const fx = useMemo(
    () => ({
      ringMat: glowMaterial(getRingTexture(), { polygonOffset: true, polygonOffsetFactor: -2 }),
      color: new Color(),
      sparkles: particles ? createSparkles(PLAYER_SPARKLES, 0.2) : null,
    }),
    [particles],
  )

  useEffect(() => {
    const b = bottleById(bottleId)
    fx.color.set(b.fill)
    fx.ringMat.color.copy(fx.color).multiplyScalar(0.85)
  }, [bottleId, fx])

  useEffect(
    () => () => {
      fx.ringMat.dispose()
      if (fx.sparkles) disposeSparkles(fx.sparkles)
    },
    [fx],
  )

  useFrame(({ clock }) => {
    const ring = ringRef.current
    if (!ring) return
    const show = runtime.mode === 'walk'
    ring.visible = show
    if (fx.sparkles) fx.sparkles.points.visible = show
    if (!show) return
    const t = clock.elapsedTime
    const pos = runtime.playerPos
    const ground = groundHeightAt(pos.x, pos.z)
    // Shrinks a little while you're in the air.
    const lift = Math.min(1, Math.max(0, pos.y - ground) / 3)
    const s = (1.9 + Math.sin(t * 2.4) * 0.12) * (1 - lift * 0.4) * PLAYER_SCALE
    ring.position.set(pos.x, ground + 0.06, pos.z)
    ring.rotation.y = t * 0.8
    ring.scale.set(s, 1, s)

    const sp = fx.sparkles
    if (sp) {
      for (let j = 0; j < sp.count; j += 1) placeSparkle(sp, j, t * 0.8, pos.x, ground + 0.1, pos.z, 0.75, 1.9, fx.color)
      sp.points.geometry.attributes.position.needsUpdate = true
      sp.points.geometry.attributes.color.needsUpdate = true
    }
  })

  return (
    <>
      <mesh ref={ringRef} geometry={getDiscGeometry()} material={fx.ringMat} renderOrder={3} />
      {fx.sparkles && <primitive object={fx.sparkles.points} />}
    </>
  )
}

/**
 * Your equipped bottle slung diagonally across your back. It's put away (hidden) while
 * it's in a training pit or being thrown, since then it's somewhere else.
 */
export function BackBottle() {
  const bottleId = useGame((s) => s.profile.equippedBottle)
  const ref = useRef(null)
  useFrame(() => {
    if (ref.current) ref.current.visible = runtime.mode === 'walk' && runtime.action !== 'train'
  })
  // Offsets tuned at the base height, then scaled with the character.
  return (
    <group scale={PLAYER_SCALE}>
      <BottleModel ref={ref} bottle={bottleById(bottleId)} position={[-0.26, 0.6, -0.4]} rotation={[-0.1, 0, -0.62]} scale={0.95} />
    </group>
  )
}
