// A Continuation's parts met by imports (ADR 0063): a part uploaded again is updated in place and its joined Recording
// rebuilt in the same transaction, the Dive whose Primary it is following (the Diver's Overrides stay); a Garmin or SSI
// fetch skips the appended Dive's link as deleted earlier, and finds a moved link on the kept Dive.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { push, recording } from '../src/db/schema.js';
import { createGarminAdapter } from '../src/providers/garmin/garmin-adapter.js';
import { createGarminClient } from '../src/providers/garmin/garmin-client.js';
import { createFakeGarmin, type FakeGarmin, type FakeGarminDive } from './fake-garmin.js';
import { handTypedDive } from './fake-ssi.js';
import { ownersDiveParts } from './fixtures/surface-break-dive.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Outcome = { fileName?: string; result: string; reason?: string; diveId?: string; remoteId?: string };
type DiveView = {
  id: string; version: number; overrides: string[];
  values: { durationSeconds: number; maxDepthM: number | null };
  recordings: { id: string; parser: string }[];
};
type Revision = { cause: string };
type Samples = { series: { channel: string; values: number[] }[] };

const ERIKA = 5_012_047;

/** Two halves of one dive of one Device, 24 minutes apart, flat at this depth, so long. */
function halves(serialNumber: number, day: string, secondDepthM = 7.9) {
  const half = (start: string, durationSeconds: number, depth: number) => makeSyntheticDive({
    serialNumber, start: new Date(`${day}T${start}Z`), durationSeconds,
    depthAt: (t) => (t < 60 ? (t / 60) * depth : t > durationSeconds - 60 ? Math.max(0, ((durationSeconds - t) / 60) * depth) : depth),
  });
  return { first: half('06:00:00', 1200, 7), second: half('06:24:00', 900, secondDepthM) };
}

