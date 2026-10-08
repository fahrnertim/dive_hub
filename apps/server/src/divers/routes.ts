// Divers (ADR 0016, 0028): the User's Divers and their Devices; every Diver found by name; external Divers; a Diver's
// accounts at services.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireUser } from '../auth/fastify.js';
import { Problem, problem } from '../http/problems.js';
import { DiverError, type DiverActor, type DiverService } from './diver-service.js';

export interface DiverRouteDeps {
  auth: Auth;
  divers: DiverService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const Name = Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);
const DiverSource = Type.Enum(['ssi', 'padi'], { description: 'A service a person has an account at' });

const DiverView = Type.Object({
  id: Type.String(), name: Type.String(),
  isOwn: Type.Boolean({ description: 'The User\'s own Diver' }),
  diveCount: Type.Integer(), deviceCount: Type.Integer(),
  mutedRules: Type.Array(Type.String(), {
    description: 'Rules of the dive assessment not shown for this Diver (ADR 0036); show them again with PUT /divers/{id}/muted-rules/{rule}',
  }),
});

const FoundDiver = Type.Object({
  id: Type.String(),
  name: Type.String(),
  managed: Type.Boolean({ description: 'The signed-in User keeps this Diver\'s logbook' }),
  external: Type.Boolean({ description: 'No User keeps its logbook: someone Users dived with (ADR 0028)' }),
}, { description: 'A Diver of the instance as every User sees it: by name, nothing else' });

const ExternalDiverView = Type.Object({
  id: Type.String(),
  name: Type.String(),
  accounts: Type.Array(DiverSource, { description: 'Services this person has an account at here (the account itself isn\'t shown)' }),
  inUse: Type.Boolean({ description: 'A Dive (of any User) lists this Diver; then it can\'t be deleted' }),
  canDelete: Type.Boolean({ description: 'Whether the signed-in User may delete it: whoever added it, or an admin' }),
});

const DeviceView = Type.Object({
  id: Type.String(), manufacturer: Type.String(), product: Nullable(Type.String()), serialNumber: Type.String(),
  firmware: Nullable(Type.String()), diverId: Type.String(),
  recordingCount: Type.Integer(), lastUsedAt: Nullable(Type.String({ format: 'date-time' })),
});

/** A refusal; with `diver_external_id_taken`, the Diver that has the account, to offer it instead. */
const DiverProblem = Type.Object({
  ...Problem.properties,
  diver: Type.Optional(Type.Object({ id: Type.String(), name: Type.String() }, { description: 'The Diver that already has the account' })),
});

const CodePart = (description: string, maxLength: number) => Nullable(Type.String({ maxLength, description }));
const DetailsBody = Type.Object({
  firstName: Type.Optional(CodePart('As SSI spells it; one line without a semicolon', 100)),
  lastName: Type.Optional(CodePart('As SSI spells it; one line without a semicolon', 100)),
  email: Type.Optional(CodePart('The address the person\'s SSI account has. Every User sees it, inside the code', 254)),
  leaderNumber: Type.Optional(CodePart('The person\'s SSI leader number: what makes them a professional whose code verifies a dive', 20)),
}, { additionalProperties: false, description: 'Only the fields sent change; null or an empty text clears one' });

const DiverDetailsView = Type.Object({
  id: Type.String(),
  name: Type.String(),
  external: Type.Boolean({ description: 'No User keeps its logbook' }),
  canEdit: Type.Boolean({ description: 'Whether the signed-in User may change the details: an external Diver, or one whose logbook they keep' }),
  firstName: Nullable(Type.String()), lastName: Nullable(Type.String()),
  email: Nullable(Type.String({ description: 'Personal data every User of the instance sees (ADR 0043)' })),
  leaderNumber: Nullable(Type.String()),
  accounts: Type.Array(Type.Object({ source: DiverSource, externalId: Type.String({ description: 'e.g. the SSI account, as the code holds it' }) })),
  codes: Type.Array(Type.Object({
    kind: Type.Enum(['buddy', 'professional'], {
      description: 'buddy: another diver scans it in the Provider\'s app to add the person to their buddy list. professional: a diver scans it on a logbook entry to verify the dive',
    }),
    provider: Type.Enum(['ssi']),
    text: Type.String({ description: 'Draw this text, unchanged, as a QR code; never build or parse it (docs/spec/clients.md)' }),
  }), { description: 'Empty while the account, a name or the e-mail is missing; the professional\'s only with a leader number' }),
}, { description: 'What a Diver\'s SSI buddy code says about the person, and the codes built from it. Seen by every User (ADR 0043, amending ADR 0028)' });

