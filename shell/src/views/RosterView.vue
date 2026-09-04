<template>
  <div class="page">
    <h1>LEVANTE Offline Launcher</h1>
    <p class="muted" v-if="pack">
      <strong>{{ pack.name }}</strong> · {{ pack.locale }} · {{ pack.children.length }} children ·
      {{ pack.fileCount }} files / {{ mb(pack.totalBytes) }} MB · provisioned
      {{ pack.provisionedAt.slice(0, 16).replace('T', ' ') }} by {{ pack.provisionedBy }}
      <span v-if="pack.dateClosed"> · closes {{ pack.dateClosed.slice(0, 10) }}</span>
    </p>

    <div class="status-bar">
      <span>{{ online ? 'Network: online' : 'Network: offline' }}</span>
      <span>Pending runs: {{ pendingCount }}</span>
      <a href="#/sync">Sync &amp; export</a>
      <a href="#/provision">Provision</a>
      <a href="#/" @click.prevent="lockDevice">Lock device</a>
    </div>

    <div v-if="error" class="error" style="margin-top: 12px">
      {{ error }}
      <div style="margin-top: 8px"><a href="#/provision"><button type="button" class="primary">Provision this device</button></a></div>
    </div>

    <template v-if="pack">
      <h2>1 · Who is playing?</h2>
      <div class="child-list">
        <button
          v-for="child in pack.children"
          :key="child.localId"
          class="child"
          :class="{ selected: selectedId === child.localId }"
          type="button"
          @click="select(child)"
        >
          <div><strong>{{ child.displayName }}</strong></div>
          <div class="muted mono">
            {{ child.assessmentPid || child.localId }} · born {{ child.birthYear }}-{{ String(child.birthMonth).padStart(2, '0') }}
          </div>
        </button>
      </div>

      <h2>2 · Choose a task</h2>
      <div class="row">
        <button
          v-for="task in tasksForSelected"
          :key="task.taskId"
          class="primary big"
          type="button"
          :disabled="!selected"
          @click="startTask(task.taskId)"
        >
          {{ task.label || task.taskId }}
        </button>
      </div>
      <p class="muted" v-if="!selected">Select a child first.</p>
      <p class="muted" v-else-if="!tasksForSelected.length">No tasks are assigned to this child in this administration.</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { countRuns } from '../offline/db';
import { getSelectedChildId, setSelectedChildId } from '../offline/device';
import { loadPack } from '../offline/pack';
import type { PackRecord, RosterEntry } from '../offline/types';
import { lock, vaultExists } from '../offline/vault';

const pack = ref<PackRecord | null>(null);
const selectedId = ref<string | null>(getSelectedChildId());
const pendingCount = ref(0);
const error = ref('');
const online = ref(navigator.onLine);

const onOnline = () => (online.value = true);
const onOffline = () => (online.value = false);

const selected = computed<RosterEntry | null>(() => pack.value?.children.find((c) => c.localId === selectedId.value) ?? null);

const tasksForSelected = computed(() => {
  if (!pack.value) return [];
  const assigned = selected.value?.taskIds;
  return assigned?.length ? pack.value.tasks.filter((t) => assigned.includes(t.taskId)) : pack.value.tasks;
});

onMounted(async () => {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  if (!vaultExists()) {
    error.value = 'This device has not been provisioned yet.';
    return;
  }
  try {
    pack.value = await loadPack();
    if (selectedId.value && !pack.value.children.some((c) => c.localId === selectedId.value)) {
      selectedId.value = null;
      setSelectedChildId(null);
    }
    pendingCount.value = (await countRuns()).pending;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

onUnmounted(() => {
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
});

function select(child: RosterEntry) {
  selectedId.value = child.localId;
  setSelectedChildId(child.localId);
}

function startTask(taskId: string) {
  if (!selected.value) return;
  window.location.hash = `#/task/${encodeURIComponent(taskId)}`;
}

function lockDevice() {
  lock();
  window.location.hash = '#/';
  window.location.reload();
}

function mb(bytes: number) {
  return (bytes / 1e6).toFixed(1);
}
</script>
