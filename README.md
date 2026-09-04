# LEVANTE offline launcher — spike

A working prototype of running LEVANTE core tasks on a tablet with **no connectivity**
and syncing the data back later. It builds on the July 2026 `levante-in-a-box` branches
(asset indirection in core-tasks) and adds what those drafts lacked: real provisioning
from an administration, a service-worker shell that serves runtime-downloaded asset
packs, a sealed (PIN-encrypted) append-only outbox, and a server-side ingest path that
reuses the platform's existing completion trigger.

Background and the full feasibility assessment: the "Offline LEVANTE" report
(claude.ai artifact) and `~/Projects/LEVANTE.md` → *Delivery infrastructure*.
Numbers from the last verified run: `RESULTS.md`. Firestore field changes: `CONTRACT.md`.

## The loop

```
PROVISION (online)                ASSESS (offline, days)              SYNC (online)
proctor signs in                  device unlocked with proctor PIN    proctor signs in
picks an administration           child picked from sealed roster     pending runs posted to
provisionOfflinePack → roster,    TaskLauncher(core-tasks) with       syncOfflineRuns → runs/trials
assignments, variant params       OfflineAppkit → sealed IndexedDB    under the child's uid →
asset pack → Cache Storage        every trial appended in order       syncOnRunDocUpdate trigger
```

## Layout

```
core-tasks/        git submodule → levante-framework/core-tasks @ spike/offline-assetbase
                   = main + cherry-pick of levante-in-a-box (setAssetBaseUrl + static manifests)
functions-repo/    git submodule → levante-firebase-functions @ spike/sync-offline-runs
                     src/administrations/provision-offline-pack.ts   roster + params for one administration
                     src/runs/sync-offline-runs.ts                    ingest one run + trials, idempotent
                     src/utils/offline-permissions.ts                 permissions-core gate shared by both
shell/             the launcher: Vue 3 + Vite + vite-plugin-pwa (injectManifest)
  src/sw.ts        precaches the app shell; serves /pack/<id>/… from the levante-packs cache
  src/offline/     auth (proctor session + callable client), packStore (runtime pack download,
                   resumable), db (sealed IndexedDB envelopes), vault + crypto (PIN → PBKDF2 →
                   AES-GCM), OfflineAppkit (firekit duck type), sync, exportRuns, wipe
  src/views/       Provision, Roster, Task, Sync, Lock
  test/            offline-run.mjs — Playwright proof (provision → offline → play → sync),
                   --browser webkit for the WebKit engine
emulator/          firebase.json + seed.mjs (permissions matrix, site, proctor, children,
                   administration, assignments) + inspect.mjs (what landed after a sync)
pack-builder/      build-pack.mjs — CLI mirror of the bucket (measurement / pre-baked kits);
                   the launcher no longer needs it
```

## Quick start

Prerequisites: Node 22+, `firebase-tools`, Java for the Firestore emulator (`brew install openjdk`).

```bash
# 0. clone with the two submodules (core-tasks and the functions repo on their spike branches)
git clone --recurse-submodules https://github.com/levante-framework/levante-offline-launcher.git
cd levante-offline-launcher

# 1. core-tasks library with the asset indirection
cd core-tasks/task-launcher && CYPRESS_INSTALL_BINARY=0 HUSKY=0 npm install && npm run package

# 2. functions with the two new callables
cd ../../functions-repo/functions/levante-admin && npm install && npm run build

# 3. emulator (terminal A) + seed
cd ../../../emulator && npm install && npm start
cd emulator && npm run seed                      # terminal B

# 4. the launcher against the emulator
cd ../shell && npm install --ignore-scripts && npx playwright install chromium webkit
npm run build:emulator && npm run preview        # http://127.0.0.1:4173

# 5. the proof
node test/offline-run.mjs --tasks hearts-and-flowers,egma-math --pin 2468
node test/offline-run.mjs --browser webkit --tasks hearts-and-flowers --pin 2468
cd ../emulator && npm run inspect
```

