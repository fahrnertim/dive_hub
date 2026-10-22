// The lead estimate (ADR 0031, slice 20a): one estimate from three kinds of evidence, as plain data in and out.
//   physics        the cylinder's buoyancy at reserve and the water's density: what changes between dives
//   anchor/adjust  the Diver's own dives with the same suit set-up carry the body and the suit
//   rule of thumb  a first guess where there is no such dive
// Never certain: the answer always carries a range, its basis, each adjustment and what was missing.
// Design: docs/research/2026-10-06-weight-calculator.md ("Proposed estimator").
import type { Suit } from '../dives/weighting.js';
import type { SiteWaterType } from '../vocabulary.js';
import type {
  Confidence, EstimateAdjustment, EstimateBasis, EstimateCylinder, EstimateDive, EstimateInput, EstimateMissing, LeadEstimate,
  LeadUnit,
} from './types.js';

// ---- Constants. Every number that is a judgement or unverified is named here, with its source, so a correction is one edit.

/** Reserve pressure when the Diver's dives log no end pressure (DAN: weigh for 5 m with 35-50 bar left). */
const DEFAULT_RESERVE_BAR = 50;
/** Mass of air per litre at 1 bar, kg (1.225 g/L; Wikipedia, "Diving cylinder"). Nitrox and trimix differ by under 10 %. */
const GAS_KG_PER_LITRE_BAR = 0.001225;
/** Water density in kg/m3: fresh and salt as in the vocabulary; brackish halfway (ADR 0031, "Still to check"). */
const WATER_DENSITY_KG_M3: Record<SiteWaterType, number> = { fresh: 1000, brackish: 1012, salt: 1025 };
/**
 * Mass in air of everything a diver wears and carries but the lead and the body: cylinder, BC, regulator, suit. A
 * judgement (a steel 12 L alone is about 15 kg); it only scales the 2.5 % water term, so ±10 kg moves it by 0.25 kg.
 */
const GEAR_MASS_KG = 25;
/** Used for the water term only when no body weight is set; the missing weight is reported. */
const FALLBACK_BODY_WEIGHT_KG = 75;

/** A 1 kg correction when feedback says "too heavy" or "too light" without an amount (ADR 0031). */
const FEEDBACK_DEFAULT_KG = 1;
/** Dive weights: felt right counts twice, and a dive loses half its weight every two years (ADR 0031). */
const WEIGHT_FELT_RIGHT = 2;
const WEIGHT_OTHER = 1;
const HALF_LIFE_YEARS = 2;
const DAYS_PER_YEAR = 365.25;

/**
 * Empty (no gas) buoyancy in kg of one cylinder by water volume, in seawater, positive floats. Points are the published
 * values of the research note's table (Wikipedia, "Diving cylinder", Luxfer and Faber datasheets) between zero and the
 * largest listed size; between points linear, beyond the last constant. Origin anchors keep small cylinders sensible.
 * A manifold's own mass is not counted.
 */
const EMPTY_BUOYANCY_POINTS: Record<'aluminium' | 'steel', readonly (readonly [volumeL: number, kg: number])[]> = {
  aluminium: [[0, 0], [9, 1.8], [11.1, 1.7], [13, 1.4]],
  steel: [[0, 0], [12, -1.2], [15, -1.4]],
};
/** A single cylinder above this is a twin set (the catalogue gives twins as one volume): two cylinders of half. */
const TWIN_ABOVE_L = 20;

const ROUND_KG = 0.5;
const KG_PER_LB = 0.45359237;

// Range and confidence: judgements, not statistics; the dives are few.
/** Half-width of the range, kg, floors by basis: the spread of the dives can widen it, never narrow it below this. */
const HALF_WIDTH_MANY_DIVES_KG = 1;
const HALF_WIDTH_FEW_DIVES_KG = 1.5;
const HALF_WIDTH_RULE_WITH_OFFSET_KG = 2;
/** The rule of thumb is good to ±2-3 kg (research note), the upper end for a Diver with no history. */
const HALF_WIDTH_RULE_ALONE_KG = 3;
/** "Few" is up to this many dives; "many" (high confidence) from this many. */
const FEW_DIVES = 2;
const MANY_DIVES = 5;
/** Converts a median absolute deviation to a standard deviation for normally spread values. */
const MAD_TO_SIGMA = 1.4826;

