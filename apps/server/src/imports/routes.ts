// Imports over HTTP: uploading a file, the User's recent Imports with their outcome, and starting or cancelling one that
// waits for a choice (ADR 0044).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser, userOf } from '../auth/fastify.js';
import { DIVE_KINDS, importJob } from '../db/schema.js';
import { Problem, problem } from '../http/problems.js';
import { IdParams } from '../http/schemas.js';
import { UploadTooLargeError } from '../storage/blob-store.js';
import type { ImportService } from './import-service.js';
import { ImportView, toImportView } from './import-view.js';

export interface ImportRouteDeps {
  auth: Auth;
  imports: ImportService;
  /** Which Connections offer an Import's new Dives that weren't sent by themselves (ADR 0056). */
  waitingPushes: { offersOf(userId: string, importIds: string[]): Promise<Map<string, Static<typeof ImportView>['unsentTo']>> };
  maxUploadBytes: number;
}

/**
 * An Import's outcome is stored once; a Duplicate candidate is decided later. Adds the current
 * decision (and the Dive the Recording went to) so the client doesn't show a stale "needs your decision".
 */
async function withDecisions(
  imports: ImportService, waitingPushes: ImportRouteDeps['waitingPushes'], userId: string, rows: (typeof importJob.$inferSelect)[],
) {
  const views = rows.map(toImportView);
  const offers = await waitingPushes.offersOf(userId, views.map((v) => v.id));
  for (const v of views) v.unsentTo = offers.get(v.id) ?? [];
  const ids = views.flatMap((v) => v.outcome.filter((o) => o.result === 'duplicate-candidate' && o.recordingId).map((o) => o.recordingId!));
  if (ids.length === 0) return views;
  const byRecording = await imports.decisionsOf(ids);
  for (const v of views) {
    v.outcome = v.outcome.map((o) => {
      const d = o.result === 'duplicate-candidate' && o.recordingId ? byRecording.get(o.recordingId) : undefined;
      if (!d) return o;
      const decision = d.resolution ?? 'open';
      return { ...o, decision, ...(d.diveId && decision !== 'discarded' && { diveId: d.diveId }) };
    });
  }
  return views;
}

export const importRoutes: FastifyPluginAsyncTypebox<ImportRouteDeps> = async (app, deps) => {
  const { imports } = deps;
  app.addHook('onRequest', requireUser(deps.auth));
  const userId = (request: FastifyRequest) => userOf(request).id;

  app.post('/imports', {
    schema: {
      summary: 'Upload a FIT file or a zip archive (e.g. Garmin "Export Original") for import',
      consumes: ['multipart/form-data'],
      response: { 202: ImportView, 400: Problem, 413: Problem },
    },
  }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send(problem('upload_missing'));
    try {
      const created = await imports.createImport(userId(request), file.filename, file.file, deps.maxUploadBytes);
      return reply.code(202).send(toImportView(created));
    } catch (error) {
      if (error instanceof UploadTooLargeError) return reply.code(413).send(problem('upload_too_large', error.message));
      throw error;
    }
  });

  app.get('/imports', {
    schema: { summary: 'Recent Imports of the signed-in User', response: { 200: Type.Array(ImportView) } },
  }, async (request) => {
    return withDecisions(imports, deps.waitingPushes, userId(request), await imports.recentImports(userId(request)));
  });

  app.get('/imports/:id', {
    schema: { summary: 'One Import with its outcome', params: IdParams, response: { 200: ImportView, 404: Problem } },
  }, async (request, reply) => {
    const row = await imports.findImport(userId(request), request.params.id);
    return row ? (await withDecisions(imports, deps.waitingPushes, userId(request), [row]))[0]! : reply.code(404).send(problem('import_not_found'));
  });

  app.post('/imports/:id/start', {
    schema: {
      summary: 'Start an Import that waits for a choice: import these kinds of dive, leave the others out (ADR 0044)',
      params: IdParams,
      body: Type.Object({ kinds: Type.Array(Type.Enum([...DIVE_KINDS]), { minItems: 1, maxItems: DIVE_KINDS.length, uniqueItems: true }) }),
      response: { 202: ImportView, 409: Problem },
    },
  }, async (request, reply) => {
    const started = await imports.startImport(userId(request), request.params.id, request.body.kinds);
    return started ? reply.code(202).send(toImportView(started)) : reply.code(409).send(problem('import_not_waiting'));
  });

  app.post('/imports/:id/cancel', {
    schema: {
      summary: 'Cancel an Import that waits for a choice: its upload is removed, nothing was imported (ADR 0044)',
      params: IdParams, response: { 200: ImportView, 409: Problem },
    },
  }, async (request, reply) => {
    const cancelled = await imports.cancelImport(userId(request), request.params.id);
    return cancelled ? toImportView(cancelled) : reply.code(409).send(problem('import_not_waiting'));
  });
};
