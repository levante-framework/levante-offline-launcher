// BrowserStack real-device variant of offline-run.mjs.
// Local Chromium/WebKit/Android-emulator paths stay in offline-run.mjs.
//
//   node test/offline-run-browserstack.mjs --device ios
//   node test/offline-run-browserstack.mjs --device android
//
// Env: BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY (or ~/.cursor/mcp.json).
// The launcher + emulator + bundles must already be serving on this machine;
// BrowserStack Local tunnels 127.0.0.1 to the real device.
//
// Offline: BrowserStack Automate (web) has no documented mid-session airplane-mode
// control on real devices. Default --offline-mode local-down stops the Local
// tunnel (device cannot reach origin/emulator/bundles; CDP stays on BS cloud).
// --offline-mode emulated tries Playwright setOffline (Android Chrome maybe).
// --offline-mode profile tries browserstack_executor updateNetworkProfile.
// True radio-off needs App Automate + a native binary (separate task).

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);

const DEVICE_PRESETS = {
  ios: { deviceName: 'iPad Air 11 2026', osVersion: '26', browser: 'safari', os: 'ios' },
  android: { deviceName: 'Samsung Galaxy Tab S11', osVersion: '16.0', browser: 'chrome', os: 'android' },
};

const KIND = args.device === 'android' ? 'android' : 'ios';
const PRESET = DEVICE_PRESETS[KIND];
const DEVICE_NAME = args['device-name'] || process.env.BS_DEVICE || PRESET.deviceName;
const OS_VERSION = args['os-version'] || process.env.BS_OS_VERSION || PRESET.osVersion;
const BROWSER_NAME = args.browser || process.env.BS_BROWSER || PRESET.browser;
const OFFLINE_MODE = args['offline-mode'] || 'local-down';
const URL = args.url || 'https://bs-local.com:4173';
const TASKS = String(args.tasks || args.task || 'hearts-and-flowers').split(',');
const CHILD = args.child || 'Ada';
const ADMINISTRATION = args.administration || 'Offline spike';
const SCOPE = args.scope || 'Sunrise';
const MAX_SECONDS = Number(args['max-seconds'] || 240);
const IDLE_AFTER_PROVISION_MS = Number(args['idle-ms'] || 90_000);
const [PROCTOR_EMAIL, PROCTOR_PASSWORD] = String(args.proctor || 'ra@levante.test:ra123456').split(':');
const PIN = args.pin || '2468';
const OUT = path.resolve(args.out || `test/out/browserstack-${KIND}`);
const LOCAL_ID = process.env.BS_LOCAL_IDENTIFIER || `levante-offline-${process.pid}`;
await mkdir(OUT, { recursive: true });

function loadBsCreds() {
  if (process.env.BROWSERSTACK_USERNAME && process.env.BROWSERSTACK_ACCESS_KEY) {
    return { user: process.env.BROWSERSTACK_USERNAME, key: process.env.BROWSERSTACK_ACCESS_KEY };
  }
  const mcpPath = path.join(process.env.HOME, '.cursor/mcp.json');
  const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
  const env = mcp.mcpServers?.browserstack?.env || {};
  return { user: env.BROWSERSTACK_USERNAME, key: env.BROWSERSTACK_ACCESS_KEY };
}

