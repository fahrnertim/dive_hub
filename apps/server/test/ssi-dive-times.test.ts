// How SSI's dives came about, for finding why their times differ from a dive computer's: the read-only "dive times" of a
// Connection, against a fake SSI logbook. A hand-typed dive made weeks later, one the dive centre confirmed, one synced from
// a computer. It reads whatever the import mode is, stores nothing, and belongs to the Connection's own User.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeSsi, computerDive, handTypedDive } from './fake-ssi.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

const ERIKA = 5_012_047;

type Times = {
  provider: string;
  dives: {
    remoteId: string; remoteNumber: number | null; localStart: string; durationSeconds: number; maxDepthM: number | null;
    madeBy: string; createdAt: string | null; confirmedByCentre: boolean; confirmedByLeader: boolean;
  }[];
};

describe.skipIf(!(await databaseReachable()))('the times of the dives at SSI', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let connectionId: string;
  const remote: Record<string, string> = {};

  const call = async (method: 'GET' | 'POST', url: string, payload?: object, cookie = tim) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const times = async () => (await call('GET', `/api/connections/${connectionId}/dive-times`)).json() as Times;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { fakeSsi: createFakeSsi({ buddies: [], sites: [] }) });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    const own = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    connectionId = (await call('POST', '/api/connections/ssi', {
      diverId: own, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false,
    })).json().id;
    const add = (name: string, record: Record<string, unknown>) => { remote[name] = String(ctx.fakeSsi.addDive(ERIKA, record)); };
    add('later', {
      ...handTypedDive({ at: '2026-01-15 11:05', depthM: 18, minutes: 30, nr: 80 }), odin_user_log_crdate: '2026-02-03 19:40:12',
    });
    add('centre', {
      ...handTypedDive({ at: '2026-01-14 09:00', depthM: 20, minutes: 45, nr: 79 }), odin_user_log_divecenter_confirmed: 1,
      odin_user_log_divecenter_confirmed_name: 'Reef Divers', odin_user_log_leader_confirmed_id: 77,
    });
    add('computer', computerDive({ at: '2026-01-16 14:00', depthM: 22, minutes: 40, manufacturer: 'Garmin', product: 'Descent Mk3', serial: '3333', nr: 81 }));
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('lists each dive with its start, how it was made and who confirmed it, oldest first, while the import is off', async () => {
    const res = await call('GET', `/api/connections/${connectionId}/dive-times`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Times;
    expect(body.provider).toBe('ssi');
    expect(body.dives.map((d) => d.remoteId)).toEqual([remote.centre, remote.later, remote.computer]);
    expect(body.dives[1]).toMatchObject({
      remoteNumber: 80, localStart: '2026-01-15 11:05', durationSeconds: 1800, maxDepthM: 18, madeBy: 'logbook',
      createdAt: '2026-02-03 19:40:12', confirmedByCentre: false, confirmedByLeader: false,
    });
    expect(body.dives[0]).toMatchObject({ madeBy: 'logbook', confirmedByCentre: true, confirmedByLeader: true, createdAt: null });
    expect(body.dives[2]).toMatchObject({ madeBy: 'computer' });
  });

  it('never names the centre, and changes nothing here or at SSI', async () => {
    const before = ctx.fakeSsi.calls.length;
    const text = JSON.stringify(await times());
    expect(text).not.toContain('Reef Divers');
    expect(ctx.fakeSsi.calls.slice(before).map((c) => c.what)).toEqual(['get_divelog']);
    expect(((await call('GET', '/api/dives?limit=5')).json() as { total: number }).total).toBe(0);
  });

  it('refuses another User\'s Connection and a signed-out request', async () => {
    await createUser(ctx.auth, 'other@example.com');
    const other = await signIn(ctx.app, 'other@example.com');
    expect((await call('GET', `/api/connections/${connectionId}/dive-times`, undefined, other)).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/connections/${connectionId}/dive-times` })).statusCode).toBe(401);
  });

  it('asks to sign in again when SSI no longer accepts the token, and reads again after that', async () => {
    ctx.fakeSsi.expireTokens();
    const res = await call('GET', `/api/connections/${connectionId}/dive-times`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'provider_sign_in_needed' });
    expect((await call('POST', `/api/connections/${connectionId}/sign-in`, { login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false })).statusCode).toBe(200);
    expect((await times()).dives).toHaveLength(3);
  });
});
