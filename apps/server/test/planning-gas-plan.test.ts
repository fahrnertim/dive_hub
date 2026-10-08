// A gas plan (ADR 0033, slice 22): litres per segment, pressures per Diver, the gas rules and rock bottom, the controlling
// Diver. Figures worked by hand in fresh water at sea level (10.19716 m of water per bar, 1.01325 bar at the surface), air.
import { describe, expect, it } from 'vitest';
import { surfaceLitres } from '../src/dives/real-gas.js';
import { planGas, type GasPlanInput } from '../src/planning/gas-plan.js';

const AIR = { o2: 21, he: 0 };
const base = {
  gas: AIR,
  conditions: { water: 'fresh', altitudeM: 0 },
  levels: [{ depthM: 20, minutes: 20 }],
  ppO2Contingency: 1.6,
} as const satisfies Partial<GasPlanInput>;
const diver = (name: string, sacLpm: number, volumeL = 12, startPressureBar = 200) => ({ name, sacLpm, volumeL, startPressureBar });
const plan = (input: Partial<GasPlanInput> & Pick<GasPlanInput, 'divers' | 'rule'>) => {
  const result = planGas({ ...base, ...input });
  if (result.status !== 'ok') throw new Error(`expected a plan, got ${result.reason}`);
  return result;
};
/** Litres at the surface that a pressure in the 12 L cylinder holds. */
const litres = (bar: number) => surfaceLitres(12, bar, AIR);

describe('a gas plan for one Diver at 20 m for 20 minutes, SAC 20 L/min', () => {
  it('adds up the litres of descent, level, ascent and safety stop, and leaves the pressure at the end', () => {
    const r = plan({ divers: [diver('Tim', 20)], rule: { kind: 'rock_bottom' } });
    // Ambient: surface 1.01325, 5 m 1.50357, 20 m 2.97458 bar.
    // Descent 20/18 min at the mean 1.99391 bar: 44.31 L. Level 20 min × 2.97458: 1189.83 L.
    // Ascent 20/9 min at 1.99391: 88.62 L. Stop 3 min at 5 m: 90.21 L. Together 1412.97 L; 28.1 min from the surface.
    expect(r.runtimeMinutes).toBeCloseTo(20 + 20 / 18 + 20 / 9 + 3, 5);
    const [tim] = r.divers;
    expect(tim!.litres).toBeCloseTo(1412.97, 1);
    expect(litres(tim!.endPressureBar)).toBeCloseTo(litres(200) - 1412.97, 0);
  });

  it('puts rock bottom at the level: both Divers at twice the SAC for a minute and a direct ascent, plus 10 bar', () => {
    const r = plan({ divers: [diver('Tim', 20)], rule: { kind: 'rock_bottom' } });
    const [tim] = r.divers;
    // Alone, the buddy is taken to breathe as much: (20 + 20) × 2 = 80 L/min. One minute at 20 m: 80 × 2.97458 = 237.97 L.
    // Direct ascent 20/9 min at 1.99391 bar: 80 × 2.2222 × 1.99391 = 354.47 L. Together 592.44 L, then 10 bar on top.
    expect(tim!.rockBottom).toHaveLength(1);
    expect(tim!.rockBottom[0]!.depthM).toBe(20);
    expect(litres(tim!.rockBottom[0]!.pressureBar - 10)).toBeCloseTo(592.44, 0);
    // The default rule: ascend at rock bottom, but never below 50 bar. Here rock bottom (about 59 bar) is above it.
    expect(tim!.ascentPressureBar).toBeCloseTo(tim!.rockBottom[0]!.pressureBar, 5);
    expect(tim!.ascentPressureBar).toBeGreaterThan(50);
  });
});

describe('a group', () => {
  const group = [diver('Tim', 20), diver('Ann', 15), diver('Bob', 25)];

  it('gives each Diver their own litres and pressures, rock bottom by the highest SAC of the others', () => {
    const r = plan({ divers: group, rule: { kind: 'rock_bottom' } });
    const [tim, ann, bob] = r.divers;
    // 70.6485 L per L/min over the whole plan; 7.4055 L per L/min of rock bottom at 20 m.
    expect([tim!.litres, ann!.litres, bob!.litres].map((l) => Math.round(l))).toEqual([1413, 1060, 1766]);
    // Tim has Bob (25) at his side: (20 + 25) × 2 = 90 L/min. Ann: (15 + 25) × 2 = 80. Bob: (25 + 20) × 2 = 90.
    expect(litres(tim!.rockBottom[0]!.pressureBar - 10)).toBeCloseTo(90 * 7.4055, 0);
    expect(litres(ann!.rockBottom[0]!.pressureBar - 10)).toBeCloseTo(80 * 7.4055, 0);
    expect(litres(bob!.rockBottom[0]!.pressureBar - 10)).toBeCloseTo(90 * 7.4055, 0);
    expect(ann!.endPressureBar).toBeGreaterThan(tim!.endPressureBar);
    expect(tim!.endPressureBar).toBeGreaterThan(bob!.endPressureBar);
  });

  it('is controlled by the Diver who runs out of margin first', () => {
    const r = plan({ divers: group, rule: { kind: 'rock_bottom' } });
    expect(r.controllingIndex).toBe(2);
    const margins = r.divers.map((d) => d.marginMinutes);
    expect(margins[2]).toBeLessThan(margins[0]!);
    expect(margins[0]).toBeLessThan(margins[1]!);
    expect(r.divers.map((d) => d.controlling)).toEqual([false, false, true]);
  });

  it('is controlled by the smaller supply when the SACs are the same', () => {
    const r = plan({ divers: [diver('Tim', 20, 12), diver('Ann', 20, 10)], rule: { kind: 'rock_bottom' } });
    expect(r.controllingIndex).toBe(1);
  });
});