const creds = loadBsCreds();
if (!creds.user || !creds.key) throw new Error('Missing BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY');

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} not up`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function startLocal(key) {
  let Local;
  try {
    ({ Local } = await import('browserstack-local'));
  } catch {
    throw new Error('Install browserstack-local in shell/: npm i -D browserstack-local');
  }
  const bsLocal = new Local();
  await new Promise((resolve, reject) => {
    bsLocal.start(
      {
        key,
        force: true,
        forceLocal: true,
        localIdentifier: LOCAL_ID,
        onlyAutomate: true,
        httpsPorts: '4173',
      },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  console.log(`BrowserStack Local started (id=${LOCAL_ID})`);
  return bsLocal;
}

async function stopLocal(bsLocal) {
  if (!bsLocal) return;
  await new Promise((resolve) => bsLocal.stop(() => resolve()));
  console.log('BrowserStack Local stopped');
}

function buildCaps() {
  // Official Playwright-iOS/Android caps only: extra keys (resolution, consoleLogs) are rejected on iOS.
  return {
    browser: BROWSER_NAME,
    osVersion: OS_VERSION,
    deviceName: DEVICE_NAME,
    realMobile: 'true',
    project: process.env.BS_PROJECT_NAME || 'levante-offline-launcher',
    build: process.env.BS_BUILD_NAME || `offline-pwa-${new Date().toISOString().slice(0, 10)}`,
    name: `PWA ${KIND} ${DEVICE_NAME} ${OS_VERSION} ${BROWSER_NAME}`,
    'browserstack.username': creds.user,
    'browserstack.accessKey': creds.key,
    'browserstack.local': 'true',
    'browserstack.localIdentifier': LOCAL_ID,
    'browserstack.debug': 'true',
    'browserstack.networkLogs': 'true',
    'browserstack.idleTimeout': process.env.BS_IDLE_TIMEOUT || '300',
  };
}

async function connectBrowser() {
  const caps = buildCaps();
  const wsEndpoint = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
  console.log(`connecting Playwright → ${DEVICE_NAME} ${OS_VERSION} ${BROWSER_NAME}…`);
  const browser = await chromium.connect({ wsEndpoint, timeout: 180_000 });
  return browser;
}

async function markSession(page, status, reason) {
  try {
    await page.evaluate(
      () => {},
      `browserstack_executor: ${JSON.stringify({ action: 'setSessionStatus', arguments: { status, reason: String(reason).slice(0, 255) } })}`,
    );
  } catch {
    /* session already gone */
  }
}

async function tryExecutor(page, action, extraArgs) {
  try {
    const result = await page.evaluate(
      () => {},
      `browserstack_executor: ${JSON.stringify({ action, arguments: extraArgs })}`,
    );
    return { method: `browserstack_executor.${action}`, ok: true, result };
  } catch (e) {
    return { method: `browserstack_executor.${action}`, ok: false, error: e.message };
  }
}

const networkAttempts = [];
let bsLocal = null;

async function goOffline(context, page) {
  if (OFFLINE_MODE === 'emulated') {
    try {
      await context.setOffline(true);
      networkAttempts.push({ phase: 'offline', method: 'playwright.setOffline', ok: true });
    } catch (e) {
      networkAttempts.push({ phase: 'offline', method: 'playwright.setOffline', ok: false, error: e.message });
      throw e;
    }
    return;
  }
  if (OFFLINE_MODE === 'profile') {
    const r = await tryExecutor(page, 'updateNetworkProfile', { profileName: 'offline' });
    networkAttempts.push({ phase: 'offline', ...r });
    if (!r.ok) {
      const r2 = await tryExecutor(page, 'updateNetwork', { networkProfile: 'offline' });
      networkAttempts.push({ phase: 'offline', ...r2 });
      if (!r2.ok) throw new Error('BrowserStack network-profile toggle failed; use --offline-mode local-down');
    }
    return;
  }
  await stopLocal(bsLocal);
  bsLocal = null;
  networkAttempts.push({ phase: 'offline', method: 'local-down', ok: true });
  await new Promise((r) => setTimeout(r, 1500));
}

async function goOnline(context, page) {
  if (OFFLINE_MODE === 'emulated') {
    try {
      await context.setOffline(false);
      networkAttempts.push({ phase: 'online', method: 'playwright.setOffline', ok: true });
    } catch (e) {
      networkAttempts.push({ phase: 'online', method: 'playwright.setOffline', ok: false, error: e.message });
    }
    return;
  }
  if (OFFLINE_MODE === 'profile') {
    const r = await tryExecutor(page, 'updateNetworkProfile', { profileName: 'reset' });
    networkAttempts.push({ phase: 'online', ...r });
    return;
  }
  bsLocal = await startLocal(creds.key);
  networkAttempts.push({ phase: 'online', method: 'local-up', ok: true });
  await new Promise((r) => setTimeout(r, 2000));
}

async function storageSnapshot(page, label) {
  const snap = await page.evaluate(async () => {
    const out = { persisted: null, persistGranted: null, persistError: null, estimate: null, estimateError: null };
    try {
      if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
    } catch (e) {
      out.persistError = String(e?.message || e);
    }
    try {
      if (navigator.storage?.estimate) {
        const e = await navigator.storage.estimate();
        out.estimate = { usage: e.usage ?? null, quota: e.quota ?? null, usageDetails: e.usageDetails ?? null };
      } else {
        out.estimateError = 'navigator.storage.estimate missing';
      }
    } catch (e) {
      out.estimateError = String(e?.message || e);
    }
    return out;
  });
  console.log(`   storage[${label}]: ${JSON.stringify(snap)}`);
  return snap;
}

async function waitForText(page, pattern, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await page.evaluate((p) => {
      const re = new RegExp(p, 'i');
      return re.test((document.body?.innerText || '').replace(/\s+/g, ' '));
    }, pattern);
    if (found) return;
    await page.waitForTimeout(400);
  }
  throw new Error(`timeout waiting for text /${pattern}/`);
}

async function fillInput(page, selector, value) {
  await page.evaluate(
    ([sel, val]) => {
      const input = document.querySelector(sel);
      if (!input) throw new Error(`missing ${sel}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      input.focus();
      setter?.call(input, val);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertText' }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [selector, value],
  );
}

