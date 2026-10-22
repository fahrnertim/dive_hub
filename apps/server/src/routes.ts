import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from './auth/auth.js';
import { requireUser } from './auth/fastify.js';
import type { Db } from './db/client.js';
import {
  DIVE_KINDS, IMPORT_ERROR_CODES, OUTCOME_REASONS, PARTICIPANT_ROLES, UTC_OFFSET_SOURCES, dive, importJob,
} from './db/schema.js';
import { downsampleMinMax } from './dives/downsample.js';
import { managedDiverIds } from './dives/dive-service.js';
import { asksFor, DIVE_ONLY } from './dives/list-filter.js';
import { DIVE_SORTS, type LogbookService, type RowExtras } from './dives/logbook-service.js';
import { Problem, problem } from './http/problems.js';
import type { ImportService } from './imports/import-service.js';
import type { PushService } from './providers/push-service.js';
import { UploadTooLargeError } from './storage/blob-store.js';

export interface RouteDeps {
  db: Db;
  imports: ImportService;
  logbook: LogbookService;
  /** For the logbook's "changed since sent" filter, which needs the adapters' fingerprints. */
  pushes: PushService;
  maxUploadBytes: number;
  auth: Auth;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const DateTime = Type.String({ format: 'date-time' });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([t, Type.Null()]);

export const ImportView = Type.Object({
  id: Type.String(),
  status: Type.Enum(['pending', 'processing', 'done', 'failed', 'awaiting_choice', 'cancelled'], {
    description: 'awaiting_choice: the upload holds several kinds of dive and nothing is imported until the User starts it with the kinds '
      + 'to import (ADR 0044); cancelled: the User ended that wait, or nobody answered for seven days (errorCode choice_expired)',
  }),
  uploadName: Type.String({ description: 'The uploaded file\'s name; for an import from a Provider, the Provider\'s name' }),
  provider: Nullable(Type.String({ description: 'An import of this Provider\'s dives (ADR 0030); null for an upload' })),
  createdAt: DateTime,
  finishedAt: Nullable(DateTime),
  errorCode: Nullable(Type.Enum([...IMPORT_ERROR_CODES], { description: 'Why the Import failed or ended; clients translate it. The detail stays in the server log' })),
  found: Nullable(Type.Object({
    scuba: Type.Integer({ description: 'Dives with a gas: open circuit, rebreather, gauge' }),
    apnea: Type.Integer({ description: 'Apnea sessions' }),
    otherFiles: Type.Integer({ description: 'Files that are no dive (other sports, health data, anything else); they are not kept' }),
  }, { description: 'What an upload holds, once it is analysed (ADR 0044); null before, and for an import from a Provider' })),
  kinds: Nullable(Type.Array(Type.Enum([...DIVE_KINDS]), { description: 'The kinds of dive the User chose to import; null when nobody was asked (all were imported)' })),
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
      + 'no-site, with-findings (the list’s mark is set), not-at-provider (a Provider the User is connected to for the Diver has no current dive for it), '
      + 'changed-since-sent (at a Provider the User is connected to for the Diver, the current dive there is not up to date with the Dive, '
      + 'or its number differs and the Connection follows numbers)',
  })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 25 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

const DiveCounts = Type.Object({
  noRecording: Type.Integer(), noSite: Type.Integer(), withFindings: Type.Integer(), notAtProvider: Type.Integer(),
  changedSinceSent: Type.Integer(),
},{ description: 'How many Dives each filter would show for the Diver and the search, whatever filters are applied (ADR 0040)' });

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
  profile: Nullable(Type.Object({
    depthsM: Type.Array(Type.Number(), { description: 'Depth in metres, evenly spread over `spanSeconds`; the deepest sample of each stretch' }),
    spanSeconds: Type.Number({ description: 'Seconds from the first to the last depth sample of the Primary recording' }),
    ascentBands: Type.Array(Type.Tuple([Type.Number(), Type.Number(), Type.Integer({ minimum: 1, maximum: 3 })]), {
      description: 'Stretches of the ascent that were fast, [start s, end s, band 1–3 for brisk, quick, very quick], in seconds from the first sample (ADR 0036)',
    }),
  }, { description: 'The Primary recording’s depth, reduced to draw a sketch of the dive (ADR 0041); null without a Recording or while the Dive waits to be assessed' })),
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


const DiveNeighboursView = Type.Object({
  previous: Nullable(Type.Object({ id: Type.String() })),
  next: Nullable(Type.Object({ id: Type.String() })),
  position: Nullable(Type.Integer({ description: 'Where the Dive is in the list, from 1; null when the list does not show it' })),
  total: Type.Integer({ description: 'How many Dives the list shows' }),
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
  errorCode: j.error === null ? null : j.error === 'unsupported_file' || j.error === 'choice_expired' ? j.error : 'processing_failed',
  found: j.found, kinds: j.kinds,
});
/**
 * An Import's outcome is stored once; a Duplicate candidate is decided later. Adds the current
 * decision (and the Dive the Recording went to) so the client doesn't show a stale "needs your decision".
 */
async function withDecisions(imports: ImportService, rows: (typeof importJob.$inferSelect)[]) {
  const views = rows.map(toImportView);
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

const toDiveSummary = (d: typeof dive.$inferSelect, siteName: string | null, findings: number, extras: RowExtras): Static<typeof DiveSummaryView> => ({
  findings, ...extras, fromProvider: d.fromProvider,
  site: d.siteId && siteName !== null ? { id: d.siteId, name: siteName } : null,
  id: d.id, diverId: d.diverId, number: d.number, startsAt: d.startsAt.toISOString(), utcOffsetSeconds: d.utcOffsetSeconds,
  utcOffsetSource: d.utcOffsetSource, durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, avgDepthM: d.avgDepthM,
});

export const apiRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, deps) => {
  const { db, imports, logbook } = deps;

  // Every logbook route needs a signed-in User and only shows what that User may see.
  app.addHook('onRequest', requireUser(deps.auth));
  const userId = (request: FastifyRequest) => request.user!.id;

  /** Divers the signed-in User manages; all logbook reads are scoped to them. */
  const managedDivers = async (request: FastifyRequest) => [...await managedDiverIds(db, userId(request))];

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
    return withDecisions(imports, await imports.recentImports(userId(request)));
  });

  app.get('/imports/:id', {
    schema: { summary: 'One Import with its outcome', params: IdParams, response: { 200: ImportView, 404: Problem } },
  }, async (request, reply) => {
    const row = await imports.findImport(userId(request), request.params.id);
    return row ? (await withDecisions(imports, [row]))[0]! : reply.code(404).send(problem('import_not_found'));
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

  /** What the list shows and in which order: the Diver, search and filters, shared by the page and a Dive's neighbours (ADR 0042). */
  const listScope = async (request: FastifyRequest, query: Static<typeof DiveListQuery>, { counts = false } = {}) => {
    const { diverId, siteId, q, only, sort, order } = query;
    const managed = await managedDivers(request);
    const divers = diverId ? managed.filter((id) => id === diverId) : managed;
    // "Changed since sent" comes from the adapters' fingerprints, not SQL: worked out only when the list needs it.
    const changedIds = counts || asksFor(only, 'changed-since-sent') ? await deps.pushes.changedSinceSent(userId(request), divers) : undefined;
    return { userId: userId(request), diverIds: divers, siteId, q, only, changedIds, sort, order };
  };

  app.get('/dives', {
    schema: {
      summary: 'A page of the Dives of the Divers the signed-in User manages (newest first unless sorted otherwise)',
      querystring: DiveListQuery,
      response: { 200: DiveListView },
    },
  }, async (request) => {
    const { limit = 25, offset = 0 } = request.query;
    const scope = await listScope(request, request.query, { counts: true });
    if (scope.diverIds.length === 0) {
      return {
        dives: [], total: 0, counts: { noRecording: 0, noSite: 0, withFindings: 0, notAtProvider: 0, changedSinceSent: 0 },
        totals: { dives: 0, durationSeconds: 0, deepestM: null, lastDiveAt: null }, months: [],
      };
    }
    const { rows, total, counts, totals, months } = await logbook.listDives(scope, { limit, offset });
    return {
      dives: rows.map((r) => toDiveSummary(r.d, r.siteName, r.findings, r.extras)),
      total,
      counts,
      totals: { ...totals, lastDiveAt: totals.lastDiveAt?.toISOString() ?? null },
      months,
    };
  });

  app.get('/dives/:id/neighbours', {
    schema: {
      summary: 'The Dives before and after one in the logbook list’s order (ADR 0042)',
      description: 'Takes the list’s own settings (diverId, siteId, q, only, sort, order; not limit or offset). `previous` is the row above in that list, `next` the row below. '
        + 'When the list does not show the Dive, `position` and both neighbours are empty.',
      params: IdParams,
      querystring: Type.Omit(DiveListQuery, ['limit', 'offset']),
      response: { 200: DiveNeighboursView, 404: Problem },
    },
  }, async (request, reply) => {
    const ownId = await logbook.ownDiveId(request.params.id, await managedDivers(request));
    if (!ownId) return reply.code(404).send(problem('dive_not_found'));
    const { previous, next, position, total } = await logbook.neighbours(ownId, await listScope(request, request.query));
    return { previous: previous ? { id: previous } : null, next: next ? { id: next } : null, position, total };
  });

  app.get('/recordings/:id/samples', {
    schema: {
      summary: 'Sample series of a Recording, downsampled for display',
      params: IdParams, querystring: SamplesQuery, response: { 200: SamplesView, 404: Problem },
    },
  }, async (request, reply) => {
    const recordingId = await logbook.ownRecordingId(request.params.id, await managedDivers(request));
    if (!recordingId) return reply.code(404).send(problem('recording_not_found'));
    const wanted = request.query.channels?.split(',').map((c) => c.trim()).filter(Boolean);
    const rows = await logbook.samplesOf(recordingId, wanted);
    const maxPoints = request.query.maxPoints ?? 2000;
    return {
      recordingId,
      series: rows.map((s) => {
        const reduced = downsampleMinMax(s.offsetsMs, s.values, maxPoints);
        return { channel: s.channel, offsetsMs: reduced.offsets, values: reduced.values };
      }),
    };
  });
};
