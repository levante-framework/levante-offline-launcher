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
picks an administration and       child picked from sealed roster     pending runs posted to
a school or cohort                (with what is already done)         syncOfflineRuns → runs/trials
provisionOfflinePack → roster,    TaskLauncher(core-tasks) with       under the child's uid →
progress, variant params          OfflineAppkit → sealed IndexedDB    syncOnRunDocUpdate trigger;
asset pack → Cache Storage        every trial appended in order       offlineDevices/{id} updated
```

The proctor can be a `research_assistant`: both callables gate on permissions the RA role
already holds (`assignments:read`; sync also `users:read`). A device is provisioned for one
school or one cohort of the administration; the roster is those children who hold an
assignment for it, each with their per-task progress as of provisioning, so a child assessed
on another device (or online) shows as done. Every provision and sync is recorded in
`offlineDevices/{deviceId}` — the beginnings of a fleet view.

## Layout

```
core-tasks/        git submodule → levante-framework/core-tasks @ spike/offline-assetbase
                   = main + cherry-pick of levante-in-a-box (setAssetBaseUrl + static manifests)
functions-repo/    git submodule → levante-firebase-functions @ spike/sync-offline-runs
                     src/administrations/list-offline-scopes.ts       schools/cohorts a device can be scoped to
                     src/administrations/provision-offline-pack.ts   roster (scoped) + progress + params
                     src/runs/sync-offline-runs.ts                    ingest one run + trials, idempotent
                     src/utils/offline-permissions.ts                 permissions-core gate shared by all
                     src/utils/offline-devices.ts                     offlineDevices/{deviceId} registry
shell/             the launcher: Vue 3 + Vite + vite-plugin-pwa (injectManifest)
  src/sw.ts        precaches the app shell; serves /pack/<id>/… from the levante-packs cache
  src/offline/     auth (proctor session + callable client), packStore (runtime pack download,
                   resumable), db (sealed IndexedDB envelopes), vault + crypto (PIN → PBKDF2 →
                   AES-GCM), OfflineAppkit (firekit duck type), sync, exportRuns, wipe
  src/views/       Provision, Roster, Task, Sync, Lock
  test/            offline-run.mjs — Playwright proof (provision → offline → play → sync),
                   --browser webkit for the WebKit engine
emulator/          firebase.json + seed.mjs (permissions matrix, site, school, cohort, proctors,
                   children, administration, assignments) + inspect.mjs (what landed after a
                   sync) + serve-bundles.mjs (static bundle server with CORS + HTTP Range)
pack-builder/      build-bundles.mjs — content-addressed asset bundles (one index + one blob
                   per task×locale and per shared×locale) from the public bucket; what the
                   launcher downloads. build-pack.mjs — the older per-file mirror (measurement)
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

# 3b. asset bundles for the seeded tasks (once; ~4 s from the public bucket) + a server for them
cd ../pack-builder && node build-bundles.mjs --tasks hearts-and-flowers,egma-math,matrix-reasoning --locale en-US --out ./bundles --cache ./cache
cd ../emulator && npm run bundles               # terminal C — http://127.0.0.1:4175 (VITE_BUNDLE_BASE)

# 4. the launcher against the emulator
cd ../shell && npm install --ignore-scripts && npx playwright install chromium webkit
npm run build:emulator && npm run preview        # http://127.0.0.1:4173

