import { BOTTLES } from '@shared/balance'

/** Pedestal states, encoded one digit per bottle so the store selector returns a string. */
export const LOCKED = 0
export const OWNED = 1
export const NEXT = 2
export const NEXT_AFFORDABLE = 3
export const EQUIPPED = 4

/** Your state at every shop pedestal, one digit per bottle (a string, so the store selector is stable). */
export function shopKey(s) {
  const p = s.profile
  const wins = p.wins - s.pendingWins
  const next = BOTTLES.findIndex((b) => !p.ownedBottles.includes(b.id))
  let key = ''
  for (let i = 0; i < BOTTLES.length; i += 1) {
    const b = BOTTLES[i]
    if (p.equippedBottle === b.id) key += EQUIPPED
    else if (p.ownedBottles.includes(b.id)) key += OWNED
    else if (i === next) key += wins >= b.cost ? NEXT_AFFORDABLE : NEXT
    else key += LOCKED
  }
  return key
}

/**
 * When each bottle was last unlocked (performance.now() ms, 0 = never this session):
 * the aura and the shop bottle play their unlock burst from it.
 */
export const shopBursts = new Float64Array(BOTTLES.length)

/** How long the unlock burst plays, in seconds. */
export const BURST_SECONDS = 1.1
