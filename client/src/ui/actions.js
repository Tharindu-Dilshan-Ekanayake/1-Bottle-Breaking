import { BOTTLES, EGGS, levelCap } from '@shared/balance'
import { fmt } from '@shared/format'
import { bottleIndex, isMaxLevel, rebirthSkipPrice } from '@shared/logic'
import { portalTarget } from '@shared/world'

import { sfx } from '../game/audio'
import { runtime } from '../game/runtime'
import { toast, useUi } from '../game/stores/ui'
import { actions } from '../net/actions'
import { getGame } from '../store/game'

/**
 * What the HUD's buttons do. Each checks the rules locally first (the same shared
 * rules the authority runs) for instant feedback, then sends the intent; the authority
 * has the final say and its answer arrives as a profile update or an event.
 */

/** Give up waiting for the server to confirm a throw after this long. */
const THROW_CONFIRM_MS = 2500

export function requestThrow() {
  const ui = useUi.getState()
  if (!runtime.stageReady || runtime.mode !== 'walk' || ui.throwPending) return
  useUi.setState({ throwPending: true })
  actions.throwBottle()
  setTimeout(() => {
    if (useUi.getState().throwPending) useUi.setState({ throwPending: false })
  }, THROW_CONFIRM_MS)
}

export function hatchEgg(eggId) {
  const egg = EGGS[eggId]
  if (getGame().profile.wins < egg.cost) {
    sfx.error()
    toast(`Need ${fmt(egg.cost)} Wins for the ${egg.name}`, 'bad')
    return
  }
  actions.hatch(eggId)
}

export function buyOrEquipBottle(id) {
  const profile = getGame().profile
  if (profile.ownedBottles.includes(id)) {
    actions.equipBottle(id)
    sfx.equip()
    return
  }
  const bottle = BOTTLES[bottleIndex(id)]
  const previous = BOTTLES[bottleIndex(id) - 1]
  if (previous && !profile.ownedBottles.includes(previous.id)) {
    sfx.error()
    toast(`Buy the ${previous.name} first!`, 'bad')
    return
  }
  if (profile.wins < bottle.cost) {
    sfx.error()
    toast(`Need ${fmt(bottle.cost)} Wins`, 'bad')
    return
  }
  sfx.buy()
  toast(`${bottle.name} unlocked!`, 'good')
  actions.buyBottle(id)
}

export function doRebirth() {
  const profile = getGame().profile
  if (!isMaxLevel(profile)) {
    sfx.error()
    toast(`Reach level ${levelCap(profile.rebirths)} first!`, 'bad')
    return
  }
  actions.rebirth()
}

export function doSkipRebirth() {
  const profile = getGame().profile
  if (profile.wins < rebirthSkipPrice(profile)) {
    sfx.error()
    toast('Not enough Wins to skip', 'bad')
    return
  }
  actions.skipRebirth()
}

/** The context action for wherever the player is standing (button or E key). */
export function primaryAction() {
  const { nearby, mode, panel, pedestal } = useUi.getState()
  if (mode !== 'walk' || panel) return
  if (nearby === 'launch') requestThrow()
  else if (nearby === 'shop' && pedestal >= 0) buyOrEquipBottle(BOTTLES[pedestal].id)
  else if (nearby === 'shop') useUi.setState({ panel: 'bottles' })
  else if (nearby?.startsWith('egg:')) hatchEgg(nearby.slice(4))
  else if (nearby === 'portal') actions.travel(portalTarget(getGame().profile.world || 1))
}
