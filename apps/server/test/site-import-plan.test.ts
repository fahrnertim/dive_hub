// Planning a Site import (ADR 0021, 0025): which incoming objects become which sites, what a re-import may
// change (per field, 3-way, User edits win), and what is skipped, linked or reported.
import { describe, expect, it } from 'vitest';
import { namesMatch, planSiteImport, type ExistingSite } from '../src/sites/import/import-plan.js';
import type { ImportArea, ImportedValues, SourceSite } from '../src/sites/import/site-source.js';

const HOUSE_REEF = { latitude: 28.4950, longitude: 34.5160 };
const metresNorth = (m: number, from = HOUSE_REEF) => ({ latitude: from.latitude + m / 111_195, longitude: from.longitude });

const values = (v: Partial<ImportedValues>): ImportedValues => ({
  name: 'House Reef', position: HOUSE_REEF, country: null, waterBody: null, description: null, maxDepthM: null, waterType: null, ...v,
});
const osm = (id: string, v: Partial<ImportedValues> = {}, wikidata?: string): SourceSite => ({
  source: 'osm', externalId: id, values: values(v), sameAs: wikidata ? { wikidata } : {},
});
const ssi = (id: string, v: Partial<ImportedValues> = {}): SourceSite => ({ source: 'ssi', externalId: id, values: values(v), sameAs: {} });
const wd = (id: string, v: Partial<ImportedValues> = {}, osmId?: string): SourceSite => ({
  source: 'wikidata', externalId: id, values: values(v), sameAs: osmId ? { osm: osmId } : {},
});

/** A site as it is in the hub; `from` lists its External IDs with the values their Source delivered last. */
const site = (id: string, v: Partial<ImportedValues>, from: ExistingSite['externalIds'] = [], deleted = false): ExistingSite => ({
  id, deleted, mergedInto: null, values: values(v), externalIds: from,
});
const fromOsm = (externalId: string, imported: Partial<ImportedValues>) => ({ source: 'osm' as const, externalId, providesData: true, imported: values(imported) });
const fromWd = (externalId: string, imported: Partial<ImportedValues>) => ({ source: 'wikidata' as const, externalId, providesData: true, imported: values(imported) });
const fromSsi = (externalId: string, imported: Partial<ImportedValues>) => ({ source: 'ssi' as const, externalId, providesData: true, imported: values(imported) });
/** An SSI ID a User typed into the site form: a reference without values. */
const typedSsi = (externalId: string) => ({ source: 'ssi' as const, externalId, providesData: false, imported: null });

