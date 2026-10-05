// SSI's site list (ADR 0024, 0025): one zip with every site, downloaded without signing in. SSI gives no licence
// for it; the admin confirms that before a run. Taken per site: the SSI ID, name, position, country and water
// type. Never kept: moderation comments (they hold submitters' IP addresses), private sites and their owners,
// statistics, wildlife, alias names. The file has no area query, so the area is applied here.
import yauzl from 'yauzl';
import { looksLikeZip } from '../../imports/archive.js';
import type { SiteWaterType } from '../../vocabulary.js';
import { alpha2Of } from '../../sites/countries.js';
import { SOURCE_INFO } from '../../sites/sources.js';
import type { PoliteHttp } from '../../sites/import/polite-http.js';
import { inBox, SiteSourceError, type ImportArea, type SiteSourceAdapter, type SourceSite } from '../../sites/import/site-source.js';

export const DEFAULT_SSI_SITES_URL = 'https://api.divessi.com/app/APP_CACHE_SITES.zip';

/** The real list unpacks to about 19 MB; anything far larger is not it. */
const MAX_JSON_BYTES = 200 * 1024 * 1024;

/** SSI's `bow` (body of water): "artificial" (pools, quarries with tanks) says nothing about the water. */
const WATER_OF_BOW: Record<string, SiteWaterType> = { salt: 'salt', fresh: 'fresh' };

export function createSsiSiteSource(http: PoliteHttp, url = DEFAULT_SSI_SITES_URL): SiteSourceAdapter {
  return {
    source: 'ssi',
    async fetch(area) {
      const zip = await http.bytes('ssi', url, { method: 'GET', headers: { Accept: 'application/zip' } });
      return parseSsiSites(await sitesJson(zip), area);
    },
  };
}

const unavailable = (detail: string) => new SiteSourceError('ssi', 'unavailable', detail);

/** The JSON file inside the zip; anything else (an HTML page, an empty or broken zip) counts as unavailable. */
async function sitesJson(zip: Buffer): Promise<string> {
  if (!looksLikeZip(zip)) throw unavailable(`not a zip: ${zip.subarray(0, 100).toString('utf8')}`);
  let file: yauzl.ZipFile;
  try {
    file = await yauzl.fromBufferPromise(zip, { decodeStrings: true, validateEntrySizes: true, strictFileNames: false });
  } catch (error) {
    throw unavailable(`broken zip: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    for await (const entry of file.eachEntry()) {
      if (!/\.json$/i.test(entry.fileName)) continue;
      if (entry.uncompressedSize > MAX_JSON_BYTES) throw unavailable(`${entry.fileName} is ${entry.uncompressedSize} bytes`);
      const chunks: Buffer[] = [];
      for await (const chunk of await file.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    }
  } catch (error) {
    if (error instanceof SiteSourceError) throw error;
    throw unavailable(`broken zip: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    file.close();
  }
  throw unavailable('no JSON file in the zip');
}

const truthy = (v: unknown) => v === true || v === 1 || v === '1';
const coordinate = (v: unknown, limit: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit ? v : null);

export function parseSsiSites(json: string, area: ImportArea): SourceSite[] {
  let rows: unknown[];
  try {
    const parsed = JSON.parse(json) as { divesites?: unknown };
    if (!Array.isArray(parsed.divesites)) throw new Error('no divesites');
    rows = parsed.divesites;
  } catch (error) {
    throw unavailable(error instanceof Error ? error.message : String(error));
  }
  return rows.flatMap((row): SourceSite[] => {
    if (typeof row !== 'object' || row === null) return [];
    const r = row as Record<string, unknown>;
    if (truthy(r.odin_dive_sites_deleted) || truthy(r.odin_dive_sites_is_private)) return [];
    const id = String(r.odin_dive_sites_id ?? '');
    if (!SOURCE_INFO.ssi.idPattern.test(id)) return [];
    const name = r.odin_dive_sites_name;
    const latitude = coordinate(r.odin_dive_sites_lat, 90);
    const longitude = coordinate(r.odin_dive_sites_lon, 180);
    const position = latitude === null || longitude === null || (latitude === 0 && longitude === 0) ? null : { latitude, longitude };
    const country = alpha2Of(r.odin_countries_code_iso);
    if (area.kind === 'country' && country !== area.country) return [];
    if (area.kind === 'box' && !(position && inBox(position, area))) return [];
    return [{
      source: 'ssi',
      externalId: id,
      values: {
        name: typeof name === 'string' || typeof name === 'number' ? String(name).trim().slice(0, 120) || null : null,
        position,
        country,
        waterBody: null,
        description: null,
        maxDepthM: null,
        waterType: typeof r.bow === 'string' ? WATER_OF_BOW[r.bow] ?? null : null,
      },
      sameAs: {},
    }];
  });
}
