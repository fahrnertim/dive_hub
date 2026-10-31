// The admin's Site import over HTTP (ADR 0021, 0025): start one, follow its progress, see the latest.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../../auth/auth.js';
import { requireAdmin, requireUser, userOf } from '../../auth/fastify.js';
import { answerErrors, answers, Problem, problem } from '../../http/problems.js';
import { IdParams } from '../../http/schemas.js';
import { IMPORT_SOURCES } from '../sources.js';
import { SiteImportError, type SiteImportService } from './site-import-service.js';
import { Area, SiteImportView, Source, toSiteImportView } from './site-import-view.js';

export interface SiteImportRouteDeps {
  auth: Auth;
  siteImports: SiteImportService;
}

const StartBody = Type.Object({
  sources: Type.Array(Source, { minItems: 1, maxItems: IMPORT_SOURCES.length, uniqueItems: true }),
  area: Area,
  language: Type.String({ pattern: '^[a-z]{2,3}$', description: 'Language of names where a Source has several (Wikidata labels)' }),
  confirmOdbl: Type.Optional(Type.Boolean({ description: 'The admin read the ODbL explanation and confirms it; needed for osm' })),
  confirmSsi: Type.Optional(Type.Boolean({
    description: 'The admin read that SSI gives no licence for its site list, that the EU protects it as a database, and that importing is the operator\'s decision and risk; needed for ssi',
  })),
  createSites: Type.Optional(Type.Boolean({ default: true, description: 'false: only match and fill sites already in the hub, create none' })),
}, { additionalProperties: false });

const STATUS: Record<SiteImportError['code'], number> = { odbl_not_confirmed: 400, ssi_not_confirmed: 400, site_import_running: 409, site_import_not_found: 404 };

export const siteImportRoutes: FastifyPluginAsyncTypebox<SiteImportRouteDeps> = async (app, { auth, siteImports }) => {
  app.addHook('onRequest', requireUser(auth));
  app.addHook('onRequest', requireAdmin);
  app.setErrorHandler(answerErrors(answers(SiteImportError, STATUS)));

  app.post('/admin/site-imports', {
    schema: {
      summary: 'Start importing Dive sites from OpenStreetMap, Wikidata and/or SSI (admins)',
      description: 'Runs in the background; follow it with GET. OpenStreetMap data is under ODbL: send confirmOdbl. SSI gives no licence: send confirmSsi after showing the explanation (docs/spec/clients.md). One import at a time (409 site_import_running).',
      body: StartBody, response: { 202: SiteImportView, 400: Problem, 403: Problem, 409: Problem },
    },
  }, async (request, reply) => {
    const { sources, area, language, confirmOdbl, confirmSsi, createSites } = request.body;
    if (area.kind === 'box' && area.south >= area.north) return reply.code(400).send(problem('invalid_input', 'south must be less than north'));
    const row = await siteImports.start(userOf(request).id, {
      sources, area, language, confirmOdbl: confirmOdbl ?? false, confirmSsi: confirmSsi ?? false, createSites: createSites ?? true,
    });
    return reply.code(202).send(toSiteImportView(row));
  });

  app.get('/admin/site-imports', {
    schema: { summary: 'The latest Site imports, newest first (admins)', response: { 200: Type.Array(SiteImportView), 403: Problem } },
  }, async () => (await siteImports.list()).map(toSiteImportView));

  app.get('/admin/site-imports/:id', {
    schema: {
      summary: 'One Site import with its progress, counts and findings (admins)',
      params: IdParams, response: { 200: SiteImportView, 403: Problem, 404: Problem },
    },
  }, async (request) => toSiteImportView(await siteImports.get(request.params.id)));
};
