#!/usr/bin/env node
// Builds content-addressed asset bundles for the LEVANTE offline launcher from the public
// bucket, so a device downloads one index and one blob per unit instead of listing folders
// and fetching ~1,800 objects (which costs WebKit ~2 minutes for a three-task pack).
//
// Units:
//   task/<taskId>/<locale>   visual/<taskId>/**, the task's audio/<locale>/* (per assets-per-task.json),
//                            its default corpus, its item-bank translations
//   shared/<locale>          audio/shared/**, visual/shared/**, shared audio/<locale>/*,
//                            general translations, audio/assets-per-task.json
// A bundle is two files under <out>/<unit>/:
//   <bundleId>.json   index: entries [{name, contentType, offset, length, sha256}] + provenance + warnings
//   <bundleId>.bin    the entries' bytes concatenated in index order — no compression (stimuli
//                     already are) so slicing is trivial and HTTP Range resume works
// <out>/catalog.json maps every unit to its current bundleId. bundleId = sha256 over the entry
// names and hashes: identical content always yields the same id, so it doubles as the pack's
// version stamp on every run.
//
// Usage:
//   node build-bundles.mjs --tasks hearts-and-flowers,egma-math --locale en-US [--env prod] [--out ./bundles]
//                          [--cache ./cache] [--concurrency 8] [--strict]
// --cache keeps downloaded objects on disk (by name + size) so rebuilding is free.
// --strict exits non-zero when a bundle has warnings (missing audio/corpus/translations).

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GCS = 'https://storage.googleapis.com';

// Mirrors task-launcher/src/tasks/shared/helpers/config.ts (defaultCorpus).
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
// core-tasks reads adult-reasoning strings from the math item bank.
const translationTaskFor = (taskId) => (taskId === 'adult-reasoning' ? 'egma-math' : taskId);

const args = parseArgs(process.argv.slice(2));
const tasks = String(args.tasks || 'hearts-and-flowers').split(',').map((s) => s.trim()).filter(Boolean);
const locale = args.locale || 'en-US';
const env = args.env || 'prod';
const bucket = `levante-assets-${env}`;
const out = path.resolve(args.out || './bundles');
const cacheDir = args.cache ? path.resolve(args.cache) : null;
const concurrency = Number(args.concurrency || 8);
const strict = Boolean(args.strict);

let downloaded = 0;
let fromCache = 0;

async function main() {
  console.log(`Building bundles from gs://${bucket} → ${out}   tasks: ${tasks.join(', ')}   locale: ${locale}`);
  await mkdir(out, { recursive: true });

  const apt = await fetchJson(`${GCS}/${bucket}/audio/assets-per-task.json`);
  const localeAudio = await listPrefix(`audio/${locale}/`);
  const localeAudioByBase = new Map(localeAudio.map((it) => [baseName(it.name), it]));

  const catalogPath = path.join(out, 'catalog.json');
  const catalog = (await exists(catalogPath)) ? JSON.parse(await readFile(catalogPath, 'utf8')) : { units: {} };
  catalog.bucket = bucket;
  catalog.builtAt = new Date().toISOString();

  // --- shared unit ---
  {
    const unit = `shared/${locale}`;
    const warnings = [];
    const items = [
      ...(await listPrefix('audio/shared/')),
      ...(await listPrefix('visual/shared/')),
      ...pickAudio(apt.shared?.audio ?? [], localeAudioByBase, 'shared', warnings),
    ];
    const extras = [`translations/itembank/general/${locale}/item-bank-translations.json`, 'audio/assets-per-task.json'];
    const summary = await buildBundle(unit, items, extras, {}, warnings);
    catalog.units[unit] = summary;
  }

  // --- one unit per task ---
  for (const taskId of tasks) {
    const unit = `task/${taskId}/${locale}`;
    const warnings = [];
    const items = [...(await listPrefix(`visual/${taskId}/`)), ...pickAudio(apt[taskId]?.audio ?? [], localeAudioByBase, taskId, warnings)];
    if (!apt[taskId]) warnings.push(`no entry for ${taskId} in audio/assets-per-task.json`);
    const extras = [`translations/itembank/${translationTaskFor(taskId)}/${locale}/item-bank-translations.json`];
    const corpora = {};
    if (!NO_CORPUS.has(taskId)) {
      const corpus = DEFAULT_CORPUS[taskId];
      if (corpus) {
        extras.push(`corpus/${taskId}/${corpus}.csv`);
        corpora[taskId] = { corpus, sha256: '' };
      } else warnings.push(`no default corpus known for ${taskId}`);
    }
    const summary = await buildBundle(unit, items, extras, corpora, warnings);
    catalog.units[unit] = summary;
  }

  await writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  const warned = Object.values(catalog.units).filter((u) => u.warnings > 0);
  console.log(`\ncatalog: ${catalogPath}   objects downloaded: ${downloaded}, from cache: ${fromCache}`);
  if (warned.length) {
    console.log(`units with warnings: ${warned.length}`);
    if (strict) process.exit(2);
  }
}

