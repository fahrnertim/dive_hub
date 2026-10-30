// Changes made at a Provider (ADR 0030, amended): per field, taken when only the Provider changed it, a conflict when
// both did, nothing when only Dive Hub did; compared as the Provider keeps values (minutes, 0.1 m).
import { describe, expect, it } from 'vitest';
import { DIVE_FIELDS } from '../src/providers/provider.js';
import { contextOf, parseSsiDive } from '../src/providers/ssi/ssi-import.js';
import { SYNCED_FIELDS, comparableOf, planSend, threeWay, type Comparable, type SyncedField } from '../src/providers/three-way.js';
import { handTypedDive } from './fake-ssi.js';

const base: Comparable = {
  site: '3314', notes: 'Turtle', buddies: ['4989164'], startsAt: 29_000_000, durationSeconds: 2700, maxDepthM: 18, avgDepthM: null,
  waterTemperatureC: 24, cylinder: null, lead: null,
};
const tank: NonNullable<Comparable['cylinder']> = { volumeL: 12, material: 'steel', startPressureBar: 200, endPressureBar: 50, gas: { o2: 21, he: 0 } };
const run = (provider: Partial<Comparable>, hub: Partial<Comparable>, fields: readonly SyncedField[] = SYNCED_FIELDS) =>
  threeWay(fields, base, { ...base, ...provider }, { ...base, ...hub });

describe('three-way per field', () => {
  it('every synced field is a dive field', () => {
    expect(SYNCED_FIELDS.every((f) => (DIVE_FIELDS as readonly string[]).includes(f))).toBe(true);
  });

  it('takes what only the Provider changed', () => {
    expect(run({ site: '1077045', notes: 'Napoleon' }, {})).toEqual({ take: ['site', 'notes'], conflicts: [], clear: [] });
  });

  it('keeps what only Dive Hub changed, and clears what it removed', () => {
    expect(run({}, { site: '5120', buddies: ['1'] })).toEqual({ take: [], conflicts: [], clear: [] });
    expect(run({}, { site: '5120', buddies: [] })).toEqual({ take: [], conflicts: [], clear: ['buddies'] });
  });

  it('says when both changed a field differently, and not when they agree', () => {
    expect(run({ notes: 'Napoleon' }, { notes: 'Barracudas' })).toEqual({ take: [], conflicts: ['notes'], clear: [] });
    expect(run({ notes: 'Napoleon' }, { notes: 'Napoleon' })).toEqual({ take: [], conflicts: [], clear: [] });
  });

  it('compares as the Provider keeps values: a recording\'s exact depth and seconds are no change', () => {
    expect(run({}, { maxDepthM: 18.04, durationSeconds: 2731 })).toEqual({ take: [], conflicts: [], clear: [] });
    expect(run({ maxDepthM: 21 }, { maxDepthM: 18.04 })).toEqual({ take: ['maxDepthM'], conflicts: [], clear: [] });
  });

  it('never clears a site because the Provider names none', () => {
    expect(run({ site: null }, {})).toEqual({ take: [], conflicts: [], clear: [] });
  });

  it('looks only at the fields it is given (no values on a Dive with a Recording)', () => {
    expect(run({ maxDepthM: 30, notes: 'x' }, {}, ['site', 'notes', 'buddies'])).toEqual({ take: ['notes'], conflicts: [], clear: [] });
  });

  it('takes a tank only the Provider changed, as one field', () => {
    expect(run({ cylinder: { ...tank, endPressureBar: 60 } }, { cylinder: tank }, ['cylinder'])).toEqual({ take: [], conflicts: [], clear: [] });
    const since = (provider: Partial<typeof tank>, hub: Partial<typeof tank>) =>
      threeWay(['cylinder'], { ...base, cylinder: tank }, { ...base, cylinder: { ...tank, ...provider } }, { ...base, cylinder: { ...tank, ...hub } });
    expect(since({ endPressureBar: 60 }, {})).toEqual({ take: ['cylinder'], conflicts: [], clear: [] });
    expect(since({}, { endPressureBar: 45 })).toEqual({ take: [], conflicts: [], clear: [] });
    expect(since({ material: 'aluminium' }, { volumeL: 15 })).toEqual({ take: [], conflicts: ['cylinder'], clear: [] });
    expect(since({ gas: { o2: 32, he: 0 } }, { gas: { o2: 32, he: 0 } })).toEqual({ take: [], conflicts: [], clear: [] });
  });

  it('takes the lead total only the Provider changed, and compares it to 0.1 kg', () => {
    const since = (provider: number | null, hub: number | null, before: number | null = 6) =>
      threeWay(['lead'], { ...base, lead: before }, { ...base, lead: provider }, { ...base, lead: hub });
    expect(since(8, 6)).toEqual({ take: ['lead'], conflicts: [], clear: [] });
    expect(since(6.04, 6)).toEqual({ take: [], conflicts: [], clear: [] });
    expect(since(6, 7)).toEqual({ take: [], conflicts: [], clear: [] });
    expect(since(8, 7)).toEqual({ take: [], conflicts: ['lead'], clear: [] });
  });

  it('a lead removed at the Provider is removed here (ADR 0056 amends 0031 and 0045), and the lead here stays where Dive Hub never saw a weight there', () => {
    const since = (provider: number | null, hub: number | null, before: number | null) =>
      threeWay(['lead'], { ...base, lead: before }, { ...base, lead: provider }, { ...base, lead: hub });
    expect(since(null, 6, 6)).toEqual({ take: ['lead'], conflicts: [], clear: [] });
    expect(since(8, 6, null)).toEqual({ take: [], conflicts: [], clear: [] });
    // A weight that appears at SSI where the Dive here has none is taken.
    expect(since(8, null, null)).toEqual({ take: ['lead'], conflicts: [], clear: [] });
  });

  it('a tank removed at the Provider is removed here (ADR 0056 amends 0031 and 0045), and the tank here stays where Dive Hub never saw one there', () => {
    expect(threeWay(['cylinder'], { ...base, cylinder: tank }, base, { ...base, cylinder: tank })).toEqual({ take: ['cylinder'], conflicts: [], clear: [] });
    // No tank at the Provider when Dive Hub last saw the dive (or sent it): whether it changed there can't be told.
    expect(run({ cylinder: tank }, { cylinder: { ...tank, volumeL: 15 } }, ['cylinder'])).toEqual({ take: [], conflicts: [], clear: [] });
  });

  it('a note removed here is cleared at the Provider', () => {
    const r = threeWay(['notes'], { ...base, notes: 'X' }, { ...base, notes: 'X' }, { ...base, notes: null });
    expect(r).toEqual({ take: [], conflicts: [], clear: ['notes'] });
  });

  it('a note removed at the Provider is removed here', () => {
    const r = threeWay(['notes'], { ...base, notes: 'X' }, { ...base, notes: null }, { ...base, notes: 'X' });
    expect(r).toEqual({ take: ['notes'], conflicts: [], clear: [] });
  });

  it('removed on both sides is nothing', () => {
    const r = threeWay(['notes'], { ...base, notes: 'X' }, { ...base, notes: null }, { ...base, notes: null });
    expect(r).toEqual({ take: [], conflicts: [], clear: [] });
  });

  it('removed here and changed there is a conflict', () => {
    const r = threeWay(['notes'], { ...base, notes: 'X' }, { ...base, notes: 'Y' }, { ...base, notes: null });
    expect(r).toEqual({ take: [], conflicts: ['notes'], clear: [] });
  });

  it('buddies removed at the Provider are removed here', () => {
    const r = threeWay(['buddies'], base, { ...base, buddies: [] }, base);
    expect(r).toEqual({ take: ['buddies'], conflicts: [], clear: [] });
  });

  it('the site is never cleared by the Provider', () => {
    const r = threeWay(['site'], base, { ...base, site: null }, base);
    expect(r.take).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });
});

