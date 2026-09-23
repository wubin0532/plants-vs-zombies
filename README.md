# Garden Defense

A Chinese-language cartoon tower defense game built with Vue 3, TypeScript, Vite, and Phaser 3. The frontend is a purely static web page; game state is saved in the player's browser by default. An optional zero-dependency Node backend provides login and cloud saves for 1–5 accounts using file storage.

[中文版](README.zh-CN.md)

## Running

Requires Node.js 22.12+ (builds verified on Node.js 26).

```sh
npm ci
npm run dev
```

Production build and local preview:

```sh
npm test
npm run build
npm run preview
```

Deploy the files in `dist/` to any static host — the server does not need Node.js when accounts are disabled. `deploy/nginx.conf` is an adjustable example Nginx configuration.

### Optional: Accounts and Cloud Saves

Without login the game is fully offline and saves stay on the local machine; after login, progress is saved to the server under the account and can be continued across devices. On the same phone, local saves for the guest and each account are isolated from one another; a new account does not inherit the previous person's progress.

- The backend lives in `server/` and uses only Node built-in modules — no dependencies to install, no database: accounts are written to `users.json`, each user gets `saves/<id>.json`, and the session key is `secret.key`.
- Run locally: `DATA_DIR=./data PORT=8787 node server/index.mjs`. The Vite dev server proxies `/api`, so `npm run dev` wires frontend and backend together.
- API: `POST /api/auth/register|login|logout`, `GET /api/me`, `GET|PUT /api/save`, `GET /api/health`. Passwords are hashed with scrypt; sessions are versioned HMAC-signed cookies (`HttpOnly; SameSite=Lax`, 30 days); logout bumps the session version so old cookies fail immediately. Optional `ALLOWED_ORIGINS` allowlist enforces same-origin writes; off by default (to avoid reverse proxies rewriting Host), while classic CSRF is blocked by `SameSite=Lax` and the JSON Content-Type.
- At most 5 accounts by default; adjust with the `MAX_USERS` env var. Set `COOKIE_SECURE=1` on the backend when serving over HTTPS; leave it unset for plain-HTTP LAN access, or the browser will not store the login cookie.
- Rate limiting counts by TCP source address by default and cannot be bypassed with a forged `X-Forwarded-For`. Only set `TRUST_PROXY=1` (trusting the `X-Real-IP` overwritten by Nginx) when the backend is only reachable through a trusted reverse proxy and the port is not exposed on the LAN. See `.env.example` for all variables.

#### Example: Deploying with Docker

Nginx runs in a container and the `garden-api` backend in its own container; both join the same Docker network `garden-net`, Nginx proxies `/api/` to `http://garden-api:8787`, and **port 8787 is not published to the host**.

1. Run the one-shot script from a Mac (connects via the `fnos` alias in `~/.ssh/config`; paths at the top of the script can be changed):

   ```sh
   ./deploy/deploy-garden.sh
   ```

   It uploads `server/*.mjs` to `/vol1/1000/Docker/garden-server/`, starts `garden-api` on the NAS as `admin(1000:1001)`, and reloads Nginx after `nginx -t` passes.

2. You can also run the setup script on the NAS alone:

   ```sh
   ssh -t fnos 'bash /vol1/1000/Docker/garden-server/remote-garden-setup.sh'
   ```

3. The game site in Nginx only needs a proxy block (template in `deploy/nginx-garden-api.conf`):

   ```nginx
   location /api/ {
       proxy_pass http://garden-api:8787;
       proxy_http_version 1.1;
       proxy_set_header Host              $host;
       # overwrite instead of append, so clients cannot forge XFF prefixes to bypass rate limits
       proxy_set_header X-Real-IP         $remote_addr;
       proxy_set_header X-Forwarded-For   $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

4. Verify: `curl http://192.168.199.5:5888/api/health` should return `{"ok":true,"users":0,"maxUsers":5}`. The deploy script fails outright if the proxy block is missing or does not target `garden-api:8787`, and exits non-zero on a failed health check.

