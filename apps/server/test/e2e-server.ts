// The app as the browser tests see it (apps/web/e2e): a fresh database, the built web client, and
// one User with one Dive recorded by two computers. Started by Playwright's webServer; not for production.
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createAuth } from '../src/auth/auth.js';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createImportService } from '../src/imports/import-service.js';
import { createSiteSources } from '../src/sites/import/create-site-sources.js';
import type { Fetch } from '../src/sites/import/polite-http.js';
import { createSiteImportService } from '../src/sites/import/site-import-service.js';
import { ssiSitesZip } from './zip.js';
import { createSecretBox } from '../src/secrets/secret-box.js';
import { createProviderLayer } from '../src/providers/layer.js';
import { skippingClock } from '../src/providers/leases.js';
import { createSsiAdapter } from '../src/providers/ssi/ssi-adapter.js';
import { createSsiClient } from '../src/providers/ssi/ssi-client.js';
import { createLocalBlobStore } from '../src/storage/blob-store.js';
import { computerDive, createFakeSsi, fakeCard, handTypedDive, type FakeSsiSite } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { createMerging } from '../src/dives/merging.js';
import { createLogbookChecks } from '../src/dives/logbook-checks.js';
import { createDiverService } from '../src/divers/diver-service.js';
import { connection, dive, importJob, pushRun, waitingPush } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { createInvitations } from '../src/users/invitations.js';
import { createSetup } from '../src/users/setup.js';
import { startWorker } from '../src/worker.js';
import { createAiAccessService } from '../src/mcp/access-service.js';
import { createAssessmentService } from '../src/assessment/assessment-service.js';

export const E2E_USER = { email: 'erika@example.com', name: 'Erika', password: 'correct horse battery staple' };

const port = Number(process.env.E2E_PORT ?? 3300);
const baseDbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://divehub:divehub-dev@127.0.0.1:5432/divehub';
// One database per e2e server: the browser tests run one server per worker (ADR 0023).
const dbName = process.env.E2E_DB ?? 'divehub_e2e';
if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`E2E_DB must be a plain name: ${dbName}`);
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const admin = new pg.Client({ connectionString: baseDbUrl });
await admin.connect();
await admin.query(`drop database if exists ${dbName} with (force)`);
await admin.query(`create database ${dbName}`);
await admin.end();
const url = new URL(baseDbUrl);
url.pathname = `/${dbName}`;

const { db, pool } = createDb(url.toString());
await migrateDatabase(db, pool, here('../drizzle'));
const blobs = createLocalBlobStore(await mkdtemp(join(tmpdir(), 'divehub-e2e-')));
const assessments = createAssessmentService(db);
const imports = createImportService({ db, blobs, providerImports: () => providers.diveImports, afterImport: assessments.refreshUser });

/**
 * Overpass and Wikidata as recorded, SSI's site list hand-made in its format (test/fixtures/site-sources): the
 * browser tests never reach the live services. Overpass answers Malta and Egypt by country and the Attersee box;
 * anything else has no dive spots.
 */
