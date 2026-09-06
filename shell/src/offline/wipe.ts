import { wipeAll } from './db';
import { wipeFairCheckpoints } from './fair';
import { packStorage } from './storage';

// Removes everything the launcher stored on this device: sealed records, asset packs,
// fair checkpoints, the vault, the proctor session, and device-local selections. The device id is kept so
// runs synced earlier remain attributable to the same device.
export async function wipeDevice() {
  await wipeAll();
  await wipeFairCheckpoints();
  await packStorage.wipe();
  sessionStorage.clear();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('levante-offline:') && key !== 'levante-offline:device-id') localStorage.removeItem(key);
  }
}
