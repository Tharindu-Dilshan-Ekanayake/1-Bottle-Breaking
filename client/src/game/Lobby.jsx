import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, PlaneGeometry, Sphere, Vector3 } from 'three'

import { BOTTLES, EGGS, PADS } from '@shared/balance'
import { fmt } from '@shared/format'
import {
  EGG_AREA,
  EGG_STANDS,
  eggStandsFor,
  LAUNCH_ARCH,
  LEADERBOARD_AREA,
  PORTAL,
  portalX,
  portalZ,
  LAUNCH,
  PAD_HEIGHT,
  padCenterZ,
  PEDESTALS,
  PIT,
  PIT_ARCH,
  SHOP_AREA,
} from '@shared/world'

import { useGame } from '../store/game'
import { PadAura, ShopAura } from './Auras'
import { shopBursts, BURST_SECONDS } from './shopState'
import Eggs from './Eggs'
import Leaderboards from './Leaderboards'
import Portal from './Portal'
import { SIGN_ASPECT, signsFor } from './signLayout'
import Signs from './Signs'
import { PedestalPlaques, ShopNames } from './ShopDetails'
import { useUi } from './stores/ui'
import Label from './Label'
import { getDiscGeometry, glowMaterial } from './glow'
import {
  bottleFamilyId,
  createGelLayout,
  gelBallAt,
  gelColor,
  getBlockMaterial,
  getBottleFamily,
  getBottlePartsMaterial,
  getBottleShellMaterial,
  getGelGeometry,
  getGelMaterial,
  getGlowTexture,
  getStripeTexture,
  getUnitBox,
  setBottleLookAt,
} from './materials'
import { lobbyIsFar } from './runtime'

/**
 * Each world's lobby colours: the same layout, a different place. World 2 (Candy Peaks)
 * is pink grass, mint paths, chocolate walls and lollipop trees. `shopFloor` and
 * `eggFloor` tile the two halves of the east side so each reads as its own place.
 */
const PALETTES = {
  1: {
    grass: '#5fd84a',
    grassDark: '#4fc23f',
    path: '#f5e6bd',
    brick: '#c98f5a',
    brickDark: '#b07a47',
    brickLight: '#e9c9a0',
    white: '#f4f4f5',
    trunk: '#8b5a2b',
    leaf: '#3cc23a',
    leafLight: '#59d94a',
    leafAlt: '#3cc23a',
    shopWall: '#fbcfe8',
    shopFloor: '#fde2ee',
    eggFloor: '#fff1bf',
    hedge: '#36b83a',
    awning: ['#f472b6', '#ffffff'],
    launch: '#ff6b6b',
    spot: '#ffa0a0',
    arch: '#ff9f43',
    archCap: '#ffd43b',
    // The portal here leads to Candy Peaks.
    portal: '#d946ef',
    portalCap: '#fde047',
  },
  2: {
    grass: '#ffb3dc',
    grassDark: '#f799c9',
    path: '#bff5e3',
    brick: '#7a4a32',
    brickDark: '#5e3824',
    brickLight: '#f7d9c4',
    white: '#fff5fb',
    trunk: '#ffffff',
    leaf: '#ff6fae',
    leafLight: '#ffd1e6',
    leafAlt: '#5eead4',
    shopWall: '#c4b5fd',
    shopFloor: '#e7e0ff',
    eggFloor: '#ccf6e7',
    hedge: '#ff8cc0',
    awning: ['#5eead4', '#fff5fb'],
    launch: '#a78bfa',
    spot: '#d8ccff',
    arch: '#f472b6',
    archCap: '#fef08a',
    // The portal here leads back to Brick Meadows.
    portal: '#22c55e',
    portalCap: '#facc15',
  },
}

const ARCH_X = PIT_ARCH.x
const ARCH_OUT = PIT_ARCH.out

const tint = (hex, amount) => new Color(hex).lerp(new Color(amount > 0 ? '#ffffff' : '#000000'), Math.abs(amount)).getStyle()

