// Dive centres and their SSI verification codes (ADR 0043).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import { Problem, problem } from '../http/problems.js';
import { CENTRE_SOURCE_NAME, CENTRE_SOURCES, CentreError, type CentreActor, type CentreService } from './centre-service.js';

export interface CentreRouteDeps {
  auth: Auth;
  centres: CentreService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);
const Name = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S', description: 'As the centre spells it; for an SSI code, exactly as SSI does' });
const Source = Type.Enum([...CENTRE_SOURCES]);
const TypedId = Type.String({ minLength: 1, maxLength: 300, description: 'As the User typed or pasted it: the bare number, or the centre\'s whole code' });

export const VerificationCodeView = Type.Object({
  provider: Source,
  text: Type.String({ description: 'Draw this text, unchanged, as a QR code; never build or parse it (docs/spec/clients.md)' }),
}, { description: 'The code a diver scans in the Provider\'s app so that it shows a dive as verified (ADR 0043). Not a secret' });

const CentreView = Type.Object({
  id: Type.String(),
  name: Type.String({ description: 'The whole name, as its Source spells it (SSI: with the town). This is what is edited, and what the code holds' }),
  displayName: Type.String({ description: 'The name to show: the whole name shortened by the rule of the Source the centre has an ID at (SSI: without the town)' }),
  externalIds: Type.Array(Type.Object({
    source: Source,
    name: Type.String({ description: 'The Source\'s name, e.g. "SSI"' }),
    externalId: Type.String({ description: 'e.g. the SSI centre number' }),
  })),
  sites: Type.Array(Type.Object({ id: Type.String(), name: Type.String() }), { description: 'The Dive sites the centre is responsible for, by name' }),
  verificationCode: Nullable(VerificationCodeView),
  version: Type.Integer({ description: 'Send it back with a rename; it changes with every rename' }),
  canDelete: Type.Boolean({ description: 'Whether the signed-in User may delete it: its creator or an admin' }),
});

const ListQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 100, description: 'Words from the name' })),
  siteId: Type.Optional(Type.String({ format: 'uuid', description: 'Only the centres of this Dive site' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

const CreateBody = Type.Object({
  name: Name,
  externalIds: Type.Optional(Type.Array(Type.Object({ source: Source, externalId: TypedId }, { additionalProperties: false }), { maxItems: CENTRE_SOURCES.length })),
  siteIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 200, description: 'Dive sites the centre is responsible for' })),
}, { additionalProperties: false });

/** A refusal; with `centre_external_id_taken`, the centre that has the number, to open it instead. */
const CentreProblem = Type.Object({
  ...Problem.properties,
  centre: Type.Optional(Type.Object({ id: Type.String(), name: Type.String() }, { description: 'The Dive centre that already has the number' })),
});

const Person = {
  accountId: Type.String(), firstName: Type.String(), lastName: Type.String(), email: Type.String(),
};
const ReadCode = Type.Union([
  Type.Object({
    kind: Type.Literal('centre'), centreNumber: Type.String(), name: Type.String({ description: 'As the code spells it' }),
    existing: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, { description: 'The Dive centre here that already has this number' })),
  }),
  Type.Object({ kind: Type.Literal('buddy'), ...Person }),
  Type.Object({ kind: Type.Literal('professional'), ...Person, leaderNumber: Type.String() }),
]);

type Row = Awaited<ReturnType<CentreService['get']>>;
const toView = ({ centre: c, externalIds, sites, canDelete, displayName, verificationCode }: Row): Static<typeof CentreView> => ({
  id: c.id, name: c.name, displayName,
  externalIds: externalIds.map((e) => ({ source: e.source, name: CENTRE_SOURCE_NAME[e.source], externalId: e.externalId })),
  sites, verificationCode, version: c.version, canDelete,
});

const STATUS: Record<CentreError['code'], number> = {
  centre_not_found: 404, centre_changed: 409, centre_not_deletable: 403, centre_external_id_taken: 409, site_not_found: 404, invalid_input: 400,
};
const errors = { 400: CentreProblem, 403: CentreProblem, 404: CentreProblem, 409: CentreProblem };

const actorOf = (request: FastifyRequest): CentreActor => ({ userId: request.user!.id, isAdmin: request.user!.role === 'admin' });

