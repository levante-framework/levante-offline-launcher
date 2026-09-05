import { corpusFor, DEFAULT_CORPUS, translationTaskFor } from './corpusDefaults';
import { deletePackRecord, getPack, listPacks, putPack, updatePack } from './db';
import { packStorage } from './storage';
import type { PackRecord } from './types';

// Downloads an administration's asset pack into local storage, laid out exactly as
// core-tasks expects behind `assetBaseUrl` (see assetBase.ts on the levante-in-a-box
// branch): objects at <base>/<bucket object name> and the GCS listing responses replaced
// by <base>/manifests/<folder>.json. Where "local storage" is (Cache Storage served by the
// service worker, or the app filesystem) is the storage backend's business — see storage.ts.
//
// Two sources:
//   - bundles (VITE_BUNDLE_BASE set): one content-addressed index per unit
//     (`shared/<locale>`, `task/<id>/<locale>`) plus the entries' bytes as fixed-size part
//     files, built by pack-builder/build-bundles.mjs. Parts are read in order and sliced
//     into per-file objects — streamed where the platform exposes a body stream, one part
//     in memory at a time where it does not (Capacitor's native HTTP) — every entry's
//     SHA-256 verified; an interrupted download resumes at the part holding the first
//     entry not yet stored. No Range requests anywhere.
//   - listing (fallback): enumerate the bucket folders through the GCS JSON API and fetch
//     every object — the original path, ~1,800 requests for three tasks.

const GCS = 'https://storage.googleapis.com';
const BUCKET = (import.meta.env.VITE_ASSET_BUCKET as string | undefined) || 'levante-assets-prod';
const BUNDLE_BASE = ((import.meta.env.VITE_BUNDLE_BASE as string | undefined) || '').replace(/\/+$/, '');
const CONCURRENCY = 6;
const ACTIVE_KEY = 'levante-offline:active-pack';

interface GcsItem {
  name: string;
  contentType?: string;
  size?: string;
}

interface BundleEntry {
  name: string;
  contentType: string;
  offset: number;
  length: number;
  sha256: string;
}

interface BundleIndex {
  format: string;
  unit: string;
  bundleId: string;
  builtAt: string;
  bytes: number;
  files: number;
  partBytes: number;
  parts: number;
  corpora?: Record<string, { corpus: string; sha256: string }>;
  warnings?: string[];
  entries: BundleEntry[];
}

interface BundleCatalog {
  builtAt: string;
  bucket: string;
  units: Record<string, { bundleId: string; bytes: number; files: number }>;
}

export interface DownloadProgress {
  filesDone: number;
  fileCount: number;
  bytes: number;
  current: string;
}

interface Session {
  id: string;
  progress: DownloadProgress;
  report: () => void;
}

export { PACK_CACHE } from './storage';

export const usesBundles = BUNDLE_BASE !== '';

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
  const progress: DownloadProgress = { filesDone: 0, fileCount: 0, bytes: 0, current: '' };
  const session: Session = { id: pack.packId, progress, report: () => onProgress?.({ ...progress }) };

  await putPack({ ...pack, status: 'downloading', error: null });
  const built = usesBundles ? await downloadFromBundles(pack, session) : await downloadFromListing(pack, session);

  const done: Partial<PackRecord> = {
    status: 'ready',
    error: null,
    filesDone: progress.filesDone,
    fileCount: progress.fileCount,
    totalBytes: progress.bytes,
    ...built,
  };
  await updatePack(pack.packId, done);
  setActivePackId(pack.packId);
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

// ---------- bundles ----------

