// The Review page: its part is in the address, and the two candidates of a decision show what differs between them.
import { describe, expect, it } from 'vitest';
import { differingFacts, reviewHref, reviewTab } from '../src/lib/review.ts';

describe('review address', () => {
  it('leaves the first part out', () => {
    expect(reviewHref('decide')).toBe('#/review');
    expect(reviewHref('imports')).toBe('#/review?tab=imports');
    expect(reviewHref('deleted')).toBe('#/review?tab=deleted');
  });

  it('reads the part back and falls back to the first one', () => {
    expect(reviewTab(new URLSearchParams('tab=decided'))).toBe('decided');
    expect(reviewTab(new URLSearchParams('tab=nonsense'))).toBe('decide');
    expect(reviewTab(new URLSearchParams(''))).toBe('decide');
  });
});

describe('what differs between two candidates', () => {
  it('names the facts whose text differs', () => {
    const a = { depth: '16.4 m', duration: '30 min', site: undefined };
    const b = { depth: '16.1 m', duration: '30 min', site: 'Lighthouse' };
    expect(differingFacts(a, b)).toEqual(new Set(['depth', 'site']));
  });

  it('marks nothing when both are the same, or both lack a fact', () => {
    expect(differingFacts({ depth: '16 m', site: undefined }, { depth: '16 m', site: undefined })).toEqual(new Set());
  });
});
