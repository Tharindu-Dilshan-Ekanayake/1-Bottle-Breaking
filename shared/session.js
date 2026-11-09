import { EGGS, PADS } from './balance.js'
import {
  addPlaytime,
  applyBounce,
  applyRebirth,
  applyThrow,
  applyTrain,
  buyBottle,
  buyPerk,
  buyUpgrade,
  buyPowerPack,
  canAutoThrow,
  claimDaily,
  claimPlaytime,
  createSession,
  deletePet,
  equipBestPets,
  equipBottle,
  equipPet,
  grantAdReward,
  grantGemProduct,
  hatchEgg,
  isMaxLevel,
  isPadUnlocked,
  skipRebirth,
  trainInterval,
  travelTo,
  unequipPet,
  unlockWorld,
} from './logic.js'
import { eggStandNear, inLaunch, inPortal, onPad } from './world.js'

/** How far off a pit's start plate still counts as "on" it (network jitter). */
const PAD_SLACK = 0.8
/** Same for the throw platform, the shop and the egg stands. */
const LAUNCH_SLACK = 1.5
const EGG_SLACK = 1.5
const PORTAL_SLACK = 1.5

/**
 * One player's authoritative session: validates intents, runs training and the
 * bounces of a throw, and reports what happened through `emit`.
 *
 * Transport-agnostic on purpose. The Colyseus room wraps one of these per client; the
 * offline mode wraps one for the local player. Either way the rules that run are the
 * same.
 *
 * Events emitted (type, payload):
 * - 'profile' { profile, session }   full state, after anything structural
 * - 'train'   { source, pad, gain, power, level, leveledUp, levels, maxed }
 *             one Power gain; `source` is 'pad' (a training rep) or 'bounce'
 * - 'throw'   { stairs, hops, durations, bounceAt, duration, zone, wins, prize,
 *               discovered, best, bottleId }   a throw to replay
 * - 'hatch'   { eggId, pets: [{ uid, id }] }   pets to reveal
 * - 'rebirth' { rebirths, gift }
 * - 'pack'    { amount }                       a Power pack landed
 * - 'gems'    { sku, name, wins?, pass? }      a Gems purchase was applied
 * - 'reward'  { placement, label, power? }     a rewarded ad paid out
 * - 'gift'    { source, label, wins?, power?, boost?, minutes?, pets?, eggId? }
 *             a daily reward or playtime gift opened
 * - 'upgrade' { kind, id, level, name }         a Wins upgrade or rebirth perk bought
 * - 'world'   { world, name, unlocked }         unlocked a world and/or travelled to it
 * - 'denied'  { action, reason }               an intent the rules refused
 *
 * `onThrow(result)` lets the host tell other players about a throw (ghost bottles).
 */
export class PlayerSession {
  constructor(profile, { now, emit, getPosition, onThrow, onTravel, rand = Math.random }) {
    this.profile = profile
    this.session = createSession(now)
    this.emit = emit
    this.getPosition = getPosition
    this.onThrow = onThrow
    /** onTravel(world) lets the host move the player to the new world spawn. */
    this.onTravel = onTravel
    this.rand = rand

    /** Pit the client says it's on; verified against position every tick. */
    this.pad = -1
    this.trainTimer = 0
    /** Server time until which the bottle (and its result card) is out. */
    this.busyUntil = 0
    /** The throw in progress: its start time and bounce schedule. */
    this.throwStart = 0
    this.bounceAt = []
    this.bounceIndex = 0
    this.dirty = false
  }

  sendProfile() {
    this.dirty = false
    this.emit('profile', { profile: this.profile, session: this.session })
  }

  deny(action, reason) {
    if (reason) this.emit('denied', { action, reason })
  }

  /**
   * Applies a Gems purchase. NOT a client message (not in `handlers`): the host calls it
   * only once Boxity's webhook recorded the sale (online) or the SDK confirmed it
   * (offline).
   */
  grantGemProduct(sku) {
    const result = grantGemProduct(this.profile, sku)
    if (!result.ok) return result
    this.emit('gems', result)
    this.sendProfile()
    return result
  }

  /**
   * Pays rewarded ad `placement`. NOT a client message: the host calls it only once
   * Boxity verified the ad's reward token (online) or reported it completed (offline).
   */
  grantAdReward(placement, now = Date.now()) {
    const result = grantAdReward(this.profile, placement, now)
    if (!result.ok) {
      this.deny('adReward', result.error)
      return result
    }
    this.emit('reward', result)
    this.sendProfile()
    return result
  }

