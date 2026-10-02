import { describe, expect, it } from 'vitest';
import { decideMatch } from '../src/imports/matching.js';

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
