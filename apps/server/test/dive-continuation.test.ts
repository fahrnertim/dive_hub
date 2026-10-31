// Appending a later Dive to the earlier one by hand (ADR 0063): one Dive with a joined Recording of the two, the later
// Dive deleted as in a merge. The owner's dive 85/86 (two FITs of one Device, 241 s at the surface between them) and
// synthetic dives of one Device; links at a Provider are followed at the test-only ledger.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dive as diveTable, recording, user } from '../src/db/schema.js';
import { loadOutgoingDive } from '../src/providers/push/outgoing-dive.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { ownersDiveParts } from './fixtures/surface-break-dive.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Outcome = { result: string; diveId?: string; recordingId?: string };
type RecordingView = {
  id: string; isPrimary: boolean; parser: string; partOf: string | null; durationSeconds: number;
  summary: { surfaceBreaks?: { startS: number; endS: number }[] };
};
type DiveView = {
  id: string; version: number; notes: string | null; site: { name: string } | null; participants: { diverId: string }[];
  values: { number: number | null; durationSeconds: number; maxDepthM: number | null };
  recordings: RecordingView[];
};
type Revision = { cause: string; changes: Record<string, { from: unknown; to: unknown }> };
type Deleted = { id: string; version: number; continuedInto: string | null; mergedInto: string | null; stillAt: { provider: string }[] };
type Candidate = { id: string; version: number; breakSeconds: number; bothAt: string[]; deletesItself: string[] } | null;