# 5. the proof (as the research assistant, device scoped to the school)
node test/offline-run.mjs --tasks hearts-and-flowers,egma-math --pin 2468 --proctor ra@levante.test:ra123456 --scope Sunrise
node test/offline-run.mjs --browser webkit --tasks hearts-and-flowers --pin 2468
cd ../emulator && npm run inspect                 # runs, trigger results, offlineDevices
```

By hand, in Chrome or Safari: open the app → Provision → set a PIN, sign in as
`proctor@levante.test` / `proctor123` (site admin) or `ra@levante.test` / `ra123456`
(research assistant), load administrations, pick "Offline spike", pick "Sunrise Primary"
(school: Ada, Blaise) or "Pilot cohort A" (cohort: Blaise, Carla), Provision → back to
Roster → turn Wi‑Fi off → play → Wi‑Fi on → Sync. The in-app Claude browser pane blocks
service workers; use a real browser.

## Design notes

- **Identity never moves.** Children come only from existing user documents
  (`provisionOfflinePack`), attributed by uid; the launcher refuses to run a child without
  birth month/year. The proctor authenticates only for provisioning and sync; the callables
  gate on permissions-core (`assignments:read` to list scopes and provision; `assignments:read`
  + `users:read` to sync — the research-assistant baseline) with a legacy `adminOrgs` fallback.
- **A device serves one school or cohort.** `listOfflineScopes` offers the administration's
  schools and cohorts; the pack id includes the scope; the roster is the scope's children who
  hold the assignment, each with `progress` per task as of provisioning. The roster merges
  that with completed runs stored on the device, so "done" is visible without a network.
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
- **Packs are assembled from content-addressed bundles.** `pack-builder/build-bundles.mjs`
  turns the bucket into one index (`entries: [{name, contentType, offset, length, sha256}]`)
  plus the entries' bytes, uncompressed and cut into fixed 2 MB part files, per unit —
  `task/<id>/<locale>` and `shared/<locale>` — and a `catalog.json`; `bundleId` is a hash
  of the entries, so identical content has one id and every run carries the id of the
  bundle it was played from (`offline.bundleId`). The launcher reads the parts in order
  (streamed in a browser; one part in memory at a time under native HTTP), slices them into
  per-file objects for the storage backend, verifies every SHA-256, and resumes an
  interrupted download at the part holding the first entry it does not hold — plain GETs
  only, no Range requests, so the production bucket's CORS needs nothing special. Building
  is also where a battery gets validated: missing audio, corpora or translations are
  warnings in the index (`--strict` fails the build). Without `VITE_BUNDLE_BASE` the
  launcher falls back to listing the bucket folders and fetching ~1,800 objects, which is
  what made WebKit take minutes.
- **Child mode.** "Start child mode" on the roster hides the proctor controls (sync,
  provisioning, lock, PIDs/birth dates) and makes `#/sync` and `#/provision` route back to the
  roster; leaving it requires the device PIN, verified against the vault rather than the
  session key. The flag survives the reload core-tasks needs between tasks and a relaunch.
  It is a UI guard, not a security boundary: on a real deployment pair it with the OS kiosk
  (Guided Access / Android screen pinning or an MDM kiosk profile).
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
| Provisioning from a real administration | done (callable + UI + resumable download); scoped to a school/cohort, with per-child progress and an `offlineDevices` registry |
| Research-assistant proctor | done: the full loop verified as `research_assistant` (no new role) |
| Bundled packs | done: `build-bundles.mjs` + streaming/resumable download; WebKit provisioning 47 s → 1 s |
| Child (kiosk) mode | done: proctor controls and routes gated behind the PIN; exercised by the e2e |
| Encrypted outbox + lock screen | done (PIN vault; sealed envelopes; wipe) |
| Sync engine with per-run status | done (Sync page; idempotent ingest) |
| permissions-core in the callables | done (shared gate; legacy fallback) |
| Data-contract checklist | documented in `CONTRACT.md`; validators not yet run |
| iOS Safari (PWA) | verified on an iPad Air simulator, iOS 26.5: provision (~2 min), server killed, roster + task from the service-worker cache |
| Capacitor iOS app | verified on the same simulator (Xcode 26.6): provision onto the app filesystem via native HTTP, lock/unlock across relaunch, roster, task running from `convertFileSrc` URLs, and sync of the stored run through `syncOfflineRuns`; re-verified on the part-file bundles (266 MB in under a minute, mental-rotation from the stored files). Real hardware still untested |
| Capacitor Android app | verified on a Pixel Tablet AVD: full loop (provision 266 MB in 47 s into Cache Storage, radios off, roster + task, child mode, sync) driven by `--browser android`. Real hardware still untested |
| Trigger completion bug (upstream) | still open in `update-best-run-and-completion.ts` |
| ROAR tasks, surveys, walk-up enrollment | out of scope |

## Android (Capacitor) — verified on an emulator

Toolchain without Android Studio: `brew install --cask android-commandlinetools
android-platform-tools`, `brew install openjdk@21` (Gradle 8.14 rejects JDK 26), then — the
one step that needs a person, because it accepts Google's SDK licence:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "emulator" "system-images;android-35;google_apis;arm64-v8a"
$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd -n levante-tablet -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_tablet
```

Build and run against the local emulator + bundle server (inside an AVD, `10.0.2.2` is the
host; `.env.android` points there, `CAP_CLEARTEXT=1` allows plain HTTP and a debug-only
manifest sets `usesCleartextTraffic`):

```bash
cd shell && echo "sdk.dir=$ANDROID_HOME" > android/local.properties
npm run build:android && CAP_CLEARTEXT=1 npx cap sync android && (cd android && ./gradlew assembleDebug)
$ANDROID_HOME/emulator/emulator -avd levante-tablet -no-window -no-audio &     # or with a window
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
node test/offline-run.mjs --browser android --tasks hearts-and-flowers --scope Sunrise --proctor ra@levante.test:ra123456 --pin 2468
```

`--browser android` attaches Playwright to the app's WebView over adb (debug builds expose
it), switches the AVD's radios off for the offline phase, and back on to sync. Storage
backend on Android is **Cache Storage + service worker** (the origin is `https://localhost`),
not the app filesystem as on iOS — see `RESULTS.md` for the two Capacitor-Android facts
behind that (its HTTP interceptor fails non-zero Range requests, and its file server does not
answer media requests), which also turned the bundle format into 2 MB part files.

