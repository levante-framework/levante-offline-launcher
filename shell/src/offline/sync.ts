import { callFunction } from './auth';
import { getTrials, listRuns, updateRun } from './db';
import { deviceInfo } from './device';

// Sync phase: each pending run is posted to the `syncOfflineRuns` callable as the
// signed-in proctor. Runs are independent, so one failure never blocks the others.

export interface SyncResult {
  synced: number;
  failed: number;
  clockOffsetMs: number | null;
}

export async function syncPendingRuns(): Promise<SyncResult> {
  const runs = (await listRuns()).filter((r) => r.syncState !== 'synced');
  let synced = 0;
  let failed = 0;
  let clockOffsetMs: number | null = null;
  const device = deviceInfo();
  for (const run of runs) {
    try {
      const trials = await getTrials(run.runId);
      const result = await callFunction<{ status: string; clockOffsetMs?: number }>('syncOfflineRuns', {
        deviceId: device.deviceId,
        platform: device.platform,
        clientNowMs: Date.now(),
        run,
        trials,
      });
      if (result.status !== 'ok') throw new Error(`unexpected status ${result.status}`);
      clockOffsetMs = result.clockOffsetMs ?? clockOffsetMs;
      await updateRun(run.runId, { syncState: 'synced', syncedAt: new Date().toISOString(), syncError: null });
      synced++;
    } catch (err) {
      failed++;
      await updateRun(run.runId, { syncState: 'error', syncError: err instanceof Error ? err.message : String(err) });
    }
  }
  return { synced, failed, clockOffsetMs };
}
