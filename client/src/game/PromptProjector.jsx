import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'

import { promptAnchor } from './promptAnchor'

const _v = new Vector3()

/** Moves the proximity prompt's DOM node over its world point, every frame. */
export function PromptProjector() {
  const size = useThree((s) => s.size)
  useFrame(({ camera }) => {
    const el = promptAnchor.el
    if (!el || !promptAnchor.active) return
    _v.set(promptAnchor.x, promptAnchor.y, promptAnchor.z).project(camera)
    if (_v.z > 1) {
      if (el.style.opacity !== '0') el.style.opacity = '0'
      return
    }
    // Kept inside the screen edges, so it never hangs off a phone in portrait.
    const half = el.offsetWidth / 2
    const x = Math.min(size.width - half - 8, Math.max(half + 8, (_v.x * 0.5 + 0.5) * size.width))
    const y = Math.max(el.offsetHeight + Math.min(130, size.height * 0.2), (-_v.y * 0.5 + 0.5) * size.height)
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`
    if (el.style.opacity !== '1') el.style.opacity = '1'
  })
  return null
}

export default PromptProjector
