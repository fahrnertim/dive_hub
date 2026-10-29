// Push runs over HTTP (ADR 0047): preview, start, list, read, cancel and continue. Registered inside the provider routes,
// so the sign-in hook and the Provider error handler are theirs. A run is the User's, never another's (404).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from 'typebox';
import { Problem, PROBLEMS, type ProblemCode } from '../http/problems.js';
import { DIVE_ONLY_PATTERN } from '../dives/list-filter.js';
import { MAX_IDS, type PushRunService } from './push-run-service.js';
import { DateTime, IdParams, Nullable } from '../http/schemas.js';

const Code = Type.Enum(Object.keys(PROBLEMS) as ProblemCode[]);

const LeftOut = Type.Object({
  upToDate: Type.Integer(), requirementsUnmet: Type.Integer(), updateNotChosen: Type.Integer(), removesVerification: Type.Integer(),
  updateUnsupported: Type.Integer(), beyondCeiling: Type.Integer(), notFound: Type.Integer(),
  numberNotChosen: Type.Integer({ description: 'Dives whose number differs and that a run with numbers would set' }),
  numberTaken: Type.Integer({ description: 'Number changes that wait for a dive the run doesn\'t move (a Dive here left out, or one with no number); set them from their own pages' }),
  numberHeldAtProvider: Type.Integer({ description: 'Number changes whose number a dive only at the Provider holds; import that dive (ADR 0052)' }),
}, { description: 'What the run left out when it was planned, as counts' });

const RunView = Type.Object({
  id: Type.String(),
  connectionId: Type.String(),
  provider: Type.String(),
  diverId: Type.String(),
  status: Type.Enum(['queued', 'running', 'done', 'cancelled', 'stopped']),
  stopCode: Nullable(Code),
  updates: Type.Boolean(),
  updatesRemovingVerification: Type.Boolean(),
  numbers: Type.Boolean(),
  numbersRemovingVerification: Type.Boolean(),
  cancelRequested: Type.Boolean({ description: 'Stop was asked for; the Dive being sent is finished first' }),
  counts: Type.Object({ total: Type.Integer(), waiting: Type.Integer(), sent: Type.Integer(), skipped: Type.Integer(), failed: Type.Integer() }),
  conflicts: Type.Integer({ description: 'Conflicts of this run that still wait in Needs your decision (GET /api/provider-conflicts); an entry a later send closed is not counted, one a later run found again counts in that run' }),
  leftOut: LeftOut,
  pauseMs: Type.Integer({ description: 'Pause between two Dives; 0 when this instance no longer has the Provider' }),
  createdAt: DateTime,
  startedAt: Nullable(DateTime),
  finishedAt: Nullable(DateTime),
  dismissedAt: Nullable(DateTime),
});

const ItemView = Type.Object({
  diveId: Type.String(),
  position: Type.Integer({ description: 'The server\'s order; don\'t rely on it being by date' }),
  action: Type.Enum(['create', 'update', 'number']),
  state: Type.Enum(['waiting', 'sending', 'sent', 'skipped', 'failed']),
  outcome: Nullable(Type.Enum(['created', 'updated', 'linked', 'numbered'])),
  sharesWithDiveId: Nullable(Type.String({ description: 'A number change that took the number this Dive still held, for one save (a swap or cycle, ADR 0052)' })),
  reason: Nullable(Type.String({
    description: 'skipped: exists, requirements_unmet, up_to_date, update_not_chosen, removes_verification, update_unsupported, dive_not_found, number_taken. failed: a problem code',
  })),
  dive: Type.Object({ number: Nullable(Type.Integer()), startsAt: DateTime, siteName: Nullable(Type.String()) }),
});

const WithoutSomeone = Type.Object({
  diveId: Type.String(), startsAt: DateTime,
  names: Type.Array(Type.String(), { description: 'Participants the sent Dive went without: no SSI account and no list entry, or not at the Provider' }),
}, { description: 'A sent Dive whose Push left someone out' });

const Unmet = Type.Any({ description: 'As in a Dive\'s status at the Provider (unmet)' });

