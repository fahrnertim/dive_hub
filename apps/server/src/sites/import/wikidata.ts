// Wikidata through its Query Service (ADR 0021): items that are a recreational dive site (Q2141554) or a
// subclass of one. There are only a few hundred worldwide, so one query fetches them all and the area is
// applied here: one small, cacheable query instead of a different one per country or box.
import type { PoliteHttp } from './polite-http.js';
import { inBox, SiteSourceError, type ImportArea, type SiteSourceAdapter, type SourceSite } from './site-source.js';

export const DEFAULT_WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';

const LANGUAGE = /^[a-z]{2,3}(-[a-z0-9]+)?$/;

/** Labels in `language`, then English; the site's coordinates, country code, body of water and OSM IDs. */
export function wikidataQuery(language: string): string {
  if (!LANGUAGE.test(language)) throw new Error(`not a language code: ${language}`);
  return `SELECT ?item (SAMPLE(?coord_) AS ?coord) (SAMPLE(?iso_) AS ?iso)
  (SAMPLE(?labelLang_) AS ?labelLang) (SAMPLE(?labelEn_) AS ?labelEn) (SAMPLE(?labelAny_) AS ?labelAny)
  (SAMPLE(?waterLang_) AS ?waterLang) (SAMPLE(?waterEn_) AS ?waterEn)
  (SAMPLE(?node_) AS ?node) (SAMPLE(?way_) AS ?way) (SAMPLE(?relation_) AS ?relation)
WHERE {
  ?item wdt:P31/wdt:P279* wd:Q2141554 .
  OPTIONAL { ?item wdt:P625 ?coord_ }
  OPTIONAL { ?item wdt:P17/wdt:P297 ?iso_ }
  OPTIONAL { ?item rdfs:label ?labelLang_ FILTER(LANG(?labelLang_) = "${language}") }
  OPTIONAL { ?item rdfs:label ?labelEn_ FILTER(LANG(?labelEn_) = "en") }
  OPTIONAL { ?item rdfs:label ?labelAny_ }
  OPTIONAL { ?item wdt:P206 ?water .
    OPTIONAL { ?water rdfs:label ?waterLang_ FILTER(LANG(?waterLang_) = "${language}") }
    OPTIONAL { ?water rdfs:label ?waterEn_ FILTER(LANG(?waterEn_) = "en") } }
  OPTIONAL { ?item wdt:P11693 ?node_ }
  OPTIONAL { ?item wdt:P10689 ?way_ }
  OPTIONAL { ?item wdt:P402 ?relation_ }
}
GROUP BY ?item`;
}

export function createWikidataSource(http: PoliteHttp, url = DEFAULT_WIKIDATA_SPARQL_URL): SiteSourceAdapter {
  return {
    source: 'wikidata',
    async fetch(area, language) {
      const text = await http('wikidata', url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
        body: new URLSearchParams({ query: wikidataQuery(language) }).toString(),
      });
      return parseWikidata(text, area);
    },
  };
}

type Binding = Record<string, { value: string } | undefined>;

/** "Point(33.92 27.814166666)": WKT puts longitude first. */
function point(wkt: string | undefined) {
  const match = wkt?.match(/^Point\((-?[\d.]+) (-?[\d.]+)\)$/);
  if (!match) return null;
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

const value = (b: Binding, key: string) => b[key]?.value.trim() || null;

export function parseWikidata(body: string, area: ImportArea): SourceSite[] {
  let bindings: Binding[];
  try {
    const parsed = JSON.parse(body) as { results?: { bindings?: unknown } };
    if (!Array.isArray(parsed.results?.bindings)) throw new Error('no bindings');
    bindings = parsed.results.bindings as Binding[];
  } catch {
    throw new SiteSourceError('wikidata', 'unavailable', body.slice(0, 200));
  }
  return bindings.flatMap((b): SourceSite[] => {
    const id = value(b, 'item')?.split('/').at(-1);
    if (!id || !/^Q[1-9]\d*$/.test(id)) return [];
    const position = point(value(b, 'coord') ?? undefined);
    const iso = value(b, 'iso');
    const country = iso && /^[A-Z]{2}$/.test(iso) ? iso : null;
    if (area.kind === 'country' && country !== area.country) return [];
    if (area.kind === 'box' && !(position && inBox(position, area))) return [];
    const osm = value(b, 'node') ? `node/${value(b, 'node')}` : value(b, 'way') ? `way/${value(b, 'way')}` : value(b, 'relation') ? `relation/${value(b, 'relation')}` : null;
    return [{
      source: 'wikidata',
      externalId: id,
      values: {
        name: value(b, 'labelLang') ?? value(b, 'labelEn') ?? value(b, 'labelAny'),
        position,
        country,
        waterBody: value(b, 'waterLang') ?? value(b, 'waterEn'),
        description: null,
        maxDepthM: null,
        waterType: null,
      },
      sameAs: osm && /^(node|way|relation)\/[1-9]\d*$/.test(osm) ? { osm } : {},
    }];
  });
}
