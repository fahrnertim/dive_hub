import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

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

/** The logbook's rows, one per Dive (ADR 0040); English or German. */
export const diveRows = (page: Page) => page.getByRole('region', { name: /^(Dives|Tauchgänge)$/ }).getByRole('listitem');

/**
 * Opens a line of the dive page that is closed until asked for (History, the Dive at a Provider), by its title. Leaves
 * it alone when it is open already: a line that has something to say opens by itself.
 */
export async function openLine(page: Page, name: string) {
  const line = page.getByRole('button', { name, exact: true });
  if (await line.getAttribute('aria-expanded') !== 'true') await line.click();
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
    // React Aria points a search field at its new active result one render after a list changes: wait until every such
    // reference is on the page. One that stays broken still fails.
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[aria-activedescendant]')]
      .every((el) => !!document.getElementById(el.getAttribute('aria-activedescendant')!)))).toBe(true);
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
export const SSI_ACCOUNT = { login: 'erika@example.com', password: 'ssi-password' };
type Connection = { id: string; provider: string; diverId: string; state: string };

/** Erika's own Diver connected to the fake SSI, password kept, signed in. */
export async function connectSsi(api: APIRequestContext) {
  const me = await (await api.get('/api/me')).json() as { ownDiver: { id: string } };
  const connections = await (await api.get('/api/connections')).json() as Connection[];
  const own = connections.find((c) => c.provider === 'ssi' && c.diverId === me.ownDiver.id);
  if (own?.state === 'active') return;
  const response = own
    ? await api.post(`/api/connections/${own.id}/sign-in`, { data: { password: SSI_ACCOUNT.password, keepSignedIn: true }, headers })
    : await api.post('/api/connections/ssi', { data: { diverId: me.ownDiver.id, ...SSI_ACCOUNT, keepSignedIn: true }, headers });
  if (!response.ok()) throw new Error(`connecting to SSI failed: ${response.status()} ${await response.text()}`);
}

/** Lena's own SSI account (ADR 0030): the e2e server's fake SSI has her logbook to import. Lena is a Diver Erika keeps. */
export const LENA_SSI = { login: 'lena@example.com', password: 'ssi-password-lena' };

/**
 * Lena connected to her SSI account, the import set to also create dives, matching within 30 minutes. Tests that call it
 * disconnect her at the end (leaveLena), so other specs see only Erika's Connection.
 */
export async function lenaReady(api: APIRequestContext): Promise<{ diverId: string; connectionId: string }> {
  const divers = await (await api.get('/api/divers')).json() as { id: string; name: string }[];
  const lena = divers.find((d) => d.name === 'Lena')!;
  const connections = await (await api.get('/api/connections')).json() as Connection[];
  let connectionId = connections.find((c) => c.provider === 'ssi' && c.diverId === lena.id)?.id;
  if (!connectionId) {
    const created = await api.post('/api/connections/ssi', { data: { diverId: lena.id, ...LENA_SSI, keepSignedIn: false }, headers });
    if (!created.ok()) throw new Error(`connecting Lena to SSI failed: ${created.status()} ${await created.text()}`);
    connectionId = (await created.json() as { id: string }).id;
  }
  await api.patch(`/api/connections/${connectionId}`, { data: { diveImport: { mode: 'create', windowMinutes: 30 } }, headers });
  return { diverId: lena.id, connectionId };
}

/** Changes Lena's SSI dive with this number in the fake SSI, as she would in SSI's app (the e2e server's test-only route). */
export async function editInSsi(api: APIRequestContext, number: number, set: Record<string, unknown>) {
  const answer = await (await api.post('/e2e/fake-ssi/dive', { data: { email: LENA_SSI.login, number, set }, headers })).json() as { found: boolean };
  if (!answer.found) throw new Error(`Lena has no SSI dive ${number}`);
}

/**
 * A field changed both here and in SSI since the last import (ADR 0030): the notes of Lena's second dive (SSI dive 12),
 * so the next preview asks whose to keep. Imports the dives first.
 */
