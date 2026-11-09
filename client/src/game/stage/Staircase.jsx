import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three'

import { THROW_REST, THROW_WINDUP, ZONES } from '@shared/balance'
import { fmt } from '@shared/format'
import { baseGain, bottleById, gainRoom, isPickupStair, pickupValue, zoneIndexAt } from '@shared/logic'
import { LAUNCH, STAIR, stairCenterZ, stairIndexAtZ, stairTopY } from '@shared/world'

import { getGame, useGame } from '../../store/game'
import { sfx } from '../audio'
import BottleModel from '../BottleModel'
import { bottleFamilyId, drawLabel, getBlockMaterial, getBottleGeometries, getUnitBox, getUnitCone } from '../materials'
import { spawnPopup } from '../popups'
import { PLAYER_SCALE } from '../playerSize'
import { resetRuntimeThrow, runtime } from '../runtime'
import { getPreset, PRESETS, useQuality } from '../stores/quality'
import { zoneLook } from '../themes'
import { createBottleTrail, trailPower } from './BottleTrail'
import { createShatterFx } from './ShatterFx'

/*
 * The throw stage: an endless terraced staircase, the bottle's flight, and other
 * players' bottles. Loaded lazily (React.lazy) after the lobby is on screen.
 *
 * Only a sliding window of stairs exists at any time - a fixed pool of instances
 * recycled as the camera moves down - so a 4,000-stair throw costs the same as a short
 * one.
 */

const BLOCKS_PER_STAIR = 14
const SPIKES_PER_STAIR = 2
const TERRACE_H = 1.6
const BACK_STAIRS = 12

const _dummy = new Object3D()
const _color = new Color()
const _pop = { x: 0, y: 0, z: 0 }

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function setBlock(mesh, index, x, y, z, sx, sy, sz, color) {
  _dummy.position.set(x, y, z)
  _dummy.rotation.set(0, 0, 0)
  _dummy.scale.set(sx, sy, sz)
  _dummy.updateMatrix()
  mesh.setMatrixAt(index, _dummy.matrix)
  if (color) mesh.setColorAt(index, _color.set(color))
}

function hideBlock(mesh, index) {
  _dummy.scale.set(0, 0, 0)
  _dummy.updateMatrix()
  mesh.setMatrixAt(index, _dummy.matrix)
}

