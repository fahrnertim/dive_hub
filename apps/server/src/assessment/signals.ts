// What the profile rules measure on (ADR 0036): a Recording's depth cleaned of sensor spikes, its ascent rate, its
// split into dives, and the plain helpers on a sampled series. No thresholds of their own: those are LIMITS in rules.ts.
import { LIMITS } from './rules.js';

export interface Series {
  offsetsMs: number[];
  values: number[];
}

export const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;
export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
};

/** Depth samples with sensor spikes interpolated (never dropped): in and straight back out faster than 60 m/min. */
export function cleanDepth(depth: Series): { t: number[]; d: number[] } {
  const t = depth.offsetsMs.map((ms) => ms / 1000);
  const raw = depth.values;
  const d = [...raw];
  for (let i = 1; i < raw.length - 1; i++) {
    const before = t[i]! - t[i - 1]!;
    const after = t[i + 1]! - t[i]!;
    if (before <= 0 || after <= 0) continue;
    const rateIn = ((raw[i]! - raw[i - 1]!) / before) * 60;
    const rateOut = ((raw[i + 1]! - raw[i]!) / after) * 60;
    if (Math.abs(rateIn) > LIMITS.spikeMMin && Math.abs(rateOut) > LIMITS.spikeMMin && Math.sign(rateIn) !== Math.sign(rateOut)) {
      d[i] = raw[i - 1]! + ((raw[i + 1]! - raw[i - 1]!) * before) / (before + after);
    }
  }
  return { t, d };
}

/**
 * The ascent rate from each sample over the next 15 seconds, in m/min (negative: descending); null where the
 * recording ends or has a gap. `end[i]` is the sample the window reaches.
 */
export function windowRates(t: number[], d: number[]) {
  const rate: (number | null)[] = [];
  const end: number[] = [];
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    while (j < t.length && t[j]! - t[i]! < LIMITS.windowS) j++;
    const span = j < t.length ? t[j]! - t[i]! : 0;
    rate.push(j < t.length && span <= LIMITS.windowS * 3 ? ((d[i]! - d[j]!) / span) * 60 : null);
    end.push(Math.min(j, t.length - 1));
  }
  return { rate, end };
}

/** Runs of consecutive samples for which `holds` is true, as index pairs. */
export function runs(length: number, holds: (i: number) => boolean): [number, number][] {
  const found: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= length; i++) {
    if (i < length && holds(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      found.push([start, i - 1]);
      start = -1;
    }
  }
  return found;
}

/** A recording split where it stayed at the surface for a minute or more: each part is a dive of its own. */
export function segments(t: number[], d: number[]): [number, number][] {
  const breaks = runs(d.length, (i) => d[i]! < LIMITS.surfaceM)
    .filter(([a, b]) => a > 0 && b < d.length - 1 && t[b]! - t[a]! >= LIMITS.surfaceSplitS);
  const parts: [number, number][] = [];
  let from = 0;
  for (const [a, b] of breaks) {
    parts.push([from, a]);
    from = b;
  }
  parts.push([from, d.length - 1]);
  return parts;
}

/** A series' value at time `at` (seconds): its latest sample up to then. */
export function stepAt(series: Series, at: number): number | null {
  let value: number | null = null;
  for (let i = 0; i < series.offsetsMs.length && series.offsetsMs[i]! / 1000 <= at; i++) value = series.values[i]!;
  return value;
}

/** Seconds a series spent above `limit`, and the stretch from the first to the last such sample. */
export function timeAbove(series: Series, limit: number) {
  let seconds = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (let i = 0; i < series.values.length; i++) {
    if (series.values[i]! <= limit) continue;
    const at = series.offsetsMs[i]! / 1000;
    const next = i + 1 < series.offsetsMs.length ? series.offsetsMs[i + 1]! / 1000 : at;
    seconds += next - at;
    first ??= at;
    last = next;
  }
  return { seconds, first, last };
}

/** Shallow turning points between two deeper stretches, each at least `amplitude` metres deeper (a zigzag filter). */
export function excursions(t: number[], d: number[], from: number, to: number, amplitude: number): number[] {
  const shallow: number[] = [];
  let direction: 'down' | 'up' = 'down';
  let extreme = from;
  for (let i = from + 1; i <= to; i++) {
    if (direction === 'down') {
      if (d[i]! > d[extreme]!) extreme = i;
      else if (d[extreme]! - d[i]! >= amplitude) { direction = 'up'; extreme = i; }
    } else if (d[i]! < d[extreme]!) extreme = i;
    else if (d[i]! - d[extreme]! >= amplitude) { shallow.push(extreme); direction = 'down'; extreme = i; }
  }
  return shallow;
}