export async function conflictForLena(api: APIRequestContext, stamp: string) {
  const { diverId } = await importLena(api);
  const { dives } = await (await api.get(`/api/dives?diverId=${diverId}&sort=startsAt&order=asc&limit=2`)).json() as { dives: { id: string }[] };
  await editElsewhere(api, dives[1]!.id, `Changed in Dive Hub ${stamp}`);
  await editInSsi(api, 12, { odin_user_log_comment: `Changed in SSI ${stamp}` });
  return dives[1]!.id;
}

/** Lena's SSI dives imported (nothing new when they are already), the entries with several dives here left out. */
export async function importLena(api: APIRequestContext) {
  const ready = await lenaReady(api);
  const started = await api.post(`/api/connections/${ready.connectionId}/dive-import`, { data: { computers: [], decisions: [] }, headers });
  if (!started.ok()) throw new Error(`importing Lena's dives failed: ${started.status()} ${await started.text()}`);
  const { id } = await started.json() as { id: string };
  await expect.poll(async () => (await (await api.get(`/api/imports/${id}`)).json() as { status: string }).status, { timeout: 30_000 }).toBe('done');
  return ready;
}

/** A Dive of Lena's made from her SSI logbook, which has no recording (ADR 0030). */
export async function diveWithoutRecording(api: APIRequestContext): Promise<string> {
  const { diverId } = await importLena(api);
  const { dives } = await (await api.get(`/api/dives?diverId=${diverId}&limit=200&sort=startsAt&order=asc`)).json() as { dives: { id: string }[] };
  for (const d of dives) {
    const view = await (await api.get(`/api/dives/${d.id}`)).json() as { recordings: unknown[]; fromProvider: string | null };
    if (view.recordings.length === 0 && view.fromProvider) return d.id;
  }
  throw new Error('Lena has no dive without a recording');
}

/**
 * Lena's SSI account held by an external Diver, as when she was imported from someone's buddy list before (ADR 0028):
 * Lena not connected, her own account cleared, an external "Lena Berger" with it. Connecting Lena then asks to claim it.
 */
export async function lenaClaimable(api: APIRequestContext) {
  await leaveLena(api);
  const divers = await (await api.get('/api/divers')).json() as { id: string; name: string }[];
  const lena = divers.find((d) => d.name === 'Lena')!;
  await api.put(`/api/divers/${lena.id}/external-ids/ssi`, { data: { externalId: null }, headers });
  const id = await externalDiver(api, `Lena Berger ${Date.now()}`, '6100200');
  return { lenaId: lena.id, externalId: id };
}

/** Lena's SSI Connection gone again; her dives stay. */
export async function leaveLena(api: APIRequestContext) {
  const divers = await (await api.get('/api/divers')).json() as { id: string; name: string }[];
  const lena = divers.find((d) => d.name === 'Lena');
  const connections = await (await api.get('/api/connections')).json() as Connection[];
  for (const c of connections.filter((x) => x.provider === 'ssi' && x.diverId === lena?.id)) await api.delete(`/api/connections/${c.id}`, { headers });
}

/** A marker unique to one test run, in letters only: digits would turn up in the logbook's searches by dive number. */
export const uniqueWord = () => [...String(Date.now())].map((d) => 'abcdefghij'[Number(d)]).join('');

/**
 * Waits until a search field's active result is on the page: React Aria points the field at the new active result
 * (aria-activedescendant) one render after the list changes, which axe would flag in between.
 */
export async function activeResultShown(field: Locator) {
  await expect.poll(() => field.evaluate((el) => {
    const active = el.getAttribute('aria-activedescendant');
    return !active || !!document.getElementById(active);
  })).toBe(true);
}

/** No SSI Connections at all. */
export async function disconnectSsi(api: APIRequestContext) {
  const connections = await (await api.get('/api/connections')).json() as Connection[];
  for (const c of connections.filter((x) => x.provider === 'ssi')) await api.delete(`/api/connections/${c.id}`, { headers });
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
  else await api.put(`/api/dive-sites/${site.id}/external-ids/ssi`, { data: { externalId: null }, headers });
  const dive = await (await api.get(`/api/dives/${diveId}`)).json() as Dive;
  await api.patch(`/api/dives/${diveId}`, { data: { version: dive.version, siteId: site.id }, headers });
  const status = await (await api.get(`/api/dives/${diveId}/providers/ssi`)).json() as { current: unknown };
  if (status.current) await api.delete(`/api/dives/${diveId}/providers/ssi`, { headers });
}