async function clickText(page, pattern) {
  const ok = await page.evaluate((p) => {
    const re = new RegExp(p, 'i');
    const el = [...document.querySelectorAll('button, a, [role=button]')].find((e) => re.test((e.textContent || '').replace(/\s+/g, ' ')));
    if (!el) return false;
    el.click();
    return true;
  }, pattern);
  if (!ok) throw new Error(`no clickable text matching /${pattern}/`);
}

async function pageHas(page, selector) {
  try {
    return (await page.locator(selector).count()) > 0;
  } catch {
    return page.evaluate((sel) => !!document.querySelector(sel), selector).catch(() => false);
  }
}

async function dumpPage(page, label) {
  const info = await page
    .evaluate(() => ({
      href: location.href,
      title: document.title,
      ready: document.readyState,
      ua: navigator.userAgent,
      sw: 'serviceWorker' in navigator,
      storage: typeof navigator.storage,
      body: (document.body?.innerText || '').slice(0, 400),
    }))
    .catch((e) => ({ evaluateError: e.message }));
  console.log(`   page[${label}]: ${JSON.stringify(info)}`);
  return info;
}

async function requestPersist(page) {
  const result = await page.evaluate(async () => {
    try {
      if (!navigator.storage?.persist) return { persistGranted: null, persistError: 'navigator.storage.persist missing' };
      const persistGranted = await navigator.storage.persist();
      const persisted = await navigator.storage.persisted();
      return { persistGranted, persisted, persistError: null };
    } catch (e) {
      return { persistGranted: false, persistError: String(e?.message || e) };
    }
  });
  console.log(`   persist(): ${JSON.stringify(result)}`);
  return result;
}

const steps = {};
function record(step, status, detail) {
  steps[step] = { status, detail };
  console.log(`   [${status}] ${step}${detail ? ` — ${detail}` : ''}`);
}

const idbErrors = [];
const failed = [];
const requested = { online: 0, offline: 0 };
let offline = false;
const storage = {};

bsLocal = await startLocal(creds.key);
let browser;
let context;
let page;
try {
  browser = await connectBrowser();
  try {
    context = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await context.newPage();
  } catch {
    context = browser.contexts()[0] || (await browser.newContext());
    page = context.pages()[0] || (await context.newPage());
  }
  await context.addInitScript(() => {
    window.Cypress = true;
  });
} catch (e) {
  await stopLocal(bsLocal);
  throw new Error(`Playwright connect failed (${DEVICE_NAME} ${OS_VERSION} ${BROWSER_NAME}): ${e.message}`);
}

