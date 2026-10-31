// A Site import over HTTP (ADR 0021, 0025): the view its routes answer, and the area and Sources it is asked for.
import { Type, type Static } from 'typebox';
import { type siteImport, siteImportStatus } from '../../db/schema.js';
import { PROBLEM_CODES, storedProblemCode } from '../../http/problems.js';
import { DateTime, Nullable, refTo } from '../../http/schemas.js';
import { IMPORT_SOURCES } from '../sources.js';

const Latitude = Type.Number({ minimum: -90, maximum: 90 });
const Longitude = Type.Number({ minimum: -180, maximum: 180 });

export const Area = Type.Union([
  Type.Object({ kind: Type.Literal('country'), country: Type.String({ pattern: '^[A-Z]{2}$', description: 'ISO 3166-1 alpha-2' }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('box'), south: Latitude, west: Longitude, north: Latitude, east: Longitude }, {
    additionalProperties: false, description: 'Degrees; west may be greater than east across the date line',
  }),
  Type.Object({ kind: Type.Literal('world') }, { additionalProperties: false }),
], { description: 'Where to import: a country, a box, or everywhere' });

export const Source = Type.Enum([...IMPORT_SOURCES]);

const Counts = Type.Object({
  created: Type.Integer(), updated: Type.Integer(), unchanged: Type.Integer(), kept: Type.Integer(), linked: Type.Integer(),
  skippedNoName: Type.Integer(), skippedDeleted: Type.Integer(), skippedMerged: Type.Integer(),
  skippedNew: Type.Integer(), offered: Type.Integer(), gone: Type.Integer(),
}, { description: 'Sites created, updated, unchanged, kept (only fields Users changed differed), linked (references on hand-made sites); objects skipped without a name, because their site was deleted in the hub, because it was merged into another, or because the run created no sites; hand-made sites whose page now offers the data; objects gone from the Source' });

/** Registered with app.addSchema; routes answer SiteImportView, the reference. */
export const SiteImportViewSchema = Type.Object({
  id: Type.String(),
  status: Type.Enum([...siteImportStatus.enumValues]),
  sources: Type.Array(Source),
  area: Area,
  language: Type.String(),
  createSites: Type.Boolean({ description: 'false: the run only matched and filled sites already in the hub' }),
  progress: Type.Object({
    step: Type.Enum(['waiting', ...IMPORT_SOURCES, 'saving']),
    done: Type.Integer(), total: Type.Integer(),
  }),
  counts: Nullable(Counts),
  findings: Type.Array(Type.Union([
    Type.Object({
      kind: Type.Literal('near'), siteId: Type.String(), name: Type.String(), nearSiteId: Type.String(), nearName: Type.String(), distanceM: Type.Integer(),
    }, { description: 'A new site within 200 m of one that was there before' }),
    Type.Object({
      kind: Type.Literal('offer'), siteId: Type.String(), name: Type.String(), source: Source,
    }, { description: 'A hand-made site the Source describes: its page offers the Source\'s data' }),
  ])),
  failureCode: Nullable(Type.Enum(PROBLEM_CODES), { description: 'Why it failed (a problem code)' }),
  createdAt: DateTime,
  finishedAt: Nullable(DateTime),
}, { $id: 'SiteImportView' });
export const SiteImportView = refTo(SiteImportViewSchema);

export const toSiteImportView = (r: typeof siteImport.$inferSelect): Static<typeof SiteImportView> => ({
  id: r.id, status: r.status, sources: r.sources, area: r.area, language: r.language, createSites: r.createSites, progress: r.progress,
  counts: r.counts, findings: r.findings, failureCode: storedProblemCode(r.errorCode),
  createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
});
