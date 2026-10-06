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
import { computerDive, createFakeSsi, handTypedDive } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { createMerging } from '../src/dives/merging.js';
import { createDiverService } from '../src/divers/diver-service.js';
import { dive } from '../src/db/schema.js';
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
  ],
  // Erika's SSI buddy list (ADR 0029); buddies.spec.ts adds Kai to Dive Hub and finds Mia for a Diver typed by hand.
  buddies: [
    { owner: 5_012_047, id: 3_786_888, buddy_master_id: 4_989_164, firstname: 'Kai', lastname: 'Lund', email: 'kai@example.com', dob: '1980-01-02', phone: '+49 170 000001', city: 'Kiel' },
    { owner: 5_012_047, id: 2_826_964, buddy_master_id: 4_512_484, firstname: 'Mia', lastname: 'Stone', email: 'mia@example.com', dob: '1985-03-04', phone: '+49 170 000002', city: 'Linz' },
  ],
});
const providers = createProviderLayer({
  db, blobs, secrets: createSecretBox(Buffer.alloc(32, 9)),
  adapters: [createSsiAdapter({ client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fakeSsi.fetch, userAgent: 'DiveHub (e2e)' }) })],
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
const lena = await createDiverService(db).create(user.id, 'Lena');
const dives = createMerging(db);
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
const worker = await startWorker(pool, imports, siteImports, aiAccesses, assessments, app.log);
// Test-only (never in the production app): a browser test changes a dive in an SSI account's logbook, as the User would
// in SSI's app (ADR 0030: changes taken back). By the account's e-mail and SSI's dive number; only the fields given.
app.post('/e2e/fake-ssi/dive', { schema: { hide: true } }, async (request) => {
  const { email, number, set } = request.body as { email: string; number: number; set: Record<string, unknown> };
  const account = fakeSsi.accounts.find((a) => a.email === email);
  const record = [...fakeSsi.dives.values()].find((d) => d.odin_user_log_user_master_id === account?.accountId && d.odin_user_log_nr === number);
  if (!record) return { found: false };
  Object.assign(record, set);
  return { found: true };
});

await app.listen({ host: '127.0.0.1', port });
console.log(`e2e server ready on http://localhost:${port}`);

const stop = async () => { await app.close(); await worker.stop(); await pool.end(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
