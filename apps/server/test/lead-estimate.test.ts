// The lead estimate engine (ADR 0031, slice 20a): pure function, no database. Expected values are worked by hand
// from the rules in docs/research/2026-10-06-weight-calculator.md and docs/spec/data-model.md scenario 5, not by
// calling the engine's own helpers. Hand calculations use the engine's constants where they are named in a comment:
//   reserve 50 bar; gas 0.001225 kg per litre and bar; empty buoyancy AL80 (11.1 L) +1.59, steel 12 L -1.20 (research table);
//   total mass for the water term = body weight + 25 kg gear + lead; water 1000 / 1025 / 1012 kg/m3.
import { describe, expect, it } from 'vitest';
import { estimateLead } from '../src/lead/estimate.js';
import type { EstimateDive, EstimateInput } from '../src/lead/types.js';

const TODAY = new Date('2026-10-13T12:00:00Z');
const WETSUIT_5 = { type: 'wetsuit', thicknessMm: 5, hood: false, undergarment: null } as const;
const WETSUIT_7_HOOD = { type: 'wetsuit', thicknessMm: 7, hood: true, undergarment: null } as const;
const AL80 = { volumeL: 11.1, material: 'aluminium' } as const;
const STEEL_12 = { volumeL: 12, material: 'steel' } as const;

let nextId = 0;
function dive(over: Partial<EstimateDive> = {}): EstimateDive {
  return {
    id: `dive-${++nextId}`, date: TODAY, leadKg: 8, feedback: null, suit: WETSUIT_7_HOOD, water: 'fresh',
    cylinders: [{ ...STEEL_12, endPressureBar: null }], ...over,
  };
}
function input(over: Partial<EstimateInput> = {}): EstimateInput {
  return {
    dives: [], bodyWeightKg: 82, unit: 'kg', today: TODAY,
    plan: { water: 'salt', suit: WETSUIT_5, cylinders: [AL80] }, ...over,
  };
}

describe('anchor and adjust from the Diver\'s own dives', () => {
  it('rests on one dive with the same suit: 10 kg, too heavy by 2 kg, in the same conditions needs 8 kg (scenario 5)', () => {
    const redSea = dive({
      id: 'red-sea-1', leadKg: 10, feedback: { felt: 'too_heavy', amountKg: 2 }, suit: WETSUIT_5, water: 'salt',
      cylinders: [{ ...AL80, endPressureBar: null }],
    });
    const result = estimateLead(input({ dives: [redSea] }));

    expect(result.total).toBe(8);
    expect(result.confidence).toBe('medium');
    expect(result.basis).toMatchObject({ kind: 'dives', dives: [{ id: 'red-sea-1', carried: 10, needed: 8, weight: 1 }] });
    expect(result.missing).toEqual([]);
  });
});

