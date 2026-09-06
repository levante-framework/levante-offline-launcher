// Proctor session + Firebase callable client.
//
// The On-site Researcher signs in only for the online phases — provisioning and
// sync. Password uses the Identity Toolkit REST API. Google uses Firebase Auth
// (popup, then redirect if the tablet blocks popups). Callables use
// POST { data } → { result } | { error }.

import { clearProctor, logError, logInfo, setProctor } from './sentry';

const FUNCTIONS_BASE = (import.meta.env.VITE_FUNCTIONS_BASE as string | undefined)?.replace(/\/+$/, '');
const SIGNIN_ENDPOINT = import.meta.env.VITE_AUTH_SIGNIN_URL as string | undefined;
const FIREBASE_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
const FIREBASE_AUTH_DOMAIN = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
const SESSION_KEY = 'levante-offline:proctor';
const RETURN_HASH_KEY = 'levante-offline:google-return-hash';

export const backendConfigured = Boolean(FUNCTIONS_BASE && SIGNIN_ENDPOINT);
export const googleAuthConfigured = Boolean(
  backendConfigured && FIREBASE_API_KEY && FIREBASE_AUTH_DOMAIN && FIREBASE_PROJECT_ID,
);

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
    if (session.expiresAtMs <= Date.now() + 30_000) return null;
    setProctor(session.uid);
    return session;
  } catch {
    return null;
  }
}

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
  clearProctor();
  void firebaseSignOut();
}

export async function signIn(email: string, password: string): Promise<ProctorSession> {
  if (!SIGNIN_ENDPOINT) throw new Error('This build has no backend configured (VITE_AUTH_SIGNIN_URL).');
  try {
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
    storeSession(session);
    logInfo('proctor signed in');
    return finalizeResearcherSession();
  } catch (err) {
    logError('proctor sign-in failed', err);
    throw err;
  }
}

type AuthMod = typeof import('firebase/auth');

let authReady: Promise<{ auth: import('firebase/auth').Auth; authMod: AuthMod }> | null = null;

async function getFirebaseAuth() {
  if (!googleAuthConfigured) {
    throw new Error('Google sign-in is not configured on this build.');
  }
  if (!authReady) {
    authReady = (async () => {
      const [{ initializeApp, getApps, getApp }, authMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ]);
      const app = getApps().length
        ? getApp()
        : initializeApp({
            apiKey: FIREBASE_API_KEY,
            authDomain: FIREBASE_AUTH_DOMAIN,
            projectId: FIREBASE_PROJECT_ID,
          });
      const auth = authMod.getAuth(app);
      await authMod.setPersistence(auth, authMod.browserSessionPersistence);
      return { auth, authMod };
    })();
  }
  return authReady;
}

function storeSession(session: ProctorSession): ProctorSession {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  setProctor(session.uid);
  return session;
}

/** Same post-login step as the dashboard firekit: write userClaims.adminUid, then refresh the ID token. */
async function finalizeResearcherSession(): Promise<ProctorSession> {
  try {
    await callFunction('setUidClaims', {});
  } catch (err) {
    logError('setUidClaims failed', err);
    throw new Error(
      'This Google account is not a LEVANTE researcher on this project. Sign in on the dashboard once first, then try again.',
    );
  }
  if (authReady) {
    try {
      const { auth } = await authReady;
      if (auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken(true);
        const current = getSession();
        if (current) {
          return storeSession({ ...current, idToken, expiresAtMs: Date.now() + 3600_000 });
        }
      }
    } catch (err) {
      logError('id token refresh failed', err);
    }
  }
  const session = getSession();
  if (!session) throw new Error('Not signed in.');
  return session;
}

async function sessionFromUser(user: import('firebase/auth').User): Promise<ProctorSession> {
  const idToken = await user.getIdToken();
  return storeSession({
    email: user.email ?? '',
    uid: user.uid,
    idToken,
    expiresAtMs: Date.now() + 3600_000,
  });
}

function googleSignInError(err: unknown): Error {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return new Error('Google sign-in was cancelled.');
  }
  if (code === 'auth/unauthorized-domain') {
    return new Error('This site is not allowed for Google sign-in yet.');
  }
  if (code === 'auth/user-disabled') {
    return new Error('This Google account is disabled in LEVANTE.');
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Finish a Google redirect that came back to this page. Restores the pack-link hash if the redirect dropped it. */
export async function consumeGoogleRedirect(): Promise<ProctorSession | null> {
  if (!googleAuthConfigured) return null;
  if (!sessionStorage.getItem(RETURN_HASH_KEY)) return null;
  try {
    const { auth, authMod } = await getFirebaseAuth();
    const result = await authMod.getRedirectResult(auth);
    const savedHash = sessionStorage.getItem(RETURN_HASH_KEY);
    if (savedHash) {
      sessionStorage.removeItem(RETURN_HASH_KEY);
      if (savedHash !== window.location.hash) window.location.hash = savedHash;
    }
    if (!result?.user) return null;
    await sessionFromUser(result.user);
    logInfo('proctor signed in with Google');
    return finalizeResearcherSession();
  } catch (err) {
    logError('proctor Google redirect failed', err);
    throw googleSignInError(err);
  }
}

export async function signInWithGoogle(): Promise<ProctorSession> {
  if (!googleAuthConfigured) throw new Error('Google sign-in is not configured on this build.');
  try {
    const { auth, authMod } = await getFirebaseAuth();
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const cred = await authMod.signInWithPopup(auth, provider);
      await sessionFromUser(cred.user);
      logInfo('proctor signed in with Google');
      return finalizeResearcherSession();
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
      if (code !== 'auth/popup-blocked' && code !== 'auth/operation-not-supported-in-this-environment') {
        throw err;
      }
      sessionStorage.setItem(RETURN_HASH_KEY, window.location.hash);
      await authMod.signInWithRedirect(auth, provider);
      throw new Error('Redirecting to Google…');
    }
  } catch (err) {
    logError('proctor Google sign-in failed', err);
    throw googleSignInError(err);
  }
}

async function firebaseSignOut() {
  if (!authReady) return;
  try {
    const { auth, authMod } = await authReady;
    await authMod.signOut(auth);
  } catch {
    // Session is already cleared locally.
  }
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
