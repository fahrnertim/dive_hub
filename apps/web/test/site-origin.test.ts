import { describe, expect, it } from 'vitest';
import { needsOsmAttribution, siteOrigin } from '../src/lib/site-origin.ts';

const osm = { source: 'osm' as const, name: 'OpenStreetMap', externalId: 'node/1', url: 'https://www.openstreetmap.org/node/1', providesData: true, attribution: { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' } };
const wikidata = { source: 'wikidata' as const, name: 'Wikidata', externalId: 'Q1', url: 'https://www.wikidata.org/wiki/Q1', providesData: false, attribution: null };
const ssi = { source: 'ssi' as const, name: 'SSI', externalId: '3314', url: null, providesData: false, attribution: null };

describe('where a site comes from (ADR 0021)', () => {
  it('separates the Sources it was filled from, the ones it is only known at, and the SSI ID', () => {
    expect(siteOrigin([osm, wikidata, ssi])).toEqual({ from: [osm], alsoIn: [wikidata] });
  });

  it('says nothing for a site made here', () => {
    expect(siteOrigin([ssi])).toEqual({ from: [], alsoIn: [] });
  });

  it('asks for the OSM Attribution only where OSM data is shown', () => {
    expect(needsOsmAttribution([{ externalIds: [osm] }])).toBe(true);
    expect(needsOsmAttribution([{ externalIds: [{ ...osm, providesData: false, attribution: null }] }, { externalIds: [] }])).toBe(false);
  });
});
