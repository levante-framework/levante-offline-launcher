// Asserts the science_fair resync: 10 TEST-* students, both tasks completed
// on the assignment, runs+trials ingested, birthdates unchanged.
//
//   npm run inspect:science-fair

import admin from 'firebase-admin';
import { ADMINISTRATION_ID, CHILDREN, TASK_IDS } from './seed-science-fair.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8180';

const db = admin.firestore(admin.apps[0] ?? admin.initializeApp({ projectId: 'demo-levante-spike' }));

const errors = [];
function check(ok, msg) {
  if (!ok) errors.push(msg);
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${msg}`);
}

const onlyPids = String(process.env.SCIENCE_FAIR_PIDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const expected = new Map((onlyPids.length ? CHILDREN.filter((c) => onlyPids.includes(c.pid)) : CHILDREN).map((c) => [c.pid, c]));
const users = await db.collection('users').where('userType', '==', 'student').get();
const kids = users.docs.filter((d) => String(d.get('assessmentPid') || '').startsWith('TEST-'));

const wantRuns = expected.size * TASK_IDS.length;
check(kids.length === CHILDREN.length, `${kids.length} TEST-* students (want ${CHILDREN.length})`);

let runTotal = 0;
let trialTotal = 0;
let assignmentsComplete = 0;

for (const user of kids) {
  const pid = user.get('assessmentPid');
  const exp = expected.get(pid);
  if (!exp) continue;
  check(user.get('birthMonth') === exp.birthMonth && user.get('birthYear') === exp.birthYear, `${pid} birth ${user.get('birthYear')}-${String(user.get('birthMonth')).padStart(2, '0')} (want ${exp.birthYear}-${String(exp.birthMonth).padStart(2, '0')})`);

  const runs = await user.ref.collection('runs').get();
  const byTask = new Map();
  for (const run of runs.docs) {
    const d = run.data();
    if (d.assignmentId !== ADMINISTRATION_ID && d.administrationId !== ADMINISTRATION_ID) continue;
    const trials = await run.ref.collection('trials').count().get();
    const n = trials.data().count;
    runTotal++;
    trialTotal += n;
    byTask.set(d.taskId, { completed: d.completed === true, trials: n, runId: run.id });
    console.log(`    ${pid} run ${d.taskId} completed=${d.completed} trials=${n}`);
  }
  for (const taskId of TASK_IDS) {
    const hit = byTask.get(taskId);
    check(!!hit, `${pid} has a ${taskId} run`);
    if (hit) {
      check(hit.completed, `${pid} ${taskId} completed`);
      if (taskId !== 'intro') check(hit.trials > 0, `${pid} ${taskId} has trials (${hit.trials})`);
    }
  }

  const assignment = await user.ref.collection('assignments').doc(ADMINISTRATION_ID).get();
  check(assignment.exists, `${pid} has assignment ${ADMINISTRATION_ID}`);
  if (assignment.exists) {
    const progress = assignment.get('progress') ?? {};
    const completed = assignment.get('completed') === true;
    if (completed) assignmentsComplete++;
    check(completed, `${pid} assignment.completed`);
    for (const taskId of TASK_IDS) {
      const key = taskId.replace(/-/g, '_');
      check(progress[key] === 'completed', `${pid} progress.${key}=${progress[key] ?? 'missing'}`);
    }
  }
}

const devices = await db.collection('offlineDevices').get();
const fairDevices = devices.docs.filter((d) => String(d.get('packId') || '').includes('admin-science-fair'));
const syncedDevices = fairDevices.filter((d) => d.get('lastSyncAt'));
check(syncedDevices.length >= 1, `${syncedDevices.length} science-fair device(s) with a sync`);
for (const dev of syncedDevices) {
  const d = dev.data();
  const iso = (t) => t?.toDate?.().toISOString() ?? '-';
  console.log(`  device ${dev.id}: lastSync=${iso(d.lastSyncAt)} runsSynced=${d.runsSynced ?? 0} trialsSynced=${d.trialsSynced ?? 0}`);
}
const best = syncedDevices.reduce((n, d) => Math.max(n, d.get('runsSynced') ?? 0), 0);
check(best >= wantRuns, `best device runsSynced ${best} (want >= ${wantRuns})`);

check(runTotal >= wantRuns, `ingested runs ${runTotal} (want >= ${wantRuns})`);
check(assignmentsComplete === expected.size, `completed assignments ${assignmentsComplete}/${expected.size}`);
check(trialTotal > 0, `ingested trials ${trialTotal}`);

console.log(`\nscience_fair inspect: ${errors.length ? 'FAILED' : 'PASSED'} (${errors.length} check(s) failed)`);
for (const e of errors) console.log(`  - ${e}`);
process.exit(errors.length ? 1 : 0);
