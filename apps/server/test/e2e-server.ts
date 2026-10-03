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
import { createLocalBlobStore } from '../src/storage/blob-store.js';
import { createInvitations } from '../src/users/invitations.js';
import { createSetup } from '../src/users/setup.js';

export const E2E_USER = { email: 'erika@example.com', name: 'Erika', password: 'correct horse battery staple' };

const port = Number(process.env.E2E_PORT ?? 3300);
const baseDbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://divehub:divehub-dev@127.0.0.1:5432/divehub';
const dbName = 'divehub_e2e';
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
const imports = createImportService({ db, blobs });
const auth = createAuth({ db, baseUrl: `http://localhost:${port}`, secret: 'e2e-secret-with-enough-entropy-0123456789abcdef' });
const app = await buildApp({
  db, imports, blobs, auth, setup: createSetup(db), invitations: createInvitations(db),
  baseUrl: `http://localhost:${port}`, maxUploadBytes: 1 << 26, webDir: here('../../web/dist'),
});

// Seed: one User, one Dive from a main computer and a backup that auto-attaches to it.
const { user } = await auth.api.createUser({ body: { ...E2E_USER, role: 'admin' } });
for (const file of ['main-computer.fit', 'backup-computer.fit']) {
  const data = readFileSync(here(`../../web/e2e/fixtures/${file}`));
  const created = await imports.createImport(user.id, file, Readable.from([data]), 1 << 26);
  await imports.processImport(created.id);
}

await app.listen({ host: '127.0.0.1', port });
console.log(`e2e server ready on http://localhost:${port}`);

const stop = async () => { await app.close(); await pool.end(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
