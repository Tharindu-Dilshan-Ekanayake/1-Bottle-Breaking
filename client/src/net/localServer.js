import { applyOfflineProgress, migrateLegacySave, normalizeProfile } from '@shared/logic'
import { PlayerSession } from '@shared/session'
import { SPAWN } from '@shared/world'

import { runtime } from '../game/runtime'

const SAVE_KEY = 'bt.save.v2'
/** The first, client-only version of the game saved here (zustand persist). */
const LEGACY_KEY = 'bottle-tumble-save-v1'
const TICK_MS = 100
const SAVE_MS = 5000

function loadSave() {
  try {
    const current = localStorage.getItem(SAVE_KEY)
    if (current) return JSON.parse(current)
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
    return legacy?.state ? migrateLegacySave(legacy.state) : null
  } catch {
    return null
  }
}

/** Set while offline play runs; lets the `?perf` probe adjust the local save. */
export const localDebug = { profile: null, session: null }

/**
 * Offline stand-in for the game server: runs the same PlayerSession the Colyseus room
 * runs, against a save in localStorage. Used when no server is configured or it can't
 * be reached, so the game is always playable.
 */
export function createLocalServer({ id, name, onEvent }) {
  const profile = normalizeProfile(loadSave(), id, name)
  const startedAt = Date.now()
  const offline = applyOfflineProgress(profile, startedAt)

  const session = new PlayerSession(profile, {
    now: startedAt,
    // The session mutates its profile in place; the UI gets its own copy, or it would
    // never see a change (same reference) and could edit authority state.
    emit: (type, payload) => onEvent(type, payload ? structuredClone(payload) : payload),
    getPosition: () => runtime.playerPos,
    onTravel: () => onEvent('spawn', { x: SPAWN.x, z: SPAWN.z }),
  })
  localDebug.profile = profile
  localDebug.session = session

  const save = () => {
    try {
      profile.lastSeen = Date.now()
      localStorage.setItem(SAVE_KEY, JSON.stringify(profile))
    } catch {
      // Storage full or blocked: progress just won't persist this session.
    }
  }

  let last = performance.now()
  const tickId = setInterval(() => {
    const t = performance.now()
    session.tick(Math.min(0.5, (t - last) / 1000), Date.now())
    last = t
  }, TICK_MS)
  const saveId = setInterval(save, SAVE_MS)
  const onHide = () => {
    if (document.visibilityState === 'hidden') save()
  }
  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', onHide)

  session.sendProfile()
  if (offline) onEvent('offline', offline)

  return {
    send(type, payload) {
      // Offline there is no server to ask Boxity, so these are granted here - and the
      // client only sends them after the SDK reported a completed ad / a purchase.
      if (type === 'adReward') return void session.grantAdReward(String(payload?.placement || ''), Date.now())
      if (type === 'gemsLocal') return void session.grantGemProduct(String(payload?.sku || ''))
      if (type === 'gemsCheck') return undefined
      if (type === 'respawn') return void onEvent('spawn', { x: SPAWN.x, z: SPAWN.z })
      session.handle(type, payload, Date.now())
    },
    close() {
      clearInterval(tickId)
      clearInterval(saveId)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onHide)
      save()
      localDebug.profile = null
      localDebug.session = null
    },
  }
}
