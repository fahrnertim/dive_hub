// Types of the Site import that the schema stores as JSON (ADR 0021, 0025). They live here, below the domain
// modules, so db/ imports nothing of sites/ (ADR 0053); sites/ re-exports them under their old homes.
import type { Position, SiteWaterType } from '../vocabulary.js';

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
  /** Only SSI knows it (ADR 0025). Missing in values stored before it existed: read as null. */
  waterType: SiteWaterType | null;
}

export interface SiteImportCounts {
  created: number;
  updated: number;
  unchanged: number;
  kept: number;
  linked: number;
  skippedNoName: number;
  skippedDeleted: number;
  skippedMerged: number;
  /** New places left out because the admin chose not to create sites (ADR 0025). */
  skippedNew: number;
  /** Hand-made sites whose page now offers a Source's data. */
  offered: number;
  gone: number;
}
