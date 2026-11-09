/**
 * Every tunable number in Bottle Tumble. Rules live in logic.js; this file is only data,
 * so balancing never means touching code.
 *
 * Shared by the client (display, offline play) and the server (authority): both read
 * the same table, so they always agree on costs and multipliers.
 *
 * The loop: train in a step pit for Power -> throw your bottle down the endless stairs
 * (more Power sends it further, and every stair pays Wins) -> better bottles and pet
 * eggs -> reach max level and rebirth for a bigger Power multiplier and a higher level
 * cap -> throw further still.
 *
 * The level / rebirth / Wins model follows the +1 Kick Field Goal game.
 */

// --- Power and levels ---------------------------------------------------------------

/** Seconds between Power gains while training in a pit. */
export const TRAIN_INTERVAL = 0.6

/**
 * Your level comes from your Power: reaching level L takes powerForLevel(L) Power.
 * Each level needs LEVEL_GROWTH_EARLY times the last at first, easing towards
 * LEVEL_GROWTH_LATE, so every rebirth takes a little longer than the one before.
 */
export const LEVEL_BASE = 20
export const LEVEL_GROWTH_EARLY = 1.3
export const LEVEL_GROWTH_LATE = 1.097
export const LEVEL_GROWTH_FADE = 100
export const MAX_LEVEL = 1200

const LEVEL_TABLE = (() => {
  const table = new Float64Array(MAX_LEVEL + 1)
  let need = LEVEL_BASE
  for (let level = 2; level <= MAX_LEVEL; level += 1) {
    table[level] = table[level - 1] + need
    const growth = LEVEL_GROWTH_LATE + (LEVEL_GROWTH_EARLY - LEVEL_GROWTH_LATE) * Math.exp(-level / LEVEL_GROWTH_FADE)
    need *= growth
  }
  return table
})()

/** Two significant figures, so thresholds read cleanly (2,300, not 2,317). */
const round2 = (n) => {
  if (n < 100) return Math.round(n)
  const step = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.round(n / step) * step
}

export const powerForLevel = (level) => (level <= 1 ? 0 : round2(LEVEL_TABLE[Math.min(MAX_LEVEL, level)]))

// --- Rebirth ------------------------------------------------------------------------

/** Max level by rebirth count: R0 = 15, R1 = 23, then +8 per rebirth. */
export const levelCap = (rebirths) => Math.min(MAX_LEVEL, 15 + 8 * Math.max(0, rebirths))

/** Power multiplier from rebirths: R0 = x1, R1 = x2, R2 = x3 ... */
export const rebirthMultiplier = (rebirths) => 1 + Math.max(0, rebirths)

/** Every 5th rebirth comes with a free egg hatch; the egg gets better over time. */
export const REBIRTH_GIFT_EVERY = 5
export function rebirthGift(rebirths) {
  if (rebirths <= 0 || rebirths % REBIRTH_GIFT_EVERY !== 0) return null
  const egg = rebirths >= 25 ? 'cosmic' : rebirths >= 15 ? 'unicorn' : rebirths >= 10 ? 'sunset' : 'frost'
  return { rebirths, egg, label: `a free ${EGGS[egg].name}` }
}
export function nextRebirthGift(rebirths) {
  const at = (Math.floor(rebirths / REBIRTH_GIFT_EVERY) + 1) * REBIRTH_GIFT_EVERY
  return rebirthGift(at)
}

/** Rebirthing before max level costs this many max-level throws' worth of Wins. */
export const REBIRTH_SKIP_THROWS = 10

/**
 * The three Power packs under the level bar (from +1 Kick Field Goal). They grow with
 * you: each gives `share` of the Power your next level needs, for `throws` throws' worth
 * of Wins at that Power. Packs aren't held back by the level cap.
 */
export const POWER_PACKS = [
  { share: 1, throws: 1 },
  { share: 5, throws: 4 },
  { share: 20, throws: 12 },
]