> **Upgrading from the old topology (host port 8787)**: run once on the NAS
> `sudo bash /vol1/1000/Docker/garden-server/migrate-garden-net.sh`.
> The script is idempotent and zero-downtime: it starts the new container under the alias `garden-api`, and only after `nginx -t` passes and the health check succeeds removes the old container; any failure automatically restores the old config and keeps the old container.
> Because session tokens switched to a versioned format, old login cookies become invalid after the switch and players must log in again.

**Data and backups**: accounts, saves, and `secret.key` all live in `/vol1/1000/Docker/Data/garden/` (`/data/garden` inside the container, owned by `admin`). Backup command:

```sh
ssh fnos 'tar czf /vol1/1000/Docker/Data/garden-backup-$(date +%F).tar.gz -C /vol1/1000/Docker/Data garden'
```

**Starting over**: `ssh -t fnos 'bash /vol1/1000/Docker/garden-server/reset-garden-data.sh'`. The service caches the user table in memory; after manually deleting files you must restart the container for it to take effect.

**Forgot password**: use the bundled reset script. It only replaces the password hash and **keeps the `user.id` and the cloud save**.

One command from the Mac (SSHes to the NAS, enters the container, resets; without `--password` it prompts with hidden input):

```sh
./deploy/reset-garden-password.sh --list          # list accounts (id / has save / last login)
./deploy/reset-garden-password.sh <username>      # reset (prompts for the new password)
ssh fnos 'sudo docker restart garden-api'         # required: users.json is cached in memory
```

On the NAS itself run `sudo bash /vol1/1000/Docker/garden-server/reset-garden-password.sh <username>`,
or call the underlying script directly: `sudo docker exec -it garden-api node /app/server/reset-password.mjs <username>`.
`SUDO=`, `DOCKER=`, `NAS=`, `CONTAINER=` and `APP_HOST_DIR=` can be overridden (use `SUDO= ` when running as root).

Outside the container, point `DATA_DIR` at the data directory, e.g. `DATA_DIR=/vol1/1000/Docker/Data/garden npm run reset-password -- <username>`.
Progress is preserved because the save file is named after `user.id`; this differs from "delete the account and re-register", which discards the save too.

`deploy/docker-compose.garden.yml` provides an equivalent compose setup (external network `garden-net`, running as `1000:1001`) for merging into existing orchestration; `deploy/nginx.conf` is a pure-static deployment example with security response headers and cache policies split between hashed and fixed-name assets.

## Controls

- After picking cards and entering a level, click a seed, then click a tile to plant.
- Click to collect sun; click the shovel, then a plant to remove it.
- Number keys 1–9 select seeds, S toggles the shovel, Esc cancels selection, Space pauses.
- The game auto-pauses when switched to the background. In fullscreen battles the seed bar floats over the left margin of the board, and progress/timer collapse into a thin top bar ("take a break" only shows while paused). Portrait phones get a rotation guide (skippable); on iPhone, "Add to Home Screen" opens a standalone window without the address bar; in standalone mode the home page's top bar clears the status bar and sticks to the top; a phone in landscape enters battle fullscreen automatically (after a manual exit it stays windowed for that landscape orientation until you rotate back or start a new battle).
- Conveyor belt: planting is free; in bowling, nuts roll to attack; in vasebreaking, click the vases directly; in zombatar levels, click the zombies directly.
- When the Cob Cannon is ready, click the cannon, then click the target tile to fire.
- Clear Dr. Zomboss's fireballs with an Ice-shroom, and iceballs with a Jalapeno in the same row.

## Current Completeness and Limits

This is a working first release, **not yet a faithful large-scale remake with per-level tuning**.

Implemented: cartoon home page, five battlefields, card selection, an almanac with 50 plant cards and 26 zombie types, 50 level entries, a rules engine, most special abilities, simplified adventure special levels, boss mechanics, sound effects, progress unlocks, and save import/export.

Notable differences from the original:

