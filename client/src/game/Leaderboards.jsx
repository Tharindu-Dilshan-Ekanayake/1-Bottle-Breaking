import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three'
import { create } from 'zustand'

import { fmt } from '@shared/format'
import { leaderboardScores } from '@shared/logic'
import { LEADERBOARD_AREA } from '@shared/world'

import { getSDK } from '../bloxity/sdk'
import { serverHttpUrl } from '../net/connection'
import { getGame, useGame } from '../store/game'
import { GAME_FONT } from './materials'
import { lobbyIsFar } from './runtime'

/*
 * The lobby leaderboards: Total Wins, Rebirths and Longest Throw, top 8 each, on three
 * boards along the back wall. Where the numbers come from, best first:
 *  1. Boxity's leaderboards (Legion.SDK.leaderboard.getTop) - every player of the game;
 *  2. this game server's /api/leaderboards, when connected straight to one (dev);
 *  3. nobody else (offline) - then the board shows just you.
 * Refreshed every minute, outside the frame loop; a board's canvas is redrawn only when
 * its rows change. Each board is one mesh and one 512x512 texture.
 */

const BOARDS = [
  { id: 'wins', title: 'TOTAL WINS', color: '#ffd23f' },
  { id: 'rebirths', title: 'REBIRTHS', color: '#5ee0ff' },
  { id: 'stairs', title: 'LONGEST THROW', color: '#7dff4a' },
]
const TOP = 8
const REFRESH_MS = 60_000

/** `{ rows: { wins: [{ name, value }] ... }, source }`, written only by refresh(). */
const useBoards = create(() => ({ rows: {}, source: 'none' }))

async function fromBoxity() {
  const board = getSDK()?.leaderboard
  if (typeof board?.getTop !== 'function') return null
  const out = {}
  for (const { id } of BOARDS) {
    const result = await board.getTop(id, { period: 'all', limit: TOP })
    if (!result || !Array.isArray(result.rows)) return null
    out[id] = result.rows.map((r) => ({ name: r.displayName || r.username || 'Player', value: Number(r.score) || 0 }))
  }
  return out
}

