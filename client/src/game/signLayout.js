import { EGG_AREA, PORTAL, portalX, portalZ, SHOP_AREA } from '@shared/world'

/**
 * Where the lobby's signs hang: the same spots in every world. `face` is the way the
 * sign looks (its front): east = +x, west = -x, north = -z, south = +z. Signs are 8:1
 * (one 512x64 cell of the sign texture), so a sign `w` wide is w / 8 tall.
 *
 * Each sign sits 5 cm in front of its frame (a lobby block), so nothing z-fights.
 */
export const SIGN_ASPECT = 8

/** The face name of the portal's doorway direction. */
const PORTAL_FACE = PORTAL.nz > 0 ? 'south' : PORTAL.nz < 0 ? 'north' : PORTAL.nx > 0 ? 'east' : 'west'

export function signsFor(world) {
  return [
    // Over the training pits, on the west wall.
    { id: 'training', text: 'TRAINING', x: -29.65, y: 9.6, z: 4, w: 14, face: 'east', frame: { x: -29.85, d: 0.3 } },
    // Over the bottle shop, on the east wall.
    { id: 'bottles', text: 'BOTTLES', x: 29.65, y: 9.6, z: (SHOP_AREA.minZ + SHOP_AREA.maxZ) / 2, w: 13, face: 'west', frame: { x: 29.85, d: 0.3 } },
    // Over the egg stands, on the east wall.
    { id: 'pets', text: 'PETS & EGGS', x: 29.65, y: 9.6, z: (EGG_AREA.minZ + EGG_AREA.maxZ) / 2, w: 13, face: 'west', frame: { x: 29.85, d: 0.3 } },
    // Over the leaderboards, on the south (back) wall.
    { id: 'boards', text: 'LEADERBOARDS', x: 0, y: 9.4, z: 23.65, w: 14, face: 'north', frame: { z: 23.85, d: 0.3 } },
    // On the portal's crown: where it goes.
    { id: 'portal', text: world === 1 ? 'WORLD 2' : 'WORLD 1', x: portalX(0, 0.55), y: 7, z: portalZ(0, 0.55), w: 4.4, face: PORTAL_FACE, frame: null },
  ]
}

/** Every distinct sign text, in atlas order. */
export const SIGN_TEXTS = ['TRAINING', 'BOTTLES', 'PETS & EGGS', 'LEADERBOARDS', 'WORLD 2', 'WORLD 1']
