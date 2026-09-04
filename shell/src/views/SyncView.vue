<template>
  <div class="page">
    <h1>Sync &amp; export</h1>
    <p class="muted">
      Device <span class="mono">{{ deviceId }}</span> · {{ runs.length }} run(s) stored locally ·
      {{ online ? 'online' : 'offline' }}
    </p>
    <div class="row">
      <a href="#/"><button type="button">← Roster</button></a>
      <a href="#/provision"><button type="button">Provision</button></a>
      <button type="button" @click="exportAll" :disabled="!runs.length">Download JSON export</button>
      <button type="button" @click="clearSynced" :disabled="!synced.length">Delete {{ synced.length }} synced</button>
    </div>

    <div class="card">
      <h2 style="margin-top: 0">Sync to server</h2>
      <p class="muted" v-if="!backendConfigured">This build has no backend configured; use the JSON export.</p>
      <template v-else>
        <div v-if="session" class="row">
          <span>Signed in as <strong>{{ session.email }}</strong></span>
          <button type="button" class="primary" @click="sync" :disabled="!online || !pending.length || syncing">
            {{ syncing ? 'Syncing…' : `Sync ${pending.length} pending run(s)` }}
          </button>
          <button type="button" @click="doSignOut">Sign out</button>
        </div>
        <form v-else class="row" @submit.prevent="signInAndSync">
          <input v-model="email" type="email" placeholder="proctor email" autocomplete="username" required />
          <input v-model="password" type="password" placeholder="password" autocomplete="current-password" required />
          <button type="submit" class="primary" :disabled="!online || !pending.length || syncing">
            {{ syncing ? 'Syncing…' : `Sign in & sync ${pending.length} pending run(s)` }}
          </button>
        </form>
      </template>
      <div v-if="message" class="notice" style="margin-top: 12px">{{ message }}</div>
      <div v-if="error" class="error" style="margin-top: 12px">{{ error }}</div>
    </div>

    <div class="card" style="overflow-x: auto">
      <table>
        <thead>
          <tr>
            <th>Child</th>
            <th>Task</th>
            <th>Started (device clock)</th>
            <th>Trials</th>
            <th>Status</th>
            <th>Sync</th>
            <th>Versions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in runs" :key="run.runId">
            <td>{{ run.child.assessmentPid || run.child.localId }}</td>
            <td>{{ run.taskId }}</td>
            <td class="mono">{{ run.timeStarted.slice(0, 19).replace('T', ' ') }}</td>
            <td>{{ run.trialCount }}</td>
            <td>
              <span v-if="run.aborted" class="pill bad">aborted</span>
              <span v-else-if="run.completed" class="pill ok">completed</span>
              <span v-else class="pill warn">incomplete</span>
              <span v-if="run.stopReason" class="muted"> · {{ run.stopReason }}</span>
            </td>
            <td>
              <span class="pill" :class="{ ok: run.syncState === 'synced', info: run.syncState === 'pending', bad: run.syncState === 'error' }">
                {{ run.syncState }}
              </span>
              <div v-if="run.syncError" class="muted">{{ run.syncError }}</div>
            </td>
            <td class="mono muted">
              core-tasks {{ run.taskVersion }}<br />
              pack {{ run.packId }}<br />
              app {{ run.appBuild }}
            </td>
          </tr>
          <tr v-if="!runs.length">
            <td colspan="7" class="muted">No runs stored on this device yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { backendConfigured, getSession, type ProctorSession, signIn, signOut } from '../offline/auth';
import { deleteRun, listRuns } from '../offline/db';
import { getDeviceId } from '../offline/device';
import { buildExportBundle, downloadJson } from '../offline/exportRuns';
import { syncPendingRuns } from '../offline/sync';
import type { OfflineRunRecord } from '../offline/types';

const runs = ref<OfflineRunRecord[]>([]);
const deviceId = getDeviceId();
const online = ref(navigator.onLine);
const syncing = ref(false);
const message = ref('');
const error = ref('');
const session = ref<ProctorSession | null>(getSession());
const email = ref('');
const password = ref('');

const pending = computed(() => runs.value.filter((r) => r.syncState !== 'synced'));
const synced = computed(() => runs.value.filter((r) => r.syncState === 'synced'));

async function refresh() {
  runs.value = await listRuns();
}

onMounted(() => {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
  void refresh();
});

async function exportAll() {
  const bundle = await buildExportBundle();
  downloadJson(`levante-offline-export-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`, bundle);
  message.value = `Exported ${bundle.runs.length} run(s).`;
}

async function signInAndSync() {
  error.value = '';
  try {
    session.value = await signIn(email.value, password.value);
    password.value = '';
    await sync();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function doSignOut() {
  signOut();
  session.value = null;
}

async function sync() {
  syncing.value = true;
  message.value = '';
  error.value = '';
  try {
    const result = await syncPendingRuns();
    message.value =
      `Synced ${result.synced} run(s); ${result.failed} failed.` +
      (result.clockOffsetMs !== null ? ` Device clock offset vs server: ${result.clockOffsetMs} ms.` : '');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    syncing.value = false;
    await refresh();
  }
}

async function clearSynced() {
  for (const run of synced.value) await deleteRun(run.runId);
  await refresh();
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