const WORLD: ImportArea = { kind: 'world' };
const plan = (incoming: SourceSite[], existing: ExistingSite[] = [], sources: ('osm' | 'wikidata' | 'ssi')[] = ['osm', 'wikidata'], area: ImportArea = WORLD, createSites = true) =>
  planSiteImport({ sources, area, incoming, existing, createSites });

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

  it('never re-creates a site merged into another, and never matches it by distance (ADR 0022)', () => {
    const merged = { ...site('s1', {}, [fromOsm('node/1', {})]), mergedInto: 's2' };
    const p = plan([osm('node/1'), osm('node/2', { name: 'House Reef', position: metresNorth(5) })], [merged]);
    expect(p.counts).toMatchObject({ skippedMerged: 1, created: 1 });
    expect(p.creates[0]).toMatchObject({ externalIds: [{ externalId: 'node/2' }], near: null });
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
  it('links a hand-made site close by with the same name as a reference, never changing it, and keeps the offer', () => {
    const handMade = site('s1', { name: 'Hausriff', description: 'Our notes', position: metresNorth(30) });
    const offer = values({ name: 'Hausriff', description: 'OSM text', maxDepthM: 25 });
    const p = plan([osm('node/1', { name: 'Hausriff', description: 'OSM text', maxDepthM: 25 })], [handMade]);
    expect(p.creates).toEqual([]);
    expect(p.updates).toEqual([{
      siteId: 's1', outcome: 'linked', set: {}, kept: [], offers: ['osm'],
      externalIds: [{ source: 'osm', externalId: 'node/1', providesData: false, imported: offer, added: true }],
    }]);
    expect(p.counts).toMatchObject({ linked: 1, offered: 1 });
  });

  it('keeps a reference a reference on later imports, refreshing only its offer', () => {
    const linked = site('s1', { name: 'Hausriff', position: metresNorth(30) }, [{ source: 'osm', externalId: 'node/1', providesData: false, imported: values({ name: 'Hausriff' }) }]);
    const p = plan([osm('node/1', { name: 'Hausriff Nord', maxDepthM: 20 })], [linked]);
    expect(p.updates).toEqual([{
      siteId: 's1', outcome: 'unchanged', set: {}, kept: [], offers: [],
      externalIds: [{ source: 'osm', externalId: 'node/1', providesData: false, imported: values({ name: 'Hausriff Nord', maxDepthM: 20 }), added: false }],
    }]);
    expect(p.counts).toMatchObject({ unchanged: 1, linked: 0, offered: 0 });
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

describe('SSI with the other Sources (ADR 0025)', () => {
  it('makes one site of an OSM object and an SSI site close by with the same name: SSI names it, OSM places it, SSI gives the water type', () => {
    const p = plan([
      osm('node/1', { name: 'Attersee - Wrack Dixie', maxDepthM: 34 }),
      ssi('6102', { name: 'Wrack Dixie', position: metresNorth(12), country: 'AT', waterType: 'fresh' }),
    ], [], ['osm', 'ssi']);
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]!.values).toEqual(values({ name: 'Wrack Dixie', position: HOUSE_REEF, country: 'AT', maxDepthM: 34, waterType: 'fresh' }));
    expect(p.creates[0]!.externalIds.map((e) => `${e.source}:${e.externalId}`)).toEqual(['osm:node/1', 'ssi:6102']);
  });

  it('adds SSI to a site imported from OSM before: its name and water type follow where Users left them', () => {
    const existing = site('s1', { name: 'Attersee - Wrack Dixie' }, [fromOsm('node/1', { name: 'Attersee - Wrack Dixie' })]);
    const p = plan([ssi('6102', { name: 'Wrack Dixie', position: metresNorth(12), waterType: 'fresh' })], [existing], ['ssi']);
    expect(p.updates).toEqual([expect.objectContaining({
      siteId: 's1', outcome: 'updated', set: { name: 'Wrack Dixie', waterType: 'fresh' },
      externalIds: [expect.objectContaining({ source: 'ssi', externalId: '6102', providesData: true, added: true })],
    })]);
  });

  it('turns an SSI ID a User typed on an imported site into one that provides data', () => {
    const existing = site('s1', { name: 'Hausreef' }, [fromOsm('node/1', { name: 'Hausreef' }), typedSsi('3314')]);
    const p = plan([ssi('3314', { name: 'Hausreef', country: 'EG', waterType: 'salt' })], [existing], ['ssi']);
    expect(p.updates).toEqual([{
      siteId: 's1', outcome: 'updated', set: { country: 'EG', waterType: 'salt' }, kept: [], offers: [],
      externalIds: [{ source: 'ssi', externalId: '3314', providesData: true, imported: values({ name: 'Hausreef', country: 'EG', waterType: 'salt' }), added: false }],
    }]);
  });

  it("leaves an SSI ID a User typed on a hand-made site a reference, and offers SSI's data once", () => {
    const handMade = site('s1', { name: 'Unser Hausriff' }, [typedSsi('3314')]);
    const first = plan([ssi('3314', { name: 'Hausreef', waterType: 'salt' })], [handMade], ['ssi']);
    expect(first.updates).toEqual([{
      siteId: 's1', outcome: 'unchanged', set: {}, kept: [], offers: ['ssi'],
      externalIds: [{ source: 'ssi', externalId: '3314', providesData: false, imported: values({ name: 'Hausreef', waterType: 'salt' }), added: false }],
    }]);
    expect(first.counts.offered).toBe(1);
    const offered = site('s1', { name: 'Unser Hausriff' }, [{ ...typedSsi('3314'), imported: values({ name: 'Hausreef', waterType: 'salt' }) }]);
    expect(plan([ssi('3314', { name: 'Hausreef', waterType: 'salt' })], [offered], ['ssi']).counts.offered).toBe(0);
  });

  it('merges the water type per field: it follows SSI unless a User changed it', () => {
    const untouched = site('s1', { name: 'Blue Hole', waterType: 'salt' }, [fromSsi('7006', { name: 'Blue Hole', waterType: 'salt' })]);
    const changed = site('s2', { name: 'Cenote', waterType: 'brackish', position: metresNorth(5000) }, [fromSsi('7010', { name: 'Cenote', position: metresNorth(5000), waterType: 'fresh' })]);
    const p = plan([
      ssi('7006', { name: 'Blue Hole', waterType: 'brackish' }),
      ssi('7010', { name: 'Cenote', position: metresNorth(5000), waterType: 'salt' }),
    ], [untouched, changed], ['ssi']);
    expect(p.updates.find((u) => u.siteId === 's1')).toMatchObject({ outcome: 'updated', set: { waterType: 'brackish' } });
    expect(p.updates.find((u) => u.siteId === 's2')).toMatchObject({ outcome: 'kept', set: {}, kept: ['waterType'] });
  });

  it('reads values stored before the water type existed as having none, so nothing changes', () => {
    const { waterType: _, ...old } = values({ name: 'Lighthouse' });
    const existing = site('s1', { name: 'Lighthouse' }, [{ source: 'osm', externalId: 'node/1', providesData: true, imported: old as ImportedValues }]);
    expect(plan([osm('node/1', { name: 'Lighthouse' })], [existing]).updates[0]).toMatchObject({ outcome: 'unchanged', set: {} });
  });

  it('creates no sites when asked not to, but still fills and links those in the hub', () => {
    const imported = site('s1', { name: 'Lighthouse' }, [fromOsm('node/1', { name: 'Lighthouse' })]);
    const p = plan([
      ssi('1', { name: 'Lighthouse', position: metresNorth(20), waterType: 'salt' }),
      ssi('2', { name: 'Canyon', position: metresNorth(5000) }),
    ], [imported], ['ssi'], WORLD, false);
    expect(p.creates).toEqual([]);
    expect(p.updates).toEqual([expect.objectContaining({ siteId: 's1', set: { waterType: 'salt' } })]);
    expect(p.counts).toMatchObject({ created: 0, skippedNew: 1, updated: 1 });
  });

  it('plans a worldwide run of tens of thousands of sites in seconds, not minutes', () => {
    const at = (i: number, north = 0) => ({ latitude: -60 + (i % 1200) * 0.1 + north, longitude: -170 + Math.floor(i / 1200) * 13 });
    const many = Array.from({ length: 30_000 }, (_, i) => ssi(String(i + 1), { name: `Site ${i}`, position: at(i) }));
    const existing = Array.from({ length: 3_000 }, (_, i) => site(`s${i}`, { name: `Site ${i * 10}`, position: at(i * 10, 0.0002) }));
    const started = performance.now();
    const p = plan(many, existing, ['ssi']);
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(p.counts).toMatchObject({ linked: 3_000, created: 27_000 });
  });
});