/** Builds every static lobby block for `world`: [cx, cy, cz, sx, sy, sz, color]. */
function buildLobbyBlocks(world = 1) {
  const C = PALETTES[world] || PALETTES[1]
  const b = []
  const box = (cx, cy, cz, sx, sy, sz, color) => b.push([cx, cy, cz, sx, sy, sz, color])
  /** A block from minY up to topY. */
  const column = (minX, maxX, minZ, maxZ, topY, color, minY = -6) =>
    box((minX + maxX) / 2, (minY + topY) / 2, (minZ + maxZ) / 2, maxX - minX, topY - minY, maxZ - minZ, color)

  // --- Ground: one slab east of the pits, strips between them ---------------------
  column(PIT.topX, 30, -24, 24, 0, C.grass)
  const edges = [-24]
  PADS.forEach((_, i) => edges.push(padCenterZ(i) - PIT.halfWidth, padCenterZ(i) + PIT.halfWidth))
  edges.push(24)
  for (let e = 0; e < edges.length; e += 2) column(-30, PIT.topX, edges[e], edges[e + 1], 0, C.grass)

  // --- Training pits: a staircase of coloured steps down to the floor -------------
  PADS.forEach((pad, i) => {
    const z = padCenterZ(i)
    const minZ = z - PIT.halfWidth
    const maxZ = z + PIT.halfWidth
    for (let k = 0; k < PIT.stepCount; k += 1) {
      const x1 = PIT.topX - k * PIT.stepDepth
      const x0 = x1 - PIT.stepDepth
      const top = -(k + 1) * PIT.stepDrop
      column(x0, x1, minZ, maxZ, top, tint(pad.color, k % 2 ? 0.55 : 0.38))
      // White nosing along the front edge of every tread.
      box(x0 + 0.1, top + 0.01, z, 0.24, 0.06, PIT.halfWidth * 2 - 0.5, C.white)
    }
    const floorFrom = PIT.topX - PIT.stepCount * PIT.stepDepth
    const floorTop = -(PIT.stepCount + 1) * PIT.stepDrop
    column(PIT.floorX, floorFrom, minZ, maxZ, floorTop, tint(pad.color, -0.15))
    // Brick walls down both sides of the pit, flush with the ground, with a light coping.
    for (const wz of [minZ + 0.11, maxZ - 0.11]) {
      box((PIT.floorX + PIT.topX) / 2, floorTop / 2, wz, PIT.topX - PIT.floorX, -floorTop, 0.22, C.brick)
      // Stops 3 cm short of each end, so it never shares a face with the curb beside it.
      box((PIT.floorX + PIT.topX) / 2, 0.02, wz, PIT.topX - PIT.floorX - 0.06, 0.06, 0.3, C.brickLight)
    }
    // An arch over the mouth of the pit, in the pit's colour.
    for (const az of [minZ - ARCH_OUT, maxZ + ARCH_OUT]) {
      box(ARCH_X, 1.7, az, 0.55, 3.4, 0.55, pad.color)
      box(ARCH_X, 3.5, az, 0.75, 0.3, 0.75, C.white)
    }
    box(ARCH_X, 3.55, z, 0.5, 0.45, (PIT.halfWidth + ARCH_OUT) * 2 + 0.3, pad.color)
    box(ARCH_X, 3.82, z, 0.6, 0.1, (PIT.halfWidth + ARCH_OUT) * 2 + 0.5, C.white)
    // Coloured curbs along both sides of the pit.
    box((PIT.floorX + PIT.topX) / 2, 0.2, minZ - 0.18, PIT.topX - PIT.floorX, 0.4, 0.36, pad.color)
    box((PIT.floorX + PIT.topX) / 2, 0.2, maxZ + 0.18, PIT.topX - PIT.floorX, 0.4, 0.36, pad.color)
    // Start plate: white frame, coloured inset, a stripe at the lip.
    const plateX = PIT.topX + PIT.plateDepth / 2
    box(plateX, PAD_HEIGHT / 2, z, PIT.plateDepth, PAD_HEIGHT, PIT.halfWidth * 2, C.white)
    box(plateX + 0.1, PAD_HEIGHT / 2 + 0.01, z, PIT.plateDepth - 0.8, PAD_HEIGHT, PIT.halfWidth * 2 - 0.7, tint(pad.color, 0.25))
    box(PIT.topX + 0.2, PAD_HEIGHT / 2 + 0.02, z, 0.3, PAD_HEIGHT, PIT.halfWidth * 2 - 0.3, '#fde047')
    // Blocky arrows on the plate pointing down into the pit: where the bottle goes.
    for (const [ax, shade] of [[-17.0, 0.5], [-16.1, 0.65], [-15.2, 0.8]]) {
      for (let k = 0; k < 3; k += 1) {
        for (const side of k === 0 ? [0] : [-1, 1]) {
          box(ax + k * 0.3, PAD_HEIGHT + 0.03, z + side * k * 0.3, 0.3, 0.06, 0.3, tint(pad.color, shade))
        }
      }
    }
    // The target on the pit floor: a gold frame round the pad's colour.
    const targetX = (PIT.floorX + floorFrom) / 2
    box(targetX, floorTop + 0.03, z, floorFrom - PIT.floorX - 0.5, 0.06, PIT.halfWidth * 2 - 0.7, '#ffd23f')
    box(targetX, floorTop + 0.045, z, floorFrom - PIT.floorX - 1.1, 0.06, PIT.halfWidth * 2 - 1.3, tint(pad.color, 0.35))
    // Lamps on the arch: a bright cap on each post and three gems along the beam.
    for (const az of [minZ - ARCH_OUT, maxZ + ARCH_OUT]) {
      box(ARCH_X, 3.95, az, 0.42, 0.42, 0.42, '#fff3b0')
    }
    for (const dz of [-1.6, 0, 1.6]) box(ARCH_X, 4.1, z + dz, 0.4, 0.4, 0.4, tint(pad.color, dz === 0 ? 0.7 : 0.35))
  })

  // --- Boundary walls -------------------------------------------------------------
  for (const side of [-1, 1]) {
    box(side * 32, 3, 2, 4, 10, 52, C.brick)
    box(side * 32, 10, 2, 4, 4, 52, C.brickDark)
    box(side * 32, 12.25, 2, 4.4, 0.5, 52.4, C.grassDark)
  }
  box(0, 3, 26, 68, 10, 4, C.brick)
  box(0, 10, 26, 68, 4, 4, C.brickDark)
  box(0, 12.25, 26, 68.4, 0.5, 4.4, C.grassDark)

  // North rim either side of the stair mouth (and of the wide throw platform).
  {
    const from = LAUNCH.w / 2 + 0.2
    box(-(from + 30) / 2, 0.4, -23.6, 30 - from, 0.8, 0.8, C.white)
    box((from + 30) / 2, 0.4, -23.6, 30 - from, 0.8, 0.8, C.white)
  }

  // Paths: the main one from the stage gate back to the leaderboards; across the lobby
  // from the training side to the east wall (it splits the shop from the eggs); and one
  // along the training pits up to the portal.
  box(0, -0.04, 1.75, 4.5, 0.14, 38.5, C.path)
  box(8.9, -0.04, 0, 41.8, 0.14, 4, C.path)
  box(-13.2, -0.04, 3, 2.4, 0.14, 40, C.path)

  // --- The east side: the shop's floor (north) and the eggs' floor (south) ----------
  // Each is a tiled floor with a white curb on its open sides; they stop 5 cm short of
  // the path, so no two floors ever share a top face, and every curb reaches 3 cm past
  // the floor's edges, so no curb shares a side face with it.
  {
    const x0 = SHOP_AREA.minX
    const x1 = 29.6
    const shopZ0 = -23.15
    const shopZ1 = -2.05
    box((x0 + x1) / 2, -0.035, (shopZ0 + shopZ1) / 2, x1 - x0, 0.13, shopZ1 - shopZ0, C.shopFloor)
    box(x0 + 0.08, 0.06, (shopZ0 + shopZ1) / 2, 0.26, 0.12, shopZ1 - shopZ0 + 0.06, C.white)
    box((x0 + 0.21 + x1 + 0.03) / 2, 0.06, shopZ1 - 0.095, x1 + 0.03 - x0 - 0.21, 0.12, 0.25, C.white)
    const eggZ0 = EGG_AREA.minZ
    const eggZ1 = EGG_AREA.maxZ
    box((x0 + x1) / 2, -0.035, (eggZ0 + eggZ1) / 2, x1 - x0, 0.13, eggZ1 - eggZ0, C.eggFloor)
    box(x0 + 0.08, 0.06, (eggZ0 + eggZ1) / 2, 0.26, 0.12, eggZ1 - eggZ0 + 0.06, C.white)
    box((x0 + 0.21 + x1 + 0.03) / 2, 0.06, eggZ0 + 0.095, x1 + 0.03 - x0 - 0.21, 0.12, 0.25, C.white)
    // The shop's back: pink panelling on the east wall under a striped awning.
    box(29.8, 2.75, (shopZ0 + shopZ1) / 2, 0.4, 5.5, shopZ1 - shopZ0, C.shopWall)
    const segments = 6
    const seg = (shopZ1 - shopZ0) / segments
    for (let i = 0; i < segments; i += 1) box(28, 5.3, shopZ0 + seg * (i + 0.5), 3.2, 0.5, seg, C.awning[i % 2])
    // The egg garden's back: a hedge along the east wall.
    box(29.1, 0.65, (eggZ0 + eggZ1) / 2, 1.1, 1.3, eggZ1 - eggZ0 - 0.4, C.hedge)
  }

  // --- Throw platform and its arch ------------------------------------------------
  box(LAUNCH.x, LAUNCH.h / 2, LAUNCH.z, LAUNCH.w, LAUNCH.h, LAUNCH.d, C.white)
  box(LAUNCH.x, LAUNCH.h / 2 + 0.01, LAUNCH.z, LAUNCH.w - 1.4, LAUNCH.h, LAUNCH.d - 1.4, C.launch)
  // Eight standing spots along the front: room for a full lobby to throw side by side.
  for (let i = 0; i < 8; i += 1) {
    box(LAUNCH.x - 6.3 + i * 1.8, LAUNCH.h / 2 + 0.02, LAUNCH.z + 1.2, 1.2, LAUNCH.h, 1.2, C.spot)
  }
  const archZ = LAUNCH_ARCH.z
  for (const side of [-1, 1]) {
    box(side * LAUNCH_ARCH.x, 3.5, archZ, 1.2, 7, 1.2, C.arch)
    box(side * LAUNCH_ARCH.x, 7.25, archZ, 1.5, 0.5, 1.5, C.archCap)
  }
  box(0, 7.9, archZ, LAUNCH_ARCH.x * 2 + 1.6, 1.1, 1.2, C.arch)

  // --- Bottle shop -------------------------------------------------------------------
  PEDESTALS.forEach((p, i) => {
    const fill = BOTTLES[i].fill
    box(p.x, 0.12, p.z, 1.95, 0.24, 1.95, tint(fill, -0.35))
    box(p.x, 0.62, p.z, 1.4, 0.8, 1.4, C.white)
    box(p.x, 1.02, p.z, 1.6, 0.06, 1.6, tint(fill, 0.55))
    box(p.x, 1.1, p.z, 1.75, 0.12, 1.75, tint(fill, 0.15))
  })

  // --- Egg stands ------------------------------------------------------------------
  const stands = eggStandsFor(world)
  // Spots without a stand in this world get a sweet little pillar instead.
  for (const spot of EGG_STANDS) {
    if (stands.some((e) => e.x === spot.x)) continue
    box(spot.x, 0.6, spot.z, 1.2, 1.2, 1.2, C.brickLight)
    box(spot.x, 1.9, spot.z, 0.5, 1.4, 0.5, C.white)
    box(spot.x, 3, spot.z, 1.6, 1.6, 1.6, C.leaf)
  }
  for (const e of stands) {
    const c = EGGS[e.egg].color
    box(e.x, 0.15, e.z, 3.4, 0.3, 3.4, tint(c, -0.4))
    box(e.x, 0.5, e.z, 2.8, 0.4, 2.8, C.white)
    box(e.x, 0.76, e.z, 3, 0.12, 3, tint(c, 0.05))
    box(e.x, 0.84, e.z, 2.2, 0.06, 2.2, tint(c, 0.55))
    for (const [dx, dz] of [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]]) {
      box(e.x + dx, 0.75, e.z + dz, 0.3, 0.9, 0.3, tint(c, -0.2))
      box(e.x + dx, 1.26, e.z + dz, 0.42, 0.14, 0.42, '#ffd23f')
    }
  }

  // --- The portal to the other world: a grand gate --------------------------------
  {
    const half = PORTAL.halfWidth + 0.4
    /** A box `su` wide across the doorway and `sv` deep, `u` across and `v` out in front. */
    const pbox = (u, y, v, su, sy, sv, color) =>
      box(portalX(u, v), y, portalZ(u, v), Math.abs(PORTAL.ax) * su + Math.abs(PORTAL.nx) * sv, sy, Math.abs(PORTAL.az) * su + Math.abs(PORTAL.nz) * sv, color)
    // A low stepped dais.
    pbox(0, 0.06, 0.3, half * 2 + 2.8, 0.12, 4.2, C.white)
    pbox(0, 0.15, 0.15, half * 2 + 1.7, 0.1, 3.2, C.portalCap)
    for (const side of [-1, 1]) {
      const u = side * half
      pbox(u, 0.65, 0, 1.6, 1, 1.6, C.white) // plinth
      pbox(u, 3.6, 0, 1.1, 5, 1.1, C.portal) // shaft
      for (const y of [1.8, 3, 4.2, 5.4]) pbox(u, y, 0, 1.28, 0.24, 1.28, C.portalCap) // bands
      pbox(u, 6.35, 0, 1.5, 0.5, 1.5, C.white) // capital
      pbox(u, 6.95, 0, 0.8, 0.7, 0.8, C.portalCap) // the orb's seat (the glow sits on it)
    }
    // The crown: a beam carrying the sign, a cornice, a keystone.
    pbox(0, 7, 0, half * 2 - 0.6, 1.6, 1, C.portal)
    pbox(0, 8, 0, half * 2 + 1.2, 0.4, 1.3, C.portalCap)
    pbox(0, 8.55, 0, 1.4, 0.7, 0.9, C.white)
  }

  // --- Sign frames ---------------------------------------------------------------------
  for (const sign of signsFor(world)) {
    if (!sign.frame) continue
    const h = sign.w / SIGN_ASPECT + 0.5
    const w = sign.w + 0.6
    if (sign.frame.x !== undefined) box(sign.frame.x, sign.y, sign.z, sign.frame.d, h, w, C.white)
    else box(sign.x, sign.y, sign.frame.z, w, h, sign.frame.d, C.white)
  }

  // --- Leaderboards: three boards on posts along the back wall -----------------------
  {
    const { z, xs, width: w, height: h, y } = LEADERBOARD_AREA
    for (const x of xs) {
      box(x, y, z, w + 0.4, h + 0.4, 0.3, C.brickDark) // back panel
      for (const side of [-1, 1]) box(x + side * (w / 2 + 0.1), (y + h / 2 + 0.4) / 2, z, 0.35, y + h / 2 + 0.4, 0.45, C.white)
      box(x, y + h / 2 + 0.45, z, w + 0.6, 0.3, 0.7, C.portalCap) // cap (neighbouring caps never touch)
    }
  }

  return b
}

