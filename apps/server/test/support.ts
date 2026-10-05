// Shared helpers for tests against PostgreSQL: a throwaway database per test file, the app with
// real Better Auth, and signing in through the HTTP API. Skipped when PostgreSQL is unreachable.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { LightMyRequestResponse } from 'fastify';
import { createAuth, type Auth } from '../src/auth/auth.js';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createImportService, type ImportService } from '../src/imports/import-service.js';
import { createSiteImportService } from '../src/sites/import/site-import-service.js';
import type { SiteSourceAdapter } from '../src/sites/import/site-source.js';
import type { ImportSource } from '../src/sites/sources.js';
import { createSecretBox } from '../src/secrets/secret-box.js';
import { createProviderLayer } from '../src/providers/layer.js';
import { skippingClock } from '../src/providers/leases.js';
import type { ProviderAdapter } from '../src/providers/provider.js';
import { createSsiAdapter } from '../src/providers/ssi/ssi-adapter.js';
import { createSsiClient } from '../src/providers/ssi/ssi-client.js';
import { createLocalBlobStore } from '../src/storage/blob-store.js';
import { createFakeSsi, type FakeSsi } from './fake-ssi.js';
import { createInvitations } from '../src/users/invitations.js';
import { createSetup, type Setup } from '../src/users/setup.js';

const baseDbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://divehub:divehub-dev@127.0.0.1:5432/divehub';
export const BASE_URL = 'http://localhost:3000';
/** A password that satisfies the length rule (ADR 0011). */
export const PASSWORD = 'correct horse battery staple';

export async function databaseReachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: baseDbUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
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

export async function createTestApp(t: TestDatabase, options: {
  rateLimit?: boolean; webDir?: string; siteSources?: Record<ImportSource, SiteSourceAdapter>;
  /** SSI as tests see it (default: a fresh fake); `encryptionKey: null` runs without DIVEHUB_ENCRYPTION_KEY. */
  fakeSsi?: FakeSsi; encryptionKey?: Buffer | null;
  /** Providers besides SSI, such as the test-only hand-over adapter (never in production). */
  extraProviders?: ProviderAdapter[];
  /** The leases' clock; two app instances on one database share one (default: a fresh skipping clock). */
  clock?: ReturnType<typeof skippingClock>;
} = {}) {
  const {
    webDir, siteSources, fakeSsi = createFakeSsi(), encryptionKey = TEST_ENCRYPTION_KEY, extraProviders = [], clock = skippingClock(),
    ...authOptions
  } = options;
  const auth = createTestAuth(t.db, authOptions);
  const setup: Setup = createSetup(t.db);
  const blobs = createLocalBlobStore(t.dataDir);
  const imports: ImportService = createImportService({ db: t.db, blobs, providerImports: () => providers.diveImports });
  const siteImports = createSiteImportService({ db: t.db, sources: siteSources ?? { osm: unreachable('osm'), wikidata: unreachable('wikidata'), ssi: unreachable('ssi') } });
  // SSI keeps its last logbook read for two minutes (ADR 0027); a test that changes the fake SSI behind Dive Hub's back
  // moves this clock on, as if the change happened a while later. Pauses between actions are skipped and recorded.
  const ssiClock = { now: 0, advance(ms: number) { this.now += ms; } };
  const providers = createProviderLayer({
    db: t.db, blobs, secrets: createSecretBox(encryptionKey ?? undefined),
    adapters: [
      createSsiAdapter({
        client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fakeSsi.fetch, userAgent: 'DiveHub (test)' }),
        now: () => ssiClock.now,
      }),
      ...extraProviders,
    ],
    clock,
  });
  const app = await buildApp({
    db: t.db, imports, siteImports, providers, blobs, auth, setup, invitations: createInvitations(t.db), baseUrl: BASE_URL, maxUploadBytes: 1 << 26, webDir,
  });
  return { app, auth, setup, imports, siteImports, providers, fakeSsi, ssiClock, clock, pauses: clock.slept, blobs };
}

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