describe('the other gas rules', () => {
  const tim = diver('Tim', 20);

  it('fixed reserve: the ascent starts with the reserve plus the ascent and the safety stop, here 88.62 + 90.21 L', () => {
    const [d] = plan({ divers: [tim], rule: { kind: 'reserve', bar: 50 } }).divers;
    expect(litres(d!.ascentPressureBar)).toBeCloseTo(litres(50) + 178.83, 0);
  });

  it('fixed ascent pressure: the ascent starts at that pressure', () => {
    const [d] = plan({ divers: [tim], rule: { kind: 'ascent_pressure', bar: 100 } }).divers;
    expect(d!.ascentPressureBar).toBe(100);
    expect(d!.belowRockBottom).toBe(false);
    expect(plan({ divers: [tim], rule: { kind: 'ascent_pressure', bar: 40 } }).divers[0]!.belowRockBottom).toBe(true);
  });

  it('never ascends below 50 bar with rock bottom, whatever rock bottom comes to', () => {
    // At 6 m for 20 minutes rock bottom is about 20 bar.
    const [d] = plan({ divers: [tim], rule: { kind: 'rock_bottom' }, levels: [{ depthM: 6, minutes: 20 }] }).divers;
    expect(d!.rockBottom[0]!.pressureBar).toBeLessThan(50);
    expect(d!.ascentPressureBar).toBe(50);
  });

  it('halves, thirds and sixths: the smaller supply sets the litres to turn on, each Diver turns by their own pressure', () => {
    const ann = diver('Ann', 20, 10);
    const small = surfaceLitres(10, 200, AIR);
    for (const [kind, share] of [['halves', 1 / 2], ['thirds', 1 / 3], ['sixths', 1 / 6]] as const) {
      const [t, a] = plan({ divers: [tim, ann], rule: { kind } }).divers;
      // Ann's 10 L supply is smaller: she turns after a share of it; Tim turns after the same litres.
      expect(surfaceLitres(10, a!.turnPressureBar!, AIR)).toBeCloseTo(small * (1 - share), 3);
      expect(surfaceLitres(12, t!.turnPressureBar!, AIR)).toBeCloseTo(surfaceLitres(12, 200, AIR) - small * share, 3);
      // Back out the same litres, then up: the remaining supply (less the share twice) plus the ascent.
      expect(surfaceLitres(10, a!.ascentPressureBar, AIR)).toBeCloseTo(small * (1 - 2 * share) + 178.83, 0);
    }
  });

  it('has no turn pressure under the other rules', () => {
    expect(plan({ divers: [tim], rule: { kind: 'rock_bottom' } }).divers[0]!.turnPressureBar).toBeNull();
  });
});

describe('whether the plan fits', () => {
  const tim = diver('Tim', 20);

  it('has a margin above the ascent pressure, and the minute to leave the last level by', () => {
    const r = plan({ divers: [tim], rule: { kind: 'rock_bottom' } });
    expect(r.fits).toBe(true);
    const [d] = r.divers;
    expect(d!.marginBar).toBeGreaterThan(0);
    expect(d!.atAscentStartBar).toBeCloseTo(d!.ascentPressureBar + d!.marginBar, 5);
    // The plan reaches 20 m at minute 1.11 and leaves at 21.11: it could stay longer.
    expect(r.leaveLastLevelAtMinute).toBeGreaterThan(21.11);
  });

  it('says so when a level does not fit, and leaves the last level at the minute that does', () => {
    const long = plan({ divers: [tim], rule: { kind: 'rock_bottom' }, levels: [{ depthM: 20, minutes: 40 }] });
    expect(long.fits).toBe(false);
    expect(long.divers[0]!.marginBar).toBeLessThan(0);
    const leave = long.leaveLastLevelAtMinute;
    expect(leave).toBeLessThan(41.11);
    // Staying the whole minutes up to that minute fits, one more does not.
    const stay = Math.floor(leave - 20 / 18);
    expect(plan({ divers: [tim], rule: { kind: 'rock_bottom' }, levels: [{ depthM: 20, minutes: stay }] }).fits).toBe(true);
    expect(plan({ divers: [tim], rule: { kind: 'rock_bottom' }, levels: [{ depthM: 20, minutes: stay + 1 }] }).fits).toBe(false);
  });
});