function createBlockMesh(blocks) {
  const mesh = new InstancedMesh(getUnitBox(), getBlockMaterial(), blocks.length)
  const dummy = new Object3D()
  const color = new Color()
  blocks.forEach(([cx, cy, cz, sx, sy, sz, c], i) => {
    dummy.position.set(cx, cy, cz)
    dummy.scale.set(sx, sy, sz)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    mesh.setColorAt(i, color.set(c))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * The whole static lobby - ground, pits, walls, shop, stands, trees, portal - is one
 * draw call. Rebuilt (a few hundred instances, a millisecond) when you change worlds.
 */
function LobbyBlocks({ world }) {
  const mesh = useMemo(() => createBlockMesh(buildLobbyBlocks(world)), [world])
  useEffect(() => () => mesh.dispose(), [mesh])
  return <primitive object={mesh} />
}

const _dummy = new Object3D()

/**
 * The shop bottles, drawn by shape family: per family that has bottles, one shell
 * (glass + liquid, transparent) and one parts (cap, label, trim) InstancedMesh, plus
 * ONE InstancedMesh for the gel balls of all 16 bottles. Geometry and materials are the
 * shared ones from materials.js; only the instance buffers belong to the shop.
 */
function ShopBottles() {
  const shop = useMemo(() => {
    const col = new Color()
    /** A fixed sphere round some pedestals, roomy enough for the bob, hop and squash. */
    const pedestalBound = (slots) => {
      const centre = new Vector3()
      for (const i of slots) centre.x += PEDESTALS[i].x / slots.length
      for (const i of slots) centre.z += PEDESTALS[i].z / slots.length
      centre.y = 2
      let r = 0
      for (const i of slots) r = Math.max(r, Math.hypot(PEDESTALS[i].x - centre.x, PEDESTALS[i].z - centre.z))
      return new Sphere(centre, r + 2.6)
    }

    const slotsByFamily = new Map()
    BOTTLES.forEach((b, i) => {
      const id = bottleFamilyId(b)
      if (!slotsByFamily.has(id)) slotsByFamily.set(id, [])
      slotsByFamily.get(id).push(i)
    })
    // Families with no bottle get no meshes at all.
    const families = []
    for (const [id, slots] of slotsByFamily) {
      const fam = getBottleFamily(id)
      const shell = new InstancedMesh(fam.shell, getBottleShellMaterial(), slots.length)
      const parts = new InstancedMesh(fam.parts, getBottlePartsMaterial(), slots.length)
      slots.forEach((bi, k) => {
        setBottleLookAt(shell, k, BOTTLES[bi])
        parts.setColorAt(k, col.set(BOTTLES[bi].cap))
      })
      parts.instanceColor.needsUpdate = true
      shell.boundingSphere = pedestalBound(slots)
      parts.boundingSphere = shell.boundingSphere.clone()
      shell.castShadow = true
      families.push({ id, shell, parts, slots })
    }

    const layouts = BOTTLES.map((b) => createGelLayout(b))
    const gel = new InstancedMesh(getGelGeometry(), getGelMaterial(), layouts.reduce((n, l) => n + l.count, 0))
    let k = 0
    layouts.forEach((layout, i) => {
      for (let j = 0; j < layout.count; j += 1) {
        gel.setColorAt(k, gelColor(BOTTLES[i], j, col))
        k += 1
      }
    })
    gel.instanceColor.needsUpdate = true
    gel.boundingSphere = pedestalBound(BOTTLES.map((_, i) => i))

    return {
      families,
      gel,
      layouts,
      /** Each bottle's matrix this frame, and its width scale (for the gel ball size). */
      matrices: BOTTLES.map(() => new Matrix4()),
      widths: new Float32Array(BOTTLES.length),
      v: new Vector3(),
      m: new Matrix4(),
    }
  }, [])

  useEffect(
    () => () => {
      for (const f of shop.families) {
        f.shell.dispose()
        f.parts.dispose()
      }
      shop.gel.dispose()
    },
    [shop],
  )

  useFrame(({ clock, camera }) => {
    const far = lobbyIsFar(camera)
    const { families, gel, layouts, matrices, widths, v, m } = shop
    for (let f = 0; f < families.length; f += 1) {
      families[f].shell.visible = !far
      families[f].parts.visible = !far
    }
    gel.visible = !far
    if (far) return
    const t = clock.elapsedTime
    const now = performance.now()
    for (let i = 0; i < BOTTLES.length; i += 1) {
      const b = BOTTLES[i]
      const p = PEDESTALS[i]
      const w = b.shape[0]
      const h = b.shape[1]
      // Unlock burst: a hop with two quick spins, and a squash on landing.
      const k = shopBursts[i] ? (now - shopBursts[i]) / 1000 / BURST_SECONDS : 1
      const hop = k < 1 ? Math.sin(k * Math.PI) * 1.4 : 0
      const spin = k < 1 ? k * Math.PI * 4 : 0
      const s = 1.35 * (k < 1 ? 1 + Math.sin(k * Math.PI) * 0.25 : 1)
      const y = 1.2 + Math.sin(t * 1.5 + i) * 0.08 + hop
      _dummy.position.set(p.x, y, p.z)
      _dummy.rotation.set(0, t * 0.6 + i + spin, Math.sin(t * 1.1 + i * 0.7) * 0.06)
      _dummy.scale.set(s * w, s * h, s * w)
      _dummy.updateMatrix()
      matrices[i].copy(_dummy.matrix)
      widths[i] = s * w
    }
    for (let f = 0; f < families.length; f += 1) {
      const { shell, parts, slots } = families[f]
      for (let k = 0; k < slots.length; k += 1) {
        shell.setMatrixAt(k, matrices[slots[k]])
        parts.setMatrixAt(k, matrices[slots[k]])
      }
      shell.instanceMatrix.needsUpdate = true
      parts.instanceMatrix.needsUpdate = true
    }
    // Gel balls drift inside each bottle, carried along by its bob and spin.
    let n = 0
    for (let i = 0; i < BOTTLES.length; i += 1) {
      const layout = layouts[i]
      for (let j = 0; j < layout.count; j += 1) {
        const size = gelBallAt(layout, j, t + i * 1.7, v) * widths[i]
        v.applyMatrix4(matrices[i])
        m.makeScale(size, size, size).setPosition(v)
        gel.setMatrixAt(n, m)
        n += 1
      }
    }
    gel.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      {shop.families.map((f) => (
        <primitive key={`${f.id}-parts`} object={f.parts} />
      ))}
      <primitive object={shop.gel} />
      {shop.families.map((f) => (
        <primitive key={`${f.id}-shell`} object={f.shell} />
      ))}
    </>
  )
}

/**
 * A soft pulsing pool of the pit's colour over every unlocked start plate and over the
 * target at the bottom of its pit. One additive InstancedMesh (one draw call), the
 * shared disc and glow texture; only the opacity moves in the frame loop.
 */
function PadGlow() {
  const rebirths = useGame((s) => s.profile.rebirths)
  const fx = useMemo(() => {
    const material = glowMaterial(getGlowTexture(), { polygonOffset: true, polygonOffsetFactor: -2 })
    const mesh = new InstancedMesh(getDiscGeometry(), material, PADS.length * 2)
    mesh.frustumCulled = false
    mesh.renderOrder = 3
    return { mesh, material }
  }, [])

  useEffect(() => {
    const col = new Color()
    const floorX = (PIT.floorX + PIT.topX - PIT.stepCount * PIT.stepDepth) / 2
    const floorY = -(PIT.stepCount + 1) * PIT.stepDrop + 0.12
    PADS.forEach((pad, i) => {
      const on = rebirths >= pad.rebirths ? 1 : 0.0001
      const z = padCenterZ(i)
      _dummy.rotation.set(0, 0, 0)
      _dummy.position.set(PIT.topX + PIT.plateDepth / 2, PAD_HEIGHT + 0.05, z)
      _dummy.scale.set(4.4 * on, 1, (PIT.halfWidth * 2 + 1.4) * on)
      _dummy.updateMatrix()
      fx.mesh.setMatrixAt(i * 2, _dummy.matrix)
      _dummy.position.set(floorX, floorY, z)
      _dummy.scale.set(3.4 * on, 1, (PIT.halfWidth * 2) * on)
      _dummy.updateMatrix()
      fx.mesh.setMatrixAt(i * 2 + 1, _dummy.matrix)
      col.set(pad.color)
      fx.mesh.setColorAt(i * 2, col)
      fx.mesh.setColorAt(i * 2 + 1, col)
    })
    fx.mesh.instanceMatrix.needsUpdate = true
    fx.mesh.instanceColor.needsUpdate = true
  }, [rebirths, fx])

  useEffect(
    () => () => {
      fx.material.dispose()
      fx.mesh.dispose()
    },
    [fx],
  )

  useFrame(({ clock, camera }) => {
    fx.mesh.visible = !lobbyIsFar(camera)
    if (fx.mesh.visible) fx.material.opacity = 0.5 + Math.sin(clock.elapsedTime * 2.2) * 0.22
  })

  return <primitive object={fx.mesh} />
}

const BARRIER_H = 1.5

/** Striped tape across the mouth of each pit you haven't unlocked yet. One draw call. */
function LockedBarriers() {
  const rebirths = useGame((s) => s.profile.rebirths)
  const fx = useMemo(() => {
    const map = getStripeTexture().clone()
    map.repeat.set((PIT.halfWidth * 2) / BARRIER_H, 1)
    map.needsUpdate = true
    const geometry = new PlaneGeometry(1, 1)
    geometry.rotateY(Math.PI / 2)
    const material = new MeshBasicMaterial({ map, color: '#ff5a5a', transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false })
    const mesh = new InstancedMesh(geometry, material, PADS.length)
    mesh.frustumCulled = false
    return { mesh, map }
  }, [])

  useEffect(() => {
    let any = false
    PADS.forEach((pad, i) => {
      const locked = rebirths < pad.rebirths
      any ||= locked
      _dummy.position.set(PIT.topX - 0.05, BARRIER_H / 2, padCenterZ(i))
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.set(1, locked ? BARRIER_H : 0, locked ? PIT.halfWidth * 2 : 0)
      _dummy.updateMatrix()
      fx.mesh.setMatrixAt(i, _dummy.matrix)
    })
    fx.mesh.instanceMatrix.needsUpdate = true
    fx.mesh.userData.any = any
  }, [rebirths, fx])

  useEffect(
    () => () => {
      fx.mesh.geometry.dispose()
      fx.mesh.material.dispose()
      fx.map.dispose()
      fx.mesh.dispose()
    },
    [fx],
  )

  useFrame(({ clock, camera }) => {
    fx.mesh.visible = Boolean(fx.mesh.userData.any) && !lobbyIsFar(camera)
    if (fx.mesh.visible) fx.map.offset.x = (clock.elapsedTime * 0.35) % 1
  })

  return <primitive object={fx.mesh} />
}

function PadLabels() {
  const rebirths = useGame((s) => s.profile.rebirths)
  // While you train, only your pit keeps its sign: the others would sit over the HUD.
  const here = useUi((s) => (s.nearby?.startsWith('pad:') ? Number(s.nearby.slice(4)) : -1))
  return PADS.map((p, i) => {
    const unlocked = rebirths >= p.rebirths
    return (
      <Label
        key={p.id}
        visible={here < 0 || here === i}
        position={[ARCH_X, 4.75, padCenterZ(i)]}
        width={5}
        lines={[
          { text: `${p.mult}x POWER`, size: 56, color: '#ffffff' },
          unlocked
            ? { text: p.name.toUpperCase(), size: 30, color: p.color }
            : { text: `LOCKED · ${p.rebirths} REBIRTH${p.rebirths > 1 ? 'S' : ''}`, size: 30, color: '#f87171' },
        ]}
      />
    )
  })
}

export function Lobby() {
  const settled = useUi((s) => s.settled)
  const world = useGame((s) => s.profile.world || 1)
  return (
    <>
      <LobbyBlocks world={world} />
      <Portal world={world} />
      <ShopBottles />
      {settled && <ShopAura />}
      <PedestalPlaques />
      <ShopNames />
      <Eggs />
      {settled && <LockedBarriers />}
      <PadGlow />
      {settled && <PadAura />}

      <PadLabels />
      <Signs world={world} />
      <Leaderboards />
      {eggStandsFor(world).map((e) => {
        const egg = EGGS[e.egg]
        return (
          <Label
            key={e.egg}
            position={[e.x, 4.3, e.z]}
            width={4.6}
            lines={[
              { text: egg.name.toUpperCase(), size: 44, color: egg.color },
              { text: `${fmt(egg.cost)} WINS`, size: 32, color: '#fde047' },
            ]}
          />
        )
      })}
      <Label position={[0, 9.6, LAUNCH_ARCH.z]} width={9} lines={[{ text: 'THROW ZONE', size: 66, color: '#ffffff' }]} />
    </>
  )
}

export default Lobby
