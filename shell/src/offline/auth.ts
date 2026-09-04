// Proctor session + Firebase callable client.
//
// The proctor (a site account) signs in only for the online phases — provisioning and
// sync — through the Identity Toolkit REST API (no Firebase SDK needed). Callables use
// the callable wire protocol: POST { data } → { result } | { error }.

const FUNCTIONS_BASE = (import.meta.env.VITE_FUNCTIONS_BASE as string | undefined)?.replace(/\/+$/, '');
const SIGNIN_ENDPOINT = import.meta.env.VITE_AUTH_SIGNIN_URL as string | undefined;
const SESSION_KEY = 'levante-offline:proctor';

export const backendConfigured = Boolean(FUNCTIONS_BASE && SIGNIN_ENDPOINT);

export interface ProctorSession {
  email: string;
  uid: string;
  idToken: string;
  expiresAtMs: number;
}

export function getSession(): ProctorSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as ProctorSession;
    return session.expiresAtMs > Date.now() + 30_000 ? session : null;
  } catch {
    return null;
  }
}

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function signIn(email: string, password: string): Promise<ProctorSession> {
  if (!SIGNIN_ENDPOINT) throw new Error('This build has no backend configured (VITE_AUTH_SIGNIN_URL).');
  const res = await fetch(SIGNIN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    idToken?: string;
    localId?: string;
    expiresIn?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.idToken || !body.localId) {
    throw new Error(`Sign-in failed: ${body.error?.message ?? res.status}`);
  }
  const session: ProctorSession = {
    email,
    uid: body.localId,
    idToken: body.idToken,
    expiresAtMs: Date.now() + Number(body.expiresIn ?? 3600) * 1000,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function callFunction<T>(name: string, data: unknown): Promise<T> {
  if (!FUNCTIONS_BASE) throw new Error('This build has no backend configured (VITE_FUNCTIONS_BASE).');
  const session = getSession();
  if (!session) throw new Error('Not signed in.');
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { message?: string; status?: string } };
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ? `${name}: ${body.error.message}` : `${name}: HTTP ${res.status}`);
  }
  return body.result as T;
}
