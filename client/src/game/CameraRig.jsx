import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'

import { eggStandsFor, PEDESTALS, pedestalNear, PORTAL } from '@shared/world'

import { getBloxityState } from '../bloxity/store'
import { PLAYER_SCALE } from './playerSize'
import { runtime } from './runtime'

const LOOK_HEIGHT = 1.4 * PLAYER_SCALE
const MIN_DISTANCE = 4
const MAX_DISTANCE = 22
const MIN_PITCH = -0.1
const MAX_PITCH = 1.25
const DRAG_SENSITIVITY = 0.005
const TOUCH_SENSITIVITY = 0.007
const ZOOM_SENSITIVITY = 0.012

/** Chase offset behind/above the bottle while it tumbles (stairs run towards −Z). */
// The stairs drop 1 per 2 units, so the camera must sit well above the slope.
const CHASE_OFFSET = new Vector3(0, 7.2, 8.5)
const CHASE_LOOK = new Vector3(0, -0.8, -5)

const _desired = new Vector3()
const _target = new Vector3()
const _lastBottle = new Vector3()
/** Extra field of view at full bottle speed: the track seems to rush past. */
const FOV_KICK = 9

/**
 * Two modes, blended by smoothing:
 *  - walk:  third-person orbit around the player (mouse drag / one-finger drag to
 *           orbit, wheel / pinch to zoom)
 *  - throw: chase camera behind the tumbling bottle
 *
 * Writes the look target to runtime.focus, which the sky, sun and stair window follow.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  // Portrait phones see a narrow slice horizontally, so start a little further back.
  const orbit = useRef({ yaw: 0, pitch: 0.38, distance: size.width < size.height ? 13 : 10 })
  // Lazy initialiser: the Vector3 is created once, not on every render.
  const [lookAt] = useState(() => ({ current: new Vector3().copy(runtime.focus) }))
  const initialised = useRef(false)
  const lastMode = useRef(runtime.mode)
  const baseFov = useRef(null)
  /** How long the player has stood still (s): the look-at swing waits for a moment. */
  const still = useRef(0)
  /** Was the bottle being followed last frame (so its speed can be measured)? */
  const followedBottle = useRef(false)
  /** Live pointers; while any is down the player is steering the camera. */
  const dragging = useRef(null)

  useEffect(() => {
    const el = gl.domElement
    const pointers = new Map()
    dragging.current = pointers
    let pinchDist = 0

    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      el.setPointerCapture?.(e.pointerId)
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }

    const onPointerMove = (e) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const o = orbit.current
      if (pointers.size === 1) {
        // Boxity's camera_sensitivity setting (0.1-5) scales the drag speed.
        const sens = (e.pointerType === 'touch' ? TOUCH_SENSITIVITY : DRAG_SENSITIVITY) * getBloxityState().cameraSensitivity
        o.yaw -= (e.clientX - prev.x) * sens
        o.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, o.pitch + (e.clientY - prev.y) * sens))
      }
      prev.x = e.clientX
      prev.y = e.clientY
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        o.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, o.distance - (d - pinchDist) * 0.03))
        pinchDist = d
      }
    }

    const onPointerUp = (e) => {
      pointers.delete(e.pointerId)
      el.releasePointerCapture?.(e.pointerId)
    }

    const onWheel = (e) => {
      e.preventDefault()
      const o = orbit.current
      o.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, o.distance + e.deltaY * ZOOM_SENSITIVITY))
    }
    const onContextMenu = (e) => e.preventDefault()

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  useFrame((_s, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const throwing = runtime.mode === 'throw'

    if (throwing) {
      const b = runtime.bottlePos
      _desired.copy(b).add(CHASE_OFFSET)
      _target.copy(b).add(CHASE_LOOK)
    } else {
      const p = runtime.playerPos
      // Training: swing round behind the player to look down into the pit (west),
      // unless they're steering the camera themselves.
      const steering = dragging.current?.size > 0
      still.current = runtime.playerSpeed < 0.5 ? still.current + delta : 0
      if (runtime.trainingPad >= 0 && !steering) {
        const o = orbit.current
        let d = (Math.PI / 2 - o.yaw) % (Math.PI * 2)
        if (d > Math.PI) d -= Math.PI * 2
        if (d < -Math.PI) d += Math.PI * 2
        o.yaw += d * (1 - Math.pow(0.05, delta))
        o.pitch += (0.55 - o.pitch) * (1 - Math.pow(0.1, delta))
      } else if (!steering && still.current > 0.35) {
        // Stopped at an egg stand or a shop pedestal: swing round behind you so it's in
        // front of the camera, with you, rather than between you and the camera.
        let target = null
        const near = runtime.nearby
        if (near?.startsWith('egg:')) target = eggStandsFor(runtime.world).find((e) => e.egg === near.slice(4))
        else if (near === 'shop') target = PEDESTALS[pedestalNear(p.x, p.z)]
        else if (near === 'portal') target = PORTAL
        if (target) {
          const o = orbit.current
          let d = (Math.atan2(p.x - target.x, p.z - target.z) - o.yaw) % (Math.PI * 2)
          if (d > Math.PI) d -= Math.PI * 2
          if (d < -Math.PI) d += Math.PI * 2
          o.yaw += d * (1 - Math.pow(0.08, delta))
        }
      }
      const { yaw, pitch, distance } = orbit.current
      const horizontal = Math.cos(pitch) * distance
      _target.set(p.x, p.y + LOOK_HEIGHT, p.z)
      _desired.set(
        p.x + Math.sin(yaw) * horizontal,
        p.y + LOOK_HEIGHT + Math.sin(pitch) * distance,
        p.z + Math.cos(yaw) * horizontal,
      )
      // Keep the camera inside the lobby walls and above the floor.
      _desired.x = Math.min(29, Math.max(-29, _desired.x))
      _desired.z = Math.min(23.2, _desired.z)
      _desired.y = Math.max(0.6, _desired.y)
    }

    // Coming back from a throw is a camera cut: easing up from hundreds of stairs
    // below would drag the camera through the lobby floor.
    if (lastMode.current === 'throw' && !throwing) initialised.current = false
    lastMode.current = runtime.mode

    if (!initialised.current) {
      camera.position.copy(_desired)
      lookAt.current.copy(_target)
      initialised.current = true
    }

    // Tighter follow while throwing: hops can cover 40+ units a second.
    const k = 1 - Math.pow(throwing ? 1e-6 : 0.002, delta)
    camera.position.lerp(_desired, k)
    lookAt.current.lerp(_target, 1 - Math.pow(throwing ? 1e-7 : 0.0001, delta))

    // Bounce shake, decaying.
    if (runtime.shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * runtime.shake
      camera.position.y += (Math.random() - 0.5) * runtime.shake
      runtime.shake *= Math.pow(0.004, delta)
    }

    // FOV kick: widen a little as the bottle picks up speed, settle back after.
    if (baseFov.current === null) baseFov.current = camera.fov
    let speed = 0
    if (throwing && followedBottle.current && delta > 0) speed = _lastBottle.distanceTo(runtime.bottlePos) / delta
    _lastBottle.copy(runtime.bottlePos)
    followedBottle.current = throwing
    const wantFov = baseFov.current + (throwing ? Math.min(1, speed / 45) * FOV_KICK : 0)
    if (Math.abs(camera.fov - wantFov) > 0.02) {
      camera.fov += (wantFov - camera.fov) * (1 - Math.pow(0.02, delta))
      camera.updateProjectionMatrix()
    }

    camera.lookAt(lookAt.current)
    runtime.focus.copy(lookAt.current)
  })

  return null
}

export default CameraRig
