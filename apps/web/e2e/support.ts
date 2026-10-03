import type { APIRequestContext } from '@playwright/test';

export const E2E_PORT = 3300;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Mirrors the User seeded by apps/server/test/e2e-server.ts. */
export const E2E_USER = { email: 'erika@example.com', name: 'Erika', password: 'correct horse battery staple' };

type Dive = { id: string; version: number; overrides: string[]; recordings: { id: string }[] };

/** The seeded Dive (number 42, from the main and the backup computer). */
export async function seededDiveId(api: APIRequestContext): Promise<string> {
  const dives = await (await api.get('/api/dives')).json() as { id: string; number: number | null }[];
  return dives.find((d) => d.number === 42)!.id;
}
const headers = { origin: E2E_BASE_URL };

/**
 * Puts the seeded Dive back to its imported state: no Overrides, no notes, the main computer as
 * Primary recording, default display settings. Each test starts from there.
 */
export async function resetDive(api: APIRequestContext): Promise<Dive> {
  await api.patch('/api/me/preferences', { data: { language: null, units: null }, headers });
  let dive = await (await api.get(`/api/dives/${await seededDiveId(api)}`)).json() as Dive;
  dive = await (await api.put(`/api/dives/${dive.id}/primary-recording`, {
    data: { recordingId: dive.recordings[0]!.id, version: dive.version }, headers,
  })).json() as Dive;
  dive = await (await api.patch(`/api/dives/${dive.id}`, {
    data: { version: dive.version, reset: dive.overrides, notes: null }, headers,
  })).json() as Dive;
  return dive;
}

/** Changes the Dive behind the browser's back, as another session would. */
export async function editElsewhere(api: APIRequestContext, diveId: string, notes: string) {
  const dive = await (await api.get(`/api/dives/${diveId}`)).json() as Dive;
  await api.patch(`/api/dives/${diveId}`, { data: { version: dive.version, notes }, headers });
}

export async function setPreferences(api: APIRequestContext, preferences: { language?: string | null; units?: string | null }) {
  await api.patch('/api/me/preferences', { data: preferences, headers });
}
