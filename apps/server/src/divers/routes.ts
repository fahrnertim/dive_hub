// Divers (ADR 0016, 0028): the User's Divers and their Devices; every Diver found by name; external Divers; a Diver's
// accounts at services.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireUser } from '../auth/fastify.js';
import { Problem, problem } from '../http/problems.js';
import { NO_CERTIFICATIONS, type CertificationService } from '../certifications/certification-service.js';
import { DiverError, type DiverActor, type DiverService } from './diver-service.js';

export interface DiverRouteDeps {
  auth: Auth;
  divers: DiverService;
  /** Releases the card pictures of a deleted Diver (ADR 0050). */
  certifications: CertificationService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const Name = Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);
const DiverSource = Type.Enum(['ssi', 'padi'], { description: 'A service a person has an account at' });

const DateParam = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' });
const BodyWeightView = Type.Object({ date: Type.String({ description: 'YYYY-MM-DD' }), kg: Type.Number() });

const CertificationSummary = Type.Object({
  count: Type.Integer(),
  newest: Nullable(Type.Object({ agency: Type.String(), level: Type.String() })),
  expired: Type.Integer({ description: 'Cards whose expiry date has passed' }),
  expiringSoon: Type.Integer({ description: 'Cards expiring within 90 days (not yet expired)' }),
}, { description: 'What the Divers list shows of a Diver\'s certification cards (ADR 0050); the cards are GET /divers/{id}/certifications' });

const DiverView = Type.Object({
  id: Type.String(), name: Type.String(),
  isOwn: Type.Boolean({ description: 'The User\'s own Diver' }),
  divesBefore: Type.Integer({ description: 'The dives made before the first one in this logbook (ADR 0048): the first Dive here gets the next number' }),
  apneaCounts: Type.Boolean({ description: 'Whether apnea sessions count in the Dive numbers (ADR 0048)' }),
  diveCount: Type.Integer(), deviceCount: Type.Integer(),
  mutedRules: Type.Array(Type.String(), {
    description: 'Rules of the dive assessment not shown for this Diver (ADR 0036); show them again with PUT /divers/{id}/muted-rules/{rule}',
  }),
  certifications: CertificationSummary,
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
  invalid_input: 400, body_weight_not_found: 404,
};
const errors = { 400: Problem, 403: Problem, 404: Problem, 409: Problem };

const actorOf = (request: FastifyRequest): DiverActor => ({ userId: request.user!.id, isAdmin: request.user!.role === 'admin' });

export const diverRoutes: FastifyPluginAsyncTypebox<DiverRouteDeps> = async (app, { auth, divers, certifications }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DiverError) {
      return reply.code(STATUS[error.code]).send({ ...problem(error.code), ...(error.diver && { diver: error.diver }) });
    }
    throw error;
  });

  const listDivers = async (userId: string) => {
    const rows = await divers.list(userId);
    const summaries = await certifications.summaries(rows.map((d) => d.id));
    return rows.map((d) => ({ ...d, certifications: summaries.get(d.id) ?? NO_CERTIFICATIONS }));
  };

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
    return reply.code(201).send({ id: created.id, name: created.name, isOwn: false, divesBefore: 0, apneaCounts: true, diveCount: 0, deviceCount: 0, mutedRules: [], certifications: NO_CERTIFICATIONS });
  });

  app.patch('/divers/:id', {
    schema: {
      summary: 'Rename a Diver whose logbook the User keeps, or change its Dive number settings',
      description: "ADR 0048: `divesBefore` (0 to 100 000) and `apneaCounts` change the numbers of the Diver's Dives, which are numbered again. At least one field.",
      params: IdParams,
      body: Type.Object({
        name: Type.Optional(Name),
        divesBefore: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
        apneaCounts: Type.Optional(Type.Boolean()),
      }, { additionalProperties: false, minProperties: 1 }),
      response: { 200: DiverView, ...errors },
    },
  }, async (request) => {
    const { name, ...settings } = request.body;
    await divers.update(request.user!.id, request.params.id, { ...settings, ...(name !== undefined && { name: name.trim() }) });
    return (await listDivers(request.user!.id)).find((d) => d.id === request.params.id)!;
  });

  app.delete('/divers/:id', {
    schema: { summary: 'Delete a Diver without Dives or Devices who is on no Dive', params: IdParams, response: { 204: Type.Null(), ...errors } },
  }, async (request, reply) => {
    const pictures = await certifications.imageKeysOf(request.params.id);
    await divers.remove(request.user!.id, request.params.id);
    await certifications.releaseKeys(pictures);
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

  app.get('/divers/:id/body-weights', {
    schema: {
      summary: 'A Diver\'s body weights, newest first (only the Users who keep the Diver; others get 404 diver_not_found)',
      description: 'ADR 0031: the first health-like data on a Diver. Always kilograms; clients show lb for imperial (ADR 0014). Never part of another view.',
      params: IdParams, response: { 200: Type.Array(BodyWeightView), ...errors },
    },
  }, async (request) => divers.bodyWeights(request.user!.id, request.params.id));

  app.put('/divers/:id/body-weights/:date', {
    schema: {
      summary: 'Set the Diver\'s body weight on a date, replacing the one there',
      description: '400 for a weight outside 20 to 400 kg or a date that does not exist.',
      params: Type.Object({ id: Type.String({ format: 'uuid' }), date: DateParam }),
      body: Type.Object({ kg: Type.Number({ minimum: 20, maximum: 400 }) }, { additionalProperties: false }),
      response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await divers.setBodyWeight(request.user!.id, request.params.id, request.params.date, request.body.kg);
    return reply.code(204).send(null);
  });

  app.delete('/divers/:id/body-weights/:date', {
    schema: {
      summary: 'Remove the Diver\'s body weight on a date (404 body_weight_not_found when there is none)',
      params: Type.Object({ id: Type.String({ format: 'uuid' }), date: DateParam }), response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await divers.removeBodyWeight(request.user!.id, request.params.id, request.params.date);
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
