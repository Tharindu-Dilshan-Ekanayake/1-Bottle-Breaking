import { getSDK, safeCall } from './sdk'

/**
 * Who this player is, for the game server: the single source of the player id, the
 * game slug and the Boxity token every join sends.
 */

export const GAME_SLUG = import.meta.env.VITE_GAME_SLUG || '1-bottle-breaking'

const GUEST_KEY = 'bt.guestId'

/**
 * A stable per-browser id for players with no Boxity identity at all (the SDK never
 * loaded). `?tabguest` gives the tab a guest of its own instead, for trying several
 * players from one browser.
 */
function localGuestId() {
  try {
    const storage = new URLSearchParams(window.location.search).has('tabguest') ? sessionStorage : localStorage
    let id = storage.getItem(GUEST_KEY)
    if (!id) {
      id = `guest-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
      storage.setItem(GUEST_KEY, id)
    }
    return id
  } catch {
    return `guest-${Math.random().toString(36).slice(2)}`
  }
}

/**
 * The id progress is saved under: the signed-in Boxity user's `_id`, else the Boxity
 * guest's `_id`, else this browser's own guest id. `?tabguest` always takes the last.
 */
export function playerIdFor(user, guest) {
  if (user?._id) return String(user._id)
  const tabGuest = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tabguest')
  if (!tabGuest && guest?._id) return String(guest._id)
  return localGuestId()
}

/** The SDK's game token for the server to verify, or null (guest / no SDK). */
export function joinToken() {
  const sdk = getSDK()
  return safeCall(sdk?.auth?.getToken?.bind(sdk.auth)) || null
}

/** Strips the 'legion_' prefix Boxity puts on some user ids (chat messages). */
export function bareUserId(id) {
  return typeof id === 'string' ? id.replace(/^legion_/, '') : ''
}
