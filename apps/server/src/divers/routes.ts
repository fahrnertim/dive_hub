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

const STATUS: Record<DiverError['code'], number> = {
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
    return reply.code(201).send({ id: created.id, name: created.name, isOwn: false, diveCount: 0, deviceCount: 0 });
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
