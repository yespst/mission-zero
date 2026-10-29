# MISSION ZERO

A real-time cooperative spaceship survival game for 2–6 players. The browser is a client; the Node.js server owns rooms, timers, mission validation, ship health, contributions, and match results.

## Local play

Requirements: Node.js 22.12 or newer and npm.

```sh
npm ci
npm run dev
```

Open <http://localhost:5173> in two separate browser windows/devices. Create a room, join with the five-character code, ready both crew members, and launch. Vite proxies Socket.IO to `127.0.0.1:3001`. Room snapshots are written to `./data/rooms.json` by default.

```sh
npm test       # gameplay and live Socket.IO integration tests
npm run build  # production Vite build; requires VITE_SERVER_URL
npm start      # long-running Node server; serves dist/ when present
```

## GitHub repository

This project is initialized locally as a `main` branch for a new repository named `mission-zero`. Create an empty GitHub repository with that name (do not pre-create a README or license), then from the project root:

```sh
git add .
git commit -m "Prepare Mission Zero deployment"
git remote add origin https://github.com/YOUR_GITHUB_OWNER/mission-zero.git
git push -u origin main
```

The `.gitignore` excludes `.env` files, Vercel local settings, room data, build output, dependencies, and intermediate work. `.env.example` is the only environment template intended for Git. No GitHub repository has been created or pushed by this workspace.

## Vercel frontend + Oracle backend

Vercel serves the React SPA; Oracle runs the existing long-lived Node/Socket.IO server. Production Vite builds require `VITE_SERVER_URL` to be an HTTPS origin, and production backend startup requires `CLIENT_ORIGIN` to be one or more exact HTTPS frontend origins. The backend no longer allows every origin in production.

Vercel project settings:

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `.` |
| Node.js Version | 22.x (22.12 or newer) |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Set `VITE_SERVER_URL` in Vercel **Production** and **Preview** environments to the backend HTTPS origin, for example `https://your-choice.duckdns.org`. Do not add `/socket.io` or another path. This is public browser configuration, not a secret. A Preview deployment connects only if its exact Vercel origin is included in `CLIENT_ORIGIN`; use a stable branch alias if needed and never allow a wildcard preview domain.

Follow [docs/oracle-cloud.md](docs/oracle-cloud.md) for the ordered GitHub/Vercel/OCI deployment, a new dedicated Ubuntu VM, a free DuckDNS name, Nginx HTTPS/WSS, exact CORS setup, systemd reboot persistence, OCI/UFW rules, and verification. The guide uses a separate VM and does not change the existing Oracle-hosted website. `render.yaml` remains as the earlier single-service option and is not part of this split deployment.

## Environment variables

`.env.example` documents names; Vite reads local `.env` files, while the Node server reads its process environment (the example is not loaded by Node automatically). On Oracle, the supplied systemd unit reads `/etc/mission-zero/mission-zero.env`, outside the repository.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set to `production` on the backend; requires exact HTTPS `CLIENT_ORIGIN` values |
| `HOST` | `127.0.0.1` | Backend bind address; keep loopback behind Nginx |
| `PORT` | `3001` | HTTP/Socket.IO listener; do not open this port publicly on Oracle |
| `CLIENT_ORIGIN` | Local Vite origins in development | Exact comma-separated browser origins; mandatory in production |
| `ROOM_TTL_MINUTES` | `30` | Remove inactive rooms after this many minutes |
| `DATA_DIR` | `./data` | JSON room snapshots; use `/var/lib/mission-zero` on the VM boot volume |
| `VITE_SERVER_URL` | Unset | Required for production builds; public HTTPS backend origin |

Never commit `.env`, `.env.local`, production env files, DuckDNS tokens, or GitHub credentials. Room snapshots contain room codes, nicknames, player session identifiers, and game state; protect and back up the data directory.

## Controls and rules

