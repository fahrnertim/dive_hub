// The public routes that take a token (setup, invitations, password reset links) count attempts per client IP
// and refuse more than TOKEN_ATTEMPTS.max in a window with 429 too_many_attempts and Retry-After (ADR 0061).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOKEN_ATTEMPTS } from '../src/http/attempt-limit.js';
import { BASE_URL, PASSWORD, createTestApp, createTestDatabase, databaseReachable, resettableClock, type TestDatabase } from './support.js';

const TOKEN = 'not-a-real-token-0123456789abcdef';

/** Each token route with a body it accepts; none of the tokens is real. */
const ROUTES = [
  ['/api/setup', { token: TOKEN, email: 'first@example.com', name: 'First', password: PASSWORD }],
  ['/api/invitations/lookup', { token: TOKEN }],
  ['/api/invitations/accept', { token: TOKEN, name: 'Someone', password: PASSWORD }],
  ['/api/password-resets/lookup', { token: TOKEN }],
  ['/api/password-resets/complete', { token: TOKEN, password: PASSWORD }],
] as const;

describe.skipIf(!(await databaseReachable()))('attempts at the token routes', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const clock = resettableClock({ stopped: true });

  /** The nth attempt from an address goes to the nth token route, so the attempts count across all of them. */
  const attempt = (n: number, remoteAddress = '203.0.113.1') => {
    const [url, payload] = ROUTES[n % ROUTES.length]!;
    return ctx.app.inject({ method: 'POST', url, headers: { origin: BASE_URL }, payload, remoteAddress });
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { clock });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('refuses the attempt after the limit from one address, with Retry-After, and no other address', async () => {
    expect(TOKEN_ATTEMPTS).toEqual({ max: 30, windowMs: 15 * 60_000 });
    for (let n = 0; n < TOKEN_ATTEMPTS.max; n++) expect((await attempt(n)).statusCode).not.toBe(429);

    const refused = await attempt(TOKEN_ATTEMPTS.max);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBe('900');
    expect(refused.json()).toMatchObject({ code: 'too_many_attempts' });

    expect((await attempt(0, '203.0.113.2')).statusCode).not.toBe(429);
  });

  it('says how long is left and lets the address try again once the window is over', async () => {
    clock.skip(10 * 60_000);
    expect((await attempt(1)).headers['retry-after']).toBe('300');

    clock.skip(5 * 60_000);
    expect((await attempt(1)).statusCode).toBe(404);
  });
});