const recorded = (file: string) => readFileSync(here(`fixtures/site-sources/${file}`), 'utf8');
const ssiZip = await ssiSitesZip();
const replay: Fetch = async (url, init) => {
  const query = new URLSearchParams(init.body ?? '').get('data') ?? '';
  const body: string | Buffer = url.includes('ssi.invalid') ? ssiZip
    : url.includes('wikidata') ? recorded('wikidata-en.json')
    : query.includes('"MT"') ? recorded('overpass-country-MT.json')
    : query.includes('"EG"') ? recorded('overpass-country-EG.json')
    : query.includes('(47.75,13.45,47.95,13.62)') ? recorded('overpass-box-attersee.json')
    : JSON.stringify({ elements: [] });
  const bytes = Buffer.from(body);
  return {
    status: 200, headers: { get: () => null }, text: async () => bytes.toString('utf8'),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
};
const siteImports = createSiteImportService({
  db, sources: createSiteSources({
    fetch: replay, overpassUrl: 'https://overpass.invalid/api/interpreter', wikidataUrl: 'https://wikidata.invalid/sparql',
    ssiSitesUrl: 'https://ssi.invalid/app/APP_CACHE_SITES.zip',
  }),
});
// SSI as the fake answers it (ADR 0024): the browser tests never reach SSI. Its account is Erika's,
// with the password below; the e2e server keeps passwords (it has an encryption key).
// Each reset gives its entries new IDs, so what an earlier test remembered for an entry never sticks to a new one.
let nextTestEntry = 7_000_000;
const seedBuddies = [
  { owner: 5_012_047, id: 3_786_888, buddy_master_id: 4_989_164, firstname: 'Kai', lastname: 'Lund', email: 'kai@example.com', dob: '1980-01-02', phone: '+49 170 000001', city: 'Kiel' },
  { owner: 5_012_047, id: 2_826_964, buddy_master_id: 4_512_484, firstname: 'Mia', lastname: 'Stone', email: 'mia@example.com', dob: '1985-03-04', phone: '+49 170 000002', city: 'Linz' },
];
const fakeSsi = createFakeSsi({
  accounts: [
    { email: 'erika@example.com', password: 'ssi-password', accountId: 5_012_047 },
    // Lena's own SSI account, whose logbook dive-import.spec.ts imports (ADR 0030).
    { email: 'lena@example.com', password: 'ssi-password-lena', accountId: 6_100_200 },
  ],
  // Hausreef's 3314 is the ID site-import.spec.ts types by hand; ssi.spec.ts picks Schwarzenbach.
  sites: [
    { odin_dive_sites_id: 3314, odin_dive_sites_name: 'Hausreef', odin_dive_sites_lat: 27.29, odin_dive_sites_lon: 33.82, odin_countries_code_iso: 'EG' },
    { odin_dive_sites_id: 5120, odin_dive_sites_name: 'Attersee – Schwarzenbach', odin_dive_sites_lat: 47.8512, odin_dive_sites_lon: 13.5514, odin_countries_code_iso: 'AT' },
    // Erika's own private site, and one private to Lena (SSI's logbook lists it, Dive Hub drops it): the private-ID browser tests.
    { odin_dive_sites_id: 7010, odin_dive_sites_name: 'Erikas Geheimriff', odin_dive_sites_lat: 27.5, odin_dive_sites_lon: 34.1, odin_countries_code_iso: 'EG', odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: 5_012_047 },
    { odin_dive_sites_id: 7020, odin_dive_sites_name: 'Lenas Geheimriff', odin_dive_sites_lat: 27.6, odin_dive_sites_lon: 34.2, odin_countries_code_iso: 'EG', odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: 6_100_200 },
  ],
  // Erika's SSI buddy list (ADR 0029); buddies.spec.ts adds Kai to Dive Hub and finds Mia for a Diver typed by hand.
  buddies: seedBuddies.map((b) => ({ ...b })),
  // Erika's certification cards (ADR 0050); certifications.spec.ts imports them from the Diver page. Invented values.
  cards: [
    fakeCard(5_012_047, { uid: 'E2ECARD-0001', course: 'Open Water Diver', short: 'owd', courseId: 101, issued: '2019-06-15', dives: 9 }),
    fakeCard(5_012_047, { uid: 'E2ECARD-0002', course: 'Advanced Adventurer', short: 'aa', courseId: 102, issued: '2021-04-02', dives: 40 }),
  ],
});
const quick = <A extends { capabilities: { limits: { pauseMs: number; run: unknown } } }>(adapter: A): A => ({
  ...adapter, capabilities: { ...adapter.capabilities, limits: { ...adapter.capabilities.limits, pauseMs: 0, run: { pauseMs: 150, maxDives: 100 } } },
});
const providers = createProviderLayer({
  db, blobs, secrets: createSecretBox(Buffer.alloc(32, 9)),
  // SSI's pauses between Dives are for the real SSI (5 s in a run); the fake takes them as fast as the browser tests go.
  adapters: [quick(createSsiAdapter({ client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fakeSsi.fetch }) }))],
  // The fake needs no pause between actions; the browser tests would only wait, so the pauses are skipped.
  clock: skippingClock(),
});
const auth = createAuth({ db, baseUrl: `http://localhost:${port}`, secret: 'e2e-secret-with-enough-entropy-0123456789abcdef' });
const aiAccesses = createAiAccessService(db, auth);
const app = await buildApp({
  db, imports, siteImports, providers, blobs, auth, aiAccesses, assessments, setup: createSetup(db), invitations: createInvitations(db),
  baseUrl: `http://localhost:${port}`, maxUploadBytes: 1 << 26, webDir: here('../../web/dist'),
});

