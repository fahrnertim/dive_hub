// The User's Divers and their Devices (ADR 0016).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import { Problem, problem } from '../http/problems.js';
import { DiverError, type DiverService } from './diver-service.js';

export interface DiverRouteDeps {
  auth: Auth;
  divers: DiverService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const Name = Type.String({ minLength: 1, maxLength: 100 });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);

const DiverView = Type.Object({
  id: Type.String(), name: Type.String(),
  isOwn: Type.Boolean({ description: 'The User\'s own Diver' }),
  diveCount: Type.Integer(), deviceCount: Type.Integer(),
});

const DeviceView = Type.Object({
  id: Type.String(), manufacturer: Type.String(), product: Nullable(Type.String()), serialNumber: Type.String(),
  firmware: Nullable(Type.String()), diverId: Type.String(),
  recordingCount: Type.Integer(), lastUsedAt: Nullable(Type.String({ format: 'date-time' })),
});

const STATUS: Record<DiverError['code'], number> = { diver_not_found: 404, own_diver: 409, diver_not_empty: 409, device_not_found: 404 };
const errors = { 400: Problem, 404: Problem, 409: Problem };

export const diverRoutes: FastifyPluginAsyncTypebox<DiverRouteDeps> = async (app, { auth, divers }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DiverError) return reply.code(STATUS[error.code]).send(problem(error.code));
    throw error;
  });

  const listDivers = async (userId: string) => divers.list(userId);

  app.get('/divers', {
    schema: { summary: 'The Divers whose logbooks the User keeps, own first', response: { 200: Type.Array(DiverView) } },
  }, async (request) => listDivers(request.user!.id));

  app.post('/divers', {
    schema: { summary: 'Start keeping another Diver\'s logbook (e.g. a child\'s)', body: Type.Object({ name: Name }), response: { 201: DiverView, ...errors } },
  }, async (request, reply) => {
    const created = await divers.create(request.user!.id, request.body.name);
    return reply.code(201).send({ id: created.id, name: created.name, isOwn: false, diveCount: 0, deviceCount: 0 });
  });

  app.patch('/divers/:id', {
    schema: { summary: 'Rename a Diver', params: IdParams, body: Type.Object({ name: Name }), response: { 200: DiverView, ...errors } },
  }, async (request) => {
    await divers.rename(request.user!.id, request.params.id, request.body.name);
    return (await listDivers(request.user!.id)).find((d) => d.id === request.params.id)!;
  });

  app.delete('/divers/:id', {
    schema: { summary: 'Delete a Diver without Dives or Devices', params: IdParams, response: { 204: Type.Null(), ...errors } },
  }, async (request, reply) => {
    await divers.remove(request.user!.id, request.params.id);
    return reply.code(204).send(null);
  });

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
