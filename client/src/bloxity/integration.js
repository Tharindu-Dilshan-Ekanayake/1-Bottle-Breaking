import { LEADERBOARDS } from '@shared/balance'
import { leaderboardScores } from '@shared/logic'

import { setAdBreakMuted, setMasterVolume, setMusicVolume } from '../game/audio'
import { runtime } from '../game/runtime'
import { useQuality } from '../game/stores/quality'
import { useUi } from '../game/stores/ui'
import { actions } from '../net/actions'
import { getGame, useGame } from '../store/game'
import { handleChatMessage } from './chat'
import { loadEmotes, playLocalEmote, stopLocalEmote } from './emotes'
import { safeCall, toUnsubscribe } from './sdk'
import { hideScreen, setScreen } from './services'
import { getBloxityState, useBloxityStore } from './store'

/**
 * Everything the game wires into the Boxity SDK besides auth and the avatar (those stay
 * in BloxityProvider): features, leaderboards, ad breaks and screen ads, the portal's
 * settings menu, portal-sent player events (Reset Character, emotes), chat bubbles,
 * the gameplay lifecycle and - when playing offline - leaderboard scores.
 *
 * `setupOnce` runs once per page right after `init()`; `installIntegration` runs per
 * provider mount and returns its teardown (StrictMode mounts twice in dev).
 */

/**
 * Every screen this game has, for Boxity's screen ads. There is no title menu, lobby or
 * results screen: you are in the 3D lobby from the first frame. 'panel' is a popup
 * (Bottle Shop, Pets, Rebirth, Upgrades, Daily, Gifts, Settings, Friends): the only place
 * ads show - a banner each side of it, or one strip under it on narrow screens (which
 * one is picked per screen size in services.js `panelAdLayout`). Gameplay never shows
 * a banner; it is declared (`show: false`) so Boxity's admins can see that.
 */
const SIDE_SIZES = ['300x600', '160x600', '300x250']
const SCREENS = {
  panel: {
    show: true,
    slots: [
      { position: 'middle-left', sizes: SIDE_SIZES },
      { position: 'middle-right', sizes: SIDE_SIZES },
      { position: 'bottom-center', sizes: ['320x50'] },
    ],
  },
  gameplay: { show: false },
}

/** Once per page, right after `Legion.SDK.init()`. */
export function setupOnce(sdk) {
  const ads = sdk.ads
  safeCall(ads?.declareScreens?.bind(ads), SCREENS)
  // Boxity draws the emote picker once a game says it can play emotes.
  safeCall(sdk.game?.registerFeature?.bind(sdk.game), 'emotes')
  // Declaring the boards is also what shows the trophy button in Boxity's toolbar.
  safeCall(sdk.leaderboard?.define?.bind(sdk.leaderboard), LEADERBOARDS)
}

/** Subscribes `fn` through an SDK `on*` method if it exists; returns the unsubscribe. */
function subscribe(target, method, fn) {
  return toUnsubscribe(safeCall(target?.[method]?.bind(target), fn))
}

// --- Ad breaks ------------------------------------------------------------------------

function setAdBreak(on) {
  if (getBloxityState().adBreak === on) return
  useBloxityStore.getState().setAdBreak(on)
  setAdBreakMuted(on)
}

// --- Settings (the Boxity portal menu) --------------------------------------------------

const QUALITY_FROM_SETTING = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH', ultra: 'HIGH' }
const QUALITY_ORDER = ['LOW', 'MEDIUM', 'HIGH']

