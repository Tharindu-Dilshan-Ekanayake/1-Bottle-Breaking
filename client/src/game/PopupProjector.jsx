import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'

import { POPUP_LIFETIME, popupSlots, setPopupLimit } from './popups'
import { PRESETS, useQuality } from './stores/quality'

const _v = new Vector3()

/**
 * Projects the live "+N" popups (plain DOM nodes from the pool) onto the screen.
 * Writes element styles directly — no React state in the loop.
 */
export function PopupProjector() {
  const preset = useQuality((s) => s.preset)

  useEffect(() => {
    setPopupLimit(PRESETS[preset].maxPopups)
  }, [preset])

  useFrame((state, delta) => {
    const { camera, size } = state
    for (let i = 0; i < popupSlots.length; i += 1) {
      const slot = popupSlots[i]
      if (!slot.active || !slot.el) continue
      slot.age += delta
      const a = slot.age / POPUP_LIFETIME
      if (a >= 1) {
        slot.active = false
        slot.el.style.opacity = '0'
        continue
      }
      _v.set(slot.x, slot.y + slot.age * 1.4, slot.z).project(camera)
      if (_v.z > 1) {
        slot.el.style.opacity = '0'
        continue
      }
      const x = (_v.x * 0.5 + 0.5) * size.width + slot.drift * a
      const y = (-_v.y * 0.5 + 0.5) * size.height
      const pop = a < 0.12 ? 0.6 + (a / 0.12) * 0.5 : 1.1 - Math.min(0.1, (a - 0.12) * 0.4)
      slot.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(3)})`
      slot.el.style.opacity = a < 0.7 ? '1' : ((1 - a) / 0.3).toFixed(3)
    }
  })

  return null
}

export default PopupProjector
