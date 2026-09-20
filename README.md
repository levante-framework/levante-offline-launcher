# LEVANTE offline launcher — spike

A working prototype of running LEVANTE core tasks on a tablet with **no connectivity**
and syncing the data back later. It builds on the July 2026 `levante-in-a-box` branches
(asset indirection in core-tasks) and adds what those drafts lacked: real provisioning
from an administration, a service-worker shell that serves runtime-downloaded asset
packs, a sealed (PIN-encrypted) append-only outbox, and a server-side ingest path that
reuses the platform's existing completion trigger.

Background and the full feasibility assessment: the "Offline LEVANTE" report
(claude.ai artifact) and `~/Projects/LEVANTE.md` → *Delivery infrastructure*.
Numbers from the last verified run: `RESULTS.md`. BrowserStack devices: `RESULTS-browserstack.md`.
Firestore field changes: `CONTRACT.md`.

## Field collection on a tablet

Staff runbook (navbar): **Step-by-Step → 1 · Select Site → 2 · Provision → 3 · Collect Data → 4 · Sync**.

Dashboard setup (site, children, assignment) can be on a **laptop**. Select Site can also be
checked on a laptop, but that pick lives in *that* browser — it does not set up the tablet.
On the tablet, sign in again and pick the same site, or open a pack link from the wizard.

**On the tablet (once), before Provision:** open the launcher in Chrome → menu →
**Add to Home screen** → **Install**. Use that icon for Provision, Collect, and Sync.
Skip install on a laptop. A Chrome tab still works for a short test; install it if the
tablet will sit offline for days. This is not an APK and not the parked Capacitor Android app.

```
1 SELECT SITE (online)            2 PROVISION (online)                 3 COLLECT (offline)             4 SYNC (online)
laptop or tablet: sign in         on the tablet: install PWA first     Start child mode                leave child mode → Backup
and pick the site (tablet must    pick one assignment × group pack     child taps their name + task    file in Downloads; sign in
repeat this, or open a pack       Download pack → roster, tasks,       no network                      Sync uploads pending runs
link)                             assets into Cache Storage            next child taps a different name  (same run ids overwrite)
```

The researcher can be a `research_assistant`: the callables gate on permissions that role
already holds (`assignments:read`; sync also `users:read`). A pack is one assignment plus
the children in one cohort, classroom, or school — not the whole site. Progress already
collected on another device (or online) shows as done. Every provision and sync is recorded in
`offlineDevices/{deviceId}`.

The launcher **never creates** a site, school, classroom, cohort, child, or assignment. If
those already exist in the dashboard, skip the wizard: Select Site → Provision auto-builds
the pack from `getAdministrations` + `listOfflineScopes` + `provisionOfflinePack`. The
optional dashboard wizard (DEV-only `/science-fair`) is only for creating or finding those
objects, or minting a pack link that preselects one pack.

Field-collection tablets use an **open vault** (no device PIN). Tablets that already have a
PIN vault still lock until that PIN is entered. Children never authenticate.

### Preview (admin-dev, expires 2026-10-19)

Anyone can open these URLs — no GitHub login and no cloned repos. Staff must sign in with a
**LEVANTE researcher account on `hs-levante-admin-dev`** that already has access to the site.

| Tool | URL |
|---|---|
| Launcher | https://hs-levante-admin-dev--offline-launcher-34g4znyg.web.app |
| Wizard (optional) | https://hs-levante-admin-dev--science-fair-rcdjddph.web.app/science-fair |

Hash routes stay as written: `#/`, `#/site`, `#/provision`, `#/sync`, `#/fair`. Do not rewrite
them. Child mode also blocks `#/site`, `#/provision`, `#/sync`, and `#/fair`.

## The loop (emulator / engineering)

```
PROVISION (online)                ASSESS (offline, days)              SYNC (online)
researcher signs in               child picked from the roster        researcher signs in
picks a site, then one            (with what is already done)         pending runs posted to
assignment × group pack           TaskLauncher(core-tasks) with       syncOfflineRuns → runs/trials
provisionOfflinePack → roster,    OfflineAppkit → IndexedDB           under the child's uid →
progress, variant params          every trial appended in order       syncOnRunDocUpdate trigger;
asset pack → Cache Storage                                            offlineDevices/{id} updated
```

## Layout