describe('the rule of thumb', () => {
  it('without any dive: 10 % of 82 kg for a 5 mm suit in salt water with an AL80 is 8.2 kg, rounded to 8, a low-confidence first guess', () => {
    const result = estimateLead(input());

    expect(result.total).toBe(8);
    expect(result.range).toEqual({ low: 5, high: 11 });
    expect(result.confidence).toBe('low');
    expect(result.basis).toMatchObject({ kind: 'rule_of_thumb', rule: 8.2, personalOffset: null, offsetFromSuits: 0 });
  });

  it('without any dive and without body weight: no number, and body weight is what was missing', () => {
    const result = estimateLead(input({ bodyWeightKg: null }));

    expect(result.total).toBeNull();
    expect(result.range).toBeNull();
    expect(result.basis).toBeNull();
    expect(result.missing).toContainEqual({ kind: 'body_weight' });
  });

  it('with dives of another suit: the rule shifted by the Diver\'s personal offset (scenario 5, six 7 mm dives)', () => {
    // Tim carried 8 kg fresh with a 12 L steel on six dives: three felt right, one too heavy by 1 kg, two said nothing.
    // Steel 12 L at 50 bar: -1.2 - 12 x 50 x 0.001225 = -1.935, so each dive's personal term is 8 + 1.935 = 9.935
    // (the too heavy one 8.935; the median stays 9.935). Rule for 7 mm + hood: 0.10 x 82 + 2 = 10.2 kg in salt with an AL80;
    // AL80 at 50 bar: 1.7 - 0.68 = +1.02. Personal term of the rule: (10.2 - 107 x 0.025) / 1.025 - 1.02 = 6.3215,
    // so the offset is 9.935 - 6.3215 = +3.6135. Rule for 5 mm: 8.2 -> (8.2 - 2.675) / 1.025 - 1.02 = 4.3702; + offset
    // = 7.9837; in salt with an AL80: (7.9837 + 1.02) x 1.025 + 2.675 = 11.90 kg, scenario 5's "about 11.5, 9.5-13.5".
    const tim = [
      ...[1, 2, 3].map(() => dive({ feedback: { felt: 'right', amountKg: null } })),
      dive({ feedback: { felt: 'too_heavy', amountKg: 1 } }),
      dive(), dive(),
    ];
    const result = estimateLead(input({ dives: tim }));

    expect(result.total).toBe(12);
    expect(result.range).toEqual({ low: 10, high: 14 });
    expect(result.confidence).toBe('low');
    expect(result.basis).toMatchObject({ kind: 'rule_of_thumb', rule: 8.2, personalOffset: 3.6, offsetFromSuits: 1 });
    expect(result.adjustments).toContainEqual({ kind: 'personal_offset', amount: 3.6 });
  });
});

// Conditions of the dives below equal the plan's (fresh water, 7 mm suit with hood, steel 12 L) unless a test says
// otherwise, so a dive's needed lead is the estimate and the physics terms cancel.
const SAME_CONDITIONS = { water: 'fresh', suit: WETSUIT_7_HOOD, cylinders: [STEEL_12] } as const;
const inSameConditions = (dives: EstimateDive[], over: Partial<EstimateInput> = {}) =>
  estimateLead(input({ dives, plan: { ...SAME_CONDITIONS, cylinders: [STEEL_12] }, ...over }));
const yearsAgo = (years: number) => new Date(TODAY.getTime() - years * 365.25 * 86_400_000);

describe('which dives count', () => {
  it('leaves out a dive whose water is not known from its site, instead of guessing it', () => {
    const noSite = dive({ id: 'no-site', water: null });
    const result = inSameConditions([noSite]);

    expect(result.basis?.kind).toBe('rule_of_thumb');
    expect(result.basis).toMatchObject({ offsetFromSuits: 0 });
  });

  it('counts 0 kg as no lead, but not a dive with lead unknown', () => {
    const noLead = dive({ id: 'dry', leadKg: 0 });
    const unknown = dive({ id: 'unknown', leadKg: null });
    const result = inSameConditions([noLead, unknown]);

    expect(result.total).toBe(0);
    expect(result.basis).toMatchObject({ kind: 'dives', dives: [{ id: 'dry', carried: 0, needed: 0 }] });
  });

  it('leaves out dives without a suit and dives with another suit set-up, a hood that differs included', () => {
    const noSuit = dive({ suit: null });
    const noHood = dive({ id: 'no-hood', suit: { ...WETSUIT_7_HOOD, hood: false } });
    const result = inSameConditions([noSuit, noHood]);

    expect(result.basis).toMatchObject({ kind: 'rule_of_thumb', offsetFromSuits: 1 });
  });
});

describe('what a dive needed: carried, corrected by its feedback', () => {
  it.each([
    ['felt right', { felt: 'right', amountKg: null }, 8],
    ['no feedback', null, 8],
    ['too heavy, no amount: 1 kg', { felt: 'too_heavy', amountKg: null }, 7],
    ['too heavy by 2.5 kg', { felt: 'too_heavy', amountKg: 2.5 }, 5.5],
    ['too light, no amount: 1 kg', { felt: 'too_light', amountKg: null }, 9],
    ['too light by 1.5 kg', { felt: 'too_light', amountKg: 1.5 }, 9.5],
  ] as const)('%s', (_name, feedback, needed) => {
    const result = inSameConditions([dive({ feedback })]);

    expect(result.total).toBe(needed);
    expect(result.basis).toMatchObject({ kind: 'dives', dives: [{ carried: 8, needed }] });
  });
});

