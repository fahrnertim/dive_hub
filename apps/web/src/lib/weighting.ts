// Lead, weighting feedback and the exposure suit in the Dive's form (ADR 0031): lead in the User's unit (kilograms or
// pounds, one decimal), the suit's values kept to the ones its type has; filled from the Diver's last dive.
import type { paths } from '@dive-hub/api-client';
import { massFromDisplay, massIn, type UnitSystem } from './units.ts';

type Json<P extends keyof paths> = paths[P] extends { get: { responses: { 200: { content: { 'application/json': infer T } } } } } ? T : never;
type Dive = Json<'/api/dives/{id}'>;
export type LeadEntry = Dive['lead'][number];
export type LeadPlacement = NonNullable<LeadEntry['placement']>;
export type WeightingFeedback = NonNullable<Dive['weightingFeedback']>;
export type WeightingFelt = WeightingFeedback['felt'];
export type Suit = NonNullable<Dive['suit']>;
export type SuitType = Suit['type'];
export type SuitUndergarment = NonNullable<Suit['undergarment']>;
/** What the Dive has of them, and what its edit takes. */
export type WeightingValues = Pick<Dive, 'lead' | 'weightingFeedback' | 'suit'>;
export type LastWeighting = Pick<Json<'/api/dives/{id}/same-as-last'>, 'lead' | 'suit'>;

export const LEAD_PLACEMENTS: LeadPlacement[] = ['belt', 'integrated', 'trim', 'ankle', 'backplate', 'other'];
export const WEIGHTING_FELT: WeightingFelt[] = ['right', 'too_heavy', 'too_light'];
export const SUIT_TYPES: SuitType[] = ['none', 'skin', 'wetsuit', 'semidry', 'drysuit'];
export const SUIT_UNDERGARMENTS: SuitUndergarment[] = ['light', 'medium', 'heavy'];

/** One Lead entry's fields; an empty amount is NaN. */
export interface LeadDraft {
  /** Stable while the form is open, for React's keys. */
  key: string;
  amount: number;
  placement: LeadPlacement | null;
  /** The entry as it was loaded: an amount nobody touched is saved as it was, not as the field rounded it. */
  loaded?: LeadEntry;
}

export interface WeightingDraft {
  lead: LeadDraft[];
  felt: WeightingFelt | null;
  feltAmount: number;
  loadedFeedback: Dive['weightingFeedback'];
  suitType: SuitType | null;
  thicknessMm: number;
  hood: boolean | null;
  undergarment: SuitUndergarment | null;
}

let drafts = 0;
const nextKey = () => `lead-${++drafts}`;
const shown = (kg: number | null | undefined, units: UnitSystem) => (kg == null ? Number.NaN : Math.round(massIn(kg, units) * 10) / 10);
const sameNumber = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));
/** A typed amount in kilograms; an untouched one as it was loaded. */
const kg = (typed: number, loaded: number | null | undefined, units: UnitSystem) => {
  if (sameNumber(typed, shown(loaded, units))) return loaded ?? null;
  return Number.isNaN(typed) ? null : Math.round(massFromDisplay(typed, units) * 100) / 100;
};

export const emptyLead = (): LeadDraft => ({ key: nextKey(), amount: Number.NaN, placement: null });
const draftOfLead = (e: LeadEntry, units: UnitSystem): LeadDraft => ({ key: nextKey(), amount: shown(e.amountKg, units), placement: e.placement, loaded: e });

export const hasThickness = (type: SuitType | null) => type === 'wetsuit' || type === 'semidry';
export const wornSuit = (type: SuitType | null) => type !== null && type !== 'none';

export const draftOfWeighting = (d: WeightingValues, units: UnitSystem): WeightingDraft => ({
  lead: d.lead.map((e) => draftOfLead(e, units)),
  felt: d.weightingFeedback?.felt ?? null, feltAmount: shown(d.weightingFeedback?.amountKg, units), loadedFeedback: d.weightingFeedback,
  suitType: d.suit?.type ?? null, thicknessMm: d.suit?.thicknessMm ?? Number.NaN, hood: d.suit?.hood ?? null, undergarment: d.suit?.undergarment ?? null,
});

/** The draft as the Dive's edit takes it. */
export function weightingOfDraft(d: WeightingDraft, units: UnitSystem): WeightingValues {
  return {
    lead: d.lead.flatMap((e) => {
      const amountKg = kg(e.amount, e.loaded?.amountKg, units);
      return amountKg === null ? [] : [{ amountKg, placement: e.placement }];
    }),
    weightingFeedback: d.felt && { felt: d.felt, amountKg: d.felt === 'right' ? null : kg(d.feltAmount, d.loadedFeedback?.amountKg, units) || null },
    suit: d.suitType && {
      type: d.suitType,
      thicknessMm: hasThickness(d.suitType) && !Number.isNaN(d.thicknessMm) ? d.thicknessMm : null,
      hood: wornSuit(d.suitType) ? d.hood : null,
      undergarment: d.suitType === 'drysuit' ? d.undergarment : null,
    },
  };
}

/** Whether two drafts would save the same. */
export const sameWeighting = (a: WeightingDraft, b: WeightingDraft, units: UnitSystem) =>
  JSON.stringify(weightingOfDraft(a, units)) === JSON.stringify(weightingOfDraft(b, units));

/** The total of the amounts typed, in the User's unit; null when there are none. */
export function leadTotal(lead: LeadDraft[]): number | null {
  const amounts = lead.map((e) => e.amount).filter((n) => !Number.isNaN(n));
  return amounts.length === 0 ? null : Math.round(amounts.reduce((sum, n) => sum + n, 0) * 10) / 10;
}

/** What "same as last dive" would still fill: the lead while no amount is typed, the suit while it has no type. */
export const lacks = (d: WeightingDraft) => ({ lead: leadTotal(d.lead) === null, suit: d.suitType === null });

/** "Same as last dive": the last dive's lead and suit where the form has none; how the weighting felt is this dive's own. */
export function fromLastDive(draft: WeightingDraft, last: LastWeighting, units: UnitSystem): WeightingDraft {
  const empty = lacks(draft);
  return {
    ...draft,
    ...(empty.lead && last.lead.length > 0 && { lead: last.lead.map((e) => draftOfLead(e, units)) }),
    ...(empty.suit && last.suit && {
      suitType: last.suit.type, thicknessMm: last.suit.thicknessMm ?? Number.NaN, hood: last.suit.hood, undergarment: last.suit.undergarment,
    }),
  };
}
