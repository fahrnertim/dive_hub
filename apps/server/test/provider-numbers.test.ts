// A Provider's numbers following Dive Hub's (ADR 0048), through the HTTP API with the test-only ledger: the Connection's
// setting, what a send carries, "Set number" as a Push of its own, and never a number another dive there has.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { diveLease } from '../src/db/schema.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Status = {
  provider: string;
  current: { remoteId: string; remoteNumber: number | null; upToDate: boolean; updateRemovesVerification: boolean;
    number: { wanted: number; differs: boolean; canSet: boolean; removesVerification: boolean } | null } | null;
  pushes: { action: string; state: string; failureCode: string | null }[];
};
type ConnectionView = { id: string; diveNumbers: { follow: boolean } | null };

// A year per test: a Dive deleted earlier is not imported again.
let year = 2000;
const day = (n: number) => new Date(Date.UTC(year, 4, n, 9));

describe.skipIf(!(await databaseReachable()))('a Provider\'s numbers following Dive Hub\'s', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let bob: string;
  let diverId: string;
  let connectionId: string;
  const ledger = createFakeLedger();

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    (await call(method, url, payload, cookie)).json() as T;
  const upload = async (start: Date) => {
    const { payload, headers } = multipartFile(`dive-${start.getTime()}.fit`, makeSyntheticDive({ serialNumber: 100, start }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
    await ctx.imports.processImport(created.json().id);
    return (await json<{ outcome: { diveId: string }[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!.diveId;
  };
  const statusOf = async (id: string) => (await json<Status[]>('GET', `/api/dives/${id}/providers`)).find((s) => s.provider === 'ledger')!;
  const send = (id: string) => call('POST', `/api/dives/${id}/providers/ledger`, {});
  const setNumber = (id: string) => call('POST', `/api/dives/${id}/providers/ledger/number`);
  const follow = async (on: boolean) => json<ConnectionView>('PATCH', `/api/connections/${connectionId}`, { diveNumbers: { follow: on } });
  const remoteNumber = async (id: string) => ledger.dives.get((await statusOf(id)).current!.remoteId)!.number;
  const version = async (id: string) => (await json<{ version: number }>('GET', `/api/dives/${id}`)).version;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { extraProviders: [ledger.adapter] });
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'bob@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    bob = await signIn(ctx.app, 'bob@example.com');
    diverId = (await json<{ id: string }[]>('GET', '/api/divers'))[0]!.id;
    connectionId = (await json<{ id: string }>('POST', '/api/connections/ledger', { diverId, token: 'ledger-token-1', keepSignedIn: false })).id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });
  beforeEach(async () => {
    year++;
    // A clean logbook and ledger for each test.
    const { dives } = await json<{ dives: { id: string }[] }>('GET', `/api/dives?limit=100&diverId=${diverId}`);
    for (const d of dives) await call('DELETE', `/api/dives/${d.id}`, { version: await version(d.id) });
    ledger.dives.clear();
    await follow(false);
  });

  it('shows what the Provider can set, and the Connection\'s setting off by default', async () => {
    const providers = await json<{ id: string; data: { dives: { export: { numbers: unknown } } } }[]>('GET', '/api/providers');
    expect(providers.find((p) => p.id === 'ledger')!.data.dives.export.numbers).toEqual({ set: ['create', 'update'], changeRemovesVerification: true });
    const fresh = (await json<ConnectionView[]>('GET', '/api/connections')).find((c) => c.id === connectionId)!;
    expect(fresh.diveNumbers).toEqual({ follow: false });
    expect((await follow(true)).diveNumbers).toEqual({ follow: true });
    expect((await follow(false)).diveNumbers).toEqual({ follow: false });
  });

  it('refuses an empty change and another User\'s Connection', async () => {
    expect((await call('PATCH', `/api/connections/${connectionId}`, {})).statusCode).toBe(400);
    const other = await call('PATCH', `/api/connections/${connectionId}`, { diveNumbers: { follow: true } }, bob);
    expect(other.statusCode).toBe(404);
    expect(other.json()).toMatchObject({ code: 'connection_not_found' });
  });

  it('off: the ledger numbers its own way, the status has no number, and Set number is refused', async () => {
    ledger.seedRemote({ number: 5, startsAt: '2026-01-01T09:00:00Z' });
    const id = await upload(day(1));
    expect((await send(id)).statusCode).toBe(200);
    expect(await remoteNumber(id)).toBe(6);
    expect((await statusOf(id)).current!.number).toBeNull();
    const refused = await setNumber(id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'provider_numbers_off' });
  });

  it('on: a send carries the Dive\'s number', async () => {
    await follow(true);
    await upload(day(1));
    const second = await upload(day(2));
    expect((await send(second)).statusCode).toBe(200);
    expect(await remoteNumber(second)).toBe(2);
    expect((await statusOf(second)).current!.number).toEqual({ wanted: 2, differs: false, canSet: true, removesVerification: true });
  });

  it('on: a number a dive only at the ledger holds is not taken twice; the send goes with the ledger\'s own number', async () => {
    await follow(true);
    ledger.seedRemote({ number: 1, startsAt: '2025-01-01T09:00:00Z' });
    const id = await upload(day(1));
    expect((await send(id)).statusCode).toBe(200);
    expect(await remoteNumber(id)).toBe(2);
    expect((await statusOf(id)).current!.number).toMatchObject({ wanted: 1, differs: true });
  });

  it('Set number changes only the number: a Push of its own, the Dive state stays what it was', async () => {
    await follow(true);
    const id = await upload(day(2));
    await send(id);
    const remote = (await statusOf(id)).current!.remoteId;
    await upload(day(1));
    expect((await statusOf(id)).current).toMatchObject({ upToDate: true, remoteNumber: 1, number: { wanted: 2, differs: true } });
    const set = await setNumber(id);
    expect(set.statusCode).toBe(200);
    expect(ledger.dives.get(remote)!.number).toBe(2);
    // It answers the status as GET and DELETE do.
    const status = set.json<Status>();
    expect(status).toEqual(await statusOf(id));
    expect(status.current).toMatchObject({ upToDate: true, remoteNumber: 2, number: { differs: false } });
    expect(status.pushes[0]).toMatchObject({ action: 'number', state: 'confirmed' });
    // Changed since sent stays changed, and the change is not sent with the number.
    await call('PATCH', `/api/dives/${id}`, { version: await version(id), notes: 'Turtle' });
    await upload(day(0));
    expect((await setNumber(id)).statusCode).toBe(200);
    expect((await statusOf(id)).current).toMatchObject({ upToDate: false, remoteNumber: 3 });
    expect(ledger.dives.get(remote)).toMatchObject({ number: 3, notes: null });
  });

  it('a number another dive there has: 409 with that dive, a failed Push, nothing changed; the holder first, then it works', async () => {
    await follow(true);
    const first = await upload(day(2));
    const second = await upload(day(3));
    await send(first);
    await send(second);
    const a = (await statusOf(first)).current!.remoteId;
    const b = (await statusOf(second)).current!.remoteId;
    await upload(day(1));
    // first wants 2, which second has at the ledger.
    const taken = await setNumber(first);
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'provider_number_taken', existing: { remoteId: b, number: 2 }, diveId: second });
    expect(ledger.dives.get(a)!.number).toBe(1);
    expect((await statusOf(first)).pushes[0]).toMatchObject({ action: 'number', state: 'failed', failureCode: 'provider_number_taken' });
    // The holder first.
    expect((await setNumber(second)).statusCode).toBe(200);
    expect(ledger.dives.get(b)!.number).toBe(3);
    expect((await setNumber(first)).statusCode).toBe(200);
    expect(ledger.dives.get(a)!.number).toBe(2);
  });

  it('a holder only at the ledger has no diveId', async () => {
    await follow(true);
    const id = await upload(day(2));
    await send(id);
    ledger.seedRemote({ number: 2, startsAt: '2025-01-01T09:00:00Z' });
    await upload(day(1));
    const taken = await setNumber(id);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().existing.number).toBe(2);
    expect(taken.json().diveId ?? null).toBeNull();
  });

  it('nothing to set, never sent, and a dive deleted there', async () => {
    await follow(true);
    const id = await upload(day(2));
    const never = await setNumber(id);
    expect(never.statusCode).toBe(409);
    expect(never.json()).toMatchObject({ code: 'provider_not_sent' });
    await send(id);
    const nothing = await setNumber(id);
    expect(nothing.statusCode).toBe(409);
    expect(nothing.json()).toMatchObject({ code: 'provider_number_nothing_to_set' });
    await upload(day(1));
    ledger.dives.delete((await statusOf(id)).current!.remoteId);
    const gone = await setNumber(id);
    expect(gone.statusCode).toBe(409);
    expect(gone.json()).toMatchObject({ code: 'provider_dive_gone' });
  });

  it('an update of a changed Dive carries the number when free and leaves it when taken', async () => {
    await follow(true);
    const id = await upload(day(1));
    await send(id);
    const remote = (await statusOf(id)).current!.remoteId;
    ledger.renumber(remote, 6);
    await call('PATCH', `/api/dives/${id}`, { version: await version(id), notes: 'Turtle' });
    expect((await send(id)).statusCode).toBe(200);
    expect(ledger.dives.get(remote)!.number).toBe(1);
    ledger.renumber(remote, 6);
    ledger.seedRemote({ number: 1, startsAt: '2025-01-01T09:00:00Z' });
    await call('PATCH', `/api/dives/${id}`, { version: await version(id), notes: 'Turtle again' });
    expect((await send(id)).statusCode).toBe(200);
    expect(ledger.dives.get(remote)!.number).toBe(6);
  });

  it('says when a number change can remove a verification', async () => {
    await follow(true);
    const id = await upload(day(2));
    await send(id);
    await upload(day(1));
    const current = (await statusOf(id)).current!;
    expect(current.number).toMatchObject({ differs: true, removesVerification: true });
    expect(current.updateRemovesVerification).toBe(false);
  });

  it('an older Dive added later makes every Dive at the ledger differ, with nothing sent', async () => {
    await follow(true);
    const a = await upload(day(2));
    const b = await upload(day(3));
    await send(a);
    await send(b);
    const pushes = async () => (await statusOf(a)).pushes.length + (await statusOf(b)).pushes.length;
    const before = await pushes();
    await upload(day(1));
    for (const id of [a, b]) expect((await statusOf(id)).current).toMatchObject({ upToDate: true, number: { differs: true } });
    expect(await pushes()).toBe(before);
    expect([...ledger.dives.values()].map((d) => d.number).sort()).toEqual([1, 2]);
  });

  it('a held lease answers provider_busy', async () => {
    await follow(true);
    const id = await upload(day(2));
    await send(id);
    await upload(day(1));
    await t.db.insert(diveLease).values({ diveId: id, provider: 'ledger', holder: randomUUID(), lockedUntil: new Date(Date.now() + 60_000) });
    const busy = await setNumber(id);
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({ code: 'provider_busy' });
  });
});
