# Data-contract notes for the offline launcher

Written against `levante-support/docs/DATA_CONTRACT_CHANGE_CHECKLIST.md`. The launcher
writes nothing to Firestore itself; the `syncOfflineRuns` callable writes on its behalf
with the Admin SDK. Everything below is what that callable produces that differs from,
or adds to, what firekit produces online. Run the support repo's
`npm run schema:contract:all` and the stage validators before merging.

## 1) Scope and impact

Entities touched: `users/{uid}/runs/{runId}` (create/overwrite), `users/{uid}/runs/{runId}/trials/{trialId}` (create/overwrite), `users/{uid}` (`tasks`, `variants`, `lastUpdated` — same as firekit's `startRun`).
Not touched: `assignments` (the existing `syncOnRunDocUpdate` trigger updates them), `surveyResponses`, `administrations`.

Paths and ids:

| What | Online (firekit) | Offline sync | Note |
|---|---|---|---|
| run id | Firestore auto-id | client UUID v4 (`runId`) | still a single-segment string; re-sync overwrites the same doc (idempotent) |
| trial id | Firestore auto-id | `t` + zero-padded `trialIndex` (`t00007`) | ordering recoverable from the id; re-sync overwrites |
| cardinality | one run doc per attempt; one trial doc per saved trial | same | |

## 2) Field-level differences

### Run document (`users/{uid}/runs/{runId}`)

| Field | Online | Offline | Change type |
|---|---|---|---|
| `timeStarted`, `timeFinished` | `serverTimestamp()` at write time (≈ collection time) | `Timestamp` = device clock **corrected by the measured device↔server offset** at sync | semantics: collection time, not arrival time (this is the intended meaning downstream) |
| `taskVersion` | number from the dashboard's `package-lock` | **string** (`"1.3.17"`, the core-tasks package version) | **type change** — downstream code parsing this as a number must accept strings; alternatively the callable can emit the numeric form |
| `variantParams` | present | present (params pinned on the administration) | none |
| `aborted` | — | boolean | **new field** |
| `stopReason` | string | string | none |
| `scores.raw.composite.{practice,test}` | maintained per trial by firekit | computed at ingest (`numAttempted/numCorrect/numIncorrect`, last `thetaEstimate`/`thetaSE`) | same shape |
| `offline` (map) | — | `{ source, packId, packBuiltAt, deviceId, appBuild, corpusSha256, clockOffsetMs, deviceTimeStarted, deviceTimeFinished, trialCount, orphan, syncedAt, syncedBy }` | **new map**; `syncedAt` is the only server-time field for the run |
| `assigningOrgs`, `readOrgs` | copied from the assignment at `startRun` | copied from the assignment at sync; `null` + `offline.orphan=true` if the assignment is missing | same field, new failure mode (orphan runs are flagged, never dropped) |
| `userData.birthMonth/birthYear/assessmentPid/variantId` | from the user doc | from the pack roster (= the user doc at provisioning time) | none |

### Trial document (`…/trials/{trialId}`)

| Field | Online | Offline | Change type |
|---|---|---|---|
| `serverTimestamp`, `createdAt`, `updatedAt` | server time at write (≈ collection time) | server time **at ingest** (days later) | **semantics change** — downstream must stop treating `serverTimestamp` as collection time for offline trials |
| `clientTimestamp` | — | `Timestamp` = device time corrected by the clock offset | **new field** — the collection time for offline trials |
| `deviceTimestamp` | — | ISO string, raw device clock | **new field** (diagnostic) |
| `trialIndex` | from core-tasks | same, plus the outbox index | none |
| `offline` | — | `true` | **new field** |
| everything else | jsPsych trial data as written by core-tasks | identical (the same `trialSaving.ts` path produced it) | none |

Recommendation for the pipeline: define `collection_time = coalesce(clientTimestamp, serverTimestamp)` at the validator boundary, so online and offline trials read the same downstream. `server_timestamp` in the raw Redivis tables then remains "arrival time" for both.

### Device registry (`offlineDevices/{deviceId}`) — new collection

One document per launcher device id (minted on the device, `dev_<uuid>`), merged by
`provisionOfflinePack` and `syncOfflineRuns`. Fleet state only; nothing downstream depends on it.

| Field | Written by | Meaning |
|---|---|---|
| `deviceId`, `platform` (`web` / `capacitor-ios` / `capacitor-android`), `appBuild`, `lastSeenAt` | both | identity + last contact |
| `siteId`, `administrationId`, `packId`, `scope` (`{orgType, orgId, name, siteId}` or `null`), `locale`, `childCount`, `taskIds`, `provisionedAt`, `provisionedBy` | provision | what the device currently holds |
| `lastSyncAt`, `lastSyncBy`, `lastClockOffsetMs`, `runsSynced`, `trialsSynced` (increments) | sync | drain history |

## 2b) Callables

| Callable | Caller needs (permissions-core, on the administration's / child's site) | Input | Output |
|---|---|---|---|
| `listOfflineScopes` | `assignments:read` | `{administrationId}` | `{scopes: [{orgType: 'school'\|'cohort', orgId, name, siteId}]}` — the administration's own schools/cohorts if it targets some, else every unarchived school and cohort under its sites |
| `provisionOfflinePack` | `assignments:read` | `{administrationId, scope?: {orgType, orgId}, device?: {deviceId, platform, appBuild}}` | `{pack: {packId, administrationId, name, siteId, scope, locale, dateClosed, tasks[], children[], serverNowMs}}`; `children[].progress` is `{taskId: 'assigned'\|'started'\|'completed'}` from the assignment (`progress` map, either key spelling, or `completedOn`) so a second device shows what a first one collected. The scope must belong to the administration's site (`resolveSiteId`); roster = students with `<schools|groups>.current ∋ orgId` holding a visible assignment |
| `syncOfflineRuns` | `assignments:read` **and** `users:read` | `{deviceId, platform?, clientNowMs, run, trials[]}` | `{runId, trialsWritten, clockOffsetMs, orphan}` |

The sync gate is deliberately the research-assistant baseline: the matrix has no run-level
resource, and the decision (2026-09-04) is that RAs provision and drain devices without a
new role. The run is written with the Admin SDK; the caller never gets write access to
`users/{uid}/runs` themselves.

## 3) Cardinality and key safety

- Run and trial ids are client-generated; collisions are cryptographically negligible (UUID v4; trial ids scoped to the run). Re-syncing the same device twice produces no duplicates.
- One run per (child, task, attempt) exactly as online; a child can accumulate multiple runs per task, and the trigger picks the best run by the same rules.

## 4) Rollout and compatibility

- New fields are additive; the only type change is `taskVersion` (string). Old data is unaffected.
- The trigger's completion bug (`update-best-run-and-completion.ts`, hyphen vs underscore key) becomes visible with offline data because no `completeTask` call masks it; fix it before relying on trigger-only completion.
- Late arrivals: the Redivis exporter must pick up runs by ingest time (`offline.syncedAt` / trial `serverTimestamp`), not by `timeStarted`, or week-late data will be missed. Verify in `data-validator` / `site-ops-sync`.

## 5) Evidence

Emulator run on 2026-09-04 (see `RESULTS.md`): runs written under the child's uid, trials under `tNNNNN` ids, trigger recomputed `bestRun`, `progress.*`, `assessments[].runId/completedOn`.
