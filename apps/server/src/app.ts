import { existsSync } from 'node:fs';
import Fastify, { type FastifyServerOptions } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import type { Auth } from './auth/auth.js';
import { authHandler } from './auth/fastify.js';
import { withAuthEndpoints } from './auth/openapi.js';
import type { Db } from './db/client.js';
import type { ImportService } from './imports/import-service.js';
import { problem, useProblemErrors } from './http/problems.js';
import { createDiveService } from './dives/dive-service.js';
import { createCandidates } from './dives/candidates.js';
import { candidateRoutes } from './dives/candidate-routes.js';
import { diveRoutes } from './dives/routes.js';
import { createDiverService } from './divers/diver-service.js';
import { diverRoutes } from './divers/routes.js';
import { apiRoutes } from './routes.js';
import { createSiteService } from './sites/site-service.js';
import { siteRoutes } from './sites/routes.js';
import type { SiteImportService } from './sites/import/site-import-service.js';
import { siteImportRoutes } from './sites/import/site-import-routes.js';
import type { ProviderLayer } from './providers/layer.js';
import { providerRoutes } from './providers/routes.js';
import { aiAccessRoutes } from './mcp/access-routes.js';
import type { AiAccessService } from './mcp/access-service.js';
import { mcpEndpoint } from './mcp/endpoint.js';
import type { BlobStore } from './storage/blob-store.js';
import { accountRoutes } from './users/account-routes.js';
import { adminRoutes } from './users/admin-routes.js';
import type { Invitations } from './users/invitations.js';
import { createPasswordResets } from './users/password-resets.js';
import { userRoutes } from './users/routes.js';
import type { Setup } from './users/setup.js';
import { createUserAdmin } from './users/user-admin.js';

export interface AppDeps {
  db: Db;
  imports: ImportService;
  siteImports: SiteImportService;
  /** Providers such as SSI, their Connections and Pushes (ADR 0024, 0027). */
  providers: ProviderLayer;
  blobs: BlobStore;
  auth: Auth;
  /** AI accesses to the MCP endpoint, the instance's switch and the log (ADR 0035). */
  aiAccesses: AiAccessService;
  setup: Setup;
  invitations: Invitations;
  /** Public URL of the instance; invitation links point there. */
  baseUrl: string;
  maxUploadBytes: number;
  /** Reverse proxies whose X-Forwarded-For is believed; empty means none. */
  trustedProxies?: string[];
  webDir?: string | undefined;
}

export async function buildApp(deps: AppDeps, options: FastifyServerOptions = {}) {
  const trustedProxies = deps.trustedProxies ?? [];
  const app = Fastify({ ...options, ...(trustedProxies.length > 0 && { trustProxy: trustedProxies }) })
    .withTypeProvider<TypeBoxTypeProvider>();
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  useProblemErrors(app);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Dive Hub API',
        version: '0.6.0',
        description: 'Sign in with POST /api/auth/sign-in/email (Better Auth); the session cookie authenticates every other call.',
      },
    },
  });
  await app.register(multipart, { limits: { files: 1, fileSize: deps.maxUploadBytes } });

  app.get('/api/health/live', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/api/health/ready', { schema: { hide: true } }, async () => {
    await deps.db.execute(sql`select 1`);
    return { status: 'ok' };
  });
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => withAuthEndpoints(app.swagger(), deps.auth));

  await app.register(authHandler, { auth: deps.auth });
  const passwordResets = createPasswordResets(deps.db);
  await app.register(userRoutes, { prefix: '/api', ...deps });
  await app.register(accountRoutes, { prefix: '/api', ...deps, passwordResets });
  await app.register(adminRoutes, { prefix: '/api', ...deps, passwordResets, userAdmin: createUserAdmin(deps.db, deps.blobs) });
  await app.register(apiRoutes, { prefix: '/api', ...deps });
  await app.register(diveRoutes, { prefix: '/api', ...deps, dives: createDiveService(deps.db), pushes: deps.providers.pushes });
  await app.register(candidateRoutes, { prefix: '/api', ...deps, candidates: createCandidates(deps.db) });
  await app.register(diverRoutes, { prefix: '/api', ...deps, divers: createDiverService(deps.db) });
  await app.register(siteRoutes, { prefix: '/api', ...deps, sites: createSiteService(deps.db) });
  await app.register(siteImportRoutes, { prefix: '/api', ...deps });
  await app.register(providerRoutes, { prefix: '/api', auth: deps.auth, ...deps.providers });
  await app.register(aiAccessRoutes, { prefix: '/api', auth: deps.auth, accesses: deps.aiAccesses, baseUrl: deps.baseUrl });
  // The MCP endpoint (ADR 0035): not under /api, authenticated by an AI access's key instead of a session.
  await app.register(mcpEndpoint, { db: deps.db, accesses: deps.aiAccesses, baseUrl: deps.baseUrl });

  const serveWeb = !!deps.webDir && existsSync(deps.webDir);
  if (serveWeb) await app.register(fastifyStatic, { root: deps.webDir!, wildcard: false });
  // Single-page app: unknown page paths get index.html. Unknown API paths and missing files (a path
  // with an extension, e.g. an old asset) get a 404, so a browser never runs HTML as a script.
  const isPage = (url: string) => !url.startsWith('/api/') && url.split(/[?#]/)[0] !== '/mcp' && !/\.[a-z0-9]+$/i.test(url.split(/[?#]/)[0]!);
  app.setNotFoundHandler((request, reply) =>
    serveWeb && request.method === 'GET' && isPage(request.url) ? reply.sendFile('index.html') : reply.code(404).send(problem('not_found')),
  );
  return app;
}
