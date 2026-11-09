import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BOTTLES, levelCap, powerForLevel, rebirthMultiplier, THROW_BASE, ZONES } from '../../shared/balance.js'
import {
  applyRebirth,
  applyThrow,
  applyTrain,
  baseThrowWins,
  buyBottle,
  createProfile,
  hatchEgg,
  isMaxLevel,
  buyPowerPack,
  migrateLegacySave,
  powerPacks,
  normalizeProfile,
  padGain,
  rebirthSkipPrice,
  skipRebirth,
  throwPlan,
  throwReach,
} from '../../shared/logic.js'
import { PlayerSession } from '../../shared/session.js'
import { LAUNCH, padRect, pushOutOfBlocked, pitRect, SPAWN } from '../../shared/world.js'

const fixedRand = () => 0.5

test('levels follow Power and stop at the cap for the rebirth count', () => {
  const p = createProfile('t', 'T')
  assert.equal(levelCap(0), 15)
  assert.equal(levelCap(1), 23)
  p.power = powerForLevel(levelCap(0)) - 1
  applyTrain(p, 0)
  assert.equal(p.level, levelCap(0))
  assert.ok(isMaxLevel(p))
  const before = p.power
  const again = applyTrain(p, 0)
  assert.equal(again.gain, 0, 'gains stop at max level')
  assert.equal(p.power, before)
})

test('rebirth needs max level, resets Power and level, keeps Wins and bottles', () => {
  const p = createProfile('t', 'T')
  p.wins = 500
  p.ownedBottles.push('lemon')
  assert.equal(applyRebirth(p).ok, false)
  p.power = powerForLevel(levelCap(0))
  p.level = levelCap(0)
  const result = applyRebirth(p, { rand: fixedRand })
  assert.equal(result.ok, true)
  assert.equal(p.rebirths, 1)
  assert.equal(p.power, 0)
  assert.equal(p.level, 1)
  assert.equal(p.wins, 500)
  assert.deepEqual(p.ownedBottles, ['glass', 'lemon'])
  assert.equal(rebirthMultiplier(1), 2)
  assert.equal(padGain(p, 0), 2, 'x2 Power after the first rebirth')
})

test('skipping a rebirth costs Wins', () => {
  const p = createProfile('t', 'T')
  const price = rebirthSkipPrice(p)
  assert.ok(price > 0)
  assert.equal(skipRebirth(p).ok, false)
  p.wins = price
  assert.equal(skipRebirth(p, { rand: fixedRand }).ok, true)
  assert.equal(p.rebirths, 1)
  assert.equal(p.wins, 0)
})

test('every 5th rebirth hatches a free egg', () => {
  const p = createProfile('t', 'T')
  p.rebirths = 4
  p.level = levelCap(4)
  const result = applyRebirth(p, { rand: fixedRand })
  assert.equal(result.gift?.egg, 'frost')
  assert.equal(p.pets.length, 1)
})

test('throws reach further with more Power and pay Wins for every stair', () => {
  assert.equal(Math.round(throwReach(0)), THROW_BASE)
  assert.ok(throwReach(1000) > throwReach(100))
  assert.ok(baseThrowWins(300) > baseThrowWins(100))
  const p = createProfile('t', 'T')
  p.power = 1000
  const result = applyThrow(p, { rand: fixedRand })
  assert.equal(result.stairs, Math.round(throwReach(1000)))
  assert.equal(result.hops.reduce((s, h) => s + h, 0), result.stairs, 'hops cover every stair')
  assert.equal(p.wins, result.wins + result.prize)
  assert.ok(result.discovered.length > 0, 'first visits pay a prize')
  assert.equal(p.stats.bestZone, result.zone)
  // A second throw to the same stage pays no discovery prize.
  assert.equal(applyThrow(p, { rand: fixedRand }).prize, 0)
})

