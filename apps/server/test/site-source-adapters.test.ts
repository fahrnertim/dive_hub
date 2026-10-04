// The open Sources a Site import reads (ADR 0021), replaying answers recorded from the live services
// (test/fixtures/site-sources, refreshed by record.ts); tests never call Overpass or Wikidata.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createOverpassSource } from '../src/sites/import/overpass.js';
import { createPoliteHttp, type Fetch } from '../src/sites/import/polite-http.js';
import { SiteSourceError } from '../src/sites/import/site-source.js';
import { createWikidataSource } from '../src/sites/import/wikidata.js';

const recorded = (file: string) => readFileSync(new URL(`./fixtures/site-sources/${file}`, import.meta.url), 'utf8');

interface Sent { url: string; method: string; headers: Record<string, string>; body: string }

/** A stand-in for the network: answers each request with the next of `answers`, and keeps what was sent. */
function replay(...answers: { status?: number; body: string; headers?: Record<string, string> }[]) {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body ?? '' });
    const answer = answers[Math.min(sent.length, answers.length) - 1]!;
    return {
      status: answer.status ?? 200,
      headers: { get: (name: string) => answer.headers?.[name.toLowerCase()] ?? null },
      text: async () => answer.body,
    };
  };
  const pauses: number[] = [];
  const http = createPoliteHttp({ fetch, contact: 'ops@example.org', sleep: async (ms) => { pauses.push(ms); } });
  return { http, sent, pauses };
}

const query = (s: Sent, key: string) => new URLSearchParams(s.body).get(key) ?? '';
const overpassAnswer = (elements: object[]) => JSON.stringify({ version: 0.6, elements });

