import { useEffect, useRef } from 'react'

import { useBloxityStore } from './store'

/**
 * A tiny frames-per-second readout, shown while the player has Boxity's show_fps
 * setting on. Counts animation frames itself and writes the number straight into the
 * DOM twice a second: no React re-render per frame, and nothing at all runs while it
 * is off.
 */
export function FpsMeter() {
  const show = useBloxityStore((s) => s.showFps)
  const ref = useRef(null)

  useEffect(() => {
    if (!show) return undefined
    let frames = 0
    let since = performance.now()
    let raf = 0
    const tick = (now) => {
      frames += 1
      if (now - since >= 500) {
        if (ref.current) ref.current.textContent = `${Math.round((frames * 1000) / (now - since))} FPS`
        frames = 0
        since = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [show])

  if (!show) return null
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 4,
        transform: 'translateX(-50%)',
        zIndex: 60,
        pointerEvents: 'none',
        padding: '1px 6px',
        borderRadius: 4,
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        font: '600 11px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      -- FPS
    </div>
  )
}

export default FpsMeter