const PreviewView = Type.Object({
  provider: Type.String(),
  diverId: Type.String(),
  limits: Type.Object({ pauseMs: Type.Integer(), maxDives: Type.Integer() }),
  counts: Type.Object({
    create: Type.Integer(), update: Type.Integer(), updateRemovingVerification: Type.Integer(), upToDate: Type.Integer(),
    requirementsUnmet: Type.Integer(), updateUnsupported: Type.Integer(), notFound: Type.Integer(),
    number: Type.Integer({ description: 'Dives already there whose number differs and can be set, whether or not they are also updated' }),
    numberRemovingVerification: Type.Integer({ description: 'Of those, the ones that need updatesRemovingVerification as well' }),
    numberTaken: Type.Integer({ description: 'Of those, the ones that wait for a dive the run doesn\'t move' }),
    numberHeldAtProvider: Type.Integer({ description: 'Of those, the ones a dive only at the Provider holds the number of; known only when `numbers` is chosen (the logbook is read for it)' }),
  }, { description: 'What is there, whatever the choices say' }),
  leftOut: LeftOut,
  send: Type.Integer({ description: 'How many a start with these choices queues' }),
  beyondCeiling: Type.Integer(),
  withLeftOut: Type.Integer({ description: 'Dives to send that go without a Participant an advisory requirement leaves out' }),
  estimatedSeconds: Type.Integer(),
  blocked: Type.Object({
    total: Type.Integer(),
    dives: Type.Array(Type.Object({
      diveId: Type.String(), number: Nullable(Type.Integer()), startsAt: DateTime, siteId: Nullable(Type.String()),
      siteName: Nullable(Type.String()), unmet: Type.Array(Unmet),
    }), { description: 'The first 100, oldest first' }),
  }),
  inScope: Type.Integer({ description: 'How many Dives the request names (those of the list, or the ids found), whatever happens to them' }),
  numberPlan: Type.Array(Type.Object({
    diveId: Type.String(), number: Nullable(Type.Integer({ description: 'The Dive\'s number here' })),
    from: Nullable(Type.Integer({ description: 'Its number at the Provider now' })), to: Type.Integer({ description: 'The number it gets there' }),
    sharesWith: Nullable(Type.String({ description: 'The Dive that still holds `to`: this first step of a swap or cycle makes the number twice for one save' })),
    with: Type.Enum(['number', 'update'], { description: 'number: a save of its own; update: goes with the dive\'s update' }),
  }), { description: 'Every number a start would set, in the order they go, so the User sees them before anything is sent (ADR 0052)' }),
  heldAtProvider: Type.Array(Type.Object({
    diveId: Type.String(), number: Nullable(Type.Integer()), wanted: Type.Integer(),
    holder: Nullable(Type.Object({
      remoteId: Type.String(), number: Nullable(Type.Integer()), startsAt: Nullable(Type.String()), maxDepthM: Nullable(Type.Number()),
      durationMinutes: Nullable(Type.Number()),
    }, { description: 'The dive at the Provider that has the number (local time as it keeps it); a dive only there' })),
  }), { description: 'Number changes held back by a dive only at the Provider, the first 100; lead to the import' }),
  dives: Type.Array(Type.Object({
    diveId: Type.String(), number: Nullable(Type.Integer()), startsAt: DateTime, siteId: Nullable(Type.String()), siteName: Nullable(Type.String()),
    action: Type.Enum(['create', 'update', 'number']),
  }), { description: 'The Dives a start with these choices would queue, in the order they are sent: at most `limits.maxDives`' }),
});

const StartBody = Type.Object({
  dives: Type.Object({
    list: Type.Optional(Type.Object({
      siteId: Type.Optional(Type.String({ format: 'uuid' })),
      q: Type.Optional(Type.String({ maxLength: 200 })),
      only: Type.Optional(Type.String({ pattern: DIVE_ONLY_PATTERN })),
    }, { description: 'The logbook\'s list for the Connection\'s Diver, as GET /api/dives takes siteId, q and only' })),
    ids: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: MAX_IDS, description: 'Instead of list: these Dives. Ids that are none of the Diver\'s are counted as notFound' })),
  }, { description: 'Exactly one of list and ids' }),
  updates: Type.Optional(Type.Boolean({ default: false, description: 'Also update Dives changed since they were sent (replaces the Provider\'s values)' })),
  updatesRemovingVerification: Type.Optional(Type.Boolean({ default: false, description: 'Also update (or set the number of) Dives where that removes a verification at the Provider' })),
  numbers: Type.Optional(Type.Boolean({ default: false, description: 'Also set the number of Dives already there whose number differs (ADR 0048)' })),
  numbersRemovingVerification: Type.Optional(Type.Boolean({
    default: false, description: 'Confirmed once for the run: set numbers where that can remove a verification at the Provider (ADR 0052). Not what updatesRemovingVerification is for',
  })),
  withHolders: Type.Optional(Type.Boolean({
    default: false, description: 'With dives.ids: also the Dives here whose number at the Provider the named ones want, and so on, so that a taken number is freed by a run (ADR 0052)',
  })),
});

const time = (d: Date | null) => d?.toISOString() ?? null;
const runView = <T extends { stopCode: string | null; createdAt: Date; startedAt: Date | null; finishedAt: Date | null; dismissedAt: Date | null }>(r: T) =>
  ({ ...r, stopCode: r.stopCode as ProblemCode | null, createdAt: r.createdAt.toISOString(), startedAt: time(r.startedAt), finishedAt: time(r.finishedAt), dismissedAt: time(r.dismissedAt) });

const PushRunProblem = Type.Object({
  ...Problem.properties,
  runId: Type.Optional(Type.String({ description: 'With push_run_active: the run that is going' })),
});
const errors = { 400: PushRunProblem, 404: PushRunProblem, 409: PushRunProblem };

