import {
  AD_REWARDS,
  AUTO_THROW_REBIRTHS,
  BOOSTS,
  BOTTLES,
  DAILY_REWARDS,
  EGGS,
  GEM_PRODUCTS,
  levelCap,
  MAX_EQUIPPED_PETS,
  MAX_FLIGHT,
  MAX_PET_INVENTORY,
  OFFLINE_MAX_MS,
  OFFLINE_MIN_MS,
  OFFLINE_RATE,
  PADS,
  PASSES,
  PERKS,
  PETS,
  PICKUP_FIRST,
  PLAYTIME_GIFTS,
  PICKUP_SPACING,
  PICKUP_STAIRS,
  POWER_PACKS,
  powerForLevel,
  RARITIES,
  REBIRTH_SKIP_THROWS,
  rebirthGift,
  rebirthMultiplier,
  THROW_BASE,
  THROW_H0,
  THROW_RECOVERY,
  THROW_REST,
  THROW_SPREAD,
  THROW_WINDUP,
  tokensForRebirth,
  TRAIN_INTERVAL,
  UPGRADES,
  WALL_MARGIN,
  WORLDS,
  ZONES,
} from './balance.js'

/**
 * Game rules as pure functions over a plain profile object.
 *
 * The server runs these authoritatively; the client runs the very same functions for
 * offline play and for display (costs, multipliers, what a button would do). Mutating
 * functions change the profile in place and return a small result describing what
 * happened, which is what gets sent to the client as an event.
 */

export const PROFILE_VERSION = 2

export function createProfile(id, name) {
  return {
    v: PROFILE_VERSION,
    id,
    name,
    power: 0,
    wins: 0,
    rebirths: 0,
    level: 1,
    equippedBottle: 'glass',
    ownedBottles: ['glass'],
    /** [{ uid, id }] */
    pets: [],
    /** uids, at most MAX_EQUIPPED_PETS */
    equippedPets: [],
    nextPetUid: 1,
    stats: {
      throws: 0,
      trains: 0,
      bestStairs: 0,
      bestPower: 0,
      totalWins: 0,
      playtime: 0,
      /** Furthest stage ever reached: its `discover` prize is paid once. */
      bestZone: 0,
    },
    lastPad: -1,
    lastSeen: 0,
    settings: { autoRebirth: false, autoThrow: false },
    /** Permanent perks bought with Gems (PASSES). */
    passes: [],
    /** Rewarded-ad placement -> time it can be watched again. */
    adCooldowns: {},
    /** Wins upgrades: id -> level (UPGRADES). */
    upgrades: {},
    /** Rebirth perks: id -> level (PERKS), and tokens left to spend on them. */
    perks: {},
    tokens: 0,
    /** Timed boosts: id -> when it ends (ms). */
    boosts: {},
    /** Daily rewards: the next day to claim (0-6) and when the last was claimed (ms). */
    daily: { next: 0, last: 0 },
    /** Today's playtime gifts: the UTC day, seconds played, gifts opened. */
    playday: { key: 0, seconds: 0, claimed: [] },
    /** The world you're in, and the worlds unlocked. */
    world: 1,
    worlds: [1],
  }
}

const finite = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback)

/** `{ id: level }` from a save, keeping only known ids and levels within their max. */
function cleanLevels(raw, defs) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, level] of Object.entries(raw)) {
    if (defs[id] && Number.isFinite(level)) out[id] = Math.min(defs[id].max, Math.max(0, Math.floor(level)))
  }
  return out
}

