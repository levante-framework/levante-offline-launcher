# Spike results

Environment: macOS, Node 22, Playwright (Chromium 151 / WebKit 26.5), Firebase emulator suite
(auth + firestore + functions) running the real `levante-admin` functions codebase plus the
two new callables. core-tasks 1.3.17 + the `levante-in-a-box` asset commit.

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

Real Safari on an iPad remains untested: this machine has no Xcode or simulators.

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
