#!/usr/bin/env node
// Builds a static offline asset pack for the LEVANTE launcher from the public GCS bucket.
//
// The pack mirrors the bucket layout core-tasks expects when `assetBaseUrl` is set
// (see task-launcher/src/tasks/shared/helpers/assetBase.ts on the levante-in-a-box branch):
//   <out>/visual/<task>/...            stimuli
//   <out>/audio/<locale>/...           only the audio files the chosen tasks use
//   <out>/audio/shared/...             language-independent SFX
//   <out>/manifests/<folder>.json      replaces the live GCS listing call
//   <out>/corpus/<task>/<corpus>.csv   item banks (with IRT params for CAT)
//   <out>/translations/itembank/...    task + general strings
//   <out>/audio/assets-per-task.json
//   <out>/pack.json                    provenance: every file with size/md5/generation
//   <out>/site-config.json             tasks + variant params the shell will run
//
// Usage:
//   node build-pack.mjs --tasks hearts-and-flowers,egma-math --locale en-US --out ../shell/public/pack
// Options: --env prod|dev  --pack-id <id>  --corpus:<task>=<name>  --concurrency 8

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GCS = 'https://storage.googleapis.com';

const DEFAULT_CORPUS = {
  'egma-math': 'math-item-bank',
  'matrix-reasoning': 'matrix-reasoning-item-bank',
  'mental-rotation': 'mental-rotation-item-bank',
  'same-different-selection': 'same-different-selection-item-bank',
  trog: 'trog-item-bank',
  'theory-of-mind': 'theory-of-mind-item-bank',
  vocab: 'vocab-item-bank',
  'adult-reasoning': 'adult-reasoning-item-bank',
  'hostile-attribution': 'hostile-attribution-item-bank',
  'child-survey': 'child-survey-item-bank',
};
const NO_CORPUS = new Set(['hearts-and-flowers', 'memory-game', 'intro']);

const args = parseArgs(process.argv.slice(2));
const tasks = String(args.tasks || 'hearts-and-flowers')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const locale = args.locale || 'en-US';
const env = args.env || 'prod';
const bucket = `levante-assets-${env}`;
const out = path.resolve(args.out || './pack');
const packId = args['pack-id'] || `${locale}-${tasks.join('+')}-${new Date().toISOString().slice(0, 10)}`;
const concurrency = Number(args.concurrency || 8);

const files = []; // { name, size, md5Hash, generation, contentType }
let bytesDownloaded = 0;
let skipped = 0;

async function main() {
  console.log(`Building pack "${packId}" from gs://${bucket} → ${out}`);
  console.log(`tasks: ${tasks.join(', ')}  locale: ${locale}`);

  // 1. assets-per-task.json tells us which audio files each task needs.
  const apt = await fetchJson(`${GCS}/${bucket}/audio/assets-per-task.json`);
  await writeJson('audio/assets-per-task.json', apt);
  for (const t of tasks) {
    if (!apt[t]) throw new Error(`Task "${t}" is not in assets-per-task.json (known: ${Object.keys(apt).join(', ')})`);
  }
  const audioNames = new Set([...tasks.flatMap((t) => apt[t].audio), ...(apt.shared?.audio ?? [])]);

  // 2. Locale audio, filtered to what the chosen tasks use.
  const localeItems = (await listPrefix(`audio/${locale}/`)).filter((it) =>
    audioNames.has(baseName(it.name)),
  );
  const missing = [...audioNames].filter((n) => !localeItems.some((it) => baseName(it.name) === n));
  if (missing.length) console.warn(`  warning: ${missing.length} audio names not found in audio/${locale}/: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`);
  await mirror(`audio/${locale}`, localeItems);

  // 3. Shared SFX.
  await mirror('audio/shared', await listPrefix('audio/shared/'));

  // 4. Per-task visuals + shared visuals.
  for (const t of tasks) await mirror(`visual/${t}`, await listPrefix(`visual/${t}/`));
  await mirror('visual/shared', await listPrefix('visual/shared/'));

  // 5. Corpora (item banks).
  const corpora = {};
  for (const t of tasks) {
    if (NO_CORPUS.has(t)) continue;
    const corpus = args[`corpus:${t}`] || DEFAULT_CORPUS[t];
    if (!corpus) throw new Error(`No default corpus known for ${t}; pass --corpus:${t}=<name>`);
    const rel = `corpus/${t}/${corpus}.csv`;
    await downloadObject(rel);
    corpora[t] = { corpus, sha256: await sha256File(rel) };
  }

  // 6. Translations.
  const translations = {};
  const tasksForStrings = [...new Set(tasks.map((t) => (t === 'adult-reasoning' ? 'egma-math' : t)))];
  for (const t of [...tasksForStrings, 'general']) {
    const rel = `translations/itembank/${t}/${locale}/item-bank-translations.json`;
    await downloadObject(rel);
    translations[t] = { sha256: await sha256File(rel) };
  }

  // 7. Provenance manifest + shell config.
  const totalBytes = files.reduce((a, f) => a + Number(f.size || 0), 0);
  const pack = {
    packId,
    builtAt: new Date().toISOString(),
    bucket,
    locale,
    tasks,
    corpora,
    translations,
    fileCount: files.length,
    totalBytes,
    files: files.sort((a, b) => a.name.localeCompare(b.name)),
  };
  await writeJson('pack.json', pack);

  const siteConfigPath = path.join(out, 'site-config.json');
  if (!(await exists(siteConfigPath)) || args.force) {
    await writeJson('site-config.json', {
      packId,
      language: locale,
      assetBaseUrl: '/pack',
      administrationId: null,
      tasks: tasks.map((t) => ({
        taskId: t,
        label: t,
        variantId: null,
        variantParams: defaultVariantParams(t, locale, corpora[t]?.corpus),
      })),
    });
  } else {
    console.log('  site-config.json exists; left untouched (use --force to overwrite)');
  }

  const rosterPath = path.join(out, 'roster.json');
  if (!(await exists(rosterPath))) {
    await writeJson('roster.json', {
      packId,
      note: 'Demo roster. Real provisioning replaces this with children pulled from an administration.',
      children: [
        { localId: 'demo-child-1', uid: null, displayName: 'Demo child A (7y)', assessmentPid: 'DEMO-A', birthMonth: 3, birthYear: 2019 },
        { localId: 'demo-child-2', uid: null, displayName: 'Demo child B (9y)', assessmentPid: 'DEMO-B', birthMonth: 9, birthYear: 2017 },
        { localId: 'demo-child-3', uid: null, displayName: 'Demo child C (11y)', assessmentPid: 'DEMO-C', birthMonth: 1, birthYear: 2015 },
      ],
    });
  }

  console.log(
    `done: ${files.length} files, ${(totalBytes / 1e6).toFixed(1)} MB in pack (${(bytesDownloaded / 1e6).toFixed(1)} MB downloaded, ${skipped} already present)`,
  );
}

