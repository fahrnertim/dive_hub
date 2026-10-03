// Sign-in, first-admin setup and invitations through the HTTP API (ADR 0011, 0012).
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, invitation, user } from '../src/db/schema.js';
import {
  BASE_URL, PASSWORD, cookieHeader, createTestApp, createTestDatabase, createUser, databaseReachable, signIn,
  type TestDatabase,
} from './support.js';

const online = await databaseReachable();

describe.skipIf(!online)('first-admin setup', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  const admin = { email: 'admin@example.com', name: 'Admin', password: PASSWORD };

  it('is needed on a fresh instance', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/setup' });
    expect(response.json()).toEqual({ needed: true });
  });

  it('rejects a wrong setup token', async () => {
    await ctx.setup.issue();
    const response = await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: { ...admin, token: 'x'.repeat(43) } });
    expect(response.statusCode).toBe(403);
  });

  it('keeps the token usable when the input is rejected', async () => {
    const token = (await ctx.setup.issue())!;
    const short = await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: { ...admin, token, password: 'too short' } });
    expect(short.statusCode).toBe(400);

    const ok = await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: { ...admin, token } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ email: 'admin@example.com', role: 'admin' });

    // The admin is signed in right away.
    const me = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieHeader(ok) } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { email: 'admin@example.com', role: 'admin' }, ownDiver: { name: 'Admin' } });
  });

  it('is closed once an admin exists, and issues no new token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/setup' })).json()).toEqual({ needed: false });
    expect(await ctx.setup.issue()).toBeNull();
    const again = await ctx.app.inject({
      method: 'POST', url: '/api/setup', payload: { ...admin, email: 'second@example.com', token: 'x'.repeat(43) },
    });
    expect(again.statusCode).toBe(409);
  });
});

describe.skipIf(!online)('sign-in', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'diver@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('requires a session for the logbook and account routes', async () => {
    for (const url of ['/api/me', '/api/dives', '/api/imports', '/api/users', '/api/invitations']) {
      const response = await ctx.app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('signs in with e-mail and password and out again, revoking the session', async () => {
    const cookie = await signIn(ctx.app, 'diver@example.com');
    expect(cookie).toContain('session_token');
    const me = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ user: { email: 'diver@example.com', role: 'user' } });

    const out = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie, origin: BASE_URL } });
    expect(out.statusCode).toBe(200);
    // The old cookie is useless now, even if a client kept it.
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('rejects a wrong password without saying whether the account exists', async () => {
    const wrong = await ctx.app.inject({
      method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: BASE_URL },
      payload: { email: 'diver@example.com', password: 'not the right password' },
    });
    const unknown = await ctx.app.inject({
      method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: BASE_URL },
      payload: { email: 'nobody@example.com', password: 'not the right password' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().message).toBe(wrong.json().message);
  });

  it('rejects sign-in from a foreign origin', async () => {
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: 'https://evil.example' },
      payload: { email: 'diver@example.com', password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
  });

  it('has no public sign-up', async () => {
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/auth/sign-up/email', headers: { origin: BASE_URL },
      payload: { email: 'stranger@example.com', name: 'Stranger', password: PASSWORD },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await t.db.select().from(user).where(eq(user.email, 'stranger@example.com'))).toHaveLength(0);
  });

  it('stores passwords as argon2id hashes', async () => {
    const [row] = await t.db.select({ password: account.password }).from(account)
      .innerJoin(user, eq(user.id, account.userId)).where(eq(user.email, 'diver@example.com'));
    expect(row!.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('gives every User an own Diver', async () => {
    const cookie = await signIn(ctx.app, 'diver@example.com');
    const me = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json().ownDiver).toMatchObject({ name: 'diver' });
  });
});

describe.skipIf(!online)('rate limiting', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { rateLimit: true });
    await createUser(ctx.auth, 'diver@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('blocks password sign-in after 10 attempts per client within 15 minutes, counted in the database', async () => {
    const attempt = () => ctx.app.inject({
      method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: BASE_URL },
      payload: { email: 'diver@example.com', password: 'guessing wrongly again' },
    });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
    const rows = await t.db.execute(sql`select count(*)::int as n from rate_limit`);
    expect(rows.rows[0]).toMatchObject({ n: expect.any(Number) });
    expect((rows.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });
});

