// Science-fair fixture: one site, 10 test students with distinct birthdates,
// one administration of two no-corpus tasks (hearts-and-flowers + intro).
//
//   npm run seed:science-fair

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_PERMISSION_MATRIX } from '@levante-framework/permissions-core';
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8180';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9199';

export const PROJECT_ID = 'demo-levante-spike';
export const SITE_ID = 'site-science-fair';
export const SCHOOL_ID = 'school-science-fair';
export const ADMINISTRATION_ID = 'admin-science-fair';
export const PROCTOR = { email: 'fair@levante.test', password: 'fair123456', role: 'site_admin' };
export const LOCALE = 'en-US';
export const TASK_IDS = ['hearts-and-flowers', 'intro'];

export const CHILDREN = [
  { first: 'Test01', last: 'User', pid: 'TEST-01', birthMonth: 1, birthYear: 2013 },
  { first: 'Test02', last: 'User', pid: 'TEST-02', birthMonth: 3, birthYear: 2014 },
  { first: 'Test03', last: 'User', pid: 'TEST-03', birthMonth: 6, birthYear: 2014 },
  { first: 'Test04', last: 'User', pid: 'TEST-04', birthMonth: 11, birthYear: 2015 },
  { first: 'Test05', last: 'User', pid: 'TEST-05', birthMonth: 2, birthYear: 2016 },
  { first: 'Test06', last: 'User', pid: 'TEST-06', birthMonth: 8, birthYear: 2016 },
  { first: 'Test07', last: 'User', pid: 'TEST-07', birthMonth: 4, birthYear: 2017 },
  { first: 'Test08', last: 'User', pid: 'TEST-08', birthMonth: 12, birthYear: 2018 },
  { first: 'Test09', last: 'User', pid: 'TEST-09', birthMonth: 7, birthYear: 2019 },
  { first: 'Test10', last: 'User', pid: 'TEST-10', birthMonth: 5, birthYear: 2020 },
];

const TASKS = TASK_IDS.map((taskId) => ({
  taskId,
  params: { taskName: taskId, language: LOCALE, storeItemId: true },
}));

const app = admin.apps[0] ?? admin.initializeApp({ projectId: PROJECT_ID });
const auth = admin.auth(app);
const db = admin.firestore(app);

async function main() {
  await db.collection('system').doc('permissions').set({
    permissions: DEFAULT_PERMISSION_MATRIX,
    updatedAt: new Date().toISOString(),
    version: '1.1.0',
  });

  await db.collection('districts').doc(SITE_ID).set(
    { name: 'Science Fair site', id: SITE_ID, schools: [SCHOOL_ID], subGroups: [], archived: false, createdAt: new Date() },
    { merge: true },
  );
  await db.collection('schools').doc(SCHOOL_ID).set(
    { id: SCHOOL_ID, name: 'Science Fair', normalizedName: 'science fair', districtId: SITE_ID, classes: [], archived: false, createdAt: new Date() },
    { merge: true },
  );

  const proctor = await upsertProctor(PROCTOR);

  const children = [];
  for (const c of CHILDREN) {
    const user = await upsertAuthUser(`${c.pid.toLowerCase()}@levante.test`, 'child123');
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
        schools: { current: [SCHOOL_ID], all: [SCHOOL_ID] },
        classes: { current: [], all: [] },
        groups: { current: [], all: [] },
        tasks: [],
        variants: [],
        lastUpdated: new Date(),
      },
      { merge: true },
    );
    await db.collection('userClaims').doc(user.uid).set({ claims: { roarUid: user.uid, adminUid: user.uid }, lastUpdated: new Date() }, { merge: true });
    const prior = await db.collection('users').doc(user.uid).collection('runs').get();
    for (const run of prior.docs) {
      if (run.get('assignmentId') !== ADMINISTRATION_ID) continue;
      const trials = await run.ref.collection('trials').listDocuments();
      await Promise.all(trials.map((t) => t.delete()));
      await run.ref.delete();
    }
    children.push({ ...c, uid: user.uid });
  }

  const assessments = [];
  for (const t of TASKS) {
    const variantId = `variant-${t.taskId}-science-fair`;
    const variantName = `${t.taskId} (science fair)`;
    await db.collection('tasks').doc(t.taskId).set({ id: t.taskId, name: t.taskId, registered: true, lastUpdated: new Date() }, { merge: true });
    await db.collection('tasks').doc(t.taskId).collection('variants').doc(variantId).set({ name: variantName, registered: true, params: t.params, lastUpdated: new Date() }, { merge: true });
    assessments.push({ taskId: t.taskId, variantId, variantName, params: t.params });
  }

  const now = new Date();
  const dateClosed = new Date(now.getTime() + 90 * 24 * 3600 * 1000);
  await db.collection('administrations').doc(ADMINISTRATION_ID).set({
    id: ADMINISTRATION_ID,
    name: 'Science fair administration',
    publicName: 'Science fair',
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
    testData: true,
  });

  for (const child of children) {
    const progress = Object.fromEntries(assessments.map((a) => [a.taskId.replace(/-/g, '_'), 'assigned']));
    await db.collection('users').doc(child.uid).collection('assignments').doc(ADMINISTRATION_ID).set({
      id: ADMINISTRATION_ID,
      name: 'Science fair administration',
      publicName: 'Science fair',
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

  console.log('Seeded science_fair on', PROJECT_ID);
  console.log('  proctor:', PROCTOR.email, '/', PROCTOR.password);
  console.log('  site:', SITE_ID, '· school:', SCHOOL_ID);
  for (const c of children) console.log(`  ${c.pid} ${c.first} born ${c.birthYear}-${String(c.birthMonth).padStart(2, '0')} uid ${c.uid}`);
  console.log('  administration:', ADMINISTRATION_ID, 'tasks:', TASK_IDS.join(', '));
}

async function upsertProctor({ email, password, role }) {
  const user = await upsertAuthUser(email, password);
  const claims = {
    adminUid: user.uid,
    roarUid: user.uid,
    siteRoles: { [SITE_ID]: [role] },
    siteNames: { [SITE_ID]: 'Science Fair site' },
    useNewPermissions: true,
    rolesSet: true,
    adminOrgs: { districts: [], schools: [], classes: [], groups: [] },
  };
  await auth.setCustomUserClaims(user.uid, claims);
  await db.collection('users').doc(user.uid).set(
    {
      email,
      userType: 'admin',
      districts: { current: [SITE_ID], all: [SITE_ID] },
      schools: { current: [], all: [] },
      classes: { current: [], all: [] },
      groups: { current: [], all: [] },
      lastUpdated: new Date(),
    },
    { merge: true },
  );
  await db.collection('userClaims').doc(user.uid).set({ claims, lastUpdated: new Date() });
  return user;
}

async function upsertAuthUser(email, password) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    return auth.createUser({ email, password, emailVerified: true });
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
