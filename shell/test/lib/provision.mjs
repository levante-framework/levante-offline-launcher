/** Shared Playwright steps for Select Site → pick pack → Download pack. */

export async function unlockIfNeeded(page, pin = '2468') {
  if (await page.$('input[name=pin]')) {
    await page.fill('input[name=pin]', pin);
    if (await page.$('input[name=pinConfirm]')) {
      await page.fill('input[name=pinConfirm]', pin);
      await page.click('button:has-text("Set PIN")');
      await page.waitForSelector('text=Device PIN set', { timeout: 30_000 });
    } else {
      await page.click('button:has-text("Unlock")');
    }
  }
}

export async function launcherPasswordSignIn(page, email, password) {
  const emailBox = page.locator('input[type=email]');
  if (!(await emailBox.count())) return;
  await emailBox.fill(email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Signed in as', { timeout: 60_000 });
}

export async function pickListedCard(page, text) {
  const cards = page.locator('button.child');
  await cards.first().waitFor({ timeout: 120_000 });
  const n = await cards.count();
  const labels = [];
  for (let i = 0; i < n; i++) {
    const label = (await cards.nth(i).innerText()).replace(/\s+/g, ' ').trim();
    labels.push(label);
    if (text && new RegExp(escapeRe(text), 'i').test(label)) {
      await cards.nth(i).click();
      return label;
    }
  }
  if (!text || n === 1) {
    await cards.first().click();
    return labels[0];
  }
  throw new Error(`no card matching ${JSON.stringify(text)}. saw: ${labels.join(' | ')}`);
}

export async function pickPack(page, assignment, scope) {
  const cards = page.locator('button.child');
  await cards.first().waitFor({ timeout: 120_000 });
  const n = await cards.count();
  const labels = [];
  for (let i = 0; i < n; i++) {
    const label = (await cards.nth(i).innerText()).replace(/\s+/g, ' ').trim();
    labels.push(label);
    const okAssign = !assignment || new RegExp(escapeRe(assignment), 'i').test(label);
    const okScope = !scope || new RegExp(escapeRe(scope), 'i').test(label);
    if (okAssign && okScope) {
      await cards.nth(i).click();
      return label;
    }
  }
  if (assignment || scope) {
    throw new Error(
      `no pack matching assignment=${JSON.stringify(assignment)} scope=${JSON.stringify(scope)}. saw: ${labels.join(' | ')}`,
    );
  }
  await cards.first().click();
  return labels[0];
}

/**
 * Sign in on #/site, pick the site, continue, pick an assignment×group pack, download it.
 * A pack-link hash is saved and used to preselect when present.
 */
export async function provisionFromSite(page, opts) {
  const {
    appUrl,
    email,
    password,
    site,
    assignment,
    scope,
    packLink,
    pin = '2468',
  } = opts;
  const origin = String(appUrl || packLink).replace(/\/$/, '').split('#')[0];
  await page.goto(packLink || `${origin}/#/site`, { waitUntil: 'load' });
  if (await page.evaluate(() => 'serviceWorker' in navigator)) {
    await page
      .waitForFunction(() => navigator.serviceWorker?.getRegistration().then((r) => !!r?.active), null, {
        timeout: 60_000,
      })
      .catch(() => {});
  }
  await unlockIfNeeded(page, pin);
  await launcherPasswordSignIn(page, email, password);

  if (await page.locator('text=Which site?').count()) {
    const siteLabel = await pickListedCard(page, site);
    const continueBtn = page.getByRole('button', { name: /Continue to provision/i });
    await continueBtn.waitFor({ timeout: 15_000 });
    await continueBtn.click();
    console.log(`   site: ${siteLabel}`);
  }

  await page.waitForSelector('text=Packs for this site', { timeout: 60_000 });
  const download = page.getByRole('button', { name: /Download pack/i });
  const alreadySelected = await download.isEnabled().catch(() => false);
  const packLabel = alreadySelected && !assignment && !scope ? '(preselected)' : await pickPack(page, assignment, scope);
  console.log(`   pack: ${packLabel}`);

  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    if (await download.isEnabled().catch(() => false)) break;
    const err = (await page.locator('.error').textContent().catch(() => '')) || '';
    console.log(`   waiting for pack download… ${err.slice(0, 80)}`);
    await page.waitForTimeout(8_000);
  }
  if (!(await download.isEnabled().catch(() => false))) {
    throw new Error('Download pack stayed disabled.');
  }

  const t0 = Date.now();
  await download.click();
  await page.waitForSelector('.notice, .error', { timeout: 15 * 60_000 });
  const message = await page.evaluate(() => document.querySelector('.notice, .error')?.textContent?.trim());
  if (await page.locator('.error').count() && !/Provisioned/i.test(message || '')) {
    throw new Error(message || 'provision failed');
  }
  return { packLabel, message, seconds: (Date.now() - t0) / 1000 };
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