/** Writes every instance belonging to stair `i` into pool slot `slot`. */
function writeStair(blocks, spikes, i, slot) {
  const zi = zoneIndexAt(i)
  const look = zoneLook(zi)
  const y = stairTopY(i)
  const cz = stairCenterZ(i)
  const d = STAIR.depth
  const alt = i % 2
  const lh = STAIR.laneHalf
  const sideW = STAIR.terraceHalf - lh
  const b = slot * BLOCKS_PER_STAIR
  const s = slot * SPIKES_PER_STAIR

  setBlock(blocks, b, -(lh + sideW / 2), y - TERRACE_H / 2, cz, sideW, TERRACE_H, d, look.terrace[alt])
  setBlock(blocks, b + 1, 0, y - TERRACE_H / 2, cz, lh * 2, TERRACE_H, d, look.lane[alt])
  setBlock(blocks, b + 2, lh + sideW / 2, y - TERRACE_H / 2, cz, sideW, TERRACE_H, d, look.terrace[alt])
  // Rails, with an accent band every fifth stair so speed reads at a glance.
  const rail = i % 5 === 4 ? look.accent : look.rail
  setBlock(blocks, b + 3, -(lh + 0.35), y + 0.35, cz, 0.7, 0.7, d, rail)
  setBlock(blocks, b + 4, lh + 0.35, y + 0.35, cz, 0.7, 0.7, d, rail)

  const gate = zi > 0 && i === ZONES[zi].start
  // Marker posts on the rails every 10 stairs (the gate takes their place on its stair).
  if (i % 10 === 9 && !gate) {
    setBlock(blocks, b + 12, -(lh + 0.35), y + 1.35, cz, 0.42, 1.3, 0.42, look.accent)
    setBlock(blocks, b + 13, lh + 0.35, y + 1.35, cz, 0.42, 1.3, 0.42, look.accent)
  } else if (gate) {
    // Bright lantern blocks on top of the gate posts.
    setBlock(blocks, b + 12, -6.8, y + 9.5, cz, 1.5, 1.1, 1.5, '#fff6c2')
    setBlock(blocks, b + 13, 6.8, y + 9.5, cz, 1.5, 1.1, 1.5, '#fff6c2')
  } else {
    hideBlock(blocks, b + 12)
    hideBlock(blocks, b + 13)
  }

  // A gate on the first stair of each stage.
  if (gate) {
    setBlock(blocks, b + 5, -6.8, y + 4, cz, 1.2, 8, 1.2, look.accent)
    setBlock(blocks, b + 6, 6.8, y + 4, cz, 1.2, 8, 1.2, look.accent)
    setBlock(blocks, b + 7, 0, y + 8.5, cz, 15, 1, 1.4, look.accent)
  } else {
    hideBlock(blocks, b + 5)
    hideBlock(blocks, b + 6)
    hideBlock(blocks, b + 7)
  }

  for (let k = 0; k < 2; k += 1) {
    const side = k === 0 ? -1 : 1
    const h = hash(i * 2 + k)
    const h2 = hash(i * 7 + k * 3 + 1)
    const x = side * (lh + 3 + h * (sideW - 6))
    const z = cz + (h2 - 0.5) * d * 0.6
    const trunk = b + 8 + k * 2
    const crown = trunk + 1
    const spike = s + k
    hideBlock(blocks, trunk)
    hideBlock(blocks, crown)
    hideBlock(spikes, spike)
    if (h2 <= 0.25) continue

    switch (look.prop) {
      case 'tree':
        setBlock(blocks, trunk, x, y + 1.2, z, 0.8, 2.4, 0.8, look.propB)
        setBlock(blocks, crown, x, y + 3.4, z, 2.6, 2.4, 2.6, look.propA)
        break
      case 'palm':
        setBlock(blocks, trunk, x, y + 2.1, z, 0.5, 4.2, 0.5, look.propB)
        setBlock(blocks, crown, x, y + 4.4, z, 3.6, 0.5, 3.6, look.propA)
        break
      case 'pine':
        setBlock(blocks, trunk, x, y + 0.6, z, 0.6, 1.2, 0.6, look.propB)
        setBlock(spikes, spike, x, y + 1, z, 2.8, 4.5 + h * 1.5, 2.8, look.propA)
        break
      case 'crystal':
        setBlock(spikes, spike, x, y, z, 1.4 + h, 2.5 + h2 * 3, 1.4 + h, h > 0.5 ? look.propA : look.propB)
        break
      case 'tower': {
        const th = 3 + h * 7
        setBlock(blocks, crown, x, y + th / 2, z, 2, th, 2, h2 > 0.6 ? look.propA : look.propB)
        break
      }
      case 'cloud':
        setBlock(blocks, crown, x, y + 2.5 + h * 2, z, 3.4, 1.6, 2.6, look.propA)
        setBlock(blocks, trunk, x + 0.8, y + 3.3 + h * 2, z, 2, 1.2, 2, look.propB)
        break
      default:
        setBlock(spikes, spike, x, y, z, 1.2, 2 + h2 * 3, 1.2, look.propA)
        setBlock(blocks, crown, x, y + 5 + h * 6, z, 0.6, 0.6, 0.6, look.propB)
    }
  }
}

/** The window's first stair: a little behind whatever the camera looks at. */
const windowStart = () => {
  const fz = runtime.focus.z
  return Math.max(0, (fz < STAIR.startZ ? stairIndexAtZ(fz) : 0) - BACK_STAIRS)
}

