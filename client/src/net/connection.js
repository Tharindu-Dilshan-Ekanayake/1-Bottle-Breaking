import { environment } from '../bloxity/env'
import { GAME_SLUG, joinToken } from '../bloxity/identity'
import { getSDK, safeCall, whenInitialized } from '../bloxity/sdk'
import { runtime } from '../game/runtime'
import { getGame } from '../store/game'
import { setTransport } from './actions'
import { handleServerEvent } from './events'
import { createLocalServer } from './localServer'
import { clearRemotePlayers, markRemoteThrow, removeRemotePlayer, upsertRemotePlayer } from './remotePlayers'

/** Position reports per second (the server validates each against the last). */
const POSITION_HZ = 10
const JOIN_RETRIES = 4
const RETRY_DELAY_MS = 4000
/** Server code for "you joined from another window". */
const DUPLICATE_LOGIN = 4100
/** Matchmaker: give up and play offline after this long (a cold start takes ~45 s). */
const MATCHMAKER_GIVE_UP_MS = 60_000
const MATCHMAKER_BACKOFF_MS = [1000, 2000, 4000, 8000, 10000]
/** What /api/health says on this game's own server. */
const SERVER_GAME_ID = 'bottle-tumble'

const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')

/**
 * `?roomId=<id>`: Boxity opened the game to join a particular room (the Join button
 * under "Open Rooms", a friend's invite, a CrazyGames invite). Only the first connection
 * goes there; if the room is gone or full, normal matchmaking takes over.
 */
let launchRoomId = params.get('roomId') || null

/**
 * Where to play. `?offline` forces offline play; in development `?server=` points at a
 * server. A build with VITE_LEGION_GAME_ID goes through Bloxity Legion's matchmaker;
 * otherwise VITE_SERVER_URL; in development, this game's server on the same host. A
 * production build with none of those plays offline.
 */
function serverTarget() {
  if (params.has('offline')) return null
  if (import.meta.env.DEV && params.get('server')) return { kind: 'direct', url: params.get('server') }
  if (import.meta.env.VITE_LEGION_GAME_ID) return { kind: 'matchmaker', gameId: import.meta.env.VITE_LEGION_GAME_ID }
  if (import.meta.env.VITE_SERVER_URL) return { kind: 'direct', url: import.meta.env.VITE_SERVER_URL }
  return import.meta.env.DEV ? { kind: 'dev' } : null
}

/** The server's /api/health answer, or null if it can't be reached. */
async function healthOf(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2500) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/**
 * Development: this game's own server. With a local Boxity stack (BLOXITY_ENV.env ===
 * 'local') its playUrl comes first; then port 2567 on the host the page came from (a
 * phone on the LAN too). This only locates the dev game server; it never decides which
 * Boxity environment is in use (env.js does). Only a server that says it's this game
 * counts.
 */
async function findDevServer() {
  const env = environment()
  const candidates = env.env === 'local' ? [env.playUrl] : []
  candidates.push(`${window.location.protocol}//${window.location.hostname}:2567`)
  for (const url of new Set(candidates)) {
    const health = await healthOf(url)
    if (health?.ok && health.game === SERVER_GAME_ID) return url
  }
  return null
}

let active = null
let generation = 0
/** The game server's HTTP address when connected straight to one (dev / VITE_SERVER_URL), else null. */
let httpBase = null
let lastIdentity = null
/** The room we're in (or were last in), so signing in mid-game rejoins it. */
let lastRoom = null
/** What our avatar wears, as last shared; sent again on every join. */
let localLook = null
let sendLook = () => {}

