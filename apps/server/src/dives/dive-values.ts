// The Dive values that come from its Primary recording unless overridden (ADR 0015).
import type { OverridableField, RecordingSummary } from '../db/schema.js';
import type { WaterType } from '../vocabulary.js';

/** The overridable values as stored on the Dive (startsAt carries its UTC offset along). */
export interface DiveValues {
  number: number | null;
  startsAt: { at: Date; utcOffsetSeconds: number | null };
  durationSeconds: number;
  maxDepthM: number | null;
  avgDepthM: number | null;
  waterTemperatureC: number | null;
  waterType: WaterType | null;
}

export interface RecordingFacts {
  startsAt: Date;
  utcOffsetSeconds: number | null;
  durationSeconds: number;
  maxDepthM: number | null;
  avgDepthM: number | null;
  summary: RecordingSummary;
}

export const valuesFromRecording = (r: RecordingFacts): DiveValues => ({
  number: r.summary.diveNumber ?? null,
  startsAt: { at: r.startsAt, utcOffsetSeconds: r.utcOffsetSeconds },
  durationSeconds: r.durationSeconds,
  maxDepthM: r.maxDepthM,
  avgDepthM: r.avgDepthM,
  waterTemperatureC: r.summary.minTemperatureC ?? null,
  waterType: r.summary.waterType ?? null,
});

/** The Dive's table columns that hold each value. */
export function columnsOf<F extends OverridableField>(field: F, value: DiveValues[F]): Record<string, unknown> {
  if (field === 'startsAt') {
    const s = value as DiveValues['startsAt'];
    return { startsAt: s.at, utcOffsetSeconds: s.utcOffsetSeconds };
  }
  return { [field]: value };
}

/** The values as they are on a Dive row. */
export const valuesOfDive = (d: {
  number: number | null; startsAt: Date; utcOffsetSeconds: number | null; durationSeconds: number;
  maxDepthM: number | null; avgDepthM: number | null; waterTemperatureC: number | null; waterType: WaterType | null;
}): DiveValues => ({
  number: d.number,
  startsAt: { at: d.startsAt, utcOffsetSeconds: d.utcOffsetSeconds },
  durationSeconds: d.durationSeconds,
  maxDepthM: d.maxDepthM,
  avgDepthM: d.avgDepthM,
  waterTemperatureC: d.waterTemperatureC,
  waterType: d.waterType,
});

/** JSON-friendly form of a value, as Revisions and the API carry it. */
export function plain<F extends OverridableField>(field: F, value: DiveValues[F]): unknown {
  if (field !== 'startsAt') return value;
  const s = value as DiveValues['startsAt'];
  return { at: s.at.toISOString(), utcOffsetSeconds: s.utcOffsetSeconds };
}

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
