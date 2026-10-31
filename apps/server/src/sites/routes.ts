// Dive sites, shared by every User (ADR 0020).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import { callerOf } from '../http/caller.js';
import { answerErrors, answers, Problem, problem } from '../http/problems.js';
import { REVISION_CAUSES } from '../dives/revisions.js';
import { SITE_WATER_TYPES } from '../vocabulary.js';
import { NEARBY_M, SITE_SORTS, SiteError, type SiteService } from './site-service.js';
import { SiteView, toSiteView } from './site-view.js';
import { PositionSchema } from './position-view.js';
import { IMPORT_SOURCES, SITE_SOURCES } from './sources.js';
import { Change, Changes, DateTime, historyRoute, IdParams, Made, Nullable } from '../http/schemas.js';

export interface SiteRouteDeps {
  auth: Auth;
  sites: SiteService;
}

/** Null first, so Fastify's coercion keeps a null a null (ADR 0015). */

const Name = Type.String({ minLength: 1, maxLength: 120, pattern: '\\S' });
const Country = Nullable(Type.String({ pattern: '^[A-Z]{2}$', description: 'ISO 3166-1 alpha-2, e.g. "EG"' }));
const WaterBody = Nullable(Type.String({ maxLength: 120, description: 'e.g. "Red Sea"' }));
const Description = Nullable(Type.String({ maxLength: 5000 }));
const MaxDepth = Nullable(Type.Number({ exclusiveMinimum: 0, maximum: 400, description: 'Deepest point divers reach here, in metres' }));
const WaterType = Nullable(Type.Enum([...SITE_WATER_TYPES], {
  description: 'The water at the site (ADR 0025); it is the water type of every Dive here. Clients say so where it is edited',
}));

const CreateBody = Type.Object({
  name: Name,
  position: Type.Optional(Nullable(PositionSchema)),
  country: Type.Optional(Country),
  waterBody: Type.Optional(WaterBody),
  description: Type.Optional(Description),
  maxDepthM: Type.Optional(MaxDepth),
  waterType: Type.Optional(WaterType),
}, { additionalProperties: false });

const EditBody = Type.Object({
  version: Type.Integer({ description: 'The version the edit started from' }),
  name: Type.Optional(Name),
  position: Type.Optional(Nullable(PositionSchema)),
  country: Type.Optional(Country),
  waterBody: Type.Optional(WaterBody),
  description: Type.Optional(Description),
  maxDepthM: Type.Optional(MaxDepth),
  waterType: Type.Optional(WaterType),
}, { additionalProperties: false });

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

const AdoptBody = Type.Object({
  source: Type.Enum([...IMPORT_SOURCES], { description: 'The Source whose offered values to take' }),
  version: Type.Integer({ description: 'The version the User saw' }),
}, { additionalProperties: false });

const SiteRef = Type.Object({ id: Type.String(), name: Type.String({ description: 'The name it had then' }) });
/** The fields a site's history names with their shapes. */
const SiteChanges = Changes({
  position: Change(Nullable(PositionSchema)),
  mergedSite: Made(SiteRef),
  mergedInto: Made(SiteRef),
  adopted: Made(Type.Object({ source: Type.Enum([...IMPORT_SOURCES]), externalId: Type.String() }, { description: 'The Source offer taken up (ADR 0025)' })),
}, 'Field → { from, to }; a field not named here has a value of any shape');
type StoredSiteChanges = Static<typeof SiteChanges>;

const SiteRevisionView = Type.Object({
  id: Type.String(),
  at: DateTime,
  actor: Type.Object({
    type: Type.Enum(['you', 'user', 'site_import', 'import', 'system'], {
      description: 'you: the signed-in User; user: another User, never named (ADR 0020); site_import: named by its Sources',
    }),
    name: Nullable(Type.String()),
  }),
  cause: Type.Enum([...REVISION_CAUSES]),
  changes: SiteChanges,
});

const STATUS: Record<SiteError['code'], number> = {
  site_not_found: 404, site_changed: 409, site_in_use: 409, site_not_deletable: 403, external_id_taken: 409, site_merge_self: 400,
  site_offer_not_found: 404, site_source_not_typed: 400, invalid_input: 400,
};
const errors = { 400: Problem, 403: Problem, 404: Problem, 409: Problem };

/** Blank text is no text. */
const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

