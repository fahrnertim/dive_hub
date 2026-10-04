// Dive sites, shared by every User (ADR 0020).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import { Problem, problem } from '../http/problems.js';
import { REVISION_CAUSES } from '../dives/revisions.js';
import { NEARBY_M, SITE_SORTS, SiteError, type ExternalIdRow, type SiteActor, type SiteService } from './site-service.js';
import { SITE_SOURCES, SOURCE_INFO } from './sources.js';

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
const MaxDepth = Nullable(Type.Number({ exclusiveMinimum: 0, maximum: 400, description: 'Deepest point divers reach here, in metres' }));
const SsiSiteId = Nullable(Type.String({ pattern: '^[1-9][0-9]{0,9}$', description: 'The site\'s ID at SSI (digits), as in its QR code "site:3314"' }));

const CreateBody = Type.Object({
  name: Name,
  position: Type.Optional(Nullable(PositionSchema)),
  country: Type.Optional(Country),
  waterBody: Type.Optional(WaterBody),
  description: Type.Optional(Description),
  maxDepthM: Type.Optional(MaxDepth),
  ssiSiteId: Type.Optional(SsiSiteId),
}, { additionalProperties: false });

const EditBody = Type.Object({
  version: Type.Integer({ description: 'The version the edit started from' }),
  name: Type.Optional(Name),
  position: Type.Optional(Nullable(PositionSchema)),
  country: Type.Optional(Country),
  waterBody: Type.Optional(WaterBody),
  description: Type.Optional(Description),
  maxDepthM: Type.Optional(MaxDepth),
  ssiSiteId: Type.Optional(SsiSiteId),
}, { additionalProperties: false });

const ExternalIdView = Type.Object({
  source: Type.Enum([...SITE_SOURCES]),
  name: Type.String({ description: 'The Source\'s name, e.g. "OpenStreetMap"' }),
  externalId: Type.String({ description: 'e.g. "node/123", "Q42", "3314"' }),
  url: Nullable(Type.String({ description: 'The object\'s page at the Source' })),
  providesData: Type.Boolean({ description: 'The site was created or filled from this Source ("From OpenStreetMap"); otherwise a reference only ("Also in …")' }),
  attribution: Nullable(Type.Object({ text: Type.String(), url: Type.String() }, { description: 'What the Source\'s license asks to show with its data' })),
}, { description: 'Where a site comes from, or where else it is known (ADR 0021)' });

export const SiteView = Type.Object({
  id: Type.String(),
  name: Type.String(),
  position: Nullable(PositionSchema),
  country: Nullable(Type.String()),
  waterBody: Nullable(Type.String()),
  description: Nullable(Type.String()),
  maxDepthM: Nullable(Type.Number({ description: 'Metres' })),
  ssiSiteId: Nullable(Type.String()),
  externalIds: Type.Array(ExternalIdView),
  version: Type.Integer({ description: 'Send it back with an edit; it changes with every change' }),
  diveCount: Type.Integer({ description: 'How many of the signed-in User\'s Dives are at the site' }),
  inUse: Type.Boolean({ description: 'Whether any Dive (of any User) is at the site; then it can\'t be deleted' }),
  canDelete: Type.Boolean({ description: 'Whether the signed-in User may delete it: its creator or an admin' }),
  distanceM: Type.Optional(Type.Number({ description: 'Metres from the position asked for (with latitude/longitude)' })),
  mergedInto: Nullable(Type.String({ description: 'Set when this site was merged into another (ADR 0022): open that one instead' })),
});

const ListQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 100, description: 'Words from the name or body of water' })),
  latitude: Type.Optional(Type.Number({ minimum: -90, maximum: 90, description: 'With longitude: only sites near here, nearest first' })),
  longitude: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
  within: Type.Optional(Type.Integer({ minimum: 1, maximum: 50_000, default: NEARBY_M, description: 'Metres around latitude/longitude' })),
  country: Type.Optional(Type.String({ pattern: '^[A-Z]{2}$', description: 'Only sites in this country (ISO 3166-1 alpha-2)' })),
  mine: Type.Optional(Type.Boolean({ description: 'Only sites where the signed-in User has dives' })),
  sort: Type.Optional(Type.Enum([...SITE_SORTS], { default: 'name', description: 'Ignored near a position (nearest first)' })),
  order: Type.Optional(Type.Enum(['asc', 'desc'], { default: 'asc' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

const MergeBody = Type.Object({
  intoId: Type.String({ format: 'uuid', description: 'The site to keep' }),
  version: Type.Integer({ description: 'The version of the site being merged, as the User saw it' }),
  intoVersion: Type.Integer({ description: 'The version of the kept site, as the User saw it' }),
}, { additionalProperties: false });

const SiteRevisionView = Type.Object({
  id: Type.String(),
  at: Type.String({ format: 'date-time' }),
  actor: Type.Object({
    type: Type.Enum(['you', 'user', 'site_import', 'import', 'system'], {
      description: 'you: the signed-in User; user: another User, never named (ADR 0020); site_import: named by its Sources',
    }),
    name: Nullable(Type.String()),
  }),
  cause: Type.Enum([...REVISION_CAUSES]),
  changes: Type.Record(Type.String(), Type.Object({ from: Type.Unknown(), to: Type.Unknown() })),
});

export const externalIdView = (e: ExternalIdRow) => {
  const info = SOURCE_INFO[e.source];
  return {
    source: e.source, name: info.name, externalId: e.externalId, url: info.link?.(e.externalId) ?? null,
    providesData: e.providesData, attribution: e.providesData ? info.attribution : null,
  };
};

type Row = Awaited<ReturnType<SiteService['get']>> & { distanceM?: number };
export const toSiteView = ({ site: s, diveCount, inUse, canDelete, externalIds, ssiSiteId, distanceM }: Row): Static<typeof SiteView> => ({
  id: s.id, name: s.name,
  position: s.latitude === null || s.longitude === null ? null : { latitude: s.latitude, longitude: s.longitude },
  country: s.country, waterBody: s.waterBody, description: s.description, maxDepthM: s.maxDepthM, ssiSiteId,
  externalIds: externalIds.map(externalIdView), version: s.version,
  diveCount, inUse, canDelete, mergedInto: s.mergedInto, ...(distanceM !== undefined && { distanceM: Math.round(distanceM) }),
});

const STATUS: Record<SiteError['code'], number> = {
  site_not_found: 404, site_changed: 409, site_in_use: 409, site_not_deletable: 403, external_id_taken: 409, site_merge_self: 400,
};
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
      summary: 'One page of the instance\'s Dive sites, with how many match; with latitude and longitude only those nearby, nearest first',
      querystring: ListQuery,
      response: { 200: Type.Object({ sites: Type.Array(SiteView), total: Type.Integer({ description: 'Sites matching, on all pages' }) }), 400: Problem },
    },
  }, async (request, reply) => {
    const { q, latitude, longitude, within = NEARBY_M, country, mine, sort, order, limit, offset } = request.query;
    if ((latitude === undefined) !== (longitude === undefined)) {
      return reply.code(400).send(problem('invalid_input', 'latitude and longitude go together'));
    }
    const near = latitude !== undefined && longitude !== undefined ? { position: { latitude, longitude }, withinM: within } : undefined;
    const page = await sites.list(actorOf(request), { q, near, country, mine, sort, order, limit, offset });
    return { sites: page.sites.map(toSiteView), total: page.total };
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
      maxDepthM: b.maxDepthM ?? null, ssiSiteId: b.ssiSiteId ?? null,
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
    const { version, name, position, country, waterBody, description, maxDepthM, ssiSiteId } = request.body;
    await sites.edit(actorOf(request), request.params.id, version, {
      ...(name !== undefined && { name: name.trim() }),
      ...(position !== undefined && { position }),
      ...(country !== undefined && { country }),
      ...(waterBody !== undefined && { waterBody: text(waterBody) ?? null }),
      ...(description !== undefined && { description: text(description) ?? null }),
      ...(maxDepthM !== undefined && { maxDepthM }),
      ...(ssiSiteId !== undefined && { ssiSiteId }),
    });
    return toSiteView(await sites.get(actorOf(request), request.params.id));
  });

  app.post('/dive-sites/:id/merge', {
    schema: {
      summary: 'Merge this Dive site into another (any User; no undo)',
      description: 'The kept site keeps its values and fills its gaps from this one; Dives and External IDs move to it (ADR 0022). Send both versions; 409 site_changed if either changed.',
      params: IdParams, body: MergeBody, response: { 200: SiteView, ...errors },
    },
  }, async (request) => {
    const { intoId, version, intoVersion } = request.body;
    await sites.merge(actorOf(request), request.params.id, version, intoId, intoVersion);
    return toSiteView(await sites.get(actorOf(request), intoId));
  });

  app.get('/dive-sites/:id/revisions', {
    schema: {
      summary: 'The Dive site\'s history, newest first',
      description: 'Every User may read it. Other Users are never named; a Site import is named by its Sources.',
      params: IdParams, response: { 200: Type.Array(SiteRevisionView), 404: Problem },
    },
  }, async (request) => (await sites.revisions(actorOf(request), request.params.id)).map((r) => ({
    ...r, cause: r.cause as (typeof REVISION_CAUSES)[number],
  })));

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
