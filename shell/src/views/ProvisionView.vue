<template>
  <div class="page">
    <h1>Provision this device</h1>
    <p class="muted">
      While online, sign in as the site's On-site Researcher. If you opened a science-fair pack link, this
      page already knows the assignment and cohort — sign in and download. Otherwise, pick them below.
    </p>
    <div class="row">
      <a href="#/"><button type="button">← Roster</button></a>
      <a href="#/sync"><button type="button">Sync &amp; export</button></a>
      <a href="#/fair"><button type="button">Science fair</button></a>
    </div>

    <div v-if="!backendConfigured" class="error" style="margin-top: 12px">
      This build has no backend configured (VITE_FUNCTIONS_BASE / VITE_AUTH_SIGNIN_URL).
    </div>

    <div class="card">
      <h2 style="margin-top: 0">1 · On-site Researcher sign-in</h2>
      <p class="muted" style="margin-top: 0">
        Use Google if that is how you sign in to the dashboard. Email and password still works.
        Science-fair tablets do not use a device PIN.
      </p>
      <div v-if="session" class="row">
        <span>Signed in as <strong>{{ session.email }}</strong></span>
        <button type="button" @click="doSignOut">Sign out</button>
      </div>
      <div v-else class="sign-in-stack">
        <button
          v-if="googleAuthConfigured"
          type="button"
          class="google-btn"
          :disabled="!online || busy"
          @click="doGoogleSignIn"
        >
          Continue with Google
        </button>
        <p v-if="googleAuthConfigured" class="muted sign-in-or">or use email and password</p>
        <form class="row" @submit.prevent="doSignIn">
          <input v-model="email" type="email" placeholder="researcher email" autocomplete="username" required />
          <input v-model="password" type="password" placeholder="password" autocomplete="current-password" required />
          <button type="submit" :disabled="!online || busy">Sign in</button>
        </form>
      </div>
    </div>

    <div class="card" v-if="session && eventLink">
      <h2 style="margin-top: 0">2 · Download this event</h2>
      <p class="muted" style="margin-top: 0">
        This link is for <strong>{{ eventAdminName || 'the assignment from the wizard' }}</strong>
        <span v-if="eventScopeName"> · {{ eventScopeName }}</span>.
      </p>
      <p v-if="eventApplying" class="muted">Looking up that assignment…</p>
      <div class="row" style="margin-top: 12px">
        <button type="button" class="primary big" :disabled="!canProvision" @click="provision">
          {{ busy && progress ? 'Downloading…' : 'Download pack' }}
        </button>
      </div>
      <div v-if="progress" class="muted" style="margin-top: 10px">
        {{ progress.filesDone }} / {{ progress.fileCount || '?' }} files · {{ (progress.bytes / 1e6).toFixed(1) }} MB
        <span class="mono">{{ progress.current }}</span>
      </div>
    </div>

    <div class="card" v-if="session && !eventLink">
      <h2 style="margin-top: 0">2 · Choose an administration</h2>
      <div class="row">
        <button type="button" @click="loadAdministrations" :disabled="busy || !online">
          {{ administrations.length ? 'Reload administrations' : 'Load my administrations' }}
        </button>
      </div>
      <div class="child-list" style="margin-top: 12px" v-if="administrations.length">
        <button
          v-for="a in administrations"
          :key="a.id"
          class="child"
          :class="{ selected: selectedId === a.id }"
          type="button"
          @click="selectAdministration(a.id)"
        >
          <div><strong>{{ a.name }}</strong></div>
          <div class="muted mono">{{ a.id }}</div>
          <div class="muted">{{ a.tasks.join(', ') || 'no tasks' }}<span v-if="a.dateClosed"> · closes {{ a.dateClosed }}</span></div>
        </button>
      </div>
    </div>

    <div class="card" v-if="session && selectedId && !eventLink">
      <h2 style="margin-top: 0">3 · Which children?</h2>
      <p class="muted" style="margin-top: 0">
        A device serves one school or one cohort. Its roster is the children of that group who hold an
        assignment for the administration, with what they have already completed.
      </p>
      <p v-if="scopesLoading" class="muted">Loading schools and cohorts…</p>
      <template v-else-if="scopes.length">
        <div class="child-list">
          <button
            v-for="s in scopes"
            :key="s.orgType + s.orgId"
            class="child scope"
            :class="{ selected: selectedScope?.orgId === s.orgId && selectedScope?.orgType === s.orgType }"
            type="button"
            @click="selectedScope = s"
          >
            <div><strong>{{ s.name }}</strong></div>
            <div class="muted">{{ s.orgType }}</div>
          </button>
        </div>
      </template>
      <p v-else-if="scopesLoaded" class="notice">
        This administration has no schools or cohorts to scope to; the device will hold the whole site.
      </p>
      <div class="row" style="margin-top: 12px">
        <button type="button" class="primary big" :disabled="!canProvision" @click="provision">
          {{ busy && progress ? 'Downloading…' : 'Provision this device' }}
        </button>
      </div>
      <div v-if="progress" class="muted" style="margin-top: 10px">
        {{ progress.filesDone }} / {{ progress.fileCount || '?' }} files · {{ (progress.bytes / 1e6).toFixed(1) }} MB
        <span class="mono">{{ progress.current }}</span>
      </div>
    </div>

    <div v-if="message" class="notice" style="margin-top: 12px">{{ message }}</div>
    <div v-if="error" class="error" style="margin-top: 12px">{{ error }}</div>

    <div class="card">
      <h2 style="margin-top: 0">Packs on this device</h2>
      <table v-if="packs.length">
        <thead>
          <tr><th>Administration</th><th>Scope</th><th>Locale</th><th>Children</th><th>Tasks</th><th>Files</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in packs" :key="p.packId">
            <td>
              <strong>{{ p.name }}</strong><br />
              <span class="muted mono">{{ p.packId }}</span>
              <span v-if="p.packId === activeId" class="pill info" style="margin-left: 6px">active</span>
            </td>
            <td>{{ scopeLabel(p) }}</td>
            <td>{{ p.locale }}</td>
            <td>{{ p.children.length }}</td>
            <td>{{ p.tasks.map((t) => t.taskId).join(', ') }}</td>
            <td>{{ p.filesDone }}/{{ p.fileCount }} · {{ (p.totalBytes / 1e6).toFixed(1) }} MB</td>
            <td>
              <span class="pill" :class="{ ok: p.status === 'ready', warn: p.status === 'downloading', bad: p.status === 'error' }">{{ p.status }}</span>
              <div v-if="p.error" class="muted">{{ p.error }}</div>
            </td>
            <td class="row">
              <button type="button" @click="activate(p.packId)" :disabled="p.status !== 'ready' || p.packId === activeId">Use</button>
              <button type="button" @click="remove(p.packId)" :disabled="busy">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">No packs yet.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  backendConfigured,
  callFunction,
  getSession,
  googleAuthConfigured,
  type ProctorSession,
  signIn,
  signInWithGoogle,
  signOut,
} from '../offline/auth';
import { logError, logInfo } from '../offline/sentry';
import { listPacks, putPack } from '../offline/db';
import { deviceInfo } from '../offline/device';
import { deletePack, type DownloadProgress, downloadPack, getActivePackId, markPackError, setActivePackId } from '../offline/packStore';
import type { PackRecord, PackScope, PackTaskConfig, RosterEntry } from '../offline/types';
import { ensureOpenVault } from '../offline/vault';

