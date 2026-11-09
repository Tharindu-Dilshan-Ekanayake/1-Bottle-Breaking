import { BOTTLES, PADS, WORLD_EGGS } from './balance.js'

/**
 * Lobby layout: every gameplay-relevant position and trigger area.
 *
 * Shared by the client (which renders it and moves the player around it) and the
 * server (which validates positions against it), so the two can never disagree about
 * where a training pit or the throw platform is.
 *
 * The lobby is a flat plateau, top at y = 0, x in [-30, 30], z in [-24, 24]. -Z is
 * north: the staircase starts at the north edge. Rects are { minX, maxX, minZ, maxZ }.
 *
 * Seen from the spawn, looking north at the stage gate (the throw platform):
 *  - left (west): the training pits, and the portal to the other world in the corner
 *    beside the stage gate;
 *  - right (east): the bottle shop (north half) and the egg stands (south half), split
 *    by the main path;
 *  - behind (the south wall): the leaderboards.
 */

export const LOBBY = { minX: -30, maxX: 30, minZ: -24, maxZ: 24 }
export const SPAWN = { x: 0, z: 9 }

/** Fastest a player can legitimately move (sprint 10.5, up to +40% with Fast Feet), with slack. */
export const MAX_MOVE_SPEED = 18

// --- The staircase ------------------------------------------------------------------

/** One stair is `depth` long (-Z) and drops `rise`. The lobby edge is at startZ. */
export const STAIR = { depth: 2, rise: 1, laneHalf: 5, terraceHalf: 46, startZ: -24 }
export const stairTopY = (i) => -(i + 1) * STAIR.rise
export const stairCenterZ = (i) => STAIR.startZ - (i + 0.5) * STAIR.depth
export const stairIndexAtZ = (z) => Math.floor((STAIR.startZ - z) / STAIR.depth)

/** The platform the bottle is thrown from, at the top of the stairs: room for 8 players side by side. */
export const LAUNCH = { x: 0, z: -20.5, w: 16, d: 6, h: 0.35 }
/** The arch over the launch platform: its posts stand just outside the platform's sides. */
export const LAUNCH_ARCH = { x: LAUNCH.w / 2 + 1.4, z: LAUNCH.z - 1.5 }

// --- Training pits ------------------------------------------------------------------

/**
 * Each training pit is a little staircase sunk into the west side of the lobby: you
 * stand on its start plate (at lobby level, facing west) and toss your bottle down
 * STEP_COUNT steps to the pit floor.
 */
export const PIT = {
  halfWidth: 2.7,
  /** West edge of the start plate = where the first step begins. */
  topX: -18,
  plateDepth: 3.6,
  stepCount: 6,
  stepDepth: 1.6,
  stepDrop: 0.5,
  floorX: LOBBY.minX,
}
export const PAD_HEIGHT = 0.3
/** The arch over each pit's mouth: its x, and how far outside the pit edge its posts stand. */
export const PIT_ARCH = { x: PIT.topX + 0.35, out: 0.55 }
export const padCenterZ = (index) => -12 + index * 8

/** The start plate of pit `index`: stand here to train. */
export function padRect(index) {
  const z = padCenterZ(index)
  return { minX: PIT.topX, maxX: PIT.topX + PIT.plateDepth, minZ: z - PIT.halfWidth, maxZ: z + PIT.halfWidth }
}

/** The sunken part of pit `index`: not walkable. */
export function pitRect(index) {
  const z = padCenterZ(index)
  return { minX: PIT.floorX, maxX: PIT.topX, minZ: z - PIT.halfWidth, maxZ: z + PIT.halfWidth }
}

/** Top-centre of step `k` of a pit (k = stepCount is the floor). */
export function pitStep(index, k) {
  const z = padCenterZ(index)
  if (k >= PIT.stepCount) {
    const fromX = PIT.topX - PIT.stepCount * PIT.stepDepth
    return { x: (fromX + PIT.floorX) / 2, y: -(PIT.stepCount + 1) * PIT.stepDrop, z }
  }
  return { x: PIT.topX - (k + 0.5) * PIT.stepDepth, y: -(k + 1) * PIT.stepDrop, z }
}

// --- Bottle shop, eggs, scenery -------------------------------------------------------

