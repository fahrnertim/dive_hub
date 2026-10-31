// Fetching dives from Garmin (ADR 0062), against the fake Garmin: each new dive's FIT is downloaded, kept as the
// Original and placed like an uploaded file, one Recording per dive whatever came first; a dive fetched before isn't
// downloaded again, one entered by hand is skipped, and a download Garmin refuses fails that dive only.
import { readFileSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dive, original, push, recording } from '../src/db/schema.js';
import { createGarminAdapter } from '../src/providers/garmin/garmin-adapter.js';
import { createGarminClient } from '../src/providers/garmin/garmin-client.js';
import { createFakeGarmin, type FakeGarmin, type FakeGarminDive } from './fake-garmin.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase } from './support.js';

type Outcome = { fileName: string; result: string; reason?: string; diveId?: string; recordingId?: string; remoteId?: string };

const syntheticFit = new Uint8Array(readFileSync(new URL('./fixtures/synthetic-dive.fit', import.meta.url)));

describe.skipIf(!(await databaseReachable()))('fetching dives from Garmin', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let garmin: FakeGarmin;
  /** Activities whose download Garmin answers with 429. */
  const refused = new Set<string>();
  let users = 0;

  beforeAll(async () => {
    t = await createTestDatabase();
    garmin = await createFakeGarmin();
    const flaky: typeof fetch = async (input, init) => {
      const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
      const id = /\/download-service\/files\/activity\/(\d+)$/.exec(path)?.[1];
      return id && refused.has(id) ? new Response('{}', { status: 429 }) : fetch(input, init);
    };
    ctx = await createTestApp(t, { extraProviders: [createGarminAdapter({ client: createGarminClient({ url: garmin.url, fetch: flaky }), pauseMs: 0 })] });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await garmin?.close();
    await t?.drop();
  });

  /** A User with their own Garmin account holding these dives, connected with the import on. */
  async function connected(dives: FakeGarminDive[]) {
    users += 1;
    const key = `GCDC_key-${users}`;
    garmin.addAccount({ key, guid: `guid-${users}`, displayName: `Diver ${users}`, dives });
    const email = `diver${users}@example.com`;
    const user = await createUser(ctx.auth, email);
    const cookie = await signIn(ctx.app, email);
    const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
      ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
    const diverId = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    const connectionId = (await call('POST', '/api/connections/garmin', { diverId, token: key, keepSignedIn: false })).json().id as string;
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'add' } });
    return {
      userId: user.id, diverId, call,
      preview: async () => (await call('GET', `/api/connections/${connectionId}/dive-import`)).json() as { computers: unknown[]; counts: Record<string, number> },
      /** Starts a fetch, runs it as the worker would, and answers its outcome. */
      fetch: async () => {
        const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
        expect(started.statusCode).toBe(202);
        await ctx.imports.processImport(started.json().id);
        const done = (await call('GET', `/api/imports/${started.json().id}`)).json() as { status: string; outcome: Outcome[] };
        expect(done.status).toBe('done');
        return done.outcome;
      },
      upload: async (name: string, data: Uint8Array) => {
        const { payload, headers } = multipartFile(name, data);
        const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
        await ctx.imports.processImport(created.json().id);
        return ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: Outcome[] }).outcome;
      },
      recordings: () => t.db.select({ id: recording.id, originalId: recording.originalId, diveId: recording.diveId }).from(recording)
        .innerJoin(dive, eq(dive.id, recording.diveId)).where(and(eq(dive.diverId, diverId), isNull(recording.deletedAt))),
      dives: () => t.db.select({ id: dive.id }).from(dive).where(and(eq(dive.diverId, diverId), isNull(dive.deletedAt))),
      links: (diveId: string) => t.db.select({ remoteId: push.remoteId, action: push.action }).from(push)
        .where(and(eq(push.diveId, diveId), eq(push.provider, 'garmin'))),
    };
  }

  const downloads = (id: number) => garmin.calls.filter((c) => c === `GET /download-service/files/activity/${id}`).length;
  const garminDive = (activityId: number, fit: Uint8Array, extra: Partial<FakeGarminDive> = {}): FakeGarminDive =>
    ({ activityId, typeKey: 'single_gas_diving', startTimeLocal: '2026-01-15 11:00:00', fit, ...extra });

  it('a fetch makes one Recording per dive from its FIT and keeps the FIT as the Original', async () => {
    const fit = makeSyntheticDive({ serialNumber: 7001 });
    const u = await connected([garminDive(2001, fit)]);
    const preview = await u.preview();
    expect(preview.computers).toEqual([]);
    expect(preview.counts).toMatchObject({ total: 1, recordings: 1, linked: 0 });

    const outcome = await u.fetch();
    expect(outcome).toEqual([expect.objectContaining({ result: 'created', remoteId: '2001', fileName: '2001.fit' })]);
    const recordings = await u.recordings();
    expect(recordings).toHaveLength(1);
    expect(await u.dives()).toHaveLength(1);
    const [stored] = await t.db.select().from(original).where(eq(original.id, recordings[0]!.originalId));
    expect(stored).toMatchObject({ mediaType: 'application/vnd.ant.fit', fileName: '2001.fit', userId: u.userId });
    expect(await u.links(recordings[0]!.diveId!)).toEqual([{ remoteId: '2001', action: 'link' }]);
  });

  it('fetching twice downloads nothing the second time', async () => {
    const u = await connected([garminDive(2101, makeSyntheticDive({ serialNumber: 7101 }))]);
    await u.fetch();
    expect(downloads(2101)).toBe(1);
    expect((await u.preview()).counts).toMatchObject({ recordings: 0, linked: 1 });

    const again = await u.fetch();
    expect(downloads(2101)).toBe(1);
    const [only] = await u.dives();
    expect(again).toEqual([expect.objectContaining({ result: 'unchanged', remoteId: '2101', diveId: only!.id })]);
    expect(await u.recordings()).toHaveLength(1);
    expect(await u.dives()).toHaveLength(1);
  });

  it('a dive uploaded as a file before is not replaced by the fetch', async () => {
    const u = await connected([garminDive(2201, syntheticFit)]);
    const [uploaded] = await u.upload('synthetic-dive.fit', syntheticFit);
    expect(uploaded).toMatchObject({ result: 'created' });
    const before = await u.recordings();

    const outcome = await u.fetch();
    expect(outcome).toEqual([expect.objectContaining({ result: 'skipped', reason: 'already_here', remoteId: '2201', diveId: uploaded!.diveId })]);
    const after = await u.recordings();
    expect(after).toEqual(before);
    const [kept] = await t.db.select().from(original).where(eq(original.id, after[0]!.originalId));
    expect(kept!.fileName).toBe('synthetic-dive.fit');
    expect(await u.dives()).toHaveLength(1);
    expect(await u.links(uploaded!.diveId!)).toEqual([{ remoteId: '2201', action: 'link' }]);
  });

  it('a dive fetched before and uploaded later is one Recording', async () => {
    const fit = makeSyntheticDive({ serialNumber: 7301 });
    const u = await connected([garminDive(2301, fit)]);
    await u.fetch();
    await u.upload('my-dive.fit', fit);
    // A re-export of the same dive (other bytes, the same dive's key) replaces it, as an upload does.
    const reexport = makeSyntheticDive({ serialNumber: 7301, maxDepthM: 19 });
    expect(await u.upload('my-dive-again.fit', reexport)).toEqual([expect.objectContaining({ result: 'updated' })]);
    expect(await u.recordings()).toHaveLength(1);
    expect(await u.dives()).toHaveLength(1);
  });

  it('a manual activity is skipped as entered by hand', async () => {
    const u = await connected([
      garminDive(2401, makeSyntheticDive({ serialNumber: 7401 }), { manual: true }),
      garminDive(2402, makeSyntheticDive({ serialNumber: 7402, start: new Date('2026-01-16T09:00:00Z') }), { startTimeLocal: '2026-01-16 11:00:00' }),
    ]);
    expect((await u.preview()).counts).toMatchObject({ total: 2, enteredByHand: 1, recordings: 1 });

    const outcome = await u.fetch();
    expect(outcome).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'skipped', reason: 'entered_by_hand', remoteId: '2401' }),
      expect.objectContaining({ result: 'created', remoteId: '2402' }),
    ]));
    expect(downloads(2401)).toBe(0);
    expect(await u.recordings()).toHaveLength(1);
    expect(await u.dives()).toHaveLength(1);
  });

  it('a download answering 429 fails that dive only; the next fetch takes it', async () => {
    const u = await connected([
      garminDive(2501, makeSyntheticDive({ serialNumber: 7501 })),
      garminDive(2502, makeSyntheticDive({ serialNumber: 7501, start: new Date('2026-01-16T09:00:00Z') }), { startTimeLocal: '2026-01-16 11:00:00' }),
    ]);
    refused.add('2501');
    const first = await u.fetch();
    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2501' }),
      expect.objectContaining({ result: 'created', remoteId: '2502' }),
    ]));
    expect(await u.recordings()).toHaveLength(1);

    refused.delete('2501');
    const next = await u.fetch();
    expect(next).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'created', remoteId: '2501' }),
      expect.objectContaining({ result: 'unchanged', remoteId: '2502' }),
    ]));
    expect(downloads(2502)).toBe(1);
    expect(await u.recordings()).toHaveLength(2);
    expect(await u.dives()).toHaveLength(2);
  });
});
