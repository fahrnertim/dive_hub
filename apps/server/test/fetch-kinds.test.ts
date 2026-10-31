// The kinds of dive a Connection fetches (ADR 0062): scuba and apnea by default, set through the Connection's settings;
// a dive of a kind not chosen is skipped with a reason, at SSI and at Garmin, and a Garmin dive of such a kind is never
// downloaded. Turning a kind on later takes in its older dives with the next fetch.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connection } from '../src/db/schema.js';
import { createGarminAdapter } from '../src/providers/garmin/garmin-adapter.js';
import { createGarminClient } from '../src/providers/garmin/garmin-client.js';
import { createFakeGarmin, type FakeGarmin } from './fake-garmin.js';
import { createFakeSsi, handTypedDive } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

const ERIKA = 5_012_047;

type Outcome = { result: string; reason?: string; remoteId?: string };

describe.skipIf(!(await databaseReachable()))('the kinds of dive a Connection fetches', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let garmin: FakeGarmin;
  let cookie: string;
  let diverId: string;
  let users = 0;

  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const downloads = (id: number) => garmin.calls.filter((c) => c === `GET /download-service/files/activity/${id}`).length;

  beforeAll(async () => {
    t = await createTestDatabase();
    garmin = await createFakeGarmin();
    ctx = await createTestApp(t, {
      fakeSsi: createFakeSsi(),
      extraProviders: [createGarminAdapter({ client: createGarminClient({ url: garmin.url }), pauseMs: 0 })],
    });
    await createUser(ctx.auth, 'kinds@example.com');
    cookie = await signIn(ctx.app, 'kinds@example.com');
    diverId = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await garmin?.close();
    await t?.drop();
  });

  /** A Connection to a fresh Garmin account holding these dives (activity ID and type), import on. */
  async function garminConnection(dives: { activityId: number; typeKey: string; start: string }[]) {
    users += 1;
    const key = `GCDC_kinds-${users}`;
    garmin.addAccount({
      key, guid: `kinds-guid-${users}`, displayName: `Kinds ${users}`,
      dives: dives.map((d) => ({ activityId: d.activityId, typeKey: d.typeKey, startTimeLocal: d.start, fit: makeSyntheticDive({ serialNumber: 9000 + d.activityId, start: new Date(`${d.start.replace(' ', 'T')}Z`) }) })),
    });
    // One Connection per Diver and Provider: a Diver of its own for each.
    const other = (await call('POST', '/api/divers', { name: `Kinds diver ${users}` })).json().id as string;
    const id = (await call('POST', '/api/connections/garmin', { diverId: other, token: key, keepSignedIn: false })).json().id as string;
    await call('PATCH', `/api/connections/${id}`, { diveImport: { mode: 'add' } });
    return id;
  }
  const fetchOutcome = async (id: string): Promise<Outcome[]> => {
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${id}/dive-import`, { computers: [], decisions: [] });
    expect(started.statusCode).toBe(202);
    await ctx.imports.processImport(started.json().id);
    const done = (await call('GET', `/api/imports/${started.json().id}`)).json() as { status: string; outcome: Outcome[] };
    expect(done.status).toBe('done');
    return done.outcome;
  };

  it('a new Connection fetches both kinds', async () => {
    const id = await garminConnection([]);
    const view = (await call('GET', '/api/connections')).json() as { id: string; fetchKinds: string[] }[];
    expect(view.find((c) => c.id === id)!.fetchKinds).toEqual(['scuba', 'apnea']);
  });

  it('PATCH sets the kinds and refuses an empty or unknown one', async () => {
    const id = await garminConnection([]);
    const set = await call('PATCH', `/api/connections/${id}`, { fetchKinds: ['apnea'] });
    expect(set.statusCode).toBe(200);
    expect(set.json().fetchKinds).toEqual(['apnea']);
    const [row] = await t.db.select({ kinds: connection.fetchKinds }).from(connection).where(eq(connection.id, id));
    expect(row!.kinds).toEqual(['apnea']);

    for (const fetchKinds of [[], ['scuba', 'scuba'], ['snorkel'], ['scuba', 'apnea', 'apnea']]) {
      expect((await call('PATCH', `/api/connections/${id}`, { fetchKinds })).statusCode).toBe(400);
    }
    expect((await call('GET', '/api/connections')).json().find((c: { id: string }) => c.id === id).fetchKinds).toEqual(['apnea']);
  });

  it('the database refuses an empty list or an unknown kind', async () => {
    const id = await garminConnection([]);
    await expect(t.db.update(connection).set({ fetchKinds: [] }).where(eq(connection.id, id))).rejects.toThrow();
    await expect(t.db.update(connection).set({ fetchKinds: ['snorkel' as 'scuba'] }).where(eq(connection.id, id))).rejects.toThrow();
  });

  it('SSI: an apnea dive is skipped when only scuba is chosen', async () => {
    const connectionId = (await call('POST', '/api/connections/ssi', {
      diverId, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false,
    })).json().id as string;
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'create' }, fetchKinds: ['scuba'] });
    const scuba = String(ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at: '2026-03-01 10:00', depthM: 18, minutes: 30, nr: 1 })));
    const apnea = String(ctx.fakeSsi.addDive(ERIKA, { ...handTypedDive({ at: '2026-03-02 10:00', depthM: 25, minutes: 3, nr: 2 }), odin_user_log_dive_type: 6 }));

    const preview = (await call('GET', `/api/connections/${connectionId}/dive-import`)).json() as { counts: Record<string, number> };
    expect(preview.counts).toMatchObject({ total: 2, create: 1, kindNotChosen: 1 });

    const outcome = await fetchOutcome(connectionId);
    expect(outcome.find((o) => o.remoteId === scuba)).toMatchObject({ result: 'created' });
    expect(outcome.find((o) => o.remoteId === apnea)).toMatchObject({ result: 'skipped', reason: 'kind_not_chosen' });
  });

  it('Garmin: an apnea dive isn\'t downloaded when only scuba is chosen', async () => {
    const id = await garminConnection([
      { activityId: 5001, typeKey: 'single_gas_diving', start: '2026-02-01 10:00:00' },
      { activityId: 5002, typeKey: 'apnea_diving', start: '2026-02-02 10:00:00' },
    ]);
    await call('PATCH', `/api/connections/${id}`, { fetchKinds: ['scuba'] });
    const preview = (await call('GET', `/api/connections/${id}/dive-import`)).json() as { counts: Record<string, number> };
    expect(preview.counts).toMatchObject({ total: 2, recordings: 1, kindNotChosen: 1 });

    const outcome = await fetchOutcome(id);
    expect(outcome).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'created', remoteId: '5001' }),
      expect.objectContaining({ result: 'skipped', reason: 'kind_not_chosen', remoteId: '5002' }),
    ]));
    expect(downloads(5001)).toBe(1);
    expect(downloads(5002)).toBe(0);
  });

  it('turning apnea on, the next fetch takes in the older apnea dive', async () => {
    const id = await garminConnection([
      { activityId: 5101, typeKey: 'apnea_diving', start: '2026-01-10 10:00:00' },
      { activityId: 5102, typeKey: 'single_gas_diving', start: '2026-01-20 10:00:00' },
    ]);
    await call('PATCH', `/api/connections/${id}`, { fetchKinds: ['scuba'] });
    await fetchOutcome(id);
    expect(downloads(5101)).toBe(0);
    expect(downloads(5102)).toBe(1);

    await call('PATCH', `/api/connections/${id}`, { fetchKinds: ['scuba', 'apnea'] });
    const outcome = await fetchOutcome(id);
    expect(outcome).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'created', remoteId: '5101' }),
      expect.objectContaining({ result: 'unchanged', remoteId: '5102' }),
    ]));
    expect(downloads(5101)).toBe(1);
    expect(downloads(5102)).toBe(1);
  });
});
