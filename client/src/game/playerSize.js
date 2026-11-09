/**
 * How tall every character stands, in world units: the local player, other players'
 * avatars and the block figures all fit to this. One number so they always match.
 */
export const PLAYER_HEIGHT = 2.15

/** The size the character-relative offsets (hands, back, toss origin) were tuned at. */
export const BASE_PLAYER_HEIGHT = 1.8

/** Multiply a character-relative offset tuned at BASE_PLAYER_HEIGHT by this. */
export const PLAYER_SCALE = PLAYER_HEIGHT / BASE_PLAYER_HEIGHT
