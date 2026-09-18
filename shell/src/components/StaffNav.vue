<template>
  <nav class="staff-nav" aria-label="Staff">
    <a
      v-for="item in items"
      :key="item.hash"
      :href="item.hash"
      class="staff-nav-item"
      :class="{ active: current === item.id }"
      :title="item.tip"
      :data-tip="item.tip"
    >
      {{ item.label }}
    </a>
  </nav>
</template>

<script setup lang="ts">
defineProps<{
  current: 'roster' | 'site' | 'provision' | 'sync' | 'fair';
}>();

const items = [
  { id: 'fair' as const, hash: '#/fair', label: 'Step-by-Step', tip: 'Numbered field-collection steps for this tablet' },
  { id: 'site' as const, hash: '#/site', label: '1 · Select Site', tip: 'Step 1: sign in and pick the site this tablet collects for' },
  { id: 'provision' as const, hash: '#/provision', label: '2 · Provision', tip: 'Step 2: download a pack for the selected site' },
  { id: 'roster' as const, hash: '#/', label: '3 · Roster', tip: 'Step 3: pick a child and collect tasks' },
  { id: 'sync' as const, hash: '#/sync', label: '4 · Sync', tip: 'Step 4: upload completed runs or export them as JSON' },
];
</script>
