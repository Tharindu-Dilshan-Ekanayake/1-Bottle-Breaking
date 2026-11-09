import { Vector3 } from 'three'

import { SPAWN } from '@shared/world'

/**
 * Mutable, non-reactive game state shared between the render loop, the network layer
 * and the UI.
 *
 * The render loop (useFrame) only ever WRITES here - never to a React/zustand store.
 * RuntimeSync copies what the HUD needs into the UI store at 10 Hz, outside the frame
 * loop. The network layer drops server events here (a throw plan, training pulses,
 * other players' throws) for the frame loop to pick up.
 */
export const runtime = {
  /** 'walk' | 'throw'. During 'throw' the camera follows the bottle and input is ignored. */
  mode: 'walk',
  /** The world you're in (profile.world, mirrored for the frame loop). */
  world: 1,
  /** Walking speed multiplier (the Fast Feet upgrade). */
  walkMult: 1,

  // --- Player --------------------------------------------------------------------
  playerPos: new Vector3(SPAWN.x, 0, SPAWN.z),
  /** Facing angle (radians about +Y); 0 faces +Z. */
  playerYaw: Math.PI,
  playerSpeed: 0,
  grounded: true,
  /** 'pad:<index>' | 'launch' | 'shop' | 'egg:<id>' | null */
  nearby: null,
  /** Pit index the player is training in, or -1. */
  trainingPad: -1,
  /** 'idle' | 'train' | 'throw' - drives the avatar's pose. */
  action: 'idle',
  actionTime: 0,
  /** Seconds of celebration left (a new best throw, a rebirth): arms up, hopping. */
  cheer: 0,
  /** Seconds since the last training toss (for the toss swing). */
  tossTime: 9,
  /** What other players are told we're doing: 'idle' | 'walk' | 'jump' | 'run' | 'train' | 'throw' | 'cheer'. */
  netAnim: 'idle',
  /** Where our right hand is in the world this frame (PlayerAvatar): a bottle in hand starts here. */
  handPos: new Vector3(),
  /** performance.now() when playerPos was last updated (Player): the clock behind our position reports. */
  playerPosAt: 0,

  // --- Input written by the touch UI ------------------------------------------------
  joystick: { x: 0, y: 0 },
  jumpQueued: false,

  // --- Camera ----------------------------------------------------------------------
  /** What the camera is looking at; lights and the stair window follow it too. */
  focus: new Vector3(SPAWN.x, 1, SPAWN.z),
  shake: 0,

  // --- Server events waiting for the frame loop --------------------------------------
  /** A confirmed throw to replay: the server's 'throw' event. */
  throwPlan: null,
  /** Power gains from training reps, oldest first; each one is a bounce in the pit. */
  trainPulses: [],
  /** sessionId -> another player's throw: { hops, durations, bottleId, x, z, startedAt }. */
  ghostThrows: new Map(),
  /** Other players' pets this frame, filled by RemotePlayers for the pet renderer. */
  remotePets: [],

  // --- Throw ------------------------------------------------------------------------
  bottlePos: new Vector3(),
  /** True once the staircase chunk has mounted and can run a throw. */
  stageReady: false,
  /** Live throw progress for the HUD. */
  throwStair: 0,
  throwZone: 0,
  throwEarned: 0,
  throwWins: 0,
  /** Win pickups on stairs below this index have been collected by the current throw. */
  collectedUpTo: -1,
  /** Written once when the bottle shatters: { stairs, zone, power, wins, prize, best }. */
  throwResult: null,
}

/** Most training pulses kept waiting (a hidden tab must not pile them up). */
export const MAX_TRAIN_PULSES = 6

export function resetRuntimeThrow() {
  runtime.throwStair = 0
  runtime.throwZone = 0
  runtime.throwEarned = 0
  runtime.throwWins = 0
  runtime.collectedUpTo = -1
  runtime.throwResult = null
}

/** Lobby props further than this from the camera skip rendering and their updates. */
const LOBBY_CULL_DISTANCE = 90

/** Distance-based culling for lobby-only dynamic props (pets, shop bottles, eggs). */
export function lobbyIsFar(camera) {
  const dx = camera.position.x - runtime.playerPos.x
  const dy = camera.position.y - runtime.playerPos.y
  const dz = camera.position.z - runtime.playerPos.z
  return dx * dx + dy * dy + dz * dz > LOBBY_CULL_DISTANCE * LOBBY_CULL_DISTANCE
}
