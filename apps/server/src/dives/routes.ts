// One Dive: its values (with Overrides), Recordings, editing, Primary recording, history (ADR 0015).
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import type { Db } from '../db/client.js';
import {
  OVERRIDABLE_FIELDS, dive, diverManagement, importJob, recording, revision, sampleSeries, user,
  type RecordingSummary,
} from '../db/schema.js';
import { Problem, problem } from '../http/problems.js';
import { DECO_MODELS, DIVE_MODES, GAS_CIRCUITS, WATER_TYPES } from '../vocabulary.js';
import { DiveError, type DiveService } from './dive-service.js';
import { valuesFromRecording, type DiveValues } from './dive-values.js';
import { REVISION_CAUSES } from './revisions.js';

export interface DiveRouteDeps {
  db: Db;
  auth: Auth;
  dives: DiveService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const DateTime = Type.String({ format: 'date-time' });
/**
 * Null first: Fastify's validator coerces types and tries union members in order, so with the
 * value type first a null in a request would become 0 or "" (caught by the dive editing tests).
 */
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);

const Field = Type.Enum([...OVERRIDABLE_FIELDS], { description: 'A Dive value that can be overridden' });
const WaterTypeSchema = Type.Enum([...WATER_TYPES]);
/** Start time with the local UTC offset at the dive (gap A8). */
const StartsAt = Type.Object({
  at: DateTime,
  utcOffsetSeconds: Nullable(Type.Integer({ minimum: -12 * 3600, maximum: 14 * 3600, multipleOf: 900 })),
});

const ValuesSchema = Type.Object({
  number: Nullable(Type.Integer({ minimum: 0, maximum: 100_000 })),
  startsAt: StartsAt,
  durationSeconds: Type.Number({ minimum: 0, maximum: 48 * 3600 }),
  maxDepthM: Nullable(Type.Number({ minimum: 0, maximum: 400 })),
  avgDepthM: Nullable(Type.Number({ minimum: 0, maximum: 400 })),
  waterTemperatureC: Nullable(Type.Number({ minimum: -5, maximum: 50 })),
  waterType: Nullable(WaterTypeSchema),
});

const SummaryView = Type.Object({
  diveNumber: Type.Optional(Type.Integer()),
  diveMode: Type.Optional(Type.Enum([...DIVE_MODES])),
  decoModel: Type.Optional(Type.Enum([...DECO_MODELS])),
  gfLow: Type.Optional(Type.Number()),
  gfHigh: Type.Optional(Type.Number()),
  waterType: Type.Optional(WaterTypeSchema),
  waterDensity: Type.Optional(Type.Number()),
  gases: Type.Optional(Type.Array(Type.Object({
    o2: Type.Number(), he: Type.Number(), circuit: Type.Optional(Type.Enum([...GAS_CIRCUITS])),
  }))),
  minTemperatureC: Type.Optional(Type.Number()),
  maxTemperatureC: Type.Optional(Type.Number()),
  avgHeartRate: Type.Optional(Type.Number()),
  surfaceIntervalSeconds: Type.Optional(Type.Number()),
  cnsStart: Type.Optional(Type.Number()),
  cnsEnd: Type.Optional(Type.Number()),
  extras: Type.Optional(Type.Record(Type.String(), Type.String(), {
    description: 'Source values without a word in our vocabulary, by source field name',
  })),
});

const RecordingView = Type.Object({
  id: Type.String(),
  isPrimary: Type.Boolean(),
  startsAt: DateTime,
  durationSeconds: Type.Number(),
  maxDepthM: Nullable(Type.Number()),
  parser: Type.String(),
  summary: SummaryView,
  channels: Type.Array(Type.String()),
});

const DiveView = Type.Object({
  id: Type.String(),
  version: Type.Integer({ description: 'Send it back with an edit; it changes with every change' }),
  values: ValuesSchema,
  overrides: Type.Array(Field, { description: 'Values the User set by hand' }),
  fromRecording: Nullable(ValuesSchema, ),
  notes: Nullable(Type.String()),
  recordings: Type.Array(RecordingView),
});

const EditBody = Type.Object({
  version: Type.Integer(),
  set: Type.Optional(Type.Partial(ValuesSchema)),
  reset: Type.Optional(Type.Array(Field)),
  notes: Type.Optional(Nullable(Type.String({ maxLength: 20_000 }))),
});

const RevisionView = Type.Object({
  id: Type.String(),
  at: DateTime,
  actor: Type.Object({
    type: Type.Enum(['user', 'import', 'system']),
    name: Nullable(Type.String({ description: 'User name or uploaded file name' })),
  }),
  cause: Type.Enum([...REVISION_CAUSES]),
  /** Field → { from, to }. Values of overridable fields have the same shape as in `values`. */
  changes: Type.Record(Type.String(), Type.Object({ from: Type.Unknown(), to: Type.Unknown() })),
});

const toValues = (v: DiveValues): Static<typeof ValuesSchema> => ({
  ...v, startsAt: { at: v.startsAt.at.toISOString(), utcOffsetSeconds: v.startsAt.utcOffsetSeconds },
});
const fromValues = (v: Partial<Static<typeof ValuesSchema>>): Partial<DiveValues> => {
  const { startsAt, ...rest } = v;
  return { ...rest, ...(startsAt && { startsAt: { at: new Date(startsAt.at), utcOffsetSeconds: startsAt.utcOffsetSeconds } }) };
};