/** Fills in anything missing from an older or partial save. Never throws. */
export function normalizeProfile(raw, id, name) {
  const base = createProfile(id, name)
  if (!raw || typeof raw !== 'object') return base
  const p = { ...base, ...raw, id, name: name || raw.name || base.name }
  p.stats = { ...base.stats, ...(raw.stats || {}) }
  p.settings = { ...base.settings, ...(raw.settings || {}) }
  p.power = Math.max(0, finite(raw.power))
  p.wins = Math.max(0, finite(raw.wins))
  p.rebirths = Math.max(0, Math.floor(finite(raw.rebirths)))
  p.pets = Array.isArray(raw.pets) ? raw.pets.filter((pet) => PETS[pet?.id] && Number.isFinite(pet.uid)) : []
  p.nextPetUid = Math.max(finite(raw.nextPetUid, 1), ...p.pets.map((pet) => pet.uid + 1), 1)
  p.equippedPets = Array.isArray(raw.equippedPets) ? raw.equippedPets.filter((uid) => p.pets.some((pet) => pet.uid === uid)) : []
  const owned = Array.isArray(raw.ownedBottles) ? raw.ownedBottles.filter((b) => bottleIndex(b) >= 0) : []
  p.ownedBottles = owned.length ? [...new Set(owned)] : ['glass']
  if (!p.ownedBottles.includes(p.equippedBottle)) p.equippedBottle = p.ownedBottles[0]
  p.stats.bestZone = Math.min(ZONES.length - 1, Math.max(0, Math.floor(finite(p.stats.bestZone))))
  p.lastPad = Number.isInteger(raw.lastPad) && PADS[raw.lastPad] ? raw.lastPad : -1
  p.passes = Array.isArray(raw.passes) ? [...new Set(raw.passes.filter((x) => PASSES.includes(x)))] : []
  p.adCooldowns = {}
  for (const [key, at] of Object.entries(raw.adCooldowns && typeof raw.adCooldowns === 'object' ? raw.adCooldowns : {})) {
    if (AD_REWARDS[key] && Number.isFinite(at)) p.adCooldowns[key] = at
  }
  p.upgrades = cleanLevels(raw.upgrades, UPGRADES)
  p.perks = cleanLevels(raw.perks, PERKS)
  // Saves from before tokens existed get the tokens their rebirths would have earned.
  p.tokens = Number.isFinite(raw.tokens)
    ? Math.max(0, Math.floor(raw.tokens))
    : Array.from({ length: p.rebirths }, (_, i) => tokensForRebirth(i + 1)).reduce((a, b) => a + b, 0)
  p.boosts = {}
  for (const id of Object.keys(BOOSTS)) if (Number.isFinite(raw.boosts?.[id])) p.boosts[id] = raw.boosts[id]
  p.daily = {
    next: Math.min(DAILY_REWARDS.length - 1, Math.max(0, Math.floor(finite(raw.daily?.next)))),
    last: Math.max(0, finite(raw.daily?.last)),
  }
  p.playday = {
    key: Math.floor(finite(raw.playday?.key)),
    seconds: Math.max(0, finite(raw.playday?.seconds)),
    claimed: Array.isArray(raw.playday?.claimed)
      ? [...new Set(raw.playday.claimed.filter((i) => Number.isInteger(i) && PLAYTIME_GIFTS[i]))]
      : [],
  }
  p.worlds = [...new Set([1, ...(Array.isArray(raw.worlds) ? raw.worlds.filter((w) => WORLDS[w]) : [])])]
  p.world = WORLDS[raw.world] && p.worlds.includes(raw.world) ? raw.world : 1
  p.equippedPets = p.equippedPets.slice(0, maxEquippedPets(p))
  // Levels follow from Power; recompute rather than trust a stored one.
  p.level = levelFor(p.power, p.rebirths)
  p.v = PROFILE_VERSION
  return p
}

/**
 * Converts a save from the first, client-only version of the game (localStorage key
 * 'bottle-tumble-save-v1': power / trophies / rebirths / pets with a `type`) into a
 * raw profile. Trophies become Wins; Power starts again (it now drives levels).
 */
export function migrateLegacySave(state) {
  if (!state || typeof state !== 'object') return null
  return {
    wins: finite(state.trophies),
    rebirths: finite(state.rebirths),
    ownedBottles: state.ownedBottles,
    equippedBottle: state.equippedBottle,
    pets: Array.isArray(state.pets) ? state.pets.map((pet) => ({ uid: pet.uid, id: pet.type })) : [],
    equippedPets: state.equippedPets,
    nextPetUid: state.nextPetUid,
    stats: { bestStairs: finite(state.bestStairs), throws: finite(state.totalThrows) },
  }
}

export function createSession(now) {
  return { start: now }
}

// --- Lookups ------------------------------------------------------------------------

export const bottleIndex = (id) => BOTTLES.findIndex((b) => b.id === id)
export const bottleById = (id) => BOTTLES.find((b) => b.id === id) || BOTTLES[0]
/** The next bottle in the shop you don't own yet, or null. */
export const nextBottle = (profile) => BOTTLES.find((b) => !profile.ownedBottles.includes(b.id)) || null

export function isPadUnlocked(profile, index) {
  const pad = PADS[index]
  return Boolean(pad) && profile.rebirths >= pad.rebirths
}

/** Kept to a tenth below a million and whole above, so small gains don't pile up float dust. */
export const tidy = (value) => (value < 1e6 ? Math.round(value * 10) / 10 : Math.round(value))

/** Two significant figures: 692 -> 690, 1934 -> 1900. */
export function niceRound(n) {
  if (n < 100) return Math.max(1, Math.round(n))
  const step = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.round(n / step) * step
}

// --- Levels -------------------------------------------------------------------------

/** The level `power` reaches, never above the cap for `rebirths`. */
export function levelFor(power, rebirths) {
  const cap = levelCap(rebirths)
  let level = 1
  while (level < cap && power >= powerForLevel(level + 1)) level += 1
  return level
}

