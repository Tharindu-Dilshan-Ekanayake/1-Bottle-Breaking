# Bottle Tumble

Train in the step pits for Power, throw your bottle down the endless staircase and smash
it. Power raises your level (capped per rebirth); every stair the bottle covers pays Wins,
plus gold Win coins on the stairs and a prize the first time you reach each of the 60
stages. Wins buy bottles and pet eggs. At max level, rebirth: Power and level reset for a
permanent x(1 + rebirths) Power multiplier and a higher level cap.

Multiplayer runs on Colyseus (up to 8 players per room), with offline play as a fallback.

## Run

```bash
# Game server (Colyseus, saves to server/data/bottle.db)
cd server && npm install && npm run dev        # port 2567

# Client
cd client && npm install && npm run dev        # finds the local server by itself
```

Boxity environment in `vite dev`: a local Boxity stack (API on :4000, portal on :3000)
is assumed. To log in with real Boxity accounts while developing, put
`BLOXITY_DEV_ENV=prod` in `client/.env` (see `.env.example`). Production builds carry
no environment: the page Boxity serves tells the SDK. Everything Boxity does in this
game is listed in `../BLOXITY_CODE_METADATA.md`.

Without a reachable server the client plays offline (same rules, saved in the browser).
`?offline` forces offline play; `?tabguest` makes each tab its own player for testing.
Production builds connect through `VITE_LEGION_GAME_ID` (Boxity's matchmaker, via
`Legion.SDK.net.resolveEndpoint`; set by `.github/workflows/deploy.yml`).

## Layout

| | |
|---|---|
| `shared/balance.js` | **All tuning**: levels, rebirth, pits, bottles, 60 stages, pets, eggs |
| `shared/logic.js` | The rules, as pure functions over a profile |
| `shared/session.js` | `PlayerSession`: validates intents, runs training and throw bounces |
| `shared/world.js` | Lobby layout, used for rendering and for server-side validation |
| `server/src/rooms/GameRoom.js` | Colyseus room: one `PlayerSession` per player, positions, saves |
| `server/src/db.js` | SQLite locally, MongoDB when `MONGODB_URI` is set |
| `client/src/net/` | Connection, events, offline stand-in, other players |
| `client/src/game/stage/Staircase.jsx` | Lazy chunk: stair window, throw replay, ghost bottles |

The server is the authority. The client sends intents (`throw`, `enterPad`, `rebirth`,
`buyBottle`, ...), and the server answers with a profile or an event. The offline mode
runs the very same `PlayerSession` locally.

## Controls

WASD / joystick to move, Space / JUMP, E / the big button for the context action, drag
to look, wheel / pinch to zoom.

## Performance rules this code follows

- Quality presets LOW / MEDIUM / HIGH, auto-detected and dropped by the
  PerformanceMonitor below 45 FPS. LOW has no shadows and no particles, and draws at most
  2 other players as full avatars.
- No store writes and no `new THREE.*` inside `useFrame`. Every repeated object is
  instanced (lobby, stairs, coins, pets, other players, ghost bottles), and anything with
  nothing to show is hidden rather than drawn empty.
- `?perf` exposes `window.__perf` (draw calls, triangles, texture MB, net state) and
  `window.__bt` helpers for automated tests. r3f-perf runs in dev (F2).
