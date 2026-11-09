import { create } from 'zustand'

import { createProfile, createSession } from '@shared/logic'

/**
 * The authoritative game state as the client last heard it. Written only by the network
 * layer (profile, events) and UI events - never from a frame loop.
 *
 * Components select narrowly (`useGame((s) => s.profile.wins)`), so a Power tick
 * re-renders the Power label and nothing else.
 */
export const useGame = create((set) => ({
  /** The player's save, as last sent by the server (or the offline stand-in). */
  profile: createProfile('local', 'Player'),
  session: createSession(Date.now()),
  /** True once the first real profile has arrived. */
  profileLoaded: false,

  net: {
    /** 'connecting' | 'online' | 'offline' | 'replaced' */
    mode: 'connecting',
    roomId: null,
    players: 1,
    maxPlayers: 8,
    message: null,
  },

  /** Wins of the throw in flight, held back from the HUD until the bottle shatters. */
  pendingWins: 0,

  setProfile: (profile, session) => set((s) => ({ profile, session: session || s.session, profileLoaded: true, profileAt: Date.now() })),
  /** When the last full profile arrived (ms), for client-side estimates like today's playtime. */
  profileAt: Date.now(),
  patchProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
  setNet: (patch) => set((s) => ({ net: { ...s.net, ...patch } })),
  holdWins: (pendingWins) => set({ pendingWins }),
}))

/** Non-reactive snapshot for timers and non-React code. */
export const getGame = () => useGame.getState()
