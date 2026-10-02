import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { migrateDatabase } from './db/migrate.js';
import { buildApp } from './app.js';
import { DEV_USER_ID, ensureDevUser } from './dev-user.js';
import { createImportService } from './imports/import-service.js';
import { createLocalBlobStore } from './storage/blob-store.js';
import { startWorker } from './worker.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const imports = createImportService({ db, blobs: createLocalBlobStore(config.dataDir) });

const app = await buildApp(
  { db, imports, maxUploadBytes: config.maxUploadBytes, currentUserId: () => DEV_USER_ID, webDir: config.webDir },
  { logger: { level: config.logLevel } },
);

// src/main.ts (dev) and dist/main.js (image) both sit one level below the drizzle/ folder.
await migrateDatabase(db, pool, fileURLToPath(new URL('../drizzle', import.meta.url)));
await ensureDevUser(db);
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
