// The logbook's settings live in the address (ADR 0017): back, reload and links keep them.
import { describe, expect, it } from 'vitest';
import { diveHref, listOfDiveAddress, logbookHref, logbookHrefOf, logbookParams, neighbourParams } from '../src/lib/logbook.ts';

const roundTrip = (href: string) => logbookParams(new URLSearchParams(href.split('?')[1] ?? ''));

describe('logbook address', () => {
  it('leaves the defaults out', () => {
    expect(logbookHref({})).toBe('#/');
    expect(logbookHref({ sort: 'startsAt', order: 'desc', page: 1 })).toBe('#/');
  });

  it('keeps Diver, search, sort, order and page', () => {
    const href = logbookHref({ diverId: 'd1', q: 'turtle reef', sort: 'maxDepth', order: 'asc', page: 3 });
    expect(href).toBe('#/?diver=d1&q=turtle+reef&sort=maxDepth&order=asc&page=3');
    expect(roundTrip(href)).toEqual({ diverId: 'd1', siteId: undefined, q: 'turtle reef', sort: 'maxDepth', order: 'asc', only: undefined, page: 3 });
  });

  it('keeps the Dive site filter (ADR 0020)', () => {
    const href = logbookHref({ siteId: 's1', page: 2 });
    expect(href).toBe('#/?site=s1&page=2');
    expect(roundTrip(href)).toMatchObject({ siteId: 's1', page: 2 });
  });

  it('ignores values it doesn’t know', () => {
    expect(roundTrip('#/?sort=drop+table&page=-2&order=sideways')).toEqual({
      diverId: undefined, siteId: undefined, q: undefined, sort: undefined, order: undefined, only: undefined, page: undefined,
    });
  });

  it('keeps the "Show only" filters, in one order whatever order they were pressed in (ADR 0040)', () => {
    const href = logbookHref({ only: ['no-site', 'no-recording'], page: 2 });
    expect(href).toBe('#/?only=no-recording,no-site&page=2');
    expect(roundTrip(href)).toMatchObject({ only: ['no-recording', 'no-site'], page: 2 });
    expect(logbookHref({ only: [] })).toBe('#/');
  });

  it('drops filters it doesn’t know, which the API would refuse', () => {
    expect(roundTrip('#/?only=no-number,with-findings,with-findings').only).toEqual(['with-findings']);
    expect(roundTrip('#/?only=nothing').only).toBeUndefined();
  });
});

describe('the list a Dive was opened from (ADR 0042)', () => {
  const list = 'sort=maxDepth&only=no-recording,no-site&page=3';

  it('rides in the address of the Dive and comes back as the logbook address', () => {
    const href = diveHref('d1', list, 'r1');
    expect(href).toBe('#/dives/d1?list=sort%3DmaxDepth%26only%3Dno-recording%2Cno-site%26page%3D3&recording=r1');
    const query = new URLSearchParams(href.split('?')[1]);
    expect(listOfDiveAddress(query)).toBe(list);
    expect(logbookHrefOf(listOfDiveAddress(query))).toBe(`#/?${list}`);
  });

  it('leaves out what is default', () => {
    expect(diveHref('d1', '')).toBe('#/dives/d1');
    expect(diveHref('d1', undefined)).toBe('#/dives/d1');
    expect(logbookHrefOf('')).toBe('#/');
  });

  it('cleans a list that was written by hand', () => {
    expect(listOfDiveAddress(new URLSearchParams({ list: 'sort=drop+table&only=nothing&q=reef' }))).toBe('q=reef');
  });

  it('asks the neighbours without the page', () => {
    expect(neighbourParams(logbookParams(new URLSearchParams(list)))).toEqual({ only: 'no-recording,no-site', sort: 'maxDepth' });
  });
});
