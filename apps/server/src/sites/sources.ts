// The Sources of Dive site data and site IDs (ADR 0021), defined once: name, license, Attribution and
// how to link an External ID. Nothing of this is stored per site; the API hands it out with each ID.

export const SITE_SOURCES = ['osm', 'wikidata', 'ssi'] as const;
export type SiteSource = (typeof SITE_SOURCES)[number];

/** Sources a Site import fetches from, in the order a run asks them. Which value wins per field: `FIELD_PRECEDENCE`. */
export const IMPORT_SOURCES = ['osm', 'wikidata', 'ssi'] as const satisfies readonly SiteSource[];
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface SourceInfo {
  /** Proper name, the same in every UI language. */
  name: string;
  /** What a valid External ID looks like. */
  idPattern: RegExp;
  /** The object's page at the Source, if it has public pages. */
  link: ((externalId: string) => string) | null;
  /** The license of data taken from the Source, and the Attribution it requires (null: none). */
  license: { name: string; url: string } | null;
  attribution: { text: string; url: string } | null;
}

export const SOURCE_INFO: Record<SiteSource, SourceInfo> = {
  osm: {
    name: 'OpenStreetMap',
    idPattern: /^(node|way|relation)\/[1-9]\d*$/,
    link: (id) => `https://www.openstreetmap.org/${id}`,
    license: { name: 'ODbL 1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
    attribution: { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  },
  wikidata: {
    name: 'Wikidata',
    idPattern: /^Q[1-9]\d*$/,
    link: (id) => `https://www.wikidata.org/wiki/${id}`,
    license: { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    attribution: null,
  },
  ssi: {
    name: 'SSI',
    // SSI's site IDs appear only in its QR payload ("site:3314"); there is no public page to link to.
    idPattern: /^[1-9]\d{0,9}$/,
    link: null,
    license: null,
    attribution: null,
  },
};
