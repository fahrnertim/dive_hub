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
import type { Merging } from './merging.js';
import { LOGBOOK_CHECK_RULES } from './logbook-check-rules.js';
import type { LogbookChecks } from './logbook-checks.js';
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
  /** Merging two Dives and moving one to another Diver (ADR 0038). */
  merging: Merging;
  /** What in a logbook can't be right as it stands (ADR 0038). */
  checks: LogbookChecks;
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
    tankVolumeL: Type.Optional(Type.Number({ description: 'With a tank pod: the size of the tank, litres' })),
    startPressureBar: Type.Optional(Type.Number()),
    endPressureBar: Type.Optional(Type.Number()),
  }))),
  minTemperatureC: Type.Optional(Type.Number()),
  maxTemperatureC: Type.Optional(Type.Number()),
  avgHeartRate: Type.Optional(Type.Number()),
  surfaceIntervalSeconds: Type.Optional(Type.Number()),
  cnsStart: Type.Optional(Type.Number()),
  cnsEnd: Type.Optional(Type.Number()),
  otuStart: Type.Optional(Type.Number({ description: 'Oxygen dose, OTU' })),
  otuEnd: Type.Optional(Type.Number()),
  sacLpm: Type.Optional(Type.Number({ description: 'Gas consumption at the surface as a tank pod measured it, L/min' })),
  conservatism: Type.Optional(Type.Number({ description: 'The personal setting of the computer where its model has one (Suunto: -2 to +2)' })),
  surfacePressureBar: Type.Optional(Type.Number()),
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
  merge_not_possible: 400, check_not_found: 404,
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
  mergedInto: Nullable(Type.String({ description: 'The Dive it was merged into (ADR 0038): clients say so and link there' })),
  movedTo: Nullable(Type.String({ description: 'The Dive it became in another Diver\'s logbook when it was moved while linked to a Provider (ADR 0038)' })),
  stillAt: Type.Array(Type.Object({
    provider: Type.String(),
    remoteNumber: Nullable(Type.Integer({ description: 'The Provider\'s own dive number' })),
  }), { description: 'Providers the dive is still at: clients remind the User and offer to delete it there (docs/spec/clients.md)' }),
});

const At = Type.Array(Type.Object({
  provider: Type.String(),
  remoteNumber: Nullable(Type.Integer({ description: 'The Provider\'s own dive number' })),
}));

const Rule = Type.Enum([...LOGBOOK_CHECK_RULES], {
  description: 'recording_beside_entry: a Dive without a Recording and one with a Recording at the same time, as an import would have '
    + 'attached them; overlapping_dives: two Dives of one Diver that overlap in time; entry_apart_from_recording: a Dive without a '
    + 'Recording and one with one on the same local day, not overlapping, with depth (0.2 m or 3 %) and duration (3 minutes) agreeing: '
    + 'probably one dive typed with another start (never `obvious`; show both local start times and their difference)',
});

/** A Dive as a check or a merge shows it. */
const PairedDive = {
  id: Type.String(),
  version: Type.Integer({ description: 'Send it when merging' }),
  number: Nullable(Type.Integer()),
  startsAt: DateTime,
  utcOffsetSeconds: Nullable(Type.Integer()),
  utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES]),
  durationSeconds: Type.Number(),
  maxDepthM: Nullable(Type.Number()),
  site: Nullable(Type.Object({ id: Type.String(), name: Type.String() })),
  fromProvider: Nullable(Type.String()),
  recordings: Type.Integer({ description: 'How many Recordings it has' }),
  at: At,
};

const MergeCandidate = Type.Object({
  ...PairedDive,
  rule: Rule,
  answered: Type.Boolean({ description: 'The User said these are two dives: don\'t hint at the pair again (it can still be merged)' }),
  keeps: Type.String({ description: 'Which of the two Dives a merge keeps: the one with a Recording when only one has, else the Dive asked about' }),
  bothAt: Type.Array(Type.String(), {
    description: 'Providers both Dives are at: the dive of the one not kept stays there unless `alsoAt` names the Provider (docs/spec/clients.md)',
  }),
});