export const isMaxLevel = (profile) => profile.level >= levelCap(profile.rebirths)

/** 0..1 through the current level: what the level bar fills to. */
export function levelProgress(profile) {
  if (isMaxLevel(profile)) return 1
  const from = powerForLevel(profile.level)
  const to = powerForLevel(profile.level + 1)
  return Math.max(0, Math.min(1, (profile.power - from) / Math.max(1e-9, to - from)))
}

/** 0..1 progress towards being able to rebirth, by levels. */
export function rebirthProgress(profile) {
  const cap = levelCap(profile.rebirths)
  if (profile.level >= cap) return 1
  return Math.max(0, Math.min(1, (profile.level - 1 + levelProgress(profile)) / Math.max(1, cap - 1)))
}

// --- Multipliers --------------------------------------------------------------------

/** Equipped pets stack additively: x3 and x2 together make x4, not x6. */
export function petMultiplier(profile) {
  let total = 1
  for (const uid of profile.equippedPets) {
    const pet = profile.pets.find((p) => p.uid === uid)
    if (pet && PETS[pet.id]) total += PETS[pet.id].mult - 1
  }
  return total
}

/** Does the profile own Gems perk `pass`? */
export const hasPass = (profile, pass) => Array.isArray(profile.passes) && profile.passes.includes(pass)

/** Everything that multiplies a Power gain except the bottle and where you earn it. */
export const gainMultiplier = (profile, now = Date.now()) =>
  rebirthMultiplier(profile.rebirths) *
  petMultiplier(profile) *
  (hasPass(profile, 'powerX2') ? 2 : 1) *
  (1 + PERKS.surge.per * perkLevel(profile, 'surge')) *
  worldOf(profile).gain *
  (boostActive(profile, 'power', now) ? BOOSTS.power.mult : 1)

/** May this profile switch Auto Throw on? (the first rebirth, or the Gems perk) */
export const canAutoThrow = (profile) => profile.rebirths >= AUTO_THROW_REBIRTHS || hasPass(profile, 'autoThrow')

/** Power from one bounce down the big staircase. */
export const baseGain = (profile) => tidy(bottleById(profile.equippedBottle).power * gainMultiplier(profile))

/** Power from one training rep in pit `index`. */
export function padGain(profile, index) {
  const pad = PADS[index]
  if (!pad) return 0
  return tidy(bottleById(profile.equippedBottle).power * pad.mult * gainMultiplier(profile))
}

/** What a gain would really add right now (0 at max level). */
export function gainRoom(profile, gain) {
  const cap = levelCap(profile.rebirths)
  if (profile.level >= cap) return 0
  return tidy(Math.min(gain, Math.max(0, powerForLevel(cap) - profile.power)))
}

// --- Power, training, rebirth -------------------------------------------------------

/**
 * Banks a gain and the levels it reaches. At max level gains stop: rebirth to keep
 * going. Returns what was really added.
 */
function addPower(profile, gain) {
  const cap = levelCap(profile.rebirths)
  if (profile.level >= cap) return { gain: 0, leveledUp: false, levels: 0, maxed: true }
  const added = gainRoom(profile, gain)
  profile.power = tidy(profile.power + added)
  profile.stats.trains += 1
  profile.stats.bestPower = Math.max(profile.stats.bestPower, profile.power)
  const before = profile.level
  profile.level = levelFor(profile.power, profile.rebirths)
  return { gain: added, leveledUp: profile.level > before, levels: profile.level - before, maxed: profile.level >= cap }
}

export function applyTrain(profile, index) {
  if (!isPadUnlocked(profile, index)) return { ok: false, error: 'Pit locked' }
  profile.lastPad = index
  return { ok: true, ...addPower(profile, padGain(profile, index)) }
}

/** One bounce of your bottle down the big staircase. */
export const applyBounce = (profile) => ({ ok: true, ...addPower(profile, baseGain(profile)) })

/** Rebirth: +1 rebirth; Power and level reset (Wins, bottles and pets stay). */
export function applyRebirth(profile, { rand = Math.random } = {}) {
  if (!isMaxLevel(profile)) return { ok: false, error: `Reach level ${levelCap(profile.rebirths)} first!` }
  profile.rebirths += 1
  profile.power = 0
  profile.level = 1
  const tokens = tokensForRebirth(profile.rebirths)
  profile.tokens = (profile.tokens || 0) + tokens
  const gift = rebirthGift(profile.rebirths)
  let pets = []
  if (gift) {
    const hatched = hatchEgg(profile, gift.egg, { paid: 'free', rand })
    if (hatched.ok) pets = hatched.pets
  }
  return { ok: true, rebirths: profile.rebirths, gift, pets, eggId: gift?.egg ?? null, tokens }
}

