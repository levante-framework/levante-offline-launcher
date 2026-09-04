export type ProgressState = 'assigned' | 'started' | 'completed';

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
  /** Per-task progress as of provisioning (what other devices / online sessions already collected). */
  progress?: Record<string, ProgressState>;
}

export interface PackTaskConfig {
  taskId: string;
  label?: string;
  variantId?: string | null;
  variantName?: string | null;
  variantParams: Record<string, unknown>;
}

/** The school or cohort a device is provisioned for. */
export interface PackScope {
  orgType: 'school' | 'cohort';
  orgId: string;
  name: string;
  siteId: string;
}

export type PackStatus = 'downloading' | 'ready' | 'error';

/** A provisioned administration: everything the device needs to assess offline. */
export interface PackRecord {
  packId: string;
  administrationId: string;
  name: string;
  siteId?: string | null;
  /** null = the whole site (an administration with no schools/cohorts to scope to). */
  scope?: PackScope | null;
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
  /** Content-addressed bundles the pack was assembled from, by unit (`task/<id>/<locale>`, `shared/<locale>`). */
  bundles?: Record<string, { bundleId: string; bytes: number; files: number }>;
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
  /** Content id of the task's asset bundle (null when the pack came from a folder listing). */
  bundleId: string | null;
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
