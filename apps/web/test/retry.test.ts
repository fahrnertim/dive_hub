// Which failed requests are tried again (UI review A3): a 404 must show its message at once.
import { describe, expect, it } from 'vitest';
import { ApiError, shouldRetry } from '../src/api.ts';

describe('retrying failed queries', () => {
  it('tries a network or server error once more', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(0, new ApiError('boom', 503))).toBe(true);
    expect(shouldRetry(1, new ApiError('boom', 503))).toBe(false);
  });

  it('does not retry what another try can\'t change (not found, forbidden, signed out)', () => {
    for (const status of [400, 401, 403, 404, 409]) expect(shouldRetry(0, new ApiError('no', status))).toBe(false);
  });
});
