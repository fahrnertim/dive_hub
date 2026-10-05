// The real Sources of a Site import, configured for this instance (ADR 0021, 0025).
import type { ImportSource } from '../sources.js';
import { DEFAULT_OVERPASS_URL, createOverpassSource } from './overpass.js';
import { createPoliteHttp, type Fetch } from './polite-http.js';
import type { SiteSourceAdapter } from './site-source.js';
import { DEFAULT_SSI_SITES_URL, createSsiSiteSource } from './ssi-sites.js';
import { DEFAULT_WIKIDATA_SPARQL_URL, createWikidataSource } from './wikidata.js';

export function createSiteSources(options: {
  overpassUrl?: string | undefined;
  wikidataUrl?: string | undefined;
  ssiSitesUrl?: string | undefined;
  /** The operator's e-mail address or URL, for the User-Agent (DIVEHUB_CONTACT). */
  contact?: string | undefined;
  /** Replaces the network (the browser tests replay recorded answers). */
  fetch?: Fetch;
}): Record<ImportSource, SiteSourceAdapter> {
  const http = createPoliteHttp({ contact: options.contact, ...(options.fetch && { fetch: options.fetch }) });
  return {
    osm: createOverpassSource(http, options.overpassUrl ?? DEFAULT_OVERPASS_URL),
    wikidata: createWikidataSource(http, options.wikidataUrl ?? DEFAULT_WIKIDATA_SPARQL_URL),
    ssi: createSsiSiteSource(http, options.ssiSitesUrl ?? DEFAULT_SSI_SITES_URL),
  };
}
