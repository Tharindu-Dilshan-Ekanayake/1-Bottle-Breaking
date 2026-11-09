import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'

import { LAUNCH } from '@shared/world'
import { levelFor } from '@shared/logic'

import { actions } from '../net/actions'
import { localDebug } from '../net/localServer'
import { remotePlayers } from '../net/remotePlayers'
import { getGame } from '../store/game'
import { runtime } from './runtime'
import { useQuality } from './stores/quality'
import { useUi } from './stores/ui'

const ENABLED = typeof window !== 'undefined' && /[?&]perf\b/.test(window.location.search)

/**
 * Opt-in measurement hook (add `?perf` to the URL). Publishes renderer stats on
 * `window.__perf` once a second and exposes `window.__bt` helpers so an automated
 * browser can drive a throw. Renders nothing and does nothing without `?perf`.
 */
export function PerfProbe() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const frames = useRef(0)

  useFrame(() => {
    if (ENABLED) frames.current += 1
  })

  useEffect(() => {
    if (!ENABLED) return undefined
    // Time-to-playable: when the loading screen lifts.
    const markLoaded = (s) => {
      if (s.loaded && !window.__loadedAt) window.__loadedAt = Math.round(performance.now())
    }
    markLoaded(useUi.getState())
    const unsub = useUi.subscribe(markLoaded)

    /** Rough GPU texture memory: unique textures in the scene (+1/3 for mips) + shadow map. */
    const textureMemoryMB = () => {
      const seen = new Set()
      let bytes = 0
      scene.traverse((o) => {
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
        for (const m of mats) {
          for (const key of ['map', 'emissiveMap', 'normalMap', 'alphaMap']) {
            const t = m[key]
            const img = t?.image
            if (!t || seen.has(t) || !img?.width) continue
            seen.add(t)
            bytes += img.width * img.height * 4 * (t.generateMipmaps ? 4 / 3 : 1)
          }
        }
        if (o.isLight && o.castShadow && o.shadow?.map) {
          const s = o.shadow.mapSize
          bytes += s.x * s.y * 4
        }
      })
      return Math.round((bytes / (1024 * 1024)) * 10) / 10
    }

    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const info = gl.info
      window.__perf = {
        textureMB: textureMemoryMB(),
        loadedAt: window.__loadedAt,
        fps: Math.round((frames.current * 1000) / (now - last)),
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        preset: useQuality.getState().preset,
        mode: runtime.mode,
        throwStair: runtime.throwStair,
        net: getGame().net.mode,
        players: getGame().net.players,
        remotes: remotePlayers.size,
        ghosts: runtime.ghostThrows.size,
        power: getGame().profile.power,
        wins: getGame().profile.wins,
        pixelRatio: gl.getPixelRatio(),
      }
      frames.current = 0
      last = now
    }, 1000)

    window.__bt = {
      /** The three.js scene (?perf only), for test scripts that inspect it. */
      scene,
      /** The camera (?perf only): test scripts read where it looks from. */
      camera,
      throw: () => {
        runtime.playerPos.set(LAUNCH.x, LAUNCH.h, LAUNCH.z)
        // Give the position a moment to reach the authority.
        setTimeout(() => actions.throwBottle(), 250)
      },
      /** Offline play only: sets Power (and the matching level) on the local save. */
      setPower: (p, rebirths) => {
        const profile = localDebug.profile
        if (!profile) return false
        if (Number.isFinite(rebirths)) profile.rebirths = rebirths
        profile.power = p
        profile.level = levelFor(p, profile.rebirths)
        localDebug.session.sendProfile()
        return true
      },
      /** Offline test helper: sets Wins (and optionally rebirths) on the local profile. */
      setWins: (wins, rebirths) => {
        const profile = localDebug.profile
        if (!profile) return false
        profile.wins = wins
        if (Number.isFinite(rebirths)) profile.rebirths = rebirths
        localDebug.session.sendProfile()
        return true
      },
      /** Walks (at a legal speed, so the server accepts it) to (x, z). */
      walkTo: (x, z) =>
        new Promise((resolve) => {
          const id = setInterval(() => {
            const p = runtime.playerPos
            const dx = x - p.x
            const dz = z - p.z
            const d = Math.hypot(dx, dz)
            if (d < 0.6) {
              clearInterval(id)
              resolve(true)
              return
            }
            const step = Math.min(d, 0.9)
            p.x += (dx / d) * step
            p.z += (dz / d) * step
          }, 100)
        }),
      runtime,
    }
    return () => {
      clearInterval(id)
      unsub()
    }
  }, [gl, scene, camera])

  return null
}

export default PerfProbe