/** The recycled window of stairs (2 draw calls) and its Win coins (1 more). */
function StairWindow() {
  const preset = useQuality((s) => s.preset)
  const n = PRESETS[preset].stairWindow

  const pool = useMemo(() => {
    const blocks = new InstancedMesh(getUnitBox(), getBlockMaterial(), n * BLOCKS_PER_STAIR)
    const spikes = new InstancedMesh(getUnitCone(), new MeshLambertMaterial({ color: '#ffffff', flatShading: true }), n * SPIKES_PER_STAIR)
    for (let i = 0; i < blocks.count; i += 1) {
      hideBlock(blocks, i)
      blocks.setColorAt(i, _color.set('#ffffff'))
    }
    for (let i = 0; i < spikes.count; i += 1) {
      hideBlock(spikes, i)
      spikes.setColorAt(i, _color.set('#ffffff'))
    }
    // Gold Win coins, one per pickup stair in the window.
    const coinGeo = new CylinderGeometry(0.55, 0.55, 0.16, 18)
    coinGeo.rotateX(Math.PI / 2)
    const coins = new InstancedMesh(
      coinGeo,
      new MeshLambertMaterial({ color: '#ffc928', emissive: '#a86a00', emissiveIntensity: 0.6 }),
      Math.ceil(n / 20) + 2,
    )
    for (const m of [blocks, spikes, coins]) m.frustumCulled = false
    blocks.receiveShadow = true
    blocks.castShadow = true
    spikes.castShadow = true
    return { blocks, spikes, coins, coinGeo, slotStair: new Int32Array(n).fill(-1), n, pop: new Float32Array(coins.count) }
  }, [n])

  useEffect(
    () => () => {
      pool.spikes.material.dispose()
      pool.coins.material.dispose()
      pool.coinGeo.dispose()
      pool.blocks.dispose()
      pool.spikes.dispose()
      pool.coins.dispose()
    },
    [pool],
  )

  useFrame(({ clock }) => {
    const { blocks, spikes, coins, slotStair } = pool
    const start = windowStart()
    let dirty = false
    for (let k = 0; k < pool.n; k += 1) {
      const i = start + k
      const slot = i % pool.n
      if (slotStair[slot] !== i) {
        writeStair(blocks, spikes, i, slot)
        slotStair[slot] = i
        dirty = true
      }
    }
    if (dirty) {
      blocks.instanceMatrix.needsUpdate = true
      blocks.instanceColor.needsUpdate = true
      spikes.instanceMatrix.needsUpdate = true
      spikes.instanceColor.needsUpdate = true
    }

    // Coins spin over the lane; a collected one shoots up and shrinks away.
    const t = clock.elapsedTime
    let c = 0
    for (let i = start; i < start + pool.n && c < coins.count; i += 1) {
      if (!isPickupStair(i)) continue
      const collected = runtime.collectedUpTo > i
      const k = collected ? Math.min(1, (pool.pop[c] += 0.05)) : (pool.pop[c] = 0)
      _dummy.position.set(0, stairTopY(i) + 1.2 + Math.sin(t * 2 + i) * 0.15 + k * 3, stairCenterZ(i))
      _dummy.rotation.set(0, t * 2.2 + i, 0)
      _dummy.scale.setScalar(collected ? Math.max(0, 1.3 - k * 1.3) : 1)
      _dummy.updateMatrix()
      coins.setMatrixAt(c, _dummy.matrix)
      c += 1
    }
    coins.visible = c > 0
    for (; c < coins.count; c += 1) hideBlock(coins, c)
    coins.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <primitive object={pool.blocks} />
      <primitive object={pool.spikes} />
      <primitive object={pool.coins} />
    </>
  )
}

const SIGN_POOL = 3

/**
 * Name signs over the gates. Sixty stages would mean sixty textures; instead three
 * sprites are reused, each redrawn only when it moves on to a new gate.
 */
function ZoneSigns() {
  const signs = useMemo(
    () =>
      Array.from({ length: SIGN_POOL }, () => {
        const canvas = document.createElement('canvas')
        canvas.width = 512
        canvas.height = 128
        const texture = new CanvasTexture(canvas)
        texture.colorSpace = SRGBColorSpace
        const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false })
        return { canvas, texture, material, zone: -1 }
      }),
    [],
  )
  const refs = useRef([])

  useEffect(
    () => () => {
      for (const s of signs) {
        s.texture.dispose()
        s.material.dispose()
      }
    },
    [signs],
  )

  useFrame(({ camera }) => {
    const start = windowStart()
    // The first stage whose gate is at or past the window's start.
    let zone = 1
    while (zone < ZONES.length && ZONES[zone].start < start) zone += 1
    for (let k = 0; k < SIGN_POOL; k += 1) {
      const sprite = refs.current[k]
      if (!sprite) continue
      const z = zone + k
      if (z >= ZONES.length) {
        sprite.visible = false
        continue
      }
      const sign = signs[z % SIGN_POOL]
      if (sign.zone !== z) {
        sign.zone = z
        drawLabel(sign.canvas, [
          { text: ZONES[z].name.toUpperCase(), size: 56, color: zoneLook(z).accent },
          { text: `STAGE ${z + 1}`, size: 32, color: '#ffffff' },
        ])
        sign.texture.needsUpdate = true
      }
      sprite.material = sign.material
      sprite.position.set(0, stairTopY(ZONES[z].start) + 10.4, stairCenterZ(ZONES[z].start))
      // Passing under the gate: the sign would sit behind the HUD, so let it go.
      sprite.visible = camera.position.distanceTo(sprite.position) > 16
    }
  })

  return signs.map((s, k) => (
    <sprite
      key={k}
      ref={(el) => {
        refs.current[k] = el
      }}
      material={s.material}
      scale={[9, 2.25, 1]}
      visible={false}
    />
  ))
}

