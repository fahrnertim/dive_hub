// Lead, weighting feedback and the exposure suit in the Dive's form (ADR 0031): lead typed in kilograms or pounds,
// the suit's values kept to the ones its type has, filled from the Diver's last dive.
import { describe, expect, it } from 'vitest';
import { draftOfWeighting, fromLastDive, weightingOfDraft, type WeightingValues } from '../src/lib/weighting.ts';

const NaN_ = Number.NaN;
const nothing: WeightingValues = { lead: [], weightingFeedback: null, suit: null };
const logged: WeightingValues = {
  lead: [{ amountKg: 6, placement: 'belt' }, { amountKg: 2, placement: null }],
  weightingFeedback: { felt: 'too_heavy', amountKg: 1 },
  suit: { type: 'wetsuit', thicknessMm: 7, hood: true, undergarment: null },
};

describe('lead, weighting feedback and suit in the Dive\'s form', () => {
  it('a Dive without them is an empty form that saves nothing', () => {
    const draft = draftOfWeighting(nothing, 'metric');
    expect(draft).toMatchObject({ lead: [], felt: null, feltAmount: NaN_, suitType: null, thicknessMm: NaN_, hood: null, undergarment: null });
    expect(weightingOfDraft(draft, 'metric')).toEqual(nothing);
  });

  it('what was logged comes back as it was', () => {
    expect(weightingOfDraft(draftOfWeighting(logged, 'metric'), 'metric')).toEqual(logged);
  });

  it('shows lead in pounds for imperial, saves an untouched amount as it was and a typed one in kilograms', () => {
    const draft = draftOfWeighting(logged, 'imperial');
    expect(draft.lead.map((e) => e.amount)).toEqual([13.2, 4.4]);
    expect(draft.feltAmount).toBe(2.2);
    expect(weightingOfDraft(draft, 'imperial')).toEqual(logged);
    const typed = { ...draft, lead: [{ ...draft.lead[0]!, amount: 10 }, draft.lead[1]!] };
    expect(weightingOfDraft(typed, 'imperial').lead).toEqual([{ amountKg: 4.54, placement: 'belt' }, { amountKg: 2, placement: null }]);
  });

  it('an entry without an amount is not saved; 0 is no lead', () => {
    const draft = draftOfWeighting(nothing, 'metric');
    const entry = (amount: number) => ({ key: `k${amount}`, amount, placement: null });
    expect(weightingOfDraft({ ...draft, lead: [entry(NaN_)] }, 'metric').lead).toEqual([]);
    expect(weightingOfDraft({ ...draft, lead: [entry(0)] }, 'metric').lead).toEqual([{ amountKg: 0, placement: null }]);
  });

  it('keeps of a suit only what its type has, and no amount for weighting that felt right', () => {
    const draft = draftOfWeighting(logged, 'metric');
    expect(weightingOfDraft({ ...draft, suitType: 'drysuit', undergarment: 'heavy' }, 'metric').suit)
      .toEqual({ type: 'drysuit', thicknessMm: null, hood: true, undergarment: 'heavy' });
    expect(weightingOfDraft({ ...draft, suitType: 'wetsuit', undergarment: 'heavy' }, 'metric').suit).toEqual(logged.suit);
    expect(weightingOfDraft({ ...draft, suitType: 'none' }, 'metric').suit).toEqual({ type: 'none', thicknessMm: null, hood: null, undergarment: null });
    expect(weightingOfDraft({ ...draft, suitType: null }, 'metric').suit).toBeNull();
    expect(weightingOfDraft({ ...draft, felt: 'right' }, 'metric').weightingFeedback).toEqual({ felt: 'right', amountKg: null });
    expect(weightingOfDraft({ ...draft, felt: null }, 'metric').weightingFeedback).toBeNull();
  });

  it('"same as last dive" fills the suit and the lead that are still empty, and never how the weighting felt', () => {
    const last = { lead: logged.lead, suit: logged.suit };
    const filled = weightingOfDraft(fromLastDive(draftOfWeighting(nothing, 'metric'), last, 'metric'), 'metric');
    expect(filled).toEqual({ ...logged, weightingFeedback: null });
    const own: WeightingValues = { lead: [{ amountKg: 4, placement: 'integrated' }], weightingFeedback: null, suit: null };
    expect(weightingOfDraft(fromLastDive(draftOfWeighting(own, 'metric'), last, 'metric'), 'metric')).toEqual({ ...own, suit: logged.suit });
  });
});
