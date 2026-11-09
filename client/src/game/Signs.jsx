import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { CanvasTexture, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace } from 'three'

import { GAME_FONT } from './materials'
import { lobbyIsFar } from './runtime'
import { SIGN_ASPECT, SIGN_TEXTS, signsFor } from './signLayout'

/*
 * The lobby's signs - TRAINING, BOTTLES, PETS & EGGS, LEADERBOARDS, and the portal's
 * WORLD n - as one instanced mesh reading cells of one 512x512 sign texture (a 64 px
 * tall row per text). Drawn once, and again when the game font arrives.
 */

const ROWS = 8
const ROTATION = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }
const _dummy = new Object3D()

function drawSigns(ctx, size) {
  const h = size / ROWS
  ctx.clearRect(0, 0, size, size)
  SIGN_TEXTS.forEach((text, i) => {
    const y0 = i * h
    const pad = 3
    // A navy panel with a gold rim and a lighter top edge.
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h)
    g.addColorStop(0, '#34407a')
    g.addColorStop(1, '#1b2147')
    ctx.fillStyle = g
    ctx.strokeStyle = '#ffd23f'
    ctx.lineWidth = 4
    const r = 12
    ctx.beginPath()
    ctx.moveTo(pad + r, y0 + pad)
    ctx.arcTo(size - pad, y0 + pad, size - pad, y0 + h - pad, r)
    ctx.arcTo(size - pad, y0 + h - pad, pad, y0 + h - pad, r)
    ctx.arcTo(pad, y0 + h - pad, pad, y0 + pad, r)
    ctx.arcTo(pad, y0 + pad, size - pad, y0 + pad, r)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.14)'
    ctx.fillRect(pad + 8, y0 + pad + 4, size - pad * 2 - 16, 4)
    // The words: big, outlined, a gold gradient.
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    let font = h * 0.62
    ctx.font = `${font}px ${GAME_FONT}`
    const w = ctx.measureText(text).width
    if (w > size * 0.86) font *= (size * 0.86) / w
    ctx.font = `${font}px ${GAME_FONT}`
    ctx.lineWidth = font * 0.2
    ctx.strokeStyle = '#111'
    ctx.strokeText(text, size / 2, y0 + h * 0.54)
    const tg = ctx.createLinearGradient(0, y0 + h * 0.25, 0, y0 + h * 0.8)
    tg.addColorStop(0, '#fff6a8')
    tg.addColorStop(1, '#ffb21e')
    ctx.fillStyle = tg
    ctx.fillText(text, size / 2, y0 + h * 0.54)
  })
}

export function Signs({ world }) {
  const fx = useMemo(() => {
    const size = 512
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    drawSigns(ctx, size)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4

    const signs = signsFor(world)
    const geometry = new PlaneGeometry(1, 1)
    const cells = new Float32Array(signs.length)
    signs.forEach((sign, i) => {
      cells[i] = 1 - (SIGN_TEXTS.indexOf(sign.text) + 1) / ROWS
    })
    geometry.setAttribute('aRow', new InstancedBufferAttribute(cells, 1))
    const material = new MeshBasicMaterial({ map: texture, alphaTest: 0.5, toneMapped: false })
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRow;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vec2(vMapUv.x, vMapUv.y * ${(1 / ROWS).toFixed(4)} + aRow);\n#endif`)
    }
    material.customProgramCacheKey = () => 'lobby-signs'

    const mesh = new InstancedMesh(geometry, material, signs.length)
    signs.forEach((sign, i) => {
      _dummy.position.set(sign.x, sign.y, sign.z)
      _dummy.rotation.set(0, ROTATION[sign.face], 0)
      _dummy.scale.set(sign.w, sign.w / SIGN_ASPECT, 1)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    return { mesh, texture, ctx, size }
  }, [world])

  // Redraw once the game font has loaded (the first draw may be in the fallback face).
  useEffect(() => {
    let cancelled = false
    document.fonts?.load?.(`40px ${GAME_FONT}`).then(
      () => {
        if (cancelled) return
        drawSigns(fx.ctx, fx.size)
        fx.texture.needsUpdate = true
      },
      () => {},
    )
    return () => {
      cancelled = true
      fx.mesh.geometry.dispose()
      fx.mesh.material.dispose()
      fx.texture.dispose()
      fx.mesh.dispose()
    }
  }, [fx])

  useFrame(({ camera }) => {
    fx.mesh.visible = !lobbyIsFar(camera)
  })

  return <primitive object={fx.mesh} />
}

export default Signs
