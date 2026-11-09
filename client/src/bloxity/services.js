import { actions } from '../net/actions'
import { currentRoomId, isOnline } from '../net/connection'
import { getGame } from '../store/game'
import { getSDK, safeCall } from './sdk'
import { getBloxityState, useBloxityStore } from './store'

/**
 * Boxity services for the game's UI: rewarded ads, friends and invites, screen
 * ads and the portal's leaderboards. Plain functions - call them from anywhere.
 *
 * Every call is safe without the SDK (offline, outside Boxity, script blocked): it
 * reports "not available" instead of throwing. Async ones never reject.
 *
 * Grants are never decided here. Online, the game server verifies Boxity's word (the
 * rewarded-ad token, the Gems webhook). Offline there is no server, so the offline
 * stand-in (net/localServer.js) grants - and it is only told to after Boxity reported
 * a completed ad / a successful purchase.
 */

const errorText = (err) => (err instanceof Error ? err.message : String(err ?? 'error'))

/** Is the game playing offline against its local stand-in? */
const playingOffline = () => !isOnline() && getGame().net.mode === 'offline'

// --- Rewarded ads ---------------------------------------------------------------------

/** True when Boxity can show a rewarded ad here (inside the portal, ads enabled). */
export function isRewardedAvailable() {
  const sdk = getSDK()
  return Boolean(safeCall(sdk?.ads?.isAvailable?.bind(sdk.ads)))
}

/**
 * Shows a rewarded ad for `placement` ('free-power') and, if it
 * was watched to the end, claims the reward.
 *
 * @returns {Promise<{ ok: boolean, status: string, reason?: string }>} `ok` once the
 *   claim was sent (the reward itself arrives as a profile update / 'reward' event);
 *   `status` is Boxity's ('completed', 'skipped', 'disabled', 'error', ...).
 */
export async function watchRewardedAd(placement) {
  try {
    const sdk = getSDK()
    if (typeof sdk?.ads?.showRewarded !== 'function') return { ok: false, status: 'disabled', reason: 'no-sdk' }
    const result = await sdk.ads.showRewarded(placement)
    const status = result?.status || 'error'
    if (status !== 'completed') return { ok: false, status, reason: result?.reason }

    if (isOnline()) {
      // The server checks the token with Boxity once; no token, no reward.
      if (!result.rewardToken) return { ok: false, status, reason: 'no-reward-token' }
      actions.adReward(placement, result.rewardToken)
      return { ok: true, status }
    }
    if (playingOffline()) {
      actions.adReward(placement, result.rewardToken ?? null)
      return { ok: true, status }
    }
    return { ok: false, status, reason: 'not-connected' }
  } catch (err) {
    return { ok: false, status: 'error', reason: errorText(err) }
  }
}

// --- Friends and invites ----------------------------------------------------------------

/** Re-reads the signed-in player's Boxity friends into the store ([] for guests). */
export async function refreshFriends() {
  const store = useBloxityStore.getState()
  const user = store.user
  const social = getSDK()?.social
  if (!user || typeof social?.getFriends !== 'function') {
    store.setFriends([])
    return []
  }
  try {
    const friends = await social.getFriends()
    if (useBloxityStore.getState().user !== user) return getBloxityState().friends
    const list = Array.isArray(friends) ? friends : []
    useBloxityStore.getState().setFriends(list)
    return list
  } catch (err) {
    console.warn('[bloxity] friends unavailable', err)
    return getBloxityState().friends
  }
}

/**
 * React hook: the player's Boxity friends, `[{ _id, username, displayName, pfp,
 * presence: { status: 'online'|'in-game'|'away'|'offline', gameName? } }]`.
 */
export function useFriends() {
  return useBloxityStore((s) => s.friends)
}

/** Makes sure Boxity knows the room we're in before anything builds a join link. */
function reportRoom() {
  const game = getSDK()?.game
  safeCall(game?.updateRoom?.bind(game), currentRoomId() || '')
}

/** A shareable link that brings friends into this game (and room), or null. */
export function getInviteLink() {
  const social = getSDK()?.social
  if (typeof social?.getInviteFriendsLink !== 'function') return null
  reportRoom()
  return safeCall(social.getInviteFriendsLink.bind(social)) || null
}

/** Invites Boxity friend `userId` to this room. Resolves true when the invite was sent. */
export async function inviteFriend(userId) {
  try {
    const social = getSDK()?.social
    if (!userId || typeof social?.inviteFriend !== 'function') return false
    reportRoom()
    return Boolean(await social.inviteFriend(userId))
  } catch (err) {
    console.warn('[bloxity] invite failed', err)
    return false
  }
}