async function downloadFromBundles(pack: PackRecord, { id, progress, report }: Session): Promise<Partial<PackRecord>> {
  progress.current = 'bundle catalog…';
  report();
  const catalog = (await fetchJson(`${BUNDLE_BASE}/catalog.json`)) as BundleCatalog;
  const units = [`shared/${pack.locale}`, ...pack.tasks.map((t) => `task/${t.taskId}/${pack.locale}`)];
  const indexes: BundleIndex[] = [];
  for (const unit of units) {
    const summary = catalog.units[unit];
    if (!summary) throw new Error(`No bundle for ${unit} in ${BUNDLE_BASE}/catalog.json — build it with pack-builder/build-bundles.mjs`);
    indexes.push((await fetchJson(`${BUNDLE_BASE}/${unit}/${summary.bundleId}.json`)) as BundleIndex);
  }

  // Variants can ask for a corpus other than the bundled default; those are fetched singly.
  const extraCorpora: Array<{ taskId: string; corpus: string }> = [];
  for (const task of pack.tasks) {
    const corpus = corpusFor(task.taskId, task.variantParams);
    if (corpus && corpus !== DEFAULT_CORPUS[task.taskId]) extraCorpora.push({ taskId: task.taskId, corpus });
  }
  progress.fileCount = indexes.reduce((n, ix) => n + ix.entries.length, 0) + extraCorpora.length;
  await updatePack(id, { fileCount: progress.fileCount });
  report();

  const bundles: NonNullable<PackRecord['bundles']> = {};
  const corpora: PackRecord['corpora'] = {};
  for (const index of indexes) {
    await downloadBundle(id, index, progress, report, pack.filesDone > 0);
    bundles[index.unit] = { bundleId: index.bundleId, bytes: index.bytes, files: index.entries.length };
    Object.assign(corpora, index.corpora ?? {});
  }
  for (const { taskId, corpus } of extraCorpora) {
    const rel = `corpus/${taskId}/${corpus}.csv`;
    progress.current = rel;
    const stored = await storeObject(id, rel);
    progress.bytes += stored.bytes;
    progress.filesDone++;
    const buf = stored.buf ?? (await packStorage.readBytes(id, rel));
    corpora[taskId] = { corpus, sha256: buf ? await sha256Hex(new Uint8Array(buf)) : '' };
    report();
  }

  // The folder listings core-tasks asks for, from the union of every bundle's entries. The
  // four it always lists get a manifest even when empty (child-survey has no visual folder;
  // the bucket answers such a listing with an empty page, and so must the pack).
  const byFolder = new Map<string, Array<{ name: string; contentType: string }>>();
  for (const folder of [`audio/${pack.locale}`, 'audio/shared', 'visual/shared', ...pack.tasks.map((t) => `visual/${t.taskId}`)]) byFolder.set(folder, []);
  for (const index of indexes) {
    for (const e of index.entries) {
      const parts = e.name.split('/');
      if (parts.length < 3) continue;
      const folder = parts.slice(0, 2).join('/');
      let items = byFolder.get(folder);
      if (!items) byFolder.set(folder, (items = []));
      items.push({ name: e.name, contentType: e.contentType });
    }
  }
  for (const [folder, items] of byFolder) {
    const listed = folder.startsWith('visual/') ? preferWebpImages(items) : items;
    await packStorage.putJson(id, `manifests/${folder}.json`, { items: listed });
  }

  return { corpora, bundles };
}

