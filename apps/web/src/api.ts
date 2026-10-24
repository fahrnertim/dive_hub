import { createApiClient, type paths } from '@dive-hub/api-client';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { createAuthClient } from 'better-auth/client';
import { SITES_PAGE, type SitesParams } from './lib/sites-list.ts';
import type { LogbookParams, neighbourParams } from './lib/logbook.ts';
import { BOTTOM_TIME_RULES, type ToolsParams } from './lib/tools.ts';

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
    readonly details: {
      unmet?: UnmetView[]; diver?: { id: string; name: string; dives?: number }; centre?: { id: string; name: string };
      /** With provider_number_taken: the dive at the Provider that has the number, and the Dive here it is (ADR 0048). */
      existing?: { remoteId: string; number: number | null; startsAt: string | null }; diveId?: string | null;
      /** With push_run_active: the run that is going (ADR 0047). */
      runId?: string;
    } = {},
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
/** A page of the logbook with its counts, totals and months (ADR 0040). */
export type LogbookPage = Awaited<ReturnType<typeof fetchDives>>;
export type DiveSummary = LogbookPage['dives'][number];
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
type AnyLogbookCheck = Awaited<ReturnType<typeof fetchLogbookChecks>>[number];
/** A logbook check about two Dives (ADR 0038). */
export type LogbookCheckView = AnyLogbookCheck & { rule: Exclude<AnyLogbookCheck['rule'], 'short_shallow_dive'>; other: NonNullable<AnyLogbookCheck['other']> };
/** A logbook check about one Dive: probably no dive, to delete or to keep. */
export type DiveCheckView = AnyLogbookCheck & { rule: 'short_shallow_dive'; other: null };
export const isPairCheck = (c: AnyLogbookCheck): c is LogbookCheckView => c.other !== null;
export const isDiveCheck = (c: AnyLogbookCheck): c is DiveCheckView => c.other === null;
export type MergeCandidateView = Awaited<ReturnType<typeof fetchMergeCandidates>>[number];
export type DeletedDiveView = Awaited<ReturnType<typeof fetchDeletedDives>>['dives'][number];
export type SiteView = Awaited<ReturnType<typeof fetchSite>>;
export type Position = NonNullable<SiteView['position']>;
export type ExternalIdView = SiteView['externalIds'][number];
export type CentreView = Awaited<ReturnType<typeof fetchCentre>>;
export type VerificationCodeView = NonNullable<CentreView['verificationCode']>;
/** A Diver's details and codes as every User sees them (ADR 0043). */
export type DiverDetailsView = Awaited<ReturnType<typeof fetchDiverDetails>>;
/** What the server says a scanned or pasted code is. */
export type ReadCodeView = paths['/api/verification-codes/read']['post']['responses'][200]['content']['application/json'];
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
  /** Logbook checks (ADR 0038); under ['dives'], so whatever changes the logbook computes them again. */
  logbookChecks: (status: 'open' | 'answered') => ['dives', 'checks', status] as const,
  /** Dives this one may be merged with (ADR 0038); under the Dive, so whatever changes it asks again. */
  mergeCandidates: (id: string) => ['dives', id, 'merge-candidates'] as const,
  /** The Dive's assessment (ADR 0036); under the Dive, so whatever changes it reads the findings again. */
  assessment: (id: string) => ['dives', id, 'assessment'] as const,
  divers: ['divers'] as const,
  devices: ['devices'] as const,
  candidates: (status: 'open' | 'discarded') => ['candidates', status] as const,
  samples: (recordingId: string) => ['recordings', recordingId, 'samples'] as const,
  sites: ['sites'] as const,
  site: (id: string) => ['sites', id] as const,
  siteRevisions: (id: string) => ['sites', id, 'revisions'] as const,
  /** Dive centres (ADR 0043). A Dive's codes follow them: whatever changes a centre also refreshes ['dives']. */
  centres: ['centres'] as const,
  centre: (id: string) => ['centres', id] as const,
  siteImports: ['site-imports'] as const,
  providers: ['providers'] as const,
  connections: ['connections'] as const,
  /** Dives gone at a Provider, waiting for the User's choice (ADR 0051). */
  goneDives: ['gone-dives'] as const,
  /** Conflicts with a Provider waiting for the User's choice (ADR 0056); a send from the Dive's page closes them. */
  providerConflicts: ['provider-conflicts'] as const,
  /** Push runs (ADR 0047): the User's list, one run with its items, and what a start would do. */
  pushRuns: ['push-runs'] as const,
  pushRun: (id: string) => ['push-runs', id] as const,
  pushRunPreview: (connectionId: string, body: unknown) => ['push-run-preview', connectionId, body] as const,
  /** The Dive at every Provider; one Provider's state sits under it, so refreshing this refreshes both. */
  diveProviders: (diveId: string) => ['dives', diveId, 'providers'] as const,
  providerStatus: (diveId: string, provider: string) => ['dives', diveId, 'providers', provider] as const,
  providerSites: (diveId: string, provider: string) => ['dives', diveId, 'providers', provider, 'sites'] as const,
  /** Every Diver of the instance by name (ADR 0028); under ['divers'], so changing a Diver refreshes searches. */
  diverSearch: (q: string) => ['divers', 'search', q] as const,
  externalDivers: (q: string) => ['divers', 'external', q] as const,
  /** A Diver's details and codes (ADR 0043); under ['divers']. */
  diverDetails: (id: string) => ['divers', id, 'details'] as const,
  /** A Diver's body weights (ADR 0031); only for the Users who keep the Diver. */
  bodyWeights: (id: string) => ['divers', id, 'body-weights'] as const,
  certifications: (id: string) => ['divers', id, 'certifications'] as const,
  /** The account's list of people at a Provider; under ['connections']. */
  buddies: (connectionId: string) => ['connections', connectionId, 'buddies'] as const,
  /** What importing the account's dives would do (ADR 0030); under ['connections']. */
  diveImport: (connectionId: string) => ['connections', connectionId, 'dive-import'] as const,
  diveTimes: (connectionId: string) => ['connections', connectionId, 'dive-times'] as const,
  importOf: (id: string) => ['imports', id] as const,
  /** Admins: whether Dive sites may be made from a Provider's site data (ADR 0030). */
  siteData: ['admin', 'provider-site-data'] as const,
  /** The User's AI accesses to the MCP endpoint (ADR 0035), and what they read. */
  aiAccess: ['me', 'ai-access'] as const,
  aiAccessLog: ['me', 'ai-access', 'log'] as const,
  /** Admins: the instance's switch for the MCP endpoint. */
  aiAccessSetting: ['admin', 'ai-access'] as const,
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
      unmet?: UnmetView[]; diver?: { id: string; name: string; dives?: number }; centre?: { id: string; name: string };
      existing?: { remoteId: string; number: number | null; startsAt: string | null }; diveId?: string | null; runId?: string;
    } | undefined;
    const message = body?.error ?? body?.message ?? `Request failed (${result.response.status})`;
    const provider = body?.provider ? { id: body.provider, name: body.providerName ?? body.provider } : undefined;
    throw new ApiError(message, result.response.status, body?.code, provider, {
      ...(body?.unmet && { unmet: body.unmet }), ...(body?.diver && { diver: body.diver }), ...(body?.centre && { centre: body.centre }),
      ...(body?.existing && { existing: body.existing }), ...(body?.diveId && { diveId: body.diveId }), ...(body?.runId && { runId: body.runId }),
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

export const PAGE_SIZE = 25;

/** One page of the logbook. The previous page stays on screen while the next one loads. */
export const divesQuery = (p: LogbookParams = {}) => queryOptions({
  queryKey: [...keys.dives, { ...p }],
  queryFn: async () => unwrap(await api.GET('/api/dives', {
    params: {
      query: {
        ...(p.diverId && { diverId: p.diverId }), ...(p.siteId && { siteId: p.siteId }), ...(p.q && { q: p.q }), ...(p.sort && { sort: p.sort }), ...(p.order && { order: p.order }),
        ...(p.only?.length && { only: p.only.join(',') }),
        limit: PAGE_SIZE, offset: ((p.page ?? 1) - 1) * PAGE_SIZE,
      },
    },
  })),
  placeholderData: keepPreviousData,
});

async function fetchDive(id: string) {
  return unwrap(await api.GET('/api/dives/{id}', { params: { path: { id } } }));
}
async function fetchCylinderCatalogue() {
  return unwrap(await api.GET('/api/cylinder-catalogue'));
}
/** The cylinder catalogue (ADR 0031): a list in the server's code, the same until the next release. */
export const cylinderCatalogueQuery = () =>
  queryOptions({ queryKey: ['cylinder-catalogue'] as const, queryFn: fetchCylinderCatalogue, staleTime: Infinity });
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

async function fetchLogbookChecks(status: 'open' | 'answered') {
  return unwrap(await api.GET('/api/logbook-checks', { params: { query: { status } } }));
}
/** Pairs of Dives that can't both be right as they stand, or those the User said are two dives (ADR 0038). */
export const logbookChecksQuery = (status: 'open' | 'answered') =>
  queryOptions({ queryKey: keys.logbookChecks(status), queryFn: () => fetchLogbookChecks(status) });
async function fetchMergeCandidates(id: string) {
  return unwrap(await api.GET('/api/dives/{id}/merge-candidates', { params: { path: { id } } }));
}
/** The Dives of the same Diver at the same time as this one, which it may be merged with (ADR 0038). */
export const mergeCandidatesQuery = (id: string) => queryOptions({ queryKey: keys.mergeCandidates(id), queryFn: () => fetchMergeCandidates(id) });
/** Every Dive of the same Diver from the day before to the day after: what a merge by hand chooses from (ADR 0038, amended). */
export const nearbyDivesQuery = (id: string) => queryOptions({
  queryKey: [...keys.mergeCandidates(id), 'nearby'] as const,
  queryFn: async () => unwrap(await api.GET('/api/dives/{id}/merge-candidates', { params: { path: { id }, query: { scope: 'nearby' } } })),
});

/** The Dives before and after one in a list's order (ADR 0042); under the Dive, so whatever changes the logbook asks again. */
export const diveNeighboursQuery = (id: string, list: ReturnType<typeof neighbourParams>) => queryOptions({
  queryKey: [...keys.dive(id), 'neighbours', list],
  queryFn: async () => unwrap(await api.GET('/api/dives/{id}/neighbours', { params: { path: { id }, query: list } })),
  placeholderData: keepPreviousData,
});
export interface NeighboursView { previous: { id: string } | null; next: { id: string } | null; position: number | null; total: number }
export const diveQuery = (id: string) => queryOptions({ queryKey: keys.dive(id), queryFn: () => fetchDive(id) });
async function fetchAssessment(id: string) {
  return unwrap(await api.GET('/api/dives/{id}/assessment', { params: { path: { id } } }));
}
/** A Dive's findings, the computer's own events and the ascent bands (ADR 0036). */
export const assessmentQuery = (id: string) => queryOptions({ queryKey: keys.assessment(id), queryFn: () => fetchAssessment(id) });
export type AssessmentView = Awaited<ReturnType<typeof fetchAssessment>>;

export const revisionsQuery = (id: string) => queryOptions({ queryKey: keys.revisions(id), queryFn: () => fetchRevisions(id) });

export const samplesQuery = (recordingId: string) =>
  queryOptions({
    queryKey: keys.samples(recordingId),
    queryFn: async () =>
      unwrap(await api.GET('/api/recordings/{id}/samples', {
        params: { path: { id: recordingId }, query: { channels: 'depth,temperature,tankPressure', maxPoints: 2000 } },
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

async function fetchCentre(id: string) {
  return unwrap(await api.GET('/api/dive-centres/{id}', { params: { path: { id } } }));
}
/** Dive centres (ADR 0043) by name: the ones matching words, or the ones of a Dive site. */
export const centresQuery = (p: { q?: string | undefined; siteId?: string | undefined } = {}) => queryOptions({
  queryKey: [...keys.centres, { q: p.q, siteId: p.siteId }],
  queryFn: async () => unwrap(await api.GET('/api/dive-centres', { params: { query: { ...(p.q && { q: p.q }), ...(p.siteId && { siteId: p.siteId }), limit: 100 } } })),
  placeholderData: keepPreviousData,
});
export const centreQuery = (id: string) => queryOptions({ queryKey: keys.centre(id), queryFn: () => fetchCentre(id) });

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
  return (await response.json()) as ImportView;
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

async function fetchDiverDetails(id: string) {
  return unwrap(await api.GET('/api/divers/{id}/details', { params: { path: { id } } }));
}
export const diverDetailsQuery = (id: string) => queryOptions({ queryKey: keys.diverDetails(id), queryFn: () => fetchDiverDetails(id) });
async function fetchBodyWeights(id: string) {
  return unwrap(await api.GET('/api/divers/{id}/body-weights', { params: { path: { id } } }));
}
export const bodyWeightsQuery = (id: string) => queryOptions({ queryKey: keys.bodyWeights(id), queryFn: () => fetchBodyWeights(id) });
async function fetchCertifications(id: string) {
  return unwrap(await api.GET('/api/divers/{id}/certifications', { params: { path: { id } } }));
}
/** A Diver's certification cards, newest first (ADR 0050). */
export const certificationsQuery = (id: string) => queryOptions({ queryKey: keys.certifications(id), queryFn: () => fetchCertifications(id) });
export type CertificationView = Awaited<ReturnType<typeof fetchCertifications>>[number];

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

async function fetchGoneDives() {
  return unwrap(await api.GET('/api/gone-dives'));
}
/** Dives whose remote dive is gone at a Provider, per Connection (ADR 0051); stored findings, no call to the Provider. */
export const goneDivesQuery = () => queryOptions({ queryKey: keys.goneDives, queryFn: fetchGoneDives });
export type GoneDivesOfConnection = Awaited<ReturnType<typeof fetchGoneDives>>[number];
export type GoneDiveView = GoneDivesOfConnection['dives'][number];

async function fetchProviderConflicts() {
  return unwrap(await api.GET('/api/provider-conflicts')).connections;
}
/** Conflicts with a Provider that wait for the User's choice, per Connection (ADR 0056); stored, no call to the Provider. */
export const providerConflictsQuery = () => queryOptions({ queryKey: keys.providerConflicts, queryFn: fetchProviderConflicts });
export type ConflictsOfConnection = Awaited<ReturnType<typeof fetchProviderConflicts>>[number];
export type ConflictEntryView = ConflictsOfConnection['entries'][number];
/** One field changed on both sides, with both values as the import preview says them. */
export type ConflictFieldView = ConflictEntryView['fields'][number];
/** A choice per Conflict: Dive Hub's value goes out (hub), or the Provider's comes in (provider). */
export type ConflictChoices = Partial<Record<ConflictFieldView['field'], 'hub' | 'provider'>>;

async function fetchDiveTimes(connectionId: string) {
  return unwrap(await api.GET('/api/connections/{id}/dive-times', { params: { path: { id: connectionId } } }));
}
/** How each dive at the Provider started and came about, to find why times differ (read only); reads the Provider, so only when asked. */
export const diveTimesQuery = (connectionId: string) =>
  queryOptions({ queryKey: keys.diveTimes(connectionId), queryFn: () => fetchDiveTimes(connectionId), staleTime: 0, gcTime: 0, retry: false });

/** Admins: per Provider whose dives Users import, whether new Dive sites may be made from its site data (ADR 0030). */
export const siteDataQuery = () => queryOptions({
  queryKey: keys.siteData, queryFn: async () => unwrap(await api.GET('/api/admin/provider-site-data')).providers,
});
export type SiteDataView = Awaited<ReturnType<NonNullable<ReturnType<typeof siteDataQuery>['queryFn']>>>[number];

async function fetchAiAccess() {
  return unwrap(await api.GET('/api/me/ai-access'));
}
/** The User's AI accesses and whether this instance offers the MCP endpoint (ADR 0035). */
export const aiAccessQuery = () => queryOptions({ queryKey: keys.aiAccess, queryFn: fetchAiAccess });
export type AiAccessView = Awaited<ReturnType<typeof fetchAiAccess>>['accesses'][number];

async function fetchAiAccessLog(limit: number) {
  return unwrap(await api.GET('/api/me/ai-access-log', { params: { query: { limit } } }));
}
/** What the User's AI accesses read, newest first; `limit` grows with "show older". */
export const aiAccessLogQuery = (limit: number) =>
  queryOptions({ queryKey: [...keys.aiAccessLog, limit] as const, queryFn: () => fetchAiAccessLog(limit), placeholderData: keepPreviousData });
export type AiAccessLogEntry = Awaited<ReturnType<typeof fetchAiAccessLog>>['entries'][number];

/** Admins: whether this instance offers the MCP endpoint, and how many AI accesses exist. */
export const aiAccessSettingQuery = () => queryOptions({
  queryKey: keys.aiAccessSetting, queryFn: async () => unwrap(await api.GET('/api/admin/ai-access')),
});

/** One Import, asked again every second while it runs (an import from a Provider, ADR 0030). */
export const importQuery = (id: string) => queryOptions({
  queryKey: keys.importOf(id),
  queryFn: async () => unwrap(await api.GET('/api/imports/{id}', { params: { path: { id } } })),
  refetchInterval: (q) => (q.state.data && (q.state.data.status === 'pending' || q.state.data.status === 'processing') ? 1000 : false),
});

/** The Provider's sites near the Dive, nearest first; asks the Provider, so only when the User wants to pick one. */
export const providerSitesQuery = (diveId: string, provider: string) =>
  queryOptions({ queryKey: keys.providerSites(diveId, provider), queryFn: () => fetchProviderSites(diveId, provider), staleTime: 5 * 60_000 });

/** The Tools page (ADR 0032): computed on request; the inputs come from the page's address. */
export type ToolsGas = Awaited<ReturnType<typeof fetchToolsGas>>;
export type ToolsBottomTime = Awaited<ReturnType<typeof fetchToolsBottomTime>>;
type ToolsInput = ToolsParams;
/** Leaves out what is undefined (the address holds only what was typed); the type claims every key, which the query's optional keys accept. */
const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };

async function fetchToolsGas(p: ToolsInput) {
  return unwrap(await api.GET('/api/tools/gas', {
    params: { query: defined({ o2: p.o2!, he: p.he, depth: p.depth, water: p.water, altitude: p.altitude, ppo2Working: p.pw, ppo2Contingency: p.pc, oxygenNarcotic: p.narcotic }) },
  }));
}
/** While the inputs are complete the last answer stays on screen until the next arrives, so the page doesn't blink; with incomplete inputs there is no answer. */
export const toolsGasQuery = (p: ToolsInput) => {
  const enabled = p.o2 !== undefined && p.o2 > 0;
  return queryOptions({
    queryKey: ['tools', 'gas', p] as const, queryFn: () => fetchToolsGas(p), enabled, retry: false,
    ...(enabled && { placeholderData: keepPreviousData }),
  });
};

/** A single bottom time knows three rules; the turn rules are for a plan with a return (ADR 0033). */
const bottomTimeRule = (p: ToolsInput) =>
  p.rule !== undefined && (BOTTOM_TIME_RULES as readonly string[]).includes(p.rule) ? { rule: p.rule as 'rock_bottom' | 'reserve' | 'ascent_pressure', bar: p.bar } : {};

async function fetchToolsBottomTime(p: ToolsInput, diverId: string | undefined) {
  return unwrap(await api.GET('/api/tools/bottom-time', {
    params: { query: defined({
      depth: p.depth!, o2: p.o2!, he: p.he, volume: p.volume, pressure: p.pressure, sac: p.sac, ...bottomTimeRule(p), gfHigh: p.gf,
      water: p.water, altitude: p.altitude, ppo2Working: p.pw, ppo2Contingency: p.pc, diverId,
    }) },
  }));
}
export const toolsBottomTimeQuery = (p: ToolsInput, diverId: string | undefined, ready: boolean) => {
  const enabled = ready && p.o2 !== undefined && p.o2 > 0 && p.depth !== undefined && p.depth > 0;
  return queryOptions({
    queryKey: ['tools', 'bottom-time', p, diverId] as const, queryFn: () => fetchToolsBottomTime(p, diverId), enabled, retry: false,
    ...(enabled && { placeholderData: keepPreviousData }),
  });
};

/** A gas plan (ADR 0033): the server's answer, read field by field. */
export interface ToolsPlanDiver {
  name: string;
  diverId: string | null;
  sacLpm: { value: number; source: 'request' | 'logbook' | 'default'; basedOn?: number };
  litres: number;
  endPressureBar: number;
  rockBottom: { depthM: number; pressureBar: number }[];
  ascentPressureBar: number;
  turnPressureBar: number | null;
  belowRockBottom: boolean;
  atAscentStartBar: number;
  marginBar: number;
  marginMinutes: number;
  controlling: boolean;
  recentDiveEndedAt: string | null;
  /** At the start and at the end of every segment. */
  pressuresBar: number[];
}
export type ToolsPlan =
  | { status: 'outside_limits'; reason: 'depth' | 'mod' | 'gas'; levelIndex: number | null }
  | {
    status: 'ok';
    runtimeMinutes: number;
    /** In the order they are dived; a level and the stop start and end at the same depth. */
    segments: { kind: 'descent' | 'level' | 'ascent' | 'safety_stop'; fromDepthM: number; depthM: number; minutes: number }[];
    divers: ToolsPlanDiver[];
    controllingIndex: number;
    fits: boolean;
    leaveLastLevelAtMinute: number;
    used: {
      water: { value: string; source: string }; altitudeM: { value: number; source: string }; gasRule: { value: { kind: string; bar: number | null }; source: string };
      descentRateMPerMin: { value: number; source: string }; ascentRateMPerMin: { value: number; source: string };
    };
  };

async function fetchToolsPlan(p: ToolsInput) {
  const answer = await unwrap(await api.GET('/api/tools/gas-plan', {
    params: { query: defined({
      // The plan's own mix (air when empty), never the one of "Your dive"; no helium: a plan is air or nitrox.
      o2: p.mix ?? 21, water: p.water, altitude: p.altitude, rule: p.rule, bar: p.bar, ppo2Contingency: p.pc, descentRate: p.dr, ascentRate: p.ar,
      levels: JSON.stringify((p.levels ?? []).map((l) => ({ depth: l.depth, minutes: l.minutes }))),
      divers: JSON.stringify((p.divers ?? []).map((d) => defined({ name: d.name, volume: d.volume, pressure: d.pressure, sac: d.sac, diverId: d.diverId }))),
    }) },
  }));
  return answer as unknown as ToolsPlan;
}
export const toolsPlanQuery = (p: ToolsInput) => {
  const enabled = (p.levels?.length ?? 0) > 0 && (p.divers?.length ?? 0) > 0;
  return queryOptions({
    queryKey: ['tools', 'plan', p] as const, queryFn: () => fetchToolsPlan(p), enabled, retry: false,
    ...(enabled && { placeholderData: keepPreviousData }),
  });
};

/** The lead estimate (ADR 0031): computed on request for a Diver the User keeps, in the unit the User counts in. */
export type LeadEstimate = Awaited<ReturnType<typeof fetchLeadEstimate>>;
async function fetchLeadEstimate(p: ToolsInput, diverId: string, unit: 'kg' | 'lb') {
  return unwrap(await api.GET('/api/divers/{id}/lead-estimate', {
    params: {
      path: { id: diverId },
      query: defined({
        water: p.leadWater!, suit: p.suit!, suitThicknessMm: p.suit === 'wetsuit' || p.suit === 'semidry' ? p.thicknessMm : undefined,
        suitHood: p.suit && p.suit !== 'none' ? p.hood : undefined, suitUndergarment: p.suit === 'drysuit' ? p.undergarment : undefined,
        cylinders: JSON.stringify((p.cylinders ?? []).map((c) => defined({ volumeL: c.volumeL, material: c.material }))), unit,
      }),
    },
  }));
}
/** Needs a Diver, the water, the suit and Cylinders with a volume each; the suit's details may stay empty (the answer says so). */
export const leadEstimateQuery = (p: ToolsInput, diverId: string | undefined, unit: 'kg' | 'lb') => {
  const enabled = diverId !== undefined && p.leadWater !== undefined && p.suit !== undefined
    && (p.cylinders?.length ?? 0) > 0 && p.cylinders!.every((c) => c.volumeL > 0);
  return queryOptions({
    queryKey: ['tools', 'lead', p, diverId, unit] as const, queryFn: () => fetchLeadEstimate(p, diverId!, unit), enabled, retry: false,
    ...(enabled && { placeholderData: keepPreviousData }),
  });
};

/** Sending many Dives to a Provider (ADR 0047). */
export type PushRunView = Awaited<ReturnType<typeof fetchPushRuns>>[number];
export type PushRunDetail = Awaited<ReturnType<typeof fetchPushRun>>;
export type PushRunPreview = Awaited<ReturnType<typeof fetchPushRunPreview>>;
/**
 * What a run sends: a list (the logbook's, or a scope of the dialog's own) or exactly these Dives (`ids`, when the User
 * left some out), and the three choices (unticked unless the User ticks them).
 */
export interface PushRunChoices {
  list: { siteId?: string | undefined; q?: string | undefined; only?: string | undefined };
  ids?: string[] | undefined;
  updates: boolean; updatesRemovingVerification: boolean; numbers: boolean;
  /** Confirmed once for the run: numbers that can remove a verification (ADR 0052). */
  numbersRemovingVerification: boolean;
  /** With `ids`: also the Dives in their way (a Dive's chain, ADR 0052). */
  withHolders?: boolean | undefined;
}
const pushRunBody = (c: PushRunChoices) => ({
  dives: c.ids
    ? { ids: c.ids }
    : { list: { ...(c.list.siteId && { siteId: c.list.siteId }), ...(c.list.q && { q: c.list.q }), ...(c.list.only && { only: c.list.only }) } },
  updates: c.updates, updatesRemovingVerification: c.updatesRemovingVerification, numbers: c.numbers,
  numbersRemovingVerification: c.numbersRemovingVerification, ...(c.withHolders && { withHolders: true }),
});
async function fetchPushRuns() {
  return unwrap(await api.GET('/api/push-runs'));
}
async function fetchPushRun(id: string) {
  return unwrap(await api.GET('/api/push-runs/{id}', { params: { path: { id } } }));
}
async function fetchPushRunPreview(connectionId: string, choices: PushRunChoices) {
  return unwrap(await api.POST('/api/connections/{id}/push-runs/preview', { params: { path: { id: connectionId } }, body: pushRunBody(choices) }));
}
export const pushRunActive = (r: Pick<PushRunView, 'status'>) => r.status === 'queued' || r.status === 'running';
/** The User's runs, newest first; asked again every two seconds while one is going (no faster: ADR 0047). */
export const pushRunsQuery = () => queryOptions({
  queryKey: keys.pushRuns, queryFn: fetchPushRuns, refetchInterval: (q) => (q.state.data?.some(pushRunActive) ? 2000 : false),
});
/** One run with its items; the list above has the progress, this has what happened to each Dive. */
export const pushRunQuery = (id: string) => queryOptions({ queryKey: keys.pushRun(id), queryFn: () => fetchPushRun(id) });
/** What a run with these choices would do: Dive Hub's data, and one read of the Provider's logbook where numbers are chosen. */
export const pushRunPreviewQuery = (connectionId: string, choices: PushRunChoices) => queryOptions({
  queryKey: keys.pushRunPreview(connectionId, choices), queryFn: () => fetchPushRunPreview(connectionId, choices), placeholderData: keepPreviousData, staleTime: 0,
});
export async function startPushRun(connectionId: string, choices: PushRunChoices) {
  return unwrap(await api.POST('/api/connections/{id}/push-runs', { params: { path: { id: connectionId } }, body: pushRunBody(choices) }));
}
export async function cancelPushRun(id: string) {
  return unwrap(await api.POST('/api/push-runs/{id}/cancel', { params: { path: { id } } }));
}
/** Puts an ended run away for good, on the server: every browser of the User stops showing it (slice 25d). */
export async function dismissPushRun(id: string) {
  return unwrap(await api.POST('/api/push-runs/{id}/dismiss', { params: { path: { id } } }));
}
export async function continuePushRun(id: string) {
  return unwrap(await api.POST('/api/push-runs/{id}/continue', { params: { path: { id } } }));
}