describe.skipIf(!(await databaseReachable()))('appending a later Dive to the earlier one', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let own: string;
  let lena: string;
  const ledger = createFakeLedger();
  let serial = 7_100_000;

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => (await call(method, url, payload)).json() as T;
  const upload = async (bytes: Uint8Array): Promise<Outcome> => {
    const { payload, headers } = multipartFile('dive.fit', bytes);
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    return (await json<{ outcome: Outcome[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!;
  };
  /** A synthetic dive of that Device at that UTC time, so long: its Dive's id. */
  const dive = async (serialNumber: number, start: string, durationSeconds: number) => {
    const placed = await upload(makeSyntheticDive({ serialNumber, start: new Date(start), durationSeconds }));
    expect(placed.result).toBe('created');
    return placed.diveId!;
  };
  /** Two dives of one Device on that day, 09:00 for 20 minutes and 09:25 for 15 (or the second of another Device). */
  const pair = async (day: string, otherDevice = false) => {
    const s = serial++;
    return {
      a: await dive(s, `${day}T09:00:00Z`, 1200),
      b: await dive(otherDevice ? serial++ : s, `${day}T09:25:00Z`, 900),
    };
  };
  const diveOf = (id: string) => json<DiveView>('GET', `/api/dives/${id}`);
  const append = async (keptId: string, laterIds: string[], more: object = {}) => call('POST', `/api/dives/${keptId}/continuation`, {
    version: (await diveOf(keptId)).version,
    dives: await Promise.all(laterIds.map(async (id) => ({ id, version: (await diveOf(id)).version }))),
    ...more,
  });
  const deleted = async (id: string) => (await json<Deleted[]>('GET', '/api/dives/deleted')).find((d) => d.id === id);
  const at = async (id: string) =>
    (await json<{ current: { remoteId: string } | null }>('GET', `/api/dives/${id}/providers/ledger`)).current?.remoteId ?? null;
  const send = async (id: string) => {
    expect(await json('POST', `/api/dives/${id}/providers/ledger`, {})).toMatchObject({ outcome: 'created' });
    return (await at(id))!;
  };
  const joinedOf = (view: DiveView) => view.recordings.find((r) => r.parser === 'continuation')!;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { extraProviders: [ledger.adapter] });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    own = (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers')).find((d) => d.isOwn)!.id;
    lena = (await json<{ id: string }>('POST', '/api/divers', { name: 'Lena' })).id;
    await call('POST', '/api/connections/ledger', { diverId: own, token: 'ledger-token-1', keepSignedIn: false });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe("the owner's dive 85/86", () => {
    let first: string;
    let second: string;
    let after: string;
    let afterNumber: number;

    beforeAll(async () => {
      const { first: one, second: two } = ownersDiveParts();
      first = (await upload(one)).diveId!;
      second = (await upload(two)).diveId!;
      after = await dive(serial++, '2026-10-26T12:00:00Z', 1800);
      expect(new Set([first, second, after]).size).toBe(3);
      afterNumber = (await diveOf(after)).values.number!;
    });

    it("the dive page's candidate", async () => {
      expect(await json<Candidate>('GET', `/api/dives/${second}/continuation-candidate`)).toMatchObject({
        id: first, breakSeconds: 241, bothAt: [], deletesItself: [],
      });
      expect(await json<Candidate>('GET', `/api/dives/${first}/continuation-candidate`)).toBeNull();
    });

    it('appends dive 86 to dive 85: one Dive, the joined Recording Primary, both parts kept', async () => {
      const appended = await append(first, [second]);
      expect(appended.statusCode).toBe(200);
      const kept = appended.json() as DiveView;
      expect(kept.id).toBe(first);
      expect(kept.values).toMatchObject({ durationSeconds: 2951, maxDepthM: 7.9 });
      expect(kept.recordings).toHaveLength(3);
      const joined = joinedOf(kept);
      expect(joined).toMatchObject({ isPrimary: true, partOf: null, summary: { surfaceBreaks: [{ startS: 1180, endS: 1421 }] } });
      const parts = kept.recordings.filter((r) => r.id !== joined.id);
      expect(parts).toHaveLength(2);
      expect(parts.every((p) => p.partOf === joined.id && !p.isPrimary && p.parser !== 'continuation')).toBe(true);
      const samples = await json<{ series: { channel: string; values: number[] }[] }>(
        'GET', `/api/recordings/${joined.id}/samples?channels=depth&maxPoints=5000`,
      );
      expect(samples.series[0]!.values).toHaveLength(1476);
    });

    it('deletes the later Dive the normal way, naming the Dive it continues', async () => {
      expect(await deleted(second)).toMatchObject({ continuedInto: first, mergedInto: null });
      const history = await json<Revision[]>('GET', `/api/dives/${first}/revisions`);
      expect(history[0]).toMatchObject({ cause: 'continuation', changes: { appendedFrom: { from: null, to: [second] } } });
      expect(history.findIndex((r) => r.changes.recordings !== undefined)).toBeGreaterThan(0);
      expect((await diveOf(after)).values.number).toBe(afterNumber - 1);
    });
  });

  it('fills the kept Dive from the later one and appends its notes, as a merge', async () => {
    const { a, b } = await pair('2026-11-13');
    const site = await json<{ id: string }>('POST', '/api/dive-sites', { name: 'Hausriff' });
    await call('PATCH', `/api/dives/${a}`, { version: (await diveOf(a)).version, notes: 'Wall' });
    await call('PATCH', `/api/dives/${b}`, { version: (await diveOf(b)).version, notes: 'Pike', siteId: site.id });
    await call('PUT', `/api/dives/${b}/participants`, { version: (await diveOf(b)).version, participants: [{ diverId: lena, role: 'buddy' }] });
    const kept = (await append(a, [b])).json() as DiveView;
    expect(kept).toMatchObject({ id: a, notes: 'Wall\n\nPike', site: { name: 'Hausriff' }, participants: [{ diverId: lena }] });
  });

  it('moves the later Dive\'s link to a Provider where the kept Dive has none, and leaves it where both have one', async () => {
    const one = await pair('2026-11-14');
    const remote = await send(one.b);
    expect((await append(one.a, [one.b])).statusCode).toBe(200);
    expect(await at(one.a)).toBe(remote);
    expect(await deleted(one.b)).toMatchObject({ continuedInto: one.a, stillAt: [] });

    const both = await pair('2026-11-15');
    const mine = await send(both.a);
    await send(both.b);
    expect(await json<Candidate>('GET', `/api/dives/${both.b}/continuation-candidate`)).toMatchObject({ id: both.a, bothAt: ['ledger'], deletesItself: [] });
    expect((await append(both.a, [both.b])).statusCode).toBe(200);
    expect(await at(both.a)).toBe(mine);
    expect(await deleted(both.b)).toMatchObject({ continuedInto: both.a, stillAt: [{ provider: 'ledger' }] });
  });

  it('alsoAt deletes the later Dive at the Provider first; a refusal appends nothing', async () => {
    const { a, b } = await pair('2026-11-16');
    const mine = await send(a);
    const theirs = await send(b);
    ledger.refuseDelete = true;
    try {
      const refused = await append(a, [b], { alsoAt: ['ledger'] });
      expect(refused.statusCode).not.toBe(200);
      expect((await diveOf(b)).id).toBe(b);
      expect((await diveOf(a)).recordings).toHaveLength(1);
      expect(ledger.dives.has(theirs)).toBe(true);
    } finally {
      ledger.refuseDelete = false;
    }
    expect((await append(a, [b], { alsoAt: ['ledger'] })).statusCode).toBe(200);
    expect(ledger.dives.has(theirs)).toBe(false);
    expect(ledger.dives.has(mine)).toBe(true);
    expect(await deleted(b)).toMatchObject({ continuedInto: a, stillAt: [] });
  });

  describe('alsoAt with two later Dives', () => {
    /** Three dives of one Device on that day, 10 minutes each, 5 minutes apart. */
    const chain = async (day: string) => {
      const s = serial++;
      return [
        await dive(s, `${day}T09:00:00Z`, 600), await dive(s, `${day}T09:15:00Z`, 600), await dive(s, `${day}T09:30:00Z`, 600),
      ] as [string, string, string];
    };

    it('asks about a later Dive where the kept Dive is, even when the Dive before it is not', async () => {
      const [a, b, c] = await chain('2026-11-17');
      const mine = await send(a);
      const theirs = await send(c);
      expect((await append(a, [b, c], { alsoAt: ['ledger'] })).statusCode).toBe(200);
      expect(ledger.dives.has(theirs)).toBe(false);
      expect(ledger.dives.has(mine)).toBe(true);
      expect(await deleted(c)).toMatchObject({ continuedInto: a, stillAt: [] });
    });

    it('checks every version before asking a Provider: a stale later Dive deletes nothing there', async () => {
      const [a, b, c] = await chain('2026-11-18');
      const remotes = [await send(a), await send(b), await send(c)];
      const before = await Promise.all([a, b, c].map(diveOf));
      const answer = await call('POST', `/api/dives/${a}/continuation`, {
        version: before[0]!.version, dives: [{ id: b, version: before[1]!.version }, { id: c, version: before[2]!.version - 1 }], alsoAt: ['ledger'],
      });
      expect(answer.statusCode).toBe(409);
      expect(answer.json()).toMatchObject({ code: 'dive_changed' });
      expect(remotes.map((r) => ledger.dives.has(r))).toEqual([true, true, true]);
      expect(await Promise.all([a, b, c].map(diveOf))).toEqual(before);
    });
  });

  describe('three parts of one Device', () => {
    const three = async (day: string) => {
      const s = serial++;
      return [
        await dive(s, `${day}T09:00:00Z`, 600), await dive(s, `${day}T09:15:00Z`, 600), await dive(s, `${day}T09:30:00Z`, 300),
      ] as [string, string, string];
    };
    const expectThreeParts = (kept: DiveView) => {
      expect(kept.values.durationSeconds).toBe(2100);
      const joined = joinedOf(kept);
      expect(joined).toMatchObject({ isPrimary: true, summary: { surfaceBreaks: [{ startS: 600, endS: 900 }, { startS: 1500, endS: 1800 }] } });
      expect(kept.recordings.filter((r) => r.partOf === joined.id)).toHaveLength(3);
      expect(kept.recordings).toHaveLength(4);
    };

    it('appends a third part to a joined Dive', async () => {
      const [a, b, c] = await three('2026-11-11');
      const once = (await append(a, [b])).json() as DiveView;
      const joined = joinedOf(once).id;
      const twice = await append(a, [c]);
      expect(twice.statusCode).toBe(200);
      expectThreeParts(twice.json() as DiveView);
      expect(joinedOf(twice.json() as DiveView).id).toBe(joined);
      expect(await deleted(c)).toMatchObject({ continuedInto: a });
    });

    it('appends two later Dives in one go', async () => {
      const [a, b, c] = await three('2026-11-12');
      const appended = await append(a, [b, c]);
      expect(appended.statusCode).toBe(200);
      expectThreeParts(appended.json() as DiveView);
      expect([await deleted(b), await deleted(c)]).toMatchObject([{ continuedInto: a }, { continuedInto: a }]);
      const history = await json<Revision[]>('GET', `/api/dives/${a}/revisions`);
      expect(history[0]).toMatchObject({ cause: 'continuation', changes: { appendedFrom: { to: [b, c] } } });
    });
  });

  describe('refuses', () => {
    /** Refused with the code, and neither Dive changed. */
    const refused = async (a: string, laterIds: string[], code: string, status = 400) => {
      const before = await Promise.all([a, ...laterIds].map(diveOf));
      const answer = await append(a, laterIds);
      expect(answer.statusCode).toBe(status);
      expect(answer.json()).toMatchObject({ code });
      expect(await Promise.all([a, ...laterIds].map(diveOf))).toEqual(before);
    };

    it('another Device', async () => {
      const { a, b } = await pair('2026-11-05', true);
      await refused(a, [b], 'continuation_not_possible');
    });

    it('the later Dive with two Recordings', async () => {
      const { a, b } = await pair('2026-11-06');
      expect(await upload(makeSyntheticDive({ serialNumber: serial++, start: new Date('2026-11-06T09:25:30Z'), durationSeconds: 900 })))
        .toMatchObject({ result: 'attached', diveId: b });
      await refused(a, [b], 'continuation_not_possible');
    });

    it('a Dive between them', async () => {
      const s = serial++;
      const a = await dive(s, '2026-11-07T09:00:00Z', 1200);
      await dive(serial++, '2026-11-07T10:00:00Z', 1200);
      const b = await dive(s, '2026-11-07T11:00:00Z', 1200);
      await refused(a, [b], 'continuation_not_possible');
    });

    it('overlapping times', async () => {
      const { a, b } = await pair('2026-11-08');
      // One Device doesn't record two dives at once; a clock set wrong can make it look so.
      const [bRec] = (await diveOf(b)).recordings;
      await t.db.update(recording).set({ startsAt: new Date('2026-11-08T09:15:00Z') }).where(eq(recording.id, bRec!.id));
      await refused(a, [b], 'continuation_not_possible');
    });

    it('another Diver', async () => {
      const { a, b } = await pair('2026-11-09');
      expect((await call('POST', `/api/dives/${b}/move`, { diverId: lena, version: (await diveOf(b)).version })).statusCode).toBe(200);
      await refused(a, [b], 'continuation_not_possible');
    });

    it('a stale version', async () => {
      const { a, b } = await pair('2026-11-10');
      const answer = await call('POST', `/api/dives/${a}/continuation`, {
        version: (await diveOf(a)).version - 1, dives: [{ id: b, version: (await diveOf(b)).version }],
      });
      expect(answer.statusCode).toBe(409);
      expect(answer.json()).toMatchObject({ code: 'dive_changed' });
      expect((await diveOf(a)).recordings).toHaveLength(1);
    });
  });

  describe('a joined Dive in the existing flows', () => {
    const primaryOf = (view: DiveView) => view.recordings.find((r) => r.isPrimary);
    const partsOf = (view: DiveView) => view.recordings.filter((r) => r.partOf !== null);
    /** A Dive typed by hand: no Recording, from a Provider. */
    const entry = async (start: string, durationSeconds: number) => {
      const [made] = await t.db.insert(diveTable).values({ diverId: own, startsAt: new Date(start), durationSeconds, maxDepthM: 20, fromProvider: 'ssi' })
        .returning({ id: diveTable.id });
      return made!.id;
    };
    const merge = async (id: string, otherId: string) => call('POST', `/api/dives/${id}/merge`, {
      version: (await diveOf(id)).version, otherId, otherVersion: (await diveOf(otherId)).version,
    });
    let counted: string;
    let typed: string;

    it('counts a joined Dive as one Recording', async () => {
      const { a, b } = await pair('2026-12-01');
      expect((await append(a, [b])).statusCode).toBe(200);
      counted = a;
      typed = await entry('2026-12-01T09:00:00Z', 1200);
      const { dives } = await json<{ dives: { id: string; recordings: number }[] }>('GET', `/api/dives?limit=100&diverId=${own}`);
      expect(dives.find((d) => d.id === a)).toMatchObject({ recordings: 1 });
      expect(await json<{ dive: { id: string }; recordings: number }[]>('GET', `/api/dives/${typed}/merge-candidates`))
        .toMatchObject([{ recordings: 1, keeps: a }]);
      const found = (await json<{ dive: { id: string; recordings: number }; other: { id: string; recordings: number } | null }[]>('GET', '/api/logbook-checks'))
        .find((c) => c.other && [c.dive.id, c.other.id].includes(a) && [c.dive.id, c.other.id].includes(typed))!;
      expect([found.dive, found.other!].find((d) => d.id === a)!.recordings).toBe(1);
    });

    it('merges a joined Dive and keeps the unit: the joined Dive is kept beside an entry', async () => {
      const merged = await merge(typed, counted);
      expect(merged.statusCode).toBe(200);
      expect(merged.json()).toMatchObject({ id: counted });
      const view = await diveOf(counted);
      expect(view.recordings).toHaveLength(3);
      expect(primaryOf(view)).toMatchObject({ parser: 'continuation' });
    });

    it('merges as the second of two: the joined Recording and both parts attach together, no part Primary', async () => {
      const { a, b } = await pair('2026-12-02');
      expect((await append(a, [b])).statusCode).toBe(200);
      const single = await dive(serial++, '2026-12-02T15:00:00Z', 1200);
      const singleRecording = primaryOf(await diveOf(single))!;
      const merged = await merge(single, a);
      expect(merged.json()).toMatchObject({ id: single });
      const view = await diveOf(single);
      expect(view.recordings).toHaveLength(4);
      expect(primaryOf(view)!.id).toBe(singleRecording.id);
      expect(partsOf(view)).toHaveLength(2);
      expect(partsOf(view).some((r) => r.isPrimary)).toBe(false);
    });

    describe("with another Device's file on it", () => {
      let joinedDive: string;
      let other: string;

      beforeAll(async () => {
        const { a, b } = await pair('2026-12-03');
        expect((await append(a, [b])).statusCode).toBe(200);
        joinedDive = a;
      });

      it('places the file overlapping it as today: attached, not Primary', async () => {
        const placed = await upload(makeSyntheticDive({ serialNumber: serial++, start: new Date('2026-12-03T09:05:00Z'), durationSeconds: 600 }));
        expect(placed).toMatchObject({ result: 'attached', diveId: joinedDive });
        const view = await diveOf(joinedDive);
        expect(view.recordings).toHaveLength(4);
        expect(primaryOf(view)).toMatchObject({ parser: 'continuation' });
        other = view.recordings.find((r) => r.parser !== 'continuation' && r.partOf === null)!.id;
      });

      it('sends the joined profile to a Provider', async () => {
        const [owner] = await t.db.select({ id: user.id }).from(user);
        const view = await diveOf(joinedDive);
        const { outgoing } = await loadOutgoingDive(t.db, owner!.id, joinedDive);
        expect(outgoing.durationSeconds).toBe(view.values.durationSeconds);
        const samples = await json<{ series: { channel: string; values: number[] }[] }>(
          'GET', `/api/recordings/${joinedOf(view).id}/samples?channels=depth&maxPoints=5000`,
        );
        expect(outgoing.samples.depth!.values).toHaveLength(samples.series[0]!.values.length);
      });

      it('refuses to make a part primary or split it off', async () => {
        const view = await diveOf(joinedDive);
        const part = partsOf(view)[0]!;
        const primary = await call('PUT', `/api/dives/${joinedDive}/primary-recording`, { recordingId: part.id, version: view.version });
        expect(primary.statusCode).toBe(400);
        expect(primary.json()).toMatchObject({ code: 'recording_is_part' });
        const split = await call('POST', `/api/recordings/${part.id}/detach`, { version: view.version });
        expect(split.statusCode).toBe(400);
        expect(split.json()).toMatchObject({ code: 'recording_is_part' });
        expect(await diveOf(joinedDive)).toEqual(view);
      });

      it('splits the joined Recording off only with its parts', async () => {
        const view = await diveOf(joinedDive);
        const split = await call('POST', `/api/recordings/${joinedOf(view).id}/detach`, { version: view.version });
        expect(split.statusCode).toBe(200);
        const created = await diveOf(split.json().diveId);
        expect(created.recordings).toHaveLength(3);
        expect(primaryOf(created)).toMatchObject({ id: joinedOf(view).id });
        expect(partsOf(created)).toHaveLength(2);
        const old = await diveOf(joinedDive);
        expect(old.recordings.map((r) => r.id)).toEqual([other]);
        expect(primaryOf(old)!.id).toBe(other);
      });
    });

    it('moves a joined Dive to another Diver with its parts, also as a copy where it is at a Provider', async () => {
      const plain = await pair('2026-12-04');
      expect((await append(plain.a, [plain.b])).statusCode).toBe(200);
      expect((await call('POST', `/api/dives/${plain.a}/move`, { diverId: lena, version: (await diveOf(plain.a)).version })).json()).toMatchObject({ id: plain.a });
      expect((await diveOf(plain.a)).recordings).toHaveLength(3);

      const linked = await pair('2026-12-05');
      expect((await append(linked.a, [linked.b])).statusCode).toBe(200);
      await send(linked.a);
      const moved = await call('POST', `/api/dives/${linked.a}/move`, { diverId: lena, version: (await diveOf(linked.a)).version });
      const copy = moved.json() as DiveView;
      expect(copy.id).not.toBe(linked.a);
      expect(copy.recordings).toHaveLength(3);
      expect(primaryOf(copy)).toMatchObject({ parser: 'continuation' });
      expect(partsOf(copy)).toHaveLength(2);
    });
  });
});
