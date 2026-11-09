import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  Quaternion,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
} from 'three'

import { THROW_WINDUP, TRAIN_INTERVAL } from '@shared/balance'

import { BACK_BONE, HAT_BONE, NECK_OFFSET_BONE, PART_SLOTS, WORN_SLOTS } from '../bloxity/avatarAssets'

/**
 * Rig manipulation for the base `player.glb` character.
 *
 * The rig's real structure (confirmed by reading player.glb directly):
 *   character
 *     - default_arm_L / default_arm_R / default_head
 *     - default_leg_L / default_leg_R / default_torso   (6 SkinnedMeshes, 1 skeleton)
 *     - Rig1
 *         - Spine1 > Spine2 > { ArmL_Offset > ArmL1 > ArmL2 > ArmL2_leaf,
 *                               ArmR_Offset > ArmR1 > ArmR2 > ArmR2_leaf,
 *                               Neck_Offset > Neck1 > Neck1_leaf }
 *         - LegL_Offset > LegL1 > LegL2 > LegL2_leaf, LegR_Offset > LegR1 > LegR2 > LegR2_leaf
 *
 * The rig is 6.4 units tall, feet at y 0, hips at y 2.4; the L limbs sit on +X.
 *
 * Two consequences drive everything below:
 *  1. Body parts are NOT attached to bones. Each is a separate SkinnedMesh sharing one
 *     skeleton, so equipping a part means swapping that mesh's geometry (remapping
 *     skin indices into the base skeleton's bone order first).
 *  2. Accessories DO attach to bones: hat/hair/mask to `Neck1`, back to `Spine2`, and
 *     neck, chest, waist, hands and shoes to theirs (see WORN_SLOTS).
 *
 * player.glb ships no animation clips, so the character is posed, not animated.
 */

/**
 * Walks the loaded rig and collects everything later operations need. Call on a fresh
 * clone, before any pose or proportions touch it.
 *
 * @param {import('three').Object3D} root
 */
