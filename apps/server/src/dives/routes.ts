// One Dive: its values (with Overrides), Recordings, editing, Primary recording, history (ADR 0015); its water
// type from its site, and whether the computer was set to other water (ADR 0025).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser, userOf } from '../auth/fastify.js';
import {
  CYLINDER_MATERIALS, PARTICIPANT_ROLES, UTC_OFFSET_SOURCES, dive,
  type RecordingSummary,
} from '../db/schema.js';
import { answerErrors, answers, Problem, problem } from '../http/problems.js';
import { Copies, DeleteProblemSchema } from './deletion-view.js';
import {
  CylinderInput, CylinderValues, CylinderView, DiveView, Field, LeadEntry, LeadInput, Role, SuitInput, SuitValues, valueProperties, ValuesSchema,
  WeightingFeedbackInput, WeightingFeedbackValues,
} from './dive-view.js';
import { CYLINDER_CATALOGUE } from './cylinder-catalogue.js';
import { CylinderError, withoutPressures } from './cylinders.js';
import { DiveError, type DiveService } from './dive-service.js';
import { DiveSummaryFields, diveSummaryOf, providersOf } from './dive-summary-view.js';
import { WeightingError, leadTotalKg, suitOf, weightingFeedbackOf } from './weighting.js';
import type { MergingService } from './merging-service.js';
import type { LogbookService } from './logbook-service.js';
import type { DeletionService } from './deletion-service.js';
import type { MergeService } from './merge-service.js';
import { LOGBOOK_CHECK_RULES } from './checks/logbook-check-rules.js';
import type { LogbookCheckService } from './checks/logbook-check-service.js';
import { valuesFromRecording, type DiveValues } from './dive-values.js';
import { REVISION_CAUSES } from './revisions.js';
import { sacOfDive } from './calc/sac.js';
import { waterMismatch } from './calc/water.js';
import { recordingPosition } from '../sites/dive-site-link.js';
import type { CentreService } from '../centres/centre-service.js';
import type { DiverService } from '../divers/diver-service.js';
import type { PushService } from '../providers/push/push-service.js';
import type { WaitingPushService } from '../providers/waiting-push/waiting-push-service.js';
import type { AssessmentService } from '../assessment/assessment-service.js';
import { refreshAssessmentsAfterChange } from './assessment-refresh.js';
import { WaitingPushView } from './waiting-push-view.js';
import type { ProviderAnswers } from '../providers/route-parts.js';
import { Change, Changes, DateTime, historyRoute, IdParams, Made, Nullable, refTo } from '../http/schemas.js';

export interface DiveRouteDeps {
  auth: Auth;
  dives: DiveService;
  logbook: LogbookService;
  divers: DiverService;
  centres: CentreService;
  /** Merging two Dives and moving one to another Diver (ADR 0038). */
  merging: MergingService;
  /** What in a logbook can't be right as it stands (ADR 0038). */
  checks: LogbookCheckService;
  pushes: PushService;
  waitingPushes: Pick<WaitingPushService, 'deletingItself'>;
  /** Deleting a Dive asks every Provider it is at (ADR 0026, 0027). */
  deletion: DeletionService;
  /** Merging two Dives deletes the one not kept at the Providers asked first (ADR 0038). */
  merge: MergeService;
  assessments: AssessmentService;
  /** How a refusal about a Provider is answered (providers/route-parts.ts). */
  providerAnswers: ProviderAnswers;
}


const EditBody = Type.Object({
  version: Type.Integer(),
  set: Type.Optional(Type.Object({
    startsAt: Type.Optional(valueProperties.startsAt), durationSeconds: Type.Optional(valueProperties.durationSeconds),
    maxDepthM: Type.Optional(valueProperties.maxDepthM), avgDepthM: Type.Optional(valueProperties.avgDepthM),
    waterTemperatureC: Type.Optional(valueProperties.waterTemperatureC),
    // Named so that it is refused (400), not left out silently like an unknown field: ADR 0048.
    number: Type.Optional(Type.Never({ description: 'Never accepted: the number of a Dive is computed' })),
  }, { additionalProperties: false, description: 'Values to override. The number of the Dive is none of them (ADR 0048): naming it is 400' })),
  reset: Type.Optional(Type.Array(Field)),
  notes: Type.Optional(Nullable(Type.String({ maxLength: 20_000 }))),
  siteId: Type.Optional(Nullable(Type.String({ format: 'uuid', description: 'The Dive site, or null for none' }))),
  cylinders: Type.Optional(Type.Array(CylinderInput, {
    maxItems: 12,
    description: 'The Dive\'s Cylinders as one list, replacing the ones it has; a value left out is unknown. 400 cylinder_invalid for an end '
      + 'pressure above the start, a gas over 100 % or a series twice; 400 cylinder_series_not_found for a series the Dive\'s Recordings don\'t have',
  })),
  lead: Type.Optional(Type.Array(LeadInput, {
    maxItems: 8,
    description: 'The Dive\'s Lead as one list of entries, replacing the ones it has; an empty list means unknown, one entry of 0 no lead',
  })),
  weightingFeedback: Type.Optional(Nullable(WeightingFeedbackInput)),
  suit: Type.Optional(Nullable(SuitInput)),
});

