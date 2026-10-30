import { existsSync } from 'node:fs';
import Fastify, { type FastifyServerOptions } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import { authHandler } from './auth/fastify.js';
import type { Services } from './compose.js';
import { withAuthEndpoints } from './auth/openapi.js';
import { problem, ProblemSchema, useProblemErrors } from './http/problems.js';
import { DeleteProblemSchema } from './dives/deletion-view.js';
import { DiveViewSchema } from './dives/dive-view.js';
import { WaitingPushViewSchema } from './dives/waiting-push-view.js';
import { UnmetViewSchema } from './providers/unmet-view.js';
import { ConflictFieldViewSchema } from './providers/conflicts/conflict-view.js';
import { ImportViewSchema } from './imports/import-view.js';
import { CertificationViewSchema } from './certifications/certification-view.js';
import { DiverDetailsViewSchema, DiverViewSchema, ExternalDiverViewSchema } from './divers/diver-view.js';
import { SiteViewSchema } from './sites/site-view.js';
import { CentreViewSchema } from './centres/centre-view.js';
import { SiteImportViewSchema } from './sites/import/site-import-view.js';
import { ConnectionViewSchema } from './providers/connection-view.js';
import { DiveProviderStatusSchema } from './providers/dive-provider-view.js';
import { PushRunViewSchema } from './providers/push/push-run-view.js';
import { UserViewSchema } from './users/views.js';
import { logbookRoutes } from './dives/logbook-routes.js';
import { importRoutes } from './imports/routes.js';
import { candidateRoutes } from './dives/candidates/candidate-routes.js';
import { diveRoutes } from './dives/routes.js';
import { certificationRoutes } from './certifications/routes.js';
import { diverRoutes } from './divers/routes.js';
import { leadRoutes } from './lead/routes.js';
import { planningRoutes } from './planning/routes.js';
import { siteRoutes } from './sites/routes.js';
import { centreRoutes } from './centres/routes.js';
import { siteImportRoutes } from './sites/import/site-import-routes.js';
import { providerAnswers, ProviderProblemSchema } from './providers/route-parts.js';
import { providerRoutes } from './providers/routes.js';
import { assessmentRoutes } from './assessment/routes.js';
import { aiAccessRoutes } from './mcp/access-routes.js';
import { mcpEndpoint } from './mcp/endpoint.js';
import { accountRoutes } from './users/account-routes.js';
import { adminRoutes } from './users/admin-routes.js';
import { userRoutes } from './users/routes.js';

/** Every service, as createServices (compose.ts) builds them, and the instance's settings. */
export type AppDeps = Services & {
  /** Public URL of the instance; invitation links point there. */
  baseUrl: string;
  maxUploadBytes: number;
  webDir?: string | undefined;
};

/** The Fastify instance, logger included, before any route: main.ts hands its logger to the services first. */
export const createServer = (options: FastifyServerOptions = {}) => Fastify(options).withTypeProvider<TypeBoxTypeProvider>();

export type Server = ReturnType<typeof createServer>;

/** Registers the plugins and routes on `app` (a fresh instance unless given) with the services it is given, and returns it. */
export async function buildApp(deps: AppDeps, app: Server = createServer()) {
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
    // A schema added with app.addSchema becomes the component named by its $id (Problem), which routes $ref.
    refResolver: { buildLocalReference: (json, _baseUri, _fragment, i) => (typeof json.$id === 'string' ? json.$id : `def-${i}`) },
  });
  // Every refusal's shape, named once for clients (ADR 0014), the two that add extras of their own, each resource view
  // several routes answer, and the parts several of them share (first, as the others refer to them); the routes refer to
  // them (refTo, http/schemas.ts).
  for (const schema of [
    UnmetViewSchema, ConflictFieldViewSchema, WaitingPushViewSchema,
    ProblemSchema, ProviderProblemSchema, DeleteProblemSchema,
    UserViewSchema, ImportViewSchema, DiveViewSchema, DiverViewSchema, DiverDetailsViewSchema, ExternalDiverViewSchema, CertificationViewSchema,
    SiteViewSchema, CentreViewSchema, SiteImportViewSchema, PushRunViewSchema, ConnectionViewSchema, DiveProviderStatusSchema,
  ]) app.addSchema(schema);
  await app.register(multipart, { limits: { files: 1, fileSize: deps.maxUploadBytes } });

  app.get('/api/health/live', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/api/health/ready', { schema: { hide: true } }, async () => {
    await deps.db.execute(sql`select 1`);
    return { status: 'ok' };
  });
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => withAuthEndpoints(app.swagger(), deps.auth));

  await app.register(authHandler, { auth: deps.auth });
  const { db, auth, assessments, baseUrl, passwordResets, logbook, divers, centres, dives, merging, checks } = deps;
  const { pushes, waitingPushes, certifications } = deps.providers;
  await app.register(userRoutes, { prefix: '/api', auth, profiles: deps.profiles, setup: deps.setup, invitations: deps.invitations });
  await app.register(accountRoutes, { prefix: '/api', auth, passwordResets, sessions: deps.sessions });
  await app.register(adminRoutes, { prefix: '/api', auth, passwordResets, userAdmin: deps.userAdmin, invitations: deps.invitations, baseUrl });
  await app.register(importRoutes, { prefix: '/api', auth, imports: deps.imports, waitingPushes, maxUploadBytes: deps.maxUploadBytes });
  await app.register(logbookRoutes, { prefix: '/api', auth, logbook, pushes, waitingPushes });
  await app.register(diveRoutes, {
    prefix: '/api', auth, logbook, divers, centres, dives, merging, checks, pushes, waitingPushes,
    deletion: deps.deletion, merge: deps.merge, assessments, providerAnswers,
  });
  await app.register(candidateRoutes, { prefix: '/api', auth, candidates: deps.candidates, assessments });
  await app.register(assessmentRoutes, { prefix: '/api', auth, assessments });
  await app.register(diverRoutes, { prefix: '/api', auth, divers, certifications });
  await app.register(certificationRoutes, { prefix: '/api', auth, certifications });
  await app.register(planningRoutes, { prefix: '/api', auth, planning: deps.planning });
  await app.register(leadRoutes, { prefix: '/api', auth, lead: deps.lead });
  await app.register(siteRoutes, { prefix: '/api', auth, sites: deps.sites });
  await app.register(centreRoutes, { prefix: '/api', auth, centres, divers });
  await app.register(siteImportRoutes, { prefix: '/api', auth, siteImports: deps.siteImports });
  await app.register(providerRoutes, { prefix: '/api', auth, ...deps.providers, assessments });
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