export function collectRig(root) {
  const rig = {
    root,
    skeleton: null,
    /** slot -> SkinnedMesh */
    partMeshes: {},
    /** slot -> the pristine geometry to restore on unequip */
    originalGeometries: {},
    /** slot -> a remapped part geometry this rig made (and so must free) */
    ownedGeometries: {},
    /** bone name -> { bone, origPos, origQuat, origScale } */
    bones: {},
    hatBone: null,
    backBone: null,
    neckOffsetBindY: 0,
    skinnedMeshes: [],
    /** Rest position of the character root, so the bob and weight shift return to it. */
    rootRestX: root.position.x,
    rootRestY: root.position.y,
    /** +1 when the L limbs sit on +X (player.glb), -1 if mirrored. */
    sideL: 1,
    /** Hip to sole, in rig units. */
    legLength: 2.4,
    /** bone name -> inverse of its rest transform in model space (see restInverses). */
    restInverse: {},
    /** Pairs worn on hands and feet, placed every frame (placeFollowers). */
    followers: [],
    /** Everything worn (hat, hair, back, hands...), so far avatars can hide them. */
    accessories: [],
    /** False hides the accessories (setAccessoriesVisible). */
    detail: true,
    /** The six body parts as one skinned mesh (mergeBody), or null. */
    merged: null,
    /** Where the six parts were taken from while merged: [mesh, parent] pairs. */
    detached: [],
  }

  const meshBySlot = new Map(
    Object.entries(PART_SLOTS).map(([slot, cfg]) => [cfg.mesh.toLowerCase(), slot]),
  )

  root.traverse((node) => {
    if (node.isSkinnedMesh) {
      node.castShadow = true
      node.receiveShadow = true
      rig.skinnedMeshes.push(node)
      if (!rig.skeleton) rig.skeleton = node.skeleton

      const slot = meshBySlot.get((node.name || '').toLowerCase())
      if (slot) {
        rig.partMeshes[slot] = node
        rig.originalGeometries[slot] = node.geometry.clone()
      }
    } else if (node.isMesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })

  const skeleton = rig.skeleton
  if (skeleton) {
    for (const bone of skeleton.bones) {
      // Proportions are re-applied every frame from these rest values.
      bone.matrixAutoUpdate = true
      rig.bones[bone.name] = {
        bone,
        origPos: bone.position.clone(),
        origQuat: bone.quaternion.clone(),
        origScale: bone.scale.clone(),
        /** What applyProportions does to it (decided once, not by name every frame). */
        kind: boneKind(bone.name),
      }
    }

    // Bone local axes are NOT world-aligned in this rig: a limb bone's local X
    // points along world -Z and its local Z along world -X, so rotating a leg about
    // its local X swings it sideways instead of forward/back. The offsets differ per
    // bone (Spine1 is identity, ArmL2 is off by ~14 degrees), so rather than hardcode
    // an axis, record for each bone the local-space axis matching each character-space
    // axis and animate about those.
    root.updateMatrixWorld(true)
    const rootQuat = new Quaternion()
    root.getWorldQuaternion(rootQuat)
    const rootQuatInv = rootQuat.invert()
    const boneWorld = new Quaternion()

    for (const bone of skeleton.bones) {
      const entry = rig.bones[bone.name]
      if (!entry) continue
      bone.getWorldQuaternion(boneWorld)
      // Bone orientation relative to the character, then inverted: this maps a
      // character-space axis into the bone's own local frame.
      const relInv = rootQuatInv.clone().multiply(boneWorld).invert()
      /** Local axis to rotate about for forward/back swing. */
      entry.axisX = new Vector3(1, 0, 0).applyQuaternion(relInv).normalize()
      /** Local axis to rotate about for lateral sway. */
      entry.axisZ = new Vector3(0, 0, 1).applyQuaternion(relInv).normalize()
      /** Local axis to rotate about for a twist (spine, head turn). */
      entry.axisY = new Vector3(0, 1, 0).applyQuaternion(relInv).normalize()
    }

    rig.restInverse = restInverses(root)

    // Which side the left leg is on, and how long it is: the idle stance spreads the
    // legs outwards and keeps the feet planted from these.
    const hip = rig.bones.LegL1?.bone
    const sole = rig.bones.LegL2_leaf?.bone
    if (hip) {
      const hipPos = root.worldToLocal(hip.getWorldPosition(new Vector3()))
      if (hipPos.x < 0) rig.sideL = -1
      if (sole) {
        const length = hipPos.distanceTo(root.worldToLocal(sole.getWorldPosition(new Vector3())))
        if (length > 0.01) rig.legLength = length
      }
    }

    rig.hatBone = skeleton.bones.find((b) => b.name === HAT_BONE) || null
    rig.backBone = skeleton.bones.find((b) => b.name === BACK_BONE) || null

    const neckIndex = skeleton.bones.findIndex((b) => b.name === NECK_OFFSET_BONE)
    if (neckIndex >= 0) {
      // elements[13] is the Y translation of the inverted bind matrix.
      rig.neckOffsetBindY = skeleton.boneInverses[neckIndex].clone().invert().elements[13]
    }
  }

  return rig
}

/**
 * For every bone, the inverse of its rest transform in the model's own space:
 * inverse(inverse(model.matrixWorld) * bone.matrixWorld). Call straight after the GLB
 * loads, before any pose or proportions. Accessories are placed from these, not from
 * skeleton.boneInverses - player.glb's leaf bones bind 90 degrees off their rest pose,
 * which would turn hand items sideways.
 */
export function restInverses(model) {
  model.updateMatrixWorld(true)
  const modelInv = new Matrix4().copy(model.matrixWorld).invert()
  const out = {}
  model.traverse((node) => {
    if (node.isBone) out[node.name] = new Matrix4().multiplyMatrices(modelInv, node.matrixWorld).invert()
  })
  return out
}

/**
 * Frees what a rig made for itself: its skinned meshes' materials (one per avatar) and
 * the geometries it cloned. Loaded assets are the loader cache's and stay.
 */
export function disposeRig(rig) {
  if (!rig) return
  unmergeBody(rig)
  for (const mesh of rig.skinnedMeshes) mesh.material?.dispose?.()
  for (const geometry of Object.values(rig.originalGeometries)) geometry.dispose()
  for (const geometry of Object.values(rig.ownedGeometries)) geometry.dispose()
  rig.ownedGeometries = {}
  rig.followers.length = 0
  rig.accessories.length = 0
}

/* ---------------------------------------------------------------------------
 * One draw call for the body
 *
 * player.glb is six skinned meshes (head, torso, arms, legs) on one skeleton, all with
 * the same skin texture: six draw calls (and six shadow casts) per character. Once the
 * outfit is assembled they are merged into a single SkinnedMesh on the same skeleton
 * and the six are hidden; a re-assembly unmerges first, swaps parts, and merges again.
 * Anything that doesn't fit (a custom character with several textures, a part without
 * skin weights) simply stays as it is.
 * ------------------------------------------------------------------------- */

const MERGE_ATTRIBUTES = [
  ['position', 3],
  ['normal', 3],
  ['uv', 2],
  ['skinIndex', 4],
  ['skinWeight', 4],
]
const _bindInv = new Matrix4()
const _bindRel = new Matrix4()
const _mv = new Vector3()

/**
 * Does `skeleton` pose like the rig's own? SkeletonUtils.clone gives every skinned mesh
 * its own Skeleton object, but over the same bones with the same bind inverses.
 */
function sameSkeleton(rig, skeleton) {
  const base = rig.skeleton
  if (skeleton === base) return true
  if (!skeleton || skeleton.bones.length !== base.bones.length) return false
  for (let i = 0; i < base.bones.length; i += 1) {
    if (skeleton.bones[i] !== base.bones[i]) return false
    if (!skeleton.boneInverses[i].equals(base.boneInverses[i])) return false
  }
  return true
}

/** Can these skinned meshes become one draw call? */
function mergeable(rig, meshes) {
  if (meshes.length < 2 || !rig.skeleton) return false
  const first = meshes[0]
  const map = first.material?.map ?? null
  for (const mesh of meshes) {
    if (!sameSkeleton(rig, mesh.skeleton) || Array.isArray(mesh.material)) return false
    if ((mesh.material?.map ?? null) !== map) return false
    const g = mesh.geometry
    if (!g || Object.keys(g.morphAttributes || {}).length) return false
    for (const [name, size] of MERGE_ATTRIBUTES) if (g.attributes[name]?.itemSize !== size) return false
  }
  return true
}

/**
 * Merges the rig's skinned meshes into one (see above). Call after every part and the
 * skin are applied; returns the merged mesh, or null if the body stays as it was.
 */
export function mergeBody(rig) {
  unmergeBody(rig)
  const meshes = rig.skinnedMeshes
  if (!mergeable(rig, meshes)) return null
  const first = meshes[0]

  let vertices = 0
  let indices = 0
  for (const mesh of meshes) {
    const g = mesh.geometry
    vertices += g.attributes.position.count
    indices += g.index ? g.index.count : g.attributes.position.count
  }
  const out = {
    position: new Float32Array(vertices * 3),
    normal: new Float32Array(vertices * 3),
    uv: new Float32Array(vertices * 2),
    skinIndex: new Uint16Array(vertices * 4),
    skinWeight: new Float32Array(vertices * 4),
  }
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)

  _bindInv.copy(first.bindMatrix).invert()
  let v = 0
  let n = 0
  for (const mesh of meshes) {
    const g = mesh.geometry
    const count = g.attributes.position.count
    // player.glb's parts all share one bind matrix; anything else is baked in.
    const rebase = !mesh.bindMatrix.equals(first.bindMatrix)
    if (rebase) _bindRel.multiplyMatrices(_bindInv, mesh.bindMatrix)
    const { position, normal, uv, skinIndex, skinWeight } = g.attributes
    for (let i = 0; i < count; i += 1) {
      const o = v + i
      _mv.fromBufferAttribute(position, i)
      if (rebase) _mv.applyMatrix4(_bindRel)
      out.position[o * 3] = _mv.x
      out.position[o * 3 + 1] = _mv.y
      out.position[o * 3 + 2] = _mv.z
      _mv.fromBufferAttribute(normal, i)
      if (rebase) _mv.transformDirection(_bindRel)
      out.normal[o * 3] = _mv.x
      out.normal[o * 3 + 1] = _mv.y
      out.normal[o * 3 + 2] = _mv.z
      out.uv[o * 2] = uv.getX(i)
      out.uv[o * 2 + 1] = uv.getY(i)
      out.skinIndex[o * 4] = skinIndex.getX(i)
      out.skinIndex[o * 4 + 1] = skinIndex.getY(i)
      out.skinIndex[o * 4 + 2] = skinIndex.getZ(i)
      out.skinIndex[o * 4 + 3] = skinIndex.getW(i)
      out.skinWeight[o * 4] = skinWeight.getX(i)
      out.skinWeight[o * 4 + 1] = skinWeight.getY(i)
      out.skinWeight[o * 4 + 2] = skinWeight.getZ(i)
      out.skinWeight[o * 4 + 3] = skinWeight.getW(i)
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i += 1) index[n + i] = g.index.getX(i) + v
      n += g.index.count
    } else {
      for (let i = 0; i < count; i += 1) index[n + i] = v + i
      n += count
    }
    v += count
  }

  const geometry = new BufferGeometry()
  for (const [name, size] of MERGE_ATTRIBUTES) geometry.setAttribute(name, new BufferAttribute(out[name], size))
  geometry.setIndex(new BufferAttribute(index, 1))

  const mesh = new SkinnedMesh(geometry, first.material)
  mesh.name = 'merged_body'
  mesh.position.copy(first.position)
  mesh.quaternion.copy(first.quaternion)
  mesh.scale.copy(first.scale)
  mesh.castShadow = true
  mesh.receiveShadow = true
  first.parent.add(mesh)
  mesh.bind(rig.skeleton, first.bindMatrix)
  // Culled by a sphere measured once (from the bones' current pose), padded for limbs
  // swinging out of it.
  rig.root.updateMatrixWorld(true)
  mesh.computeBoundingSphere()
  mesh.boundingSphere.radius *= 1.5
  // The six come out of the scene graph while merged: hidden, they'd still have their
  // matrices updated every frame.
  for (const part of meshes) {
    part.visible = false
    if (part.parent) {
      rig.detached.push([part, part.parent])
      part.parent.remove(part)
    }
  }
  rig.merged = mesh
  return mesh
}

