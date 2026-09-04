import { corpusFor, translationTaskFor } from './corpusDefaults';
import { deletePackRecord, getPack, listPacks, putPack, updatePack } from './db';
import type { PackRecord } from './types';

// Downloads an administration's asset pack from the public bucket into Cache Storage,
// laid out exactly as core-tasks expects behind `assetBaseUrl` (see assetBase.ts on the
// levante-in-a-box branch): objects at /pack/<packId>/<bucket object name> and the GCS
// listing responses replaced by /pack/<packId>/manifests/<folder>.json. The service
// worker (src/sw.ts) serves this cache, so a provisioned device needs no network at all.

const GCS = 'https://storage.googleapis.com';
const BUCKET = (import.meta.env.VITE_ASSET_BUCKET as string | undefined) || 'levante-assets-prod';
export const PACK_CACHE = 'levante-packs';
const CONCURRENCY = 6;
const ACTIVE_KEY = 'levante-offline:active-pack';

interface GcsItem {
  name: string;
  contentType?: string;
  size?: string;
}

export interface DownloadProgress {
  filesDone: number;
  fileCount: number;
  bytes: number;
  current: string;
}

export function packBase(packId: string) {
  return `/pack/${encodeURIComponent(packId)}`;
}

export function getActivePackId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActivePackId(packId: string | null) {
  if (packId) localStorage.setItem(ACTIVE_KEY, packId);
  else localStorage.removeItem(ACTIVE_KEY);
}

export async function getActivePack(): Promise<PackRecord | null> {
  const id = getActivePackId();
  if (id) {
    const pack = await getPack(id);
    if (pack) return pack;
  }
  const ready = (await listPacks()).find((p) => p.status === 'ready');
  if (ready) setActivePackId(ready.packId);
  return ready ?? null;
}

export async function downloadPack(pack: PackRecord, onProgress?: (p: DownloadProgress) => void): Promise<PackRecord> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
  const base = packBase(pack.packId);
  const cache = await caches.open(PACK_CACHE);
  const progress: DownloadProgress = { filesDone: 0, fileCount: 0, bytes: 0, current: '' };
  const report = () => onProgress?.({ ...progress });

  await putPack({ ...pack, status: 'downloading', error: null });

  // 1. Which audio files these tasks need.
  const apt = (await fetchJson(`${GCS}/${BUCKET}/audio/assets-per-task.json`)) as Record<string, { audio: string[] }>;
  await putJson(cache, `${base}/audio/assets-per-task.json`, apt);
  const audioNames = new Set<string>();
  for (const task of pack.tasks) {
    for (const name of apt[task.taskId]?.audio ?? []) audioNames.add(name);
  }
  for (const name of apt.shared?.audio ?? []) audioNames.add(name);

  // 2. Enumerate every folder up front so progress is meaningful.
  const folders: Array<{ folder: string; items: GcsItem[] }> = [];
  const localeItems = (await listPrefix(`audio/${pack.locale}/`)).filter((it) => audioNames.has(baseName(it.name)));
  folders.push({ folder: `audio/${pack.locale}`, items: localeItems });
  folders.push({ folder: 'audio/shared', items: await listPrefix('audio/shared/') });
  for (const task of pack.tasks) folders.push({ folder: `visual/${task.taskId}`, items: await listPrefix(`visual/${task.taskId}/`) });
  folders.push({ folder: 'visual/shared', items: await listPrefix('visual/shared/') });

  const extras: string[] = [];
  const corpora: PackRecord['corpora'] = {};
  for (const task of pack.tasks) {
    const corpus = corpusFor(task.taskId, task.variantParams);
    if (corpus) {
      extras.push(`corpus/${task.taskId}/${corpus}.csv`);
      corpora[task.taskId] = { corpus, sha256: '' };
    }
    extras.push(`translations/itembank/${translationTaskFor(task.taskId)}/${pack.locale}/item-bank-translations.json`);
  }
  extras.push(`translations/itembank/general/${pack.locale}/item-bank-translations.json`);

  progress.fileCount = folders.reduce((n, f) => n + f.items.length, 0) + extras.length;
  await updatePack(pack.packId, { fileCount: progress.fileCount });
  report();

  // 3. Manifests + objects.
  for (const { folder, items } of folders) {
    await putJson(cache, `${base}/manifests/${folder}.json`, {
      items: items.map(({ name, contentType }) => ({ name, contentType })),
    });
    await runPool(items, CONCURRENCY, async (item) => {
      progress.current = item.name;
      // Await first, then add: `x += await f()` reads x before the await and races other workers.
      const bytes = await cacheObject(cache, `${base}/${item.name}`, item.name);
      progress.bytes += bytes;
      progress.filesDone++;
      if (progress.filesDone % 25 === 0) {
        await updatePack(pack.packId, { filesDone: progress.filesDone, totalBytes: progress.bytes });
        report();
      }
    });
  }

  // 4. Corpora + translations, hashing corpora for provenance.
  for (const rel of extras) {
    progress.current = rel;
    const bytes = await cacheObject(cache, `${base}/${rel}`, rel);
    progress.bytes += bytes;
    progress.filesDone++;
    const corpusTask = Object.keys(corpora).find((t) => rel.startsWith(`corpus/${t}/`));
    if (corpusTask) {
      const cached = await cache.match(`${base}/${rel}`);
      corpora[corpusTask].sha256 = cached ? await sha256(await cached.arrayBuffer()) : '';
    }
    report();
  }

  const done: Partial<PackRecord> = {
    status: 'ready',
    error: null,
    filesDone: progress.filesDone,
    fileCount: progress.fileCount,
    totalBytes: progress.bytes,
    corpora,
  };
  await updatePack(pack.packId, done);
  setActivePackId(pack.packId);
  return { ...pack, ...done } as PackRecord;
}

