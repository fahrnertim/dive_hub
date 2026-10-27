// The queue of Waiting pushes (ADR 0056): a change to a Dive puts it in the queue once per Provider, due after a quiet
// period, and the Connection's job runs at the earliest due time. Rows are read from the table (the API comes later).
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connection, importJob, push, revision, waitingPush } from '../src/db/schema.js';
import { writeRevision } from '../src/dives/revisions.js';
import { QUIET_MS, settle, WAITING_PUSHES_TASK } from '../src/providers/waiting-push-queue.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

// A year per test: a Dive deleted earlier is not imported again.
let year = 3100;
const day = (n: number) => new Date(Date.UTC(year, 4, n, 9));

describe.skipIf(!(await databaseReachable()))('the queue of Waiting pushes', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let bob: string;
  let diverId: string;
  let connectionId: string;
  let annId: string;
  const ledger = createFakeLedger();

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    (await call(method, url, payload, cookie)).json() as T;
  const upload = async (start: Date, serialNumber = 100) => {
    const { payload, headers } = multipartFile(`dive-${start.getTime()}-${serialNumber}.fit`, makeSyntheticDive({ serialNumber, start }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
    await ctx.imports.processImport(created.json().id);
    return (await json<{ outcome: { diveId: string }[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!.diveId;
  };
  const version = async (id: string) => (await json<{ version: number }>('GET', `/api/dives/${id}`)).version;
  const edit = async (id: string, notes: string, cookie = ann) =>
    call('PATCH', `/api/dives/${id}`, { version: await version(id), notes }, cookie);
  const send = async (id: string) => {
    expect((await call('POST', `/api/dives/${id}/providers/ledger`, {})).statusCode).toBeLessThan(300);
    await t.db.delete(waitingPush);
  };
  const rows = () => t.db.select().from(waitingPush);
  const settings = (set: Partial<typeof connection.$inferInsert>) => t.db.update(connection).set(set).where(eq(connection.id, connectionId));
  const jobRunAt = async (id: string) => {
    const found = await t.db.execute(sql`select run_at from graphile_worker.jobs where key = ${'waiting-pushes:' + id}`);
    const runAt = (found.rows[0] as { run_at: Date | string } | undefined)?.run_at;
    return runAt === undefined ? null : new Date(runAt);
  };
  const lastRevision = async (id: string) =>
    (await t.db.select().from(revision).where(eq(revision.entityId, id)).orderBy(desc(revision.at)).limit(1))[0]!;
  const connect = async (token: string, cookie = ann) =>
    (await json<{ id: string }>('POST', '/api/connections/ledger', { diverId, token, keepSignedIn: false }, cookie)).id;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { extraProviders: [ledger.adapter] });
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'bob@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    bob = await signIn(ctx.app, 'bob@example.com');
    diverId = (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers')).find((d) => d.isOwn)!.id;
    annId = ((await t.db.execute(sql`select id from "user" where email = 'ann@example.com'`)).rows[0] as { id: string }).id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });
  beforeEach(async () => {
    year++;
    await t.db.delete(waitingPush);
    await t.db.delete(connection);
    await t.db.delete(push);
    const { dives } = await json<{ dives: { id: string }[] }>('GET', `/api/dives?limit=100&diverId=${diverId}`);
    for (const d of dives) await call('DELETE', `/api/dives/${d.id}`, { version: await version(d.id) });
    await t.db.delete(waitingPush);
    ledger.dives.clear();
    ledger.tokens.clear();
    ledger.tokens.set('ledger-token-1', { accountId: 'l-5', label: 'Ledger of Erika' });
    ledger.tokens.set('ledger-token-2', { accountId: 'l-6', label: 'Ledger of Someone Else' });
    connectionId = await connect('ledger-token-1');
    await settings({ sendChanges: true });
  });

  it('an edit queues the Dive due 30 s later', async () => {
    const id = await upload(day(1));
    await send(id);
    await edit(id, 'Turtle');
    const [row, ...rest] = await rows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ diveId: id, provider: 'ledger', connectionId, action: 'send', state: 'waiting', reason: null, attempts: 0 });
    expect(row!.changedAt).toEqual((await lastRevision(id)).at);
    expect(row!.dueAt.getTime() - row!.changedAt.getTime()).toBe(QUIET_MS);
    expect(await jobRunAt(connectionId)).toEqual(row!.dueAt);
    expect(WAITING_PUSHES_TASK).toBe('waiting_pushes');
  });

  it('a second edit moves the due time and keeps one entry', async () => {
    const id = await upload(day(1));
    await send(id);
    await edit(id, 'Turtle');
    const [first] = await rows();
    await edit(id, 'Turtle and ray');
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.dueAt.getTime()).toBeGreaterThan(first!.dueAt.getTime());
    expect(after[0]!.changedAt).toEqual((await lastRevision(id)).at);
    expect(await jobRunAt(connectionId)).toEqual(after[0]!.dueAt);
  });

  it('nothing is queued with send changes off', async () => {
    const id = await upload(day(1));
    await send(id);
    await settings({ sendChanges: false });
    await edit(id, 'Turtle');
    expect(await rows()).toEqual([]);
    expect(await jobRunAt(connectionId)).toBeNull();
  });

  it('one entry per Dive and Provider for two Connections', async () => {
    const id = await upload(day(1));
    await send(id);
    const [pushed] = await t.db.select().from(push).where(and(eq(push.diveId, id), eq(push.provider, 'ledger')));
    expect(pushed!.connectionId).toBe(connectionId);
    const bobsUser = (await t.db.execute(sql`select id from "user" where email = 'bob@example.com'`)).rows[0] as { id: string };
    await t.db.execute(sql`insert into diver_management (user_id, diver_id) values (${bobsUser.id}, ${diverId})`);
    const bobs = await connect('ledger-token-1', bob);
    await t.db.update(connection).set({ sendChanges: true, sendNewDives: true }).where(eq(connection.id, bobs));
    await settings({ sendNewDives: true });
    expect((await edit(id, 'Turtle', bob)).statusCode).toBe(200);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.connectionId).toBe(connectionId);
    expect(await jobRunAt(bobs)).toBeNull();
  });

  it('a Connection now at another account queues nothing', async () => {
    const id = await upload(day(1));
    await send(id);
    // The Connection is removed and the Diver connected to another account: the Push no longer has a Connection.
    expect((await call('DELETE', `/api/connections/${connectionId}`)).statusCode).toBeLessThan(300);
    connectionId = await connect('ledger-token-2');
    await settings({ sendChanges: true, sendNewDives: true });
    await edit(id, 'Turtle');
    expect(await rows()).toEqual([]);
  });

  it('a Dive typed in queues a send with send new dives on', async () => {
    const id = await upload(day(1));
    await edit(id, 'Turtle');
    expect(await rows()).toEqual([]);
    await settings({ sendNewDives: true });
    await edit(id, 'Turtle and ray');
    expect(await rows()).toMatchObject([{ diveId: id, provider: 'ledger', connectionId, action: 'send', state: 'waiting' }]);
    // A Dive made by hand: its first Revision is a `create` (ADR 0016).
    await t.db.delete(waitingPush);
    await t.db.transaction((tx) => writeRevision(tx, 'dive', id, { type: 'user', id: annId }, 'create', {}));
    expect(await rows()).toHaveLength(1);
  });

  it('an import\'s new Dive is not queued here', async () => {
    await settings({ sendNewDives: true });
    const id = await upload(day(1));
    expect(id).toBeTruthy();
    expect(await rows()).toEqual([]);
  });

  it('an import\'s update from the same Provider sends nothing back', async () => {
    const id = await upload(day(1));
    await send(id);
    const [fromLedger] = await t.db.insert(importJob).values({
      userId: annId, uploadName: 'ledger', provider: 'ledger', connectionId,
    }).returning({ id: importJob.id });
    const [fromFile] = await t.db.insert(importJob).values({
      userId: annId, uploadName: 'file.fit',
    }).returning({ id: importJob.id });
    for (const cause of ['fill', 'update'] as const) {
      await t.db.transaction((tx) => writeRevision(tx, 'dive', id, { type: 'import', id: fromLedger!.id }, cause, { notes: { from: null, to: 'x' } }));
      expect(await rows()).toEqual([]);
    }
    // The same cause from a file, or from another Provider, still goes out.
    await t.db.transaction((tx) => writeRevision(tx, 'dive', id, { type: 'import', id: fromFile!.id }, 'fill', { notes: { from: null, to: 'x' } }));
    expect(await rows()).toHaveLength(1);
  });

  it('a site\'s position change queues its sent Dives', async () => {
    const site = await json<{ id: string; version: number }>('POST', '/api/dive-sites', { name: 'Blue Hole', position: { latitude: 28.57, longitude: 34.54 } });
    const sent = await upload(day(1));
    const unsent = await upload(day(2));
    for (const id of [sent, unsent]) await call('PATCH', `/api/dives/${id}`, { version: await version(id), siteId: site.id });
    await send(sent);
    await t.db.delete(waitingPush);
    // A change of country is not sent.
    const first = await json<{ version: number }>('PATCH', `/api/dive-sites/${site.id}`, { version: site.version, country: 'EG' });
    expect(await rows()).toEqual([]);
    const moved = await call('PATCH', `/api/dive-sites/${site.id}`, { version: first.version, position: { latitude: 28.6, longitude: 34.5 } });
    expect(moved.statusCode).toBe(200);
    expect(await rows()).toMatchObject([{ diveId: sent, provider: 'ledger', action: 'send', state: 'waiting' }]);
    await t.db.delete(waitingPush);
    await call('PATCH', `/api/dive-sites/${site.id}`, { version: (moved.json() as { version: number }).version, name: 'Blue Hole, Dahab' });
    expect(await rows()).toMatchObject([{ diveId: sent }]);
  });

  it('a save while the Connection needs a sign-in holds the entry at once', async () => {
    const id = await upload(day(1));
    await send(id);
    await settings({ state: 'needs_sign_in' });
    await edit(id, 'Turtle');
    expect(await rows()).toMatchObject([{ diveId: id, state: 'held', reason: 'sign_in', action: 'send' }]);
    expect(await jobRunAt(connectionId)).toBeNull();
    // Signed in again, the next save puts it back to waiting.
    await settings({ state: 'active' });
    await edit(id, 'Turtle and ray');
    expect(await rows()).toMatchObject([{ diveId: id, state: 'waiting', reason: null }]);
  });

  it('a manual send removes the entry', async () => {
    const id = await upload(day(1));
    await send(id);
    await edit(id, 'Turtle');
    expect(await rows()).toHaveLength(1);
    expect((await call('POST', `/api/dives/${id}/providers/ledger`, {})).statusCode).toBeLessThan(300);
    expect(await rows()).toEqual([]);
  });

  it('settle keeps an entry changed after the send began', async () => {
    const id = await upload(day(1));
    await send(id);
    await edit(id, 'Turtle');
    const [row] = await rows();
    await t.db.update(waitingPush).set({ state: 'held', reason: 'exists', attempts: 2 }).where(eq(waitingPush.diveId, id));
    await settle(t.db, id, 'ledger', new Date(row!.changedAt.getTime() - 1000));
    expect(await rows()).toMatchObject([{ diveId: id, state: 'waiting', reason: null, attempts: 0 }]);
    expect((await rows())[0]!.dueAt.getTime()).toBe(row!.changedAt.getTime() + QUIET_MS);
    await settle(t.db, id, 'ledger', new Date(row!.changedAt.getTime() + 1000));
    expect(await rows()).toEqual([]);
  });

  describe('each kind of change that alters what is sent', () => {
    let id: string;
    beforeEach(async () => {
      id = await upload(day(1));
      await send(id);
    });

    it('queues an edit of values', async () => {
      expect((await call('PATCH', `/api/dives/${id}`, { version: await version(id), set: { maxDepthM: 30 } })).statusCode).toBe(200);
      expect(await rows()).toHaveLength(1);
    });

    it('queues a change of Participants', async () => {
      const buddy = await json<{ id: string }>('POST', '/api/external-divers', { name: 'Lena Meier' });
      const response = await call('PUT', `/api/dives/${id}/participants`, { version: await version(id), participants: [{ diverId: buddy.id, role: 'buddy' }] });
      expect(response.statusCode).toBe(200);
      expect(await rows()).toHaveLength(1);
    });

    it('queues a Recording attached to the Dive', async () => {
      const again = await upload(new Date(day(1).getTime() + 2 * 60_000), 999);
      expect(again).toBe(id);
      expect(await rows()).toHaveLength(1);
    });

    it('queues a Dive whose site was merged into another', async () => {
      const [a, b] = [
        await json<{ id: string; version: number }>('POST', '/api/dive-sites', { name: 'Site A' }),
        await json<{ id: string; version: number }>('POST', '/api/dive-sites', { name: 'Site B' }),
      ] as [{ id: string; version: number }, { id: string; version: number }];
      await call('PATCH', `/api/dives/${id}`, { version: await version(id), siteId: a.id });
      await send(id);
      const merged = await call('POST', `/api/dive-sites/${a.id}/merge`, { intoId: b.id, version: a.version, intoVersion: b.version });
      expect(merged.statusCode).toBe(200);
      expect(await rows()).toMatchObject([{ diveId: id, action: 'send' }]);
    });

    it('queues a change of Cylinders', async () => {
      const steel12 = { volumeL: 12, workingPressureBar: 232, material: 'steel', gas: { o2: 21, he: 0 }, startPressureBar: 200, endPressureBar: 60 };
      expect((await call('PATCH', `/api/dives/${id}`, { version: await version(id), cylinders: [steel12] })).statusCode).toBe(200);
      expect(await rows()).toHaveLength(1);
    });
  });
});
