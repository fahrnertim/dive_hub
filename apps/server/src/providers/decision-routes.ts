// What waits for the User's decision, over HTTP: Dives gone at a Provider (ADR 0051), Conflicts and dives already there
// ("Needs your decision", ADR 0056), and the answers that queue a Waiting push again (retry, decision).
// Registered inside the provider routes, so the sign-in hook and the error handler are theirs.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userOf } from '../auth/fastify.js';
import { Problem } from '../http/problems.js';
import { DiveSummaryFields } from '../dives/dive-summary-view.js';
import { DateTime, IdParams, Nullable } from '../http/schemas.js';
import { ConflictChoices, ConflictFieldView } from './conflict-view.js';
import type { ConflictService } from './conflicts.js';
import type { GoneDiveService } from './gone-dives.js';
import type { ProviderRegistry } from './registry.js';
import { DiveProviderParams, errors, GoneSummary } from './route-parts.js';
import type { WaitingPushService } from './waiting-push-service.js';

const GoneDivesView = Type.Object({
  connectionId: Type.String(),
  provider: Type.String(),
  diverId: Type.String(),
  diverName: Type.String(),
  accountLabel: Type.String(),
  compared: Type.Integer({ description: 'Dives of this Diver sent or linked through the Connection' }),
  warning: Type.Boolean({ description: 'More than half of at least five Dives are gone: say to look at the Provider\'s app first' }),
  dives: Type.Array(Type.Object({
    diveId: Type.String(),
    version: Type.Integer({ description: 'The version to send when deleting the Dive (DELETE /api/dives/{id})' }),
    ...DiveSummaryFields,
    remoteId: Type.String(),
    remoteNumber: Nullable(Type.Integer()),
    foundAt: DateTime,
  })),
});

const ConflictsView = Type.Object({
  connectionId: Type.String(),
  provider: Type.String(),
  providerName: Type.String(),
  entries: Type.Array(Type.Object({
    diveId: Type.String(),
    ...DiveSummaryFields,
    kind: Type.Enum(['conflict', 'exists'], {
      description: 'conflict: fields changed on both sides, the User chooses per field. exists: the Provider already has a dive at the Dive\'s time and the send waits (fields is empty): '
        + '"<Provider> already has a dive at this time" with "Link to it" and "Create a new one"',
    }),
    remoteId: Type.String({ description: 'conflict: the remote dive the Conflict is about. exists: the dive at the Provider' }),
    fields: Type.Array(ConflictFieldView, { description: "`hub` is the Dive's value now, `provider` the Provider's as the run found it; a field whose two values became equal is left out. An entry with no field left is not listed (nor counted in the Connection's or a run's conflicts)" }),
    existing: Nullable(Type.Object({
      remoteId: Type.String(), remoteNumber: Nullable(Type.Integer()),
      startsAt: Type.String({ description: 'Local time as the Provider keeps it, "YYYY-MM-DD HH:MM"' }),
    }, { description: 'With kind exists: that dive at the Provider' })),
    foundAt: DateTime,
    queued: Type.Boolean({ description: 'conflict: the User chose and the Dive waits to be sent with the choices; the entry stays listed until the send settles. A Conflict found again after the choice is not queued' }),
  })),
});

const DecisionBody = Type.Object({
  onExisting: Type.Optional(Type.Enum(['link', 'create'], { description: 'link: tie the Dive to the dive at the Provider. create: a second dive' })),
  conflicts: Type.Optional(ConflictChoices),
}, { additionalProperties: false, minProperties: 1 });

export interface DecisionRouteDeps {
  providers: ProviderRegistry;
  goneDives: GoneDiveService;
  conflicts: ConflictService;
  waitingPushes: WaitingPushService;
}

