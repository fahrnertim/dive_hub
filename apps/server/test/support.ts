// Shared helpers for tests against PostgreSQL: a throwaway database per test file, the app with
// real Better Auth, and signing in through the HTTP API. Skipped when PostgreSQL is unreachable (see databaseReachable).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { LightMyRequestResponse } from 'fastify';
import { createAuth, type Auth } from '../src/auth/auth.js';
import { buildApp } from '../src/app.js';
import { createServices } from '../src/compose.js';
import { createDb, type Db } from '../src/db/client.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { listenToChanges } from '../src/dives/revisions.js';
import type { SiteSourceAdapter } from '../src/sites/import/site-source.js';
import type { ImportSource } from '../src/sites/sources.js';
import { createSecretBox } from '../src/secrets/secret-box.js';
import type { ProviderAdapter } from '../src/providers/provider.js';
import { createSsiAdapter } from '../src/providers/ssi/ssi-adapter.js';
import { createSsiClient } from '../src/providers/ssi/ssi-client.js';
import { createLocalBlobStore } from '../src/storage/blob-store.js';
import { createFakeSsi, type FakeSsi } from './fake-ssi.js';

const baseDbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://divehub:divehub-dev@127.0.0.1:5432/divehub';
export const BASE_URL = 'http://localhost:3000';
/** A password that satisfies the length rule (ADR 0011). */
export const PASSWORD = 'correct horse battery staple';

let skipWarned = false;

/**
 * Whether the database tests can run. Without PostgreSQL they are skipped with a warning; with REQUIRE_DATABASE=1
 * (CI) an unreachable database fails the file instead, so a broken DATABASE_URL never passes as skipped tests.
 */
export async function databaseReachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: baseDbUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch (error) {
    if (process.env.REQUIRE_DATABASE === '1') throw new Error(`REQUIRE_DATABASE is set but PostgreSQL is unreachable at ${new URL(baseDbUrl).host}`, { cause: error });
    // Straight to stderr: Vitest doesn't print the console of a file whose tests were all skipped.
    if (!skipWarned) process.stderr.write(`\nPostgreSQL is unreachable at ${new URL(baseDbUrl).host}: the database tests are SKIPPED, not passed.\n`);
    skipWarned = true;
    return false;
  }
}

export interface TestDatabase {
  db: Db;
  pool: pg.Pool;
  dataDir: string;
  drop(): Promise<void>;
}