const SiteRef = Type.Object({ id: Type.String(), name: Type.String({ description: 'The name it had then' }) });
/** The fields a Dive's history names with their shapes; the overridable values have the same shape as in `values`. */
const DiveChanges = Changes({
  overrides: Change(Type.Array(Field)),
  site: Change(Nullable(SiteRef)),
  utcOffsetSource: Change(Type.Enum([...UTC_OFFSET_SOURCES])),
  fromProvider: Made(Type.String({ description: 'The Provider the Dive was made from (ADR 0030)' })),
  providers: Change(Type.Array(Type.Object({ provider: Type.String(), remoteId: Type.String(), remoteNumber: Nullable(Type.Integer()) }), {
    description: 'Links to Providers a merge moved onto this Dive (ADR 0038)',
  })),
  cylinders: Change(Type.Array(CylinderView)),
  lead: Change(Type.Array(LeadEntry)),
  weightingFeedback: Change(Nullable(Type.Object(WeightingFeedbackValues))),
  suit: Change(Nullable(Type.Object(SuitValues))),
  participants: Change(Type.Array(Type.Object({
    diverId: Type.String(), name: Type.String({ description: 'The name the Diver had then' }), role: Type.Enum([...PARTICIPANT_ROLES]),
  }))),
}, 'Field → { from, to }; a field not named here has a value of any shape');

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
  changes: DiveChanges,
});
type StoredDiveChanges = Static<typeof DiveChanges>;

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
const CYLINDER_STATUS: Record<CylinderError['code'], number> = { cylinder_invalid: 400, cylinder_series_not_found: 400 };
const WEIGHTING_STATUS: Record<WeightingError['code'], number> = { weighting_feedback_invalid: 400, suit_invalid: 400 };

const DeletedDiveView = Type.Object({
  id: Type.String(),
  diverId: Type.String(),
  version: Type.Integer({ description: 'Send it back to restore the Dive' }),
  ...DiveSummaryFields,
  deletedAt: DateTime,
  mergedInto: Nullable(Type.String({ description: 'The Dive it was merged into (ADR 0038): clients say so and link there' })),
  movedTo: Nullable(Type.String({ description: 'The Dive it became in another Diver\'s logbook when it was moved while linked to a Provider (ADR 0038)' })),
  stillAt: Type.Array(Type.Object({
    provider: Type.String(),
    remoteNumber: Nullable(Type.Integer({ description: 'The Provider\'s own dive number' })),
  }), { description: 'Providers the dive is still at: clients remind the User and offer to delete it there (docs/spec/clients.md)' }),
  waiting: Type.Array(WaitingPushView, {
    description: 'The Dive\'s entries in the queue of Waiting pushes: a delete at a Provider that goes out 5 minutes after deleting here '
      + '(Undo cancels it), or one that is held or stopped, with its reason',
  }),
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
  ...DiveSummaryFields,
  fromProvider: Nullable(Type.String()),
  recordings: Type.Integer({ description: 'How many Recordings it has' }),
  at: At,
};

const MergeCandidate = Type.Object({
  ...PairedDive,
  /** Null for a Dive that is only nearby (`scope=nearby`) and breaks no logbook check with this one. */
  rule: Nullable(Rule),
  answered: Type.Boolean({ description: 'The User said these are two dives: don\'t hint at the pair again (it can still be merged)' }),
  keeps: Type.String({ description: 'Which of the two Dives a merge keeps: the one with a Recording when only one has, else the Dive asked about' }),
  bothAt: Type.Array(Type.String(), {
    description: 'Providers both Dives are at: the dive of the one not kept stays there unless `alsoAt` names the Provider (docs/spec/clients.md)',
  }),
  deletesItself: Type.Array(Type.String(), {
    description: 'Of `bothAt`, the Providers where the Connection of the Dive not kept deletes at the Provider by itself: its dive there is '
      + 'deleted 5 minutes after the merge (restoring it cancels that), so don\'t ask about them and leave them out of `alsoAt`',
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
    deletesItself: Type.Array(Type.String(), {
      description: 'Of `bothAt`, the Providers where the Connection of the Dive not kept deletes at the Provider by itself (see GET /dives/{id}/merge-candidates): '
        + 'merging doesn\'t ask about them; leave them out of `alsoAt`',
    }),
  })),
});