/** Takes the Dive off the test reef again: other specs expect the seeded Dive without a site (as sites.spec.ts leaves it). */
export async function leaveSsi(api: APIRequestContext, diveId: string) {
  const dive = await (await api.get(`/api/dives/${diveId}`)).json() as Dive;
  await api.patch(`/api/dives/${diveId}`, { data: { version: dive.version, siteId: null }, headers });
}

type DeletedDive = { id: string; number: number | null; version: number };

/**
 * Dive 9 (e2e/fixtures/deletable-computer.fit), in the logbook and not in SSI, for the tests that delete it (ADR 0026):
 * imported the first time, restored when an earlier test left it deleted, and taken out of SSI.
 */
export async function deletableDive(api: APIRequestContext): Promise<string> {
  const { dives } = await (await api.get('/api/dives?q=9')).json() as { dives: { id: string; number: number | null }[] };
  let id = dives.find((d) => d.number === 9)?.id;
  if (!id) {
    const deleted = (await (await api.get('/api/dives/deleted')).json() as { dives: DeletedDive[] }).dives.find((d) => d.number === 9);
    if (deleted) {
      await api.post(`/api/dives/${deleted.id}/restore`, { data: { version: deleted.version }, headers });
      id = deleted.id;
    } else {
      const upload = await api.post('/api/imports', {
        headers, multipart: { file: { name: 'deletable-computer.fit', mimeType: 'application/octet-stream', buffer: readFileSync('e2e/fixtures/deletable-computer.fit') } },
      });
      const url = `/api/imports/${(await upload.json() as { id: string }).id}`;
      await expect.poll(async () => (await (await api.get(url)).json()).status).toBe('done');
      id = ((await (await api.get(url)).json()) as { outcome: { diveId?: string }[] }).outcome[0]!.diveId!;
    }
  }
  const status = await (await api.get(`/api/dives/${id}/providers/ssi`)).json() as { current: unknown };
  if (status.current) await api.delete(`/api/dives/${id}/providers/ssi`, { headers });
  return id;
}

/**
 * Two Dives at the same time (ADR 0038): dive 31 from two computers (e2e/fixtures/mergeable-*.fit) as `kept`, with both
 * Recordings, and `other`, a Dive without one beside it. Made once: the backup is split off, merged back, and the Dive
 * that the merge deleted is restored (it gave its Recording away). Later the same deleted Dive is restored again, so
 * merging in a test never leaves a second deleted "Dive 31".
 */
export async function mergeablePair(api: APIRequestContext): Promise<{ kept: string; other: string }> {
  type Shown = { id: string; version: number; recordings: { id: string; device: { serialNumber: string } | null }[] };
  const find = async () => (await (await api.get('/api/dives?q=31')).json() as { dives: { id: string; number: number | null }[] })
    .dives.filter((d) => d.number === 31).map((d) => d.id);
  const shown = async (id: string) => await (await api.get(`/api/dives/${id}`)).json() as Shown;
  const merged = async (into: string) => (await (await api.get('/api/dives/deleted')).json() as { dives: (DeletedDive & { mergedInto: string | null })[] })
    .dives.find((d) => d.number === 31 && d.mergedInto === into);
  let ids = await find();
  if (ids.length === 0) {
    for (const name of ['mergeable-main.fit', 'mergeable-backup.fit']) {
      const upload = await api.post('/api/imports', {
        headers, multipart: { file: { name, mimeType: 'application/octet-stream', buffer: readFileSync(`e2e/fixtures/${name}`) } },
      });
      const url = `/api/imports/${(await upload.json() as { id: string }).id}`;
      await expect.poll(async () => (await (await api.get(url)).json()).status).toBe('done');
    }
    ids = await find();
  }
  if (ids.length === 1) {
    const kept = ids[0]!;
    if (!(await merged(kept))) {
      const one = await shown(kept);
      const backup = one.recordings.find((r) => r.device?.serialNumber === '882')!;
      const split = await (await api.post(`/api/recordings/${backup.id}/detach`, { data: { version: one.version }, headers })).json() as { diveId: string };
      await api.post(`/api/dives/${kept}/merge`, { data: { version: (await shown(kept)).version, otherId: split.diveId, otherVersion: (await shown(split.diveId)).version }, headers });
    }
    const gone = (await merged(kept))!;
    await api.post(`/api/dives/${gone.id}/restore`, { data: { version: gone.version }, headers });
    ids = await find();
  }
  const dives = await Promise.all(ids.map(shown));
  const kept = dives.find((d) => d.recordings.length > 0)!.id;
  const other = dives.find((d) => d.id !== kept)!.id;
  // An earlier test may have answered "these are two dives": asked about again.
  await api.put('/api/logbook-checks/answer', { data: { diveIds: [kept, other], answer: null }, headers });
  return { kept, other };
}

