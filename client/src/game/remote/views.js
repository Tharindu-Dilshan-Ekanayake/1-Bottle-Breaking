import { Matrix4 } from 'three'

/**
 * The avatars RemoteAvatars has mounted, by session id, for the RemotePlayers frame loop
 * to pose and place. Kept apart from the network's player records so a reconnect (a new
 * record for the same session) still finds its avatar.
 *
 * A view holds up to two avatars: `poser` is the player's own outfit and `hold` the
 * default avatar shown while that outfit downloads (so nobody ever appears as a bare
 * placeholder). Each `*.current` is BloxityAvatar's poser (see PlayerAvatar.jsx), or
 * null until it has mounted.
 */
export const remoteViews = new Map()

export function createView() {
  return {
    /** The groups the loop moves (set by ref callbacks; null when unmounted). */
    group: null,
    holdGroup: null,
    poser: { current: null },
    hold: { current: null },
    /** Bottle-on-the-back placement relative to the chest bone, measured at rest. */
    backOffset: new Matrix4(),
    /** The rig backOffset was measured on (re-measured when the avatar changes). */
    backRig: null,
    backBone: null,
  }
}
