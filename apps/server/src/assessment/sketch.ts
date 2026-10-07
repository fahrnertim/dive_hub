// The reduced depth profile a logbook row draws (ADR 0041): a fixed number of points evenly spread over the
// Recording, each the deepest sample of its stretch so peaks survive. Full resolution stays in `sample_series`.

export const SKETCH_POINTS = 48;

export interface Sketch {
  /** Depth in metres to a decimetre, evenly spread over `spanSeconds`. */
  depthsM: number[];
  /** Seconds from the first to the last depth sample. */
  spanSeconds: number;
}

/** Null when there is nothing to draw: under two samples, or never below a metre. */
export function sketchOf(depth: { offsetsMs: number[]; values: number[] }): Sketch | null {
  const n = depth.values.length;
  if (n < 2) return null;
  const start = depth.offsetsMs[0]!;
  const span = depth.offsetsMs[n - 1]! - start;
  if (span <= 0 || Math.max(...depth.values) < 1) return null;

  const deepest: (number | undefined)[] = Array.from({ length: SKETCH_POINTS });
  for (let i = 0; i < n; i++) {
    const bucket = Math.min(SKETCH_POINTS - 1, Math.floor(((depth.offsetsMs[i]! - start) / span) * SKETCH_POINTS));
    deepest[bucket] = Math.max(deepest[bucket] ?? -Infinity, depth.values[i]!);
  }
  // A stretch with no sample keeps the last depth seen.
  let last = depth.values[0]!;
  const depthsM = deepest.map((d) => {
    last = d ?? last;
    return Math.round(Math.max(0, last) * 10) / 10;
  });
  return { depthsM, spanSeconds: Math.round(span / 1000) };
}
