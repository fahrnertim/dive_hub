// Which tab of the main navigation an address belongs to (aria-current): the path decides, never the query.
import { describe, expect, it } from 'vitest';
import { navSection } from '../src/lib/nav.ts';

describe('the tab an address belongs to', () => {
  it('puts the logbook, a Dive and the Review page under the logbook', () => {
    for (const route of ['/', '/?only=no-site', '/dives/3f1c', '/dives/3f1c?recording=9', '/review', '/review?tab=checks']) {
      expect(navSection(route)).toBe('logbook');
    }
  });

  it('keeps a tab current with a query or a sub-page', () => {
    expect(navSection('/divers?certifications=own')).toBe('divers');
    expect(navSection('/sites/4a2b')).toBe('sites');
    expect(navSection('/sites?q=reef')).toBe('sites');
    expect(navSection('/centres/7c')).toBe('centres');
    expect(navSection('/tools/plan?gas=air')).toBe('tools');
  });

  it('gives pages outside the bar none', () => {
    for (const route of ['/account', '/account?tab=ai', '/admin', '/setup', '/diversity']) expect(navSection(route)).toBeNull();
  });
});
