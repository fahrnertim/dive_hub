// Fetching dives from Garmin (ADR 0062), against the fake Garmin: each new dive's FIT is downloaded, kept as the
// Original and placed like an uploaded file, one Recording per dive whatever came first; a dive fetched before isn't
// downloaded again (nor one on a Dive deleted here), one entered by hand is skipped, a download that holds no FIT ends
// that dive only, and any other failed download (a 429, a 404, an unreadable answer) ends the downloads of this fetch
// for the next one to take; a download that ends for good (no FIT, no dive, another Diver's, a second copy on a linked
// Dive) isn't tried again, however many fetches come between; a key revoked during the
// downloads ends the fetch with what was placed; the worker downloads, not the request that starts the fetch.
import { readFileSync } from 'node:fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connection, dive, original, push, recording } from '../src/db/schema.js';
import { createGarminAdapter } from '../src/providers/garmin/garmin-adapter.js';
import { createGarminClient } from '../src/providers/garmin/garmin-client.js';
import { createFakeGarmin, type FakeGarmin, type FakeGarminDive } from './fake-garmin.js';
import { makeSyntheticDive, makeSyntheticRun } from './fixtures/synthetic-dive.js';
import { zipOf } from './zip.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase } from './support.js';

type Outcome = { fileName: string; result: string; reason?: string; diveId?: string; recordingId?: string; remoteId?: string };

const syntheticFit = new Uint8Array(readFileSync(new URL('./fixtures/synthetic-dive.fit', import.meta.url)));

