import { memo } from 'react'

import { iconUrl } from './kfgIcons'

/**
 * An icon from the shared SVG set (kfgIcons.js, from +1 Kick Field Goal), as an <img> so
 * repeated icons share one decoded image and never clash over gradient ids.
 */
export const Icon = memo(function Icon({ name, size = '1em', className = '', style }) {
  const src = iconUrl(name)
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={`pointer-events-none inline-block select-none ${className}`}
      style={{ width: size, height: size, ...style }}
    />
  )
})

export default Icon