/**
 * Boxity Gems products, by sku. Boxity's catalog (per game slug) holds the prices; the
 * game only ever passes the sku, and the server grants on Boxity's webhook.
 *  - winsThrows: that many max-level throws' worth of Wins
 *  - pass: a permanent perk (see PASSES)
 */
export const GEM_PRODUCTS = {
  wins_small: { name: 'Pile of Wins', blurb: '10 max-level throws of Wins', icon: 'trophy', grant: { winsThrows: 10 } },
  wins_big: { name: 'Mountain of Wins', blurb: '60 max-level throws of Wins', icon: 'trophy', grant: { winsThrows: 60 } },
  power_x2: { name: 'x2 Power', blurb: 'Double every Power gain, forever', icon: 'muscle', grant: { pass: 'powerX2' } },
  wins_x2: { name: 'x2 Wins', blurb: 'Double every throw’s Wins, forever', icon: 'trophy', grant: { pass: 'winsX2' } },
  auto_throw: { name: 'Auto Throw', blurb: 'Throws for you on the platform', icon: 'bottle', grant: { pass: 'autoThrow' } },
}

/**
 * Boxity leaderboards. Declared by the client (Legion.SDK.leaderboard.define, which
 * also shows the trophy button) and by the server with every report. Ids are
 * permanent: Boxity keeps a board's first declaration.
 */
