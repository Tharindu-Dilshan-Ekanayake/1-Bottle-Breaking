import { runtime } from '../game/runtime'
import { send } from '../net/actions'
import { apiUrl } from './env'

/**
 * Boxity emotes.
 *
 * Boxity draws the emote picker itself and tells the game which one to play through
 * `player.onEvent('play_emote', id)`; the game only plays the animation. The catalog
 * comes from `{apiUrl}/v1/avatar/emotes`, fetched once:
 *   [{ id, name, price, free, icon, clip: { len, loop, tracks } }]
 * where `tracks` maps a bone name to keys `[timeSeconds, xDeg, yDeg, zDeg]`: rotation
 * DELTAS over the bind pose (see avatarRig.updateEmote for how they are applied).
 *
 * No ids are hardcoded and nothing is checked for ownership (Boxity only offers what the
 * player owns); an id not in the catalog is ignored.
 *
 * Your own emote is replicated with the room message `emote { id }` (`{ id: '' }` when
 * it ends). The server keeps it on your synced state with a counter, so everyone else
 * plays it too, and plays it again when you pick the same one twice.
 */

/** id -> { id, len, loop, tracks: [{ bone, keys: [[t, xDeg, yDeg, zDeg]] }] } */
const clips = new Map()
let loading = null

const toNumber = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/** A catalog clip in a shape cheap to sample, or null if it's malformed. */
function normalizeClip(id, clip) {
  if (!clip || typeof clip !== 'object' || !clip.tracks || typeof clip.tracks !== 'object') return null
  const tracks = []
  let lastKey = 0
  for (const [bone, rawKeys] of Object.entries(clip.tracks)) {
    if (!Array.isArray(rawKeys)) continue
    const keys = []
    for (const k of rawKeys) {
      if (!Array.isArray(k)) continue
      const [t, x, y, z] = k.map(toNumber)
      if (t === null) continue
      keys.push([t, x ?? 0, y ?? 0, z ?? 0])
    }
    if (keys.length === 0) continue
    keys.sort((a, b) => a[0] - b[0])
    lastKey = Math.max(lastKey, keys[keys.length - 1][0])
    tracks.push({ bone, keys })
  }
  if (tracks.length === 0) return null
  const len = toNumber(clip.len)
  return { id, len: len && len > 0 ? len : Math.max(lastKey, 0.001), loop: Boolean(clip.loop), tracks }
}

/** Fetches the catalog once; later calls share the same promise. Never rejects. */
export function loadEmotes() {
  if (!loading) {
    try {
      loading = fetch(`${apiUrl()}/v1/avatar/emotes`)
        .then((res) => (res.ok ? res.json() : []))
        .then((body) => {
          const list = Array.isArray(body) ? body : Array.isArray(body?.emotes) ? body.emotes : []
          for (const emote of list) {
            const id = emote?.id ?? emote?._id
            if (id === undefined || id === null) continue
            const clip = normalizeClip(String(id), emote.clip)
            if (clip) clips.set(String(id), clip)
          }
          return clips
        })
        .catch((err) => {
          console.warn('[bloxity] emote catalog unavailable', err)
          // Let a later call try again.
          loading = null
          return clips
        })
    } catch (err) {
      // No fetch (an old browser, a test runner): no emotes, never an error.
      console.warn('[bloxity] emote catalog unavailable', err)
      return Promise.resolve(clips)
    }
  }
  return loading
}

/** The playable clip for an emote id, or null when unknown (or not loaded yet). */
export function getEmoteClip(id) {
  return (id && clips.get(String(id))) || null
}

// --- Your own emote -------------------------------------------------------------------

/** The emote you are playing now, or null, and when it started (performance.now()). */
let localEmoteId = null
let localStartedAt = 0
/** Bumped on every start, so picking the same emote again restarts it. */
let localSeq = 0
/** Whether the server was told about the current emote (and so must hear it end). */
let localShared = false
/** Emote ids are only sent in this shape (the server accepts exactly this). */
const REPLICABLE = /^[a-f0-9]{24}$/i

/**
 * Anything that ends an emote: moving, being in the air, training, or a throw (any mode
 * but walking around).
 */
const isBusy = () =>
  runtime.mode !== 'walk' || runtime.action === 'train' || runtime.playerSpeed > 0.5 || !runtime.grounded

function share(id) {
  try {
    send('emote', { id })
  } catch {
    // Offline or mid-reconnect: the emote still plays here.
  }
}

function startLocal(id) {
  localEmoteId = id
  localStartedAt = performance.now()
  localSeq = (localSeq + 1) % 65536
  localShared = REPLICABLE.test(id)
  if (localShared) share(id)
}

/** Accepts the id as Boxity sends it: a string, or an object carrying one. */
function emoteId(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (value && typeof value === 'object') return emoteId(value.id ?? value.emoteId ?? value._id ?? '')
  return ''
}

/**
 * Plays emote `id` on your character (Boxity's play_emote). Unknown ids do nothing; if
 * the catalog is still loading, it plays once it arrives (unless you moved meanwhile).
 * Ignored while you're moving, jumping, training or throwing. Never throws.
 */
export function playLocalEmote(id) {
  try {
    const key = emoteId(id)
    if (!key || isBusy()) return
    if (getEmoteClip(key)) {
      startLocal(key)
      return
    }
    const askedAt = performance.now()
    loadEmotes().then(() => {
      try {
        if (getEmoteClip(key) && performance.now() - askedAt < 1500 && !isBusy()) startLocal(key)
      } catch {
        // Never surfaces.
      }
    })
  } catch {
    // Never surfaces.
  }
}

/** Ends your emote (and tells the others). Never throws. */
export function stopLocalEmote() {
  if (!localEmoteId) return
  localEmoteId = null
  if (localShared) share('')
  localShared = false
}

/**
 * Your current emote id, or null. Called every frame by your avatar: it ends the emote
 * once you move, jump, train or throw, or when a one-shot clip has played through.
 */
export function updateLocalEmote() {
  if (!localEmoteId) return null
  const clip = getEmoteClip(localEmoteId)
  const elapsed = (performance.now() - localStartedAt) / 1000
  if (!clip || isBusy() || (!clip.loop && elapsed > clip.len)) stopLocalEmote()
  return localEmoteId
}

/** Reused every frame: never allocate in the render loop. */
const _local = { emote: null, emoteSeq: 0 }

/**
 * Your emote in the shape an avatar plays it from (`{ emote, emoteSeq }`, as on a
 * remote player's motion). Advances it like updateLocalEmote; the object is reused.
 */
export function localEmote() {
  _local.emote = updateLocalEmote()
  _local.emoteSeq = localSeq
  return _local
}
