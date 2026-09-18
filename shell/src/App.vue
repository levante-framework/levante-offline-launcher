<template>
  <LockView
    v-if="locked"
    @unlocked="
      locked = false;
      ready = true;
    "
  />
  <template v-else-if="ready">
    <RosterView v-if="route.name === 'roster'" />
    <TaskView v-else-if="route.name === 'task'" :task-id="route.taskId" />
    <SyncView v-else-if="route.name === 'sync'" />
    <ProvisionView v-else-if="route.name === 'provision'" />
    <SiteView v-else-if="route.name === 'site'" />
    <FairView v-else-if="route.name === 'fair'" />
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { consumeGoogleRedirect } from './offline/auth';
import { isChildMode } from './offline/mode';
import { ensureOpenVault, isUnlocked, pinProtected } from './offline/vault';
import FairView from './views/FairView.vue';
import LockView from './views/LockView.vue';
import ProvisionView from './views/ProvisionView.vue';
import RosterView from './views/RosterView.vue';
import SiteView from './views/SiteView.vue';
import SyncView from './views/SyncView.vue';
import TaskView from './views/TaskView.vue';

// Science-fair (default) uses an open vault with no PIN. Tablets that already have a
// PIN vault still lock until that PIN is entered.
const locked = ref(pinProtected() && !isUnlocked());
const ready = ref(false);

// Hash routing keeps the shell a single precached document, which is what the
// service worker needs to bring the app up with no network at all.
const hash = ref(window.location.hash);
const onHashChange = () => {
  hash.value = window.location.hash;
};
onMounted(async () => {
  window.addEventListener('hashchange', onHashChange);
  if (!pinProtected()) {
    await ensureOpenVault();
    locked.value = false;
  }
  try {
    await consumeGoogleRedirect();
  } catch {
    // Provision/Sync show their own error if the user retries Google.
  }
  ready.value = !locked.value;
});
onUnmounted(() => window.removeEventListener('hashchange', onHashChange));

const route = computed(() => {
  const m = hash.value.match(/^#\/task\/([^/]+)/);
  if (m) return { name: 'task' as const, taskId: decodeURIComponent(m[1]) };
  // In child mode the proctor screens are unreachable by URL as well as by link.
  if (hash.value.startsWith('#/sync') && !isChildMode()) return { name: 'sync' as const, taskId: '' };
  if (hash.value.startsWith('#/provision') && !isChildMode()) return { name: 'provision' as const, taskId: '' };
  if (hash.value.startsWith('#/site') && !isChildMode()) return { name: 'site' as const, taskId: '' };
  if (hash.value.startsWith('#/fair') && !isChildMode()) return { name: 'fair' as const, taskId: '' };
  return { name: 'roster' as const, taskId: '' };
});
</script>
