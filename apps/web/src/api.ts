import { createApiClient, type components, type paths } from '@dive-hub/api-client';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { createAuthClient } from 'better-auth/client';
import { SITES_PAGE, type SitesParams } from './lib/sites-list.ts';
import type { LogbookParams, neighbourParams } from './lib/logbook.ts';
import { BOTTOM_TIME_RULES, type ToolsParams } from './lib/tools.ts';
import { pollUntilDue } from './lib/waiting-push.ts';

export const api = createApiClient();
/** Better Auth's own endpoints (sign-in, sign-out) at /api/auth on this origin; the session is a cookie. */
export const authClient = createAuthClient();

/** A refusal's body (the server's Problem schema, ADR 0014). */
type Problem = components['schemas']['Problem'];
/** The server's error codes (one list for every route). */
export type ProblemCode = Problem['code'];
/** As openapi-fetch reads an answer (its `Readable`): a tuple is an array of its members. */
type Read<T> = T extends readonly (infer E)[] ? Read<E>[] : T extends object ? { [K in keyof T]: Read<T[K]> } : T;
/** The body of a route's 200 answer, as `api` returns it: every view type below is one of these, or part of one. */
type Ok<P extends keyof paths, M extends 'get' | 'post' = 'get'> =
  paths[P][M] extends { responses: { 200: { content: { 'application/json': infer B } } } } ? Read<B> : never;

/**
 * What else a refusal says besides its code: the Problem schema's extras, and the Provider routes'
 * own `unmet` with provider_requirements_unmet (ADR 0029).
 */
export type ProblemDetails = Pick<Problem, 'diver' | 'centre' | 'existing' | 'diveId' | 'runId'> & { unmet?: UnmetView[] };
const DETAILS = ['unmet', 'diver', 'centre', 'existing', 'diveId', 'runId'] as const satisfies readonly (keyof ProblemDetails)[];

/**
 * An API error with its HTTP status (a 401 anywhere sends the user back to sign-in) and the
 * server's error code, which the UI translates (ADR 0014).
 */
