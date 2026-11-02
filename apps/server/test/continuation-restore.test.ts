// Undoing an append by restoring a Dive it took (ADR 0063): the whole append goes back, and every later append to the
// same joined Recording; each Dive comes back with its part Recording as its Primary one. The owner's dive 85/86 and
// synthetic dives of one Device.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownersDiveParts } from './fixtures/surface-break-dive.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Outcome = { result: string; diveId?: string };
type RecordingView = { id: string; isPrimary: boolean; parser: string; partOf: string | null; durationSeconds: number; maxDepthM: number | null };
type DiveView = { id: string; version: number; values: { number: number | null; durationSeconds: number; maxDepthM: number | null }; recordings: RecordingView[] };
type Deleted = { id: string; version: number; continuedInto: string | null; appendedWith: string[] };
type Check = { rule: string; dive: { id: string }; other: { id: string } | null };

describe.skipIf(!(await databaseReachable()))('restoring an appended Dive', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let serial = 7_200_000;

  const call = async (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST', url: string, payload?: object) => (await call(method, url, payload)).json() as T;
  const upload = async (bytes: Uint8Array): Promise<Outcome> => {
    const { payload, headers } = multipartFile('dive.fit', bytes);
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    return (await json<{ outcome: Outcome[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!;
  };
  const dive = async (serialNumber: number, start: string, durationSeconds: number) => {
    const placed = await upload(makeSyntheticDive({ serialNumber, start: new Date(start), durationSeconds }));
    expect(placed.result).toBe('created');
    return placed.diveId!;
  };
  /** Three dives of one Device on that day: 09:00 for 20 minutes, 09:25 for 15 and 09:45 for 10. */
  const three = async (day: string) => {
    const s = serial++;
    return {
      a: await dive(s, `${day}T09:00:00Z`, 1200), b: await dive(s, `${day}T09:25:00Z`, 900), c: await dive(s, `${day}T09:45:00Z`, 600), serialNumber: s,
    };
  };
  const diveOf = (id: string) => json<DiveView>('GET', `/api/dives/${id}`);
  const append = async (keptId: string, laterIds: string[]) => {
    const response = await call('POST', `/api/dives/${keptId}/continuation`, {
      version: (await diveOf(keptId)).version,
      dives: await Promise.all(laterIds.map(async (id) => ({ id, version: (await diveOf(id)).version }))),
    });
    expect(response.statusCode).toBe(200);
  };
  const deleted = async (id: string) => (await json<Deleted[]>('GET', '/api/dives/deleted')).find((d) => d.id === id);
  const restore = async (id: string) => {
    const response = await call('POST', `/api/dives/${id}/restore`, { version: (await deleted(id))!.version });
    expect(response.statusCode).toBe(200);
    return response.json() as DiveView;
  };
  const preview = async (id: string) => (await json<{ comesBack: string[] }>('GET', `/api/dives/${id}/restore-preview`)).comesBack;
  /** The Dive stands alone: its one Recording, not a part, is its Primary one. */
  const alone = async (id: string) => {
    const view = await diveOf(id);
    expect(view.recordings).toHaveLength(1);
    expect(view.recordings[0]).toMatchObject({ isPrimary: true, partOf: null });
    expect(view.recordings[0]!.parser).not.toBe('continuation');
    return view;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe("the owner's dive 85/86", () => {
    let first: string;
    let second: string;
    let after: string;
    let numbers: number[];

    beforeAll(async () => {
      const { first: one, second: two } = ownersDiveParts();
      first = (await upload(one)).diveId!;
      second = (await upload(two)).diveId!;
      after = await dive(serial++, '2026-10-26T12:00:00Z', 1800);
      numbers = await Promise.all([first, second, after].map(async (id) => (await diveOf(id)).values.number!));
      await append(first, [second]);
    });

    it('lists 86 as appended to 85, alone in its append', async () => {
      expect(await deleted(second)).toMatchObject({ continuedInto: first, appendedWith: [] });
      expect(await preview(second)).toEqual([second]);
    });

    it('restoring the later Dive separates the two and gives back its Recording', async () => {
      const restored = await restore(second);
      expect(restored.id).toBe(second);
      const one = await alone(first);
      const two = await alone(second);
      expect(one.values.durationSeconds).toBe(1180);
      expect(two.values.durationSeconds).toBe(1530);
      expect(await Promise.all([first, second, after].map(async (id) => (await diveOf(id)).values.number))).toEqual(numbers);
      expect(await deleted(second)).toBeUndefined();
      const history = await json<{ cause: string }[]>('GET', `/api/dives/${second}/revisions`);
      expect(history[0]).toMatchObject({ cause: 'continuation-undo' });
    });

    it('records "two dives" so the check doesn\'t ask again at once', async () => {
      const checks = await json<Check[]>('GET', '/api/logbook-checks');
      expect(checks.filter((c) => c.rule === 'surface_break' && [c.dive.id, c.other?.id].includes(second))).toEqual([]);
    });

    it('the kept Dive deleted meanwhile: the restored Dive gets its Recording back and stands alone', async () => {
      await append(first, [second]);
      expect((await call('DELETE', `/api/dives/${first}`, { version: (await diveOf(first)).version })).statusCode).toBe(200);
      await restore(second);
      expect((await alone(second)).values.durationSeconds).toBe(1530);
      expect(await deleted(first)).toBeDefined();
      // Brought back later, the kept Dive has its own Recording again, and its values.
      await restore(first);
      expect((await alone(first)).values.durationSeconds).toBe(1180);
    });
  });

  it('one append of two Dives comes back whole', async () => {
    const { a, b, c } = await three('2026-11-20');
    await append(a, [b, c]);
    expect(await deleted(b)).toMatchObject({ continuedInto: a, appendedWith: [c] });
    expect(await deleted(c)).toMatchObject({ continuedInto: a, appendedWith: [b] });
    expect(await preview(c)).toEqual([b, c]);
    await restore(c);
    expect((await alone(a)).values.durationSeconds).toBe(1200);
    expect((await alone(b)).values.durationSeconds).toBe(900);
    expect((await alone(c)).values.durationSeconds).toBe(600);
  });

  it('undoing the first append undoes the later one', async () => {
    const { a, b, c } = await three('2026-11-21');
    await append(a, [b]);
    await append(a, [c]);
    expect(await preview(b)).toEqual([b, c]);
    expect(await preview(c)).toEqual([c]);
    await restore(b);
    await alone(a);
    await alone(b);
    await alone(c);
    expect(await deleted(c)).toBeUndefined();
  });

  it('restoring the later append only leaves the first joined', async () => {
    const { a, b, c } = await three('2026-11-22');
    await append(a, [b]);
    await append(a, [c]);
    await restore(c);
    await alone(c);
    const kept = await diveOf(a);
    expect(kept.recordings).toHaveLength(3);
    expect(kept.recordings.find((r) => r.isPrimary)).toMatchObject({ parser: 'continuation', durationSeconds: 2400 });
    expect(kept.values.durationSeconds).toBe(2400);
    expect(await deleted(b)).toMatchObject({ continuedInto: a });
  });

  it('works where the joined Dive went since', async () => {
    const { a, b } = await three('2026-11-23');
    await append(a, [b]);
    const f = await dive(serial++, '2026-11-23T15:00:00Z', 1200);
    const own = (await diveOf(f)).recordings[0]!.id;
    const merged = await call('POST', `/api/dives/${f}/merge`, {
      version: (await diveOf(f)).version, otherId: a, otherVersion: (await diveOf(a)).version,
    });
    expect(merged.json()).toMatchObject({ id: f });
    await restore(b);
    expect((await alone(b)).values.durationSeconds).toBe(900);
    const kept = await diveOf(f);
    expect(kept.recordings).toHaveLength(2);
    expect(kept.recordings.some((r) => r.parser === 'continuation' || r.partOf !== null)).toBe(false);
    expect(kept.recordings.find((r) => r.isPrimary)!.id).toBe(own);
    expect(await deleted(a)).toBeDefined();
  });

  it('a part updated by an import since comes back as it is now', async () => {
    const { a, b, serialNumber } = await three('2026-11-24');
    await append(a, [b]);
    const deeper = makeSyntheticDive({
      serialNumber, start: new Date('2026-11-24T09:25:00Z'), durationSeconds: 900,
      depthAt: (s) => (s < 60 ? (s / 60) * 25 : s > 840 ? ((900 - s) / 60) * 25 : 25),
    });
    expect(await upload(deeper)).toMatchObject({ result: 'updated', diveId: a });
    await restore(b);
    const view = await alone(b);
    expect(view.values.maxDepthM).toBeCloseTo(25, 1);
    expect(view.recordings[0]!.maxDepthM).toBeCloseTo(25, 1);
  });
});
