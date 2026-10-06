// One Dive: its values (with Overrides), Recordings, editing, Primary recording, history (ADR 0015); its water
// type from its site, and whether the computer was set to other water (ADR 0025).
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import type { Db } from '../db/client.js';
import {
  OVERRIDABLE_FIELDS, PARTICIPANT_ROLES, UTC_OFFSET_SOURCES, device, dive, diveSite, diverManagement, importJob, recording, revision, sampleSeries, user,
  type RecordingSummary,
} from '../db/schema.js';
import { Problem, problem } from '../http/problems.js';
import { DECO_MODELS, DIVE_MODES, GAS_CIRCUITS, SITE_WATER_TYPES, WATER_TYPES } from '../vocabulary.js';
import { DiveError, participantsOf, type DiveService } from './dive-service.js';
import { valuesFromRecording, type DiveValues } from './dive-values.js';
import { REVISION_CAUSES } from './revisions.js';
import { waterMismatch } from './water.js';
import { recordingPosition } from '../sites/dive-site-link.js';
import { PositionSchema } from '../sites/routes.js';
import type { PushService } from '../providers/push-service.js';
import type { AssessmentService } from '../assessment/assessment-service.js';
import { ProviderServiceError } from '../providers/registry.js';
import { replyProviderError } from '../providers/routes.js';

export interface DiveRouteDeps {
  db: Db;
  auth: Auth;
  dives: DiveService;
  /** Deleting a Dive asks every Provider it is at (ADR 0026, 0027). */
  pushes: PushService;
  assessments: AssessmentService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const DateTime = Type.String({ format: 'date-time' });
/**
 * Null first: Fastify's validator coerces types and tries union members in order, so with the
 * value type first a null in a request would become 0 or "" (caught by the dive editing tests).
 */
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);

const Field = Type.Enum([...OVERRIDABLE_FIELDS], { description: 'A Dive value that can be overridden' });
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
});

const SummaryView = Type.Object({
  diveNumber: Type.Optional(Type.Integer()),
  diveMode: Type.Optional(Type.Enum([...DIVE_MODES])),
  decoModel: Type.Optional(Type.Enum([...DECO_MODELS])),
  gfLow: Type.Optional(Type.Number()),
  gfHigh: Type.Optional(Type.Number()),
  waterType: Type.Optional(Type.Enum([...WATER_TYPES], { description: 'The computer\'s salinity setting, not the water of the Dive (that is the site\'s)' })),
  waterDensity: Type.Optional(Type.Number({ description: 'Density the computer computed depths with, kg/m³' })),
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

const Role = Type.Enum([...PARTICIPANT_ROLES], { description: 'buddy: dived together; guide: led the dive; instructor: taught on it' });
const Participant = Type.Object({
  diverId: Type.String(),
  name: Type.String({ description: 'The Diver\'s name, as every User sees it' }),
  role: Role,
});

const RecordingView = Type.Object({
  id: Type.String(),
  isPrimary: Type.Boolean(),
  device: Nullable(Type.Object({ manufacturer: Type.String(), product: Nullable(Type.String()), serialNumber: Type.String() })),
  startsAt: DateTime,
  durationSeconds: Type.Number(),
  maxDepthM: Nullable(Type.Number()),
  parser: Type.String(),
  summary: SummaryView,
  channels: Type.Array(Type.String()),
});

const DiveView = Type.Object({
  id: Type.String(),
  diverId: Type.String({ description: 'The Diver whose logbook this Dive is in' }),
  version: Type.Integer({ description: 'Send it back with an edit; it changes with every change' }),
  values: ValuesSchema,
  overrides: Type.Array(Field, { description: 'Values the User set by hand' }),
  utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES], {
    description: 'Where the start\'s UTC offset came from (ADR 0030): device, position (the time zone where the dive was), nearby (the '
      + 'Diver\'s Dives within 7 days) or unknown (startsAt is the local wall-clock time kept as if UTC: show it in UTC without an '
      + 'offset). Clients say where it came from when it isn\'t the device (docs/spec/clients.md)',
  }),
  fromProvider: Nullable(Type.String({
    description: 'The Provider whose logbook entry this Dive was made from (ADR 0030); with no recordings, its values are that entry\'s',
  })),
  fromRecording: Nullable(ValuesSchema, ),
  notes: Nullable(Type.String()),
  site: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, { description: 'The Dive site (ADR 0020)' })),
  waterType: Nullable(Type.Enum([...SITE_WATER_TYPES], {
    description: 'The Dive site\'s water type (ADR 0025); null without a site, or when the site has none. Not editable on the Dive',
  })),
  waterMismatch: Nullable(Type.Object({
    computer: Type.Enum([...WATER_TYPES], { description: 'What the Primary recording\'s computer was set to' }),
    site: Type.Enum([...SITE_WATER_TYPES]),
    depthPercent: Nullable(Type.Number({ description: 'Recorded vs true depth in percent: negative reads shallow, positive deep; null where a density is unknown' })),
  }, { description: 'Set when the computer was set to other water than the site\'s: clients say so (docs/spec/clients.md)' })),
  position: Nullable(Type.Object(PositionSchema.properties, {
    description: 'Where the Device of the Primary recording placed the dive: its exit, else its entry. Private like the Dive',
  })),
  recordings: Type.Array(RecordingView),
  participants: Type.Array(Participant, { description: 'Buddies first, then guides and instructors (ADR 0028)' }),
});

