import { fileURLToPath } from 'node:url';
import { createAuth } from './auth/auth.js';
import { loadAuthSecret } from './auth/secret.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { migrateDatabase } from './db/migrate.js';
import { buildApp } from './app.js';
import { createImportService } from './imports/import-service.js';
import { createLocalBlobStore } from './storage/blob-store.js';
import { createInvitations } from './users/invitations.js';
import { createSetup } from './users/setup.js';
import { startWorker } from './worker.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const blobs = createLocalBlobStore(config.dataDir);
const imports = createImportService({ db, blobs });
const auth = createAuth({
  db, baseUrl: config.baseUrl, secret: await loadAuthSecret(config.authSecret, config.dataDir),
  // The Vite dev server proxies /api from its own origin.
  trustedOrigins: config.production ? [] : ['http://localhost:5173'],
});
const setup = createSetup(db);

const app = await buildApp(
  {
    db, imports, blobs, auth, setup, invitations: createInvitations(db), baseUrl: config.baseUrl,
    maxUploadBytes: config.maxUploadBytes, trustedProxies: config.trustedProxies, webDir: config.webDir,
  },
  { logger: { level: config.logLevel } },
);

// src/main.ts (dev) and dist/main.js (image) both sit one level below the drizzle/ folder.
await migrateDatabase(db, pool, fileURLToPath(new URL('../drizzle', import.meta.url)));
const setupToken = await setup.issue();
if (setupToken) {
  // Deliberately logged: whoever can read the server log may create the first admin (ADR 0012).
  app.log.warn(`No admin yet. Open ${config.baseUrl}/#/setup and enter this setup token (valid 24 h, until the first admin exists): ${setupToken}`);
}
const worker = config.inProcessWorker ? await startWorker(pool, imports, app.log) : undefined;
await app.listen({ host: config.host, port: config.port });

const shutdown = async () => {
  app.log.info('shutting down');
  await app.close();
  await worker?.stop();
  await pool.end();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