describe('removals of guarded fields', () => {
  const lead = (before: number | null, provider: number | null, hub: number | null) =>
    threeWay(['lead'], { ...base, lead: before }, { ...base, lead: provider }, { ...base, lead: hub });
  const tankAt = (before: typeof tank | null, provider: typeof tank | null, hub: typeof tank | null) =>
    threeWay(['cylinder'], { ...base, cylinder: before }, { ...base, cylinder: provider }, { ...base, cylinder: hub });

  it('a site removed here is not cleared at the Provider', () => {
    expect(threeWay(['site'], base, base, { ...base, site: null })).toEqual({ take: [], conflicts: [], clear: [] });
  });

  it('a lead or tank removed at the Provider and changed here is a conflict', () => {
    expect(lead(6, null, 7)).toEqual({ take: [], conflicts: ['lead'], clear: [] });
    expect(tankAt(tank, null, { ...tank, volumeL: 15 })).toEqual({ take: [], conflicts: ['cylinder'], clear: [] });
  });

  it('a lead or tank removed here, unchanged at the Provider, is cleared', () => {
    expect(lead(6, 6, null)).toEqual({ take: [], conflicts: [], clear: ['lead'] });
    expect(tankAt(tank, tank, null)).toEqual({ take: [], conflicts: [], clear: ['cylinder'] });
  });
});