/** Puts the six separate meshes back (before parts are swapped, or on disposal). */
export function unmergeBody(rig) {
  const mesh = rig?.merged
  if (!mesh) return
  mesh.parent?.remove(mesh)
  mesh.geometry.dispose()
  rig.merged = null
  for (const [part, parent] of rig.detached) parent.add(part)
  rig.detached.length = 0
  for (const part of rig.skinnedMeshes) part.visible = true
}

/** Shows or hides everything the avatar wears (far-away players skip them). */
export function setAccessoriesVisible(rig, visible) {
  if (!rig || rig.detail === visible) return
  rig.detail = visible
  for (const object of rig.accessories) object.visible = visible
}

/**
 * Bloxity textures are authored unflipped and pixel-art filtered.
 *
 * They are also sRGB images. A plain TextureLoader leaves them tagged as linear, which
 * makes three skip the sRGB decode and the avatar renders pale and washed out.
 */
export function configureAvatarTexture(texture) {
  if (!texture) return texture
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

/**
 * Applies the skin texture to every skinned mesh of the base body.
 * The base body ships with an empty texture, so this always runs - with skin "0"
 * standing in when nothing is equipped.
 */
export function applySkin(rig, texture) {
  if (!texture) return
  for (const mesh of rig.skinnedMeshes) {
    if (!mesh.material) continue
    mesh.material.map = texture
    mesh.material.needsUpdate = true
  }
}

/** Puts `geometry` on a part mesh, freeing the remapped copy it replaces. */
function setPartGeometry(rig, slot, geometry, owned) {
  const mesh = rig.partMeshes[slot]
  if (mesh.geometry !== geometry) mesh.geometry = geometry
  const previous = rig.ownedGeometries[slot]
  if (previous && previous !== geometry) previous.dispose()
  if (owned) rig.ownedGeometries[slot] = geometry
  else delete rig.ownedGeometries[slot]
}

/**
 * Swaps a body part's geometry onto its base skinned mesh.
 *
 * A part GLB carries its own skeleton whose bone *order* may differ from the base
 * rig's. Its `skinIndex` attribute therefore has to be remapped by bone name, or the
 * limb deforms against the wrong bones.
 *
 * @param {object} rig from `collectRig`
 * @param {string} slot key of PART_SLOTS
 * @param {import('three').Object3D|null} partScene loaded GLB scene, or null to reset
 */
export function applyPart(rig, slot, partScene) {
  const targetMesh = rig.partMeshes[slot]
  if (!targetMesh) return

  // Unequipped / failed download: restore the part baked into player.glb.
  if (!partScene) {
    const original = rig.originalGeometries[slot]
    if (original) setPartGeometry(rig, slot, original, false)
    return
  }

  let skinnedSource = null
  let plainSource = null
  partScene.traverse((node) => {
    if (node.isSkinnedMesh && !skinnedSource) skinnedSource = node
    else if (node.isMesh && !plainSource) plainSource = node
  })

  if (!skinnedSource) {
    // Some parts ship as plain meshes; use them as-is (shared with the loader cache).
    if (plainSource) setPartGeometry(rig, slot, plainSource.geometry, false)
    return
  }

  const baseSkeleton = rig.skeleton
  if (!baseSkeleton || !skinnedSource.skeleton) {
    setPartGeometry(rig, slot, skinnedSource.geometry, false)
    return
  }

  const geometry = skinnedSource.geometry.clone()

  const baseIndexByName = new Map()
  baseSkeleton.bones.forEach((bone, i) => baseIndexByName.set(bone.name, i))

  const remap = new Map()
  skinnedSource.skeleton.bones.forEach((bone, i) => {
    const baseIndex = baseIndexByName.get(bone.name)
    if (baseIndex !== undefined) remap.set(i, baseIndex)
  })

  const skinIndex = geometry.getAttribute('skinIndex')
  if (skinIndex) {
    const array = skinIndex.array
    for (let i = 0; i < array.length; i += 1) {
      const mapped = remap.get(array[i])
      if (mapped !== undefined) array[i] = mapped
    }
    skinIndex.needsUpdate = true
  }

  setPartGeometry(rig, slot, geometry, true)
}

/* ---------------------------------------------------------------------------
 * Accessories
 * ------------------------------------------------------------------------- */

/**
 * Accessory materials, shared by every avatar wearing the same texture: texture (or
 * null for an item whose texture is missing) -> { front, double }. Bounded by the
 * distinct items seen; never disposed, like the textures in the loader cache.
 */
const accessoryMaterials = new Map()

/** The shared material for an accessory textured with `texture`. */
export function accessoryMaterial(texture, doubleSided = false) {
  const key = texture || null
  let entry = accessoryMaterials.get(key)
  if (!entry) {
    entry = {
      front: new MeshStandardMaterial({ map: key, color: 0xffffff, metalness: 0, roughness: 1 }),
      double: null,
    }
    accessoryMaterials.set(key, entry)
  }
  if (!doubleSided) return entry.front
  if (!entry.double) {
    entry.double = entry.front.clone()
    entry.double.side = DoubleSide
  }
  return entry.double
}

const _origin = new Matrix4()
const _mirror = new Matrix4().makeScale(-1, 1, 1)

function prepare(object) {
  object.traverse((child) => {
    if (child.isMesh) child.castShadow = true
  })
  object.matrixAutoUpdate = false
  return object
}

/** Places `object` under `parent` with a fixed local matrix. */
function fixUnder(parent, object, local) {
  prepare(object)
  object.matrix.copy(local)
  object.matrixWorldNeedsUpdate = true
  parent.add(object)
  return object
}

/**
 * A copy of a hand/shoe mesh for the other side. It is mirrored across x by its
 * matrix, which turns its faces inside out, so it draws both sides. Geometry and
 * materials stay shared.
 */
function mirrored(object) {
  const copy = object.clone(true)
  copy.traverse((child) => {
    if (child.isMesh) child.material = accessoryMaterial(child.material?.map ?? null, true)
  })
  return copy
}

/**
 * Wears `object` (already textured) in `slot` (WORN_SLOTS) on a player.glb avatar.
 * Head and back items sit at the SDK's offsets on their bone; neck, chest and waist at
 * restInverse(bone) * translate(origin), so they follow the bone (shoulder width and
 * torso scale move the bones, so they follow those too); hands and shoes go on as a
 * pair that follows the bones' position and rotation only. Returns everything added.
 */
export function attachAccessory(rig, slot, object) {
  const cfg = WORN_SLOTS[slot]
  if (!cfg || !object) return []
  const bone = rig.bones[cfg.bone]?.bone
  if (!bone) return []
  if (cfg.local) return [fixUnder(bone, object, _origin.makeTranslation(...cfg.local))]
  const rest = rig.restInverse[cfg.bone]
  if (!rest) return []
  const local = new Matrix4().copy(rest).multiply(_origin.makeTranslation(...cfg.origin))
  if (!cfg.mirror) return [fixUnder(bone, object, local)]
  const localR = new Matrix4()
    .copy(rig.restInverse[cfg.mirror] ?? rest)
    .multiply(_mirror)
    .multiply(_origin.makeTranslation(...cfg.origin))
  return wearPair(rig, cfg, object, local, localR)
}

function wearPair(rig, cfg, object, localL, localR) {
  const holder = rig.root.parent ?? rig.root
  const out = []
  for (const [boneName, item, local] of [
    [cfg.bone, object, localL],
    [cfg.mirror, mirrored(object), localR],
  ]) {
    const bone = rig.bones[boneName]?.bone
    if (!bone) continue
    prepare(item)
    holder.add(item)
    rig.followers.push({ object: item, bone, local })
    out.push(item)
  }
  return out
}

/**
 * A custom character (the player's own uploaded one, see PlayerAvatar) wearing `object`
 * in `slot`. `character` is the SDK's description ({ rig: { anchors, ... } }) and
 * `baseRestInverse` player.glb's rest inverses: the items keep their player.glb
 * placement, fitted to the character.
 *   - head, back, neck, chest, waist: local = M * placement in player.glb model space,
 *     M from the SDK's characterAccessoryMatrix(character, bone) (or, for an older
 *     character without one, scale(anchor) * the usual local).
 *   - hands, shoes: scale(anchor) * restInverse(player.glb bone) * translate(origin).
 */
export function attachToCharacter(rig, slot, object, character, baseRestInverse, accessoryMatrix) {
  const cfg = WORN_SLOTS[slot]
  if (!cfg || !object) return []
  const bone = rig.bones[cfg.bone]?.bone
  if (!bone) return []
  const anchor = (name) => {
    const a = character?.rig?.anchors?.[name]
    const s = Array.isArray(a) ? a : Number.isFinite(a) ? [a, a, a] : [1, 1, 1]
    return new Matrix4().makeScale(s[0] ?? 1, s[1] ?? 1, s[2] ?? 1)
  }
  const origin = cfg.origin ?? [0, 0, 0]
  if (cfg.mirror) {
    const restL = baseRestInverse[cfg.bone]
    const restR = baseRestInverse[cfg.mirror] ?? restL
    if (!restL) return []
    const localL = anchor(cfg.bone).multiply(restL).multiply(_origin.makeTranslation(...origin))
    const localR = anchor(cfg.mirror).multiply(restR).multiply(_mirror).multiply(_origin.makeTranslation(...origin))
    return wearPair(rig, cfg, object, localL, localR)
  }
  const placement = new Matrix4().makeTranslation(...(cfg.model ?? origin))
  const m = accessoryMatrix?.(character, cfg.bone)
  if (Array.isArray(m) && m.length === 16) return [fixUnder(bone, object, new Matrix4().fromArray(m).multiply(placement))]
  // Older character: the anchor's scale on the usual local.
  const usual = cfg.local
    ? new Matrix4().makeTranslation(...cfg.local)
    : new Matrix4().copy(baseRestInverse[cfg.bone] ?? new Matrix4()).multiply(_origin.makeTranslation(...origin))
  return [fixUnder(bone, object, anchor(cfg.bone).multiply(usual))]
}

const _fp = new Vector3()
const _fq = new Quaternion()
const _fs = new Vector3()
const _one = new Vector3(1, 1, 1)
const _holderInv = new Matrix4()
const _fm = new Matrix4()

/**
 * Hands and shoes: each frame, compose(bone position, bone rotation, scale 1) * local,
 * in the space of the object holding them - so they ride the limb without being
 * stretched by arm length or height. Run after the pose (and the emote).
 */
export function placeFollowers(rig) {
  const followers = rig.followers
  if (followers.length === 0) return
  const holder = followers[0].object.parent
  if (!holder) return
  holder.updateWorldMatrix(true, false)
  _holderInv.copy(holder.matrixWorld).invert()
  for (const f of followers) {
    f.bone.updateWorldMatrix(true, false)
    _fm.multiplyMatrices(_holderInv, f.bone.matrixWorld).decompose(_fp, _fq, _fs)
    f.object.matrix.compose(_fp, _fq, _one).multiply(f.local)
    f.object.matrixWorldNeedsUpdate = true
  }
}

/**
 * Applies Bloxity body proportions.
 *
 * Must run every frame: each bone is reset to its rest transform before the
 * multipliers are re-applied, which is what makes the result idempotent and lets
 * proportion changes take effect live.
 *
 * `height`, `armLength`, `headScale` and `neckHeight` are applied exactly as the
 * Bloxity portal does, so the in-game body matches the preview. The remaining three
 * (`shoulderWidth`, `torsoScaleX`, `legOffsetX`) are not implemented in the SDK's
 * preview renderer; they are applied here in the spirit of their names and are the
 * ones to sanity-check against the portal.
 *
 * `proportions` may be null (a custom character takes none): every bone is still
 * reset to its rest pose, which is what keeps the per-frame posing from piling up.
 */
export function applyProportions(rig, proportions) {
  const skeleton = rig.skeleton
  if (!skeleton) return
  const p = proportions || NO_PROPORTIONS

  const height = p.height ?? 1
  const armLength = p.armLength ?? 1
  const headScale = p.headScale ?? 1
  const neckHeight = p.neckHeight ?? 1
  const shoulderWidth = p.shoulderWidth ?? 1
  const torsoScaleX = p.torsoScaleX ?? 1
  const legOffsetX = p.legOffsetX ?? 1

  // Overall height is a scale on the character root, not on a bone.
  rig.root.scale.set(1, height, 1)

  const bones = skeleton.bones
  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i]
    const rest = rig.bones[bone.name]
    if (!rest) continue

    const { origScale, origPos, origQuat, kind } = rest
    bone.position.copy(origPos)
    bone.quaternion.copy(origQuat)
    bone.scale.copy(origScale)

    if (kind === KIND_ARM || kind === KIND_SHOULDER) {
      bone.scale.y = origScale.y * armLength
      // Not in the SDK preview: widen the shoulders by pushing the arm roots out.
      if (kind === KIND_SHOULDER) bone.position.x = origPos.x * shoulderWidth
    } else if (kind === KIND_NECK) {
      // Keeps the head sitting on the neck as height/headScale change, then applies
      // neckHeight against the bind-pose offset.
      bone.position.y += (height - headScale) * origPos.y
      bone.position.y += rig.neckOffsetBindY * (neckHeight - 1) * 0.8
    } else if (kind === KIND_HEAD) {
      // Divided by height so the head stays uniform inside the stretched root.
      bone.scale.set(
        origScale.x * headScale,
        origScale.y * (headScale / height),
        origScale.z * headScale,
      )
    } else if (kind === KIND_CHEST) {
      // Not in the SDK preview: torso width.
      bone.scale.x = origScale.x * torsoScaleX
    } else if (kind === KIND_HIP) {
      // Not in the SDK preview: leg splay, mirrored about the rig centre.
      bone.position.x = origPos.x * legOffsetX
    }
  }
}

