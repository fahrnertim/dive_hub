// Boots the server in its order: logger, services, routes, migrations, the setup token, the worker, then listening.
// main.ts calls it; nothing here runs on import.
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth/auth.js';
import { loadAuthSecret } from './auth/secret.js';
import type { Config } from './config.js';
import { createDb } from './db/client.js';
import { findChangedMigrations, migrateDatabase } from './db/migrate.js';
import { buildApp, createServer } from './app.js';
import { createServices, workerDeps } from './compose.js';
import { createSiteSources } from './site-sources.js';
import { createSecretBox } from './secrets/secret-box.js';
import { createGarminAdapter } from './providers/garmin/garmin-adapter.js';
import { createGarminClient, DEFAULT_GARMIN_URL } from './providers/garmin/garmin-client.js';
import { createSsiAdapter } from './providers/ssi/ssi-adapter.js';
import { createSsiClient } from './providers/ssi/ssi-client.js';
import { createLocalBlobStore } from './storage/blob-store.js';
import { startWorker } from './worker.js';

export async function start(config: Config) {
  const { db, pool } = createDb(config.databaseUrl);
  // The logger comes first: the Providers and the worker log through it.
  const app = createServer({
    logger: { level: config.logLevel },
    // Reverse proxies whose X-Forwarded-For is believed; none unless configured.
    ...(config.trustedProxies.length > 0 && { trustProxy: config.trustedProxies }),
  });
  const auth = createAuth({
    db, baseUrl: config.baseUrl, secret: await loadAuthSecret(config.authSecret, config.dataDir),
    // The Vite dev server proxies /api from its own origin.
    trustedOrigins: config.production ? [] : ['http://localhost:5173'],
  });
  const services = createServices({
    db, auth, blobs: createLocalBlobStore(config.dataDir), secrets: createSecretBox(config.encryptionKey),
    siteSources: createSiteSources({ contact: config.contact, overpassUrl: config.overpassUrl, wikidataUrl: config.wikidataSparqlUrl, ssiSitesUrl: config.ssiSitesUrl }),
    // The Providers of this instance (ADR 0027): SSI and Garmin. Every call to SSI is logged (no token or password), to
    // tell Dive Hub's use of an account from the owner's own (docs/references/ssi-app-api.md).
    adapters: [createSsiAdapter({ client: createSsiClient({ url: config.ssiUrl }), onCall: (call) => app.log.info({ ssi: call }, 'SSI call') }),
      createGarminAdapter({ client: createGarminClient({ url: config.garminUrl ?? DEFAULT_GARMIN_URL }) })],
    // The worker's own faults, with the entry they hit, for the operator.
    log: app.log,
  });
  await buildApp({ ...services, baseUrl: config.baseUrl, maxUploadBytes: config.maxUploadBytes, webDir: config.webDir }, app);

  // src/ (dev) and dist/ (image) both sit one level below the drizzle/ folder.
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  await migrateDatabase(db, pool, migrationsFolder);
  const changedMigrations = await findChangedMigrations(pool, migrationsFolder);
  if (changedMigrations.length > 0) {
    app.log.error({ migrations: changedMigrations }, 'Migration files changed after this database applied them; their changes never ran here. Put changes into a new migration (docs/development.md).');
  }
  const setupToken = await services.setup.issue();
  if (setupToken) {
    // Deliberately logged: whoever can read the server log may create the first admin (ADR 0012).
    app.log.warn(`No admin yet. Open ${config.baseUrl}/#/setup and enter this setup token (valid 24 h, until the first admin exists): ${setupToken}`);
  }
  // The worker starts after the migrations, and the server listens last.
  const worker = config.inProcessWorker ? await startWorker(pool, workerDeps(services, app.log)) : undefined;
  await app.listen({ host: config.host, port: config.port });

  return {
    app, worker,
    async stop() {
      app.log.info('shutting down');
      await app.close();
      await worker?.stop();
      await pool.end();
    },
  };
}
