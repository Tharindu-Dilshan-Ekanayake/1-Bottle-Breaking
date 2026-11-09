import { useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, Matrix4, Sphere, Vector3 } from 'three'

import {
  bottleFamilyId,
  createGelLayout,
  gelBallAt,
  gelColor,
  getBottleFamily,
  getBottlePartsMaterial,
  getBottleShellMaterial,
  getGelGeometry,
  getGelMaterial,
  setBottleLookAt,
} from './materials'

const _v = new Vector3()
const _m = new Matrix4()
const _c = new Color()

/** Places the gel balls for time t (outside the [w, h, w] scale, so they stay round). */
function placeGel(gel, layout, t) {
  for (let k = 0; k < layout.count; k += 1) {
    const size = gelBallAt(layout, k, t, _v) * layout.w
    _v.set(_v.x * layout.w, _v.y * layout.h, _v.z * layout.w)
    _m.makeScale(size, size, size).setPosition(_v)
    gel.setMatrixAt(k, _m)
  }
  gel.instanceMatrix.needsUpdate = true
}

/** Gives a model's meshes the look of `bottle` (colours, fill, gel balls). */
function applyBottle(meshes, bottle) {
  setBottleLookAt(meshes.shell, 0, bottle)
  meshes.parts.setColorAt(0, _c.set(bottle.cap))
  meshes.parts.instanceColor.needsUpdate = true
  const layout = createGelLayout(bottle)
  for (let k = 0; k < layout.count; k += 1) meshes.gel.setColorAt(k, gelColor(bottle, k, _c))
  meshes.gel.instanceColor.needsUpdate = true
  placeGel(meshes.gel, layout, 0)
  // The balls are positioned by hand every frame; a fixed sphere round the bottle culls them.
  meshes.gel.boundingSphere.center.set(0, 0.5 * layout.h, 0)
  meshes.gel.boundingSphere.radius = 0.6 * Math.max(layout.w, layout.h)
  return layout
}

/**
 * One bottle in the shape of its family (see BOTTLE_FAMILIES in materials.js): the
 * glass + liquid shell, the cap/stopper/label parts and a few gel balls drifting in the
 * liquid. Geometry and materials are shared with every other bottle in the game; a model
 * only owns its three small InstancedMeshes (3 draw calls), recreated when the family
 * changes and recoloured in place when only the bottle does.
 *
 * The model is about 1 unit tall with its base at the origin.
 */
export const BottleModel = forwardRef(function BottleModel({ bottle, visible = true, ...props }, ref) {
  const familyId = bottleFamilyId(bottle)
  const layoutRef = useRef(null)

  const meshes = useMemo(() => {
    const fam = getBottleFamily(familyId)
    const shell = new InstancedMesh(fam.shell, getBottleShellMaterial(), 1)
    const parts = new InstancedMesh(fam.parts, getBottlePartsMaterial(), 1)
    const gel = new InstancedMesh(getGelGeometry(), getGelMaterial(), fam.gelCount)
    shell.renderOrder = 1
    shell.castShadow = true
    parts.castShadow = true
    gel.boundingSphere = new Sphere(new Vector3(), 1)
    return { shell, parts, gel }
  }, [familyId])

  // Before the first frame draws them, so their shaders compile with instance colours.
  useLayoutEffect(() => {
    layoutRef.current = applyBottle(meshes, bottle)
  }, [bottle, meshes])

  useEffect(
    () => () => {
      meshes.shell.dispose()
      meshes.parts.dispose()
      meshes.gel.dispose()
    },
    [meshes],
  )

  useFrame(({ clock }) => {
    const layout = layoutRef.current
    if (!layout) return
    for (let o = meshes.gel; o; o = o.parent) if (!o.visible) return
    placeGel(meshes.gel, layout, clock.elapsedTime)
  })

  const [w, h] = bottle.shape

  return (
    <group ref={ref} visible={visible} {...props}>
      <group scale={[w, h, w]}>
        <primitive object={meshes.shell} />
        <primitive object={meshes.parts} />
      </group>
      {/* Outside the shape scale so the balls stay round. */}
      <primitive object={meshes.gel} />
    </group>
  )
})

export default BottleModel