// What applyProportions does to each bone, by name.
const KIND_NONE = 0
const KIND_ARM = 1
const KIND_SHOULDER = 2
const KIND_NECK = 3
const KIND_HEAD = 4
const KIND_CHEST = 5
const KIND_HIP = 6

function boneKind(name) {
  if (name === 'ArmL_Offset' || name === 'ArmR_Offset') return KIND_SHOULDER
  if (name.startsWith('Arm')) return KIND_ARM
  if (name === NECK_OFFSET_BONE) return KIND_NECK
  if (name === HAT_BONE) return KIND_HEAD
  if (name === BACK_BONE) return KIND_CHEST
  if (name === 'LegL_Offset' || name === 'LegR_Offset') return KIND_HIP
  return KIND_NONE
}

const NO_PROPORTIONS = Object.freeze({})

/* ---------------------------------------------------------------------------
 * Procedural animation
 *
 * player.glb ships zero animation clips, so a walk/run/jump cycle has to be
 * driven directly on the bones. Rotations are *multiplied onto* whatever
 * applyProportions() just wrote, so this must run immediately after it in the
 * same frame - proportions reset each bone to its rest pose, which is exactly
 * the clean base a pose needs.
 * ------------------------------------------------------------------------- */

const _animQ = new Quaternion()