- Waves are generated per chapter and difficulty, not recreated from the original per-level spawn tables; timing, values, and boss fights are simplified.
- Runtime assets are converted to WebP: 50 plants (49 with dedicated action atlases), 26 zombies, and 16 effects; some characters use dedicated sequences, the rest use layered procedural animation — still not full frame-by-frame hand-drawn animation.
- Multi-shot/burst fire and butter are resolved per real projectile (20 damage per shot for Repeater/Gatling, 25 per spike for Cattail; butter deals double the Kernel damage and is decided before firing); Starfruit fires five fixed-direction stars, lobbed trajectories are still simplified; some original details still need item-by-item comparison.
- Shop plants unlock uniformly after the first clear, card slots expand per chapter; a simple Zen-garden-style item shop exists; there is no separate minigame, survival, puzzle, or garden mode yet.
- The Yeti zombie's almanac entry and behavior are defined, and it has been added to replay-level spawns (~20% chance, deterministically rolled from (seed, replay count) on each replay).
- No mid-battle saves. Accounts and cloud saves are an optional simple implementation: passwords are scrypt-hashed (N=2^17, parameters embedded in the hash, legacy hashes upgraded on the next successful login), sessions use signed cookies; but save content is produced by the client — no anti-cheat or score validation, and no email-based password recovery.

## Verification Record

- Rules tests cover resources, cooldowns, pausing, armor, water lanes, roof, mushroom waking, jumping, ladders, explosions, conveyor belt, Imitater, and save validation.
- Backend tests in `server/index.test.mjs` cover registration, password verification, 401 when logged out, logout revoking sessions, optimistic concurrency, **save two-way isolation (API and on-disk)**, cross-site write rejection, Content-Type enforcement, source-address normalisation, `users.json` self-healing, rate limiting, and the `MAX_USERS` cap; the frontend has tests for cloud-save merging, import validation, and **same-device multi-account save isolation**. The two sprite source sheets are committed to the repo (see `.gitignore`); the `npm test` pass count is reproducible on a clean clone / CI (currently 652).
- Verified in a real browser: auto-uploading the save after registration, the sync status in the top bar, and logout; on the NAS through Nginx, verified `/api/health`, registration, save read/write, and cookie issuance.
- A browser-side save check runs locally with `npm run dev` plus `npm run verify:save` (asserts a legacy v2 save still loads, the four accounting fields really reach localStorage, the balance never exceeds lifetime earnings, and the path raises no runtime errors). It needs Playwright browsers, so it is intentionally outside `npm test` (CI installs no browsers).
- All 50 levels were run to completion with a fixed seed and an auto-player, checking for stalls and illegal resources; win/loss depends on the auto strategy and current difficulty. This check **does not mean every level has passed manual playthrough acceptance**.
- Chromium tested asset loading, starting a battle, click-to-plant, and the pause screen; desktop and mobile landscape screenshots are in `output/playwright/`.
- The mobile layout was retested on a matrix of iPhone 16 Pro Max (440×956 / 956×440), iPad 11", Android, and desktop devices: landscape battles fill the visible height (765×440 canvas on iPhone without the address bar, previously 593×341), portrait phones show the rotation guide, and click-to-plant still hits the board under overlays; screenshots in `output/playwright/v2-*.png`.
- Safari, real-device touch performance, and full-level manual balance acceptance are not done yet.

## Structure

- `src/game/content.ts`: plant, zombie, scene, and level data.
- `src/game/engine.ts`: deterministic rules engine, independent of rendering.
- `src/game/scene.ts`: Phaser loading-on-demand and render configuration.
- `src/game/scene-class.ts`: assets, drawing, input, texture cache, and the fixed-timestep loop.
- `src/game/art.ts`: local WebP asset paths.
- `src/game/difficulty.ts`: difficulty, durations, and phased waves.
- `src/game/audio.ts`: Web Audio synthesized sound effects, concurrency limits, and volume.
- `src/game/animation.ts`, `layout.ts`: animation frames and unified battlefield coordinates.
- `assets-source/`, `scripts/prepare-assets.mjs`: source art generation and the PNG cropping pipeline.
- `src/store.ts`, `src/save-keys.ts`: Pinia plus validated localStorage saves; local saves are slotted by guest/account, with debounced cloud sync layered on after login.
- `src/auth.ts`, `src/api.ts`: login state and backend API wrapper.
- `src/App.vue`: menus, card selection, almanac, settings, HUD, and results.
- `server/`: zero-dependency Node backend with file-stored accounts, sessions, and save APIs.
- `deploy/deploy-garden.sh`, `remote-garden-setup.sh`, `reset-garden-data.sh`: upload/deploy, container start, and data reset scripts for the fnOS NAS.