export class ApiError extends Error {
  constructor(
    message: string, readonly status: number, readonly code?: ProblemCode,
    /** The Provider a provider_* code is about, named for the translated text (ADR 0027). */
    readonly provider?: { id: string; name: string },
    readonly details: ProblemDetails = {},
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

export type ImportView = Ok<'/api/imports'>[number];
/** A page of the logbook with its counts, totals and months (ADR 0040). */
export type LogbookPage = Ok<'/api/dives'>;
export type DiveSummary = LogbookPage['dives'][number];
export type Me = Ok<'/api/me'>;
export type InvitationView = Ok<'/api/invitations'>[number];
export type UserView = Ok<'/api/users'>[number];
export type SessionView = Ok<'/api/me/sessions'>[number];
export type DiveView = Ok<'/api/dives/{id}'>;
export type DiveValues = DiveView['values'];
export type OverridableField = DiveView['overrides'][number];
export type RevisionView = Ok<'/api/dives/{id}/revisions'>[number];
export type RecordingSummary = DiveView['recordings'][number]['summary'];
export type DiverView = Ok<'/api/divers'>[number];
export type DeviceView = Ok<'/api/devices'>[number];
export type CandidateView = Ok<'/api/duplicate-candidates'>[number];
type AnyLogbookCheck = Ok<'/api/logbook-checks'>[number];
/** A logbook check about two Dives (ADR 0038). */
export type LogbookCheckView = AnyLogbookCheck & { rule: Exclude<AnyLogbookCheck['rule'], 'short_shallow_dive'>; other: NonNullable<AnyLogbookCheck['other']> };
/** A logbook check about one Dive: probably no dive, to delete or to keep. */
export type DiveCheckView = AnyLogbookCheck & { rule: 'short_shallow_dive'; other: null };
export const isPairCheck = (c: AnyLogbookCheck): c is LogbookCheckView => c.other !== null;
export const isDiveCheck = (c: AnyLogbookCheck): c is DiveCheckView => c.other === null;
export type MergeCandidateView = Ok<'/api/dives/{id}/merge-candidates'>[number];
export type DeletedDiveView = Ok<'/api/dives/deleted'>[number];
export type SiteView = Ok<'/api/dive-sites/{id}'>;
export type Position = NonNullable<SiteView['position']>;
export type ExternalIdView = SiteView['externalIds'][number];
export type CentreView = Ok<'/api/dive-centres/{id}'>;
export type VerificationCodeView = NonNullable<CentreView['verificationCode']>;
/** A Diver's details and codes as every User sees them (ADR 0043). */
export type DiverDetailsView = Ok<'/api/divers/{id}/details'>;
/** What the server says a scanned or pasted code is. */
export type ReadCodeView = paths['/api/verification-codes/read']['post']['responses'][200]['content']['application/json'];
export type SiteRevisionView = Ok<'/api/dive-sites/{id}/revisions'>[number];
export type SiteImportView = Ok<'/api/admin/site-imports/{id}'>;
export type SiteImportArea = SiteImportView['area'];
export type ProviderView = Ok<'/api/providers'>[number];
export type ConnectionView = Ok<'/api/connections'>[number];
export type ProviderStatusView = Ok<'/api/dives/{id}/providers/{provider}'>;
export type PushView = ProviderStatusView['pushes'][number];
export type RemoteSiteView = Ok<'/api/dives/{id}/providers/{provider}/sites'>[number];
export type RequirementView = NonNullable<NonNullable<ProviderView['data']['dives']>['export']>['requirements'][number];
export type UnmetView = ProviderStatusView['unmet'][number];
export type LeftOutView = NonNullable<PushView['leftOut']>[number];
export type ParticipantView = DiveView['participants'][number];
export type ParticipantRole = ParticipantView['role'];
export type FoundDiverView = Ok<'/api/divers/search'>[number];
export type ExternalDiverView = Ok<'/api/external-divers'>['divers'][number];
export type BuddyView = Ok<'/api/connections/{id}/buddies'>[number];
export type DiveImportPreview = Ok<'/api/connections/{id}/dive-import'>;
export type DiveImportMode = NonNullable<ConnectionView['diveImport']>['mode'];
export type UtcOffsetSource = DiveView['utcOffsetSource'];

/** Query keys in one place (hierarchical, so invalidating ['dives'] covers every dive query). */
export const keys = {
  me: ['me'] as const,
  setup: ['setup'] as const,
  users: ['users'] as const,
  invitations: ['invitations'] as const,
  /** What an invitation or password reset link opens (ADR 0013); not under ['invitations'], the admin's list. */
  invitationLink: (token: string) => ['invitation', token] as const,
  passwordReset: (token: string) => ['password-reset', token] as const,
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
  buddiesFor: (connectionId: string, diverId: string) => ['connections', connectionId, 'buddies', diverId] as const,
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
    const body = (result.error ?? {}) as Partial<Problem> & ProblemDetails & { message?: string };
    const message = body.error ?? body.message ?? `Request failed (${result.response.status})`;
    const provider = body.provider ? { id: body.provider, name: body.providerName ?? body.provider } : undefined;
    const details = Object.fromEntries(DETAILS.filter((k) => body[k]).map((k) => [k, body[k]])) as ProblemDetails;
    throw new ApiError(message, result.response.status, body.code, provider, details);
  }
  return result.data as T;
}


/** The signed-in User, or null when nobody is signed in. */
export const meQuery = () => queryOptions({
  queryKey: keys.me,
  queryFn: async () => {
    const result = await api.GET('/api/me');
    return result.response.status === 401 ? null : unwrap(result);
  },
  staleTime: 5 * 60_000,
});
export const setupQuery = () =>
  queryOptions({ queryKey: keys.setup, queryFn: async () => unwrap(await api.GET('/api/setup')) });
export const usersQuery = () => queryOptions({ queryKey: keys.users, queryFn: async () => unwrap(await api.GET('/api/users')) });
export const sessionsQuery = () => queryOptions({ queryKey: keys.sessions, queryFn: async () => unwrap(await api.GET('/api/me/sessions')) });
export const invitationsQuery = () => queryOptions({ queryKey: keys.invitations, queryFn: async () => unwrap(await api.GET('/api/invitations')) });
/** A link that is used up or expired stays an error: asking again won't change it. */
export const invitationLinkQuery = (token: string) => queryOptions({
  queryKey: keys.invitationLink(token), queryFn: async () => unwrap(await api.POST('/api/invitations/lookup', { body: { token } })), retry: false,
});
export const passwordResetQuery = (token: string) => queryOptions({
  queryKey: keys.passwordReset(token), queryFn: async () => unwrap(await api.POST('/api/password-resets/lookup', { body: { token } })), retry: false,
});


export const importsQuery = () =>
  queryOptions({
    queryKey: keys.imports,
    queryFn: async () => unwrap(await api.GET('/api/imports')),
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

/** The cylinder catalogue (ADR 0031): a list in the server's code, the same until the next release. */
export const cylinderCatalogueQuery = () =>
  queryOptions({ queryKey: ['cylinder-catalogue'] as const, queryFn: async () => unwrap(await api.GET('/api/cylinder-catalogue')), staleTime: Infinity });


export const diversQuery = () => queryOptions({ queryKey: keys.divers, queryFn: async () => unwrap(await api.GET('/api/divers')) });
export const devicesQuery = () => queryOptions({ queryKey: keys.devices, queryFn: async () => unwrap(await api.GET('/api/devices')) });
export const candidatesQuery = (status: 'open' | 'discarded') =>
  queryOptions({ queryKey: keys.candidates(status), queryFn: async () => unwrap(await api.GET('/api/duplicate-candidates', { params: { query: { status } } })) });

/**
 * The logbook's list pages (`['dives', { …params }]`), not a Dive's own queries: for what changes how a row looks (a
 * send, a number, a Waiting push settled) without changing the Dive.
 */
export const diveListPages = { queryKey: keys.dives, predicate: (q: { queryKey: readonly unknown[] }) => typeof q.queryKey[1] === 'object' && q.queryKey[1] !== null };

/**
 * The User's deleted Dives, to restore them, and which Providers they are still at (ADR 0026, 0027); a delete at a
 * Provider that waits is asked about again when it is due (ADR 0056).
 */
export const deletedDivesQuery = () => queryOptions({
  queryKey: keys.deletedDives, queryFn: async () => unwrap(await api.GET('/api/dives/deleted')),
  refetchInterval: (q) => pollUntilDue(q.state.data?.flatMap((d) => d.waiting), Date.now()),
});

/** Pairs of Dives that can't both be right as they stand, or those the User said are two dives (ADR 0038). */
export const logbookChecksQuery = (status: 'open' | 'answered') =>
  queryOptions({ queryKey: keys.logbookChecks(status), queryFn: async () => unwrap(await api.GET('/api/logbook-checks', { params: { query: { status } } })) });
/** The Dives of the same Diver at the same time as this one, which it may be merged with (ADR 0038). */
export const mergeCandidatesQuery = (id: string) => queryOptions({
  queryKey: keys.mergeCandidates(id),
  queryFn: async () => unwrap(await api.GET('/api/dives/{id}/merge-candidates', { params: { path: { id } } })),
});
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
export const diveQuery = (id: string) => queryOptions({ queryKey: keys.dive(id), queryFn: async () => unwrap(await api.GET('/api/dives/{id}', { params: { path: { id } } })) });
/** A Dive's findings, the computer's own events and the ascent bands (ADR 0036). */
export const assessmentQuery = (id: string) => queryOptions({ queryKey: keys.assessment(id), queryFn: async () => unwrap(await api.GET('/api/dives/{id}/assessment', { params: { path: { id } } })) });
export type AssessmentView = Ok<'/api/dives/{id}/assessment'>;

export const revisionsQuery = (id: string) => queryOptions({ queryKey: keys.revisions(id), queryFn: async () => unwrap(await api.GET('/api/dives/{id}/revisions', { params: { path: { id } } })) });

export const samplesQuery = (recordingId: string) =>
  queryOptions({
    queryKey: keys.samples(recordingId),
    queryFn: async () =>
      unwrap(await api.GET('/api/recordings/{id}/samples', {
        params: { path: { id: recordingId }, query: { channels: 'depth,temperature,tankPressure', maxPoints: 2000 } },
      })),
    staleTime: Infinity,
  });


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
export const siteQuery = (id: string) => queryOptions({ queryKey: keys.site(id), queryFn: async () => unwrap(await api.GET('/api/dive-sites/{id}', { params: { path: { id } } })) });

/** Dive centres (ADR 0043) by name: the ones matching words, or the ones of a Dive site. */
export const centresQuery = (p: { q?: string | undefined; siteId?: string | undefined } = {}) => queryOptions({
  queryKey: [...keys.centres, { q: p.q, siteId: p.siteId }],
  queryFn: async () => unwrap(await api.GET('/api/dive-centres', { params: { query: { ...(p.q && { q: p.q }), ...(p.siteId && { siteId: p.siteId }), limit: 100 } } })),
  placeholderData: keepPreviousData,
});
export const centreQuery = (id: string) => queryOptions({ queryKey: keys.centre(id), queryFn: async () => unwrap(await api.GET('/api/dive-centres/{id}', { params: { path: { id } } })) });

/** A Dive site's history (ADR 0021): every User reads it; other Users are never named. */
export const siteRevisionsQuery = (id: string) => queryOptions({
  queryKey: keys.siteRevisions(id),
  queryFn: async () => unwrap(await api.GET('/api/dive-sites/{id}/revisions', { params: { path: { id } } })),
});

const running = (i: SiteImportView) => i.status === 'queued' || i.status === 'running';
/** The latest Site imports (admins, ADR 0021); asked again every two seconds while one runs. */
export const siteImportsQuery = () => queryOptions({
  queryKey: keys.siteImports,
  queryFn: async () => unwrap(await api.GET('/api/admin/site-imports')),
  refetchInterval: (query) => (query.state.data?.some(running) ? 2000 : false),
});

/** A multipart upload, which openapi-fetch's JSON body doesn't carry; its answer goes through unwrap like any other. */
export async function uploadFile(file: File) {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/imports', { method: 'POST', body });
  const json: unknown = await response.json().catch(() => undefined);
  return unwrap({ data: json as ImportView, error: json, response });
}

/** The Providers of this server and what each offers (ADR 0027); they change only with the server. */
export const providersQuery = () => queryOptions({ queryKey: keys.providers, queryFn: async () => unwrap(await api.GET('/api/providers')), staleTime: Infinity });
/** The User's Connections to Providers (ADR 0024). */
export const connectionsQuery = () => queryOptions({ queryKey: keys.connections, queryFn: async () => unwrap(await api.GET('/api/connections')) });
/** The Dive at every Provider that takes dives (for the delete dialog). */
export const diveProvidersQuery = (diveId: string) => queryOptions({
  queryKey: keys.diveProviders(diveId),
  queryFn: async () => unwrap(await api.GET('/api/dives/{id}/providers', { params: { path: { id: diveId } } })),
});
/** A Dive at one Provider: its Diver's Connection, what is unmet (ADR 0029), the remote dive it has, its Pushes. */
export const providerStatusQuery = (diveId: string, provider: string) =>
  queryOptions({
    queryKey: keys.providerStatus(diveId, provider),
    queryFn: async () => unwrap(await api.GET('/api/dives/{id}/providers/{provider}', { params: { path: { id: diveId, provider } } })),
    // An entry that waits goes out at its due time (ADR 0056): the page asks again then, until it is settled.
    refetchInterval: (q) => pollUntilDue(q.state.data?.waiting ? [q.state.data.waiting] : [], Date.now()),
  });
/** Every Diver of the instance whose name matches, the User's own first (ADR 0028). */
export const diverSearchQuery = (q: string) =>
  queryOptions({ queryKey: keys.diverSearch(q), queryFn: async () => unwrap(await api.GET('/api/divers/search', { params: { query: { q, limit: 20 } } })), placeholderData: keepPreviousData });

/** People Users dived with who keep no logbook here (ADR 0028). */
export const externalDiversQuery = (q = '') =>
  queryOptions({
    queryKey: keys.externalDivers(q),
    queryFn: async () => unwrap(await api.GET('/api/external-divers', { params: { query: { ...(q && { q }), limit: 200 } } })),
    placeholderData: keepPreviousData,
  });

export const diverDetailsQuery = (id: string) => queryOptions({
  queryKey: keys.diverDetails(id),
  queryFn: async () => unwrap(await api.GET('/api/divers/{id}/details', { params: { path: { id } } })),
});
export const bodyWeightsQuery = (id: string) => queryOptions({
  queryKey: keys.bodyWeights(id),
  queryFn: async () => unwrap(await api.GET('/api/divers/{id}/body-weights', { params: { path: { id } } })),
});
/** A Diver's certification cards, newest first (ADR 0050). */
export const certificationsQuery = (id: string) => queryOptions({
  queryKey: keys.certifications(id),
  queryFn: async () => unwrap(await api.GET('/api/divers/{id}/certifications', { params: { path: { id } } })),
});
export type CertificationView = Ok<'/api/divers/{id}/certifications'>[number];

async function fetchBuddies(connectionId: string, diverId?: string) {
  return unwrap(await api.GET('/api/connections/{id}/buddies', {
    params: { path: { id: connectionId }, ...(diverId && { query: { for: diverId } }) },
  }));
}
/** The account's list of people at the Provider (SSI's buddy list); asks the Provider, so only when the User opens it. */
export const buddiesQuery = (connectionId: string) =>
  queryOptions({ queryKey: keys.buddies(connectionId), queryFn: () => fetchBuddies(connectionId), staleTime: 2 * 60_000 });
/** The same list for Link or add: the entries that look like this Diver come first (a sort, never a link). */
export const buddiesForQuery = (connectionId: string, diverId: string) =>
  queryOptions({ queryKey: keys.buddiesFor(connectionId, diverId), queryFn: () => fetchBuddies(connectionId, diverId), staleTime: 30_000 });

/** What importing the account's dives would do now (ADR 0030); reads the Provider, so only when the User asks. */
export const diveImportPreviewQuery = (connectionId: string) =>
  queryOptions({
    queryKey: keys.diveImport(connectionId),
    queryFn: async () => unwrap(await api.GET('/api/connections/{id}/dive-import', { params: { path: { id: connectionId } } })),
    staleTime: Infinity,
    retry: false,
  });

/** Dives whose remote dive is gone at a Provider, per Connection (ADR 0051); stored findings, no call to the Provider. */
export const goneDivesQuery = () => queryOptions({ queryKey: keys.goneDives, queryFn: async () => unwrap(await api.GET('/api/gone-dives')) });
export type GoneDivesOfConnection = Ok<'/api/gone-dives'>[number];
export type GoneDiveView = GoneDivesOfConnection['dives'][number];

/** Conflicts with a Provider that wait for the User's choice, per Connection (ADR 0056); stored, no call to the Provider. */
export const providerConflictsQuery = () => queryOptions({ queryKey: keys.providerConflicts, queryFn: async () => unwrap(await api.GET('/api/provider-conflicts')) });
export type ConflictsOfConnection = Ok<'/api/provider-conflicts'>[number];
export type ConflictEntryView = ConflictsOfConnection['entries'][number];
/** One field changed on both sides, with both values as the import preview says them. */
export type ConflictFieldView = ConflictEntryView['fields'][number];
/** A choice per Conflict: Dive Hub's value goes out (hub), or the Provider's comes in (provider). */
export type ConflictChoices = Partial<Record<ConflictFieldView['field'], 'hub' | 'provider'>>;

/** How each dive at the Provider started and came about, to find why times differ (read only); reads the Provider, so only when asked. */
export const diveTimesQuery = (connectionId: string) =>
  queryOptions({
    queryKey: keys.diveTimes(connectionId),
    queryFn: async () => unwrap(await api.GET('/api/connections/{id}/dive-times', { params: { path: { id: connectionId } } })),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

/** Admins: per Provider whose dives Users import, whether new Dive sites may be made from its site data (ADR 0030). */
export const siteDataQuery = () => queryOptions({
  queryKey: keys.siteData, queryFn: async () => unwrap(await api.GET('/api/admin/provider-site-data')),
});
export type SiteDataView = Ok<'/api/admin/provider-site-data'>[number];

/** The User's AI accesses and whether this instance offers the MCP endpoint (ADR 0035). */
export const aiAccessQuery = () => queryOptions({ queryKey: keys.aiAccess, queryFn: async () => unwrap(await api.GET('/api/me/ai-access')) });
export type AiAccessView = Ok<'/api/me/ai-access'>['accesses'][number];

/** What the User's AI accesses read, newest first; `limit` grows with "show older". */
export const aiAccessLogQuery = (limit: number) =>
  queryOptions({
    queryKey: [...keys.aiAccessLog, limit] as const,
    queryFn: async () => unwrap(await api.GET('/api/me/ai-access-log', { params: { query: { limit } } })),
    placeholderData: keepPreviousData,
  });
export type AiAccessLogEntry = Ok<'/api/me/ai-access-log'>['entries'][number];

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
  queryOptions({
    queryKey: keys.providerSites(diveId, provider),
    queryFn: async () => unwrap(await api.GET('/api/dives/{id}/providers/{provider}/sites', { params: { path: { id: diveId, provider } } })),
    staleTime: 5 * 60_000,
  });

/** The Tools page (ADR 0032): computed on request; the inputs come from the page's address. */
export type ToolsGas = Ok<'/api/tools/gas'>;
export type ToolsBottomTime = Ok<'/api/tools/bottom-time'>;
type ToolsInput = ToolsParams;
/** Leaves out what is undefined (the address holds only what was typed); the type claims every key, which the query's optional keys accept. */
const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };

/** While the inputs are complete the last answer stays on screen until the next arrives, so the page doesn't blink; with incomplete inputs there is no answer. */
export const toolsGasQuery = (p: ToolsInput) => {
  const enabled = p.o2 !== undefined && p.o2 > 0;
  return queryOptions({
    queryKey: ['tools', 'gas', p] as const, queryFn: async () => unwrap(await api.GET('/api/tools/gas', {
    params: { query: defined({ o2: p.o2!, he: p.he, depth: p.depth, water: p.water, altitude: p.altitude, ppo2Working: p.pw, ppo2Contingency: p.pc, oxygenNarcotic: p.narcotic }) },
  })), enabled, retry: false,
    ...(enabled && { placeholderData: keepPreviousData }),
  });
};

/** A single bottom time knows three rules; the turn rules are for a plan with a return (ADR 0033). */
const bottomTimeRule = (p: ToolsInput) =>
  p.rule !== undefined && (BOTTOM_TIME_RULES as readonly string[]).includes(p.rule) ? { rule: p.rule as 'rock_bottom' | 'reserve' | 'ascent_pressure', bar: p.bar } : {};

export const toolsBottomTimeQuery = (p: ToolsInput, diverId: string | undefined, ready: boolean) => {
  const enabled = ready && p.o2 !== undefined && p.o2 > 0 && p.depth !== undefined && p.depth > 0;
  return queryOptions({
    queryKey: ['tools', 'bottom-time', p, diverId] as const, queryFn: async () => unwrap(await api.GET('/api/tools/bottom-time', {
    params: { query: defined({
      depth: p.depth!, o2: p.o2!, he: p.he, volume: p.volume, pressure: p.pressure, sac: p.sac, ...bottomTimeRule(p), gfHigh: p.gf,
      water: p.water, altitude: p.altitude, ppo2Working: p.pw, ppo2Contingency: p.pc, diverId,
    }) },
  })), enabled, retry: false,
    ...(enabled && { placeholderData: keepPreviousData }),
  });
};

/** A gas plan (ADR 0033). */
export type ToolsPlan = Ok<'/api/tools/gas-plan', 'post'>;
export type ToolsPlanDiver = Extract<ToolsPlan, { status: 'ok' }>['divers'][number];

const fetchToolsPlan = async (p: ToolsInput) => unwrap(await api.POST('/api/tools/gas-plan', {
  body: defined({
    // The plan's own mix (air when empty), never the one of "Your dive"; no helium: a plan is air or nitrox.
    o2: p.mix ?? 21, water: p.water, altitude: p.altitude, rule: p.rule, bar: p.bar, ppo2Contingency: p.pc, descentRate: p.dr, ascentRate: p.ar,
    levels: (p.levels ?? []).map((l) => ({ depth: l.depth, minutes: l.minutes })),
    divers: (p.divers ?? []).map((d) => defined({ name: d.name, volume: d.volume, pressure: d.pressure, sac: d.sac, diverId: d.diverId })),
  }),
}));
export const toolsPlanQuery = (p: ToolsInput) => {
  const enabled = (p.levels?.length ?? 0) > 0 && (p.divers?.length ?? 0) > 0;
  return queryOptions({
    queryKey: ['tools', 'plan', p] as const, queryFn: () => fetchToolsPlan(p), enabled, retry: false,
    ...(enabled && { placeholderData: keepPreviousData }),
  });
};

/** The lead estimate (ADR 0031): computed on request for a Diver the User keeps, in the unit the User counts in. */
export type LeadEstimate = Ok<'/api/divers/{id}/lead-estimate'>;
/** Needs a Diver, the water, the suit and Cylinders with a volume each; the suit's details may stay empty (the answer says so). */
export const leadEstimateQuery = (p: ToolsInput, diverId: string | undefined, unit: 'kg' | 'lb') => {
  const enabled = diverId !== undefined && p.leadWater !== undefined && p.suit !== undefined
    && (p.cylinders?.length ?? 0) > 0 && p.cylinders!.every((c) => c.volumeL > 0);
  return queryOptions({
    queryKey: ['tools', 'lead', p, diverId, unit] as const, queryFn: async () => unwrap(await api.GET('/api/divers/{id}/lead-estimate', {
    params: {
      path: { id: diverId! },
      query: defined({
        water: p.leadWater!, suit: p.suit!, suitThicknessMm: p.suit === 'wetsuit' || p.suit === 'semidry' ? p.thicknessMm : undefined,
        suitHood: p.suit && p.suit !== 'none' ? p.hood : undefined, suitUndergarment: p.suit === 'drysuit' ? p.undergarment : undefined,
        cylinders: JSON.stringify((p.cylinders ?? []).map((c) => defined({ volumeL: c.volumeL, material: c.material }))), unit,
      }),
    },
  })), enabled, retry: false,
    ...(enabled && { placeholderData: keepPreviousData }),
  });
};

/** Sending many Dives to a Provider (ADR 0047). */
export type PushRunView = Ok<'/api/push-runs'>[number];
export type PushRunDetail = Ok<'/api/push-runs/{id}'>;
export type PushRunPreview = Ok<'/api/connections/{id}/push-runs/preview', 'post'>;
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
export const pushRunActive = (r: Pick<PushRunView, 'status'>) => r.status === 'queued' || r.status === 'running';
/** The User's runs, newest first; asked again every two seconds while one is going (no faster: ADR 0047). */
export const pushRunsQuery = () => queryOptions({
  queryKey: keys.pushRuns, queryFn: async () => unwrap(await api.GET('/api/push-runs')), refetchInterval: (q) => (q.state.data?.some(pushRunActive) ? 2000 : false),
});
/** One run with its items; the list above has the progress, this has what happened to each Dive. */
export const pushRunQuery = (id: string) => queryOptions({ queryKey: keys.pushRun(id), queryFn: async () => unwrap(await api.GET('/api/push-runs/{id}', { params: { path: { id } } })) });
/** What a run with these choices would do: Dive Hub's data, and one read of the Provider's logbook where numbers are chosen. */
export const pushRunPreviewQuery = (connectionId: string, choices: PushRunChoices) => queryOptions({
  queryKey: keys.pushRunPreview(connectionId, choices),
  queryFn: async () => unwrap(await api.POST('/api/connections/{id}/push-runs/preview', { params: { path: { id: connectionId } }, body: pushRunBody(choices) })),
  placeholderData: keepPreviousData, staleTime: 0,
});
/** A named helper only because two screens start runs and the body is shaped as for the preview; other mutations call `api` inline. */
export async function startPushRun(connectionId: string, choices: PushRunChoices) {
  return unwrap(await api.POST('/api/connections/{id}/push-runs', { params: { path: { id: connectionId } }, body: pushRunBody(choices) }));
}
