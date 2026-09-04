import { getDb, getTrials, listPacks, listRuns } from './db';

// Exposes the (decrypting) store to end-to-end tests; harmless in production because
// every call still requires the unlocked vault of the current session.
declare global {
  interface Window {
    __levanteStore?: Promise<{
      listRuns: typeof listRuns;
      listPacks: typeof listPacks;
      allTrials: () => Promise<Awaited<ReturnType<typeof getTrials>>>;
    }>;
  }
}

window.__levanteStore = Promise.resolve({
  listRuns,
  listPacks,
  allTrials: async () => {
    const db = await getDb();
    const rows = await db.getAll('runs');
    const all = await Promise.all(rows.map((r) => getTrials(r.runId)));
    return all.flat();
  },
});