const CheckView = Type.Object({
  rule: Rule,
  obvious: Type.Boolean({ description: 'An import would have put the two together by itself, and no dive is left over at a Provider: may be merged with others in one go' }),
  diverId: Type.String(),
  dive: Type.Object(PairedDive, { description: 'The earlier of the two Dives; the Dive, when the check is about one (short_shallow_dive: `other` is null)' }),
  other: Nullable(Type.Object({
    ...PairedDive,
    keeps: Type.String({ description: 'Which of the two a merge keeps' }),
    bothAt: Type.Array(Type.String(), { description: 'Providers both Dives are at (see GET /dives/{id}/merge-candidates)' }),
  })),
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

export const diveRoutes: FastifyPluginAsyncTypebox<DiveRouteDeps> = async (app, { db, auth, dives, merging, checks, pushes, assessments }) => {
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
      description: 'A Dive linked to a Provider moves as a copy with a new `id` (ADR 0038): the old Dive is deleted and keeps its '
        + 'links, so the old Diver\'s imports don\'t make it again; it is listed in GET /dives/deleted with `movedTo`. Follow the `id` '
        + 'of the answer.',
      params: IdParams, body: Type.Object({ diverId: Type.String({ format: 'uuid' }), version: Type.Integer() }),
      response: { 200: DiveView, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    const id = await merging.move(request.user!.id, request.params.id, request.body.diverId, request.body.version);
    return view((await findDive(request, id))!);
  });

  app.get('/dives/:id/merge-candidates', {
    schema: {
      summary: 'The Dives of the same Diver this one overlaps in time and may be merged with',
      description: 'Overlap as an import matches a Recording to a Dive (5 minutes of tolerance; local times where a time zone is unknown).',
      params: IdParams, response: { 200: Type.Array(MergeCandidate), 404: Problem },
    },
  }, async (request) => (await merging.candidates(request.user!.id, request.params.id)).map(({ dive: d, siteName, recordings, at, keeps, bothAt, rule, answered }) => ({
    id: d.id, version: d.version, number: d.number, startsAt: d.startsAt.toISOString(), utcOffsetSeconds: d.utcOffsetSeconds,
    utcOffsetSource: d.utcOffsetSource, durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM,
    site: d.siteId && siteName !== null ? { id: d.siteId, name: siteName } : null, fromProvider: d.fromProvider, recordings, at, keeps, bothAt,
    rule, answered,
  })));

  /** Which of these Dives are at a Provider now. */
  const atProvider = async (diveIds: string[]) => {
    const remote = await pushes.currentOf(diveIds);
    return new Set(diveIds.filter((id) => (remote.get(id)?.size ?? 0) > 0));
  };

  app.get('/logbook-checks', {
    schema: {
      summary: 'Logbook checks: pairs of Dives in the User\'s logbooks that can\'t both be right as they stand, and Dives that are probably no dive',
      description: 'Computed from the logbook each time by fixed rules (ADR 0038): a Dive without a Recording beside a Dive with one '
        + '(at the same time, or on the same day with the same depth and duration), or two Dives of one Diver that overlap; and, about '
        + 'one Dive (`other: null`), a Recording under 2 minutes that stayed above 3 m, at no Provider: offer deleting it (DELETE /dives/{id}) or keeping it. '
        + '`status=answered` lists the pairs the User said are two dives and the Dives they said to keep, to ask again. '
        + 'Resolve one by merging (POST /dives/{id}/merge), answering (PUT /logbook-checks/answer), correcting a time, moving or '
        + 'deleting one of the Dives. Never merge unasked (docs/spec/clients.md).',
      querystring: Type.Object({ status: Type.Optional(Type.Enum(['open', 'answered'], { default: 'open' })) }),
      response: { 200: Type.Array(CheckView) },
    },
  }, async (request) => {
    const status = request.query.status ?? 'open';
    const list = await checks.list(request.user!.id, status);
    const short = await checks.shortDives(request.user!.id, atProvider, status);
    const remote = await pushes.currentOf([...new Set(list.flatMap((c) => c.dives.map((d) => d.id)))]);
    const at = (id: string) => [...(remote.get(id)?.entries() ?? [])].map(([provider, p]) => ({ provider, remoteNumber: p.remoteNumber }));
    const paired = (d: (typeof list)[number]['dives'][number]) => ({
      id: d.id, version: d.version, number: d.number, startsAt: d.startsAt.toISOString(), utcOffsetSeconds: d.utcOffsetSeconds,
      utcOffsetSource: d.utcOffsetSource, durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM,
      site: d.siteId && d.siteName !== null ? { id: d.siteId, name: d.siteName } : null, fromProvider: d.fromProvider, recordings: d.recordings, at: at(d.id),
    });
    return [...list.map(({ rule, obvious, dives: [a, b] }) => {
      const bothAt = at(b.id).filter((t) => at(a.id).some((m) => m.provider === t.provider)).map((t) => t.provider);
      return {
        rule, obvious: obvious && bothAt.length === 0, diverId: a.diverId, dive: paired(a),
        other: { ...paired(b), keeps: a.recordings === 0 && b.recordings > 0 ? b.id : a.id, bothAt },
      };
    }), ...short.map((d) => ({ rule: 'short_shallow_dive' as const, obvious: false, diverId: d.diverId, dive: paired(d), other: null }))];
  });

  app.put('/logbook-checks/answer', {
    schema: {
      summary: 'Answer a logbook check: these two Dives are two dives, or keep this Dive (or take the answer back)',
      description: 'Two ids with `two_dives`: the answer holds until one of the two Dives changes its start; then the pair is asked '
        + 'about again. One id with `keep` (a check about one Dive): it holds until the Dive\'s duration or depth changes. '
        + '`answer: null` takes either back. 404 dive_not_found for a Dive not in the User\'s logbooks, check_not_found when the '
        + 'Dives break no rule. 400 for an answer that doesn\'t fit the number of Dives.',
      body: Type.Union([
        Type.Object({
          diveIds: Type.Tuple([Type.String({ format: 'uuid' }), Type.String({ format: 'uuid' })]),
          answer: Nullable(Type.Enum(['two_dives'])),
        }, { additionalProperties: false }),
        Type.Object({
          diveIds: Type.Tuple([Type.String({ format: 'uuid' })]),
          answer: Nullable(Type.Enum(['keep'])),
        }, { additionalProperties: false }),
      ]),
      response: { 204: Type.Null(), 400: Problem, 404: Problem },
    },
  }, async (request, reply) => {
    const { diveIds: [a, b], answer } = request.body;
    // The schema lets `keep` through only with one Dive, `two_dives` only with two.
    if (b === undefined) await checks.keep(request.user!.id, a, atProvider, answer && 'keep');
    else await checks.answer(request.user!.id, [a, b], answer && 'two_dives');
    return reply.code(204).send(null);
  });

  app.post('/dives/:id/merge', {
    schema: {
      summary: 'Merge this Dive and another of the same Diver into one (the same descent logged twice)',
      description: 'Send both versions (409 dive_changed). The Dive with a Recording is kept when only one has, else this one; the '
        + 'answer is the kept Dive: follow its `id`. It gets the other\'s Recordings, fills what it lacks from it (site, Participants, '
        + 'values; the other\'s notes are appended), and takes its link at each Provider where it has none. The other is deleted '
        + 'like any Dive (GET /dives/deleted, `mergedInto`) and can be restored, without what it gave away. Where both are at a '
        + 'Provider, the other\'s dive there stays unless `alsoAt` names the Provider: it is deleted there first, and a refusal '
        + '(provider_* codes) merges nothing. 400 merge_not_possible for the same Dive or Dives of two Divers. ADR 0038.',
      params: IdParams,
      body: Type.Object({
        version: Type.Integer(),
        otherId: Type.String({ format: 'uuid' }),
        otherVersion: Type.Integer(),
        alsoAt: Type.Optional(Type.Array(Type.String(), { description: 'Providers to delete the other Dive\'s copy at, where both have one; ask the User first' })),
      }, { additionalProperties: false }),
      response: { 200: DiveView, 400: DeleteProblem, 404: Problem, 409: DeleteProblem, 502: DeleteProblem },
    },
  }, async (request, reply) => {
    const { version, otherId, otherVersion, alsoAt = [] } = request.body;
    const userId = request.user!.id;
    const candidate = (await merging.candidates(userId, request.params.id).catch(() => [])).find((c) => c.dive.id === otherId);
    // Deleted at the Provider before anything changes here, as when deleting a Dive: only the copy of the Dive not kept,
    // and only where the kept one has its own.
    const asked = candidate ? candidate.bothAt.filter((provider) => alsoAt.includes(provider)) : [];
    if (asked.length > 0) {
      const leaving = candidate!.keeps === otherId ? request.params.id : otherId;
      const [row] = await db.select({ version: dive.version }).from(dive).where(eq(dive.id, leaving));
      if (row?.version !== (leaving === otherId ? otherVersion : version)) return reply.code(409).send(problem('dive_changed'));
      const { copies, failure } = await pushes.removeAt(userId, leaving, asked);
      if (failure) return replyProviderError(failure, reply, { providers: asked.map((provider) => ({ provider, copy: copies.find((c) => c.provider === provider)?.copy ?? 'kept' as const })) });
    }
    // Deleting there recorded a Push, not a change of the Dive: its version is the one sent.
    const { kept } = await merging.merge(userId, { id: request.params.id, version }, { id: otherId, version: otherVersion });
    return view((await findDive(request, kept))!);
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
    // Why it is gone, when it wasn't deleted by hand: the Revision that deleted it names the Dive it went into.
    const last = rows.length === 0 ? [] : await db.selectDistinctOn([revision.entityId], { id: revision.entityId, changes: revision.changes })
      .from(revision).where(and(eq(revision.entityType, 'dive'), inArray(revision.entityId, rows.map((r) => r.d.id))))
      .orderBy(revision.entityId, desc(revision.at), desc(revision.id));
    const went = (id: string, key: 'mergedInto' | 'movedTo') => {
      const to = last.find((r) => r.id === id)?.changes[key]?.to;
      return typeof to === 'string' ? to : null;
    };
    return {
      dives: rows.map(({ d, siteName }) => ({
        id: d.id, diverId: d.diverId, version: d.version, number: d.number, startsAt: d.startsAt.toISOString(),
        utcOffsetSeconds: d.utcOffsetSeconds, utcOffsetSource: d.utcOffsetSource, durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM,
        site: d.siteId && siteName !== null ? { id: d.siteId, name: siteName } : null,
        deletedAt: d.deletedAt!.toISOString(), mergedInto: went(d.id, 'mergedInto'), movedTo: went(d.id, 'movedTo'),
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
