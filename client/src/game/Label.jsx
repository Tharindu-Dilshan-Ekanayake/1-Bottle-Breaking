import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { SpriteMaterial } from 'three'

import { createLabelTexture, drawLabel, GAME_FONT } from './materials'

/** Resolves once the game font is usable in canvas (or immediately if it never loads). */
let fontReady = null
function whenFontReady() {
  if (!fontReady) {
    fontReady =
      typeof document !== 'undefined' && document.fonts?.load
        ? document.fonts.load(`48px ${GAME_FONT}`).catch(() => null)
        : Promise.resolve()
  }
  return fontReady
}

/**
 * A camera-facing text sign drawn into a 512x128 canvas texture.
 * Redraws only when its text changes — never per frame.
 *
 * @param {{ position: [number,number,number], lines: {text:string,size:number,color:string}[],
 *           width?: number, visible?: boolean }} props
 */
export function Label({ position, lines, width = 6, visible = true }) {
  const key = JSON.stringify(lines)
  const ref = useRef(null)

  // Fade out when the camera is right on top of it, instead of filling the screen.
  useFrame(({ camera }) => {
    const sprite = ref.current
    if (!sprite || !visible) return
    const d = camera.position.distanceTo(sprite.position)
    const fade = Math.min(1, Math.max(0, (d - width * 0.9) / (width * 0.8)))
    sprite.material.opacity = fade
    sprite.visible = fade > 0.02
  })

  const { texture, material } = useMemo(() => {
    const tex = createLabelTexture(JSON.parse(key))
    const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })
    return { texture: tex, material: mat }
  }, [key])

  // Redraw once the web font has arrived, so labels don't stay in the fallback face.
  useEffect(() => {
    let cancelled = false
    whenFontReady().then(() => {
      if (cancelled) return
      drawLabel(texture.image, JSON.parse(key))
      texture.needsUpdate = true
    })
    return () => {
      cancelled = true
    }
  }, [texture, key])

  useEffect(
    () => () => {
      texture.dispose()
      material.dispose()
    },
    [texture, material],
  )

  return (
    <sprite
      ref={ref}
      position={position}
      scale={[width, width / 4, 1]}
      material={material}
      visible={visible}
    />
  )
}

export default Label
