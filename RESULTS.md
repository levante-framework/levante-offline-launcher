# Spike results

Environment: macOS, Node 22, Playwright (Chromium 151 / WebKit 26.5), Firebase emulator suite
(auth + firestore + functions) running the real `levante-admin` functions codebase plus the
two new callables. core-tasks 1.3.17 + the `levante-in-a-box` asset commit.

## Capacitor iOS app, re-run on the part-file bundles — 2026-09-04 (iPad Air 11" simulator, iOS 26.5)

Driven by hand after the format change, because the iOS app takes the reader's
"whole part in memory" branch (its native fetch has no body stream), which Android does not
exercise. Fresh install: PIN vault, sign-in as `ra@levante.test`, "Offline spike" →
"Sunrise Primary" → **5,349 files / 265.6 MB onto the app filesystem in under a minute**
(2 MB parts through native HTTP, each entry SHA-verified and written through the
Filesystem plugin). Cold relaunch → lock screen → PIN → roster (`native ios · filesystem
storage`, Ada 2/11 and Blaise 1/11 from the server's progress) → mental-rotation:
fullscreen gate, then the instruction screen with its stimuli loaded from
`capacitor://localhost/_capacitor_file_/…` (screenshot `shell/test/out/ios-capacitor-parts-task.png`).
Sync was not repeated (unchanged code, verified natively earlier in the day).

## Capacitor Android app — 2026-09-04 (Pixel Tablet AVD, API 36 image, arm64, headless)

Toolchain from the command line only: Homebrew `android-commandlinetools` + `openjdk@21`
(Gradle 8.14 does not run on JDK 26), `sdkmanager` packages after the licence step, an AVD
created with `avdmanager`; `./gradlew assembleDebug` produced a 4.9 MB debug APK. The proof
script drives the app's WebView through Playwright's Android API (`--browser android`; it
does not accept `connectOverCDP`), goes offline by switching the AVD's radios off, and syncs
after switching them back on.

Two Android platform facts, each found by running it:

1. **Capacitor's Android HTTP interceptor fails any Range request that does not start at
   byte 0** (`net::ERR_FAILED`, four retries each; 8 MB or 2 MB chunks, same or distinct
   URLs). Bundles therefore ship as fixed 2 MB **part files** and the launcher never sends a
   Range header anywhere — which also frees the production bucket from needing a CORS
   exception for it. Rebuilding the whole battery in the new format took 10 s from the
   builder's object cache; bundle ids did not change (same content).
2. **Capacitor's Android file server does not answer media requests for
   `_capacitor_file_` URLs**: with the pack on the app filesystem (as on iOS), provisioning
   worked (5,349 files / 266 MB in 85 s through the plugin bridge) and the task mounted, but
   every audio file "did not begin loading" (`ERR_CONNECTION_REFUSED` — the request fell
   through to the network). On Android the WebView origin is `https://localhost`, so the
   service-worker + Cache Storage path is available; the app now uses it there and keeps the
   filesystem backend for iOS.

| Step | Outcome (Android WebView, Cache Storage backend) |
|---|---|
| Vault, sign-in as the RA, scopes, `provisionOfflinePack` | as in the browser (native HTTP to the host's emulator via 10.0.2.2) |
| Provisioning | **5,349 files / 265.6 MB in 47 s** into Cache Storage through the service worker (5,295 entries after dedupe) |
| Radios off, reload | roster rendered from the service-worker cache; status bar `native android · cache storage` |
| hearts-and-flowers | mounted and played (6 trials in the 60 s budget); **134 requests, 1 failed — the app's own `icon.svg` favicon (`ERR_ABORTED`), nothing from the pack** |
| Child mode | proctor links hidden, `#/sync` redirected, wrong PIN rejected, exit with the PIN |
| Radios on, Sync page | **1 run synced, 0 failed**; clock offset 319 ms; `offlineDevices` row `platform=capacitor-android` |

Not exercised on Android: a full playthrough, a real tablet, storage eviction over time.

## Full battery offline — 2026-09-04

Seed extended to all eleven tasks in one administration (base params, no CAT except the
three original ones); bundles for the whole battery built in 68 s (255 MB; theory-of-mind
150.6 MB, trog 44.4 MB, vocab 28.4 MB). Provisioning the 11-task pack — **5,349 files /
265.6 MB — took 4 s in Chromium and 3 s in WebKit** from the bundle server.

| Task | Chromium (auto-play, 40–45 s budget) | Notes |
|---|---|---|
| hearts-and-flowers | mounted, played | |
| egma-math (CAT) | mounted, played | |
| matrix-reasoning (CAT) | mounted, played | |
| mental-rotation | mounted, played | also in WebKit (video instructions served as 206 by the SW) |
| same-different-selection | mounted, played | also in WebKit (video) |
| trog | mounted, played | |
| vocab | mounted, played | |
| theory-of-mind | **refused to start with the default corpus**: `Corpus validation failed (13): hostile-attribution-scene1-instruct1: Missing prompt for hostileAttributionScene1Instruct1 …` — mounted and played once the variant pinned `corpus: theory-of-mind-no-ha-item-bank` (fetched singly next to the bundle) | upstream content issue, see README |
| memory-game | mounted, played | also in WebKit (video) |
| child-survey | first attempt 404 on `manifests/visual/child-survey.json` (the bucket has only a folder placeholder there); mounted and played after the pack writes the four standard listings even when empty | pack-layout fix |
| intro | mounted, played to its end | |

Across the runs: **0 failed requests while offline** (235 + 140 in Chromium for the second
and third groups, 528 in WebKit), every run synced (4 + 2 + 3), kiosk checks passed in both
engines (proctor links hidden, `#/sync` redirected to the roster, wrong PIN rejected, exit
with the PIN). The proof script now continues past a task that fails to mount and reports
it in the result line, which is what made the two failures above diagnosable.

## Content-addressed bundles — 2026-09-04

`pack-builder/build-bundles.mjs` built the three-task battery from the public bucket in
**4 s**: `shared/en-US` 40 files / 1.7 MB, `task/hearts-and-flowers/en-US` 106 / 2.5 MB,
`task/egma-math/en-US` 200 / 10.3 MB, `task/matrix-reasoning/en-US` 1,546 / 5.6 MB; no
missing audio/corpus/translation warnings. Served locally with CORS + Range
(`emulator/serve-bundles.mjs`); the launcher streams each blob, slices, verifies SHA-256 per
entry and writes per-file objects into the same storage backend as before.

Provisioning time for the same pack (1,817 objects, 16.8 MB stored), same machine, same e2e:

| Engine | Listing path (per-object fetch) | Bundles (4 requests) |
|---|---|---|
| Chromium 151 (headless) | 6 s | **2 s** |
| WebKit 26.5 (Playwright, headless) | 47 s | **1 s** |
| Safari on iPad Air simulator (by hand, earlier) | ≈2 min | not re-measured |

Both bundle runs then completed the full loop (offline roster, hearts-and-flowers, 113–115
requests with 0 failures, sealed rows, sync); the synced run documents carry
`offline.bundleId = cd93cf09…` (the hearts-and-flowers bundle), which is now the stimulus /
corpus / translation version stamp. Duplicated entries across bundles (audio prompts used by
more than one task): 65 of 1,892, 3.3 MB, deduped by the storage layer.

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
