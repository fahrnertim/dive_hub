// The logbook's profile sketch as paths (ADR 0041).
import { describe, expect, it } from 'vitest';
import { SKETCH_HEIGHT, SKETCH_WIDTH, sketchPaths, sketchScale } from '../src/lib/sketch.ts';

const profile = (depthsM: number[], ascentBands: [number, number, number][] = [], spanSeconds = 100) => ({ depthsM, spanSeconds, ascentBands });

describe('the profile sketch', () => {
  it('scales every dive by the same metres, never below ten', () => {
    expect(sketchScale(42)).toBe(42);
    expect(sketchScale(6)).toBe(10);
    expect(sketchScale(null)).toBe(10);
  });

  it('draws the same depth the same height whatever the dive, and the surface at the top', () => {
    const shallow = sketchPaths(profile([0, 10, 10, 0]), 40);
    const deep = sketchPaths(profile([0, 20, 20, 0]), 40);
    // 10 m of 40 m is a quarter of the drawing height (less the room for the stroke); 20 m, half of it.
    expect(shallow.line).toBe('M0 0L37.3 9.5L74.7 9.5L112 0');
    expect(deep.line).toBe('M0 0L37.3 19L74.7 19L112 0');
    expect(deep.area.endsWith(`L${SKETCH_WIDTH} 0L0 0Z`)).toBe(true);
  });

  it('keeps a depth below the scale inside the box', () => {
    const { line } = sketchPaths(profile([0, 80]), 40);
    expect(line).toBe(`M0 0L${SKETCH_WIDTH} ${SKETCH_HEIGHT - 2}`);
  });

  it('draws a fast ascent between its two times, also when it falls between two points', () => {
    // Points at 0, 50 and 100 s; the ascent is 60 to 80 s.
    const { bands } = sketchPaths(profile([0, 20, 0], [[60, 80, 2]]), 20);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.band).toBe(2);
    expect(bands[0]!.d.startsWith('M')).toBe(true);
    expect(bands[0]!.d.match(/L/g)).toHaveLength(1);
  });

  it('draws nothing for a profile with fewer than two points', () => {
    expect(sketchPaths(profile([5]), 40)).toEqual({ area: '', line: '', bands: [] });
  });
});
