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

  describe('a probable non-dive (ADR 0030, amended)', () => {
    // The owner's 2024-04-19: 50 s at 1.8 m, the real dive 5 min 24 s later.
    const falseStart = { startsAt: plus(0), durationSeconds: 50, maxDepthM: 1.8, probablyNoDive: true };
    const real = { startsAt: new Date(plus(0).getTime() + 324_000), durationSeconds: 42 * 60, maxDepthM: 18.3 };

    it('is no candidate for a real Recording: that one becomes a Dive of its own', () => {
      expect(decideMatch(real, [{ id: 'false-start', ...falseStart }])).toEqual({ kind: 'create' });
    });

    it('is no candidate either when the depths would agree, and does not make one real Dive several', () => {
      const shallow = { ...real, maxDepthM: 2.6 };
      expect(decideMatch(shallow, [{ id: 'false-start', ...falseStart }])).toEqual({ kind: 'create' });
      expect(decideMatch(real, [{ id: 'false-start', ...falseStart }, { id: 'a', ...real, maxDepthM: 18 }])).toEqual({ kind: 'attach', diveId: 'a' });
    });

    it('as a Recording never attaches by itself: it waits for the User beside every Dive in reach', () => {
      // An entry without a depth: nothing disagrees, and it would have become the entry's Primary recording.
      expect(decideMatch(falseStart, [{ id: 'entry', ...span(2, 40) }])).toEqual({
        kind: 'duplicate-candidate', diveIds: ['entry'], reason: 'probably_no_dive',
      });
      // The same false start from a second computer.
      expect(decideMatch(falseStart, [{ id: 'other', ...falseStart }, { id: 'entry', ...span(2, 40) }])).toEqual({
        kind: 'duplicate-candidate', diveIds: ['other', 'entry'], reason: 'probably_no_dive',
      });
    });

    it('as a Recording becomes a Dive when nothing is in reach', () => {
      expect(decideMatch(falseStart, [{ id: 'a', ...span(120, 40, 18) }])).toEqual({ kind: 'create' });
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