// Downloads every object of the unit, writes <bundleId>.bin/.json, returns the catalog summary.
async function buildBundle(unit, items, extras, corpora, warnings) {
  const wanted = [...items.map((it) => ({ name: it.name, contentType: it.contentType })), ...extras.map((name) => ({ name, contentType: null }))];
  const bytesByName = new Map();
  await runPool(wanted, concurrency, async (w) => {
    try {
      bytesByName.set(w.name, await getObject(w.name));
    } catch (err) {
      warnings.push(`${w.name}: ${err.message}`);
    }
  });

  const entries = [];
  let offset = 0;
  const parts = [];
  for (const w of wanted) {
    const bytes = bytesByName.get(w.name);
    if (!bytes) continue;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    entries.push({ name: w.name, contentType: w.contentType ?? guessType(w.name), offset, length: bytes.length, sha256 });
    parts.push(bytes);
    offset += bytes.length;
    const corpusTask = Object.keys(corpora).find((t) => w.name.startsWith(`corpus/${t}/`));
    if (corpusTask) corpora[corpusTask].sha256 = sha256;
  }
  const bundleId = createHash('sha256')
    .update(entries.map((e) => `${e.name}\n${e.sha256}\n`).join(''))
    .digest('hex')
    .slice(0, 32);

  const dir = path.join(out, unit);
  await mkdir(dir, { recursive: true });
  const index = {
    format: 'levante-bundle/1',
    unit,
    bundleId,
    builtAt: new Date().toISOString(),
    bucket,
    bytes: offset,
    files: entries.length,
    corpora,
    warnings,
    entries,
  };
  await writeFile(path.join(dir, `${bundleId}.bin`), Buffer.concat(parts));
  await writeFile(path.join(dir, `${bundleId}.json`), JSON.stringify(index));
  console.log(`  ${unit}: ${entries.length} files, ${(offset / 1e6).toFixed(1)} MB → ${bundleId}${warnings.length ? `   ⚠ ${warnings.length} warning(s)` : ''}`);
  for (const w of warnings) console.log(`      ⚠ ${w}`);
  return { bundleId, bytes: offset, files: entries.length, warnings: warnings.length, builtAt: index.builtAt };
}

// The audio files a task needs, resolved against the locale folder; missing ones are warnings
// (a task whose prompts are not recorded in this locale is exactly what CI should flag).
function pickAudio(names, byBase, owner, warnings) {
  const picked = [];
  for (const name of names) {
    const it = byBase.get(name);
    if (it) picked.push(it);
    else warnings.push(`audio/${locale}/${name}.* missing (used by ${owner})`);
  }
  return picked;
}

async function getObject(name) {
  const cached = cacheDir ? path.join(cacheDir, name) : null;
  if (cached && (await exists(cached))) {
    fromCache++;
    return readFile(cached);
  }
  const res = await fetchWithRetry(`${GCS}/${bucket}/${name.split('/').map(encodeURIComponent).join('/')}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  downloaded++;
  if (cached) {
    await mkdir(path.dirname(cached), { recursive: true });
    await writeFile(cached, bytes);
  }
  return bytes;
}

async function listPrefix(prefix) {
  const items = [];
  let pageToken = '';
  do {
    const url = new URL(`${GCS}/storage/v1/b/${bucket}/o`);
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('maxResults', '1000');
    url.searchParams.set('fields', 'items(name,contentType,size),nextPageToken');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await fetchJson(url.toString());
    for (const it of data.items ?? []) if (!it.name.endsWith('/')) items.push(it);
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return items;
}

async function fetchJson(url) {
  return (await fetchWithRetry(url)).json();
}

async function fetchWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) throw Object.assign(new Error('404 not found'), { fatal: true });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (err.fatal) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastErr;
}

async function runPool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

function guessType(name) {
  const ext = path.extname(name).toLowerCase();
  return { '.json': 'application/json', '.csv': 'text/csv', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' }[ext] ?? 'application/octet-stream';
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function baseName(objectName) {
  return (objectName.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
