import { groundHeightAt, padAt, padCenterZ, PIT } from '@shared/world'

import { ANIM_NAMES, SNAPSHOTS } from '../../net/remotePlayers'
import { PLAYER_SCALE } from '../playerSize'

/**
 * Turns another player's snapshots (net/remotePlayers.js) into what their character
 * does this frame: where they stand, which way they face, and the motion state their
 * avatar is posed from - the same fields the local Player feeds avatarRig.animateRig,
 * so a remote player walks, sprints, jumps, trains, throws, cheers and emotes exactly
 * like you see yourself. Their bottle's trip down a training pit is replayed here too,
 * rep by rep, as PitBottle does for yours.
 *
 * Everything writes into the player's own preallocated record; nothing allocates.
 */

/** How far in the past remote players are drawn (reports come every 100 ms). */
export const INTERP_DELAY_MS = 150
/** Past the newest report, keep moving along the last segment for at most this long. */
const MAX_EXTRAPOLATE_MS = 100
/** Two reports further apart than this don't make a segment to extrapolate along. */
const SEGMENT_MS = 260
/** The throw wind-up and follow-through, timed from the server's 'ghostThrow'. */
const THROW_HOLD_MS = 1500
/** Speed at which the run cycle is at full stride (a local walk is 7). */
const FULL_SPEED = 6
/** Slower than this is standing still. */
const MOVING_SPEED = 0.6
/** Higher than this above the ground is airborne. */
const AIR_HEIGHT = 0.15

// The training pit bottle, as PitBottle.jsx.
const PIT_SCALE = 0.75
const PIT_RADIUS = 0.23 * PIT_SCALE
const HOP = 0.42
const TOSS = 0.46
const REST = 0.3

const WALK = ANIM_NAMES.indexOf('walk')
const RUN = ANIM_NAMES.indexOf('run')
const JUMP = ANIM_NAMES.indexOf('jump')

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * Places `r` (position, netYaw, animCode) where its snapshots say it was at
 * `renderTime`. False if there's nothing to place yet.
 */
function sample(r, renderTime) {
  if (r.count === 0) return false
  const ring = r.ring
  const oldest = (r.head - r.count + SNAPSHOTS) % SNAPSHOTS
  let a = ring[oldest]
  let b = null
  for (let k = 1; k < r.count; k += 1) {
    const s = ring[(oldest + k) % SNAPSHOTS]
    if (s.t > renderTime) {
      b = s
      break
    }
    a = s
  }
  const p = r.position
  if (a.t > renderTime || (!b && r.count === 1)) {
    // Before the first report (or only one): stand there.
    p.set(a.x, a.y, a.z)
    r.netYaw = a.r
    r.animCode = a.a
  } else if (b) {
    const u = (renderTime - a.t) / Math.max(1, b.t - a.t)
    p.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u)
    r.netYaw = a.r + angleDelta(a.r, b.r) * u
    r.animCode = a.a
  } else {
    // Past the newest report (it's late): carry on along the last segment for a
    // moment if they were moving, rather than stopping dead and then jumping.
    const prev = ring[(r.head - 2 + SNAPSHOTS) % SNAPSHOTS]
    const span = a.t - prev.t
    const over = Math.min(renderTime - a.t, MAX_EXTRAPOLATE_MS)
    const moving = a.a === WALK || a.a === RUN || a.a === JUMP
    if (moving && span > 0 && span < SEGMENT_MS) {
      const k = over / span
      const x = a.x + (a.x - prev.x) * k
      const z = a.z + (a.z - prev.z) * k
      p.set(x, Math.max(groundHeightAt(x, z), a.y + (a.y - prev.y) * k), z)
    } else p.set(a.x, a.y, a.z)
    r.netYaw = a.r
    r.animCode = a.a
  }
  return true
}

/** Where step `k` of pit `pad` is (shared/world pitStep, without the allocation). */
function pitLanding(pit, pad, k) {
  if (k >= PIT.stepCount) {
    pit.toX = (PIT.topX - PIT.stepCount * PIT.stepDepth + PIT.floorX) / 2
    pit.toY = -(PIT.stepCount + 1) * PIT.stepDrop
  } else {
    pit.toX = PIT.topX - (k + 0.5) * PIT.stepDepth
    pit.toY = -(k + 1) * PIT.stepDrop
  }
  pit.toZ = padCenterZ(pad)
}

/**
 * Their right hand: the posed hand bone once their avatar is drawn (RemotePlayers keeps
 * r.hand up to date), else where PitBottle.handPosition puts it.
 */
function handPosition(r, pit) {
  if (r.handOk) {
    pit.fromX = r.hand.x
    pit.fromY = r.hand.y
    pit.fromZ = r.hand.z
    return
  }
  const p = r.position
  const fx = Math.sin(r.yaw)
  const fz = Math.cos(r.yaw)
  pit.fromX = p.x + (fx * 0.45 - fz * 0.35) * PLAYER_SCALE
  pit.fromY = p.y + 1.25 * PLAYER_SCALE
  pit.fromZ = p.z + (fz * 0.45 + fx * 0.35) * PLAYER_SCALE
}

