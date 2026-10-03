// Dive sites, shared by every User (ADR 0020).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import { Problem, problem } from '../http/problems.js';
import { NEARBY_M, SiteError, type SiteActor, type SiteService } from './site-service.js';

export interface SiteRouteDeps {
  auth: Auth;
  sites: SiteService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
/** Null first, so Fastify's coercion keeps a null a null (ADR 0015). */
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);

export const PositionSchema = Type.Object({
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
}, { additionalProperties: false, description: 'WGS84 degrees' });

const Name = Type.String({ minLength: 1, maxLength: 120, pattern: '\\S' });
const Country = Nullable(Type.String({ pattern: '^[A-Z]{2}$', description: 'ISO 3166-1 alpha-2, e.g. "EG"' }));
const WaterBody = Nullable(Type.String({ maxLength: 120, description: 'e.g. "Red Sea"' }));
const Description = Nullable(Type.String({ maxLength: 5000 }));

const CreateBody = Type.Object({
  name: Name,
  position: Type.Optional(Nullable(PositionSchema)),
  country: Type.Optional(Country),
  waterBody: Type.Optional(WaterBody),
  description: Type.Optional(Description),
}, { additionalProperties: false });

const EditBody = Type.Object({
  version: Type.Integer({ description: 'The version the edit started from' }),
  name: Type.Optional(Name),
  position: Type.Optional(Nullable(PositionSchema)),
  country: Type.Optional(Country),
  waterBody: Type.Optional(WaterBody),
  description: Type.Optional(Description),
}, { additionalProperties: false });

export const SiteView = Type.Object({
  id: Type.String(),
  name: Type.String(),
  position: Nullable(PositionSchema),
  country: Nullable(Type.String()),
  waterBody: Nullable(Type.String()),
  description: Nullable(Type.String()),
  version: Type.Integer({ description: 'Send it back with an edit; it changes with every change' }),
  diveCount: Type.Integer({ description: 'How many of the signed-in User\'s Dives are at the site' }),
  inUse: Type.Boolean({ description: 'Whether any Dive (of any User) is at the site; then it can\'t be deleted' }),
  canDelete: Type.Boolean({ description: 'Whether the signed-in User may delete it: its creator or an admin' }),
  distanceM: Type.Optional(Type.Number({ description: 'Metres from the position asked for (with latitude/longitude)' })),
});

const ListQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 100, description: 'Words from the name or body of water' })),
  latitude: Type.Optional(Type.Number({ minimum: -90, maximum: 90, description: 'With longitude: only sites near here, nearest first' })),
  longitude: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
  within: Type.Optional(Type.Integer({ minimum: 1, maximum: 50_000, default: NEARBY_M, description: 'Metres around latitude/longitude' })),
});

type Row = Awaited<ReturnType<SiteService['get']>> & { distanceM?: number };
export const toSiteView = ({ site: s, diveCount, inUse, canDelete, distanceM }: Row): Static<typeof SiteView> => ({
  id: s.id, name: s.name,
  position: s.latitude === null || s.longitude === null ? null : { latitude: s.latitude, longitude: s.longitude },
  country: s.country, waterBody: s.waterBody, description: s.description, version: s.version,
  diveCount, inUse, canDelete, ...(distanceM !== undefined && { distanceM: Math.round(distanceM) }),
});

const STATUS: Record<SiteError['code'], number> = { site_not_found: 404, site_changed: 409, site_in_use: 409, site_not_deletable: 403 };
const errors = { 400: Problem, 403: Problem, 404: Problem, 409: Problem };

const actorOf = (request: FastifyRequest): SiteActor => ({ userId: request.user!.id, isAdmin: request.user!.role === 'admin' });
/** Blank text is no text. */
const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

export const siteRoutes: FastifyPluginAsyncTypebox<SiteRouteDeps> = async (app, { auth, sites }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SiteError) return reply.code(STATUS[error.code]).send(problem(error.code));
    throw error;
  });

  app.get('/dive-sites', {
    schema: {
      summary: 'The instance\'s Dive sites by name; with latitude and longitude only those nearby, nearest first',
      querystring: ListQuery, response: { 200: Type.Array(SiteView), 400: Problem },
    },
  }, async (request, reply) => {
    const { q, latitude, longitude, within = NEARBY_M } = request.query;
    if ((latitude === undefined) !== (longitude === undefined)) {
      return reply.code(400).send(problem('invalid_input', 'latitude and longitude go together'));
    }
    const near = latitude !== undefined && longitude !== undefined ? { position: { latitude, longitude }, withinM: within } : undefined;
    return (await sites.list(actorOf(request), { q, near })).map(toSiteView);
  });

  app.get('/dive-sites/:id', {
    schema: { summary: 'One Dive site', params: IdParams, response: { 200: SiteView, 404: Problem } },
  }, async (request) => toSiteView(await sites.get(actorOf(request), request.params.id)));

  app.post('/dive-sites', {
    schema: { summary: 'Create a Dive site; every User of the instance sees it', body: CreateBody, response: { 201: SiteView, ...errors } },
  }, async (request, reply) => {
    const b = request.body;
    const id = await sites.create(actorOf(request), {
      name: b.name.trim(), position: b.position ?? null, country: b.country ?? null,
      waterBody: text(b.waterBody) ?? null, description: text(b.description) ?? null,
    });
    return reply.code(201).send(toSiteView(await sites.get(actorOf(request), id)));
  });

  app.patch('/dive-sites/:id', {
    schema: {
      summary: 'Edit a Dive site (any User)',
      description: 'Send the version you started from; if the site changed meanwhile the answer is 409 site_changed.',
      params: IdParams, body: EditBody, response: { 200: SiteView, ...errors },
    },
  }, async (request) => {
    const { version, name, position, country, waterBody, description } = request.body;
    await sites.edit(actorOf(request), request.params.id, version, {
      ...(name !== undefined && { name: name.trim() }),
      ...(position !== undefined && { position }),
      ...(country !== undefined && { country }),
      ...(waterBody !== undefined && { waterBody: text(waterBody) ?? null }),
      ...(description !== undefined && { description: text(description) ?? null }),
    });
    return toSiteView(await sites.get(actorOf(request), request.params.id));
  });

  app.delete('/dive-sites/:id', {
    schema: {
      summary: 'Delete a Dive site: its creator or an admin, while no Dive is there',
      params: IdParams, response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await sites.remove(actorOf(request), request.params.id);
    return reply.code(204).send(null);
  });
};
