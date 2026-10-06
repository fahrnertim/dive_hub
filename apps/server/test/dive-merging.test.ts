// Merging two Dives and moving a linked Dive (ADR 0038), with hand-made dives. It starts from two observations on the
// owner's logbook (2026-10-07): a logbook entry whose time is corrected at the Provider after its computer's file came
// in stands beside the file's Dive, and two logbook entries of one dive become two Dives. Merging resolves both; links
// are followed at two Providers (SSI's fake and the test-only ledger). Finding such pairs unasked is slice 18c.
import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dive } from '../src/db/schema.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { createFakeSsi, handTypedDive } from './fake-ssi.js';
import { makeSuuntoJson } from './fixtures/suunto-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

const ERIKA = 5_012_047;
const LAKE = 5120;

type Outcome = { result: string; reason?: string; diveId?: string; remoteId?: string };
type DiveView = {
  id: string; diverId: string; version: number; notes: string | null; overrides: string[]; site: { name: string } | null;
  values: { startsAt: { at: string }; maxDepthM: number | null; waterTemperatureC: number | null };
  recordings: { isPrimary: boolean; parser: string }[]; participants: { name: string }[];
};
type Candidate = { id: string; version: number; recordings: number; keeps: string; bothAt: string[]; at: { provider: string }[] };
type Deleted = { id: string; version: number; mergedInto: string | null; movedTo: string | null; stillAt: { provider: string }[] };