// Rule of thumb (strategy 1). UNVERIFIED against PADI's printed table: the numbers are as seen through the open-source
// Lead app's code (quoting PADI's basic guideline), PADI's blog (2024) and DAN (2014), see the research note's table. A
// correction is an edit of this block. They assume salt water and an AL80 (below); no study validates any of them.
const RULE_PERCENT_THIN = 0.05; // 3 mm one-piece and thinner
const RULE_PERCENT_THICK = 0.1; // 5 mm and thicker, drysuits
const RULE_THIN_UP_TO_MM = 3;
/** Extra kg for 7 mm and thicker with a hood (PADI: "7 mm + hood and boots: 10 % + 1.5-3 kg"; the low end, as the note's scenario). */
const RULE_THICK_FROM_MM = 7;
const RULE_THICK_EXTRA_KG = 2;
/** Assumed where a wetsuit's thickness was not logged: the middle band (reported as missing). */
const RULE_ASSUMED_THICKNESS_MM = 5;
/** Swimsuit or skin: 0.5-2 kg (PADI), the middle. */
const RULE_SKIN_KG = 1.25;
/** Drysuit, 10 % plus: light undergarment 1.5-3 kg, heavy 3-7 kg (PADI); the low end of light, the middle of heavy. */
const RULE_DRYSUIT_EXTRA_KG = { light: 2, medium: 4, heavy: 5 } as const;
/** The conditions the rule is quoted for. */
const RULE_WATER: SiteWaterType = 'salt';
const RULE_CYLINDER: EstimateCylinder = { volumeL: 11.1, material: 'aluminium' };

/** The rule's lead in kg for the suit and body weight, in salt water with an AL80, and what it had to assume. */
function ruleOfThumbKg(suit: Suit, bodyWeightKg: number): { kg: number; missing: EstimateMissing[] } {
  const missing: EstimateMissing[] = [];
  if (suit.type === 'none' || suit.type === 'skin') return { kg: RULE_SKIN_KG, missing };
  if (suit.type === 'drysuit') {
    if (suit.undergarment === null) missing.push({ kind: 'suit_undergarment' });
    return { kg: RULE_PERCENT_THICK * bodyWeightKg + RULE_DRYSUIT_EXTRA_KG[suit.undergarment ?? 'medium'], missing };
  }
  if (suit.thicknessMm === null) missing.push({ kind: 'suit_thickness' });
  const mm = suit.thicknessMm ?? RULE_ASSUMED_THICKNESS_MM;
  if (mm <= RULE_THIN_UP_TO_MM) return { kg: RULE_PERCENT_THIN * bodyWeightKg, missing };
  // A hood is part of the table's 7 mm row; only a logged "no hood" leaves the extra out.
  const extra = mm >= RULE_THICK_FROM_MM && suit.hood !== false ? RULE_THICK_EXTRA_KG : 0;
  return { kg: RULE_PERCENT_THICK * bodyWeightKg + extra, missing };
}

// ---- Physics.

function emptyBuoyancyKg(volumeL: number, material: 'aluminium' | 'steel'): number {
  const points = EMPTY_BUOYANCY_POINTS[material];
  const last = points[points.length - 1]!;
  if (volumeL >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [v1, b1] = points[i]!;
    if (volumeL <= v1) {
      const [v0, b0] = points[i - 1]!;
      return b0 + ((b1 - b0) * (volumeL - v0)) / (v1 - v0);
    }
  }
  return last[1];
}

interface CylinderTerm {
  kg: number;
  /** Half the difference between aluminium and steel where the material is not known, else 0. */
  uncertaintyKg: number;
  materialKnown: boolean;
}

