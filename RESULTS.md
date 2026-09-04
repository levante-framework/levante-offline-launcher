# Spike results

Environment: macOS, Node 22, Playwright (Chromium 151 / WebKit 26.5), Firebase emulator suite
(auth + firestore + functions) running the real `levante-admin` functions codebase plus the
two new callables. core-tasks 1.3.17 + the `levante-in-a-box` asset commit.

## Scoped provisioning as a research assistant — 2026-09-04 (Chromium)

Seed: site `site-demo` with school "Sunrise Primary" (Ada, Blaise) and cohort "Pilot cohort A"
(Blaise, Carla); Blaise's assignment already has `egma-math` completed; proctors
`proctor@levante.test` (`site_admin`) and `ra@levante.test` (`research_assistant`), both with
new-style claims only (empty legacy `adminOrgs`).

| Step | Outcome (proctor = `research_assistant`, scope = school) |
|---|---|
| `listOfflineScopes` | `[cohort Pilot cohort A, school Sunrise Primary]`; a child account gets `PERMISSION_DENIED`; a bogus org `NOT_FOUND`; `orgType: class` `INVALID_ARGUMENT` |
| `provisionOfflinePack` (school) | **2 children** (Ada, Blaise — Carla excluded), pack id `admin-spike-offline-school-school-sunrise-en-US`, 1,817 files / 16.8 MB in 8 s; roster shows **Ada 0/3, Blaise 1/3 tasks done** from the assignment progress |
| `provisionOfflinePack` (cohort, direct call) | Blaise + Carla, Blaise's `egma-math: completed` carried; no scope → all three |
| Offline | roster from cache; hearts-and-flowers 13 trials; 113 requests, 0 failed; rows sealed |
| Sync as the RA | **1 run synced, 0 failed** under the new gate (`assignments:read` + `users:read`); trigger: `progress.hearts_and_flowers = completed`, `bestRun`, `completedOn` |
| `offlineDevices/dev_…` | `platform=web build=c5f9726-… site=site-demo pack=…-school-school-sunrise-en-US scope=school:Sunrise Primary children=2 provisioned=20:48:44Z lastSync=20:50:02Z runsSynced=1 trialsSynced=13` |
| Second device, cohort scope, `site_admin`, child Blaise | pack `…-cohort-cohort-pilot-a-en-US` (Blaise, Carla) in 6 s; after his offline hearts-and-flowers run the roster — still offline — read **"Blaise P: 2/3 tasks done | Carla H: 0/3"** (one from the pack's progress, one from the device's own outbox); synced (offset 27 ms); trigger: both of Blaise's tasks `completed`; second `offlineDevices` row with its own counters |

## Phase 2 loop — 2026-09-04 (`shell/test/offline-run.mjs`, Chromium)

