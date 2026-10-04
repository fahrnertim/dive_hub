// Planning a Site import (ADR 0021): which incoming objects become which sites, what a re-import may
// change (per field, 3-way, User edits win), and what is skipped, linked or reported.
import { describe, expect, it } from 'vitest';
import { namesMatch, planSiteImport, type ExistingSite } from '../src/sites/import/import-plan.js';
import type { ImportArea, ImportedValues, SourceSite } from '../src/sites/import/site-source.js';

const HOUSE_REEF = { latitude: 28.4950, longitude: 34.5160 };
const metresNorth = (m: number, from = HOUSE_REEF) => ({ latitude: from.latitude + m / 111_195, longitude: from.longitude });

const values = (v: Partial<ImportedValues>): ImportedValues => ({
  name: 'House Reef', position: HOUSE_REEF, country: null, waterBody: null, description: null, maxDepthM: null, ...v,
});
const osm = (id: string, v: Partial<ImportedValues> = {}, wikidata?: string): SourceSite => ({
  source: 'osm', externalId: id, values: values(v), sameAs: wikidata ? { wikidata } : {},
});
const wd = (id: string, v: Partial<ImportedValues> = {}, osmId?: string): SourceSite => ({
  source: 'wikidata', externalId: id, values: values(v), sameAs: osmId ? { osm: osmId } : {},
});

/** A site as it is in the hub; `from` lists its External IDs with the values their Source delivered last. */
const site = (id: string, v: Partial<ImportedValues>, from: ExistingSite['externalIds'] = [], deleted = false): ExistingSite => ({
  id, deleted, values: values(v), externalIds: from,
});
const fromOsm = (externalId: string, imported: Partial<ImportedValues>) => ({ source: 'osm' as const, externalId, providesData: true, imported: values(imported) });
const fromWd = (externalId: string, imported: Partial<ImportedValues>) => ({ source: 'wikidata' as const, externalId, providesData: true, imported: values(imported) });

const WORLD: ImportArea = { kind: 'world' };
const plan = (incoming: SourceSite[], existing: ExistingSite[] = [], sources: ('osm' | 'wikidata')[] = ['osm', 'wikidata'], area: ImportArea = WORLD) =>
  planSiteImport({ sources, area, incoming, existing });

describe('a first import', () => {
  it('creates a site per object, filled from its Source', () => {
    const p = plan([osm('node/1', { name: 'Lighthouse', maxDepthM: 30, description: 'Shore entry' })]);
    expect(p.creates).toEqual([{
      values: values({ name: 'Lighthouse', maxDepthM: 30, description: 'Shore entry' }),
      externalIds: [{ source: 'osm', externalId: 'node/1', imported: values({ name: 'Lighthouse', maxDepthM: 30, description: 'Shore entry' }) }],
      near: null,
    }]);
    expect(p.counts).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
  });

  it('skips objects without a name and counts them', () => {
    const p = plan([osm('node/1', { name: null }), osm('node/2', { name: 'Canyon', position: metresNorth(5000) })]);
    expect(p.creates.map((c) => c.values.name)).toEqual(['Canyon']);
    expect(p.counts.skippedNoName).toBe(1);
  });
});