test('flight plans stay short even for huge throws', () => {
  for (const stairs of [3, 15, 120, 1000, 5000]) {
    const plan = throwPlan(stairs)
    assert.equal(plan.hops.reduce((s, h) => s + h, 0), stairs)
    assert.ok(plan.duration < 18, `${stairs} stairs take ${plan.duration}s`)
    assert.equal(plan.bounceAt.length, plan.hops.length)
  }
})

test('bottles are bought in order with Wins', () => {
  const p = createProfile('t', 'T')
  p.wins = 100
  assert.equal(buyBottle(p, 'mint').ok, false, 'lemon first')
  assert.equal(buyBottle(p, 'lemon').ok, true)
  assert.equal(p.wins, 100 - BOTTLES[1].cost)
  assert.equal(p.equippedBottle, 'lemon')
})

test('eggs cost Wins and auto-equip the first pets', () => {
  const p = createProfile('t', 'T')
  assert.equal(hatchEgg(p, 'sprout').ok, false)
  p.wins = 15
  const result = hatchEgg(p, 'sprout', { rand: fixedRand })
  assert.equal(result.ok, true)
  assert.equal(p.equippedPets.length, 1)
})

test('stage table is ordered', () => {
  for (let i = 1; i < ZONES.length; i += 1) {
    assert.ok(ZONES[i].start > ZONES[i - 1].start)
    assert.ok(ZONES[i].wall > ZONES[i - 1].wall)
  }
})

test('old client-only saves migrate: trophies become Wins', () => {
  const raw = migrateLegacySave({ trophies: 42, rebirths: 2, ownedBottles: ['glass', 'lemon'], pets: [{ uid: 1, type: 'pup' }], equippedPets: [1] })
  const p = normalizeProfile(raw, 'id', 'Name')
  assert.equal(p.wins, 42)
  assert.equal(p.rebirths, 2)
  assert.deepEqual(p.pets, [{ uid: 1, id: 'pup' }])
  assert.deepEqual(p.equippedPets, [1])
})

test('the session validates where intents come from', () => {
  const events = []
  const position = { x: SPAWN.x, y: 0, z: SPAWN.z }
  const session = new PlayerSession(createProfile('t', 'T'), {
    now: 0,
    emit: (type, payload) => events.push([type, payload]),
    getPosition: () => position,
    rand: fixedRand,
  })

  // Throwing from the spawn is refused; from the platform it's a throw.
  session.handle('throw', {}, 1000)
  assert.equal(events.at(-1)[0], 'denied')
  Object.assign(position, { x: LAUNCH.x, z: LAUNCH.z })
  session.handle('throw', {}, 2000)
  const thrown = events.find(([type]) => type === 'throw')
  assert.ok(thrown)
  // Bounces pay Power as they land.
  session.tick(0.1, 2000 + thrown[1].bounceAt[0] * 1000 + 1)
  assert.ok(events.some(([type, e]) => type === 'train' && e.source === 'bounce'))
  // No second throw while the bottle is out.
  const throws = events.filter(([type]) => type === 'throw').length
  session.handle('throw', {}, 2500)
  assert.equal(events.filter(([type]) => type === 'throw').length, throws)

  // Training only counts standing on the pit's start plate.
  const r = padRect(0)
  Object.assign(position, { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 })
  session.handle('enterPad', { pad: 0 }, 1e6)
  // The first tick drains the throw's remaining bounces; training starts on the next.
  session.tick(0.1, 1e6)
  session.tick(1, 1e6 + 1000)
  assert.ok(events.some(([type, e]) => type === 'train' && e.source === 'pad'))
  session.handle('enterPad', { pad: 3 }, 1e6)
  assert.equal(session.pad, 0, 'a locked pit is refused')
})

test('players are pushed out of the sunken pits', () => {
  const pit = pitRect(2)
  const p = { x: (pit.minX + pit.maxX) / 2, z: (pit.minZ + pit.maxZ) / 2 }
  pushOutOfBlocked(p, 0.45)
  assert.ok(p.x > pit.maxX || p.x < pit.minX || p.z > pit.maxZ || p.z < pit.minZ)
})

