// Duplicate candidates: what waits for the User's decision, and the decisions (ADR 0016).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import { Problem, problem } from '../http/problems.js';
import { CandidateError, type Candidates } from './candidates.js';

export interface CandidateRouteDeps {
  auth: Auth;
  candidates: Candidates;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const DateTime = Type.String({ format: 'date-time' });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);

const DiveBrief = Type.Object({
  id: Type.String(),
  number: Nullable(Type.Integer()),
  startsAt: DateTime,
  utcOffsetSeconds: Nullable(Type.Integer()),
  durationSeconds: Type.Number(),
  maxDepthM: Nullable(Type.Number()),
});

const CandidateView = Type.Object({
  id: Type.String(),
  reason: Type.Enum(['overlaps_several_dives', 'max_depth_differs']),
  status: Type.Enum(['open', 'discarded']),
  createdAt: DateTime,
  recording: Type.Object({
    id: Type.String(),
    startsAt: DateTime,
    utcOffsetSeconds: Nullable(Type.Integer()),
    durationSeconds: Type.Number(),
    maxDepthM: Nullable(Type.Number()),
    device: Nullable(Type.Object({ manufacturer: Type.String(), product: Nullable(Type.String()), serialNumber: Type.String() })),
  }),
  dives: Type.Array(DiveBrief, { description: 'The Dives it might belong to (only those the User may see)' }),
});

const Decided = Type.Object({ diveId: Nullable(Type.String({ description: 'The Dive the Recording now belongs to' })) });

const STATUS: Record<CandidateError['code'], number> = {
  candidate_not_found: 404, candidate_resolved: 409, not_a_candidate: 400, dive_not_found: 404,
};

export const candidateRoutes: FastifyPluginAsyncTypebox<CandidateRouteDeps> = async (app, { auth, candidates }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CandidateError) return reply.code(STATUS[error.code]).send(problem(error.code));
    throw error;
  });

  app.get('/duplicate-candidates', {
    schema: {
      summary: 'Recordings from the User\'s Imports that wait for a decision (or were discarded)',
      querystring: Type.Object({ status: Type.Optional(Type.Enum(['open', 'discarded'], { default: 'open' })) }),
      response: { 200: Type.Array(CandidateView) },
    },
  }, async (request) => {
    const status = request.query.status ?? 'open';
    return (await candidates.list(request.user!.id, status)).map(({ candidate: c, recording: r, device: d, dives }) => ({
      id: c.id,
      reason: c.reason as 'overlaps_several_dives' | 'max_depth_differs',
      status,
      createdAt: c.createdAt.toISOString(),
      recording: {
        id: r.id, startsAt: r.startsAt.toISOString(), utcOffsetSeconds: r.utcOffsetSeconds,
        durationSeconds: r.durationSeconds, maxDepthM: r.maxDepthM,
        device: d ? { manufacturer: d.manufacturer, product: d.product, serialNumber: d.serialNumber } : null,
      },
      dives: dives.map((v) => ({
        id: v.id, number: v.number, startsAt: v.startsAt.toISOString(), utcOffsetSeconds: v.utcOffsetSeconds,
        durationSeconds: v.durationSeconds, maxDepthM: v.maxDepthM,
      })),
    }));
  });

  const decision = { params: IdParams, response: { 200: Decided, 400: Problem, 404: Problem, 409: Problem } };

  app.post('/duplicate-candidates/:id/attach', {
    schema: { summary: 'Add the Recording to one of the candidate Dives', ...decision, body: Type.Object({ diveId: Type.String({ format: 'uuid' }) }) },
  }, async (request) => ({ diveId: await candidates.attach(request.user!.id, request.params.id, request.body.diveId) }));

  app.post('/duplicate-candidates/:id/new-dive', {
    schema: { summary: 'Make the Recording a Dive of its own', ...decision },
  }, async (request) => ({ diveId: await candidates.newDive(request.user!.id, request.params.id) }));

  app.post('/duplicate-candidates/:id/discard', {
    schema: { summary: 'Put the Recording aside; it stays, detached, and can be reopened', ...decision },
  }, async (request) => {
    await candidates.discard(request.user!.id, request.params.id);
    return { diveId: null };
  });

  app.post('/duplicate-candidates/:id/reopen', {
    schema: { summary: 'Decide about a discarded Recording again', ...decision },
  }, async (request) => {
    await candidates.reopen(request.user!.id, request.params.id);
    return { diveId: null };
  });
};