```
core-tasks/        git submodule → levante-framework/core-tasks @ spike/offline-assetbase
                   = main + cherry-pick of levante-in-a-box (setAssetBaseUrl + static manifests)
functions-repo/    git submodule → levante-firebase-functions @ spike/sync-offline-runs
                   (emulator). The same three callables are on `hs-levante-admin-dev`
                   (ported onto functions `main` — do not deploy this spike snapshot wholesale).
                     src/administrations/list-offline-scopes.ts       school/class/cohort a device can be scoped to
                     src/administrations/provision-offline-pack.ts   roster (scoped) + progress + params
                     src/administrations/offline-packs.ts            saveOfflinePack + listOfflinePacks (wizard)
                     src/runs/sync-offline-runs.ts                    ingest one run + trials, idempotent
                     src/utils/offline-permissions.ts                 permissions-core gate shared by all
                     src/utils/offline-devices.ts                     offlineDevices/{deviceId} registry
shell/             the launcher: Vue 3 + Vite + vite-plugin-pwa (injectManifest)
  src/sw.ts        precaches the app shell; serves /pack/<id>/… from the levante-packs cache
  src/offline/     auth (Google + email/password + callable client), site (selected site),
                   packStore (runtime pack download, resumable), db (IndexedDB), vault (open
                   vault or PIN), OfflineAppkit, sync, backupRuns (Downloads JSON), wipe
  src/views/       Site, Provision, Roster, Task, Sync, Fair (Step-by-Step), Lock
  src/components/  StaffNav — numbered staff tabs
  test/            Playwright: Select Site → pack → offline play → sync
                   test/offline-run.mjs (emulator), test/science-fair-dev-run.mjs (admin-dev)
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

# 2. functions with the three offline callables (emulator copy)
cd ../../functions-repo/functions/levante-admin && npm install && npm run build

# 3. emulator (terminal A) + seed
cd ../../../emulator && npm install && npm start
cd emulator && npm run seed                      # terminal B

# 3b. asset bundles for the seeded tasks (once; ~4 s from the public bucket) + a server for them
cd ../pack-builder && node build-bundles.mjs --tasks hearts-and-flowers,egma-math,matrix-reasoning --locale en-US --out ./bundles --cache ./cache
cd ../emulator && npm run bundles               # terminal C — http://127.0.0.1:4175 (VITE_BUNDLE_BASE)

# 4. the launcher against the emulator
cd ../shell && npm install --ignore-scripts && npx playwright install chromium webkit
npm run build:emulator && npm run preview        # http://127.0.0.1:4173 (HTTP; HTTPS is PREVIEW_HTTPS=1)

# 5. the proof (Select Site → assignment×group pack → offline play → sync)
node test/offline-run.mjs --tasks hearts-and-flowers,egma-math --proctor ra@levante.test:ra123456 --site "Spike demo" --administration "Offline spike" --scope Sunrise
node test/offline-run.mjs --browser webkit --tasks hearts-and-flowers
cd ../emulator && npm run inspect                 # runs, trigger results, offlineDevices
```

By hand, in Chrome or Safari: open `#/site` → sign in as `proctor@levante.test` /
`proctor123` (site admin) or `ra@levante.test` / `ra123456` (research assistant) → pick
**Spike demo site** → Continue to provision → tap the **Offline spike** pack for
**Sunrise Primary** (Ada, Blaise) or **Pilot cohort A** (Blaise, Carla) → Download pack →
Roster → turn Wi‑Fi off → play → Wi‑Fi on → Sync. The in-app Claude browser pane blocks
service workers; use a real browser.

## Against `hs-levante-admin-dev`

The three callables are live on that project (`us-central1`, codebase `levante-admin`).
`shell/.env.dev` points Auth, Functions, and assets at `-dev`
(`levante-assets-dev`, same bucket the dashboard uses). Sentry (`offline-launcher` in
`levante-framework-eu`, Frankfurt) gets errors plus lifecycle logs (boot, sign-in,
provision, task, sync). Handled core-tasks errors go through the same client via the
injected logger. While the tablet is offline, envelopes queue in IndexedDB (up to 200)
and flush on the next launch once the device is online. No session replay — this shell
sits in front of children. Rebuild after changing `VITE_SENTRY_DSN`.
Set `SENTRY_AUTH_TOKEN` when building so hidden source maps upload to that EU project
and are stripped from `dist` (readable stacks; maps never ship to the tablet).

```bash
cd shell
npm run build:dev && npm run preview        # http://127.0.0.1:4173
```

The hosted Playwright run uses the same password login as Cypress
(`E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` from levante-support `.env`). It follows the
tablet path (Select Site → first matching pack → play → sync). Pass `--wizard` only if
you need the dashboard wizard to create a new cohort/assignment.

```bash
set -a && source /path/to/levante-support/.env && set +a
cd shell && npm run test:science-fair:dev
# smoke: node test/science-fair-dev-run.mjs --max-children 1 --tasks intro
# optional wizard: node test/science-fair-dev-run.mjs --wizard
```