By hand, in Chrome or Safari: open the app → Provision → set a PIN, sign in as
`proctor@levante.test` / `proctor123`, load administrations, pick "Offline spike",
Provision → back to Roster → turn Wi‑Fi off → play → Wi‑Fi on → Sync. The in-app
Claude browser pane blocks service workers; use a real browser.

## Design notes

- **Identity never moves.** Children come only from existing user documents
  (`provisionOfflinePack`), attributed by uid; the launcher refuses to run a child without
  birth month/year. The proctor authenticates only for provisioning and sync; the callables
  gate on permissions-core (`assignments:read` to provision, `users:update` to sync) with a
  legacy `adminOrgs` fallback.
- **The pack is a cache of an administration.** `provisionOfflinePack` returns the tasks
  with the params *pinned on the administration* (the same snapshot `startTask` reads online)
  plus the roster; the device downloads stimuli, corpora and translations from the public
  bucket with resume and records the corpus SHA-256. Where the pack lives is a storage
  backend (`storage.ts`): in the browser, Cache Storage served by the service worker under
  `/pack/<packId>/…`; in the Capacitor app, the app filesystem served through
  `Capacitor.convertFileSrc` — because the Cache API refuses to store entries for a
  custom-scheme origin like `capacitor://localhost` ("Request url is not HTTP/HTTPS"), and
  because files in the app container are outside browser storage-eviction heuristics anyway.
  Either way core-tasks' `assetBaseUrl` needs no network.
- **Sealed at rest.** A proctor PIN (PBKDF2, 310k iterations) derives an AES-GCM key.
  Runs, trials and the roster are stored as small plaintext envelopes (ids, indexes, counts)
  plus one sealed box; the key lives in `sessionStorage` after unlock so the reload
  core-tasks needs between tasks does not re-prompt, and "Lock device" / closing the app drops
  it. Forgotten PIN = wipe. This is defence in depth on top of device encryption + MDM, not a
  replacement.
- **Outbox.** Trials are appended in order through a serial write chain (core-tasks fires
  `writeTrial` without awaiting); a crash mid-run keeps every trial written before it.
- **Ingest (`syncOfflineRuns`).** Validates shape, checks authority, writes trials first and
  the run doc last (so the trigger sees a complete run), deterministic ids (re-sync overwrites),
  stores device time and clock-corrected time, flags runs with no matching assignment as
  `orphan` rather than dropping them. See `CONTRACT.md`.
- **Versions.** Each run records `taskVersion`, `packId`/`packBuiltAt` (= provisioning time),
  `appBuild`, `corpusSha256`, `deviceId`.

## Status against the Phase-2 list

| Item | State |
|---|---|
| Provisioning from a real administration | done (callable + UI + resumable download) |
| Encrypted outbox + lock screen | done (PIN vault; sealed envelopes; wipe) |
| Sync engine with per-run status | done (Sync page; idempotent ingest) |
| permissions-core in the callables | done (shared gate; legacy fallback) |
| Data-contract checklist | documented in `CONTRACT.md`; validators not yet run |
| iOS Safari (PWA) | verified on an iPad Air simulator, iOS 26.5: provision (~2 min), server killed, roster + task from the service-worker cache |
| Capacitor iOS app | verified on the same simulator (Xcode 26.6): provision onto the app filesystem via native HTTP (<1 min), lock/unlock, roster, task running from `convertFileSrc` URLs. `shell/android/` is generated but unbuilt (no Android SDK here). Real hardware still untested |
| Trigger completion bug (upstream) | still open in `update-best-run-and-completion.ts` |
| ROAR tasks, surveys, walk-up enrollment | out of scope |

## Known gaps

- Clock offset is measured per request; a sync session should measure once with RTT/2.
- The pack downloader keeps the whole folder listing in memory and puts synthetic
  `Response`s; large batteries (ToM's 127 MB) will want a streaming put and a size check
  against `navigator.storage.estimate()`.
- `window.__levanteStore` exposes the decrypting store for tests; strip for production.
- The export JSON is plaintext by design (courier fallback); protect it operationally.
- The auto-player in the e2e is a test driver, not a validity claim about responses.
