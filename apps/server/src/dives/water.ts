// A Dive's water is its site's (ADR 0025). The computer computed depths for the water it was set to, so when
// the two differ the dive page says so, with how far off the depths read where the densities tell.
import type { RecordingSummary } from '../db/schema.js';
import { WATER_DENSITY, type SiteWaterType, type WaterType } from '../vocabulary.js';

export interface WaterMismatch {
  /** What the Primary recording's computer was set to. */
  computer: WaterType;
  site: SiteWaterType;
  /**
   * How the recorded depths compare with the true ones, in percent: negative reads shallow, positive deep.
   * Null where a density isn't known (brackish water, a custom setting without its density).
   */
  depthPercent: number | null;
}

/** Below this the difference is smaller than a depth gauge's tolerance and not worth a hint (EN 13319 in salt water: 0.5 %). */
const NOTICEABLE_PERCENT = 1;

export function waterMismatch(site: SiteWaterType | null, summary: RecordingSummary | undefined): WaterMismatch | null {
  const computer = summary?.waterType;
  if (!site || !computer || computer === site) return null;
  const assumed = summary.waterDensity ?? WATER_DENSITY[computer];
  const actual = WATER_DENSITY[site];
  if (assumed === undefined || actual === undefined) return { computer, site, depthPercent: null };
  // A computer turns pressure into depth with its density: read / true = actual density / assumed density.
  const percent = (actual / assumed - 1) * 100;
  if (Math.abs(percent) < NOTICEABLE_PERCENT) return null;
  return { computer, site, depthPercent: Math.round(percent * 10) / 10 };
}
