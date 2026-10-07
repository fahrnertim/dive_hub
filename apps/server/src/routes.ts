import { and, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from './auth/auth.js';
import { requireUser } from './auth/fastify.js';
import type { Db } from './db/client.js';
import {
  IMPORT_ERROR_CODES, OUTCOME_REASONS, PARTICIPANT_ROLES, UTC_OFFSET_SOURCES, dive, diveSite, diver, diverManagement, duplicateCandidate,
  importJob, participant, recording, sampleSeries,
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

export const ImportView = Type.Object({
  id: Type.String(),
  status: Type.Union([Type.Literal('pending'), Type.Literal('processing'), Type.Literal('done'), Type.Literal('failed')]),
  uploadName: Type.String({ description: 'The uploaded file\'s name; for an import from a Provider, the Provider\'s name' }),
  provider: Nullable(Type.String({ description: 'An import of this Provider\'s dives (ADR 0030); null for an upload' })),
  createdAt: DateTime,
  finishedAt: Nullable(DateTime),
  errorCode: Nullable(Type.Enum([...IMPORT_ERROR_CODES], { description: 'Why the Import failed; clients translate it. The detail stays in the server log' })),
  outcome: Type.Array(Type.Object({
    fileName: Type.String(),
    result: Type.Enum(['created', 'attached', 'linked', 'updated', 'unchanged', 'duplicate-candidate', 'skipped', 'failed'], {
      description: 'linked: a Provider\'s logbook entry tied to a Dive here and filled where it was empty (ADR 0030)',
    }),
    diveId: Type.Optional(Type.String()),
    recordingId: Type.Optional(Type.String()),
    remoteId: Type.Optional(Type.String({ description: 'A Provider\'s dive: its ID there' })),
    remoteNumber: Type.Optional(Type.Integer({ description: 'A Provider\'s dive: its own number there' })),
    reason: Type.Optional(Type.Enum([...OUTCOME_REASONS], { description: 'Why; clients translate it. A failure’s detail stays in the server log' })),
    decision: Type.Optional(Type.Enum(['open', 'attached', 'new_dive', 'discarded'], {
      description: 'For a duplicate-candidate: what has been decided since. diveId is then the Dive it went to',
    })),
  })),
});

/** The logbook list (ADR 0017, 0040): a page of Dives, sorted, searched, narrowed by "show only" filters, with the total. */
const DIVE_SORTS = ['startsAt', 'number', 'maxDepth', 'duration'] as const;
const DIVE_ONLY = ['no-recording', 'no-site', 'with-findings', 'not-at-provider'] as const;
type DiveOnly = (typeof DIVE_ONLY)[number];
const ONLY_PATTERN = `^(${DIVE_ONLY.join('|')})(,(${DIVE_ONLY.join('|')}))*$`;
const DiveListQuery = Type.Object({
  diverId: Type.Optional(Type.String({ format: 'uuid', description: 'Only this Diver\'s Dives' })),
  siteId: Type.Optional(Type.String({ format: 'uuid', description: 'Only Dives at this Dive site' })),
  q: Type.Optional(Type.String({ maxLength: 100, description: 'A dive number, or words from the notes or the site name' })),
  sort: Type.Optional(Type.Enum([...DIVE_SORTS], { default: 'startsAt' })),
  order: Type.Optional(Type.Enum(['desc', 'asc'], { default: 'desc' })),
  only: Type.Optional(Type.String({
    pattern: ONLY_PATTERN,
    description: 'Comma-separated "show only" filters, all of which must fit: no-recording (a logbook entry without a Recording), '
      + 'no-site, with-findings (the list’s mark is set), not-at-provider (a Provider the User is connected to for the Diver has no current dive for it)',
  })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 25 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

const DiveCounts = Type.Object({
  noRecording: Type.Integer(), noSite: Type.Integer(), withFindings: Type.Integer(), notAtProvider: Type.Integer(),
}, { description: 'How many Dives each filter would show for the Diver and the search, whatever filters are applied (ADR 0040)' });

const DiveSummaryView = Type.Object({
  id: Type.String(),
  diverId: Type.String(),
  number: Nullable(Type.Integer()),
  startsAt: DateTime,
  utcOffsetSeconds: Nullable(Type.Integer()),
  utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES], {
    description: 'unknown: startsAt is the local wall-clock time kept as if UTC; show it in UTC without an offset (ADR 0030)',
  }),
  durationSeconds: Type.Number(),
  maxDepthM: Nullable(Type.Number()),
  avgDepthM: Nullable(Type.Number()),
  site: Nullable(Type.Object({ id: Type.String(), name: Type.String() })),
  findings: Type.Integer({
    description: 'How many findings of the dive assessment differ from guidance (note or caution) and were not put aside (ADR 0036); 0: no mark',
  }),
  recordings: Type.Integer({ description: 'How many Recordings the Dive has; 0: a logbook entry only (from a Provider or typed)' }),
  fromProvider: Nullable(Type.String({ description: 'The Provider whose logbook entry the Dive was made from, while it has no Recording (ADR 0030)' })),
  gases: Type.Array(Type.Object({ o2: Type.Number(), he: Type.Number() }), { description: 'The mixes the Primary recording’s computer knew; O₂ and He as percent' }),
  surfaceIntervalSeconds: Nullable(Type.Number({ description: 'The computer’s own surface interval before the dive' })),
  participants: Type.Array(Type.Object({
    diverId: Type.String(), name: Type.String(), role: Type.Enum([...PARTICIPANT_ROLES]),
  }), { description: 'The Divers on the Dive besides its own Diver: buddies first, then guides and instructors, each by name (ADR 0028)' }),
});

const DiveListView = Type.Object({
  dives: Type.Array(DiveSummaryView),
  total: Type.Integer(),
  counts: DiveCounts,
  totals: Type.Object({
    dives: Type.Integer(), durationSeconds: Type.Number(), deepestM: Nullable(Type.Number()), lastDiveAt: Nullable(DateTime),
  }, { description: 'The Diver’s whole logbook, not narrowed by search, site or filters' }),
  months: Type.Array(Type.Object({
    month: Type.String({ pattern: '^\d{4}-\d{2}$', description: 'The local month, YYYY-MM' }), dives: Type.Integer(), durationSeconds: Type.Number(),
  }), { description: 'Only while sorted by date: the months of this page in page order, each with all the matching Dives of that month' }),
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
export const toImportView = (j: typeof importJob.$inferSelect): Static<typeof ImportView> => ({
  id: j.id, status: j.status, uploadName: j.uploadName, provider: j.provider, createdAt: j.createdAt.toISOString(),
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

/** Findings that differ from guidance and that the User neither dismissed on the Dive nor muted for its Diver. */
const FINDINGS_SHOWN = sql<number>`(select count(*)::int from dive_finding f where f.dive_id = "dive"."id" and f.severity <> 'info'
  and not exists (select 1 from finding_dismissal x where x.dive_id = f.dive_id and x.rule = f.rule)
  and not exists (select 1 from muted_rule m where m.diver_id = "dive"."diver_id" and m.rule = f.rule))`.mapWith(Number);

const NO_RECORDING = sql`not exists (select 1 from recording r where r.dive_id = "dive"."id" and r.deleted_at is null)`;

/**
 * A Provider the User is connected to for the Dive's Diver has no current dive for it: the newest Push there that decides
 * ("found gone", or confirmed with a remote ID or a delete) is none, a delete or gone. The same rule as `currentRemote`.
 */
const notAtProvider = (userId: string) => sql`exists (select 1 from connection c where c.user_id = ${userId}::uuid and c.diver_id = "dive"."diver_id"
  and not exists (select 1 from (select p.action, p.remote_gone from push p where p.dive_id = "dive"."id" and p.provider = c.provider
      and (p.remote_gone or (p.state = 'confirmed' and (p.action = 'delete' or p.remote_id is not null)))
      order by p.created_at desc, p.id desc limit 1) newest
    where not newest.remote_gone and newest.action <> 'delete'))`;

/** The local month of a Dive, as the logbook groups it: an unknown offset keeps the wall-clock time as it is. */
const LOCAL_MONTH = sql<string>`to_char("dive"."starts_at" at time zone 'UTC' + make_interval(secs => coalesce("dive"."utc_offset_seconds", 0)), 'YYYY-MM')`;

const ROLE_ORDER = Object.fromEntries(PARTICIPANT_ROLES.map((r, i) => [r, i]));

interface RowExtras {
  recordings: number;
  gases: { o2: number; he: number }[];
  surfaceIntervalSeconds: number | null;
  participants: Static<typeof DiveSummaryView>['participants'];
}

const toDiveSummary = (d: typeof dive.$inferSelect, siteName: string | null, findings: number, extras: RowExtras): Static<typeof DiveSummaryView> => ({
  findings, ...extras, fromProvider: d.fromProvider,
  site: d.siteId && siteName !== null ? { id: d.siteId, name: siteName } : null,
  id: d.id, diverId: d.diverId, number: d.number, startsAt: d.startsAt.toISOString(), utcOffsetSeconds: d.utcOffsetSeconds,
  utcOffsetSource: d.utcOffsetSource, durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, avgDepthM: d.avgDepthM,
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
      response: { 200: DiveListView },
    },
  }, async (request) => {
    const { diverId, siteId, q, only, sort = 'startsAt', order = 'desc', limit = 25, offset = 0 } = request.query;
    const managed = await managedDiverIds(request);
    const divers = diverId ? managed.filter((id) => id === diverId) : managed;
    if (divers.length === 0) {
      return {
        dives: [], total: 0, counts: { noRecording: 0, noSite: 0, withFindings: 0, notAtProvider: 0 },
        totals: { dives: 0, durationSeconds: 0, deepestM: null, lastDiveAt: null }, months: [],
      };
    }
    const filters: Record<DiveOnly, SQL> = {
      'no-recording': NO_RECORDING,
      'no-site': isNull(dive.siteId),
      'with-findings': sql`${FINDINGS_SHOWN} > 0`,
      'not-at-provider': notAtProvider(userId(request)),
    };

    const text = q?.trim();
    let search: SQL | undefined;
    if (text) {
      const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const asNumber = /^\d{1,9}$/.test(text) ? Number(text) : undefined;
      search = or(ilike(dive.notes, pattern), ilike(diveSite.name, pattern), asNumber === undefined ? undefined : eq(dive.number, asNumber));
    }
    // The counts follow the Diver and the search but not the chosen filters, so a chip keeps its number once pressed.
    const base = and(inArray(dive.diverId, divers), isNull(dive.deletedAt), siteId ? eq(dive.siteId, siteId) : undefined, search);
    const chosen = (only?.split(',') ?? []) as DiveOnly[];
    const where = and(base, ...chosen.map((f) => filters[f]));
    const column = { startsAt: dive.startsAt, number: dive.number, maxDepth: dive.maxDepthM, duration: dive.durationSeconds }[sort];
    // Dives without a value (no number, no depth) go last either way; the start time breaks ties.
    const direction = order === 'asc' ? sql`asc nulls last` : sql`desc nulls last`;
    const [rows, [counted], [counts], [totals]] = await Promise.all([
      db.select({ d: dive, siteName: diveSite.name, findings: FINDINGS_SHOWN }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(where)
        .orderBy(sql`${column} ${direction}`, desc(dive.startsAt), desc(dive.id))
        .limit(limit).offset(offset),
      db.select({ n: count() }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(where),
      db.select({
        noRecording: sql<number>`(count(*) filter (where ${filters['no-recording']}))::int`,
        noSite: sql<number>`(count(*) filter (where ${filters['no-site']}))::int`,
        withFindings: sql<number>`(count(*) filter (where ${filters['with-findings']}))::int`,
        notAtProvider: sql<number>`(count(*) filter (where ${filters['not-at-provider']}))::int`,
      }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(base),
      db.select({
        dives: count(), durationSeconds: sql<number>`coalesce(sum(${dive.durationSeconds}), 0)`.mapWith(Number),
        deepestM: sql<number | null>`max(${dive.maxDepthM})`, lastDiveAt: sql<Date | null>`max(${dive.startsAt})`.mapWith((v) => (v ? new Date(v) : null)),
      }).from(dive).where(and(inArray(dive.diverId, divers), isNull(dive.deletedAt))),
    ]);

    const pageIds = rows.map((r) => r.d.id);
    const primaryIds = rows.flatMap((r) => (r.d.primaryRecordingId ? [r.d.primaryRecordingId] : []));
    const [recordingCounts, primaries, people] = pageIds.length === 0 ? [[], [], []] : await Promise.all([
      db.select({ diveId: recording.diveId, n: count() }).from(recording)
        .where(and(inArray(recording.diveId, pageIds), isNull(recording.deletedAt))).groupBy(recording.diveId),
      primaryIds.length === 0 ? [] : db.select({ id: recording.id, summary: recording.summary }).from(recording).where(inArray(recording.id, primaryIds)),
      db.select({ diveId: participant.diveId, diverId: participant.diverId, name: diver.name, role: participant.role }).from(participant)
        .innerJoin(diver, eq(diver.id, participant.diverId)).where(and(inArray(participant.diveId, pageIds), isNull(diver.deletedAt))),
    ]);
    const recordingsOf = new Map(recordingCounts.map((c) => [c.diveId, c.n]));
    const summaryOf = new Map(primaries.map((p) => [p.id, p.summary]));
    const primary = (d: typeof dive.$inferSelect) => (d.primaryRecordingId ? summaryOf.get(d.primaryRecordingId) : undefined);
    const peopleOf = new Map<string, typeof people>();
    for (const p of people.toSorted((a, b) => ROLE_ORDER[a.role]! - ROLE_ORDER[b.role]! || a.name.localeCompare(b.name))) {
      peopleOf.set(p.diveId, [...(peopleOf.get(p.diveId) ?? []), p]);
    }

    // The months of this page, with every matching Dive of each month (not only this page's share).
    let months: Static<typeof DiveListView>['months'] = [];
    if (sort === 'startsAt' && rows.length > 0) {
      const monthOf = (d: typeof dive.$inferSelect) => new Date(d.startsAt.getTime() + (d.utcOffsetSeconds ?? 0) * 1000).toISOString().slice(0, 7);
      const onPage = [...new Set(rows.map((r) => monthOf(r.d)))];
      const sums = await db.select({ month: LOCAL_MONTH, dives: count(), durationSeconds: sql<number>`sum(${dive.durationSeconds})`.mapWith(Number) })
        .from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(and(where, sql`${LOCAL_MONTH} in ${onPage}`)).groupBy(LOCAL_MONTH);
      const byMonth = new Map(sums.map((m) => [m.month, m]));
      months = onPage.flatMap((month) => byMonth.get(month) ?? []);
    }

    return {
      dives: rows.map((r) => toDiveSummary(r.d, r.siteName, r.findings, {
        recordings: recordingsOf.get(r.d.id) ?? 0,
        gases: (primary(r.d)?.gases ?? []).map(({ o2, he }) => ({ o2, he })),
        surfaceIntervalSeconds: primary(r.d)?.surfaceIntervalSeconds ?? null,
        participants: (peopleOf.get(r.d.id) ?? []).map(({ diverId, name, role }) => ({ diverId, name, role })),
      })),
      total: counted?.n ?? 0,
      counts: counts!,
      totals: { ...totals!, lastDiveAt: totals!.lastDiveAt?.toISOString() ?? null },
      months,
    };
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
