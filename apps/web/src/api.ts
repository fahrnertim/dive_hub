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
  constructor(
    message: string, readonly status: number, readonly code?: ProblemCode,
    /** The Provider a provider_* code is about, named for the translated text (ADR 0027). */
    readonly provider?: { id: string; name: string },
    /** What else the refusal says: what is unmet (ADR 0029), the Diver that has an account already (ADR 0028). */
    readonly details: { unmet?: UnmetView[]; diver?: { id: string; name: string; dives?: number } } = {},
  ) {
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
export type ProviderView = Awaited<ReturnType<typeof fetchProviders>>[number];
export type ConnectionView = Awaited<ReturnType<typeof fetchConnections>>[number];
export type ProviderStatusView = Awaited<ReturnType<typeof fetchProviderStatus>>;
export type PushView = ProviderStatusView['pushes'][number];
export type RemoteSiteView = Awaited<ReturnType<typeof fetchProviderSites>>[number];
export type RequirementView = NonNullable<NonNullable<ProviderView['data']['dives']>['export']>['requirements'][number];
export type UnmetView = ProviderStatusView['unmet'][number];
export type LeftOutView = NonNullable<PushView['leftOut']>[number];
export type ParticipantView = DiveView['participants'][number];
export type ParticipantRole = ParticipantView['role'];
export type FoundDiverView = Awaited<ReturnType<typeof fetchDiverSearch>>[number];
export type ExternalDiverView = Awaited<ReturnType<typeof fetchExternalDivers>>['divers'][number];
export type BuddyView = Awaited<ReturnType<typeof fetchBuddies>>[number];
export type DiveImportPreview = Awaited<ReturnType<typeof fetchDiveImportPreview>>;
export type DiveImportMode = NonNullable<ConnectionView['diveImport']>['mode'];
export type UtcOffsetSource = DiveView['utcOffsetSource'];

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
  providers: ['providers'] as const,
  connections: ['connections'] as const,
  /** The Dive at every Provider; one Provider's state sits under it, so refreshing this refreshes both. */
  diveProviders: (diveId: string) => ['dives', diveId, 'providers'] as const,
  providerStatus: (diveId: string, provider: string) => ['dives', diveId, 'providers', provider] as const,
  providerSites: (diveId: string, provider: string) => ['dives', diveId, 'providers', provider, 'sites'] as const,
  /** Every Diver of the instance by name (ADR 0028); under ['divers'], so changing a Diver refreshes searches. */
  diverSearch: (q: string) => ['divers', 'search', q] as const,
  externalDivers: (q: string) => ['divers', 'external', q] as const,
  /** The account's list of people at a Provider; under ['connections']. */
  buddies: (connectionId: string) => ['connections', connectionId, 'buddies'] as const,
  /** What importing the account's dives would do (ADR 0030); under ['connections']. */
  diveImport: (connectionId: string) => ['connections', connectionId, 'dive-import'] as const,
  importOf: (id: string) => ['imports', id] as const,
  /** Admins: whether Dive sites may be made from a Provider's site data (ADR 0030). */
  siteData: ['admin', 'provider-site-data'] as const,
};

