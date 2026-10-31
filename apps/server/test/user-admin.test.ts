// Admins managing Users through the HTTP API (ADR 0013): role, disable/enable, ending sessions,
// deleting with everything only that User owns, and always keeping an enabled admin.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
    // The loser is either stopped by the last-admin guard (409) or, if the winner committed first, is no longer an admin (403).
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes[0]).toBe(200);
    expect([403, 409]).toContain(codes[1]);
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

  it('logs every admin action with the acting admin, and not a refused one', async () => {
    const info = vi.spyOn(ctx.app.log, 'info');
    try {
      await inject('PATCH', `/api/users/${ids.promoted}`, adminCookie, { role: 'user' });
      await inject('POST', `/api/users/${ids.promoted}/disable`, adminCookie);
      await inject('POST', `/api/users/${ids.promoted}/enable`, adminCookie);
      await inject('DELETE', `/api/users/${ids.promoted}/sessions`, adminCookie);
      await inject('POST', `/api/users/${ids.promoted}/password-reset`, adminCookie);
      await inject('POST', `/api/users/${adminId}/disable`, adminCookie);
      const logged = info.mock.calls.filter(([, message]) => message === 'admin action').map(([fields]) => fields);
      expect(logged).toEqual(['role changed', 'disabled', 'enabled', 'sessions ended', 'reset link issued']
        .map((action) => ({ action, userId: ids.promoted, by: adminId })));
    } finally {
      info.mockRestore();
    }
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

      // A Cylinder tied to a doomed Recording: on the leaver's own Dive, and on a Dive that stays (its Diver is also the stayer's).
      const leaversDives = (await t.db.execute(sql`select d.id, d.primary_recording_id as recording from dive d
        join diver_management m on m.diver_id = d.diver_id where m.user_id = ${ids.leaver} order by d.starts_at`)).rows as { id: string; recording: string }[];
      expect(leaversDives).toHaveLength(2);
      const [own, kept] = leaversDives as [{ id: string; recording: string }, { id: string; recording: string }];
      const both = (await t.db.execute(sql`insert into diver (name) values ('Shared buddy') returning id`)).rows[0] as { id: string };
      await t.db.execute(sql`insert into diver_management (user_id, diver_id) values (${ids.leaver}, ${both.id}), (${ids.stayer}, ${both.id})`);
      await t.db.execute(sql`update dive set diver_id = ${both.id} where id = ${kept.id}`);
      for (const d of [own, kept]) {
        await t.db.execute(sql`delete from cylinder where dive_id = ${d.id}`);
        await t.db.execute(sql`insert into cylinder (dive_id, position, volume_l, from_pod, recording_id, channel)
          values (${d.id}, 0, 12, true, ${d.recording}, 'tankPressure')`);
      }

      const response = await inject('DELETE', `/api/users/${ids.leaver}`, adminCookie, { confirmEmail: 'Leaver@Example.com ' });
      expect(response.statusCode, response.body).toBe(204);
      // The Dive that stays keeps its Cylinder, without the series.
      expect((await t.db.execute(sql`select dive_id, volume_l, from_pod, recording_id, channel from cylinder where dive_id in (${own.id}, ${kept.id})`)).rows)
        .toEqual([{ dive_id: kept.id, volume_l: 12, from_pod: false, recording_id: null, channel: null }]);

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
      // The stayer's logbook is untouched: their own Dive, and the shared Diver's that stayed.
      expect((await inject('GET', '/api/dives', stayer)).json().dives).toHaveLength(2);
      expect((await inject('GET', '/api/imports', stayer)).json()).toHaveLength(2);
    });
  });
});
