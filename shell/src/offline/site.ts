import { callFunction } from './auth';
import { logError } from './sentry';

const SELECTED_SITE_KEY = 'levante-offline:selected-site';
const LAST_PACK_KEY = 'levante-offline:last-pack-link';

export interface AdministrationSummary {
  id: string;
  name: string;
  dateClosed: string | null;
  tasks: string[];
  districts: string[];
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
  const [adminRes, savedRes] = await Promise.all([
    callFunction<{ status: string; data: Array<Record<string, unknown>> }>('getAdministrations', {
      idsOnly: false,
    }),
    callFunction<{ status: string; packs: Array<{ siteId?: string; siteName?: string }> }>(
      'listOfflinePacks',
      {},
    ).catch((err) => {
      logError('listOfflinePacks failed', err);
      return { status: 'ok', packs: [] };
    }),
  ]);
  const administrations = (adminRes.data ?? []).map((a) => ({
    id: String(a.id),
    name: String(a.publicName ?? a.name ?? a.id),
    dateClosed: toDateString(a.dateClosed),
    tasks: Array.isArray(a.assessments) ? a.assessments.map((x: { taskId?: string }) => String(x.taskId)) : [],
    districts: Array.isArray(a.districts) ? a.districts.map((id: unknown) => String(id)) : [],
  }));
  const names: Record<string, string> = {};
  for (const pack of savedRes.packs ?? []) {
    if (pack.siteId && pack.siteName) names[pack.siteId] = pack.siteName;
  }
  const ids = new Set<string>();
  for (const admin of administrations) {
    for (const siteId of admin.districts) ids.add(siteId);
  }
  const sites = [...ids]
    .map((id) => ({ id, name: names[id] || id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { administrations, sites };
}

function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const v = value as { _seconds?: number; seconds?: number };
  const secs = v._seconds ?? v.seconds;
  return typeof secs === 'number' ? new Date(secs * 1000).toISOString().slice(0, 10) : null;
}