export const decisionRoutes: FastifyPluginAsyncTypebox<DecisionRouteDeps> = async (app, { providers, goneDives, conflicts, waitingPushes }) => {
  app.get('/gone-dives', {
    schema: {
      summary: 'Dives whose remote dive is gone at a Provider and wait for the User\'s choice (ADR 0051), per Connection; no call to a Provider',
      description: 'Clients show them with two choices each, "Keep here" and "Delete here too", never a default, never "all". '
        + 'Both first confirm: POST /api/connections/{id}/gone-dives/confirm. "Delete here too" then deletes the one Dive with its own dialog.',
      response: { 200: Type.Array(GoneDivesView), ...errors },
    },
  }, async (request) => (await goneDives.waiting(userOf(request).id)).map((c) => ({
    ...c, dives: c.dives.map((d) => ({ ...d, startsAt: d.startsAt.toISOString(), foundAt: d.foundAt.toISOString() })),
  })));

  app.get('/provider-conflicts', {
    schema: {
      summary: 'What waits for the choice of the User ("Needs your decision"), per Connection; no call to a Provider',
      description: 'A Conflict (kind conflict) is a field changed on both sides, differently, found while sending or fetching a Dive. One entry per Dive and Provider, '
        + 'with both values of each field. The User chooses per field, the Dive Hub value preselected; the choice goes to POST /api/dives/{id}/providers/{provider}/decision '
        + 'with `conflicts` (or sends the Dive from its page with `conflicts`). A Dive the Provider already has a dive for (kind exists) waits for "Link to it" or '
        + '"Create a new one": the same route with `onExisting`. A choice queues the Dive, due now: an exists entry leaves the list, a conflict entry stays with queued true until the send settles. '
        + 'An entry whose Dive is deleted, or whose remote dive is no longer the current one of the Dive, is not listed.',
      response: { 200: Type.Array(ConflictsView), ...errors },
    },
  }, async (request) => (await conflicts.waiting(userOf(request).id)).map((c) => ({
    ...c, providerName: providers.get(c.provider).capabilities.name,
    entries: c.entries.map((e) => ({ ...e, startsAt: e.startsAt.toISOString(), foundAt: e.foundAt.toISOString() })),
  })));

  app.post('/connections/:id/gone-dives/check', {
    schema: {
      summary: 'Check the Provider\'s logbook for Dives that are gone there (ADR 0051): one fresh read, stores findings, changes no Dive',
      description: 'Works whatever the Connection\'s import mode is. One paced action at the Provider. An empty logbook is never a finding (empty true). '
        + 'The Connection\'s owner only (others: 404).',
      params: IdParams, response: { 200: GoneSummary, ...errors },
    },
  }, async (request) => goneDives.check(userOf(request).id, request.params.id));

  app.post('/connections/:id/gone-dives/confirm', {
    schema: {
      summary: 'Confirm findings with one more fresh read before the User\'s choice (ADR 0051): gone again, the Dive has no remote dive there from now on',
      description: 'Send the Dives the User chose. gone: a confirmed delete Push with remoteGone was recorded (the Dive stays here until deleted '
        + 'or kept). there: the dive is in the logbook after all; nothing was recorded, the finding is gone: tell the User. '
        + 'not_waiting: no such finding any more. unconfirmed: the logbook came back empty (empty true); nothing was recorded. '
        + 'Each Dive is under its lease: provider_busy while another action holds one. Never call it for Dives the User didn\'t choose.',
      params: IdParams,
      body: Type.Object({
        diveIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 50 }),
      }, { additionalProperties: false }),
      response: {
        200: Type.Object({
          empty: Type.Boolean(),
          results: Type.Array(Type.Object({ diveId: Type.String(), confirmation: Type.Enum(['gone', 'there', 'not_waiting', 'unconfirmed']) })),
        }),
        ...errors,
      },
    },
  }, async (request) => goneDives.confirm(userOf(request).id, request.params.id, request.body.diveIds));

  app.post('/dives/:id/providers/:provider/retry', {
    schema: {
      summary: 'Retry a Waiting push that is stopped or held: it waits again, due now (ADR 0056)',
      description: '404 dive_not_found for a Dive that is none of the User\'s Divers\' (also for one that does not exist), 404 waiting_push_not_found when '
        + 'the Dive has no entry for the Provider (an entry that waits already answers 204 and stays as it is), 404 connection_not_found when the entry is on another User\'s Connection '
        + '(sends go out as the Connection\'s User).',
      params: DiveProviderParams, response: { 204: Type.Null(), 404: Problem },
    },
  }, async (request, reply) => {
    await waitingPushes.retry(userOf(request).id, request.params.id, request.params.provider);
    return reply.code(204).send(null);
  });

  app.post('/dives/:id/providers/:provider/decision', {
    schema: {
      summary: 'The User\'s decision for a Dive at a Provider: it is queued as a send, due now, with this choice (ADR 0056)',
      description: 'From "Needs your decision", by the entry\'s kind. `exists` (the Provider already has a dive at the Dive\'s time): `onExisting` '
        + 'link ties the Dive to that dive and updates it, create makes a second dive there. `conflict` (a field changed on both sides): '
        + '`conflicts` per field, hub sends the Dive\'s value over the Provider\'s, provider takes the Provider\'s value into the Dive here (a '
        + 'Revision of the User\'s) and leaves that field as it is there; the other fields go out as usual. It sends nothing at once: the worker sends, one Dive after another, paced for the Provider '
        + '(the Dive\'s page keeps POST /api/dives/{id}/providers/{provider}, which sends at once). At least one property; 404 dive_not_found, '
        + '404 connection_not_found as for Retry.',
      params: DiveProviderParams, body: DecisionBody, response: { 204: Type.Null(), 400: Problem, 404: Problem },
    },
  }, async (request, reply) => {
    const { onExisting, conflicts: choices } = request.body;
    await waitingPushes.decide(userOf(request).id, request.params.id, request.params.provider, {
      ...(onExisting && { onExisting }), ...(choices && { conflicts: choices }),
    });
    return reply.code(204).send(null);
  });
};