/** Merges the pair again, so the logbook has nothing to decide for the tests that follow. */
export async function mergePair(api: APIRequestContext): Promise<void> {
  const { dives } = await (await api.get('/api/dives?q=31')).json() as { dives: { id: string; number: number | null }[] };
  const ids = dives.filter((d) => d.number === 31).map((d) => d.id);
  if (ids.length < 2) return;
  const version = async (id: string) => (await (await api.get(`/api/dives/${id}`)).json() as { version: number }).version;
  await api.post(`/api/dives/${ids[0]}/merge`, { data: { version: await version(ids[0]!), otherId: ids[1], otherVersion: await version(ids[1]!) }, headers });
}

const FALSE_START_DAY = '2019-02-03';
type DatedDive = { id: string; version: number; startsAt: string };

async function findFalseStart(api: APIRequestContext): Promise<{ live?: string; deleted?: DatedDive }> {
  for (const status of ['open', 'answered']) {
    const checks = await (await api.get(`/api/logbook-checks?status=${status}`)).json() as { rule: string; dive: DatedDive }[];
    const found = checks.find((c) => c.rule === 'short_shallow_dive' && c.dive.startsAt.startsWith(FALSE_START_DAY));
    if (found) return { live: found.dive.id };
  }
  const { dives } = await (await api.get('/api/dives/deleted')).json() as { dives: DatedDive[] };
  const deleted = dives.find((d) => d.startsAt.startsWith(FALSE_START_DAY));
  return deleted ? { deleted } : {};
}

/**
 * A Dive that is probably no dive (ADR 0038): 50 seconds at 1.8 m (e2e/fixtures/false-start.json), waiting as a logbook
 * check. Made once; later it is asked about again, restored first if a test deleted it.
 */
export async function falseStart(api: APIRequestContext): Promise<string> {
  const { live, deleted } = await findFalseStart(api);
  let id = live;
  if (deleted) {
    await api.post(`/api/dives/${deleted.id}/restore`, { data: { version: deleted.version }, headers });
    id = deleted.id;
  }
  if (!id) {
    const upload = await api.post('/api/imports', {
      headers, multipart: { file: { name: 'false-start.json', mimeType: 'application/json', buffer: readFileSync('e2e/fixtures/false-start.json') } },
    });
    const url = `/api/imports/${(await upload.json() as { id: string }).id}`;
    await expect.poll(async () => (await (await api.get(url)).json()).status).toBe('done');
    id = ((await (await api.get(url)).json()) as { outcome: { diveId?: string }[] }).outcome[0]!.diveId!;
  }
  // Restoring it, or an earlier test, answered "keep it": asked about again.
  await api.put('/api/logbook-checks/answer', { data: { diveIds: [id], answer: null }, headers });
  return id;
}

/** Keeps the false start (restoring it does), so nothing waits and no dive is deleted for the tests that follow. */
export async function keepFalseStart(api: APIRequestContext): Promise<void> {
  const { live, deleted } = await findFalseStart(api);
  if (deleted) await api.post(`/api/dives/${deleted.id}/restore`, { data: { version: deleted.version }, headers });
  else if (live) await api.put('/api/logbook-checks/answer', { data: { diveIds: [live], answer: 'keep' }, headers });
}

