// End-to-end proof of the full launcher loop, run against a built shell served by `vite preview`
// with the Firebase emulator seeded (../emulator):
//   1. Provision online: sign in as the proctor, pick the administration, download the pack.
//   2. Switch the browser context offline (Chromium's network stack refuses every request).
//   3. Reload, pick a child, and play each requested task by clicking through it.
//   4. Assert no request failed offline and that runs + trials landed in IndexedDB.
//   5. Write the export bundle to test/out/.
//   6. Reconnect and sync through the app's own Sync page.
//
//   node test/offline-run.mjs [--url http://127.0.0.1:4173] [--tasks hearts-and-flowers,egma-math]
//                             [--child Ada] [--administration "Offline spike"] [--scope Sunrise|site] [--max-seconds 240]
//                             [--proctor proctor@levante.test:proctor123]

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);
// Two ways to be offline: 'emulated' uses the browser's network emulation (Chromium);
// 'server-down' starts its own web server for the app and kills it for the offline phase,
// so every app request fails at the TCP level unless the service worker answers it — the
// physical equivalent of a tablet losing Wi‑Fi, and the only mode WebKit handles.
const OFFLINE_MODE = args['offline-mode'] || (args.browser === 'webkit' ? 'server-down' : 'emulated');
const OWN_PORT = Number(args.port || 4174);
let server = null;
if (OFFLINE_MODE === 'server-down') {
  server = spawn('npx', ['vite', 'preview', '--port', String(OWN_PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
  await waitForPort(OWN_PORT, 30_000);
}
const URL = args.url || (OFFLINE_MODE === 'server-down' ? `http://127.0.0.1:${OWN_PORT}` : 'http://127.0.0.1:4173');
const TASKS = String(args.tasks || args.task || 'hearts-and-flowers').split(',');

async function goOffline(context) {
  if (OFFLINE_MODE === 'server-down') {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
  } else {
    await context.setOffline(true);
  }
}

async function goOnline(context) {
  if (OFFLINE_MODE === 'server-down') {
    // The app shell stays served by the service worker; only the emulator needs to be reachable.
    return;
  }
  await context.setOffline(false);
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.end(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} not up`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}
const CHILD = args.child || 'Ada';
const ADMINISTRATION = args.administration || 'Offline spike';
// The school/cohort the device is provisioned for (text of its button); "site" = no scope offered.
const SCOPE = args.scope || 'Sunrise';
const MAX_SECONDS = Number(args['max-seconds'] || 240);
const [PROCTOR_EMAIL, PROCTOR_PASSWORD] = String(args.proctor || 'proctor@levante.test:proctor123').split(':');
const PIN = args.pin || '2468';
const OUT = path.resolve('test/out');
await mkdir(OUT, { recursive: true });

// --browser webkit runs the same proof on Playwright's WebKit build: not Safari on an iPad,
// but the same engine family for service worker / Cache Storage / IndexedDB behaviour.
const ENGINE = args.browser === 'webkit' ? 'webkit' : 'chromium';
const browser =
  ENGINE === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({
        headless: true,
        // Synthetic clicks are not user gestures; core-tasks awaits AudioContext.resume() before
        // advancing past its fullscreen gate, so let audio start without one.
        args: ['--autoplay-policy=no-user-gesture-required'],
      });
console.log(`engine: ${ENGINE} ${browser.version()}`);
const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'allow' });
// core-tasks marks the correct AFC option with `.correct` when it thinks it runs under Cypress,
// which lets the auto-player answer correctly when it finds one.
await context.addInitScript(() => {
  window.Cypress = true;
});
const page = await context.newPage();
const failed = [];
const requested = { online: 0, offline: 0 };
let offline = false;
page.on('request', () => (offline ? requested.offline++ : requested.online++));
page.on('requestfailed', (req) => offline && failed.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
page.on('pageerror', (err) => console.log('  [pageerror]', err.message.slice(0, 200)));
page.on('console', (msg) => msg.type() === 'error' && console.log('  [console.error]', msg.text().slice(0, 160)));

// Records are sealed at rest; read them back through the app's own (unlocked) store so the
// test sees what the app sees, and separately confirm the raw rows carry no plaintext.
const idb = {
  all: () =>
    page.evaluate(async () => {
      const store = await window.__levanteStore;
      return { runs: await store.listRuns(), trials: await store.allTrials(), packs: await store.listPacks() };
    }),
  raw: () =>
    page.evaluate(async () => {
      const open = () => new Promise((res, rej) => { const r = indexedDB.open('levante-offline'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const db = await open();
      const all = (store) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const runs = await all('runs');
      const trials = await all('trials');
      const packs = await all('packs');
      db.close();
      const text = JSON.stringify({ runs, trials, packs });
      return { runKeys: Object.keys(runs[0] ?? {}), trialKeys: Object.keys(trials[0] ?? {}), packKeys: Object.keys(packs[0] ?? {}), plaintextLeak: /Lovelace|Pascal|Hesse|DEMO-A|birthYear|assessment_stage/.test(text) };
    }),
};

// 1. Provision online.
console.log(`1. provisioning at ${URL} as ${PROCTOR_EMAIL}…`);
await page.goto(`${URL}/#/provision`, { waitUntil: 'load' });
await page.waitForFunction(() => navigator.serviceWorker?.getRegistration().then((r) => !!r?.active), null, { timeout: 60_000 });
if (await page.$('input[name=pin]')) {
  await page.fill('input[name=pin]', PIN);
  await page.fill('input[name=pinConfirm]', PIN);
  await page.click('button:has-text("Set PIN")');
  await page.waitForSelector('text=Device PIN set', { timeout: 30_000 });
  console.log('   device vault created (PIN set)');
}
await page.fill('input[type=email]', PROCTOR_EMAIL);
await page.fill('input[type=password]', PROCTOR_PASSWORD);
await page.click('button[type=submit]');
await page.waitForSelector('text=Signed in as', { timeout: 30_000 });
await page.click('button:has-text("administrations")');
await page.waitForSelector(`button.child:has-text("${ADMINISTRATION}")`, { timeout: 60_000 });
await page.click(`button.child:has-text("${ADMINISTRATION}")`);
if (SCOPE !== 'site') {
  await page.waitForSelector(`button.scope:has-text("${SCOPE}")`, { timeout: 60_000 });
  await page.click(`button.scope:has-text("${SCOPE}")`);
  console.log(`   scope: ${await page.evaluate(() => document.querySelector('button.scope.selected')?.textContent?.trim().replace(/\s+/g, ' '))}`);
}
const t0p = Date.now();
await page.click('button:has-text("Provision this device")');
await page.waitForSelector('.notice:has-text("Provisioned")', { timeout: 15 * 60_000 });
const provisionMsg = await page.evaluate(() => document.querySelector('.notice')?.textContent?.trim());
console.log(`   ${provisionMsg} (${((Date.now() - t0p) / 1000).toFixed(0)}s)`);
const cacheStats = await page.evaluate(async () => {
  const cache = await caches.open('levante-packs');
  const keys = await cache.keys();
  let bytes = 0;
  for (const key of keys) {
    const res = await cache.match(key);
    bytes += Number(res?.headers.get('content-length')) || 0;
  }
  return { entries: keys.length, bytes };
});
console.log(`   pack cache: ${cacheStats.entries} entries, ${(cacheStats.bytes / 1e6).toFixed(1)} MB by content-length; app precache active`);
await page.screenshot({ path: path.join(OUT, '1-provisioned.png') });

// 2. Go offline and reload the app cold.
console.log(`2. going offline (${OFFLINE_MODE}) and reloading…`);
await goOffline(context);
offline = true;
await page.goto(`${URL}/#/`, { waitUntil: 'load' });
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
console.log('   roster rendered from cache while offline');
await page.screenshot({ path: path.join(OUT, '2-offline-roster.png') });

// 3. Play each task.
const CLICK_SELECTORS = [
  '.correct:visible',
  '#jspsych-html-multi-response-btngroup button:visible',
  '.jspsych-btn:visible',
  '#jspsych-content button:visible',
  '.jspsych-content button:visible',
  '.jspsych-display-element button:visible',
  '.jspsych-display-element img.image:visible',
  '.jspsych-display-element .image-large:visible',
  '.jspsych-display-element [class*="response"] img:visible',
  '#jspsych-target button:visible',
];
const mountFailures = [];
for (const task of TASKS) {
  console.log(`3. ${task}: selecting ${CHILD} and starting the task offline…`);
  await page.click(`button.child:has-text("${CHILD}")`);
  const consoleErrors = [];
  const onConsole = (msg) => msg.type() === 'error' && consoleErrors.push(msg.text().slice(0, 300));
  page.on('console', onConsole);
  await page.click(`button:has-text("${task}")`);
  try {
    await page.waitForSelector('.jspsych-content-wrapper', { timeout: 60_000 });
  } catch {
    // A task that never mounts (e.g. corpus validation failed) must not end the battery.
    page.off('console', onConsole);
    const why = consoleErrors.find((t) => /Error/.test(t)) ?? 'no jsPsych wrapper within 60 s';
    console.log(`   FAILED TO MOUNT: ${why}`);
    mountFailures.push({ task, why });
    await page.screenshot({ path: path.join(OUT, `3-${task}-failed.png`) });
    await page.goto(`${URL}/#/`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
    continue;
  }
  page.off('console', onConsole);
  console.log('   task loaded (jsPsych mounted)');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `3-${task}-start.png`) });

  const t0 = Date.now();
  let clicks = 0;
  let lastTrials = -1;
  let lastChange = Date.now();
  let shots = 0;
  while (Date.now() - t0 < MAX_SECONDS * 1000) {
    const backOnRoster = await page.evaluate(() => (location.hash === '' || location.hash === '#/') && !document.querySelector('.jspsych-content-wrapper'));
    if (backOnRoster) break;
    let clicked = false;
    for (const sel of CLICK_SELECTORS) {
      const loc = page.locator(sel);
      const n = await loc.count().catch(() => 0);
      if (!n) continue;
      const idx = sel.startsWith('.correct') ? 0 : Math.floor(Math.random() * n);
      try {
        await loc.nth(idx).click({ timeout: 1500, force: true });
        clicked = true;
        clicks++;
        break;
      } catch {
        /* element vanished between count and click; try the next selector */
      }
    }
    if (clicks % 15 === 0 && clicks > 0 && shots < 3 && clicked) {
      shots++;
      await page.screenshot({ path: path.join(OUT, `4-${task}-${shots}.png`) });
    }
    if (clicks % 10 === 0) {
      const { trials } = await idb.all();
      if (trials.length !== lastTrials) {
        lastTrials = trials.length;
        lastChange = Date.now();
      } else if (Date.now() - lastChange > 90_000) {
        console.log('   no new trials for 90s; stopping this task');
        break;
      }
    }
    await page.waitForTimeout(clicked ? 700 : 400);
  }
  console.log(`   auto-play: ${clicks} clicks over ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!(await page.evaluate(() => location.hash === '' || location.hash === '#/'))) {
    await page.goto(`${URL}/#/`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
  }
  await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
}

// 4. Inspect IndexedDB — through the app (decrypted) and raw (must be sealed).
const raw = await idb.raw();
console.log(`4. raw IndexedDB rows: run keys=${raw.runKeys.join(',')} | trial keys=${raw.trialKeys.join(',')} | pack keys=${raw.packKeys.join(',')} | plaintext PII/trial leak: ${raw.plaintextLeak}`);
const { runs, trials, packs } = await idb.all();
const summary = runs.map((r) => {
  const mine = trials.filter((t) => t.runId === r.runId);
  return {
    runId: r.runId, taskId: r.taskId, child: r.child.assessmentPid ?? r.child.localId, uid: r.child.uid, completed: r.completed, aborted: r.aborted, stopReason: r.stopReason,
    trialCount: mine.length,
    stages: Object.fromEntries(mine.reduce((m, t) => m.set(t.data.assessment_stage, (m.get(t.data.assessment_stage) || 0) + 1), new Map())),
    thetaEstimates: mine.filter((t) => typeof t.data.thetaEstimate === 'number').map((t) => Number(t.data.thetaEstimate.toFixed(2))).slice(-4),
    started: r.timeStarted, finished: r.timeFinished,
    versions: { taskVersion: r.taskVersion, packId: r.packId, appBuild: r.appBuild, corpusSha256: r.corpusSha256?.slice(0, 12) },
  };
});
console.log('4. packs:', packs.map((p) => `${p.packId} ${p.status} ${p.filesDone}/${p.fileCount} files ${(p.totalBytes / 1e6).toFixed(1)} MB children=${p.children.length}`).join('; '));
console.log('   IndexedDB runs:', JSON.stringify(summary, null, 2));

// 5. Export bundle.
const bundle = {
  version: 1,
  exportedAt: new Date().toISOString(),
  deviceId: await page.evaluate(() => localStorage.getItem('levante-offline:device-id')),
  runs: runs.map((r) => ({ ...r, trials: trials.filter((t) => t.runId === r.runId).sort((a, b) => a.trialIndex - b.trialIndex) })),
};
await writeFile(path.join(OUT, 'export.json'), JSON.stringify(bundle, null, 2));

const totalTrials = summary.reduce((a, r) => a + r.trialCount, 0);
console.log(`\nRESULT: requests while offline: ${requested.offline} (failed: ${failed.length}); runs: ${summary.length}; trials: ${totalTrials}; tasks that did not mount: ${mountFailures.length}`);
if (failed.length) console.log('failed requests:\n  ' + failed.slice(0, 20).join('\n  '));
for (const f of mountFailures) console.log(`   did not mount: ${f.task} — ${f.why}`);

// 5b. Still offline: the roster must now show the run just collected as done (merged with
// the progress that came with the pack at provisioning).
await page.goto(`${URL}/#/`, { waitUntil: 'load' });
await page.waitForSelector('.child .progress', { timeout: 30_000 });
const rosterProgress = await page.$$eval('.child', (els) =>
  els.map((el) => `${el.querySelector('strong')?.textContent?.trim()}: ${el.querySelector('.progress')?.textContent?.trim()}`),
);
console.log(`   roster progress while offline: ${rosterProgress.join(' | ')}`);
await page.screenshot({ path: path.join(OUT, '5-roster-after-run.png') });

// 5c. Child (kiosk) mode: proctor controls gone, proctor routes redirect, PIN to leave.
await page.click('a:has-text("Start child mode")');
await page.waitForSelector('a:has-text("Proctor")', { timeout: 10_000 });
const kioskLinks = await page.$$eval('.status-bar a', (els) => els.length);
await page.goto(`${URL}/#/sync`, { waitUntil: 'load' });
await page.waitForSelector('h2:has-text("Who is playing?")', { timeout: 30_000 });
const kioskRedirected = !(await page.$('button:has-text("Sync")'));
await page.screenshot({ path: path.join(OUT, '5-child-mode.png') });
await page.click('a:has-text("Proctor")');
await page.fill('input[name=exitPin]', '0000');
await page.click('button:has-text("Exit child mode")');
const wrongPinRejected = !!(await page.waitForSelector('.proctor-exit .error', { timeout: 10_000 }));
await page.fill('input[name=exitPin]', PIN);
await page.click('button:has-text("Exit child mode")');
await page.waitForSelector('a[href="#/sync"]', { timeout: 10_000 });
console.log(`   child mode: proctor links hidden=${kioskLinks === 0}, #/sync redirected to roster=${kioskRedirected}, wrong PIN rejected=${wrongPinRejected}, exited with PIN`);

// 6. Reconnect and sync through the app's own Sync page (the proctor session is still live).
console.log('6. back online; syncing via the Sync page…');
await goOnline(context);
offline = false;
await page.goto(`${URL}/#/sync`, { waitUntil: 'load' });
await page.reload({ waitUntil: 'load' });
if (await page.$('input[type=email]')) {
  await page.fill('input[type=email]', PROCTOR_EMAIL);
  await page.fill('input[type=password]', PROCTOR_PASSWORD);
  await page.click('button[type=submit]');
} else {
  await page.click('button.primary:has-text("Sync")');
}
await page.waitForSelector('.notice, .error', { timeout: 90_000 });
console.log(`   ${await page.evaluate(() => document.querySelector('.notice, .error')?.textContent?.trim())}`);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, '6-synced.png') });
await browser.close();
server?.kill('SIGTERM');
process.exit(failed.length === 0 && totalTrials > 0 ? 0 : 1);
