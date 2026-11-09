import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, Euler, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three'

import { BACK_BONE } from '../../bloxity/avatarAssets'
import { bubbleFor, localBubble } from '../../bloxity/chat'
import { remotePlayers } from '../../net/remotePlayers'
import { getUnitBox } from '../materials'
import { PLAYER_SCALE } from '../playerSize'
import { runtime } from '../runtime'
import { getPreset } from '../stores/quality'
import { addBottle, beginBottles, createBottlePool, disposeBottlePool, endBottles } from './bottlePool'
import { hideNameplatesFrom, LOCAL_SLOT, NAMEPLATE_POOL_SIZE, placeNameplate } from './nameplates'
import { PIT_BOTTLE_SCALE, updateRemote } from './remoteMotion'
import { remoteViews } from './views'

/** A room holds 8: everyone else. Every pool below is sized for this many. */
const MAX_REMOTES = 7
const PARTS = 6
/** Block-figure unit, scaled with every other character (playerSize.js). */
const S = 0.36 * PLAYER_SCALE
const Y = PLAYER_SCALE
/** Gel balls in remote bottles only this close (and never on LOW). */
const GEL_DISTANCE = 24
/** Extra metres a detailed avatar keeps its accessories for, so they don't flicker. */
const DETAIL_HYSTERESIS = 3
/** Closer than this to the camera, an avatar is posed every frame whatever its detail. */
const FULL_RATE_DISTANCE = 14
/** Frame counter for the every-other-frame posing of far avatars. */
let frame = 0

/**
 * The stand-in figure, only while a player's avatar is still being built (or if both
 * their avatar and the default one failed): [pivot position, size]; limbs hang from
 * their pivot. Coloured like the default Bloxity outfit, so the swap is barely visible.
 */
const PART_LAYOUT = [
  { key: 'head', pos: [0, 1.62 * Y, 0], size: [1.1 * S, 1 * S, 1 * S] },
  { key: 'torso', pos: [0, 1.08 * Y, 0], size: [2 * S, 1.8 * S, 1 * S] },
  { key: 'armL', pos: [-1.5 * S, 1.38 * Y, 0], size: [0.9 * S, 1.8 * S, 0.9 * S], swing: -1 },
  { key: 'armR', pos: [1.5 * S, 1.38 * Y, 0], size: [0.9 * S, 1.8 * S, 0.9 * S], swing: 1 },
  { key: 'legL', pos: [-0.5 * S, 0.76 * Y, 0], size: [0.95 * S, 2.1 * S, 0.95 * S], swing: 1 },
  { key: 'legR', pos: [0.5 * S, 0.76 * Y, 0], size: [0.95 * S, 2.1 * S, 0.95 * S], swing: -1 },
]
const SHIRT = new Color('#7fb33a')
const PANTS = new Color('#5b4a3a')
const SKIN = new Color('#e9b98f')

/**
 * The bottle slung on the back, in character space: the same spot, angle and size as
 * your own (Auras.jsx BackBottle: tuned at the base height, then scaled).
 */
const CHAR_BOTTLE = new Matrix4().compose(
  new Vector3(-0.26, 0.6, -0.4).multiplyScalar(PLAYER_SCALE),
  new Quaternion().setFromEuler(new Euler(-0.1, 0, -0.62)),
  new Vector3(1, 1, 1).multiplyScalar(0.95 * PLAYER_SCALE),
)

// Scratch, reused every frame.
const _m = new Matrix4()
const _base = new Matrix4()
const _local = new Matrix4()
const _rot = new Matrix4()
const _scale = new Matrix4()
const _inv = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()
const _one = new Vector3(1, 1, 1)
const _v = new Vector3()
const _up = new Vector3(0, 1, 0)
const _target = new Vector3()
const _dir = new Vector3()
const _euler = new Euler(0, 0, 0, 'ZYX')
const _drop = new Matrix4().makeTranslation(0, -0.47, 0)
/** Players drawn this frame, nearest-first ranking for accessories. */
const VISIBLE = []
/** `?perf` (as PerfProbe): expose the remote players to automated test scripts. */
const DEBUG = typeof window !== 'undefined' && /[?&]perf\b/.test(window.location.search)