## First QA pass — proposed

Everything above was verified on emulators/simulators by an auto-player. The first QA pass
should be a person with real devices, in this order:

1. **Reproduce the proof on a second machine** (README quick start, both engines). If the
   setup instructions fail, that is the first bug.
2. **Deploy the three callables to `hs-levante-admin-dev`** and point a build at it
   (`.env.dev`); until then everything runs against the emulator seed, which is not real data.
3. **Real devices, one of each:** an iPad (TestFlight or a dev-signed build) and the cheapest
   Android tablet the field will actually buy (sideloaded APK). Provision a real dev-project
   administration scoped to one school; check the roster and per-child progress against the
   dashboard.
4. **The offline day:** airplane mode on, reboot the tablet, wait, reopen → lock → PIN →
   roster. Play every core task to completion with a real child-like pace; note any task whose
   audio, video or images fail (the emulator proof only checks that nothing 404s).
5. **Persistence:** leave the device untouched for a week in airplane mode (iOS 7-day eviction
   applies to Safari, not the app, but verify); update the app with a pending outbox and check
   the runs survive.
6. **Sync correctness:** sync over a poor link (throttled Wi‑Fi, then interrupted mid-sync);
   confirm each run lands once under the right child, `progress`/`bestRun` update, a second
   sync creates no duplicates, and the `offlineDevices` row reflects it.
7. **Clock skew:** set the tablet clock wrong by hours, collect, sync; `offline.clockOffsetMs`
   should absorb it and `timeStarted` should be right.
8. **PIN and child mode:** wrong PINs, lock/unlock, wipe; a child trying to leave child mode;
   Guided Access / screen pinning on top.
9. **Data contract:** run the support repo's validators on the synced runs and diff an offline
   run against an online run of the same task in Redivis.
10. **Log everything in the QA knowledge base** (levante-support) with device model, OS,
    app build (`appBuild` on the roster), pack/bundle ids, and the `offlineDevices` row.

## Findings for upstream (from running the whole battery offline)

- **theory-of-mind's default corpus does not start.** `corpus/theory-of-mind/theory-of-mind-item-bank.csv`
  (2025-09) still contains 13 hostile-attribution items whose prompt keys
  (`hostileAttributionScene1Instruct1`, …) exist in neither the theory-of-mind nor the
  hostile-attribution en-US translation file, so core-tasks' corpus validation throws before
  the first trial. The bucket's 2026 `theory-of-mind-no-ha-item-bank.csv` runs; whichever
  corpus production variants pin, the default one is a trap for anyone building a pack (or
  a variant) without knowing that. This is exactly the class of problem the bundle builder
  should catch, once it knows which prompt keys a corpus needs.
- **child-survey has no `visual/child-survey/` objects**, only a folder placeholder; the
  task still asks for the listing. Packs must answer an empty listing, as the bucket does.

## Known gaps

- Clock offset is measured per request; a sync session should measure once with RTT/2.
- Bundles are per task, so audio prompts shared by several tasks are downloaded once per
  task that uses them (65 of 1,892 entries, 3.3 MB, for the three-task pack); the storage
  layer dedupes them. Moving multi-task audio into the shared unit would remove that.
- Capacitor's Android HTTP interceptor fails any Range request that does not start at byte 0
  (`net::ERR_FAILED`; observed with both 8 MB and 2 MB chunks, distinct URLs or not), which
  is why bundles ship as part files instead of one blob. On native platforms each file is
  written through the plugin bridge (base64), the slow part of provisioning there.
- No size check against `navigator.storage.estimate()` before a download yet.
- `window.__levanteStore` exposes the decrypting store for tests; strip for production.
- The export JSON is plaintext by design (courier fallback); protect it operationally.
- The auto-player in the e2e is a test driver, not a validity claim about responses.
