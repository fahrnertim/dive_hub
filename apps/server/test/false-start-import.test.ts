// A probable non-dive in matching (ADR 0030, amended; ADR 0038), through the API against PostgreSQL: a false start (a
// Recording under 2 minutes above 3 m) neither holds up the real Recording nor takes a Provider's entry or a Dive by
// itself; the import asks instead. The pure rules are in matching.test.ts and logbook-check-rules.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeSsi, handTypedDive } from './fake-ssi.js';
import { makeSuuntoJson } from './fixtures/suunto-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

const ERIKA = 5_012_047;
const LAKE = 5120;

type Outcome = { result: string; reason?: string; diveId?: string; recordingId?: string; remoteId?: string };
type Preview = {
  counts: { link: number; decide: number; create: number };
  decisions: { remoteId: string; candidates: { diveId: string; probablyNoDive: boolean }[] }[];
};
type Check = { rule: string; obvious: boolean; dive: { id: string }; other: { id: string } | null };
type Candidate = { id: string; reason: string; dives: { id: string }[] };

describe.skipIf(!(await databaseReachable()))('a false start in matching', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let connectionId: string;

  const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const checks = async (status = 'open') => (await call('GET', `/api/logbook-checks?status=${status}`)).json() as Check[];
  const preview = async () => {
    ctx.ssiClock.advance(5 * 60_000);
    return (await call('GET', `/api/connections/${connectionId}/dive-import`)).json() as Preview;
  };
  const runImport = async (decisions: { remoteId: string; choice: string }[] = []) => {
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions });
    await ctx.imports.processImport(started.json().id);
    return ((await call('GET', `/api/imports/${started.json().id}`)).json() as { outcome: Outcome[] }).outcome;
  };
  const addEntry = (at: string, minutes: number, depthM: number) => String(ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at, minutes, depthM, siteId: LAKE })));
  const upload = async (start: string, durationSeconds: number, maxDepthM: number) => {
    const { payload, headers } = multipartFile('dive.json', makeSuuntoJson({ start: new Date(start), durationSeconds, maxDepthM, serialNumber: '900000000001', utcOffsetMinutes: 120 }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    return ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: Outcome[] }).outcome[0]!;
  };
  /** 50 seconds at 1.8 m, as in the owner's logbook. */
  const falseStart = (start: string) => upload(start, 50, 1.8);
  const linkOf = async (diveId: string) => ((await call('GET', `/api/dives/${diveId}/providers/ssi`)).json() as { current: { remoteId: string } | null }).current?.remoteId ?? null;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      fakeSsi: createFakeSsi({
        buddies: [],
        sites: [{ odin_dive_sites_id: LAKE, odin_dive_sites_name: 'Attersee – Schwarzenbach', odin_dive_sites_lat: 47.8512, odin_dive_sites_lon: 13.5514, odin_countries_code_iso: 'AT' }],
      }),
    });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    const own = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    connectionId = (await call('POST', '/api/connections/ssi', { diverId: own, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false })).json().id;
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'create' } });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('beside the real dive', () => {
    let first: Outcome;
    let real: Outcome;

    it('does not hold up the real Recording three minutes after it: that becomes a Dive of its own', async () => {
      first = await falseStart('2026-07-01T08:00:00.000Z');
      expect(first.result).toBe('created');
      real = await upload('2026-07-01T08:03:50.000Z', 2141, 14.5);
      expect(real).toMatchObject({ result: 'created' });
      expect(real.diveId).not.toBe(first.diveId);
      expect((await call('GET', '/api/duplicate-candidates')).json()).toEqual([]);
    });

    it('does not take the Provider\'s entry of the real dive: that links to the real Dive, with no question', async () => {
      // Logged as 10:05 at the lake (UTC+2), within the window of both Dives.
      const remoteId = addEntry('2026-07-01 10:05', 36, 14.5);
      expect(await preview()).toMatchObject({ counts: { link: 1, decide: 0 }, decisions: [] });
      expect((await runImport()).find((o) => o.remoteId === remoteId)).toMatchObject({ result: 'linked', diveId: real.diveId });
      expect(await linkOf(first.diveId!)).toBeNull();
    });
  });

  describe('as the only Dive in an entry\'s window', () => {
    let alone: Outcome;
    let remoteId: string;

    it('is asked about in the preview, marked as probably no dive, and nothing links without a decision', async () => {
      alone = await falseStart('2026-07-02T08:00:00.000Z');
      remoteId = addEntry('2026-07-02 10:04', 40, 12);
      const p = await preview();
      expect(p.counts).toMatchObject({ link: 0, decide: 1 });
      expect(p.decisions).toEqual([expect.objectContaining({ remoteId, candidates: [expect.objectContaining({ diveId: alone.diveId, probablyNoDive: true })] })]);
      expect((await runImport()).find((o) => o.remoteId === remoteId)).toMatchObject({ result: 'skipped', reason: 'ambiguous' });
      expect(await linkOf(alone.diveId!)).toBeNull();
    });

    it('lets the User make a new Dive of the entry; the two then wait as a check that is never obvious', async () => {
      const made = (await runImport([{ remoteId, choice: 'new' }])).find((o) => o.remoteId === remoteId)!;
      expect(made.result).toBe('created');
      expect(made.diveId).not.toBe(alone.diveId);
      const pair = (await checks()).find((c) => c.other && [c.dive.id, c.other.id].includes(made.diveId!));
      expect(pair).toMatchObject({ rule: 'recording_beside_entry', obvious: false });
    });

    it('lets the User link it all the same, and such a Dive at a Provider is not offered for deleting', async () => {
      const linked = await falseStart('2026-07-03T08:00:00.000Z');
      const entry = addEntry('2026-07-03 10:01', 1, 2);
      const short = async () => (await checks()).filter((c) => c.rule === 'short_shallow_dive').map((c) => c.dive.id);
      expect(await short()).toContain(linked.diveId);
      expect((await runImport([{ remoteId: entry, choice: linked.diveId! }])).find((o) => o.remoteId === entry)).toMatchObject({ result: 'linked', diveId: linked.diveId });
      expect(await linkOf(linked.diveId!)).toBe(entry);
      expect(await short()).not.toContain(linked.diveId);
      expect(await short()).toContain(alone.diveId);
    });
  });

  describe('as a Recording beside a Dive', () => {
    it('never attaches by itself to an entry\'s Dive: it waits as a Duplicate candidate, and made a Dive of its own the two are answered as two dives', async () => {
      const remoteId = addEntry('2026-07-04 10:02', 40, 12);
      const entryDive = (await runImport()).find((o) => o.remoteId === remoteId)!.diveId!;
      const waiting = await falseStart('2026-07-04T08:00:00.000Z');
      expect(waiting).toMatchObject({ result: 'duplicate-candidate', reason: 'probably_no_dive' });
      const [candidate] = (await call('GET', '/api/duplicate-candidates')).json() as Candidate[];
      expect(candidate).toMatchObject({ reason: 'probably_no_dive', dives: [{ id: entryDive }] });

      const { diveId } = (await call('POST', `/api/duplicate-candidates/${candidate!.id}/new-dive`)).json() as { diveId: string };
      const pairs = async (status: string) => (await checks(status)).filter((c) => c.other).map((c) => [c.dive.id, c.other!.id].sort());
      expect(await pairs('open')).not.toContainEqual([entryDive, diveId].sort());
      expect(await pairs('answered')).toContainEqual([entryDive, diveId].sort());
    });
  });
});
