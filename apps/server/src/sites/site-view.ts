// A Dive site over HTTP (ADR 0020, 0021): the view the site routes answer.
import { Type, type Static } from 'typebox';
import { SITE_WATER_TYPES } from '../vocabulary.js';
import type { ExternalIdRow, SiteService } from './site-service.js';
import { PositionSchema } from './position-view.js';
import { SITE_SOURCES, SOURCE_INFO } from './sources.js';
import { Nullable, refTo } from '../http/schemas.js';

/** A Source's values for a site, as offered beside a reference. */
const OfferedValues = Type.Object({
  name: Nullable(Type.String()),
  position: Nullable(PositionSchema),
  country: Nullable(Type.String()),
  waterBody: Nullable(Type.String()),
  description: Nullable(Type.String()),
  maxDepthM: Nullable(Type.Number()),
  waterType: Nullable(Type.Enum([...SITE_WATER_TYPES])),
});

const ExternalIdView = Type.Object({
  source: Type.Enum([...SITE_SOURCES]),
  name: Type.String({ description: 'The Source\'s name, e.g. "OpenStreetMap"' }),
  externalId: Type.String({ description: 'e.g. "node/123", "Q42", "3314"' }),
  url: Nullable(Type.String({ description: 'The object\'s page at the Source' })),
  providesData: Type.Boolean({ description: 'The site was created or filled from this Source ("From OpenStreetMap"); otherwise a reference only ("Also in …")' }),
  attribution: Nullable(Type.Object({ text: Type.String(), url: Type.String() }, { description: 'What the Source\'s license asks to show with its data' })),
  offered: Nullable(Type.Object(OfferedValues.properties, {
    description: 'A reference\'s values from its Source, which any User can take up with POST …/adopt (ADR 0025): empty fields take them',
  })),
  privateTo: Nullable(Type.Object({ diverId: Type.String() }, {
    description: 'Set: private to this Diver\'s account at the Source (ADR 0057), seen only by Users who manage the Diver and used only by sends for the Diver. Null: public',
  })),
}, { description: 'Where a site comes from, or where else it is known (ADR 0021)' });

/** Registered with app.addSchema; routes answer SiteView, the reference. */
export const SiteViewSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  position: Nullable(PositionSchema),
  country: Nullable(Type.String()),
  waterBody: Nullable(Type.String()),
  description: Nullable(Type.String()),
  maxDepthM: Nullable(Type.Number({ description: 'Metres' })),
  waterType: Nullable(Type.Enum([...SITE_WATER_TYPES], { description: 'The water type of every Dive at the site (ADR 0025)' })),
  externalIds: Type.Array(ExternalIdView),
  version: Type.Integer({ description: 'Send it back with an edit; it changes with every change' }),
  diveCount: Type.Integer({ description: 'How many of the signed-in User\'s Dives are at the site' }),
  inUse: Type.Boolean({ description: 'Whether any Dive (of any User) is at the site; then it can\'t be deleted' }),
  canDelete: Type.Boolean({ description: 'Whether the signed-in User may delete it: its creator or an admin' }),
  distanceM: Type.Optional(Type.Number({ description: 'Metres from the position asked for (with latitude/longitude)' })),
  mergedInto: Nullable(Type.String({ description: 'Set when this site was merged into another (ADR 0022): open that one instead' })),
}, { $id: 'SiteView' });
export const SiteView = refTo(SiteViewSchema);

const externalIdView = (e: ExternalIdRow) => {
  const info = SOURCE_INFO[e.source];
  return {
    source: e.source, name: info.name, externalId: e.externalId, url: info.link?.(e.externalId) ?? null,
    providesData: e.providesData, attribution: e.providesData ? info.attribution : null,
    offered: e.offered && {
      name: e.offered.name ?? null, position: e.offered.position ?? null, country: e.offered.country ?? null,
      waterBody: e.offered.waterBody ?? null, description: e.offered.description ?? null,
      maxDepthM: e.offered.maxDepthM ?? null, waterType: e.offered.waterType ?? null,
    },
    privateTo: e.privateTo,
  };
};

type Row = Awaited<ReturnType<SiteService['get']>> & { distanceM?: number };
export const toSiteView = ({ site: s, diveCount, inUse, canDelete, externalIds, distanceM }: Row): Static<typeof SiteView> => ({
  id: s.id, name: s.name,
  position: s.latitude === null || s.longitude === null ? null : { latitude: s.latitude, longitude: s.longitude },
  country: s.country, waterBody: s.waterBody, description: s.description, maxDepthM: s.maxDepthM, waterType: s.waterType,
  externalIds: externalIds.map(externalIdView), version: s.version,
  diveCount, inUse, canDelete, mergedInto: s.mergedInto, ...(distanceM !== undefined && { distanceM: Math.round(distanceM) }),
});