async function fromServer() {
  const base = serverHttpUrl()
  if (!base) return null
  const res = await fetch(`${base}/api/leaderboards`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return null
  const body = await res.json()
  const out = {}
  for (const { id } of BOARDS) out[id] = Array.isArray(body[id]) ? body[id].slice(0, TOP).map((r) => ({ name: r.name || 'Player', value: Number(r.value) || 0 })) : []
  return out
}

let refreshing = false
async function refresh() {
  if (refreshing) return
  refreshing = true
  try {
    let rows = null
    let source = 'none'
    try {
      rows = await fromBoxity()
      if (rows) source = 'boxity'
    } catch {
      rows = null
    }
    if (!rows) {
      try {
        rows = await fromServer()
        if (rows) source = 'server'
      } catch {
        rows = null
      }
    }
    useBoards.setState({ rows: rows || {}, source })
  } finally {
    refreshing = false
  }
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

function text(ctx, value, x, y, size, fill, align = 'left') {
  ctx.font = `${size}px ${GAME_FONT}`
  ctx.textAlign = align
  ctx.lineWidth = Math.max(3, size * 0.18)
  ctx.strokeStyle = '#111'
  ctx.strokeText(value, x, y)
  ctx.fillStyle = fill
  ctx.fillText(value, x, y)
}

const MEDALS = ['#ffd23f', '#d6dde8', '#e3955a']

/** Draws one board: header, the top rows with medals, and your own line. */
function drawBoard(ctx, size, board, rows, me, myName) {
  ctx.clearRect(0, 0, size, size)
  roundRect(ctx, 4, 4, size - 8, size - 8, 26)
  const bg = ctx.createLinearGradient(0, 0, 0, size)
  bg.addColorStop(0, '#262c52')
  bg.addColorStop(1, '#14182f')
  ctx.fillStyle = bg
  ctx.fill()
  ctx.lineWidth = 8
  ctx.strokeStyle = board.color
  ctx.stroke()
  // Header band.
  roundRect(ctx, 18, 18, size - 36, 70, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fill()
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  text(ctx, board.title, size / 2, 54, 44, board.color, 'center')

  const top = 104
  const rowH = 40
  if (!rows.length) {
    text(ctx, 'Play online to see', size / 2, top + 120, 30, '#c8d0dc', 'center')
    text(ctx, 'the top players!', size / 2, top + 160, 30, '#c8d0dc', 'center')
  }
  rows.slice(0, TOP).forEach((r, i) => {
    const y = top + i * rowH + rowH / 2
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.fillRect(22, y - rowH / 2 + 2, size - 44, rowH - 4)
    }
    if (i < 3) {
      ctx.beginPath()
      ctx.arc(52, y, 15, 0, Math.PI * 2)
      ctx.fillStyle = MEDALS[i]
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = '#111'
      ctx.stroke()
      ctx.font = `20px ${GAME_FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = '#111'
      ctx.fillText(String(i + 1), 52, y + 1)
    } else {
      text(ctx, String(i + 1), 52, y, 24, '#c8d0dc', 'center')
    }
    let name = r.name
    ctx.font = `26px ${GAME_FONT}`
    while (ctx.measureText(name).width > 270 && name.length > 3) name = `${name.slice(0, -2)}…`
    text(ctx, name, 80, y, 26, '#ffffff')
    text(ctx, fmt(r.value), size - 36, y, 26, board.color, 'right')
  })
  // You.
  const y = size - 50
  roundRect(ctx, 18, y - 26, size - 36, 52, 14)
  ctx.fillStyle = 'rgba(255,210,63,0.16)'
  ctx.fill()
  let name = `YOU (${myName})`
  ctx.font = `26px ${GAME_FONT}`
  while (ctx.measureText(name).width > 300 && name.length > 8) name = `${name.slice(0, -3)}…)`
  text(ctx, name, 36, y, 26, '#ffffff')
  text(ctx, fmt(me), size - 36, y, 28, board.color, 'right')
}

export function Leaderboards() {
  const rows = useBoards((s) => s.rows)
  // A string, not an object: a selector must return the same value for the same state.
  const scoreKey = useGame((s) => {
    const scores = leaderboardScores(s.profile)
    return BOARDS.map((b) => scores[b.id]).join(',')
  })
  const myName = useGame((s) => s.profile.name || 'Player')

  const boards = useMemo(() => {
    const { z, xs, width, height, y, face } = LEADERBOARD_AREA
    const geometry = new PlaneGeometry(width, height)
    return BOARDS.map((board, i) => {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 512
      const texture = new CanvasTexture(canvas)
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = 4
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: texture, alphaTest: 0.5, toneMapped: false }))
      // Left to right as you look at them, whichever way they face.
      mesh.position.set(xs[face < 0 ? xs.length - 1 - i : i], y, z + face * 0.2)
      mesh.rotation.y = face < 0 ? Math.PI : 0
      return { board, canvas, ctx: canvas.getContext('2d'), texture, mesh, drawn: '' }
    })
  }, [])

  // Fetch now and every minute (never from the frame loop).
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // Redraw a board only when what it shows changed; again once the font is in.
  useEffect(() => {
    const draw = (force) => {
      const me = leaderboardScores(getGame().profile)
      for (const b of boards) {
        const list = rows[b.board.id] || []
        const key = `${JSON.stringify(list)}|${me[b.board.id]}|${myName}`
        if (!force && key === b.drawn) continue
        b.drawn = key
        drawBoard(b.ctx, 512, b.board, list, me[b.board.id], myName)
        b.texture.needsUpdate = true
      }
    }
    draw(false)
    let cancelled = false
    document.fonts?.load?.(`26px ${GAME_FONT}`).then(() => !cancelled && draw(true), () => {})
    return () => {
      cancelled = true
    }
  }, [rows, scoreKey, myName, boards])

  useEffect(
    () => () => {
      boards[0].mesh.geometry.dispose()
      for (const b of boards) {
        b.mesh.material.dispose()
        b.texture.dispose()
      }
    },
    [boards],
  )

  useFrame(({ camera }) => {
    const far = lobbyIsFar(camera)
    for (const b of boards) b.mesh.visible = !far
  })

  return boards.map((b) => <primitive key={b.board.id} object={b.mesh} />)
}

export default Leaderboards
