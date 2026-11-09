import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { CanvasTexture, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace } from 'three'

import { BOTTLES } from '@shared/balance'
import { fmt } from '@shared/format'
import { PEDESTALS } from '@shared/world'

import { useGame } from '../store/game'
import { EQUIPPED, LOCKED, NEXT, NEXT_AFFORDABLE, OWNED, shopKey } from './shopState'
import { GAME_FONT } from './materials'
import { lobbyIsFar } from './runtime'
import { useQuality } from './stores/quality'

/*
 * A details plaque on the front of every shop pedestal: the bottle's name, its Power,
 * and its price - or OWNED / EQUIPPED / LOCKED. All 16 are one instanced mesh reading
 * their cell of one canvas atlas (512 px wide on LOW, 1024 otherwise), and a cell is
 * redrawn only when that bottle's state changes.
 */

const COLS = 4
const ROWS = 4
const PLAQUE_W = 1.3
const PLAQUE_H = 0.65
/** Just proud of the pedestal column's front (west) face: the column is 1.4 wide. */
const PLAQUE_OUT = 0.72
const PLAQUE_Y = 0.62

const _dummy = new Object3D()

const STATUS_COLOR = {
  [EQUIPPED]: '#7dff4a',
  [OWNED]: '#e2e8f0',
  [NEXT]: '#ffb347',
  [NEXT_AFFORDABLE]: '#ffd23f',
  [LOCKED]: '#8b93a7',
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function outlined(ctx, text, x, y, size, fill) {
  ctx.font = `${size}px ${GAME_FONT}`
  ctx.lineWidth = Math.max(2, size * 0.22)
  ctx.strokeStyle = '#111'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
}

/** A small gold trophy, centred on (x, y), `s` tall. */
function trophy(ctx, x, y, s) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s / 10, s / 10)
  ctx.fillStyle = '#ffd23f'
  ctx.strokeStyle = '#111'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(-3.5, -5)
  ctx.lineTo(3.5, -5)
  ctx.lineTo(3, -1)
  ctx.quadraticCurveTo(0, 2.5, -3, -1)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillRect(-0.8, 1, 1.6, 2)
  ctx.fillRect(-2.6, 3, 5.2, 1.8)
  ctx.strokeRect(-2.6, 3, 5.2, 1.8)
  ctx.restore()
}

/** Draws plaque `i` (bottle i in state `st`) into its atlas cell. */
function drawPlaque(ctx, i, st, cw, ch) {
  const b = BOTTLES[i]
  const x0 = (i % COLS) * cw
  const y0 = Math.floor(i / COLS) * ch
  ctx.clearRect(x0, y0, cw, ch)
  const pad = cw * 0.03
  const border = Math.max(2, cw * 0.035)
  roundRect(ctx, x0 + pad, y0 + pad, cw - pad * 2, ch - pad * 2, ch * 0.16)
  ctx.fillStyle = st === LOCKED ? '#2a2e38' : '#1d2030'
  ctx.fill()
  ctx.lineWidth = border
  ctx.strokeStyle = STATUS_COLOR[st]
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const cx = x0 + cw / 2
  // Long names shrink to fit.
  let nameSize = ch * 0.26
  ctx.font = `${nameSize}px ${GAME_FONT}`
  const maxW = cw * 0.86
  const w = ctx.measureText(b.name).width
  if (w > maxW) nameSize *= maxW / w
  outlined(ctx, b.name, cx, y0 + ch * 0.27, nameSize, st === LOCKED ? '#9aa3b5' : b.fill)
  outlined(ctx, `+${fmt(b.power)} Power`, cx, y0 + ch * 0.52, ch * 0.18, '#ffffff')

  const by = y0 + ch * 0.77
  const bs = ch * 0.2
  if (st === EQUIPPED) outlined(ctx, 'EQUIPPED', cx, by, bs, STATUS_COLOR[EQUIPPED])
  else if (st === OWNED) outlined(ctx, 'OWNED', cx, by, bs, STATUS_COLOR[OWNED])
  else {
    const price = fmt(b.cost)
    ctx.font = `${bs}px ${GAME_FONT}`
    const tw = ctx.measureText(price).width
    const icon = bs * 1.05
    trophy(ctx, cx - tw / 2 - icon * 0.35, by, icon)
    outlined(ctx, price, cx + icon * 0.35, by, bs, STATUS_COLOR[st])
  }
}

