import { createApiClient } from '@dive-hub/api-client';
import { queryOptions } from '@tanstack/react-query';
import { createAuthClient } from 'better-auth/client';

export const api = createApiClient();
/** Better Auth's own endpoints (sign-in, sign-out) at /api/auth on this origin; the session is a cookie. */
export const authClient = createAuthClient();

/** An API error with its HTTP status, so a 401 anywhere can send the user back to sign-in. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
export const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

export type ImportView = Awaited<ReturnType<typeof fetchImports>>[number];
export type DiveSummary = Awaited<ReturnType<typeof fetchDives>>[number];
export type Me = NonNullable<Awaited<ReturnType<typeof fetchMe>>>;
export type InvitationView = Awaited<ReturnType<typeof fetchInvitations>>[number];

/** Query keys in one place (hierarchical, so invalidating ['dives'] covers every dive query). */
export const keys = {
  me: ['me'] as const,
  setup: ['setup'] as const,
  users: ['users'] as const,
  invitations: ['invitations'] as const,
  imports: ['imports'] as const,
  dives: ['dives'] as const,
  dive: (id: string) => ['dives', id] as const,
  samples: (recordingId: string) => ['recordings', recordingId, 'samples'] as const,
};

export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || result.data === undefined) {
    const message = (result.error as { error?: string } | undefined)?.error ?? 'Request failed';
    throw new ApiError(message, result.response.status);
  }
  return result.data;
}

/** The signed-in User, or null when nobody is signed in. */
async function fetchMe() {
  const result = await api.GET('/api/me');
  return result.response.status === 401 ? null : unwrap(result);
}
async function fetchInvitations() {
  return unwrap(await api.GET('/api/invitations'));
}

export const meQuery = () => queryOptions({ queryKey: keys.me, queryFn: fetchMe, staleTime: 5 * 60_000 });
export const setupQuery = () =>
  queryOptions({ queryKey: keys.setup, queryFn: async () => unwrap(await api.GET('/api/setup')) });
export const usersQuery = () =>
  queryOptions({ queryKey: keys.users, queryFn: async () => unwrap(await api.GET('/api/users')) });
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

export const diveQuery = (id: string) =>
  queryOptions({
    queryKey: keys.dive(id),
    queryFn: async () => unwrap(await api.GET('/api/dives/{id}', { params: { path: { id } } })),
  });

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
    const problem = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(problem.error ?? `Upload failed (${response.status})`, response.status);
  }
}
