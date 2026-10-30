// What leaves Dive Hub of a Dive (ADR 0027, 0057): the values every Provider may take from it, read once.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dive, sampleSeries, user } from '../src/db/schema.js';
import { loadOutgoingDive } from '../src/providers/push/outgoing-dive.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

let year = 3100;

describe.skipIf(!(await databaseReachable()))('the outgoing Dive', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let userId: string;
  let diverId: string;

  const call = (method: 'GET' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: ann, origin: BASE_URL }, ...(payload && { payload }) });
  const upload = async (subSport?: 'apneaDiving') => {
    year++;
    const { payload, headers } = multipartFile('dive.fit', makeSyntheticDive({ serialNumber: 100, start: new Date(Date.UTC(year, 4, 1, 9)), ...(subSport && { subSport }) }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
    await ctx.imports.processImport(created.json().id);
    const done = (await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: { diveId: string }[] };
    return done.outcome[0]!.diveId;
  };
  const patch = async (id: string, changes: object) => {
    const version = ((await call('GET', `/api/dives/${id}`)).json() as { version: number }).version;
    expect((await call('PATCH', `/api/dives/${id}`, { version, ...changes })).statusCode).toBe(200);
  };
  const outgoing = async (id: string) => (await loadOutgoingDive(t.db, userId, id)).outgoing;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'ann@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    diverId = ((await call('GET', '/api/divers')).json() as { id: string }[])[0]!.id;
    [{ id: userId }] = (await t.db.select({ id: user.id }).from(user).where(eq(user.email, 'ann@example.com'))) as [{ id: string }];
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it("carries the Primary recording's dive mode, surface interval and heart rate", async () => {
    const out = await outgoing(await upload());
    expect(out).toMatchObject({ diveMode: 'open_circuit', surfaceIntervalSeconds: 86_400, avgHeartRate: 80 });
    expect(out.samples.heartRate!.values.length).toBeGreaterThan(0);
    expect(new Set(out.samples.heartRate!.values)).toEqual(new Set([80]));
  });

  it("carries the Primary recording's tank pressure and CNS channels", async () => {
    const id = await upload();
    const [row] = await t.db.select({ recordingId: dive.primaryRecordingId }).from(dive).where(eq(dive.id, id));
    await t.db.insert(sampleSeries).values([
      { recordingId: row!.recordingId!, channel: 'tankPressure', offsetsMs: [0, 60_000], values: [200, 190] },
      { recordingId: row!.recordingId!, channel: 'cns', offsetsMs: [0, 60_000], values: [0, 1] },
    ]).onConflictDoNothing();
    const { samples } = await outgoing(id);
    expect(samples.tankPressure).toEqual({ offsetsMs: [0, 60_000], values: [200, 190] });
    expect(samples.cns).toEqual({ offsetsMs: [0, 60_000], values: [0, 1] });
  });

  it('an apnea session is apnea', async () => {
    expect((await outgoing(await upload('apneaDiving'))).diveMode).toBe('apnea');
  });

  it('the tank of a Dive with one Cylinder, none with two', async () => {
    const id = await upload();
    const tank = { volumeL: 12, workingPressureBar: 232, material: 'steel', gas: { o2: 32, he: 0 }, startPressureBar: 200, endPressureBar: 50 };
    await patch(id, { cylinders: [tank] });
    expect((await outgoing(id)).cylinder).toMatchObject(tank);
    await patch(id, { cylinders: [tank, { ...tank, gas: { o2: 50, he: 0 }, startPressureBar: 150, endPressureBar: 100 }] });
    expect((await outgoing(id)).cylinder).toBeNull();
  });

  it('the lead is the total of its entries', async () => {
    const id = await upload();
    expect((await outgoing(id)).leadKg).toBeNull();
    await patch(id, { lead: [{ amountKg: 4 }, { amountKg: 2 }] });
    expect((await outgoing(id)).leadKg).toBe(6);
    await patch(id, { lead: [] });
    expect((await outgoing(id)).leadKg).toBeNull();
  });

  it('a Dive without a Recording has no dive mode, surface interval or heart rate', async () => {
    const [entry] = await t.db.insert(dive).values({
      diverId, startsAt: new Date(Date.UTC(2026, 1, 10, 14)), durationSeconds: 2700, maxDepthM: 20, fromProvider: 'ssi',
    }).returning({ id: dive.id });
    expect(await outgoing(entry!.id)).toMatchObject({ diveMode: null, surfaceIntervalSeconds: null, avgHeartRate: null, samples: {} });
  });
});
