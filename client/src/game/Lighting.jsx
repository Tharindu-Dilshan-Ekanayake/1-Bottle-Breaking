import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { LIGHTS } from './sceneStyle'

const SUN_DIRECTION = new Vector3(...LIGHTS.sunDirection).normalize()
/** How far back along SUN_DIRECTION the light sits from the point it shadows. */
const SUN_DISTANCE = 60
/** Half-size of the square area around the player that receives shadows. */
const SHADOW_EXTENT = 24

/**
 * Bright, even daylight: a white hemisphere fill and a warm sun with soft shadows.
 *
 * A directional light's shadow only covers a fixed box around its target, so the sun
 * and its target are moved with the player every frame. Otherwise shadows would exist
 * only near the world origin and disappear a few steps down the track.
 *
 * @param {{ followRef: React.MutableRefObject<any> }} props the player's rigid body
 */
export function Lighting({ followRef }) {
  const sunRef = useRef(null)
  const scene = useThree((s) => s.scene)

  useLayoutEffect(() => {
    const sun = sunRef.current
    if (!sun) return undefined

    const shadowCamera = sun.shadow.camera
    shadowCamera.left = -SHADOW_EXTENT
    shadowCamera.right = SHADOW_EXTENT
    shadowCamera.top = SHADOW_EXTENT
    shadowCamera.bottom = -SHADOW_EXTENT
    shadowCamera.near = 1
    shadowCamera.far = SUN_DISTANCE * 2
    shadowCamera.updateProjectionMatrix()

    // The target has to be in the scene for its matrix to update as it moves.
    scene.add(sun.target)
    return () => {
      scene.remove(sun.target)
    }
  }, [scene])

  useFrame(() => {
    const sun = sunRef.current
    const body = followRef.current
    if (!sun || !body) return

    const p = body.translation()
    sun.target.position.set(p.x, 0, p.z)
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, SUN_DISTANCE)
  })

  return (
    <>
      <hemisphereLight args={[LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity]} />
      <directionalLight
        ref={sunRef}
        castShadow
        color={LIGHTS.sunColor}
        intensity={LIGHTS.sunIntensity}
        position={SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE).toArray()}
        shadow-mapSize={[2048, 2048]}
        shadow-radius={LIGHTS.shadowSoftness}
        shadow-intensity={LIGHTS.shadowIntensity}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
    </>
  )
}

export default Lighting
