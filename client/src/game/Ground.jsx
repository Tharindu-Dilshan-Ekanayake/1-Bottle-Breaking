import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Object3D } from 'three'

import { FENCE, GROUND, WALLS } from './sceneStyle'
import {
  createStudTexture,
  createWorldBoxGeometry,
  createWorldPlaneGeometry,
} from './textures'

const TRACK_LENGTH = 200
const TRACK_WIDTH = 20
const TRACK_CENTER_Z = -TRACK_LENGTH / 2 + 20
/** End of the track behind the spawn point. */
const TRACK_NEAR_Z = TRACK_CENTER_Z + TRACK_LENGTH / 2
/** End of the track in the running direction. */
const TRACK_FAR_Z = TRACK_CENTER_Z - TRACK_LENGTH / 2

/** World size of one ground texture repeat (4 x 4 studs of 0.5 units). */
const GROUND_TILE = 2
/** World size of one wall texture repeat (8 x 8 studs of 0.5 units). */
const WALL_TILE = 4

/** Boundary walls: scenery only, well outside where the player or camera can go. */
const WALL_X = 45
const WALL_NEAR_Z = 60
const WALL_FAR_Z = -230
const WALL_HEIGHT = 12
const WALL_THICKNESS = 2

const FENCE_HEIGHT = 1.25
const FENCE_POST_SPACING = 2.5
const FENCE_RAIL_HEIGHTS = [0.45, 0.95]

/**
 * A wooden fence from `from` to `to` ([x, z] each): two rails and a row of posts.
 * Visual only - the colliders live in Ground.
 *
 * @param {{ from: [number, number], to: [number, number], skipEndPosts?: boolean }} props
 *   `skipEndPosts` avoids doubling up a corner post another fence already has.
 */
function Fence({ from, to, skipEndPosts = false }) {
  const postsRef = useRef(null)

  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  // Rotates the group's local +Z onto the fence direction.
  const angle = Math.atan2(dx, dz)

  const postOffsets = useMemo(() => {
    const count = Math.floor(length / FENCE_POST_SPACING) + 1
    const step = length / (count - 1)
    const offsets = Array.from({ length: count }, (_, i) => -length / 2 + i * step)
    return skipEndPosts ? offsets.slice(1, -1) : offsets
  }, [length, skipEndPosts])

  useLayoutEffect(() => {
    const posts = postsRef.current
    if (!posts) return
    const dummy = new Object3D()
    postOffsets.forEach((z, i) => {
      dummy.position.set(0, FENCE_HEIGHT / 2, z)
      dummy.updateMatrix()
      posts.setMatrixAt(i, dummy.matrix)
    })
    posts.instanceMatrix.needsUpdate = true
    posts.computeBoundingSphere()
  }, [postOffsets])

  return (
    <group position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]} rotation={[0, angle, 0]}>
      {FENCE_RAIL_HEIGHTS.map((y) => (
        <mesh key={y} castShadow receiveShadow position={[0, y, 0]}>
          <boxGeometry args={[0.12, 0.22, length]} />
          <meshStandardMaterial color={FENCE.rail} roughness={0.85} />
        </mesh>
      ))}
      <instancedMesh
        ref={postsRef}
        args={[undefined, undefined, postOffsets.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0.24, FENCE_HEIGHT, 0.24]} />
        <meshStandardMaterial color={FENCE.post} roughness={0.85} />
      </instancedMesh>
    </group>
  )
}

/**
 * The play area: a long studded track fenced on all four sides, set in a wider lime
 * field enclosed by tall checker brick walls.
 *
 * Only the track and its fences are physical. The surrounding field and walls are
 * scenery; the fences keep the player off them.
 */
