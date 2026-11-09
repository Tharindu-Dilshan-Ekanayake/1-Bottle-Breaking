import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, InstancedBufferAttribute, InstancedMesh, MeshPhongMaterial, Object3D } from 'three'

import { ALL_EGGS, EGGS } from '@shared/balance'
import { eggStandsFor } from '@shared/world'

import { useGame } from '../store/game'
import { createSparkles, disposeSparkles, getDiscGeometry, glowMaterial, placeSparkle } from './glow'
import { EGG_PATTERN_ROWS, getEggPatternTexture } from './eggPatterns'
import { getEggGeometry, getRingTexture } from './materials'
import { sfx } from './audio'
import { lobbyIsFar, runtime } from './runtime'
import { PRESETS, useQuality } from './stores/quality'

/*
 * The pet eggs on their stands: patterned, glossy eggs (one draw call for all five,
 * each picking its strip of one shared pattern texture), a glowing ring under each
 * stand that pulses faster when you can afford that egg, and - on MEDIUM / HIGH only -
 * sparkles drifting up around them. Every few seconds an egg wobbles as if something
 * inside wants out.
 */

const _dummy = new Object3D()
const _color = new Color()
const EGG_Y = 2.25
const EGG_SCALE = 0.9
const SPARKLES_PER_EGG = 6

/** Phong with the egg's pattern strip chosen per instance (attribute `aRow`). */
function createEggMaterial() {
  const material = new MeshPhongMaterial({ map: getEggPatternTexture(), shininess: 90, specular: '#ffffff' })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRow;')
      .replace(
        '#include <uv_vertex>',
        // Twice around the egg; v stays inside its strip so neighbours never bleed in.
        `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vec2(vMapUv.x * 2.0, (clamp(vMapUv.y, 0.03, 0.97) + aRow) / ${EGG_PATTERN_ROWS.toFixed(1)});\n#endif`,
      )
  }
  // A distinct program from plain Phong: it must not be shared with materials without aRow.
  material.customProgramCacheKey = () => 'egg-pattern'
  return material
}

/** The world you're in, and which of its eggs you can afford ('1' / '0' per egg). */
const affordKey = (s) => {
  const world = s.profile.world || 1
  return `${world}:${eggStandsFor(world).map((e) => (s.profile.wins - s.pendingWins >= EGGS[e.egg].cost ? '1' : '0')).join('')}`
}

export function Eggs() {
  const key = useGame(affordKey)
  const world = Number(key.split(':')[0])
  const afford = key.split(':')[1]
  const particles = useQuality((s) => PRESETS[s.preset].particles)

  const fx = useMemo(() => {
    const stands = eggStandsFor(world)
    const n = stands.length
    // Its own copy of the shared egg shape: the per-instance pattern row lives on it.
    const geometry = getEggGeometry().clone()
    const rows = new Float32Array(n)
    stands.forEach((e, i) => {
      rows[i] = EGG_PATTERN_ROWS - 1 - ALL_EGGS.indexOf(e.egg)
    })
    geometry.setAttribute('aRow', new InstancedBufferAttribute(rows, 1))
    const eggs = new InstancedMesh(geometry, createEggMaterial(), n)
    eggs.castShadow = true
    eggs.frustumCulled = false

    const rings = new InstancedMesh(getDiscGeometry(), glowMaterial(getRingTexture(), { polygonOffset: true, polygonOffsetFactor: -2 }), n)
    rings.frustumCulled = false
    rings.renderOrder = 3

    return {
      eggs,
      rings,
      stands,
      colors: stands.map((e) => new Color(EGGS[e.egg].color)),
      affordable: new Uint8Array(n),
      /** Last wobble cycle phase per egg, to catch a new wobble starting. */
      phase: new Float32Array(n),
      sparkles: particles ? createSparkles(n * SPARKLES_PER_EGG, 0.24) : null,
    }
  }, [particles, world])

  useEffect(
    () => () => {
      fx.eggs.geometry.dispose()
      fx.eggs.material.dispose()
      fx.eggs.dispose()
      fx.rings.material.dispose()
      fx.rings.dispose()
      if (fx.sparkles) disposeSparkles(fx.sparkles)
    },
    [fx],
  )

  // Ring colours: brighter for the eggs you can afford. Only when that changes.
  useEffect(() => {
    for (let i = 0; i < fx.stands.length; i += 1) {
      fx.affordable[i] = afford.charCodeAt(i) === 49 ? 1 : 0
      fx.rings.setColorAt(i, _color.copy(fx.colors[i]).multiplyScalar(fx.affordable[i] ? 1 : 0.45))
    }
    fx.rings.instanceColor.needsUpdate = true
  }, [afford, fx])

  useFrame(({ clock, camera }) => {
    const far = lobbyIsFar(camera)
    fx.eggs.visible = !far
    fx.rings.visible = !far
    if (fx.sparkles) fx.sparkles.points.visible = !far
    if (far) return
    const t = clock.elapsedTime
    for (let i = 0; i < fx.stands.length; i += 1) {
      const e = fx.stands[i]
      // A wobble burst every ~4 s, staggered per egg, so the eggs look alive.
      const cycle = (t + i * 0.9) % 4.2
      if (cycle < fx.phase[i]) {
        const dx = runtime.playerPos.x - e.x
        const dz = runtime.playerPos.z - e.z
        if (dx * dx + dz * dz < 49 && runtime.mode === 'walk') sfx.rattle()
      }
      fx.phase[i] = cycle
      const wobble = cycle < 0.6 ? Math.sin(cycle * 30) * (0.6 - cycle) * 0.5 : 0
      const squash = 1 + (cycle < 0.6 ? Math.sin(cycle * 15) * 0.05 : 0)
      _dummy.position.set(e.x, EGG_Y + Math.sin(t * 2 + i * 2) * 0.12, e.z)
      _dummy.rotation.set(0, t * 0.45 + i, wobble)
      _dummy.scale.set(EGG_SCALE / squash, EGG_SCALE * squash, EGG_SCALE / squash)
      _dummy.updateMatrix()
      fx.eggs.setMatrixAt(i, _dummy.matrix)

      // The ring: slowly turning, pulsing quicker when you can afford the egg.
      const pulse = fx.affordable[i] ? 1 + Math.sin(t * 4 + i) * 0.08 : 1 + Math.sin(t * 1.5 + i) * 0.03
      _dummy.position.set(e.x, 0.9, e.z)
      _dummy.rotation.set(0, -t * 0.6 + i, 0)
      _dummy.scale.set(3 * pulse, 1, 3 * pulse)
      _dummy.updateMatrix()
      fx.rings.setMatrixAt(i, _dummy.matrix)
    }
    fx.eggs.instanceMatrix.needsUpdate = true
    fx.rings.instanceMatrix.needsUpdate = true

    const sp = fx.sparkles
    if (sp) {
      for (let j = 0; j < sp.count; j += 1) {
        const i = Math.floor(j / SPARKLES_PER_EGG)
        const e = fx.stands[i]
        placeSparkle(sp, j, t * 0.7 + i * 0.37, e.x, 1.1, e.z, 1.35, 2.8, fx.colors[i])
      }
      sp.points.geometry.attributes.position.needsUpdate = true
      sp.points.geometry.attributes.color.needsUpdate = true
    }
  })

  return (
    <>
      <primitive object={fx.eggs} />
      <primitive object={fx.rings} />
      {fx.sparkles && <primitive object={fx.sparkles.points} />}
    </>
  )
}

export default Eggs
