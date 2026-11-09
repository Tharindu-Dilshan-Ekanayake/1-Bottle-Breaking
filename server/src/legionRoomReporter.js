import { matchMaker } from '@colyseus/core'

/**
 * Tells Boxity which rooms this pod is running, so they show under "Open Rooms" on the
 * game's page (each with a Join button that opens the game with ?roomId=).
 *
 * Every 2 s: POST {MATCHMAKER_REPORT_URL}/{BLOXITY_GAME_ID}/rooms with
 * { podName, players, rooms: [{ colyseusRoomId, name, clients, maxClients, locked,
 * private, started, metadata }] }. Boxity hosting injects the three variables; without
 * any of them (local dev) this does nothing. Failures are ignored: the next report
 * corrects the list.
 *
 * `query` lists the rooms (this pod's, from Colyseus' matchmaker by default).
 *
 * @returns {() => void} stops reporting
 */
export function installRoomReporter({ intervalMs = 2000, timeoutMs = 4000, query = () => matchMaker.query({}) } = {}) {
  const base = (process.env.MATCHMAKER_REPORT_URL || '').replace(/\/+$/, '')
  const token = process.env.BLOXITY_REPORT_TOKEN
  const gameId = process.env.BLOXITY_GAME_ID
  if (!base || !token || !gameId) return () => {}
  const url = `${base}/${encodeURIComponent(gameId)}/rooms`
  const podName = process.env.POD_NAME || process.env.HOSTNAME || ''

  const report = async () => {
    try {
      const listings = await query()
      const rooms = listings.map((room) => ({
        colyseusRoomId: room.roomId,
        name: room.name,
        clients: room.clients,
        maxClients: room.maxClients,
        locked: Boolean(room.locked),
        private: Boolean(room.private),
        // A lobby you can drop into at any time: there are no rounds to be "started".
        started: false,
        metadata: room.metadata ?? {},
      }))
      const players = rooms.reduce((sum, room) => sum + room.clients, 0)
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ podName, players, rooms }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      // Unreachable or slow: try again next time.
    }
  }

  report()
  const id = setInterval(report, intervalMs)
  return () => clearInterval(id)
}
