const DEVICE_KEY = 'levante-offline:device-id';
const CHILD_KEY = 'levante-offline:selected-child';

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev_${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// Only the child's opaque local id is kept outside the vault; the roster entry itself is
// resolved from the (sealed) pack when needed.
export function getSelectedChildId(): string | null {
  return localStorage.getItem(CHILD_KEY);
}

export function setSelectedChildId(localId: string | null) {
  if (localId) localStorage.setItem(CHILD_KEY, localId);
  else localStorage.removeItem(CHILD_KEY);
}