describe('combining dives', () => {
  it('weighs a dive that felt right twice', () => {
    // 6 kg (no feedback, weight 1) and 10 kg (felt right, weight 2): the median is 10; unweighted it would be 8.
    const result = inSameConditions([
      dive({ leadKg: 6 }), dive({ leadKg: 10, feedback: { felt: 'right', amountKg: null } }),
    ]);

    expect(result.total).toBe(10);
  });

  it('halves a dive weight every two years', () => {
    // 10 kg four years ago has weight 0.25, 6 kg today 1: the median is 6; at equal weight it would be 8.
    const result = inSameConditions([dive({ leadKg: 10, date: yearsAgo(4) }), dive({ leadKg: 6 })]);

    expect(result.total).toBe(6);
    expect(result.basis).toMatchObject({ dives: [{ weight: 0.25 }, { weight: 1 }] });
  });

  it('gives the range from the spread of the dives: the median absolute deviation of 4, 6, 8, 10, 12 is 2', () => {
    // sigma = 1.4826 x 2 = 2.965; 8 -/+ 2.965 rounds to 5.0 and 11.0. Five dives: high confidence.
    const result = inSameConditions([4, 6, 8, 10, 12].map((leadKg) => dive({ leadKg })));

    expect(result.total).toBe(8);
    expect(result.range).toEqual({ low: 5, high: 11 });
    expect(result.confidence).toBe('high');
  });

  it('gives dives that agree a narrow range with a floor of 1 kg', () => {
    const result = inSameConditions([8, 8, 8].map((leadKg) => dive({ leadKg })));

    expect(result.range).toEqual({ low: 7, high: 9 });
    expect(result.confidence).toBe('medium');
  });

  it('rests on one dive with a wider floor of 1.5 kg and says so in its confidence', () => {
    const result = inSameConditions([dive({ leadKg: 8 })]);

    expect(result.range).toEqual({ low: 6.5, high: 9.5 });
    expect(result.confidence).toBe('medium');
  });
});

describe('physics', () => {
  it('adds the water: 8 kg in fresh water needs (8 x 1.025 + 107 x 0.025) = 10.875 kg in salt, rounded to 11', () => {
    const result = inSameConditions([dive()], { plan: { ...SAME_CONDITIONS, water: 'salt', cylinders: [STEEL_12] } });

    expect(result.total).toBe(11);
    expect(result.adjustments).toContainEqual({ kind: 'water', amount: 2.9, water: 'salt' });
  });

  it('takes brackish water halfway: 8 x 1.012 + 107 x 0.012 = 9.38 kg, rounded to 9.5', () => {
    const result = inSameConditions([dive()], { plan: { ...SAME_CONDITIONS, water: 'brackish', cylinders: [STEEL_12] } });

    expect(result.total).toBe(9.5);
  });

  it('takes the reserve from the Diver median end pressure and the cylinder at that pressure', () => {
    // End pressures 90, 100, 110 bar: median 100. Steel 12 L at 100 bar: -1.2 - 12 x 100 x 0.001225 = -2.67, so the
    // personal term is 8 + 2.67 = 10.67. AL80 at 100 bar: 1.7 - 11.1 x 100 x 0.001225 = +0.34: 11.01 kg.
    const dives = [90, 100, 110].map((p) => dive({ leadKg: 8, cylinders: [{ ...STEEL_12, endPressureBar: p }] }));
    const result = estimateLead(input({ dives, plan: { water: 'fresh', suit: WETSUIT_7_HOOD, cylinders: [AL80] } }));

    expect(result.reserve).toEqual({ bar: 100, fromDives: true });
    expect(result.basis).toMatchObject({ kind: 'dives', personal: 10.7 });
    expect(result.total).toBe(11);
    expect(result.adjustments).toContainEqual({ kind: 'cylinder', amount: 0.3 });
  });

  it('takes 50 bar when no end pressure was logged', () => {
    expect(inSameConditions([dive()]).reserve).toEqual({ bar: 50, fromDives: false });
  });
});

