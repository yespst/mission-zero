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

- Reactor: rotate five couplers to the displayed solution key.
- Oxygen: cycle pressure valves to their randomized target bars.
- Navigation: plot a route through a randomized, validated asteroid field; collisions damage the hull and reset the ship.
- Core sync: stabilize three nodes within the phase window; Systems Analysts can hold all three, other roles up to two.
- Hull: seal three leaks; each patch restores hull integrity.
- Launch: enter the glyph sequence, ignite engines, and activate escape.

Role specialties affect play: Engineers improve reactor stability, Navigators add moves, Systems Analysts can hold the full sync array, Medics restore oxygen while tuning valves, Pilots add engine power, and Security restores extra hull per patch.

The server validates actions and deadlines. Rooms are collision-checked, inputs bounded, and actions rate-limited. A browser session can reconnect with its saved player ID and room code; captaincy migrates if the host disconnects. Disk snapshots preserve room state and the shared deadline through server restarts.

## Tests and manual check

`npm test` covers room creation/joining, two/six player lobbies, readiness, randomized puzzle solvability, all mission outcomes, invalid/stale actions, deadline enforcement, defeat/victory, rematch reset, reconnects, captain migration, snapshots, and server restart. `npm run build` checks the production client; provide `VITE_SERVER_URL=https://...` when running it.

After deployment, open the Vercel URL in two separate browser profiles/devices. Create/join a room, ready both players, launch, verify that both clients see state changes, refresh one client, disconnect the captain, finish or lose the match, and use Rematch/Return to Lobby. Verify `https://YOUR_API_HOST/health` returns `{"ok":true,...}` and confirm the Socket.IO connection is secure in browser developer tools.

## Current limits

- Room coordination is in one Node process and snapshots use one JSON file. This is suitable for one always-on backend VM, not multiple scaled instances.
- Room membership is session-based, not account-based. Reclaim requires the saved browser player ID and room code.
- Audio is omitted; warnings and feedback are visual.
- The GitHub, Vercel, DNS, Oracle, and TLS resources are not created by this project workspace. Do not treat it as publicly deployed until the verification steps succeed.
