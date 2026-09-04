// WebCrypto primitives for the device vault: a proctor PIN is stretched with PBKDF2 into an
// AES-GCM key that seals the personally identifiable and performance data the launcher keeps
// on a shared tablet (roster, run attribution, trial data).

const PBKDF2_ITERATIONS = 310_000;
const KEY_LENGTH = 256;

export type Bytes = Uint8Array<ArrayBuffer>;

export interface SealedBox {
  /** base64 96-bit IV */
  iv: string;
  /** base64 AES-GCM ciphertext (includes the auth tag) */
  ct: string;
}

export function randomBytes(length: number): Bytes {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function deriveKey(pin: string, salt: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encodeText(pin.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export async function importKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(raw), { name: 'AES-GCM', length: KEY_LENGTH }, true, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, value: unknown): Promise<SealedBox> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodeText(JSON.stringify(value)));
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function open<T>(key: CryptoKey, box: SealedBox): Promise<T> {
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, key, fromBase64(box.ct));
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeText(text: string): Bytes {
  const encoded = new TextEncoder().encode(text);
  const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copy.set(encoded);
  return copy;
}
