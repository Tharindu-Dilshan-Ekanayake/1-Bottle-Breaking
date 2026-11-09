import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DAILY_REWARDS, PLAYTIME_GIFTS, WORLDS } from '../../shared/balance.js'
import {
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
  powerForLevelCap,
  throwReachFor,
  upgradeCost,
} from './progressionHelpers.js'
import { PlayerSession } from '../../shared/session.js'
import { PORTAL } from '../../shared/world.js'

const DAY = 86400000
const T0 = Date.UTC(2026, 10, 9, 12)

test('daily rewards: one a day, in order; a missed day starts the streak over', () => {
  const p = createProfile('d', 'D')
  assert.equal(dailyStatus(p, T0).canClaim, true)
  const first = claimDaily(p, T0, { rand: () => 0.1 })
  assert.equal(first.ok, true)
  assert.equal(first.label, DAILY_REWARDS[0].label)
  assert.ok(p.wins > 0)
  assert.equal(claimDaily(p, T0 + 1000).ok, false, 'once a day')
  assert.equal(claimDaily(p, T0 + DAY).day, 1, 'next day: day 2')
  assert.equal(claimDaily(p, T0 + DAY * 2).day, 2)
  const boosted = p.boosts.power > T0 + DAY * 2
  assert.ok(boosted, 'day 3 gives a timed Power boost')
  assert.equal(dailyStatus(p, T0 + DAY * 5).day, 0, 'missing days resets the streak')
})

test('playtime gifts open with time played today, and reset the next day', () => {
  const p = createProfile('g', 'G')
  assert.equal(claimPlaytime(p, 0, T0).ok, false, 'not yet')
  const s = new PlayerSession(p, { now: T0, emit: () => {}, getPosition: () => ({ x: 0, z: 0 }) })
  for (let i = 0; i < 61; i += 1) s.tick(1, T0 + i * 1000)
  assert.equal(claimPlaytime(p, 0, T0 + 61000).ok, true)
  assert.equal(claimPlaytime(p, 0, T0 + 61000).ok, false, 'once')
  assert.equal(claimPlaytime(p, 1, T0 + 61000).ok, false, 'the 3-minute gift is not ready')
  assert.equal(PLAYTIME_GIFTS.length > 4, true)
  assert.equal(claimPlaytime(p, 1, T0 + DAY).ok, false, 'a new day starts the clock again')
})

test('Wins upgrades: priced per level, capped, and they do what they say', () => {
  const p = createProfile('u', 'U')
  p.power = 2000
  const before = throwReachFor(p)
  p.wins = 1e9
  assert.equal(buyUpgrade(p, 'arm').ok, true)
  assert.ok(throwReachFor(p) > before * 1.07)
  assert.ok(upgradeCost('arm', 1) > upgradeCost('arm', 0))
  const slots = maxEquippedPets(p)
  buyUpgrade(p, 'pets')
  assert.equal(maxEquippedPets(p), slots + 1)
  buyUpgrade(p, 'pets')
  assert.equal(buyUpgrade(p, 'pets').ok, false, 'maxed')
  p.wins = 0
  assert.equal(buyUpgrade(p, 'luck').ok, false, 'costs Wins')
})

test('rebirths earn tokens for perks; old saves get their tokens', () => {
  const p = createProfile('r', 'R')
  p.power = powerForLevelCap(p)
  p.level = 15
  const rebirth = applyRebirth(p, { rand: () => 0.5 })
  assert.equal(rebirth.tokens, 1)
  assert.equal(p.tokens, 1)
  const gain = gainMultiplier(p)
  assert.equal(buyPerk(p, 'surge').ok, true)
  assert.ok(gainMultiplier(p) > gain)
  assert.equal(buyPerk(p, 'surge').ok, false, 'level 2 costs 2 tokens')
  assert.equal(normalizeProfile({ rebirths: 5 }, 'o', 'O').tokens, 6, '1 per rebirth, 2 on the fifth')
})

test('World 2: needs Rebirths and Wins, only through the portal, then pays more', () => {
  const p = createProfile('w', 'W')
  p.power = 5000
  const events = []
  let at = { x: 0, z: 0 }
  const s = new PlayerSession(p, { now: T0, emit: (type, payload) => events.push([type, payload]), getPosition: () => at })
  s.handle('travel', { world: 2 }, T0)
  assert.equal(p.world, 1, 'not from across the lobby')
  at = { x: PORTAL.x, z: PORTAL.z + 0.8 }
  s.handle('travel', { world: 2 }, T0)
  assert.equal(p.world, 1, 'locked: needs rebirths')
  p.rebirths = WORLDS[2].unlock.rebirths
  p.wins = WORLDS[2].unlock.wins
  const wins1 = applyThrow(createProfileLike(p, 1), { rand: () => 0.5 }).wins
  s.handle('travel', { world: 2 }, T0)
  assert.equal(p.world, 2)
  assert.equal(p.wins, 0, 'the unlock costs Wins')
  assert.ok(events.some(([type, e]) => type === 'world' && e.unlocked))
  const wins2 = applyThrow(createProfileLike(p, 2), { rand: () => 0.5 }).wins
  assert.ok(wins2 > wins1 * 2.5, 'World 2 pays x3')
  s.handle('travel', { world: 1 }, T0)
  assert.equal(p.world, 1, 'back for free')
})

/** A copy of `p` in `world`, so throws can be compared without touching p. */
function createProfileLike(p, world) {
  const copy = normalizeProfile(JSON.parse(JSON.stringify(p)), p.id, p.name)
  copy.worlds = [1, 2]
  copy.world = world
  copy.stats.bestZone = 99
  return copy
}