// --- Screen ads -----------------------------------------------------------------------

/*
 * Ads only ever show while a popup (a full-screen panel) is open: a banner each side of
 * it when the screen has room, else one strip under it. Never during play.
 */

/** Side banners Boxity can place beside a popup, biggest first: [size, width, height]. */
const SIDE_SIZES = [
  ['300x600', 300, 600],
  ['160x600', 160, 600],
  ['300x250', 300, 250],
]
/** The strip under a popup on screens too narrow for side banners. */
const STRIP = ['320x50', 320, 50]
/** Space kept round every banner (and under the top bar). */
const AD_GAP = 12
const TOP_BAR = 64

/** A popup's width on a `w` x `h` screen (Panel.jsx: min(920 units, 100vw - 60 units - 16px)). */
function popupWidth(w, h) {
  const unit = Math.min(1.4, Math.max(0.3, w < h ? Math.min(w / 1000, h / 1900) : Math.min(w / 1920, h / 1080)))
  return Math.min(920 * unit, w - 60 * unit - 16)
}

/**
 * Which banners fit beside a popup on a `w` x `h` screen, as Boxity's `ads.screen()`
 * options: `{ sizes, skip }`, plus `strip` (px to keep free under the popup) - or null
 * when nothing fits without covering the popup.
 */
export function panelAdLayout(w = window.innerWidth, h = window.innerHeight) {
  const side = (w - popupWidth(w, h)) / 2 - AD_GAP * 2
  const tall = h - TOP_BAR - AD_GAP * 2
  const fit = SIDE_SIZES.find(([, sw, sh]) => sw <= side && sh <= tall)
  if (fit) return { sizes: { 'middle-left': fit[0], 'middle-right': fit[0] }, skip: ['bottom-center'], strip: 0 }
  if (w >= STRIP[1] + AD_GAP * 2 && h >= 560) return { sizes: { 'bottom-center': STRIP[0] }, skip: ['middle-left', 'middle-right'], strip: STRIP[2] + AD_GAP }
  return null
}

let screenType = null
let screenSizes = ''

/** Moves the popups up to clear a strip banner under them (Panel.jsx reads --ad-bottom). */
function setStrip(px) {
  document.documentElement.style.setProperty('--ad-bottom', `${px}px`)
}

/**
 * Tells Boxity which screen the player is on, for its screen ads: 'panel' while a popup
 * is open (banners beside it, when they fit), and nothing at all during play.
 * integration.js switches this automatically from the game store's `panel`, and again
 * when the window is resized; calling it with the same screen and layout does nothing.
 */
export function setScreen(type) {
  if (type !== 'panel') {
    hideScreen()
    return
  }
  const ads = getSDK()?.ads
  if (typeof ads?.screen !== 'function') return
  const layout = panelAdLayout()
  if (!layout) {
    hideScreen()
    return
  }
  const key = JSON.stringify(layout.sizes)
  if (screenType === type && screenSizes === key) return
  screenType = type
  screenSizes = key
  setStrip(layout.strip)
  safeCall(ads.screen.bind(ads), type, { sizes: layout.sizes, skip: layout.skip })
}

/** Takes Boxity's screen ads down (back to play, or teardown). */
export function hideScreen() {
  setStrip(0)
  if (!screenType) return
  screenType = null
  screenSizes = ''
  const ads = getSDK()?.ads
  safeCall(ads?.hideScreen?.bind(ads))
}

// --- Leaderboards ----------------------------------------------------------------------

/**
 * Opens Boxity's leaderboard overlay on board `id` ('rebirths', 'wins', 'stairs',
 * 'playtime'). False when the portal can't show it.
 */
export function openBoxityLeaderboard(id) {
  const board = getSDK()?.leaderboard
  return Boolean(safeCall(board?.open?.bind(board), id))
}

// --- Portal ---------------------------------------------------------------------------

/**
 * True when the game runs inside a Boxity page (bloxity.io, its CrazyGames build...).
 * Boxity's toolbar handles accounts there: the game draws no Log in / Log out.
 */
export function isEmbeddedInBoxity() {
  const portal = getSDK()?.portal
  return Boolean(safeCall(portal?.isEmbeddedInLegion?.bind(portal)))
}

// --- Account --------------------------------------------------------------------------

/** Called by BloxityProvider on every login/logout: loads or clears the account data. */
export function onAccountChanged(user) {
  if (user) refreshFriends()
  else useBloxityStore.getState().setFriends([])
}

/** React hook: true while Boxity plays an ad break (pause rendering then). */
export function useAdBreak() {
  return useBloxityStore((s) => s.adBreak)
}