/** One training rep: a fresh toss from the hand, or a hop down to the next step. */
function startHop(r, pit) {
  if (pit.step < 0 || pit.step >= PIT.stepCount) {
    handPosition(r, pit)
    pit.step = 0
    pit.dur = TOSS
    pit.arc = 1.3
    pit.roll = 0
    r.motion.tossTime = 0
    r.motion.trainHops = 0
  } else {
    r.motion.trainHops += 1
    pit.fromX = pit.toX
    pit.fromY = pit.toY
    pit.fromZ = pit.toZ
    pit.step += 1
    pit.dur = HOP
    pit.arc = 0.7
  }
  pitLanding(pit, pit.pad, pit.step)
  pit.toX += (Math.random() - 0.5) * 0.4
  pit.toY += PIT_RADIUS
  pit.toZ += (Math.random() - 0.5) * 1.6
  pit.t = 0
  pit.hopping = true
  r.motion.repTime = 0
}

/** Advances their pit bottle; it sits in their hand between tosses. */
function updatePit(r, training, delta) {
  const pit = r.pit
  if (!training) {
    r.handOk = false
    pit.pad = -1
    pit.step = -1
    pit.hopping = false
    pit.rest = 0
    // Reps that arrive just before the (delayed) pose shows them training are kept.
    if (r.anim !== 'train') r.pendingReps = 0
    return
  }
  if (pit.pad < 0) {
    pit.pad = padAt(r.position.x, r.position.z, 0.6)
    pit.step = -1
    pit.hopping = false
    // Just arrived: the first rep tosses a fresh bottle.
    r.motion.trainHops = 6
    r.motion.repTime = 0
    if (pit.pad < 0) return
  }
  r.motion.repTime += delta
  r.motion.interval = r.repGap ? r.repGap / 1000 : 0.6
  if (!pit.hopping && pit.rest <= 0 && r.pendingReps > 0) {
    r.pendingReps -= 1
    startHop(r, pit)
  }
  if (pit.hopping) {
    pit.t += delta
    const u = Math.min(1, pit.t / pit.dur)
    pit.x = pit.fromX + (pit.toX - pit.fromX) * u
    pit.y = pit.fromY + (pit.toY - pit.fromY) * u + pit.arc * 4 * u * (1 - u)
    pit.z = pit.fromZ + (pit.toZ - pit.fromZ) * u
    pit.roll += delta * 13
    if (u >= 1) {
      pit.hopping = false
      pit.squash = 1
      if (pit.step >= PIT.stepCount) pit.rest = REST
    }
  } else if (pit.step < 0) {
    handPosition(r, pit)
    pit.x = pit.fromX
    pit.y = pit.fromY + Math.sin(r.motion.tossTime * 6) * 0.04
    pit.z = pit.fromZ
  }
  if (pit.rest > 0) {
    pit.rest -= delta
    // Splashed down on the pit floor: the next rep tosses a fresh bottle.
    if (pit.rest <= 0) pit.step = -1
  }
  pit.squash = Math.max(0, pit.squash - delta * 6)
}

/** The pit bottle's size (PitBottle's SCALE). */
export const PIT_BOTTLE_SCALE = PIT_SCALE

/**
 * Advances remote player `r` to now: position and facing from the snapshots, speed and
 * vertical speed from how that moved, and the motion state (r.motion) for the pose.
 */
export function updateRemote(r, now, delta) {
  const p = r.position
  const px = p.x
  const py = p.y
  const pz = p.z
  if (!sample(r, now - INTERP_DELAY_MS)) return
  // Throwing from the server's broadcast (so the arm whips with their bottle's launch),
  // held while their reports say they're still at it. A throw always faces down the
  // stairs (as Player.jsx turns you), before their own report of it arrives.
  const recentThrow = r.throwAt > 0 && now - r.throwAt < THROW_HOLD_MS
  if (recentThrow) r.netYaw = Math.PI
  if (r.snapped) {
    // Just arrived (or teleported): appear there, facing their way, standing.
    r.snapped = false
    r.yaw = r.netYaw
    r.speed = 0
    r.vy = 0
  } else {
    const d = Math.max(delta, 1e-3)
    const ease = 1 - Math.exp(-12 * delta)
    r.speed += (Math.hypot(p.x - px, p.z - pz) / d - r.speed) * ease
    r.vy += ((p.y - py) / d - r.vy) * (1 - Math.exp(-15 * delta))
    // Turned as smoothly as your own character turns (Player.jsx).
    r.yaw += angleDelta(r.yaw, r.netYaw) * (1 - Math.pow(0.0005, delta))
  }

  const anim = ANIM_NAMES[r.animCode] || 'idle'
  const m = r.motion
  m.time += delta

  const action = anim === 'throw' || recentThrow ? 'throw' : anim === 'train' ? 'train' : 'idle'
  if (recentThrow && r.throwShown !== r.throwAt) {
    r.throwShown = r.throwAt
    m.action = 'throw'
    m.actionTime = (now - r.throwAt) / 1000
  } else if (action !== m.action) {
    m.action = action
    m.actionTime = 0
  } else m.actionTime += delta

  const air = anim === 'jump' || p.y > groundHeightAt(p.x, p.z) + AIR_HEIGHT
  const striding = anim === 'walk' || anim === 'run'
  const moving = striding || r.speed > MOVING_SPEED
  m.grounded = !air
  m.vy = r.vy
  m.speed = moving ? Math.max(r.speed, striding ? 2.5 : 0) : 0
  m.maxSpeed = FULL_SPEED
  m.sprint = anim === 'run' ? 1 : 0
  m.cheer = anim === 'cheer' ? 1 : 0
  // Their Boxity emote plays while they stand still; it ends the moment they move,
  // even before their '' (stop) arrives.
  m.emote = r.emote && action === 'idle' && !moving && !air ? r.emote : null
  m.emoteSeq = r.emoteSeq

  m.tossTime += delta
  updatePit(r, action === 'train', delta)
  if (action !== 'train') m.tossTime = 9
}
