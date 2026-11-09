import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box3, MeshStandardMaterial, Vector3 } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

import {
  assetUrls,
  baseBodyUrl,
  isRealId,
  PART_SLOTS,
  skinCompositeUrl,
  skinIdOrDefault,
  WORN_SLOTS,
} from '../bloxity/avatarAssets'
import { loadCharacterGLB, loadOBJ, loadPartGLB, loadTexture } from '../bloxity/avatarLoader'
import { useBloxity } from '../bloxity/BloxityContext'
import { getEmoteClip, localEmote } from '../bloxity/emotes'
import { getSDK, safeCall } from '../bloxity/sdk'
import { DEFAULT_PROPORTIONS } from '../bloxity/store'
import {
  accessoryMaterial,
  animateRig,
  applyPart,
  applyProportions,
  applySkin,
  attachAccessory,
  attachToCharacter,
  collectRig,
  createEmotePlayer,
  disposeRig,
  mergeBody,
  placeFollowers,
  restInverses,
  setAccessoriesVisible,
  unmergeBody,
  updateEmote,
} from './avatarRig'
import { PLAYER_HEIGHT } from './playerSize'

/**
 * Keeps the avatar breathing when it is rendered outside the game (a menu preview,
 * say) with no physics body feeding it motion.
 */
const _idleMotion = { time: 0, speed: 0, grounded: true, maxSpeed: 6 }
function fallbackMotion(delta) {
  _idleMotion.time += delta
  return _idleMotion
}

/**
 * A Bloxity avatar wearing `equipped` with `proportions`, assembled at runtime: yours,
 * or another player's from what the server tells us they wear.
 *
 * `player.glb` is the base humanoid rig: six skinned meshes (head, torso, two arms,
 * two legs) sharing one skeleton. Assembly means, per equipped slot:
 *   - body parts  -> swap the matching mesh's geometry
 *   - skin        -> set one texture as the map on every skinned mesh (with the
 *                    face, shirt and pants composited on by the server)
 *   - worn items  -> hat, hair and mask on Neck1; back on Spine2; neck, chest and
 *                    waist on their bones; hands and shoes as mirrored pairs (see
 *                    WORN_SLOTS and avatarRig.attachAccessory)
 *
 * Any slot that is unequipped or 404s leaves the base body's own part in place (or
 * nothing, for a worn item), and never holds up `onReady`. The whole thing
 * re-assembles when `equipped` changes, so changing cosmetics in the Bloxity portal
 * updates the character live.
 *
 * A player wearing their own uploaded character (`equipped.characterId`) gets that GLB
 * instead of player.glb - same 22 bones, so every pose and emote plays on it - with no
 * skin, body parts or proportions, and their accessories fitted to it. If it can't be
 * found or loaded, the regular avatar shows. `local` says whether this is your own
 * avatar (the SDK describes yours and other players' characters differently).
 *
 * Once assembled, the six body parts are merged into one skinned mesh (one draw call
 * instead of six; avatarRig.mergeBody).
 *
 * @param {{ equipped?: object, proportions?: object, game?: object, onReady?: () => void,
 *   targetHeight?: number, motionRef?: object, emoteSource?: () => object,
 *   local?: boolean, poserRef?: { current: object } }} props
 *   `motionRef.current` is the motion state animateRig poses the body from; its
 *   `emote` / `emoteSeq` fields (a Boxity emote id or null, and a counter that replays
 *   it) play that emote over the pose. `emoteSource`, if given, is asked for
 *   `{ emote, emoteSeq }` every frame instead (your own avatar uses it).
 *   `targetHeight` is the world-space height to fit the avatar into, in the game's
 *   own units. Bloxity authors the rig ~6.4 units tall with the feet at y=0, which is
 *   far bigger than a metric-scale physics capsule, so the model is measured and
 *   rescaled rather than trusted at native size.
 *   `poserRef`, if given, hands posing to the caller: the avatar then has no frame loop
 *   of its own and `poserRef.current` is `{ rig, isReady(), reset(), animate(delta,
 *   motion), setDetail(on) }` - other players are all posed from one loop that way, in
 *   a known order, and the far ones not at all.
 */