/**
 * Rotates a bone about one of its precomputed character-space axes.
 * `which` is 'axisX' (forward/back swing) or 'axisZ' (lateral sway).
 *
 * Signs, in character space (it faces +Z): a positive swing moves a hanging limb's end
 * backwards (-Z); a positive sway moves it towards +X - outwards for an L limb on
 * player.glb, inwards for an R one.
 */
function rotateBone(rig, name, which, angle) {
  if (!angle) return
  const entry = rig.bones[name]
  const axis = entry?.[which]
  if (!axis) return
  entry.bone.quaternion.multiply(_animQ.setFromAxisAngle(axis, angle))
}

/** Swing a limb forward/back - the plane a walk cycle actually moves in. */
const swing = (rig, name, angle) => rotateBone(rig, name, 'axisX', angle)
/** Sway a limb out to the side. */
const sway = (rig, name, angle) => rotateBone(rig, name, 'axisZ', angle)
/** Twist a bone about the character's vertical. */
const twist = (rig, name, angle) => rotateBone(rig, name, 'axisY', angle)

const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t))
const BONES = ['Spine1', 'Neck1', 'ArmL1', 'ArmL2', 'ArmR1', 'ArmR2', 'LegL1', 'LegL2', 'LegR1', 'LegR2']
/** Per-bone angles for this frame: [swing, sway, twist]. Module scratch, reused. */
const POSE = Object.fromEntries(BONES.map((b) => [b, [0, 0, 0]]))

function resetPose() {
  for (const b of BONES) {
    const a = POSE[b]
    a[0] = 0
    a[1] = 0
    a[2] = 0
  }
}

/** Adds `w` x (swing, sway, twist) to bone `b`. */
function add(b, w, x, z = 0, y = 0) {
  if (w <= 0) return
  const a = POSE[b]
  a[0] += x * w
  a[1] += z * w
  a[2] += y * w
}

/* Idle stance, in radians unless noted. Feet about shoulder width apart: each leg
 * tips out by STANCE_SPREAD (the soles end up ~0.6 units apart, the legs no longer
 * touching), the shins take back STANCE_KNEE of that so the feet sit nearly flat. The
 * weight shift slides the hips sideways by up to WEIGHT_SHIFT rig units while the legs
 * lean to keep the feet planted; it stays well under the spread, so a leg never tips
 * past vertical towards the other one - however the walk blends in. */
const STANCE_SPREAD = 0.13
const STANCE_KNEE = 0.6
const ARM_HANG = 0.1
const WEIGHT_SHIFT = 0.1
const WEIGHT_SHIFT_RATE = 1.25
const BREATH_RATE = 1.6

/* ---------------------------------------------------------------------------
 * Throw and training: keyed poses with easing
 *
 * Both actions are short sequences of full-body key poses, blended pose to pose with
 * easing curves (no linear snaps). A pose is CHANNELS numbers (see addPose); the tables
 * are built once, and sampling writes into a module scratch array, so nothing allocates
 * per frame. Remote players are posed by the same code from the synced action time, so
 * they throw and train exactly as their owner sees it.
 * ------------------------------------------------------------------------- */

const CHANNELS = 16
const CH = {
  armR1: 0, armR1s: 1, armR2: 2, armL1: 3, armL1s: 4, armL2: 5, spine: 6, spineTw: 7, spineSway: 8,
  neck: 9, neckTw: 10, legL1: 11, legL2: 12, legR1: 13, legR2: 14, bob: 15,
}
function pose(values) {
  const out = new Float32Array(CHANNELS)
  for (const [key, v] of Object.entries(values)) out[CH[key]] = v
  return out
}
const _target = new Float32Array(CHANNELS)

/** Adds pose `p` at weight `w` (swing / sway / twist per bone); returns its body bob. */
function addPose(p, w) {
  add('ArmR1', w, p[0], p[1])
  add('ArmR2', w, p[2])
  add('ArmL1', w, p[3], p[4])
  add('ArmL2', w, p[5])
  add('Spine1', w, p[6], p[8], p[7])
  add('Neck1', w, p[9], 0, p[10])
  add('LegL1', w, p[11])
  add('LegL2', w, p[12])
  add('LegR1', w, p[13])
  add('LegR2', w, p[14])
  return p[15] * w
}

/** out = a -> b at eased progress e. */
function blendPose(out, a, b, e) {
  for (let i = 0; i < CHANNELS; i += 1) out[i] = a[i] + (b[i] - a[i]) * e
  return out
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const easeOutCubic = (x) => 1 - (1 - x) ** 3
const easeInCubic = (x) => x * x * x
const easeInOutSine = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x)
const smoothstep = (x) => x * x * (3 - 2 * x)

const REST = pose({})

/* The throw (right arm, overhand), facing down the stairs. The bottle leaves the hand
 * at THROW_WINDUP (shared with the staircase's flight start), so the whip lands on it. */
