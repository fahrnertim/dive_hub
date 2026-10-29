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
import { createLogbookService } from './dives/logbook-service.js';
import { createMerging } from './dives/merging.js';
import { createLogbookChecks } from './dives/logbook-checks.js';
import { createCandidates } from './dives/candidates.js';
import { candidateRoutes } from './dives/candidate-routes.js';
import { diveRoutes } from './dives/routes.js';
import { createDiverService } from './divers/diver-service.js';
import { certificationRoutes } from './certifications/routes.js';
import { diverRoutes } from './divers/routes.js';
import { leadRoutes } from './lead/routes.js';
import { createLeadService } from './lead/service.js';
import { createPlanningService } from './planning/planning-service.js';
import { planningRoutes } from './planning/routes.js';
import { apiRoutes } from './routes.js';
import { createSiteService } from './sites/site-service.js';
import { siteRoutes } from './sites/routes.js';
import { createCentreService } from './centres/centre-service.js';
import { centreRoutes } from './centres/routes.js';
import type { SiteImportService } from './sites/import/site-import-service.js';
import { siteImportRoutes } from './sites/import/site-import-routes.js';
import type { ProviderLayer } from './providers/layer.js';
import { providerRoutes } from './providers/routes.js';
import { assessmentRoutes } from './assessment/routes.js';
import type { AssessmentService } from './assessment/assessment-service.js';
import { aiAccessRoutes } from './mcp/access-routes.js';
import type { AiAccessService } from './mcp/access-service.js';
import { mcpEndpoint } from './mcp/endpoint.js';
import type { BlobStore } from './storage/blob-store.js';
import { accountRoutes } from './users/account-routes.js';
import { adminRoutes } from './users/admin-routes.js';
import type { Invitations } from './users/invitations.js';
import { createPasswordResets } from './users/password-resets.js';
import { createProfileService } from './users/profile-service.js';
import { createSessionService } from './users/session-service.js';
import { userRoutes } from './users/routes.js';
import type { Setup } from './users/setup.js';
import { createUserAdmin } from './users/user-admin.js';

export interface AppDeps {
  db: Db;
  imports: ImportService;
  siteImports: SiteImportService;
  /** Providers such as SSI, their Connections and Pushes (ADR 0024, 0027). */
  providers: ProviderLayer;
  /** Stored files: deleting a User lets theirs go. */
  blobs: BlobStore;
  auth: Auth;
  /** The dive assessment (ADR 0036): kept up to date after whatever changes a logbook. */
  assessments: AssessmentService;
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
  const { db, auth, assessments, baseUrl } = deps;
  const { pushes, waitingPushes, certifications } = deps.providers;
  await app.register(userRoutes, { prefix: '/api', auth, profiles: createProfileService(db), setup: deps.setup, invitations: deps.invitations, baseUrl });
  await app.register(accountRoutes, { prefix: '/api', auth, passwordResets, sessions: createSessionService(db) });
  await app.register(adminRoutes, { prefix: '/api', auth, passwordResets, userAdmin: createUserAdmin(db, deps.blobs), baseUrl });
  const logbook = createLogbookService(db);
  const divers = createDiverService(db);
  const centres = createCentreService(db);
  await app.register(apiRoutes, { prefix: '/api', auth, imports: deps.imports, logbook, pushes, waitingPushes, maxUploadBytes: deps.maxUploadBytes });
  await app.register(diveRoutes, { prefix: '/api', auth, logbook, divers, centres, dives: createDiveService(db), merging: createMerging(db), checks: createLogbookChecks(db), pushes, waitingPushes, assessments });
  await app.register(candidateRoutes, { prefix: '/api', auth, candidates: createCandidates(db), assessments });
  await app.register(assessmentRoutes, { prefix: '/api', auth, assessments });
  await app.register(diverRoutes, { prefix: '/api', auth, divers, certifications });
  await app.register(certificationRoutes, { prefix: '/api', auth, certifications });
  await app.register(planningRoutes, { prefix: '/api', auth, planning: createPlanningService(db) });
  await app.register(leadRoutes, { prefix: '/api', auth, lead: createLeadService(db) });
  await app.register(siteRoutes, { prefix: '/api', auth, sites: createSiteService(db) });
  await app.register(centreRoutes, { prefix: '/api', auth, centres, divers });
  await app.register(siteImportRoutes, { prefix: '/api', auth, siteImports: deps.siteImports });
  await app.register(providerRoutes, { prefix: '/api', auth, ...deps.providers });
  await app.register(aiAccessRoutes, { prefix: '/api', auth, accesses: deps.aiAccesses, baseUrl });
  // The MCP endpoint (ADR 0035): not under /api, authenticated by an AI access's key instead of a session.
  await app.register(mcpEndpoint, { db, accesses: deps.aiAccesses, baseUrl });

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
