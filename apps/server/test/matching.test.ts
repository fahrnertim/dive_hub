import { describe, expect, it } from 'vitest';
import { alignedForMatching, decideMatch, entryMatches } from '../src/imports/matching.js';

const t0 = new Date('2026-01-15T09:00:00Z');
const plus = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const span = (startMin: number, durMin: number, depth?: number) => ({
  startsAt: plus(startMin), durationSeconds: durMin * 60, maxDepthM: depth,
});

describe('decideMatch', () => {
  it('creates a Dive when nothing overlaps', () => {
    expect(decideMatch(span(0, 40, 18), [{ id: 'a', ...span(120, 40, 18) }])).toEqual({ kind: 'create' });
  });

  it('attaches a backup computer recording with clock drift to the one overlapping Dive', () => {
    expect(decideMatch(span(3, 40, 18.4), [{ id: 'a', ...span(0, 41, 18) }])).toEqual({ kind: 'attach', diveId: 'a' });
  });

  it('asks the User when a Recording spans two Dives (split dive)', () => {
    const decision = decideMatch(span(0, 60, 18), [
      { id: 'a', ...span(0, 25, 18) },
      { id: 'b', ...span(27, 33, 17) },
    ]);
    expect(decision).toMatchObject({ kind: 'duplicate-candidate', diveIds: ['a', 'b'] });
  });

  it('asks the User when the max depth differs a lot', () => {
    expect(decideMatch(span(0, 40, 30), [{ id: 'a', ...span(0, 40, 12) }])).toMatchObject({
      kind: 'duplicate-candidate', diveIds: ['a'],
    });
  });
});

describe('a Provider\'s logbook entries (ADR 0030)', () => {
  const at = (iso: string, utcOffsetSeconds: number | null, id = iso) => ({ id, startsAt: new Date(iso), utcOffsetSeconds });
  const entry = Date.UTC(2025, 7, 10, 10, 0); // 10:00 local, as SSI keeps it

  it('matches Dives starting within the window in local time, closest first', () => {
    const dives = [at('2025-08-10T07:12:00Z', 3 * 3600, 'a'), at('2025-08-10T06:55:00Z', 3 * 3600, 'b'), at('2025-08-10T07:40:00Z', 3 * 3600, 'c')];
    expect(entryMatches(entry, dives, 15).map((d) => d.id)).toEqual(['b', 'a']);
    expect(entryMatches(entry, dives, 5).map((d) => d.id)).toEqual(['b']);
    expect(entryMatches(entry, dives, 60).map((d) => d.id)).toEqual(['b', 'a', 'c']);
  });

  it('compares a Dive whose offset is unknown by its stored wall-clock time', () => {
    expect(entryMatches(entry, [at('2025-08-10T10:10:00Z', null)], 15)).toHaveLength(1);
  });

  it('never matches across midnight, even within the window', () => {
    const lateEntry = Date.UTC(2025, 7, 10, 23, 55);
    expect(entryMatches(lateEntry, [at('2025-08-11T00:05:00Z', 0)], 15)).toEqual([]);
  });

  it('moves a Dive with an unknown offset into the Recording\'s, so they overlap in local time', () => {
    const rec = { utcOffsetSeconds: 7200, utcOffsetSource: 'position' };
    const [aligned] = alignedForMatching(rec, [{ startsAt: new Date('2025-08-10T10:00:00Z'), utcOffsetSeconds: null, utcOffsetSource: 'unknown' }]);
    expect(aligned!.startsAt).toEqual(new Date('2025-08-10T08:00:00Z'));
    const known = { startsAt: new Date('2025-08-10T08:00:00Z'), utcOffsetSeconds: 7200, utcOffsetSource: 'device' };
    expect(alignedForMatching(rec, [known])[0]).toBe(known);
  });
});