Sign in with a **dashboard-dev** site admin or research assistant — not
`ra@levante.test`. `VITE_BUNDLE_BASE` is empty in this mode, so provision lists GCS
instead of the local bundle server.

Redeploy the 30-day preview (does **not** publish live `hs-levante-admin-dev.web.app`):

```bash
cd shell && npm run deploy:dev:preview
```

levante-support can mint disposable site-admin / RA accounts (`reset-site`,
`create-permissions-users`). Its `setup-qa-site` fixture is a walk-up participant on
the whole site (no school); that is not the field shape. Field data is: site → school
(or cohort) → `createUsers` children → `upsertAdministration` assigned to that org.

Birth month/year on the user doc must be integers (`createUsers` writes `birthMonth` /
`birthYear` from levante-zod `month` / `year`, 1–12 and a four-digit year, required and
under 18 for children). The pack callable also coerces numeric strings so older QA docs
still provision; the launcher will not start a child if either is missing after that.

To redeploy **only** these functions from `levante-firebase-functions/functions/levante-admin`
(never omit `--project dev` or the `levante-admin:` codebase prefix):

```bash
firebase --project dev deploy --only \
  functions:levante-admin:provisionOfflinePack,\
  functions:levante-admin:syncOfflineRuns,\
  functions:levante-admin:listOfflineScopes,\
  functions:levante-admin:saveOfflinePack,\
  functions:levante-admin:listOfflinePacks
```

## Design notes

- **Identity never moves.** Children come only from existing user documents
  (`provisionOfflinePack`), attributed by uid. Birth fields are integers (`birthMonth` 1–12,
  `birthYear` four digits); the callable coerces numeric strings the way levante-zod does
  for `month`/`year`. The launcher refuses to run a child if either is missing. The
  researcher authenticates only for Select Site, provisioning, and sync: Google via the
  Firebase Auth client (popup, then redirect if the tablet blocks popups) or email/password
  via Identity Toolkit REST, then `setUidClaims` and `POST { data }` callables. The
  callables gate on permissions-core (`assignments:read` to list scopes and provision;
  `assignments:read` + `users:read` to sync — the research-assistant baseline) with a
  legacy `adminOrgs` fallback.
