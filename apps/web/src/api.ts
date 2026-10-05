import { createApiClient, type paths } from '@dive-hub/api-client';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { createAuthClient } from 'better-auth/client';
import { SITES_PAGE, type SitesParams } from './lib/sites-list.ts';

export const api = createApiClient();
/** Better Auth's own endpoints (sign-in, sign-out) at /api/auth on this origin; the session is a cookie. */
export const authClient = createAuthClient();

/** The server's error codes (one list for every route; any problem response shows it). */
export type ProblemCode = paths['/api/dives/{id}']['get']['responses'][404]['content']['application/json']['code'];

/**
 * An API error with its HTTP status (a 401 anywhere sends the user back to sign-in) and the
 * server's error code, which the UI translates (ADR 0014).
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: ProblemCode) {
    super(message);
  }
}
export const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

/**
 * Retry a failed query once, but only when trying again can help: a network error or a server error.
 * A 4xx (not found, not allowed, signed out) stays the same, and retrying only delays the message.
 */
export const shouldRetry = (failures: number, error: unknown) =>
  failures < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500);

export type ImportView = Awaited<ReturnType<typeof fetchImports>>[number];
export type DiveSummary = Awaited<ReturnType<typeof fetchDives>>['dives'][number];
export type Me = NonNullable<Awaited<ReturnType<typeof fetchMe>>>;
export type InvitationView = Awaited<ReturnType<typeof fetchInvitations>>[number];
export type UserView = Awaited<ReturnType<typeof fetchUsers>>[number];
export type SessionView = Awaited<ReturnType<typeof fetchSessions>>[number];
export type DiveView = Awaited<ReturnType<typeof fetchDive>>;
export type DiveValues = DiveView['values'];
export type OverridableField = DiveView['overrides'][number];
export type RevisionView = Awaited<ReturnType<typeof fetchRevisions>>[number];
export type RecordingSummary = DiveView['recordings'][number]['summary'];
export type DiverView = Awaited<ReturnType<typeof fetchDivers>>[number];
export type DeviceView = Awaited<ReturnType<typeof fetchDevices>>[number];
export type CandidateView = Awaited<ReturnType<typeof fetchCandidates>>[number];
export type DeletedDiveView = Awaited<ReturnType<typeof fetchDeletedDives>>['dives'][number];
export type SiteView = Awaited<ReturnType<typeof fetchSite>>;
export type Position = NonNullable<SiteView['position']>;
export type ExternalIdView = SiteView['externalIds'][number];
export type SiteRevisionView = Awaited<ReturnType<typeof fetchSiteRevisions>>[number];
export type SiteImportView = Awaited<ReturnType<typeof fetchSiteImport>>;
export type SiteImportArea = SiteImportView['area'];
export type SsiConnectionView = Awaited<ReturnType<typeof fetchSsiConnections>>['connections'][number];
export type SsiStatusView = Awaited<ReturnType<typeof fetchSsiStatus>>;
export type SsiPushView = SsiStatusView['pushes'][number];
export type SsiSiteSuggestion = Awaited<ReturnType<typeof fetchSsiSites>>[number];

/** Query keys in one place (hierarchical, so invalidating ['dives'] covers every dive query). */
export const keys = {
  me: ['me'] as const,
  setup: ['setup'] as const,
  users: ['users'] as const,
  invitations: ['invitations'] as const,
  sessions: ['me', 'sessions'] as const,
  imports: ['imports'] as const,
  dives: ['dives'] as const,
  dive: (id: string) => ['dives', id] as const,
  /** Under ['dives'], so whatever changes the logbook refreshes it too (ADR 0026). */
  deletedDives: ['dives', 'deleted'] as const,
  revisions: (id: string) => ['dives', id, 'revisions'] as const,
  divers: ['divers'] as const,
  devices: ['devices'] as const,
  candidates: (status: 'open' | 'discarded') => ['candidates', status] as const,
  samples: (recordingId: string) => ['recordings', recordingId, 'samples'] as const,
  sites: ['sites'] as const,
  site: (id: string) => ['sites', id] as const,
  siteRevisions: (id: string) => ['sites', id, 'revisions'] as const,
  siteImports: ['site-imports'] as const,
  ssiConnections: ['connections', 'ssi'] as const,
  ssi: (diveId: string) => ['dives', diveId, 'ssi'] as const,
  ssiSites: (diveId: string) => ['dives', diveId, 'ssi', 'sites'] as const,
};

