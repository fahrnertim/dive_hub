// Admins managing Users through the HTTP API (ADR 0013): role, disable/enable, ending sessions,
// deleting with everything only that User owns, and always keeping an enabled admin.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { original } from '../src/db/schema.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, PASSWORD, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn,
  type TestDatabase,
} from './support.js';

describe.skipIf(!(await databaseReachable()))('managing Users', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let adminCookie: string;
  let adminId: string;
  const ids: Record<string, string> = {};

  const inject = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const status = async (url: string, cookie: string) => (await inject('GET', url, cookie, undefined)).statusCode;
  const canSignIn = async (email: string) => (await ctx.app.inject({
    method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: BASE_URL }, payload: { email, password: PASSWORD },
  })).statusCode === 200;

  async function upload(cookie: string, fileName: string, data: Uint8Array) {
    const { payload, headers } = multipartFile(fileName, data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(response.json().id);
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    adminId = (await createUser(ctx.auth, 'admin@example.com', 'admin')).id;
    for (const name of ['member', 'promoted', 'disabled', 'leaver', 'stayer']) {
      ids[name] = (await createUser(ctx.auth, `${name}@example.com`)).id;
    }
    adminCookie = await signIn(ctx.app, 'admin@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('is for admins only', async () => {
    const member = await signIn(ctx.app, 'member@example.com');
    expect((await inject('PATCH', `/api/users/${ids.promoted}`, member, { role: 'admin' })).statusCode).toBe(403);
    expect((await inject('POST', `/api/users/${ids.leaver}/disable`, member)).statusCode).toBe(403);
    expect((await inject('DELETE', `/api/users/${ids.leaver}`, member, { confirmEmail: 'leaver@example.com' })).statusCode).toBe(403);
  });

  it('changes roles, and a new admin can manage Users at once', async () => {
    const promoted = await signIn(ctx.app, 'promoted@example.com');
    expect(await status('/api/users', promoted)).toBe(403);
    const response = await inject('PATCH', `/api/users/${ids.promoted}`, adminCookie, { role: 'admin' });
    expect(response.json()).toMatchObject({ email: 'promoted@example.com', role: 'admin' });
    expect(await status('/api/users', promoted)).toBe(200);

    await inject('PATCH', `/api/users/${ids.promoted}`, adminCookie, { role: 'user' });
    expect(await status('/api/users', promoted)).toBe(403);
  });

  it('always keeps an enabled admin', async () => {
    const demoteSelf = await inject('PATCH', `/api/users/${adminId}`, adminCookie, { role: 'user' });
    expect(demoteSelf.statusCode).toBe(409);
    expect(await status('/api/users', adminCookie)).toBe(200);

    // With a second admin, stepping down works.
    await inject('PATCH', `/api/users/${ids.promoted}`, adminCookie, { role: 'admin' });
    const second = await signIn(ctx.app, 'promoted@example.com');
    expect((await inject('PATCH', `/api/users/${adminId}`, adminCookie, { role: 'user' })).statusCode).toBe(200);
    // …but now the second admin is the last one.
    expect((await inject('PATCH', `/api/users/${ids.promoted}`, second, { role: 'user' })).statusCode).toBe(409);
    await inject('PATCH', `/api/users/${adminId}`, second, { role: 'admin' });
    await inject('PATCH', `/api/users/${ids.promoted}`, adminCookie, { role: 'user' });
  });

  it("doesn't let two admins demote each other at the same moment", async () => {
    await inject('PATCH', `/api/users/${ids.promoted}`, adminCookie, { role: 'admin' });
    const second = await signIn(ctx.app, 'promoted@example.com');
    const results = await Promise.all([
      inject('PATCH', `/api/users/${ids.promoted}`, adminCookie, { role: 'user' }),
      inject('PATCH', `/api/users/${adminId}`, second, { role: 'user' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const admins = await t.db.execute(sql`select count(*)::int as n from "user" where role = 'admin'`);
    expect((admins.rows[0] as { n: number }).n).toBe(1);
    // Restore: the original admin stays admin for the following tests.
    const meNow = await inject('GET', '/api/me', adminCookie);
    if (meNow.json().user.role !== 'admin') await inject('PATCH', `/api/users/${adminId}`, second, { role: 'admin' });
    await inject('PATCH', `/api/users/${ids.promoted}`, adminCookie, { role: 'user' });
  });

  it('disables a User: sessions end, sign-in is refused, data stays; enabling undoes it', async () => {
    const cookie = await signIn(ctx.app, 'disabled@example.com');
    await upload(cookie, 'mine.fit', makeSyntheticDive({ serialNumber: 501 }));

    const response = await inject('POST', `/api/users/${ids.disabled}/disable`, adminCookie);
    expect(response.json()).toMatchObject({ disabled: true });
    expect(await status('/api/me', cookie)).toBe(401);
    expect(await canSignIn('disabled@example.com')).toBe(false);

    expect((await inject('POST', `/api/users/${ids.disabled}/enable`, adminCookie)).json()).toMatchObject({ disabled: false });
    const again = await signIn(ctx.app, 'disabled@example.com');
    expect((await inject('GET', '/api/dives', again)).json().dives).toHaveLength(1);
  });

  it("doesn't let an admin disable or delete themselves", async () => {
    expect((await inject('POST', `/api/users/${adminId}/disable`, adminCookie)).statusCode).toBe(409);
    expect((await inject('DELETE', `/api/users/${adminId}`, adminCookie, { confirmEmail: 'admin@example.com' })).statusCode).toBe(409);
  });

  it('signs a User out everywhere', async () => {
    const one = await signIn(ctx.app, 'member@example.com');
    const two = await signIn(ctx.app, 'member@example.com');
    expect((await inject('DELETE', `/api/users/${ids.member}/sessions`, adminCookie)).statusCode).toBe(204);
    expect(await status('/api/me', one)).toBe(401);
    expect(await status('/api/me', two)).toBe(401);
    expect(await canSignIn('member@example.com')).toBe(true);
  });

  describe('deleting a User', () => {
    let leaver: string;
    let stayer: string;
    const sharedFile = makeSyntheticDive({ serialNumber: 777 });

    beforeAll(async () => {
      leaver = await signIn(ctx.app, 'leaver@example.com');
      stayer = await signIn(ctx.app, 'stayer@example.com');
      await upload(leaver, 'leaver.fit', sharedFile);
      await upload(leaver, 'leaver-2.fit', makeSyntheticDive({ serialNumber: 777, start: new Date('2026-02-01T10:00:00Z') }));
      // The stayer uploads the very same file: a separate Original, stored once on disk.
      await upload(stayer, 'copy.fit', sharedFile);
      await upload(stayer, 'stayer.fit', makeSyntheticDive({ serialNumber: 888 }));
    });

    it('needs the e-mail typed as confirmation', async () => {
      const response = await inject('DELETE', `/api/users/${ids.leaver}`, adminCookie, { confirmEmail: 'someone@example.com' });
      expect(response.statusCode).toBe(400);
      expect(await status('/api/me', leaver)).toBe(200);
    });

    it('removes the account and everything only they own, but not files another User still has', async () => {
      const keyOf = async (userId: string) =>
        (await t.db.select({ key: original.storageKey }).from(original).where(eq(original.userId, userId))).map((r) => r.key);
      const leaversKeys = await keyOf(ids.leaver!);
      const stayersKeys = await keyOf(ids.stayer!);
      expect(leaversKeys).toHaveLength(2);
      const shared = leaversKeys.filter((k) => stayersKeys.includes(k));
      expect(shared).toHaveLength(1);

      const response = await inject('DELETE', `/api/users/${ids.leaver}`, adminCookie, { confirmEmail: 'Leaver@Example.com ' });
      expect(response.statusCode).toBe(204);

      expect(await status('/api/me', leaver)).toBe(401);
      expect(await canSignIn('leaver@example.com')).toBe(false);
      const users = (await inject('GET', '/api/users', adminCookie)).json() as { email: string }[];
      expect(users.map((u) => u.email)).not.toContain('leaver@example.com');

      // Nothing of theirs is left in the database…
      const left = await t.db.execute(sql`select
        (select count(*) from original where user_id = ${ids.leaver})::int as originals,
        (select count(*) from import where user_id = ${ids.leaver})::int as imports,
        (select count(*) from diver_management where user_id = ${ids.leaver})::int as managed,
        (select count(*) from device where serial_number = '777')::int as devices,
        (select count(*) from dive d where not exists (select 1 from diver_management m where m.diver_id = d.diver_id))::int as orphan_dives,
        (select count(*) from diver v where not exists (select 1 from diver_management m where m.diver_id = v.id))::int as orphan_divers`);
      expect(left.rows[0]).toEqual({ originals: 0, imports: 0, managed: 0, devices: 0, orphan_dives: 0, orphan_divers: 0 });

      // …and their own file is gone from storage, while the one the stayer also uploaded remains.
      for (const key of leaversKeys) {
        expect(existsSync(join(t.dataDir, ...key.split('/'))), key).toBe(shared.includes(key));
      }
      // The stayer's logbook is untouched.
      expect((await inject('GET', '/api/dives', stayer)).json().dives).toHaveLength(1);
      expect((await inject('GET', '/api/imports', stayer)).json()).toHaveLength(2);
    });
  });
});
