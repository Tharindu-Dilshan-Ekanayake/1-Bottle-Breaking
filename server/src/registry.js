/**
 * Process-wide bookkeeping shared by every room. Progress is per player, not per room,
 * so a player may only be in one room at a time: this is what enforces that.
 */

/** playerId -> { room, client } */
export const activePlayers = new Map()

/** Every live GameRoom (the Gems poller looks for work only while there are some). */
export const liveRooms = new Set()
