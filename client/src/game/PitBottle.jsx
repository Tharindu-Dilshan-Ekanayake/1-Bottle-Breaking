import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, MeshBasicMaterial, RingGeometry } from 'three'

import { PIT, pitStep } from '@shared/world'
import { bottleById } from '@shared/logic'
import { fmt } from '@shared/format'

import { useGame } from '../store/game'
import { sfx } from './audio'
import { PLAYER_SCALE } from './playerSize'
import BottleModel from './BottleModel'
import { spawnPopup } from './popups'
import { runtime } from './runtime'

const SCALE = 0.75
const RADIUS = 0.23 * SCALE
/** A hop between steps; shorter than a training rep, so the bottle keeps up. */
const HOP = 0.42
const TOSS = 0.46
const REST = 0.3

const _pop = { x: 0, y: 0, z: 0 }

/**
 * Training, made visible: every Power gain the server sends from a pit is one bounce of
 * your bottle down the pit's steps - a toss from your hand onto the first step, a hop
 * down each step after that, a splash on the floor, then a fresh bottle.
 *
 * Driven by runtime.trainPulses (filled by the network layer), so each "+N" popup lands
 * exactly with the gain it shows.
 */
export function PitBottle() {
  const bottleId = useGame((s) => s.profile.equippedBottle)
  const bottle = bottleById(bottleId)
  const groupRef = useRef(null)
  const ringRef = useRef(null)

  const s = useMemo(
    () => ({
      /** -1 = in hand; 0..stepCount-1 = on a step; stepCount = on the floor. */
      step: -1,
      hopping: false,
      t: 0,
      dur: HOP,
      arc: 0.6,
      gain: 0,
      fromX: 0, fromY: 0, fromZ: 0,
      toX: 0, toY: 0, toZ: 0,
      roll: 0,
      rest: 0,
      ringT: -1,
      pad: -1,
      squash: 0,
    }),
    [],
  )

  const fx = useMemo(() => {
    const ring = new RingGeometry(0.4, 0.75, 24)
    ring.rotateX(-Math.PI / 2)
    const mat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide })
    return { ring, mat }
  }, [])
  useEffect(
    () => () => {
      fx.ring.dispose()
      fx.mat.dispose()
    },
    [fx],
  )

  const handPosition = () => {
    const p = runtime.playerPos
    const fxDir = Math.sin(runtime.playerYaw)
    const fzDir = Math.cos(runtime.playerYaw)
    // The right hand, at the character's size.
    s.fromX = p.x + (fxDir * 0.45 - fzDir * 0.35) * PLAYER_SCALE
    s.fromY = p.y + 1.25 * PLAYER_SCALE
    s.fromZ = p.z + (fzDir * 0.45 + fxDir * 0.35) * PLAYER_SCALE
  }

  const startHop = (gain) => {
    s.gain = gain
    if (s.step < 0 || s.step >= PIT.stepCount) {
      // A fresh bottle, tossed from the hand onto the first step.
      handPosition()
      s.step = 0
      s.dur = TOSS
      s.arc = 1.3
      s.roll = 0
      runtime.tossTime = 0
      sfx.toss()
    } else {
      s.fromX = s.toX
      s.fromY = s.toY
      s.fromZ = s.toZ
      s.step += 1
      s.dur = HOP
      s.arc = 0.7
    }
    const land = pitStep(s.pad, s.step)
    s.toX = land.x + (Math.random() - 0.5) * 0.4
    s.toY = land.y + RADIUS
    s.toZ = land.z + (Math.random() - 0.5) * 1.6
    s.t = 0
    s.hopping = true
  }

  useFrame((_state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const group = groupRef.current
    if (!group) return
    runtime.tossTime += delta

    // The splash ring on the floor (not drawn at all while idle).
    if (ringRef.current) ringRef.current.visible = s.ringT >= 0
    if (s.ringT >= 0 && ringRef.current) {
      s.ringT += delta
      const k = s.ringT / 0.45
      if (k >= 1) {
        s.ringT = -1
        fx.mat.opacity = 0
      } else {
        ringRef.current.scale.setScalar(0.5 + k * 2.6)
        fx.mat.opacity = 0.8 * (1 - k)
      }
    }

    if (runtime.trainingPad < 0 || runtime.mode !== 'walk') {
      group.visible = false
      s.step = -1
      s.hopping = false
      runtime.trainPulses.length = 0
      return
    }
    if (s.pad !== runtime.trainingPad) {
      s.pad = runtime.trainingPad
      s.step = -1
      s.hopping = false
    }

    if (!s.hopping && s.rest <= 0 && runtime.trainPulses.length > 0) startHop(runtime.trainPulses.shift())

    if (s.hopping) {
      s.t += delta
      const u = Math.min(1, s.t / s.dur)
      const x = s.fromX + (s.toX - s.fromX) * u
      const y = s.fromY + (s.toY - s.fromY) * u + s.arc * 4 * u * (1 - u)
      const z = s.fromZ + (s.toZ - s.fromZ) * u
      s.roll += delta * 13
      group.position.set(x, y, z)
      if (u >= 1) {
        // Landed: the gain pops up where it hit.
        s.hopping = false
        s.squash = 1
        _pop.x = s.toX
        _pop.y = s.toY + 0.8
        _pop.z = s.toZ
        spawnPopup(_pop, `+${fmt(s.gain)}`, 'rep')
        sfx.rep(s.step)
        if (s.step >= PIT.stepCount) s.rest = REST
      }
    } else if (s.step < 0) {
      handPosition()
      group.position.set(s.fromX, s.fromY + Math.sin(runtime.tossTime * 6) * 0.04, s.fromZ)
    }

    if (s.rest > 0) {
      s.rest -= delta
      if (s.rest <= 0) {
        // Splash on the pit floor; the next pulse tosses a new bottle.
        s.ringT = 0
        if (ringRef.current) ringRef.current.position.set(s.toX, s.toY - RADIUS + 0.03, s.toZ)
        fx.mat.color.set(bottle.fill)
        s.step = -1
      }
    }

    // Lying on its side and rolling down the pit (west), with a little landing squash.
    s.squash = Math.max(0, s.squash - delta * 6)
    const inHand = s.step < 0 && !s.hopping
    group.visible = s.rest <= 0 || s.step >= 0
    group.rotation.set(inHand ? 0 : Math.PI / 2, 0, inHand ? 0 : s.roll)
    const sq = 1 + Math.sin(s.squash * Math.PI) * 0.12
    group.scale.set(SCALE * sq, SCALE / sq, SCALE * sq)
  })

  return (
    <>
      <group ref={groupRef} visible={false} rotation-order="ZYX">
        <BottleModel bottle={bottle} position={[0, -0.47, 0]} />
      </group>
      <mesh ref={ringRef} geometry={fx.ring} material={fx.mat} renderOrder={2} visible={false} />
    </>
  )
}

export default PitBottle