export const BloxityAvatar = forwardRef(function BloxityAvatar(
  { equipped, proportions, game, onReady, targetHeight = PLAYER_HEIGHT, motionRef, emoteSource, local = false, poserRef, ...props },
  ref,
) {
  const { scene: baseScene } = useGLTF(baseBodyUrl())
  const [assembled, setAssembled] = useState(false)
  /** The same, readable from a frame loop (poserRef.isReady). */
  const assembledRef = useRef(false)
  /** Their own uploaded character, once loaded: { info, scene }; null = player.glb. */
  const custom = useCustomCharacter(equipped, local)

  // The GLTF cache hands back one shared scene. Clone via SkeletonUtils so this
  // instance gets an independent, still-working skeleton.
  const character = useMemo(() => cloneSkeleton(custom?.scene ?? baseScene), [custom, baseScene])
  // player.glb's rest pose, captured as it loads: hands and shoes on a custom
  // character are placed from it.
  const baseRest = useMemo(() => restInverses(baseScene), [baseScene])

  // Rig lookup tables (bones, part meshes, pristine geometries) built once per clone.
  const rig = useMemo(() => {
    const collected = collectRig(character)

    // The base body ships with an empty texture; give every skinned mesh its own
    // material instance so a skin swap here can't leak into another avatar. A custom
    // character keeps its own texture.
    for (const mesh of collected.skinnedMeshes) {
      mesh.material = new MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 1,
        map: custom ? (mesh.material?.map ?? null) : null,
      })
    }

    if (!collected.skeleton) {
      console.warn('[bloxity] avatar has no skeleton - it will not deform')
    }
    return collected
  }, [character, custom])

  // Measured once, from player.glb's bind pose, before proportions touch the root
  // scale. A custom character uses the same fit: both are 6.4-unit rigs, feet at y 0.
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(baseScene)
    const size = box.getSize(new Vector3())
    if (!Number.isFinite(size.y) || size.y <= 0) return { scale: 1, footOffset: 0 }
    const scale = targetHeight / size.y
    // The rig's feet sit at its bbox minimum; drop the group so they land on y=0
    // of the parent (which Player positions at the bottom of the capsule).
    return { scale, footOffset: -box.min.y * scale }
  }, [baseScene, targetHeight])

  // --- Assemble equipped cosmetics --------------------------------------------
  useEffect(() => {
    let cancelled = false
    // Worn items are re-attached on every rebuild; track them so the previous ones
    // can be removed rather than stacking up.
    const attached = []

    game?.loadingStep?.('Loading avatar…')

    const jobs = []

    if (custom) {
      // Their own character: only its texture (if the GLB doesn't carry one) and what
      // they wear on it.
      if (custom.info?.textureUrl) {
        jobs.push(loadTexture(custom.info.textureUrl).then((texture) => ({ kind: 'characterTexture', texture })))
      }
    } else {
      // Skin always loads - "0" is the fallback, since the base body has no baked map.
      // With a face, shirt or pants worn it's the server-composited version; if that
      // can't be fetched, the bare skin is better than an untextured body.
      const compositeUrl = skinCompositeUrl(equipped)
      const plainSkinUrl = assetUrls.skinTexture(skinIdOrDefault(equipped?.skinId))
      jobs.push(
        (compositeUrl ? loadTexture(compositeUrl) : Promise.resolve(null))
          .then((texture) => texture || loadTexture(plainSkinUrl))
          .then((texture) => ({ kind: 'skin', texture })),
      )

      // Body parts: fetch only real ids; a missing slot resets to the base geometry.
      for (const [slot, cfg] of Object.entries(PART_SLOTS)) {
        const id = equipped?.[cfg.idKey]
        if (!isRealId(id)) {
          jobs.push(Promise.resolve({ kind: 'part', slot, scene: null }))
          continue
        }
        jobs.push(
          loadPartGLB(assetUrls.part(slot, id)).then((scene) => ({
            kind: 'part',
            slot,
            scene,
          })),
        )
      }
    }

    // Everything worn: hat, hair and mask together, back, neck, chest, waist, hands, shoes.
    for (const [slot, cfg] of Object.entries(WORN_SLOTS)) {
      const id = equipped?.[cfg.idKey]
      if (!isRealId(id)) continue
      jobs.push(
        Promise.all([loadOBJ(cfg.mesh(id)), loadTexture(cfg.texture(id))]).then(
          ([object, texture]) => ({ kind: 'accessory', accessory: slot, object, texture }),
        ),
      )
    }
    const accessoryMatrix = custom ? characterAccessoryMatrix() : null

    Promise.all(jobs)
      .then((results) => {
        if (cancelled) return

        for (const result of results) {
          // One bad slot must not take the rest of the character down.
          try {
            if (result.kind === 'characterTexture') {
              for (const mesh of rig.skinnedMeshes) {
                if (result.texture && !mesh.material.map) mesh.material.map = result.texture
                mesh.material.needsUpdate = true
              }
            } else if (result.kind === 'skin') {
              applySkin(rig, result.texture)
            } else if (result.kind === 'part') {
              applyPart(rig, result.slot, result.scene)
            } else if (result.kind === 'accessory' && result.object) {
              // Shared per texture across every avatar wearing the item.
              const material = accessoryMaterial(result.texture)
              result.object.traverse((child) => {
                if (child.isMesh) child.material = material
              })
              const added = custom
                ? attachToCharacter(rig, result.accessory, result.object, custom.info, baseRest, accessoryMatrix)
                : attachAccessory(rig, result.accessory, result.object)
              for (const object of added) object.visible = rig.detail
              attached.push(...added)
            }
          } catch (err) {
            console.warn(`[bloxity] failed to apply ${result.kind}`, err)
          }
        }
        rig.accessories = attached

        // Skin and parts are on: the body becomes one draw call.
        try {
          mergeBody(rig)
        } catch (err) {
          console.warn('[bloxity] could not merge the avatar body', err)
          unmergeBody(rig)
        }

        assembledRef.current = true
        setAssembled(true)
      })
      .catch((err) => {
        console.warn('[bloxity] avatar assembly failed; showing base body', err)
        if (cancelled) return
        assembledRef.current = true
        setAssembled(true)
      })

    return () => {
      cancelled = true
      rig.followers.length = 0
      // Parts are about to be swapped: back to six meshes until the next merge.
      unmergeBody(rig)
      // Geometry and materials are shared (loader cache, accessoryMaterial): only
      // the clones come off.
      for (const object of attached) object.parent?.remove(object)
      if (rig.accessories === attached) rig.accessories = []
    }
  }, [rig, equipped, game, custom, baseRest])

  // Frees what this avatar made when it goes (other players come and go). Loaded
  // assets are shared through the loader cache, so they stay.
  useEffect(() => () => disposeRig(rig), [rig])

  // --- Proportions, pose and emote -----------------------------------------------
  // Applied per frame rather than in an effect: every bone is reset to its rest pose
  // and re-scaled each pass, which keeps it idempotent and survives anything else
  // that touches the skeleton.
  // Always some proportions: applying them is also what resets every bone to its rest
  // pose each frame, which the animation builds on. A custom character takes none
  // (null still resets its rest pose).
  const proportionsRef = useRef(proportions || DEFAULT_PROPORTIONS)
  useEffect(() => {
    proportionsRef.current = custom ? null : proportions || DEFAULT_PROPORTIONS
  }, [custom, proportions])
  /** This avatar's emote playback (blend weight, clip time). */
  const emotePlayer = useMemo(() => createEmotePlayer(), [])

  // Posed from outside (other players): publish the steps instead of running them here.
  useLayoutEffect(() => {
    if (!poserRef) return undefined
    const poser = {
      rig,
      isReady: () => assembledRef.current,
      /** Every bone back to its rest pose, with the body proportions applied. */
      reset: () => applyProportions(rig, proportionsRef.current),
      /** The pose for `motion` (see animateRig) and its emote, over the rest pose. */
      animate: (delta, motion) => {
        animateRig(rig, motion)
        updateEmote(rig, emotePlayer, motion.emote, Math.min(delta, 0.1), getEmoteClip, motion.emoteSeq ?? 0)
        placeFollowers(rig)
      },
      /** False hides what they wear (hat, hair, hands...): far-away players. */
      setDetail: (on) => setAccessoriesVisible(rig, on),
    }
    poserRef.current = poser
    return () => {
      if (poserRef.current === poser) poserRef.current = null
    }
  }, [poserRef, rig, emotePlayer])

  useFrame((_state, delta) => {
    if (poserRef) return
    try {
      // Order matters: proportions reset every bone to its rest pose, the animation
      // then rotates on top of that clean base, and an emote blends over the result.
      applyProportions(rig, proportionsRef.current)
      const motion = motionRef?.current ?? fallbackMotion(delta)
      animateRig(rig, motion)
      const emote = emoteSource ? emoteSource() : motion
      updateEmote(rig, emotePlayer, emote?.emote, Math.min(delta, 0.1), getEmoteClip, emote?.emoteSeq ?? 0)
      placeFollowers(rig)
    } catch {
      // A malformed payload must not kill the render loop.
    }
  })

  // Signal readiness only once the model is actually standing there.
  useEffect(() => {
    if (assembled) onReady?.()
  }, [assembled, onReady])

  return (
    <group ref={ref} {...props}>
      {/* Fit scale lives on this wrapper, not on `character` - applyProportions
          overwrites the character's own scale every frame. */}
      <group scale={fit.scale} position={[0, fit.footOffset, 0]}>
        <primitive object={character} />
      </group>
    </group>
  )
})

