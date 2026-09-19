// Hosted hs-levante-admin-dev field collection: Select Site → pack → offline play → sync.
// Auth matches Cypress -dev runs: E2E_TEST_EMAIL / E2E_TEST_PASSWORD (never Google SSO).
//
//   set -a && source /home/david/levante/levante-support/.env && set +a
//   cd shell && node test/science-fair-dev-run.mjs
//
// Flags: --wizard  --wizard-only  --headed  --max-children 1  --tasks hearts-and-flowers,intro

import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launcherPasswordSignIn, provisionFromSite } from './lib/provision.mjs';

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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

const EMAIL = args.email || process.env.E2E_TEST_EMAIL || process.env.E2E_AI_SITE_ADMIN_EMAIL;
const PASSWORD = args.password || process.env.E2E_TEST_PASSWORD || process.env.E2E_AI_SITE_ADMIN_PASSWORD;
const DASHBOARD = (
  args.dashboard ||
  process.env.SCIENCE_FAIR_DASHBOARD_URL ||
  'https://hs-levante-admin-dev--science-fair-rcdjddph.web.app'
).replace(/\/$/, '');
const LAUNCHER = (
  args.launcher ||
  process.env.SCIENCE_FAIR_LAUNCHER_URL ||
  'https://hs-levante-admin-dev--offline-launcher-34g4znyg.web.app'
).replace(/\/$/, '');
const SITE_NAME = args.site || process.env.E2E_SITE_NAME || process.env.CYPRESS_E2E_SITE_NAME || 'ai-tests';
const ASSIGNMENT = args.assignment || process.env.SCIENCE_FAIR_ASSIGNMENT || '';
const SCOPE = args.scope || process.env.SCIENCE_FAIR_SCOPE || '';
const TASKS = String(args.tasks || 'hearts-and-flowers,intro')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const CHILD_COUNT = Number(args.count || 10);
const PLAY_LIMIT = Number(args['max-children'] || 0);
const MIN_AGE = Number(args['min-age'] || 5);
const MAX_AGE = Number(args['max-age'] || 12);
const MAX_SECONDS = Number(args['max-seconds'] || 300);
const LOGIN_ONLY = args['login-only'] === 'true';
const USE_WIZARD = args.wizard === 'true' || args['wizard-only'] === 'true';
const WIZARD_ONLY = args['wizard-only'] === 'true';
const SKIP_USERS = args['skip-users'] === 'true';
const PACK_LINK = args['pack-link'] || '';
const HEADED = args.headed === 'true';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const GROUP_NAME = args.group || `Science Fair Auto ${stamp}`;
const ASSIGNMENT_NAME = args.assignment || `Science Fair Auto ${stamp}`;
const OUT = path.resolve(here, 'out/science-fair-dev');
await mkdir(OUT, { recursive: true });

if (!EMAIL || !PASSWORD) {
  throw new Error('Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD (same vars as Cypress -dev).');
}

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

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
}

async function fillPassword(page) {
  const host = page.locator('[data-cy="input-password"]');
  await host.waitFor({ state: 'visible', timeout: 30_000 });
  const inner = host.locator('input[type="password"]');
  const target = (await inner.count()) ? inner.first() : host;
  await target.click();
  await target.fill(PASSWORD);
}

async function dashboardPasswordLogin(page) {
  await page.goto(`${DASHBOARD}/science-fair`, { waitUntil: 'domcontentloaded' });
  const emailBox = page.locator('[data-cy="input-username-email"]');
  try {
    await emailBox.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    if (page.url().includes('/science-fair') && !page.url().includes('/signin')) return;
    throw new Error(`Sign-in form not found at ${page.url()}`);
  }
  await emailBox.click();
  await emailBox.fill(EMAIL);
  await fillPassword(page);
  await page.locator('[data-cy="submit-sign-in-with-password"]').click();
  await page.waitForURL((url) => !String(url).includes('/signin'), { timeout: 60_000 });
  if (!page.url().includes('/science-fair')) {
    await page.goto(`${DASHBOARD}/science-fair`, { waitUntil: 'domcontentloaded' });
  }
  await page.getByRole('heading', { name: /Field collection|Science fair/i }).waitFor({ timeout: 60_000 });
  await dismissWelcomeTour(page);
}

