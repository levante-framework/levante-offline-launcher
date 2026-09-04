// Prints what landed in the emulator after a sync: runs, trial counts, and the
// assignment progress/completion the syncOnRunDocUpdate trigger recomputed.
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8180';
const db = admin.firestore(admin.initializeApp({ projectId: 'demo-levante-spike' }));

const users = await db.collection('users').where('userType', '==', 'student').get();
for (const user of users.docs) {
  const runs = await user.ref.collection('runs').get();
  if (runs.empty) continue;
  console.log(`\n${user.get('assessmentPid')} (${user.id})`);
  for (const run of runs.docs) {
    const d = run.data();
    const trials = await run.ref.collection('trials').count().get();
    console.log(
      `  run ${run.id.slice(0, 8)}… task=${d.taskId} completed=${d.completed} trials=${trials.data().count}` +
        ` started=${d.timeStarted?.toDate?.().toISOString()} offset=${d.offline?.clockOffsetMs}ms bundle=${d.offline?.bundleId?.slice(0, 8) ?? '-'} bestRun=${d.bestRun ?? '-'}` +
        ` scores.test=${JSON.stringify(d.scores?.raw?.composite?.test ?? null)}`,
    );
  }
  const assignments = await user.ref.collection('assignments').get();
  for (const a of assignments.docs) {
    const d = a.data();
    console.log(`  assignment ${a.id}: started=${d.started} completed=${d.completed} progress=${JSON.stringify(d.progress)}`);
    for (const as of d.assessments ?? []) {
      if (as.runId || as.completedOn) {
        console.log(`    ${as.taskId}: runId=${as.runId ?? '-'} completedOn=${as.completedOn?.toDate?.().toISOString() ?? '-'}`);
      }
    }
  }
}

const devices = await db.collection('offlineDevices').get();
for (const dev of devices.docs) {
  const d = dev.data();
  const iso = (t) => t?.toDate?.().toISOString() ?? '-';
  console.log(
    `\ndevice ${dev.id}: platform=${d.platform} build=${d.appBuild} site=${d.siteId} pack=${d.packId}` +
      ` scope=${d.scope ? `${d.scope.orgType}:${d.scope.name}` : 'site'} children=${d.childCount}` +
      ` provisioned=${iso(d.provisionedAt)} lastSync=${iso(d.lastSyncAt)} runsSynced=${d.runsSynced ?? 0} trialsSynced=${d.trialsSynced ?? 0}`,
  );
}
process.exit(0);