describe('planSend', () => {
  const plan = (o: { base?: Comparable | null; provider?: Partial<Comparable>; hub?: Partial<Comparable>; choices?: Parameters<typeof planSend>[0]['choices']; open?: SyncedField[]; onConflict?: 'ask' | 'defer'; fields?: readonly SyncedField[] }) =>
    planSend({
      fields: o.fields ?? SYNCED_FIELDS, base: o.base === undefined ? base : o.base, provider: { ...base, ...o.provider }, hub: { ...base, ...o.hub },
      choices: o.choices ?? {}, open: o.open ?? [], onConflict: o.onConflict ?? 'ask',
    });
  const empty = { take: [], clear: [], keep: [], conflicts: [] };

  it("without a base, Dive Hub's values go out and empty ones are filled", () => {
    expect(plan({ base: null, provider: { notes: 'Y', lead: 8 }, hub: { notes: null, lead: 6 } })).toEqual({ ...empty, take: ['notes'] });
  });

  it('a conflict without a choice is asked, or kept in a run', () => {
    const sides = { provider: { notes: 'P' }, hub: { notes: 'H' } };
    expect(plan({ ...sides, onConflict: 'ask' })).toEqual({ ...empty, conflicts: ['notes'] });
    expect(plan({ ...sides, onConflict: 'defer' })).toEqual({ ...empty, keep: ['notes'] });
  });

  it('choices settle a conflict: provider is taken, hub is sent or cleared', () => {
    const sides = { provider: { notes: 'P' }, hub: { notes: 'H' } };
    expect(plan({ ...sides, choices: { notes: 'provider' } })).toEqual({ ...empty, take: ['notes'] });
    expect(plan({ ...sides, choices: { notes: 'hub' } })).toEqual(empty);
    expect(plan({ provider: { notes: 'P' }, hub: { notes: null }, choices: { notes: 'hub' } })).toEqual({ ...empty, clear: ['notes'] });
  });

  it('an open field is a conflict while the sides differ, whatever the base says', () => {
    expect(plan({ base: { ...base, notes: 'Y' }, provider: { notes: 'Y' }, hub: { notes: 'X' }, open: ['notes'] })).toEqual({ ...empty, conflicts: ['notes'] });
  });

  it('an open field whose sides agree is nothing', () => {
    expect(plan({ provider: { notes: 'Z' }, hub: { notes: 'Z' }, open: ['notes'] })).toEqual(empty);
  });

  it("SSI's rounding is no change", () => {
    expect(plan({ provider: { durationSeconds: 3600 }, base: { ...base, durationSeconds: 3630 }, hub: { durationSeconds: 3630 } })).toEqual(empty);
    expect(plan({ base: { ...base, notes: 'X' }, provider: { notes: 'X ' }, hub: { notes: 'X' } })).toEqual(empty);
  });

  it('a stale choice is ignored', () => {
    expect(plan({ provider: { notes: 'Napoleon' }, choices: { notes: 'hub' } })).toEqual({ ...empty, take: ['notes'] });
  });

  it('a choice on a removal: provider takes it, hub clears it', () => {
    const removedThere = { base: { ...base, notes: 'X' }, provider: { notes: null }, hub: { notes: 'H' } };
    expect(plan({ ...removedThere, choices: { notes: 'provider' } })).toEqual({ ...empty, take: ['notes'] });
    expect(plan({ ...removedThere, choices: { notes: 'hub' } })).toEqual(empty);
    const removedHere = { base: { ...base, notes: 'X' }, provider: { notes: 'P' }, hub: { notes: null } };
    expect(plan({ ...removedHere, choices: { notes: 'hub' } })).toEqual({ ...empty, clear: ['notes'] });
    expect(plan({ ...removedHere, choices: { notes: 'provider' } })).toEqual({ ...empty, take: ['notes'] });
  });

  it('an open site is never taken as a removal nor cleared', () => {
    expect(plan({ provider: { site: null }, open: ['site'], choices: { site: 'provider' } })).toEqual(empty);
    expect(plan({ provider: { site: '77' }, hub: { site: null }, open: ['site'], choices: { site: 'hub' } })).toEqual(empty);
  });
});

describe('a Provider\'s dive as compared', () => {
  const dive = parseSsiDive({ ...handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45 }), odin_user_log_id: 1 }, contextOf({ dives: [], sites: [], buddies: [] }))!;

  it('takes the local start in whole minutes', () => {
    expect(comparableOf(dive).startsAt).toBe(Date.UTC(2025, 7, 10, 10, 0) / 60_000);
  });

  it('has a readable local start: an adapter drops a dive without one, so an unreadable one is a broken invariant', () => {
    expect(() => comparableOf({ ...dive, localStart: 'yesterday' })).toThrow(/local start/);
  });
});
