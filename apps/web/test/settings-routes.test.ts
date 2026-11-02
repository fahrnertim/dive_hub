// Settings is one area with a view per section (UI overhaul, "The shell"); the old account and admin addresses lead there.
import { describe, expect, it } from 'vitest';
import { connectionHref, legacyRedirect, settingsHref } from '../src/lib/settings.ts';

describe('the old addresses', () => {
  it('lead to their Settings section, keeping the Connection to go to', () => {
    expect(legacyRedirect('/account')).toBe('#/settings/display');
    expect(legacyRedirect('/account?tab=connections&connection=c1')).toBe('#/settings/connections?connection=c1');
    expect(legacyRedirect('/account?tab=connections')).toBe('#/settings/connections');
    expect(legacyRedirect('/account?tab=ai')).toBe('#/settings/ai-access');
    expect(legacyRedirect('/admin')).toBe('#/settings/admin');
    expect(legacyRedirect('/admin/site-imports')).toBe('#/settings/admin/site-imports');
  });

  it('leave every other address alone', () => {
    for (const route of ['/sites', '/', '/settings/display', '/divers?certifications=own', '/accounts']) expect(legacyRedirect(route)).toBeNull();
  });
});

describe('the addresses of Settings', () => {
  it('name the section, and a query when there is one', () => {
    expect(settingsHref('devices')).toBe('#/settings/devices');
    expect(settingsHref('connections', { connection: 'c 1' })).toBe('#/settings/connections?connection=c+1');
    expect(connectionHref('c1')).toBe('#/settings/connections?connection=c1');
  });
});
