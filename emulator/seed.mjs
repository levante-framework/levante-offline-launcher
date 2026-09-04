// Seeds the local Firebase emulator with the minimum a provisioning + offline sync test needs:
//   - system/permissions (permissions-core default matrix, as the platform's own seeder does)
//   - a site, and a proctor (site admin) with new-style claims covering it
//   - three child users (+ auth users) in that site with birth data
//   - one administration assigning three tasks, plus each child's assignment document
// The launcher then provisions itself through the real callables (getAdministrations,
// provisionOfflinePack) — nothing is written into the app's files anymore.
//
// Run with the emulator up:  npm run seed   (from this directory)

import { DEFAULT_PERMISSION_MATRIX } from '@levante-framework/permissions-core';
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8180';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9199';

const PROJECT_ID = 'demo-levante-spike';
const SITE_ID = 'site-demo';
const ADMINISTRATION_ID = 'admin-spike-offline';
const PROCTOR = { email: 'proctor@levante.test', password: 'proctor123' };
const LOCALE = 'en-US';

const CHILDREN = [
  { key: 'demo-child-1', first: 'Ada', last: 'Lovelace', pid: 'DEMO-A', birthMonth: 3, birthYear: 2019 },
  { key: 'demo-child-2', first: 'Blaise', last: 'Pascal', pid: 'DEMO-B', birthMonth: 9, birthYear: 2017 },
  { key: 'demo-child-3', first: 'Carla', last: 'Hesse', pid: 'DEMO-C', birthMonth: 1, birthYear: 2015 },
];

const TASKS = [
  { taskId: 'hearts-and-flowers', params: { taskName: 'hearts-and-flowers', language: LOCALE, storeItemId: true } },
  {
    taskId: 'egma-math',
    params: { taskName: 'egma-math', language: LOCALE, storeItemId: true, cat: true, semThreshold: 0.3, startingTheta: 0, maxIncorrect: 50, numberOfTrials: 25 },
  },
  {
    taskId: 'matrix-reasoning',
    params: { taskName: 'matrix-reasoning', language: LOCALE, storeItemId: true, cat: true, semThreshold: 0.3, startingTheta: 0, maxIncorrect: 50, numberOfTrials: 25 },
  },
];

const app = admin.initializeApp({ projectId: PROJECT_ID });
const auth = admin.auth(app);
const db = admin.firestore(app);

