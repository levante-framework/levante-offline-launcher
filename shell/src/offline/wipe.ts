import { wipeAll } from './db';
import { PACK_CACHE } from './packStore';

// Removes everything the launcher stored on this device: sealed records, asset packs,
// the vault, the proctor session, and device-local selections. The device id is kept so
// runs synced earlier remain attributable to the same device.
export async function wipeDevice() {
  await wipeAll();
  await caches.delete(PACK_CACHE);
  sessionStorage.clear();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('levante-offline:') && key !== 'levante-offline:device-id') localStorage.removeItem(key);
  }
}
