import { useEffect } from 'react'

import { useUi } from '../../game/stores/ui'
import Icon from '../Icon'
import StrokeText from '../StrokeText'
import { u } from '../hud/style'

/** The red square X that sits on every panel's top-right corner. */
export function CloseButton({ onClick, style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="pp-btn pointer-events-auto absolute flex items-center justify-center"
      style={{
        width: u(96),
        height: u(96),
        background: 'linear-gradient(180deg, #ff6a5c 0%, #ee2233 55%, #c4101f 100%)',
        border: `${u(5)} solid #111`,
        borderRadius: u(6),
        boxShadow: `inset 0 0 0 ${u(4)} #ffffff, 0 ${u(4)} 0 rgba(0,0,0,0.4)`,
        fontSize: u(78),
        lineHeight: 1,
        ...style,
      }}
    >
      <StrokeText stroke={u(10)}>X</StrokeText>
    </button>
  )
}

/**
 * The modal panel from +1 Kick Field Goal: dark rounded frame, a big outlined title
 * riding the top edge and the red X on the corner. Escape or a click outside closes it.
 * `width` is in reference pixels; `icon` (an Icon name) or `iconNode` sits before the title.
 */
export function Panel({ title, icon, iconNode, width = 920, children }) {
  const close = useUi((s) => s.closePanel)
  // Long titles shrink to stay clear of the close button.
  const titleSize = Math.min(92, (width - 190) / (title.length * 0.62))

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div
      className="pp-font pointer-events-auto absolute inset-0 z-40 flex items-center justify-center"
      // --ad-bottom: room for the ad strip under the popup on narrow screens (services.js).
      style={{ background: 'rgba(0, 0, 0, 0.22)', paddingBottom: 'var(--ad-bottom, 0px)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="pp-panel-in relative flex flex-col items-center" style={{ width: `min(${u(width)}, calc(100vw - ${u(60)} - 16px))` }}>
        <div
          className="relative w-full"
          style={{
            marginTop: u(56),
            padding: `${u(56)} ${u(26)} ${u(26)}`,
            borderRadius: u(14),
            background: 'linear-gradient(180deg, rgba(34, 30, 52, 0.96), rgba(18, 16, 30, 0.96))',
            border: `${u(6)} solid #0b0c0e`,
            boxShadow: `inset 0 0 0 ${u(3)} rgba(255,255,255,0.08), 0 ${u(10)} ${u(30)} rgba(0,0,0,0.35)`,
            maxHeight: `calc(100dvh - ${u(56)} - 24px - var(--ad-bottom, 0px))`,
            overflowY: 'auto',
          }}
        >
          {children}
        </div>
        <div className="absolute flex items-center leading-none" style={{ left: u(icon || iconNode ? 10 : 60), top: u(8 + (92 - titleSize) * 0.6), fontSize: u(titleSize), gap: u(8) }}>
          {icon && <Icon name={icon} size={u(titleSize * 1.4)} style={{ marginTop: u(-titleSize * 0.3) }} />}
          {iconNode}
          <StrokeText stroke={u(titleSize * 0.17)}>{title}</StrokeText>
        </div>
        <CloseButton onClick={close} style={{ right: u(-24), top: u(20) }} />
      </div>
    </div>
  )
}

export default Panel
