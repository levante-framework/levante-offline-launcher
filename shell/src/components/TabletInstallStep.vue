<template>
  <div class="card">
    <div class="row" style="justify-content: space-between">
      <h2 :style="{ margin: 0 }">2a · Install on this tablet</h2>
      <span class="pill" :class="standalone ? 'ok' : 'warn'">{{
        standalone ? 'Opened from Home screen' : 'Opened in a browser tab'
      }}</span>
    </div>
    <p class="muted">
      <strong>When:</strong> on the field tablet, after Select Site, <em>before</em> Download pack.
      Skip on a laptop.
    </p>
    <ol class="muted" style="padding-left: 1.2rem; margin: 0 0 12px">
      <li>Open this launcher in <strong>Chrome</strong> (not the stock Android browser).</li>
      <li>Chrome menu (⋮) → <strong>Add to Home screen</strong> → <strong>Install</strong>.</li>
      <li>Open the new Home screen icon, then download the pack from that window.</li>
    </ol>
    <p v-if="standalone" class="notice">This is the installed app. Continue with Download pack here.</p>
    <p v-else class="notice">
      This is a browser tab. Fine for a short test. For a field day, finish these three steps and
      reopen from the icon first — that is the window you will use with radios off.
    </p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { isStandalonePwa } from '../offline/displayMode';

const standalone = ref(isStandalonePwa());
let mql: MediaQueryList | null = null;

function refresh() {
  standalone.value = isStandalonePwa();
}

onMounted(() => {
  mql = window.matchMedia('(display-mode: standalone)');
  mql.addEventListener('change', refresh);
});

onUnmounted(() => {
  mql?.removeEventListener('change', refresh);
});
</script>
