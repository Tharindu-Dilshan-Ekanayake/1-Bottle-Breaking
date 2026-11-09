import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial, SRGBColorSpace } from 'three'

import { WORLDS } from '@shared/balance'
import { fmt } from '@shared/format'
import { PORTAL, portalTarget, portalX, portalZ } from '@shared/world'

import { useGame } from '../store/game'
import { getDiscGeometry, glowMaterial } from './glow'
import Label from './Label'
import { getGlowTexture } from './materials'
import { lobbyIsFar } from './runtime'

/*
 * The gate between worlds: a swirling surface in the colour of the world it leads to,
 * a glow on the ground in front, and a sign with what it takes. Two draw calls.
 */

const SWIRL_COLOR = { 1: '#4ade80', 2: '#f472b6' }

/** A white spiral on a soft disc (tinted by the material), drawn once. */
function createSwirlTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2
  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  g.addColorStop(0.85, 'rgba(255,255,255,0.18)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineCap = 'round'
  for (let arm = 0; arm < 4; arm += 1) {
    ctx.lineWidth = 7
    ctx.beginPath()
    for (let t = 0; t < 1; t += 0.02) {
      const a = arm * (Math.PI / 2) + t * Math.PI * 2.4
      const r = t * c * 0.95
      ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r)
    }
    ctx.stroke()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.center.set(0.5, 0.5)
  return texture
}

export function Portal({ world }) {
  const target = portalTarget(world)
  const unlocked = useGame((s) => s.profile.worlds?.includes(target))

  const fx = useMemo(() => {
    const map = createSwirlTexture()
    const geometry = new PlaneGeometry(PORTAL.halfWidth * 2, 5.6)
    geometry.rotateY(Math.atan2(PORTAL.nx, PORTAL.nz)) // facing out of the doorway, towards the spawn
    const material = new MeshBasicMaterial({ map, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false })
    const surface = new Mesh(geometry, material)
    surface.position.set(PORTAL.x, 3.3, PORTAL.z)
    surface.renderOrder = 3
    const glow = new Mesh(getDiscGeometry(), glowMaterial(getGlowTexture(), { polygonOffset: true, polygonOffsetFactor: -2 }))
    glow.position.set(portalX(0, 1.4), 0.18, portalZ(0, 1.4))
    // 6 across the doorway, 4 deep.
    glow.scale.set(Math.abs(PORTAL.ax) * 6 + Math.abs(PORTAL.nx) * 4, 1, Math.abs(PORTAL.az) * 6 + Math.abs(PORTAL.nz) * 4)
    glow.renderOrder = 3
    // A glowing orb on each pillar.
    const orbGeometry = new BufferGeometry()
    const half = PORTAL.halfWidth + 0.4
    orbGeometry.setAttribute('position', new BufferAttribute(new Float32Array([portalX(-half), 7.75, portalZ(-half), portalX(half), 7.75, portalZ(half)]), 3))
    const orbs = new Points(orbGeometry, new PointsMaterial({ size: 2.2, map: getGlowTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }))
    orbs.frustumCulled = false
    return { map, surface, glow, orbs }
  }, [])

  useEffect(() => {
    fx.surface.material.color.set(SWIRL_COLOR[target])
    fx.glow.material.color.set(SWIRL_COLOR[target]).multiplyScalar(0.6)
    fx.orbs.material.color.set(SWIRL_COLOR[target])
  }, [target, fx])

  useEffect(
    () => () => {
      fx.map.dispose()
      fx.surface.geometry.dispose()
      fx.surface.material.dispose()
      fx.glow.material.dispose()
      fx.orbs.geometry.dispose()
      fx.orbs.material.dispose()
    },
    [fx],
  )

  useFrame(({ camera }, delta) => {
    const far = lobbyIsFar(camera)
    fx.surface.visible = !far
    fx.glow.visible = !far
    fx.orbs.visible = !far
    if (far) return
    fx.map.rotation -= Math.min(delta, 0.05) * (unlocked ? 1.6 : 0.6)
  })

  const dest = WORLDS[target]
  const need = dest.unlock
  return (
    <>
      <primitive object={fx.surface} />
      <primitive object={fx.glow} />
      <primitive object={fx.orbs} />
      <Label
        position={[PORTAL.x, 10, PORTAL.z]}
        width={6}
        lines={[
          { text: `WORLD ${target}: ${dest.name.toUpperCase()}`, size: 42, color: SWIRL_COLOR[target] },
          unlocked || !need
            ? { text: 'STEP IN TO TRAVEL', size: 30, color: '#ffffff' }
            : { text: `${fmt(need.wins)} WINS + ${need.rebirths} REBIRTHS`, size: 30, color: '#fde047' },
        ]}
      />
    </>
  )
}

export default Portal
