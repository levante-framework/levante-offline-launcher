import { deriveKey, exportKey, fromBase64, importKey, open, randomBytes, seal, type SealedBox, toBase64 } from './crypto';

// Device vault lifecycle.
//
// Threat model: a shared tablet that leaves the site's custody (lost, stolen, borrowed)
// must not yield children's names, birth dates, or assessment data to whoever holds it.
// The proctor sets a PIN when provisioning; the PIN never leaves the device. Everything
// sensitive in IndexedDB is sealed with a key derived from it. After an unlock the raw
// key lives in sessionStorage so the app survives the reload core-tasks needs between
// tasks; closing the app (or "Lock") drops it. This is not a substitute for OS-level
// device encryption and MDM; it is defence in depth for the data the app itself holds.

const SALT_KEY = 'levante-offline:vault-salt';
const CHECK_KEY = 'levante-offline:vault-check';
const SESSION_KEY = 'levante-offline:vault-key';
const CHECK_VALUE = 'levante-offline-vault-v1';

let cachedKey: CryptoKey | null = null;

export function vaultExists(): boolean {
  return !!localStorage.getItem(SALT_KEY);
}

export function isUnlocked(): boolean {
  return cachedKey !== null || !!sessionStorage.getItem(SESSION_KEY);
}

/** Creates the vault with a fresh salt; wipes nothing else, so call only on a fresh device. */
export async function createVault(pin: string): Promise<void> {
  validatePin(pin);
  const salt = randomBytes(16);
  const key = await deriveKey(pin, salt);
  localStorage.setItem(SALT_KEY, toBase64(salt));
  localStorage.setItem(CHECK_KEY, JSON.stringify(await seal(key, CHECK_VALUE)));
  await remember(key);
}

export async function unlock(pin: string): Promise<void> {
  const salt = localStorage.getItem(SALT_KEY);
  const check = localStorage.getItem(CHECK_KEY);
  if (!salt || !check) throw new Error('This device has no vault yet.');
  const key = await deriveKey(pin, fromBase64(salt));
  try {
    const value = await open<string>(key, JSON.parse(check) as SealedBox);
    if (value !== CHECK_VALUE) throw new Error('bad check');
  } catch {
    throw new Error('Wrong PIN.');
  }
  await remember(key);
}

export function lock(): void {
  cachedKey = null;
  sessionStorage.removeItem(SESSION_KEY);
}

/** The unlocked key, or a "locked" error the UI turns into the lock screen. */
export async function requireKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) throw new VaultLockedError();
  cachedKey = await importKey(raw);
  return cachedKey;
}

export async function sealValue(value: unknown): Promise<SealedBox> {
  return seal(await requireKey(), value);
}

export async function openValue<T>(box: SealedBox): Promise<T> {
  return open<T>(await requireKey(), box);
}

export class VaultLockedError extends Error {
  constructor() {
    super('The device vault is locked. Enter the proctor PIN.');
    this.name = 'VaultLockedError';
  }
}

function validatePin(pin: string) {
  if (!/^\d{4,12}$/.test(pin)) throw new Error('PIN must be 4–12 digits.');
}

async function remember(key: CryptoKey) {
  cachedKey = key;
  sessionStorage.setItem(SESSION_KEY, await exportKey(key));
}