| Step | Outcome |
|---|---|
| Device PIN | vault created (PBKDF2 → AES-GCM key), key held for the session |
| Provision as proctor (`site_admin`) | `getAdministrations` → "Offline spike" → `provisionOfflinePack` → **3 children, 3 tasks; 1,817 files / 15.9 MB downloaded into Cache Storage in 5 s** (1,824 cache entries incl. manifests) |
| Offline (network emulation), cold reload | roster rendered from cache; children shown as first name + last initial |
| hearts-and-flowers, offline | **21 trials** (5 practice, 16 test); completed (`errorOut` from random play) |
| egma-math `cat: true`, offline | **17 trials** (2 instruction, 6 practice, 9 test); `thetaEstimate` on every scored trial; corpus SHA-256 stamped |
| Network while offline | **260 requests, 0 failed** — everything served by the service worker from the pack cache |
| At rest | raw IndexedDB rows contain only `{runId, packId, taskId, timeStartedMs, syncState, trialCount, sealed}` / `{runId, trialIndex, clientTimestampMs, sealed}` / `{packId, status, provisionedAt, sealed}`; **grep for names, PIDs, birth years and trial fields over the raw rows: no plaintext** |
| Sync as the proctor | **2 runs synced, 0 failed**; permissions-core gate (`users:update` on the child's site) passed; clock offset 8 ms |

What landed (`emulator/inspect.mjs`):

```
DEMO-A (SV2t554Pp9bdUVkfMt7aF6hcfG4C)
  run 3c757ecd… task=egma-math          completed=true trials=17 bestRun=true scores.test={numAttempted:9,  numCorrect:2,  numIncorrect:7, thetaEstimate:-6}
  run 8bf891e7… task=hearts-and-flowers completed=true trials=21 bestRun=true scores.test={numAttempted:16, numCorrect:10, numIncorrect:6}
  assignment admin-spike-offline: started=true completed=false
    progress={hearts_and_flowers:"completed", egma_math:"completed", matrix_reasoning:"assigned"}
    hearts-and-flowers: runId=8bf891e7… completedOn=2026-09-04T19:40:55Z
    egma-math:          runId=3c757ecd… completedOn=2026-09-04T19:42:55Z
```

`bestRun`, `progress.*`, `started` and the per-task `runId`/`completedOn` were written by the
platform's existing `syncOnRunDocUpdate` trigger reacting to the ingested run documents —
no `startTask`/`completeTask` involved. `completed=false` is correct (matrix-reasoning unplayed).

## WebKit (Playwright WebKit 26.5)

Provisioning worked identically (vault, 1,824 cache entries, 15.9 MB): service-worker
registration, Cache Storage, IndexedDB and WebCrypto all behave. Playwright's *network
emulation* crashed WebKit on the offline reload ("internal error"), so the offline phase was
run in `--offline-mode server-down` — the test starts its own web server for the app and kills
it, the physical equivalent of losing Wi‑Fi:

| Step | Outcome (WebKit 26.5, server-down) |
|---|---|
| Cold reload with the app's server dead | roster rendered from the service-worker cache |
| hearts-and-flowers, offline | task mounted and played; **40 trials** in the 150 s budget (run still in progress when the budget ended, so `completed=false`) |
| Network while offline | **115 requests, 0 failed** |
| At rest | raw rows sealed; no plaintext leak |
| Sync | 1 run synced (incomplete runs sync too, by design); clock offset 33 ms |

## iOS Safari — iPad Air 11" simulator, iOS 26.5 (Xcode 26.6), driven by hand

| Step | Outcome |
|---|---|
| Vault + proctor sign-in | PIN vault created (WebCrypto); sign-in via the Auth emulator from Safari |
| Provisioning | `getAdministrations` → `provisionOfflinePack` → **1,817 files / 16.8 MB into Cache Storage in ≈2 min** (WebKit pays per-request overhead on matrix-reasoning's 1,522 tiny files; ~20 files/s — a bundled pack format is the obvious optimization) |
| App's web server killed, Safari reload | page served by the service worker; proctor session and pack (`READY`/`ACTIVE`) intact |
| Roster | sealed roster decrypted with the session key, rendered from cache |
| hearts-and-flowers | fullscreen gate, then the instruction screen (otter image, audio control) — every asset from the pack cache with no server |

Screenshot: `shell/test/out/ios-safari-offline-task.png`. Not exercised in Safari: full playthrough and sync (the same code paths verified in Chromium/WebKit headless).

## Capacitor iOS app — same simulator, Xcode 26.6 build

First attempt (pack in Cache Storage, as in the PWA): the shell loaded under
`capacitor://localhost`, the PIN vault and proctor sign-in worked, `provisionOfflinePack`
returned the roster — and the first `cache.put` failed with **"Request url is not
HTTP/HTTPS"**: the Cache Storage API refuses entries for a custom-scheme origin. This is
the platform fact the native test was meant to surface, and it settles the native design:
the pack goes on the **app filesystem** (`@capacitor/filesystem`, `Directory.Data`) and
core-tasks gets `Capacitor.convertFileSrc(<pack dir>)` as `assetBaseUrl` — no service
worker, and outside browser storage-eviction heuristics. `storage.ts` now switches
backends by platform; the roster shows which one is active ("native ios · filesystem
storage"). The PWA path was re-verified after the refactor (Chromium: 113 requests
offline, 0 failed, 21 trials, sealed rows, synced; clock offset 48 ms).

Second attempt (filesystem backend) failed on the first **folder listing**: WebKit logged
`SubResourceLoader::didFail (type=2 …)` — an access-control failure — four times (the retry
loop). Verified with curl: the GCS **JSON listing API** returns no
`Access-Control-Allow-Origin` for `Origin: capacitor://localhost` (it echoes only http(s)
origins), whereas the **object** endpoint answers `*` — which is why attempt 1 got past
`assets-per-task.json` and attempt 2 did not. Fix: route the app's HTTP through Capacitor's
native stack (`plugins.CapacitorHttp.enabled`), which is not subject to WebView CORS.

Third attempt (filesystem backend + native HTTP) — **works**:

| Step | Outcome (Capacitor iOS, WKWebView, `capacitor://localhost`) |
|---|---|
| Relaunch | lock screen (vault persisted across reinstall; session key dropped), unlocked with the PIN |
| Provisioning | sign-in + `getAdministrations` + `provisionOfflinePack` through native HTTP; **1,817 files / 16.8 MB written to the app filesystem in under a minute** (faster than Safari's Cache Storage) |
| Roster | sealed roster decrypted; status bar shows `native ios · filesystem storage` |
| hearts-and-flowers | fullscreen gate, then the instruction screen (otter image, audio control) — manifests, translations, images and audio all loaded from `capacitor://localhost/_capacitor_file_/…/packs/<packId>/…` |

| Relaunch → lock screen → unlock → Sync page | the run started above (incomplete, 0 trials, `taskAbort`) was decrypted and listed as pending; proctor sign-in and **`syncOfflineRuns` from the native app succeeded** ("Synced 1 run(s); 0 failed", clock offset 34 ms) |

Screenshot: `shell/test/out/ios-capacitor-task.png`. Not exercised natively: a full playthrough
(same core-tasks code as the browser runs).

Two facts for the native design, both learned only by running it: (1) the Cache API cannot
be used under a custom-scheme origin, so packs belong on the filesystem; (2) the GCS JSON
listing API is CORS-blocked for a custom-scheme origin, so asset downloads must go through
native HTTP (`CapacitorHttp`) — or the launcher should stop calling the listing API at all and
fetch a build-time pack manifest instead, which is the better design anyway (one request
instead of a listing per folder, and no dependence on the bucket's CORS policy).

## Phase 1 (earlier the same day, static pack, no vault)

2 tasks incl. CAT offline: 269 requests, 0 failed; 26 trials; synced; trigger recomputed
completion. Superseded by the Phase-2 loop above.

## Caveats

- The auto-player clicks randomly (with core-tasks' Cypress `.correct` marker where present),
  so accuracy and theta trajectories mean nothing; the claim is that the machinery runs offline
  unchanged and re-integrates.
- Clock offset is measured per request (`serverNow − clientNow`); the math run's request
  measured 1.36 s because of request latency. A sync session should measure once with RTT/2.
- The emulator log shows `Error initializing permissions at module load` once at cold start
  (the functions load before the seed writes `system/permissions`); the lazy loader recovers on
  first use, and both permission-gated callables succeeded.
- Not exercised: matrix-reasoning, a real tablet, Capacitor, MDM.
