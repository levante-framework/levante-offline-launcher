import { getActivePack } from './packStore';
import type { PackRecord } from './types';

// The active provisioned administration. Everything the roster and task screens need
// lives in IndexedDB (pack record) and Cache Storage (assets), so this works offline.
export async function loadPack(): Promise<PackRecord> {
  const pack = await getActivePack();
  if (!pack) throw new Error('This device has no provisioned administration yet. Provision one while online.');
  if (pack.status !== 'ready') throw new Error(`Pack ${pack.packId} is ${pack.status}${pack.error ? `: ${pack.error}` : ''}.`);
  return pack;
}