function parseNumber(value, min, max, fallback) {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/**
 * `settings.listen(key, cb)` registers a control in the portal menu and calls `cb` at
 * once with the current value - which, before the portal has sent the player's real
 * settings, is Boxity's default (graphics "High"). So: `initial` is true for that first
 * value (and for `triggerAll()` right after), `changed` for a later, different value.
 */
const SETTINGS = {
  master_volume(value) {
    setMasterVolume(parseNumber(value, 0, 100, 80) / 100)
  },
  music_volume(value) {
    setMusicVolume(parseNumber(value, 0, 100, 80) / 100)
  },
  graphics_quality(value, { initial, changed }) {
    const level = QUALITY_FROM_SETTING[String(value).trim().toLowerCase()]
    if (!level) return
    const quality = useQuality.getState()
    if (initial) {
      // The default must never raise an auto-detected weak device: only a lower setting
      // applies at startup, and it stays 'auto' (the FPS monitor may still drop it).
      if (QUALITY_ORDER.indexOf(level) < QUALITY_ORDER.indexOf(quality.preset)) useQuality.setState({ preset: level })
      return
    }
    // The player picked it in the portal menu: a manual choice.
    if (changed && quality.preference !== level) quality.setPreference(level)
  },
  show_fps(value) {
    useBloxityStore.getState().setSetting({ showFps: value === 'true' })
  },
  camera_sensitivity(value) {
    useBloxityStore.getState().setSetting({ cameraSensitivity: parseNumber(value, 0.1, 5, 1) })
  },
  enable_chat(value) {
    useBloxityStore.getState().setSetting({ chatEnabled: value !== 'false' })
  },
  background_transparency(value) {
    // How solid the panels' backgrounds are (0.2-1): a CSS variable the panels read.
    document.documentElement.style.setProperty('--panel-alpha', String(parseNumber(value, 0.2, 1, 0.9)))
  },
  fullscreen(value, { initial, changed }, sdk) {
    // Only a change the player made: the initial "false" must not exit a fullscreen the
    // portal itself entered.
    if (initial || !changed) return
    const portal = sdk.portal
    if (value === 'true') safeCall(portal?.requestFullscreen?.bind(portal))
    else if (value === 'false') safeCall(portal?.exitFullscreen?.bind(portal))
  },
}

function installSettings(sdk) {
  const settings = sdk.settings
  if (typeof settings?.listen !== 'function') return () => {}
  const unsubscribers = []
  const lastSeen = new Map()
  let starting = true
  for (const [key, apply] of Object.entries(SETTINGS)) {
    const listener = (raw) => {
      const value = raw === undefined || raw === null ? '' : String(raw)
      const first = !lastSeen.has(key)
      const changed = !first && lastSeen.get(key) !== value
      lastSeen.set(key, value)
      try {
        apply(value, { initial: starting || first, changed }, sdk)
      } catch (err) {
        console.warn(`[bloxity] setting ${key} failed`, err)
      }
    }
    unsubscribers.push(toUnsubscribe(safeCall(settings.listen.bind(settings), key, listener)))
  }
  safeCall(settings.triggerAll?.bind(settings))
  starting = false
  return () => unsubscribers.forEach((fn) => safeCall(fn))
}

/**
 * The game's own Settings panel saves graphics through Boxity too, so the choice follows
 * the player into every game ('auto' is this game's own and isn't sent).
 */
export function saveGraphicsSetting(sdk, preference) {
  const value = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' }[preference]
  if (!value) return
  safeCall(sdk?.settings?.set?.bind(sdk.settings), { graphics_quality: value })
}

// --- Player events from the portal ---------------------------------------------------

function onPlayerEvent(event, data) {
  switch (event) {
    case 'respawn_request':
      // Not mid-throw: the camera is following the bottle down the stairs.
      if (runtime.mode !== 'walk') return
      stopLocalEmote()
      actions.respawn()
      return
    case 'play_emote':
      playLocalEmote(typeof data === 'string' ? data : (data?.id ?? data?.emoteId))
      return
    default:
      // 'chat_message_sent', 'pointer_lock_changed' and anything newer: nothing to do
      // (chat bubbles come from chat.onMessage).
      return
  }
}

function installPlayerEvents(sdk) {
  const player = sdk.player
  if (typeof player?.onEvent === 'function') {
    return subscribe(player, 'onEvent', (event, data) => {
      try {
        onPlayerEvent(event, data)
      } catch (err) {
        console.warn('[bloxity] player event failed', event, err)
      }
    })
  }
  // Older SDK builds: only the respawn request.
  return subscribe(player, 'onRespawnRequest', () => onPlayerEvent('respawn_request'))
}

// --- Gameplay lifecycle + screen ads ---------------------------------------------------

/** gameplayStart is reported once per page (and again after a bfcache restore). */
let gameplayStarted = false

function installLifecycle(sdk) {
  const game = sdk.game
  const start = () => {
    if (gameplayStarted) return
    gameplayStarted = true
    safeCall(game?.gameplayStart?.bind(game))
  }
  const end = () => {
    if (!gameplayStarted) return
    gameplayStarted = false
    safeCall(game?.gameplayEnd?.bind(game))
  }
  /**
   * Play is "on" except while a popup is open: Boxity's ad breaks come at gameplay
   * pauses, so they wait for a popup instead of cutting into play. Screen ads follow
   * the same rule (banners beside the popup only).
   */
  const sync = (state) => {
    if (!state.loaded) return
    if (state.panel) end()
    else start()
    setScreen(state.panel ? 'panel' : 'gameplay')
  }
  sync(useUi.getState())
  const unsubscribe = useUi.subscribe((state, prev) => {
    if (state.loaded !== prev.loaded || Boolean(state.panel) !== Boolean(prev.panel)) sync(state)
  })
  // A popup's banners are re-picked when the window changes size (rotate, resize).
  let resizeTimer = 0
  const onResize = () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => sync(useUi.getState()), 250)
  }

  const onPageShow = (e) => {
    if (e.persisted) sync(useUi.getState())
  }
  window.addEventListener('pagehide', end)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('resize', onResize)
  return () => {
    unsubscribe()
    clearTimeout(resizeTimer)
    window.removeEventListener('pagehide', end)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('resize', onResize)
    hideScreen()
  }
}