export const centreRoutes: FastifyPluginAsyncTypebox<CentreRouteDeps> = async (app, { auth, centres }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CentreError) {
      return reply.code(STATUS[error.code]).send({ ...problem(error.code), ...(error.centre && { centre: error.centre }) });
    }
    throw error;
  });

  app.get('/dive-centres', {
    schema: {
      summary: 'One page of the instance\'s Dive centres by name, with how many match',
      querystring: ListQuery,
      response: { 200: Type.Object({ centres: Type.Array(CentreView), total: Type.Integer({ description: 'Centres matching, on all pages' }) }), 400: Problem },
    },
  }, async (request) => {
    const page = await centres.list(actorOf(request), request.query);
    return { centres: page.centres.map(toView), total: page.total };
  });

  app.get('/dive-centres/:id', {
    schema: { summary: 'One Dive centre', params: IdParams, response: { 200: CentreView, 404: Problem } },
  }, async (request) => toView(await centres.get(actorOf(request), request.params.id)));

  app.post('/dive-centres', {
    schema: {
      summary: 'Create a Dive centre; every User of the instance sees it',
      description: 'With its numbers and Dive sites in one step, or not at all. 409 centre_external_id_taken names the centre that has the number.',
      body: CreateBody, response: { 201: CentreView, ...errors },
    },
  }, async (request, reply) => {
    const { name, externalIds, siteIds } = request.body;
    const id = await centres.create(actorOf(request), { name: name.trim(), externalIds, siteIds });
    return reply.code(201).send(toView(await centres.get(actorOf(request), id)));
  });

  app.patch('/dive-centres/:id', {
    schema: {
      summary: 'Rename a Dive centre (any User)',
      description: 'Send the version you started from; if the centre was renamed meanwhile the answer is 409 centre_changed.',
      params: IdParams, body: Type.Object({ version: Type.Integer(), name: Name }, { additionalProperties: false }),
      response: { 200: CentreView, ...errors },
    },
  }, async (request) => {
    await centres.rename(actorOf(request), request.params.id, request.body.version, request.body.name.trim());
    return toView(await centres.get(actorOf(request), request.params.id));
  });

  app.put('/dive-centres/:id/external-ids/:source', {
    schema: {
      summary: 'Set or clear the Dive centre\'s External ID at a Source (SSI: its centre number; any User)',
      description: 'Takes the bare number or the centre\'s whole code, of which only the number is used. 409 centre_external_id_taken '
        + 'names the centre that has it. The centre\'s version stays, as for a Dive site (ADR 0029).',
      params: Type.Object({ id: Type.String({ format: 'uuid' }), source: Source }),
      body: Type.Object({ externalId: Nullable(TypedId) }, { additionalProperties: false }),
      response: { 200: CentreView, ...errors },
    },
  }, async (request) => {
    await centres.setExternalId(actorOf(request), request.params.id, request.params.source, request.body.externalId);
    return toView(await centres.get(actorOf(request), request.params.id));
  });

  const SiteParams = Type.Object({ id: Type.String({ format: 'uuid' }), siteId: Type.String({ format: 'uuid' }) });

  app.put('/dive-centres/:id/sites/:siteId', {
    schema: {
      summary: 'Say the Dive centre is responsible for a Dive site (any User); asking again changes nothing',
      description: 'Every Dive at the site then shows the centre\'s verification code (ADR 0043).',
      params: SiteParams, response: { 200: CentreView, ...errors },
    },
  }, async (request) => {
    await centres.setSite(actorOf(request), request.params.id, request.params.siteId, true);
    return toView(await centres.get(actorOf(request), request.params.id));
  });

  app.delete('/dive-centres/:id/sites/:siteId', {
    schema: {
      summary: 'Say the Dive centre is no longer responsible for a Dive site (any User); asking again changes nothing',
      params: SiteParams, response: { 200: CentreView, ...errors },
    },
  }, async (request) => {
    await centres.setSite(actorOf(request), request.params.id, request.params.siteId, false);
    return toView(await centres.get(actorOf(request), request.params.id));
  });

  app.delete('/dive-centres/:id', {
    schema: {
      summary: 'Delete a Dive centre: its creator or an admin',
      description: 'Its links to Dive sites and its numbers go with it; Dive sites and Dives are untouched.',
      params: IdParams, response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await centres.remove(actorOf(request), request.params.id);
    return reply.code(204).send(null);
  });

  app.post('/verification-codes/read', {
    schema: {
      summary: 'Read a verification code\'s text, pasted or scanned: what it is and its fields',
      description: 'A centre\'s code gives number and name to create a Dive centre from, and the centre here that already has the number. '
        + 'A buddy\'s or a professional\'s is only told apart for now. Nothing of the text is kept. 400 code_not_recognised for any other text (ADR 0043).',
      body: Type.Object({ text: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
      response: { 200: ReadCode, 400: Problem },
    },
  }, async (request, reply) => {
    const read = await centres.readCode(request.body.text);
    return read ?? reply.code(400).send(problem('code_not_recognised'));
  });
};
