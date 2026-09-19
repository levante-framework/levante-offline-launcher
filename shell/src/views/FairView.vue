<template>
  <div class="page">
    <h1>Step-by-step</h1>
    <p class="muted">
      Staff runbook for one tablet. The site, children, and assignment must already exist in this
      project's dashboard. Children never see this page.
    </p>
    <StaffNav current="fair" />

    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">1 · Select Site</h2>
        <span class="pill" :class="progress.siteReady ? 'ok' : 'warn'">{{
          progress.siteReady ? 'Done' : 'Do this first'
        }}</span>
      </div>
      <p class="muted">
        Sign in on this tablet and pick the site you are collecting for. Researchers with access to
        more than one site must choose before provisioning. The site, children, and assignment must
        already exist in the
        <a
          href="https://hs-levante-admin-dev--science-fair-rcdjddph.web.app/science-fair"
          target="_blank"
          rel="noreferrer"
          >field-collection preview</a
        >. This launcher does not create any of that.
      </p>
      <p v-if="siteLabel" class="notice">Current site: {{ siteLabel }}</p>
      <a href="#/site"><button type="button" class="primary">Open select site</button></a>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">2 · Provision</h2>
        <span class="pill" :class="progress.provisioned ? 'ok' : 'warn'">{{
          progress.provisioned ? 'Pack on device' : 'Not provisioned'
        }}</span>
      </div>
      <p class="muted">
        Online. After the site is selected, open Provision (or the pack link from the wizard) and
        tap <strong>Download pack</strong>. Stay on the network until it finishes. Field-collection
        tablets do not use a device PIN.
      </p>
      <p v-if="progress.packName" class="notice">Current pack: {{ progress.packName }}</p>
      <a href="#/provision"><button type="button" class="primary">Open provision</button></a>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">3 · Collect Data</h2>
        <span class="pill" :class="progress.assessed ? 'ok' : 'warn'">{{
          progress.assessed ? `${progress.runCount} run(s) on device` : 'No runs yet'
        }}</span>
      </div>
      <p class="muted">
        One tablet holds that group. You do not provision or sign in again between children. Play
        does not need a network — at a school site or house to house.
      </p>
      <ol class="muted" style="padding-left: 1.2rem; margin: 0 0 12px">
        <li>On the roster, tap <strong>Start child mode</strong> so children cannot open Provision or Sync.</li>
        <li>Each child taps <strong>their own name</strong>, then a task.</li>
        <li>When the task finishes, the roster returns. The next child taps a <strong>different</strong> name.</li>
        <li>Use the task counts to see who still has work left.</li>
        <li>Stay in child mode while collecting. Leave it only when you are done for the session: tap <strong>On-site Researcher</strong>, then <strong>Exit child mode</strong> (that also writes a Backup file to Downloads).</li>
      </ol>
      <a href="#/"><button type="button" class="primary">Collect Data</button></a>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">4 · Sync</h2>
        <span class="pill" :class="progress.retrieved ? 'ok' : 'warn'">{{
          progress.retrieved
            ? 'All local runs synced'
            : progress.pending
              ? `${progress.pending} pending`
              : 'Nothing to sync yet'
        }}</span>
      </div>
      <p class="muted">
        Online. After you leave child mode, sign in with the same On-site Researcher Google
        account (or email / password) and tap <strong>Sync</strong> to upload pending runs
        to the server. The same run ids overwrite, so a Backup plus a later Sync does not
        create duplicates. <strong>Backup to Download Folder</strong> only saves a JSON file
        — it does not upload. You can tap it again anytime. This page marks retrieval done
        when every local run is synced.
      </p>
      <a href="#/sync"><button type="button" class="primary">Open sync</button></a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import StaffNav from '../components/StaffNav.vue';
import { loadFairProgress, type FairProgress } from '../offline/fair';
import { getSelectedSite } from '../offline/site';

const progress = ref<FairProgress>({
  siteReady: false,
  provisioned: false,
  packName: '',
  assessed: false,
  runCount: 0,
  pending: 0,
  retrieved: false,
});

const siteLabel = ref(getSelectedSite()?.name ?? '');

async function refresh() {
  progress.value = await loadFairProgress();
  siteLabel.value = getSelectedSite()?.name ?? '';
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
