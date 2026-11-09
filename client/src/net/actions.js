/**
 * Player intents. The UI never changes game state itself: it calls one of these, the
 * authority (the Colyseus room, or the offline stand-in) validates it, and the result
 * comes back as an updated profile or an event.
 */

let transport = null

/** Installs the active connection: `{ send(type, payload) }`. */
export function setTransport(next) {
  transport = next
}

export function send(type, payload) {
  transport?.send(type, payload)
}

export const actions = {
  throwBottle: () => send('throw'),
  enterPad: (pad) => send('enterPad', { pad }),
  leavePad: () => send('leavePad'),
  rebirth: () => send('rebirth'),
  skipRebirth: () => send('skipRebirth'),
  buyBottle: (id) => send('buyBottle', { id }),
  /** Buys Power pack `index` (0-2) from the bar under the level. */
  buyPack: (index) => send('buyPack', { index }),
  equipBottle: (id) => send('equipBottle', { id }),
  hatch: (eggId) => send('hatch', { eggId }),
  equipPet: (uid) => send('equipPet', { uid }),
  unequipPet: (uid) => send('unequipPet', { uid }),
  equipBestPets: () => send('equipBest'),
  deletePet: (uid) => send('deletePet', { uid }),
  setSetting: (key, value) => send('setting', { key, value }),
  claimDaily: () => send('claimDaily'),
  claimPlaytime: (index) => send('claimPlaytime', { index }),
  buyUpgrade: (id) => send('buyUpgrade', { id }),
  buyPerk: (id) => send('buyPerk', { id }),
  /** Through the portal to `world` (unlocking it first if it can be). */
  travel: (world) => send('travel', { world }),
  /** A rewarded ad Boxity reported completed; the server verifies the token first. */
  adReward: (placement, rewardToken) => send('adReward', { placement, rewardToken }),
  /** "I just bought something": apply any Gems grant Boxity's webhook recorded. */
  gemsCheck: () => send('gemsCheck'),
  /** Boxity's "Reset Character": back to the spawn point. */
  respawn: () => send('respawn'),
}
