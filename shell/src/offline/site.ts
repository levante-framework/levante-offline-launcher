import { callFunction, getSession } from './auth';
import { logError } from './sentry';

const SELECTED_SITE_KEY = 'levante-offline:selected-site';
const LAST_PACK_KEY = 'levante-offline:last-pack-link';

export interface AdministrationSummary {
  id: string;
  name: string;
  dateClosed: string | null;
  tasks: string[];
  siteId: string | null;
  districts: string[];
}

export function administrationMatchesSite(
  admin: Pick<AdministrationSummary, 'siteId' | 'districts'>,
  siteId: string,
): boolean {
  return admin.siteId === siteId || admin.districts.includes(siteId);
}

export interface SelectedSite {
  id: string;
  name: string;
}

export interface PackLink {
  admin: string;
  orgType: 'school' | 'class' | 'cohort' | null;
  orgId: string | null;
}

export interface SiteCatalog {
  administrations: AdministrationSummary[];
  sites: SelectedSite[];
}

export function getSelectedSite(): SelectedSite | null {
  try {
    const raw = localStorage.getItem(SELECTED_SITE_KEY);
    if (!raw) return null;
    const site = JSON.parse(raw) as SelectedSite;
    return site?.id ? site : null;
  } catch {
    return null;
  }
}

export function setSelectedSite(site: SelectedSite | null) {
  if (!site) localStorage.removeItem(SELECTED_SITE_KEY);
  else localStorage.setItem(SELECTED_SITE_KEY, JSON.stringify(site));
}

function parsePackLink(hash: string): PackLink | null {
  if (!hash.startsWith('#/provision')) return null;
  const qStart = hash.indexOf('?');
  if (qStart < 0) return null;
  const query = new URLSearchParams(hash.slice(qStart));
  const admin = query.get('admin');
  if (!admin) return null;
  const orgType = query.get('orgType');
  const orgId = query.get('orgId');
  return {
    admin,
    orgType: orgType === 'school' || orgType === 'class' || orgType === 'cohort' ? orgType : null,
    orgId,
  };
}

/** Saves a pack-link hash, then returns that link or the last one stored. */
export function readPackLink(): PackLink | null {
  const fromHash = parsePackLink(window.location.hash);
  if (fromHash) {
    sessionStorage.setItem(LAST_PACK_KEY, JSON.stringify(fromHash));
    return fromHash;
  }
  try {
    const raw = sessionStorage.getItem(LAST_PACK_KEY);
    return raw ? (JSON.parse(raw) as PackLink) : null;
  } catch {
    return null;
  }
}

export async function loadSiteCatalog(): Promise<SiteCatalog> {
  const namesFromToken = siteNamesFromToken();
  const [adminRows, savedRes] = await Promise.all([
    loadAdministrations(Object.keys(namesFromToken)),
    callFunction<{ status: string; packs: Array<{ siteId?: string; siteName?: string }> }>(
      'listOfflinePacks',
      {},
    ).catch((err) => {
      logError('listOfflinePacks failed', err);
      return { status: 'ok', packs: [] };
    }),
  ]);
  const administrations = adminRows.map((a) => ({
    id: String(a.id),
    name: String(a.publicName ?? a.name ?? a.id),
    dateClosed: toDateString(a.dateClosed),
    tasks: Array.isArray(a.tasks)
      ? a.tasks.map((taskId: unknown) => String(taskId))
      : Array.isArray(a.assessments)
        ? a.assessments.map((x: { taskId?: string }) => String(x.taskId))
        : [],
    siteId: typeof a.siteId === 'string' && a.siteId ? a.siteId : null,
    districts: Array.isArray(a.districts) ? a.districts.map((id: unknown) => String(id)) : [],
  }));
  const names: Record<string, string> = { ...namesFromToken };
  for (const pack of savedRes.packs ?? []) {
    if (pack.siteId && pack.siteName) names[pack.siteId] = pack.siteName;
  }
  const ids = new Set<string>();
  for (const admin of administrations) {
    if (admin.siteId) ids.add(admin.siteId);
    for (const siteId of admin.districts) ids.add(siteId);
  }
  const sites = [...ids]
    .map((id) => ({ id, name: names[id] || id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { administrations, sites };
}

async function loadAdministrations(siteIds: string[]): Promise<Array<Record<string, unknown>>> {
  const requests = siteIds.length
    ? siteIds.map((siteId) =>
        callFunction<{ status: string; data: Array<Record<string, unknown>> }>('getAdministrations', {
          idsOnly: false,
          summary: true,
          siteId,
        }),
      )
    : [
        callFunction<{ status: string; data: Array<Record<string, unknown>> }>('getAdministrations', {
          idsOnly: false,
          summary: true,
        }),
      ];
  const responses = await Promise.all(requests);
  const byId = new Map<string, Record<string, unknown>>();
  for (const res of responses) {
    for (const row of res.data ?? []) {
      if (row?.id != null) byId.set(String(row.id), row);
    }
  }
  return [...byId.values()];
}

function siteNamesFromToken(): Record<string, string> {
  const token = getSession()?.idToken;
  if (!token) return {};
  try {
    const part = token.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(pad)) as { siteNames?: Record<string, unknown> };
    const names: Record<string, string> = {};
    for (const [id, name] of Object.entries(payload.siteNames ?? {})) {
      if (!id) continue;
      names[id] = typeof name === 'string' && name.trim() ? name : id;
    }
    return names;
  } catch {
    return {};
  }
}

function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const v = value as { _seconds?: number; seconds?: number };
  const secs = v._seconds ?? v.seconds;
  return typeof secs === 'number' ? new Date(secs * 1000).toISOString().slice(0, 10) : null;
}