const T_COIL = 0.13
const T_HOLD = 0.24
const T_RELEASE = THROW_WINDUP
const T_FOLLOW = T_RELEASE + 0.24
const T_SETTLE = T_FOLLOW + 0.4
/** Crouch, lean back, twist away, bottle drawn back over the shoulder, left arm aiming. */
const THROW_COIL = pose({
  armR1: -3.0, armR1s: 0.2, armR2: -1.35, armL1: -1.35, armL1s: 0.25, armL2: -0.3, spine: 0.24, spineTw: 0.6,
  spineSway: 0.06, neckTw: -0.45, legL1: -0.4, legL2: 0.5, legR1: -0.2, legR2: 0.65, bob: -0.2,
})
/** The brief hold at the top: coiled a little further. */
const THROW_HOLD = pose({
  armR1: -3.25, armR1s: 0.22, armR2: -1.45, armL1: -1.45, armL1s: 0.3, armL2: -0.35, spine: 0.28, spineTw: 0.68,
  spineSway: 0.07, neckTw: -0.52, legL1: -0.45, legL2: 0.55, legR1: -0.22, legR2: 0.7, bob: -0.22,
})
/** Release: arm out in front at full stretch, weight onto the front foot, hips through. */
const THROW_RELEASE = pose({
  armR1: -1.45, armR1s: 0.05, armR2: -0.1, armL1: -0.25, armL1s: -0.45, armL2: -0.7, spine: -0.36, spineTw: -0.45,
  spineSway: -0.04, neck: 0.12, neckTw: 0.3, legL1: -0.6, legL2: 0.35, legR1: 0.42, legR2: 0.3, bob: -0.06,
})
/** Follow-through: arm across the body, torso round, back leg kicking up in a hop. */
const THROW_FOLLOW = pose({
  armR1: -0.35, armR1s: 0.65, armR2: -0.35, armL1: 0.3, armL1s: -0.2, armL2: -0.35, spine: -0.5, spineTw: -0.78,
  spineSway: -0.06, neck: 0.25, neckTw: 0.5, legL1: -0.5, legL2: 0.3, legR1: 0.9, legR2: 1.0, bob: 0.1,
})
/** Settled, watching it go (then the idle stance takes over). */
const THROW_SETTLE = pose({
  armR1: -0.15, armR1s: 0.12, armR2: -0.1, armL1: -0.05, armL2: -0.1, spine: -0.1, spineTw: -0.15, neck: 0.1,
  neckTw: 0.1, legL1: -0.1, legL2: 0.15, legR1: 0.05, legR2: 0.1, bob: -0.02,
})

/** The throw's pose `t` seconds after it started. */
function throwPose(out, t) {
  if (t < T_COIL) return blendPose(out, REST, THROW_COIL, easeOutCubic(clamp01(t / T_COIL)))
  if (t < T_HOLD) return blendPose(out, THROW_COIL, THROW_HOLD, smoothstep((t - T_COIL) / (T_HOLD - T_COIL)))
  // The whip accelerates into the release.
  if (t < T_RELEASE) return blendPose(out, THROW_HOLD, THROW_RELEASE, easeInCubic((t - T_HOLD) / (T_RELEASE - T_HOLD)))
  if (t < T_FOLLOW) return blendPose(out, THROW_RELEASE, THROW_FOLLOW, easeOutCubic((t - T_RELEASE) / (T_FOLLOW - T_RELEASE)))
  return blendPose(out, THROW_FOLLOW, THROW_SETTLE, easeInOutSine(clamp01((t - T_FOLLOW) / (T_SETTLE - T_FOLLOW))))
}

/** How much of the throw layer shows: all of it, then it eases back into idle. */
function throwEnvelope(t) {
  return 1 - smoothstep(clamp01((t - T_SETTLE) / 0.45))
}

/* Training (right arm, underhand), facing the pit. A fresh bottle is tossed every few
 * reps (PitBottle: onto the first step, then one hop per rep down to the floor); in
 * between you crouch, hands on knees, and bob with each bounce; as the last hop lands
 * you straighten, take the next bottle and swing back, timed to the next rep. Every
 * duration scales with the rep interval (Quick Reps makes it all snappier). */
/** Bottle held in front, ready. */
const TRAIN_READY = pose({
  armR1: -0.9, armR2: -0.9, armL1: -0.3, armL1s: 0.2, spine: -0.08, neck: 0.15,
  legL1: -0.12, legL2: 0.25, legR1: -0.12, legR2: 0.25, bob: -0.04,
})
/** Knees bent, arm swung back low: about to toss. */
const TRAIN_BACK = pose({
  armR1: 0.6, armR1s: -0.08, armR2: -0.2, armL1: -0.6, armL1s: 0.25, armL2: -0.2, spine: -0.22, spineTw: 0.2,
  neck: 0.2, neckTw: -0.1, legL1: -0.35, legL2: 0.7, legR1: -0.35, legR2: 0.7, bob: -0.14,
})
/** Release: arm through to the front, knees driving up. */
const TRAIN_RELEASE = pose({
  armR1: -1.5, armR2: -0.3, armL1: -0.2, armL1s: 0.15, spine: -0.05, spineTw: -0.15, neck: 0.2,
  legL1: -0.1, legL2: 0.2, legR1: -0.1, legR2: 0.2,
})
/** Follow-through: arm high, up on the toes, watching it fly. */
const TRAIN_FOLLOW = pose({
  armR1: -2.1, armR2: -0.4, armL1: 0.1, armL1s: 0.3, spine: 0.06, spineTw: -0.2, neck: 0.25, bob: 0.04,
})
/** Hands on knees, watching the bottle bounce down. */
const TRAIN_WATCH = pose({
  armR1: -0.55, armR1s: 0.15, armR2: -0.5, armL1: -0.55, armL1s: -0.15, armL2: -0.5, spine: -0.45, neck: -0.25,
  legL1: -0.3, legL2: 0.55, legR1: -0.3, legR2: 0.55, bob: -0.12,
})
/** PitBottle's hop time and floor rest: when the next fresh bottle can go. */
const PIT_HOP = 0.42
const PIT_REST = 0.3
/** Hops down the pit (6 steps and the floor) before the next toss. */
const PIT_HOPS = 6

/**
 * The training pose: `tossTime` since the last fresh toss, and from `motion` the time
 * since the last rep (`repTime`), hops since the toss (`trainHops`; PIT_HOPS or more =
 * the next rep tosses a new bottle) and the rep interval.
 */
