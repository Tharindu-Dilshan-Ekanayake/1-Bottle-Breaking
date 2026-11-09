import { useRef } from 'react'

import { runtime } from '../game/runtime'
import { useUi } from '../game/stores/ui'
import { useIsTouch } from './device'
import { ChunkyButton } from './hud/parts'
import { GRADIENTS } from './hud/style'
import StrokeText from './StrokeText'

/**
 * Virtual joystick (bottom-left) + jump button (bottom-right). Both write straight
 * into `runtime`, which the player controller reads every frame. Camera look is a
 * one-finger drag anywhere else on the screen (handled by CameraRig).
 *
 * Sizes and positions come from the --joy / --jump / --touch-* CSS variables
 * (index.css), so they fit phones held either way. Hidden while a panel or the hatch
 * is up, so they never sit on top of one.
 */
export function TouchControls() {
  const touch = useIsTouch()
  const mode = useUi((s) => s.mode)
  const covered = useUi((s) => s.panel !== null || s.hatching !== null)
  const knob = useRef(null)
  const origin = useRef(null)

  if (!touch || mode !== 'walk' || covered) return null

  const move = (e) => {
    if (!origin.current) return
    const { x, y, radius } = origin.current
    let dx = e.clientX - x
    let dy = e.clientY - y
    const len = Math.hypot(dx, dy)
    if (len > radius) {
      dx = (dx / len) * radius
      dy = (dy / len) * radius
    }
    runtime.joystick.x = dx / radius
    runtime.joystick.y = dy / radius
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`
  }

  const end = () => {
    origin.current = null
    runtime.joystick.x = 0
    runtime.joystick.y = 0
    if (knob.current) knob.current.style.transform = 'translate(0px, 0px)'
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div
        data-control="joystick"
        className="pointer-events-auto absolute grid touch-none place-items-center rounded-full border-[4px] border-[#111] bg-black/30"
        style={{ left: 'var(--touch-side)', bottom: 'var(--touch-bottom)', width: 'var(--joy)', height: 'var(--joy)' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const r = e.currentTarget.getBoundingClientRect()
          // The knob travels about a third of the pad's width from the centre.
          origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, radius: r.width * 0.36 }
          move(e)
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div
          ref={knob}
          className="rounded-full border-[4px] border-[#111] shadow-lg"
          style={{ width: 'calc(var(--joy) * 0.42)', height: 'calc(var(--joy) * 0.42)', background: 'linear-gradient(180deg, #ffffff 0%, #d6dde8 100%)' }}
        />
      </div>
      <div
        data-control="jump"
        className="pointer-events-auto absolute touch-none"
        style={{ right: 'var(--touch-side)', bottom: 'calc(var(--touch-bottom) + var(--joy) * 0.12)' }}
        onPointerDown={() => {
          runtime.jumpQueued = true
        }}
      >
        <ChunkyButton gradient={GRADIENTS.blueButton} title="Jump" radius={60} border={5} style={{ width: 'var(--jump)', height: 'var(--jump)' }}>
          <span style={{ fontSize: 'calc(var(--jump) * 0.26)' }}>
            <StrokeText stroke={5}>JUMP</StrokeText>
          </span>
        </ChunkyButton>
      </div>
    </div>
  )
}

export default TouchControls
