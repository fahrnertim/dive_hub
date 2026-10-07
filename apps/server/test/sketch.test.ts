// The reduced profile the logbook rows draw (ADR 0041).
import { describe, expect, it } from 'vitest';
import { SKETCH_POINTS, sketchOf } from '../src/assessment/sketch.js';

const series = (seconds: number[], depths: number[]) => ({ offsetsMs: seconds.map((s) => s * 1000), values: depths });

describe('sketchOf', () => {
  it('gives nothing for a recording without a profile to draw', () => {
    expect(sketchOf(series([], []))).toBeNull();
    expect(sketchOf(series([0], [0]))).toBeNull();
    expect(sketchOf(series([0, 10], [0, 0]))).toBeNull();
  });

  it('keeps the span and reduces a long dive to SKETCH_POINTS, the deepest point of each stretch', () => {
    const seconds = Array.from({ length: 3601 }, (_, i) => i);
    const depths = seconds.map((s) => (s === 1800 ? 40 : 10));
    const sketch = sketchOf(series(seconds, depths))!;
    expect(sketch.spanSeconds).toBe(3600);
    expect(sketch.depthsM).toHaveLength(SKETCH_POINTS);
    expect(Math.max(...sketch.depthsM)).toBe(40);
  });

  it('rounds to a decimetre and carries a depth over a gap in the samples', () => {
    const sketch = sketchOf(series([0, 2400], [0, 12.3456]))!;
    expect(sketch.depthsM).toHaveLength(SKETCH_POINTS);
    expect(sketch.depthsM.every((d) => Math.round(d * 10) === d * 10)).toBe(true);
    expect(sketch.depthsM.at(-1)).toBe(12.3);
    // Nothing was sampled in between: the depth stays where it was last seen.
    expect(sketch.depthsM[10]).toBe(0);
  });

  it('keeps a short dive at its own number of points', () => {
    const sketch = sketchOf(series([0, 10, 20, 30], [0, 5, 5, 0]))!;
    expect(sketch.depthsM.length).toBeLessThanOrEqual(SKETCH_POINTS);
    expect(Math.max(...sketch.depthsM)).toBe(5);
  });
});