// Seed: one User, one Dive from a main computer and a backup that auto-attaches to it.
const { user } = await auth.api.createUser({ body: { ...E2E_USER, role: 'admin' } });
for (const file of ['main-computer.fit', 'backup-computer.fit']) {
  const data = readFileSync(here(`../../web/e2e/fixtures/${file}`));
  const created = await imports.createImport(user.id, file, Readable.from([data]), 1 << 26);
  await imports.processImport(created.id);
}

// Lena, a Diver Erika keeps, with four dives from a computer's files (UTC+2): two on 12 and two on 13 August 2025, at 10:00
// and 10:40 local time each day. Her SSI logbook (ADR 0030): two dives typed by hand at Hausreef, one from a Mares, and
// one typed by hand at 10:20 on each of those days, between two of her dives (dive-import.spec.ts decides the first; the
// second stays to decide).
const divers = createDiverService(db);
const lena = await divers.create(user.id, 'Lena');
// Dive numbers are the place in the logbook (ADR 0048): the seeded Dive is 42 and Lena's four are 501 to 504, as the
// computers counted them, by the dives before these logbooks.
await divers.update(user.id, (await divers.list(user.id)).find((d) => d.isOwn)!.id, { divesBefore: 41 });
await divers.update(user.id, lena.id, { divesBefore: 500 });
const dives = createMerging(db, createLogbookChecks(db));
for (const [n, start] of [[501, '2025-08-12T08:00:00Z'], [502, '2025-08-12T08:40:00Z'], [503, '2025-08-13T08:00:00Z'], [504, '2025-08-13T08:40:00Z']] as const) {
  const created = await imports.createImport(user.id, `lena-${n}.fit`, Readable.from([Buffer.from(makeSyntheticDive({ serialNumber: 7070, start: new Date(start), diveNumber: n }))]), 1 << 26);
  const outcome = await imports.processImport(created.id);
  const [moved] = await db.select({ id: dive.id, version: dive.version }).from(dive).where(eq(dive.id, outcome[0]!.diveId!));
  await dives.move(user.id, moved!.id, lena.id, moved!.version);
}
for (const record of [
  handTypedDive({ at: '2025-08-10 10:00', depthM: 20, minutes: 45, siteId: 3314, comment: 'Napoleon at the drop-off', nr: 11 }),
  handTypedDive({ at: '2025-08-10 14:30', depthM: 16, minutes: 50, siteId: 3314, nr: 12 }),
  computerDive({ at: '2025-08-11 09:30', depthM: 22, minutes: 40, manufacturer: 'Mares', product: 'Puck 4', serial: '4711', siteId: 3314, nr: 13 }),
  handTypedDive({ at: '2025-08-12 10:20', depthM: 18, minutes: 40, nr: 14 }),
  handTypedDive({ at: '2025-08-13 10:20', depthM: 18, minutes: 40, nr: 15 }),
]) fakeSsi.addDive(6_100_200, record);

// Uploads made by the tests are processed in the background, as in the real app.
const worker = await startWorker(pool, {
  imports, siteImports, aiAccesses, assessments, pushRuns: providers.pushRuns, waitingPushes: providers.waitingPushes,
  scheduledFetch: providers.scheduledFetch, certifications: providers.certifications, log: app.log,
});
// Test-only (never in the production app): a browser test changes a dive in an SSI account's logbook, as the User would
// in SSI's app (ADR 0030: changes taken back). By the account's e-mail and SSI's dive number or ID; only the fields given.
// `site`: a site SSI then lists too (one Dive Hub doesn't know), when it isn't listed yet.
app.post('/e2e/fake-ssi/dive', { schema: { hide: true } }, async (request) => {
  const { email, number, remoteId, set, site } = request.body as {
    email: string; number?: number; remoteId?: string; set: Record<string, unknown>; site?: FakeSsiSite;
  };
  if (site && !fakeSsi.sites.some((s) => s.odin_dive_sites_id === site.odin_dive_sites_id)) fakeSsi.sites.push(site);
  const account = fakeSsi.accounts.find((a) => a.email === email);
  const record = remoteId !== undefined
    ? [fakeSsi.dives.get(Number(remoteId))].find((d) => d?.odin_user_log_user_master_id === account?.accountId)
    : [...fakeSsi.dives.values()].find((d) => d.odin_user_log_user_master_id === account?.accountId && d.odin_user_log_nr === number);
  if (!record) return { found: false };
  Object.assign(record, set);
  return { found: true };
});