interface AdministrationSummary {
  id: string;
  name: string;
  dateClosed: string | null;
  tasks: string[];
}

interface ProvisionResult {
  status: string;
  pack: {
    packId: string;
    administrationId: string;
    name: string;
    siteId: string | null;
    scope: PackScope | null;
    locale: string;
    dateClosed: string | null;
    tasks: PackTaskConfig[];
    children: RosterEntry[];
    serverNowMs: number;
  };
}

function readEventLink() {
  const hash = window.location.hash;
  if (!hash.startsWith('#/provision')) return null;
  const qStart = hash.indexOf('?');
  if (qStart < 0) return null;
  const query = new URLSearchParams(hash.slice(qStart));
  const admin = query.get('admin');
  if (!admin) return null;
  const orgType = query.get('orgType');
  const orgId = query.get('orgId');
  return {
    admin,
    orgType: orgType === 'school' || orgType === 'cohort' ? orgType : null,
    orgId,
  };
}

const eventLink = ref(readEventLink());
const eventApplying = ref(false);
const eventAdminName = computed(
  () => administrations.value.find((item) => item.id === eventLink.value?.admin)?.name ?? '',
);
const eventScopeName = computed(() => selectedScope.value?.name ?? '');

const session = ref<ProctorSession | null>(getSession());
const email = ref('');
const password = ref('');
const administrations = ref<AdministrationSummary[]>([]);
const selectedId = ref<string | null>(null);
const scopes = ref<PackScope[]>([]);
const selectedScope = ref<PackScope | null>(null);
const scopesLoading = ref(false);
const scopesLoaded = ref(false);
const packs = ref<PackRecord[]>([]);
const activeId = ref<string | null>(getActivePackId());
const progress = ref<DownloadProgress | null>(null);
const busy = ref(false);
const message = ref('');
const error = ref('');
const online = ref(navigator.onLine);

const canProvision = computed(
  () =>
    !!selectedId.value &&
    online.value &&
    !busy.value &&
    scopesLoaded.value &&
    (scopes.value.length === 0 || selectedScope.value !== null),
);

onMounted(() => {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
  void ensureOpenVault();
  void refreshPacks();
});

watch(
  session,
  async (value) => {
    if (value && eventLink.value) await applyEventLink();
  },
  { immediate: true },
);

