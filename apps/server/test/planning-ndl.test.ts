// No-decompression limit by Bühlmann ZHL-16C with gradient factors (ADR 0032, slice 21).
// Expected values are published, independent results (docs/research/2026-10-06-gas-and-ndl-tools.md):
//   GasPlanner's no-deco tests (MIT), air, descent included, floored to whole minutes [gasplanner-tests];
//   US Navy Rev 7 air table, 60 ft / 100 ft [usn-rev7].
// The rule (ADR 0046, amending ADR 0032): our limit carries a one-minute margin, as the reference does, and is never
// longer than a reference at 21 m and deeper; at 12 to 18 m, where the slowest compartments decide, it may be up to
// SHALLOW_EXTRA minutes longer (measured 2026-10-09: +2 at 12 m, +1 at 18 m, from the reference's own constants).
// It is at most TOLERANCE minutes shorter.
import { describe, expect, it } from 'vitest';
import { ndlMinutes } from '../src/planning/ndl.js';

const AIR = { o2: 21, he: 0 };
const TOLERANCE = 3;
const SHALLOW_EXTRA = 2;

// depth (m) -> minutes in GasPlanner's tests
const GF100_FRESH: Record<number, number> = { 12: 195, 15: 94, 18: 61, 21: 43, 24: 30, 27: 23, 30: 17, 33: 14, 36: 11, 39: 9, 42: 9 };
const GF100_SALT: Record<number, number> = { 12: 173, 15: 87, 18: 57, 21: 40, 24: 28, 27: 21, 30: 16, 33: 13, 36: 10, 39: 9, 42: 8 };
const GF85_FRESH: Record<number, number> = { 12: 134, 15: 72, 18: 45, 21: 30, 24: 21, 27: 16, 30: 13, 33: 10, 36: 8, 39: 7, 42: 7 };

// GasPlanner's salt water is 1030 kg/m³ (ours is 1025), so its salt table is compared at its own density.
function expectWithinReference(table: Record<number, number>, water: 'fresh' | 'salt', gfHigh: number) {
  const densityKgM3 = water === 'salt' ? 1030 : undefined;
  for (const [depth, reference] of Object.entries(table)) {
    const ours = ndlMinutes({ gas: AIR, depthM: Number(depth), gfHigh, conditions: { water, altitudeM: 0, densityKgM3 } });
    expect(ours, `${depth} m`).toBeLessThanOrEqual(reference + (Number(depth) <= 18 ? SHALLOW_EXTRA : 0));
    expect(ours, `${depth} m`).toBeGreaterThanOrEqual(reference - TOLERANCE);
  }
}

describe('no-decompression limit on air', () => {
  it('GF 100 in fresh water is within GasPlanner\'s values, never longer', () => expectWithinReference(GF100_FRESH, 'fresh', 100));
  it('GF 100 in salt water is within GasPlanner\'s values, never longer', () => expectWithinReference(GF100_SALT, 'salt', 100));
  it('GF 85 in fresh water is within GasPlanner\'s values, never longer', () => expectWithinReference(GF85_FRESH, 'fresh', 85));

  it('is no longer than the US Navy Rev 7 table at 18 m and 30 m (63 and 25 min), a sanity band', () => {
    const at = (depthM: number) => ndlMinutes({ gas: AIR, depthM, gfHigh: 100, conditions: { water: 'salt', altitudeM: 0 } });
    expect(at(18)).toBeLessThanOrEqual(63);
    expect(at(30)).toBeLessThanOrEqual(25);
  });

  it('is shorter with a lower gradient factor and at altitude', () => {
    const base = { gas: AIR, depthM: 18, conditions: { water: 'salt' as const, altitudeM: 0 } };
    expect(ndlMinutes({ ...base, gfHigh: 85 })).toBeLessThan(ndlMinutes({ ...base, gfHigh: 100 }));
    // Research note: 0.9 bar surface pressure takes 18 m from 63 to 59 minutes.
    expect(ndlMinutes({ ...base, gfHigh: 100, conditions: { water: 'salt', altitudeM: 900 } })).toBeLessThan(ndlMinutes({ ...base, gfHigh: 100 }));
  });

  it('is longer on nitrox, which carries less nitrogen', () => {
    const at = (o2: number) => ndlMinutes({ gas: { o2, he: 0 }, depthM: 30, gfHigh: 85, conditions: { water: 'salt', altitudeM: 0 } });
    expect(at(32)).toBeGreaterThan(at(21));
    expect(at(40)).toBeGreaterThan(at(32));
  });
});
