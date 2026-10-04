// The Dive sites list keeps its settings in the address (ADR 0022), like the logbook.
import { describe, expect, it } from 'vitest';
import { sitesHref, sitesParams } from '../src/lib/sites-list.ts';

const roundTrip = (href: string) => sitesParams(new URLSearchParams(href.split('?')[1] ?? ''));

describe('Dive sites address', () => {
  it('leaves the defaults out', () => {
    expect(sitesHref({})).toBe('#/sites');
    expect(sitesHref({ sort: 'name', order: 'asc', page: 1, mine: false })).toBe('#/sites');
  });

  it('keeps search, country, my dives, sort, order and page', () => {
    const href = sitesHref({ q: 'blue hole', country: 'EG', mine: true, sort: 'diveCount', order: 'desc', page: 2 });
    expect(href).toBe('#/sites?q=blue+hole&country=EG&mine=1&sort=diveCount&order=desc&page=2');
    expect(roundTrip(href)).toEqual({ q: 'blue hole', country: 'EG', mine: true, sort: 'diveCount', order: 'desc', page: 2 });
  });

  it('ignores values it doesn’t know', () => {
    expect(roundTrip('#/sites?sort=drop&order=up&page=0&country=egypt&mine=yes')).toEqual({
      q: undefined, country: undefined, mine: undefined, sort: undefined, order: undefined, page: undefined,
    });
  });
});
