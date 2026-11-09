// Re-exports for the progression tests, plus a small helper.
import { levelCap, powerForLevel } from '../../shared/balance.js'

export {
  applyRebirth,
  applyThrow,
  buyPerk,
  buyUpgrade,
  claimDaily,
  claimPlaytime,
  createProfile,
  dailyStatus,
  gainMultiplier,
  maxEquippedPets,
  normalizeProfile,
  throwReachFor,
  upgradeCost,
} from '../../shared/logic.js'

/** Power at the profile's level cap (so it can rebirth). */
export const powerForLevelCap = (profile) => powerForLevel(levelCap(profile.rebirths))
