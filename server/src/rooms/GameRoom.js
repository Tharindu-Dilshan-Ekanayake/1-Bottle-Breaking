import { Room } from '@colyseus/core'

import { applyOfflineProgress } from '../../../shared/logic.js'
import { PlayerSession } from '../../../shared/session.js'
import { clampToWalkable, MAX_MOVE_SPEED, SPAWN } from '../../../shared/world.js'
import { resolveIdentity, verifyAdReward } from '../bloxityApi.js'
import { bloxity } from '../bloxityEnv.js'
import { reportLeaver } from '../bloxityLeaderboards.js'
import { carryOverGuest, loadProfile, saveProfile } from '../db.js'
import { applyGemsForSession } from '../gems.js'
import { activePlayers, liveRooms } from '../registry.js'
import { GameState, PlayerState } from './schema.js'

const MAX_CLIENTS = 8
const RECONNECT_SECONDS = 20
const AUTOSAVE_MS = 30_000
/** State patches to clients, and the training / bounce simulation, per second. */
const PATCH_HZ = 15
const SIM_HZ = 10
/** Allowance on top of max speed for a position update to be accepted. */
const MOVE_SLACK = 2.5
/** Close code used when the same player joins somewhere else (4000-4010 are Colyseus's). */
const DUPLICATE_LOGIN = 4100
/** Names this server process in save ownership; Legion sets POD_NAME per pod. */
const POD = process.env.POD_NAME || `local-${process.pid}`

/** What other players may be told someone is doing. */
const ANIMS = ['idle', 'walk', 'run', 'jump', 'train', 'throw', 'cheer']

const cleanName = (name) =>
  String(name || 'Player')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 20) || 'Player'

/**
 * One lobby: up to 8 players. All game rules run in each player's PlayerSession; the
 * room handles networking, position validation, persistence and the small shared state
 * other players render from.
 */
export class GameRoom extends Room {
  maxClients = MAX_CLIENTS
  autoDispose = true

  /** sessionId -> { session, playerId, verified, owner, lastPos, lastPosAt, kicked?, reconnection? } */
  members = new Map()

  onCreate() {
    this.setState(new GameState())
    this.setPatchRate(1000 / PATCH_HZ)
    this.setSimulationInterval((dt) => this.tick(dt / 1000), 1000 / SIM_HZ)
    this.updateListing()
    liveRooms.add(this)

    this.onMessage('*', (client, type, payload) => {
      if (type === 'pos') return this.handlePosition(client, payload)
      if (type === 'look') return this.handleLook(client, payload)
      // Boxity: a finished rewarded ad (verified with Boxity before it pays), and
      // "I just bought something" (apply any Gems grant the webhook recorded).
      if (type === 'adReward') return this.handleAdReward(client, payload)
      if (type === 'gemsCheck') return applyGemsForSession(this, client.sessionId)
      if (type === 'respawn') return this.handleRespawn(client)
      const member = this.members.get(client.sessionId)
      if (!member) return
      member.session.handle(String(type), payload || {}, Date.now())
      this.syncPlayer(client.sessionId)
    })

    // A Boxity emote, `{ id }`: a 24-hex emote id to play, or '' to stop. Kept on the
    // player's synced state for everyone else to play; `emoteSeq` counts starts, so the
    // same emote picked twice plays again. Cosmetic: anything malformed is ignored.
    this.onMessage('emote', (client, msg) => {
      const player = this.state.players.get(client.sessionId)
      const id = msg && typeof msg.id === 'string' ? msg.id : null
      if (!player || id === null || (id !== '' && !/^[a-f0-9]{24}$/i.test(id))) return
      if (id === '') {
        if (player.emote !== '') player.emote = ''
        return
      }
      player.emote = id
      player.emoteSeq = ((player.emoteSeq || 0) + 1) % 65536
    })

    this.autosave = setInterval(() => this.saveAll(), AUTOSAVE_MS)
  }

  /**
   * Who is joining. Options are `{ playerId, name, token }`, `token` being the Boxity
   * SDK's game token (null for guests). Throwing refuses the join.
   */
  async onAuth(_client, options) {
    const identity = await resolveIdentity(options)
    return { ...identity, name: cleanName(identity.name || options?.name) }
  }