describe.skipIf(!(await databaseReachable()))('imports meeting the parts of a Continuation', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let garmin: FakeGarmin;
  let tim: string;
  let own: string;
  let serial = 7_300_000;

  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => (await call(method, url, payload)).json() as T;
  const upload = async (bytes: Uint8Array): Promise<Outcome> => {
    const { payload, headers } = multipartFile('dive.fit', bytes);
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    return (await json<{ outcome: Outcome[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!;
  };
  const diveOf = (id: string) => json<DiveView>('GET', `/api/dives/${id}`);
  const append = async (keptId: string, laterId: string) => {
    const response = await call('POST', `/api/dives/${keptId}/continuation`, {
      version: (await diveOf(keptId)).version, dives: [{ id: laterId, version: (await diveOf(laterId)).version }],
    });
    expect(response.statusCode).toBe(200);
  };
  const depths = async (view: DiveView) => (await json<Samples>(
    'GET', `/api/recordings/${view.recordings.find((r) => r.parser === 'continuation')!.id}/samples?channels=depth&maxPoints=5000`,
  )).series[0]!.values;
  const revisions = (id: string) => json<Revision[]>('GET', `/api/dives/${id}/revisions`);
  const linksOf = async (diveId: string, provider: string) =>
    (await t.db.select({ remoteId: push.remoteId, provider: push.provider }).from(push).where(eq(push.diveId, diveId)))
      .filter((p) => p.provider === provider).map((p) => p.remoteId);

  /** A fetch of this Garmin account, run as the worker would. */
  const garminFetch = async (connectionId: string) => {
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
    expect(started.json()).toMatchObject({ id: expect.any(String) });
    await ctx.imports.processImport(started.json().id);
    return (await json<{ outcome: Outcome[] }>('GET', `/api/imports/${started.json().id}`)).outcome;
  };
  /** The one Garmin account's activities; a test adds its own. */
  const activities: FakeGarminDive[] = [];
  const garminConnection = async () => {
    garmin.addAccount({ key: 'GCDC_key-1', guid: 'guid-1', displayName: 'Tim', dives: activities });
    const id = (await call('POST', '/api/connections/garmin', { diverId: own, token: 'GCDC_key-1', keepSignedIn: false })).json().id as string;
    await call('PATCH', `/api/connections/${id}`, { diveImport: { mode: 'add' } });
    return id;
  };
  const activity = (activityId: number, fit: Uint8Array): FakeGarminDive =>
    ({ activityId, typeKey: 'single_gas_diving', startTimeLocal: '2026-01-15 11:00:00', fit });
  const downloads = (id: number) => garmin.calls.filter((c) => c === `GET /download-service/files/activity/${id}`).length;

  beforeAll(async () => {
    t = await createTestDatabase();
    garmin = await createFakeGarmin();
    ctx = await createTestApp(t, { extraProviders: [createGarminAdapter({ client: createGarminClient({ url: garmin.url }), pauseMs: 0 })] });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    own = (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers')).find((d) => d.isOwn)!.id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await garmin?.close();
    await t?.drop();
  });

  describe('a part uploaded again', () => {
    const owners = ownersDiveParts();
    const reexported = ownersDiveParts(99);
    let kept: string;
    let before: DiveView;
    let samplesBefore: number[];

    beforeAll(async () => {
      kept = (await upload(owners.first)).diveId!;
      const later = (await upload(owners.second)).diveId!;
      await append(kept, later);
      // The Diver's own duration stays whatever the parts say.
      const view = await diveOf(kept);
      expect(await call('PATCH', `/api/dives/${kept}`, { version: view.version, set: { durationSeconds: 3000 } })).toMatchObject({ statusCode: 200 });
      before = await diveOf(kept);
      samplesBefore = await depths(before);
    });

    it('the same file again changes nothing', async () => {
      expect(await upload(owners.second)).toMatchObject({ result: 'unchanged', diveId: kept });
      expect(await upload(reexported.second)).toMatchObject({ result: 'updated', diveId: kept });
      const after = await diveOf(kept);
      expect(after.values).toEqual(before.values);
      expect(await depths(after)).toEqual(samplesBefore);
    });

    it('the first half uploaded again changes nothing either', async () => {
      expect(await upload(reexported.first)).toMatchObject({ result: 'updated', diveId: kept });
      const after = await diveOf(kept);
      expect(after.values).toEqual(before.values);
      expect(await depths(after)).toEqual(samplesBefore);
    });

    it('with changed samples rebuilds the joined Recording and the Dive, keeping the Diver\'s Overrides', async () => {
      expect(before.values.maxDepthM).toBe(7.9);
      const deeper = makeSyntheticDive({
        serialNumber: 3_400_085, start: new Date('2026-10-26T06:29:30Z'), durationSeconds: 1530,
        depthAt: (t) => (t < 100 ? 1.9 + (t / 100) * 10 : t < 1200 ? 11.9 : Math.max(0, ((1530 - t) / 330) * 11.9)),
      });
      expect(await upload(deeper)).toMatchObject({ result: 'updated', diveId: kept });
      const after = await diveOf(kept);
      expect(after.recordings).toHaveLength(3);
      expect(after.values.maxDepthM).toBeCloseTo(11.9, 1);
      expect(Math.max(...(await depths(after)))).toBeCloseTo(11.9, 1);
      expect(after.overrides).toEqual(['durationSeconds']);
      expect(after.values.durationSeconds).toBe(3000);
      expect((await revisions(kept))[0]).toMatchObject({ cause: 'reimport' });
    });
  });

  describe('a Garmin fetch', () => {
    let connection: string;
    it('skips the appended Dive\'s activity as deleted earlier, and leaves the first unchanged', async () => {
      const { first, second } = halves(serial++, '2026-11-02');
      activities.push(activity(8001, first), activity(8002, second));
      connection = await garminConnection();
      const outcome = await garminFetch(connection);
      expect(outcome.map((o) => o.result)).toEqual(['created', 'created']);
      const a = outcome.find((o) => o.remoteId === '8001')!.diveId!;
      const b = outcome.find((o) => o.remoteId === '8002')!.diveId!;
      expect(a).not.toBe(b);
      await append(a, b);

      const again = await garminFetch(connection);
      expect(again.find((o) => o.remoteId === '8002')).toMatchObject({ result: 'skipped', reason: 'deleted_earlier' });
      expect(again.find((o) => o.remoteId === '8001')).toMatchObject({ result: 'unchanged', diveId: a });
      expect(await linksOf(b, 'garmin')).toEqual(['8002']);
      expect(downloads(8001)).toBe(1);
      expect(downloads(8002)).toBe(1);
    });

    it('finds the second half\'s link on the kept Dive, and downloads nothing', async () => {
      const { first, second } = halves(serial++, '2026-11-03');
      const a = (await upload(first)).diveId!;
      activities.push(activity(8101, second));
      const b = (await garminFetch(connection)).find((o) => o.remoteId === '8101')!.diveId!;
      await append(a, b);
      expect(await linksOf(a, 'garmin')).toEqual(['8101']);

      const again = await garminFetch(connection);
      expect(again.find((o) => o.remoteId === '8101')).toMatchObject({ result: 'unchanged', diveId: a });
      expect(downloads(8101)).toBe(1);
      expect((await t.db.select({ id: recording.id }).from(recording).where(eq(recording.diveId, a))).length).toBe(3);
    });
  });

  describe('an SSI import', () => {
    it('skips the second entry as deleted earlier once appended', async () => {
      const s = serial++;
      const { first, second } = halves(s, '2026-11-04');
      const a = (await upload(first)).diveId!;
      const b = (await upload(second)).diveId!;
      // The files' local time is UTC+2.
      const entryA = ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at: '2026-11-04 08:00', depthM: 7, minutes: 20 }));
      const entryB = ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at: '2026-11-04 08:24', depthM: 8, minutes: 15 }));
      const connectionId = (await call('POST', '/api/connections/ssi', {
        diverId: own, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false,
      })).json().id as string;
      await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'add' } });
      const run = async () => {
        ctx.ssiClock.advance(5 * 60_000);
        const started = await call('POST', `/api/connections/${connectionId}/dive-import`, {
          computers: [], decisions: [
            { remoteId: String(entryA), choice: a }, { remoteId: String(entryB), choice: b },
          ],
        });
        expect(started.json()).toMatchObject({ id: expect.any(String) });
        await ctx.imports.processImport(started.json().id);
        return (await json<{ outcome: Outcome[] }>('GET', `/api/imports/${started.json().id}`)).outcome;
      };
      const linked = await run();
      expect(linked.find((o) => o.remoteId === String(entryA))).toMatchObject({ diveId: a });
      expect(linked.find((o) => o.remoteId === String(entryB))).toMatchObject({ diveId: b });
      await append(a, b);

      const again = await run();
      expect(again.find((o) => o.remoteId === String(entryB))).toMatchObject({ result: 'skipped', reason: 'deleted_earlier' });
      expect(again.find((o) => o.remoteId === String(entryA))).toMatchObject({ diveId: a });
      expect(await linksOf(b, 'ssi')).toEqual([String(entryB)]);
    });
  });
});