describe('OpenStreetMap through Overpass', () => {
  it('asks once for the dive spots in a country, saying who is asking', async () => {
    const net = replay({ body: recorded('overpass-country-MT.json') });
    const sites = await createOverpassSource(net.http, 'https://overpass.example/api/interpreter').fetch({ kind: 'country', country: 'MT' }, 'en');

    expect(net.sent).toHaveLength(1);
    expect(net.sent[0]).toMatchObject({ url: 'https://overpass.example/api/interpreter', method: 'POST' });
    expect(net.sent[0]!.headers['User-Agent']).toBe('DiveHub (+https://github.com/fahrnertim/dive_hub; ops@example.org)');
    expect(query(net.sent[0]!, 'data')).toContain('area["ISO3166-1"="MT"][admin_level=2]');
    expect(query(net.sent[0]!, 'data')).toContain('"scuba_diving:divespot"="yes"');

    expect(sites).toHaveLength(36);
    expect(sites.find((s) => s.externalId === 'node/4159831401')).toEqual({
      source: 'osm', externalId: 'node/4159831401', sameAs: {},
      // scuba_diving:depth is the typical depth, not the maximum (OSM wiki).
      values: { name: 'Ras il-Ħobż', position: { latitude: 36.0156263, longitude: 14.2793976 }, country: 'MT', waterBody: null, description: null, maxDepthM: null },
    });
  });

  it('places ways and relations at their centre and keeps their link to Wikidata', async () => {
    const net = replay({ body: recorded('overpass-country-EG.json') });
    const sites = await createOverpassSource(net.http).fetch({ kind: 'country', country: 'EG' }, 'en');
    expect(sites.find((s) => s.externalId === 'way/644356549')).toMatchObject({
      sameAs: { wikidata: 'Q1333272' },
      values: { name: 'Elphinstone Reef', position: { latitude: 25.3093037, longitude: 34.8607108 }, country: 'EG' },
    });
    expect(sites.map((s) => s.externalId)).toContain('relation/19266691');
  });

  it('gives sites in a box no country (the box may cross borders)', async () => {
    const net = replay({ body: recorded('overpass-box-attersee.json') });
    const sites = await createOverpassSource(net.http).fetch({ kind: 'box', south: 47.75, west: 13.45, north: 47.95, east: 13.62 }, 'de');
    expect(query(net.sent[0]!, 'data')).toContain('(47.75,13.45,47.95,13.62)');
    expect(sites).toHaveLength(24);
    expect(sites.every((s) => s.values.country === null)).toBe(true);
    expect(sites.find((s) => s.externalId === 'node/437310417')?.values.name).toBe('Attersee - Wrack Dixie');
  });

  it('asks for every dive spot when importing everywhere', async () => {
    const net = replay({ body: overpassAnswer([]) });
    await createOverpassSource(net.http).fetch({ kind: 'world' }, 'en');
    expect(query(net.sent[0]!, 'data')).toMatch(/nwr\["scuba_diving:divespot"="yes"\];/);
  });

  it('reads the maximum depth only where it is clear, and the description', async () => {
    const node = (id: number, tags: Record<string, string>) => ({ type: 'node', id, lat: 1, lon: 2, tags: { name: `Spot ${id}`, ...tags } });
    const net = replay({ body: overpassAnswer([
      node(1, { 'scuba_diving:maxdepth': '30' }),
      node(2, { 'scuba_diving:maxdepth': '18,5 m' }),
      node(3, { 'scuba_diving:maxdepth': '40 metres' }),
      node(4, { 'scuba_diving:maxdepth': '-40M' }),
      node(5, { 'scuba_diving:maxdepth': '100 ft' }),
      node(6, { 'scuba_diving:maxdepth': '>30' }),
      node(7, { 'scuba_diving:maxdepth': '12;18' }),
      node(8, { 'scuba_diving:depth': '5-30', depth: '12' }),
      node(9, { 'scuba_diving:maxdepth': '9000' }),
      node(10, { description: '  Shore entry by the steps.  ' }),
    ]) });
    const sites = await createOverpassSource(net.http).fetch({ kind: 'world' }, 'en');
    const depth = Object.fromEntries(sites.map((s) => [s.externalId, s.values.maxDepthM]));
    expect(depth).toEqual({
      'node/1': 30, 'node/2': 18.5, 'node/3': 40, 'node/4': 40, 'node/5': 30.48,
      'node/6': null, 'node/7': null, 'node/8': null, 'node/9': null, 'node/10': null,
    });
    expect(sites.find((s) => s.externalId === 'node/10')?.values.description).toBe('Shore entry by the steps.');
  });

  it('keeps unnamed spots as nameless (the import skips and counts them)', async () => {
    const net = replay({ body: overpassAnswer([{ type: 'node', id: 7, lat: 1, lon: 2, tags: { 'scuba_diving:divespot': 'yes' } }]) });
    const [site] = await createOverpassSource(net.http).fetch({ kind: 'world' }, 'en');
    expect(site?.values.name).toBeNull();
  });

  it('waits as asked and tries once more when the server is busy', async () => {
    const net = replay({ status: 429, body: 'busy', headers: { 'retry-after': '12' } }, { body: overpassAnswer([]) });
    await expect(createOverpassSource(net.http).fetch({ kind: 'world' }, 'en')).resolves.toEqual([]);
    expect(net.sent).toHaveLength(2);
    expect(net.pauses).toEqual([12_000]);
  });

  it('pauses 30 seconds without Retry-After, and gives up after the second refusal', async () => {
    const net = replay({ status: 429, body: 'busy' });
    const failure = createOverpassSource(net.http).fetch({ kind: 'world' }, 'en');
    await expect(failure).rejects.toBeInstanceOf(SiteSourceError);
    await expect(failure).rejects.toMatchObject({ source: 'osm', reason: 'rate_limited' });
    expect(net.pauses).toEqual([30_000]);
    expect(net.sent).toHaveLength(2);
  });

  it('treats the HTML page an overloaded Overpass sends as unavailable', async () => {
    const page = '<?xml version="1.0"?><html><body><p><strong>Error</strong>: runtime error: Dispatcher_Client::request_read_and_idx::timeout</p></body></html>';
    const net = replay({ body: page });
    await expect(createOverpassSource(net.http).fetch({ kind: 'world' }, 'en')).rejects.toMatchObject({ source: 'osm', reason: 'unavailable' });
  });
});

