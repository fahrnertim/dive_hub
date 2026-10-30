// Which Dives are gone at a Provider (ADR 0051): the comparison of a Connection's linked Dives with a complete listing,
// by remote ID over the raw records. Pure; what is stored and confirmed is in gone-dives.test.ts.
import { describe, expect, it } from 'vitest';
import { compareGone, type GoneCandidate } from '../src/providers/dive-import/gone-dive-rules.js';

const CONNECTION = 'c-1';
const dive = (n: number, over: Partial<GoneCandidate> = {}): GoneCandidate => ({
  diveId: `dive-${n}`, remoteId: `r-${n}`, remoteNumber: n, connectionId: CONNECTION, deleted: false, ...over,
});
const listing = (...ids: string[]) => ids.map((remoteId) => ({ remoteId }));

describe('comparing Dives with a Provider\'s logbook', () => {
  it('finds a Dive whose remote ID is absent, and leaves the ones listed', () => {
    const r = compareGone({ connectionId: CONNECTION, candidates: [dive(1), dive(2), dive(3)], listed: listing('r-1', 'r-3', 'r-99') });
    expect(r.gone.map((d) => d.diveId)).toEqual(['dive-2']);
    expect(r.there.map((d) => d.diveId)).toEqual(['dive-1', 'dive-3']);
    expect(r).toMatchObject({ empty: false, compared: 3, warning: false });
  });

  it('finds nothing in an empty logbook and says so', () => {
    const r = compareGone({ connectionId: CONNECTION, candidates: [dive(1), dive(2)], listed: [] });
    expect(r).toMatchObject({ empty: true, compared: 0, gone: [], there: [], warning: false });
  });

  it('compares only Dives sent through this Connection, never one through another or one that no longer exists', () => {
    const r = compareGone({
      connectionId: CONNECTION,
      candidates: [dive(1), dive(2, { connectionId: 'c-2' }), dive(3, { connectionId: null })],
      listed: listing('r-other'),
    });
    expect(r.gone.map((d) => d.diveId)).toEqual(['dive-1']);
    expect(r.compared).toBe(1);
  });

  it('does not compare a deleted Dive', () => {
    const r = compareGone({ connectionId: CONNECTION, candidates: [dive(1, { deleted: true }), dive(2)], listed: listing('r-x') });
    expect(r.gone.map((d) => d.diveId)).toEqual(['dive-2']);
    expect(r.compared).toBe(1);
  });

  it('counts a record Dive Hub cannot parse as present (the comparison is over remote IDs, not parsed dives)', () => {
    const r = compareGone({ connectionId: CONNECTION, candidates: [dive(1)], listed: listing('r-1') });
    expect(r.gone).toEqual([]);
    expect(r.there).toHaveLength(1);
  });

  it('warns when more than half of at least five compared Dives are gone, and not otherwise', () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => dive(n));
    expect(compareGone({ connectionId: CONNECTION, candidates: six, listed: listing('r-1', 'r-2') }).warning).toBe(true);
    // exactly half is not more than half
    expect(compareGone({ connectionId: CONNECTION, candidates: six, listed: listing('r-1', 'r-2', 'r-3') }).warning).toBe(false);
    // four of four gone is over half but under five compared
    const four = [1, 2, 3, 4].map((n) => dive(n));
    expect(compareGone({ connectionId: CONNECTION, candidates: four, listed: listing('r-x') }).warning).toBe(false);
  });
});