  async onJoin(client, _options, auth) {
    const { playerId, name, verified = false } = client.auth || auth

    // Same account joining again (a refresh, a new tab): the newest connection wins.
    const existing = activePlayers.get(playerId)
    if (existing) await existing.room.evict(existing.client, 'You joined from another window.')

    // A Boxity account signing in for the first time here: bring the progress of the
    // guest this browser played as (Boxity's carriedFrom) - once, and only if the
    // account has no progress of its own yet.
    const { carriedFrom = [] } = client.auth || auth
    if (verified && carriedFrom.length) {
      const carried = await carryOverGuest(playerId, carriedFrom, name)
      if (carried) console.log(`[auth] carried guest ${carried} into ${playerId}`)
    }

    const now = Date.now()
    const owner = `${POD}:${client.sessionId}`
    const profile = await loadProfile(playerId, name, owner)
    const offline = applyOfflineProgress(profile, now)

    const player = new PlayerState()
    const spawnX = SPAWN.x + (Math.random() - 0.5) * 6
    const spawnZ = SPAWN.z + (Math.random() - 0.5) * 4
    Object.assign(player, {
      name,
      uid: verified ? playerId : '',
      x: spawnX,
      y: 0,
      z: spawnZ,
      rotY: Math.PI,
      anim: 'idle',
      bottleId: profile.equippedBottle,
    })
    this.state.players.set(client.sessionId, player)

    const session = new PlayerSession(profile, {
      now,
      emit: this.emitter(client),
      getPosition: () => player,
      // Through the portal: arrive at the new world's spawn point.
      onTravel: () => this.moveToSpawn(client),
      onThrow: (result) => {
        // Everyone else watches it as a ghost bottle. Excluded by session id: after a
        // reconnect the client object from the join is stale.
        const self = this.clients.find((c) => c.sessionId === client.sessionId)
        this.broadcast(
          'ghostThrow',
          {
            sid: client.sessionId,
            hops: result.hops,
            durations: result.durations,
            bottleId: profile.equippedBottle,
            x: player.x,
            z: player.z,
            world: profile.world,
          },
          self ? { except: self } : undefined,
        )
      },
    })

    this.members.set(client.sessionId, { session, playerId, verified, owner, lastPos: { x: spawnX, z: spawnZ }, lastPosAt: now })
    activePlayers.set(playerId, { room: this, client })

    session.sendProfile()
    client.send('spawn', { x: spawnX, z: spawnZ })
    if (offline) client.send('offline', offline)
    this.syncPlayer(client.sessionId)
    this.updateListing()
    // Anything bought while they were away.
    applyGemsForSession(this, client.sessionId)
  }

  /**
   * How a player's session talks to their client. A training rep in a pit is also
   * counted on their synced state, so everyone else sees their bottle bounce with it.
   */
  emitter(client) {
    return (type, payload) => {
      if (type === 'train' && payload?.source === 'pad') {
        const player = this.state.players.get(client.sessionId)
        if (player) player.reps = ((player.reps || 0) + 1) & 0xff
      }
      client.send(type, payload)
    }
  }

  /** Boxity's "Reset Character": back to a spawn point (the server moves you). */
  handleRespawn(client) {
    const member = this.members.get(client.sessionId)
    if (!member || member.kicked) return
    member.session.handle('leavePad', {}, Date.now())
    this.moveToSpawn(client)
  }

  /** Puts a player on a spawn point (respawn, travel) and tells their client. */
  moveToSpawn(client) {
    const member = this.members.get(client.sessionId)
    const player = this.state.players.get(client.sessionId)
    if (!member || !player) return
    const x = SPAWN.x + (Math.random() - 0.5) * 6
    const z = SPAWN.z + (Math.random() - 0.5) * 4
    Object.assign(player, { x, y: 0, z })
    member.lastPos = { x, z }
    member.lastPosAt = Date.now()
    client.send('spawn', { x, z })
  }

  /**
   * A rewarded ad the client says was watched: `{ placement, rewardToken }`. Pays only
   * if Boxity confirms the token (once, for this game, within 5 minutes). Off Boxity
   * hosting (development) there is no token to check, so it pays.
   */
  async handleAdReward(client, payload) {
    const member = this.members.get(client.sessionId)
    if (!member || member.kicked) return
    const placement = String(payload?.placement || '')
    const ok = bloxity.hosted ? await verifyAdReward(payload?.rewardToken) : true
    // They may have left while Boxity answered.
    if (this.members.get(client.sessionId) !== member) return
    if (!ok) {
      client.send('denied', { action: 'adReward', reason: 'That ad could not be verified - try again later' })
      return
    }
    member.session.grantAdReward(placement, Date.now())
    this.syncPlayer(client.sessionId)
  }

  /** Dropped without saying goodbye (a mobile network blip): hold the seat. */
  async onDrop(client) {
    const member = this.members.get(client.sessionId)
    if (!member || member.kicked) return
    member.session.handle('leavePad', {}, Date.now())
    member.reconnection = this.allowReconnection(client, RECONNECT_SECONDS)
    try {
      await member.reconnection
    } catch {
      // Window expired, or the player came back as a new session; onLeave cleans up.
    } finally {
      member.reconnection = null
    }
  }

  onReconnect(client) {
    const member = this.members.get(client.sessionId)
    if (!member) return
    activePlayers.set(member.playerId, { room: this, client })
    member.session.emit = this.emitter(client)
    member.session.sendProfile()
  }