/**
 * The response body, or an ApiError. Success is the HTTP status: a 204 has no body, so openapi-fetch
 * gives `data: undefined` for it.
 */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (!result.response.ok) {
    // Our routes answer { error }; Fastify's validation errors carry the useful text in `message`.
    const body = result.error as { code?: ProblemCode; error?: string; message?: string } | undefined;
    const message = body?.error ?? body?.message ?? `Request failed (${result.response.status})`;
    throw new ApiError(message, result.response.status, body?.code);
  }
  return result.data as T;
}

/** The signed-in User, or null when nobody is signed in. */
async function fetchMe() {
  const result = await api.GET('/api/me');
  return result.response.status === 401 ? null : unwrap(result);
}
async function fetchInvitations() {
  return unwrap(await api.GET('/api/invitations'));
}
async function fetchUsers() {
  return unwrap(await api.GET('/api/users'));
}
async function fetchSessions() {
  return unwrap(await api.GET('/api/me/sessions'));
}

export const meQuery = () => queryOptions({ queryKey: keys.me, queryFn: fetchMe, staleTime: 5 * 60_000 });
export const setupQuery = () =>
  queryOptions({ queryKey: keys.setup, queryFn: async () => unwrap(await api.GET('/api/setup')) });
export const usersQuery = () => queryOptions({ queryKey: keys.users, queryFn: fetchUsers });
export const sessionsQuery = () => queryOptions({ queryKey: keys.sessions, queryFn: fetchSessions });
export const invitationsQuery = () => queryOptions({ queryKey: keys.invitations, queryFn: fetchInvitations });

async function fetchImports() {
  return unwrap(await api.GET('/api/imports'));
}
async function fetchDives() {
  return unwrap(await api.GET('/api/dives'));
}

export const importsQuery = () =>
  queryOptions({
    queryKey: keys.imports,
    queryFn: fetchImports,
    // Poll while an Import is still being processed.
    refetchInterval: (q) => (q.state.data?.some((i) => i.status === 'pending' || i.status === 'processing') ? 1000 : false),
  });

/** What the logbook shows (ADR 0017); it lives in the address, e.g. "#/?sort=maxDepth&page=2". */
export interface LogbookParams {
  diverId?: string | undefined;
  /** Only Dives at this Dive site. */
  siteId?: string | undefined;
  q?: string | undefined;
  sort?: 'startsAt' | 'number' | 'maxDepth' | 'duration' | undefined;
  order?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
}
export const PAGE_SIZE = 50;

/** One page of the logbook. The previous page stays on screen while the next one loads. */
export const divesQuery = (p: LogbookParams = {}) => queryOptions({
  queryKey: [...keys.dives, { ...p }],
  queryFn: async () => unwrap(await api.GET('/api/dives', {
    params: {
      query: {
        ...(p.diverId && { diverId: p.diverId }), ...(p.siteId && { siteId: p.siteId }), ...(p.q && { q: p.q }), ...(p.sort && { sort: p.sort }), ...(p.order && { order: p.order }),
        limit: PAGE_SIZE, offset: ((p.page ?? 1) - 1) * PAGE_SIZE,
      },
    },
  })),
  placeholderData: keepPreviousData,
});

async function fetchDive(id: string) {
  return unwrap(await api.GET('/api/dives/{id}', { params: { path: { id } } }));
}
async function fetchRevisions(id: string) {
  return unwrap(await api.GET('/api/dives/{id}/revisions', { params: { path: { id } } }));
}

async function fetchDivers() {
  return unwrap(await api.GET('/api/divers'));
}
async function fetchDevices() {
  return unwrap(await api.GET('/api/devices'));
}
async function fetchCandidates(status: 'open' | 'discarded') {
  return unwrap(await api.GET('/api/duplicate-candidates', { params: { query: { status } } }));
}

export const diversQuery = () => queryOptions({ queryKey: keys.divers, queryFn: fetchDivers });
export const devicesQuery = () => queryOptions({ queryKey: keys.devices, queryFn: fetchDevices });
export const candidatesQuery = (status: 'open' | 'discarded') =>
  queryOptions({ queryKey: keys.candidates(status), queryFn: () => fetchCandidates(status) });

async function fetchDeletedDives() {
  return unwrap(await api.GET('/api/dives/deleted'));
}
/** The User's deleted Dives, to restore them, and which are still in SSI (ADR 0026). */
export const deletedDivesQuery = () => queryOptions({ queryKey: keys.deletedDives, queryFn: fetchDeletedDives });

