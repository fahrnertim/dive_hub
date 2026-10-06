import { fileURLToPath } from 'node:url';
import { createAuth } from './auth/auth.js';
import { loadAuthSecret } from './auth/secret.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { findChangedMigrations, migrateDatabase } from './db/migrate.js';
import { buildApp } from './app.js';
import { createImportService } from './imports/import-service.js';
import { createSiteSources } from './sites/import/create-site-sources.js';
import { createSiteImportService } from './sites/import/site-import-service.js';
import { userAgent } from './sites/import/polite-http.js';
import { createSecretBox } from './secrets/secret-box.js';
import { createProviderLayer } from './providers/layer.js';
import { createSsiAdapter } from './providers/ssi/ssi-adapter.js';
import { createSsiClient } from './providers/ssi/ssi-client.js';
import { createAiAccessService } from './mcp/access-service.js';
import { createLocalBlobStore } from './storage/blob-store.js';
import { createInvitations } from './users/invitations.js';
import { createSetup } from './users/setup.js';
import { startWorker } from './worker.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const blobs = createLocalBlobStore(config.dataDir);
// Imports of a Provider's dives run in the worker like uploads (ADR 0030); the layer is built below.
const imports = createImportService({ db, blobs, providerImports: () => providers.diveImports });
const siteImports = createSiteImportService({
  db, sources: createSiteSources({ contact: config.contact, overpassUrl: config.overpassUrl, wikidataUrl: config.wikidataSparqlUrl, ssiSitesUrl: config.ssiSitesUrl }),
});
// The Providers of this instance (ADR 0027): SSI only, for now. Every call to SSI is logged (no token or password), to
// tell Dive Hub's use of an account from the owner's own (docs/references/ssi-app-api.md); calls only come after `app` exists.
const providers = createProviderLayer({
  db, blobs, secrets: createSecretBox(config.encryptionKey),
  adapters: [createSsiAdapter({
    client: createSsiClient({ url: config.ssiUrl, userAgent: userAgent(config.contact) }),
    onCall: (call) => app.log.info({ ssi: call }, 'SSI call'),
  })],
});
const auth = createAuth({
  db, baseUrl: config.baseUrl, secret: await loadAuthSecret(config.authSecret, config.dataDir),
  // The Vite dev server proxies /api from its own origin.
  trustedOrigins: config.production ? [] : ['http://localhost:5173'],
});
const setup = createSetup(db);
const aiAccesses = createAiAccessService(db, auth);

const app = await buildApp(
  {
    db, imports, siteImports, providers, blobs, auth, aiAccesses, setup, invitations: createInvitations(db), baseUrl: config.baseUrl,
    maxUploadBytes: config.maxUploadBytes, trustedProxies: config.trustedProxies, webDir: config.webDir,
  },
  { logger: { level: config.logLevel } },
);

// src/main.ts (dev) and dist/main.js (image) both sit one level below the drizzle/ folder.
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
await migrateDatabase(db, pool, migrationsFolder);
const changedMigrations = await findChangedMigrations(pool, migrationsFolder);
if (changedMigrations.length > 0) {
  app.log.error({ migrations: changedMigrations }, 'Migration files changed after this database applied them; their changes never ran here. Put changes into a new migration (docs/development.md).');
}
const setupToken = await setup.issue();
if (setupToken) {
  // Deliberately logged: whoever can read the server log may create the first admin (ADR 0012).
  app.log.warn(`No admin yet. Open ${config.baseUrl}/#/setup and enter this setup token (valid 24 h, until the first admin exists): ${setupToken}`);
}
const worker = config.inProcessWorker ? await startWorker(pool, imports, siteImports, aiAccesses, app.log) : undefined;
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
