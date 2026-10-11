// A Diver's certification cards (ADR 0050). Only the Users who manage the Diver; everyone else, and every call for an
// external Diver, gets 404 diver_not_found. The import from a Provider is in providers/routes.ts.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyReply } from 'fastify';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import { CERTIFICATION_IMAGE_STATES, CERTIFICATION_VERIFICATIONS } from '../db/schema.js';
import { Problem, problem } from '../http/problems.js';
import { CertificationError, type CertificationService } from './certification-service.js';

export interface CertificationRouteDeps {
  auth: Auth;
  certifications: CertificationService;
}

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);
const DiverParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const CardParams = Type.Object({ id: Type.String({ format: 'uuid' }), certificationId: Type.String({ format: 'uuid' }) });
const Day = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' });
const Text = (max: number) => Type.String({ maxLength: max });

export const CertificationView = Type.Object({
  id: Type.String(), diverId: Type.String(),
  agency: Type.String({ description: 'Free text (SSI, PADI, CMAS, …)' }),
  level: Type.String({ description: 'The course or level, free text; for an imported card as the agency names it' }),
  number: Nullable(Type.String({ description: 'The card or diver number (a typed card); an imported card has its card ID in cardId' })),
  issuedOn: Nullable(Day), expiresOn: Nullable(Day),
  divesAtIssue: Nullable(Type.Integer()),
  instructorName: Nullable(Type.String()), instructorNumber: Nullable(Type.String()),
  centreName: Nullable(Type.String()), centreNumber: Nullable(Type.String()), centreCity: Nullable(Type.String()), centreCountry: Nullable(Type.String()),
  verification: Type.Enum([...CERTIFICATION_VERIFICATIONS], {
    description: 'self_declared: typed by the User; card_seen: the User says they looked at the card; verified_with_agency: read from the agency\'s own record by an import (never settable by hand)',
  }),
  expiry: Type.Enum(['none', 'valid', 'soon', 'expired'], {
    description: 'none: no expiry date; soon: expires within 90 days (the day itself is still valid); expired: the date has passed. Expired cards come last in the list',
  }),
  notes: Nullable(Type.String()),
  source: Nullable(Type.String({ description: 'The Provider the card was imported from (`ssi`). Not null: the card\'s fields can\'t be changed, only its notes' })),
  cardId: Nullable(Type.String({ description: 'The Provider\'s ID of the card' })),
  category: Nullable(Type.String({ description: 'The Provider\'s category code, e.g. `scubadiving`; not a translation' })),
  imageState: Type.Enum([...CERTIFICATION_IMAGE_STATES], { description: 'pending: a job will fetch the picture; failed: show "Fetch again" (POST …/image)' }),
  imageUrl: Nullable(Type.String({ description: 'API path of the picture (needs the session); set only while imageState is stored' })),
  importedAt: Nullable(Type.String({ format: 'date-time' })),
  version: Type.Integer({ description: 'Send it back with a change; 409 certification_changed when the card changed meanwhile' }),
  createdAt: Type.String({ format: 'date-time' }),
}, { description: 'A certification card of a Diver (ADR 0050)' });

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

export const CERTIFICATION_STATUS: Record<CertificationError['code'], number> = {
  diver_not_found: 404, certification_not_found: 404, certification_image_not_found: 404,
  certification_changed: 409, certification_read_only: 409, invalid_input: 400,
};

export const replyCertificationError = (error: CertificationError, reply: FastifyReply) =>
  reply.code(CERTIFICATION_STATUS[error.code]).send(problem(error.code));

const errors = { 400: Problem, 404: Problem, 409: Problem };

export const certificationRoutes: FastifyPluginAsyncTypebox<CertificationRouteDeps> = async (app, { auth, certifications }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CertificationError) return replyCertificationError(error, reply);
    throw error;
  });

  app.get('/divers/:id/certifications', {
    schema: {
      summary: 'A Diver\'s certification cards, the latest issue first (only the Users who keep the Diver; others and external Divers: 404 diver_not_found)',
      description: 'ADR 0050. Never part of another view, never shown to other Users (ADR 0028).',
      params: DiverParams, response: { 200: Type.Array(CertificationView), ...errors },
    },
  }, async (request) => certifications.list(request.user!.id, request.params.id));

  app.post('/divers/:id/certifications', {
    schema: {
      summary: 'Add a certification card by hand: self_declared, or card_seen with cardSeen',
      description: 'Agency and level are free text; clients suggest the agencies already in the list. 400 for a date that does not exist, an expiry before the issue or a count outside 0 to 100 000.',
      params: DiverParams, body: Type.Object(Fields, { additionalProperties: false }),
      response: { 201: CertificationView, ...errors },
    },
  }, async (request, reply) => reply.code(201).send(await certifications.create(request.user!.id, request.params.id, request.body)));

  app.put('/divers/:id/certifications/:certificationId', {
    schema: {
      summary: 'Change a card with the version the client saw',
      description: '409 certification_changed for an older version. An imported card (source set) takes only notes: 409 certification_read_only when another field differs or cardSeen is set.',
      params: CardParams, body: Type.Object({ version: Type.Integer({ minimum: 1 }), ...Fields }, { additionalProperties: false }),
      response: { 200: CertificationView, ...errors },
    },
  }, async (request) => {
    const { version, ...input } = request.body;
    return certifications.update(request.user!.id, request.params.id, request.params.certificationId, version, input);
  });

  app.delete('/divers/:id/certifications/:certificationId', {
    schema: {
      summary: 'Delete a card and its picture; a later import leaves it deleted',
      params: CardParams, response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await certifications.remove(request.user!.id, request.params.id, request.params.certificationId);
    return reply.code(204).send(null);
  });

  app.get('/divers/:id/certifications/:certificationId/image', {
    schema: {
      summary: 'The card\'s picture, a PNG (404 certification_image_not_found until it is stored)',
      description: 'Needs the session, so a client shows it with a fetch that sends the cookie (an <img> of the same site does).',
      params: CardParams, response: { 200: Type.Unknown(), ...errors },
    },
  }, async (request, reply) => {
    const image = await certifications.image(request.user!.id, request.params.id, request.params.certificationId);
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
    await certifications.refetchImage(request.user!.id, request.params.id, request.params.certificationId);
    return reply.code(204).send(null);
  });
};