/** Wins to rebirth now without reaching max level first. */
export const rebirthSkipPrice = (profile) => niceRound(Math.max(20, maxThrowWins(profile) * REBIRTH_SKIP_THROWS))

export function skipRebirth(profile, opts) {
  if (isMaxLevel(profile)) return applyRebirth(profile, opts)
  const price = rebirthSkipPrice(profile)
  if (profile.wins < price) return { ok: false, error: 'Not enough Wins!' }
  profile.wins -= price
  profile.level = levelCap(profile.rebirths)
  return applyRebirth(profile, opts)
}

// --- Throwing -----------------------------------------------------------------------

const GATE_REACH = ZONES.map((z) => z.wall / WALL_MARGIN)

/**
 * How many stairs `power` throws the bottle: from THROW_BASE up to the second stage
 * along a gentle curve, then from each stage's start to the next as Power climbs from
 * one stage's wall to the next (in log terms), past the last at the last stage's pace.
 */
export function throwReach(power) {
  const h = Math.max(0, power)
  const first = GATE_REACH[1]
  if (h <= first) return THROW_BASE + ((ZONES[1].start - THROW_BASE) * Math.log1p(h / THROW_H0)) / Math.log1p(first / THROW_H0)
  let i = 1
  while (i + 1 < ZONES.length && h >= GATE_REACH[i + 1]) i += 1
  const a = i + 1 < ZONES.length ? i : i - 1
  const span = ZONES[a + 1].start - ZONES[a].start
  return ZONES[i].start + (span * Math.log(h / GATE_REACH[i])) / Math.log(GATE_REACH[a + 1] / GATE_REACH[a])
}

/** The stage stair index `stair` is in. */
export function zoneIndexAt(stair) {
  for (let i = ZONES.length - 1; i >= 0; i -= 1) if (stair >= ZONES[i].start) return i
  return 0
}

/** A throw of `stairs` lands on stair index stairs - 1. */
export const zoneForThrow = (stairs) => zoneIndexAt(Math.max(0, stairs - 1))

/** Stair indices of the Win pickups a throw of `stairs` collects. */
export function pickupsWithin(stairs) {
  const out = []
  for (let s = PICKUP_FIRST; s < stairs; s += PICKUP_SPACING) out.push(s)
  return out
}

export const isPickupStair = (stair) => stair >= PICKUP_FIRST && (stair - PICKUP_FIRST) % PICKUP_SPACING === 0

/** Wins the pickup on stair `stair` is worth. */
export const pickupValue = (stair) => Math.max(1, Math.round(ZONES[zoneIndexAt(stair)].winsPerStair * PICKUP_STAIRS))

/** Wins for a throw of `stairs`: every stair covered at its stage's rate, plus the pickups. */
export function baseThrowWins(stairs) {
  let wins = 0
  for (let i = 0; i < ZONES.length; i += 1) {
    const start = ZONES[i].start
    const end = i + 1 < ZONES.length ? ZONES[i + 1].start : Infinity
    wins += Math.max(0, Math.min(stairs, end) - start) * ZONES[i].winsPerStair
  }
  for (let s = PICKUP_FIRST; s < stairs; s += PICKUP_SPACING) wins += pickupValue(s)
  return wins
}

/** Bounces in a throw: more stairs, more (and longer) bounces, capped for pacing. */
export const throwBounces = (stairs) => Math.min(stairs, Math.max(5, Math.min(26, Math.round(5 + 3 * Math.log1p(stairs / 8)))))

/**
 * The flight of a throw of `stairs`: how many stairs each hop covers (long hops
 * first, shorter as the bottle slows), how long each takes, and when each bounce lands
 * (seconds from the throw). Deterministic, so server and client agree.
 */
export function throwPlan(stairs) {
  const bounces = throwBounces(stairs)
  const hops = []
  let sumW = 0
  for (let k = 0; k < bounces; k += 1) sumW += Math.pow(bounces - k + 1, 1.5)
  let used = 0
  for (let k = 0; k < bounces; k += 1) {
    const len = Math.max(1, Math.round((stairs * Math.pow(bounces - k + 1, 1.5)) / sumW))
    hops.push(len)
    used += len
  }
  let diff = stairs - used
  for (let k = 0, guard = 0; diff !== 0 && guard < 100000; k = (k + 1) % bounces, guard += 1) {
    if (diff > 0) {
      hops[k] += 1
      diff -= 1
    } else if (hops[k] > 1) {
      hops[k] -= 1
      diff += 1
    }
  }
  const raw = hops.map((len) => 0.2 + 0.065 * Math.sqrt(len))
  const total = raw.reduce((s, d) => s + d, 0)
  const squeeze = Math.max(1, total / MAX_FLIGHT)
  const durations = raw.map((d) => Math.round((d / squeeze) * 1000) / 1000)
  const bounceAt = []
  let t = THROW_WINDUP
  for (const d of durations) {
    t += d
    bounceAt.push(Math.round(t * 1000) / 1000)
  }
  const duration = t + THROW_REST
  return { stairs, hops, durations, bounceAt, duration }
}

