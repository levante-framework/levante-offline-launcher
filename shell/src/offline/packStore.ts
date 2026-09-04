import { corpusFor, translationTaskFor } from './corpusDefaults';
import { deletePackRecord, getPack, listPacks, putPack, updatePack } from './db';
import { packStorage } from './storage';
import type { PackRecord } from './types';

// Downloads an administration's asset pack from the public bucket into local storage, laid
// out exactly as core-tasks expects behind `assetBaseUrl` (see assetBase.ts on the
// levante-in-a-box branch): objects at <base>/<bucket object name> and the GCS listing
// responses replaced by <base>/manifests/<folder>.json. Where "local storage" is (Cache
// Storage served by the service worker, or the app filesystem) is the storage backend's
// business — see storage.ts.

const GCS = 'https://storage.googleapis.com';
const BUCKET = (import.meta.env.VITE_ASSET_BUCKET as string | undefined) || 'levante-assets-prod';
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

export { PACK_CACHE } from './storage';

export function assetBaseFor(packId: string) {
  return packStorage.assetBase(packId);
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
  const id = pack.packId;
  const progress: DownloadProgress = { filesDone: 0, fileCount: 0, bytes: 0, current: '' };
  const report = () => onProgress?.({ ...progress });

  await putPack({ ...pack, status: 'downloading', error: null });

  // 1. Which audio files these tasks need.
  const apt = (await fetchJson(`${GCS}/${BUCKET}/audio/assets-per-task.json`)) as Record<string, { audio: string[] }>;
  await packStorage.putJson(id, 'audio/assets-per-task.json', apt);
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
  await updatePack(id, { fileCount: progress.fileCount });
  report();

  // 3. Manifests + objects.
  for (const { folder, items } of folders) {
    await packStorage.putJson(id, `manifests/${folder}.json`, {
      items: items.map(({ name, contentType }) => ({ name, contentType })),
    });
    await runPool(items, CONCURRENCY, async (item) => {
      progress.current = item.name;
      // Await first, then add: `x += await f()` reads x before the await and races other workers.
      const stored = await storeObject(id, item.name);
      progress.bytes += stored.bytes;
      progress.filesDone++;
      if (progress.filesDone % 25 === 0) {
        await updatePack(id, { filesDone: progress.filesDone, totalBytes: progress.bytes });
        report();
      }
    });
  }

  // 4. Corpora + translations, hashing corpora for provenance.
  for (const rel of extras) {
    progress.current = rel;
    const stored = await storeObject(id, rel);
    progress.bytes += stored.bytes;
    progress.filesDone++;
    const corpusTask = Object.keys(corpora).find((t) => rel.startsWith(`corpus/${t}/`));
    if (corpusTask) {
      const buf = stored.buf ?? (await packStorage.readBytes(id, rel));
      corpora[corpusTask].sha256 = buf ? await sha256(buf) : '';
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
  await updatePack(id, done);
  setActivePackId(id);
  return { ...pack, ...done } as PackRecord;
}

export async function markPackError(packId: string, error: unknown) {
  await updatePack(packId, { status: 'error', error: error instanceof Error ? error.message : String(error) });
}

export async function deletePack(packId: string) {
  await packStorage.deletePack(packId);
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

// Resumable: an object already stored is not fetched again.
async function storeObject(packId: string, objectName: string): Promise<{ bytes: number; buf: ArrayBuffer | null }> {
  if (await packStorage.has(packId, objectName)) return { bytes: 0, buf: null };
  const url = `${GCS}/${BUCKET}/${objectName.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetchWithRetry(url);
  const buf = await res.arrayBuffer();
  await packStorage.putBytes(packId, objectName, buf, res.headers.get('content-type') ?? 'application/octet-stream');
  return { bytes: buf.byteLength, buf };
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
  // WebKit's network errors are a bare "Load failed"; keep the URL so the failure is diagnosable.
  throw new Error(`${lastErr instanceof Error ? lastErr.message : String(lastErr)} — ${url}`);
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
