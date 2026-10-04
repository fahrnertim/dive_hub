// Where a Dive site comes from (ADR 0021): the Sources it was created or filled from ("From
// OpenStreetMap", with the Attribution its license asks for), and those it is only known at ("Also in").
// The SSI site ID is a field of its own, not an origin.
import type { ExternalIdView } from '../api.ts';

export function siteOrigin(externalIds: ExternalIdView[]) {
  const imported = externalIds.filter((e) => e.source !== 'ssi');
  return { from: imported.filter((e) => e.providesData), alsoIn: imported.filter((e) => !e.providesData) };
}

/** Whether a list shows any site with OpenStreetMap data, so it must carry OSM's Attribution once. */
export const needsOsmAttribution = (sites: { externalIds: ExternalIdView[] }[]) =>
  sites.some((s) => s.externalIds.some((e) => e.source === 'osm' && e.providesData));