/**
 * A throw down the stairs. Power is not consumed. Returns everything the client needs
 * to replay it: the flight plan, the Wins (paid now; the HUD holds them back until the
 * bottle shatters) and any stage reached for the first time.
 */
export function applyThrow(profile, { rand = Math.random } = {}) {
  const reach = throwReachFor(profile)
  const stairs = Math.max(3, Math.round(reach * (1 + (rand() * 2 - 1) * THROW_SPREAD)))
  const plan = throwPlan(stairs)
  const wins = Math.max(1, Math.round(baseThrowWins(stairs) * winsMultiplier(profile)))
  const zone = zoneForThrow(stairs)
  const discovered = []
  let prize = 0
  for (let i = profile.stats.bestZone + 1; i <= zone; i += 1) {
    discovered.push(i)
    prize += ZONES[i].discover
  }
  const best = stairs > profile.stats.bestStairs
  profile.wins += wins + prize
  profile.stats.totalWins += wins + prize
  profile.stats.throws += 1
  profile.stats.bestStairs = Math.max(profile.stats.bestStairs, stairs)
  profile.stats.bestZone = Math.max(profile.stats.bestZone, zone)
  return {
    ok: true,
    ...plan,
    zone,
    wins,
    prize,
    discovered,
    best,
    cooldown: plan.duration + THROW_RECOVERY,
  }
}

/** The Power packs as they stand for you now: `[{ amount, price }]`. */
export function powerPacks(profile) {
  const next = powerForLevel(profile.level + 1)
  const wins = baseThrowWins(Math.round(throwReach(next)))
  const boost = 1 + PERKS.packs.per * perkLevel(profile, 'packs')
  return POWER_PACKS.map((pack) => ({
    amount: niceRound(Math.max(10, next * pack.share * boost)),
    price: niceRound(Math.max(3, wins * pack.throws)),
  }))
}

/** Buys Power pack `index` with Wins. Packs ignore the level cap. */
export function buyPowerPack(profile, index) {
  const pack = powerPacks(profile)[index]
  if (!pack) return { ok: false, error: 'Unknown pack' }
  if (profile.wins < pack.price) return { ok: false, error: 'Not enough Wins!' }
  profile.wins -= pack.price
  profile.power = tidy(profile.power + pack.amount)
  profile.stats.bestPower = Math.max(profile.stats.bestPower, profile.power)
  profile.level = levelFor(profile.power, profile.rebirths)
  return { ok: true, amount: pack.amount }
}

/** Wins of a throw at your max level (no spread): what a rebirth skip costs in. */
export const maxThrowWins = (profile) => baseThrowWins(Math.round(throwReach(powerForLevel(levelCap(profile.rebirths)))))

/** Adds a Power pack's Power for free (a reward). Like bought packs, ignores the cap. */
function givePowerPack(profile, index) {
  const pack = powerPacks(profile)[index]
  if (!pack) return 0
  profile.power = tidy(profile.power + pack.amount)
  profile.stats.bestPower = Math.max(profile.stats.bestPower, profile.power)
  profile.level = levelFor(profile.power, profile.rebirths)
  return pack.amount
}

// --- Boxity: leaderboards, Gems and rewarded ads ------------------------------------

/** A profile's score on each LEADERBOARDS board, as whole numbers. */
export function leaderboardScores(profile) {
  const stats = profile?.stats || {}
  const whole = (n) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0)
  return {
    rebirths: whole(profile?.rebirths),
    wins: whole(stats.totalWins),
    stairs: whole(stats.bestStairs),
    playtime: whole((stats.playtime || 0) / 60),
  }
}

/**
 * Applies Gems product `sku` (after Boxity confirmed the purchase). Returns
 * `{ ok, sku, wins?, pass? }` or `{ ok: false, error }`.
 */
export function grantGemProduct(profile, sku) {
  const product = GEM_PRODUCTS[sku]
  if (!product) return { ok: false, error: `Unknown sku ${sku}` }
  const { grant } = product
  const out = { ok: true, sku, name: product.name }
  if (grant.winsThrows) {
    const wins = niceRound(Math.max(100, maxThrowWins(profile) * grant.winsThrows))
    profile.wins += wins
    profile.stats.totalWins += wins
    out.wins = wins
  }
  if (grant.pass && PASSES.includes(grant.pass)) {
    if (!profile.passes.includes(grant.pass)) profile.passes.push(grant.pass)
    if (grant.pass === 'autoThrow') profile.settings.autoThrow = true
    out.pass = grant.pass
  }
  return out
}