export function PedestalPlaques() {
  const key = useGame(shopKey)
  const big = useQuality((s) => s.preset !== 'LOW')

  const fx = useMemo(() => {
    const cw = big ? 256 : 128
    const ch = cw / 2
    const canvas = document.createElement('canvas')
    canvas.width = cw * COLS
    canvas.height = ch * ROWS
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4

    const geometry = new PlaneGeometry(PLAQUE_W, PLAQUE_H)
    geometry.rotateY(-Math.PI / 2) // face the walkway (-x)
    const cells = new Float32Array(BOTTLES.length * 2)
    BOTTLES.forEach((_, i) => {
      cells[i * 2] = (i % COLS) / COLS
      cells[i * 2 + 1] = 1 - (Math.floor(i / COLS) + 1) / ROWS
    })
    geometry.setAttribute('aCell', new InstancedBufferAttribute(cells, 2))

    const material = new MeshBasicMaterial({ map: texture, alphaTest: 0.5, toneMapped: false })
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vMapUv * vec2(${(1 / COLS).toFixed(4)}, ${(1 / ROWS).toFixed(4)}) + aCell;\n#endif`)
    }
    material.customProgramCacheKey = () => 'pedestal-plaque'

    const mesh = new InstancedMesh(geometry, material, BOTTLES.length)
    PEDESTALS.forEach((p, i) => {
      _dummy.position.set(p.x - PLAQUE_OUT, PLAQUE_Y, p.z)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    return { mesh, canvas, texture, ctx: canvas.getContext('2d'), cw, ch, drawn: '' }
  }, [big])

  useEffect(
    () => () => {
      fx.mesh.geometry.dispose()
      fx.mesh.material.dispose()
      fx.texture.dispose()
      fx.mesh.dispose()
    },
    [fx],
  )

  // Redraw the cells whose state changed (a purchase, an equip); once more when the
  // game font has loaded.
  useEffect(() => {
    const redraw = (force) => {
      for (let i = 0; i < BOTTLES.length; i += 1) {
        if (!force && fx.drawn.charCodeAt(i) === key.charCodeAt(i)) continue
        drawPlaque(fx.ctx, i, key.charCodeAt(i) - 48, fx.cw, fx.ch)
      }
      fx.drawn = key
      fx.texture.needsUpdate = true
    }
    redraw(false)
    let cancelled = false
    document.fonts?.load?.(`32px ${GAME_FONT}`).then(() => !cancelled && redraw(true), () => {})
    return () => {
      cancelled = true
    }
  }, [key, fx])

  useFrame(({ camera }) => {
    fx.mesh.visible = !lobbyIsFar(camera)
  })

  return <primitive object={fx.mesh} />
}

export default PedestalPlaques

/* ------------------------------------------------------------- Bottle names */

const NAME_COLS = 3
const NAME_ROWS = 6
/** One cell is 2:1; the quad is NAME_W wide. */
const NAME_W = 2.6
const NAME_H = NAME_W / 2
/** The cell's text sits in its lower half, so the quad's centre is raised to put it above the bottle. */
const NAME_Y = 3.75

/** Draws bottle i's cell: its name (coloured, outlined, a tick when equipped), and under it the Wins it costs or "OWNED". */
function drawName(ctx, i, st, cw, ch) {
  const b = BOTTLES[i]
  const x0 = (i % NAME_COLS) * cw
  const y0 = Math.floor(i / NAME_COLS) * ch
  ctx.clearRect(x0, y0, cw, ch)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const tick = st === EQUIPPED
  let size = ch * 0.3
  ctx.font = `${size}px ${GAME_FONT}`
  const maxW = cw * (tick ? 0.78 : 0.94)
  const w = ctx.measureText(b.name).width
  if (w > maxW) size *= maxW / w
  const cx = x0 + cw / 2 + (tick ? ch * 0.13 : 0)
  const ny = y0 + ch * 0.58
  outlined(ctx, b.name, cx, ny, size, st === LOCKED ? '#a3abbb' : b.fill)
  if (tick) {
    // A green tick before the name.
    ctx.font = `${size}px ${GAME_FONT}`
    const tx = cx - ctx.measureText(b.name).width / 2 - ch * 0.17
    ctx.lineCap = 'round'
    ctx.lineWidth = ch * 0.09
    ctx.strokeStyle = '#111'
    ctx.beginPath()
    ctx.moveTo(tx - ch * 0.07, ny)
    ctx.lineTo(tx - ch * 0.015, ny + ch * 0.06)
    ctx.lineTo(tx + ch * 0.08, ny - ch * 0.065)
    ctx.stroke()
    ctx.lineWidth = ch * 0.045
    ctx.strokeStyle = '#7dff4a'
    ctx.stroke()
  }
  // The second line: what it costs in Wins, or that you have it.
  const ly = y0 + ch * 0.84
  const ls = ch * 0.23
  if (st === EQUIPPED) outlined(ctx, 'EQUIPPED', cx, ly, ls, STATUS_COLOR[EQUIPPED])
  else if (st === OWNED) outlined(ctx, 'OWNED', cx, ly, ls, STATUS_COLOR[OWNED])
  else {
    const price = `${fmt(b.cost)} WINS`
    ctx.font = `${ls}px ${GAME_FONT}`
    const tw = ctx.measureText(price).width
    const icon = ls * 1.1
    const left = x0 + cw / 2 - (tw + icon * 0.8) / 2
    trophy(ctx, left + icon * 0.4, ly, icon)
    ctx.textAlign = 'left'
    outlined(ctx, price, left + icon * 0.9, ly, ls, STATUS_COLOR[st])
    ctx.textAlign = 'center'
  }
}

/**
 * Each bottle's name floating above it, always facing the camera. One instanced mesh:
 * the vertex shader turns every quad to the camera around its own centre (instanced
 * billboards), and each reads its cell of one 512x512 atlas.
 */
export function ShopNames() {
  const key = useGame(shopKey)
  const big = useQuality((s) => s.preset !== 'LOW')

  const fx = useMemo(() => {
    const cw = big ? 340 : 170
    const ch = cw / 2
    const canvas = document.createElement('canvas')
    canvas.width = cw * NAME_COLS
    canvas.height = ch * NAME_ROWS
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace

    const geometry = new PlaneGeometry(1, 1)
    const cells = new Float32Array(BOTTLES.length * 2)
    BOTTLES.forEach((_, i) => {
      cells[i * 2] = (i % NAME_COLS) / NAME_COLS
      cells[i * 2 + 1] = 1 - (Math.floor(i / NAME_COLS) + 1) / NAME_ROWS
    })
    geometry.setAttribute('aCell', new InstancedBufferAttribute(cells, 2))

    const material = new MeshBasicMaterial({ map: texture, alphaTest: 0.4, toneMapped: false })
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vMapUv * vec2(${(1 / NAME_COLS).toFixed(4)}, ${(1 / NAME_ROWS).toFixed(4)}) + aCell;\n#endif`)
        .replace(
          '#include <project_vertex>',
          // Billboard: the instance's centre in view space, the quad laid out flat on screen.
          `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 bbScale = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  mvPosition.xy += position.xy * bbScale;
  gl_Position = projectionMatrix * mvPosition;`,
        )
    }
    material.customProgramCacheKey = () => 'shop-names'

    const mesh = new InstancedMesh(geometry, material, BOTTLES.length)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    PEDESTALS.forEach((p, i) => {
      _dummy.position.set(p.x, NAME_Y, p.z)
      _dummy.scale.set(NAME_W, NAME_H, 1)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    return { mesh, texture, ctx: canvas.getContext('2d'), cw, ch, drawn: '' }
  }, [big])

  useEffect(
    () => () => {
      fx.mesh.geometry.dispose()
      fx.mesh.material.dispose()
      fx.texture.dispose()
      fx.mesh.dispose()
    },
    [fx],
  )

  useEffect(() => {
    const redraw = (force) => {
      for (let i = 0; i < BOTTLES.length; i += 1) {
        if (!force && fx.drawn.charCodeAt(i) === key.charCodeAt(i)) continue
        drawName(fx.ctx, i, key.charCodeAt(i) - 48, fx.cw, fx.ch)
      }
      fx.drawn = key
      fx.texture.needsUpdate = true
    }
    redraw(false)
    let cancelled = false
    document.fonts?.load?.(`32px ${GAME_FONT}`).then(() => !cancelled && redraw(true), () => {})
    return () => {
      cancelled = true
    }
  }, [key, fx])

  useFrame(({ camera }) => {
    fx.mesh.visible = !lobbyIsFar(camera)
  })

  return <primitive object={fx.mesh} />
}
