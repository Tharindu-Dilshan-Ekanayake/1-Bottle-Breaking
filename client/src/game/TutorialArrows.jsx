import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three'

import { groundHeightAt } from '@shared/world'

import { getGame } from '../store/game'
import { runtime } from './runtime'
import { tutorialStep, tutorialTarget } from './tutorial'

/*
 * The first-time guide in the world: glowing chevrons flowing along the ground from you
 * to where the current step happens, and a big bouncing arrow over it. One instanced
 * mesh plus one sprite; hidden once the guide is done.
 */

const CHEVRONS = 14
const SPACING = 1.4
const _dummy = new Object3D()
const _color = new Color()
const _target = { x: 0, z: 0 }
const GLOW = new Color('#ffd23f')

function canvas(size, draw) {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  draw(c.getContext('2d'), size)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** A chevron pointing up the texture (towards -z once laid flat). */
const chevronTexture = () =>
  canvas(128, (ctx, s) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(255,255,255,1)'
    ctx.lineWidth = 22
    ctx.beginPath()
    ctx.moveTo(s * 0.18, s * 0.72)
    ctx.lineTo(s * 0.5, s * 0.3)
    ctx.lineTo(s * 0.82, s * 0.72)
    ctx.stroke()
  })

/** A fat gold arrow pointing down, outlined. */
const markerTexture = () =>
  canvas(128, (ctx, s) => {
    ctx.beginPath()
    ctx.moveTo(s * 0.32, s * 0.08)
    ctx.lineTo(s * 0.68, s * 0.08)
    ctx.lineTo(s * 0.68, s * 0.46)
    ctx.lineTo(s * 0.9, s * 0.46)
    ctx.lineTo(s * 0.5, s * 0.92)
    ctx.lineTo(s * 0.1, s * 0.46)
    ctx.lineTo(s * 0.32, s * 0.46)
    ctx.closePath()
    ctx.lineJoin = 'round'
    ctx.lineWidth = 10
    ctx.strokeStyle = '#111'
    ctx.stroke()
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#fff6a8')
    g.addColorStop(1, '#ff9c00')
    ctx.fillStyle = g
    ctx.fill()
  })

export function TutorialArrows() {
  const fx = useMemo(() => {
    const geometry = new PlaneGeometry(0.9, 0.9)
    geometry.rotateX(-Math.PI / 2)
    const chevronMap = chevronTexture()
    const chevrons = new InstancedMesh(
      geometry,
      new MeshBasicMaterial({ map: chevronMap, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      CHEVRONS,
    )
    chevrons.frustumCulled = false
    chevrons.renderOrder = 4
    for (let i = 0; i < CHEVRONS; i += 1) chevrons.setColorAt(i, GLOW)
    const markerMap = markerTexture()
    const marker = new Sprite(new SpriteMaterial({ map: markerMap, depthWrite: false, toneMapped: false }))
    marker.scale.set(1.6, 1.6, 1)
    marker.renderOrder = 4
    return { chevrons, chevronMap, marker, markerMap }
  }, [])

  useEffect(
    () => () => {
      fx.chevrons.geometry.dispose()
      fx.chevrons.material.dispose()
      fx.chevronMap.dispose()
      fx.marker.material.dispose()
      fx.markerMap.dispose()
    },
    [fx],
  )

  useFrame(({ clock }) => {
    const profile = getGame().profile
    const step = runtime.mode === 'walk' ? tutorialStep(profile) : 0
    const p = runtime.playerPos
    const has = step > 0 && tutorialTarget(step, profile, p.x, p.z, _target)
    fx.marker.visible = has
    if (!has) {
      fx.chevrons.visible = false
      return
    }
    const t = clock.elapsedTime
    fx.marker.position.set(_target.x, groundHeightAt(_target.x, _target.z) + 3.4 + Math.abs(Math.sin(t * 3)) * 0.6, _target.z)

    const dx = _target.x - p.x
    const dz = _target.z - p.z
    const dist = Math.hypot(dx, dz)
    // Close enough: the arrow overhead says "here".
    if (dist < 2.4) {
      fx.chevrons.visible = false
      return
    }
    fx.chevrons.visible = true
    const ux = dx / dist
    const uz = dz / dist
    const yaw = Math.atan2(-ux, -uz)
    const flow = (t * 2.2) % SPACING
    for (let i = 0; i < CHEVRONS; i += 1) {
      const along = 1.3 + i * SPACING + flow
      const left = dist - 1.2 - along
      // Fade out towards the target and in near you; none past the target.
      const fade = left < 0 ? 0 : Math.min(1, left / 2.5, (along - 1) / 1.2)
      const x = p.x + ux * along
      const z = p.z + uz * along
      _dummy.position.set(x, groundHeightAt(x, z) + 0.07, z)
      _dummy.rotation.set(0, yaw, 0)
      _dummy.scale.setScalar(fade > 0 ? 0.7 + fade * 0.3 : 0.0001)
      _dummy.updateMatrix()
      fx.chevrons.setMatrixAt(i, _dummy.matrix)
      fx.chevrons.setColorAt(i, _color.copy(GLOW).multiplyScalar(fade))
    }
    fx.chevrons.instanceMatrix.needsUpdate = true
    fx.chevrons.instanceColor.needsUpdate = true
  })

  return (
    <>
      <primitive object={fx.chevrons} />
      <primitive object={fx.marker} />
    </>
  )
}

export default TutorialArrows