describe('Wikidata through its Query Service', () => {
  it('asks once for every dive site item, with labels in the chosen language', async () => {
    const net = replay({ body: recorded('wikidata-en.json') });
    await createWikidataSource(net.http, 'https://wdqs.example/sparql').fetch({ kind: 'world' }, 'de');
    expect(net.sent).toHaveLength(1);
    expect(net.sent[0]).toMatchObject({ url: 'https://wdqs.example/sparql', method: 'POST' });
    expect(net.sent[0]!.headers['User-Agent']).toContain('ops@example.org');
    expect(query(net.sent[0]!, 'query')).toContain('wd:Q2141554');
    expect(query(net.sent[0]!, 'query')).toContain('"de"');
  });

  it('keeps the items of a country, with position and OSM link', async () => {
    const net = replay({ body: recorded('wikidata-en.json') });
    const sites = await createWikidataSource(net.http).fetch({ kind: 'country', country: 'EG' }, 'en');
    expect(sites).toHaveLength(17);
    expect(sites.find((s) => s.externalId === 'Q32276')).toEqual({
      source: 'wikidata', externalId: 'Q32276', sameAs: { osm: 'node/255316037' },
      values: { name: 'SS Thistlegorm', position: { latitude: 27.814166666, longitude: 33.92 }, country: 'EG', waterBody: null, description: null, maxDepthM: null },
    });
    expect(sites.find((s) => s.externalId === 'Q335216')?.sameAs).toEqual({ osm: 'relation/16662777' });
  });

  it('keeps the items inside a box, by their position', async () => {
    const net = replay({ body: recorded('wikidata-en.json') });
    // The Gulf of Suez west of 33.9° E: Kingston and Shag Rock; Thistlegorm (33.92° E) lies just outside.
    const sites = await createWikidataSource(net.http).fetch({ kind: 'box', south: 27.7, west: 33.8, north: 27.9, east: 33.9 }, 'en');
    expect(sites.map((s) => s.values.name).sort()).toEqual(['Kingston', 'Shag Rock']);
  });

  it('keeps every item, also those without position, when importing everywhere', async () => {
    const net = replay({ body: recorded('wikidata-en.json') });
    const sites = await createWikidataSource(net.http).fetch({ kind: 'world' }, 'en');
    expect(sites).toHaveLength(345);
    expect(sites.find((s) => s.externalId === 'Q109467089')?.values).toMatchObject({ name: 'סלע משה', position: null, country: 'IL' });
  });

  it('takes the body of water and falls back from the chosen language to English, then any label', async () => {
    const net = replay({ body: recorded('wikidata-en.json') });
    const sites = await createWikidataSource(net.http).fetch({ kind: 'world' }, 'en');
    expect(sites.find((s) => s.externalId === 'Q990992')?.values).toMatchObject({ name: 'Brouwersdam', waterBody: 'North Sea', country: null });
    // No English label: the label in any language.
    expect(sites.find((s) => s.externalId === 'Q126486432')?.values.name).toBe('Sites de plongée au Cape Peninsula (False Bay/Off-Super Fan Reef)');

    const binding = (vars: Record<string, string>) => Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, { type: 'literal', value: v }]));
    const german = replay({ body: JSON.stringify({ head: { vars: [] }, results: { bindings: [
      { ...binding({ labelLang: 'Blaue Grotte', labelEn: 'Blue Cave', waterEn: 'East China Sea', waterLang: 'Ostchinesisches Meer' }), item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q1' } },
      { ...binding({ labelEn: 'Blue Cave', waterEn: 'East China Sea' }), item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q2' } },
    ] } }) });
    const named = await createWikidataSource(german.http).fetch({ kind: 'world' }, 'de');
    expect(named.map((s) => [s.values.name, s.values.waterBody])).toEqual([['Blaue Grotte', 'Ostchinesisches Meer'], ['Blue Cave', 'East China Sea']]);
  });

  it('refuses an answer that is not a query result', async () => {
    const net = replay({ body: 'java.util.concurrent.TimeoutException' });
    await expect(createWikidataSource(net.http).fetch({ kind: 'world' }, 'en')).rejects.toMatchObject({ source: 'wikidata', reason: 'unavailable' });
  });
});
