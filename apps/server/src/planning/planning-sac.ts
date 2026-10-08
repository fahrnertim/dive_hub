// The planning SAC (ADR 0033, slice 22): a plan needs a bad day's consumption, so the 85th percentile of the SAC of a
// Diver's last 20 Dives that have one, not the median. Fewer than 5 and the default stands, said so.

export const PLANNING_SAC_DIVES = 20;
export const PLANNING_SAC_MIN_DIVES = 5;
export const PLANNING_SAC_PERCENTILE = 0.85;
export const DEFAULT_PLANNING_SAC_LPM = 20;

export interface PlanningSac {
  lpm: number;
  /** How many Dives it rests on. */
  basedOn: number;
  source: 'logbook' | 'default';
}

/** `dives` newest first; a Dive without a SAC has `sacLpm` null. */
export function planningSac(dives: readonly { sacLpm: number | null }[]): PlanningSac {
  const sacs = dives.flatMap((d) => (d.sacLpm === null ? [] : [d.sacLpm])).slice(0, PLANNING_SAC_DIVES);
  if (sacs.length < PLANNING_SAC_MIN_DIVES) return { lpm: DEFAULT_PLANNING_SAC_LPM, basedOn: sacs.length, source: 'default' };
  const sorted = [...sacs].sort((a, b) => a - b);
  // Linear between ranks (the common "inclusive" percentile).
  const rank = PLANNING_SAC_PERCENTILE * (sorted.length - 1) + 1e-9;
  const low = Math.floor(rank);
  const value = sorted[low]! + (rank - low) * ((sorted[Math.min(low + 1, sorted.length - 1)]!) - sorted[low]!);
  return { lpm: Math.round(value * 10) / 10, basedOn: sorted.length, source: 'logbook' };
}
