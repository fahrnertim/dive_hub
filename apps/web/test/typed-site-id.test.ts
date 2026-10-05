// A typed site ID in the forms the Provider declares (ADR 0029): the web client knows no Provider's format itself.
import { describe, expect, it } from 'vitest';
import { typedSiteId } from '../src/lib/providers.ts';

/** As GET /api/providers gives SSI's `site_external_id` requirement. */
const ssi = { pattern: '^[1-9]\\d{0,9}$', prefixes: ['site:'] };

describe('typedSiteId', () => {
  it('takes the bare ID and the form the Source shows, with spaces and any case', () => {
    expect(typedSiteId(ssi, '3314')).toBe('3314');
    expect(typedSiteId(ssi, 'site:3314')).toBe('3314');
    expect(typedSiteId(ssi, '  SITE: 3314 ')).toBe('3314');
  });

  it('refuses what isn\'t an ID of that Source', () => {
    for (const text of ['site:', 'Q3314', '03314', 'site:abc', '12345678901']) expect(typedSiteId(ssi, text)).toBeUndefined();
  });

  it('refuses everything when the Source declares no pattern', () => {
    expect(typedSiteId({ pattern: null, prefixes: null }, '3314')).toBeUndefined();
  });
});
