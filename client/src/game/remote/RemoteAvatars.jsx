import { Component, Suspense, useCallback, useEffect, useMemo, useState } from 'react'

import { isRealId } from '../../bloxity/avatarAssets'
import { remotePlayers } from '../../net/remotePlayers'
import { BloxityAvatar } from '../PlayerAvatar'
import { PLAYER_HEIGHT } from '../playerSize'
import { runtime } from '../runtime'
import { createView, remoteViews } from './views'

/** How often the set of mounted avatars is reconsidered (never per frame). */
const PICK_MS = 500
/** A room holds 8: everyone else. */
const MAX_REMOTES = 7
/** Wait this long after someone joins for their outfit before building the default. */
const LOOK_WAIT_MS = 1500

/** Renders `fallback` instead of a child that throws (a broken outfit, a bad asset). */
class Guard extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err) {
    console.warn('[remote] avatar failed; falling back', err)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Does this outfit need anything downloaded beyond the default avatar? */
function needsDownload(look) {
  const equipped = look?.equipped
  if (!equipped) return false
  return Object.entries(equipped).some(([key, id]) => isRealId(id) && !(key === 'skinId' && String(id) === '0'))
}

/**
 * One other player: their real Bloxity avatar, dressed from what the server says they
 * wear, built exactly like yours (PlayerAvatar.jsx) and posed by the RemotePlayers frame
 * loop. Until their outfit has downloaded, the default avatar stands in for them (built
 * at once from the cached base body and skin), so nobody ever shows up as a bare figure.
 * If their outfit can't be built, they wear the default.
 */
function RemoteAvatar({ sessionId, look }) {
  const view = useMemo(() => createView(), [])
  const [ownReady, setOwnReady] = useState(false)
  const onReady = useCallback(() => setOwnReady(true), [])
  const setGroup = useCallback((g) => (view.group = g), [view])
  const setHoldGroup = useCallback((g) => (view.holdGroup = g), [view])

  useEffect(() => {
    remoteViews.set(sessionId, view)
    return () => {
      if (remoteViews.get(sessionId) === view) remoteViews.delete(sessionId)
    }
  }, [sessionId, view])
  // A new outfit can change their proportions: re-measure where the bottle sits.
  useEffect(() => {
    view.backRig = null
  }, [look, view])

  const fallback = (
    <Guard fallback={null}>
      <Suspense fallback={null}>
        <BloxityAvatar poserRef={view.poser} targetHeight={PLAYER_HEIGHT} onReady={onReady} />
      </Suspense>
    </Guard>
  )

  return (
    <>
      <group ref={setGroup} visible={false}>
        <Guard fallback={fallback}>
          <Suspense fallback={null}>
            <BloxityAvatar
              equipped={look?.equipped}
              proportions={look?.proportions}
              poserRef={view.poser}
              targetHeight={PLAYER_HEIGHT}
              onReady={onReady}
            />
          </Suspense>
        </Guard>
      </group>
      {!ownReady && needsDownload(look) && (
        <group ref={setHoldGroup} visible={false}>
          <Guard fallback={null}>
            <Suspense fallback={null}>
              <BloxityAvatar poserRef={view.hold} targetHeight={PLAYER_HEIGHT} />
            </Suspense>
          </Guard>
        </group>
      )}
    </>
  )
}

/**
 * Every other player in your world gets their real avatar (a room holds 8, so at most
 * 7), mounted once and kept while they stay: RemotePlayers hides the ones past the draw
 * distance and strips the far ones down to one draw call. The set is re-checked twice a
 * second, never per frame, so React re-renders only when someone arrives, leaves,
 * changes world or changes outfit.
 */
export function RemoteAvatars() {
  const [shown, setShown] = useState([])

  useEffect(() => {
    const pick = () => {
      const now = performance.now()
      const next = []
      for (const r of remotePlayers.values()) {
        if ((r.world || 1) !== runtime.world || next.length >= MAX_REMOTES) continue
        // Give their outfit a moment to arrive, so it isn't built twice.
        if (!r.lookKey && now - (r.seenAt || 0) < LOOK_WAIT_MS) continue
        next.push(r)
      }
      next.sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
      setShown((prev) => {
        const same = prev.length === next.length && prev.every((p, i) => p.sessionId === next[i].sessionId && p.lookKey === next[i].lookKey)
        return same ? prev : next.map((r) => ({ sessionId: r.sessionId, look: r.look, lookKey: r.lookKey }))
      })
    }
    pick()
    const id = setInterval(pick, PICK_MS)
    return () => clearInterval(id)
  }, [])

  return shown.map((s) => <RemoteAvatar key={s.sessionId} sessionId={s.sessionId} look={s.look} />)
}

export default RemoteAvatars
