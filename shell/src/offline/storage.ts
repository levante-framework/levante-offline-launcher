import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

// Where a provisioned pack lives, and the URL core-tasks fetches it from.
//
// In the browser (PWA) the pack goes into Cache Storage and the service worker serves it
// under /pack/<packId>/…. Inside the Capacitor shell the WebView origin is a custom scheme
// (capacitor://localhost on iOS), which the Cache API refuses to store, so the pack goes on
// the app's filesystem instead and is served through Capacitor's file URL bridge — no
// service worker involved, and no browser storage-eviction heuristics.

export interface PackStorage {
  readonly kind: 'cache' | 'filesystem';
  /** Base URL core-tasks can fetch objects and manifests from. */
  assetBase(packId: string): Promise<string>;
  has(packId: string, name: string): Promise<boolean>;
  putBytes(packId: string, name: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
  putJson(packId: string, name: string, data: unknown): Promise<void>;
  readBytes(packId: string, name: string): Promise<ArrayBuffer | null>;
  deletePack(packId: string): Promise<void>;
  wipe(): Promise<void>;
}

export const PACK_CACHE = 'levante-packs';

function cachePath(packId: string, name = '') {
  return `/pack/${encodeURIComponent(packId)}${name ? `/${name}` : ''}`;
}

const cacheStorage: PackStorage = {
  kind: 'cache',
  async assetBase(packId) {
    return cachePath(packId);
  },
  async has(packId, name) {
    const cache = await caches.open(PACK_CACHE);
    return !!(await cache.match(cachePath(packId, name)));
  },
  async putBytes(packId, name, bytes, contentType) {
    const cache = await caches.open(PACK_CACHE);
    await cache.put(
      cachePath(packId, name),
      new Response(bytes, { headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) } }),
    );
  },
  async putJson(packId, name, data) {
    const cache = await caches.open(PACK_CACHE);
    await cache.put(cachePath(packId, name), new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }));
  },
  async readBytes(packId, name) {
    const cache = await caches.open(PACK_CACHE);
    const hit = await cache.match(cachePath(packId, name));
    return hit ? hit.arrayBuffer() : null;
  },
  async deletePack(packId) {
    const cache = await caches.open(PACK_CACHE);
    const prefix = `${location.origin}${cachePath(packId)}/`;
    for (const req of await cache.keys()) if (req.url.startsWith(prefix)) await cache.delete(req);
  },
  async wipe() {
    await caches.delete(PACK_CACHE);
  },
};

const FS_ROOT = 'packs';
const FS_DIR = Directory.Data;

function fsPath(packId: string, name = '') {
  return `${FS_ROOT}/${packId}${name ? `/${name}` : ''}`;
}

const filesystemStorage: PackStorage = {
  kind: 'filesystem',
  async assetBase(packId) {
    const { uri } = await Filesystem.getUri({ directory: FS_DIR, path: fsPath(packId) });
    return Capacitor.convertFileSrc(uri).replace(/\/+$/, '');
  },
  async has(packId, name) {
    try {
      await Filesystem.stat({ directory: FS_DIR, path: fsPath(packId, name) });
      return true;
    } catch {
      return false;
    }
  },
  async putBytes(packId, name, bytes) {
    await Filesystem.writeFile({ directory: FS_DIR, path: fsPath(packId, name), data: toBase64(bytes), recursive: true });
  },
  async putJson(packId, name, data) {
    await Filesystem.writeFile({
      directory: FS_DIR,
      path: fsPath(packId, name),
      data: JSON.stringify(data),
      encoding: Encoding.UTF8,
      recursive: true,
    });
  },
  async readBytes(packId, name) {
    try {
      const { data } = await Filesystem.readFile({ directory: FS_DIR, path: fsPath(packId, name) });
      return typeof data === 'string' ? fromBase64(data) : await data.arrayBuffer();
    } catch {
      return null;
    }
  },
  async deletePack(packId) {
    try {
      await Filesystem.rmdir({ directory: FS_DIR, path: fsPath(packId), recursive: true });
    } catch {
      /* already gone */
    }
  },
  async wipe() {
    try {
      await Filesystem.rmdir({ directory: FS_DIR, path: FS_ROOT, recursive: true });
    } catch {
      /* already gone */
    }
  },
};

export const packStorage: PackStorage = Capacitor.isNativePlatform() ? filesystemStorage : cacheStorage;

export function platformLabel() {
  return `${Capacitor.isNativePlatform() ? `native ${Capacitor.getPlatform()}` : 'browser'} · ${packStorage.kind} storage`;
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) binary += String.fromCharCode(...view.subarray(i, i + chunk));
  return btoa(binary);
}

function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}