/** A fresh database with every migration, or those of `migrationsFolder` (a migration's data test stops before it). */
export async function createTestDatabase(options: { migrationsFolder?: string } = {}): Promise<TestDatabase> {
  const name = `divehub_test_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: baseDbUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(baseDbUrl);
  url.pathname = `/${name}`;
  const { db, pool } = createDb(url.toString());
  await migrateDatabase(db, pool, options.migrationsFolder ?? fileURLToPath(new URL('../drizzle', import.meta.url)));
  const dataDir = await mkdtemp(join(tmpdir(), 'divehub-test-'));
  return {
    db, pool, dataDir,
    async drop() {
      await pool.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export function createTestAuth(db: Db, options: { rateLimit?: boolean } = {}): Auth {
  return createAuth({ db, baseUrl: BASE_URL, secret: 'test-secret-with-enough-entropy-0123456789abcdef', ...options });
}

/** Sources that must not be reached: tests that import pass their own stand-ins. */
export const unreachable = (source: ImportSource): SiteSourceAdapter => ({
  source, fetch: () => Promise.reject(new Error(`the test reached the ${source} Source`)),
});

/** A key for DIVEHUB_ENCRYPTION_KEY in tests (32 bytes). */
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7);

/**
 * The app's clock in tests and the browser tests' server: sleeping skips ahead instead of waiting and is recorded in
 * `slept`. It runs with real time and only skips forward, until a test sets it back with `reset`; a `stopped` clock
 * moves only by skips and sleeps, for a test that checks how long something waited.
 */
export function resettableClock({ stopped = false } = {}) {
  const start = Date.now();
  let skipped = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => (stopped ? start : Date.now()) + skipped,
    async sleep(ms: number) { slept.push(ms); skipped += ms; },
    skip(ms: number) {
      if (ms < 0) throw new Error('the clock only skips forward; use reset() for real time');
      skipped += ms;
    },
    /** Back to real time. */
    reset() { skipped = 0; },
  };
}

export async function createTestApp(t: TestDatabase, options: {
  rateLimit?: boolean; webDir?: string; siteSources?: Record<ImportSource, SiteSourceAdapter>;
  /** SSI as tests see it (default: a fresh fake); `encryptionKey: null` runs without DIVEHUB_ENCRYPTION_KEY. */
  fakeSsi?: FakeSsi; encryptionKey?: Buffer | null;
  /** Providers besides SSI, such as the test-only hand-over adapter (never in production). */
  extraProviders?: ProviderAdapter[];
  /** The leases' clock; two app instances on one database share one (default: a fresh skipping clock). */
  clock?: ReturnType<typeof resettableClock>;
  /** A test's change to the SSI adapter, such as which way its fields travel. */
  ssi?: (adapter: ProviderAdapter) => ProviderAdapter;
} = {}) {
  const {
    webDir, siteSources, fakeSsi = createFakeSsi(), encryptionKey = TEST_ENCRYPTION_KEY, extraProviders = [], clock = resettableClock(), ssi = (a) => a,
    ...authOptions
  } = options;
  // SSI keeps its last logbook read for two minutes (ADR 0027); a test that changes the fake SSI behind Dive Hub's back
  // moves this clock on, as if the change happened a while later. Pauses between actions are skipped and recorded.
  const ssiClock = { now: 0, advance(ms: number) { this.now += ms; } };
  const services = createServices({
    db: t.db, auth: createTestAuth(t.db, authOptions), blobs: createLocalBlobStore(t.dataDir), secrets: createSecretBox(encryptionKey ?? undefined),
    siteSources: siteSources ?? { osm: unreachable('osm'), wikidata: unreachable('wikidata'), ssi: unreachable('ssi') },
    adapters: [
      ssi(createSsiAdapter({
        client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fakeSsi.fetch }),
        now: () => ssiClock.now,
      })),
      ...extraProviders,
    ],
    clock,
  });
  const app = await buildApp({ ...services, baseUrl: BASE_URL, maxUploadBytes: 1 << 26, webDir });
  return { ...services, app, fakeSsi, ssiClock, clock, pauses: clock.slept };
}

/**
 * For a test that builds services without createTestApp: its Revisions are written, and no Provider queue hears them.
 * Without it the test passes only when an earlier file in the shared pool built a provider layer.
 */
export const listenToNoChanges = () => listenToChanges({ diveChanged: async () => {}, siteChanged: async () => {} });

/** Creates a User the way an admin would (Better Auth's admin API, server-side). */
export async function createUser(auth: Auth, email: string, role: 'user' | 'admin' = 'user') {
  const { user } = await auth.api.createUser({ body: { email, name: email.split('@')[0]!, password: PASSWORD, role } });
  return user;
}

/** The `cookie` request header that replays the cookies a response set. */
export const cookieHeader = (response: LightMyRequestResponse) =>
  response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

type App = Awaited<ReturnType<typeof createTestApp>>['app'];

/** Signs in through Better Auth's endpoint like the web client does; returns the session cookie header. */
export async function signIn(app: App, email: string, password = PASSWORD): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: BASE_URL },
    payload: { email, password },
  });
  if (response.statusCode !== 200) throw new Error(`sign-in failed: ${response.statusCode} ${response.body}`);
  return cookieHeader(response);
}

/** A multipart/form-data body with one file in the "file" field, as the web client uploads it. */
export function multipartFile(fileName: string, data: Uint8Array) {
  const boundary = `----divehub${Date.now()}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
