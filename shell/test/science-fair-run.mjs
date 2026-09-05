// science_fair: provision 10 test children × 2 tasks, play them offline, sync, assert Firestore.
//
//   cd emulator && npm run seed:science-fair
//   cd shell && node test/science-fair-run.mjs [--url https://127.0.0.1:4173]

import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);

const APP_URL = args.url || 'https://127.0.0.1:4173';
const TASKS = String(args.tasks || 'hearts-and-flowers,intro').split(',');
const PIDS = String(args.children || 'TEST-01,TEST-02,TEST-03,TEST-04,TEST-05,TEST-06,TEST-07,TEST-08,TEST-09,TEST-10').split(',');
const ADMINISTRATION = args.administration || 'Science fair';
const SCOPE = args.scope || 'Science Fair';
const MAX_SECONDS = Number(args['max-seconds'] || 180);
const [PROCTOR_EMAIL, PROCTOR_PASSWORD] = String(args.proctor || 'fair@levante.test:fair123456').split(':');
const PIN = args.pin || '2468';
const OUT = path.resolve('test/out/science-fair');
await mkdir(OUT, { recursive: true });

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

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'],
});
const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'allow', ignoreHTTPSErrors: true });
await context.addInitScript(() => {
  window.Cypress = true;
});
const page = await context.newPage();
page.on('pageerror', (err) => console.log('  [pageerror]', err.message.slice(0, 200)));
page.on('console', (msg) => msg.type() === 'error' && console.log('  [console.error]', msg.text().slice(0, 160)));

const failed = [];
let offline = false;
page.on('requestfailed', (req) => offline && failed.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`));

const idbAll = () =>
  page.evaluate(async () => {
    const store = await window.__levanteStore;
    return { runs: await store.listRuns(), trials: await store.allTrials(), packs: await store.listPacks() };
  });

console.log(`engine: chromium ${browser.version()}`);
console.log(`1. provisioning ${PIDS.length} children × ${TASKS.join(', ')} at ${APP_URL} as ${PROCTOR_EMAIL}…`);
await page.goto(`${APP_URL}/#/provision`, { waitUntil: 'load' });
if (await page.evaluate(() => 'serviceWorker' in navigator)) {
  await page.waitForFunction(() => navigator.serviceWorker?.getRegistration().then((r) => !!r?.active), null, { timeout: 60_000 });
}
if (await page.$('input[name=pin]')) {
  await page.fill('input[name=pin]', PIN);
  await page.fill('input[name=pinConfirm]', PIN);
  await page.click('button:has-text("Set PIN")');
  await page.waitForSelector('text=Device PIN set', { timeout: 30_000 });
  console.log('   device vault created');
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
}
const t0p = Date.now();
await page.click('button:has-text("Provision this device")');
await page.waitForSelector('.notice:has-text("Provisioned")', { timeout: 15 * 60_000 });
console.log(`   ${await page.evaluate(() => document.querySelector('.notice')?.textContent?.trim())} (${((Date.now() - t0p) / 1000).toFixed(0)}s)`);

console.log('2. going offline and reloading…');
await context.setOffline(true);
offline = true;
await page.goto(`${APP_URL}/#/`, { waitUntil: 'load' });
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
const rosterCount = await page.locator('button.child').count();
console.log(`   roster children: ${rosterCount}`);
if (rosterCount < PIDS.length) throw new Error(`expected at least ${PIDS.length} children on roster, got ${rosterCount}`);

const mountFailures = [];
for (const pid of PIDS) {
  for (const task of TASKS) {
    console.log(`3. ${pid} · ${task}`);
    await page.click(`button.child:has-text("${pid}")`);
    await page.click(`button.primary.big:has-text("${task}")`);
    try {
      await page.waitForSelector('.jspsych-content-wrapper', { timeout: 60_000 });
    } catch {
      mountFailures.push({ pid, task });
      console.log('   FAILED TO MOUNT');
      await page.screenshot({ path: path.join(OUT, `fail-${pid}-${task}.png`) });
      await page.goto(`${APP_URL}/#/`, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
      continue;
    }
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
        const { trials } = await idbAll();
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
    console.log(`   auto-play: ${clicks} clicks / ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (!(await page.evaluate(() => location.hash === '' || location.hash === '#/'))) {
      await page.goto(`${APP_URL}/#/`, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
    }
    await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
  }
}

const { runs, trials } = await idbAll();
const localPairs = runs.filter((r) => r.completed && !r.aborted).map((r) => `${r.child.assessmentPid}:${r.taskId}`);
console.log(`4. local completed pairs: ${localPairs.length} / ${PIDS.length * TASKS.length}`);
console.log(`   runs=${runs.length} trials=${trials.length} mountFailures=${mountFailures.length}`);

await page.goto(`${APP_URL}/#/`, { waitUntil: 'load' });
await page.waitForSelector('.child .progress', { timeout: 30_000 });
const rosterProgress = await page.$$eval('.child', (els) =>
  els.map((el) => `${el.querySelector('.mono')?.textContent?.trim()}: ${el.querySelector('.progress')?.textContent?.trim()}`),
);
console.log(`   roster while offline: ${rosterProgress.join(' | ')}`);
const incompleteRoster = rosterProgress.filter((line) => PIDS.some((pid) => line.includes(pid)) && !line.includes(`${TASKS.length}/${TASKS.length}`));
if (incompleteRoster.length) console.log(`   roster not done: ${incompleteRoster.join(' | ')}`);

console.log('5. back online; syncing…');
await context.setOffline(false);
offline = false;
await page.goto(`${APP_URL}/#/sync`, { waitUntil: 'load' });
await page.reload({ waitUntil: 'load' });
if (await page.$('input[type=email]')) {
  await page.fill('input[type=email]', PROCTOR_EMAIL);
  await page.fill('input[type=password]', PROCTOR_PASSWORD);
  await page.click('button[type=submit]');
} else {
  await page.click('button.primary:has-text("Sync")');
}
await page.waitForSelector('.notice, .error', { timeout: 180_000 });
const syncMsg = await page.evaluate(() => document.querySelector('.notice, .error')?.textContent?.trim());
console.log(`   ${syncMsg}`);
await page.screenshot({ path: path.join(OUT, 'synced.png') });
await browser.close();

const inspect = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../emulator/inspect-science-fair.mjs');
const result = spawnSync(process.execPath, [inspect], {
  stdio: 'inherit',
  env: { ...process.env, SCIENCE_FAIR_PIDS: PIDS.join(',') },
});
const ok =
  failed.length === 0 &&
  mountFailures.length === 0 &&
  localPairs.length >= PIDS.length * TASKS.length &&
  result.status === 0;
console.log(`\nscience_fair: ${ok ? 'PASSED' : 'FAILED'} (offline request failures ${failed.length})`);
process.exit(ok ? 0 : 1);
