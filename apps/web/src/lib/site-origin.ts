// Where a Dive site comes from (ADR 0021, 0025): the Sources it was created or filled from ("From
// OpenStreetMap", with the Attribution its license asks for; "From SSI", without a link), and those it is only
// known at ("Also in"), which may offer their data. A typed SSI site ID without an offer is a field of its own,
// not an origin.
import type { ExternalIdView } from '../api.ts';

export function siteOrigin(externalIds: ExternalIdView[]) {
  return {
    from: externalIds.filter((e) => e.providesData),
    alsoIn: externalIds.filter((e) => !e.providesData && (e.source !== 'ssi' || e.offered)),
  };
}

/** Whether a list shows any site with OpenStreetMap data, so it must carry OSM's Attribution once. */
export const needsOsmAttribution = (sites: { externalIds: ExternalIdView[] }[]) =>
  sites.some((s) => s.externalIds.some((e) => e.source === 'osm' && e.providesData));