Local saves are slotted by ownership: `pvz-garden-save-v1::guest` when logged out and `pvz-garden-save-v1::<user id>` when logged in; the legacy global key `pvz-garden-save-v1` is migrated to the guest slot on first load. So switching accounts on the same device never inherits progress; when a new account has an empty cloud save but the local guest save has progress, a confirmation dialog appears and defaults to **not** importing — only an explicit player choice merges it. Save version 2, with migration from version 1. Import only accepts contiguous, valid level progress; failures never overwrite current data. Clearing site data or switching browsers, domains, or ports affects save access — export a JSON backup in advance. After login or session restore, the client first fetches the cloud save and performs a **progress union merge** (level progress/coins/achievements/stars are unioned, never losing level progress), then writes with **server-side revision numbers** for optimistic concurrency: on conflict it merges and retries, no longer reconciling against the client clock. The settings page still offers manual "upload/download overwrite" buttons.

## This Release

- The card-select page supports Casual, Standard, Hard, and Custom. Normal levels target 8–12 minutes in the early-to-mid game and 12–15 minutes later; actual clear time includes cleanup, and losses can end early. Special modes use their own pacing.
- Custom supports 5–30 minutes, spawn density, health, speed, starting sun, preparation time, and lawn mowers; custom wins record a score but do not unlock adventure progress. Scores are saved and labeled per difficulty.
- Plants firing, zombies biting/groaning/dying, armor hits, freezing, explosions, planting, and collecting all have synthesized sound effects. The settings page can preview sounds, adjust volume, disable vibration, and change the effects tier. Still no recorded voiceover; there is procedurally synthesized background music and ambient layers.
- Zombies show health and armor bars, with visual feedback for armor breaking, freezing, walking, biting, and jumping. Explosions, fire, freeze, smoke, and collect effects use PNG sprites.
- Chromium verified PNG loading, health bars, pool alignment, explosions/freezing, animation frames, and Web Audio output; the audio analyzer measured a non-zero waveform.
- Running `node scripts/prepare-assets.mjs` rebuilds assets from the local source art. The generated images come from an image-generation tool used for this project, not extracted from the original game.

The new difficulties still need hands-on playtesting and per-level manual clear verification.

## Experience Optimization Plan

Item-by-item execution status lives in the local document `docs/optimization-plan.md` (not committed). This batch adds combat-logic fixes, continuous card selection, pure-battle fullscreen, PNG action sequences for the basic, conehead, buckethead, Gargantuar, pole-vaulting, and Chomper zombies, continuous action transitions, and grouped mixing; dedicated animations for other characters are still planned.

This batch also adds body-size tiers for special characters and stat adjustments for heavy armor, tanky plants, and agile zombies. Gargantuar's club swing, imp throw, and Chomper's bite resolve per action phase; detailed values and verification limits are in the optimization plan.

Mobile maximization: the battle immersion layout changed to "battlefield fills the screen + floating seed bar/status bar", adding the portrait rotation guide, canvas recomputation on orientation/address-bar changes, plus a PWA manifest and iOS standalone-window meta (`scripts/prepare-icons.mjs` generates home-screen icons). Entering the portrait guide auto-pauses the battle so health is not lost while the board is invisible; each battle resets the "play in portrait anyway" skip state.

## CI and Checks

- `.github/workflows/ci.yml` runs `npm ci` → `npm test` → `npm run verify:assets` → `npm run build` on Node 22.
- `npm run verify:assets` exits non-zero on **blocking** issues like missing/empty/wrong-size/edge-touching images; `npm run verify:assets:strict` also treats hints like "foot offset >8px" as failures.

## Disclaimer and License

This is an unofficial personal project, not affiliated with PopCap / EA; Plants vs. Zombies-related names, characters, and trademarks belong to their respective owners. The source code is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE): non-commercial use, modification, and distribution are allowed; **commercial use is prohibited**. See [NOTICE.md](NOTICE.md) for details.
