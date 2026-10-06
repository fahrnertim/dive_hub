// The profile summary an MCP tool gives instead of a Recording's samples (ADR 0035).
import { describe, expect, it } from 'vitest';
import { summariseProfile } from '../src/mcp/profile.js';

const s = (seconds: number) => seconds * 1000;

describe('summariseProfile', () => {
  it('gives nothing for a series without samples', () => {
    expect(summariseProfile({ offsetsMs: [], values: [] })).toBeNull();
  });

  it('finds the deepest point and when it was reached', () => {
    const summary = summariseProfile({ offsetsMs: [s(0), s(60), s(120), s(180)], values: [0, 12, 21.37, 4] })!;
    expect(summary.max_depth_m).toBe(21.4);
    expect(summary.max_depth_at_min).toBe(2);
    expect(summary.sample_count).toBe(4);
    expect(summary.duration_min).toBe(3);
  });

  it('weights the average depth by time, not by sample count', () => {
    // One minute at 10 m, then nine minutes at 20 m, sampled unevenly.
    const summary = summariseProfile({ offsetsMs: [s(0), s(60), s(60), s(600)], values: [10, 10, 20, 20] })!;
    expect(summary.avg_depth_m).toBe(19);
  });

  it('says how long the dive stayed in each 10 m band, leaving empty bands out', () => {
    const summary = summariseProfile({
      offsetsMs: [s(0), s(120), s(120), s(720), s(720), s(900)],
      values: [5, 5, 25, 25, 45, 45],
    })!;
    expect(summary.minutes_by_depth).toEqual([
      { from_m: 0, to_m: 10, minutes: 2 },
      { from_m: 20, to_m: 30, minutes: 10 },
      { from_m: 40, to_m: null, minutes: 3 },
    ]);
  });

  it('adds the temperature range when the Recording has temperatures', () => {
    const depth = { offsetsMs: [s(0), s(60)], values: [0, 10] };
    expect(summariseProfile(depth)!.temperature_c).toBeNull();
    expect(summariseProfile(depth, { offsetsMs: [s(0), s(60)], values: [24.04, 21.96] })!.temperature_c).toEqual({ min: 22, max: 24 });
  });
});