/** Shares what our Bloxity avatar wears so other players can dress our character the same. */
export function shareLook(equipped, proportions) {
  localLook = { equipped: equipped || {}, proportions: proportions || {} }
  sendLook()
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function sdkGame(method, ...args) {
  const game = getSDK()?.game
  return safeCall(game?.[method]?.bind(game), ...args)
}

/** Join options, read fresh each time: the Boxity token changes on sign-in. */
const joinOptions = (identity) => ({ playerId: identity.id, name: identity.name, token: joinToken(), gameSlug: GAME_SLUG })

function startLocal(identity, message) {
  httpBase = null
  const local = createLocalServer({ ...identity, onEvent: handleServerEvent })
  active = { kind: 'local', close: () => local.close() }
  setTransport(local)
  sdkGame('updateRoom', '')
  getGame().setNet({ mode: 'offline', players: 1, roomId: null, message })
}

/** Wires a joined room into the game: events, other players, position reports. */
function attachRoom(room, identity, Callbacks, endpoint, gen) {
  const callbacks = Callbacks.get(room)
  let leaving = false
  let replaced = false
  /** False during the first state sync: players already there vs. players arriving. */
  let stateSeen = false

  lastRoom = { endpoint, roomId: room.roomId }
  sdkGame('updateRoom', room.roomId)

  // Closing the page leaves properly, so the server lets go at once.
  const onPageHide = () => {
    leaving = true
    room.leave(true)
  }
  window.addEventListener('pagehide', onPageHide)

  const syncLobby = () => {
    getGame().setNet({ mode: 'online', roomId: room.roomId, players: room.state.players?.size ?? 1, message: null })
  }

  room.onMessage('*', (type, payload) => {
    switch (type) {
      case 'spawn':
        runtime.playerPos.set(payload.x, 0, payload.z)
        break
      case 'correct':
        runtime.playerPos.set(payload.x, payload.y, payload.z)
        break
      case 'ghostThrow':
        if (payload.sid !== room.sessionId && (payload.world || 1) === (getGame().profile.world || 1)) {
          runtime.ghostThrows.set(payload.sid, { ...payload, startedAt: performance.now() })
          // Their character winds up and throws in time with the bottle.
          markRemoteThrow(payload.sid)
        }
        break
      case 'kicked':
        leaving = true
        replaced = true
        break
      default:
        handleServerEvent(type, payload)
    }
  })

  callbacks.onAdd('players', (player, sessionId) => {
    if (sessionId !== room.sessionId) {
      upsertRemotePlayer(sessionId, player)
      callbacks.onChange(player, () => upsertRemotePlayer(sessionId, player))
      // Boxity toasts these only when that player is one of your friends.
      if (player.name) sdkGame(stateSeen ? 'playerJoined' : 'playerInRoom', player.name)
    }
    syncLobby()
  })
  room.onStateChange(() => {
    stateSeen = true
  })
  callbacks.onRemove('players', (_player, sessionId) => {
    removeRemotePlayer(sessionId)
    runtime.ghostThrows.delete(sessionId)
    syncLobby()
  })

  sendLook = () => {
    if (localLook) room.send('look', localLook)
  }
  sendLook()

  // ~10 Hz position reports, skipped while standing still doing nothing new. `t` is
  // when it was sampled (our clock, ms mod 65536), so everyone else can replay the
  // reports at their real spacing however the network bunches them up.
  const last = { x: NaN, y: NaN, z: NaN, r: NaN, a: '' }
  let lastSentAt = 0
  const posId = setInterval(() => {
    const p = runtime.playerPos
    const a = runtime.netAnim
    const r = runtime.playerYaw
    const now = performance.now()
    const moved = Math.abs(p.x - last.x) + Math.abs(p.y - last.y) + Math.abs(p.z - last.z) > 0.03
    const turned = Math.abs(r - last.r) > 0.02
    if (!moved && !turned && a === last.a && now - lastSentAt < 1000) return
    last.x = p.x
    last.y = p.y
    last.z = p.z
    last.r = r
    last.a = a
    lastSentAt = now
    // Stamped with the frame that computed this position (Player.jsx), if it's recent.
    const at = runtime.playerPosAt > now - 100 ? runtime.playerPosAt : now
    room.send('pos', { x: p.x, y: p.y, z: p.z, r, a, t: Math.round(at) & 0xffff })
  }, 1000 / POSITION_HZ)

  room.onDrop(() => getGame().setNet({ mode: 'connecting', message: 'Reconnecting…' }))
  room.onReconnect(syncLobby)
  room.onLeave((code) => {
    window.removeEventListener('pagehide', onPageHide)
    clearInterval(posId)
    // A newer connection may already own the game's state (a rejoin after sign-in).
    if (gen !== generation) return
    sendLook = () => {}
    clearRemotePlayers()
    runtime.ghostThrows.clear()
    sdkGame('updateRoom', '')
    if (replaced || code === DUPLICATE_LOGIN) {
      getGame().setNet({ mode: 'replaced', message: 'Playing in another window' })
      return
    }
    if (leaving) {
      getGame().setNet({ mode: 'offline', message: 'Disconnected' })
      return
    }
    // Lost the room (server restart, reconnect window missed): back in if we can.
    if (active?.room === room) {
      getGame().setNet({ mode: 'connecting', message: 'Reconnecting…' })
      setTimeout(() => startConnection(identity, { mode: 'rejoin' }), 1500)
    }
  })

  active = {
    kind: 'online',
    room,
    close: () => {
      leaving = true
      clearInterval(posId)
      clearRemotePlayers()
      runtime.ghostThrows.clear()
      room.leave(true)
    },
  }
  setTransport({ send: (type, payload) => room.send(type, payload) })
  syncLobby()
}

/**
 * A Legion endpoint (`<play>/v1/ws/<relayRoomId>`) rebuilt on the current environment's
 * playUrl, as Boxity's spec has a rejoin do; any other endpoint (a direct server) as is.
 */
function rejoinEndpoint(endpoint) {
  const match = /\/v1\/ws\/([^/?#]+)/.exec(endpoint || '')
  if (!match) return endpoint
  return `${environment().playUrl.replace(/^http/i, 'ws')}/v1/ws/${match[1]}`
}

/**
 * The join URL of room `roomId` from Legion's room directory
 * (`{playUrl}/v1/dir/<hostingId>/list`), or null if it's gone or full. A bare joinById
 * could land on another pod.
 */
async function findListedRoom(hostingId, roomId) {
  try {
    const res = await fetch(`${environment().playUrl}/v1/dir/${encodeURIComponent(hostingId)}/list`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const body = await res.json()
    const rooms = Array.isArray(body) ? body : body?.rooms || body?.list || []
    const room = rooms.find((r) => r && (r.roomId === roomId || r.id === roomId || r.colyseusRoomId === roomId))
    if (!room?.joinUrl) return null
    const clients = Number(room.clients ?? room.players)
    const max = Number(room.maxClients ?? room.maxPlayers)
    if (Number.isFinite(clients) && Number.isFinite(max) && max > 0 && clients >= max) return null
    return room.joinUrl
  } catch (err) {
    console.warn('[net] room directory unavailable', err)
    return null
  }
}

/**
 * Joins one specific room by id, if asked to: `lobby.mode === 'rejoin'` (signed in or
 * out mid-game: the room we were just in, so friends stay together) or the launch
 * `?roomId=` (first connection only). True once attached; false = matchmake normally.
 */
async function joinSpecificRoom(gen, identity, target, lobby, Client, Callbacks) {
  let endpoint = null
  let roomId = null
  if (lobby.mode === 'rejoin' && lastRoom) {
    endpoint = rejoinEndpoint(lastRoom.endpoint)
    roomId = lastRoom.roomId
  } else if (launchRoomId) {
    roomId = launchRoomId
    if (target.kind === 'matchmaker') {
      // Boxity's matchmaker only after init(): the requests carry the player's party.
      await whenInitialized()
      if (gen !== generation) return true
      endpoint = await findListedRoom(target.gameId, roomId)
    } else endpoint = target.kind === 'dev' ? await findDevServer() : target.url
    if (gen !== generation) return true
    // Tried (or found gone/full): later connections matchmake normally.
    launchRoomId = null
  }
  if (!endpoint || !roomId) return false
  const room = await tryJoinById(Client, endpoint, roomId, joinOptions(identity))
  if (gen !== generation) {
    room?.leave(true)
    return true
  }
  if (!room) return false
  attachRoom(room, identity, Callbacks, endpoint, gen)
  return true
}

async function tryJoinById(Client, endpoint, roomId, options) {
  try {
    return await new Client(endpoint).joinById(roomId, options)
  } catch (err) {
    console.warn(`[net] could not rejoin room ${roomId}`, err)
    return null
  }
}

/**
 * Connects `identity` ({ id, name }) to a room. `lobby.mode` is 'public' (matchmade) or
 * 'rejoin' (the identity changed mid-game: back into the same room if it still exists).
 * Falls back to offline play when no server is reachable.
 */
export async function startConnection(identity, lobby = { mode: 'public' }) {
  const gen = ++generation
  lastIdentity = identity
  stopConnection()
  const target = serverTarget()
  if (!target) {
    startLocal(identity, null)
    return
  }

  getGame().setNet({ mode: 'connecting', message: 'Connecting…' })
  // Loaded on demand: offline play never downloads the networking code.
  const { Client, Callbacks } = await import('@colyseus/sdk')
  if (gen !== generation) return

  if (await joinSpecificRoom(gen, identity, target, lobby, Client, Callbacks)) return
  if (gen !== generation) return

  if (target.kind === 'matchmaker') {
    await joinThroughMatchmaker(gen, identity, target.gameId, Client, Callbacks)
    return
  }
  const url = target.kind === 'dev' ? await findDevServer() : (await healthOf(target.url)) && target.url
  if (gen !== generation) return
  if (!url) {
    startLocal(identity, import.meta.env.DEV ? 'No local server - playing offline' : 'Server unreachable - playing offline')
    return
  }

  httpBase = url
  const client = new Client(url)
  for (let attempt = 0; attempt <= JOIN_RETRIES; attempt += 1) {
    try {
      const room = await client.joinOrCreate('game', joinOptions(identity))
      if (gen !== generation) {
        room.leave(true)
        return
      }
      attachRoom(room, identity, Callbacks, url, gen)
      return
    } catch (err) {
      if (gen !== generation) return
      console.warn('[net] join failed', err)
      if (attempt >= 1) getGame().setNet({ mode: 'connecting', message: 'Server full, retrying…' })
      await wait(attempt === 0 ? 300 : RETRY_DELAY_MS)
      if (gen !== generation) return
    }
  }
  startLocal(identity, 'Could not join a room - playing offline')
}

/**
 * Hosted on Bloxity Legion: each attempt asks the matchmaker for a seat (it picks a pod
 * with room, or cold-starts one), then joins the endpoint it returns with a NEW Client,
 * since each endpoint is pinned to one pod. Retries for up to a minute, then offline.
 */
async function joinThroughMatchmaker(gen, identity, gameId, Client, Callbacks) {
  const started = performance.now()
  // Only after init(): every matchmaker request carries the player's Boxity party.
  const sdk = await whenInitialized()
  if (gen !== generation) return
  if (!sdk?.net?.resolveEndpoint) {
    startLocal(identity, 'Server unreachable - playing offline')
    return
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { endpoint } = await sdk.net.resolveEndpoint(gameId)
      if (gen !== generation) return
      const room = await new Client(endpoint).joinOrCreate('game', joinOptions(identity))
      if (gen !== generation) {
        room.leave(true)
        return
      }
      attachRoom(room, identity, Callbacks, endpoint, gen)
      return
    } catch (err) {
      if (gen !== generation) return
      console.warn('[net] matchmaker join failed', err)
      if (performance.now() - started > MATCHMAKER_GIVE_UP_MS) break
      getGame().setNet({ mode: 'connecting', message: attempt === 0 ? 'Starting a server…' : 'Still connecting…' })
      await wait(MATCHMAKER_BACKOFF_MS[Math.min(attempt, MATCHMAKER_BACKOFF_MS.length - 1)])
      if (gen !== generation) return
    }
  }
  startLocal(identity, 'Could not reach the game server - playing offline')
}

/** Takes the game back after another window of the same account replaced this one. */
export function playHere() {
  if (lastIdentity) startConnection(lastIdentity)
}

/** The game server's HTTP base (for /api/leaderboards), when known. */
export function serverHttpUrl() {
  return active?.kind === 'online' ? httpBase : null
}

export function isOnline() {
  return active?.kind === 'online'
}

/** The Colyseus id of the room we're playing in, or null (offline / connecting). */
export function currentRoomId() {
  return active?.kind === 'online' ? active.room.roomId : null
}

export function stopConnection() {
  if (!active) return
  setTransport(null)
  active.close()
  active = null
  sdkGame('updateRoom', '')
}