/** Arm/leg angles for the stand-in figure. */
function limbAngle(part, r, t) {
  const m = r.motion
  if (!m.grounded) {
    if (part.key.startsWith('arm')) return -2.4
    return part.key === 'legL' ? -0.5 : 0.3
  }
  if (m.action === 'train' && part.key === 'armR') return -1.2 - Math.max(0, Math.sin(t * 10)) * 1.2
  if (m.action === 'throw' && part.key === 'armR') return m.actionTime < 0.28 ? 1.2 : -2.6
  const ratio = Math.min(1, m.speed / m.maxSpeed)
  return Math.sin(r.walkPhase || 0) * 0.9 * ratio * part.swing
}

/**
 * Measures where the back bottle sits relative to the chest bone, with the avatar in
 * its rest pose (call between poser.reset and poser.animate). Allocation-free.
 */
function measureBack(view, group, rig) {
  view.backRig = rig
  view.backBone = rig.bones[BACK_BONE]?.bone || null
  if (!view.backBone) return
  group.updateWorldMatrix(true, true)
  _inv.copy(group.matrixWorld).invert()
  _m.multiplyMatrices(_inv, view.backBone.matrixWorld).decompose(_p, _q, _s)
  _m.compose(_p, _q, _one).invert()
  view.backOffset.multiplyMatrices(_m, CHAR_BOTTLE)
}

/** The back bottle's world matrix: the chest bone's place and turn (not its stretch). */
function backMatrix(view, out) {
  view.backBone.updateWorldMatrix(true, false)
  view.backBone.matrixWorld.decompose(_p, _q, _s)
  return out.compose(_p, _q, _one).multiply(view.backOffset)
}

/**
 * Everyone else in the room, posed and placed from one frame loop:
 *  - their real Bloxity avatar (mounted by RemoteAvatars; the default avatar while
 *    their outfit downloads), interpolated ~150 ms in the past, turning smoothly,
 *    animated from the same motion state your own character uses;
 *  - their equipped bottle on their back, riding the chest bone (pooled: a couple of
 *    draw calls per bottle family, not per player), in their hand and down the pit
 *    while they train;
 *  - their name tag (a DOM pool) and their pets (handed to the shared pet renderer).
 * Hidden past the preset's draw distance (from the camera); only the few nearest you
 * (preset.remoteAvatars, within remoteAvatarDistance of you) wear their accessories, the
 * rest are one draw call each plus their bottle.
 */