describe('a re-import', () => {
  it('leaves a site alone when nothing changed at the Source', () => {
    const existing = site('s1', { name: 'Lighthouse' }, [fromOsm('node/1', { name: 'Lighthouse' })]);
    const p = plan([osm('node/1', { name: 'Lighthouse' })], [existing]);
    expect(p.creates).toEqual([]);
    expect(p.updates).toEqual([expect.objectContaining({ siteId: 's1', set: {}, outcome: 'unchanged' })]);
    expect(p.counts).toMatchObject({ unchanged: 1, updated: 0 });
  });

  it('follows the Source in fields Users left alone, and keeps the fields they changed', () => {
    // A User fixed the name; meanwhile OSM moved the spot and added a depth.
    const existing = site('s1', { name: 'Lighthouse Reef' }, [fromOsm('node/1', { name: 'Lighthouse' })]);
    const moved = metresNorth(40);
    const p = plan([osm('node/1', { name: 'Lighthouse (north)', position: moved, maxDepthM: 28 })], [existing]);
    expect(p.updates).toEqual([expect.objectContaining({
      siteId: 's1', outcome: 'updated', set: { position: moved, maxDepthM: 28 }, kept: ['name'],
    })]);
  });

  it('keeps a site whose only changes at the Source are in fields Users changed', () => {
    const existing = site('s1', { name: 'Lighthouse Reef' }, [fromOsm('node/1', { name: 'Lighthouse' })]);
    const p = plan([osm('node/1', { name: 'Lighthouse (north)' })], [existing]);
    expect(p.updates).toEqual([expect.objectContaining({ siteId: 's1', outcome: 'kept', set: {}, kept: ['name'] })]);
    expect(p.counts).toMatchObject({ kept: 1, updated: 0 });
  });

  it('remembers what the Source delivered, also when nothing changes in the hub', () => {
    const existing = site('s1', { name: 'Lighthouse Reef' }, [fromOsm('node/1', { name: 'Lighthouse' })]);
    const p = plan([osm('node/1', { name: 'Lighthouse (north)' })], [existing]);
    expect(p.updates[0]!.externalIds).toEqual([{ source: 'osm', externalId: 'node/1', providesData: true, imported: values({ name: 'Lighthouse (north)' }), added: false }]);
  });

  it('never re-creates a site deleted in the hub', () => {
    const deleted = site('s1', {}, [fromOsm('node/1', {})], true);
    const p = plan([osm('node/1')], [deleted]);
    expect(p.creates).toEqual([]);
    expect(p.updates).toEqual([]);
    expect(p.counts.skippedDeleted).toBe(1);
  });

  it('counts objects gone from the Source within the area, and changes nothing about them', () => {
    const malta: ImportArea = { kind: 'country', country: 'MT' };
    const gone = site('s1', { name: 'Old Pier', country: 'MT' }, [fromOsm('node/1', { name: 'Old Pier', country: 'MT' })]);
    const elsewhere = site('s2', { name: 'Blue Hole', country: 'EG' }, [fromOsm('node/2', { name: 'Blue Hole', country: 'EG' })]);
    const p = plan([], [gone, elsewhere], ['osm'], malta);
    expect(p.counts.gone).toBe(1);
    expect(p.updates).toEqual([]);
  });

  it('counts nothing as gone from a Source that was not asked', () => {
    const fromWikidata = site('s1', {}, [fromWd('Q1', {})]);
    expect(plan([], [fromWikidata], ['osm']).counts.gone).toBe(0);
  });
});

describe('OpenStreetMap and Wikidata describing the same place', () => {
  it('makes one site when the OSM object names the Wikidata item; OSM wins where both have a value', () => {
    const p = plan([
      osm('node/1', { name: 'Vortex Spring', maxDepthM: 35 }, 'Q9'),
      wd('Q9', { name: 'Vortex Springs', position: metresNorth(300), waterBody: 'Vortex Spring lake', country: 'US' }),
    ]);
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]!.values).toEqual(values({ name: 'Vortex Spring', maxDepthM: 35, waterBody: 'Vortex Spring lake', country: 'US' }));
    expect(p.creates[0]!.externalIds.map((e) => `${e.source}:${e.externalId}`)).toEqual(['osm:node/1', 'wikidata:Q9']);
  });

  it('makes one site when the Wikidata item names the OSM object', () => {
    const p = plan([osm('way/7', { name: 'Thistlegorm' }), wd('Q32276', { name: 'SS Thistlegorm', position: metresNorth(900) }, 'way/7')]);
    expect(p.creates).toHaveLength(1);
  });

  it('adds a newly linked Wikidata item to a site imported from OSM before, filling what OSM lacks', () => {
    const existing = site('s1', { name: 'Thistlegorm' }, [fromOsm('way/7', { name: 'Thistlegorm' })]);
    const p = plan([wd('Q32276', { name: 'SS Thistlegorm', waterBody: 'Red Sea', country: 'EG' }, 'way/7')], [existing], ['wikidata']);
    expect(p.updates).toEqual([expect.objectContaining({
      siteId: 's1', outcome: 'updated', set: { waterBody: 'Red Sea', country: 'EG' },
      externalIds: [{ source: 'wikidata', externalId: 'Q32276', providesData: true, imported: values({ name: 'SS Thistlegorm', waterBody: 'Red Sea', country: 'EG' }), added: true }],
    })]);
  });

  it('matches within 100 m when the names are the same after normalising', () => {
    const p = plan([osm('node/1', { name: 'Vortex Spring (Dive Site)' }), wd('Q2', { name: 'vortex spring', position: metresNorth(96) })]);
    expect(p.creates).toHaveLength(1);
  });

  it('keeps two sites when they are further apart than 100 m, or named differently', () => {
    expect(plan([osm('node/1', { name: 'Countess of Erne' }), wd('Q3', { name: 'Countess of Erne', position: metresNorth(171) })]).creates).toHaveLength(2);
    expect(plan([osm('node/1', { name: 'Bergse Diepsluis' }), wd('Q4', { name: 'Oesterdam', position: metresNorth(13) })]).creates).toHaveLength(2);
  });

  it('does not let a Wikidata-only run override a name OSM provides', () => {
    const both = site('s1', { name: 'Elphinstone Reef' }, [fromOsm('way/1', { name: 'Elphinstone Reef' }), fromWd('Q5', { name: 'Elphinstone' })]);
    const p = plan([wd('Q5', { name: 'Elphinstone Reef (Marsa Alam)' })], [both], ['wikidata']);
    expect(p.updates).toEqual([expect.objectContaining({ siteId: 's1', set: {}, outcome: 'unchanged' })]);
  });
});

