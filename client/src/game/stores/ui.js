import { create } from 'zustand'

function readFlag(key, fallback) {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writeFlag(key, value) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* not remembered */
  }
}

/**
 * Transient UI state (not saved). Written from UI events, network events and
 * RuntimeSync's 10 Hz interval - never from inside useFrame.
 */
export const useUi = create((set) => ({
  /** Mirrors runtime.nearby. */
  nearby: null,
  /** Shop pedestal (BOTTLES index) the player stands at, or -1. */
  pedestal: -1,
  /** Mirrors runtime.mode. */
  mode: 'walk',
  training: false,
  stageReady: false,

  /** Live throw read-out. */
  throwStair: 0,
  throwZone: 0,
  throwEarned: 0,
  throwWins: 0,
  /** Sent THROW, waiting for the server to confirm. */
  throwPending: false,

  /** { stairs, zone, power, wins, prize, best } shown after the shatter. */
  result: null,
  /** Stage index shown in the banner while it's up. */
  /** { level, maxed, id } for the level-up pop. */
  levelUp: null,
  /** { rebirths, gift, id } for the rebirth celebration. */
  celebrate: null,

  /** 'bottles' | 'pets' | 'rebirth' | 'settings' | null */
  panel: null,
  /** { pets, egg, at } while the hatch animation plays. */
  hatching: null,
  /** Arrived in a world through the portal: { world, name, unlocked, id }, for the banner. */
  worldArrive: null,
  toasts: [],

  soundOn: true,
  /** Background music; remembered in this browser. */
  musicOn: readFlag('bt.music', true),
  /** True once the lobby is on screen. */
  loaded: false,
  /** Set a beat after `loaded`: decorative extras mount then, off the critical path. */
  settled: false,
  contextLost: false,

  openPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),
  setSoundOn: (soundOn) => set({ soundOn }),
  setMusicOn: (musicOn) => {
    writeFlag('bt.music', musicOn)
    set({ musicOn })
  },
}))

let toastId = 0
export function toast(text, tone = 'info') {
  if (!text) return
  const id = (toastId += 1)
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }))
  setTimeout(() => {
    useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }, 2600)
}