function defaultVariantParams(task, language, corpus) {
  const base = { taskName: task, language, skipInstructions: false, storeItemId: true };
  if (corpus) base.corpus = corpus;
  const cat = { cat: true, semThreshold: 0.3, startingTheta: 0, maxIncorrect: 3 };
  switch (task) {
    case 'egma-math':
      return { ...base, ...cat, numberOfTrials: 40 };
    case 'matrix-reasoning':
    case 'vocab':
    case 'trog':
    case 'mental-rotation':
      return { ...base, ...cat, numberOfTrials: 30 };
    default:
      return base;
  }
}

// ---------- bucket helpers ----------

async function listPrefix(prefix) {
  const items = [];
  let pageToken = '';
  do {
    const url = new URL(`${GCS}/storage/v1/b/${bucket}/o`);
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('maxResults', '1000');
    url.searchParams.set('fields', 'items(name,contentType,size,md5Hash,generation),nextPageToken');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await fetchJson(url);
    for (const it of data.items ?? []) {
      if (it.name.endsWith('/')) continue; // folder placeholder objects
      items.push(it);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return items;
}

// Downloads every listed object under `folder` and writes the manifest core-tasks
// reads instead of calling the GCS listing API (shape: { items: [{ name, contentType }] }).
async function mirror(folder, items) {
  const t0 = Date.now();
  await runPool(items, concurrency, (it) => downloadObject(it.name, it));
  await writeJson(`manifests/${folder}.json`, {
    items: items.map(({ name, contentType, size, md5Hash, generation }) => ({ name, contentType, size, md5Hash, generation })),
  });
  const mb = items.reduce((a, f) => a + Number(f.size || 0), 0) / 1e6;
  console.log(`  ${folder}: ${items.length} files, ${mb.toFixed(1)} MB (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

async function downloadObject(name, meta) {
  const dest = path.join(out, name);
  const url = `${GCS}/${bucket}/${name.split('/').map(encodeURIComponent).join('/')}`;
  let info = meta;
  if (!info) {
    const metaUrl = `${GCS}/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?fields=name,contentType,size,md5Hash,generation`;
    info = await fetchJson(metaUrl);
  }
  const existing = await stat(dest).catch(() => null);
  if (existing && Number(info.size) === existing.size) {
    skipped++;
  } else {
    const buf = await fetchWithRetry(url).then((r) => r.arrayBuffer());
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(buf));
    bytesDownloaded += buf.byteLength;
  }
  files.push({ name, size: Number(info.size), md5Hash: info.md5Hash, generation: info.generation, contentType: info.contentType });
}

async function fetchWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

async function fetchJson(url) {
  return fetchWithRetry(String(url)).then((r) => r.json());
}

async function runPool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function writeJson(rel, data) {
  const dest = path.join(out, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, `${JSON.stringify(data, null, 2)}\n`);
}

async function sha256File(rel) {
  const buf = await readFile(path.join(out, rel));
  return createHash('sha256').update(buf).digest('hex');
}

async function exists(p) {
  return stat(p).then(() => true, () => false);
}

function baseName(objectName) {
  return objectName.split('/').pop().replace(/\.[^.]+$/, '');
}

function parseArgs(argv) {
  const res = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) res[key] = true;
    else {
      res[key] = next;
      i++;
    }
  }
  return res;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