/**
 * The response body, or an ApiError. Success is the HTTP status: a 204 has no body, so openapi-fetch
 * gives `data: undefined` for it.
 */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (!result.response.ok) {
    // Our routes answer { error }; Fastify's validation errors carry the useful text in `message`.
    const body = result.error as {
      code?: ProblemCode; error?: string; message?: string; provider?: string; providerName?: string;
      unmet?: UnmetView[]; diver?: { id: string; name: string; dives?: number };
    } | undefined;
    const message = body?.error ?? body?.message ?? `Request failed (${result.response.status})`;
    const provider = body?.provider ? { id: body.provider, name: body.providerName ?? body.provider } : undefined;
    throw new ApiError(message, result.response.status, body?.code, provider, {
      ...(body?.unmet && { unmet: body.unmet }), ...(body?.diver && { diver: body.diver }),
    });
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
/** The User's deleted Dives, to restore them, and which Providers they are still at (ADR 0026, 0027). */
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

async function fetchProviders() {
  return unwrap(await api.GET('/api/providers'));
}
async function fetchConnections() {
  return unwrap(await api.GET('/api/connections'));
}
async function fetchDiveProviders(diveId: string) {
  return unwrap(await api.GET('/api/dives/{id}/providers', { params: { path: { id: diveId } } }));
}
async function fetchProviderStatus(diveId: string, provider: string) {
  return unwrap(await api.GET('/api/dives/{id}/providers/{provider}', { params: { path: { id: diveId, provider } } }));
}
async function fetchProviderSites(diveId: string, provider: string) {
  return unwrap(await api.GET('/api/dives/{id}/providers/{provider}/sites', { params: { path: { id: diveId, provider } } }));
}
/** The Providers of this server and what each offers (ADR 0027); they change only with the server. */
export const providersQuery = () => queryOptions({ queryKey: keys.providers, queryFn: fetchProviders, staleTime: Infinity });
/** The User's Connections to Providers (ADR 0024). */
export const connectionsQuery = () => queryOptions({ queryKey: keys.connections, queryFn: fetchConnections });
/** The Dive at every Provider that takes dives (for the delete dialog). */
export const diveProvidersQuery = (diveId: string) => queryOptions({ queryKey: keys.diveProviders(diveId), queryFn: () => fetchDiveProviders(diveId) });
/** A Dive at one Provider: its Diver's Connection, what is unmet (ADR 0029), the remote dive it has, its Pushes. */
export const providerStatusQuery = (diveId: string, provider: string) =>
  queryOptions({ queryKey: keys.providerStatus(diveId, provider), queryFn: () => fetchProviderStatus(diveId, provider) });
async function fetchDiverSearch(q: string) {
  return unwrap(await api.GET('/api/divers/search', { params: { query: { q, limit: 20 } } })).divers;
}
/** Every Diver of the instance whose name matches, the User's own first (ADR 0028). */
export const diverSearchQuery = (q: string) =>
  queryOptions({ queryKey: keys.diverSearch(q), queryFn: () => fetchDiverSearch(q), placeholderData: keepPreviousData });

async function fetchExternalDivers(q: string) {
  return unwrap(await api.GET('/api/external-divers', { params: { query: { ...(q && { q }), limit: 200 } } }));
}
/** People Users dived with who keep no logbook here (ADR 0028). */
export const externalDiversQuery = (q = '') =>
  queryOptions({ queryKey: keys.externalDivers(q), queryFn: () => fetchExternalDivers(q), placeholderData: keepPreviousData });

async function fetchBuddies(connectionId: string) {
  return unwrap(await api.GET('/api/connections/{id}/buddies', { params: { path: { id: connectionId } } })).buddies;
}
/** The account's list of people at the Provider (SSI's buddy list); asks the Provider, so only when the User opens it. */
export const buddiesQuery = (connectionId: string) =>
  queryOptions({ queryKey: keys.buddies(connectionId), queryFn: () => fetchBuddies(connectionId), staleTime: 2 * 60_000 });

async function fetchDiveImportPreview(connectionId: string) {
  return unwrap(await api.GET('/api/connections/{id}/dive-import', { params: { path: { id: connectionId } } }));
}
/** What importing the account's dives would do now (ADR 0030); reads the Provider, so only when the User asks. */
export const diveImportPreviewQuery = (connectionId: string) =>
  queryOptions({ queryKey: keys.diveImport(connectionId), queryFn: () => fetchDiveImportPreview(connectionId), staleTime: Infinity, retry: false });

/** Admins: per Provider whose dives Users import, whether new Dive sites may be made from its site data (ADR 0030). */
export const siteDataQuery = () => queryOptions({
  queryKey: keys.siteData, queryFn: async () => unwrap(await api.GET('/api/admin/provider-site-data')).providers,
});
export type SiteDataView = Awaited<ReturnType<NonNullable<ReturnType<typeof siteDataQuery>['queryFn']>>>[number];

/** One Import, asked again every second while it runs (an import from a Provider, ADR 0030). */
export const importQuery = (id: string) => queryOptions({
  queryKey: keys.importOf(id),
  queryFn: async () => unwrap(await api.GET('/api/imports/{id}', { params: { path: { id } } })),
  refetchInterval: (q) => (q.state.data && (q.state.data.status === 'pending' || q.state.data.status === 'processing') ? 1000 : false),
});

/** The Provider's sites near the Dive, nearest first; asks the Provider, so only when the User wants to pick one. */
export const providerSitesQuery = (diveId: string, provider: string) =>
  queryOptions({ queryKey: keys.providerSites(diveId, provider), queryFn: () => fetchProviderSites(diveId, provider), staleTime: 5 * 60_000 });