async function main() {
  // --- permissions matrix (what ensurePermissionsLoaded reads) ---
  await db.collection('system').doc('permissions').set({
    permissions: DEFAULT_PERMISSION_MATRIX,
    updatedAt: new Date().toISOString(),
    version: '1.1.0',
  });

  // --- site + proctor ---
  await db.collection('districts').doc(SITE_ID).set({ name: 'Spike demo site', id: SITE_ID, createdAt: new Date() }, { merge: true });

  const proctor = await upsertAuthUser(PROCTOR.email, PROCTOR.password);
  const proctorClaims = {
    adminUid: proctor.uid,
    roarUid: proctor.uid,
    siteRoles: { [SITE_ID]: ['site_admin'] },
    siteNames: { [SITE_ID]: 'Spike demo site' },
    useNewPermissions: true,
    rolesSet: true,
    adminOrgs: { districts: [SITE_ID], schools: [], classes: [], groups: [] },
  };
  await auth.setCustomUserClaims(proctor.uid, proctorClaims);
  await db.collection('users').doc(proctor.uid).set(
    {
      email: PROCTOR.email,
      userType: 'admin',
      districts: { current: [SITE_ID], all: [SITE_ID] },
      schools: { current: [], all: [] },
      classes: { current: [], all: [] },
      groups: { current: [], all: [] },
      lastUpdated: new Date(),
    },
    { merge: true },
  );
  await db.collection('userClaims').doc(proctor.uid).set({ claims: proctorClaims, lastUpdated: new Date() });

  // --- children ---
  const children = [];
  for (const c of CHILDREN) {
    const user = await upsertAuthUser(`${c.key}@levante.test`, 'child123');
    await auth.setCustomUserClaims(user.uid, { roarUid: user.uid, adminUid: user.uid });
    await db.collection('users').doc(user.uid).set(
      {
        assessmentPid: c.pid,
        userType: 'student',
        birthMonth: c.birthMonth,
        birthYear: c.birthYear,
        name: { first: c.first, last: c.last },
        studentData: {},
        districts: { current: [SITE_ID], all: [SITE_ID] },
        schools: { current: [], all: [] },
        classes: { current: [], all: [] },
        groups: { current: [], all: [] },
        tasks: [],
        variants: [],
        lastUpdated: new Date(),
      },
      { merge: true },
    );
    await db.collection('userClaims').doc(user.uid).set({ claims: { roarUid: user.uid, adminUid: user.uid }, lastUpdated: new Date() }, { merge: true });
    children.push({ ...c, uid: user.uid });
  }

  // --- tasks/variants catalog + administration ---
  const assessments = [];
  for (const t of TASKS) {
    const variantId = `variant-${t.taskId}-spike`;
    const variantName = `${t.taskId} (offline spike)`;
    await db.collection('tasks').doc(t.taskId).set({ id: t.taskId, name: t.taskId, registered: true, lastUpdated: new Date() }, { merge: true });
    await db.collection('tasks').doc(t.taskId).collection('variants').doc(variantId).set({ name: variantName, registered: true, params: t.params, lastUpdated: new Date() }, { merge: true });
    assessments.push({ taskId: t.taskId, variantId, variantName, params: t.params });
  }

  const now = new Date();
  const dateClosed = new Date(now.getTime() + 90 * 24 * 3600 * 1000);
  await db.collection('administrations').doc(ADMINISTRATION_ID).set({
    id: ADMINISTRATION_ID,
    name: 'Offline spike administration',
    publicName: 'Offline spike',
    createdBy: proctor.uid,
    dateCreated: now,
    dateOpened: now,
    dateClosed,
    sequential: false,
    siteId: SITE_ID,
    districts: [SITE_ID],
    schools: [],
    classes: [],
    groups: [],
    readOrgs: { districts: [SITE_ID], schools: [], classes: [], groups: [] },
    minimalOrgs: { districts: [SITE_ID], schools: [], classes: [], groups: [] },
    assessments,
    legal: {},
    testData: false,
  });

  for (const child of children) {
    const progress = Object.fromEntries(assessments.map((a) => [a.taskId.replace(/-/g, '_'), 'assigned']));
    await db.collection('users').doc(child.uid).collection('assignments').doc(ADMINISTRATION_ID).set({
      id: ADMINISTRATION_ID,
      name: 'Offline spike administration',
      publicName: 'Offline spike',
      started: false,
      completed: false,
      dateAssigned: now,
      dateOpened: now,
      dateClosed,
      dateCreated: now,
      createdBy: proctor.uid,
      legal: {},
      sequential: false,
      assessments: assessments.map((a) => ({ ...a, optional: false })),
      progress,
      assigningOrgs: { districts: [SITE_ID], schools: [], classes: [], groups: [] },
      readOrgs: { districts: [SITE_ID], schools: [], classes: [], groups: [] },
      userData: { assessmentPid: child.pid, name: { first: child.first, last: child.last } },
    });
  }

  console.log('Seeded emulator project', PROJECT_ID);
  console.log('  proctor:', PROCTOR.email, '/', PROCTOR.password, 'uid', proctor.uid);
  for (const c of children) console.log('  child:', c.first, c.last, c.pid, 'uid', c.uid);
  console.log('  administration:', ADMINISTRATION_ID, 'tasks:', assessments.map((a) => a.taskId).join(', '));
}

async function upsertAuthUser(email, password) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    return auth.createUser({ email, password, emailVerified: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