function trainPose(out, motion, tossTime) {
  const interval = motion.interval || TRAIN_INTERVAL
  const s = Math.min(1, Math.max(0.55, interval / TRAIN_INTERVAL))
  const t = tossTime / s
  if (t < 0.55) {
    if (t < 0.07) return blendPose(out, TRAIN_BACK, TRAIN_RELEASE, easeOutCubic(t / 0.07))
    if (t < 0.22) return blendPose(out, TRAIN_RELEASE, TRAIN_FOLLOW, easeOutCubic((t - 0.07) / 0.15))
    return blendPose(out, TRAIN_FOLLOW, TRAIN_WATCH, easeInOutSine((t - 0.22) / 0.33))
  }
  const rep = motion.repTime ?? 9
  if ((motion.trainHops ?? PIT_HOPS) >= PIT_HOPS) {
    // The last hop is landing: stand up, take the next bottle, swing back for the toss.
    const tossAt = Math.max(interval, PIT_HOP + PIT_REST)
    const back = Math.min(0.18, tossAt * 0.35)
    if (rep < tossAt - back) blendPose(out, TRAIN_WATCH, TRAIN_READY, smoothstep(clamp01((rep - PIT_HOP * 0.6) / 0.25)))
    else blendPose(out, TRAIN_READY, TRAIN_BACK, easeOutCubic(clamp01((rep - (tossAt - back)) / back)))
    return out
  }
  // Watching: a little bob and nod with every bounce.
  out.set(TRAIN_WATCH)
  const beat = 0.35 * s
  const bump = rep < beat ? Math.sin((Math.PI * rep) / beat) : 0
  out[CH.bob] -= 0.05 * bump
  out[CH.legL2] += 0.12 * bump
  out[CH.legR2] += 0.12 * bump
  out[CH.legL1] -= 0.06 * bump
  out[CH.legR1] -= 0.06 * bump
  out[CH.neck] += 0.12 * bump
  out[CH.armR1] -= 0.25 * bump
  out[CH.spine] -= 0.05 * bump
  return out
}

/**
 * Poses the rig for the current motion state, as a blend of layers - walk, idle, air,
 * training toss, throw, landing - whose weights ease in and out, so nothing ever snaps
 * from one pose to the next.
 *
 * @param {object} rig from `collectRig`
 * @param {{ time: number, speed: number, grounded: boolean, maxSpeed: number,
 *           action?: string, actionTime?: number, tossTime?: number, vy?: number }} motion
 */
export function animateRig(rig, motion) {
  if (!rig?.skeleton || !motion) return

  const { time = 0, speed = 0, grounded = true, maxSpeed = 6, action = 'idle', actionTime = 0, tossTime = 9, vy = 0, cheer = 0, sprint = 0 } = motion
  // Blend state lives on the rig: one per character.
  const st = rig.anim || (rig.anim = { last: time, ratio: 0, air: 0, train: 0, throw: 0, landing: 0, phase: 0, cheer: 0, sprint: 0 })
  const dt = Math.min(0.1, Math.max(0, time - st.last))
  st.last = time

  const ease = (rate) => 1 - Math.exp(-rate * dt)
  const ratioTarget = Math.min(speed / Math.max(maxSpeed, 0.001), 1)
  const wasAir = st.air
  st.ratio = lerp(st.ratio, ratioTarget, ease(12))
  st.air = lerp(st.air, grounded ? 0 : 1, ease(grounded ? 18 : 10))
  st.train = lerp(st.train, action === 'train' ? 1 : 0, ease(10))
  // The throw plays out, then hands back to the idle stance while the bottle tumbles.
  st.throw = lerp(st.throw, action === 'throw' ? throwEnvelope(actionTime) : 0, ease(18))
  st.cheer = lerp(st.cheer, cheer > 0 ? 1 : 0, ease(10))
  // Sprinting: a deeper lean, longer strides and pumping arms on top of the run.
  st.sprint = lerp(st.sprint || 0, sprint > 0 && speed > 0.5 ? 1 : 0, ease(6))
  if (wasAir > 0.5 && grounded) st.landing = 1
  st.landing = Math.max(0, st.landing - dt * 4)
  // Step frequency rises with speed so a sprint doesn't look like a moonwalk.
  st.phase += dt * (5 + st.ratio * 5 + st.sprint * 2.5)

  const ratio = st.ratio
  const busy = Math.max(st.train, st.throw)
  const ground = (1 - st.air) * (1 - busy) * (1 - st.cheer)
  const walkW = ground * ratio
  const idleW = ground * (1 - ratio)
  const airW = st.air * (1 - busy)
  resetPose()
  let bob = 0
  let shift = 0

  // --- Walk / run -------------------------------------------------------------------
  if (walkW > 0.001) {
    const c = Math.sin(st.phase)
    const sp = st.sprint || 0
    const legAmp = (0.85 + 0.25 * sp) * ratio
    const armAmp = (0.7 + 0.4 * sp) * ratio
    const knee = (1.1 + 0.45 * sp) * ratio
    add('LegL1', walkW, c * legAmp)
    add('LegR1', walkW, -c * legAmp)
    add('LegL2', walkW, Math.max(0, -c) * knee)
    add('LegR2', walkW, Math.max(0, c) * knee)
    add('ArmL1', walkW, -c * armAmp, -0.06)
    add('ArmR1', walkW, c * armAmp, 0.06)
    // Elbows bend more the harder you run: pumping arms when sprinting.
    add('ArmL2', walkW, (Math.max(0, c) * 0.5 + sp * 0.35) * ratio)
    add('ArmR2', walkW, (Math.max(0, -c) * 0.5 + sp * 0.35) * ratio)
    // Lean into the run, swing the hips, counter with the head.
    add('Spine1', walkW, -(0.14 + 0.16 * sp) * ratio, 0, c * (0.1 + 0.04 * sp) * ratio)
    add('Neck1', walkW, (0.06 + 0.1 * sp) * ratio, 0, -c * 0.08 * ratio)
    bob += walkW * Math.abs(Math.cos(st.phase)) * (0.18 + 0.08 * sp) * ratio
  }

  // --- Idle: a relaxed A-stance, breathing, a slow weight shift, a look around -------
  if (idleW > 0.001) {
    const out = rig.sideL ?? 1
    const legLength = rig.legLength || 2.4
    const breath = Math.sin(time * BREATH_RATE)
    // Hips drift from one foot to the other; the legs lean back the same distance so
    // the feet stay where they are.
    const hips = Math.sin(time * WEIGHT_SHIFT_RATE) * WEIGHT_SHIFT
    const lean = -Math.asin(Math.max(-1, Math.min(1, hips / legLength)))
    // Each leg's outward tilt: L tips towards +X when out is +1, R the other way.
    add('LegL1', idleW, 0, out * STANCE_SPREAD + lean)
    add('LegR1', idleW, 0, -out * STANCE_SPREAD + lean)
    add('LegL2', idleW, 0, -out * STANCE_SPREAD * STANCE_KNEE)
    add('LegR2', idleW, 0, out * STANCE_SPREAD * STANCE_KNEE)
    // Arms hang a little clear of the body, lifting slightly on each breath.
    const arms = ARM_HANG + breath * 0.02
    add('ArmL1', idleW, 0, out * arms)
    add('ArmR1', idleW, 0, -out * arms)
    // The chest rises with the breath; the upper body leans gently against the hips.
    add('Spine1', idleW, breath * 0.02, hips * 0.15)
    add('Neck1', idleW, Math.sin(time * 0.23) * 0.05, -hips * 0.1, Math.sin(time * 0.37) * Math.sin(time * 0.11) * 0.45)
    shift += idleW * hips
    // Tipping the legs out lifts the soles a touch; drop the body (by the two legs'
    // average) to keep them down. Thigh and shin are half the leg each.
    const spread = STANCE_SPREAD * idleW
    const tilt = lean * idleW
    const knee = spread * STANCE_KNEE
    const reach =
      Math.cos(spread + tilt) + Math.cos(spread + tilt - knee) + Math.cos(spread - tilt) + Math.cos(spread - tilt - knee)
    bob += idleW * breath * 0.03 - (legLength - (legLength / 4) * reach)
  }

  // --- Air: arms up on the way up, out on the way down, legs tucked ------------------
  if (airW > 0.001) {
    const rising = Math.min(1, Math.max(0, vy / 6))
    const arms = -1.2 - rising * 1.1
    add('LegL1', airW, -0.55)
    add('LegL2', airW, 0.8)
    add('LegR1', airW, 0.3)
    add('LegR2', airW, 0.25)
    add('ArmL1', airW, arms, -0.25)
    add('ArmR1', airW, arms, 0.25)
    add('Spine1', airW, -0.1)
  }

  // --- Training: the underhand toss into the pit, then watching it bounce ------------
  if (st.train > 0.001) {
    const smooth = rig.trainPose || (rig.trainPose = new Float32Array(CHANNELS))
    trainPose(_target, motion, tossTime)
    // Lightly smoothed, so an early or late rep never snaps the body.
    const k = ease(28)
    for (let i = 0; i < CHANNELS; i += 1) smooth[i] += (_target[i] - smooth[i]) * k
    bob += addPose(smooth, st.train)
  }

  // --- Throw: coil, whip, release, follow through, settle ------------------------------
  if (st.throw > 0.001) {
    throwPose(_target, actionTime)
    bob += addPose(_target, st.throw)
  }

  // --- Cheer: both arms up, waving, little hops ----------------------------------------
  if (st.cheer > 0.001) {
    const w = st.cheer * (1 - busy)
    const wave = Math.sin(time * 14)
    const hop = Math.abs(Math.sin(time * 7))
    add('ArmL1', w, -2.7 + wave * 0.25, -0.35)
    add('ArmR1', w, -2.7 - wave * 0.25, 0.35)
    add('ArmL2', w, -0.3)
    add('ArmR2', w, -0.3)
    add('Spine1', w, 0.08)
    add('Neck1', w, -0.15)
    add('LegL2', w, 0.25 * (1 - hop))
    add('LegR2', w, 0.25 * (1 - hop))
    bob += w * hop * 0.22
  }

  // --- Landing: a quick squat ---------------------------------------------------------
  if (st.landing > 0.001) {
    const k = Math.sin(st.landing * Math.PI)
    add('LegL1', 1, -0.35 * k)
    add('LegR1', 1, -0.35 * k)
    add('LegL2', 1, 0.7 * k)
    add('LegR2', 1, 0.7 * k)
    add('Spine1', 1, -0.12 * k)
    bob -= 0.16 * k
  }

  for (const b of BONES) {
    const a = POSE[b]
    swing(rig, b, a[0])
    sway(rig, b, a[1])
    twist(rig, b, a[2])
  }
  rig.root.position.x = rig.rootRestX + shift
  rig.root.position.y = rig.rootRestY + bob
}

