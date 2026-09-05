# Spike results — BrowserStack real devices

Environment: WSL2, Node 24, Playwright 1.62 connecting to BrowserStack Automate
(`wss://cdp.browserstack.com/playwright`). Local stack: Firebase emulator
(`demo-levante-spike`) + `pack-builder` hearts-and-flowers bundles + HTTPS
`vite preview` on `:4173` tunneled with BrowserStack Local (`forceLocal`,
`httpsPorts=4173`). App origin on the device is `https://bs-local.com:4173`
(BrowserStack rewrites `127.0.0.1` / `localhost`).

Plan: **Automate Mobile**, 5 parallels, public terminal. Real iPad and Android
tablet names are on the account (`GET /automate/browsers.json`).

Driver: `shell/test/offline-run-browserstack.mjs` (local Chromium/WebKit path
untouched). Matrix in `shell/browserstack.yml`.

## Network toggle (Automate web, real devices)

| Mechanism | Controllable mid-session? | Notes |
|---|---|---|
| Playwright `context.setOffline()` | not used as primary | Official WebKit proof already crashed on emulation; iOS Playwright rejects several locator APIs |
| `browserstack.networkProfile` | session-start only | Existing Levante scripts (`4G`, `3G`, custom kbps) apply at session create |
| `browserstack_executor` `updateNetworkProfile` / `updateNetwork` | **not confirmed on Playwright Automate** | Documented for App Automate / Appium. Script can try `--offline-mode profile` |
| Airplane / radios | **no** on Automate (web) | Needs App Automate + Appium `network_connection` / `mobile: setConnectivity` |
| **`--offline-mode local-down` (default)** | yes | Stop BrowserStack Local so the device cannot reach origin/emulator/bundles; CDP stays on the cloud. Closest automated equivalent of Wi‑Fi loss. Restart Local to sync |

**Manual/local-device fallback is still required** if the field claim is
“radios off / airplane mode,” not “origin unreachable.”

Capacitor `.ipa` / `.apk` is **App Automate**, not this product. Native
binaries were not uploaded. Separate task.

## iPad Air 11 2026 — iOS 26.3 Safari (Playwright Automate) — 2026-09-05

Closest field match to the iPad Air 11" simulator in `RESULTS.md`. Session
example: Automate build `offline-pwa-2026-09-05`. UA reported as Macintosh
Safari 26.3 (Playwright-iOS bridge); Automate API listed `device=iPad Air 11 2026`,
`os=ios 26.3`, `browser=ipad`.

| Step | Outcome |
|---|---|
| Playwright CDP connect | pass |
| HTTPS Local + `bs-local.com` (Vite `allowedHosts` + preview proxy) | required — HTTP `bs-local.com` is **not** a secure context (no SW / no `navigator.storage`); Vite 6 also 403s unknown hosts |
| `navigator.storage.estimate()` before pack | **pass** — `usage≈1.08 MB` app shell → `≈4.5 MB` after pack; `quota≈38.4 GiB` |
| `navigator.storage.persist()` | **fail (product-relevant)** — returned `false`; `persisted()` stayed `false`. No prompt. Real Safari did not grant durable storage. |
| Service worker | pass — active on the HTTPS origin |
| Device PIN vault | pass |
| Sign-in `ra@levante.test` | pass |
| Pack download → UI “Provisioned” | **pass** — one-task seed (`SEED_TASKS=hearts-and-flowers`): 2 children, **1 task**, 105 files, 3.4 MB in **5–15 s** |
| Idle eviction (15–90 s) | no drop (`4.5 MB → 4.5 MB`). Not a 7-day Safari test |
| Offline roster (`local-down`) | **pass** — “Who is playing” + Ada/Blaise after Local stop + reload |
| hearts-and-flowers mount (offline) | **pass** — jsPsych loaded from the pack |
| hearts-and-flowers play / trials | **fail (harness)** — run started, **0 trials**. H&F ignores untrusted clicks (`touchResponseRouting.js`); Playwright-iOS `el.click()` is not a user gesture. Fullscreen OK also logs “no transient activation.” A child tapping should still work |
| Sync / `inspect.mjs` | not reached (selector strict-mode abort on `.child .progress`) |
| IndexedDB write errors | none |

Deviations from the iPad Air **simulator** (`RESULTS.md`):

- Real Safari **denied** `persist()`. The pack, if it had finished, would sit in
  evictable Cache Storage / IndexedDB. Field iPads left idle (Safari’s ~7-day
  eviction) are at risk until the Capacitor filesystem path or a successful
  persist grant is proven.
- BrowserStack sessions cannot sit idle for days; short idle is the most this
  cloud can do.
- Playwright-iOS `page.$` / `:has-text()` throw `browserstack_error` instead of
  returning empty; the BS driver uses `evaluate` clicks.
- First HTTP attempt never reached the app (Vite host allowlist + insecure
  origin). Simulator `http://127.0.0.1` is a secure context; real-device Local
  is not, unless HTTPS.

## Android tablet — Playwright Automate — 2026-09-05

| Device tried | Outcome |
|---|---|
| Samsung Galaxy Tab S11 / Android 16 / Chrome | CDP connect rejected: `Malformed endpoint` |
| Samsung Galaxy Tab S9 / Android 13 / Chrome | same |

Both names exist on the account’s **Selenium** Automate device list (and in
`scripts/browserstack-task-preload.mjs`). Playwright’s mobile CDP endpoint did
not accept them here. **Android PWA loop not run.** Retry options: Playwright
phone (Pixel / Galaxy S) as a Chrome stand-in, or a Selenium port of this
script (the org’s working iPad/Android path). Field-cheap tablet on the
account: **Galaxy Tab A9 Plus / Android 14**.

## Capacitor native

Out of scope for Automate web. Need signed `.ipa` / `.apk` on **App Automate**
for radio-off and filesystem-backend checks. Simulator/AVD status in
`RESULTS.md` still stands.

## How to re-run

```bash
# emulator + seed + bundles + HTTPS preview (see README quick start, then:)
cd shell
npm run build:browserstack && npm run preview:browserstack   # :4173 HTTPS + proxies
# other terminals: emulator `npm start` / `npm run seed` / `npm run bundles`

cd shell
# creds: BROWSERSTACK_* or ~/.cursor/mcp.json
node test/offline-run-browserstack.mjs --device ios \
  --proctor ra@levante.test:ra123456 --scope Sunrise --tasks hearts-and-flowers
```

One-task seed (required for this pack):

```bash
cd emulator && SEED_TASKS=hearts-and-flowers npm run seed
```

Full 11-task battery (~266 MB) through Local previously exceeded 15 minutes
because only hearts-and-flowers bundles were on `:4175`.
