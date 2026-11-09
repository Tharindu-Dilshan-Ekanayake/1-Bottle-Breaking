import { Vector3 } from 'three'

import { getEmoteClip, loadEmotes } from '../bloxity/emotes'

/**
 * Other players, as the network last described them. Network callbacks write here; the
 * renderer (game/remote) reads it each frame and interpolates between snapshots, drawing
 * everyone a little in the past so 10 Hz updates still move smoothly.
 *
 * Each position report carries the sender's own clock (`stamp`, ms mod 65536), so a
 * snapshot is placed on the timeline when it was sampled, not when its patch happened
 * to arrive: patches land on a 15 Hz grid and through network jitter, and timing them
 * by arrival makes a steady walk stutter. The sender's clock is mapped onto ours by the
 * smallest arrival delay seen (creeping up slowly, so a lasting change in latency or
 * clock drift is followed).
 */

/** sessionId -> remote player */
export const remotePlayers = new Map()

/** What a player can be doing, as stored per snapshot (index = code). */
export const ANIM_NAMES = ['idle', 'walk', 'run', 'jump', 'train', 'throw', 'cheer']
const ANIM_CODE = Object.fromEntries(ANIM_NAMES.map((name, i) => [name, i]))

/** Snapshot ring size per player: ~1.6 s at 10 Hz, far more than the render delay needs. */
export const SNAPSHOTS = 16
/** A report this long after the previous one starts from a standstill (see push). */
const GAP_MS = 250
/** The sender's report interval (connection.js POSITION_HZ). */
const REPORT_MS = 100
/** Further than this between two reports is a teleport (respawn, portal): no sliding. */
const TELEPORT_DISTANCE = 6
/** How fast the clock mapping follows rising latency, in ms per ms. */
const OFFSET_CREEP = 0.01
/** Most the clock mapping in use moves per report (2% of a 100 ms segment). */
const OFFSET_STEP_MS = 2
/** A clock mapping this far off is corrected in one go. */
const OFFSET_SNAP_MS = 50
/** Silence longer than this (a long-hidden tab) resets the clock mapping. */
const CLOCK_RESET_MS = 30_000
/** Training reps queued for the pit bottle at most (like runtime.MAX_TRAIN_PULSES). */
const MAX_PENDING_REPS = 6

function newPlayer(sessionId, state) {
  return {
    sessionId,
    name: '',
    /** Their verified Boxity user id ('' for guests): matches Boxity chat to them. */
    uid: '',
    world: 1,
    /** When we first heard of them (RemoteAvatars waits a moment for their outfit). */
    seenAt: performance.now(),
    // Snapshot ring, allocated once per player and reused: { t, x, y, z, r, a }.
    ring: Array.from({ length: SNAPSHOTS }, () => ({ t: 0, x: 0, y: 0, z: 0, r: 0, a: 0 })),
    /** Next slot to write, and how many slots hold snapshots. */
    head: 0,
    count: 0,
    /** Sender clock mapping (see the file comment). */
    clock: { seen: false, stamp: 0, sender: 0, offset: 0, applied: 0, at: 0 },
    lastRecv: 0,
    /** Set when the player jumped (teleport): the renderer snaps instead of sliding. */
    snapped: true,
    /** Latest reported state (the renderer uses the snapshots, which lag it). */
    anim: 'idle',
    // Allocated once per player, when they join - never per frame.
    position: new Vector3(state.x || 0, state.y || 0, state.z || 0),
    /** Facing from the snapshots, and the eased facing the body is drawn with. */
    netYaw: state.rotY || 0,
    yaw: state.rotY || 0,
    speed: 0,
    vy: 0,
    animCode: 0,
    bottleId: 'glass',
    rebirths: 0,
    /** Name tag text: name, and rebirths if any. */
    label: '',
    /** Their avatar's outfit, parsed from `look`; `lookKey` is the raw string. */
    look: null,
    lookKey: '',
    petIds: [],
    /** Follow state per equipped pet, grown as needed and reused. */
    pets: [],
    /** The Boxity emote they're playing ('' = none); a new `emoteSeq` replays it. */
    emote: '',
    emoteSeq: 0,
    /** Training reps counter (mod 256), and reps not yet shown by the pit bottle. */
    reps: -1,
    pendingReps: 0,
    /** performance.now() when their throw started (the 'ghostThrow' broadcast), or 0. */
    throwAt: 0,
    /** The throwAt the pose last started a throw from. */
    throwShown: 0,
    /** Motion the avatar is posed from (avatarRig.animateRig), updated by the renderer. */
    motion: {
      time: 0, speed: 0, grounded: true, maxSpeed: 6, action: 'idle', actionTime: 0, tossTime: 9, vy: 0,
      cheer: 0, sprint: 0, emote: null, emoteSeq: 0,
    },
    /** Their bottle's trip down a training pit (game/remote). */
    pit: {
      pad: -1, step: -1, hopping: false, t: 0, dur: 0, arc: 0, roll: 0, rest: 0, squash: 0,
      fromX: 0, fromY: 0, fromZ: 0, toX: 0, toY: 0, toZ: 0, x: 0, y: 0, z: 0,
    },
  }
}

/** Writes a snapshot into the ring (overwriting the oldest when full). */
function write(r, t, x, y, z, rot, a) {
  const s = r.ring[r.head]
  s.t = t
  s.x = x
  s.y = y
  s.z = z
  s.r = rot
  s.a = a
  r.head = (r.head + 1) % SNAPSHOTS
  r.count = Math.min(SNAPSHOTS, r.count + 1)
}

