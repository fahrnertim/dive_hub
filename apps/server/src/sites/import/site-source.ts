// What a Site import asks of an open Source (ADR 0021): the dive sites of an area, as plain values.
// One adapter per Source (Overpass for OpenStreetMap, the Wikidata Query Service); tests replay recorded answers.
import type { Position } from '../site-service.js';
import type { ImportSource } from '../sources.js';

/** Where to import: one country (ISO 3166-1 alpha-2), a box in degrees, or everywhere. */
export type ImportArea =
  | { kind: 'country'; country: string }
  | { kind: 'box'; south: number; west: number; north: number; east: number }
  | { kind: 'world' };

/** The site fields a Source can fill; null where it has nothing. */
export interface ImportedValues {
  name: string | null;
  position: Position | null;
  country: string | null;
  waterBody: string | null;
  description: string | null;
  maxDepthM: number | null;
}

export const IMPORTED_FIELDS = ['name', 'position', 'country', 'waterBody', 'description', 'maxDepthM'] as const satisfies readonly (keyof ImportedValues)[];

/** One dive site as a Source describes it. */
export interface SourceSite {
  source: ImportSource;
  externalId: string;
  values: ImportedValues;
  /** The same place at the other Source, where the Source says so (OSM's wikidata=, Wikidata's OSM IDs). */
  sameAs: { osm?: string; wikidata?: string };
}

export interface SiteSourceAdapter {
  source: ImportSource;
  /** The dive sites in `area`; names in `language` where the Source has several. Throws SiteSourceError. */
  fetch(area: ImportArea, language: string): Promise<SourceSite[]>;
}

export class SiteSourceError extends Error {
  constructor(readonly source: ImportSource, readonly reason: 'unavailable' | 'rate_limited' | 'bad_response', detail: string) {
    super(`${source}: ${reason} (${detail})`);
  }
}

export const inBox = (p: Position, a: Extract<ImportArea, { kind: 'box' }>) =>
  p.latitude >= a.south && p.latitude <= a.north
  && (a.west <= a.east ? p.longitude >= a.west && p.longitude <= a.east : p.longitude >= a.west || p.longitude <= a.east);
