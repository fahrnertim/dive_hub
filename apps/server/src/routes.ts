import { and, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from './auth/auth.js';
import { requireUser } from './auth/fastify.js';
import type { Db } from './db/client.js';
import {
  IMPORT_ERROR_CODES, OUTCOME_REASONS, dive, diveSite, diverManagement, duplicateCandidate, importJob, recording, sampleSeries,
} from './db/schema.js';
import { downsampleMinMax } from './dives/downsample.js';
import { Problem, problem } from './http/problems.js';
import type { ImportService } from './imports/import-service.js';
import { UploadTooLargeError } from './storage/blob-store.js';

export interface RouteDeps {
  db: Db;
  imports: ImportService;
  maxUploadBytes: number;
  auth: Auth;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const DateTime = Type.String({ format: 'date-time' });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([t, Type.Null()]);

const ImportView = Type.Object({
  id: Type.String(),
  status: Type.Union([Type.Literal('pending'), Type.Literal('processing'), Type.Literal('done'), Type.Literal('failed')]),
  uploadName: Type.String(),
  createdAt: DateTime,
  finishedAt: Nullable(DateTime),
  errorCode: Nullable(Type.Enum([...IMPORT_ERROR_CODES], { description: 'Why the Import failed; clients translate it. The detail stays in the server log' })),
  outcome: Type.Array(Type.Object({
    fileName: Type.String(),
    result: Type.Enum(['created', 'attached', 'updated', 'unchanged', 'duplicate-candidate', 'skipped', 'failed']),
    diveId: Type.Optional(Type.String()),
    recordingId: Type.Optional(Type.String()),
    reason: Type.Optional(Type.Enum([...OUTCOME_REASONS], { description: 'Why; clients translate it. A failure’s detail stays in the server log' })),
    decision: Type.Optional(Type.Enum(['open', 'attached', 'new_dive', 'discarded'], {
      description: 'For a duplicate-candidate: what has been decided since. diveId is then the Dive it went to',
    })),
  })),
});

/** The logbook list (ADR 0017): a page of Dives, sorted, optionally searched, with the total. */
const DIVE_SORTS = ['startsAt', 'number', 'maxDepth', 'duration'] as const;
const DiveListQuery = Type.Object({
  diverId: Type.Optional(Type.String({ format: 'uuid', description: 'Only this Diver\'s Dives' })),
  siteId: Type.Optional(Type.String({ format: 'uuid', description: 'Only Dives at this Dive site' })),
  q: Type.Optional(Type.String({ maxLength: 100, description: 'A dive number, or words from the notes or the site name' })),
  sort: Type.Optional(Type.Enum([...DIVE_SORTS], { default: 'startsAt' })),
  order: Type.Optional(Type.Enum(['desc', 'asc'], { default: 'desc' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

const DiveSummaryView = Type.Object({
  id: Type.String(),
  diverId: Type.String(),
  number: Nullable(Type.Integer()),
  startsAt: DateTime,
  utcOffsetSeconds: Nullable(Type.Integer()),
  durationSeconds: Type.Number(),
  maxDepthM: Nullable(Type.Number()),
  avgDepthM: Nullable(Type.Number()),
  site: Nullable(Type.Object({ id: Type.String(), name: Type.String() })),
});


const SamplesQuery = Type.Object({
  channels: Type.Optional(Type.String({ description: 'Comma-separated channel names; default all' })),
  maxPoints: Type.Optional(Type.Integer({ minimum: 4, maximum: 20000, default: 2000 })),
});

const SamplesView = Type.Object({
  recordingId: Type.String(),
  series: Type.Array(Type.Object({
    channel: Type.String(),
    offsetsMs: Type.Array(Type.Integer()),
    values: Type.Array(Type.Number()),
  })),
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toImportView = (j: typeof importJob.$inferSelect): Static<typeof ImportView> => ({
  id: j.id, status: j.status, uploadName: j.uploadName, createdAt: j.createdAt.toISOString(),
  // A parser's own words (English, internals) stay in the database and the server log (client contract §6).
  finishedAt: iso(j.finishedAt), outcome: j.outcome.map(({ message: _detail, ...o }) => o),
  errorCode: j.error === null ? null : j.error === 'unsupported_file' ? 'unsupported_file' : 'processing_failed',
});
/**
 * An Import's outcome is stored once; a Duplicate candidate is decided later. Adds the current
 * decision (and the Dive the Recording went to) so the client doesn't show a stale "needs your decision".
 */
async function withDecisions(db: Db, rows: (typeof importJob.$inferSelect)[]) {
  const views = rows.map(toImportView);
  const ids = views.flatMap((v) => v.outcome.filter((o) => o.result === 'duplicate-candidate' && o.recordingId).map((o) => o.recordingId!));
  if (ids.length === 0) return views;
  const decided = await db.select({
    recordingId: duplicateCandidate.recordingId, resolution: duplicateCandidate.resolution, createdAt: duplicateCandidate.createdAt,
    diveId: recording.diveId,
  }).from(duplicateCandidate)
    .innerJoin(recording, eq(recording.id, duplicateCandidate.recordingId))
    .where(inArray(duplicateCandidate.recordingId, ids))
    .orderBy(duplicateCandidate.createdAt);
  // The latest candidate per Recording wins (a discarded one may be reopened as a new candidate).
  const byRecording = new Map(decided.map((d) => [d.recordingId, d]));
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

const toDiveSummary = (d: typeof dive.$inferSelect, siteName: string | null): Static<typeof DiveSummaryView> => ({
  site: d.siteId && siteName !== null ? { id: d.siteId, name: siteName } : null,
  id: d.id, diverId: d.diverId, number: d.number, startsAt: d.startsAt.toISOString(), utcOffsetSeconds: d.utcOffsetSeconds,
  durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, avgDepthM: d.avgDepthM,
});

export const apiRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, deps) => {
  const { db, imports } = deps;

  // Every logbook route needs a signed-in User and only shows what that User may see.
  app.addHook('onRequest', requireUser(deps.auth));
  const userId = (request: FastifyRequest) => request.user!.id;

  /** Divers the signed-in User manages; all logbook reads are scoped to them. */
  const managedDiverIds = async (request: FastifyRequest) =>
    (await db.select({ id: diverManagement.diverId }).from(diverManagement)
      .where(eq(diverManagement.userId, userId(request)))).map((r) => r.id);

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
    const rows = await db.select().from(importJob).where(eq(importJob.userId, userId(request)))
      .orderBy(desc(importJob.createdAt)).limit(50);
    return withDecisions(db, rows);
  });

  app.get('/imports/:id', {
    schema: { summary: 'One Import with its outcome', params: IdParams, response: { 200: ImportView, 404: Problem } },
  }, async (request, reply) => {
    const [row] = await db.select().from(importJob)
      .where(and(eq(importJob.id, request.params.id), eq(importJob.userId, userId(request))));
    return row ? (await withDecisions(db, [row]))[0]! : reply.code(404).send(problem('import_not_found'));
  });

  app.get('/dives', {
    schema: {
      summary: 'A page of the Dives of the Divers the signed-in User manages (newest first unless sorted otherwise)',
      querystring: DiveListQuery,
      response: { 200: Type.Object({ dives: Type.Array(DiveSummaryView), total: Type.Integer() }) },
    },
  }, async (request) => {
    const { diverId, siteId, q, sort = 'startsAt', order = 'desc', limit = 50, offset = 0 } = request.query;
    const managed = await managedDiverIds(request);
    const divers = diverId ? managed.filter((id) => id === diverId) : managed;
    if (divers.length === 0) return { dives: [], total: 0 };

    const text = q?.trim();
    let search: SQL | undefined;
    if (text) {
      const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const asNumber = /^\d{1,9}$/.test(text) ? Number(text) : undefined;
      search = or(ilike(dive.notes, pattern), ilike(diveSite.name, pattern), asNumber === undefined ? undefined : eq(dive.number, asNumber));
    }
    const where = and(inArray(dive.diverId, divers), isNull(dive.deletedAt), siteId ? eq(dive.siteId, siteId) : undefined, search);
    const column = { startsAt: dive.startsAt, number: dive.number, maxDepth: dive.maxDepthM, duration: dive.durationSeconds }[sort];
    // Dives without a value (no number, no depth) go last either way; the start time breaks ties.
    const direction = order === 'asc' ? sql`asc nulls last` : sql`desc nulls last`;
    const [rows, [counted]] = await Promise.all([
      db.select({ d: dive, siteName: diveSite.name }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(where)
        .orderBy(sql`${column} ${direction}`, desc(dive.startsAt), desc(dive.id))
        .limit(limit).offset(offset),
      db.select({ n: count() }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(where),
    ]);
    return { dives: rows.map((r) => toDiveSummary(r.d, r.siteName)), total: counted?.n ?? 0 };
  });

  app.get('/recordings/:id/samples', {
    schema: {
      summary: 'Sample series of a Recording, downsampled for display',
      params: IdParams, querystring: SamplesQuery, response: { 200: SamplesView, 404: Problem },
    },
  }, async (request, reply) => {
    const divers = await managedDiverIds(request);
    const [rec] = divers.length === 0 ? [] : await db.select({ id: recording.id }).from(recording)
      .innerJoin(dive, eq(dive.id, recording.diveId))
      .where(and(eq(recording.id, request.params.id), inArray(dive.diverId, divers), isNull(recording.deletedAt)));
    if (!rec) return reply.code(404).send(problem('recording_not_found'));
    const wanted = request.query.channels?.split(',').map((c) => c.trim()).filter(Boolean);
    const rows = await db.select().from(sampleSeries).where(and(
      eq(sampleSeries.recordingId, rec.id),
      ...(wanted?.length ? [inArray(sampleSeries.channel, wanted)] : []),
    ));
    const maxPoints = request.query.maxPoints ?? 2000;
    return {
      recordingId: rec.id,
      series: rows.map((s) => {
        const reduced = downsampleMinMax(s.offsetsMs, s.values, maxPoints);
        return { channel: s.channel, offsetsMs: reduced.offsets, values: reduced.values };
      }),
    };
  });
};
