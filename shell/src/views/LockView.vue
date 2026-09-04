<template>
  <div class="page">
    <h1>Device locked</h1>
    <p class="muted">Enter the proctor PIN set when this device was provisioned.</p>
    <form class="row" @submit.prevent="submit">
      <input v-model="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="PIN" autocomplete="off" required />
      <button type="submit" class="primary" :disabled="busy">Unlock</button>
    </form>
    <div v-if="error" class="error" style="margin-top: 12px">{{ error }}</div>

    <div class="card" style="margin-top: 32px">
      <p class="muted" style="margin: 0 0 8px">
        Forgot the PIN? The data on this device cannot be recovered without it. Wiping removes every pack and every
        run that has not been synced, after which the device must be provisioned again.
      </p>
      <button type="button" @click="wipe" :disabled="busy">Wipe this device</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { wipeDevice } from '../offline/wipe';
import { unlock } from '../offline/vault';

const emit = defineEmits<{ unlocked: [] }>();
const pin = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await unlock(pin.value);
    pin.value = '';
    emit('unlocked');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function wipe() {
  if (!window.confirm('Wipe every pack and all unsynced runs from this device?')) return;
  busy.value = true;
  try {
    await wipeDevice();
    window.location.hash = '#/provision';
    window.location.reload();
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
input {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  min-width: 160px;
  letter-spacing: 0.3em;
}
</style>