/* ---------------------------------------------------------------------------
 * Emotes
 *
 * A Boxity emote clip gives, per bone, keys `[time, xDeg, yDeg, zDeg]`: rotation
 * deltas over the BIND pose, as an XYZ euler right-multiplied onto the bone's bind
 * quaternion (`bind * euler(x, y, z)`). Between keys the value eases with a smoothstep;
 * before the first key / after the last it holds that key. A looping clip wraps its
 * time on `len`.
 *
 * Runs after animateRig: each emoted bone is blended from the procedural pose towards
 * the emote pose by the player's weight, which ramps over EMOTE_BLEND seconds in and
 * out. Bones the clip doesn't name keep the procedural pose; bones the rig doesn't have
 * are ignored. The body's bob and weight shift fade out under an emote, since clips
 * carry no root motion.
 * ------------------------------------------------------------------------- */

const EMOTE_BLEND = 0.1
const DEG = Math.PI / 180
const _emoteEuler = new Euler(0, 0, 0, 'XYZ')
const _emoteQ = new Quaternion()
const _emoteTarget = new Quaternion()

/** Per-avatar playback state for `updateEmote`. Allocate once per avatar. */
export function createEmotePlayer() {
  return { id: null, seq: 0, clip: null, time: 0, weight: 0 }
}

/** Writes the clip's value for one track at `t` into _emoteEuler (radians). */
function sampleTrack(keys, t) {
  const last = keys.length - 1
  let a = keys[0]
  let b = keys[0]
  let s = 0
  if (t >= keys[last][0]) {
    a = keys[last]
    b = a
  } else if (t > keys[0][0]) {
    let i = 1
    while (i < last && keys[i][0] <= t) i += 1
    a = keys[i - 1]
    b = keys[i]
    const span = b[0] - a[0]
    s = span > 0 ? (t - a[0]) / span : 1
    s = s * s * (3 - 2 * s)
  }
  _emoteEuler.set((a[1] + (b[1] - a[1]) * s) * DEG, (a[2] + (b[2] - a[2]) * s) * DEG, (a[3] + (b[3] - a[3]) * s) * DEG, 'XYZ')
}

/**
 * Advances `player` (from createEmotePlayer) towards emote `id` (null = none) and poses
 * the rig with it. `getClip(id)` looks a clip up in the catalog (bloxity/emotes.js);
 * an id it doesn't know is treated as no emote until it does. A new `seq` with the same
 * id plays it again from the start (the same emote picked twice).
 */
export function updateEmote(rig, player, id, delta, getClip, seq = 0) {
  if (!rig?.skeleton || !player) return
  const want = id || null
  if (want !== player.id || (want && seq !== player.seq)) {
    const clip = want ? getClip(want) : null
    player.seq = seq
    if (clip) {
      // A new emote blends in from wherever the body is now.
      player.id = want
      player.clip = clip
      player.time = 0
      player.weight = 0
    } else {
      player.id = null
    }
  }

  if (player.id) {
    player.time += delta
    player.weight = Math.min(1, player.weight + delta / EMOTE_BLEND)
  } else {
    player.weight = Math.max(0, player.weight - delta / EMOTE_BLEND)
    if (player.weight === 0) player.clip = null
  }
  const clip = player.clip
  if (!clip || player.weight <= 0) return

  const t = clip.loop ? player.time % clip.len : player.time
  const w = player.weight * player.weight * (3 - 2 * player.weight)
  const tracks = clip.tracks
  for (let i = 0; i < tracks.length; i += 1) {
    const entry = rig.bones[tracks[i].bone]
    if (!entry) continue
    sampleTrack(tracks[i].keys, t)
    _emoteTarget.copy(entry.origQuat).multiply(_emoteQ.setFromEuler(_emoteEuler))
    if (w >= 1) entry.bone.quaternion.copy(_emoteTarget)
    else entry.bone.quaternion.slerp(_emoteTarget, w)
  }
  const root = rig.root
  root.position.x = rig.rootRestX + (root.position.x - rig.rootRestX) * (1 - w)
  root.position.y = rig.rootRestY + (root.position.y - rig.rootRestY) * (1 - w)
}