const STATUS: Record<DiveError['code'], number> = {
  dive_not_found: 404, dive_changed: 409, dive_values_inconsistent: 400, recording_not_on_dive: 400,
};

export const diveRoutes: FastifyPluginAsyncTypebox<DiveRouteDeps> = async (app, { db, auth, dives }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DiveError) return reply.code(STATUS[error.code]).send(problem(error.code));
    throw error;
  });

  /** The Dive if the signed-in User manages its Diver. */
  const findDive = async (request: FastifyRequest, id: string) => {
    const [row] = await db.select({ d: dive }).from(dive)
      .innerJoin(diverManagement, and(eq(diverManagement.diverId, dive.diverId), eq(diverManagement.userId, request.user!.id)))
      .where(and(eq(dive.id, id), isNull(dive.deletedAt)));
    return row?.d;
  };

  const view = async (row: typeof dive.$inferSelect): Promise<Static<typeof DiveView>> => {
    const recs = await db.select({
      r: recording,
      channels: sql<string[]>`coalesce((select array_agg(channel order by channel) from ${sampleSeries} where ${sampleSeries.recordingId} = ${recording.id}), '{}')`,
    }).from(recording).where(and(eq(recording.diveId, row.id), isNull(recording.deletedAt))).orderBy(recording.startsAt);
    const primary = recs.find(({ r }) => r.id === row.primaryRecordingId)?.r;
    return {
      id: row.id,
      version: row.version,
      values: toValues({
        number: row.number, startsAt: { at: row.startsAt, utcOffsetSeconds: row.utcOffsetSeconds },
        durationSeconds: row.durationSeconds, maxDepthM: row.maxDepthM, avgDepthM: row.avgDepthM,
        waterTemperatureC: row.waterTemperatureC, waterType: row.waterType,
      }),
      overrides: row.overrides,
      fromRecording: primary ? toValues(valuesFromRecording(primary)) : null,
      notes: row.notes,
      recordings: recs.map(({ r, channels }) => ({
        id: r.id, isPrimary: r.id === row.primaryRecordingId, startsAt: r.startsAt.toISOString(),
        durationSeconds: r.durationSeconds, maxDepthM: r.maxDepthM, parser: r.parser,
        summary: r.summary as RecordingSummary, channels,
      })),
    };
  };

  app.get('/dives/:id', {
    schema: {
      summary: 'One Dive: values in effect, which are Overrides, the Primary recording\'s values, Recordings',
      params: IdParams, response: { 200: DiveView, 404: Problem },
    },
  }, async (request, reply) => {
    const row = await findDive(request, request.params.id);
    return row ? view(row) : reply.code(404).send(problem('dive_not_found'));
  });

  app.patch('/dives/:id', {
    schema: {
      summary: 'Edit a Dive: set values (they become Overrides), reset Overrides, change notes',
      description: 'Send the version you started from; if the Dive changed meanwhile the answer is 409 dive_changed.',
      params: IdParams, body: EditBody, response: { 200: DiveView, 400: Problem, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    const { version, set, reset, notes } = request.body;
    await dives.edit(request.user!.id, request.params.id, {
      version, ...(set && { set: fromValues(set) }), ...(reset && { reset }), ...(notes !== undefined && { notes }),
    });
    return view((await findDive(request, request.params.id))!);
  });

  app.put('/dives/:id/primary-recording', {
    schema: {
      summary: 'Make one of the Dive\'s Recordings the Primary one; values without Override follow it',
      params: IdParams, body: Type.Object({ recordingId: Type.String({ format: 'uuid' }), version: Type.Integer() }),
      response: { 200: DiveView, 400: Problem, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    await dives.setPrimary(request.user!.id, request.params.id, request.body.recordingId, request.body.version);
    return view((await findDive(request, request.params.id))!);
  });

  app.get('/dives/:id/revisions', {
    schema: {
      summary: 'The Dive\'s history, newest first: its own Revisions and those of its Recordings',
      params: IdParams, response: { 200: Type.Array(RevisionView), 404: Problem },
    },
  }, async (request, reply) => {
    const row = await findDive(request, request.params.id);
    if (!row) return reply.code(404).send(problem('dive_not_found'));
    const recIds = (await db.select({ id: recording.id }).from(recording).where(eq(recording.diveId, row.id))).map((r) => r.id);
    const rows = await db.select({
      r: revision,
      userName: user.name,
      uploadName: importJob.uploadName,
    }).from(revision)
      .leftJoin(user, and(eq(revision.actorType, 'user'), sql`${user.id}::text = ${revision.actorId}`))
      .leftJoin(importJob, and(eq(revision.actorType, 'import'), sql`${importJob.id}::text = ${revision.actorId}`))
      .where(or(
        and(eq(revision.entityType, 'dive'), eq(revision.entityId, row.id)),
        ...(recIds.length ? [and(eq(revision.entityType, 'recording'), inArray(revision.entityId, recIds))] : []),
      ))
      .orderBy(desc(revision.at), desc(revision.id)).limit(200);
    return rows.map(({ r, userName, uploadName }) => ({
      id: r.id, at: r.at.toISOString(),
      actor: { type: r.actorType, name: r.actorType === 'user' ? userName : r.actorType === 'import' ? uploadName : null },
      cause: r.cause as (typeof REVISION_CAUSES)[number],
      changes: r.changes,
    }));
  });
};