- **A device serves one group on one site.** Step 1 stores the site (names come from the
  researcher's `siteNames` claims). Step 2 lists every assignment × cohort/classroom/school
  pack on that site. The pack id includes the scope; the roster is that group's children
  who hold the assignment, each with `progress` per task as of provisioning. The roster
  merges that with completed runs stored on the device, so "done" is visible without a
  network.
- **The pack is a cache of an administration.** `provisionOfflinePack` returns the tasks
  with the params *pinned on the administration* (the same snapshot `startTask` reads online)
  plus the roster; the device downloads stimuli, corpora and translations from the public
  bucket with resume and records the corpus SHA-256. Where the pack lives is a storage
  backend (`storage.ts`): Android and desktop browsers use Cache Storage served by the
  service worker under `/pack/<packId>/…`. Capacitor iOS uses the app filesystem through
  `Capacitor.convertFileSrc` (Cache API refuses the `capacitor://localhost` origin).
  Capacitor Android is parked — not used in the Android field build.
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
- **Child mode.** "Start child mode" on the roster hides staff controls (Select Site,
  Provision, Sync, lock, PIDs/birth dates) and makes `#/site`, `#/provision`, `#/sync`, and
  `#/fair` route back to the roster. On a PIN vault, leaving child mode requires that PIN.
  On an open field-collection vault, the on-site researcher exit control is enough. Leaving
  child mode also writes a **Backup** file (`levante-offline-export-….json`) to the tablet
  Downloads folder — real filesystem storage, outside IndexedDB. The Sync screen **Backup**
  button does the same on request. The file is plaintext; the app never deletes it.
  The flag survives the reload core-tasks needs between tasks and a relaunch. It is a UI guard,
  not a security boundary: on a real deployment pair it with the OS kiosk (Guided Access /
  Android screen pinning or an MDM kiosk profile).
- **Vault.** New field-collection tablets use an open vault (no PIN). Devices that already
  have a PIN vault still seal runs with AES-GCM (PBKDF2, 310k iterations); the key lives in
  `sessionStorage` after unlock so the reload between tasks does not re-prompt. Forgotten
  PIN = wipe. That is defence in depth on top of device encryption + MDM, not a replacement.
- **Outbox.** Trials are appended in order through a serial write chain (core-tasks fires
  `writeTrial` without awaiting); a crash mid-run keeps every trial written before it.
- **Ingest (`syncOfflineRuns`).** Validates shape, checks authority, writes trials first and
  the run doc last (so the trigger sees a complete run), deterministic ids (re-sync overwrites
  the same `users/{uid}/runs/{runId}` — Backup then Sync does not create duplicates),
  stores device time and clock-corrected time, flags runs with no matching assignment as
  `orphan` rather than dropping them. Sync uploads from IndexedDB; it does not read the
  Downloads Backup file. See `CONTRACT.md`.
- **Versions.** Each run records `taskVersion`, `packId`/`packBuiltAt` (= provisioning time),
  `appBuild`, `corpusSha256`, `deviceId`.

## Status against the Phase-2 list

| Item | State |
|---|---|
| Provisioning from a real administration | done (Select Site + assignment×group pack + resumable download); scoped to a school/classroom/cohort, with per-child progress and an `offlineDevices` registry. Callables are on `hs-levante-admin-dev`; preview channel + `npm run build:dev` |
| Research-assistant proctor | done: the full loop verified as `research_assistant` (no new role) |
| Bundled packs | done: `build-bundles.mjs` + streaming/resumable download; WebKit provisioning 47 s → 1 s |
| Child (kiosk) mode | done: proctor controls and routes gated behind the PIN; exercised by the e2e |
| Encrypted outbox + lock screen | done (PIN vault; sealed envelopes; wipe) |
| Sync engine with per-run status | done (Sync page; idempotent ingest). Backup writes a Downloads JSON copy on Exit child mode and via the Backup button |
| permissions-core in the callables | done (shared gate; legacy fallback) |
| Data-contract checklist | documented in `CONTRACT.md`; validators not yet run |
| iOS Safari (PWA) | verified on an iPad Air simulator, iOS 26.5: provision (~2 min), server killed, roster + task from the service-worker cache |
| Capacitor iOS app | verified on the same simulator (Xcode 26.6): provision onto the app filesystem via native HTTP, lock/unlock across relaunch, roster, task running from `convertFileSrc` URLs, and sync of the stored run through `syncOfflineRuns`; re-verified on the part-file bundles (266 MB in under a minute, mental-rotation from the stored files). Real hardware still untested |
| Capacitor Android app | parked (not used). Same Cache Storage path as the PWA; AVD proof kept in RESULTS.md |
| Trigger completion bug (upstream) | still open in `update-best-run-and-completion.ts` |
| ROAR tasks, surveys, walk-up enrollment | out of scope |

## Android — Chrome PWA

Field Android is the **installed Chrome PWA** (hosted preview or `npm run build:dev`), not a
Play Store app.

1. Open the launcher URL in **Chrome** (not the stock Android browser).
2. Chrome menu (⋮) → **Add to Home screen** → **Install**.
3. Open the new home-screen icon for Provision, Collect, and Sync.

A normal Chrome tab uses the same origin (same service worker, cache, and IndexedDB) and
still works for a short supervised test. Install it for days offline: Chrome treats the
installed app more like durable storage, and staff can reopen it after a reboot with
radios off without hunting for the URL. A laptop browser is a different origin store —
that Select Site / pack does not appear on the tablet.

Do not `cap sync android` for a field tablet. The Capacitor Android tree (`shell/android`,
`npm run build:android`) is parked for a later native app; AVD steps that wrap the same
UI in an APK are in RESULTS.md.

## Android (Capacitor) — parked, verified on an emulator

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
2. **Point a build at `hs-levante-admin-dev`** (`npm run build:dev && npm run preview`,
   or the hosted preview URL). Sign in with a dashboard-dev site admin or research
   assistant, Select Site, then download a real assignment × group pack. The emulator
   seed is not real data. See *Field collection on a tablet* above.
3. **Real devices, one of each:** an iPad (TestFlight or a dev-signed build) and the cheapest
   Android tablet the field will actually buy (Chrome, Add to Home screen). Provision a real dev-project
   administration scoped to one school; check the roster and per-child progress against the
   dashboard.
4. **The offline day:** airplane mode on, reboot the tablet, wait, reopen → lock → PIN →
   roster. Play every core task to completion with a real child-like pace; note any task whose
   audio, video or images fail (the emulator proof only checks that nothing 404s).
5. **Persistence:** leave the device untouched for a week in airplane mode (iOS 7-day eviction
   applies to Safari, not the app, but verify); update the app with a pending outbox and check
   the runs survive.
6. **Sync correctness:** leave child mode (confirm a Backup file appears in Downloads), then
   sync over a poor link (throttled Wi‑Fi, then interrupted mid-sync); confirm each run lands
   once under the right child, `progress`/`bestRun` update, a second sync creates no duplicates,
   and the `offlineDevices` row reflects it.
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
- Backup JSON is plaintext by design (courier copy in Downloads); the app never deletes
  those files — staff must. Sync does not read them.
- The auto-player in the e2e is a test driver, not a validity claim about responses.