export function Ground() {
  const groundTexture = useMemo(
    () => createStudTexture({ base: GROUND.base, alt: GROUND.alt }),
    [],
  )
  const wallTexture = useMemo(
    () => createStudTexture({ base: WALLS.base, alt: WALLS.alt, studsPerCell: 4 }),
    [],
  )

  const trackGeometry = useMemo(
    () => createWorldBoxGeometry(TRACK_WIDTH, 1, TRACK_LENGTH, GROUND_TILE),
    [],
  )
  const fieldGeometry = useMemo(() => createWorldPlaneGeometry(800, 800, GROUND_TILE), [])

  const wallLength = WALL_NEAR_Z - WALL_FAR_Z
  const wallCenterZ = (WALL_NEAR_Z + WALL_FAR_Z) / 2
  const sideWallGeometry = useMemo(
    () => createWorldBoxGeometry(WALL_THICKNESS, WALL_HEIGHT, wallLength, WALL_TILE),
    [wallLength],
  )
  const endWallGeometry = useMemo(
    () =>
      createWorldBoxGeometry(WALL_X * 2 + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS, WALL_TILE),
    [],
  )

  const halfWidth = TRACK_WIDTH / 2

  return (
    <>
      {/* --- Physical track -------------------------------------------------- */}
      <RigidBody type="fixed" friction={1} name="ground">
        <mesh receiveShadow geometry={trackGeometry} position={[0, -0.5, TRACK_CENTER_Z]}>
          <meshStandardMaterial map={groundTexture} roughness={0.9} />
        </mesh>
      </RigidBody>

      {/* Fence colliders: the sides match the old rails exactly; the ends stop the
          player running off the track. */}
      <RigidBody type="fixed" colliders={false} name="fences">
        {[-1, 1].map((side) => (
          <CuboidCollider
            key={`side-${side}`}
            args={[0.25, 1, TRACK_LENGTH / 2]}
            position={[side * halfWidth, 0.5, TRACK_CENTER_Z]}
          />
        ))}
        {[TRACK_NEAR_Z, TRACK_FAR_Z].map((z) => (
          <CuboidCollider key={`end-${z}`} args={[halfWidth, 1, 0.25]} position={[0, 0.5, z]} />
        ))}
      </RigidBody>

      <Fence from={[-halfWidth, TRACK_NEAR_Z]} to={[-halfWidth, TRACK_FAR_Z]} />
      <Fence from={[halfWidth, TRACK_NEAR_Z]} to={[halfWidth, TRACK_FAR_Z]} />
      <Fence from={[-halfWidth, TRACK_NEAR_Z]} to={[halfWidth, TRACK_NEAR_Z]} skipEndPosts />
      <Fence from={[-halfWidth, TRACK_FAR_Z]} to={[halfWidth, TRACK_FAR_Z]} skipEndPosts />

      {/* Distance stripes, purely visual, so movement reads on a flat plane.
          polygonOffset keeps them from flickering against the ground far away. */}
      {Array.from({ length: 20 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, 10 - i * 10]}>
          <planeGeometry args={[TRACK_WIDTH - 1, 0.3]} />
          <meshStandardMaterial
            color="#ffffff"
            opacity={0.35}
            transparent
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      ))}

      {/* --- Scenery ---------------------------------------------------------- */}
      {/* Sits a little below the track so the two never z-fight. */}
      <mesh
        receiveShadow
        geometry={fieldGeometry}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.25, TRACK_CENTER_Z]}
      >
        <meshStandardMaterial map={groundTexture} roughness={0.9} />
      </mesh>

      {[-1, 1].map((side) => (
        <mesh
          key={`wall-${side}`}
          geometry={sideWallGeometry}
          position={[side * WALL_X, WALL_HEIGHT / 2 - 0.25, wallCenterZ]}
        >
          <meshStandardMaterial map={wallTexture} roughness={0.9} />
        </mesh>
      ))}
      {[WALL_NEAR_Z, WALL_FAR_Z].map((z) => (
        <mesh key={`wall-${z}`} geometry={endWallGeometry} position={[0, WALL_HEIGHT / 2 - 0.25, z]}>
          <meshStandardMaterial map={wallTexture} roughness={0.9} />
        </mesh>
      ))}
    </>
  )
}

export default Ground