const DeleteProblem = refTo(DeleteProblemSchema);

/** Deleted Dives listed at most (newest deletion first). */
const DELETED_SHOWN = 100;

export const diveRoutes: FastifyPluginAsyncTypebox<DiveRouteDeps> = async (app, { auth, dives, logbook, divers, centres, merging, checks, pushes, waitingPushes, deletion, merge, assessments, providerAnswers }) => {
  app.addHook('onRequest', requireUser(auth));
  refreshAssessmentsAfterChange(app, assessments);

  app.setErrorHandler(answerErrors(
    answers(DiveError, STATUS), answers(CylinderError, CYLINDER_STATUS), answers(WeightingError, WEIGHTING_STATUS), providerAnswers.answer,
  ));


  /** The Dive if the signed-in User manages its Diver. */
  const findDive = (request: FastifyRequest, id: string) => logbook.findManagedDive(userOf(request).id, id);
  /** The view of a Dive a change just kept: it must exist, so its absence is a bug, not a 404. */
  const viewOfKept = async (request: FastifyRequest, id: string) => {
    const row = await findDive(request, id);
    if (!row) throw new Error(`Dive ${id} is gone right after its change`);
    return view(row);
  };

  const view = async (row: typeof dive.$inferSelect): Promise<Static<typeof DiveView>> => {
    const { recordings: recs, site } = await logbook.recordingsAndSite(row);
    const primary = recs.find(({ r }) => r.id === row.primaryRecordingId)?.r;
    const { cylinders, lead } = await logbook.partsOf(row.id);
    const { sac, missing: sacMissing } = sacOfDive(row, cylinders);
    return {
      id: row.id,
      diverId: row.diverId,
      version: row.version,
      values: { number: row.number, ...toValues({
        startsAt: { at: row.startsAt, utcOffsetSeconds: row.utcOffsetSeconds },
        durationSeconds: row.durationSeconds, maxDepthM: row.maxDepthM, avgDepthM: row.avgDepthM,
        waterTemperatureC: row.waterTemperatureC,
      }) },
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
      cylinders,
      lead,
      leadTotalKg: leadTotalKg(lead),
      weightingFeedback: weightingFeedbackOf(row),
      suit: suitOf(row),
      sac,
      sacMissing,
      participants: await logbook.participantsOfDive(row.id),
      verificationCodes: [
        ...(await centres.codesOfDive(row.id)).map((c) => ({ kind: 'centre' as const, diver: null, ...c })),
        ...(await divers.professionalCodesOfDive(row.id)).map((c) => ({ kind: 'professional' as const, centre: null, ...c })),
      ],
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
      summary: 'Edit a Dive: set values (they become Overrides), reset Overrides, change notes, the Dive site or the Cylinders',
      description: 'Send the version you started from; if the Dive changed meanwhile the answer is 409 dive_changed.',
      params: IdParams, body: EditBody, response: { 200: DiveView, 400: Problem, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    const { version, set, reset, notes, siteId, cylinders, lead, weightingFeedback, suit } = request.body;
    await dives.edit(userOf(request).id, request.params.id, {
      version, ...(set && { set: fromValues(set) }), ...(reset && { reset }), ...(notes !== undefined && { notes }),
      ...(siteId !== undefined && { siteId }), ...(cylinders && { cylinders }), ...(lead && { lead }),
      ...(weightingFeedback !== undefined && { weightingFeedback }), ...(suit !== undefined && { suit }),
    });
    return viewOfKept(request, request.params.id);
  });

  app.get('/cylinder-catalogue', {
    schema: {
      summary: 'Common cylinders: picking one fills a Cylinder\'s volume, working pressure and material (ADR 0031)',
      description: 'A list in code, the same for everyone. The Cylinder keeps the values, not the entry; any value can be typed instead. '
        + 'Clients name an entry by its trade name, else by material, size and pressure (docs/spec/clients.md).',
      response: {
        200: Type.Array(Type.Object({
          id: Type.String(),
          tradeName: Nullable(Type.String({ description: 'The name it is sold under, the same in every language (AL80)' })),
          twin: Type.Boolean({ description: 'Two cylinders on one manifold: volumeL is that of both' }),
          volumeL: Type.Number(),
          workingPressureBar: Type.Number(),
          material: Type.Enum([...CYLINDER_MATERIALS]),
        })),
      },
    },
  }, async () => [...CYLINDER_CATALOGUE]);

  app.get('/dives/:id/same-as-last', {
    schema: {
      summary: '"Same as last dive": what the Diver\'s previous Dive had, to put into this Dive\'s form',
      description: 'What the Diver\'s Dive before this one by start time had: its Cylinders without their pressures and their series, its Lead '
        + 'and its exposure suit; not how the weighting felt (ADR 0031, 0045). '
        + 'Nothing is changed: the client fills its form and the User saves (docs/spec/clients.md). `diveId` is null for a Diver\'s first Dive.',
      params: IdParams,
      response: {
        200: Type.Object({
          diveId: Nullable(Type.String({ description: 'The previous Dive' })),
          cylinders: Type.Array(Type.Object({
            volumeL: CylinderValues.volumeL, workingPressureBar: CylinderValues.workingPressureBar, material: CylinderValues.material, gas: CylinderValues.gas,
          })),
          lead: Type.Array(LeadEntry),
          suit: Nullable(Type.Object(SuitValues)),
        }),
        404: Problem,
      },
    },
  }, async (request, reply) => {
    const row = await findDive(request, request.params.id);
    if (!row) return reply.code(404).send(problem('dive_not_found'));
    const previous = await logbook.previousDive(row);
    if (!previous) return { diveId: null, cylinders: [], lead: [], suit: null };
    const { cylinders, lead } = await logbook.partsOf(previous.id);
    return { diveId: previous.id, cylinders: cylinders.map(withoutPressures), lead, suit: suitOf(previous) };
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
    await dives.setParticipants(userOf(request).id, request.params.id, request.body.version, request.body.participants);
    return viewOfKept(request, request.params.id);
  });

  app.put('/dives/:id/primary-recording', {
    schema: {
      summary: 'Make one of the Dive\'s Recordings the Primary one; values without Override follow it',
      params: IdParams, body: Type.Object({ recordingId: Type.String({ format: 'uuid' }), version: Type.Integer() }),
      response: { 200: DiveView, 400: Problem, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    await dives.setPrimary(userOf(request).id, request.params.id, request.body.recordingId, request.body.version);
    return viewOfKept(request, request.params.id);
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
    const id = await merging.move(userOf(request).id, request.params.id, request.body.diverId, request.body.version);
    return viewOfKept(request, id);
  });

  app.get('/dives/:id/merge-candidates', {
    schema: {
      summary: 'The Dives of the same Diver this one may be merged with',
      description: 'By default those it breaks a logbook check with (ADR 0038): at the same time as an import matches a Recording to a Dive '
        + '(5 minutes of tolerance; local times where a time zone is unknown), or the same dive typed with another start. `scope=nearby` '
        + 'lists every Dive of the Diver from the local day before to the day after, in order of their start, each with its rule or null: '
        + 'the Dives to choose from when the User merges two by hand.',
      params: IdParams,
      querystring: Type.Object({ scope: Type.Optional(Type.Enum(['rule', 'nearby'], { default: 'rule' })) }),
      response: { 200: Type.Array(MergeCandidate), 404: Problem },
    },
  }, async (request) => (await merging.mergeCandidates(userOf(request).id, request.params.id, request.query.scope)).map(({ dive: d, siteName, recordings, at, keeps, bothAt, deletesItself, rule, answered }) => ({
    id: d.id, version: d.version, ...diveSummaryOf(d, siteName), fromProvider: d.fromProvider, recordings, at, keeps, bothAt, deletesItself,
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
    const list = await checks.list(userOf(request).id, status);
    const short = await checks.shortDives(userOf(request).id, atProvider, status);
    const ids = [...new Set(list.flatMap((c) => c.dives.map((d) => d.id)))];
    const remote = await pushes.currentOf(ids);
    const at = (id: string) => providersOf(remote, id);
    const itself = await waitingPushes.deletingItself(ids);
    const paired = (d: (typeof list)[number]['dives'][number]) => ({
      id: d.id, version: d.version, ...diveSummaryOf(d, d.siteName), fromProvider: d.fromProvider, recordings: d.recordings, at: at(d.id),
    });
    return [...list.map(({ rule, obvious, dives: [a, b] }) => {
      const bothAt = at(b.id).filter((t) => at(a.id).some((m) => m.provider === t.provider)).map((t) => t.provider);
      const keeps = a.recordings === 0 && b.recordings > 0 ? b.id : a.id;
      return {
        rule, obvious: obvious && bothAt.length === 0, diverId: a.diverId, dive: paired(a),
        // The Dive not kept stays behind at a Provider, unless its Connection deletes there by itself (the queue, 5 minutes after the merge).
        other: { ...paired(b), keeps, bothAt, deletesItself: bothAt.filter((provider) => itself.get(keeps === a.id ? b.id : a.id)?.has(provider)) },
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
    if (b === undefined) await checks.keep(userOf(request).id, a, atProvider, answer && 'keep');
    else await checks.answer(userOf(request).id, [a, b], answer && 'two_dives');
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
    const merged = await merge.merge(userOf(request).id, { id: request.params.id, version }, { id: otherId, version: otherVersion }, alsoAt);
    if (merged.failure) return providerAnswers.reply(merged.failure, reply, { providers: merged.providers });
    return viewOfKept(request, merged.kept);
  });

  app.post('/recordings/:id/detach', {
    schema: {
      summary: 'Split a Recording off its Dive into a new Dive of the same Diver',
      description: 'Send the version of the Dive it is on. The Dive\'s last Recording can\'t be split off.',
      params: IdParams, body: Type.Object({ version: Type.Integer() }),
      response: { 200: Type.Object({ diveId: Type.String({ description: 'The new Dive' }) }), 404: Problem, 409: Problem },
    },
  }, async (request) => ({ diveId: await dives.detach(userOf(request).id, request.params.id, request.body.version) }));

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
    const { providers, failure } = await deletion.remove(userOf(request).id, request.params.id, version, alsoAt);
    if (failure) return providerAnswers.reply(failure, reply, { providers });
    return { providers };
  });

  app.get('/dives/deleted', {
    schema: {
      summary: 'The User\'s deleted Dives, most recently deleted first (at most 100), to restore them; which Providers they are still at',
      response: { 200: Type.Array(DeletedDiveView) },
    },
  }, async (request) => deletion.deleted(userOf(request).id, DELETED_SHOWN));

  app.post('/dives/:id/restore', {
    schema: {
      summary: 'Bring a deleted Dive back with its Recordings (not to Providers: send it again from there)',
      description: 'Send the version from GET /dives/deleted (409 dive_changed). A site deleted meanwhile becomes the one it was merged into, or none.',
      params: IdParams, body: Type.Object({ version: Type.Integer() }),
      response: { 200: DiveView, 404: Problem, 409: Problem },
    },
  }, async (request) => {
    await dives.restore(userOf(request).id, request.params.id, request.body.version);
    return viewOfKept(request, request.params.id);
  });

  app.get('/dives/:id/revisions', {
    ...historyRoute,
    schema: {
      summary: 'The Dive\'s history, newest first: its own Revisions and those of its Recordings',
      params: IdParams, response: { 200: Type.Array(RevisionView), 404: Problem },
    },
  }, async (request, reply) => {
    const row = await findDive(request, request.params.id);
    if (!row) return reply.code(404).send(problem('dive_not_found'));
    const rows = await logbook.revisionsOfDive(row.id);
    return rows.map(({ r, userName, uploadName }) => ({
      id: r.id, at: r.at.toISOString(),
      actor: { type: r.actorType, id: r.actorId, name: r.actorType === 'user' ? userName : r.actorType === 'import' ? uploadName : null },
      cause: r.cause as (typeof REVISION_CAUSES)[number],
      // Stored as written: today's shapes for the named fields, older Revisions as they were (see Changes).
      changes: r.changes as StoredDiveChanges,
    }));
  });
};
