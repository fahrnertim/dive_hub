// The admin's Site import over HTTP (ADR 0021): start one, follow its progress, see the latest.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from 'typebox';
import type { Auth } from '../../auth/auth.js';
import { requireAdmin, requireUser } from '../../auth/fastify.js';
import type { siteImport } from '../../db/schema.js';
import { Problem, problem, PROBLEMS, type ProblemCode } from '../../http/problems.js';
import { IMPORT_SOURCES } from '../sources.js';
import { SiteImportError, type SiteImportService } from './site-import-service.js';

export interface SiteImportRouteDeps {
  auth: Auth;
  siteImports: SiteImportService;
}

const Latitude = Type.Number({ minimum: -90, maximum: 90 });
const Longitude = Type.Number({ minimum: -180, maximum: 180 });

const Area = Type.Union([
  Type.Object({ kind: Type.Literal('country'), country: Type.String({ pattern: '^[A-Z]{2}$', description: 'ISO 3166-1 alpha-2' }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('box'), south: Latitude, west: Longitude, north: Latitude, east: Longitude }, {
    additionalProperties: false, description: 'Degrees; west may be greater than east across the date line',
  }),
  Type.Object({ kind: Type.Literal('world') }, { additionalProperties: false }),
], { description: 'Where to import: a country, a box, or everywhere' });

const Source = Type.Enum([...IMPORT_SOURCES]);

const StartBody = Type.Object({
  sources: Type.Array(Source, { minItems: 1, maxItems: IMPORT_SOURCES.length, uniqueItems: true }),
  area: Area,
  language: Type.String({ pattern: '^[a-z]{2,3}$', description: 'Language of names where a Source has several (Wikidata labels)' }),
  confirmOdbl: Type.Optional(Type.Boolean({ description: 'The admin read the ODbL explanation and confirms it; needed for osm' })),
}, { additionalProperties: false });

const Counts = Type.Object({
  created: Type.Integer(), updated: Type.Integer(), unchanged: Type.Integer(), kept: Type.Integer(), linked: Type.Integer(),
  skippedNoName: Type.Integer(), skippedDeleted: Type.Integer(), gone: Type.Integer(),
}, { description: 'Sites created, updated, unchanged, kept (only fields Users changed differed), linked (references on hand-made sites); objects skipped without a name or because their site was deleted in the hub; objects gone from the Source' });

export const SiteImportView = Type.Object({
  id: Type.String(),
  status: Type.Union([Type.Literal('queued'), Type.Literal('running'), Type.Literal('done'), Type.Literal('failed')]),
  sources: Type.Array(Source),
  area: Area,
  language: Type.String(),
  progress: Type.Object({
    step: Type.Union([Type.Literal('waiting'), Type.Literal('osm'), Type.Literal('wikidata'), Type.Literal('saving')]),
    done: Type.Integer(), total: Type.Integer(),
  }),
  counts: Type.Union([Type.Null(), Counts]),
  findings: Type.Array(Type.Object({
    kind: Type.Literal('near'), siteId: Type.String(), name: Type.String(), nearSiteId: Type.String(), nearName: Type.String(), distanceM: Type.Integer(),
  }, { description: 'A new site within 200 m of one that was there before' })),
  failureCode: Type.Union([Type.Null(), Type.Enum(Object.keys(PROBLEMS) as ProblemCode[])], { description: 'Why it failed (a problem code)' }),
  createdAt: Type.String({ format: 'date-time' }),
  finishedAt: Type.Union([Type.Null(), Type.String({ format: 'date-time' })]),
});

const toView = (r: typeof siteImport.$inferSelect): Static<typeof SiteImportView> => ({
  id: r.id, status: r.status, sources: r.sources, area: r.area, language: r.language, progress: r.progress,
  counts: r.counts, findings: r.findings, failureCode: (r.errorCode as ProblemCode | null) ?? null,
  createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
});

const STATUS: Record<SiteImportError['code'], number> = { odbl_not_confirmed: 400, site_import_running: 409, site_import_not_found: 404 };

export const siteImportRoutes: FastifyPluginAsyncTypebox<SiteImportRouteDeps> = async (app, { auth, siteImports }) => {
  app.addHook('onRequest', requireUser(auth));
  app.addHook('onRequest', requireAdmin);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SiteImportError) return reply.code(STATUS[error.code]).send(problem(error.code));
    throw error;
  });

  app.post('/admin/site-imports', {
    schema: {
      summary: 'Start importing Dive sites from OpenStreetMap and/or Wikidata (admins)',
      description: 'Runs in the background; follow it with GET. OpenStreetMap data is under ODbL: send confirmOdbl. One import at a time (409 site_import_running).',
      body: StartBody, response: { 202: SiteImportView, 400: Problem, 403: Problem, 409: Problem },
    },
  }, async (request, reply) => {
    const { sources, area, language, confirmOdbl } = request.body;
    if (area.kind === 'box' && area.south >= area.north) return reply.code(400).send(problem('invalid_input', 'south must be less than north'));
    const row = await siteImports.start(request.user!.id, { sources, area, language, confirmOdbl: confirmOdbl ?? false });
    return reply.code(202).send(toView(row));
  });

  app.get('/admin/site-imports', {
    schema: { summary: 'The latest Site imports, newest first (admins)', response: { 200: Type.Object({ imports: Type.Array(SiteImportView) }), 403: Problem } },
  }, async () => ({ imports: (await siteImports.list()).map(toView) }));

  app.get('/admin/site-imports/:id', {
    schema: {
      summary: 'One Site import with its progress, counts and findings (admins)',
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }), response: { 200: SiteImportView, 403: Problem, 404: Problem },
    },
  }, async (request) => toView(await siteImports.get(request.params.id)));
};
