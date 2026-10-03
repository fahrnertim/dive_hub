import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const E2E_PORT = 3300;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Mirrors the User seeded by apps/server/test/e2e-server.ts. */
export const E2E_USER = { email: 'erika@example.com', name: 'Erika', password: 'correct horse battery staple' };

type Dive = { id: string; version: number; overrides: string[]; recordings: { id: string }[] };

/** The seeded Dive (number 42, from the main and the backup computer). */
export async function seededDiveId(api: APIRequestContext): Promise<string> {
  const { dives } = await (await api.get('/api/dives?q=42')).json() as { dives: { id: string; number: number | null }[] };
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

/**
 * The checks every page must pass (UI review 2026-10-03, so its problems don't come back):
 * axe-core finds no WCAG 2.2 AA or best-practice violation, the page has one h1 and its own title,
 * nothing scrolls the page sideways, and no two buttons have the same name (screen readers list
 * buttons by name, so "Revoke" on every row can't be told apart). `title` is the expected h1 text,
 * checked against document.title; leave it out to check only that the page set one.
 */
export async function expectGoodPage(page: Page, title?: string) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  if (title) await expect(page).toHaveTitle(`${title} – Dive Hub`);
  else await expect(page).toHaveTitle(/^.+ – Dive Hub$/);

  const axe = await new AxeBuilder({ page })
    // React Aria's live announcer briefly keeps a role=img pointing at a pending button that may be gone.
    .exclude('[data-live-announcer]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`)).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);

  const names = await page.getByRole('button').evaluateAll((buttons) => buttons
    .filter((b) => b.checkVisibility())
    .map((b) => {
      const ids = b.getAttribute('aria-labelledby');
      if (ids) return ids.split(' ').map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ');
      return (b.getAttribute('aria-label') ?? b.textContent ?? '').trim();
    }));
  const repeated = names.filter((n, i) => names.indexOf(n) !== i);
  expect(repeated, 'buttons with the same name').toEqual([]);
}
