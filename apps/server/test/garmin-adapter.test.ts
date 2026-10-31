// The Garmin adapter against the fake Garmin (ADR 0062): signing in with a personal key, the dives as the preview sees
// them, a key revoked at Garmin, the file of a dive and the pause between downloads, and the Provider through the HTTP
// API. The key and the token never appear in an error.
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connection } from '../src/db/schema.js';
import { createGarminAdapter } from '../src/providers/garmin/garmin-adapter.js';
import { createGarminClient } from '../src/providers/garmin/garmin-client.js';
import { createFakeGarmin, type FakeGarmin, type FakeGarminDive } from './fake-garmin.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

const fit = new Uint8Array(readFileSync(new URL('./fixtures/synthetic-dive.fit', import.meta.url)));
const KEY = 'GCDC_secret-key-1234';
const dive = (n: number, typeKey = 'single_gas_diving'): FakeGarminDive => ({ activityId: 1000 + n, typeKey, startTimeLocal: '2026-10-01 10:00:00', fit });

let garmin: FakeGarmin;

function setUp(dives: FakeGarminDive[], deps: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}) {
  garmin.addAccount({ key: KEY, guid: 'guid-1', displayName: 'Ida Diver', dives });
  return createGarminAdapter({ client: createGarminClient({ url: garmin.url }), ...deps });
}
const tokenCalls = () => garmin.calls.filter((c) => c.startsWith('POST')).length;

describe('the Garmin adapter', () => {
  beforeEach(async () => {
    garmin = await createFakeGarmin();
  });
  afterEach(() => garmin.close());

  it('signs in with a key and names the account', async () => {
    const adapter = setUp([dive(1)]);
    expect(adapter.capabilities.signIn).toEqual({ kind: 'token', createUrl: 'https://connect.garmin.com/app/settings/personalApiToken', expires: true });
    expect(await adapter.signIn({ kind: 'token', token: KEY })).toEqual({ account: { id: 'guid-1', label: 'Ida Diver' }, access: KEY });
  });

  it('names an account without dives "Garmin", and refuses a wrong key without telling it', async () => {
    const adapter = setUp([]);
    expect((await adapter.signIn({ kind: 'token', token: KEY })).account.label).toBe('Garmin');
    const error = await adapter.signIn({ kind: 'token', token: 'GCDC_wrong' }).catch((e: Error) => e);
    expect(error).toMatchObject({ reason: 'wrong_credentials' });
    expect((error as Error).message).not.toContain('GCDC_wrong');
  });

  it('lists the dives as computer dives with their mode', async () => {
    const adapter = setUp([dive(1), dive(2, 'apnea_diving')]);
    const ctx = { connectionId: 'c1', accountId: 'guid-1', access: KEY };
    const listing = await adapter.dives!.list!(ctx);
    expect(listing.records.map((r) => r.remoteId)).toEqual(['1001', '1002']);
    const parsed = listing.records.map((r) => adapter.dives!.parse!(r.record, listing.context));
    expect(parsed).toEqual([
      expect.objectContaining({ remoteId: '1001', evidence: 'computer', device: null, diveMode: 'open_circuit', localStart: '2026-10-01 10:00:00', maxDepthM: 18.4, durationSeconds: 2400.5 }),
      expect.objectContaining({ remoteId: '1002', evidence: 'computer', diveMode: 'apnea' }),
    ]);
  });

  it('trades the key once and again a minute before its token expires', async () => {
    let now = Date.now();
    const adapter = setUp([dive(1)], { now: () => now });
    const ctx = { connectionId: 'c1', accountId: 'guid-1', access: KEY };
    await adapter.dives!.list!(ctx);
    await adapter.dives!.list!(ctx);
    expect(tokenCalls()).toBe(1);
    now += 24 * 3600_000 - 30_000;
    await adapter.dives!.list!(ctx);
    expect(tokenCalls()).toBe(2);
  });

  it('answers a revoked key on an action as signed_out', async () => {
    const adapter = setUp([dive(1)]);
    const ctx = { connectionId: 'c1', accountId: 'guid-1', access: KEY };
    await adapter.dives!.list!(ctx);
    garmin.revoke(KEY);
    // Garmin refuses the token it handed out too; the key is traded again and found revoked.
    const error = await adapter.dives!.list!(ctx).catch((e: Error) => e);
    expect(error).toMatchObject({ reason: 'signed_out' });
    expect((error as Error).message).not.toContain(KEY);
  });

  it('does not retry a kept token on 429 or 5xx, nor skip the pause before a download', async () => {
    garmin.addAccount({ key: KEY, guid: 'guid-1', displayName: 'Ida Diver', dives: [dive(1)] });
    let status = 0;
    const flaky: typeof fetch = async (input, init) =>
      (status && !new URL(String(input instanceof Request ? input.url : input)).pathname.includes('personalapitoken'))
        ? new Response('{}', { status }) : fetch(input, init);
    const sleep = vi.fn(async (_ms: number) => {});
    const adapter = createGarminAdapter({ client: createGarminClient({ url: garmin.url, fetch: flaky }), sleep, now: () => 0 });
    const ctx = { connectionId: 'c1', accountId: 'guid-1', access: KEY };
    await adapter.dives!.list!(ctx);
    for (const s of [429, 503]) {
      status = s;
      const before = garmin.calls.length;
      await expect(adapter.dives!.list!(ctx)).rejects.toMatchObject({ reason: 'unavailable' });
      await expect(adapter.dives!.file!(ctx, '1001')).rejects.toMatchObject({ reason: 'unavailable' });
      // Nothing reached Garmin again, and no token was traded anew.
      expect(garmin.calls.length).toBe(before);
    }
    expect(tokenCalls()).toBe(1);
  });

  it('gives the original file of a dive', async () => {
    const adapter = setUp([dive(1)]);
    const file = await adapter.dives!.file!({ connectionId: 'c1', accountId: 'guid-1', access: KEY }, '1001');
    expect(file).toMatchObject({ mediaType: 'application/vnd.ant.fit', fileName: '1001.fit' });
    expect(Buffer.from(file.bytes).equals(Buffer.from(fit))).toBe(true);
  });

  it('downloads wait the pause between two files', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const now = Date.now();
    const adapter = setUp([dive(1), dive(2)], { sleep, now: () => now });
    const ctx = { connectionId: 'c1', accountId: 'guid-1', access: KEY };
    await adapter.dives!.file!(ctx, '1001');
    expect(sleep).not.toHaveBeenCalled();
    await adapter.dives!.file!(ctx, '1002');
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1000);
  });
});

