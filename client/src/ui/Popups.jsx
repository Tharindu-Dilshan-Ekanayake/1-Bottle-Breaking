import { useEffect, useRef } from 'react'

import { POOL_SIZE, registerPopupNodes } from '../game/popups'

const SLOTS = Array.from({ length: POOL_SIZE }, (_, i) => i)

/** The fixed pool of popup nodes. Positioned by PopupProjector, never re-rendered. */
export function Popups() {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) registerPopupNodes([...ref.current.children])
  }, [])
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {SLOTS.map((i) => (
        <div key={i} className="popup" />
      ))}
    </div>
  )
}

export default Popups