export const LEADERBOARDS = [
  { id: 'rebirths', label: 'Rebirths', order: 'desc', mode: 'best', format: 'number', reset: 'none' },
  { id: 'wins', label: 'Total Wins', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
  { id: 'stairs', label: 'Longest Throw (stairs)', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
  { id: 'playtime', label: 'Minutes Played', order: 'desc', mode: 'best', format: 'number', reset: 'none' },
]

/** Permanent perks a Gems product can unlock. */
export const PASSES = ['powerX2', 'winsX2', 'autoThrow']

/**
 * Rewarded ads (Boxity): watch one to the end to earn this. Placement names are
 * lowercase letters, digits and hyphens. `cooldownMs` keeps a player from chaining them.
 *  - pack: that Power pack (index into POWER_PACKS), free
 */
export const AD_REWARDS = {
  'free-power': { label: 'Free Power Pack', grant: { pack: 2 }, cooldownMs: 3 * 60 * 1000 },
}

/** Auto throw is unlocked by the first rebirth. */
export const AUTO_THROW_REBIRTHS = 1

// --- Training pits ------------------------------------------------------------------

/** Step pits along the west side of the lobby (positions in world.js). */
export const PADS = [
  { id: 'rookie', name: 'Rookie Steps', mult: 1, rebirths: 0, color: '#4ade80' },
  { id: 'bouncy', name: 'Bouncy Steps', mult: 2, rebirths: 1, color: '#38bdf8' },
  { id: 'turbo', name: 'Turbo Steps', mult: 4, rebirths: 2, color: '#c084fc' },
  { id: 'mega', name: 'Mega Steps', mult: 10, rebirths: 4, color: '#fb923c' },
  { id: 'ultra', name: 'Ultra Steps', mult: 20, rebirths: 6, color: '#f472b6' },
]

// --- Bottles ------------------------------------------------------------------------

/**
 * `power` is the Power every single gain is worth before multipliers; `cost` is in
 * Wins. Bought in order at the Bottle Shop. About x2.6 power for x3 the Wins each.
 * The rest of each entry is how it looks.
 */
export const BOTTLES = [
  { id: 'glass', name: 'Glass Bottle', power: 1, cost: 0, glass: '#cdeeff', fill: '#38bdf8', fillLevel: 0.55, cap: '#ef4444', glow: 0.1, shape: [1, 1] },
  { id: 'lemon', name: 'Lemon Fizz', power: 3, cost: 1, glass: '#fffbe0', fill: '#ffd23f', fillLevel: 0.7, cap: '#22c55e', glow: 0.05, shape: [1, 1] },
  { id: 'mint', name: 'Mint Soda', power: 5, cost: 15, glass: '#e0fff3', fill: '#2ee6a0', fillLevel: 0.75, cap: '#0ea5e9', glow: 0.1, shape: [0.95, 1.08] },
  { id: 'berry', name: 'Berry Juice', power: 12, cost: 75, glass: '#ffe8f2', fill: '#e11d74', fillLevel: 0.8, cap: '#fde047', glow: 0.1, shape: [1.05, 0.98] },
  { id: 'beads', name: 'Bubble Beads', power: 30, cost: 300, glass: '#fbf5ff', fill: '#ff6fb5', fillLevel: 0.85, cap: '#a855f7', glow: 0.15, shape: [1.3, 0.9] },
  { id: 'slime', name: 'Jelly Slime', power: 75, cost: 1200, glass: '#efffe0', fill: '#7cff3a', fillLevel: 0.8, cap: '#f97316', glow: 0.35, shape: [1.1, 1] },
  { id: 'honey', name: 'Honey Jar', power: 200, cost: 4500, glass: '#fff7e0', fill: '#f59e0b', fillLevel: 0.9, cap: '#78350f', glow: 0.2, shape: [1.35, 0.85] },
  { id: 'magma', name: 'Magma Jar', power: 500, cost: 16000, glass: '#fff0e6', fill: '#ff4d1a', fillLevel: 0.85, cap: '#3f3f46', glow: 0.6, shape: [1.3, 0.88] },
  { id: 'frost', name: 'Frost Flask', power: 1250, cost: 55000, glass: '#eefcff', fill: '#7dd3fc', fillLevel: 0.85, cap: '#e0f2fe', glow: 0.45, shape: [0.9, 1.15] },
  { id: 'aurora', name: 'Aurora Flask', power: 3500, cost: 180000, glass: '#e6fdff', fill: '#22d3ee', fillLevel: 0.9, cap: '#f0abfc', glow: 0.7, shape: [0.9, 1.15] },
  { id: 'gold', name: 'Golden Bottle', power: 9000, cost: 600000, glass: '#fff6d6', fill: '#facc15', fillLevel: 0.95, cap: '#b45309', glow: 0.8, shape: [1, 1.05] },
  { id: 'rainbow', name: 'Rainbow Bottle', power: 23000, cost: 2e6, glass: '#fdf2ff', fill: '#f472b6', fillLevel: 0.95, cap: '#22d3ee', glow: 0.8, shape: [1.05, 1.05] },
  { id: 'diamond', name: 'Diamond Bottle', power: 60000, cost: 6e6, glass: '#f0fdff', fill: '#a5f3fc', fillLevel: 0.95, cap: '#ffffff', glow: 0.9, shape: [1, 1.1] },
  { id: 'lava', name: 'Lava Lamp', power: 155000, cost: 17e6, glass: '#fff1f2', fill: '#fb7185', fillLevel: 0.95, cap: '#4c0519', glow: 1, shape: [1.15, 1.1] },
  { id: 'nebula', name: 'Nebula Bottle', power: 400000, cost: 48e6, glass: '#f1edff', fill: '#7c3aed', fillLevel: 0.95, cap: '#facc15', glow: 0.9, shape: [1.05, 1.1] },
  { id: 'infinity', name: 'Infinity Bottle', power: 1.05e6, cost: 135e6, glass: '#ffffff', fill: '#111827', fillLevel: 0.95, cap: '#f0abfc', glow: 1, shape: [1.1, 1.15] },
]

// --- Throwing -----------------------------------------------------------------------

/**
 * How far a throw goes, in stairs: 0 Power still sends it THROW_BASE stairs; each
 * stage's start is reached with the Power in its `wall`, less WALL_MARGIN; in between,
 * distance follows Power (in log terms). See logic.throwReach.
 */
export const THROW_BASE = 22
export const THROW_H0 = 50
export const WALL_MARGIN = 1.3
/** A throw goes a random 94-106% of its reach. */
export const THROW_SPREAD = 0.06

/** Seconds from pressing THROW to the bottle leaving your hand. */
export const THROW_WINDUP = 0.32
/** Seconds the bottle rests before it shatters. */
export const THROW_REST = 0.5
/** All the hops of one throw together never take longer than this. */
export const MAX_FLIGHT = 16
/** The result card after the shatter, before you can throw again. */
export const THROW_RECOVERY = 2.6

/** Visual themes for the stages (colours live in the client). */
export const THEMES = ['garden', 'shore', 'snow', 'crystal', 'neon', 'cloud', 'cosmos']

const STAGE_NAMES = {
  garden: ['Garden Steps', 'Flower Hill', 'Mossy Path', 'Clover Climb', 'Tulip Terrace', 'Bramble Bend', 'Sunny Meadow', 'Orchard Drop', 'Hedge Maze'],
  shore: ['Sunny Shore', 'Palm Steps', 'Coral Cove', 'Tide Terrace', 'Seashell Slope', 'Lagoon Ledge', 'Driftwood Drop', 'Pearl Bay', 'Surf Stairs'],
  snow: ['Snowcap Ridge', 'Frosty Falls', 'Icicle Ledge', 'Polar Pass', 'Glacier Steps', 'Blizzard Bluff', 'Yeti Peak', 'Aurora Ice', 'Frozen Spire'],
  crystal: ['Crystal Caverns', 'Gem Grotto', 'Amethyst Abyss', 'Prism Pit', 'Quartz Quarry', 'Opal Depths', 'Sapphire Shaft', 'Diamond Mine', 'Geode Gulch'],
  neon: ['Neon Heights', 'Arcade Alley', 'Pixel Plaza', 'Laser Lane', 'Synth City', 'Glow Tower', 'Cyber Steps', 'Disco Drop', 'Electric Avenue'],
  cloud: ['Cloud Kingdom', 'Sky Steps', 'Rainbow Bridge', 'Feather Falls', 'Sunbeam Spire', 'Breeze Bluff', 'Thunder Top', 'Halo Heights', 'Star Gate'],
  cosmos: ['The Cosmos', 'Moon Steps', 'Comet Trail', 'Nebula Drop', 'Saturn Rings', 'Meteor Mile', 'Galaxy Gate', 'Black Hole', 'The Beyond'],
}

// Sixty stages: [start stair, wall Power, Wins per stair, first-visit prize].
// The pacing is the Kick Field Goal field's, at four yards to a stair.
const STAGE_START = [0, 25, 50, 77, 105, 134, 165, 198, 232, 267, 304, 343, 383, 424, 467, 512, 558, 605, 654, 705, 757, 810, 865, 922, 980, 1039, 1100, 1163, 1227, 1292, 1359, 1428, 1498, 1569, 1642, 1717, 1793, 1870, 1949, 2030, 2112, 2195, 2280, 2367, 2455, 2544, 2635, 2728, 2822, 2917, 3014, 3113, 3213, 3314, 3417, 3522, 3628, 3735, 3844, 3955]
const STAGE_WALL = [0, 11, 21, 41, 79, 150, 300, 590, 1200, 2300, 4600, 9200, 18000, 37000, 75000, 150000, 310000, 640000, 1.3e6, 2.7e6, 5.7e6, 1.2e7, 2.5e7, 5.3e7, 1.1e8, 2.4e8, 5.1e8, 1.1e9, 2.3e9, 5e9, 1.1e10, 2.4e10, 5.2e10, 1.1e11, 2.5e11, 5.6e11, 1.2e12, 2.8e12, 6.2e12, 1.4e13, 3.2e13, 7.2e13, 1.6e14, 3.7e14, 8.6e14, 2e15, 4.6e15, 1.1e16, 2.5e16, 5.8e16, 1.4e17, 3.2e17, 7.6e17, 1.8e18, 4.3e18, 1e19, 2.5e19, 6e19, 1.5e20, 3.5e20]
const STAGE_WPM = [0.006, 0.0072, 0.00984, 0.0135, 0.0185, 0.0255, 0.0351, 0.0486, 0.0673, 0.0934, 0.13, 0.181, 0.253, 0.355, 0.498, 0.7, 0.987, 1.39, 1.97, 2.8, 3.98, 5.66, 8.08, 11.6, 16.6, 23.8, 34.2, 49.3, 71.3, 103, 150, 218, 317, 462, 676, 990, 1450, 2140, 3150, 4650, 6870, 10200, 15100, 22500, 33500, 50000, 74800, 112000, 168000, 253000, 382000, 576000, 872000, 1.3e6, 2e6, 3e6, 4.7e6, 7.1e6, 1.1e7, 1.7e7]
const STAGE_DISCOVER = [0, 5, 7, 9, 13, 18, 24, 34, 47, 65, 90, 130, 180, 250, 350, 490, 690, 970, 1400, 1900, 2800, 3900, 5600, 8000, 12000, 17000, 24000, 34000, 50000, 72000, 100000, 150000, 220000, 320000, 470000, 690000, 1e6, 1.5e6, 2.2e6, 3.2e6, 4.8e6, 7.1e6, 1e7, 1.6e7, 2.3e7, 3.5e7, 5.2e7, 7.8e7, 1.2e8, 1.8e8, 2.7e8, 4e8, 6.1e8, 9.2e8, 1.4e9, 2.1e9, 3.2e9, 4.9e9, 7.5e9, 1.2e10]

/**
 * The staircase's sixty stages. `mult` is shown on the gate; `winsPerStair` pays for
 * every stair the bottle covers inside the stage; `discover` is paid once, the first
 * time a throw ever reaches it.
 */
/**
 * Every stage is STAGE_LENGTH times longer than the original pacing: the same Power
 * reaches the same stage (throwReach interpolates between stage starts), over more
 * stairs - a longer flight and more Wins on the way. WINS_SCALE pays a little more
 * per stair on top.
 */
export const STAGE_LENGTH = 1.5
export const WINS_SCALE = 1.25

export const ZONES = STAGE_START.map((start, i) => {
  const theme = THEMES[i % THEMES.length]
  return {
    id: `stage-${i}`,
    name: STAGE_NAMES[theme][Math.floor(i / THEMES.length)],
    theme,
    start: Math.round(start * STAGE_LENGTH),
    wall: STAGE_WALL[i],
    winsPerStair: STAGE_WPM[i] * 4 * WINS_SCALE,
    discover: STAGE_DISCOVER[i],
  }
})

/** Win pickups down the stairs: the first at stair 10, then every 20 stairs. */
export const PICKUP_FIRST = 10
export const PICKUP_SPACING = 20
/** A pickup is worth this many stairs of its stage's Wins (at least 1). */
export const PICKUP_STAIRS = 20

// --- Pets & eggs ----------------------------------------------------------------------

export const RARITIES = {
  common: { name: 'Common', color: '#b9c3cf', order: 0 },
  uncommon: { name: 'Uncommon', color: '#4ade80', order: 1 },
  rare: { name: 'Rare', color: '#38bdf8', order: 2 },
  epic: { name: 'Epic', color: '#b15cff', order: 3 },
  legendary: { name: 'Legendary', color: '#ffc41f', order: 4 },
  mythic: { name: 'Mythic', color: '#ff3b6b', order: 5 },
}

/** `mult` multiplies Power gains; equipped pets stack additively (see logic.js). */
export const PETS = {
  pup: { name: 'Pebble Pup', rarity: 'common', mult: 1.1, body: '#d6a46b', ear: '#8b5a2b', ears: 'flop' },
  kitty: { name: 'Mochi Cat', rarity: 'common', mult: 1.15, body: '#f5f5f4', ear: '#f9a8d4', ears: 'point' },
  bunny: { name: 'Hop Bun', rarity: 'uncommon', mult: 1.25, body: '#fce7f3', ear: '#f472b6', ears: 'tall' },
  fox: { name: 'Ember Fox', rarity: 'rare', mult: 1.5, body: '#fb923c', ear: '#7c2d12', ears: 'point' },
  penguin: { name: 'Waddles', rarity: 'uncommon', mult: 1.4, body: '#334155', ear: '#f59e0b', ears: 'none' },
  seal: { name: 'Snowpup Seal', rarity: 'rare', mult: 1.7, body: '#cbd5e1', ear: '#94a3b8', ears: 'none' },
  owl: { name: 'Frost Owl', rarity: 'epic', mult: 2.2, body: '#e0f2fe', ear: '#0ea5e9', ears: 'point' },
  yeti: { name: 'Little Yeti', rarity: 'legendary', mult: 3, body: '#f8fafc', ear: '#7dd3fc', ears: 'flop' },
  flamingo: { name: 'Flamingo', rarity: 'uncommon', mult: 2.5, body: '#f9a8d4', ear: '#ec4899', ears: 'none' },
  turtle: { name: 'Shelly', rarity: 'rare', mult: 3.2, body: '#4ade80', ear: '#166534', ears: 'none' },
  parrot: { name: 'Polly', rarity: 'epic', mult: 4.5, body: '#ef4444', ear: '#3b82f6', ears: 'point' },
  phoenix: { name: 'Phoenix', rarity: 'legendary', mult: 7, body: '#f97316', ear: '#fde047', ears: 'point' },
  pony: { name: 'Pony', rarity: 'rare', mult: 5, body: '#d4a373', ear: '#7f5539', ears: 'point' },
  unicorn: { name: 'Unicorn', rarity: 'epic', mult: 8, body: '#fdf4ff', ear: '#f0abfc', ears: 'tall' },
  pegasus: { name: 'Pegasus', rarity: 'legendary', mult: 13, body: '#e0f2fe', ear: '#93c5fd', ears: 'flop' },
  alien: { name: 'Blip', rarity: 'rare', mult: 10, body: '#86efac', ear: '#16a34a', ears: 'tall' },
  comet: { name: 'Comet Cat', rarity: 'epic', mult: 16, body: '#fde047', ear: '#f97316', ears: 'point' },
  dragon: { name: 'Star Drake', rarity: 'legendary', mult: 26, body: '#8b5cf6', ear: '#facc15', ears: 'point' },
  whale: { name: 'Galaxy Whale', rarity: 'mythic', mult: 45, body: '#312e81', ear: '#f0abfc', ears: 'none' },
  // World 2 (Candy Peaks)
  gummy: { name: 'Gummy Bear', rarity: 'uncommon', mult: 60, body: '#fb7185', ear: '#be123c', ears: 'flop' },
  mallow: { name: 'Marshmallow', rarity: 'rare', mult: 85, body: '#fdf2f8', ear: '#f9a8d4', ears: 'tall' },
  sprinkle: { name: 'Sprinkle Pup', rarity: 'epic', mult: 120, body: '#fde68a', ear: '#a855f7', ears: 'point' },
  cupcake: { name: 'Cupcake King', rarity: 'legendary', mult: 200, body: '#f0abfc', ear: '#facc15', ears: 'none' },
  magma: { name: 'Magma Pup', rarity: 'rare', mult: 260, body: '#ef4444', ear: '#fdba74', ears: 'flop' },
  cinder: { name: 'Cinder Cat', rarity: 'epic', mult: 380, body: '#7c2d12', ear: '#f97316', ears: 'point' },
  inferno: { name: 'Inferno Drake', rarity: 'legendary', mult: 600, body: '#f97316', ear: '#fde047', ears: 'point' },
  volcano: { name: 'Volcano Golem', rarity: 'mythic', mult: 1000, body: '#292524', ear: '#ef4444', ears: 'none' },
  shade: { name: 'Shade Bun', rarity: 'epic', mult: 1400, body: '#1e1b4b', ear: '#a78bfa', ears: 'tall' },
  nova: { name: 'Nova Owl', rarity: 'legendary', mult: 2200, body: '#4c1d95', ear: '#f0abfc', ears: 'point' },
  singularity: { name: 'Singularity', rarity: 'mythic', mult: 4000, body: '#020617', ear: '#c084fc', ears: 'none' },
}

/** Eggs, bought with Wins. `pets` are [petId, weight]; weights sum to 100. */
export const EGGS = {
  sprout: { name: 'Sprout Egg', cost: 15, color: '#86efac', pets: [['pup', 45], ['kitty', 30], ['bunny', 20], ['fox', 5]] },
  frost: { name: 'Frost Egg', cost: 120, color: '#bae6fd', pets: [['penguin', 45], ['seal', 30], ['owl', 20], ['yeti', 5]] },
  sunset: { name: 'Sunset Egg', cost: 750, color: '#fdba74', pets: [['flamingo', 45], ['turtle', 30], ['parrot', 20], ['phoenix', 5]] },
  unicorn: { name: 'Unicorn Egg', cost: 6000, color: '#f5d0fe', pets: [['pony', 50], ['unicorn', 35], ['pegasus', 15]] },
  cosmic: { name: 'Cosmic Egg', cost: 35000, color: '#c4b5fd', pets: [['alien', 50], ['comet', 30], ['dragon', 15], ['whale', 5]] },
  // World 2 (Candy Peaks)
  candy: { name: 'Candy Egg', cost: 250000, color: '#f9a8d4', pets: [['gummy', 50], ['mallow', 30], ['sprinkle', 15], ['cupcake', 5]] },
  lava: { name: 'Lava Egg', cost: 2.5e6, color: '#fb923c', pets: [['magma', 50], ['cinder', 30], ['inferno', 15], ['volcano', 5]] },
  void: { name: 'Void Egg', cost: 2.5e7, color: '#7c3aed', pets: [['shade', 60], ['nova', 32], ['singularity', 8]] },
}
/** World 1's eggs, in stand order (kept as the long-standing default list). */
export const EGG_ORDER = ['sprout', 'frost', 'sunset', 'unicorn', 'cosmic']
/** Each world's eggs, in stand order. */
export const WORLD_EGGS = { 1: EGG_ORDER, 2: ['candy', 'lava', 'void'] }
/** Every egg, world by world (the order of the egg pattern texture's strips). */
export const ALL_EGGS = [...WORLD_EGGS[1], ...WORLD_EGGS[2]]

export const MAX_EQUIPPED_PETS = 3
export const MAX_PET_INVENTORY = 60

// --- Offline training -----------------------------------------------------------------

/** A quarter of your pit's rate, for up to 8 hours away. */
export const OFFLINE_RATE = 0.25
export const OFFLINE_MAX_MS = 8 * 60 * 60 * 1000
export const OFFLINE_MIN_MS = 60 * 1000

// --- Timed boosts ---------------------------------------------------------------------

/** Boosts from rewards: x2 for a while. */
export const BOOSTS = {
  power: { name: 'x2 Power', mult: 2, color: '#ffd23f' },
  wins: { name: 'x2 Wins', mult: 2, color: '#7dff4a' },
}

// --- Daily rewards and playtime gifts -------------------------------------------------

/**
 * Grants used by rewards:
 *  - winsThrows: that many max-level throws' worth of Wins
 *  - pack: a free Power pack (index into POWER_PACKS)
 *  - boost + minutes: a timed boost (BOOSTS)
 *  - egg: a free hatch of that egg
 */
export const DAILY_REWARDS = [
  { label: 'Pile of Wins', icon: 'trophy', grant: { winsThrows: 3 } },
  { label: 'Power Pack', icon: 'muscle', grant: { pack: 1 } },
  { label: 'x2 Power · 10 min', icon: 'muscle', grant: { boost: 'power', minutes: 10 } },
  { label: 'Bag of Wins', icon: 'trophy', grant: { winsThrows: 8 } },
  { label: 'Free Frost Egg', icon: 'egg:frost', grant: { egg: 'frost' } },
  { label: 'x2 Wins · 15 min', icon: 'trophy', grant: { boost: 'wins', minutes: 15 } },
  { label: 'Mega Chest', icon: 'egg:sunset', grant: { winsThrows: 20, egg: 'sunset' } },
]

/** Gifts for time played today; they open in order and reset each day. */
export const PLAYTIME_GIFTS = [
  { minutes: 1, label: 'Wins', icon: 'trophy', grant: { winsThrows: 1 } },
  { minutes: 3, label: 'Power Pack', icon: 'muscle', grant: { pack: 0 } },
  { minutes: 6, label: 'x2 Power · 5 min', icon: 'muscle', grant: { boost: 'power', minutes: 5 } },
  { minutes: 10, label: 'Bag of Wins', icon: 'trophy', grant: { winsThrows: 4 } },
  { minutes: 15, label: 'Free Sprout Egg', icon: 'egg:sprout', grant: { egg: 'sprout' } },
  { minutes: 25, label: 'x2 Wins · 10 min', icon: 'trophy', grant: { boost: 'wins', minutes: 10 } },
  { minutes: 40, label: 'Big Power Pack', icon: 'muscle', grant: { pack: 2 } },
  { minutes: 60, label: 'Mountain of Wins', icon: 'trophy', grant: { winsThrows: 12 } },
]

// --- Upgrades (bought with Wins) and rebirth perks (bought with tokens) ----------------

/** Permanent upgrades. Level n costs base * growth^n Wins. */
export const UPGRADES = {
  arm: { name: 'Strong Arm', desc: 'Throws go 8% further', per: 0.08, max: 10, base: 150, growth: 2.6, icon: 'muscle' },
  luck: { name: 'Lucky Bounces', desc: 'Throws pay 10% more Wins', per: 0.1, max: 10, base: 250, growth: 2.7, icon: 'trophy' },
  reps: { name: 'Quick Reps', desc: 'Train 6% faster', per: 0.06, max: 8, base: 120, growth: 2.5, icon: 'fastForward' },
  feet: { name: 'Fast Feet', desc: 'Walk 8% faster', per: 0.08, max: 5, base: 80, growth: 2.4, icon: 'star' },
  pets: { name: 'Pet Slot', desc: 'Equip one more pet', per: 1, max: 2, base: 5000, growth: 10, icon: 'pets' },
}
export const UPGRADE_ORDER = ['arm', 'luck', 'reps', 'feet', 'pets']

/** Rebirth tokens earned by a rebirth (to `rebirths` total): 1, and 2 every fifth. */
export const tokensForRebirth = (rebirths) => (rebirths % 5 === 0 ? 2 : 1)

/** Perks bought with rebirth tokens. Level n costs n + 1 tokens. */
export const PERKS = {
  surge: { name: 'Power Surge', desc: '+15% Power from everything', per: 0.15, max: 10, icon: 'muscle' },
  gold: { name: 'Golden Touch', desc: '+15% Wins from throws', per: 0.15, max: 10, icon: 'trophy' },
  packs: { name: 'Pack Master', desc: 'Power packs give 25% more', per: 0.25, max: 4, icon: 'store' },
}
export const PERK_ORDER = ['surge', 'gold', 'packs']

// --- Worlds ------------------------------------------------------------------------------

/**
 * Worlds: the same lobby and staircase, each with its own look, eggs and multipliers.
 * A world is unlocked once (it needs `rebirths` and costs `wins`), then you travel
 * freely through the portal.
 */
export const WORLDS = {
  1: { id: 1, name: 'Brick Meadows', gain: 1, wins: 1, unlock: null },
  2: { id: 2, name: 'Candy Peaks', gain: 3, wins: 3, unlock: { wins: 100000, rebirths: 6 } },
}