/**
 * The bottle shop: two rows of eight pedestals along the north-east, both facing west
 * (their plaques face the way you walk up). The front row (x = SHOP_ROWS[0]) holds the
 * first eight bottles, north to south; the back row the rest, south to north.
 */
export const SHOP_ROWS = [18.5, 25]
const SHOP_PER_ROW = 8
const SHOP_Z0 = -20.4
const SHOP_DZ = 2.6
export function pedestalAt(i) {
  const row = Math.min(SHOP_ROWS.length - 1, Math.floor(i / SHOP_PER_ROW))
  const k = i % SHOP_PER_ROW
  return { x: SHOP_ROWS[row], z: SHOP_Z0 + (row % 2 ? SHOP_PER_ROW - 1 - k : k) * SHOP_DZ }
}
export const PEDESTALS = BOTTLES.map((b, i) => ({ bottle: b.id, ...pedestalAt(i) }))
export const SHOP_AREA = { minX: 14, maxX: 29.5, minZ: -23.5, maxZ: -0.5 }
/** Where you stand to use pedestal `i` (just west of it, facing its plaque). */
export const pedestalFront = (i) => ({ x: PEDESTALS[i].x - 1.7, z: PEDESTALS[i].z })

/**
 * The egg spots in the south-east: a back row of three along the east side and a front
 * row of two between them, cheapest nearest the main path.
 */
export const EGG_SPOTS = [
  { x: 25, z: 5.5 },
  { x: 18.5, z: 9 },
  { x: 25, z: 12.5 },
  { x: 18.5, z: 16 },
  { x: 25, z: 19.5 },
]
export const EGG_AREA = { minX: 14, maxX: 29.6, minZ: 2.6, maxZ: 23.3 }

/** A world's egg stands, spread over the egg spots (World 2's three take the back row). */
export function eggStandsFor(world = 1) {
  const eggs = WORLD_EGGS[world] || WORLD_EGGS[1]
  const last = EGG_SPOTS.length - 1
  return eggs.map((egg, i) => ({ egg, ...EGG_SPOTS[eggs.length > 1 ? Math.round((i * last) / (eggs.length - 1)) : 0] }))
}
/** World 1's stands (every other world's stands sit on a subset of these spots). */
export const EGG_STANDS = eggStandsFor(1)
export const EGG_TRIGGER_RADIUS = 3.2

/**
 * The portal between worlds: a grand gate in the north-west corner, beside the stage
 * gate on the training side. (nx, nz) is the way its doorway faces - south, towards the
 * spawn - and (ax, az) runs across the doorway.
 */
export const PORTAL = { x: -16, z: -20, halfWidth: 2.3, radius: 2.6, nx: 0, nz: 1, ax: 1, az: 0 }
/** World x of a point `across` the doorway and `out` in front of it. */
export const portalX = (across, out = 0) => PORTAL.x + across * PORTAL.ax + out * PORTAL.nx
/** World z of a point `across` the doorway and `out` in front of it. */
export const portalZ = (across, out = 0) => PORTAL.z + across * PORTAL.az + out * PORTAL.nz

/**
 * The leaderboards: three boards in a row along the back (south) wall, facing north.
 * Board centres along x; `face` is the way they face along z.
 */
export const LEADERBOARD_AREA = { z: 22.6, xs: [-6.2, 0, 6.2], width: 5.4, height: 5, y: 3.9, face: -1 }

/** Which world the portal in `world` leads to. */
export const portalTarget = (world) => (world === 1 ? 2 : 1)

/** Round obstacles the player cannot walk through: [x, z, radius]. */
export const OBSTACLES = [
  ...PEDESTALS.map((p) => [p.x, p.z, 1]),
  ...EGG_STANDS.map((e) => [e.x, e.z, 1.8]),
  // The arch posts over each training pit.
  ...PADS.flatMap((_, i) => [
    [PIT_ARCH.x, padCenterZ(i) - PIT.halfWidth - PIT_ARCH.out, 0.35],
    [PIT_ARCH.x, padCenterZ(i) + PIT.halfWidth + PIT_ARCH.out, 0.35],
  ]),
  // The leaderboard boards' posts.
  ...LEADERBOARD_AREA.xs.flatMap((x) => [
    [x - LEADERBOARD_AREA.width / 2 - 0.1, LEADERBOARD_AREA.z, 0.35],
    [x + LEADERBOARD_AREA.width / 2 + 0.1, LEADERBOARD_AREA.z, 0.35],
  ]),
  // Arch pillars over the launch platform.
  [-LAUNCH_ARCH.x, LAUNCH_ARCH.z, 0.7],
  [LAUNCH_ARCH.x, LAUNCH_ARCH.z, 0.7],
  // The portal's two posts.
  [portalX(-PORTAL.halfWidth - 0.4), portalZ(-PORTAL.halfWidth - 0.4), 0.75],
  [portalX(PORTAL.halfWidth + 0.4), portalZ(PORTAL.halfWidth + 0.4), 0.75],
]