/** When rewarded ad `placement` can next be watched (0 = now). */
export const adReadyAt = (profile, placement) => profile.adCooldowns?.[placement] || 0

/**
 * Grants rewarded ad `placement` (after the ad was verified as watched), unless it is
 * still cooling down. Returns `{ ok, placement, label, power? }` or `{ ok: false, error }`.
 */
export function grantAdReward(profile, placement, now) {
  const reward = AD_REWARDS[placement]
  if (!reward) return { ok: false, error: 'Unknown reward' }
  if (adReadyAt(profile, placement) > now) return { ok: false, error: 'Not ready yet - try again later' }
  profile.adCooldowns[placement] = now + reward.cooldownMs
  const out = { ok: true, placement, label: reward.label }
  if (Number.isInteger(reward.grant.pack)) out.power = givePowerPack(profile, reward.grant.pack)
  return out
}

// --- Bottles ------------------------------------------------------------------------

export function buyBottle(profile, id) {
  const bottle = BOTTLES.find((b) => b.id === id)
  if (!bottle) return { ok: false, error: 'Unknown bottle' }
  if (profile.ownedBottles.includes(id)) return equipBottle(profile, id)
  const previous = BOTTLES[bottleIndex(id) - 1]
  if (previous && !profile.ownedBottles.includes(previous.id)) return { ok: false, error: `Buy the ${previous.name} first!` }
  if (profile.wins < bottle.cost) return { ok: false, error: 'Not enough Wins!' }
  profile.wins -= bottle.cost
  profile.ownedBottles.push(id)
  profile.equippedBottle = id
  return { ok: true, bought: true, id }
}

export function equipBottle(profile, id) {
  if (!profile.ownedBottles.includes(id)) return { ok: false, error: 'You don’t own that bottle' }
  profile.equippedBottle = id
  return { ok: true, equipped: true, id }
}

// --- Pets ---------------------------------------------------------------------------

function rollPet(eggId, rand) {
  const egg = EGGS[eggId]
  const total = egg.pets.reduce((sum, [, w]) => sum + w, 0)
  let r = rand() * total
  for (const [petId, weight] of egg.pets) {
    r -= weight
    if (r < 0) return petId
  }
  return egg.pets[egg.pets.length - 1][0]
}

export function eggOdds(eggId) {
  const egg = EGGS[eggId]
  const total = egg.pets.reduce((sum, [, w]) => sum + w, 0)
  return egg.pets.map(([id, w]) => ({ id, pct: (w / total) * 100 }))
}

export function addPet(profile, petId) {
  const pet = { uid: profile.nextPetUid++, id: petId }
  profile.pets.push(pet)
  // Auto-equip into a free slot, so a first pet does something straight away.
  if (profile.equippedPets.length < maxEquippedPets(profile)) profile.equippedPets.push(pet.uid)
  return pet
}

/** Hatches one egg. `paid`: 'wins' charges its price; 'free' is for gifts. */
export function hatchEgg(profile, eggId, { paid = 'wins', rand = Math.random } = {}) {
  const egg = EGGS[eggId]
  if (!egg) return { ok: false, error: 'Unknown egg' }
  if (profile.pets.length >= MAX_PET_INVENTORY) return { ok: false, error: 'Pet inventory full!' }
  if (paid === 'wins') {
    if (profile.wins < egg.cost) return { ok: false, error: 'Not enough Wins!' }
    profile.wins -= egg.cost
  }
  return { ok: true, eggId, pets: [addPet(profile, rollPet(eggId, rand))] }
}

export function equipPet(profile, uid) {
  if (!profile.pets.some((p) => p.uid === uid)) return { ok: false, error: 'Unknown pet' }
  if (profile.equippedPets.includes(uid)) return { ok: true }
  if (profile.equippedPets.length >= maxEquippedPets(profile)) return { ok: false, error: `Max ${maxEquippedPets(profile)} pets equipped` }
  profile.equippedPets.push(uid)
  return { ok: true }
}

export function unequipPet(profile, uid) {
  profile.equippedPets = profile.equippedPets.filter((u) => u !== uid)
  return { ok: true }
}

const petScore = (pet) => PETS[pet.id]?.mult ?? 0

export function equipBestPets(profile) {
  profile.equippedPets = [...profile.pets]
    .sort((a, b) => petScore(b) - petScore(a))
    .slice(0, maxEquippedPets(profile))
    .map((p) => p.uid)
  return { ok: true }
}