/** One cylinder's buoyancy at reserve in kg (positive floats, so needs more lead). */
function oneCylinderAtReserve(c: EstimateCylinder, reserveBar: number): CylinderTerm {
  const twin = c.volumeL > TWIN_ABOVE_L;
  const each = twin ? c.volumeL / 2 : c.volumeL;
  const count = twin ? 2 : 1;
  const gas = each * reserveBar * GAS_KG_PER_LITRE_BAR;
  // Carbon is not tabulated: it is treated like an unknown material rather than guessed as aluminium or steel.
  const material = c.material === 'aluminium' || c.material === 'steel' ? c.material : null;
  const alu = emptyBuoyancyKg(each, 'aluminium');
  const steel = emptyBuoyancyKg(each, 'steel');
  const empty = material === 'aluminium' ? alu : material === 'steel' ? steel : (alu + steel) / 2;
  return {
    kg: count * (empty - gas),
    uncertaintyKg: material ? 0 : (count * Math.abs(alu - steel)) / 2,
    materialKnown: material !== null,
  };
}

function cylindersAtReserve(cylinders: readonly EstimateCylinder[], reserveBar: number): CylinderTerm {
  const terms = cylinders.map((c) => oneCylinderAtReserve(c, reserveBar));
  return {
    kg: terms.reduce((s, t) => s + t.kg, 0),
    uncertaintyKg: terms.reduce((s, t) => s + t.uncertaintyKg, 0),
    materialKnown: terms.every((t) => t.materialKnown),
  };
}

const densityRatio = (water: SiteWaterType) => WATER_DENSITY_KG_M3[water] / WATER_DENSITY_KG_M3.fresh;

/**
 * Lead needed in `water` for a base (personal + cylinder terms, as at fresh water). The denser water needs its ratio
 * more displacement for everything carried, body and gear and lead: needed = base x ratio + (body + gear) x (ratio - 1).
 * Fresh to salt is then 2.5 % of the total mass.
 */
const neededIn = (water: SiteWaterType, base: number, bodyAndGearKg: number) =>
  base * densityRatio(water) + bodyAndGearKg * (densityRatio(water) - 1);
/** The inverse: the base (as at fresh water) from what was needed in `water`. */
const baseFrom = (water: SiteWaterType, needed: number, bodyAndGearKg: number) =>
  (needed - bodyAndGearKg * (densityRatio(water) - 1)) / densityRatio(water);

// ---- Statistics.

interface Weighted {
  value: number;
  weight: number;
}

/** The weighted median; at exactly half the weight, the mean of the two values around it. */
function weightedMedian(items: readonly Weighted[]): number {
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const half = sorted.reduce((s, i) => s + i.weight, 0) / 2;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i]!.weight;
    if (Math.abs(cumulative - half) < 1e-9 && i + 1 < sorted.length) return (sorted[i]!.value + sorted[i + 1]!.value) / 2;
    if (cumulative > half) return sorted[i]!.value;
  }
  return sorted[sorted.length - 1]!.value;
}

const median = (values: readonly number[]) => weightedMedian(values.map((value) => ({ value, weight: 1 })));

// ---- Dives.

/** What a dive needed: carried, corrected by its feedback. Too heavy by x: carried - x; too light by x: carried + x. */
function neededKg(carried: number, feedback: EstimateDive['feedback']): number {
  if (!feedback || feedback.felt === 'right') return carried;
  const amount = feedback.amountKg ?? FEEDBACK_DEFAULT_KG;
  return feedback.felt === 'too_heavy' ? carried - amount : carried + amount;
}

function diveWeight(d: EstimateDive, today: Date): number {
  const years = Math.max(0, (today.getTime() - d.date.getTime()) / 86_400_000 / DAYS_PER_YEAR);
  return (d.feedback?.felt === 'right' ? WEIGHT_FELT_RIGHT : WEIGHT_OTHER) * 0.5 ** (years / HALF_LIFE_YEARS);
}

/** The Diver's reserve: the median of every logged end pressure, else the default. */
function reserveOf(dives: readonly EstimateDive[]): { bar: number; fromDives: boolean } {
  const pressures = dives.flatMap((d) => d.cylinders.map((c) => c.endPressureBar)).filter((p): p is number => p !== null && p > 0);
  return pressures.length > 0 ? { bar: median(pressures), fromDives: true } : { bar: DEFAULT_RESERVE_BAR, fromDives: false };
}

const suitKey = (s: Suit) =>
  s.type === 'none' || s.type === 'skin' ? s.type : `${s.type}|${s.thicknessMm}|${s.hood}|${s.undergarment}`;

