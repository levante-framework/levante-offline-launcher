<template>
  <div class="page">
    <h1>Provision this device</h1>
    <p class="muted">
      While online, sign in as the site's proctor, pick an administration and the school or cohort this
      device will serve, and download everything the device needs to assess those children offline:
      roster, task settings, and stimuli.
    </p>
    <div class="row">
      <a href="#/"><button type="button">← Roster</button></a>
      <a href="#/sync"><button type="button">Sync &amp; export</button></a>
    </div>

    <div v-if="!backendConfigured" class="error" style="margin-top: 12px">
      This build has no backend configured (VITE_FUNCTIONS_BASE / VITE_AUTH_SIGNIN_URL).
    </div>

    <div class="card">
      <h2 style="margin-top: 0">1 · Device PIN</h2>
      <p v-if="hasVault" class="muted" style="margin: 0">
        A vault exists on this device; rosters, runs and trials are sealed with its PIN.
      </p>
      <template v-else>
        <p class="muted" style="margin-top: 0">
          Choose a 4–12 digit PIN. Everything the device stores about children is encrypted with it, and it is
          required to unlock the app. It cannot be recovered — without it the device must be wiped.
        </p>
        <form class="row" @submit.prevent="createPin">
          <input v-model="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="PIN" autocomplete="off" required />
          <input v-model="pinConfirm" name="pinConfirm" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="confirm PIN" autocomplete="off" required />
          <button type="submit" class="primary" :disabled="busy">Set PIN</button>
        </form>
      </template>
    </div>

    <div class="card">
      <h2 style="margin-top: 0">2 · Proctor sign-in</h2>
      <div v-if="session" class="row">
        <span>Signed in as <strong>{{ session.email }}</strong></span>
        <button type="button" @click="doSignOut">Sign out</button>
      </div>
      <form v-else class="row" @submit.prevent="doSignIn">
        <input v-model="email" type="email" placeholder="proctor email" autocomplete="username" required />
        <input v-model="password" type="password" placeholder="password" autocomplete="current-password" required />
        <button type="submit" class="primary" :disabled="!online || busy">Sign in</button>
      </form>
    </div>

    <div class="card" v-if="session">
      <h2 style="margin-top: 0">3 · Choose an administration</h2>
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

    <div class="card" v-if="session && selectedId">
      <h2 style="margin-top: 0">4 · Which children?</h2>
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
import { computed, onMounted, ref } from 'vue';
import { backendConfigured, callFunction, getSession, type ProctorSession, signIn, signOut } from '../offline/auth';
import { logError, logInfo } from '../offline/sentry';
import { listPacks, putPack } from '../offline/db';
import { deviceInfo } from '../offline/device';
import { deletePack, type DownloadProgress, downloadPack, getActivePackId, markPackError, setActivePackId } from '../offline/packStore';
import type { PackRecord, PackScope, PackTaskConfig, RosterEntry } from '../offline/types';
import { createVault, vaultExists } from '../offline/vault';

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

const session = ref<ProctorSession | null>(getSession());
const email = ref('');
const password = ref('');
const hasVault = ref(vaultExists());
const pin = ref('');
const pinConfirm = ref('');
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
    hasVault.value &&
    online.value &&
    !busy.value &&
    scopesLoaded.value &&
    (scopes.value.length === 0 || selectedScope.value !== null),
);

onMounted(() => {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
  void refreshPacks();
});

async function refreshPacks() {
  packs.value = await listPacks();
  activeId.value = getActivePackId();
}

async function createPin() {
  error.value = '';
  if (pin.value !== pinConfirm.value) {
    error.value = 'The PINs do not match.';
    return;
  }
  busy.value = true;
  try {
    await createVault(pin.value);
    hasVault.value = true;
    pin.value = '';
    pinConfirm.value = '';
    message.value = 'Device PIN set; this device is now sealed.';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
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
      restrictToOpenAdministrations: true,
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
input {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  min-width: 200px;
}
</style>