describe('sites already in the hub', () => {
  it('links a hand-made site close by with the same name as a reference only, never changing it', () => {
    const handMade = site('s1', { name: 'Hausriff', description: 'Our notes', position: metresNorth(30) });
    const p = plan([osm('node/1', { name: 'Hausriff', description: 'OSM text', maxDepthM: 25 })], [handMade]);
    expect(p.creates).toEqual([]);
    expect(p.updates).toEqual([{
      siteId: 's1', outcome: 'linked', set: {}, kept: [],
      externalIds: [{ source: 'osm', externalId: 'node/1', providesData: false, imported: null, added: true }],
    }]);
    expect(p.counts.linked).toBe(1);
  });

  it('keeps a reference a reference on later imports, changing nothing', () => {
    const linked = site('s1', { name: 'Hausriff', position: metresNorth(30) }, [{ source: 'osm', externalId: 'node/1', providesData: false, imported: null }]);
    const p = plan([osm('node/1', { name: 'Hausriff Nord', maxDepthM: 20 })], [linked]);
    expect(p.updates).toEqual([{
      siteId: 's1', outcome: 'unchanged', set: {}, kept: [],
      externalIds: [{ source: 'osm', externalId: 'node/1', providesData: false, imported: null, added: false }],
    }]);
    expect(p.counts).toMatchObject({ unchanged: 1, linked: 0 });
  });

  it('creates a new site near a hand-made one with another name, and reports it', () => {
    const handMade = site('s1', { name: 'Hausriff', position: metresNorth(150) });
    const p = plan([osm('node/1', { name: 'Lighthouse' })], [handMade]);
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]!.near).toEqual({ siteId: 's1', name: 'Hausriff', distanceM: 150 });
  });

  it('does not report sites further than 200 m away', () => {
    const handMade = site('s1', { name: 'Hausriff', position: metresNorth(250) });
    expect(plan([osm('node/1', { name: 'Lighthouse' })], [handMade]).creates[0]!.near).toBeNull();
  });

  it('never gives a site a second ID from the same Source', () => {
    const imported = site('s1', { name: 'Nöhmer' }, [fromOsm('node/1', { name: 'Nöhmer' })]);
    const p = plan([osm('node/1', { name: 'Nöhmer' }), osm('node/2', { name: 'Attersee - Nöhmer', position: metresNorth(20) })], [imported]);
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]!.externalIds[0]!.externalId).toBe('node/2');
    expect(p.creates[0]!.near).toMatchObject({ siteId: 's1' });
  });

  it('ignores deleted sites when matching by distance', () => {
    const deleted = site('s1', { name: 'Hausriff', position: metresNorth(10) }, [], true);
    const p = plan([osm('node/1', { name: 'Hausriff' })], [deleted]);
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]!.near).toBeNull();
  });
});

describe('names that match', () => {
  it.each([
    ['Vortex Spring', 'vortex spring'],
    ['Bottleneck Cave (Dive Site)', 'Bottleneck Cave'],
    ['Tauchplatz Steinwand', 'Steinwand'],
    ['Il-Ħofra tal-Bidwin', 'Il-Hofra tal Bidwin'],
    ['Attersee - Nöhmer', 'Nöhmer'],
  ])('%s ≈ %s', (a, b) => expect(namesMatch(a, b)).toBe(true));

  it.each([
    ['Oesterdam', 'Bergse Diepsluis'],
    ['Reef', 'House Reef North'],
    ['Dive Site', 'Tauchplatz'],
  ])('%s ≠ %s', (a, b) => expect(namesMatch(a, b)).toBe(false));
});