const EditBody = Type.Object({
  version: Type.Integer(),
  set: Type.Optional(Type.Partial(ValuesSchema)),
  reset: Type.Optional(Type.Array(Field)),
  notes: Type.Optional(Nullable(Type.String({ maxLength: 20_000 }))),
  siteId: Type.Optional(Nullable(Type.String({ format: 'uuid', description: 'The Dive site, or null for none' }))),
});

const RevisionView = Type.Object({
  id: Type.String(),
  at: DateTime,
  actor: Type.Object({
    // A Site import changes Dive sites, never a Dive; the type is shared with the Revision table.
    type: Type.Enum(['user', 'import', 'system', 'site_import']),
    id: Type.String({ description: 'User id, Import id, or the system actor' }),
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
  recording_not_found: 404, last_recording: 409, diver_not_found: 404, site_not_found: 404, participant_invalid: 400,
};

const DeletedDiveView = Type.Object({
  id: Type.String(),
  diverId: Type.String(),
  version: Type.Integer({ description: 'Send it back to restore the Dive' }),
  number: Nullable(Type.Integer()),
  startsAt: DateTime,
  utcOffsetSeconds: Nullable(Type.Integer()),
  utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES]),
  durationSeconds: Type.Number(),
  maxDepthM: Nullable(Type.Number()),
  site: Nullable(Type.Object({ id: Type.String(), name: Type.String() })),
  deletedAt: DateTime,
  stillAt: Type.Array(Type.Object({
    provider: Type.String(),
    remoteNumber: Nullable(Type.Integer({ description: 'The Provider\'s own dive number' })),
  }), { description: 'Providers the dive is still at: clients remind the User and offer to delete it there (docs/spec/clients.md)' }),
});

const Copies = Type.Array(Type.Object({
  provider: Type.String(),
  copy: Type.Enum(['deleted', 'kept'], { description: 'What happened to the copy there' }),
}), { description: 'Each Provider the Dive was at' });

/** A refusal while deleting; after a provider_* code, which copies at Providers are gone already. */
const DeleteProblem = Type.Object({
  ...Problem.properties,
  providers: Type.Optional(Type.Array(Copies.items, {
    description: 'With a provider_* code: each Provider the Dive is at, and whether its copy there was deleted before the refusal (the Dive stays here)',
  })),
});

/** Deleted Dives listed at most (newest deletion first). */
const DELETED_SHOWN = 100;

export const diveRoutes: FastifyPluginAsyncTypebox<DiveRouteDeps> = async (app, { db, auth, dives, pushes, assessments }) => {
  app.addHook('onRequest', requireUser(auth));
  // Whatever changed a Dive may change its findings and those of the dives around it (ADR 0036): brought up to date
  // before the answer goes out, so the client's next read sees them. A failure here never fails the change itself.
  app.addHook('onSend', async (request, reply) => {
    if (request.method === 'GET' || reply.statusCode >= 300 || !request.user) return;
    await assessments.refreshUser(request.user.id).catch((error) => request.log.error({ err: error }, 'dive assessment failed'));
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DiveError) return reply.code(STATUS[error.code]).send(problem(error.code));
    if (error instanceof ProviderServiceError) return replyProviderError(error, reply);
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
      d: device,
      channels: sql<string[]>`coalesce((select array_agg(channel order by channel) from ${sampleSeries} where ${sampleSeries.recordingId} = ${recording.id}), '{}')`,
    }).from(recording).leftJoin(device, eq(device.id, recording.deviceId))
      .where(and(eq(recording.diveId, row.id), isNull(recording.deletedAt))).orderBy(recording.startsAt);
    const primary = recs.find(({ r }) => r.id === row.primaryRecordingId)?.r;
    const [site] = row.siteId
      ? await db.select({ id: diveSite.id, name: diveSite.name, waterType: diveSite.waterType }).from(diveSite).where(eq(diveSite.id, row.siteId))
      : [];
    return {
      id: row.id,
      diverId: row.diverId,
      version: row.version,
      values: toValues({
        number: row.number, startsAt: { at: row.startsAt, utcOffsetSeconds: row.utcOffsetSeconds },
        durationSeconds: row.durationSeconds, maxDepthM: row.maxDepthM, avgDepthM: row.avgDepthM,
        waterTemperatureC: row.waterTemperatureC,
      }),
      overrides: row.overrides,
      utcOffsetSource: row.utcOffsetSource,
      fromProvider: row.fromProvider,
      fromRecording: primary ? toValues(valuesFromRecording(primary)) : null,
      notes: row.notes,
      site: site ? { id: site.id, name: site.name } : null,
      waterType: site?.waterType ?? null,
      waterMismatch: waterMismatch(site?.waterType ?? null, primary?.summary),
      position: primary ? recordingPosition(primary) : null,
      recordings: recs.map(({ r, d, channels }) => ({
        id: r.id, isPrimary: r.id === row.primaryRecordingId,
        device: d ? { manufacturer: d.manufacturer, product: d.product, serialNumber: d.serialNumber } : null, startsAt: r.startsAt.toISOString(),
        durationSeconds: r.durationSeconds, maxDepthM: r.maxDepthM, parser: r.parser,
        summary: r.summary as RecordingSummary, channels,
      })),
      participants: await participantsOf(db, row.id),
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
      summary: 'Edit a Dive: set values (they become Overrides), reset Overrides, change notes or the Dive site',
      description: 'Send the version you started from; if the Dive changed meanwhile the answer is 409 dive_changed.',
      params: IdParams, body: EditBody, response: { 200: DiveView, 400: Problem, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    const { version, set, reset, notes, siteId } = request.body;
    await dives.edit(request.user!.id, request.params.id, {
      version, ...(set && { set: fromValues(set) }), ...(reset && { reset }), ...(notes !== undefined && { notes }),
      ...(siteId !== undefined && { siteId }),
    });
    return view((await findDive(request, request.params.id))!);
  });

  app.put('/dives/:id/participants', {
    schema: {
      summary: 'Set who else was on the Dive, as one list: any Diver of the instance (GET /divers/search) but the Dive\'s own, one role each',
      description: 'Send the version you started from (409 dive_changed). 400 participant_invalid for a Diver twice or the Dive\'s own; '
        + '404 diver_not_found for one that doesn\'t exist. Providers that take buddies see the Dive changed (ADR 0028, 0029).',
      params: IdParams,
      body: Type.Object({
        version: Type.Integer(),
        participants: Type.Array(Type.Object({ diverId: Type.String({ format: 'uuid' }), role: Role }, { additionalProperties: false }), { maxItems: 50 }),
      }, { additionalProperties: false }),
      response: { 200: DiveView, 400: Problem, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    await dives.setParticipants(request.user!.id, request.params.id, request.body.version, request.body.participants);
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

  app.post('/dives/:id/move', {
    schema: {
      summary: 'File the Dive under another Diver the User manages',
      params: IdParams, body: Type.Object({ diverId: Type.String({ format: 'uuid' }), version: Type.Integer() }),
      response: { 200: DiveView, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    await dives.move(request.user!.id, request.params.id, request.body.diverId, request.body.version);
    return view((await findDive(request, request.params.id))!);
  });

  app.post('/recordings/:id/detach', {
    schema: {
      summary: 'Split a Recording off its Dive into a new Dive of the same Diver',
      description: 'Send the version of the Dive it is on. The Dive\'s last Recording can\'t be split off.',
      params: IdParams, body: Type.Object({ version: Type.Integer() }),
      response: { 200: Type.Object({ diveId: Type.String({ description: 'The new Dive' }) }), 404: Problem, 409: Problem },
    },
  }, async (request) => ({ diveId: await dives.detach(request.user!.id, request.params.id, request.body.version) }));

  app.delete('/dives/:id', {
    schema: {
      summary: 'Delete a Dive: it leaves the logbook, its counts and search; re-imports skip it; it can be restored',
      description: 'Send the version you started from (409 dive_changed). When the Dive is at Providers, `alsoAt` names those '
        + 'to delete it at first (SSI\'s app can\'t bring it back). With several, each is checked first; if one refuses (provider_* '
        + 'codes), the Dive stays here and `providers` says which copies are gone already. The others keep it, and the deleted '
        + 'Dive keeps reminding (`stillAt` in GET /dives/deleted). ADR 0026, 0027.',
      params: IdParams,
      body: Type.Object({
        version: Type.Integer(),
        alsoAt: Type.Optional(Type.Array(Type.String(), { description: 'Providers to delete the Dive\'s copy at too; ask the User first (docs/spec/clients.md)' })),
      }),
      response: {
        200: Type.Object({ providers: Copies }),
        400: DeleteProblem, 404: Problem, 409: DeleteProblem, 502: DeleteProblem,
      },
    },
  }, async (request, reply) => {
    const { version, alsoAt = [] } = request.body;
    const row = await findDive(request, request.params.id);
    if (!row) return reply.code(404).send(problem('dive_not_found'));
    // Checked before any Provider is asked, so a changed Dive isn't deleted there and then kept here.
    if (row.version !== version) return reply.code(409).send(problem('dive_changed'));
    const at = [...((await pushes.currentOf([row.id])).get(row.id)?.keys() ?? [])];
    const asked = at.filter((provider) => alsoAt.includes(provider));
    const { copies, failure } = asked.length > 0 ? await pushes.removeAt(request.user!.id, row.id, asked) : { copies: [], failure: null };
    const providers = at.map((provider) => ({ provider, copy: copies.find((c) => c.provider === provider)?.copy ?? 'kept' as const }));
    if (failure) return replyProviderError(failure, reply, { providers });
    await dives.remove(request.user!.id, row.id, version);
    return { providers };
  });

  app.get('/dives/deleted', {
    schema: {
      summary: 'The User\'s deleted Dives, most recently deleted first (at most 100), to restore them; which Providers they are still at',
      response: { 200: Type.Object({ dives: Type.Array(DeletedDiveView) }) },
    },
  }, async (request) => {
    const rows = await db.select({ d: dive, siteName: diveSite.name }).from(dive)
      .innerJoin(diverManagement, and(eq(diverManagement.diverId, dive.diverId), eq(diverManagement.userId, request.user!.id)))
      .leftJoin(diveSite, eq(diveSite.id, dive.siteId))
      .where(isNotNull(dive.deletedAt))
      .orderBy(desc(dive.deletedAt), desc(dive.id)).limit(DELETED_SHOWN);
    const remote = await pushes.currentOf(rows.map((r) => r.d.id));
    return {
      dives: rows.map(({ d, siteName }) => ({
        id: d.id, diverId: d.diverId, version: d.version, number: d.number, startsAt: d.startsAt.toISOString(),
        utcOffsetSeconds: d.utcOffsetSeconds, utcOffsetSource: d.utcOffsetSource, durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM,
        site: d.siteId && siteName !== null ? { id: d.siteId, name: siteName } : null,
        deletedAt: d.deletedAt!.toISOString(),
        stillAt: [...(remote.get(d.id)?.entries() ?? [])].map(([provider, p]) => ({ provider, remoteNumber: p.remoteNumber })),
      })),
    };
  });

  app.post('/dives/:id/restore', {
    schema: {
      summary: 'Bring a deleted Dive back with its Recordings (not to Providers: send it again from there)',
      description: 'Send the version from GET /dives/deleted (409 dive_changed). A site deleted meanwhile becomes the one it was merged into, or none.',
      params: IdParams, body: Type.Object({ version: Type.Integer() }),
      response: { 200: DiveView, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    await dives.restore(request.user!.id, request.params.id, request.body.version);
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
      actor: { type: r.actorType, id: r.actorId, name: r.actorType === 'user' ? userName : r.actorType === 'import' ? uploadName : null },
      cause: r.cause as (typeof REVISION_CAUSES)[number],
      changes: r.changes,
    }));
  });
};
