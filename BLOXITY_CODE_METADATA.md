---
canDie: false
hasScore: true
---

# Bottle Tumble: Boxity integration

The player cannot die: there is no death or game-over screen. You train in the sunken
pits for Power, throw your bottle down the endless staircase as far as your Power takes
it, collect Wins, rebirth for a bigger multiplier, and you always get another throw. So
there is no death screen (`Legion.SDK.deathScreen`).

Everything Boxity-related in the client lives in `client/src/bloxity/`:

| File | What it does |
|---|---|
| `env.js` | The only place Boxity URLs come from: `Legion.SDK.environment()`, else `window.BLOXITY_ENV`, else production |
| `sdk.js` | Waits for the SDK script; `whenInitialized()` gates every matchmaker request on `init()` |
| `BloxityProvider.jsx` | `init({ gameSlug })` once, the single `onUserChanged` subscription, avatar and proportions |
| `integration.js` | `ads.declareScreens`, `registerFeature('emotes')`, `leaderboard.define`, ad breaks, the portal settings menu, player events, chat, lifecycle, offline leaderboard submits |
| `services.js` | Rewarded ads, friends and invites, screen ads, `isEmbeddedInBoxity()` |
| `chat.js`, `emotes.js` | Chat bubbles over players; the emote catalog and playback |

## Leaderboards

Online, scores are reported by the **game server** (`server/src/bloxityLeaderboards.js`):
every ~20 s and when a player leaves, each pod sends the changed scores of its verified
players to `POST {api}/v1/leaderboards/hosted/{BLOXITY_GAME_ID}/report` as
`legion_<userId>`. Offline (no game server), the browser submits through
`Legion.SDK.leaderboard.submit`, signed-in players only. Boards (`LEADERBOARDS` in
`shared/balance.js`, declared by both):

| Board | Label | Score | Format |
|---|---|---|---|
| `rebirths` | Rebirths | `profile.rebirths` | number |
| `wins` | Total Wins | `profile.stats.totalWins` | compact |
| `stairs` | Longest Throw (stairs) | `profile.stats.bestStairs` | compact |
| `playtime` | Minutes Played | `floor(profile.stats.playtime / 60)` | number |

All four are `order: desc`, `mode: best`, `reset: none`. They mirror the sister game
+1 Kick Field Goal's boards.

## Gems purchases

None: the game sells nothing for Gems (removed at the developer's request). The server
still answers Boxity's webhook at `POST /api/gems/webhook` (unknown skus are refused, so
Boxity refunds them), but no product is offered in the game.

## Rewarded ads

Placement `free-power`: a free Power pack (the biggest), with a 3-minute cooldown. The
client sends `adReward { placement, rewardToken }`; the server verifies the token with
`POST {api}/v1/ads/reward/verify` before granting anything.

## Screen ads

Declared screens: `panel` (Bottle Shop, Pets, Rebirth, Settings, Gems, Friends) and
`gameplay`. There is no title menu, lobby or results screen. Gameplay banners are off
(Boxity's default).

## Open Rooms, invites, party play

Each pod reports its rooms every 2 s to `POST {MATCHMAKER_REPORT_URL}/{BLOXITY_GAME_ID}/rooms`
(`server/src/legionRoomReporter.js`, installed after `listen()`). The client joins
`?roomId=` at launch (resolved through `{playUrl}/v1/dir/<hostingId>/list`) and falls
back to normal matchmaking if that room is gone or full. Signing in mid-game rejoins the
same room. Rooms have `maxClients` 8, and all connections go through
`Legion.SDK.net.resolveEndpoint`, so party play and CrazyGames "play with friends" are
Boxity's automatic ones.

## Avatars and emotes

`client/src/game/PlayerAvatar.jsx` + `avatarRig.js` draw every slot: skin (with face,
shirt and pants), body parts, hat + hair + mask on `Neck1`, back, neck/chest on `Spine2`,
waist on `Spine1` (rest-inverse placement), hands and shoes as mirrored pairs. Uploaded
characters (`characterId`) load through `getCharacter()` / `getCharacterFor()`, with a
fallback to the regular avatar. Emotes from `player.onEvent('play_emote')` play on your
character and are replicated with the room message `emote { id }`.

## Server environment

| Variable | Purpose |
|---|---|
| `BLOXITY_REPORT_TOKEN` | Token for leaderboard and room reports (none set = no reports) |
| `MATCHMAKER_REPORT_URL` | Where the Open Rooms reporter posts (injected by Boxity hosting) |
| `BLOXITY_GAME_ID` | Hosted game id for reports (default `1-bottle-breaking`) |
| `LEGION_WEBHOOK_SECRET` | Must match the webhook's `x-legion-webhook-secret` header |
| `MONGODB_URI` | Shared database for profiles and Gems grants (SQLite without) |
| `BLOXITY_API_URL` etc. | Platform URLs; production defaults (`server/src/bloxityEnv.js`) |
