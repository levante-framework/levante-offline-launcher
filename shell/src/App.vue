<template>
  <LockView v-if="locked" @unlocked="locked = false" />
  <template v-else>
    <RosterView v-if="route.name === 'roster'" />
    <TaskView v-else-if="route.name === 'task'" :task-id="route.taskId" />
    <SyncView v-else-if="route.name === 'sync'" />
    <ProvisionView v-else-if="route.name === 'provision'" />
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { isUnlocked, vaultExists } from './offline/vault';
import LockView from './views/LockView.vue';
import ProvisionView from './views/ProvisionView.vue';
import RosterView from './views/RosterView.vue';
import SyncView from './views/SyncView.vue';
import TaskView from './views/TaskView.vue';

// A provisioned device is sealed behind the proctor PIN; a fresh device has no vault yet
// and goes straight to provisioning, which creates one.
const locked = ref(vaultExists() && !isUnlocked());

// Hash routing keeps the shell a single precached document, which is what the
// service worker needs to bring the app up with no network at all.
const hash = ref(window.location.hash);
const onHashChange = () => {
  hash.value = window.location.hash;
};
onMounted(() => window.addEventListener('hashchange', onHashChange));
onUnmounted(() => window.removeEventListener('hashchange', onHashChange));

const route = computed(() => {
  const m = hash.value.match(/^#\/task\/([^/]+)/);
  if (m) return { name: 'task' as const, taskId: decodeURIComponent(m[1]) };
  if (hash.value.startsWith('#/sync')) return { name: 'sync' as const, taskId: '' };
  if (hash.value.startsWith('#/provision')) return { name: 'provision' as const, taskId: '' };
  return { name: 'roster' as const, taskId: '' };
});
</script>
