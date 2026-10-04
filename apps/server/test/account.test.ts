// A User's own account through the HTTP API: password reset links, changing the password,
// seeing and ending their sessions (ADR 0013).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { passwordReset } from '../src/db/schema.js';
import {
  BASE_URL, PASSWORD, cookieHeader, createTestApp, createTestDatabase, createUser, databaseReachable, signIn,
  type TestDatabase,
} from './support.js';

const NEW_PASSWORD = 'a completely different passphrase';

describe.skipIf(!(await databaseReachable()))('own account', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let adminCookie: string;
  const ids: Record<string, string> = {};

  const inject = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie?: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { origin: BASE_URL, ...(cookie && { cookie }) }, ...(payload && { payload }) });
  const status = async (url: string, cookie: string) => (await inject('GET', url, cookie)).statusCode;
  const resetLink = async (who: string, cookie = adminCookie) => inject('POST', `/api/users/${ids[who]}/password-reset`, cookie);
  const tokenOf = (url: string) => new URL(url).hash.replace('#/reset/', '');
  const canSignIn = async (email: string, password: string) =>
    (await inject('POST', '/api/auth/sign-in/email', undefined, { email, password })).statusCode === 200;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'admin@example.com', 'admin');
    for (const name of ['forgetful', 'changer', 'traveller', 'disabled']) {
      ids[name] = (await createUser(ctx.auth, `${name}@example.com`)).id;
    }
    adminCookie = await signIn(ctx.app, 'admin@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('password reset link', () => {
    it('lets a User set a new password, ends their other sessions and signs them in', async () => {
      const elsewhere = await signIn(ctx.app, 'forgetful@example.com');
      const created = await resetLink('forgetful');
      expect(created.statusCode).toBe(201);
      const { url } = created.json();
      expect(url).toMatch(new RegExp(`^${BASE_URL}/#/reset/[\\w-]{43}$`));

      const lookup = await inject('POST', '/api/password-resets/lookup', undefined, { token: tokenOf(url) });
      expect(lookup.json()).toEqual({ email: 'forgetful@example.com' });

      const done = await inject('POST', '/api/password-resets/complete', undefined, { token: tokenOf(url), password: NEW_PASSWORD });
      expect(done.statusCode).toBe(200);
      expect(await status('/api/me', cookieHeader(done))).toBe(200);
      expect(await status('/api/me', elsewhere)).toBe(401);
      expect(await canSignIn('forgetful@example.com', PASSWORD)).toBe(false);
      expect(await canSignIn('forgetful@example.com', NEW_PASSWORD)).toBe(true);
    });

    it('works once', async () => {
      const token = tokenOf((await resetLink('forgetful')).json().url);
      const use = () => inject('POST', '/api/password-resets/complete', undefined, { token, password: NEW_PASSWORD });
      expect((await use()).statusCode).toBe(200);
      expect((await use()).statusCode).toBe(404);
    });

    it('stays usable when the new password is rejected', async () => {
      const token = tokenOf((await resetLink('forgetful')).json().url);
      const short = await inject('POST', '/api/password-resets/complete', undefined, { token, password: 'too short' });
      expect(short.statusCode).toBe(400);
      expect((await inject('POST', '/api/password-resets/lookup', undefined, { token })).statusCode).toBe(200);
    });

    it('stops working when a newer link is issued, or when it expires', async () => {
      const older = tokenOf((await resetLink('forgetful')).json().url);
      const newer = (await resetLink('forgetful')).json();
      expect((await inject('POST', '/api/password-resets/lookup', undefined, { token: older })).statusCode).toBe(404);

      await t.db.update(passwordReset).set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(passwordReset.userId, ids.forgetful!));
      expect((await inject('POST', '/api/password-resets/lookup', undefined, { token: tokenOf(newer.url) })).statusCode).toBe(404);
    });

    it('is issued by admins only, and not for disabled Users', async () => {
      const member = await signIn(ctx.app, 'changer@example.com');
      expect((await resetLink('forgetful', member)).statusCode).toBe(403);
      expect((await inject('POST', `/api/users/${ids.disabled}/disable`, adminCookie)).statusCode).toBe(200);
      expect((await resetLink('disabled')).statusCode).toBe(409);
    });
  });

  describe('changing the password', () => {
    it('needs the current password and can end the other sessions', async () => {
      const here = await signIn(ctx.app, 'changer@example.com');
      const there = await signIn(ctx.app, 'changer@example.com');
      const wrong = await inject('POST', '/api/auth/change-password', here, { currentPassword: 'not my password at all', newPassword: NEW_PASSWORD });
      expect(wrong.statusCode).toBe(400);

      const changed = await inject('POST', '/api/auth/change-password', here, {
        currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true,
      });
      expect(changed.statusCode).toBe(200);
      expect(await status('/api/me', there)).toBe(401);
      expect(await canSignIn('changer@example.com', NEW_PASSWORD)).toBe(true);
    });

    it('always ends the other sessions, whatever the client asks (ADR 0013, client contract §6)', async () => {
      const here = await signIn(ctx.app, 'changer@example.com', NEW_PASSWORD);
      const there = await signIn(ctx.app, 'changer@example.com', NEW_PASSWORD);
      const changed = await inject('POST', '/api/auth/change-password', here, {
        currentPassword: NEW_PASSWORD, newPassword: `${NEW_PASSWORD} again`, revokeOtherSessions: false,
      });
      expect(changed.statusCode).toBe(200);
      expect(await status('/api/me', there)).toBe(401);
      // The session that changed it goes on (Better Auth gives it a new token).
      expect(await status('/api/me', cookieHeader(changed) || here)).toBe(200);
      // Back to the password the tests below expect.
      const back = await inject('POST', '/api/auth/change-password', cookieHeader(changed) || here, {
        currentPassword: `${NEW_PASSWORD} again`, newPassword: NEW_PASSWORD,
      });
      expect(back.statusCode).toBe(200);
    });

    it('rejects a too short new password', async () => {
      const here = await signIn(ctx.app, 'changer@example.com', NEW_PASSWORD);
      const response = await inject('POST', '/api/auth/change-password', here, { currentPassword: NEW_PASSWORD, newPassword: 'short one' });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('own sessions', () => {
    it('lists where the User is signed in, without session tokens', async () => {
      const laptop = await signIn(ctx.app, 'traveller@example.com');
      await signIn(ctx.app, 'traveller@example.com');
      const response = await inject('GET', '/api/me/sessions', laptop);
      const sessions = response.json() as { id: string; current: boolean }[];
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
      expect(response.body).not.toContain('token');
      expect(response.body).not.toContain(decodeURIComponent(laptop.split('=')[1]!).split('.')[0]);
    });

    it('ends one session, but only the User\'s own', async () => {
      const phone = await signIn(ctx.app, 'traveller@example.com');
      const laptop = await signIn(ctx.app, 'traveller@example.com');
      const phoneId = (await inject('GET', '/api/me/sessions', phone)).json().find((s: { current: boolean }) => s.current).id;

      const someoneElse = await signIn(ctx.app, 'changer@example.com', NEW_PASSWORD);
      expect((await inject('DELETE', `/api/me/sessions/${phoneId}`, someoneElse)).statusCode).toBe(404);
      expect(await status('/api/me', phone)).toBe(200);

      expect((await inject('DELETE', `/api/me/sessions/${phoneId}`, laptop)).statusCode).toBe(204);
      expect(await status('/api/me', phone)).toBe(401);
      expect(await status('/api/me', laptop)).toBe(200);
    });

    it('ends every other session at once', async () => {
      const others = [await signIn(ctx.app, 'traveller@example.com'), await signIn(ctx.app, 'traveller@example.com')];
      const here = await signIn(ctx.app, 'traveller@example.com');
      expect((await inject('DELETE', '/api/me/sessions', here)).statusCode).toBe(204);
      for (const cookie of others) expect(await status('/api/me', cookie)).toBe(401);
      expect((await inject('GET', '/api/me/sessions', here)).json()).toHaveLength(1);
    });
  });
});
