import { createApiClient } from '@dive-hub/api-client';
import { queryOptions } from '@tanstack/react-query';

export const api = createApiClient();

export type ImportView = Awaited<ReturnType<typeof fetchImports>>[number];
export type DiveSummary = Awaited<ReturnType<typeof fetchDives>>[number];

/** Query keys in one place (hierarchical, so invalidating ['dives'] covers every dive query). */
export const keys = {
  imports: ['imports'] as const,
  dives: ['dives'] as const,
  dive: (id: string) => ['dives', id] as const,
  samples: (recordingId: string) => ['recordings', recordingId, 'samples'] as const,
};

function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error !== undefined || result.data === undefined) {
    const message = (result.error as { error?: string } | undefined)?.error ?? 'Request failed';
    throw new Error(message);
  }
  return result.data;
}

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
    throw new Error(problem.error ?? `Upload failed (${response.status})`);
  }
}
