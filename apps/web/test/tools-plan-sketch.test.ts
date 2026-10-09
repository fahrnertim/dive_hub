// The plan's profile before there is an answer (ADR 0033): the stretches of the levels alone, as the server counts them
// (planning-gas-plan.test.ts), so the picture is there with the first level and does not jump when the answer comes.
import { describe, expect, it } from 'vitest';
import { planSketch } from '../src/lib/tools.ts';

const shape = (levels: { depth: number; minutes: number }[], rates = {}) =>
  planSketch(levels, rates)?.map((s) => [s.kind, s.fromDepthM, s.depthM, Math.round(s.minutes * 100) / 100]);

describe('the sketch of a plan', () => {
  it('goes down at 18 m/min, up at 9 m/min, and stops for 3 minutes at 5 m', () => {
    expect(shape([{ depth: 20, minutes: 20 }])).toEqual([
      ['descent', 0, 20, 1.11], ['level', 20, 20, 20], ['ascent', 20, 5, 1.67], ['safety_stop', 5, 5, 3], ['ascent', 5, 0, 0.56],
    ]);
  });

  it('moves between levels, and has no stop from a level above it', () => {
    expect(shape([{ depth: 20, minutes: 10 }, { depth: 10, minutes: 10 }, { depth: 4, minutes: 5 }])?.map((s) => s[0])).toEqual([
      'descent', 'level', 'ascent', 'level', 'ascent', 'level', 'ascent',
    ]);
  });

  it('takes the rates of the plan', () => {
    expect(shape([{ depth: 20, minutes: 20 }], { descentRate: 10, ascentRate: 6 })?.map((s) => s[3])).toEqual([2, 20, 2.5, 3, 0.83]);
  });

  it('draws nothing without a level or deeper than 40 m', () => {
    expect(planSketch([], {})).toBeUndefined();
    expect(planSketch([{ depth: 42, minutes: 5 }], {})).toBeUndefined();
  });
});
