// A Diver's certification cards (ADR 0050). Only the Users who manage the Diver; everyone else, and every call for an
// external Diver, gets 404 diver_not_found. The import from a Provider is in providers/account-routes.ts.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser, userOf } from '../auth/fastify.js';
import { CertificationView, Day } from './certification-view.js';
import { answerErrors, Problem } from '../http/problems.js';
import { replyCertificationError } from './certification-answers.js';
import type { CertificationService } from './certification-service.js';
import { IdParams, Nullable } from '../http/schemas.js';

export interface CertificationRouteDeps {
  auth: Auth;
  certifications: CertificationService;
}

const CardParams = Type.Object({ id: Type.String({ format: 'uuid' }), certificationId: Type.String({ format: 'uuid' }) });
const Text = (max: number) => Type.String({ maxLength: max });

const Fields = {
  agency: Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }),
  level: Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' }),
  number: Type.Optional(Nullable(Text(60))),
  issuedOn: Type.Optional(Nullable(Day)),
  expiresOn: Type.Optional(Nullable(Day)),
  divesAtIssue: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 100_000 }))),
  instructorName: Type.Optional(Nullable(Text(200))),
  instructorNumber: Type.Optional(Nullable(Text(60))),
  centreName: Type.Optional(Nullable(Text(200))),
  centreNumber: Type.Optional(Nullable(Text(60))),
  centreCity: Type.Optional(Nullable(Text(100))),
  centreCountry: Type.Optional(Nullable(Text(100))),
  notes: Type.Optional(Nullable(Text(2000))),
  cardSeen: Type.Optional(Type.Boolean({ description: 'The User has looked at the card: verification card_seen instead of self_declared' })),
};

const errors = { 400: Problem, 404: Problem, 409: Problem };

export const certificationRoutes: FastifyPluginAsyncTypebox<CertificationRouteDeps> = async (app, { auth, certifications }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler(answerErrors(replyCertificationError));

  app.get('/divers/:id/certifications', {
    schema: {
      summary: 'A Diver\'s certification cards, the latest issue first (only the Users who keep the Diver; others and external Divers: 404 diver_not_found)',
      description: 'ADR 0050. Never part of another view, never shown to other Users (ADR 0028).',
      params: IdParams, response: { 200: Type.Array(CertificationView), ...errors },
    },
  }, async (request) => certifications.list(userOf(request).id, request.params.id));

  app.post('/divers/:id/certifications', {
    schema: {
      summary: 'Add a certification card by hand: self_declared, or card_seen with cardSeen',
      description: 'Agency and level are free text; clients suggest the agencies already in the list. 400 for a date that does not exist, an expiry before the issue or a count outside 0 to 100 000.',
      params: IdParams, body: Type.Object(Fields, { additionalProperties: false }),
      response: { 201: CertificationView, ...errors },
    },
  }, async (request, reply) => reply.code(201).send(await certifications.create(userOf(request).id, request.params.id, request.body)));

  app.put('/divers/:id/certifications/:certificationId', {
    schema: {
      summary: 'Change a card with the version the client saw',
      description: '409 certification_changed for an older version. An imported card (source set) takes only notes: 409 certification_read_only when another field differs or cardSeen is set.',
      params: CardParams, body: Type.Object({ version: Type.Integer({ minimum: 1 }), ...Fields }, { additionalProperties: false }),
      response: { 200: CertificationView, ...errors },
    },
  }, async (request) => {
    const { version, ...input } = request.body;
    return certifications.update(userOf(request).id, request.params.id, request.params.certificationId, version, input);
  });

  app.delete('/divers/:id/certifications/:certificationId', {
    schema: {
      summary: 'Delete a card and its picture; a later import leaves it deleted',
      params: CardParams, response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await certifications.remove(userOf(request).id, request.params.id, request.params.certificationId);
    return reply.code(204).send(null);
  });

  app.get('/divers/:id/certifications/:certificationId/image', {
    schema: {
      summary: 'The card\'s picture, a PNG (404 certification_image_not_found until it is stored)',
      description: 'Needs the session, so a client shows it with a fetch that sends the cookie (an <img> of the same site does).',
      params: CardParams, response: { 200: Type.Unknown(), ...errors },
    },
  }, async (request, reply) => {
    const image = await certifications.image(userOf(request).id, request.params.id, request.params.certificationId);
    return reply.header('Content-Type', image.mediaType).header('Cache-Control', 'private, max-age=0, must-revalidate')
      .header('ETag', `"${image.sha256}"`).header('X-Content-Type-Options', 'nosniff').send(image.bytes);
  });

  app.post('/divers/:id/certifications/:certificationId/image', {
    schema: {
      summary: 'Fetch the card\'s picture again (a job runs; imageState becomes pending)',
      description: '404 certification_image_not_found for a card without a Provider\'s picture (one typed by hand).',
      params: CardParams, response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await certifications.refetchImage(userOf(request).id, request.params.id, request.params.certificationId);
    return reply.code(204).send(null);
  });
};
