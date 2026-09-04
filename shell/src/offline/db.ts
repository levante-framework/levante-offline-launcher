import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { SealedBox } from './crypto';
import type { OfflineRunRecord, OfflineTrialRecord, PackRecord, SyncState } from './types';
import { openValue, sealValue } from './vault';

// Everything personally identifiable or performance-revealing is stored sealed with the
// device vault key (see vault.ts). Each store keeps a small plaintext envelope — the keys
// and fields needed to index, sort and count — and one AES-GCM box with the rest.

interface SealedRun {
  runId: string;
  packId: string;
  taskId: string;
  timeStartedMs: number;
  syncState: SyncState;
  trialCount: number;
  sealed: SealedBox;
}

interface SealedTrial {
  runId: string;
  trialIndex: number;
  clientTimestampMs: number;
  sealed: SealedBox;
}

interface SealedPack {
  packId: string;
  status: PackRecord['status'];
  provisionedAt: string;
  sealed: SealedBox;
}

interface OfflineDB extends DBSchema {
  runs: { key: string; value: SealedRun; indexes: { bySyncState: SyncState } };
  trials: { key: [string, number]; value: SealedTrial; indexes: { byRun: string } };
  packs: { key: string; value: SealedPack };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

export function getDb() {
  dbPromise ??= openDB<OfflineDB>('levante-offline', 3, {
    upgrade(db, oldVersion) {
      // v3 introduced sealed records; earlier (plaintext, spike-only) data is dropped.
      for (const store of ['runs', 'trials', 'packs'] as const) {
        if (db.objectStoreNames.contains(store)) db.deleteObjectStore(store);
      }
      void oldVersion;
      const runs = db.createObjectStore('runs', { keyPath: 'runId' });
      runs.createIndex('bySyncState', 'syncState');
      const trials = db.createObjectStore('trials', { keyPath: ['runId', 'trialIndex'] });
      trials.createIndex('byRun', 'runId');
      db.createObjectStore('packs', { keyPath: 'packId' });
    },
  });
  return dbPromise;
}

// ---------- runs ----------

async function sealRun(run: OfflineRunRecord): Promise<SealedRun> {
  const { runId, packId, taskId, timeStartedMs, syncState, trialCount, ...rest } = run;
  return { runId, packId, taskId, timeStartedMs, syncState, trialCount, sealed: await sealValue(rest) };
}

async function openRun(row: SealedRun): Promise<OfflineRunRecord> {
  const rest = await openValue<Omit<OfflineRunRecord, keyof Omit<SealedRun, 'sealed'>>>(row.sealed);
  const { sealed, ...envelope } = row;
  void sealed;
  return { ...rest, ...envelope } as OfflineRunRecord;
}

export async function putRun(run: OfflineRunRecord) {
  const row = await sealRun(run);
  const db = await getDb();
  await db.put('runs', row);
}

export async function updateRun(runId: string, patch: Partial<OfflineRunRecord>) {
  const current = await getRun(runId);
  if (!current) throw new Error(`Run ${runId} not found`);
  await putRun({ ...current, ...patch });
}

export async function getRun(runId: string) {
  const db = await getDb();
  const row = await db.get('runs', runId);
  return row ? openRun(row) : undefined;
}

export async function listRuns() {
  const db = await getDb();
  const rows = await db.getAll('runs');
  const runs = await Promise.all(rows.map(openRun));
  return runs.sort((a, b) => b.timeStartedMs - a.timeStartedMs);
}

/** Lightweight counts that need no decryption (safe to show on a locked device). */
export async function countRuns() {
  const db = await getDb();
  const rows = await db.getAll('runs');
  return { total: rows.length, pending: rows.filter((r) => r.syncState !== 'synced').length };
}

// ---------- trials ----------

export async function appendTrial(trial: OfflineTrialRecord) {
  const sealed = await sealValue({ clientTimestamp: trial.clientTimestamp, data: trial.data });
  const row: SealedTrial = { runId: trial.runId, trialIndex: trial.trialIndex, clientTimestampMs: trial.clientTimestampMs, sealed };
  const db = await getDb();
  const tx = db.transaction(['trials', 'runs'], 'readwrite');
  await tx.objectStore('trials').put(row);
  const run = await tx.objectStore('runs').get(trial.runId);
  if (run) await tx.objectStore('runs').put({ ...run, trialCount: Math.max(run.trialCount, trial.trialIndex + 1) });
  await tx.done;
}

export async function getTrials(runId: string): Promise<OfflineTrialRecord[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('trials', 'byRun', runId);
  const trials = await Promise.all(
    rows.map(async (row) => {
      const inner = await openValue<{ clientTimestamp: string; data: Record<string, unknown> }>(row.sealed);
      return { runId: row.runId, trialIndex: row.trialIndex, clientTimestampMs: row.clientTimestampMs, ...inner };
    }),
  );
  return trials.sort((a, b) => a.trialIndex - b.trialIndex);
}

export async function countTrials() {
  const db = await getDb();
  return db.count('trials');
}

export async function deleteRun(runId: string) {
  const db = await getDb();
  const tx = db.transaction(['trials', 'runs'], 'readwrite');
  let cursor = await tx.objectStore('trials').index('byRun').openCursor(runId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.objectStore('runs').delete(runId);
  await tx.done;
}

// ---------- packs ----------

async function sealPack(pack: PackRecord): Promise<SealedPack> {
  const { packId, status, provisionedAt, ...rest } = pack;
  return { packId, status, provisionedAt, sealed: await sealValue(rest) };
}

async function openPack(row: SealedPack): Promise<PackRecord> {
  const rest = await openValue<Omit<PackRecord, 'packId' | 'status' | 'provisionedAt'>>(row.sealed);
  return { ...rest, packId: row.packId, status: row.status, provisionedAt: row.provisionedAt };
}

export async function putPack(pack: PackRecord) {
  const row = await sealPack(pack);
  const db = await getDb();
  await db.put('packs', row);
}

export async function updatePack(packId: string, patch: Partial<PackRecord>) {
  const current = await getPack(packId);
  if (!current) throw new Error(`Pack ${packId} not found`);
  await putPack({ ...current, ...patch });
}

export async function getPack(packId: string) {
  const db = await getDb();
  const row = await db.get('packs', packId);
  return row ? openPack(row) : undefined;
}

export async function listPacks() {
  const db = await getDb();
  const rows = await db.getAll('packs');
  const packs = await Promise.all(rows.map(openPack));
  return packs.sort((a, b) => b.provisionedAt.localeCompare(a.provisionedAt));
}

export async function deletePackRecord(packId: string) {
  const db = await getDb();
  await db.delete('packs', packId);
}

/** Wipes every store (used by "wipe this device"). */
export async function wipeAll() {
  const db = await getDb();
  const tx = db.transaction(['runs', 'trials', 'packs'], 'readwrite');
  await Promise.all([tx.objectStore('runs').clear(), tx.objectStore('trials').clear(), tx.objectStore('packs').clear()]);
  await tx.done;
}
