<template>
  <div class="page">
    <h1>4 · Sync</h1>
    <p class="muted">
      Device <span class="mono">{{ deviceId }}</span> · {{ runs.length }} run(s) stored locally ·
      {{ online ? 'online' : 'offline' }}
    </p>
    <StaffNav current="sync" />
    <div class="row">
      <button type="button" @click="exportAll" :disabled="!runs.length">Backup</button>
      <button type="button" @click="clearSynced" :disabled="!synced.length">Delete {{ synced.length }} synced</button>
    </div>

    <div class="card">
      <h2 style="margin-top: 0">Sync to server</h2>
      <p class="muted" v-if="!backendConfigured">This build has no backend configured; use Backup.</p>
      <div v-else-if="syncing" class="spinner-overlay" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true" />
        <p class="muted">{{ session ? 'Syncing…' : 'Signing in…' }}</p>
      </div>
      <template v-else>
        <div v-if="session" class="row">
          <span>Signed in as <strong>{{ session.email }}</strong></span>
          <button type="button" class="primary" @click="sync" :disabled="!online || !pending.length || syncing">
            {{ syncing ? 'Syncing…' : `Sync ${pending.length} pending run(s)` }}
          </button>
          <button type="button" @click="doSignOut">Sign out</button>
        </div>
        <div v-else>
          <button
            v-if="googleAuthConfigured"
            type="button"
            class="google-btn"
            :disabled="!online || !pending.length || syncing"
            @click="signInWithGoogleAndSync"
          >
            {{ syncing ? 'Syncing…' : `Continue with Google & sync ${pending.length} pending run(s)` }}
          </button>
          <p v-if="googleAuthConfigured" class="muted">or use email and password</p>
          <form class="row" @submit.prevent="signInAndSync">
            <input v-model="email" type="email" placeholder="researcher email" autocomplete="username" required />
            <input v-model="password" type="password" placeholder="password" autocomplete="current-password" required />
            <button type="submit" class="primary" :disabled="!online || !pending.length || syncing">
              {{ syncing ? 'Syncing…' : `Sign in & sync ${pending.length} pending run(s)` }}
            </button>
          </form>
        </div>
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
import StaffNav from '../components/StaffNav.vue';
import {
  backendConfigured,
  getSession,
  googleAuthConfigured,
  type ProctorSession,
  signIn,
  signInWithGoogle,
  signOut,
} from '../offline/auth';
import { deleteRun, listRuns } from '../offline/db';
import { getDeviceId } from '../offline/device';
import { backupRuns } from '../offline/exportRuns';
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
  const n = await backupRuns();
  message.value = n ? `Backed up ${n} run(s) to Downloads.` : 'No runs to back up.';
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

async function signInWithGoogleAndSync() {
  error.value = '';
  try {
    session.value = await signInWithGoogle();
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
  if (syncing.value) return;
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
