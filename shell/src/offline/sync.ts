import { callFunction } from './auth';
import { getTrials, listRuns, updateRun } from './db';
import { deviceInfo } from './device';
import { logError, logInfo } from './sentry';

// Sync phase: each pending run is posted to the `syncOfflineRuns` callable as the
// signed-in proctor. Runs are independent, so one failure never blocks the others.

export interface SyncResult {
  synced: number;
  failed: number;
  clockOffsetMs: number | null;
}

let inflight: Promise<SyncResult> | null = null;

export async function syncPendingRuns(): Promise<SyncResult> {
  if (inflight) return inflight;
  inflight = syncOnce().finally(() => {
    inflight = null;
  });
  return inflight;
}

function isTransientSyncError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP 5\d\d|Failed to fetch|Load failed|network|timeout|QUIC|ERR_|unavailable|deadline/i.test(msg);
}

async function postRunWithRetry(run: Awaited<ReturnType<typeof listRuns>>[number], device: ReturnType<typeof deviceInfo>) {
  const trials = await getTrials(run.runId);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const result = await callFunction<{ status: string; clockOffsetMs?: number }>('syncOfflineRuns', {
        deviceId: device.deviceId,
        platform: device.platform,
        clientNowMs: Date.now(),
        run,
        trials,
      });
      if (result.status !== 'ok') throw new Error(`unexpected status ${result.status}`);
      return result;
    } catch (err) {
      lastErr = err;
      if (!isTransientSyncError(err) || attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function syncOnce(): Promise<SyncResult> {
  const runs = (await listRuns()).filter((r) => r.syncState !== 'synced');
  let synced = 0;
  let failed = 0;
  let clockOffsetMs: number | null = null;
  const device = deviceInfo();
  for (const run of runs) {
    try {
      const result = await postRunWithRetry(run, device);
      clockOffsetMs = result.clockOffsetMs ?? clockOffsetMs;
      await updateRun(run.runId, { syncState: 'synced', syncedAt: new Date().toISOString(), syncError: null });
      synced++;
    } catch (err) {
      failed++;
      logError('sync run failed', err, { taskId: run.taskId, packId: run.packId });
      await updateRun(run.runId, { syncState: 'error', syncError: err instanceof Error ? err.message : String(err) });
    }
  }
  logInfo('sync finished', { synced, failed, pending: runs.length });
  return { synced, failed, clockOffsetMs };
}