/** Rectangles the player cannot walk into (the sunken pits). */
export const BLOCKED = PADS.map((_, i) => pitRect(i))

// --- Queries ----------------------------------------------------------------------------

export const inRect = (r, x, z, margin = 0) =>
  x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin

export const onPad = (index, x, z, margin = 0) => index >= 0 && index < PADS.length && inRect(padRect(index), x, z, margin)

export function padAt(x, z, margin = 0) {
  for (let i = 0; i < PADS.length; i += 1) if (onPad(i, x, z, margin)) return i
  return -1
}

export const inLaunch = (x, z, margin = 0) =>
  Math.abs(x - LAUNCH.x) <= LAUNCH.w / 2 + margin && Math.abs(z - LAUNCH.z) <= LAUNCH.d / 2 + margin

export const nearShop = (x, z, margin = 0) => inRect(SHOP_AREA, x, z, margin)

/** Index of the shop pedestal the player is standing at, or -1. */
export function pedestalNear(x, z) {
  if (!nearShop(x, z)) return -1
  let best = -1
  let bestD = 2.6
  for (let i = 0; i < PEDESTALS.length; i += 1) {
    const d = Math.hypot(x - PEDESTALS[i].x, z - PEDESTALS[i].z)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function eggStandNear(x, z, margin = 0, world = 1) {
  for (const stand of eggStandsFor(world)) {
    if (Math.hypot(x - stand.x, z - stand.z) < EGG_TRIGGER_RADIUS + margin) return stand
  }
  return null
}

/** Height of the walkable surface at (x, z). */
export function groundHeightAt(x, z) {
  if (padAt(x, z) >= 0) return PAD_HEIGHT
  if (inLaunch(x, z)) return LAUNCH.h
  return 0
}

/** In the portal's doorway (or just in front of it)? */
export const inPortal = (x, z, margin = 0) => Math.hypot(x - portalX(0, 0.6), z - portalZ(0, 0.6)) < PORTAL.radius + margin

/**
 * What the player is standing on / next to in `world`: 'pad:<index>', 'launch',
 * 'egg:<id>', 'portal', 'shop' or null.
 */
export function nearbyAt(x, z, world = 1) {
  const pad = padAt(x, z)
  if (pad >= 0) return `pad:${pad}`
  if (inLaunch(x, z, 0.3)) return 'launch'
  const egg = eggStandNear(x, z, 0, world)
  if (egg) return `egg:${egg.egg}`
  if (inPortal(x, z)) return 'portal'
  if (nearShop(x, z)) return 'shop'
  return null
}

/** Clamps a position into the lobby (the server's sanity check on reports). */
export function clampToWalkable(x, z) {
  return {
    x: Math.min(LOBBY.maxX - 0.5, Math.max(LOBBY.minX + 0.5, x)),
    z: Math.min(LOBBY.maxZ - 0.5, Math.max(LOBBY.minZ + 1, z)),
  }
}

/** Pushes a circle of `radius` at `p` ({x, z}, mutated) out of every BLOCKED rect. */
export function pushOutOfBlocked(p, radius) {
  for (const r of BLOCKED) {
    const cx = Math.min(r.maxX, Math.max(r.minX, p.x))
    const cz = Math.min(r.maxZ, Math.max(r.minZ, p.z))
    const dx = p.x - cx
    const dz = p.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= radius * radius) continue
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2)
      p.x = cx + (dx / d) * radius
      p.z = cz + (dz / d) * radius
    } else {
      // Centre inside the rect: out through the nearest side.
      const options = [
        [r.minX - radius - p.x, 0],
        [r.maxX + radius - p.x, 0],
        [0, r.minZ - radius - p.z],
        [0, r.maxZ + radius - p.z],
      ]
      options.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])))
      p.x += options[0][0]
      p.z += options[0][1]
    }
  }
}