/* --------------------------------------------------------------------- Throw */

const PUFFS = 8
const BOTTLE_SCALE = 1.5

/** Seconds between rolling-sound updates (~12 a second; never per frame). */
const ROLL_UPDATE = 0.08
/** Most trail samples emitted along the path in one frame. */
const TRAIL_SUB_MAX = 12
/** Height above the step (units) at which the bottle stops "touching" it for the sound. */
const CONTACT_HEIGHT = 2.2

/** Scratch points on the flight path (never allocated in the frame loop). */
const _at = { x: 0, y: 0, z: 0 }
const _from = { x: 0, y: 0, z: 0 }
const _sub = { x: 0, y: 0, z: 0 }
const _ndc = new Vector3()
/**
 * Replays a throw the server confirmed (runtime.throwPlan): wind-up, the planned hops
 * down the stairs - a "+N" Power popup on every bounce, Win coins collected on the way -
 * a wobble on the last stair, and the shatter.
 */
function ThrowController() {
  const bottleId = useGame((s) => s.profile.equippedBottle)
  const bottle = bottleById(bottleId)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const rootRef = useRef(null)
  const groupRef = useRef(null)
  const blobRef = useRef(null)

  const sim = useMemo(
    () => ({
      phase: 'idle',
      t: 0,
      plan: null,
      hop: 0,
      landed: -1,
      fromX: 0, fromY: 0, fromZ: 0,
      toX: 0, toY: 0, toZ: 0,
      dur: 0.3,
      arc: 1,
      roll: 0,
      rollRate: 0,
      lane: 0,
      earned: 0,
      radius: 0.3,
      squash: 0,
      fill: '#ffffff',
      family: 'classic',
      rollLevel: 0,
      rollAcc: 0,
      pan: 0,
    }),
    [],
  )

  // The trail: one ribbon on every preset, plus twinkling glints where particles are on.
  const glints = useQuality((s) => PRESETS[s.preset].particles)
  const trail = useMemo(() => createBottleTrail(glints ? { points: 64, glints: 40 } : { points: 40, glints: 0 }), [glints])
  useEffect(() => () => trail.dispose(), [trail])

  // The smash: gel balls, glass shards and a flash. Bigger pools where particles are on.
  const smash = useMemo(
    () => (glints ? createShatterFx({ gels: 64, shards: 72, flash: true }) : createShatterFx({ gels: 24, shards: 24, flash: true })),
    [glints],
  )
  useEffect(() => () => smash.dispose(), [smash])

  const fx = useMemo(() => {
    const make = (geo, mat, count) => {
      const m = new InstancedMesh(geo, mat, count)
      m.frustumCulled = false
      for (let i = 0; i < count; i += 1) {
        hideBlock(m, i)
        m.setColorAt(i, _color.set('#ffffff'))
      }
      return m
    }
    const puffs = make(new IcosahedronGeometry(0.5, 0), new MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }), PUFFS)
    const blob = new CircleGeometry(0.55, 20)
    blob.rotateX(-Math.PI / 2)
    const blobMat = new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.32, depthWrite: false })
    return {
      puffs,
      blob,
      blobMat,
      puff: new Float32Array(PUFFS * 4).fill(1), // x, y, z, age (>= 1 = idle)
      puffNext: 0,
    }
  }, [])

  // The smash effects stay hidden until the first smash, so their shaders would compile
  // right at the climax. Compile them now instead (in parallel where the GPU allows it).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    try {
      gl.compileAsync(root, camera, scene).catch(() => {})
    } catch {
      /* they compile on first draw instead */
    }
  }, [gl, scene, camera])

  useEffect(() => {
    runtime.stageReady = true
    return () => {
      runtime.stageReady = false
      sfx.rollStop(0.1)
      fx.puffs.geometry.dispose()
      fx.puffs.material.dispose()
      fx.puffs.dispose()
      fx.blob.dispose()
      fx.blobMat.dispose()
    }
  }, [fx])

  const setLanding = (stairIndex) => {
    sim.lane = Math.max(-3.2, Math.min(3.2, sim.lane + (Math.random() - 0.5) * 2.6))
    sim.toX = sim.lane
    sim.toY = stairTopY(stairIndex) + sim.radius
    sim.toZ = stairCenterZ(stairIndex) + (Math.random() - 0.5) * 0.5
  }

  /** The bottle's position at progress u (0..1) through the current hop, into `out`. */
  const flightAt = (u, out) => {
    out.x = sim.fromX + (sim.toX - sim.fromX) * u
    out.y = sim.fromY + (sim.toY - sim.fromY) * u + sim.arc * 4 * u * (1 - u)
    out.z = sim.fromZ + (sim.toZ - sim.fromZ) * u
    return out
  }

  /**
   * Sends the rolling sound its targets: how hard it tumbles, the tumble rate (turns a
   * second), how close to the step it is (1 = touching) and where it is on screen.
   */
  const updateRoll = (level, x, y, z) => {
    const floor = stairTopY(Math.max(0, stairIndexAtZ(z)))
    const contact = Math.min(1, Math.max(0, 1 - (y - sim.radius - floor) / CONTACT_HEIGHT))
    _ndc.set(x, y, z).project(camera)
    sim.pan = Math.max(-0.7, Math.min(0.7, _ndc.x * 0.7))
    sfx.rollUpdate(level, Math.abs(sim.rollRate) / (Math.PI * 2), contact, sim.pan)
  }

  /**
   * Trail samples along the real path from u0 to u1 this frame (so arcs stay smooth
   * however fast the bottle goes); _at must hold the position at u1.
   */
  const emitTrail = (u0, u1, delta) => {
    flightAt(u0, _from)
    const dx = _at.x - _from.x
    const dy = _at.y - _from.y
    const dz = _at.z - _from.z
    const span = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const speed = span / Math.max(delta, 1e-3)
    trail.setSpeed(speed)
    const power = trailPower(speed)
    const maxLen = trail.maxLen
    // Faster than the whole trail in one frame: only the last trail-length matters.
    const a = span > maxLen ? u1 - (u1 - u0) * (maxLen / span) : u0
    const n = Math.min(TRAIL_SUB_MAX, Math.max(1, Math.ceil(Math.min(span, maxLen) / trail.spacing)))
    for (let i = 1; i <= n; i += 1) {
      flightAt(a + (u1 - a) * (i / n), _sub)
      trail.push(_sub.x, _sub.y, _sub.z, power)
    }
  }

  const beginHop = () => {
    const len = sim.plan.hops[sim.hop]
    sim.fromX = sim.toX
    sim.fromY = sim.toY
    sim.fromZ = sim.toZ
    setLanding(sim.landed + len)
    sim.dur = sim.plan.durations[sim.hop]
    sim.arc = 0.9 + 0.5 * Math.pow(len, 0.75)
    sim.rollRate = -(Math.PI * (1 + Math.min(len, 40) * 0.6)) / sim.dur
    sim.t = 0
    // Rolling sound: louder, brighter and faster on long hops; it calms as hops shorten.
    sim.rollLevel = 0.15 + 0.85 * Math.min(1, Math.log1p(len) / Math.log1p(200))
    sim.rollAcc = 0
    updateRoll(sim.rollLevel, sim.fromX, sim.fromY, sim.fromZ)
  }

  const startThrow = (plan) => {
    const b = bottleById(plan.bottleId)
    sim.plan = plan
    sim.hop = 0
    sim.landed = -1
    sim.earned = 0
    sim.lane = 0
    sim.roll = 0
    sim.radius = 0.23 * BOTTLE_SCALE * b.shape[0]
    sim.fill = b.fill
    sim.family = bottleFamilyId(b)
    sim.phase = 'windup'
    trail.reset()
    trail.setLook(b)
    sim.t = 0
    const p = runtime.playerPos
    sim.toX = p.x + 0.4 * PLAYER_SCALE
    sim.toY = p.y + 1.6 * PLAYER_SCALE
    sim.toZ = p.z - 0.4 * PLAYER_SCALE
    resetRuntimeThrow()
    runtime.mode = 'throw'
    runtime.action = 'throw'
    runtime.actionTime = 0
    runtime.bottlePos.set(sim.toX, sim.toY, sim.toZ)
  }

  const puffAt = (x, y, z) => {
    if (!getPreset().particles) return
    const i = fx.puffNext
    fx.puffNext = (fx.puffNext + 1) % PUFFS
    fx.puff[i * 4] = x
    fx.puff[i * 4 + 1] = y
    fx.puff[i * 4 + 2] = z
    fx.puff[i * 4 + 3] = 0
  }

  const shatter = () => {
    const group = groupRef.current
    if (group) group.visible = false
    trail.kill()
    sfx.rollStop(0.12)
    sfx.shatter(sim.pan, sim.radius / 0.35)
    runtime.shake = 0.8
    const x = sim.toX
    const y = sim.toY
    const z = sim.toZ
    const b = bottleById(sim.plan.bottleId)

    // Gel balls, glass shards and the flash, in step with the audio's shard shower.
    smash.burst(x, y, z, b, sim.radius, camera.position.distanceTo(runtime.bottlePos))

    const plan = sim.plan
    runtime.throwResult = {
      stairs: plan.stairs,
      zone: plan.zone,
      power: sim.earned,
      wins: plan.wins,
      prize: plan.prize,
      best: plan.best,
      discovered: plan.discovered,
    }
    sim.phase = 'shattered'
  }

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const group = groupRef.current

    if (runtime.throwPlan && sim.phase === 'idle') {
      const plan = runtime.throwPlan
      runtime.throwPlan = null
      startThrow(plan)
    }

    runtime.actionTime += delta

    switch (sim.phase) {
      case 'windup': {
        sim.t += delta
        if (group) {
          // Pull back behind the shoulder, then forward to the release point.
          const k = Math.min(sim.t / THROW_WINDUP, 1)
          group.visible = true
          group.position.set(sim.toX, sim.toY + k * 0.3, sim.toZ + Math.sin(Math.PI * k) * 0.6)
          group.rotation.set(-Math.sin(Math.PI * k) * 0.8, 0, 0)
          group.scale.setScalar(BOTTLE_SCALE)
        }
        if (sim.t >= THROW_WINDUP) {
          sfx.throw()
          sfx.rollStart({ size: sim.radius / 0.35, family: sim.family })
          sim.phase = 'flight'
          sim.toY += 0.3
          beginHop()
          // The trail starts in the hand, invisible, and brightens as the bottle speeds up.
          trail.push(sim.fromX, sim.fromY, sim.fromZ, 0)
        }
        break
      }
      case 'flight': {
        const u0 = Math.min(sim.t / sim.dur, 1)
        sim.t += delta
        const u = Math.min(sim.t / sim.dur, 1)
        flightAt(u, _at)
        const x = _at.x
        const y = _at.y
        const z = _at.z
        sim.roll += sim.rollRate * delta
        if (group) {
          group.position.set(x, y, z)
          group.rotation.set(sim.roll, Math.sin(sim.roll * 0.3) * 0.25, Math.PI / 2)
        }
        runtime.bottlePos.set(x, y, z)
        emitTrail(u0, u, delta)

        // Throttled: the sound only gets new targets ~12 times a second.
        sim.rollAcc += delta
        if (sim.rollAcc >= ROLL_UPDATE) {
          sim.rollAcc = 0
          updateRoll(sim.rollLevel * (0.85 + 0.15 * Math.sin(Math.PI * u)), x, y, z)
        }

        if (u >= 1) {
          const before = sim.landed
          sim.landed += sim.plan.hops[sim.hop]
          // Power for the bounce (the server pays the same amount as it lands).
          const profile = getGame().profile
          const gain = gainRoom(profile, baseGain(profile))
          sim.earned += gain
          runtime.throwStair = sim.landed + 1
          runtime.throwZone = zoneIndexAt(sim.landed)
          runtime.throwEarned = sim.earned
          _pop.x = x
          _pop.y = y + 1
          _pop.z = z
          spawnPopup(_pop, gain > 0 ? `+${fmt(gain)}` : 'MAX', 'power')
          // Win coins on every stair passed.
          for (let s = before + 1; s <= sim.landed; s += 1) {
            if (!isPickupStair(s)) continue
            const value = pickupValue(s)
            runtime.throwWins += value
            _pop.x = 0
            _pop.y = stairTopY(s) + 2.2
            _pop.z = stairCenterZ(s)
            spawnPopup(_pop, `+${fmt(value)} Wins`, 'trophy')
            sfx.pickup()
          }
          runtime.collectedUpTo = sim.landed + 1
          const len = sim.plan.hops[sim.hop]
          sfx.bounce(sim.hop, sim.radius / 0.35, 0.55 + 0.45 * Math.min(1, Math.log1p(len) / Math.log1p(40)), sim.pan)
          runtime.shake = Math.min(0.5, 0.06 + Math.min(sim.plan.hops[sim.hop], 30) * 0.02)
          puffAt(x, y - sim.radius, z)
          sim.squash = 1

          sim.hop += 1
          if (sim.hop >= sim.plan.hops.length) {
            sim.phase = 'rest'
            sim.t = 0
            // Settling on the last stair: a slow rocking roll and a rattle until the smash.
            sfx.rollUpdate(0.06, 1.4, 1, sim.pan)
          } else {
            beginHop()
          }
        }
        break
      }
      case 'rest': {
        sim.t += delta
        if (group) {
          const wobble = Math.sin(sim.t * 30) * (1 - sim.t / THROW_REST) * 0.15
          group.rotation.set(sim.roll + wobble, 0, Math.PI / 2)
        }
        if (sim.t >= THROW_REST) shatter()
        break
      }
      case 'shattered':
        // RuntimeSync shows the result, then flips the mode back to 'walk'.
        if (runtime.mode === 'walk') {
          sim.phase = 'idle'
          runtime.action = 'idle'
          sfx.rollStop()
          trail.reset()
        }
        break
      default:
        if (group) group.visible = false
    }

    trail.update(delta, state.clock.elapsedTime, state.gl.domElement.height, state.viewport.dpr)

    // Impact squash: a quick pop of the bottle on every bounce.
    if (group && sim.phase !== 'windup') {
      sim.squash = Math.max(0, sim.squash - delta * 7)
      group.scale.setScalar(BOTTLE_SCALE * (1 + Math.sin(sim.squash * Math.PI) * 0.1))
    }

    // Blob shadow on the step under the bottle.
    const blob = blobRef.current
    if (blob) {
      const airborne = sim.phase === 'flight' || sim.phase === 'rest'
      blob.visible = airborne
      if (airborne) {
        const bp = runtime.bottlePos
        const floorY = stairTopY(Math.max(0, stairIndexAtZ(bp.z))) + 0.03
        const h = Math.max(0, bp.y - floorY)
        blob.position.set(bp.x, floorY, bp.z)
        blob.scale.setScalar(Math.max(0.35, 1.1 - h * 0.12) * (BOTTLE_SCALE / 1.2))
        fx.blobMat.opacity = Math.max(0.08, 0.34 - h * 0.04)
      }
    }

    // Landing puffs.
    let puffsLive = false
    for (let i = 0; i < PUFFS; i += 1) {
      const age = fx.puff[i * 4 + 3]
      if (age < 0.4) {
        fx.puff[i * 4 + 3] = age + delta
        const k = age / 0.4
        const grow = (0.6 + k * 1.4) * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1)
        _dummy.position.set(fx.puff[i * 4], fx.puff[i * 4 + 1] + k * 0.4, fx.puff[i * 4 + 2])
        _dummy.rotation.set(0, i, 0)
        _dummy.scale.set(grow, grow * 0.4, grow)
        _dummy.updateMatrix()
        fx.puffs.setMatrixAt(i, _dummy.matrix)
        puffsLive = true
      } else if (age < 1) {
        fx.puff[i * 4 + 3] = 1
        hideBlock(fx.puffs, i)
        puffsLive = true
      }
    }
    if (puffsLive) fx.puffs.instanceMatrix.needsUpdate = true
    // Nothing to show = not drawn at all (a mesh of zero-scale instances still costs a draw call).
    fx.puffs.visible = puffsLive

    smash.update(delta)
  })

  return (
    <group ref={rootRef}>
      <group ref={groupRef} visible={false}>
        <BottleModel bottle={bottle} position={[0, -0.47, 0]} />
      </group>
      <primitive object={fx.puffs} />
      <primitive object={smash.gels} />
      <primitive object={smash.shards} />
      {smash.flash && <primitive object={smash.flash} />}
      <mesh ref={blobRef} geometry={fx.blob} material={fx.blobMat} visible={false} renderOrder={0} />
      <primitive object={trail.ribbon} />
      {trail.glints && <primitive object={trail.glints} />}
    </group>
  )
}