/** The newest snapshot, or null. */
export function newestSnapshot(r) {
  return r.count > 0 ? r.ring[(r.head - 1 + SNAPSHOTS) % SNAPSHOTS] : null
}

/**
 * When (on our clock) the report carrying `stamp` was sampled, or null if `stamp`
 * isn't a new report (a patch of other fields) or the sender sends no stamps.
 */
function sampleTime(r, stamp, now) {
  const c = r.clock
  if (!Number.isInteger(stamp)) return null
  if (now - r.lastRecv > CLOCK_RESET_MS) c.seen = false
  if (!c.seen) {
    c.seen = true
    c.stamp = stamp
    c.sender = 0
    c.offset = now
    c.applied = now
    c.at = now
    return now
  }
  if (stamp === c.stamp) return null
  c.sender += (stamp - c.stamp) & 0xffff
  c.stamp = stamp
  const offset = now - c.sender
  c.offset = Math.min(offset, c.offset + (now - c.at) * OFFSET_CREEP)
  c.at = now
  // The mapping actually used moves towards that a little per report, so one quick
  // packet can't shorten a segment (and speed them up) by its whole head start. A big
  // difference (the first reports after joining, a network change) is taken at once.
  const diff = c.offset - c.applied
  c.applied = Math.abs(diff) > OFFSET_SNAP_MS ? c.offset : c.applied + Math.max(-OFFSET_STEP_MS, Math.min(OFFSET_STEP_MS, diff))
  return c.sender + c.applied
}

/** Adds a position report to the timeline. */
function push(r, t, x, y, z, rot, a) {
  const last = newestSnapshot(r)
  if (last) {
    const jump = Math.hypot(x - last.x, z - last.z)
    if (jump > TELEPORT_DISTANCE) {
      r.count = 0
      r.snapped = true
    } else {
      t = Math.max(t, last.t + 1)
      // Reports stop while a player stands still; the first one after a pause must
      // start from where they stood, not slide there across the whole pause.
      if (t - last.t > GAP_MS) write(r, t - REPORT_MS, last.x, last.y, last.z, last.r, last.a)
    }
  } else r.snapped = true
  write(r, t, x, y, z, rot, a)
}

export function upsertRemotePlayer(sessionId, state) {
  const now = performance.now()
  let r = remotePlayers.get(sessionId)
  if (!r) {
    r = newPlayer(sessionId, state)
    remotePlayers.set(sessionId, r)
  }
  r.name = state.name
  r.uid = state.uid || ''
  r.world = state.world || 1
  const anim = ANIM_CODE[state.anim] !== undefined ? state.anim : 'idle'
  const code = ANIM_CODE[anim]
  const emote = typeof state.emote === 'string' ? state.emote : ''
  const emoteSeq = state.emoteSeq || 0
  // A new emote whose clip isn't in yet: make sure the catalog is on its way (it's
  // fetched once and shared; this only runs on a change, never per frame).
  if (emote && (emote !== r.emote || emoteSeq !== r.emoteSeq) && !getEmoteClip(emote)) loadEmotes()
  r.emote = emote
  r.emoteSeq = emoteSeq
  r.bottleId = state.bottleId || 'glass'
  r.rebirths = state.rebirths || 0
  // Their name tag, built here (on a change) rather than every frame.
  r.label = r.rebirths > 0 ? `${r.name} · R${r.rebirths}` : r.name
  if (state.look !== r.lookKey) {
    r.lookKey = state.look || ''
    try {
      r.look = state.look ? JSON.parse(state.look) : null
    } catch {
      r.look = null
    }
  }
  // Pets: only rebuilt when they change (this runs on every patch, training included).
  const petIds = state.petIds
  if (petIds.length !== r.petIds.length || r.petIds.some((id, i) => id !== petIds[i])) r.petIds = [...petIds]
  while (r.pets.length < r.petIds.length) {
    r.pets.push({ id: '', position: r.position.clone(), yaw: 0, hop: 0 })
  }

  // Training reps: each one is a bounce of their bottle down the pit.
  const reps = Number.isInteger(state.reps) ? state.reps : 0
  if (r.reps >= 0 && reps !== r.reps) r.pendingReps = Math.min(MAX_PENDING_REPS, r.pendingReps + ((reps - r.reps) & 0xff))
  r.reps = reps

  // Position: a new report (a new stamp) goes on the timeline at its sample time. A
  // sender without stamps (an older client) is timed by arrival instead.
  const t = sampleTime(r, state.stamp, now)
  const last = newestSnapshot(r)
  const changed = !last || last.x !== state.x || last.y !== state.y || last.z !== state.z || last.r !== state.rotY || last.a !== code
  if (t !== null) {
    if (changed) push(r, t, state.x, state.y, state.z, state.rotY, code)
  } else if (changed) push(r, now, state.x, state.y, state.z, state.rotY, code)
  r.anim = anim
  r.lastRecv = now
}

/** Their throw began (the server's 'ghostThrow'): the wind-up plays with their bottle. */
export function markRemoteThrow(sessionId) {
  const r = remotePlayers.get(sessionId)
  if (r) r.throwAt = performance.now()
}

export function removeRemotePlayer(sessionId) {
  remotePlayers.delete(sessionId)
}

export function clearRemotePlayers() {
  remotePlayers.clear()
}
