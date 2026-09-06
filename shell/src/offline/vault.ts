import { deriveKey, exportKey, fromBase64, importKey, open, randomBytes, seal, type SealedBox, toBase64 } from './crypto';

// Device vault lifecycle.
//
// Science-fair (default) uses ensureOpenVault(): a random key stored on the device, no PIN.
// Staff screens are gated by child mode plus researcher login for provision/sync.
// PIN-sealed vaults remain for tablets that already have one, and for later full-site work.
// After an unlock the raw key also lives in sessionStorage so the app survives the reload
// core-tasks needs between tasks.

const SALT_KEY = 'levante-offline:vault-salt';
const CHECK_KEY = 'levante-offline:vault-check';
const SESSION_KEY = 'levante-offline:vault-key';
const OPEN_KEY = 'levante-offline:vault-open-key';
const CHECK_VALUE = 'levante-offline-vault-v1';

let cachedKey: CryptoKey | null = null;

/** PIN-sealed vault from an earlier provision. Science-fair (default) does not create these. */
export function pinProtected(): boolean {
  return !!localStorage.getItem(SALT_KEY);
}

export function vaultExists(): boolean {
  return pinProtected() || !!localStorage.getItem(OPEN_KEY);
}

export function isUnlocked(): boolean {
  return cachedKey !== null || !!sessionStorage.getItem(SESSION_KEY) || !!localStorage.getItem(OPEN_KEY);
}

/** Science-fair default: a device key with no PIN, persisted so reloads stay unlocked. */
export async function ensureOpenVault(): Promise<void> {
  if (pinProtected()) return;
  const existing = localStorage.getItem(OPEN_KEY);
  if (existing) {
    cachedKey = await importKey(existing);
    sessionStorage.setItem(SESSION_KEY, existing);
    return;
  }
  const raw = toBase64(randomBytes(32));
  localStorage.setItem(OPEN_KEY, raw);
  cachedKey = await importKey(raw);
  sessionStorage.setItem(SESSION_KEY, raw);
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
  const raw = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(OPEN_KEY);
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
    super('The device vault is locked. Enter the device PIN.');
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