describe.skipIf(!(await databaseReachable()))('Garmin through the API', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let diverId: string;

  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });

  beforeAll(async () => {
    t = await createTestDatabase();
    garmin = await createFakeGarmin();
    garmin.addAccount({ key: KEY, guid: 'guid-1', displayName: 'Ida Diver', dives: [dive(1)] });
    garmin.addAccount({ key: 'GCDC_other-key', guid: 'guid-2', displayName: 'Ole Other', dives: [] });
    ctx = await createTestApp(t, { extraProviders: [createGarminAdapter({ client: createGarminClient({ url: garmin.url }) })] });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    diverId = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await garmin?.close();
    await t?.drop();
  });

  it('lists Garmin with the key page and the expiry date', async () => {
    const garminView = ((await call('GET', '/api/providers')).json() as { id: string; signIn: object }[]).find((p) => p.id === 'garmin');
    expect(garminView!.signIn).toEqual({ kind: 'token', login: null, canKeepPassword: false, createUrl: 'https://connect.garmin.com/app/settings/personalApiToken', expires: true });
    expect(garminView).toMatchObject({ data: { dives: { asFiles: true, export: null } } });
    const ssiView = ((await call('GET', '/api/providers')).json() as { id: string; data: { dives: object } }[]).find((p) => p.id === 'ssi');
    expect(ssiView!.data.dives).not.toHaveProperty('asFiles');
  });

  it('refuses a second key of another account, and needs a sign-in once the key is revoked', async () => {
    const created = await call('POST', '/api/connections/garmin', { diverId, token: KEY, keepSignedIn: false });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ provider: 'garmin', accountId: 'guid-1', accountLabel: 'Ida Diver', state: 'active' });
    const id = created.json().id as string;
    // Its dives come as files: the dive times and the check for dives gone still answer.
    const times = await call('GET', `/api/connections/${id}/dive-times`);
    expect(times.statusCode).toBe(200);
    expect(times.json()).toMatchObject({ provider: 'garmin', dives: [expect.objectContaining({ remoteId: '1001' })] });
    const gone = await call('POST', `/api/connections/${id}/gone-dives/check`);
    expect(gone.statusCode).toBe(200);
    expect(gone.json()).toMatchObject({ gone: 0 });
    expect((await call('POST', `/api/connections/${id}/sign-in`, { token: 'GCDC_other-key', keepSignedIn: false })).json())
      .toMatchObject({ code: 'provider_other_account' });

    garmin.revoke(KEY);
    const [row] = await t.db.select().from(connection).where(eq(connection.id, id));
    const list = () => ctx.providers.connections.withAccess(row!, (c) => ctx.providers.providers.get('garmin').dives!.list!(c));
    await expect(list()).rejects.toMatchObject({ code: 'provider_sign_in_needed' });
    expect((await t.db.select().from(connection).where(eq(connection.id, id)))[0]!.state).toBe('needs_sign_in');
  });
});
