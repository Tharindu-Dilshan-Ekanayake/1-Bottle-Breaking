import { schema, t } from '@colyseus/schema'

/**
 * Synced state, kept deliberately small: only what other players need to draw you.
 * Everything private (inventory, settings...) goes to its owner alone as 'profile'
 * messages, never through the shared state.
 */
export const PlayerState = schema(
  {
    name: t.string(),
    /** Their verified Boxity account id ('' for guests). */
    uid: t.string(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    rotY: t.float32(),
    /** 'idle' | 'walk' | 'run' | 'jump' | 'train' | 'throw' | 'cheer' */
    anim: t.string(),
    /**
     * When the position above was sampled, on the player's own clock (ms mod 65536):
     * other clients replay positions at their real spacing, not at patch arrival.
     */
    stamp: t.uint16().default(0),
    /** Training reps done (mod 256): each one bounces their bottle down the pit for everyone. */
    reps: t.uint8().default(0),
    /** What their Bloxity avatar wears, as JSON `{ equipped, proportions }` ('' = base). */
    look: t.string(),
    /** The Boxity emote they're playing: a 24-hex emote id, or '' for none. */
    emote: t.string().default(''),
    /** Bumped on every emote started, so the same one picked again replays. */
    emoteSeq: t.uint16().default(0),
    /** Their equipped bottle (shared/balance BOTTLES id): carried on their back. */
    bottleId: t.string(),
    /** Equipped pet species, at most 3. */
    petIds: t.array('string'),
    power: t.float64(),
    wins: t.float64(),
    rebirths: t.uint16(),
    level: t.uint16(),
    /** The world they're in (1, 2...): players only see others in their own world. */
    world: t.uint8().default(1),
  },
  'PlayerState',
)

export const GameState = schema(
  {
    /** sessionId -> player */
    players: t.map(PlayerState),
  },
  'GameState',
)