/** Sends the Dive to the fake SSI, at a site of its own whose SSI ID no other spec uses. */
export async function sendToSsi(api: APIRequestContext, diveId: string) {
  await connectSsi(api);
  const name = 'Deletion test reef';
  const { sites } = await (await api.get(`/api/dive-sites?q=${encodeURIComponent(name)}`)).json() as { sites: { id: string; name: string }[] };
  let site = sites.find((s) => s.name === name);
  if (!site) {
    site = await (await api.post('/api/dive-sites', { data: { name, position: { latitude: 47.86, longitude: 13.56 } }, headers })).json() as { id: string; name: string };
    await api.put(`/api/dive-sites/${site.id}/external-ids/ssi`, { data: { externalId: '6066' }, headers });
  }
  const dive = await (await api.get(`/api/dives/${diveId}`)).json() as Dive;
  await api.patch(`/api/dives/${diveId}`, { data: { version: dive.version, siteId: site.id }, headers });
  const sent = await api.post(`/api/dives/${diveId}/providers/ssi`, { data: {}, headers });
  if (!sent.ok()) throw new Error(`sending to SSI failed: ${sent.status()} ${await sent.text()}`);
}

/** Nobody else on the Dive (ADR 0028): the Participants the buddy tests set are taken off again. */
export async function clearParticipants(api: APIRequestContext, diveId: string) {
  const dive = await (await api.get(`/api/dives/${diveId}`)).json() as Dive;
  await api.put(`/api/dives/${diveId}/participants`, { data: { version: dive.version, participants: [] }, headers });
}

/** External Divers with this name, deleted (they must be on no Dive), so a test can add them again. */
export async function forgetDivers(api: APIRequestContext, name: string) {
  const { divers } = await (await api.get(`/api/external-divers?q=${encodeURIComponent(name)}`)).json() as { divers: { id: string; name: string }[] };
  for (const d of divers.filter((x) => x.name === name)) await api.delete(`/api/external-divers/${d.id}`, { headers });
}

/** An external Diver by this name, created if missing; with an SSI account, if given. */
export async function externalDiver(api: APIRequestContext, name: string, ssiAccount?: string): Promise<string> {
  const { divers } = await (await api.get(`/api/external-divers?q=${encodeURIComponent(name)}`)).json() as { divers: { id: string; name: string }[] };
  const id = divers.find((d) => d.name === name)?.id
    ?? (await (await api.post('/api/external-divers', { data: { name }, headers })).json() as { id: string }).id;
  if (ssiAccount) await api.put(`/api/divers/${id}/external-ids/ssi`, { data: { externalId: ssiAccount }, headers });
  return id;
}

/** The Dive's Participants, all as buddies. */
export async function setBuddies(api: APIRequestContext, diveId: string, diverIds: string[]) {
  const dive = await (await api.get(`/api/dives/${diveId}`)).json() as Dive;
  await api.put(`/api/dives/${diveId}/participants`, {
    data: { version: dive.version, participants: diverIds.map((diverId) => ({ diverId, role: 'buddy' })) }, headers,
  });
}

/** Adds these entries of Erika's SSI buddy list to Dive Hub, as the account page does (ADR 0029). Needs a Connection. */
export async function importSsiBuddies(api: APIRequestContext, accounts: string[]) {
  const connections = await (await api.get('/api/connections')).json() as Connection[];
  const ssi = connections.find((c) => c.provider === 'ssi');
  if (!ssi) throw new Error('no SSI connection');
  await api.post(`/api/connections/${ssi.id}/buddies/import`, { data: { accounts }, headers });
}

type AiAccess = { id: string; name: string };

/** AI access (ADR 0035) switched on for the server, and the seeded User without any access. */
export async function aiAccessReady(api: APIRequestContext) {
  await api.put('/api/admin/ai-access', { data: { enabled: true }, headers });
  const { accesses } = await (await api.get('/api/me/ai-access')).json() as { accesses: AiAccess[] };
  for (const a of accesses) await api.delete(`/api/me/ai-accesses/${a.id}`, { headers });
}

/** A new AI access of the seeded User, with its key. */
export async function createAiAccess(api: APIRequestContext, name: string, positions = false) {
  const created = await (await api.post('/api/me/ai-accesses', { data: { name, positions }, headers })).json() as { access: AiAccess; key: string };
  return { ...created.access, key: created.key };
}

