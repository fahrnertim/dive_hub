import { existsSync } from 'node:fs';
import Fastify, { type FastifyServerOptions } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import type { ImportService } from './imports/import-service.js';
import { apiRoutes } from './routes.js';

export interface AppDeps {
  db: Db;
  imports: ImportService;
  maxUploadBytes: number;
  currentUserId: () => string;
  webDir?: string | undefined;
}

export async function buildApp(deps: AppDeps, options: FastifyServerOptions = {}) {
  const app = Fastify(options).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Dive Hub API', version: '0.1.0' },
    },
  });
  await app.register(multipart, { limits: { files: 1, fileSize: deps.maxUploadBytes } });

  app.get('/api/health/live', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/api/health/ready', { schema: { hide: true } }, async () => {
    await deps.db.execute(sql`select 1`);
    return { status: 'ok' };
  });
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(apiRoutes, { prefix: '/api', ...deps });

  if (deps.webDir && existsSync(deps.webDir)) {
    await app.register(fastifyStatic, { root: deps.webDir, wildcard: false });
    // Single-page app: unknown non-API paths get index.html.
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html'),
    );
  }
  return app;
}
