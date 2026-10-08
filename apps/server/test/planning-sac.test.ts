// The planning SAC (ADR 0033, slice 22): the 85th percentile of the SAC of a Diver's last 20 Dives that have one, with
// how many it rests on; fewer than 5 and it is the default, said so. Figures worked by hand.
import { describe, expect, it } from 'vitest';
import { planningSac } from '../src/planning/planning-sac.js';

/** Dives newest first, as the logbook lists them. */
const dives = (...sacs: (number | null)[]) => sacs.map((sacLpm) => ({ sacLpm }));

describe('planning SAC', () => {
  it('is the 85th percentile, interpolated between ranks, of the Dives that have a SAC', () => {
    // 1 … 20 L/min: rank 0.85 × 19 = 16.15 → the 17th value (17) plus 0.15 of the way to the 18th: 17.15.
    const sacs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(planningSac(dives(...sacs))).toEqual({ lpm: 17.2, basedOn: 20, source: 'logbook' });
  });

  it('looks at the last 20 Dives with a SAC only, skipping Dives without one', () => {
    // Newest first: a Dive without SAC, then 1 … 20, then 100 (the 21st with a SAC, too old to count).
    const sacs = [null, ...Array.from({ length: 20 }, (_, i) => i + 1), 100];
    expect(planningSac(dives(...sacs))).toEqual({ lpm: 17.2, basedOn: 20, source: 'logbook' });
  });

  it('rests on as few as 5 Dives', () => {
    // 10, 12, 14, 16, 18: rank 0.85 × 4 = 3.4 → 16 + 0.4 × 2 = 16.8.
    expect(planningSac(dives(10, 12, 14, 16, 18))).toEqual({ lpm: 16.8, basedOn: 5, source: 'logbook' });
  });

  it('is the default 20 L/min with fewer than 5 Dives, and says how many there were', () => {
    expect(planningSac(dives(10, 12, 14, null))).toEqual({ lpm: 20, basedOn: 3, source: 'default' });
    expect(planningSac([])).toEqual({ lpm: 20, basedOn: 0, source: 'default' });
  });
});
