import { useEffect, useRef, useState } from 'react'

import { useBloxity } from './bloxity/BloxityContext'
import { playerIdFor } from './bloxity/identity'
import { shareLook, startConnection, stopConnection } from './net/connection'

/** Don't hold the game hostage to a slow SDK script: play as a guest after this. */
const SDK_GRACE_MS = 4000

/**
 * Non-visual: owns the connection to the authority for the lifetime of the app.
 *
 * Waits for the Bloxity SDK to settle (or fail) so the save opens under the right
 * identity, then reconnects whenever the player logs in or out - back into the same
 * room, so signing in mid-game never moves you away from the people you were with.
 */
export function GameController() {
  const { status, user, guest, identity, avatar, proportions } = useBloxity()
  const [graceOver, setGraceOver] = useState(false)
  const settled = status === 'ready' || status === 'error' || graceOver
  const playerId = settled ? playerIdFor(user, guest) : null
  const name = identity?.displayName || identity?.username || 'Player'
  const nameRef = useRef(name)
  useEffect(() => {
    nameRef.current = name
  }, [name])
  /** The id the current connection was opened with, to tell a sign-in from a remount. */
  const connectedAs = useRef(null)

  useEffect(() => {
    const id = setTimeout(() => setGraceOver(true), SDK_GRACE_MS)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!playerId) return undefined
    const identityChanged = connectedAs.current !== null && connectedAs.current !== playerId
    connectedAs.current = playerId
    startConnection({ id: playerId, name: nameRef.current }, identityChanged ? { mode: 'rejoin' } : undefined)
    return stopConnection
  }, [playerId])

  // Everyone else draws our character dressed as we are.
  useEffect(() => {
    shareLook(avatar, proportions)
  }, [avatar, proportions])

  return null
}

export default GameController