describe.skipIf(!(await databaseReachable()))('fetching dives from Garmin', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let garmin: FakeGarmin;
  /** Activities whose download Garmin answers with this status, or with a zip that holds no FIT. */
  const refused = new Map<string, number | 'no_fit'>();
  /** Activities whose download finds this key revoked at Garmin. */
  const revokedAt = new Map<string, string>();
  /** Activities whose download finds the token refused, after which Garmin answers the next token trade unreadably. */
  const unreadableTokenAt = new Set<string>();
  let tokenUnreadable = false;
  /** Every download asked for, the refused ones too. */
  const tried: string[] = [];
  let users = 0;

  beforeAll(async () => {
    t = await createTestDatabase();
    garmin = await createFakeGarmin();
    const flaky: typeof fetch = async (input, init) => {
      const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
      const id = /\/download-service\/files\/activity\/(\d+)$/.exec(path)?.[1];
      if (id) tried.push(id);
      if (path.endsWith('/personal-api-key/token') && tokenUnreadable) {
        tokenUnreadable = false;
        return new Response('not a token', { status: 200 });
      }
      if (id && unreadableTokenAt.has(id)) {
        tokenUnreadable = true;
        return new Response('{}', { status: 401 });
      }
      const revoke = id ? revokedAt.get(id) : undefined;
      if (revoke) garmin.revoke(revoke);
      const answer = id ? refused.get(id) : undefined;
      if (answer === 'no_fit') return new Response(await zipOf({ 'readme.txt': Buffer.from('no dive here') }), { status: 200 });
      return answer ? new Response('{}', { status: answer }) : fetch(input, init);
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
      userId: user.id, diverId, connectionId, key, call,
      preview: async () => (await call('GET', `/api/connections/${connectionId}/dive-import`)).json() as { computers: unknown[]; counts: Record<string, number> },
      /** Starts a fetch, runs it as the worker would, and answers its outcome; `between`: what happens before the worker runs. */
      fetch: async (between?: (importId: string) => Promise<void>) => {
        const before = allDownloads();
        const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
        expect(started.statusCode).toBe(202);
        // Starting only assesses and queues: the worker downloads.
        expect(allDownloads()).toBe(before);
        await between?.(started.json().id);
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
      deleteDive: async (id: string) => {
        const { version } = (await call('GET', `/api/dives/${id}`)).json() as { version: number };
        expect((await ctx.app.inject({ method: 'DELETE', url: `/api/dives/${id}`, headers: { cookie, origin: BASE_URL }, payload: { version } })).statusCode).toBeLessThan(300);
      },
      dives: () => t.db.select({ id: dive.id }).from(dive).where(and(eq(dive.diverId, diverId), isNull(dive.deletedAt))),
      links: (diveId: string) => t.db.select({ remoteId: push.remoteId, action: push.action }).from(push)
        .where(and(eq(push.diveId, diveId), eq(push.provider, 'garmin'))),
    };
  }

  const allDownloads = () => garmin.calls.filter((c) => c.startsWith('GET /download-service/')).length;
  const downloads = (id: number) => garmin.calls.filter((c) => c === `GET /download-service/files/activity/${id}`).length;
  const attempts = (id: number) => tried.filter((t) => t === String(id)).length;
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

  it('a download answering 429 ends the downloads of this fetch; the next fetch takes them', async () => {
    const u = await connected([
      garminDive(2501, makeSyntheticDive({ serialNumber: 7501 })),
      garminDive(2502, makeSyntheticDive({ serialNumber: 7501, start: new Date('2026-01-16T09:00:00Z') }), { startTimeLocal: '2026-01-16 11:00:00' }),
    ]);
    refused.set('2501', 429);
    const first = await u.fetch();
    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2501' }),
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2502' }),
    ]));
    // Nothing asked of Garmin after the refused download.
    expect(attempts(2501)).toBe(1);
    expect(attempts(2502)).toBe(0);
    expect(await u.recordings()).toHaveLength(0);

    refused.delete('2501');
    const next = await u.fetch();
    expect(next).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'created', remoteId: '2501' }),
      expect.objectContaining({ result: 'created', remoteId: '2502' }),
    ]));
    expect(attempts(2501)).toBe(2);
    expect(attempts(2502)).toBe(1);
    expect(await u.recordings()).toHaveLength(2);
    expect(await u.dives()).toHaveLength(2);
  });

  it('a download answering 503 fails that dive only, the dives before it stay; the next fetch takes it', async () => {
    const u = await connected([
      garminDive(2601, makeSyntheticDive({ serialNumber: 7601 })),
      garminDive(2602, makeSyntheticDive({ serialNumber: 7601, start: new Date('2026-01-16T09:00:00Z') }), { startTimeLocal: '2026-01-16 11:00:00' }),
    ]);
    refused.set('2602', 503);
    expect(await u.fetch()).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'created', remoteId: '2601' }),
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2602' }),
    ]));
    expect(await u.recordings()).toHaveLength(1);

    refused.delete('2602');
    expect(await u.fetch()).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'unchanged', remoteId: '2601' }),
      expect.objectContaining({ result: 'created', remoteId: '2602' }),
    ]));
    expect(downloads(2601)).toBe(1);
    expect(await u.recordings()).toHaveLength(2);
  });

  it('a download whose zip holds no FIT is skipped with a reason, the other dive is placed', async () => {
    const u = await connected([
      garminDive(2701, makeSyntheticDive({ serialNumber: 7701 })),
      garminDive(2702, makeSyntheticDive({ serialNumber: 7701, start: new Date('2026-01-16T09:00:00Z') }), { startTimeLocal: '2026-01-16 11:00:00' }),
    ]);
    refused.set('2701', 'no_fit');
    expect(await u.fetch()).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'skipped', reason: 'no_dive_file', remoteId: '2701' }),
      expect.objectContaining({ result: 'created', remoteId: '2702' }),
    ]));
    expect(await u.recordings()).toHaveLength(1);
    expect(await u.dives()).toHaveLength(1);

    // It holds no FIT for good: the next fetch doesn't ask for it again.
    expect(await u.fetch()).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'skipped', reason: 'no_dive_file', remoteId: '2701' }),
      expect.objectContaining({ result: 'unchanged', remoteId: '2702' }),
    ]));
    refused.delete('2701');
    expect(attempts(2701)).toBe(1);
  });

  it('a FIT that holds no dive is not downloaded again', async () => {
    const u = await connected([garminDive(2751, makeSyntheticRun())]);
    expect(await u.fetch()).toEqual([expect.objectContaining({ result: 'skipped', reason: 'not_a_dive', remoteId: '2751' })]);
    expect(await u.fetch()).toEqual([expect.objectContaining({ result: 'skipped', reason: 'not_a_dive', remoteId: '2751' })]);
    expect(downloads(2751)).toBe(1);
  });

  it("a dive another User's file brought is not downloaded again", async () => {
    const fit = makeSyntheticDive({ serialNumber: 7761 });
    const other = await connected([]);
    expect(await other.upload('theirs.fit', fit)).toEqual([expect.objectContaining({ result: 'created' })]);
    const u = await connected([garminDive(2761, fit)]);
    expect(await u.fetch()).toEqual([expect.objectContaining({ result: 'skipped', reason: 'not_your_diver', remoteId: '2761' })]);
    expect(await u.fetch()).toEqual([expect.objectContaining({ result: 'skipped', reason: 'not_your_diver', remoteId: '2761' })]);
    expect(downloads(2761)).toBe(1);
    expect(await u.dives()).toHaveLength(0);
  });

  it('a second Garmin copy placed on a Dive linked to the first is not downloaded again', async () => {
    // Two computers on one dive, both at Garmin: the second Recording joins the Dive, which keeps the first link.
    const u = await connected([
      garminDive(2771, makeSyntheticDive({ serialNumber: 7771 })),
      garminDive(2772, makeSyntheticDive({ serialNumber: 7772 })),
    ]);
    const first = await u.fetch();
    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'created', remoteId: '2771' }),
      expect.objectContaining({ result: 'attached', remoteId: '2772' }),
    ]));
    const [only] = await u.dives();
    expect(await u.links(only!.id)).toEqual([{ remoteId: '2771', action: 'link' }]);

    expect(await u.fetch()).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'unchanged', remoteId: '2771', diveId: only!.id }),
      expect.objectContaining({ result: 'unchanged', remoteId: '2772', diveId: only!.id }),
    ]));
    expect(downloads(2771)).toBe(1);
    expect(downloads(2772)).toBe(1);
    expect(await u.recordings()).toHaveLength(2);
  });

  it('a key revoked during the downloads ends the fetch with what was placed, and nothing is downloaded again', async () => {
    const u = await connected([
      garminDive(2781, makeSyntheticDive({ serialNumber: 7781 })),
      garminDive(2782, makeSyntheticDive({ serialNumber: 7781, start: new Date('2026-01-16T09:00:00Z') }), { startTimeLocal: '2026-01-16 11:00:00' }),
      garminDive(2783, makeSyntheticDive({ serialNumber: 7781, start: new Date('2026-01-17T09:00:00Z') }), { startTimeLocal: '2026-01-17 11:00:00' }),
    ]);
    revokedAt.set('2782', u.key);
    let importId = '';
    const outcome = await u.fetch(async (id) => {
      importId = id;
      // The worker runs it once: a failure isn't retried, which would download the dives again.
      const job = await t.db.execute(sql`select max_attempts from graphile_worker.jobs where queue_name = ${`dive-import:${u.connectionId}`}`);
      expect(job.rows).toEqual([{ max_attempts: 1 }]);
    });
    revokedAt.delete('2782');
    expect(outcome).toEqual([
      expect.objectContaining({ result: 'created', remoteId: '2781' }),
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2782' }),
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2783' }),
    ]);
    const [row] = await t.db.select({ state: connection.state }).from(connection).where(eq(connection.id, u.connectionId));
    expect(row!.state).toBe('needs_sign_in');
    expect(await u.recordings()).toHaveLength(1);

    expect(await ctx.imports.processImport(importId)).toEqual([]);
    expect(attempts(2781)).toBe(1);
    expect(attempts(2782)).toBe(1);
    expect(attempts(2783)).toBe(0);
  });

  it('a download answering 404 ends the downloads of this fetch and is not remembered; the next fetch takes them', async () => {
    const u = await connected([
      garminDive(2901, makeSyntheticDive({ serialNumber: 7901 })),
      garminDive(2902, makeSyntheticDive({ serialNumber: 7901, start: new Date('2026-01-16T09:00:00Z') }), { startTimeLocal: '2026-01-16 11:00:00' }),
    ]);
    refused.set('2901', 404);
    expect(await u.fetch()).toEqual([
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2901' }),
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2902' }),
    ]);
    expect(attempts(2902)).toBe(0);

    refused.delete('2901');
    expect(await u.fetch()).toEqual([
      expect.objectContaining({ result: 'created', remoteId: '2901' }),
      expect.objectContaining({ result: 'created', remoteId: '2902' }),
    ]);
    expect(await u.recordings()).toHaveLength(2);
  });

  it('an unreadable token answer during the downloads ends them and is not remembered; the next fetch takes them', async () => {
    const u = await connected([
      garminDive(2911, makeSyntheticDive({ serialNumber: 7911 })),
      garminDive(2912, makeSyntheticDive({ serialNumber: 7911, start: new Date('2026-01-16T09:00:00Z') }), { startTimeLocal: '2026-01-16 11:00:00' }),
    ]);
    // Garmin refuses the kept token at the first download, and the token traded again can't be read.
    unreadableTokenAt.add('2911');
    expect(await u.fetch()).toEqual([
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2911' }),
      expect.objectContaining({ result: 'failed', reason: 'unavailable', remoteId: '2912' }),
    ]);
    expect(attempts(2912)).toBe(0);

    unreadableTokenAt.delete('2911');
    expect(await u.fetch()).toEqual([
      expect.objectContaining({ result: 'created', remoteId: '2911' }),
      expect.objectContaining({ result: 'created', remoteId: '2912' }),
    ]);
    expect(await u.recordings()).toHaveLength(2);
  });

  it('a download that ended for good is still not asked for after several fetches that downloaded nothing', async () => {
    const u = await connected([garminDive(2921, makeSyntheticDive({ serialNumber: 7921 }))]);
    refused.set('2921', 'no_fit');
    for (let i = 0; i < 4; i += 1) {
      expect(await u.fetch()).toEqual([expect.objectContaining({ result: 'skipped', reason: 'no_dive_file', remoteId: '2921' })]);
    }
    refused.delete('2921');
    expect(attempts(2921)).toBe(1);
  });

  it('a dive on a Dive deleted here is not downloaded again', async () => {
    const fit = makeSyntheticDive({ serialNumber: 7801 });
    const u = await connected([garminDive(2801, fit)]);
    const [uploaded] = await u.upload('deleted-later.fit', fit);
    await u.deleteDive(uploaded!.diveId!);

    expect(await u.fetch()).toEqual([expect.objectContaining({ result: 'skipped', reason: 'deleted_earlier', remoteId: '2801' })]);
    expect(downloads(2801)).toBe(1);
    expect((await u.preview()).counts).toMatchObject({ deleted: 1, recordings: 0 });
    expect(await u.fetch()).toEqual([expect.objectContaining({ result: 'skipped', reason: 'deleted_earlier', remoteId: '2801' })]);
    expect(downloads(2801)).toBe(1);
    expect(await u.dives()).toHaveLength(0);
  });
});
