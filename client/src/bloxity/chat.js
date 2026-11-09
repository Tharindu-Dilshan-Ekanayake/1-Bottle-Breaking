import { bareUserId } from './identity'
import { safeCall } from './sdk'
import { getBloxityState } from './store'

/**
 * Chat bubbles over players.
 *
 * Boxity owns the chat itself (the input box, the history, moderation); the game never
 * draws a chat box. It only shows each new message as a bubble over the sender's name
 * tag for `chat.bubbleSeconds`, a newer message replacing the older one.
 *
 * Messages arrive from `Legion.SDK.chat.onMessage` (installed in integration.js) as
 *   { userId, username, text, isGif, at, isLocalPlayer }
 * Other players are matched by their Boxity user id, which the server syncs as `uid`
 * (guests have none: they are matched by name instead). Your own message is shown over
 * your character (see nameplates.placeLocalBubble).
 *
 * Read by the name tags every frame, so lookups are plain map reads.
 */

const DEFAULT_SECONDS = 4

/** Boxity user id -> { text, until } */
const byUid = new Map()
/** lower-cased username -> { text, until }, for players without a uid (guests). */
const byName = new Map()
/** Your own bubble: { text, until } or null. */
let local = null

/** Handles one `chat.onMessage` message. Never throws. */
export function handleChatMessage(sdk, m) {
  if (!m || typeof m !== 'object') return
  const text = String(safeCall(sdk?.chat?.bubbleText?.bind(sdk.chat), m) ?? (m.isGif ? 'sent a GIF' : m.text ?? '')).trim()
  if (!text) return
  const seconds = Number(sdk?.chat?.bubbleSeconds) > 0 ? Number(sdk.chat.bubbleSeconds) : DEFAULT_SECONDS
  const bubble = { text, until: performance.now() + seconds * 1000 }
  if (m.isLocalPlayer) {
    local = bubble
    return
  }
  const uid = bareUserId(m.userId)
  if (uid) byUid.set(uid, bubble)
  if (typeof m.username === 'string' && m.username) byName.set(m.username.toLowerCase(), bubble)
}

function live(map, key, now) {
  const bubble = map.get(key)
  if (!bubble) return null
  if (bubble.until <= now) {
    map.delete(key)
    return null
  }
  return bubble.text
}

/**
 * The bubble text to show over a remote player right now, or null. `uid` is their
 * synced Boxity id ('' for guests), `name` their display name.
 */
export function bubbleFor(uid, name, now = performance.now()) {
  if (!getBloxityState().chatEnabled) return null
  if (uid) {
    const text = live(byUid, bareUserId(uid), now)
    if (text) return text
  }
  return name ? live(byName, String(name).toLowerCase(), now) : null
}

/** Your own bubble text right now, or null. */
export function localBubble(now = performance.now()) {
  if (!local || !getBloxityState().chatEnabled) return null
  if (local.until <= now) {
    local = null
    return null
  }
  return local.text
}

export function clearBubbles() {
  byUid.clear()
  byName.clear()
  local = null
}