describe.skipIf(!online)('invitations', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let adminCookie: string;
  let userCookie: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'admin@example.com', 'admin');
    await createUser(ctx.auth, 'member@example.com');
    adminCookie = await signIn(ctx.app, 'admin@example.com');
    userCookie = await signIn(ctx.app, 'member@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  const invite = (email: string, cookie = adminCookie) =>
    ctx.app.inject({ method: 'POST', url: '/api/invitations', headers: { cookie }, payload: { email } });
  const tokenOf = (url: string) => new URL(url).hash.replace('#/invite/', '');
  const accept = (token: string, name = 'New Diver') =>
    ctx.app.inject({ method: 'POST', url: '/api/invitations/accept', payload: { token, name, password: PASSWORD } });

  it('lets an invited person become a User with an own Diver, signed in right away', async () => {
    const created = await invite('New@Example.com');
    expect(created.statusCode).toBe(201);
    const { url, email, status } = created.json();
    expect({ email, status }).toEqual({ email: 'new@example.com', status: 'pending' });
    expect(url).toMatch(new RegExp(`^${BASE_URL}/#/invite/[\\w-]{43}$`));

    const lookup = await ctx.app.inject({ method: 'POST', url: '/api/invitations/lookup', payload: { token: tokenOf(url) } });
    expect(lookup.json()).toMatchObject({ email: 'new@example.com' });

    const accepted = await accept(tokenOf(url));
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({ email: 'new@example.com', name: 'New Diver', role: 'user' });
    const me = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieHeader(accepted) } });
    expect(me.json()).toMatchObject({ user: { email: 'new@example.com' }, ownDiver: { name: 'New Diver' } });

    // The new User can sign in with the password they chose.
    await signIn(ctx.app, 'new@example.com');
  });

  it('works only once', async () => {
    const token = tokenOf((await invite('once@example.com')).json().url);
    expect((await accept(token)).statusCode).toBe(201);
    expect((await accept(token, 'Someone Else')).statusCode).toBe(404);
  });

  it('accepts one of two simultaneous uses of the same link', async () => {
    const token = tokenOf((await invite('race@example.com')).json().url);
    const results = await Promise.all([accept(token, 'First'), accept(token, 'Second')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 404]);
  });

  it('stops working when revoked or expired', async () => {
    const revoked = (await invite('revoked@example.com')).json();
    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/invitations/${revoked.id}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(204);
    expect((await accept(tokenOf(revoked.url))).statusCode).toBe(404);

    const expired = (await invite('expired@example.com')).json();
    await t.db.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.id, expired.id));
    expect((await accept(tokenOf(expired.url))).statusCode).toBe(404);

    const list = await ctx.app.inject({ method: 'GET', url: '/api/invitations', headers: { cookie: adminCookie } });
    const statusOf = (id: string) => list.json().find((i: { id: string }) => i.id === id)?.status;
    expect([statusOf(revoked.id), statusOf(expired.id)]).toEqual(['revoked', 'expired']);
  });

  it('is never stored as the token itself', async () => {
    const { url, id } = (await invite('hashed@example.com')).json();
    const [row] = await t.db.select().from(invitation).where(eq(invitation.id, id));
    expect(row!.tokenSha256).not.toContain(tokenOf(url));
    expect(row!.tokenSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses addresses that already have a User', async () => {
    expect((await invite('member@example.com')).statusCode).toBe(409);
  });

  it('can only be managed by admins', async () => {
    expect((await invite('sneaky@example.com', userCookie)).statusCode).toBe(403);
    for (const url of ['/api/invitations', '/api/users']) {
      expect((await ctx.app.inject({ method: 'GET', url, headers: { cookie: userCookie } })).statusCode, url).toBe(403);
    }
    const users = await ctx.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: adminCookie } });
    expect(users.json().map((u: { email: string }) => u.email)).toContain('member@example.com');
  });

  it('exposes only the Better Auth endpoints we use; its admin plugin is reachable through our routes only', async () => {
    const me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: userCookie } })).json();
    const blocked = [
      ['/api/auth/admin/set-role', userCookie, { userId: me.user.id, role: 'admin' }],
      ['/api/auth/admin/impersonate-user', adminCookie, { userId: me.user.id }],
      ['/api/auth/admin/remove-user', adminCookie, { userId: me.user.id }],
      ['/api/auth/admin/set-user-password', adminCookie, { userId: me.user.id, newPassword: PASSWORD }],
      ['/api/auth/list-sessions', userCookie, undefined],
      ['/api/auth/request-password-reset', userCookie, { email: 'member@example.com' }],
      ['/api/auth/update-user', userCookie, { name: 'x' }],
      ['/api/auth/sign-in/email/../../admin/list-users', adminCookie, undefined],
    ] as const;
    for (const [url, cookie, payload] of blocked) {
      const response = await ctx.app.inject({
        method: payload ? 'POST' : 'GET', url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }),
      });
      expect(response.statusCode, url).toBe(404);
    }
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: userCookie } })).json().user.role).toBe('user');
  });
});
