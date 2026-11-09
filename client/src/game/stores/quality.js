import { create } from 'zustand'

/**
 * Quality presets. Every visual feature reads its setting from here before it renders.
 *
 *   LOW    dpr 1, no shadows, no post-processing, no particles, short view distance
 *   MEDIUM capped dpr, small soft shadows, particles
 *   HIGH   full dpr, more clouds/anisotropy, longest view distance
 *
 * There is no post-processing at any preset.
 */
export const PRESETS = {
  LOW: {
    dpr: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    particles: false,
    clouds: 0,
    viewDistance: 140,
    fogNear: 45,
    fogFar: 130,
    stairWindow: 70,
    anisotropy: 1,
    maxPopups: 8,
    /** Other players drawn as their real Bloxity avatar (the rest are block figures). */
    remoteAvatars: 2,
    remoteAvatarDistance: 22,
    remoteDrawDistance: 70,
    remoteNameDistance: 28,
  },
  MEDIUM: {
    dpr: [1, 1.5],
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    particles: true,
    clouds: 10,
    viewDistance: 260,
    fogNear: 90,
    fogFar: 240,
    stairWindow: 110,
    anisotropy: 4,
    maxPopups: 14,
    remoteAvatars: 4,
    remoteAvatarDistance: 32,
    remoteDrawDistance: 110,
    remoteNameDistance: 40,
  },
  HIGH: {
    dpr: [1, 2],
    antialias: true,
    shadows: true,
    // 1024 keeps even the shadow render target inside the 1024px desktop texture cap.
    shadowMapSize: 1024,
    particles: true,
    clouds: 18,
    viewDistance: 380,
    fogNear: 130,
    fogFar: 360,
    stairWindow: 150,
    anisotropy: 8,
    maxPopups: 20,
    remoteAvatars: 6,
    remoteAvatarDistance: 45,
    remoteDrawDistance: 150,
    remoteNameDistance: 50,
  },
}

const ORDER = ['LOW', 'MEDIUM', 'HIGH']
const PREF_KEY = 'bottle-tumble-quality'

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1 // iPadOS
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || touchMac
}

/** Mobile or <= 4 cores -> LOW. Otherwise 8+ cores -> HIGH, else MEDIUM. */
export function detectPreset() {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4
  if (isMobileDevice() || cores <= 4) return 'LOW'
  return cores >= 8 ? 'HIGH' : 'MEDIUM'
}

function readPref() {
  try {
    const v = window.localStorage.getItem(PREF_KEY)
    return v === 'LOW' || v === 'MEDIUM' || v === 'HIGH' || v === 'auto' ? v : 'LOW'
  } catch {
    return 'LOW'
  }
}

function writePref(v) {
  try {
    window.localStorage.setItem(PREF_KEY, v)
  } catch {
    /* ignore */
  }
}

const initialPref = readPref()

export const useQuality = create((set, get) => ({
  /** 'auto' or a fixed preset the player picked in Settings. */
  preference: initialPref,
  preset: initialPref === 'auto' ? detectPreset() : initialPref,
  /** How many times the performance monitor has stepped quality down. */
  autoDrops: 0,

  setPreference: (preference) => {
    writePref(preference)
    set({ preference, preset: preference === 'auto' ? detectPreset() : preference })
  },

  /**
   * Called (deferred, never from inside a frame) when the performance monitor sees
   * the frame rate fall under 45. Only acts while the player is on 'auto'.
   */
  dropPreset: () => {
    const { preference, preset, autoDrops } = get()
    if (preference !== 'auto') return
    const i = ORDER.indexOf(preset)
    if (i <= 0) return
    set({ preset: ORDER[i - 1], autoDrops: autoDrops + 1 })
  },
}))

/** Non-reactive read for render-loop code. */
export const getPreset = () => PRESETS[useQuality.getState().preset]
