import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Browser tests run in parallel (ADR 0023): one e2e server with its own database per worker, on ports
 * 3300, 3301, … Each worker talks only to its own; Playwright tells a worker its slot in TEST_PARALLEL_INDEX.
 * The review capture uses one server (`--project=review`).
 */
export const E2E_REVIEW = process.argv.some((a) => a.includes('project=review'));
/** Measured 2026-10-04 (full suite, 14-core laptop): 1 worker 285 s, 2: 215 s, 3: 222 s, 4: 229 s. */
export const E2E_SERVERS = E2E_REVIEW ? 1 : Number(process.env.E2E_SERVERS ?? 2);
export const E2E_FIRST_PORT = 3300;
export const serverUrl = (slot: number) => `http://localhost:${E2E_FIRST_PORT + slot}`;
/** The signed-in session for one server (written by global-setup.ts). */
export const sessionFile = (slot: number) => `e2e/.state/user-${slot}.json`;
const slot = Number(process.env.TEST_PARALLEL_INDEX ?? 0) % E2E_SERVERS;
/** This worker's server. */
export const E2E_PORT = E2E_FIRST_PORT + slot;
export const E2E_BASE_URL = serverUrl(slot);
export const E2E_SESSION = sessionFile(slot);

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
 * nothing scrolls the page or a table sideways (a table that scrolls hides its last columns, often
 * the actions; it should switch to its narrow layout instead), and no two buttons have the same name (screen readers list
 * buttons by name, so "Revoke" on every row can't be told apart). `title` is the expected h1 text,
 * checked against document.title; leave it out to check only that the page set one.
 */
export async function expectGoodPage(page: Page, title?: string, options: { axe?: boolean } = {}) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  if (title) await expect(page).toHaveTitle(`${title} – Dive Hub`);
  else await expect(page).toHaveTitle(/^.+ – Dive Hub$/);

  // axe is the slowest check; ui-quality runs it in two of its four variants (ADR 0023).
  if (options.axe !== false) {
    const axe = await new AxeBuilder({ page })
      // React Aria's live announcer briefly keeps a role=img pointing at a pending button that may be gone.
      .exclude('[data-live-announcer]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`)).toEqual([]);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
  const tables = await page.locator('.table-scroll').evaluateAll((boxes) => boxes
    .filter((b) => b.checkVisibility())
    .map((b) => ({ label: b.getAttribute('aria-label'), overflow: b.scrollWidth - b.clientWidth }))
    .filter((t) => t.overflow > 0));
  expect(tables, 'tables that scroll sideways').toEqual([]);

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

/** The SSI account the e2e server's fake SSI knows (ADR 0024); its password is not Erika's Dive Hub password. */
export const SSI_ACCOUNT = { email: 'erika@example.com', password: 'ssi-password' };
type SsiConnection = { id: string; diverId: string; state: string };

/** Erika's own Diver connected to the fake SSI, password kept, signed in. */
export async function connectSsi(api: APIRequestContext) {
  const me = await (await api.get('/api/me')).json() as { ownDiver: { id: string } };
  const { connections } = await (await api.get('/api/connections/ssi')).json() as { connections: SsiConnection[] };
  const own = connections.find((c) => c.diverId === me.ownDiver.id);
  if (own?.state === 'active') return;
  const response = own
    ? await api.post(`/api/connections/ssi/${own.id}/sign-in`, { data: { password: SSI_ACCOUNT.password, keepSignedIn: true }, headers })
    : await api.post('/api/connections/ssi', { data: { diverId: me.ownDiver.id, ...SSI_ACCOUNT, keepSignedIn: true }, headers });
  if (!response.ok()) throw new Error(`connecting to SSI failed: ${response.status()} ${await response.text()}`);
}

/** No SSI Connections at all. */
export async function disconnectSsi(api: APIRequestContext) {
  const { connections } = await (await api.get('/api/connections/ssi')).json() as { connections: SsiConnection[] };
  for (const c of connections) await api.delete(`/api/connections/ssi/${c.id}`, { headers });
}

/**
 * The Dive ready to go to SSI, but not there: at the site "SSI test reef" without an SSI site ID, and with
 * no SSI dive (deleted there if an earlier test sent it). Needs a Connection.
 */
export async function readyForSsi(api: APIRequestContext, diveId: string) {
  const name = 'SSI test reef';
  const { sites } = await (await api.get(`/api/dive-sites?q=${encodeURIComponent(name)}`)).json() as { sites: { id: string; name: string; version: number }[] };
  let site = sites.find((s) => s.name === name);
  if (!site) site = await (await api.post('/api/dive-sites', { data: { name, position: { latitude: 47.851, longitude: 13.5512 } }, headers })).json() as { id: string; name: string; version: number };
  else await api.patch(`/api/dive-sites/${site.id}`, { data: { version: site.version, ssiSiteId: null }, headers });
  const dive = await (await api.get(`/api/dives/${diveId}`)).json() as Dive;
  await api.patch(`/api/dives/${diveId}`, { data: { version: dive.version, siteId: site.id }, headers });
  const status = await (await api.get(`/api/dives/${diveId}/ssi`)).json() as { current: unknown };
  if (status.current) await api.delete(`/api/dives/${diveId}/ssi`, { headers });
}

/** Takes the Dive off the test reef again: other specs expect the seeded Dive without a site (as sites.spec.ts leaves it). */
export async function leaveSsi(api: APIRequestContext, diveId: string) {
  const dive = await (await api.get(`/api/dives/${diveId}`)).json() as Dive;
  await api.patch(`/api/dives/${diveId}`, { data: { version: dive.version, siteId: null }, headers });
}