// ---- Output units.

const roundTo = (value: number, step: number) => Math.round(value / step) * step;
/** Kilograms in the answer's unit, unrounded. */
const inUnit = (kg: number, unit: LeadUnit) => (unit === 'lb' ? kg / KG_PER_LB : kg);
/** A total in the answer's unit, rounded to 0.5 kg or 1 lb. */
const roundedTotal = (kg: number, unit: LeadUnit) => (unit === 'lb' ? Math.round(kg / KG_PER_LB) : roundTo(kg, ROUND_KG));
/** For explanations: one decimal. */
const detail = (kg: number, unit: LeadUnit) => Math.round(inUnit(kg, unit) * 10) / 10;

function answer(totalKg: number, halfWidthKg: number, unit: LeadUnit) {
  return {
    total: roundedTotal(totalKg, unit),
    range: { low: roundedTotal(Math.max(0, totalKg - halfWidthKg), unit), high: roundedTotal(totalKg + halfWidthKg, unit) },
  };
}

// ---- The estimate.

interface Terms {
  weighted: Weighted[];
  used: { id: string; carried: number; needed: number; weight: number }[];
  unknownMaterial: string[];
  noCylinder: string[];
  /** The largest uncertainty from a cylinder of unknown material among the dives. */
  uncertaintyKg: number;
}

/**
 * Each dive's personal term: what it needed, with its cylinder at reserve and its water removed (as at fresh water, a
 * cylinder that is neutral at reserve). A dive without a cylinder is taken to have had the planned one.
 */
function personalTerms(
  dives: readonly EstimateDive[], reserveBar: number, plannedCylinderKg: number, bodyAndGearKg: number, today: Date,
): Terms {
  const t: Terms = { weighted: [], used: [], unknownMaterial: [], noCylinder: [], uncertaintyKg: 0 };
  for (const d of dives) {
    const needed = neededKg(d.leadKg!, d.feedback);
    let cylinderKg = plannedCylinderKg;
    if (d.cylinders.length === 0) {
      t.noCylinder.push(d.id);
    } else {
      const term = cylindersAtReserve(d.cylinders, reserveBar);
      cylinderKg = term.kg;
      t.uncertaintyKg = Math.max(t.uncertaintyKg, term.uncertaintyKg);
      if (!term.materialKnown) t.unknownMaterial.push(d.id);
    }
    const weight = diveWeight(d, today);
    t.weighted.push({ value: baseFrom(d.water!, needed, bodyAndGearKg) - cylinderKg, weight });
    t.used.push({ id: d.id, carried: d.leadKg!, needed, weight });
  }
  return t;
}