- Every run gets a persisted seed and a deterministic, non-repeating mission queue. Normal runs contain five selected repair missions plus Emergency Launch; Hard contains six, and Nightmare contains seven. The daily seed is derived from the UTC date, so players starting the Daily Challenge on that date receive the same queue and puzzle layouts.
- Reactor Stabilization: rotate the randomized couplers (4/6/8 by difficulty) to match the circuit key.
- Oxygen Restoration: cycle pressure valves to their randomized target bars.
- Navigation Override: plot a route through the validated asteroid field; collisions damage the hull and reset the ship.
- Core Synchronization: stabilize three nodes within the phase window; one player can claim two nodes, while a Systems Analyst can hold all three.
- Hull Breach: split up and seal the three leaking sections.
- Coolant Purge: route the three coolant junctions in sequence; wrong ports vent reactor pressure.
- Signal Decryption: submit distributed private cipher fragments. Crew members can transmit their assigned clue on the shared crew comms feed with **Share Clue With Crew**.
- Shield Calibration: synchronize the four pulse nodes before the timing window closes.
- Power Grid Reroute: spend shared energy cells to restore the oxygen, shield, and comms relays.
- Repair Drone: the diagnostic and repair stations receive different private information; cooperate to identify the fault and complete the service order.
- Data Core Recovery: restore the archive key from player-specific fragments.
- Emergency Launch: enter the authorization glyphs, ignite engines, then activate escape.

Crew Comms is a room-only live text channel available in the briefing room and on mission screens. It shows sender and local time, supports the existing quick transmissions, keeps the newest 80 entries per room, rejects empty or oversized text, and limits each connected crew member to eight chat messages per ten seconds. Reconnects receive the existing recent history; a new match and rematch start with a fresh channel. Text is rendered as text, and sender names are resolved by the server from the connected player session.

The captain chooses Normal, Hard, Nightmare, or the UTC Daily Challenge before launch. Difficulty changes mission count and countdown (8/7/6 minutes), and scales puzzle dimensions, move budgets, valve levels, coordination windows, mistake limits, starting energy, and emergency timing and penalties. Normal uses 4 reactor couplers, 3 valves, 5 navigation hazards, and a 3-glyph launch code; Nightmare uses 8 couplers, 5 valves, 11 hazards, and a 5-glyph launch code. Routes are built around a guaranteed safe navigation path, circuit move budgets include a valid solution, and other sequences/targets are generated from the replayable run seed. The server validates all answers. Shared energy, repair materials, oxygen canisters, and ship systems are server-owned. Optional supply-pod emergencies award reserves when two distinct crew members respond before the deadline; other emergencies apply their listed, recoverable penalty only once.

Role abilities have server-enforced 60-second cooldowns and resource or mission requirements: Engineers spend materials to stabilize the reactor, Navigators add a navigation move or restore an energy cell during grid rerouting, Systems Analysts scan signal/data tasks, Medics spend an oxygen canister to restore atmosphere, Pilots spend an energy cell to boost power, and Security spends a material to repair hull. Crew clues are sent only to the assigned player's room snapshot until that player explicitly shares them on the in-game crew comms feed.

Results show the run seed, selected challenge, contributions, MVP, rating, and actual event narrative. The captain can copy the seed, start a normal rematch with a fresh run, or replay the same seed and puzzle layout. Personal bests and achievement badges are stored in the local browser only; this release has no global leaderboard or account service.

The server validates actions and deadlines. Rooms are collision-checked, inputs bounded, and actions rate-limited. A browser session can reconnect with its saved player ID and room code; captaincy migrates if the host disconnects. Disk snapshots preserve room state and the shared deadline through server restarts.

## Tests and manual check

`npm test` covers room creation/joining, two/six player lobbies, readiness, deterministic mission selection, all twelve mission types, puzzle solvability, server action checks, difficulty and Daily Challenge settings, ability cooldowns, emergency responses, deadline enforcement, defeat/victory, rematch reset, reconnects, captain migration, snapshots, and server restart. Its live Socket.IO integration starts two independent clients and solves the generated mission queue through the final launch. `npm run build` checks the production client; provide `VITE_SERVER_URL=https://...` when running it.

After deployment, open the Vercel URL in two separate browser profiles/devices. Create/join a room, ready both players, launch, verify that both clients see state changes, refresh one client, disconnect the captain, finish or lose the match, and use Rematch/Return to Lobby. Verify `https://YOUR_API_HOST/health` returns `{"ok":true,...}` and confirm the Socket.IO connection is secure in browser developer tools.

## Current limits

- Room coordination is in one Node process and snapshots use one JSON file. This is suitable for one always-on backend VM, not multiple scaled instances.
- Room membership is session-based, not account-based. Reclaim requires the saved browser player ID and room code.
- Audio is omitted; alarms and feedback use visual warnings, motion, and event text. The UI does not expose a nonfunctional sound control.
- The GitHub, Vercel, DNS, Oracle, and TLS resources are not created by this project workspace. Do not treat it as publicly deployed until the verification steps succeed.
