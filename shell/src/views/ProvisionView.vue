<template>
  <div class="page">
    <h1>2 · Provision</h1>
    <p class="muted">
      Pick a pack for the site chosen in step 1 — each pack is one assignment and the children in
      one cohort, classroom, or school.
    </p>
    <StaffNav current="provision" />

    <div v-if="!backendConfigured" class="error" style="margin-top: 12px">
      This build has no backend configured (VITE_FUNCTIONS_BASE / VITE_AUTH_SIGNIN_URL).
    </div>

    <div class="card" v-if="session && selectedSiteId">
      <h2 style="margin-top: 0">Packs for this site</h2>
      <p class="muted" style="margin-top: 0">
        Site: <strong>{{ currentSiteLabel }}</strong>
        · <a href="#/site">change site</a>
      </p>
      <div v-if="splash && session" class="spinner-overlay" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true" />
        <p class="muted">{{ splash }}</p>
      </div>
      <div class="child-list" v-else-if="preparedPacks.length">
        <button
          v-for="p in preparedPacks"
          :key="p.packId"
          class="child"
          :class="{ selected: selectedPreparedId === p.packId }"
          type="button"
          @click="selectPrepared(p)"
        >
          <div><strong>{{ p.assignmentName }}</strong></div>
          <div class="muted">{{ p.orgName }} · {{ p.orgType }}</div>
        </button>
      </div>
      <p v-else-if="selectedSiteId" class="notice">
        No assignments with a cohort, classroom, or school were found on this site.
      </p>
      <p v-else class="notice">This account has no site assignments to provision.</p>
      <div class="row" style="margin-top: 12px" v-if="selectedPreparedId">
        <button type="button" class="primary big" :disabled="!canProvision" @click="provision">
          {{ busy && progress ? 'Downloading…' : 'Download pack' }}
        </button>
      </div>
      <div v-if="progress && selectedPreparedId" class="muted" style="margin-top: 10px">
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
import StaffNav from '../components/StaffNav.vue';
import { backendConfigured, callFunction, getSession, type ProctorSession } from '../offline/auth';
import { logError, logInfo } from '../offline/sentry';
import { listPacks, putPack } from '../offline/db';
import { deviceInfo } from '../offline/device';
import { deletePack, type DownloadProgress, downloadPack, getActivePackId, markPackError, setActivePackId } from '../offline/packStore';
import {
  getSelectedSite,
  loadSiteCatalog,
  readPackLink,
  type AdministrationSummary,
} from '../offline/site';
import type { PackRecord, PackScope, PackTaskConfig, RosterEntry } from '../offline/types';
import { ensureOpenVault } from '../offline/vault';

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

interface PreparedPack {
  packId: string;
  administrationId: string;
  assignmentName: string;
  orgType: PackScope['orgType'];
  orgId: string;
  orgName: string;
  siteId: string;
  siteName: string;
}

const eventLink = ref(readPackLink());
const eventApplying = ref(false);
const preparedPacks = ref<PreparedPack[]>([]);
const preparedLoading = ref(false);
const selectedPreparedId = ref<string | null>(null);
const selectedSite = getSelectedSite();
const selectedSiteId = ref<string | null>(selectedSite?.id ?? null);
const currentSiteLabel = computed(() => selectedSite?.name || selectedSiteId.value || '');

const session = ref<ProctorSession | null>(getSession());
const administrations = ref<AdministrationSummary[]>([]);
const selectedId = ref<string | null>(null);
const scopes = ref<PackScope[]>([]);
const selectedScope = ref<PackScope | null>(null);
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

const splash = computed(() => {
  if (progress.value) return '';
  if (preparedLoading.value || eventApplying.value) return 'Loading packs for this site…';
  return '';
});

onMounted(() => {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
  void ensureOpenVault();
  void refreshPacks();
  if (!getSession() || !getSelectedSite()) {
    window.location.hash = '#/site';
  }
});

watch(
  session,
  async (value) => {
    if (!value || !selectedSiteId.value) return;
    await refreshSiteCatalog();
    if (eventLink.value) applyEventLink();
  },
  { immediate: true },
);

function applyEventLink() {
  const ev = eventLink.value;
  if (!ev) return;
  const match = preparedPacks.value.find(
    (item) =>
      item.administrationId === ev.admin &&
      (!ev.orgId || (item.orgType === ev.orgType && item.orgId === ev.orgId)),
  );
  if (match) selectPrepared(match);
}

async function refreshPacks() {
  packs.value = await listPacks();
  activeId.value = getActivePackId();
}

function selectPrepared(pack: PreparedPack) {
  selectedPreparedId.value = pack.packId;
  selectedId.value = pack.administrationId;
  selectedScope.value = {
    orgType: pack.orgType,
    orgId: pack.orgId,
    name: pack.orgName,
    siteId: pack.siteId,
  };
  scopesLoaded.value = true;
}

async function refreshSiteCatalog() {
  error.value = '';
  preparedLoading.value = true;
  try {
    const catalog = await loadSiteCatalog();
    administrations.value = catalog.administrations;
    await loadPacksForSite();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    logError('getAdministrations failed', err);
  } finally {
    preparedLoading.value = false;
  }
}

async function loadPacksForSite() {
  const siteId = selectedSiteId.value;
  preparedPacks.value = [];
  if (!siteId) return;
  eventApplying.value = true;
  try {
    const siteAdmins = administrations.value.filter((item) => item.districts.includes(siteId));
    const groups = await Promise.all(
      siteAdmins.map(async (admin) => {
        try {
          const res = await callFunction<{ status: string; scopes: PackScope[] }>('listOfflineScopes', {
            administrationId: admin.id,
          });
          return (res.scopes ?? [])
            .filter((scope) => !scope.siteId || scope.siteId === siteId)
            .map((scope) => ({
              packId: `${admin.id}_${scope.orgType}_${scope.orgId}`,
              administrationId: admin.id,
              assignmentName: admin.name,
              orgType: scope.orgType,
              orgId: scope.orgId,
              orgName: scope.name,
              siteId: scope.siteId || siteId,
              siteName: currentSiteLabel.value || siteId,
            }));
        } catch (err) {
          logError('listOfflineScopes failed', err, { administrationId: admin.id });
          return [] as PreparedPack[];
        }
      }),
    );
    preparedPacks.value = groups.flat().sort((a, b) => {
      return a.assignmentName.localeCompare(b.assignmentName) || a.orgName.localeCompare(b.orgName);
    });
  } finally {
    eventApplying.value = false;
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
</script>
