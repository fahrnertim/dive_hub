// Records the answers of Overpass and the Wikidata Query Service that the Site import tests replay
// (ADR 0021: tests never call the live services). Run by hand when the queries change:
//   pnpm --filter @dive-hub/server exec tsx test/fixtures/site-sources/record.ts
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPoliteHttp } from '../../../src/sites/import/polite-http.js';
import { DEFAULT_OVERPASS_URL, overpassQuery } from '../../../src/sites/import/overpass.js';
import type { ImportArea } from '../../../src/sites/import/site-source.js';
import { DEFAULT_WIKIDATA_SPARQL_URL, wikidataQuery } from '../../../src/sites/import/wikidata.js';

const http = createPoliteHttp({ contact: process.env.DIVEHUB_CONTACT });
const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));
/** Same order and indentation every time, so a refresh shows as a readable diff. */
const pretty = (text: string) => `${JSON.stringify(JSON.parse(text), null, 1)}\n`;

const overpass: [string, ImportArea][] = [
  ['overpass-country-MT.json', { kind: 'country', country: 'MT' }],
  // Egypt: the country where Wikidata and OSM overlap most (Thistlegorm, Dunraven, the Tiran reefs).
  ['overpass-country-EG.json', { kind: 'country', country: 'EG' }],
  // The Attersee in Austria: lake dive sites, few of them.
  ['overpass-box-attersee.json', { kind: 'box', south: 47.75, west: 13.45, north: 47.95, east: 13.62 }],
];
for (const [file, area] of overpass) {
  const text = await http('osm', DEFAULT_OVERPASS_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: overpassQuery(area) }).toString(),
  });
  await writeFile(here(file), pretty(text));
  console.log(`wrote ${file}`);
}

const text = await http('wikidata', DEFAULT_WIKIDATA_SPARQL_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
  body: new URLSearchParams({ query: wikidataQuery('en') }).toString(),
});
await writeFile(here('wikidata-en.json'), pretty(text));
console.log('wrote wikidata-en.json');
