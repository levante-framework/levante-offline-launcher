// Hosted -dev science-fair loop on BrowserStack real tablets.
// iOS: Playwright CDP. Android tablets: Selenium (Playwright CDP rejects them).
// --local / --offline-mode local-down: serve this machine over BrowserStack Local
// (https://bs-local.com:4173), stop the tunnel during play, start it again to sync.
//
//   set -a && source /home/david/levante/levante-support/.env && set +a
//   node test/science-fair-dev-browserstack.mjs --device android --local --max-children 1

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(here, '../../../levante-support/.env'));
loadEnvFile(path.resolve('/home/david/levante/levante-support/.env'));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);

const KIND = args.device === 'android' ? 'android' : 'ios';
const PRESETS = {
  ios: { deviceName: 'iPad Air 11 2026', osVersion: '26', browser: 'safari' },
  android: { deviceName: 'Samsung Galaxy Tab A9 Plus', osVersion: '14.0', browser: 'chrome' },
};
const PRESET = PRESETS[KIND];
const DEVICE_NAME = args['device-name'] || process.env.BS_DEVICE || PRESET.deviceName;
const OS_VERSION = args['os-version'] || process.env.BS_OS_VERSION || PRESET.osVersion;
const BROWSER_NAME = args.browser || process.env.BS_BROWSER || PRESET.browser;
const EMAIL = args.email || process.env.E2E_TEST_EMAIL || process.env.E2E_AI_SITE_ADMIN_EMAIL;
const PASSWORD = args.password || process.env.E2E_TEST_PASSWORD || process.env.E2E_AI_SITE_ADMIN_PASSWORD;
const PACK_LINK =
  args['pack-link'] ||
  process.env.SCIENCE_FAIR_PACK_LINK ||
  'https://hs-levante-admin-dev--offline-launcher-34g4znyg.web.app/#/provision?admin=jKRtdEUysi9OUYaGbkPG&orgType=cohort&orgId=e7k5XNp6NX9LCXoW6hzH';
const TASKS = String(args.tasks || 'hearts-and-flowers,intro')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const PLAY_LIMIT = Number(args['max-children'] || 0);
const MAX_SECONDS = Number(args['max-seconds'] || 300);
const USE_LOCAL = args.local === 'true' || args['offline-mode'] === 'local-down';
const LOCAL_ID = process.env.BS_LOCAL_IDENTIFIER || `levante-sf-${process.pid}`;
const LOCAL_ORIGIN = 'https://bs-local.com:4173';
const hostedPack = args['pack-link'] || PACK_LINK;
const APP_ORIGIN = USE_LOCAL ? LOCAL_ORIGIN : new URL(hostedPack).origin;
const APP_PACK_LINK = USE_LOCAL ? `${LOCAL_ORIGIN}/${new URL(hostedPack).hash}` : hostedPack;
const OUT = path.resolve(here, args.out || `out/science-fair-dev-bs-${KIND}${USE_LOCAL ? '-local' : ''}`);
await mkdir(OUT, { recursive: true });

if (!EMAIL || !PASSWORD) throw new Error('Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD');

function loadBsCreds() {
  if (process.env.BROWSERSTACK_USERNAME && process.env.BROWSERSTACK_ACCESS_KEY) {
    return { user: process.env.BROWSERSTACK_USERNAME, key: process.env.BROWSERSTACK_ACCESS_KEY };
  }
  const mcp = JSON.parse(readFileSync(path.join(process.env.HOME, '.cursor/mcp.json'), 'utf8'));
  const env = mcp.mcpServers?.browserstack?.env || {};
  return { user: env.BROWSERSTACK_USERNAME, key: env.BROWSERSTACK_ACCESS_KEY };
}

const creds = loadBsCreds();
if (!creds.user || !creds.key) throw new Error('Missing BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY');