// --- Leaderboards while offline -----------------------------------------------------------

/** At most one round of submissions this often. */
const OFFLINE_SUBMIT_MS = 15000

/**
 * Online, the game server reports leaderboard scores. Offline (no server, see
 * net/localServer.js) nobody would, so the browser submits: after profile changes,
 * throttled, and only scores higher than the last sent ('best' boards keep the best
 * anyway). Signed-in players only.
 */
function installOfflineLeaderboards(sdk) {
  const board = sdk.leaderboard
  if (typeof board?.submit !== 'function') return () => {}
  let sent = {}
  let sentFor = null
  let timer = null
  let lastAt = 0

  const flush = () => {
    timer = null
    lastAt = performance.now()
    const { net, profile } = getGame()
    const user = getBloxityState().user
    if (net.mode !== 'offline' || !user || !safeCall(sdk.auth?.getToken?.bind(sdk.auth))) return
    if (sentFor !== user._id) {
      sent = {}
      sentFor = user._id
    }
    for (const [id, score] of Object.entries(leaderboardScores(profile))) {
      if (!(score > (sent[id] ?? 0))) continue
      sent[id] = score
      Promise.resolve(safeCall(board.submit.bind(board), id, score)).catch((err) => {
        console.warn(`[bloxity] leaderboard ${id} submit failed`, err)
        delete sent[id]
      })
    }
  }

  const unsubscribe = useGame.subscribe((state, prev) => {
    if (state.profile === prev.profile || state.net.mode !== 'offline' || timer) return
    timer = setTimeout(flush, Math.max(0, lastAt + OFFLINE_SUBMIT_MS - performance.now()))
  })
  return () => {
    unsubscribe()
    clearTimeout(timer)
    timer = null
  }
}

// --- Install --------------------------------------------------------------------------

/** Wires the SDK into the game; returns the teardown. Never throws. */
export function installIntegration(sdk) {
  const teardown = []
  const guard = (label, install) => {
    try {
      teardown.push(install())
    } catch (err) {
      console.warn(`[bloxity] ${label} setup failed`, err)
    }
  }

  // Ad breaks: pause (the canvas stops rendering on `adBreak`) and mute; resume with the
  // player's own audio settings untouched.
  guard('ads', () => {
    const offStart = subscribe(sdk.ads, 'onBreakStart', () => setAdBreak(true))
    const offEnd = subscribe(sdk.ads, 'onBreakEnd', () => setAdBreak(false))
    return () => {
      offStart()
      offEnd()
      setAdBreak(false)
    }
  })
  guard('settings', () => installSettings(sdk))
  guard('player events', () => installPlayerEvents(sdk))
  guard('chat', () => subscribe(sdk.chat, 'onMessage', (m) => handleChatMessage(sdk, m)))
  guard('lifecycle', () => installLifecycle(sdk))
  guard('leaderboards', () => installOfflineLeaderboards(sdk))
  loadEmotes()

  return () => teardown.forEach((fn) => safeCall(fn))
}