export function deletePet(profile, uid) {
  const before = profile.pets.length
  profile.pets = profile.pets.filter((p) => p.uid !== uid)
  profile.equippedPets = profile.equippedPets.filter((u) => u !== uid)
  return { ok: profile.pets.length < before }
}

/** Sort key for inventory display: equipped first, then rarity, then multiplier. */
export function petSortKey(profile, pet) {
  const info = PETS[pet.id]
  const equipped = profile.equippedPets.includes(pet.uid) ? 1 : 0
  return equipped * 1e6 + (RARITIES[info.rarity]?.order ?? 0) * 1e4 + info.mult
}

// --- Offline progress ---------------------------------------------------------------

/** Power earned while away, if the player logged off training in a pit. */
export function applyOfflineProgress(profile, now) {
  const away = Math.min(OFFLINE_MAX_MS, now - (profile.lastSeen || now))
  if (profile.lastPad < 0 || away < OFFLINE_MIN_MS) return null
  if (!isPadUnlocked(profile, profile.lastPad) || isMaxLevel(profile)) return null
  const steps = Math.floor(away / 1000 / trainInterval(profile))
  const result = addPower(profile, Math.floor(steps * padGain(profile, profile.lastPad) * OFFLINE_RATE))
  if (result.gain <= 0) return null
  return { power: result.gain, ms: away }
}

// --- Upgrades, perks, boosts, worlds -------------------------------------------------

export const upgradeLevel = (profile, id) => profile.upgrades?.[id] || 0
export const perkLevel = (profile, id) => profile.perks?.[id] || 0

/** Is timed boost `id` running at `now`? */
export const boostActive = (profile, id, now = Date.now()) => (profile.boosts?.[id] || 0) > now

/** The world the profile is in. */
export const worldOf = (profile) => WORLDS[profile.world] || WORLDS[1]

/** How many pets can be equipped at once. */
export const maxEquippedPets = (profile) => MAX_EQUIPPED_PETS + upgradeLevel(profile, 'pets')

/** Seconds per training rep. */
export const trainInterval = (profile) => TRAIN_INTERVAL * (1 - UPGRADES.reps.per * upgradeLevel(profile, 'reps'))

/** Walking speed multiplier (Fast Feet). */
export const walkSpeedMult = (profile) => 1 + UPGRADES.feet.per * upgradeLevel(profile, 'feet')

/** How many stairs a throw goes right now (Power, Strong Arm). */
export const throwReachFor = (profile) => throwReach(profile.power) * (1 + UPGRADES.arm.per * upgradeLevel(profile, 'arm'))

/** Everything that multiplies a throw's Wins. */
export function winsMultiplier(profile, now = Date.now()) {
  return (
    (hasPass(profile, 'winsX2') ? 2 : 1) *
    (1 + UPGRADES.luck.per * upgradeLevel(profile, 'luck')) *
    (1 + PERKS.gold.per * perkLevel(profile, 'gold')) *
    worldOf(profile).wins *
    (boostActive(profile, 'wins', now) ? BOOSTS.wins.mult : 1)
  )
}

/** Wins upgrade `id`'s price at `level` (the price of the next level). */
export const upgradeCost = (id, level) => niceRound(UPGRADES[id].base * UPGRADES[id].growth ** level)

export function buyUpgrade(profile, id) {
  const def = UPGRADES[id]
  if (!def) return { ok: false, error: 'Unknown upgrade' }
  const level = upgradeLevel(profile, id)
  if (level >= def.max) return { ok: false, error: 'Already maxed!' }
  const cost = upgradeCost(id, level)
  if (profile.wins < cost) return { ok: false, error: 'Not enough Wins!' }
  profile.wins -= cost
  profile.upgrades = { ...profile.upgrades, [id]: level + 1 }
  return { ok: true, id, level: level + 1, name: def.name }
}

/** Tokens a perk's next level costs. */
export const perkCost = (level) => level + 1

export function buyPerk(profile, id) {
  const def = PERKS[id]
  if (!def) return { ok: false, error: 'Unknown perk' }
  const level = perkLevel(profile, id)
  if (level >= def.max) return { ok: false, error: 'Already maxed!' }
  const cost = perkCost(level)
  if (profile.tokens < cost) return { ok: false, error: 'Rebirth to earn tokens!' }
  profile.tokens -= cost
  profile.perks = { ...profile.perks, [id]: level + 1 }
  return { ok: true, id, level: level + 1, name: def.name }
}

/** Can world `id` be unlocked now? `{ ok, error?, cost, rebirths }`. */
export function worldUnlockState(profile, id) {
  const world = WORLDS[id]
  if (!world) return { ok: false, error: 'Unknown world' }
  if (profile.worlds.includes(id)) return { ok: true, unlocked: true, cost: 0, rebirths: 0 }
  const { wins = 0, rebirths = 0 } = world.unlock || {}
  if (profile.rebirths < rebirths) return { ok: false, error: `Needs ${rebirths} Rebirths`, cost: wins, rebirths }
  if (profile.wins < wins) return { ok: false, error: 'Not enough Wins!', cost: wins, rebirths }
  return { ok: true, cost: wins, rebirths }
}

