import cors from 'cors'
import express from 'express'
import { defineRoom, defineServer } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'

import { resolveIdentity } from './bloxityApi.js'
import { bloxity } from './bloxityEnv.js'
import { startBloxityLeaderboards } from './bloxityLeaderboards.js'
import { closeStorage, openStorage, topPlayers } from './db.js'
import { gemsWebhook, startGemsPoller } from './gems.js'
import { installRoomReporter } from './legionRoomReporter.js'
import { activePlayers } from './registry.js'
import { GameRoom } from './rooms/GameRoom.js'

// Bloxity Legion injects PORT (HTTP and WebSocket share it); 2567 is Colyseus's usual.
const PORT = Number(process.env.PORT || 2567)

/** Identifies this server to development clients scanning local ports. */
export const GAME_ID = 'bottle-tumble'

/**
 * Browser origins allowed to call /api: Legion's CLIENT_ORIGIN, the Bloxity-hosted
 * frontends, extra ones from CLIENT_ORIGINS, and Vite dev/preview servers.
 */
const ALLOWED_ORIGINS = [
  process.env.CLIENT_ORIGIN,
  bloxity.playHost && `https://${bloxity.gameId}.${bloxity.playHost}`,
  bloxity.playHost && `https://${bloxity.gameId}.dev.${bloxity.playHost}`,
  ...(process.env.CLIENT_ORIGINS || '').split(',').map((s) => s.trim()),
  ...(process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173']),
].filter(Boolean)

function routes(app) {
  // Legion's readiness and liveness probes.
  app.get('/health', (_req, res) => res.json({ ok: true }))

  app.use('/api', cors({ origin: ALLOWED_ORIGINS, credentials: true }))
  app.use('/api', express.json())

  app.get('/api/health', (_req, res) => {
    // `game` lets a development client tell this server from another project's.
    res.json({ ok: true, game: GAME_ID, players: activePlayers.size })
  })

  /**
   * Boxity's Gems purchase webhook (server to server, so no CORS): recorded in the
   * database by transactionId and answered 2xx at once; the pod the buyer plays on
   * applies it. A non-2xx answer makes Boxity refund the player. See gems.js.
   */
  app.post('/api/gems/webhook', gemsWebhook)

  app.get('/api/leaderboards', async (_req, res) => {
    try {
      res.json(await topPlayers(10))
    } catch {
      res.status(503).json({ error: 'Leaderboards unavailable' })
    }
  })

  /**
   * Auth passthrough for the Bloxity SDK's `authenticateWithServer('/api/legion-auth')`.
   * The token is checked with Boxity; the user comes from Boxity's answer, never the body.
   */
  app.post('/api/legion-auth', async (req, res) => {
    const token = req.body?.token
    if (typeof token !== 'string' || !token) return res.status(401).json({ error: 'Missing token' })
    try {
      const identity = await resolveIdentity({ token, playerId: 'unverified' })
      if (!identity.verified) return res.status(503).json({ error: 'Boxity unavailable' })
      res.json({ accessToken: token, user: { legionId: identity.playerId } })
    } catch {
      res.status(401).json({ error: 'Invalid token' })
    }
  })
}

await openStorage()

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: {
    game: defineRoom(GameRoom).enableRealtimeListing(),
  },
  express: routes,
  greet: false,
})

// SIGTERM (a deploy or scale-in) runs Colyseus' graceful shutdown: every room saves
// (GameRoom.onBeforeShutdown), then the database closes.
const stopTimers = []
server.onShutdown(() => {
  stopTimers.forEach((stop) => stop())
  return closeStorage()
})

await server.listen(PORT)
// After listen: Boxity's "Open Rooms" list (legionRoomReporter.js), server-side
// leaderboard reports and the Gems grant poller. Each does nothing without its tokens.
stopTimers.push(installRoomReporter(), startBloxityLeaderboards(), startGemsPoller())
console.log(`[server] Bottle Tumble listening on port ${PORT} (Boxity ${bloxity.env}, ${bloxity.apiUrl})`)