/**
 * Your own character, dressed from your Bloxity session. Plays the emotes Boxity asks
 * for (bloxity/emotes.js) until you move.
 */
export const PlayerAvatar = forwardRef(function PlayerAvatar(props, ref) {
  const { avatar, proportions, game } = useBloxity()
  return (
    <BloxityAvatar
      ref={ref}
      equipped={avatar}
      proportions={proportions}
      game={game}
      local
      emoteSource={localEmote}
      {...props}
    />
  )
})

/** The SDK's characterAccessoryMatrix(character, bone), or null on an SDK without it. */
function characterAccessoryMatrix() {
  const avatar = getSDK()?.avatar
  if (typeof avatar?.characterAccessoryMatrix !== 'function') return null
  return (character, bone) => safeCall(avatar.characterAccessoryMatrix.bind(avatar), character, bone) ?? null
}

/**
 * The uploaded character `equipped.characterId` names, loaded: { info, scene } - or
 * null for the regular avatar (none worn, none found, or its GLB failed). Yours comes
 * from avatar.getCharacter(), anyone else's from avatar.getCharacterFor(equipped).
 */
function useCustomCharacter(equipped, local) {
  const characterId = isRealId(equipped?.characterId) ? String(equipped.characterId) : null
  const [loaded, setLoaded] = useState(null)
  // Read when the character changes; other slots changing mustn't reload it.
  const equippedRef = useRef(equipped)
  useEffect(() => {
    equippedRef.current = equipped
  }, [equipped])
  useEffect(() => {
    if (!characterId) return undefined
    let cancelled = false
    const avatar = getSDK()?.avatar
    const describe = local ? avatar?.getCharacter : avatar?.getCharacterFor
    // A throw inside the SDK call rejects this promise rather than escaping the effect.
    new Promise((resolve) => resolve(typeof describe === 'function' ? describe.call(avatar, equippedRef.current) : null))
      .then((info) =>
        info?.glbUrl ? loadCharacterGLB(info.glbUrl).then((scene) => (scene ? { id: characterId, info, scene } : null)) : null,
      )
      .catch(() => null)
      .then((result) => {
        if (!cancelled) setLoaded(result)
      })
    return () => {
      cancelled = true
    }
  }, [characterId, local])
  return characterId && loaded?.id === characterId ? loaded : null
}

useGLTF.preload(baseBodyUrl())
// The default skin is what guests (and most players) wear: fetch it alongside the body
// instead of after it, so the avatar isn't waiting on a second round trip. The loader
// caches by URL, so assembly picks this same request up.
loadTexture(assetUrls.skinTexture(skinIdOrDefault(null)))

export default PlayerAvatar