page.on('request', () => (offline ? requested.offline++ : requested.online++));
page.on('requestfailed', (req) => offline && failed.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
page.on('pageerror', (err) => {
  console.log('  [pageerror]', err.message.slice(0, 200));
  if (/IndexedDB|InvalidStateError|TransactionInactive|UnknownError|QuotaExceeded/i.test(err.message)) {
    idbErrors.push(err.message.slice(0, 240));
  }
});
page.on('console', (msg) => {
  const t = msg.text();
  if (msg.type() === 'error') console.log('  [console.error]', t.slice(0, 160));
  if (/IndexedDB|InvalidStateError|TransactionInactive|UnknownError|QuotaExceeded/i.test(t)) idbErrors.push(t.slice(0, 240));
});

const idb = {
  all: () =>
    page.evaluate(async () => {
      const store = await window.__levanteStore;
      return { runs: await store.listRuns(), trials: await store.allTrials(), packs: await store.listPacks() };
    }),
  raw: () =>
    page.evaluate(async () => {
      const open = () =>
        new Promise((res, rej) => {
          const r = indexedDB.open('levante-offline');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      const db = await open();
      const all = (store) =>
        new Promise((res, rej) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      const runs = await all('runs');
      const trials = await all('trials');
      const packs = await all('packs');
      db.close();
      const text = JSON.stringify({ runs, trials, packs });
      return {
        runKeys: Object.keys(runs[0] ?? {}),
        trialKeys: Object.keys(trials[0] ?? {}),
        packKeys: Object.keys(packs[0] ?? {}),
        plaintextLeak: /Lovelace|Pascal|Hesse|DEMO-A|birthYear|assessment_stage/.test(text),
      };
    }),
};

try {
  console.log(`1. provisioning at ${URL} as ${PROCTOR_EMAIL} on ${DEVICE_NAME}…`);
  await page.goto(`${URL}/#/provision`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(3000);
  await dumpPage(page, 'after-goto');
  await page.screenshot({ path: path.join(OUT, '0-landed.png') }).catch(() => {});
  const landed = await page.evaluate(() => /Device PIN|Signed in|Provision/i.test(document.body?.innerText || ''));
  if (!landed) {
    console.log('   retrying navigation…');
    await page.goto(`${URL}/#/provision`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForTimeout(4000);
    await dumpPage(page, 'after-retry');
  }
  storage.beforeProvision = await storageSnapshot(page, 'before-provision');
  storage.persist = await requestPersist(page);

  if (await page.evaluate(() => 'serviceWorker' in navigator)) {
    await page.waitForFunction(() => navigator.serviceWorker?.getRegistration().then((r) => !!r?.active), null, { timeout: 60_000 });
    record('service-worker', 'pass', 'active');
  } else {
    record('service-worker', 'fail', 'navigator.serviceWorker missing');
  }

  if (await pageHas(page, 'input[name=pin]')) {
    await fillInput(page, 'input[name=pin]', PIN);
    await fillInput(page, 'input[name=pinConfirm]', PIN);
    await clickText(page, 'Set PIN');
    await waitForText(page, 'Device PIN set', 30_000);
    record('vault', 'pass', 'PIN set');
  } else {
    record('vault', 'skip', 'PIN already set');
  }

  await fillInput(page, 'input[type=email]', PROCTOR_EMAIL);
  await fillInput(page, 'input[type=password]', PROCTOR_PASSWORD);
  await clickText(page, 'Sign in|Log in|Submit');
  try {
    await waitForText(page, 'Signed in as', 60_000);
  } catch (e) {
    await dumpPage(page, 'sign-in-failed');
    throw e;
  }
  record('sign-in', 'pass', PROCTOR_EMAIL);
  await dumpPage(page, 'signed-in');

  await clickText(page, 'administrations');
  await waitForText(page, ADMINISTRATION, 60_000);
  await clickText(page, ADMINISTRATION);
  if (SCOPE !== 'site') {
    await waitForText(page, SCOPE, 60_000);
    await clickText(page, SCOPE);
  }
  const t0p = Date.now();
  await clickText(page, 'Provision this device');
  try {
    await waitForText(page, 'Provisioned', 10 * 60_000);
  } catch (e) {
    await dumpPage(page, 'provision-timeout');
    await page.screenshot({ path: path.join(OUT, '1-provision-timeout.png') }).catch(() => {});
    throw e;
  }
  const provisionMsg = await page.evaluate(() => document.querySelector('.notice')?.textContent?.trim());
  record('provision', 'pass', `${provisionMsg} (${((Date.now() - t0p) / 1000).toFixed(0)}s)`);
  storage.afterProvision = await storageSnapshot(page, 'after-provision');
  await page.screenshot({ path: path.join(OUT, '1-provisioned.png') });

  if (IDLE_AFTER_PROVISION_MS > 0) {
    console.log(`   idle ${IDLE_AFTER_PROVISION_MS / 1000}s (BrowserStack cannot hold a device for days)…`);
    await page.waitForTimeout(IDLE_AFTER_PROVISION_MS);
    storage.afterIdle = await storageSnapshot(page, 'after-idle');
    const before = storage.afterProvision?.estimate?.usage;
    const after = storage.afterIdle?.estimate?.usage;
    const evicted = typeof before === 'number' && typeof after === 'number' && after < before * 0.5;
    record('idle-eviction', evicted ? 'fail' : 'pass', `usage ${before} → ${after} (short idle only)`);
  }

  console.log(`2. going offline (${OFFLINE_MODE}) and reloading…`);
  await goOffline(context, page);
  offline = true;
  await page.goto(`${URL}/#/`, { waitUntil: 'load', timeout: 60_000 });
  await page.reload({ waitUntil: 'load', timeout: 60_000 });
  await waitForText(page, 'Who is playing', 45_000);
  record('offline-roster', 'pass', `mode=${OFFLINE_MODE}`);
  await page.screenshot({ path: path.join(OUT, '2-offline-roster.png') });

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
    await clickText(page, CHILD);
    await clickText(page, task);
    try {
      await page.waitForSelector('.jspsych-content-wrapper', { timeout: 90_000 });
    } catch {
      mountFailures.push(task);
      record(`task-mount:${task}`, 'fail', 'no jsPsych wrapper');
      await page.screenshot({ path: path.join(OUT, `3-${task}-failed.png`) });
      await page.goto(`${URL}/#/`, { waitUntil: 'load', timeout: 60_000 });
      continue;
    }
    record(`task-mount:${task}`, 'pass');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `3-${task}-start.png`) });

    const t0 = Date.now();
    let clicks = 0;
    let lastTrials = -1;
    let lastChange = Date.now();
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
          /* vanished */
        }
      }
      if (clicks % 10 === 0) {
        const { trials } = await idb.all();
        if (trials.length !== lastTrials) {
          lastTrials = trials.length;
          lastChange = Date.now();
        } else if (Date.now() - lastChange > 90_000) {
          break;
        }
      }
      await page.waitForTimeout(clicked ? 700 : 400);
    }
    record(`task-play:${task}`, clicks > 0 ? 'pass' : 'fail', `${clicks} clicks`);
    if (!(await page.evaluate(() => location.hash === '' || location.hash === '#/'))) {
      await page.goto(`${URL}/#/`, { waitUntil: 'load', timeout: 60_000 });
    }
    await waitForText(page, 'Who is playing', 45_000);
  }

  const raw = await idb.raw();
  record('idb-sealed', raw.plaintextLeak ? 'fail' : 'pass', `keys runs=${raw.runKeys.join(',')} leak=${raw.plaintextLeak}`);
  const { runs, trials, packs } = await idb.all();
  const summary = runs.map((r) => {
    const mine = trials.filter((t) => t.runId === r.runId);
    return {
      runId: r.runId,
      taskId: r.taskId,
      child: r.child?.assessmentPid ?? r.child?.localId,
      completed: r.completed,
      trialCount: mine.length,
    };
  });
  record('idb-runs', summary.length && trials.length ? 'pass' : 'fail', `${summary.length} runs / ${trials.length} trials`);
  console.log('   packs:', packs.map((p) => `${p.packId} ${p.status} ${p.filesDone}/${p.fileCount}`).join('; '));
  console.log('   runs:', JSON.stringify(summary));

  await page.goto(`${URL}/#/`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForSelector('.child .progress', { timeout: 30_000 });
  const rosterProgress = await page.$$eval('.child', (els) =>
    els.map((el) => `${el.querySelector('strong')?.textContent?.trim()}: ${el.querySelector('.progress')?.textContent?.trim()}`),
  );
  record('offline-progress', 'pass', rosterProgress.join(' | '));

  await clickText(page, 'Start child mode');
  await waitForText(page, 'Proctor', 15_000);
  const kioskLinks = await page.$$eval('.status-bar a', (els) => els.length).catch(() => -1);
  await page.goto(`${URL}/#/sync`, { waitUntil: 'load', timeout: 60_000 });
  await waitForText(page, 'Who is playing', 30_000);
  const kioskRedirected = !(await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => /sync/i.test(b.textContent || '') && !/child/i.test(b.textContent || '')),
  ));
  await clickText(page, 'Proctor');
  await page.fill('input[name=exitPin]', '0000');
  await clickText(page, 'Exit child mode');
  const wrongPinRejected = await waitForText(page, 'wrong|incorrect|invalid', 10_000)
    .then(() => true)
    .catch(() => false);
  await page.fill('input[name=exitPin]', PIN);
  await clickText(page, 'Exit child mode');
  await page.waitForSelector('a[href="#/sync"]', { timeout: 15_000 });
  record('child-mode', kioskLinks === 0 && kioskRedirected && wrongPinRejected ? 'pass' : 'fail', `hidden=${kioskLinks === 0} redirect=${kioskRedirected} badPin=${wrongPinRejected}`);

  console.log('6. back online; syncing…');
  await goOnline(context, page);
  offline = false;
  await page.goto(`${URL}/#/sync`, { waitUntil: 'load', timeout: 90_000 });
  await page.reload({ waitUntil: 'load', timeout: 90_000 });
  if (await pageHas(page, 'input[type=email]')) {
    await page.fill('input[type=email]', PROCTOR_EMAIL);
    await page.fill('input[type=password]', PROCTOR_PASSWORD);
    await page.click('button[type=submit]');
  } else {
    await clickText(page, '^Sync$|Sync now|Sync runs');
  }
  await page.waitForSelector('.notice, .error', { timeout: 90_000 });
  const syncMsg = await page.evaluate(() => document.querySelector('.notice, .error')?.textContent?.trim());
  record('sync', /synced/i.test(syncMsg || '') && !/error/i.test(syncMsg || '') ? 'pass' : 'fail', syncMsg);
  await page.screenshot({ path: path.join(OUT, '6-synced.png') });

  let inspect = null;
  try {
    const inspectPath = path.resolve(__dirname, '../../emulator/inspect.mjs');
    if (existsSync(inspectPath)) {
      const { execFile } = await import('node:child_process');
      inspect = await new Promise((resolve, reject) => {
        execFile('node', [inspectPath], { cwd: path.dirname(inspectPath), timeout: 30_000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
      });
      record('inspect', /run /.test(inspect) ? 'pass' : 'fail', inspect.slice(0, 400));
    }
  } catch (e) {
    record('inspect', 'fail', e.message);
  }

  const ok = Object.values(steps).every((s) => s.status !== 'fail') && trials.length > 0 && mountFailures.length === 0;
  await markSession(page, ok ? 'passed' : 'failed', ok ? 'PWA loop + storage probes' : JSON.stringify(steps).slice(0, 240));

  const report = {
    device: DEVICE_NAME,
    osVersion: OS_VERSION,
    browser: BROWSER_NAME,
    kind: KIND,
    offlineMode: OFFLINE_MODE,
    url: URL,
    proctor: PROCTOR_EMAIL,
    tasks: TASKS,
    steps,
    storage,
    networkAttempts,
    idbErrors,
    failedOfflineRequests: failed.slice(0, 20),
    requested,
    runs: summary,
    inspect,
    sessionNote: 'Capacitor native .ipa/.apk is App Automate, not this Automate web run.',
  };
  await writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2));
  console.log(`\nRESULT ${ok ? 'PASS' : 'FAIL'} → ${path.join(OUT, 'result.json')}`);
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  record('aborted', 'fail', e.message);
  console.error(e);
  if (page) await markSession(page, 'failed', e.message).catch(() => {});
  await writeFile(
    path.join(OUT, 'result.json'),
    JSON.stringify({ device: DEVICE_NAME, osVersion: OS_VERSION, browser: BROWSER_NAME, steps, storage, networkAttempts, idbErrors, error: e.message }, null, 2),
  );
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await stopLocal(bsLocal);
}