// Test-only: a dive is deleted in SSI's app (ADR 0051): the account's logbook no longer lists it. By the account's
// e-mail and SSI's dive ID.
app.post('/e2e/fake-ssi/delete-dive', { schema: { hide: true } }, async (request) => {
  const { email, remoteId } = request.body as { email: string; remoteId: string };
  const account = fakeSsi.accounts.find((a) => a.email === email);
  const record = fakeSsi.dives.get(Number(remoteId));
  if (!account || !record || record.odin_user_log_user_master_id !== account.accountId) return { found: false };
  // An account whose logbook would be empty has nothing to compare (an empty logbook is never a finding): another dive stays.
  const others = [...fakeSsi.dives.entries()].some(([key, d]) => key !== Number(remoteId) && d.odin_user_log_user_master_id === account.accountId && d.odin_user_log_deleted !== 1);
  if (!others) fakeSsi.addDive(account.accountId, handTypedDive({ at: '2025-07-01 09:00', depthM: 12, minutes: 30, nr: 900 }));
  fakeSsi.dives.delete(Number(remoteId));
  return { found: true };
});

// Test-only: one SSI account's tokens expire (a Connection that keeps no password then needs a new sign-in). Only that
// account's: Lena's Connection, used by other tests on this server, stays signed in.
app.post('/e2e/fake-ssi/expire-tokens', { schema: { hide: true } }, async (request) => {
  const { email } = request.body as { email: string };
  const account = fakeSsi.accounts.find((a) => a.email === email);
  if (!account) return { ok: false };
  fakeSsi.expireTokens(account.accountId);
  return { ok: true };
});

// Test-only: Erika's SSI buddy list is put back to Kai and Mia, plus these entries without an SSI account (an account-only
// entry has no name yet), and what SSI's profiles say about some accounts (so a `save_buddy` by that account is answered
// under that name). The tests that add to or link in the list start from here.
app.post('/e2e/fake-ssi/buddies', { schema: { hide: true } }, async (request) => {
  const { entries = [], profiles = [] } = (request.body ?? {}) as {
    entries?: { firstname: string; lastname: string }[]; profiles?: { account: number; firstname: string; lastname: string }[];
  };
  fakeSsi.buddies.splice(0, fakeSsi.buddies.length, ...seedBuddies.map((b) => ({ ...b })), ...entries.map((e) => ({
    owner: 5_012_047, id: nextTestEntry++, buddy_master_id: 0, firstname: e.firstname, lastname: e.lastname, email: '', dob: '0000-00-00', phone: ' ', city: '', confirmed: 0,
  })));
  fakeSsi.profiles.clear();
  for (const p of profiles) fakeSsi.profiles.set(p.account, { firstname: p.firstname, lastname: p.lastname });
  return { ok: true };
});

// Test-only: the dives in an SSI account's logbook are removed (what earlier tests sent), so a run finds no dive there.
app.post('/e2e/fake-ssi/clear-dives', { schema: { hide: true } }, async (request) => {
  const { email } = request.body as { email: string };
  const account = fakeSsi.accounts.find((a) => a.email === email);
  for (const [key, record] of fakeSsi.dives) if (record.odin_user_log_user_master_id === account?.accountId) fakeSsi.dives.delete(key);
  return { ok: true };
});