/** Calls a tool of the MCP endpoint with an AI access's key, as an LLM client would (one stateless request). */
export async function askMcp(api: APIRequestContext, key: string, tool: string, args: Record<string, unknown> = {}) {
  return api.post('/mcp', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } },
  });
}

type AssessedFinding = { rule: string; dismissed: boolean; muted: boolean };

/**
 * Dive 77 (e2e/fixtures/assessed-computer.fit), whose assessment has several findings (ADR 0036): imported the first
 * time; every finding shown again, whatever an earlier test put aside.
 */
export async function assessedDive(api: APIRequestContext): Promise<string> {
  const { dives } = await (await api.get('/api/dives?q=77')).json() as { dives: { id: string; number: number | null; diverId: string }[] };
  let found = dives.find((d) => d.number === 77);
  if (!found) {
    const upload = await api.post('/api/imports', {
      headers, multipart: { file: { name: 'assessed-computer.fit', mimeType: 'application/octet-stream', buffer: readFileSync('e2e/fixtures/assessed-computer.fit') } },
    });
    const url = `/api/imports/${(await upload.json() as { id: string }).id}`;
    await expect.poll(async () => (await (await api.get(url)).json()).status).toBe('done');
    const id = ((await (await api.get(url)).json()) as { outcome: { diveId?: string }[] }).outcome[0]!.diveId!;
    found = { id, number: 77, diverId: (await (await api.get(`/api/dives/${id}`)).json() as { diverId: string }).diverId };
  }
  const { findings } = await (await api.get(`/api/dives/${found.id}/assessment`)).json() as { findings: AssessedFinding[] };
  for (const f of findings) {
    if (f.dismissed) await api.put(`/api/dives/${found.id}/findings/${f.rule}/dismissal`, { data: { dismissed: false }, headers });
    if (f.muted) await api.put(`/api/divers/${found.diverId}/muted-rules/${f.rule}`, { data: { muted: false }, headers });
  }
  return found.id;
}

/** Puts findings of a Dive aside as its User would: dismissed on the Dive, or their rule muted for its Diver. */
export async function putAside(api: APIRequestContext, diveId: string, options: { dismiss?: string[] | 'all'; mute?: string[] }) {
  const { diverId } = await (await api.get(`/api/dives/${diveId}`)).json() as { diverId: string };
  // 'all': whatever the Dive has on this server (dives of other specs around it can add findings of their own).
  const dismiss = options.dismiss === 'all'
    ? (await (await api.get(`/api/dives/${diveId}/assessment`)).json() as { findings: AssessedFinding[] }).findings.map((f) => f.rule)
    : options.dismiss ?? [];
  for (const rule of dismiss) await api.put(`/api/dives/${diveId}/findings/${rule}/dismissal`, { data: { dismissed: true }, headers });
  for (const rule of options.mute ?? []) await api.put(`/api/divers/${diverId}/muted-rules/${rule}`, { data: { muted: true }, headers });
}

/**
 * An upload with a scuba dive, an apnea session and a run (e2e/fixtures/account-export.zip), waiting for the User's
 * choice of what to import (ADR 0044). The scuba dive is the seeded one, so importing it adds nothing.
 */
export async function waitingImport(api: APIRequestContext): Promise<string> {
  await cancelWaitingImports(api);
  const upload = await api.post('/api/imports', {
    headers, multipart: { file: { name: 'account-export.zip', mimeType: 'application/zip', buffer: readFileSync('e2e/fixtures/account-export.zip') } },
  });
  const { id } = await upload.json() as { id: string };
  await expect.poll(async () => (await (await api.get(`/api/imports/${id}`)).json()).status).toBe('awaiting_choice');
  return id;
}

/** Ends every Import that waits for a choice, so none stays on the logbook for the next test. */
export async function cancelWaitingImports(api: APIRequestContext) {
  const imports = await (await api.get('/api/imports')).json() as { id: string; status: string }[];
  for (const i of imports.filter((x) => x.status === 'awaiting_choice')) await api.post(`/api/imports/${i.id}/cancel`, { headers });
}
