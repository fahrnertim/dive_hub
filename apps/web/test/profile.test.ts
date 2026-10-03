// The depth profile as text (UI review B6).
import { describe, expect, it } from 'vitest';
import { perMinute, summarize } from '../src/lib/profile.ts';

const depth = { offsetsMs: [0, 30_000, 60_000, 90_000, 120_000], values: [0, 5, 18.5, 12, 0] };
const temperature = { offsetsMs: [0, 60_000, 120_000], values: [26, 25, 25.5] };

describe('profile as text', () => {
  it('summarizes the deepest point, the time and the water temperature', () => {
    expect(summarize(depth, temperature)).toEqual({
      maxDepthM: 18.5, maxDepthAtSeconds: 60, durationSeconds: 120, minTemperatureC: 25, maxTemperatureC: 26,
    });
    expect(summarize(depth)).toMatchObject({ minTemperatureC: null, maxTemperatureC: null });
  });

  it('gives one row per whole minute from the nearest samples', () => {
    expect(perMinute(depth, temperature)).toEqual([
      { minute: 0, depthM: 0, temperatureC: 26 },
      { minute: 1, depthM: 18.5, temperatureC: 25 },
      { minute: 2, depthM: 0, temperatureC: 25.5 },
    ]);
  });
});
