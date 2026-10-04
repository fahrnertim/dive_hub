// OpenStreetMap through the Overpass API (ADR 0021): objects tagged scuba_diving:divespot=yes.
import type { PoliteHttp } from './polite-http.js';
import { SiteSourceError, type ImportArea, type SiteSourceAdapter, type SourceSite } from './site-source.js';

export const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** One query per run; the server-side timeout keeps a slow answer from holding a slot forever. */
export function overpassQuery(area: ImportArea): string {
  const filter = 'nwr["scuba_diving:divespot"="yes"]';
  const body = area.kind === 'country'
    // A country's boundary in OSM includes its territorial waters.
    ? `area["ISO3166-1"="${area.country}"][admin_level=2]->.country;\n${filter}(area.country);`
    : area.kind === 'box' ? `${filter}(${area.south},${area.west},${area.north},${area.east});` : `${filter};`;
  return `[out:json][timeout:180];\n${body}\nout center tags;`;
}

export function createOverpassSource(http: PoliteHttp, url = DEFAULT_OVERPASS_URL): SiteSourceAdapter {
  return {
    source: 'osm',
    async fetch(area) {
      const text = await http('osm', url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ data: overpassQuery(area) }).toString(),
      });
      return parseOverpass(text, area);
    },
  };
}

interface Element {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const METRES_PER_FOOT = 0.3048;
/** Deeper than any recreational or technical dive site; anything beyond is a mistake in the data. */
const MAX_SITE_DEPTH_M = 400;

/**
 * `scuba_diving:maxdepth` in metres where it is clear: "30", "18,5 m", "40 metres", "-40M", "100 ft".
 * Lists ("12;18"), bounds (">30") and anything else are left out rather than guessed.
 */
export function parseMaxDepth(value: string | undefined): number | null {
  const match = value?.trim().match(/^-?(\d+(?:[.,]\d+)?)\s*(m|metres?|meters?|ft|feet)?$/i);
  if (!match) return null;
  const number = Number(match[1]!.replace(',', '.'));
  const metres = /^f/i.test(match[2] ?? '') ? Math.round(number * METRES_PER_FOOT * 100) / 100 : number;
  return metres > 0 && metres <= MAX_SITE_DEPTH_M ? metres : null;
}

const text = (v: string | undefined) => v?.trim() || null;

export function parseOverpass(body: string, area: ImportArea): SourceSite[] {
  let elements: Element[];
  try {
    const parsed = JSON.parse(body) as { elements?: unknown };
    if (!Array.isArray(parsed.elements)) throw new Error('no elements');
    elements = parsed.elements as Element[];
  } catch {
    // An overloaded Overpass answers with an HTML page, sometimes with status 200.
    throw new SiteSourceError('osm', 'unavailable', body.slice(0, 200));
  }
  return elements.flatMap((e) => {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const tags = e.tags ?? {};
    const wikidata = tags.wikidata?.trim();
    return [{
      source: 'osm' as const,
      externalId: `${e.type}/${e.id}`,
      values: {
        name: text(tags.name),
        position: lat === undefined || lon === undefined ? null : { latitude: lat, longitude: lon },
        country: area.kind === 'country' ? area.country : null,
        waterBody: null,
        description: text(tags.description),
        maxDepthM: parseMaxDepth(tags['scuba_diving:maxdepth']),
      },
      sameAs: wikidata && /^Q[1-9]\d*$/.test(wikidata) ? { wikidata } : {},
    }];
  });
}