describe('limits', () => {
  const tim = diver('Tim', 20);
  const refused = (input: Partial<GasPlanInput>) => planGas({ ...base, divers: [tim], rule: { kind: 'rock_bottom' }, ...input });

  it('answers nothing deeper than 40 m, beyond the MOD at the contingency ppO2, or for a mix outside air and nitrox', () => {
    expect(refused({ levels: [{ depthM: 41, minutes: 5 }] })).toMatchObject({ status: 'outside_limits', reason: 'depth', levelIndex: 0 });
    // EAN40: (1.6 / 0.4 − 1.01325) × 10.19716 = 30.4 m.
    expect(refused({ gas: { o2: 40, he: 0 }, levels: [{ depthM: 20, minutes: 5 }, { depthM: 35, minutes: 5 }] }))
      .toMatchObject({ status: 'outside_limits', reason: 'mod', levelIndex: 1 });
    expect(refused({ gas: { o2: 21, he: 10 } })).toMatchObject({ status: 'outside_limits', reason: 'gas' });
    expect(refused({ gas: { o2: 50, he: 0 } })).toMatchObject({ status: 'outside_limits', reason: 'gas' });
  });
});

describe('the stretches of a plan, in the order they are dived', () => {
  it('goes up to the safety stop, stops there, and then to the surface', () => {
    const r = plan({ divers: [diver('Tim', 20)], rule: { kind: 'rock_bottom' } });
    expect(r.segments.map((s) => [s.kind, s.fromDepthM, s.depthM])).toEqual([
      ['descent', 0, 20], ['level', 20, 20], ['ascent', 20, 5], ['safety_stop', 5, 5], ['ascent', 5, 0],
    ]);
    const minutes = r.segments.map((s) => s.minutes);
    [20 / 18, 20, 15 / 9, 3, 5 / 9].forEach((m, i) => expect(minutes[i]).toBeCloseTo(m, 5));
  });

  it('moves between levels at the same rates, and has no stop from a level above it', () => {
    const r = plan({ levels: [{ depthM: 20, minutes: 10 }, { depthM: 10, minutes: 10 }, { depthM: 4, minutes: 5 }], divers: [diver('Tim', 20)], rule: { kind: 'rock_bottom' } });
    expect(r.segments.map((s) => [s.kind, s.fromDepthM, s.depthM])).toEqual([
      ['descent', 0, 20], ['level', 20, 20], ['ascent', 20, 10], ['level', 10, 10], ['ascent', 10, 4], ['level', 4, 4], ['ascent', 4, 0],
    ]);
  });

  it("gives each Diver's pressure at the start and at the end of every stretch", () => {
    const r = plan({ divers: [diver('Tim', 20)], rule: { kind: 'rock_bottom' } });
    const [tim] = r.divers;
    expect(tim!.pressuresBar).toHaveLength(r.segments.length + 1);
    expect(tim!.pressuresBar[0]).toBeCloseTo(200, 5);
    // After the descent (44.31 L) and the level (1189.83 L); the last one is the pressure at the end.
    expect(litres(tim!.pressuresBar[2]!)).toBeCloseTo(litres(200) - 44.31 - 1189.83, 0);
    expect(tim!.pressuresBar[2]).toBeCloseTo(tim!.atAscentStartBar, 5);
    expect(tim!.pressuresBar.at(-1)).toBeCloseTo(tim!.endPressureBar, 5);
  });
});

describe('the rates of descent and ascent', () => {
  const tim = [diver('Tim', 20)];

  it('are 18 and 9 m/min unless the plan says otherwise', () => {
    const r = plan({ divers: tim, rule: { kind: 'rock_bottom' }, descentRateMPerMin: 10, ascentRateMPerMin: 6 });
    // Descent 2 min at the mean 1.99391 bar: 79.76 L. Level 1189.83 L. Ascent 20/6 min at 1.99391: 132.93 L. Stop 90.21 L.
    expect(r.runtimeMinutes).toBeCloseTo(2 + 20 + 20 / 6 + 3, 5);
    expect(r.divers[0]!.litres).toBeCloseTo(79.76 + 1189.83 + 132.93 + 90.21, 0);
  });

  it('rock bottom follows a slower ascent, and never counts on a faster one than 9 m/min', () => {
    const slow = plan({ divers: tim, rule: { kind: 'rock_bottom' }, ascentRateMPerMin: 6 });
    // 80 L/min for a minute at 20 m (237.97 L) and 20/6 min at 1.99391 bar (531.71 L): 769.68 L.
    expect(litres(slow.divers[0]!.rockBottom[0]!.pressureBar - 10)).toBeCloseTo(769.68, 0);
    const fast = plan({ divers: tim, rule: { kind: 'rock_bottom' }, ascentRateMPerMin: 18 });
    expect(litres(fast.divers[0]!.rockBottom[0]!.pressureBar - 10)).toBeCloseTo(592.44, 0);
  });
});