  async onLeave(client) {
    const member = this.members.get(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (member) {
      if (activePlayers.get(member.playerId)?.client === client) activePlayers.delete(member.playerId)
      this.members.delete(client.sessionId)
      if (!member.kicked) {
        if (member.verified) reportLeaver(member.playerId, member.session.profile)
        await saveProfile(member.session.profile, member.owner)
      }
    }
    this.updateListing()
  }

  /** The pod is going away (a deploy, or scaling in): save everyone first. */
  async onBeforeShutdown() {
    await this.saveAll()
    super.onBeforeShutdown()
  }

  async onDispose() {
    liveRooms.delete(this)
    clearInterval(this.autosave)
    await this.saveAll()
  }

  /** Saves and removes a player who has joined again elsewhere. */
  async evict(client, reason) {
    const member = this.members.get(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (member && !member.kicked) {
      member.kicked = true
      await saveProfile(member.session.profile, member.owner)
      member.reconnection?.reject(new Error('replaced by a new session'))
    }
    try {
      client.send('kicked', { reason })
      client.leave(DUPLICATE_LOGIN)
    } catch {
      // Already disconnected (the held-seat case).
    }
  }

  saveAll() {
    return Promise.all([...this.members.values()].map((m) => (m.kicked ? null : saveProfile(m.session.profile, m.owner))))
  }

  updateListing() {
    this.setMetadata({ players: this.clients.length, region: process.env.REGION || 'default' })
  }

  /** Copies the public bits of a profile into the synced state (only what changed). */
  syncPlayer(sessionId) {
    const member = this.members.get(sessionId)
    const player = this.state.players.get(sessionId)
    if (!member || !player) return
    const p = member.session.profile
    if (player.power !== p.power) player.power = p.power
    if (player.wins !== p.wins) player.wins = p.wins
    if (player.rebirths !== p.rebirths) player.rebirths = p.rebirths
    if (player.level !== p.level) player.level = p.level
    if (player.world !== p.world) player.world = p.world
    if (player.bottleId !== p.equippedBottle) player.bottleId = p.equippedBottle
    const pets = p.equippedPets.map((uid) => p.pets.find((pet) => pet.uid === uid)?.id).filter(Boolean)
    if (pets.join() !== [...player.petIds].join()) {
      player.petIds.clear()
      for (const id of pets) player.petIds.push(id)
    }
  }

  /**
   * Position reports, ~10 Hz from each client. Accepted if the move is physically
   * possible since the last accepted one; otherwise the client is snapped back.
   */
  handlePosition(client, msg) {
    const member = this.members.get(client.sessionId)
    const player = this.state.players.get(client.sessionId)
    if (!member || !player || !msg) return
    const x = Number(msg.x)
    const y = Number(msg.y)
    const z = Number(msg.z)
    if (![x, y, z].every(Number.isFinite)) return

    const now = Date.now()
    const dt = Math.max(0.05, (now - member.lastPosAt) / 1000)
    const dist = Math.hypot(x - member.lastPos.x, z - member.lastPos.z)
    if (dist > MAX_MOVE_SPEED * dt + MOVE_SLACK) {
      client.send('correct', { x: member.lastPos.x, y: player.y, z: member.lastPos.z })
      return
    }
    const clamped = clampToWalkable(x, z)
    member.lastPos = clamped
    member.lastPosAt = now
    player.x = clamped.x
    player.y = Math.max(0, Math.min(y, 6))
    player.z = clamped.z
    player.rotY = Number(msg.r) || 0
    player.anim = ANIMS.includes(msg.a) ? msg.a : 'idle'
    // The sender's sample time (ms mod 65536); a client that sends none is timed by arrival.
    if (Number.isInteger(msg.t)) player.stamp = msg.t & 0xffff
  }

  /**
   * What a player's avatar wears, so everyone else can dress them the same. Cosmetic,
   * so trusted as sent, but kept to a small object of short strings and numbers.
   */
  handleLook(client, msg) {
    const player = this.state.players.get(client.sessionId)
    if (!player || !msg || typeof msg !== 'object') return
    const clean = (obj, keep) => {
      const out = {}
      if (!obj || typeof obj !== 'object') return out
      for (const [key, value] of Object.entries(obj).slice(0, 24)) {
        if (key.length > 24) continue
        if (keep(value)) out[key] = value
      }
      return out
    }
    // Every Bloxity slot, ids only: other keys, and anything shaped like a URL, are
    // dropped (clients build every asset URL themselves from these ids).
    const EQUIPPED_KEYS = [
      'skinId', 'headId', 'torsoId', 'armLId', 'armRId', 'legLId', 'legRId',
      'hatId', 'hairId', 'maskId', 'backId', 'neckId', 'chestId', 'waistId', 'handId', 'shoesId',
      'faceId', 'shirtId', 'pantsId', 'characterId',
    ]
    const isId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{0,40}$/.test(v)) || (Number.isInteger(v) && Math.abs(v) < 1e12)
    const equipped = {}
    if (msg.equipped && typeof msg.equipped === 'object') {
      for (const key of EQUIPPED_KEYS) if (isId(msg.equipped[key])) equipped[key] = msg.equipped[key]
    }
    const look = JSON.stringify({
      equipped,
      proportions: clean(msg.proportions, (v) => Number.isFinite(v) && v >= -1 && v <= 6),
    })
    if (look.length <= 2048 && look !== player.look) player.look = look
  }

  tick(dt) {
    const now = Date.now()
    for (const [sessionId, member] of this.members) {
      member.session.tick(dt, now)
      this.syncPlayer(sessionId)
    }
  }
}
