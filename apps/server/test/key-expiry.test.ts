// The expiry date of a Provider's API key (ADR 0062): kept when the Provider's token sign-in declares it, said a week
// ahead, refused for a Provider without it or when already past, and replaced by signing in again.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGarminAdapter } from '../src/providers/garmin/garmin-adapter.js';
import { createGarminClient } from '../src/providers/garmin/garmin-client.js';
import { createFakeGarmin, type FakeGarmin } from './fake-garmin.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, resettableClock, signIn, type TestDatabase } from './support.js';

const KEY = 'GCDC_secret-key-1234';
/** The app's clock, standing still: a day the test names is the server's, also across midnight (UTC). */
const clock = resettableClock({ stopped: true });
const day = (offsetDays: number) => new Date(clock.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!(await databaseReachable()))('the key\'s expiry date', () => {
  let t: TestDatabase;
  let garmin: FakeGarmin;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let diverId: string;
  type View = { id: string; keyExpiresOn: string | null; keyExpiresSoon: boolean };

  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const connectGarmin = (extra: object = {}) => call('POST', '/api/connections/garmin', { diverId, token: KEY, keepSignedIn: false, ...extra });

  beforeAll(async () => {
    t = await createTestDatabase();
    garmin = await createFakeGarmin();
    garmin.addAccount({ key: KEY, guid: 'guid-1', displayName: 'Ida Diver', dives: [] });
    garmin.addAccount({ key: 'GCDC_new-key', guid: 'guid-1', displayName: 'Ida Diver', dives: [] });
    ctx = await createTestApp(t, { clock, extraProviders: [createGarminAdapter({ client: createGarminClient({ url: garmin.url }) })] });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    diverId = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
  });
  beforeEach(() => ctx.clock.reset());
  afterEach(async () => {
    for (const c of (await call('GET', '/api/connections')).json() as View[]) await call('DELETE', `/api/connections/${c.id}`);
  });
  afterAll(async () => {
    await ctx?.app.close();
    await garmin?.close();
    await t?.drop();
  });

  it('the expiry date is kept and shown', async () => {
    const created = await connectGarmin({ keyExpiresOn: day(60) });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ keyExpiresOn: day(60), keyExpiresSoon: false });
    expect(((await call('GET', '/api/connections')).json() as View[])[0]).toMatchObject({ keyExpiresOn: day(60) });
    expect((await connectGarmin()).statusCode).toBe(409);
  });

  it('a Connection without a date has none', async () => {
    expect((await connectGarmin()).json()).toMatchObject({ keyExpiresOn: null, keyExpiresSoon: false });
  });

  it('keyExpiresSoon from seven days before', async () => {
    const created = (await connectGarmin({ keyExpiresOn: day(10) })).json() as View;
    const soon = async () => ((await call('GET', '/api/connections')).json() as View[]).find((c) => c.id === created.id)!.keyExpiresSoon;
    expect(await soon()).toBe(false);
    ctx.clock.skip(2 * 86_400_000);
    expect(await soon()).toBe(false);
    ctx.clock.skip(86_400_000);
    expect(await soon()).toBe(true);
    ctx.clock.skip(30 * 86_400_000);
    expect(await soon()).toBe(true);
  });

  it('a date for SSI is refused', async () => {
    const response = await call('POST', '/api/connections/ssi', {
      diverId, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: true, keyExpiresOn: day(30),
    });
    expect(response.statusCode).toBe(400);
  });

  it('a date in the past is refused', async () => {
    const response = await connectGarmin({ keyExpiresOn: day(-1) });
    expect(response.statusCode).toBe(400);
    expect(((await call('GET', '/api/connections')).json() as View[])).toEqual([]);
  });

  it('signing in again with a new key replaces the date', async () => {
    const created = (await connectGarmin({ keyExpiresOn: day(30) })).json() as View;
    const again = await call('POST', `/api/connections/${created.id}/sign-in`, { token: 'GCDC_new-key', keepSignedIn: false, keyExpiresOn: day(90) });
    expect(again.json()).toMatchObject({ keyExpiresOn: day(90) });
    const cleared = await call('POST', `/api/connections/${created.id}/sign-in`, { token: KEY, keepSignedIn: false });
    expect(cleared.json()).toMatchObject({ keyExpiresOn: null, keyExpiresSoon: false });
    expect((await call('POST', `/api/connections/${created.id}/sign-in`, { token: KEY, keepSignedIn: false, keyExpiresOn: day(-2) })).statusCode).toBe(400);
  });
});
