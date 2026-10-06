// A Recording's depth profile in a few numbers, for answers that shouldn't carry hundreds of samples (ADR 0035).
import { Type } from 'typebox';

export interface Series {
  offsetsMs: number[];
  values: number[];
}

/** Depth bands the summary counts time in, in metres; the last one is open-ended. */
const BAND_M = 10;
const LAST_BAND_FROM_M = 40;

const round1 = (v: number) => Math.round(v * 10) / 10;

export const ProfileSummary = Type.Object({
  sample_count: Type.Integer({ description: 'Depth samples the Recording holds' }),
  duration_min: Type.Number({ description: 'From the first to the last sample' }),
  max_depth_m: Type.Number(),
  max_depth_at_min: Type.Number({ description: 'Minutes into the dive when the deepest point was reached' }),
  avg_depth_m: Type.Number({ description: 'Weighted by time' }),
  minutes_by_depth: Type.Array(Type.Object({
    from_m: Type.Integer(),
    to_m: Type.Union([Type.Integer(), Type.Null()], { description: 'null: this depth and deeper' }),
    minutes: Type.Number(),
  }), { description: 'Time spent in each 10 m band; bands without time are left out' }),
  temperature_c: Type.Union([Type.Object({ min: Type.Number(), max: Type.Number() }), Type.Null()], {
    description: 'Lowest and highest water temperature recorded; null when the Recording has none',
  }),
}, { description: 'The depth profile in a few numbers. Ask for include_samples only when the shape of the dive itself matters' });

export function summariseProfile(depth: Series, temperature?: Series) {
  const { offsetsMs, values } = depth;
  if (values.length === 0) return null;
  let deepest = 0;
  let weighted = 0;
  const bandMs = new Map<number, number>();
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > values[deepest]!) deepest = i;
    if (i === 0) continue;
    const dt = offsetsMs[i]! - offsetsMs[i - 1]!;
    const mean = (values[i]! + values[i - 1]!) / 2;
    weighted += mean * dt;
    const band = Math.min(LAST_BAND_FROM_M, Math.floor(Math.max(0, mean) / BAND_M) * BAND_M);
    bandMs.set(band, (bandMs.get(band) ?? 0) + dt);
  }
  const totalMs = offsetsMs.at(-1)! - offsetsMs[0]!;
  return {
    sample_count: values.length,
    duration_min: round1(totalMs / 60_000),
    max_depth_m: round1(values[deepest]!),
    max_depth_at_min: round1((offsetsMs[deepest]! - offsetsMs[0]!) / 60_000),
    avg_depth_m: round1(totalMs > 0 ? weighted / totalMs : values[0]!),
    minutes_by_depth: [...bandMs.entries()].filter(([, ms]) => ms > 0).sort(([a], [b]) => a - b).map(([from, ms]) => ({
      from_m: from, to_m: from === LAST_BAND_FROM_M ? null : from + BAND_M, minutes: round1(ms / 60_000),
    })),
    temperature_c: temperature && temperature.values.length > 0
      ? { min: round1(Math.min(...temperature.values)), max: round1(Math.max(...temperature.values)) }
      : null,
  };
}
