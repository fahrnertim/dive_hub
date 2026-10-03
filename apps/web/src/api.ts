import { createApiClient, type paths } from '@dive-hub/api-client';
import { queryOptions } from '@tanstack/react-query';
import { createAuthClient } from 'better-auth/client';

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

export type ImportView = Awaited<ReturnType<typeof fetchImports>>[number];
export type DiveSummary = Awaited<ReturnType<typeof fetchDives>>[number];
export type Me = NonNullable<Awaited<ReturnType<typeof fetchMe>>>;
export type InvitationView = Awaited<ReturnType<typeof fetchInvitations>>[number];
export type UserView = Awaited<ReturnType<typeof fetchUsers>>[number];
export type SessionView = Awaited<ReturnType<typeof fetchSessions>>[number];
export type DiveView = Awaited<ReturnType<typeof fetchDive>>;
export type DiveValues = DiveView['values'];
export type OverridableField = DiveView['overrides'][number];
export type RevisionView = Awaited<ReturnType<typeof fetchRevisions>>[number];
export type RecordingSummary = DiveView['recordings'][number]['summary'];

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
  revisions: (id: string) => ['dives', id, 'revisions'] as const,
  samples: (recordingId: string) => ['recordings', recordingId, 'samples'] as const,
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

export const divesQuery = () => queryOptions({ queryKey: keys.dives, queryFn: fetchDives });

async function fetchDive(id: string) {
  return unwrap(await api.GET('/api/dives/{id}', { params: { path: { id } } }));
}
async function fetchRevisions(id: string) {
  return unwrap(await api.GET('/api/dives/{id}/revisions', { params: { path: { id } } }));
}

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

export async function uploadFile(file: File) {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/imports', { method: 'POST', body });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { code?: ProblemCode; error?: string };
    throw new ApiError(problem.error ?? `Upload failed (${response.status})`, response.status, problem.code);
  }
}