export const diveQuery = (id: string) => queryOptions({ queryKey: keys.dive(id), queryFn: () => fetchDive(id) });
export const revisionsQuery = (id: string) => queryOptions({ queryKey: keys.revisions(id), queryFn: () => fetchRevisions(id) });

export const samplesQuery = (recordingId: string) =>
  queryOptions({
    queryKey: keys.samples(recordingId),
    queryFn: async () =>
      unwrap(await api.GET('/api/recordings/{id}/samples', {
        params: { path: { id: recordingId }, query: { channels: 'depth,temperature', maxPoints: 2000 } },
      })),
    staleTime: Infinity,
  });

async function fetchSite(id: string) {
  return unwrap(await api.GET('/api/dive-sites/{id}', { params: { path: { id } } }));
}

/** Dive sites (ADR 0020): searched by words, or the ones near a position, nearest first. */
export const sitesQuery = (p: SitesParams & { near?: Position | undefined; within?: number | undefined } = {}) => queryOptions({
  queryKey: [...keys.sites, { q: p.q, country: p.country, mine: p.mine, sort: p.sort, order: p.order, page: p.page, near: p.near, within: p.within }],
  queryFn: async () => unwrap(await api.GET('/api/dive-sites', {
    params: {
      query: {
        ...(p.q && { q: p.q }), ...(p.country && { country: p.country }), ...(p.mine && { mine: true }),
        ...(p.sort && { sort: p.sort }), ...(p.order && { order: p.order }),
        ...(p.near && { latitude: p.near.latitude, longitude: p.near.longitude }), ...(p.within && { within: p.within }),
        limit: SITES_PAGE, offset: ((p.page ?? 1) - 1) * SITES_PAGE,
      },
    },
  })),
  placeholderData: keepPreviousData,
});
export const siteQuery = (id: string) => queryOptions({ queryKey: keys.site(id), queryFn: () => fetchSite(id) });

async function fetchSiteRevisions(id: string) {
  return unwrap(await api.GET('/api/dive-sites/{id}/revisions', { params: { path: { id } } }));
}
/** A Dive site's history (ADR 0021): every User reads it; other Users are never named. */
export const siteRevisionsQuery = (id: string) => queryOptions({ queryKey: keys.siteRevisions(id), queryFn: () => fetchSiteRevisions(id) });

async function fetchSiteImport(id: string) {
  return unwrap(await api.GET('/api/admin/site-imports/{id}', { params: { path: { id } } }));
}
const running = (i: SiteImportView) => i.status === 'queued' || i.status === 'running';
/** The latest Site imports (admins, ADR 0021); asked again every two seconds while one runs. */
export const siteImportsQuery = () => queryOptions({
  queryKey: keys.siteImports,
  queryFn: async () => unwrap(await api.GET('/api/admin/site-imports')).imports,
  refetchInterval: (query) => (query.state.data?.some(running) ? 2000 : false),
});

export async function uploadFile(file: File) {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/imports', { method: 'POST', body });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { code?: ProblemCode; error?: string };
    throw new ApiError(problem.error ?? `Upload failed (${response.status})`, response.status, problem.code);
  }
}

async function fetchSsiConnections() {
  return unwrap(await api.GET('/api/connections/ssi'));
}
async function fetchSsiStatus(diveId: string) {
  return unwrap(await api.GET('/api/dives/{id}/ssi', { params: { path: { id: diveId } } }));
}
async function fetchSsiSites(diveId: string) {
  return unwrap(await api.GET('/api/dives/{id}/ssi/sites', { params: { path: { id: diveId } } }));
}
/** The User's SSI Connections (ADR 0024), and whether the server can keep passwords. */
export const ssiConnectionsQuery = () => queryOptions({ queryKey: keys.ssiConnections, queryFn: fetchSsiConnections });
/** A Dive at SSI: its Diver's Connection, the SSI site ID, the SSI dive it has, its Pushes. */
export const ssiStatusQuery = (diveId: string) => queryOptions({ queryKey: keys.ssi(diveId), queryFn: () => fetchSsiStatus(diveId) });
/** Sites from the User's SSI logbook, nearest first; asks SSI, so only when the User wants to pick one. */
export const ssiSitesQuery = (diveId: string) => queryOptions({ queryKey: keys.ssiSites(diveId), queryFn: () => fetchSsiSites(diveId), staleTime: 5 * 60_000 });
