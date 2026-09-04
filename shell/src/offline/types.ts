export interface RosterEntry {
  localId: string;
  /** Firebase uid (`roarUid`); always set when provisioned from an administration. */
  uid: string | null;
  displayName: string;
  assessmentPid?: string | null;
  birthMonth: number;
  birthYear: number;
  /** Task ids assigned to this child within the administration. */
  taskIds?: string[];
}

export interface PackTaskConfig {
  taskId: string;
  label?: string;
  variantId?: string | null;
  variantName?: string | null;
  variantParams: Record<string, unknown>;
}

export type PackStatus = 'downloading' | 'ready' | 'error';

/** A provisioned administration: everything the device needs to assess offline. */
export interface PackRecord {
  packId: string;
  administrationId: string;
  name: string;
  locale: string;
  dateClosed: string | null;
  tasks: PackTaskConfig[];
  children: RosterEntry[];
  /** Server clock at provisioning vs device clock, for skew diagnostics. */
  serverNowMs: number;
  deviceNowMs: number;
  provisionedAt: string;
  provisionedBy: string;
  status: PackStatus;
  error: string | null;
  fileCount: number;
  filesDone: number;
  totalBytes: number;
  corpora: Record<string, { corpus: string; sha256: string }>;
}

export type SyncState = 'pending' | 'synced' | 'error';

export interface OfflineRunRecord {
  runId: string;
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
  child: {
    localId: string;
    uid: string | null;
    assessmentPid: string | null;
    birthMonth: number;
    birthYear: number;
  };
  timeStarted: string;
  timeStartedMs: number;
  timeFinished: string | null;
  timeFinishedMs: number | null;
  completed: boolean;
  aborted: boolean;
  stopReason: string | null;
  userData: Record<string, unknown>;
  startMetadata: Record<string, unknown>;
  finishMetadata: Record<string, unknown>;
  trialCount: number;
  syncState: SyncState;
  syncedAt: string | null;
  syncError: string | null;
}

export interface OfflineTrialRecord {
  runId: string;
  trialIndex: number;
  clientTimestamp: string;
  clientTimestampMs: number;
  data: Record<string, unknown>;
}

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  deviceId: string;
  runs: Array<OfflineRunRecord & { trials: OfflineTrialRecord[] }>;
}
