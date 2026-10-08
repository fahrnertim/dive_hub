// SAC on a Dive (ADR 0045, slice 3; ADR 0033): computed from the Dive's Cylinders, never stored.
import type { Cylinder } from './cylinders.js';
import { surfaceLitres } from './real-gas.js';

/** Below this a Dive is too short for its SAC to say anything (ADR 0033). */
const MIN_SECONDS = 15 * 60;

export interface Sac {
  litresPerMinute: number;
  /** Only for a Dive with exactly one Cylinder. */
  barPerMinute: number | null;
}

/** Why a Dive with Cylinders has no SAC. */
export const SAC_MISSING = ['too_short', 'no_average_depth', 'cylinder_incomplete'] as const;
export type SacMissing = (typeof SAC_MISSING)[number];

const round = (n: number) => Math.round(n * 100) / 100;

export function sacOfDive(
  dive: { durationSeconds: number; avgDepthM: number | null },
  cylinders: Pick<Cylinder, 'volumeL' | 'startPressureBar' | 'endPressureBar' | 'gas'>[],
): { sac: Sac | null; missing: SacMissing | null } {
  if (cylinders.length === 0) return { sac: null, missing: null };
  if (dive.durationSeconds < MIN_SECONDS) return { sac: null, missing: 'too_short' };
  if (dive.avgDepthM === null) return { sac: null, missing: 'no_average_depth' };
  if (cylinders.some((c) => c.volumeL === null || c.startPressureBar === null || c.endPressureBar === null)) {
    return { sac: null, missing: 'cylinder_incomplete' };
  }
  // Minutes at the surface's pressure: the time times the ambient pressure at the average depth (ADR 0033).
  const surfaceMinutes = (dive.durationSeconds / 60) * (dive.avgDepthM / 10 + 1);
  const litres = cylinders.reduce((sum, c) =>
    sum + surfaceLitres(c.volumeL!, c.startPressureBar!, c.gas) - surfaceLitres(c.volumeL!, c.endPressureBar!, c.gas), 0);
  const [only] = cylinders;
  return {
    sac: {
      litresPerMinute: round(litres / surfaceMinutes),
      barPerMinute: cylinders.length === 1 ? round((only!.startPressureBar! - only!.endPressureBar!) / surfaceMinutes) : null,
    },
    missing: null,
  };
}
