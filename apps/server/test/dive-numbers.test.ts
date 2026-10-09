// A Dive's number (ADR 0048): its place by start time among its Diver's Dives plus "dives before this logbook", computed by
// the server and never typed; apnea sessions count by the Diver's setting. Through the HTTP API, as a client sees it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { revision } from '../src/db/schema.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Row = { id: string; number: number | null; startsAt: string };
type DiveView = {
  id: string; version: number; number?: never; overrides: string[]; values: { number: number | null; startsAt: { at: string; utcOffsetSeconds: number | null } };
  recordings: { summary: { diveNumber?: number } }[];
};
type DiverView = { id: string; name: string; divesBefore: number; apneaCounts: boolean };

const day = (n: number, hour = 9) => new Date(Date.UTC(2026, 2, n, hour));

describe.skipIf(!(await databaseReachable()))('Dive numbers', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let bob: string;
  let diverId: string;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    (await call(method, url, payload, cookie)).json() as T;
  const upload = async (start: Date, more: { subSport?: 'apneaDiving'; diveNumber?: number; cookie?: string } = {}) => {
    // A dive computer belongs to one Diver, so Bob's is another one.
    const { payload, headers } = multipartFile(`dive-${start.getTime()}.fit`, makeSyntheticDive({
      serialNumber: more.cookie === bob ? 200 : 100, start, ...(more.subSport && { subSport: more.subSport }), ...(more.diveNumber !== undefined && { diveNumber: more.diveNumber }),
    }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: more.cookie ?? ann } });
    await ctx.imports.processImport(created.json().id);
    const done = await json<{ outcome: { diveId?: string }[] }>('GET', `/api/imports/${created.json().id}`, undefined, more.cookie ?? ann);
    return done.outcome[0]!.diveId!;
  };
  /** The Diver's Dives (Ann's own unless said), as the list shows them. */
  const list = async (query = '', cookie = ann, of: string | null = cookie === ann ? diverId : null) =>
    (await json<{ dives: Row[] }>('GET', `/api/dives?limit=100${of ? `&diverId=${of}` : ''}${query}`, undefined, cookie)).dives;
  /** Dive ids by number, oldest start first. */
  const byTime = async (cookie = ann) => (await list('&sort=startsAt&order=asc', cookie)).map((d) => [d.id, d.number] as const);
  const numbersByTime = async (cookie = ann) => (await byTime(cookie)).map(([, n]) => n);
  const detail = (id: string, cookie = ann) => json<DiveView>('GET', `/api/dives/${id}`, undefined, cookie);
  const setDiver = (payload: object, id = diverId) => call('PATCH', `/api/divers/${id}`, payload);
  const clear = async () => {
    for (const d of await list()) await call('DELETE', `/api/dives/${d.id}`, { version: (await detail(d.id)).version });
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'bob@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    bob = await signIn(ctx.app, 'bob@example.com');
    diverId = (await json<DiverView[]>('GET', '/api/divers'))[0]!.id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  let a: string;
  let b: string;
  let c: string;

  it('numbers Dives by start time, however they came in', async () => {
    c = await upload(day(3));
    a = await upload(day(1));
    b = await upload(day(2));
    expect(await byTime()).toEqual([[a, 1], [b, 2], [c, 3]]);
  });

  it('an older Dive added later moves the others without changing them: no version, no history, an open edit still goes through', async () => {
    const before = await Promise.all([a, b, c].map((id) => detail(id)));
    const history = async (id: string) => (await json<unknown[]>('GET', `/api/dives/${id}/revisions`)).length;
    const entries = await Promise.all([a, b, c].map(history));
    const oldest = await upload(day(0));
    expect(await byTime()).toEqual([[oldest, 1], [a, 2], [b, 3], [c, 4]]);
    const after = await Promise.all([a, b, c].map((id) => detail(id)));
    expect(after.map((d) => d.version)).toEqual(before.map((d) => d.version));
    expect(await Promise.all([a, b, c].map(history))).toEqual(entries);
    const edit = await call('PATCH', `/api/dives/${b}`, { version: before[1]!.version, notes: 'still goes through' });
    expect(edit.statusCode).toBe(200);
    await call('DELETE', `/api/dives/${oldest}`, { version: (await detail(oldest)).version });
  });

  it('deleting the first makes the later ones move down, a deleted Dive has no number, and restoring puts all back', async () => {
    expect(await byTime()).toEqual([[a, 1], [b, 2], [c, 3]]);
    await call('DELETE', `/api/dives/${a}`, { version: (await detail(a)).version });
    expect(await byTime()).toEqual([[b, 1], [c, 2]]);
    const deleted = (await json<{ dives: { id: string; number: number | null; version: number }[] }>('GET', '/api/dives/deleted')).dives;
    expect(deleted.find((d) => d.id === a)!.number).toBeNull();
    const gone = deleted.find((d) => d.id === a)!;
    await call('POST', `/api/dives/${gone.id}/restore`, { version: gone.version });
    expect(await byTime()).toEqual([[a, 1], [b, 2], [c, 3]]);
  });

  it('overriding a start time so that two Dives change places swaps their numbers; resetting swaps them back', async () => {
    const first = await detail(a);
    const moved = await call('PATCH', `/api/dives/${a}`, {
      version: first.version, set: { startsAt: { at: day(2, 12).toISOString(), utcOffsetSeconds: first.values.startsAt.utcOffsetSeconds } },
    });
    expect(moved.statusCode).toBe(200);
    expect(await byTime()).toEqual([[b, 1], [a, 2], [c, 3]]);
    await call('PATCH', `/api/dives/${a}`, { version: (await detail(a)).version, reset: ['startsAt'] });
    expect(await byTime()).toEqual([[a, 1], [b, 2], [c, 3]]);
  });

  it('"dives before this logbook" adds to every number; values outside 0 to 100 000 and fractions are refused; the Diver shows it', async () => {
    expect((await setDiver({ divesBefore: 12 })).statusCode).toBe(200);
    expect(await numbersByTime()).toEqual([13, 14, 15]);
    for (const divesBefore of [-1, 100_001, 1.5]) expect((await setDiver({ divesBefore })).statusCode).toBe(400);
    expect((await setDiver({})).statusCode).toBe(400);
    expect((await json<DiverView[]>('GET', '/api/divers'))[0]).toMatchObject({ divesBefore: 12, apneaCounts: true });
    // Not a Diver this User manages: as for a rename.
    expect((await call('PATCH', `/api/divers/${diverId}`, { divesBefore: 3 }, bob)).statusCode).toBe(404);
    expect(await numbersByTime()).toEqual([13, 14, 15]);
    await setDiver({ divesBefore: 0 });
  });

  it('counts an apnea session unless the Diver says no, and numbers it again when they change their mind', async () => {
    const apnea = await upload(day(2, 15), { subSport: 'apneaDiving' });
    expect(await byTime()).toEqual([[a, 1], [b, 2], [apnea, 3], [c, 4]]);
    await setDiver({ apneaCounts: false });
    expect(await byTime()).toEqual([[a, 1], [b, 2], [apnea, null], [c, 3]]);
    await setDiver({ apneaCounts: true });
    expect(await byTime()).toEqual([[a, 1], [b, 2], [apnea, 3], [c, 4]]);
    // Sorted by number, the one without comes last both ways; a search finds numbers only.
    await setDiver({ apneaCounts: false });
    expect((await list('&sort=number&order=asc')).map((d) => d.number)).toEqual([1, 2, 3, null]);
    expect((await list('&sort=number&order=desc')).map((d) => d.number)).toEqual([3, 2, 1, null]);
    expect((await list('&q=2')).map((d) => d.id)).toEqual([b]);
    await setDiver({ apneaCounts: true });
    await call('DELETE', `/api/dives/${apnea}`, { version: (await detail(apnea)).version });
  });

  it('closes the gap when two Dives are merged, and numbers both Divers when one is moved to the other', async () => {
    const extra = await upload(day(4));
    expect(await numbersByTime()).toEqual([1, 2, 3, 4]);
    const merged = await call('POST', `/api/dives/${c}/merge`, {
      version: (await detail(c)).version, otherId: extra, otherVersion: (await detail(extra)).version,
    });
    expect(merged.statusCode).toBe(200);
    expect(await numbersByTime()).toEqual([1, 2, 3]);
    const child = (await json<{ id: string }>('POST', '/api/divers', { name: 'Lena' })).id;
    const moved = await call('POST', `/api/dives/${b}/move`, { diverId: child, version: (await detail(b)).version });
    expect(moved.statusCode).toBe(200);
    expect(await numbersByTime()).toEqual([1, 2]);
    expect((await list('', ann, child)).map((d) => d.number)).toEqual([1]);
    await call('POST', `/api/dives/${b}/move`, { diverId, version: (await detail(b)).version });
    expect(await numbersByTime()).toEqual([1, 2, 3]);
  });

  it('keeps one Diver\'s numbers out of another\'s', async () => {
    await upload(day(1), { cookie: bob });
    expect(await numbersByTime(bob)).toEqual([1]);
    expect(await numbersByTime()).toEqual([1, 2, 3]);
  });

  it('is not the computer\'s counter, which stays on the Recording', async () => {
    await clear();
    const id = await upload(day(9), { diveNumber: 57 });
    const d = await detail(id);
    expect(d.values.number).toBe(1);
    expect(d.recordings[0]!.summary.diveNumber).toBe(57);
  });

  it('refuses to set or reset a number, and no Dive has it as an Override', async () => {
    const id = (await list())[0]!.id;
    const { version } = await detail(id);
    expect((await call('PATCH', `/api/dives/${id}`, { version, set: { number: 5 } })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/dives/${id}`, { version, reset: ['number'] })).statusCode).toBe(400);
    for (const d of await list()) expect((await detail(d.id)).overrides).not.toContain('number');
  });

  it('still answers an old Revision of the field number', async () => {
    const id = (await list())[0]!.id;
    await t.db.insert(revision).values({
      entityType: 'dive', entityId: id, actorType: 'system', actorId: 'system', cause: 'edit', changes: { number: { from: 5, to: 6 } },
    });
    const history = await json<{ changes: Record<string, unknown> }[]>('GET', `/api/dives/${id}/revisions`);
    expect(history.some((r) => 'number' in r.changes)).toBe(true);
  });
});