export const siteRoutes: FastifyPluginAsyncTypebox<SiteRouteDeps> = async (app, { auth, sites }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler(answerErrors(answers(SiteError, STATUS)));

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
    const page = await sites.list(callerOf(request), { q, near, country, mine, sort, order, limit, offset });
    return { sites: page.sites.map(toSiteView), total: page.total };
  });

  app.get('/dive-sites/:id', {
    schema: { summary: 'One Dive site', params: IdParams, response: { 200: SiteView, 404: Problem } },
  }, async (request) => toSiteView(await sites.get(callerOf(request), request.params.id)));

  app.post('/dive-sites', {
    schema: { summary: 'Create a Dive site; every User of the instance sees it', body: CreateBody, response: { 201: SiteView, ...errors } },
  }, async (request, reply) => {
    const b = request.body;
    const id = await sites.create(callerOf(request), {
      name: b.name.trim(), position: b.position ?? null, country: b.country ?? null,
      waterBody: text(b.waterBody) ?? null, description: text(b.description) ?? null,
      maxDepthM: b.maxDepthM ?? null, waterType: b.waterType ?? null,
    });
    return reply.code(201).send(toSiteView(await sites.get(callerOf(request), id)));
  });

  app.patch('/dive-sites/:id', {
    schema: {
      summary: 'Edit a Dive site (any User)',
      description: 'Send the version you started from; if the site changed meanwhile the answer is 409 site_changed.',
      params: IdParams, body: EditBody, response: { 200: SiteView, ...errors },
    },
  }, async (request) => {
    const { version, name, position, country, waterBody, description, maxDepthM, waterType } = request.body;
    await sites.edit(callerOf(request), request.params.id, version, {
      ...(name !== undefined && { name: name.trim() }),
      ...(position !== undefined && { position }),
      ...(country !== undefined && { country }),
      ...(waterBody !== undefined && { waterBody: text(waterBody) ?? null }),
      ...(description !== undefined && { description: text(description) ?? null }),
      ...(maxDepthM !== undefined && { maxDepthM }),
      ...(waterType !== undefined && { waterType }),
    });
    return toSiteView(await sites.get(callerOf(request), request.params.id));
  });

  app.put('/dive-sites/:id/external-ids/:source', {
    schema: {
      summary: 'Set or clear the Dive site\'s External ID at a Source Users may type (SSI today; any User)',
      description: 'The forms the Source shows are taken (SSI: "3314" or "site:3314", see GET /api/providers, requirements) and '
        + 'the bare ID is kept. 409 external_id_taken when another site has it; 400 site_source_not_typed for a Source whose IDs '
        + 'only a Site import brings. The site\'s version stays: this never conflicts with an edit of its other fields (ADR 0029).',
      params: Type.Object({ id: Type.String({ format: 'uuid' }), source: Type.Enum([...SITE_SOURCES]) }),
      body: Type.Object({
        externalId: Nullable(Type.String({ minLength: 1, maxLength: 40, description: 'As the User typed or picked it; null clears it' })),
      }, { additionalProperties: false }),
      response: { 200: SiteView, ...errors },
    },
  }, async (request) => {
    await sites.setExternalId(callerOf(request), request.params.id, request.params.source, request.body.externalId);
    return toSiteView(await sites.get(callerOf(request), request.params.id));
  });

  app.post('/dive-sites/:id/merge', {
    schema: {
      summary: 'Merge this Dive site into another (any User; no undo)',
      description: 'The kept site keeps its values and fills its gaps from this one; Dives and External IDs move to it (ADR 0022). Send both versions; 409 site_changed if either changed.',
      params: IdParams, body: MergeBody, response: { 200: SiteView, ...errors },
    },
  }, async (request) => {
    const { intoId, version, intoVersion } = request.body;
    await sites.merge(callerOf(request), request.params.id, version, intoId, intoVersion);
    return toSiteView(await sites.get(callerOf(request), intoId));
  });

  app.post('/dive-sites/:id/adopt', {
    schema: {
      summary: 'Take up the data a Source offers for this hand-made Dive site (any User)',
      description: 'Empty fields take the Source\'s values, filled ones stay; the Source then provides data, so later imports keep those fields current (ADR 0025). 404 site_offer_not_found without an offer; 409 site_changed if the version differs.',
      params: IdParams, body: AdoptBody, response: { 200: SiteView, ...errors },
    },
  }, async (request) => {
    await sites.adopt(callerOf(request), request.params.id, request.body.version, request.body.source);
    return toSiteView(await sites.get(callerOf(request), request.params.id));
  });

  app.get('/dive-sites/:id/revisions', {
    ...historyRoute,
    schema: {
      summary: 'The Dive site\'s history, newest first',
      description: 'Every User may read it. Other Users are never named; a Site import is named by its Sources.',
      params: IdParams, response: { 200: Type.Array(SiteRevisionView), 404: Problem },
    },
  }, async (request) => (await sites.revisions(callerOf(request), request.params.id)).map((r) => ({
    // Stored as written: today's shapes for the named fields, older Revisions as they were (see Changes).
    ...r, cause: r.cause as (typeof REVISION_CAUSES)[number], changes: r.changes as StoredSiteChanges,
  })));

  app.delete('/dive-sites/:id', {
    schema: {
      summary: 'Delete a Dive site: its creator or an admin, while no Dive is there',
      params: IdParams, response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await sites.remove(callerOf(request), request.params.id);
    return reply.code(204).send(null);
  });
};