async function dismissWelcomeTour(page) {
  const close = page.locator('.driver-popover-close-btn, .driver-popover-close-icon, button.driver-popover-close-btn');
  if (await close.count()) {
    await close.first().click().catch(() => {});
    return;
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function pickSite(page) {
  const select = page.locator('.site-select').first();
  await select.waitFor({ state: 'visible', timeout: 30_000 });
  const current = (await select.innerText()).trim();
  if (current.toLowerCase().includes(SITE_NAME.toLowerCase())) return;
  await select.click();
  const option = page.getByRole('option', { name: new RegExp(SITE_NAME, 'i') }).first();
  await option.waitFor({ state: 'visible', timeout: 15_000 });
  await option.click();
}

async function createCohortAndChildren(page) {
  const createMode = page.locator('input[type=radio][value=create]');
  if (await createMode.count()) await createMode.check({ force: true });
  await page.getByPlaceholder(/Field collection cohort|Bay Area Science Fair/i).first().fill(GROUP_NAME);
  await page.locator('input[type="number"]').nth(0).fill(String(CHILD_COUNT));
  await page.locator('input[type="number"]').nth(1).fill(String(MIN_AGE));
  await page.locator('input[type="number"]').nth(2).fill(String(MAX_AGE));
  await page.getByRole('button', { name: 'Create group and children' }).click();
  await page.locator('.created').waitFor({ timeout: 180_000 });
  const ids = await page.locator('.created tbody td.mono').evaluateAll((els) =>
    els.map((el) => el.textContent?.trim() || '').filter((t, i) => i % 2 === 0 && t),
  );
  return ids;
}

async function pickAssignmentGroup(page, tabLabel, name) {
  await page.locator('.group-picker-component [role="tab"]').filter({ hasText: new RegExp(`^${tabLabel}$`, 'i') }).click();
  const search = page.getByPlaceholder(new RegExp(`Search for ${tabLabel}`, 'i'));
  await search.waitFor({ timeout: 15_000 });
  await search.fill('');
  await search.fill(name);
  const opt = page.locator('.group-picker-component .p-listbox-option:visible').filter({ hasText: name }).first();
  await opt.waitFor({ state: 'visible', timeout: 30_000 });
  await opt.click();
  const continueBtn = page.getByRole('button', { name: /^Continue$/ });
  if (await continueBtn.isVisible().catch(() => false)) await continueBtn.click();
  await page.locator('.selected-groups-scroll-panel').getByText(name).waitFor({ timeout: 20_000 });
}

async function pickToday(page, selector) {
  const host = page.locator(selector).first();
  await host.click();
  const todayBtn = page.getByRole('button', { name: /^Today$/ });
  if (await todayBtn.count()) {
    await todayBtn.first().click();
    return;
  }
  const today = String(new Date().getDate());
  await page.locator('.p-datepicker-calendar').getByText(today, { exact: true }).first().click();
}

async function ensureDateFilled(page, selector) {
  const mm = String(new Date().getMonth() + 1).padStart(2, '0');
  const dd = String(new Date().getDate()).padStart(2, '0');
  const yyyy = String(new Date().getFullYear());
  const value = `${mm}/${dd}/${yyyy}`;
  await page.locator(selector).first().evaluate((el, next) => {
    const input = el.matches('input') ? el : el.querySelector('input');
    if (!input) return;
    if (String(input.value || '').trim()) return;
    input.removeAttribute('readonly');
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }, value);
}

async function waitForTaskSearch(page) {
  const searching = page.getByText('Searching...');
  if (await searching.isVisible().catch(() => false)) {
    await searching.waitFor({ state: 'hidden', timeout: 60_000 });
  }
}

async function selectTaskVariant(page, taskId) {
  const search = page.locator('[data-cy="input-variant-name"]');
  await search.waitFor({ state: 'visible', timeout: 60_000 });
  const queries = {
    'hearts-and-flowers': ['hearts-and-flowers', 'Hearts'],
    intro: ['intro', 'Instructions'],
    'egma-math': ['egma-math', 'EGMA', 'Math'],
    'matrix-reasoning': ['matrix-reasoning', 'Matrix'],
    'memory-game': ['memory-game', 'Memory'],
  };
  const tries = queries[taskId] || [taskId];
  for (const query of tries) {
    await search.fill('');
    await search.fill(query);
    await waitForTaskSearch(page);
    const card = page.locator(`[data-task-id="${taskId}"] [data-cy="selected-variant"]`).first();
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      await page.locator('[data-cy="panel-droppable-zone"]').getByText('Variant name:').first().waitFor({ timeout: 15_000 });
      return;
    }
    const any = page.locator('[data-cy="selected-variant"]').first();
    if (await any.isVisible().catch(() => false)) {
      await any.click();
      await page.locator('[data-cy="panel-droppable-zone"]').getByText('Variant name:').first().waitFor({ timeout: 15_000 });
      return;
    }
  }
  throw new Error(`No variant for ${taskId}`);
}

async function createAssignment(page) {
  await page.getByRole('button', { name: 'Create new assignment' }).click();
  await page.locator('[data-cy="input-administration-name"]').waitFor({ timeout: 60_000 });
  await page.locator('[data-cy="input-administration-name"]').fill(ASSIGNMENT_NAME);
  await pickToday(page, '[data-cy="input-start-date"]');
  await page.keyboard.press('Escape');
  await pickToday(page, '[data-cy="input-end-date"]');
  await page.keyboard.press('Escape');
  await ensureDateFilled(page, '[data-cy="input-start-date"]');
  await ensureDateFilled(page, '[data-cy="input-end-date"]');

  await pickAssignmentGroup(page, 'Sites', SITE_NAME);

  const language = page.locator('.languages-dropdown');
  await language.waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.p-dialog-mask').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  await language.click();
  const english = page.locator('.p-select-overlay:visible [role="option"]').filter({ hasText: /English/i }).first();
  await english.waitFor({ state: 'visible', timeout: 15_000 });
  await english.click();
  await page
    .locator('.task-picker-component')
    .getByText(/Executive Function|Introduction|No tasks available|Select language/i)
    .first()
    .waitFor({ timeout: 60_000 });
  for (const task of TASKS) await selectTaskVariant(page, task);
  await page.locator('input[id="No"]').check({ force: true });

  const upsert = page.waitForResponse((res) => /upsertAdministration/i.test(res.url()) && res.request().method() === 'POST', {
    timeout: 120_000,
  });
  await page.locator('[data-cy="button-create-administration"]').click();
  const response = await upsert;
  if (response.status() >= 400) {
    throw new Error(`upsertAdministration HTTP ${response.status()}`);
  }
  await page.waitForURL(/science-fair/, { timeout: 120_000 });
}

async function readPackLink(page) {
  const link = page.locator('.pack-link');
  await link.waitFor({ state: 'visible', timeout: 30_000 });
  return (await link.innerText()).trim();
}

const idbAll = (page) =>
  page.evaluate(async () => {
    const store = await window.__levanteStore;
    return { runs: await store.listRuns(), trials: await store.allTrials(), packs: await store.listPacks() };
  });

async function playOffline(page, origin, pids) {
  await page.context().setOffline(true);
  await page.goto(`${origin}/#/`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
  const rosterCount = await page.locator('button.child').count();
  console.log(`   roster children: ${rosterCount}`);
  if (rosterCount < pids.length) throw new Error(`expected at least ${pids.length} children on roster, got ${rosterCount}`);

  const mountFailures = [];
  for (const pid of pids) {
    for (const task of TASKS) {
      console.log(`   ${pid} · ${task}`);
      await page.click(`button.child:has-text("${pid}")`);
      const taskBtn = page.locator('button.primary.big').filter({
        hasText: task === 'hearts-and-flowers' ? /hearts/i : task === 'intro' ? /intro|instruction/i : new RegExp(task, 'i'),
      });
      await (await taskBtn.count() ? taskBtn.first() : page.locator(`button.primary.big:has-text("${task}")`)).click();
      try {
        await page.waitForSelector('.jspsych-content-wrapper', { timeout: 60_000 });
      } catch {
        mountFailures.push({ pid, task });
        await shot(page, `fail-${pid}-${task}`);
        await page.goto(`${origin}/#/`, { waitUntil: 'load' });
        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
        continue;
      }
      const t0 = Date.now();
      let clicks = 0;
      let lastTrials = -1;
      let lastChange = Date.now();
      while (Date.now() - t0 < MAX_SECONDS * 1000) {
        const backOnRoster = await page.evaluate(
          () => (location.hash === '' || location.hash === '#/') && !document.querySelector('.jspsych-content-wrapper'),
        );
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
        if (task === 'hearts-and-flowers') {
          await page.keyboard.press(' ');
          await page.keyboard.press(Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight');
          clicked = true;
          clicks++;
        }
        if (clicks % 10 === 0) {
          const { trials } = await idbAll(page);
          if (trials.length !== lastTrials) {
            lastTrials = trials.length;
            lastChange = Date.now();
          } else if (Date.now() - lastChange > 90_000) {
            break;
          }
        }
        await page.waitForTimeout(clicked ? 700 : 400);
      }
      console.log(`     auto-play: ${clicks} clicks / ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      if (!(await page.evaluate(() => location.hash === '' || location.hash === '#/'))) {
        await page.goto(`${origin}/#/`, { waitUntil: 'load' });
        await page.reload({ waitUntil: 'load' });
      }
      await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
    }
  }
  return mountFailures;
}

async function launcherSignIn(page) {
  await launcherPasswordSignIn(page, EMAIL, PASSWORD);
}

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'allow',
  ignoreHTTPSErrors: true,
});
await context.addInitScript(() => {
  window.Cypress = true;
});
const page = await context.newPage();
page.on('pageerror', (err) => console.log('  [pageerror]', err.message.slice(0, 200)));
page.on('console', (msg) => msg.type() === 'error' && console.log('  [console.error]', msg.text().slice(0, 160)));

let ok = false;
try {
  if (PACK_LINK) {
    const origin = new URL(PACK_LINK).origin;
    console.log('1. select site + provision from pack link…');
    const provisioned = await provisionFromSite(page, {
      appUrl: origin,
      email: EMAIL,
      password: PASSWORD,
      site: SITE_NAME,
      assignment: ASSIGNMENT,
      scope: SCOPE,
      packLink: PACK_LINK,
    });
    console.log(`   ${provisioned.message} (${provisioned.seconds.toFixed(0)}s)`);
    console.log('2. play offline…');
    await page.goto(`${origin}/#/`, { waitUntil: 'load' });
    await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
    const pids = await page.locator('button.child').evaluateAll((els) =>
      els
        .map((el) => {
          const mono = el.querySelector('.mono')?.textContent || '';
          const pid = mono.split('·')[0].trim();
          return pid || el.querySelector('strong')?.textContent?.trim() || '';
        })
        .filter(Boolean),
    );
    const playPids = PLAY_LIMIT > 0 ? pids.slice(0, PLAY_LIMIT) : pids;
    const mountFailures = await playOffline(page, origin, playPids);
    const { runs, trials } = await idbAll(page);
    const localPairs = runs.filter((r) => r.completed && !r.aborted).map((r) => `${r.child.assessmentPid}:${r.taskId}`);
    console.log(`   local completed pairs: ${localPairs.length} / ${playPids.length * TASKS.length}`);
    console.log(`   runs=${runs.length} trials=${trials.length} mountFailures=${mountFailures.length}`);
    console.log('3. sync…');
    await page.context().setOffline(false);
    await page.goto(`${origin}/#/sync`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await launcherSignIn(page);
    if (await page.locator('button.primary:has-text("Sync")').count()) {
      await page.click('button.primary:has-text("Sync")');
    }
    await page.waitForSelector('.notice, .error', { timeout: 180_000 });
    const syncMsg = await page.evaluate(() => document.querySelector('.notice, .error')?.textContent?.trim());
    console.log(`   ${syncMsg}`);
    await shot(page, 'synced');
    ok =
      playPids.length > 0 &&
      mountFailures.length === 0 &&
      localPairs.length >= playPids.length * TASKS.length &&
      /synced/i.test(syncMsg || '');
    console.log(`\nscience_fair -dev: ${ok ? 'PASSED' : 'FAILED'}`);
    await browser.close();
    process.exit(ok ? 0 : 1);
  }

  if (!USE_WIZARD) {
    console.log(`1. select site + provision at ${LAUNCHER} (site ${SITE_NAME})…`);
    const provisioned = await provisionFromSite(page, {
      appUrl: LAUNCHER,
      email: EMAIL,
      password: PASSWORD,
      site: SITE_NAME,
      assignment: ASSIGNMENT,
      scope: SCOPE,
    });
    console.log(`   ${provisioned.message} (${provisioned.seconds.toFixed(0)}s)`);
    await shot(page, 'provisioned');

    console.log('2. play offline…');
    await page.goto(`${LAUNCHER}/#/`, { waitUntil: 'load' });
    await page.waitForSelector('text=Who is playing?', { timeout: 30_000 });
    const pids = await page.locator('button.child').evaluateAll((els) =>
      els
        .map((el) => {
          const mono = el.querySelector('.mono')?.textContent || '';
          const pid = mono.split('·')[0].trim();
          return pid || el.querySelector('strong')?.textContent?.trim() || '';
        })
        .filter(Boolean),
    );
    const playPids = PLAY_LIMIT > 0 ? pids.slice(0, PLAY_LIMIT) : pids;
    if (!playPids.length) throw new Error('roster is empty after provision');
    const mountFailures = await playOffline(page, LAUNCHER, playPids);
    const { runs, trials } = await idbAll(page);
    const localPairs = runs.filter((r) => r.completed && !r.aborted).map((r) => `${r.child.assessmentPid}:${r.taskId}`);
    console.log(`   local completed pairs: ${localPairs.length} / ${playPids.length * TASKS.length}`);
    console.log(`   runs=${runs.length} trials=${trials.length} mountFailures=${mountFailures.length}`);

    console.log('3. sync…');
    await page.context().setOffline(false);
    await page.goto(`${LAUNCHER}/#/sync`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await launcherSignIn(page);
    if (await page.locator('button.primary:has-text("Sync")').count()) {
      await page.click('button.primary:has-text("Sync")');
    }
    await page.waitForSelector('.notice, .error', { timeout: 180_000 });
    const syncMsg = await page.evaluate(() => document.querySelector('.notice, .error')?.textContent?.trim());
    console.log(`   ${syncMsg}`);
    await shot(page, 'synced');
    ok =
      playPids.length > 0 &&
      mountFailures.length === 0 &&
      localPairs.length >= playPids.length * TASKS.length &&
      /synced/i.test(syncMsg || '');
    console.log(`\nscience_fair -dev: ${ok ? 'PASSED' : 'FAILED'}`);
    await browser.close();
    process.exit(ok ? 0 : 1);
  }

  console.log(`1. dashboard password login at ${DASHBOARD} (E2E_TEST_EMAIL, no Google)…`);
  await dashboardPasswordLogin(page);
  await shot(page, 'signed-in');
  console.log('   signed in');
  if (LOGIN_ONLY) {
    console.log('\nscience_fair -dev login: PASSED');
    ok = true;
    process.exitCode = 0;
    await browser.close();
    process.exit(0);
  }

  console.log(`2. pick site ${SITE_NAME}…`);
  await pickSite(page);
  await shot(page, 'site');

  let childIds = [];
  if (SKIP_USERS) {
    console.log(`3. reuse cohort "${GROUP_NAME}"…`);
    await page.locator('input[type=radio][value=existing]').check({ force: true });
    await page.locator('input[type=radio][value=cohort]').check({ force: true });
    const cohortSelect = page.locator('.site-select').nth(1);
    await cohortSelect.click();
    await page.getByRole('option', { name: new RegExp(GROUP_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click();
    await page.getByRole('button', { name: 'Use this cohort' }).click();
    childIds = Array.from({ length: CHILD_COUNT }, (_, i) => `reuse-${i}`);
  } else {
    console.log(`3. create cohort "${GROUP_NAME}" with ${CHILD_COUNT} children…`);
    childIds = await createCohortAndChildren(page);
    await shot(page, 'children');
    if (!childIds.length) {
      childIds = await page.locator('.created tbody tr td.mono').evaluateAll((els) =>
        els.filter((_, i) => i % 2 === 0).map((el) => el.textContent?.trim() || '').filter(Boolean),
      );
    }
    console.log(`   created ${childIds.length} children`);
  }

  console.log(`4. create assignment "${ASSIGNMENT_NAME}" (${TASKS.join(', ')})…`);
  await createAssignment(page);
  await shot(page, 'assignment');

  const packLink = await readPackLink(page);
  console.log(`   pack link: ${packLink}`);
  if (WIZARD_ONLY) {
    console.log('\nscience_fair -dev wizard: PASSED');
    ok = Boolean(packLink) && (SKIP_USERS || childIds.length >= CHILD_COUNT);
    process.exitCode = ok ? 0 : 1;
    await browser.close();
    process.exit(process.exitCode);
  }

  const origin = new URL(packLink).origin;
  console.log('5. select site + provision from pack link…');
  const provisioned = await provisionFromSite(page, {
    appUrl: origin,
    email: EMAIL,
    password: PASSWORD,
    site: SITE_NAME,
    assignment: ASSIGNMENT_NAME,
    scope: GROUP_NAME,
    packLink,
  });
  console.log(`   ${provisioned.message} (${provisioned.seconds.toFixed(0)}s)`);

  console.log('6. play offline…');
  const mountFailures = await playOffline(page, origin, childIds);
  const { runs, trials } = await idbAll(page);
  const localPairs = runs.filter((r) => r.completed && !r.aborted).map((r) => `${r.child.assessmentPid}:${r.taskId}`);
  console.log(`   local completed pairs: ${localPairs.length} / ${childIds.length * TASKS.length}`);
  console.log(`   runs=${runs.length} trials=${trials.length} mountFailures=${mountFailures.length}`);

  console.log('7. sync…');
  await page.context().setOffline(false);
  await page.goto(`${origin}/#/sync`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await launcherSignIn(page);
  if (await page.locator('button.primary:has-text("Sync")').count()) {
    await page.click('button.primary:has-text("Sync")');
  }
  await page.waitForSelector('.notice, .error', { timeout: 180_000 });
  const syncMsg = await page.evaluate(() => document.querySelector('.notice, .error')?.textContent?.trim());
  console.log(`   ${syncMsg}`);
  await shot(page, 'synced');

  ok =
    childIds.length >= CHILD_COUNT &&
    mountFailures.length === 0 &&
    localPairs.length >= childIds.length * TASKS.length &&
    /synced/i.test(syncMsg || '');
  console.log(`\nscience_fair -dev: ${ok ? 'PASSED' : 'FAILED'}`);
} catch (error) {
  await shot(page, 'failed');
  console.error(error);
  ok = false;
} finally {
  await browser.close();
}

process.exit(ok ? 0 : 1);
