import { BOTTLES, PADS } from '@shared/balance'
import { isPadUnlocked } from '@shared/logic'
import { LAUNCH, padCenterZ, pedestalFront, PIT } from '@shared/world'

/**
 * The first-time guide, worked out from the profile alone (nothing extra is saved):
 *  1. TRAINING - train TRAIN_GOAL reps on a pit;
 *  2. THROW    - throw your bottle from the throw zone;
 *  3. BOTTLES  - buy a second bottle in the shop;
 *  0. done (anyone who owns two bottles never sees it).
 */
export const TRAIN_GOAL = 5
export const TUTORIAL_STEPS = 3

export function tutorialStep(profile) {
  if (profile.ownedBottles.length >= 2) return 0
  if (profile.stats.throws >= 1) return 3
  if (profile.stats.trains >= TRAIN_GOAL) return 2
  return 1
}

/**
 * Where step `step` points from (x, z): written into `out` ({ x, z }), so the frame loop
 * allocates nothing. False when there's nothing to point at.
 */
export function tutorialTarget(step, profile, x, z, out) {
  if (step === 1) {
    let best = Infinity
    for (let i = 0; i < PADS.length; i += 1) {
      if (!isPadUnlocked(profile, i)) continue
      const px = PIT.topX + PIT.plateDepth / 2
      const pz = padCenterZ(i)
      const d = (px - x) ** 2 + (pz - z) ** 2
      if (d < best) {
        best = d
        out.x = px
        out.z = pz
      }
    }
    return best < Infinity
  }
  if (step === 2) {
    out.x = LAUNCH.x
    out.z = LAUNCH.z
    return true
  }
  if (step === 3) {
    const next = BOTTLES.findIndex((b) => !profile.ownedBottles.includes(b.id))
    if (next < 0) return false
    const front = pedestalFront(next)
    out.x = front.x
    out.z = front.z
    return true
  }
  return false
}