test('Power packs cost Wins, grow with your level and ignore the cap', () => {
  const p = createProfile('t', 'T')
  const packs = powerPacks(p)
  assert.equal(packs.length, 3)
  assert.ok(packs[2].amount > packs[0].amount && packs[2].price > packs[0].price)
  assert.equal(buyPowerPack(p, 0).ok, false)
  p.wins = packs[0].price
  assert.equal(buyPowerPack(p, 0).ok, true)
  assert.equal(p.power, packs[0].amount)
  assert.equal(p.wins, 0)
})

// --- Boxity: Gems perks and rewarded ads ------------------------------------------

test('Gems products grant Wins or a permanent perk, once', async () => {
  const { canAutoThrow, createProfile, gainMultiplier, grantGemProduct, normalizeProfile } = await import('../../shared/logic.js')
  const p = createProfile('g', 'G')
  const before = gainMultiplier(p)
  assert.equal(grantGemProduct(p, 'power_x2').pass, 'powerX2')
  assert.equal(gainMultiplier(p), before * 2)
  grantGemProduct(p, 'power_x2')
  assert.deepEqual(p.passes, ['powerX2'], 'a perk is owned once')
  assert.equal(canAutoThrow(p), false)
  grantGemProduct(p, 'auto_throw')
  assert.equal(canAutoThrow(p), true)
  assert.equal(p.settings.autoThrow, true)
  const wins = grantGemProduct(p, 'wins_small').wins
  assert.ok(wins >= 100 && p.wins === wins)
  assert.equal(grantGemProduct(p, 'nope').ok, false)
  // Saves keep only known perks.
  assert.deepEqual(normalizeProfile({ passes: ['powerX2', 'hack'] }, 'g', 'G').passes, ['powerX2'])
})

test('x2 Wins doubles a throw’s Wins (not the stage prize)', async () => {
  const { applyThrow, createProfile } = await import('../../shared/logic.js')
  const a = createProfile('a', 'A')
  const b = createProfile('b', 'B')
  a.power = b.power = 500
  b.passes = ['winsX2']
  const ra = applyThrow(a, { rand: () => 0.5 })
  const rb = applyThrow(b, { rand: () => 0.5 })
  assert.equal(rb.stairs, ra.stairs)
  assert.ok(Math.abs(rb.wins - ra.wins * 2) <= 1, 'x2 (give or take rounding)')
  assert.equal(rb.prize, ra.prize)
})

test('a rewarded ad pays a free Power pack, then cools down', async () => {
  const { createProfile, grantAdReward, powerPacks } = await import('../../shared/logic.js')
  const p = createProfile('r', 'R')
  const expected = powerPacks(p)[2].amount
  const first = grantAdReward(p, 'free-power', 1000)
  assert.equal(first.ok, true)
  assert.equal(first.power, expected)
  assert.equal(p.power, expected)
  assert.equal(grantAdReward(p, 'free-power', 2000).ok, false, 'cooling down')
  assert.equal(grantAdReward(p, 'free-power', 1000 + 3 * 60 * 1000).ok, true)
  assert.equal(grantAdReward(p, 'nope', 0).ok, false)
})

test('clients cannot grant themselves Gems or ad rewards through messages', async () => {
  const { createProfile } = await import('../../shared/logic.js')
  const { PlayerSession } = await import('../../shared/session.js')
  const p = createProfile('c', 'C')
  const session = new PlayerSession(p, { now: 0, emit: () => {}, getPosition: () => ({ x: 0, z: 0 }) })
  for (const type of ['grantGemProduct', 'grantAdReward', 'gems', 'reward', 'adReward', 'gemsLocal']) {
    session.handle(type, { sku: 'wins_big', placement: 'free-power' }, 0)
  }
  assert.equal(p.wins, 0)
  assert.equal(p.power, 0)
  assert.deepEqual(p.passes, [])
})