export const pushRunRoutes: FastifyPluginAsyncTypebox<{ pushRuns: PushRunService }> = async (app, { pushRuns }) => {
  const userId = (request: { user?: object | null | undefined }) => (request.user as { id: string }).id;
  const requestOf = (body: Static<typeof StartBody>) => {
    const { list, ids } = body.dives;
    return {
      ...(list && { list }), ...(ids && { ids }), updates: body.updates, updatesRemovingVerification: body.updatesRemovingVerification, numbers: body.numbers,
      numbersRemovingVerification: body.numbersRemovingVerification, withHolders: body.withHolders,
    };
  };
  // Exactly one of list and ids: checked here, as the validator would drop properties of a union's other branch.
  const oneOfListAndIds = (body: Static<typeof StartBody>) => !!body.dives.list !== !!body.dives.ids;
  const invalid = { code: 'invalid_input' as const, error: 'Send exactly one of dives.list and dives.ids' };

  app.post('/connections/:id/push-runs/preview', {
    schema: {
      summary: 'What a Push run would do: counts per case, what is held back and why, every number it would set, the limits and the time. Stores nothing',
      description: 'It calls the Provider once (a read of its logbook) only where `numbers` is chosen and a number differs, to name the dives only there that hold a wanted number.',
      params: IdParams, body: StartBody, response: { 200: PreviewView, ...errors },
    },
  }, async (request, reply) => {
    if (!oneOfListAndIds(request.body)) return reply.code(400).send(invalid);
    return runViewOf(await pushRuns.preview(userId(request), request.params.id, requestOf(request.body)));
  });

  app.post('/connections/:id/push-runs', {
    schema: {
      summary: 'Start sending many Dives of the Connection\'s Diver to the Provider: the worker sends one Dive at a time, paced for the Provider',
      description: 'The same body as the preview. 409 push_run_active names the run that is going (runId); poll GET /api/push-runs/{id}.',
      params: IdParams, body: StartBody, response: { 202: RunView, ...errors },
    },
  }, async (request, reply) => {
    if (!oneOfListAndIds(request.body)) return reply.code(400).send(invalid);
    return reply.code(202).send(runView(await pushRuns.start(userId(request), request.params.id, requestOf(request.body))));
  });

  app.get('/push-runs', {
    schema: { summary: 'The signed-in User\'s Push runs, newest first, without items', response: { 200: Type.Array(RunView) } },
  }, async (request) => (await pushRuns.list(userId(request))).map(runView));

  app.get('/push-runs/:id', {
    schema: {
      summary: 'One Push run with its items, in the order they are sent', params: IdParams,
      response: { 200: Type.Intersect([RunView, Type.Object({ withoutSomeone: Type.Array(WithoutSomeone), items: Type.Array(ItemView) })]), ...errors },
    },
  }, async (request) => {
    const run = await pushRuns.get(userId(request), request.params.id);
    return { ...runView(run), withoutSomeone: run.withoutSomeone.map((w) => ({ ...w, startsAt: w.startsAt.toISOString() })), items: run.items.map((i) => ({ ...i, action: i.action as Static<typeof ItemView>['action'], outcome: i.outcome as Static<typeof ItemView>['outcome'], dive: { ...i.dive, startsAt: i.dive.startsAt.toISOString() } })) };
  });

  app.post('/push-runs/:id/cancel', {
    schema: {
      summary: 'Ask a run to stop: the Dive being sent is finished, the rest stay unsent',
      params: IdParams, response: { 200: RunView, ...errors },
    },
  }, async (request) => runView(await pushRuns.cancel(userId(request), request.params.id)));

  app.post('/push-runs/:id/dismiss', {
    schema: {
      summary: 'Put an ended run away from the logbook\'s strip, for every browser and client of the User',
      description: 'Stored with the run (dismissedAt). Only an ended run: 409 push_run_going while it goes. Taking a stopped run up again clears it.',
      params: IdParams, response: { 200: RunView, ...errors },
    },
  }, async (request) => runView(await pushRuns.dismiss(userId(request), request.params.id)));

  app.post('/push-runs/:id/continue', {
    schema: {
      summary: 'Take up a stopped run: the failed Dives that are worth another try go first, then the waiting ones',
      params: IdParams, response: { 202: RunView, ...errors },
    },
  }, async (request, reply) => reply.code(202).send(runView(await pushRuns.continue(userId(request), request.params.id))));
};

/** The preview carries Dates (blocked dives' start times) as strings. */
function runViewOf(preview: Awaited<ReturnType<PushRunService['preview']>>) {
  return {
    ...preview,
    blocked: { ...preview.blocked, dives: preview.blocked.dives.map((d) => ({ ...d, startsAt: d.startsAt.toISOString() })) },
    dives: preview.dives.map((d) => ({ ...d, startsAt: d.startsAt.toISOString() })),
  };
}
