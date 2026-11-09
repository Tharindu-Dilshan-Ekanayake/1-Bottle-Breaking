import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { MeshLambertMaterial } from 'three'

import { getUnitBox } from './materials'

// Module-level: shared by every block avatar, never recreated.
const SKIN = new MeshLambertMaterial({ color: '#f5c99b' })
const SHIRT = new MeshLambertMaterial({ color: '#3b82f6' })
const PANTS = new MeshLambertMaterial({ color: '#1f2937' })

const approach = (from, to, rate, dt) => from + (to - from) * (1 - Math.exp(-rate * dt))

/**
 * A simple brick character. Shown while the Bloxity avatar downloads, and kept if that
 * download fails, so the game is always playable. Its limbs ease between poses (walk,
 * idle, jump, training toss, throw) instead of snapping.
 */
export function BlockAvatar({ motionRef, height = 1.8 }) {
  const box = getUnitBox()
  const root = useRef(null)
  const armL = useRef(null)
  const armR = useRef(null)
  const legL = useRef(null)
  const legR = useRef(null)
  const st = useRef({ phase: 0, ratio: 0 })
  const s = height / 1.8

  useFrame((_s, rawDelta) => {
    const m = motionRef?.current
    if (!m || !armL.current) return
    const dt = Math.min(rawDelta, 0.05)
    const state = st.current
    state.ratio = approach(state.ratio, Math.min(m.speed / Math.max(m.maxSpeed, 0.001), 1), 12, dt)
    state.phase += dt * (6 + state.ratio * 5)
    const swing = Math.sin(state.phase) * 0.9 * state.ratio

    let lArm = -swing
    let rArm = swing
    let lLeg = swing
    let rLeg = -swing
    if (m.cheer > 0) {
      lArm = -2.8 + Math.sin(m.time * 14) * 0.25
      rArm = -2.8 - Math.sin(m.time * 14) * 0.25
    } else if (!m.grounded) {
      lArm = rArm = -2.2
      lLeg = -0.5
      rLeg = 0.3
    } else if (m.action === 'train') {
      const t = m.tossTime ?? 9
      rArm = t < 0.12 ? 0.9 : t < 0.34 ? -1.8 : -0.4
      lArm = -0.3
    } else if (m.action === 'throw') {
      rArm = m.actionTime < 0.28 ? 1.2 : -2.6
    }
    armL.current.rotation.x = approach(armL.current.rotation.x, lArm, 16, dt)
    armR.current.rotation.x = approach(armR.current.rotation.x, rArm, 18, dt)
    legL.current.rotation.x = approach(legL.current.rotation.x, lLeg, 16, dt)
    legR.current.rotation.x = approach(legR.current.rotation.x, rLeg, 16, dt)
    root.current.position.y = m.grounded ? Math.abs(Math.cos(state.phase)) * 0.12 * state.ratio : 0
  })

  return (
    <group ref={root} scale={s}>
      <mesh geometry={box} material={SKIN} position={[0, 1.62, 0]} scale={[0.36, 0.36, 0.36]} castShadow />
      <mesh geometry={box} material={SHIRT} position={[0, 1.12, 0]} scale={[0.56, 0.62, 0.3]} castShadow />
      <group ref={armL} position={[-0.38, 1.4, 0]}>
        <mesh geometry={box} material={SKIN} position={[0, -0.3, 0]} scale={[0.18, 0.62, 0.22]} castShadow />
      </group>
      <group ref={armR} position={[0.38, 1.4, 0]}>
        <mesh geometry={box} material={SKIN} position={[0, -0.3, 0]} scale={[0.18, 0.62, 0.22]} castShadow />
      </group>
      <group ref={legL} position={[-0.14, 0.8, 0]}>
        <mesh geometry={box} material={PANTS} position={[0, -0.4, 0]} scale={[0.24, 0.8, 0.26]} castShadow />
      </group>
      <group ref={legR} position={[0.14, 0.8, 0]}>
        <mesh geometry={box} material={PANTS} position={[0, -0.4, 0]} scale={[0.24, 0.8, 0.26]} castShadow />
      </group>
    </group>
  )
}

export default BlockAvatar
