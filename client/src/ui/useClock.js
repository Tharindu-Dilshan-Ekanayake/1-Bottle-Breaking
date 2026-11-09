import { useEffect, useState } from 'react'

import { useGame } from '../store/game'

/** A clock that ticks every `ms` (for countdowns). Never runs inside the frame loop. */
export function useNow(ms) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** Today's playtime so far (s): the last figure the authority sent, plus the time since. */
export function usePlaySeconds() {
  const now = useNow(1000)
  const base = useGame((s) => s.profile.playday?.seconds || 0)
  const at = useGame((s) => s.profileAt)
  return base + Math.max(0, (now - at) / 1000)
}
