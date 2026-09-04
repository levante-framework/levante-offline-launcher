// Child (kiosk) mode: the roster and tasks only — no sync, provisioning or lock controls —
// until a proctor enters the device PIN. Survives reloads (core-tasks reloads between tasks)
// and relaunches; the PIN is what gates leaving it, not the flag itself.
const MODE_KEY = 'levante-offline:child-mode';

export function isChildMode(): boolean {
  return localStorage.getItem(MODE_KEY) === '1';
}

export function setChildMode(on: boolean) {
  if (on) localStorage.setItem(MODE_KEY, '1');
  else localStorage.removeItem(MODE_KEY);
}