const CLICK_SELECTORS = [
  '.correct',
  '#jspsych-html-multi-response-btngroup button',
  '.jspsych-btn',
  '#jspsych-content button',
  '.jspsych-content button',
  '.jspsych-display-element button',
  '.jspsych-display-element img.image',
  '.jspsych-display-element .image-large',
  '.jspsych-display-element [class*="response"] img',
  '#jspsych-target button',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let bsLocal = null;

async function startLocal() {
  const { Local } = await import('browserstack-local');
  const instance = new Local();
  await new Promise((resolve, reject) => {
    instance.start(
      {
        key: creds.key,
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
  return instance;
}

async function stopLocal(instance) {
  if (!instance) return;
  await new Promise((resolve) => instance.stop(() => resolve()));
  console.log('BrowserStack Local stopped');
}

async function connectPlaywright() {
  const caps = {
    browser: BROWSER_NAME,
    osVersion: OS_VERSION,
    deviceName: DEVICE_NAME,
    realMobile: 'true',
    project: process.env.BS_PROJECT_NAME || 'levante-offline-launcher',
    build: process.env.BS_BUILD_NAME || `science-fair-dev-${new Date().toISOString().slice(0, 10)}`,
    name: `science-fair ${KIND} ${DEVICE_NAME}`,
    'browserstack.username': creds.user,
    'browserstack.accessKey': creds.key,
    'browserstack.local': USE_LOCAL ? 'true' : 'false',
    ...(USE_LOCAL ? { 'browserstack.localIdentifier': LOCAL_ID } : {}),
    'browserstack.debug': 'true',
    'browserstack.idleTimeout': process.env.BS_IDLE_TIMEOUT || '900',
  };
  const wsEndpoint = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
  console.log(`connecting Playwright → ${DEVICE_NAME} ${OS_VERSION} ${BROWSER_NAME}…`);
  const browser = await chromium.connect({ wsEndpoint, timeout: 180_000 });
  let context;
  let page;
  try {
    context = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await context.newPage();
  } catch {
    context = browser.contexts()[0] || (await browser.newContext());
    page = context.pages()[0] || (await context.newPage());
  }
  await context.addInitScript(() => {
    window.Cypress = true;
    window.__LEVANTE_TEST_KEYS__ = true;
    try {
      window.localStorage.setItem('levante-test-keys', '1');
    } catch {
      /* ignore */
    }
  });
  return {
    kind: 'playwright',
    async goto(url) {
      try {
        await page.goto(url, { waitUntil: 'commit', timeout: 45_000 });
        await page.waitForTimeout(2000);
      } catch (e) {
        console.log(`   goto fallback: ${String(e.message || e).slice(0, 100)}`);
        await page.evaluate((u) => {
          window.location.href = u;
        }, url);
        await page.waitForTimeout(4000);
      }
    },
    async evaluate(fn, arg) {
      return arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg);
    },
    async press(key) {
      await page.keyboard.press(key).catch(() => {});
    },
    async screenshot(name) {
      await page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
    },
    async setOffline(offline) {
      if (USE_LOCAL) {
        if (offline) {
          await stopLocal(bsLocal);
          bsLocal = null;
        } else {
          bsLocal = await startLocal();
        }
        await sleep(2000);
        return { ok: true, method: offline ? 'local-down' : 'local-up' };
      }
      try {
        await context.setOffline(offline);
        return { ok: true, method: 'playwright.setOffline' };
      } catch (e) {
        return { ok: false, method: 'playwright.setOffline', error: e.message };
      }
    },
    async mark(status, reason) {
      try {
        await page.evaluate(
          () => {},
          `browserstack_executor: ${JSON.stringify({ action: 'setSessionStatus', arguments: { status, reason: String(reason).slice(0, 255) } })}`,
        );
      } catch {
        /* session gone */
      }
    },
    async close() {
      await browser.close().catch(() => {});
    },
  };
}

function wdClient() {
  const auth = Buffer.from(`${creds.user}:${creds.key}`).toString('base64');
  const hub = 'https://hub-cloud.browserstack.com/wd/hub';
  return async function wd(method, suffix, body) {
    const res = await fetch(`${hub}${suffix}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WD ${method} ${suffix} ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  };
}

const WD_KEYS = { ' ': '\uE00D', ArrowLeft: '\uE012', ArrowRight: '\uE014' };

async function connectWebDriver() {
  const wd = wdClient();
  console.log(`connecting Selenium → ${DEVICE_NAME} ${OS_VERSION} ${BROWSER_NAME}…`);
  const created = await wd('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: BROWSER_NAME,
        acceptInsecureCerts: true,
        'bstack:options': {
          deviceName: DEVICE_NAME,
          osVersion: OS_VERSION,
          realMobile: 'true',
          projectName: process.env.BS_PROJECT_NAME || 'levante-offline-launcher',
          buildName: process.env.BS_BUILD_NAME || `science-fair-dev-${new Date().toISOString().slice(0, 10)}`,
          sessionName: `science-fair ${KIND} ${DEVICE_NAME}${USE_LOCAL ? ' local-down' : ''}`,
          debug: true,
          idleTimeout: Number(process.env.BS_IDLE_TIMEOUT || 900),
          local: USE_LOCAL,
          ...(USE_LOCAL ? { localIdentifier: LOCAL_ID } : {}),
        },
      },
    },
  });
  const sid = created.value?.sessionId || created.sessionId;
  if (!sid) throw new Error(`no session id: ${JSON.stringify(created).slice(0, 200)}`);
  return {
    kind: 'webdriver',
    async goto(url) {
      await wd('POST', `/session/${sid}/url`, { url });
      await sleep(1500);
      await wd('POST', `/session/${sid}/execute/sync`, {
        script:
          'window.Cypress = true; window.__LEVANTE_TEST_KEYS__ = true; try { localStorage.setItem("levante-test-keys", "1"); } catch (e) {}',
        args: [],
      }).catch(() => {});
    },
    async evaluate(fn, arg) {
      const result = await wd('POST', `/session/${sid}/execute/sync`, {
        script: `return (${fn.toString()}).apply(null, arguments)`,
        args: arg === undefined ? [] : [arg],
      });
      return result.value;
    },
    async press(key) {
      const value = WD_KEYS[key] || key;
      try {
        await wd('POST', `/session/${sid}/actions`, {
          actions: [
            {
              type: 'key',
              id: 'keyboard',
              actions: [
                { type: 'keyDown', value },
                { type: 'keyUp', value },
              ],
            },
          ],
        });
        await wd('POST', `/session/${sid}/actions`, { actions: [] }).catch(() => {});
      } catch {
        await wd('POST', `/session/${sid}/execute/sync`, {
          script: 'document.dispatchEvent(new KeyboardEvent("keydown", { key: arguments[0], bubbles: true }));',
          args: [key],
        }).catch(() => {});
      }
    },
    async screenshot(name) {
      try {
        const shot = await wd('GET', `/session/${sid}/screenshot`);
        const b64 = shot.value || shot;
        if (typeof b64 === 'string') await writeFile(path.join(OUT, `${name}.png`), Buffer.from(b64, 'base64'));
      } catch {
        /* ignore */
      }
    },
    async setOffline(offline) {
      if (USE_LOCAL) {
        if (offline) {
          await stopLocal(bsLocal);
          bsLocal = null;
        } else {
          bsLocal = await startLocal();
        }
        await sleep(2000);
        return { ok: true, method: offline ? 'local-down' : 'local-up' };
      }
      const action = 'updateNetworkProfile';
      const profileName = offline ? 'offline' : 'reset';
      try {
        await wd('POST', `/session/${sid}/execute/sync`, {
          script: 'browserstack_executor: {"action":"updateNetworkProfile","arguments":{"profileName":arguments[0]}}',
          args: [profileName],
        });
        return { ok: true, method: `browserstack_executor.${action}` };
      } catch (e) {
        return { ok: false, method: `browserstack_executor.${action}`, error: e.message };
      }
    },
    async mark(status, reason) {
      try {
        await wd('POST', `/session/${sid}/execute/sync`, {
          script: `browserstack_executor: ${JSON.stringify({ action: 'setSessionStatus', arguments: { status, reason: String(reason).slice(0, 255) } })}`,
          args: [],
        });
      } catch {
        /* session gone */
      }
    },
    async close() {
      await wd('DELETE', `/session/${sid}`).catch(() => {});
    },
  };
}

async function waitFor(driver, fn, arg, timeout, label) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await driver.evaluate(fn, arg).catch((e) => e.message);
    if (last) return last;
    await sleep(400);
  }
  throw new Error(`timeout waiting for ${label} (last=${String(last).slice(0, 120)})`);
}

async function fillInput(driver, selector, value) {
  const ok = await driver.evaluate(
    ([sel, val]) => {
      const input = document.querySelector(sel);
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      input.focus();
      setter?.call(input, val);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertText' }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    [selector, value],
  );
  if (!ok) throw new Error(`missing ${selector}`);
}

async function clickText(driver, pattern) {
  const ok = await driver.evaluate((p) => {
    const re = new RegExp(p, 'i');
    const el = [...document.querySelectorAll('button, a, [role=button]')].find((e) =>
      re.test((e.textContent || '').replace(/\s+/g, ' ')),
    );
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
    if (typeof el.click === 'function') el.click();
    return true;
  }, pattern);
  if (!ok) throw new Error(`no clickable text matching /${pattern}/`);
}

const idbAll = (driver) =>
  driver.evaluate(async () => {
    const store = await window.__levanteStore;
    return { runs: await store.listRuns(), trials: await store.allTrials(), packs: await store.listPacks() };
  });

async function launcherSignIn(driver) {
  const needs = await driver.evaluate(() => !!document.querySelector('input[type=email]'));
  if (!needs) return;
  await fillInput(driver, 'input[type=email]', EMAIL);
  await fillInput(driver, 'input[type=password]', PASSWORD);
  await clickText(driver, 'Sign in|Log in|Submit');
  await waitFor(driver, () => /Signed in as/i.test(document.body?.innerText || ''), null, 60_000, 'signed in');
}

async function continueFromSiteIfNeeded(driver) {
  const onSite = await driver.evaluate(() => /Which site\?/i.test(document.body?.innerText || ''));
  if (!onSite) return;
  const picked = await driver.evaluate(() => {
    const selected = document.querySelector('button.child.selected') || document.querySelector('button.child');
    if (!selected) return '';
    selected.click();
    return (selected.textContent || '').replace(/\s+/g, ' ').trim();
  });
  console.log(`   site: ${picked || '(none)'}`);
  await clickText(driver, 'Continue to provision');
  await waitFor(driver, () => /Packs for this site/i.test(document.body?.innerText || ''), null, 60_000, 'packs');
}

async function waitForDownloadEnabled(driver, packLink) {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await continueFromSiteIfNeeded(driver).catch(() => {});
    const enabled = await driver.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find((e) =>
        /Download pack|Provision this device/i.test(e.textContent || ''),
      );
      return !!(el && !el.disabled);
    });
    if (enabled) return;
    const err = await driver.evaluate(() => document.querySelector('.error')?.textContent?.trim() || '');
    console.log(`   waiting for assignment/cohort to finish processing… ${err.slice(0, 80)}`);
    await sleep(8_000);
    const stillThere = await driver.evaluate(() => /Download pack|Provision this device|Signed in as|Which site/i.test(document.body?.innerText || ''));
    if (!stillThere) {
      await driver.goto(packLink);
      await launcherSignIn(driver);
    }
  }
  throw new Error('Download pack stayed disabled — assignment may still be processing.');
}

async function playOffline(driver, origin, pids) {
  await driver.goto(`${origin}/#/`);
  await waitFor(driver, () => /Who is playing/i.test(document.body?.innerText || ''), null, 45_000, 'roster');
  const offline = await driver.setOffline(true);
  console.log(`   offline: ${JSON.stringify(offline)}`);
  if (USE_LOCAL) {
    await driver.evaluate(() => {
      location.reload();
    });
    await sleep(2500);
    await waitFor(driver, () => /Who is playing/i.test(document.body?.innerText || ''), null, 45_000, 'roster after local-down');
    const sw = await driver.evaluate(() => navigator.serviceWorker?.controller?.state || null);
    console.log(`   after local-down: sw=${sw} href=${await driver.evaluate(() => location.href)}`);
  }
  const rosterCount = await driver.evaluate(() => document.querySelectorAll('button.child').length);
  console.log(`   roster children: ${rosterCount}`);
  if (rosterCount < pids.length) throw new Error(`expected at least ${pids.length} children on roster, got ${rosterCount}`);

  const mountFailures = [];
  for (const pid of pids) {
    for (const task of TASKS) {
      console.log(`   ${pid} · ${task}`);
      const selected = await driver.evaluate((id) => {
        const el = [...document.querySelectorAll('button.child')].find((b) => (b.textContent || '').includes(id));
        if (!el) return false;
        el.click();
        return true;
      }, pid);
      if (!selected) throw new Error(`child ${pid} not on roster`);
      const taskRe = task === 'hearts-and-flowers' ? 'hearts' : task === 'intro' ? 'intro|instruction' : task;
      const started = await driver.evaluate((p) => {
        const re = new RegExp(p, 'i');
        const el = [...document.querySelectorAll('button.primary.big, button.primary, button')].find((b) =>
          re.test(b.textContent || ''),
        );
        if (!el) return false;
        el.click();
        return true;
      }, taskRe);
      if (!started) throw new Error(`task button /${taskRe}/ not found`);
      try {
        await waitFor(driver, () => !!document.querySelector('.jspsych-content-wrapper'), null, 90_000, `${task} mount`);
      } catch {
        mountFailures.push({ pid, task });
        await driver.screenshot(`fail-${pid}-${task}`);
        await driver.goto(`${origin}/#/`);
        await waitFor(driver, () => /Who is playing/i.test(document.body?.innerText || ''), null, 30_000, 'roster');
        continue;
      }
      const t0 = Date.now();
      let clicks = 0;
      let lastTrials = -1;
      let lastChange = Date.now();
      while (Date.now() - t0 < MAX_SECONDS * 1000) {
        const backOnRoster = await driver.evaluate(
          () => (location.hash === '' || location.hash === '#/') && !document.querySelector('.jspsych-content-wrapper'),
        );
        if (backOnRoster) break;
        const clickedSel = await driver.evaluate((sels) => {
          const visible = (el) => el instanceof HTMLElement && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
          for (const sel of sels) {
            const nodes = [...document.querySelectorAll(sel)].filter(visible);
            if (!nodes.length) continue;
            const el = sel.includes('correct') ? nodes[0] : nodes[Math.floor(Math.random() * nodes.length)];
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            if (typeof el.click === 'function') el.click();
            return sel;
          }
          return null;
        }, CLICK_SELECTORS);
        if (clickedSel) clicks++;
        if (task === 'hearts-and-flowers') {
          await driver.press(' ');
          await driver.press(Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight');
          clicks++;
        }
        if (clicks % 10 === 0) {
          const { trials } = await idbAll(driver);
          if (trials.length !== lastTrials) {
            lastTrials = trials.length;
            lastChange = Date.now();
          } else if (Date.now() - lastChange > 90_000) {
            break;
          }
        }
        await sleep(clickedSel || task === 'hearts-and-flowers' ? 700 : 400);
      }
      const after = await idbAll(driver).catch(() => ({ runs: [], trials: [] }));
      console.log(`     auto-play: ${clicks} clicks / ${((Date.now() - t0) / 1000).toFixed(0)}s idb=${after.runs.length}r/${after.trials.length}t`);
      const onRoster = await driver.evaluate(
        () => (location.hash === '' || location.hash === '#/') && !document.querySelector('.jspsych-content-wrapper'),
      );
      if (!onRoster) {
        await driver.evaluate(() => {
          location.hash = '#/';
        });
        await sleep(800);
        const stillTask = await driver.evaluate(() => !!document.querySelector('.jspsych-content-wrapper'));
        if (stillTask) {
          await driver.evaluate(() => {
            location.hash = '#/';
            location.reload();
          });
          await sleep(2500);
        }
      }
      try {
        await waitFor(driver, () => /Who is playing/i.test(document.body?.innerText || ''), null, 60_000, 'roster after task');
      } catch (e) {
        const body = await driver.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
        throw new Error(`${e.message} body=${body}`);
      }
    }
  }
  return mountFailures;
}

const origin = APP_ORIGIN;
if (USE_LOCAL) {
  bsLocal = await startLocal();
  console.log(`   pack via Local: ${APP_PACK_LINK}`);
}
const driver = KIND === 'android' ? await connectWebDriver() : await connectPlaywright();
let ok = false;
try {
  console.log(`1. provision from pack link on ${DEVICE_NAME}…`);
  await driver.goto(APP_PACK_LINK);
  await launcherSignIn(driver);
  await waitForDownloadEnabled(driver, APP_PACK_LINK);
  const t0p = Date.now();
  await clickText(driver, 'Download pack|Provision this device');
  await waitFor(driver, () => !!document.querySelector('.notice, .error'), null, 15 * 60_000, 'provision result');
  const provisionMsg = await driver.evaluate(() => document.querySelector('.notice, .error')?.textContent?.trim());
  console.log(`   ${provisionMsg} (${((Date.now() - t0p) / 1000).toFixed(0)}s)`);
  if (await driver.evaluate(() => !!document.querySelector('.error'))) throw new Error(provisionMsg || 'provision failed');
  await driver.screenshot('provisioned');

  console.log('2. play offline…');
  await driver.goto(`${origin}/#/`);
  await waitFor(driver, () => /Who is playing/i.test(document.body?.innerText || ''), null, 45_000, 'roster');
  const pids = await driver.evaluate(() =>
    [...document.querySelectorAll('button.child')]
      .map((el) => {
        const mono = el.querySelector('.mono')?.textContent || '';
        const pid = mono.split('·')[0].trim();
        return pid || el.querySelector('strong')?.textContent?.trim() || '';
      })
      .filter(Boolean),
  );
  const playPids = PLAY_LIMIT > 0 ? pids.slice(0, PLAY_LIMIT) : pids;
  const mountFailures = await playOffline(driver, origin, playPids);
  const { runs, trials } = await idbAll(driver);
  const localPairs = runs.filter((r) => r.completed && !r.aborted).map((r) => `${r.child?.assessmentPid}:${r.taskId}`);
  console.log(`   local completed pairs: ${localPairs.length} / ${playPids.length * TASKS.length}`);
  console.log(`   runs=${runs.length} trials=${trials.length} mountFailures=${mountFailures.length}`);

  console.log('3. sync…');
  const online = await driver.setOffline(false);
  console.log(`   online: ${JSON.stringify(online)}`);
  await driver.goto(`${origin}/#/sync`);
  await launcherSignIn(driver);
  const syncLabel = await driver.evaluate(() =>
    [...document.querySelectorAll('button')]
      .map((b) => (b.textContent || '').trim())
      .find((t) => /sync/i.test(t) && /pending|now|runs/i.test(t)),
  );
  console.log(`   sync button: ${syncLabel || '(none)'}`);
  if (syncLabel) await clickText(driver, 'Sync .*pending|Sync now|Sync runs');
  else {
    const body = await driver.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 240));
    throw new Error(`no sync button body=${body}`);
  }
  await waitFor(driver, () => !!document.querySelector('.notice, .error'), null, 180_000, 'sync result');
  const syncMsg = await driver.evaluate(() => document.querySelector('.notice, .error')?.textContent?.trim());
  console.log(`   ${syncMsg}`);
  await driver.screenshot('synced');

  ok =
    playPids.length > 0 &&
    mountFailures.length === 0 &&
    localPairs.length >= playPids.length * TASKS.length &&
    /synced/i.test(syncMsg || '');
  await driver.mark(ok ? 'passed' : 'failed', ok ? `science-fair ${KIND} ${localPairs.length} pairs` : syncMsg || 'incomplete');
  console.log(`\nscience_fair -dev BrowserStack ${KIND} (${DEVICE_NAME}): ${ok ? 'PASSED' : 'FAILED'}`);
} catch (error) {
  console.error(error);
  await driver.screenshot('failed');
  await driver.mark('failed', error.message).catch(() => {});
  ok = false;
} finally {
  await driver.close();
  await stopLocal(bsLocal);
  bsLocal = null;
}

process.exit(ok ? 0 : 1);