export async function markPackError(packId: string, error: unknown) {
  await updatePack(packId, { status: 'error', error: error instanceof Error ? error.message : String(error) });
}

export async function deletePack(packId: string) {
  const cache = await caches.open(PACK_CACHE);
  const prefix = `${location.origin}${packBase(packId)}/`;
  for (const req of await cache.keys()) {
    if (req.url.startsWith(prefix)) await cache.delete(req);
  }
  await deletePackRecord(packId);
  if (getActivePackId() === packId) setActivePackId(null);
}

// ---------- helpers ----------

async function listPrefix(prefix: string): Promise<GcsItem[]> {
  const items: GcsItem[] = [];
  let pageToken = '';
  do {
    const url = new URL(`${GCS}/storage/v1/b/${BUCKET}/o`);
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('maxResults', '1000');
    url.searchParams.set('fields', 'items(name,contentType,size),nextPageToken');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = (await fetchJson(url.toString())) as { items?: GcsItem[]; nextPageToken?: string };
    for (const it of data.items ?? []) if (!it.name.endsWith('/')) items.push(it);
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return items;
}

// Resumable: an object already in the cache is not fetched again.
async function cacheObject(cache: Cache, cacheUrl: string, objectName: string): Promise<number> {
  if (await cache.match(cacheUrl)) return 0;
  const url = `${GCS}/${BUCKET}/${objectName.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetchWithRetry(url);
  const buf = await res.arrayBuffer();
  await cache.put(
    cacheUrl,
    new Response(buf, {
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
        'content-length': String(buf.byteLength),
      },
    }),
  );
  return buf.byteLength;
}

async function putJson(cache: Cache, cacheUrl: string, data: unknown) {
  await cache.put(cacheUrl, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }));
}

async function fetchJson(url: string) {
  return (await fetchWithRetry(url)).json();
}

async function fetchWithRetry(url: string, tries = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastErr;
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

async function sha256(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function baseName(objectName: string) {
  return (objectName.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
}