describe('what was missing', () => {
  it('uses a cylinder without material halfway between aluminium and steel, widens the range and says so', () => {
    // 12 L: aluminium +1.558, steel -1.2, so halfway +0.179 less gas 0.735 = -0.556; personal 9.935; total 9.38 -> 9.5.
    // Half-width 1.5 (one dive) + half the difference 1.379 = 2.879: 9.379 -/+ 2.879 -> 6.5 and 12.5.
    const unknown = { volumeL: 12, material: null };
    const result = inSameConditions([dive()], { plan: { ...SAME_CONDITIONS, cylinders: [unknown] } });

    expect(result.total).toBe(9.5);
    expect(result.range).toEqual({ low: 6.5, high: 12.5 });
    expect(result.missing).toContainEqual({ kind: 'cylinder_material', diveIds: [], planned: true });
  });

  it('names the dives whose cylinder has no material or was not logged at all', () => {
    const rented = dive({ id: 'rented', cylinders: [{ volumeL: 12, material: null, endPressureBar: null }] });
    const none = dive({ id: 'none', cylinders: [] });
    const result = inSameConditions([rented, none]);

    expect(result.missing).toContainEqual({ kind: 'cylinder_material', diveIds: ['rented'], planned: false });
    expect(result.missing).toContainEqual({ kind: 'cylinder', diveIds: ['none'] });
  });

  it('reports a missing body weight but still estimates from dives, with a nominal weight for the water term', () => {
    const result = inSameConditions([dive()], { bodyWeightKg: null });

    expect(result.total).toBe(8);
    expect(result.missing).toEqual([{ kind: 'body_weight' }]);
  });

  it('treats a wetsuit without thickness as 5 mm and says so', () => {
    const suit = { type: 'wetsuit', thicknessMm: null, hood: null, undergarment: null } as const;
    const result = estimateLead(input({ plan: { water: 'salt', suit, cylinders: [AL80] } }));

    expect(result.total).toBe(8);
    expect(result.missing).toContainEqual({ kind: 'suit_thickness' });
  });
});

describe('rule of thumb per suit, 80 kg body weight, salt water and an AL80', () => {
  const rule = (suit: EstimateInput['plan']['suit']) =>
    estimateLead(input({ bodyWeightKg: 80, plan: { water: 'salt', suit, cylinders: [AL80] } }));

  it.each([
    ['skin: 0.5-2 kg, the middle 1.25', { type: 'skin', thicknessMm: null, hood: null, undergarment: null }, 1.3],
    ['3 mm: 5 %', { type: 'wetsuit', thicknessMm: 3, hood: null, undergarment: null }, 4],
    ['5 mm: 10 %', { type: 'wetsuit', thicknessMm: 5, hood: false, undergarment: null }, 8],
    ['7 mm with hood: 10 % + 2', { type: 'semidry', thicknessMm: 7, hood: true, undergarment: null }, 10],
    ['7 mm logged without hood: 10 %', { type: 'wetsuit', thicknessMm: 7, hood: false, undergarment: null }, 8],
    ['drysuit, heavy undergarment: 10 % + 5', { type: 'drysuit', thicknessMm: null, hood: null, undergarment: 'heavy' }, 13],
  ] as const)('%s', (_name, suit, kg) => {
    expect(rule(suit).basis).toMatchObject({ kind: 'rule_of_thumb', rule: kg });
  });
});

describe('units', () => {
  it('rounds a total to 1 lb in imperial: 8.2 kg is 18.08 lb, range 5.2-11.2 kg is 11 and 25 lb', () => {
    const result = estimateLead(input({ unit: 'lb' }));

    expect(result.unit).toBe('lb');
    expect(result.total).toBe(18);
    expect(result.range).toEqual({ low: 11, high: 25 });
    expect(result.basis).toMatchObject({ rule: 18.1 });
  });

  it('rounds to 0.5 kg in metric: 10.7 kg is 10.5, 10.8 kg is 11', () => {
    expect(inSameConditions([dive({ leadKg: 10.7 })]).total).toBe(10.5);
    expect(inSameConditions([dive({ leadKg: 10.8 })]).total).toBe(11);
  });
});