const STATUS: Record<DiverError['code'], number> = {
  diver_choice_needed: 409, diver_has_other_account: 409, code_not_recognised: 400, code_not_a_person: 400,
  diver_not_found: 404, own_diver: 409, diver_not_empty: 409, device_not_found: 404, diver_in_use: 409,
  diver_not_deletable: 403, diver_not_editable: 403, diver_external_id_taken: 409, diver_external_id_connected: 409, diver_not_external: 409,
  invalid_input: 400,
};
const errors = { 400: Problem, 403: Problem, 404: Problem, 409: Problem };

const actorOf = (request: FastifyRequest): DiverActor => ({ userId: request.user!.id, isAdmin: request.user!.role === 'admin' });

export const diverRoutes: FastifyPluginAsyncTypebox<DiverRouteDeps> = async (app, { auth, divers }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DiverError) {
      return reply.code(STATUS[error.code]).send({ ...problem(error.code), ...(error.diver && { diver: error.diver }) });
    }
    throw error;
  });

  const listDivers = async (userId: string) => divers.list(userId);

  app.get('/divers', {
    schema: { summary: 'The Divers whose logbooks the User keeps, own first', response: { 200: Type.Array(DiverView) } },
  }, async (request) => listDivers(request.user!.id));

  app.get('/divers/search', {
    schema: {
      summary: 'Every Diver of the instance whose name matches, the User\'s own first: to put on a Dive (ADR 0028)',
      description: 'Every User sees every Diver by name, and nothing else of Divers they don\'t keep.',
      querystring: Type.Object({
        q: Type.Optional(Type.String({ maxLength: 100, description: 'Part of the name' })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
      }),
      response: { 200: Type.Object({ divers: Type.Array(FoundDiver) }) },
    },
  }, async (request) => ({ divers: await divers.search(request.user!.id, request.query.q, request.query.limit ?? 20) }));

  app.post('/divers', {
    schema: { summary: 'Start keeping another Diver\'s logbook (e.g. a child\'s)', body: Type.Object({ name: Name }), response: { 201: DiverView, ...errors } },
  }, async (request, reply) => {
    const created = await divers.create(request.user!.id, request.body.name.trim());
    return reply.code(201).send({ id: created.id, name: created.name, isOwn: false, diveCount: 0, deviceCount: 0, mutedRules: [] });
  });

  app.patch('/divers/:id', {
    schema: { summary: 'Rename a Diver whose logbook the User keeps', params: IdParams, body: Type.Object({ name: Name }), response: { 200: DiverView, ...errors } },
  }, async (request) => {
    await divers.rename(request.user!.id, request.params.id, request.body.name.trim());
    return (await listDivers(request.user!.id)).find((d) => d.id === request.params.id)!;
  });

  app.delete('/divers/:id', {
    schema: { summary: 'Delete a Diver without Dives or Devices who is on no Dive', params: IdParams, response: { 204: Type.Null(), ...errors } },
  }, async (request, reply) => {
    await divers.remove(request.user!.id, request.params.id);
    return reply.code(204).send(null);
  });

  app.put('/divers/:id/external-ids/:source', {
    schema: {
      summary: 'Set or clear a Diver\'s account at a service (an external Diver\'s: any User; one with a logbook: its Users)',
      description: 'Providers tell who a Participant is by it (ADR 0029; SSI: the user master ID, as the buddy list shows it). '
        + '409 diver_external_id_taken names the Diver that has it; 409 diver_external_id_connected while a Connection uses it.',
      params: Type.Object({ id: Type.String({ format: 'uuid' }), source: DiverSource }),
      body: Type.Object({ externalId: Nullable(Type.String({ minLength: 1, maxLength: 40 })) }, { additionalProperties: false }),
      response: { 204: Type.Null(), 400: DiverProblem, 403: DiverProblem, 404: DiverProblem, 409: DiverProblem },
    },
  }, async (request, reply) => {
    await divers.setExternalId(actorOf(request), request.params.id, request.params.source, request.body.externalId?.trim() ?? null);
    return reply.code(204).send(null);
  });

  app.get('/divers/:id/details', {
    schema: {
      summary: 'A Diver\'s details (first and last name, e-mail, leader number), accounts and the codes built from them, as every User sees them',
      description: 'ADR 0043: any Diver of the instance, also one whose logbook another User keeps. Nothing else of that Diver is shown.',
      params: IdParams, response: { 200: DiverDetailsView, ...errors },
    },
  }, async (request) => divers.details(actorOf(request), request.params.id));

  app.patch('/divers/:id/details', {
    schema: {
      summary: 'Set a Diver\'s details (an external Diver\'s: any User; one with a logbook: its Users)',
      description: '400 invalid_input for a value that couldn\'t stand in a code (a semicolon, a line break, no e-mail address). '
        + 'The account is set by PUT /api/divers/{id}/external-ids/{source}.',
      params: IdParams, body: DetailsBody, response: { 200: DiverDetailsView, ...errors },
    },
  }, async (request) => divers.setDetails(actorOf(request), request.params.id, request.body));

  app.post('/divers/from-code', {
    schema: {
      summary: 'Take a buddy\'s or a professional\'s code: the Diver that has its SSI account gets what the code says',
      description: 'Read the text first (POST /api/verification-codes/read) and show what it answers. The Diver that has the account is filled, '
        + 'whatever diverId says otherwise (409 diver_external_id_taken names it). When no Diver has it: diverId gives account and details to that '
        + 'Diver (409 diver_has_other_account when it has another SSI account), create makes a new external Diver named after the code (201), '
        + 'neither is 409 diver_choice_needed. A buddy code leaves a leader number that is there. 400 code_not_a_person for a centre\'s code.',
      body: Type.Object({
        text: Type.String({ minLength: 1, maxLength: 1000, description: 'The code\'s text as scanned or pasted, unchanged' }),
        diverId: Type.Optional(Type.String({ format: 'uuid', description: 'The Diver the User chose for a code whose account no Diver has' })),
        create: Type.Optional(Type.Boolean({ description: 'Make a new external Diver when no Diver has the account' })),
      }, { additionalProperties: false }),
      response: { 200: DiverDetailsView, 201: DiverDetailsView, 400: DiverProblem, 403: DiverProblem, 404: DiverProblem, 409: DiverProblem },
    },
  }, async (request, reply) => {
    const { text, diverId, create } = request.body;
    const taken = await divers.takeCode(actorOf(request), text, { diverId, create });
    return reply.code(taken.created ? 201 : 200).send(taken.diver);
  });

  app.get('/external-divers', {
    schema: {
      summary: 'One page of external Divers (people Users dived with, no logbook here) whose name matches, and how many match',
      querystring: Type.Object({
        q: Type.Optional(Type.String({ maxLength: 100 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
      }),
      response: { 200: Type.Object({ divers: Type.Array(ExternalDiverView), total: Type.Integer() }) },
    },
  }, async (request) => divers.externals(actorOf(request), { q: request.query.q, limit: request.query.limit ?? 50, offset: request.query.offset ?? 0 }));

  app.post('/external-divers', {
    schema: {
      summary: 'Add someone Users dived with; every User sees their name (ADR 0028)',
      body: Type.Object({ name: Name }, { additionalProperties: false }),
      response: { 201: ExternalDiverView, ...errors },
    },
  }, async (request, reply) => {
    const id = await divers.createExternal(actorOf(request), request.body.name.trim());
    return reply.code(201).send(await divers.external(actorOf(request), id));
  });

  app.patch('/external-divers/:id', {
    schema: {
      summary: 'Rename an external Diver (any User)', params: IdParams,
      body: Type.Object({ name: Name }, { additionalProperties: false }), response: { 200: ExternalDiverView, ...errors },
    },
  }, async (request) => {
    await divers.renameExternal(actorOf(request), request.params.id, request.body.name.trim());
    return divers.external(actorOf(request), request.params.id);
  });

  app.delete('/external-divers/:id', {
    schema: {
      summary: 'Delete an external Diver: whoever added it, or an admin, while no Dive lists it',
      params: IdParams, response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await divers.removeExternal(actorOf(request), request.params.id);
    return reply.code(204).send(null);
  });

  app.post('/admin/divers/:id/merge', {
    onRequest: requireAdmin,
    schema: {
      summary: 'Admins: merge an external Diver into another Diver, the same person (ADR 0028): its places on Dives and its accounts move',
      description: 'Only an external Diver (no User keeps it) is merged away (diver_not_external); into any Diver. When both have an '
        + 'account at the same service and they differ: diver_external_id_taken. The external Diver is deleted, kept with merged_into.',
      params: IdParams,
      body: Type.Object({ into: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
      response: { 200: Type.Object({ dives: Type.Integer({ description: 'The Dives it was a Participant on' }) }), ...errors },
    },
  }, async (request) => divers.mergeExternal(actorOf(request), request.params.id, request.body.into));

  app.get('/devices', {
    schema: { summary: 'Devices of the User\'s Divers', response: { 200: Type.Array(DeviceView) } },
  }, async (request) => (await divers.devices(request.user!.id)).map((d) => ({
    ...d, lastUsedAt: d.lastUsedAt ? new Date(d.lastUsedAt).toISOString() : null,
  })));

  app.patch('/devices/:id', {
    schema: {
      summary: 'Assign a Device to another Diver; Imports from now on go there, past Dives stay',
      params: IdParams, body: Type.Object({ diverId: Type.String({ format: 'uuid' }) }), response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await divers.assignDevice(request.user!.id, request.params.id, request.body.diverId);
    return reply.code(204).send(null);
  });
};