/* ------------------------------------------------------------- Other players */

const MAX_GHOSTS = 7

/**
 * Other players' throws, replayed from the hops the server broadcast: their bottles
 * tumble down the same stairs (one instanced draw call for all of them).
 */
function GhostBottles() {
  const mesh = useMemo(() => {
    const m = new InstancedMesh(getBottleGeometries().glass, new MeshLambertMaterial({ color: '#ffffff' }), MAX_GHOSTS)
    m.frustumCulled = false
    for (let i = 0; i < MAX_GHOSTS; i += 1) {
      hideBlock(m, i)
      m.setColorAt(i, _color.set('#ffffff'))
    }
    m.castShadow = true
    return m
  }, [])
  /** Which bottle colour each instance slot currently has. */
  const slotColor = useMemo(() => new Array(MAX_GHOSTS).fill(''), [])

  useEffect(
    () => () => {
      mesh.material.dispose()
      mesh.dispose()
    },
    [mesh],
  )

  useFrame(() => {
    const now = performance.now()
    let i = 0
    let colors = false
    for (const [sid, g] of runtime.ghostThrows) {
      const t = (now - g.startedAt) / 1000
      let total = THROW_WINDUP
      for (let h = 0; h < g.durations.length; h += 1) total += g.durations[h]
      if (t > total + THROW_REST) {
        runtime.ghostThrows.delete(sid)
        continue
      }
      if (i >= MAX_GHOSTS) continue
      if (slotColor[i] !== g.bottleId) {
        slotColor[i] = g.bottleId
        mesh.setColorAt(i, _color.set(bottleById(g.bottleId).fill))
        colors = true
      }
      const x = Math.max(-3, Math.min(3, g.x - LAUNCH.x))
      let y = LAUNCH.h + 1.6 * PLAYER_SCALE
      let z = LAUNCH.z - 0.4 * PLAYER_SCALE
      let roll = 0
      if (t > THROW_WINDUP) {
        let at = THROW_WINDUP
        let stair = -1
        let hop = 0
        while (hop < g.hops.length && at + g.durations[hop] < t) {
          at += g.durations[hop]
          stair += g.hops[hop]
          hop += 1
        }
        const fromY = stair < 0 ? y : stairTopY(stair) + 0.35
        const fromZ = stair < 0 ? z : stairCenterZ(stair)
        if (hop >= g.hops.length) {
          y = fromY
          z = fromZ
        } else {
          const u = Math.min(1, (t - at) / g.durations[hop])
          const to = stair + g.hops[hop]
          const arc = 0.9 + 0.5 * Math.pow(g.hops[hop], 0.75)
          y = fromY + (stairTopY(to) + 0.35 - fromY) * u + arc * 4 * u * (1 - u)
          z = fromZ + (stairCenterZ(to) - fromZ) * u
          roll = -t * 9
        }
      }
      // The glass geometry stands on its base; centre it before tumbling.
      _dummy.position.set(x, y, z)
      _dummy.rotation.set(roll, 0, Math.PI / 2)
      _dummy.scale.setScalar(BOTTLE_SCALE)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
      i += 1
    }
    for (let k = i; k < MAX_GHOSTS; k += 1) hideBlock(mesh, k)
    mesh.visible = i > 0
    mesh.instanceMatrix.needsUpdate = true
    if (colors) mesh.instanceColor.needsUpdate = true
  })

  return <primitive object={mesh} />
}

export function Staircase() {
  return (
    <>
      <StairWindow />
      <ZoneSigns />
      <ThrowController />
      <GhostBottles />
    </>
  )
}

export default Staircase