export function estimateLead(input: EstimateInput): LeadEstimate {
  const { plan, unit } = input;
  const reserve = reserveOf(input.dives);
  const missing: EstimateMissing[] = [];
  if (input.bodyWeightKg === null) missing.push({ kind: 'body_weight' });
  const bodyAndGearKg = (input.bodyWeightKg ?? FALLBACK_BODY_WEIGHT_KG) + GEAR_MASS_KG;

  const planCylinders = cylindersAtReserve(plan.cylinders, reserve.bar);
  const planMaterialUnknown = !planCylinders.materialKnown;

  // Candidates: lead logged (0 counts), a suit set-up, the water known from the site.
  const eligible = input.dives.filter((d) => d.leadKg !== null && d.suit !== null && d.water !== null);
  const candidates = eligible.filter((d) => suitKey(d.suit!) === suitKey(plan.suit));
  const terms = personalTerms(candidates, reserve.bar, planCylinders.kg, bodyAndGearKg, input.today);

  if (terms.weighted.length > 0) {
    if (terms.unknownMaterial.length > 0 || planMaterialUnknown) {
      missing.push({ kind: 'cylinder_material', diveIds: terms.unknownMaterial, planned: planMaterialUnknown });
    }
    if (terms.noCylinder.length > 0) missing.push({ kind: 'cylinder', diveIds: terms.noCylinder });

    const personal = weightedMedian(terms.weighted);
    const spread = MAD_TO_SIGMA * weightedMedian(terms.weighted.map((w) => ({ value: Math.abs(w.value - personal), weight: w.weight })));
    const floor = terms.used.length <= FEW_DIVES ? HALF_WIDTH_FEW_DIVES_KG : HALF_WIDTH_MANY_DIVES_KG;
    const halfWidth = Math.max(floor, spread) + Math.max(terms.uncertaintyKg, planCylinders.uncertaintyKg);

    const total = neededIn(plan.water, personal + planCylinders.kg, bodyAndGearKg);
    const basis: EstimateBasis = {
      kind: 'dives',
      dives: terms.used.map((u) => ({ id: u.id, carried: detail(u.carried, unit), needed: detail(u.needed, unit), weight: u.weight })),
      personal: detail(personal, unit),
    };
    return {
      unit, ...answer(total, halfWidth, unit), confidence: terms.used.length >= MANY_DIVES ? 'high' : 'medium', basis, missing, reserve,
      adjustments: [
        { kind: 'cylinder', amount: detail(planCylinders.kg, unit) },
        { kind: 'water', amount: detail(total - (personal + planCylinders.kg), unit), water: plan.water },
      ],
    };
  }

  // No dive with this suit set-up: the rule of thumb, shifted by the Diver's own offset from the suits they did log.
  if (input.bodyWeightKg === null) {
    return { unit, total: null, range: null, confidence: 'low', basis: null, adjustments: [], missing, reserve };
  }
  const bodyWeightKg = input.bodyWeightKg;
  const ruleCylinderKg = cylindersAtReserve([RULE_CYLINDER], reserve.bar).kg;
  /** The rule's personal term: its lead at the rule's conditions, taken back to fresh water and a neutral cylinder. */
  const ruleTerm = (suit: Suit) => baseFrom(RULE_WATER, ruleOfThumbKg(suit, bodyWeightKg).kg, bodyAndGearKg) - ruleCylinderKg;

  const bySuit = new Map<string, EstimateDive[]>();
  for (const d of eligible) bySuit.set(suitKey(d.suit!), [...(bySuit.get(suitKey(d.suit!)) ?? []), d]);
  const offsets: number[] = [];
  let offsetUncertaintyKg = 0;
  for (const group of bySuit.values()) {
    const g = personalTerms(group, reserve.bar, planCylinders.kg, bodyAndGearKg, input.today);
    offsets.push(weightedMedian(g.weighted) - ruleTerm(group[0]!.suit!));
    offsetUncertaintyKg = Math.max(offsetUncertaintyKg, g.uncertaintyKg);
    if (g.unknownMaterial.length > 0) missing.push({ kind: 'cylinder_material', diveIds: g.unknownMaterial, planned: false });
    if (g.noCylinder.length > 0) missing.push({ kind: 'cylinder', diveIds: g.noCylinder });
  }
  const offset = offsets.length > 0 ? median(offsets) : null;

  const rule = ruleOfThumbKg(plan.suit, bodyWeightKg);
  missing.push(...rule.missing);
  if (planMaterialUnknown) missing.push({ kind: 'cylinder_material', diveIds: [], planned: true });
  const personal = ruleTerm(plan.suit) + (offset ?? 0);
  const total = neededIn(plan.water, personal + planCylinders.kg, bodyAndGearKg);
  const halfWidth = (offset === null ? HALF_WIDTH_RULE_ALONE_KG : HALF_WIDTH_RULE_WITH_OFFSET_KG)
    + Math.max(offsetUncertaintyKg, planCylinders.uncertaintyKg);
  const adjustments: EstimateAdjustment[] = [
    ...(offset === null ? [] : [{ kind: 'personal_offset', amount: detail(offset, unit) } as const]),
    { kind: 'cylinder', amount: detail(planCylinders.kg, unit) },
    { kind: 'water', amount: detail(total - (personal + planCylinders.kg), unit), water: plan.water },
  ];
  return {
    unit, ...answer(total, halfWidth, unit), confidence: 'low', missing, reserve, adjustments,
    basis: {
      kind: 'rule_of_thumb', rule: detail(rule.kg, unit), personalOffset: offset === null ? null : detail(offset, unit),
      offsetFromSuits: offsets.length,
    },
  };
}
