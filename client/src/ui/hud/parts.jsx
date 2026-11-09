import { fmt } from '@shared/format'

import Icon from '../Icon'
import StrokeText from '../StrokeText'
import { GRADIENTS, u } from './style'

/*
 * The HUD's building blocks, from +1 Kick Field Goal (same author): the chunky button,
 * the price tag and the attention badge.
 */

/** Red circular "!" attention badge (or a short text, like a percentage). */
export function AlertBadge({ size = 44, style, children = '!' }) {
  return (
    <span
      className="pointer-events-none absolute flex items-center justify-center rounded-full"
      style={{
        minWidth: u(size),
        height: u(size),
        padding: `0 ${u(children === '!' ? 0 : size * 0.2)}`,
        background: 'radial-gradient(circle at 35% 30%, #ff7a7a, #ee1b2e 60%, #b80f1f)',
        border: `${u(3.5)} solid #fff`,
        boxShadow: `0 0 0 ${u(2.5)} #111`,
        fontSize: u(size * (children === '!' ? 0.62 : 0.45)),
        ...style,
      }}
    >
      <StrokeText stroke={u(4)}>{children}</StrokeText>
    </span>
  )
}

/** A price in Wins: the trophy and the amount, gold - or red while you can't afford it. */
export function Price({ amount, size = 34, afford = true, className = '', style }) {
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: u(size * 0.12), fontSize: u(size), lineHeight: 1, ...style }}>
      <Icon name="trophy" size={u(size * 1.1)} />
      <StrokeText stroke={u(size * 0.24)} gradient={afford ? GRADIENTS.gold : GRADIENTS.priceShort}>
        {fmt(amount)}
      </StrokeText>
    </span>
  )
}

/**
 * The standard chunky button: gradient face with a glossy top, black outline, and a dark
 * lip it presses down into (see .pp-chunky). Children are laid out centred.
 */
export function ChunkyButton({ onClick, gradient = GRADIENTS.goldButton, className = '', style, children, disabled, title, radius = 14, border = 4 }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`pp-btn pp-chunky pointer-events-auto relative flex items-center justify-center ${className}`}
      style={{
        background: gradient,
        borderRadius: u(radius),
        border: `${u(border)} solid #111`,
        ...style,
      }}
    >
      <span className="pp-gloss" style={{ borderRadius: `${u(radius * 0.7)} ${u(radius * 0.7)} ${u(radius * 0.45)} ${u(radius * 0.45)}` }} />
      {children}
    </button>
  )
}
