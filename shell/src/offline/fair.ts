import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { getSession } from './auth';
import { countRuns, listPacks } from './db';
import { getSelectedSite } from './site';
import { vaultExists } from './vault';

const FAIR_DB = 'levante-offline-fair';

interface FairDB extends DBSchema {
  checkpoints: { key: string; value: boolean };
}

let fairDb: Promise<IDBPDatabase<FairDB>> | null = null;

function getFairDb() {
  fairDb ??= openDB<FairDB>(FAIR_DB, 1, {
    upgrade(db) {
      db.createObjectStore('checkpoints');
    },
  });
  return fairDb;
}

export async function isFairSiteReady(): Promise<boolean> {
  const db = await getFairDb();
  return (await db.get('checkpoints', 'siteReady')) === true;
}

export async function setFairSiteReady(on: boolean): Promise<void> {
  const db = await getFairDb();
  if (on) await db.put('checkpoints', true, 'siteReady');
  else await db.delete('checkpoints', 'siteReady');
}

export async function wipeFairCheckpoints(): Promise<void> {
  const db = await getFairDb();
  await db.clear('checkpoints');
}

export type FairProgress = {
  siteReady: boolean;
  provisioned: boolean;
  packName: string;
  assessed: boolean;
  runCount: number;
  pending: number;
  retrieved: boolean;
};

export async function loadFairProgress(): Promise<FairProgress> {
  let provisioned = false;
  let packName = '';
  if (vaultExists()) {
    try {
      const packs = await listPacks();
      const ready = packs.find((p) => p.status === 'ready') ?? packs[0];
      provisioned = packs.some((p) => p.status === 'ready');
      packName = ready?.name ?? '';
    } catch {
      provisioned = false;
    }
  }
  const { total, pending } = await countRuns();
  return {
    siteReady: Boolean(getSession() && getSelectedSite()) || (await isFairSiteReady()),
    provisioned,
    packName,
    assessed: total > 0,
    runCount: total,
    pending,
    retrieved: total > 0 && pending === 0,
  };
}