describe.skipIf(!(await databaseReachable()))('merging two Dives, and moving a linked one', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let own: string;
  let lena: string;
  let connectionId: string;
  const ledger = createFakeLedger();

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => (await call(method, url, payload)).json() as T;
  /** The D5's JSON of a dive on that day at 09:07:15 local time (UTC+1), 33:45 long, to 34.2 m. */
  const uploadSuunto = async (day: string) => {
    const { payload, headers } = multipartFile('dive.json', makeSuuntoJson({
      start: new Date(`${day}T08:07:15.280Z`), durationSeconds: 2025, maxDepthM: 34.2, serialNumber: '900000000001',
    }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    return (await json<{ outcome: Outcome[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!;
  };
  const runImport = async () => {
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
    expect(started.statusCode).toBe(202);
    await ctx.imports.processImport(started.json().id);
    return (await json<{ outcome: Outcome[] }>('GET', `/api/imports/${started.json().id}`)).outcome;
  };
  const addEntry = (at: string, minutes: number, depthM: number, more: { comment?: string; tempC?: number } = {}) =>
    String(ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at, minutes, depthM, siteId: LAKE, ...more })));
  const divesOn = (day: string) => t.db.select().from(dive).where(and(
    isNull(dive.deletedAt), gte(dive.startsAt, new Date(`${day}T00:00:00Z`)), lt(dive.startsAt, new Date(`${day}T23:59:59Z`)),
  ));
  const diveOf = (id: string) => json<DiveView>('GET', `/api/dives/${id}`);
  const candidatesOf = (id: string) => json<Candidate[]>('GET', `/api/dives/${id}/merge-candidates`);
  const merge = async (id: string, otherId: string, more: object = {}) => call('POST', `/api/dives/${id}/merge`, {
    version: (await diveOf(id)).version, otherId, otherVersion: (await diveOf(otherId)).version, ...more,
  });
  const at = async (id: string, provider: string) =>
    (await json<{ current: { remoteId: string } | null }>('GET', `/api/dives/${id}/providers/${provider}`)).current?.remoteId ?? null;
  const deleted = async (id: string) => (await json<{ dives: Deleted[] }>('GET', '/api/dives/deleted')).dives.find((d) => d.id === id);
  const openCandidates = () => json<unknown[]>('GET', '/api/duplicate-candidates');

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      // The lake gives the entries their time zone (UTC+1 in March), as a Provider's site does.
      fakeSsi: createFakeSsi({
        buddies: [],
        sites: [{ odin_dive_sites_id: LAKE, odin_dive_sites_name: 'Attersee – Schwarzenbach', odin_dive_sites_lat: 47.8512, odin_dive_sites_lon: 13.5514, odin_countries_code_iso: 'AT' }],
      }),
      extraProviders: [ledger.adapter],
    });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    own = (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers')).find((d) => d.isOwn)!.id;
    lena = (await json<{ id: string }>('POST', '/api/divers', { name: 'Lena' })).id;
    connectionId = (await json<{ id: string }>('POST', '/api/connections/ssi', {
      diverId: own, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false,
    })).id;
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'create' } });
    await call('POST', '/api/connections/ledger', { diverId: own, token: 'ledger-token-1', keepSignedIn: false });
    const site = await json<{ id: string }>('POST', '/api/dive-sites', { name: 'Schwarzenbach' });
    await call('PUT', `/api/dive-sites/${site.id}/external-ids/ssi`, { externalId: String(LAKE) });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('an entry typed with the wrong time, corrected at the Provider', () => {
    it('with the right time from the start, the computer\'s file attaches to the entry\'s Dive', async () => {
      const entry = addEntry('2026-03-10 09:14', 33, 34);
      const made = (await runImport()).find((o) => o.remoteId === entry)!;
      expect(made.result).toBe('created');
      expect(await uploadSuunto('2026-03-10')).toMatchObject({ result: 'attached', diveId: made.diveId });
      expect(await divesOn('2026-03-10')).toHaveLength(1);
    });

    let entry: string;
    let fromEntry: string;
    let fromFile: string;

    it('typed as 20:14 instead of 09:14, the file finds no Dive at its time and makes its own', async () => {
      entry = addEntry('2026-03-12 20:14', 33, 34, { comment: 'Wreck at the wall', tempC: 9 });
      fromEntry = (await runImport()).find((o) => o.remoteId === entry)!.diveId!;
      const placed = await uploadSuunto('2026-03-12');
      expect(placed.result).toBe('created');
      fromFile = placed.diveId!;
      expect(fromFile).not.toBe(fromEntry);
      expect(await candidatesOf(fromEntry)).toEqual([]);
    });

    it('corrected at the Provider, the entry\'s Dive takes the new time and stands beside the file\'s, with nothing asked', async () => {
      ctx.fakeSsi.dives.get(Number(entry))!.odin_user_log_datetime = '2026-03-12 09:14';
      expect((await runImport()).find((o) => o.remoteId === entry)).toMatchObject({ result: 'updated', diveId: fromEntry });
      expect((await diveOf(fromEntry)).values.startsAt.at).toBe('2026-03-12T08:14:00.000Z');
      expect((await divesOn('2026-03-12')).map((d) => d.id).sort()).toEqual([fromEntry, fromFile].sort());
      expect(await openCandidates()).toEqual([]);
    });

    it('the two are offered to each other as Dives to merge; the one with the Recording would be kept', async () => {
      expect(await candidatesOf(fromEntry)).toEqual([expect.objectContaining({ id: fromFile, recordings: 1, keeps: fromFile, at: [], bothAt: [] })]);
      expect(await candidatesOf(fromFile)).toEqual([expect.objectContaining({ id: fromEntry, recordings: 0, keeps: fromFile, at: [expect.objectContaining({ provider: 'ssi' })] })]);
    });

    it('merged from the entry\'s side, the file\'s Dive is kept: filled with the site and notes, and linked to the entry', async () => {
      const merged = await merge(fromEntry, fromFile);
      expect(merged.statusCode).toBe(200);
      const kept = merged.json() as DiveView;
      expect(kept).toMatchObject({
        id: fromFile, site: { name: 'Schwarzenbach' }, notes: 'Wreck at the wall', recordings: [{ isPrimary: true, parser: 'suunto-json' }],
      });
      // The Recording's values stay: the computer's start and depth, not the entry's rounded ones.
      expect(kept.values.startsAt.at).toBe('2026-03-12T08:07:15.280Z');
      expect(kept.values.maxDepthM).toBeCloseTo(34.29, 1);
      expect(await at(fromFile, 'ssi')).toBe(entry);
      expect((await divesOn('2026-03-12')).map((d) => d.id)).toEqual([fromFile]);
      const history = await json<{ cause: string; changes: Record<string, { to: unknown }> }[]>('GET', `/api/dives/${fromFile}/revisions`);
      expect(history[0]).toMatchObject({ cause: 'merge', changes: { mergedFrom: { to: fromEntry } } });
    });

    it('the entry\'s Dive is among the deleted ones, says where it went, and is at no Provider any more', async () => {
      expect(await deleted(fromEntry)).toMatchObject({ mergedInto: fromFile, movedTo: null, stillAt: [] });
    });

    it('the next import finds the entry on the kept Dive and makes nothing', async () => {
      expect((await runImport()).find((o) => o.remoteId === entry)).toMatchObject({ result: 'unchanged', diveId: fromFile });
      expect(await divesOn('2026-03-12')).toHaveLength(1);
    });

    it('restored, the merged Dive comes back without what it gave away', async () => {
      const gone = (await deleted(fromEntry))!;
      expect((await call('POST', `/api/dives/${fromEntry}/restore`, { version: gone.version })).statusCode).toBe(200);
      expect(await diveOf(fromEntry)).toMatchObject({ recordings: [] });
      expect(await at(fromEntry, 'ssi')).toBeNull();
      expect((await diveOf(fromFile)).recordings).toHaveLength(1);
    });
  });

  describe('two entries of one dive at the Provider', () => {
    let first: string;
    let second: string;
    let a: string;
    let b: string;

    it('the same site, overlapping for half an hour: the import makes two Dives without a Recording and asks nothing', async () => {
      first = addEntry('2026-03-11 12:13', 44, 13, { comment: 'Pike in the reeds' });
      second = addEntry('2026-03-11 12:28', 42, 12.8, { comment: 'Cold', tempC: 6 });
      const preview = await json<{ counts: Record<string, number>; decisions: unknown[] }>('GET', `/api/connections/${connectionId}/dive-import`);
      expect(preview.counts).toMatchObject({ create: 2, decide: 0, link: 0 });
      const outcome = await runImport();
      a = outcome.find((o) => o.remoteId === first)!.diveId!;
      b = outcome.find((o) => o.remoteId === second)!.diveId!;
      expect(a).not.toBe(b);
      expect(await openCandidates()).toEqual([]);
    });

    it('they are offered to each other; both are at the Provider, so the second entry would stay there', async () => {
      expect(await candidatesOf(a)).toEqual([expect.objectContaining({ id: b, recordings: 0, keeps: a, bothAt: ['ssi'] })]);
    });

    it('merged, the Dive asked about is kept with its own values; what it lacked is filled and the notes are appended', async () => {
      const kept = (await merge(a, b)).json() as DiveView;
      expect(kept).toMatchObject({ id: a, notes: 'Pike in the reeds\n\nCold', overrides: [] });
      expect(kept.values).toMatchObject({ startsAt: { at: '2026-03-11T11:13:00.000Z' }, maxDepthM: 13, waterTemperatureC: 6 });
      expect(await at(a, 'ssi')).toBe(first);
      expect(await divesOn('2026-03-11')).toHaveLength(1);
    });

    it('the other Dive keeps its link, reminds that it is still at the Provider, and its entry is not imported again', async () => {
      expect(await deleted(b)).toMatchObject({ mergedInto: a, stillAt: [expect.objectContaining({ provider: 'ssi' })] });
      expect((await runImport()).find((o) => o.remoteId === second)).toMatchObject({ result: 'skipped', reason: 'deleted_earlier' });
      expect(await divesOn('2026-03-11')).toHaveLength(1);
    });

    it('asked to, the merge deletes the second entry at the Provider first', async () => {
      const one = addEntry('2026-03-14 10:00', 40, 15);
      const two = addEntry('2026-03-14 10:10', 40, 15);
      const outcome = await runImport();
      const [x, y] = [one, two].map((r) => outcome.find((o) => o.remoteId === r)!.diveId!);
      expect((await merge(x!, y!, { alsoAt: ['ssi'] })).json()).toMatchObject({ id: x });
      expect(ctx.fakeSsi.dives.get(Number(two))!.odin_user_log_deleted).toBe(1);
      expect(ctx.fakeSsi.dives.get(Number(one))!.odin_user_log_deleted).toBe(0);
      expect(await deleted(y!)).toMatchObject({ mergedInto: x, stillAt: [] });
    });
  });

  describe('what can\'t be merged', () => {
    it('a Dive with itself, Dives of two Divers, or a Dive that changed meanwhile', async () => {
      const mine = (await uploadSuunto('2026-03-20')).diveId!;
      const hers = (await uploadSuunto('2026-03-21')).diveId!;
      expect((await merge(mine, mine)).json()).toMatchObject({ code: 'merge_not_possible' });
      const moved = await call('POST', `/api/dives/${hers}/move`, { diverId: lena, version: (await diveOf(hers)).version });
      // Not linked to any Provider: it moves as it is.
      expect(moved.json()).toMatchObject({ id: hers, diverId: lena });
      expect(await deleted(hers)).toBeUndefined();
      expect((await merge(mine, hers)).json()).toMatchObject({ code: 'merge_not_possible' });
      const stale = await call('POST', `/api/dives/${mine}/merge`, { version: (await diveOf(mine)).version - 1, otherId: hers, otherVersion: 1 });
      expect(stale.statusCode).toBe(409);
    });
  });

  describe('a Dive at two Providers', () => {
    let entry: string;
    let fromFile: string;
    let fromEntry: string;
    let ledgerId: string;
    let copy: string;

    it('the file\'s Dive was sent to the ledger, the entry\'s Dive is linked to SSI: merged, the kept Dive is at both', async () => {
      fromFile = (await uploadSuunto('2026-03-16')).diveId!;
      expect(await json('POST', `/api/dives/${fromFile}/providers/ledger`, {})).toMatchObject({ outcome: 'created' });
      ledgerId = (await at(fromFile, 'ledger'))!;
      entry = addEntry('2026-03-16 09:10', 33, 34);
      // A Dive already at SSI with another entry isn't this entry's; here the file's Dive has none there, so the import
      // links them by itself. Typed at another hour it makes its own Dive.
      ctx.fakeSsi.dives.get(Number(entry))!.odin_user_log_datetime = '2026-03-16 15:10';
      fromEntry = (await runImport()).find((o) => o.remoteId === entry)!.diveId!;
      expect(fromEntry).not.toBe(fromFile);
      expect((await merge(fromFile, fromEntry)).json()).toMatchObject({ id: fromFile });
      expect([await at(fromFile, 'ledger'), await at(fromFile, 'ssi')]).toEqual([ledgerId, entry]);
    });

    it('moved to another Diver, it is a new Dive there with the Recording and no links', async () => {
      const moved = await call('POST', `/api/dives/${fromFile}/move`, { diverId: lena, version: (await diveOf(fromFile)).version });
      expect(moved.statusCode).toBe(200);
      const there = moved.json() as DiveView;
      copy = there.id;
      expect(copy).not.toBe(fromFile);
      expect(there).toMatchObject({ diverId: lena, recordings: [{ isPrimary: true, parser: 'suunto-json' }] });
      expect([await at(copy, 'ledger'), await at(copy, 'ssi')]).toEqual([null, null]);
      const history = await json<{ cause: string; changes: Record<string, { to: unknown }> }[]>('GET', `/api/dives/${copy}/revisions`);
      expect(history[0]).toMatchObject({ cause: 'move', changes: { movedFrom: { to: fromFile } } });
    });

    it('the old Dive is deleted, says where it went, and keeps its links at both Providers', async () => {
      const gone = (await deleted(fromFile))!;
      expect(gone).toMatchObject({ movedTo: copy, mergedInto: null });
      expect(gone.stillAt.map((s) => s.provider).sort()).toEqual(['ledger', 'ssi']);
    });

    it('so the old Diver\'s import doesn\'t make the Dive again, and the file still finds its Recording', async () => {
      expect((await runImport()).find((o) => o.remoteId === entry)).toMatchObject({ result: 'skipped', reason: 'deleted_earlier' });
      expect(await divesOn('2026-03-16')).toHaveLength(1);
      expect(await uploadSuunto('2026-03-16')).toMatchObject({ result: 'unchanged', diveId: copy });
    });
  });
});