  /** Dispatches one client message. Unknown types are ignored. */
  handle(type, payload = {}, now = Date.now()) {
    const handler = Object.prototype.hasOwnProperty.call(this.handlers, type) ? this.handlers[type] : null
    if (!handler) return
    handler.call(this, payload || {}, now)
    if (this.dirty) this.sendProfile()
  }

  handlers = {
    enterPad({ pad }) {
      const index = Number(pad)
      if (!Number.isInteger(index) || !PADS[index]) return
      if (!isPadUnlocked(this.profile, index)) return
      if (this.pad !== index) {
        this.pad = index
        // The first rep lands a beat after stepping on, not instantly.
        this.trainTimer = trainInterval(this.profile) * 0.5
      }
    },

    leavePad() {
      this.pad = -1
    },

    setting({ key, value }) {
      if (key === 'autoRebirth') this.profile.settings.autoRebirth = Boolean(value)
      else if (key === 'autoThrow') this.profile.settings.autoThrow = Boolean(value) && canAutoThrow(this.profile)
      else return
      this.dirty = true
    },

    rebirth() {
      const result = applyRebirth(this.profile, { rand: this.rand })
      if (result.ok) this.afterRebirth(result)
      else this.deny('rebirth', result.error)
    },

    skipRebirth() {
      const result = skipRebirth(this.profile, { rand: this.rand })
      if (result.ok) this.afterRebirth(result)
      else this.deny('skipRebirth', result.error)
    },

    /** Throws your bottle: only from the throw platform, and not while one is out. */
    throw(_payload, now) {
      if (now < this.busyUntil) return
      const p = this.getPosition()
      if (!inLaunch(p.x, p.z, LAUNCH_SLACK)) return this.deny('throw', 'Stand on the throw platform!')
      const result = applyThrow(this.profile, { rand: this.rand })
      this.busyUntil = now + result.cooldown * 1000
      this.throwStart = now
      this.bounceAt = result.bounceAt
      this.bounceIndex = 0
      this.pad = -1
      this.emit('throw', {
        stairs: result.stairs,
        hops: result.hops,
        durations: result.durations,
        bounceAt: result.bounceAt,
        duration: result.duration,
        zone: result.zone,
        wins: result.wins,
        prize: result.prize,
        discovered: result.discovered,
        best: result.best,
        bottleId: this.profile.equippedBottle,
      })
      this.onThrow?.(result)
      this.dirty = true
    },

    /** Bottles can be bought (in order) from the shop menu anywhere, or at a pedestal. */
    buyBottle({ id }) {
      const result = buyBottle(this.profile, id)
      if (result.ok) this.dirty = true
      else this.deny('buyBottle', result.error)
    },

    /** A Power pack from the bar under the level, for Wins. */
    buyPack({ index }) {
      const result = buyPowerPack(this.profile, Number(index))
      if (!result.ok) return this.deny('buyPack', result.error)
      this.dirty = true
      this.emit('pack', { amount: result.amount })
    },

    equipBottle({ id }) {
      if (equipBottle(this.profile, id).ok) this.dirty = true
    },

    hatch({ eggId }) {
      if (!EGGS[eggId]) return
      const p = this.getPosition()
      if (eggStandNear(p.x, p.z, EGG_SLACK, this.profile.world)?.egg !== eggId) return this.deny('hatch', 'Walk up to the egg to hatch it!')
      const result = hatchEgg(this.profile, eggId, { rand: this.rand })
      if (result.ok) this.reveal(result)
      else this.deny('hatch', result.error)
    },

    /** Today's daily reward. */
    claimDaily(_payload, now) {
      const result = claimDaily(this.profile, now, { rand: this.rand })
      if (!result.ok) return this.deny('claimDaily', result.error)
      this.gift(result)
    },

    /** A playtime gift that has opened. */
    claimPlaytime({ index }, now) {
      const result = claimPlaytime(this.profile, Number(index), now, { rand: this.rand })
      if (!result.ok) return this.deny('claimPlaytime', result.error)
      this.gift(result)
    },

    buyUpgrade({ id }) {
      const result = buyUpgrade(this.profile, String(id))
      if (!result.ok) return this.deny('buyUpgrade', result.error)
      this.dirty = true
      this.emit('upgrade', { kind: 'upgrade', id: result.id, level: result.level, name: result.name })
    },

    buyPerk({ id }) {
      const result = buyPerk(this.profile, String(id))
      if (!result.ok) return this.deny('buyPerk', result.error)
      this.dirty = true
      this.emit('upgrade', { kind: 'perk', id: result.id, level: result.level, name: result.name })
    },

    /**
     * Through the portal: unlocks the world first if it isn't yet (Wins + Rebirths),
     * then travels there. Only from the portal.
     */
    travel({ world }) {
      const id = Number(world)
      const p = this.getPosition()
      if (!inPortal(p.x, p.z, PORTAL_SLACK)) return this.deny('travel', 'Walk into the portal!')
      const unlocked = unlockWorld(this.profile, id)
      if (!unlocked.ok) return this.deny('travel', unlocked.error)
      const result = travelTo(this.profile, id)
      if (!result.ok) return this.deny('travel', result.error)
      this.pad = -1
      this.dirty = true
      this.emit('world', { world: id, name: result.name, unlocked: !unlocked.already })
      this.onTravel?.(id)
    },

    equipPet({ uid }) {
      const result = equipPet(this.profile, Number(uid))
      if (result.ok) this.dirty = true
      else this.deny('equipPet', result.error)
    },

    unequipPet({ uid }) {
      unequipPet(this.profile, Number(uid))
      this.dirty = true
    },

    equipBest() {
      equipBestPets(this.profile)
      this.dirty = true
    },

    deletePet({ uid }) {
      if (deletePet(this.profile, Number(uid)).ok) this.dirty = true
    },
  }

