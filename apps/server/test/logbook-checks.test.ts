// Logbook checks through the API (ADR 0038), against PostgreSQL with hand-made dives: a logbook entry beside its
// computer's file and two overlapping entries are found, the answer "these are two dives" is kept until a time changes,
// and merging resolves a check. The rules themselves are in logbook-check-rules.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeSsi, handTypedDive } from './fake-ssi.js';
import { makeSuuntoJson } from './fixtures/suunto-dive.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

const ERIKA = 5_012_047;
const LAKE = 5120;

type Outcome = { result: string; diveId?: string; remoteId?: string };
type Check = {
  rule: string; obvious: boolean; diverId: string;
  dive: { id: string; version: number; recordings: number };
  other: { id: string; version: number; recordings: number; keeps: string; bothAt: string[] };
};
type DiveCheck = Omit<Check, 'other'> & { other: null };

describe.skipIf(!(await databaseReachable()))('logbook checks', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let bob: string;
  let connectionId: string;
  let fromEntry: string;
  let fromFile: string;
  let first: string;
  let second: string;

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object, cookie = tim) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const checks = async (status = 'open', cookie = tim) => (await call('GET', `/api/logbook-checks?status=${status}`, undefined, cookie)).json() as Check[];
  const pairOf = (c: Check) => [c.dive.id, c.other.id].sort();
  const shortDives = async (status = 'open') => ((await checks(status)) as unknown as DiveCheck[]).filter((c) => c.rule === 'short_shallow_dive');
  const keep = (id: string, value: 'keep' | null, cookie = tim) => call('PUT', '/api/logbook-checks/answer', { diveIds: [id], answer: value }, cookie);
  const versionOf = async (id: string) => ((await call('GET', `/api/dives/${id}`)).json() as { version: number }).version;
  const answer = (a: string, b: string, value: 'two_dives' | null, cookie = tim) => call('PUT', '/api/logbook-checks/answer', { diveIds: [a, b], answer: value }, cookie);
  const runImport = async () => {
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
    await ctx.imports.processImport(started.json().id);
    return ((await call('GET', `/api/imports/${started.json().id}`)).json() as { outcome: Outcome[] }).outcome;
  };
  const addEntry = (at: string, minutes: number, depthM: number) => String(ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at, minutes, depthM, siteId: LAKE })));

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      fakeSsi: createFakeSsi({
        buddies: [],
        sites: [{ odin_dive_sites_id: LAKE, odin_dive_sites_name: 'Attersee – Schwarzenbach', odin_dive_sites_lat: 47.8512, odin_dive_sites_lon: 13.5514, odin_countries_code_iso: 'AT' }],
      }),
    });
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'bob@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    bob = await signIn(ctx.app, 'bob@example.com');
    const own = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    connectionId = (await call('POST', '/api/connections/ssi', { diverId: own, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false })).json().id;
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'create' } });

    // An entry typed at the wrong hour, its computer's file, then the hour corrected at the Provider (09:14, UTC+1).
    const entry = addEntry('2026-03-12 20:14', 33, 34);
    // Two entries of one dive, and two dives one after the other the same afternoon.
    const one = addEntry('2026-03-11 12:13', 44, 13);
    const two = addEntry('2026-03-11 12:28', 42, 12.8);
    addEntry('2026-03-11 15:00', 40, 12);
    addEntry('2026-03-11 16:00', 40, 12);
    const outcome = await runImport();
    fromEntry = outcome.find((o) => o.remoteId === entry)!.diveId!;
    first = outcome.find((o) => o.remoteId === one)!.diveId!;
    second = outcome.find((o) => o.remoteId === two)!.diveId!;
    const { payload, headers } = multipartFile('dive.json', makeSuuntoJson({
      start: new Date('2026-03-12T08:07:15.280Z'), durationSeconds: 2025, maxDepthM: 34.2, serialNumber: '900000000001',
    }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    fromFile = ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: Outcome[] }).outcome[0]!.diveId!;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('finds the two overlapping entries, and nothing between dives one after the other or a day apart', async () => {
    // The entry typed at 20:14 and its file at 09:07 are the same dive hours apart: the pair of the third rule, never obvious.
    const list = (await checks()).filter((c) => c.rule !== 'entry_apart_from_recording');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ rule: 'overlapping_dives', obvious: false, dive: { id: first, recordings: 0 }, other: { id: second, keeps: first, bothAt: ['ssi'] } });
  });

  it('finds the entry beside its file once its time is corrected, as one an import would have put together', async () => {
    const entry = [...ctx.fakeSsi.dives.values()].find((d) => d.odin_user_log_datetime === '2026-03-12 20:14')!;
    entry.odin_user_log_datetime = '2026-03-12 09:14';
    await runImport();
    const found = (await checks()).find((c) => c.rule === 'recording_beside_entry')!;
    expect(pairOf(found)).toEqual([fromEntry, fromFile].sort());
    expect(found).toMatchObject({ obvious: true, other: { keeps: fromFile, bothAt: [] } });
    expect(await checks()).toHaveLength(2);
  });

  it('shows a User only the checks of the logbooks they keep, and lets no one else answer them', async () => {
    expect(await checks('open', bob)).toEqual([]);
    expect((await answer(first, second, 'two_dives', bob)).json()).toMatchObject({ code: 'dive_not_found' });
  });

  it('keeps the answer "these are two dives": the pair is not asked about again, and the dive page stops hinting', async () => {
    expect((await answer(second, first, 'two_dives')).statusCode).toBe(204);
    expect((await checks()).map((c) => c.rule)).toEqual(['recording_beside_entry']);
    expect((await checks('answered')).map(pairOf)).toEqual([[first, second].sort()]);
    const candidates = (await call('GET', `/api/dives/${first}/merge-candidates`)).json() as { id: string; answered: boolean; rule: string }[];
    expect(candidates).toEqual([expect.objectContaining({ id: second, answered: true, rule: 'overlapping_dives' })]);
  });

  it('takes the answer back when asked to', async () => {
    expect((await answer(first, second, null)).statusCode).toBe(204);
    expect(await checks()).toHaveLength(2);
    await answer(first, second, 'two_dives');
    expect(await checks()).toHaveLength(1);
  });

  it('asks again once one of the two changes its time', async () => {
    const d = (await call('GET', `/api/dives/${second}`)).json() as { version: number };
    const moved = await call('PATCH', `/api/dives/${second}`, { version: d.version, set: { startsAt: { at: '2026-03-11T11:30:00.000Z', utcOffsetSeconds: 3600 } } });
    expect(moved.statusCode).toBe(200);
    expect((await checks()).map((c) => c.rule).sort()).toEqual(['overlapping_dives', 'recording_beside_entry']);
    expect(await checks('answered')).toEqual([]);
  });

  it('refuses an answer about two Dives that break no rule together', async () => {
    expect((await answer(first, fromFile, 'two_dives')).json()).toMatchObject({ code: 'check_not_found' });
  });

  it('is resolved by merging: the check is gone, and so is one whose Dive moved out of the way', async () => {
    const found = (await checks()).find((c) => c.rule === 'recording_beside_entry')!;
    const merged = await call('POST', `/api/dives/${found.dive.id}/merge`, { version: found.dive.version, otherId: found.other.id, otherVersion: found.other.version });
    expect(merged.json()).toMatchObject({ id: fromFile });
    expect((await checks()).map((c) => c.rule)).toEqual(['overlapping_dives']);
    const d = (await call('GET', `/api/dives/${second}`)).json() as { version: number };
    await call('PATCH', `/api/dives/${second}`, { version: d.version, set: { startsAt: { at: '2026-03-11T13:00:00.000Z', utcOffsetSeconds: 3600 } } });
    expect(await checks()).toEqual([]);
  });

  it('takes a Recording split off its Dive as the answer: the two Dives at the same time are not asked about', async () => {
    const upload = async (name: string, data: Uint8Array) => {
      const { payload, headers } = multipartFile(name, data);
      const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
      await ctx.imports.processImport(created.json().id);
      return ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: (Outcome & { recordingId?: string })[] }).outcome[0]!;
    };
    const main = await upload('main.fit', makeSyntheticDive({ serialNumber: 881, start: new Date('2026-04-02T08:00:00Z'), maxDepthM: 16.4 }));
    const backup = await upload('backup.fit', makeSyntheticDive({ serialNumber: 882, start: new Date('2026-04-02T08:00:20Z'), maxDepthM: 16.1 }));
    expect(backup).toMatchObject({ result: 'attached', diveId: main.diveId });
    const d = (await call('GET', `/api/dives/${main.diveId}`)).json() as { version: number };
    const split = (await call('POST', `/api/recordings/${backup.recordingId}/detach`, { version: d.version })).json() as { diveId: string };
    expect(await checks()).toEqual([]);
    expect((await checks('answered')).map(pairOf)).toEqual([[main.diveId!, split.diveId].sort()]);
    // Asked again when the User wants to be.
    await answer(main.diveId!, split.diveId, null);
    expect((await checks()).map((c) => [c.rule, c.obvious])).toEqual([['overlapping_dives', false]]);
  });

  it('offers an entry typed hours after its file (same day, depth and duration agree), never as obvious; merging keeps the file and takes the link', async () => {
    // Typed as 11:00 at the lake (UTC+2: 09:00 UTC); the watch says 06:30 UTC. Depth 34 / 34.2 m, 33 / 33.75 minutes.
    const remoteId = addEntry('2026-05-10 11:00', 33, 34);
    const entryDive = (await runImport()).find((o) => o.remoteId === remoteId)!.diveId!;
    const { payload, headers } = multipartFile('dive.json', makeSuuntoJson({
      start: new Date('2026-05-10T06:30:00.000Z'), durationSeconds: 2025, maxDepthM: 34.2, serialNumber: '900000000001',
    }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    const fileDive = ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: Outcome[] }).outcome[0]!.diveId!;
    expect(fileDive).not.toBe(entryDive);

    const found = (await checks()).find((c) => c.rule === 'entry_apart_from_recording')!;
    expect(pairOf(found)).toEqual([entryDive, fileDive].sort());
    expect(found).toMatchObject({ obvious: false, other: { keeps: fileDive } });
    // Asked about the Dive page too.
    const candidates = (await call('GET', `/api/dives/${fileDive}/merge-candidates`)).json() as { id: string; rule: string }[];
    expect(candidates).toEqual([expect.objectContaining({ id: entryDive, rule: 'entry_apart_from_recording' })]);

    const merged = await call('POST', `/api/dives/${found.dive.id}/merge`, { version: found.dive.version, otherId: found.other.id, otherVersion: found.other.version });
    expect(merged.json()).toMatchObject({ id: fileDive });
    const link = (await call('GET', `/api/dives/${fileDive}/providers/ssi`)).json() as { current: { remoteId: string } | null };
    expect(link.current?.remoteId).toBe(remoteId);
    expect((await checks()).filter((c) => c.rule === 'entry_apart_from_recording')).toEqual([]);
  });

  describe('a short and shallow Dive', () => {
    let falseStart: string;

    it('is offered for deleting, about one Dive and never as obvious; the real dive after it is not', async () => {
      // A false start: 50 seconds at 1.8 m, and the real dive five and a half minutes after it.
      for (const [start, durationSeconds, maxDepthM] of [['2026-06-01T08:58:07.000Z', 50, 1.8], ['2026-06-01T09:04:21.000Z', 2141, 14.5]] as const) {
        const { payload, headers } = multipartFile('dive.json', makeSuuntoJson({ start: new Date(start), durationSeconds, maxDepthM, serialNumber: '900000000001' }));
        const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
        await ctx.imports.processImport(created.json().id);
        const made = ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: Outcome[] }).outcome[0]!;
        expect(made.result).toBe('created');
        if (durationSeconds === 50) falseStart = made.diveId!;
      }
      const found = await shortDives();
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ rule: 'short_shallow_dive', obvious: false, dive: { id: falseStart, recordings: 1, durationSeconds: 50, at: [] }, other: null });
      expect(await checks('open', bob)).toEqual([]);
    });

    it('keeps the answer "keep it", lists it to ask again, and takes it back', async () => {
      expect((await keep(falseStart, 'keep', bob)).json()).toMatchObject({ code: 'dive_not_found' });
      expect((await keep(falseStart, 'keep')).statusCode).toBe(204);
      expect(await shortDives()).toEqual([]);
      expect((await shortDives('answered')).map((c) => c.dive.id)).toEqual([falseStart]);
      expect((await keep(falseStart, null)).statusCode).toBe(204);
      expect((await shortDives()).map((c) => c.dive.id)).toEqual([falseStart]);
    });

    it('asks again once the kept Dive changes its duration, and no longer once it is a dive by the rule', async () => {
      await keep(falseStart, 'keep');
      await call('PATCH', `/api/dives/${falseStart}`, { version: await versionOf(falseStart), set: { durationSeconds: 70 } });
      expect((await shortDives()).map((c) => c.dive.id)).toEqual([falseStart]);
      expect(await shortDives('answered')).toEqual([]);
      await call('PATCH', `/api/dives/${falseStart}`, { version: await versionOf(falseStart), set: { durationSeconds: 600 } });
      expect(await shortDives()).toEqual([]);
      expect((await keep(falseStart, 'keep')).json()).toMatchObject({ code: 'check_not_found' });
      await call('PATCH', `/api/dives/${falseStart}`, { version: await versionOf(falseStart), reset: ['durationSeconds'] });
    });

    it('refuses an answer that does not fit the check: "two dives" about one Dive, "keep it" about two', async () => {
      expect((await call('PUT', '/api/logbook-checks/answer', { diveIds: [falseStart], answer: 'two_dives' })).statusCode).toBe(400);
      expect((await call('PUT', '/api/logbook-checks/answer', { diveIds: [first, second], answer: 'keep' })).statusCode).toBe(400);
    });

    it('is resolved by deleting it, and restoring it is the answer "keep it"', async () => {
      // Back at 50 seconds, the answer given for 50 seconds holds again: taken back first.
      await keep(falseStart, null);
      expect((await shortDives()).map((c) => c.dive.id)).toEqual([falseStart]);
      const gone = await ctx.app.inject({ method: 'DELETE', url: `/api/dives/${falseStart}`, headers: { cookie: tim, origin: BASE_URL }, payload: { version: await versionOf(falseStart) } });
      expect(gone.statusCode).toBe(200);
      expect(await shortDives()).toEqual([]);
      const deleted = ((await call('GET', '/api/dives/deleted')).json() as { dives: { id: string; version: number }[] }).dives.find((d) => d.id === falseStart)!;
      expect((await call('POST', `/api/dives/${falseStart}/restore`, { version: deleted.version })).statusCode).toBe(200);
      expect(await shortDives()).toEqual([]);
      expect((await shortDives('answered')).map((c) => c.dive.id)).toEqual([falseStart]);
    });
  });
});
