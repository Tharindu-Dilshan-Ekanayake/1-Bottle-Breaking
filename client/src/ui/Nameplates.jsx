import { useEffect, useRef } from 'react'

import { NAMEPLATE_NODES, registerNameplateNodes } from '../game/remote/nameplates'

const SLOTS = Array.from({ length: NAMEPLATE_NODES }, (_, i) => i)

/**
 * The fixed pool of name-tag nodes (each with its chat bubble). Positioned by
 * RemotePlayers, never re-rendered.
 */
export function Nameplates() {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) registerNameplateNodes([...ref.current.children])
  }, [])
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
      {SLOTS.map((i) => (
        <div key={i} className="nameplate">
          <div className="chat-bubble" style={{ display: 'none' }} />
          <span className="nameplate-name" />
        </div>
      ))}
    </div>
  )
}

export default Nameplates