export function RemotePlayers() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const body = useMemo(() => {
    const mesh = new InstancedMesh(getUnitBox(), new MeshLambertMaterial({ color: '#ffffff' }), MAX_REMOTES * PARTS)
    mesh.frustumCulled = false
    mesh.castShadow = true
    for (let i = 0; i < mesh.count; i += 1) mesh.setColorAt(i, SKIN)
    mesh.count = 0
    mesh.visible = false
    return mesh
  }, [])
  // Back bottles plus pit bottles: one per player at a time.
  const bottles = useMemo(() => createBottlePool(MAX_REMOTES), [])

  useEffect(() => {
    if (!DEBUG) return undefined
    window.__remote = { players: remotePlayers, views: remoteViews, camera, ms: 0 }
    return () => {
      delete window.__remote
    }
  }, [camera])

  useEffect(
    () => () => {
      body.material.dispose()
      body.dispose()
      disposeBottlePool(bottles)
      hideNameplatesFrom(0)
      runtime.remotePets.length = 0
    },
    [body, bottles],
  )

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const preset = getPreset()
    const now = performance.now()
    const t = state.clock.elapsedTime
    const gelAllowed = preset.particles
    // LOW: the low-end preset (no particles there either).
    const lowEnd = !preset.particles

    // --- Where everyone is, and who is drawn ----------------------------------------
    let shown = 0
    const me = runtime.playerPos
    for (const r of remotePlayers.values()) {
      updateRemote(r, now, delta)
      r.camDist = camera.position.distanceTo(r.position)
      // Detail goes by distance from you, not the camera: zooming out mustn't strip them.
      r.myDist = Math.hypot(r.position.x - me.x, r.position.z - me.z)
      r.shown = r.camDist < preset.remoteDrawDistance && (r.world || 1) === runtime.world
      if (r.shown && shown < MAX_REMOTES * 2) VISIBLE[shown++] = r
      if (r.motion.speed > 0) r.walkPhase = (r.walkPhase || 0) + delta * (6 + Math.min(r.motion.speed, 10) * 0.5)
    }
    // Accessories for the few nearest you only (with a little hysteresis).
    for (let i = 0; i < shown; i += 1) {
      const r = VISIBLE[i]
      const mine = r.myDist - (r.detailed ? DETAIL_HYSTERESIS : 0)
      let rank = 0
      for (let j = 0; j < shown; j += 1) {
        const o = VISIBLE[j]
        if (o !== r && o.myDist - (o.detailed ? DETAIL_HYSTERESIS : 0) < mine) rank += 1
      }
      r.detailed = rank < preset.remoteAvatars && mine < preset.remoteAvatarDistance
    }
    for (let i = shown; i < VISIBLE.length; i += 1) VISIBLE[i] = null

    let instance = 0
    let index = 0
    frame = (frame + 1) & 0xffff
    let plate = 0
    runtime.remotePets.length = 0
    beginBottles(bottles)

    for (const r of remotePlayers.values()) {
      const view = remoteViews.get(r.sessionId)
      // Their outfit when it's built, else the default avatar, else the stand-in.
      const own = view?.poser.current
      const hold = view?.hold.current
      const useOwn = !!(own && view.group && own.isReady())
      const useHold = !useOwn && !!(hold && view.holdGroup && hold.isReady())
      if (view?.group) view.group.visible = r.shown && useOwn
      if (view?.holdGroup) view.holdGroup.visible = r.shown && useHold
      if (!r.shown) continue
      index += 1

      const m = r.motion
      let back = null
      if (useOwn || useHold) {
        const poser = useOwn ? own : hold
        const group = useOwn ? view.group : view.holdGroup
        group.position.copy(r.position)
        group.rotation.y = r.yaw
        // Players without accessories (the far ones; on LOW, all but the nearest two) are
        // posed every other frame, alternating so the cost spreads; everyone still moves
        // and turns every frame.
        r.poseDelta = (r.poseDelta || 0) + delta
        const fullRate = r.detailed || (!lowEnd && r.camDist < FULL_RATE_DISTANCE)
        const pose = fullRate || ((frame + index) & 1) === 0 || view.backRig !== poser.rig
        try {
          if (pose) {
            // Rest pose (with proportions), then the motion's pose and emote on top.
            poser.reset()
            if (view.backRig !== poser.rig) measureBack(view, group, poser.rig)
            poser.animate(r.poseDelta, m)
            r.poseDelta = 0
          }
          poser.setDetail(r.detailed)
          if (view.backBone) back = backMatrix(view, _base)
          // Their hand, for a bottle that leaves it (throw, training toss).
          if (m.action !== 'idle') {
            const hand = poser.rig.bones.ArmR2_leaf?.bone
            if (hand) {
              hand.updateWorldMatrix(true, false)
              r.hand.setFromMatrixPosition(hand.matrixWorld)
              r.handOk = true
            }
          }
        } catch {
          // A malformed outfit must not stop everyone else being drawn.
        }
      } else if (instance + PARTS <= MAX_REMOTES * PARTS) {
        // Stand-in figure while their avatar is built.
        _q.setFromAxisAngle(_up, r.yaw)
        _base.compose(r.position, _q, _one)
        for (const part of PART_LAYOUT) {
          const hangs = part.swing !== undefined
          _local.makeTranslation(part.pos[0], part.pos[1], part.pos[2])
          _rot.makeRotationX(hangs ? limbAngle(part, r, t) : 0)
          _scale.makeScale(part.size[0], part.size[1], part.size[2])
          if (hangs) _scale.setPosition(0, -part.size[1] / 2, 0)
          _m.copy(_base).multiply(_local).multiply(_rot).multiply(_scale)
          body.setMatrixAt(instance, _m)
          body.setColorAt(instance, part.key === 'torso' ? SHIRT : part.key.startsWith('leg') ? PANTS : SKIN)
          instance += 1
        }
        back = _base.multiply(CHAR_BOTTLE)
      }

      // Their bottle: on the back while they walk about; in the hand and down the pit
      // while they train; gone while it's flying down the stairs.
      const gel = gelAllowed && r.camDist < GEL_DISTANCE
      if (m.action === 'train') {
        const pit = r.pit
        if (pit.pad >= 0 && (pit.rest <= 0 || pit.step >= 0)) {
          const inHand = pit.step < 0 && !pit.hopping
          const sq = 1 + Math.sin(pit.squash * Math.PI) * 0.12
          _euler.set(inHand ? 0 : Math.PI / 2, 0, inHand ? 0 : pit.roll)
          _q.setFromEuler(_euler)
          _p.set(pit.x, pit.y, pit.z)
          _s.set(PIT_BOTTLE_SCALE * sq, PIT_BOTTLE_SCALE / sq, PIT_BOTTLE_SCALE * sq)
          _m.compose(_p, _q, _s).multiply(_drop)
          addBottle(bottles, r.bottleId, _m, t, gel)
        }
      } else if (back && m.action !== 'throw') addBottle(bottles, r.bottleId, back, t, gel)

      // Name tag above the head.
      if (plate < NAMEPLATE_POOL_SIZE) {
        if (r.camDist < preset.remoteNameDistance) {
          _v.set(r.position.x, r.position.y + 2.2 * Y, r.position.z).project(camera)
          if (_v.z < 1) {
            const fade = Math.min(1, (preset.remoteNameDistance - r.camDist) / 6)
            // Their latest Boxity chat message, over the name tag.
            const said = bubbleFor(r.uid, r.name)
            placeNameplate(plate, r.label, (_v.x * 0.5 + 0.5) * size.width, (-_v.y * 0.5 + 0.5) * size.height, said ? 1 : fade, said)
          } else placeNameplate(plate, '', null)
        } else placeNameplate(plate, '', null)
        plate += 1
      }

      // Their pets follow in formation; the shared pet renderer draws them.
      const sin = Math.sin(r.yaw)
      const cos = Math.cos(r.yaw)
      for (let i = 0; i < r.petIds.length && i < r.pets.length; i += 1) {
        const pet = r.pets[i]
        pet.id = r.petIds[i]
        const sx = i === 0 ? -1.4 : i === 1 ? 1.4 : 0
        const sz = i === 2 ? -2.3 : -1.3
        _target.set(r.position.x - cos * sx + sin * sz, r.position.y, r.position.z + sin * sx + cos * sz)
        _dir.copy(pet.position)
        pet.position.lerp(_target, 1 - Math.exp(-6 * delta))
        const stepped = _dir.distanceTo(pet.position)
        if (stepped > 0.005) pet.yaw = Math.atan2(pet.position.x - _dir.x, pet.position.z - _dir.z)
        pet.hop = stepped > 0.01 ? (t * 2.4 + i * 0.3) % 1 : 0
        runtime.remotePets.push(pet)
      }
    }

    hideNameplatesFrom(plate)
    endBottles(bottles)

    // Your own latest chat message, over your character while you walk around.
    const mine = runtime.mode === 'walk' ? localBubble() : null
    if (mine) {
      const p = runtime.playerPos
      _v.set(p.x, p.y + 2.35 * Y, p.z).project(camera)
      if (_v.z < 1) placeNameplate(LOCAL_SLOT, '', (_v.x * 0.5 + 0.5) * size.width, (-_v.y * 0.5 + 0.5) * size.height, 1, mine)
      else placeNameplate(LOCAL_SLOT, '', null)
    } else placeNameplate(LOCAL_SLOT, '', null)

    body.count = instance
    body.visible = instance > 0
    if (instance > 0) {
      body.instanceMatrix.needsUpdate = true
      if (body.instanceColor) body.instanceColor.needsUpdate = true
    }
    // ?perf: what this loop costs per frame (ms, smoothed), for the test scripts.
    if (DEBUG && window.__remote) window.__remote.ms = window.__remote.ms * 0.95 + (performance.now() - now) * 0.05
  })

  return (
    <>
      <primitive object={body} />
      <primitive object={bottles.group} />
    </>
  )
}

export default RemotePlayers
