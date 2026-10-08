// Bottom time for a planned dive (ADR 0032, slice 21): the shortest of the no-decompression limit, the oxygen limit and
// the gas above the reserve, saying which binds. Figures worked by hand; data-model.md scenario 6.
//
// Salt water at sea level: 9.9486 m per bar, surface 1.01325 bar. An AL80 (11.1 L) from 201 to a 51 bar reserve.
// EAN32 compressibility from NIST (see sac.test.ts): Z = 1.01628 at 201 bar, 0.98571 at 51 bar, so the usable gas is
// 11.1 × (201 / 1.01628 − 51 / 0.98571) = 11.1 × (197.78 − 51.74) = 1621.1 L at the surface's pressure.
// The gas for the way up: a direct ascent at 9 m/min and 3 minutes at 5 m (1.5158 bar), at the dive's SAC. The way down at 18 m/min.
import { describe, expect, it } from 'vitest';
import { bottomTime } from '../src/planning/bottom-time.js';

const SEA = { water: 'salt', altitudeM: 0 } as const;
const al80 = { volumeL: 11.1, startPressureBar: 201 };
const ean32 = { o2: 32, he: 0 };
const plan = (over: Record<string, unknown> = {}) => ({
  gas: ean32, depthM: 30, gfHigh: 85, conditions: SEA, cylinder: al80, sacLpm: 18, reserveBar: 51,
  ppO2: { working: 1.4, contingency: 1.6 }, ...over,
});

describe('bottom time', () => {
  it('takes the shortest of the three limits and says which binds (Tim\'s 30 m on EAN32)', () => {
    // Gas: down 1.6667 min at an average 2.521 bar: 18 × 1.6667 × 2.521 = 75.6 L; up 3.3333 min: 151.3 L; stop 3 min: 18 × 3 × 1.5158 = 81.9 L;
    // 308.8 L in all. (1621.1 − 308.8) / (18 × 4.0288 = 72.52 L/min) = 18.10 min at 30 m, 19.8 min from leaving the surface.
    // Oxygen: ppO2 0.32 × 4.0288 = 1.289 bar, 0.9 of the way from 1.2 (210 min) to 1.3 (180 min) = 183 min.
    const r = bottomTime(plan());
    if (r.status !== 'ok') throw new Error('expected a bottom time');
    expect(r.limits.gas).toBeCloseTo(19.8, 0);
    expect(r.limits.oxygen).toBeCloseTo(183, 0);
    expect(r.limits.ndl).toBeGreaterThanOrEqual(16);
    expect(r.limits.ndl).toBeLessThanOrEqual(19);
    expect(r.minutes).toBe(r.limits.ndl);
    expect(r.binding).toEqual(['ndl']);
    expect(r.ppO2AtDepth).toBeCloseTo(1.289, 2);
    expect(r.ppO2AboveWorking).toBe(false);
  });

  it('is limited by the gas when the Diver breathes a lot', () => {
    // 18 m, SAC 30 L/min, EAN32: down 1 min at 1.918 bar = 57.5 L; up 2 min = 115.1 L; stop 3 min = 30 × 3 × 1.5158 = 136.4 L; 309.0 L.
    // (1621.1 − 309.0) / (30 × 2.8226 = 84.68) = 15.50 min at depth, 16.5 min from leaving the surface; the NDL there is over an hour.
    const r = bottomTime(plan({ depthM: 18, sacLpm: 30 }));
    if (r.status !== 'ok') throw new Error('expected a bottom time');
    expect(r.limits.gas).toBeCloseTo(16.5, 0);
    expect(r.minutes).toBe(16);
    expect(r.binding).toEqual(['gas']);
  });

  it('counts the OTU of the bottom time', () => {
    // 1.289 bar for 18 minutes: 18 × ((1.289 − 0.5) / 0.5)^0.83 = 18 × 1.578^0.83 = 18 × 1.4606 = 26.3
    const r = bottomTime(plan());
    if (r.status !== 'ok') throw new Error('expected a bottom time');
    expect(r.otu).toBeCloseTo(r.minutes * 1.4606, 0);
  });

  it('has no gas limit without a Cylinder', () => {
    const r = bottomTime(plan({ cylinder: null }));
    if (r.status !== 'ok') throw new Error('expected a bottom time');
    expect(r.limits.gas).toBeNull();
  });

  it('warns when the ppO2 at depth is above the working limit but within the contingency limit', () => {
    // EAN32 at 36 m: 0.32 × (1.01325 + 36 / 9.9486) = 0.32 × 4.6319 = 1.482 bar.
    const r = bottomTime(plan({ depthM: 36 }));
    if (r.status !== 'ok') throw new Error('expected a bottom time');
    expect(r.ppO2AboveWorking).toBe(true);
  });
});

describe('outside recreational limits', () => {
  it('gives no number deeper than 40 m', () => {
    expect(bottomTime(plan({ depthM: 41, gas: { o2: 21, he: 0 } }))).toMatchObject({ status: 'outside_limits', reason: 'depth' });
  });

  it('gives no number beyond the MOD at the contingency ppO2, and still says the MOD', () => {
    // EAN40 at 36 m: 0.4 × 4.6319 = 1.85 bar. MOD at 1.6: (4 − 1.01325) × 9.9486 = 29.7 m.
    const r = bottomTime(plan({ depthM: 36, gas: { o2: 40, he: 0 } }));
    expect(r).toMatchObject({ status: 'outside_limits', reason: 'mod' });
    expect((r as { modM: number }).modM).toBeCloseTo(29.71, 1);
  });

  it('gives no bottom time for helium or for mixes outside air and nitrox 21 to 40 %', () => {
    expect(bottomTime(plan({ gas: { o2: 21, he: 35 }, depthM: 30 }))).toMatchObject({ status: 'outside_limits', reason: 'gas' });
    expect(bottomTime(plan({ gas: { o2: 50, he: 0 }, depthM: 20 }))).toMatchObject({ status: 'outside_limits', reason: 'gas' });
    expect(bottomTime(plan({ gas: { o2: 18, he: 0 }, depthM: 20 }))).toMatchObject({ status: 'outside_limits', reason: 'gas' });
  });
});