export function unlockWorld(profile, id) {
  const state = worldUnlockState(profile, id)
  if (!state.ok) return state
  if (state.unlocked) return { ok: true, world: id, already: true }
  profile.wins -= state.cost
  profile.worlds = [...profile.worlds, id]
  return { ok: true, world: id, name: WORLDS[id].name }
}

export function travelTo(profile, id) {
  if (!WORLDS[id]) return { ok: false, error: 'Unknown world' }
  if (!profile.worlds.includes(id)) return { ok: false, error: 'Unlock it first!' }
  profile.world = id
  return { ok: true, world: id, name: WORLDS[id].name }
}

// --- Rewards: daily, playtime --------------------------------------------------------

const DAY_MS = 86400000
/** A UTC day number. */
export const dayKey = (now) => Math.floor(now / DAY_MS)

/**
 * Applies a reward grant (see DAILY_REWARDS): `{ wins, power, boost, minutes, pets,
 * eggId }` of what it gave.
 */
export function applyGrant(profile, grant, { now = Date.now(), rand = Math.random } = {}) {
  const out = {}
  if (grant.winsThrows) {
    const wins = niceRound(Math.max(50, maxThrowWins(profile) * grant.winsThrows))
    profile.wins += wins
    profile.stats.totalWins += wins
    out.wins = wins
  }
  if (Number.isInteger(grant.pack)) out.power = givePowerPack(profile, grant.pack)
  if (grant.boost && BOOSTS[grant.boost]) {
    const from = Math.max(now, profile.boosts[grant.boost] || 0)
    profile.boosts = { ...profile.boosts, [grant.boost]: from + grant.minutes * 60000 }
    out.boost = grant.boost
    out.minutes = grant.minutes
  }
  if (grant.egg && EGGS[grant.egg]) {
    const hatched = hatchEgg(profile, grant.egg, { paid: 'free', rand })
    if (hatched.ok) {
      out.pets = hatched.pets
      out.eggId = grant.egg
    }
  }
  return out
}

/** Today's daily reward: `{ canClaim, day, broken, nextAt }`. */
export function dailyStatus(profile, now = Date.now()) {
  const today = dayKey(now)
  const last = profile.daily.last ? dayKey(profile.daily.last) : -1e9
  const broken = Boolean(profile.daily.last) && today - last > 1
  return {
    canClaim: today > last,
    day: broken ? 0 : profile.daily.next,
    broken,
    nextAt: (last + 1) * DAY_MS,
  }
}

export function claimDaily(profile, now = Date.now(), opts = {}) {
  const status = dailyStatus(profile, now)
  if (!status.canClaim) return { ok: false, error: 'Come back tomorrow!' }
  const reward = DAILY_REWARDS[status.day]
  const result = applyGrant(profile, reward.grant, { now, ...opts })
  profile.daily = { next: (status.day + 1) % DAILY_REWARDS.length, last: now }
  return { ok: true, source: 'daily', day: status.day, label: reward.label, ...result }
}

/** Today's playtime record (a new day starts it over). */
export function playdayOf(profile, now = Date.now()) {
  const key = dayKey(now)
  if (profile.playday.key !== key) profile.playday = { key, seconds: 0, claimed: [] }
  return profile.playday
}

export function addPlaytime(profile, seconds, now = Date.now()) {
  playdayOf(profile, now).seconds += seconds
}

/** The playtime gifts: `[{ ...gift, ready, claimed, at }]`, `at` = seconds needed. */
export function playtimeStatus(profile, now = Date.now()) {
  const day = playdayOf(profile, now)
  return PLAYTIME_GIFTS.map((gift, i) => ({
    ...gift,
    index: i,
    at: gift.minutes * 60,
    ready: day.seconds >= gift.minutes * 60,
    claimed: day.claimed.includes(i),
  }))
}

export function claimPlaytime(profile, index, now = Date.now(), opts = {}) {
  const gift = PLAYTIME_GIFTS[index]
  if (!gift) return { ok: false, error: 'Unknown gift' }
  const day = playdayOf(profile, now)
  if (day.claimed.includes(index)) return { ok: false, error: 'Already opened' }
  if (day.seconds < gift.minutes * 60) return { ok: false, error: 'Not ready yet' }
  day.claimed = [...day.claimed, index]
  const result = applyGrant(profile, gift.grant, { now, ...opts })
  return { ok: true, source: 'playtime', index, label: gift.label, ...result }
}