async function applyEventLink() {
  const ev = eventLink.value;
  if (!ev || !session.value) return;
  eventApplying.value = true;
  error.value = '';
  try {
    await loadAdministrations();
    if (!administrations.value.some((item) => item.id === ev.admin)) {
      error.value = 'This account cannot see that assignment. Sign in as a site admin for this event.';
      return;
    }
    await selectAdministration(ev.admin);
    if (ev.orgType && ev.orgId) {
      const scope = scopes.value.find((item) => item.orgType === ev.orgType && item.orgId === ev.orgId);
      if (!scope) {
        error.value = 'That cohort is not on this assignment. Add the cohort to the assignment, then open the link again.';
        return;
      }
      selectedScope.value = scope;
    }
  } finally {
    eventApplying.value = false;
  }
}

async function refreshPacks() {
  packs.value = await listPacks();
  activeId.value = getActivePackId();
}

async function doSignIn() {
  error.value = '';
  busy.value = true;
  try {
    session.value = await signIn(email.value, password.value);
    password.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function doGoogleSignIn() {
  error.value = '';
  busy.value = true;
  try {
    session.value = await signInWithGoogle();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function doSignOut() {
  signOut();
  session.value = null;
  administrations.value = [];
  selectedId.value = null;
  scopes.value = [];
  selectedScope.value = null;
  scopesLoaded.value = false;
}

async function loadAdministrations() {
  error.value = '';
  message.value = '';
  busy.value = true;
  try {
    const res = await callFunction<{ status: string; data: Array<Record<string, unknown>> }>('getAdministrations', {
      idsOnly: false,
    });
    administrations.value = (res.data ?? []).map((a) => ({
      id: String(a.id),
      name: String(a.publicName ?? a.name ?? a.id),
      dateClosed: toDateString(a.dateClosed),
      tasks: Array.isArray(a.assessments) ? a.assessments.map((x: { taskId?: string }) => String(x.taskId)) : [],
    }));
    if (!administrations.value.length) message.value = 'No open administrations are visible to this account.';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    logError('getAdministrations failed', err);
  } finally {
    busy.value = false;
  }
}

async function selectAdministration(id: string) {
  selectedId.value = id;
  selectedScope.value = null;
  scopes.value = [];
  scopesLoaded.value = false;
  scopesLoading.value = true;
  error.value = '';
  try {
    const res = await callFunction<{ status: string; scopes: PackScope[] }>('listOfflineScopes', { administrationId: id });
    scopes.value = res.scopes ?? [];
    scopesLoaded.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    logError('listOfflineScopes failed', err, { administrationId: id });
  } finally {
    scopesLoading.value = false;
  }
}

async function provision() {
  if (!selectedId.value || !session.value) return;
  error.value = '';
  message.value = '';
  busy.value = true;
  progress.value = { filesDone: 0, fileCount: 0, bytes: 0, current: 'asking the server for the roster…' };
  let packId: string | null = null;
  try {
    const res = await callFunction<ProvisionResult>('provisionOfflinePack', {
      administrationId: selectedId.value,
      scope: selectedScope.value ? { orgType: selectedScope.value.orgType, orgId: selectedScope.value.orgId } : null,
      device: deviceInfo(),
    });
    const p = res.pack;
    packId = p.packId;
    const record: PackRecord = {
      ...p,
      deviceNowMs: Date.now(),
      provisionedAt: new Date().toISOString(),
      provisionedBy: session.value.email,
      status: 'downloading',
      error: null,
      fileCount: 0,
      filesDone: 0,
      totalBytes: 0,
      corpora: {},
    };
    await putPack(record);
    await refreshPacks();
    logInfo('provision download started', {
      packId: p.packId,
      administrationId: p.administrationId,
      children: p.children.length,
      tasks: p.tasks.length,
    });
    const done = await downloadPack(record, (prog) => (progress.value = prog));
    setActivePackId(done.packId);
    logInfo('provisioned', {
      packId: done.packId,
      administrationId: done.administrationId,
      children: done.children.length,
      tasks: done.tasks.length,
      files: done.fileCount,
    });
    message.value = `Provisioned "${done.name}" for ${scopeLabel(done)}: ${done.children.length} children, ${done.tasks.length} tasks, ${done.fileCount} files (${(done.totalBytes / 1e6).toFixed(1)} MB). This device can now assess offline.`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    logError('provision failed', err, { administrationId: selectedId.value ?? '', packId: packId ?? '' });
    if (packId) await markPackError(packId, err);
  } finally {
    busy.value = false;
    progress.value = null;
    await refreshPacks();
  }
}

function activate(packId: string) {
  setActivePackId(packId);
  activeId.value = packId;
}

async function remove(packId: string) {
  busy.value = true;
  try {
    await deletePack(packId);
  } finally {
    busy.value = false;
    await refreshPacks();
  }
}

function scopeLabel(p: { scope?: PackScope | null }) {
  return p.scope ? `${p.scope.orgType} ${p.scope.name}` : 'whole site';
}

function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const v = value as { _seconds?: number; seconds?: number };
  const secs = v._seconds ?? v.seconds;
  return typeof secs === 'number' ? new Date(secs * 1000).toISOString().slice(0, 10) : null;
}
</script>

<style scoped>
.sign-in-stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}
.sign-in-or {
  margin: 0;
}
input {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  min-width: 200px;
}
</style>
