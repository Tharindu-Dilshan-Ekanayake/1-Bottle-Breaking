import { BOOSTS, levelCap } from '@shared/balance'
import { fmt } from '@shared/format'

import { sfx } from '../game/audio'
import { MAX_TRAIN_PULSES, runtime } from '../game/runtime'
import { toast, useUi } from '../game/stores/ui'
import { getGame } from '../store/game'

/**
 * Applies one authority event to the client: updates the stores and hands anything
 * visual to the frame loop through `runtime`. The same handler serves the Colyseus
 * connection and offline play.
 */
export function handleServerEvent(type, payload) {
  const game = getGame()
  switch (type) {
    case 'profile':
      game.setProfile(payload.profile, payload.session)
      break

    case 'train':
      game.patchProfile(
        // The rep count rides along so the first-time guide can count reps (training
        // doesn't re-send the whole profile).
        Number.isFinite(payload.trains) && payload.trains !== game.profile.stats.trains
          ? { power: payload.power, level: payload.level, stats: { ...game.profile.stats, trains: payload.trains } }
          : { power: payload.power, level: payload.level },
      )
      // A training rep is a bounce of the bottle down the pit's steps.
      if (payload.source === 'pad' && runtime.trainPulses.length < MAX_TRAIN_PULSES) {
        runtime.trainPulses.push(payload.gain)
      }
      if (payload.leveledUp) {
        sfx.levelUp()
        useUi.setState({ levelUp: { level: payload.level, maxed: payload.maxed, id: performance.now() } })
        if (payload.maxed) {
          toast(`MAX LEVEL ${levelCap(game.profile.rebirths)}! Rebirth to grow stronger`, 'good')
        }
      }
      break

    case 'throw':
      // The server confirmed the throw: the frame loop replays its flight plan, and
      // the HUD holds its Wins back until the bottle shatters.
      runtime.throwPlan = payload
      game.holdWins(payload.wins + payload.prize)
      useUi.setState({ throwPending: false })
      break

    case 'hatch':
      sfx.rattle()
      useUi.setState({ hatching: { pets: payload.pets, egg: payload.eggId, at: performance.now() } })
      break

    case 'rebirth':
      sfx.rebirth()
      runtime.cheer = 2
      useUi.setState({ celebrate: { rebirths: payload.rebirths, gift: payload.gift, id: performance.now() }, panel: null })
      break

    case 'pack':
      sfx.buy()
      toast(`+${fmt(payload.amount)} Power!`, 'good')
      break

    case 'denied':
      sfx.error()
      toast(payload.reason, 'bad')
      if (payload.action === 'throw') useUi.setState({ throwPending: false })
      break

    case 'gems':
      sfx.buy()
      toast(payload.pass ? `${payload.name} unlocked!` : `+${fmt(payload.wins || 0)} Wins!`, 'good')
      break

    case 'reward':
      sfx.buy()
      toast(payload.power ? `${payload.label}: +${fmt(payload.power)} Power!` : `${payload.label}!`, 'good')
      break

    case 'gift': {
      sfx.unlock()
      const parts = []
      if (payload.wins) parts.push(`+${fmt(payload.wins)} Wins`)
      if (payload.power) parts.push(`+${fmt(payload.power)} Power`)
      if (payload.boost) parts.push(`${BOOSTS[payload.boost]?.name || 'Boost'} for ${payload.minutes} min`)
      toast(`${payload.label}! ${parts.join(' · ')}`.trim(), 'good')
      break
    }

    case 'upgrade':
      sfx.unlock()
      toast(`${payload.name} - level ${payload.level}!`, 'good')
      break

    case 'world':
      sfx.rebirth()
      useUi.setState({ worldArrive: { world: payload.world, name: payload.name, unlocked: payload.unlocked, id: performance.now() } })
      break

    case 'spawn':
      runtime.playerPos.set(payload.x, 0, payload.z)
      break

    case 'offline':
      toast(`You trained while away: +${fmt(payload.power)} Power`, 'good')
      break

    default:
      break
  }
}
