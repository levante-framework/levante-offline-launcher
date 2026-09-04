import { getTrials, listRuns } from './db';
import { getDeviceId } from './device';
import type { ExportBundle } from './types';

export async function buildExportBundle(): Promise<ExportBundle> {
  const runs = await listRuns();
  const withTrials = await Promise.all(runs.map(async (run) => ({ ...run, trials: await getTrials(run.runId) })));
  return { version: 1, exportedAt: new Date().toISOString(), deviceId: getDeviceId(), runs: withTrials };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
