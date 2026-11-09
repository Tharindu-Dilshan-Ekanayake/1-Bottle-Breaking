import { useFrame } from '@react-three/fiber'
import { Component, Suspense, useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { isPadUnlocked } from '@shared/logic'
import { groundHeightAt, nearbyAt, OBSTACLES, padAt, pushOutOfBlocked } from '@shared/world'

import { getGame } from '../store/game'
import { sfx } from './audio'
import { BackBottle } from './Auras'
import BlockAvatar from './BlockAvatar'
import PlayerAvatar from './PlayerAvatar'
import { PLAYER_HEIGHT } from './playerSize'
import { runtime } from './runtime'
import { useUi } from './stores/ui'
import useKeyboard from './useKeyboard'

export { PLAYER_HEIGHT }
const PLAYER_RADIUS = 0.5
const MOVE_SPEED = 7
const SPRINT_MULTIPLIER = 1.5
const GRAVITY = -32
const JUMP_VELOCITY = 10
/** Ledges up to this tall are stepped onto automatically. */
const STEP_HEIGHT = 0.5

const BOUNDS = { minX: -29.4, maxX: 29.4, minZ: -22.75, maxZ: 23.4 }

// Scratch objects, reused every frame.
const _camForward = new Vector3()
const _camRight = new Vector3()
const _move = new Vector3()

/** Shortest signed angle from a to b. */
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Swaps in the block avatar if the Bloxity model can't be loaded. */
class AvatarBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err) {
    console.warn('[game] avatar failed to load; using block avatar', err)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Calls onReady once on mount (the block avatar is ready immediately). */
function ReadyBlockAvatar({ onReady, motionRef }) {
  useEffect(() => {
    onReady?.()
  }, [onReady])
  return <BlockAvatar motionRef={motionRef} height={PLAYER_HEIGHT} />
}

/**
 * Kinematic character controller — no physics engine.
 *
 * The lobby is flat apart from a few low platforms, so movement is: camera-relative
 * velocity, circle push-out against obstacles, a ground-height lookup with auto
 * step-up, and gravity for jumps. Everything is written to refs/runtime, never state.
 */
export function Player({ onAvatarReady }) {
  const settled = useUi((s) => s.settled)
  const groupRef = useRef(null)
  const visualRef = useRef(null)
  const keys = useKeyboard()
  const velY = useRef(0)
  const yaw = useRef(Math.PI)
  /** Stride phase for footstep sounds, and whether we were airborne last frame. */
  const stride = useRef(0)
  const wasAir = useRef(false)
  const fallSpeed = useRef(0)
  const motionRef = useRef({
    time: 0, speed: 0, grounded: true, maxSpeed: MOVE_SPEED, action: 'idle', actionTime: 0, tossTime: 9, vy: 0, sprint: 0,
  })

  useFrame((state, rawDelta) => {
    const group = groupRef.current
    if (!group) return
    const delta = Math.min(rawDelta, 0.05)
    const k = keys.current
    const pos = runtime.playerPos
    const walking = runtime.mode === 'walk'

    // --- Input (keyboard + touch joystick), camera-relative ------------------------
    let ix = 0
    let iz = 0
    if (walking) {
      ix = (k.right ? 1 : 0) - (k.left ? 1 : 0) + runtime.joystick.x
      iz = (k.backward ? 1 : 0) - (k.forward ? 1 : 0) + runtime.joystick.y
    }
    const len = Math.hypot(ix, iz)
    if (len > 1) {
      ix /= len
      iz /= len
    }

    let speed = 0
    if (len > 0.05) {
      state.camera.getWorldDirection(_camForward)
      _camForward.y = 0
      _camForward.normalize()
      _camRight.set(-_camForward.z, 0, _camForward.x)
      _move.set(0, 0, 0).addScaledVector(_camForward, -iz).addScaledVector(_camRight, ix)
      const moveLen = _move.length()
      if (moveLen > 0) _move.divideScalar(moveLen)
      speed = MOVE_SPEED * runtime.walkMult * (k.sprint ? SPRINT_MULTIPLIER : 1) * Math.min(1, len)

      const nx = pos.x + _move.x * speed * delta
      const nz = pos.z + _move.z * speed * delta
      // Refuse to walk into anything taller than a step.
      if (groundHeightAt(nx, nz) - pos.y <= STEP_HEIGHT) {
        pos.x = nx
        pos.z = nz
      }
      yaw.current = Math.atan2(_move.x, _move.z)
    }

    // --- Collisions -------------------------------------------------------------------
    for (let i = 0; i < OBSTACLES.length; i += 1) {
      const o = OBSTACLES[i]
      const dx = pos.x - o[0]
      const dz = pos.z - o[1]
      const min = o[2] + PLAYER_RADIUS
      const d2 = dx * dx + dz * dz
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2)
        pos.x = o[0] + (dx / d) * min
        pos.z = o[1] + (dz / d) * min
      }
    }
    // Not into the sunken training pits.
    pushOutOfBlocked(pos, PLAYER_RADIUS)
    pos.x = Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, pos.x))
    pos.z = Math.min(BOUNDS.maxZ, Math.max(BOUNDS.minZ, pos.z))

    // --- Vertical ---------------------------------------------------------------------
    const ground = groundHeightAt(pos.x, pos.z)
    const onGround = pos.y <= ground + 0.02 && velY.current <= 0
    if (onGround && walking && (k.jump || runtime.jumpQueued)) {
      velY.current = JUMP_VELOCITY
      sfx.jump()
    }
    runtime.jumpQueued = false
    velY.current += GRAVITY * delta
    pos.y += velY.current * delta
    if (pos.y <= ground) {
      pos.y = ground
      velY.current = 0
    }
    const grounded = pos.y <= ground + 0.02
    if (!grounded) fallSpeed.current = Math.min(fallSpeed.current, velY.current)
    // Landing thud (only for a real fall, not stepping onto a plate).
    if (grounded && wasAir.current && fallSpeed.current < -6) sfx.land()
    if (grounded) fallSpeed.current = 0
    wasAir.current = !grounded
    // Footsteps, two per stride, a little crisper on plates and platforms.
    if (grounded && speed > 0.5) {
      const before = Math.floor(stride.current / Math.PI)
      stride.current += delta * (5 + Math.min(1, speed / MOVE_SPEED) * 5)
      if (Math.floor(stride.current / Math.PI) !== before) sfx.step(ground > 0)
    }
    runtime.cheer = Math.max(0, runtime.cheer - delta)

    // Training: on an unlocked pit's start plate, standing (or nearly) still.
    const pad = walking ? padAt(pos.x, pos.z) : -1
    const training = pad >= 0 && isPadUnlocked(getGame().profile, pad) && speed < 0.5
    runtime.trainingPad = training ? pad : -1
    if (walking) runtime.action = training ? 'train' : 'idle'

    // Face the pit while training, and down the stairs while throwing.
    if (training) yaw.current = -Math.PI / 2
    if (runtime.mode === 'throw') yaw.current = Math.PI
    runtime.playerYaw = yaw.current
    // When this position was true: position reports are stamped with it (connection.js),
    // not with the moment the report timer fires, which is up to a frame later.
    runtime.playerPosAt = performance.now()

    group.position.copy(pos)
    if (visualRef.current) {
      const r = visualRef.current.rotation
      r.y += angleDelta(r.y, yaw.current) * (1 - Math.pow(0.0005, delta))
    }

    runtime.playerSpeed = speed
    runtime.grounded = grounded
    runtime.nearby = nearbyAt(pos.x, pos.z, runtime.world)
    // What everyone else sees us doing (connection.js reports it with our position).
    const sprinting = walking && k.sprint && speed > 0.5
    runtime.netAnim =
      runtime.mode === 'throw'
        ? 'throw'
        : !grounded
          ? 'jump'
          : training
            ? 'train'
            : runtime.cheer > 0
              ? 'cheer'
              : speed > 0.5
                ? sprinting
                  ? 'run'
                  : 'walk'
                : 'idle'

    // --- Pose ---------------------------------------------------------------------------
    const m = motionRef.current
    m.time += delta
    m.speed = speed
    m.grounded = grounded
    m.maxSpeed = MOVE_SPEED * runtime.walkMult * (k.sprint ? SPRINT_MULTIPLIER : 1)
    m.action = runtime.action
    m.actionTime = runtime.actionTime
    m.tossTime = runtime.tossTime
    m.vy = velY.current
    m.cheer = runtime.cheer
    m.sprint = sprinting ? 1 : 0
  })

  return (
    <group ref={groupRef} position={runtime.playerPos.toArray()}>
      <group ref={visualRef} rotation={[0, Math.PI, 0]}>
        <AvatarBoundary fallback={<ReadyBlockAvatar onReady={onAvatarReady} motionRef={motionRef} />}>
          <Suspense fallback={<BlockAvatar motionRef={motionRef} height={PLAYER_HEIGHT} />}>
            <PlayerAvatar onReady={onAvatarReady} targetHeight={PLAYER_HEIGHT} motionRef={motionRef} />
          </Suspense>
        </AvatarBoundary>
        {settled && <BackBottle />}
      </group>
    </group>
  )
}

export default Player
