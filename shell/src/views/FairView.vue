<template>
  <div class="page">
    <h1>Science fair / museum</h1>
    <p class="muted">
      Staff runbook for one tablet. The site, children, and administration must already exist in
      this project's dashboard. Kids never see this page.
    </p>
    <div class="row">
      <a href="#/"><button type="button">← Roster</button></a>
      <a href="#/provision"><button type="button">Provision</button></a>
      <a href="#/sync"><button type="button">Sync &amp; export</button></a>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">1 · Site is ready</h2>
        <span class="pill" :class="progress.siteReady ? 'ok' : 'warn'">{{
          progress.siteReady ? 'Done' : 'Do this first'
        }}</span>
      </div>
      <p class="muted">
        The researcher dashboard how-to is on a private admin-dev preview (not the main dashboard):
        <a
          href="https://hs-levante-admin-dev--science-fair-rcdjddph.web.app/science-fair"
          target="_blank"
          rel="noreferrer"
          >science-fair preview</a
        >. Create or reuse a site, children, and an administration there. This launcher does not
        create any of that.
      </p>
      <label class="row">
        <input type="checkbox" :checked="progress.siteReady" @change="toggleSiteReady" />
        I have an administration ready to provision
      </label>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">2 · Provision this tablet</h2>
        <span class="pill" :class="progress.provisioned ? 'ok' : 'warn'">{{
          progress.provisioned ? 'Pack on device' : 'Not provisioned'
        }}</span>
      </div>
      <p class="muted">
        Online. Open the pack link from the wizard on this tablet (any network), sign in, and tap
        <strong>Download pack</strong>. Stay on the network until it finishes. Science-fair tablets
        do not use a device PIN.
      </p>
      <p v-if="progress.packName" class="notice">Current pack: {{ progress.packName }}</p>
      <a href="#/provision"><button type="button" class="primary">Open provision</button></a>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">3 · Run the kiosk</h2>
        <span class="pill" :class="progress.assessed ? 'ok' : 'warn'">{{
          progress.assessed ? `${progress.runCount} run(s) on device` : 'No runs yet'
        }}</span>
      </div>
      <p class="muted">
        One tablet, many slots. You do not provision or sign in again between visitors. Play does
        not need a network.
      </p>
      <ol class="muted" style="padding-left: 1.2rem; margin: 0 0 12px">
        <li>On the roster, tap <strong>Start child mode</strong> so visitors cannot open Provision or Sync.</li>
        <li>Each visitor taps <strong>one unused name</strong>, then a task.</li>
        <li>When the task finishes, the roster returns. The next visitor taps a <strong>different</strong> name.</li>
        <li>Use the task counts to see which slots are still free.</li>
        <li>Stay in child mode all day. Leave it only to sync: tap <strong>On-site Researcher</strong>, then Exit child mode.</li>
      </ol>
      <a href="#/"><button type="button" class="primary">Open roster</button></a>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">4 · Retrieve</h2>
        <span class="pill" :class="progress.retrieved ? 'ok' : 'warn'">{{
          progress.retrieved
            ? 'All local runs synced'
            : progress.pending
              ? `${progress.pending} pending`
              : 'Nothing to sync yet'
        }}</span>
      </div>
      <p class="muted">
        Online. Leave child mode, then sign in with the same On-site Researcher Google account
        (or email / password) and sync pending runs. This page marks
        retrieval done when every local run is synced. You can also download a JSON export from the
        sync screen.
      </p>
      <a href="#/sync"><button type="button" class="primary">Open sync</button></a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { loadFairProgress, setFairSiteReady, type FairProgress } from '../offline/fair';

const progress = ref<FairProgress>({
  siteReady: false,
  provisioned: false,
  packName: '',
  assessed: false,
  runCount: 0,
  pending: 0,
  retrieved: false,
});

async function refresh() {
  progress.value = await loadFairProgress();
}

async function toggleSiteReady(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  await setFairSiteReady(checked);
  progress.value = { ...progress.value, siteReady: checked };
}

onMounted(() => {
  void refresh();
  window.addEventListener('pageshow', refresh);
  window.addEventListener('hashchange', refresh);
});

onUnmounted(() => {
  window.removeEventListener('pageshow', refresh);
  window.removeEventListener('hashchange', refresh);
});
</script>
