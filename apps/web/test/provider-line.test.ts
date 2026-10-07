import { describe, expect, it } from 'vitest';
import { waitsForUser } from '../src/lib/providers.ts';

// The Dive at a Provider is one closed line on the dive page (UI redesign, slice A). It opens by itself only when
// something waits for the User there.
describe('waitsForUser', () => {
  const connected = { state: 'connected' };
  const sent = { upToDate: true };

  it('is false for a dive that was never sent', () => {
    expect(waitsForUser({ connection: connected, current: null, pushes: [] })).toBe(false);
  });

  it('is false for a dive that is up to date at the Provider', () => {
    expect(waitsForUser({ connection: connected, current: sent, pushes: [{ state: 'confirmed' }] })).toBe(false);
  });

  it('is true when the dive changed since it was sent', () => {
    expect(waitsForUser({ connection: connected, current: { upToDate: false }, pushes: [{ state: 'confirmed' }] })).toBe(true);
  });

  it('is true when the last sending failed, and no longer once a later one worked', () => {
    expect(waitsForUser({ connection: connected, current: null, pushes: [{ state: 'failed' }] })).toBe(true);
    expect(waitsForUser({ connection: connected, current: sent, pushes: [{ state: 'confirmed' }, { state: 'failed' }] })).toBe(false);
  });

  it('is true when a sent dive needs a new sign-in, and false without a connection (nothing to do here)', () => {
    expect(waitsForUser({ connection: { state: 'needs_sign_in' }, current: sent, pushes: [] })).toBe(true);
    expect(waitsForUser({ connection: null, current: sent, pushes: [] })).toBe(false);
  });
});
