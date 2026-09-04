<template>
  <div>
    <div v-if="error" class="overlay error">
      {{ error }}
      <div style="margin-top: 8px"><button type="button" @click="goHome">Back to roster</button></div>
    </div>
    <div v-else-if="!started" class="overlay">Loading {{ taskId }}…</div>
    <div id="jspsych-target" class="game-target" translate="no"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { version as coreTasksVersion } from '@levante-framework/core-tasks/package.json';
import { getDeviceId, getSelectedChildId } from '../offline/device';
import { OfflineAppkit } from '../offline/OfflineAppkit';
import { loadPack } from '../offline/pack';
import { assetBaseFor } from '../offline/packStore';

const props = defineProps<{ taskId: string }>();
const error = ref('');
const started = ref(false);

function goHome() {
  window.location.hash = '#/';
  // core-tasks keeps module-level jsPsych/task-store state; a reload is the only
  // reliable way to run a second task in the same document (the dashboard does the same).
  window.location.reload();
}

onMounted(async () => {
  try {
    const pack = await loadPack();
    const child = pack.children.find((c) => c.localId === getSelectedChildId());
    if (!child) throw new Error('No child selected. Go back and pick a child from the roster.');
    if (!Number.isInteger(child.birthMonth) || !Number.isInteger(child.birthYear)) {
      throw new Error(`Roster entry for ${child.displayName} has no birth month/year; refusing to run without age.`);
    }

    const task = pack.tasks.find((t) => t.taskId === props.taskId);
    if (!task) throw new Error(`Task ${props.taskId} is not part of administration "${pack.name}"`);

    const variantParams: Record<string, unknown> = {
      language: pack.locale,
      taskName: props.taskId,
      assetBaseUrl: await assetBaseFor(pack.packId),
      ...task.variantParams,
    };

    const appkit = new OfflineAppkit({
      packId: pack.packId,
      packBuiltAt: pack.provisionedAt,
      deviceId: getDeviceId(),
      appBuild: __APP_BUILD__,
      taskVersion: coreTasksVersion,
      taskId: props.taskId,
      variantId: task.variantId ?? null,
      variantParams,
      administrationId: pack.administrationId,
      corpusSha256: pack.corpora[props.taskId]?.sha256 ?? null,
      bundleId: pack.bundles?.[`task/${props.taskId}/${pack.locale}`]?.bundleId ?? null,
      child,
    });

    const userParams = {
      birthMonth: String(child.birthMonth),
      birthYear: String(child.birthYear),
      assessmentPid: child.assessmentPid ?? child.localId,
    };

    const poll = setInterval(() => {
      if (document.querySelector('.jspsych-content-wrapper')) {
        started.value = true;
        clearInterval(poll);
      }
    }, 100);

    const { TaskLauncher } = await import('@levante-framework/core-tasks');
    const launcher = new TaskLauncher(appkit, variantParams, userParams);
    await launcher.run();
    clearInterval(poll);
    goHome();
  } catch (err) {
    console.error(err);
    error.value = err instanceof Error ? err.message : String(err);
  }
});
</script>

<style>
@import '@levante-framework/core-tasks/lib/resources/core-tasks.css';

/* core-tasks' stylesheet pulls its page background from a third GCS bucket; serve it from the app. */
.jspsych-display-element,
body.jspsych-fullscreen,
#jspsych-target {
  background-image: url('/levante-background.png') !important;
}
</style>
