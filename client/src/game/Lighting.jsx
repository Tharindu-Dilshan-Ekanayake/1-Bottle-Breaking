import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Color, Vector3 } from 'three'

import { useGame } from '../store/game'
import { runtime } from './runtime'
import { LIGHTS } from './sceneStyle'
import { PRESETS, useQuality } from './stores/quality'

const SUN_DISTANCE = 60
const SHADOW_EXTENT = 22

/**
 * Each world's light. World 1 is a clear sunny day: a cool sky fill and a warm sun, so
 * lit and shaded faces differ in temperature as well as brightness. World 2 (Candy
 * Peaks) is a candy dusk: pink sky fill, violet bounce and a low, warm orange sun.
 * Keep each sun direction in step with the sky glow in Sky.jsx.
 */
const WORLD_LIGHTS = {
  1: {
    hemiSky: '#eef5ff', hemiGround: '#a7c48e', hemiIntensity: 2.05,
    sunColor: '#fff0d2', sunIntensity: 1.8, sunDirection: LIGHTS.sunDirection,
  },
  2: {
    hemiSky: '#ffe6f5', hemiGround: '#a27cc8', hemiIntensity: 2.0,
    sunColor: '#ffd3a6', sunIntensity: 1.85, sunDirection: [-0.62, 0.5, 0.42],
  },
}

// Converted once; the frame loop only lerps towards these.
const TARGETS = Object.fromEntries(
  Object.entries(WORLD_LIGHTS).map(([w, l]) => [
    w,
    {
      hemiSky: new Color(l.hemiSky),
      hemiGround: new Color(l.hemiGround),
      hemiIntensity: l.hemiIntensity,
      sunColor: new Color(l.sunColor),
      sunIntensity: l.sunIntensity,
      sunDirection: new Vector3(...l.sunDirection).normalize(),
    },
  ]),
)

const START = TARGETS[1]
const SUN_START = START.sunDirection.clone().multiplyScalar(SUN_DISTANCE).toArray()
const _sunDir = START.sunDirection.clone()

/**
 * Hemisphere fill + sun, in the palette of the world you're in (blended over about a
 * second when you change worlds). The sun casts shadows only when the preset allows it
 * (never on LOW), and follows the camera focus so the shadowed area travels with the
 * action.
 */
export function Lighting() {
  const hemiRef = useRef(null)
  const sunRef = useRef(null)
  const snapped = useRef(false)
  const scene = useThree((s) => s.scene)
  const preset = useQuality((s) => s.preset)
  const world = useGame((s) => (s.profile.world === 2 ? 2 : 1))
  const { shadows, shadowMapSize } = PRESETS[preset]

  useLayoutEffect(() => {
    const sun = sunRef.current
    if (!sun) return undefined
    const cam = sun.shadow.camera
    cam.left = -SHADOW_EXTENT
    cam.right = SHADOW_EXTENT
    cam.top = SHADOW_EXTENT
    cam.bottom = -SHADOW_EXTENT
    cam.near = 1
    cam.far = SUN_DISTANCE * 2
    cam.updateProjectionMatrix()
    scene.add(sun.target)
    return () => {
      scene.remove(sun.target)
    }
  }, [scene])

  useFrame((_s, delta) => {
    const sun = sunRef.current
    const hemi = hemiRef.current
    if (!sun || !hemi) return
    const target = TARGETS[world]
    // First frame snaps; after that, colours drift to the new world's.
    const k = snapped.current ? 1 - Math.pow(0.05, delta) : 1
    snapped.current = true
    hemi.color.lerp(target.hemiSky, k)
    hemi.groundColor.lerp(target.hemiGround, k)
    hemi.intensity += (target.hemiIntensity - hemi.intensity) * k
    sun.color.lerp(target.sunColor, k)
    sun.intensity += (target.sunIntensity - sun.intensity) * k
    _sunDir.lerp(target.sunDirection, k).normalize()

    const f = runtime.focus
    sun.target.position.set(f.x, f.y, f.z)
    sun.position.copy(sun.target.position).addScaledVector(_sunDir, SUN_DISTANCE)
  })

  return (
    <>
      <hemisphereLight ref={hemiRef} args={[START.hemiSky, START.hemiGround, START.hemiIntensity]} />
      <directionalLight
        ref={sunRef}
        castShadow={shadows}
        color={START.sunColor}
        intensity={START.sunIntensity}
        position={SUN_START}
        shadow-mapSize={[shadowMapSize || 512, shadowMapSize || 512]}
        shadow-radius={LIGHTS.shadowSoftness}
        shadow-intensity={LIGHTS.shadowIntensity}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
    </>
  )
}

export default Lighting