// Reads one bundle's parts in order and stores each entry as its own object. Entries already
// present are skipped; the read starts at the part holding the first missing entry, so an
// interrupted download resumes there.
async function downloadBundle(packId: string, index: BundleIndex, progress: DownloadProgress, report: () => void, resume: boolean) {
  const entries = [...index.entries].sort((a, b) => a.offset - b.offset);
  // Only a pack that already holds something needs the per-entry existence checks (each one
  // is a native call on Capacitor); a fresh pack downloads everything.
  const missing: boolean[] = [];
  for (const e of entries) missing.push(resume ? !(await packStorage.has(packId, e.name)) : true);
  const first = missing.indexOf(true);
  if (first < 0) {
    progress.filesDone += entries.length;
    report();
    return;
  }
  progress.filesDone += first;

  const partUrl = (p: number) => `${BUNDLE_BASE}/${index.unit}/${index.bundleId}.p${String(p).padStart(4, '0')}`;
  const start = entries[first].offset;
  const firstPart = Math.floor(start / index.partBytes);
  const reader = new ByteReader((i) => (firstPart + i < index.parts ? fetchWithRetry(partUrl(firstPart + i)) : null));
  await reader.take(start - firstPart * index.partBytes);

  for (let k = first; k < entries.length; k++) {
    const e = entries[k];
    const bytes = await reader.take(e.length);
    if (missing[k]) {
      const digest = await sha256Hex(bytes);
      if (digest !== e.sha256) throw new Error(`checksum mismatch for ${e.name} in ${index.unit}/${index.bundleId}`);
      await packStorage.putBytes(packId, e.name, bytes.buffer, e.contentType);
      progress.bytes += e.length;
    }
    progress.filesDone++;
    progress.current = e.name;
    if (progress.filesDone % 25 === 0) {
      await updatePack(packId, { filesDone: progress.filesDone, totalBytes: progress.bytes });
      report();
    }
  }
  await reader.close();
  report();
}

// Sequential byte reader over a series of responses (the bundle's parts): streams a body
// when the platform exposes one and otherwise holds one part in memory (CapacitorHttp's
// patched fetch has no body stream — a part is 2 MB, so that is bounded).
class ByteReader {
  private chunks: Uint8Array[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private next = 0;
  private exhausted = false;

  constructor(private readonly open: (i: number) => Promise<Response> | null) {}

  async take(n: number): Promise<Uint8Array<ArrayBuffer>> {
    const out = new Uint8Array(new ArrayBuffer(n));
    let filled = 0;
    while (filled < n) {
      if (this.chunks.length === 0 && !(await this.fill())) throw new Error(`bundle ended after ${filled} of ${n} bytes`);
      const chunk = this.chunks[0];
      const need = n - filled;
      if (chunk.length <= need) {
        out.set(chunk, filled);
        filled += chunk.length;
        this.chunks.shift();
      } else {
        out.set(chunk.subarray(0, need), filled);
        filled += need;
        this.chunks[0] = chunk.subarray(need);
      }
    }
    return out;
  }

  private async fill(): Promise<boolean> {
    for (;;) {
      if (this.reader) {
        const { value, done } = await this.reader.read();
        if (!done && value) {
          this.chunks.push(value);
          return true;
        }
        this.reader = null;
      }
      if (this.exhausted) return false;
      const pending = this.open(this.next++);
      if (!pending) {
        this.exhausted = true;
        return false;
      }
      const res = await pending;
      if (res.body) {
        this.reader = res.body.getReader();
      } else {
        this.chunks.push(new Uint8Array(await res.arrayBuffer()));
        return true;
      }
    }
  }

  async close() {
    try {
      await this.reader?.cancel();
    } catch {
      /* stream already finished */
    }
  }
}

// ---------- listing (legacy path) ----------

async function downloadFromListing(pack: PackRecord, { id, progress, report }: Session): Promise<Partial<PackRecord>> {
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
  for (const task of pack.tasks) folders.push({ folder: `visual/${task.taskId}`, items: preferWebpImages(await listPrefix(`visual/${task.taskId}/`)) });
  folders.push({ folder: 'visual/shared', items: preferWebpImages(await listPrefix('visual/shared/')) });

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
      corpora[corpusTask].sha256 = buf ? await sha256Hex(new Uint8Array(buf)) : '';
    }
    report();
  }
  return { corpora };
}

// ---------- helpers ----------

function preferWebpImages(items: GcsItem[]): GcsItem[] {
  const webpStems = new Set<string>();
  for (const it of items) {
    if (/\.webp$/i.test(it.name)) webpStems.add(it.name.replace(/\.webp$/i, ''));
  }
  if (!webpStems.size) return items;
  return items.filter((it) => !/\.(png|jpe?g)$/i.test(it.name) || !webpStems.has(it.name.replace(/\.(png|jpe?g)$/i, '')));
}

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

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function baseName(objectName: string) {
  return (objectName.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
}
