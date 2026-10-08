// Changes made at a Provider (ADR 0030, amended): per field, taken when only the Provider changed it, a conflict when
// both did, nothing when only Dive Hub did; compared as the Provider keeps values (minutes, 0.1 m).
import { describe, expect, it } from 'vitest';
import { SYNCED_FIELDS, threeWay, type Comparable, type SyncedField } from '../src/providers/three-way.js';

const base: Comparable = {
  site: '3314', notes: 'Turtle', buddies: ['4989164'], startsAt: 29_000_000, durationSeconds: 2700, maxDepthM: 18, avgDepthM: null,
  waterTemperatureC: 24, cylinder: null,
};
const tank: NonNullable<Comparable['cylinder']> = { volumeL: 12, material: 'steel', startPressureBar: 200, endPressureBar: 50, gas: { o2: 21, he: 0 } };
const run = (provider: Partial<Comparable>, hub: Partial<Comparable>, fields: readonly SyncedField[] = SYNCED_FIELDS) =>
  threeWay(fields, base, { ...base, ...provider }, { ...base, ...hub });

describe('three-way per field', () => {
  it('takes what only the Provider changed', () => {
    expect(run({ site: '1077045', notes: 'Napoleon' }, {})).toEqual({ take: ['site', 'notes'], conflicts: [] });
  });

  it('keeps what only Dive Hub changed', () => {
    expect(run({}, { site: '5120', buddies: [] })).toEqual({ take: [], conflicts: [] });
  });

  it('says when both changed a field differently, and not when they agree', () => {
    expect(run({ notes: 'Napoleon' }, { notes: 'Barracudas' })).toEqual({ take: [], conflicts: ['notes'] });
    expect(run({ notes: 'Napoleon' }, { notes: 'Napoleon' })).toEqual({ take: [], conflicts: [] });
  });

  it('compares as the Provider keeps values: a recording\'s exact depth and seconds are no change', () => {
    expect(run({}, { maxDepthM: 18.04, durationSeconds: 2731 })).toEqual({ take: [], conflicts: [] });
    expect(run({ maxDepthM: 21 }, { maxDepthM: 18.04 })).toEqual({ take: ['maxDepthM'], conflicts: [] });
  });

  it('never clears a site because the Provider names none', () => {
    expect(run({ site: null }, {})).toEqual({ take: [], conflicts: [] });
  });

  it('looks only at the fields it is given (no values on a Dive with a Recording)', () => {
    expect(run({ maxDepthM: 30, notes: 'x' }, {}, ['site', 'notes', 'buddies'])).toEqual({ take: ['notes'], conflicts: [] });
  });

  it('takes a tank only the Provider changed, as one field', () => {
    expect(run({ cylinder: { ...tank, endPressureBar: 60 } }, { cylinder: tank }, ['cylinder'])).toEqual({ take: [], conflicts: [] });
    const since = (provider: Partial<typeof tank>, hub: Partial<typeof tank>) =>
      threeWay(['cylinder'], { ...base, cylinder: tank }, { ...base, cylinder: { ...tank, ...provider } }, { ...base, cylinder: { ...tank, ...hub } });
    expect(since({ endPressureBar: 60 }, {})).toEqual({ take: ['cylinder'], conflicts: [] });
    expect(since({}, { endPressureBar: 45 })).toEqual({ take: [], conflicts: [] });
    expect(since({ material: 'aluminium' }, { volumeL: 15 })).toEqual({ take: [], conflicts: ['cylinder'] });
    expect(since({ gas: { o2: 32, he: 0 } }, { gas: { o2: 32, he: 0 } })).toEqual({ take: [], conflicts: [] });
  });

  it('never removes a tank because the Provider names none, and leaves the tank here alone where Dive Hub never saw one there', () => {
    expect(threeWay(['cylinder'], { ...base, cylinder: tank }, base, { ...base, cylinder: tank })).toEqual({ take: [], conflicts: [] });
    // No tank at the Provider when Dive Hub last saw the dive (or sent it): whether it changed there can't be told.
    expect(run({ cylinder: tank }, { cylinder: { ...tank, volumeL: 15 } }, ['cylinder'])).toEqual({ take: [], conflicts: [] });
  });
});