// Test-only: a run that ended stays in the logbook's strip until dismissed, in each browser's own storage; the tests that
// start runs remove them, so other tests see no strip.
app.post('/e2e/push-runs/clear', { schema: { hide: true } }, async () => { await db.delete(pushRun); return { ok: true }; });

// Test-only: an entry of the queue in a given state (the worker would settle a real one within a minute): by the Dive,
// its Connection and the Provider. `dueInMs` counts from now; the tests that look at it clear it afterwards.
app.post('/e2e/waiting-push/set', { schema: { hide: true } }, async (request) => {
  const b = request.body as {
    diveId: string; connectionId: string; provider: string; action?: 'send' | 'delete';
    state: 'waiting' | 'held' | 'stopped'; reason?: string | null; dueInMs?: number;
    /** With reason `exists`: the dive already at the Provider. */
    detail?: { remoteId: string; remoteNumber: number | null; startsAt: string };
  };
  const now = new Date();
  const row = {
    diveId: b.diveId, connectionId: b.connectionId, provider: b.provider, action: b.action ?? 'send', state: b.state,
    reason: b.reason ?? null, detail: b.detail ?? null, dueAt: new Date(now.getTime() + (b.dueInMs ?? 3_600_000)), changedAt: now,
  };
  await db.insert(waitingPush).values(row).onConflictDoUpdate({ target: [waitingPush.diveId, waitingPush.provider], set: row });
  return { ok: true };
});

// Test-only: every entry of the queue is removed.
app.post('/e2e/waiting-push/clear', { schema: { hide: true } }, async () => { await db.delete(waitingPush); return { ok: true }; });

// Test-only: what the Connection shows of its last fetch and of the new Dives it offers to send (ADR 0056): an Import with
// that outcome is made and tied to it. `unsent` lists Dives the Import "created".
app.post('/e2e/connection/fetch-state', { schema: { hide: true } }, async (request) => {
  const b = request.body as { id: string; clear?: boolean; created?: number; updated?: number; skipped?: number; unsent?: string[] | null };
  const [conn] = await db.select().from(connection).where(eq(connection.id, b.id));
  if (!conn) return { ok: false };
  if (b.clear) {
    await db.update(connection).set({ lastFetchImportId: null, unsentImportIds: [] }).where(eq(connection.id, conn.id));
    return { ok: true };
  }
  const entries = (result: 'created' | 'updated' | 'skipped', n: number, ids: string[] = []) => Array.from({ length: n }, (_, i) => ({
    fileName: `fake-${result}-${i}`, result, ...(result === 'skipped' && { reason: 'ambiguous' as const }), ...(ids[i] && { diveId: ids[i] }),
  }));
  const [made] = await db.insert(importJob).values({
    userId: conn.userId, status: 'done', uploadName: conn.provider, provider: conn.provider, connectionId: conn.id, finishedAt: new Date(),
    outcome: [...entries('created', b.created ?? 0), ...entries('updated', b.updated ?? 0), ...entries('skipped', b.skipped ?? 0)],
  }).returning({ id: importJob.id });
  await db.update(connection).set({ lastFetchImportId: made!.id }).where(eq(connection.id, conn.id));
  if (b.unsent !== undefined) {
    const [offer] = b.unsent === null ? [] : await db.insert(importJob).values({
      userId: conn.userId, status: 'done', uploadName: conn.provider, provider: conn.provider, connectionId: conn.id, finishedAt: new Date(),
      outcome: entries('created', b.unsent.length, b.unsent),
    }).returning({ id: importJob.id });
    await db.update(connection).set({ unsentImportIds: offer ? [offer.id] : [] }).where(eq(connection.id, conn.id));
  }
  return { ok: true };
});

// Test-only: a Connection that keeps no password needs a new sign-in (signing in again sets it right).
app.post('/e2e/connection/needs-sign-in', { schema: { hide: true } }, async (request) => {
  const { id } = request.body as { id: string };
  await db.update(connection).set({ state: 'needs_sign_in', keepSignedIn: false }).where(eq(connection.id, id));
  return { ok: true };
});

await app.listen({ host: '127.0.0.1', port });
console.log(`e2e server ready on http://localhost:${port}`);

const stop = async () => { await app.close(); await worker.stop(); await pool.end(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