  /** Sends newly gained pets to the client's hatch animation. */
  reveal(result) {
    if (!result?.ok || !result.pets?.length) return
    this.dirty = true
    this.emit('hatch', { eggId: result.eggId ?? null, pets: result.pets })
  }

  afterRebirth(result) {
    this.dirty = true
    this.emit('rebirth', { rebirths: result.rebirths, gift: result.gift })
    if (result.pets?.length) this.reveal(result)
  }

  /** A reward opened: the client shows it (and hatches any pets it brought). */
  gift(result) {
    this.dirty = true
    this.emit('gift', {
      source: result.source,
      label: result.label,
      wins: result.wins,
      power: result.power,
      boost: result.boost,
      minutes: result.minutes,
      eggId: result.eggId,
      pets: result.pets,
    })
    if (result.pets?.length) this.reveal({ ok: true, eggId: result.eggId, pets: result.pets })
  }

  /** Whether the player is really standing on the pit they claim. */
  onClaimedPad() {
    if (this.pad < 0) return false
    const p = this.getPosition()
    return onPad(this.pad, p.x, p.z, PAD_SLACK)
  }

  /** Advances training and the bounces of a throw. Call at a steady rate. */
  tick(dt, now) {
    if (this.bounceIndex < this.bounceAt.length) {
      // Each bounce down the stairs pays Power the moment the client sees it land.
      while (this.bounceIndex < this.bounceAt.length && now >= this.throwStart + this.bounceAt[this.bounceIndex] * 1000) {
        this.bounceIndex += 1
        this.gain('bounce', -1, applyBounce(this.profile))
      }
    } else if (this.pad >= 0 && now >= this.busyUntil && this.onClaimedPad()) {
      const interval = trainInterval(this.profile)
      this.trainTimer += dt
      while (this.trainTimer >= interval) {
        this.trainTimer -= interval
        this.trainOnce()
      }
    } else {
      this.trainTimer = Math.min(this.trainTimer, trainInterval(this.profile) * 0.5)
    }
    this.profile.stats.playtime += dt
    addPlaytime(this.profile, dt, now)
    if (this.dirty) this.sendProfile()
  }

  /** Tells the client about a Power gain; rebirths automatically if that's switched on. */
  gain(source, pad, result) {
    if (result.gain > 0) {
      this.emit('train', {
        source,
        pad,
        gain: result.gain,
        power: this.profile.power,
        level: this.profile.level,
        trains: this.profile.stats.trains,
        leveledUp: result.leveledUp,
        levels: result.levels,
        maxed: result.maxed,
      })
    }
    if (this.profile.settings.autoRebirth && isMaxLevel(this.profile)) {
      const rebirth = applyRebirth(this.profile, { rand: this.rand })
      if (rebirth.ok) this.afterRebirth(rebirth)
    }
  }

  trainOnce() {
    const result = applyTrain(this.profile, this.pad)
    if (!result.ok) {
      this.pad = -1
      return
    }
    this.gain('pad', this.pad, result)
  }
}
