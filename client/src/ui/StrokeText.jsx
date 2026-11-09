import { memo } from 'react'

/**
 * Chunky outlined text in the game's style: a thick black outline with a drop under it
 * and a solid or gradient fill.
 *
 * Two stacked copies: a stroked black one behind, the fill on top. A single element
 * can't do it - `background-clip: text` gradients and `-webkit-text-stroke` fight over
 * the same glyph area, and the stroke eats half of every letter.
 *
 * @param {{ children: React.ReactNode, stroke?: number|string, fill?: string,
 *           gradient?: string, className?: string, style?: object }} props
 *   `stroke` is the outline width (CSS length or px number). `gradient` is any CSS
 *   gradient and wins over `fill`.
 *
 * Memoised: the HUD is full of these, and most re-render with the same text.
 */
export const StrokeText = memo(function StrokeText({ children, stroke = 6, fill = '#ffffff', gradient, className = '', style }) {
  const width = typeof stroke === 'number' ? `${stroke}px` : stroke
  const fillStyle = gradient
    ? { backgroundImage: gradient, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
    : { color: fill }
  return (
    <span className={`pp-text ${className}`} style={style}>
      <span aria-hidden="true" className="pp-text-stroke" style={{ WebkitTextStrokeWidth: width }}>
        {children}
      </span>
      <span className="pp-text-fill" style={fillStyle}>
        {children}
      </span>
    </span>
  )
})

export default StrokeText
