// Types of the lead estimate (ADR 0031, slice 20a): plain data in, a plain answer out. No database, no HTTP.
import type { CylinderMaterial } from '../db/schema.js';
import type { Suit, WeightingFeedback } from '../dives/weighting.js';
import type { SiteWaterType } from '../vocabulary.js';

/** The unit the answer is rounded and given in: 0.5 kg, or whole pounds. */
export type LeadUnit = 'kg' | 'lb';

export interface EstimateCylinder {
  volumeL: number;
  /** Null when not logged: its buoyancy is then taken halfway between aluminium and steel and the range widens. */
  material: CylinderMaterial | null;
}

/** One of the Diver's Dives (not deleted: the caller leaves those out), as far as the estimate looks at it. */
export interface EstimateDive {
  id: string;
  /** When it was dived: older dives weigh less. */
  date: Date;
  /** The total of its Lead entries in kg; null when none were logged (unknown). 0 is no lead and counts. */
  leadKg: number | null;
  feedback: WeightingFeedback | null;
  suit: Suit | null;
  /** The water of its site (ADR 0025); null when the Dive has no site or the site no water type. */
  water: SiteWaterType | null;
  cylinders: (EstimateCylinder & { endPressureBar: number | null })[];
}

export interface PlannedConditions {
  water: SiteWaterType;
  suit: Suit;
  cylinders: EstimateCylinder[];
}

export interface EstimateInput {
  dives: EstimateDive[];
  /** The Diver's latest body weight in kg; null when none is set. */
  bodyWeightKg: number | null;
  plan: PlannedConditions;
  unit: LeadUnit;
  /** The day the plan is made on, for the age of the dives. */
  today: Date;
}

export type Confidence = 'low' | 'medium' | 'high';

/** What the estimate rests on. */
export type EstimateBasis =
  | {
      kind: 'dives';
      /** The Dives it rests on with what each needed (as carried, corrected by its feedback) in the answer's unit. */
      dives: { id: string; carried: number; needed: number; weight: number }[];
      /** The Diver's own term in the answer's unit: needed at fresh water with a cylinder that is neutral at reserve. */
      personal: number;
    }
  | {
      kind: 'rule_of_thumb';
      /** The rule for the planned suit, salt water and an AL80, in the answer's unit. */
      rule: number;
      /** How far the Diver's own Dives differ from the rule for the suits they logged; null without any. */
      personalOffset: number | null;
      /** How many suit set-ups the offset comes from. */
      offsetFromSuits: number;
    };

export type EstimateAdjustment =
  | { kind: 'cylinder'; amount: number }
  | { kind: 'water'; amount: number; water: SiteWaterType }
  | { kind: 'personal_offset'; amount: number };

export type EstimateMissing =
  | { kind: 'body_weight' }
  | { kind: 'cylinder_material'; diveIds: string[]; planned: boolean }
  | { kind: 'cylinder'; diveIds: string[] }
  | { kind: 'suit_thickness' }
  | { kind: 'suit_undergarment' };

export interface LeadEstimate {
  unit: LeadUnit;
  /** Null when it can't be told: the rule of thumb needs body weight and there are no dives with the suit. */
  total: number | null;
  range: { low: number; high: number } | null;
  confidence: Confidence;
  /** Null together with `total`. */
  basis: EstimateBasis | null;
  adjustments: EstimateAdjustment[];
  missing: EstimateMissing[];
  /** The cylinder's reserve in bar used, and whether it is the Diver's own median. */
  reserve: { bar: number; fromDives: boolean };
}
