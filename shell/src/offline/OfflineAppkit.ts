import { appendTrial, putRun, updateRun } from './db';
import type { OfflineRunRecord, OfflineTrialRecord, RosterEntry } from './types';

// core-tasks (task-launcher/src/tasks/shared/helpers/trialSaving.ts and index.ts) treats
// the firekit handle as a RoarAppkit duck type. This is the surface it actually calls:
//   startRun, writeTrial, finishRun, updateUser, updateStopReason, run.completed, firebaseProject.
// Everything is written to IndexedDB with client-side timestamps and provenance stamps.

const REQUIRED_TRIAL_KEYS = ['assessment_stage', 'correct'];

export interface OfflineAppkitInput {
  packId: string;
  packBuiltAt: string;
  deviceId: string;
  appBuild: string;
  taskVersion: string;
  taskId: string;
  variantId: string | null;
  variantParams: Record<string, unknown>;
  administrationId: string | null;
  corpusSha256: string | null;
  bundleId: string | null;
  child: RosterEntry;
}

export class OfflineAppkit {
  /** Absent on purpose: core-tasks uses it only to detect the dev project / ROAR mode. */
  readonly firebaseProject = undefined;
  run: { completed: boolean; aborted: boolean; runId: string } | undefined;
  readonly _taskInfo: { taskId: string; variantId: string | null; variantParams: Record<string, unknown> };

  private record: OfflineRunRecord | null = null;
  private trialIndex = 0;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly input: OfflineAppkitInput) {
    this._taskInfo = { taskId: input.taskId, variantId: input.variantId, variantParams: input.variantParams };
  }

  get runId() {
    return this.record?.runId ?? null;
  }

  async startRun(additionalRunMetadata: Record<string, unknown> = {}) {
    const now = new Date();
    const { child, ...stamps } = this.input;
    this.record = {
      runId: crypto.randomUUID(),
      ...stamps,
      child: {
        localId: child.localId,
        uid: child.uid,
        assessmentPid: child.assessmentPid ?? null,
        birthMonth: child.birthMonth,
        birthYear: child.birthYear,
      },
      timeStarted: now.toISOString(),
      timeStartedMs: now.getTime(),
      timeFinished: null,
      timeFinishedMs: null,
      completed: false,
      aborted: false,
      stopReason: null,
      userData: {},
      startMetadata: clean(additionalRunMetadata),
      finishMetadata: {},
      trialCount: 0,
      syncState: 'pending',
      syncedAt: null,
      syncError: null,
    };
    this.run = { completed: false, aborted: false, runId: this.record.runId };
    await putRun(this.record);
    return true;
  }

  // Trials are written strictly in order (a serial chain) because downstream scoring
  // relies on order, and core-tasks fires writeTrial without awaiting it.
  writeTrial(trialData: Record<string, unknown>) {
    const record = this.requireRun();
    if (this.run?.aborted) return Promise.resolve();
    const missing = REQUIRED_TRIAL_KEYS.filter((k) => !(k in trialData) || trialData[k] == null);
    if (missing.length) {
      return Promise.reject(new Error(`Trial is missing required keys: ${missing.join(', ')}`));
    }
    const now = new Date();
    const trial: OfflineTrialRecord = {
      runId: record.runId,
      trialIndex: this.trialIndex++,
      clientTimestamp: now.toISOString(),
      clientTimestampMs: now.getTime(),
      data: { ...clean(trialData), taskId: this.input.taskId },
    };
    this.writeChain = this.writeChain.then(() => appendTrial(trial));
    return this.writeChain.then(() => undefined);
  }

  async finishRun(finishingMetaData: Record<string, unknown> = {}) {
    const record = this.requireRun();
    if (this.run?.aborted) return false;
    await this.writeChain;
    const now = new Date();
    const patch: Partial<OfflineRunRecord> = {
      completed: true,
      timeFinished: now.toISOString(),
      timeFinishedMs: now.getTime(),
      finishMetadata: clean(finishingMetaData),
      trialCount: this.trialIndex,
    };
    Object.assign(record, patch);
    await updateRun(record.runId, patch);
    if (this.run) this.run.completed = true;
    return true;
  }

  abortRun() {
    if (!this.record || !this.run) return;
    this.run.aborted = true;
    this.record.aborted = true;
    void updateRun(this.record.runId, { aborted: true });
  }

  async updateUser(userData: Record<string, unknown>) {
    const record = this.requireRun();
    record.userData = { ...record.userData, ...clean(userData) };
    await updateRun(record.runId, { userData: record.userData });
  }

  async updateStopReason(stopReason: string) {
    // core-tasks calls this before startRun has necessarily resolved; tolerate that.
    if (!this.record) return;
    this.record.stopReason = stopReason;
    await updateRun(this.record.runId, { stopReason });
  }

  private requireRun() {
    if (!this.record) throw new Error('Run has not been started yet. Use the startRun method first.');
    return this.record;
  }
}

// jsPsych trial data can carry URL objects and undefined values; make it structured-cloneable.
function clean(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, cleanValue(v)]),
  );
}

function cleanValue(v: unknown): unknown {
  if (v instanceof URL) return v.toString();
  if (Array.isArray(v)) return v.map(cleanValue);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return clean(v as Record<string, unknown>);
  }
  if (typeof v === 'function') return undefined;
  return v;
}
