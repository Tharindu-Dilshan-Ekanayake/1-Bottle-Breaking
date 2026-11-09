import { useEffect } from 'react'

import { THROW_RECOVERY } from '@shared/balance'
import { canAutoThrow, walkSpeedMult } from '@shared/logic'
import { pedestalNear } from '@shared/world'

import { actions } from '../net/actions'
import { getGame, useGame } from '../store/game'
import { requestThrow } from '../ui/actions'
import { setMuted, setMusic, sfx } from './audio'
import { runtime } from './runtime'
import { useUi } from './stores/ui'

const SYNC_MS = 100
const RESULT_MS = THROW_RECOVERY * 1000
/**
 * The bridge from the render loop to React and the authority, on a 10 Hz interval
 * (never per frame):
 *  - mirrors the runtime fields the HUD shows into the UI store, only on change
 *  - tells the authority when you step on or off a training pit
 *  - turns a shattered bottle into the result card, then hands control back
 *  - auto throw, when it's switched on
 */
export function RuntimeSync() {
  useEffect(() => {
    const mirror = (profile) => {
      runtime.world = profile.world || 1
      runtime.walkMult = walkSpeedMult(profile)
    }
    mirror(getGame().profile)
    return useGame.subscribe((state, prev) => {
      if (state.profile !== prev.profile) mirror(state.profile)
    })
  }, [])

  useEffect(() => {
    let lastZone = 0
    let lastPad = -1
    let nextChirpAt = performance.now() + 4000
    let resultTimer = null
    let handlingResult = false

    const id = setInterval(() => {
      const r = runtime
      const ui = useUi.getState()
      if (r.mode === 'walk' && performance.now() > nextChirpAt) {
        sfx.chirp()
        nextChirpAt = performance.now() + 5000 + Math.random() * 9000
      }
      const patch = {}
      if (ui.nearby !== r.nearby) patch.nearby = r.nearby
      const pedestal = r.nearby === 'shop' ? pedestalNear(r.playerPos.x, r.playerPos.z) : -1
      if (ui.pedestal !== pedestal) patch.pedestal = pedestal
      if (ui.mode !== r.mode) patch.mode = r.mode
      const training = r.trainingPad >= 0
      if (ui.training !== training) patch.training = training
      if (ui.stageReady !== r.stageReady) patch.stageReady = r.stageReady

      // Training pits: the authority checks the position itself every tick.
      const pad = r.mode === 'walk' && r.nearby?.startsWith('pad:') ? Number(r.nearby.slice(4)) : -1
      if (pad !== lastPad) {
        if (pad >= 0) actions.enterPad(pad)
        else actions.leavePad()
        lastPad = pad
      }

      if (r.mode === 'throw') {
        if (ui.throwStair !== r.throwStair) patch.throwStair = r.throwStair
        if (ui.throwEarned !== r.throwEarned) patch.throwEarned = r.throwEarned
        if (ui.throwWins !== r.throwWins) patch.throwWins = r.throwWins
        if (ui.throwZone !== r.throwZone) patch.throwZone = r.throwZone
        if (r.throwZone !== lastZone) {
          lastZone = r.throwZone
          // The throw HUD pops the new stage's name in; this is its sound.
          if (lastZone > 0) sfx.zone()
        }
      } else {
        lastZone = 0
      }

      if (r.throwResult && !handlingResult) {
        handlingResult = true
        patch.result = { ...r.throwResult }
        // The bottle has shattered: the Wins the server already paid show now.
        getGame().holdWins(0)
        resultTimer = setTimeout(() => {
          useUi.setState({ result: null })
          if (r.throwResult?.best) r.cheer = 1.8
          r.throwResult = null
          r.mode = 'walk'
          handlingResult = false
          // Auto throw: go again if it's on and you're still on the platform.
          const profile = getGame().profile
          if (profile.settings.autoThrow && canAutoThrow(profile) && r.nearby === 'launch') {
            setTimeout(requestThrow, 350)
          }
        }, RESULT_MS)
      }

      if (Object.keys(patch).length > 0) useUi.setState(patch)
    }, SYNC_MS)

    return () => {
      clearInterval(id)
      clearTimeout(resultTimer)
    }
  }, [])

  useEffect(() => {
    const apply = (s) => {
      setMuted(!s.soundOn)
      setMusic(s.musicOn)
    }
    apply(useUi.getState())
    return useUi.subscribe(apply)
  }, [])

  return null
}

export default RuntimeSync
