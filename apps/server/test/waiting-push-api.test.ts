// The API of the automation (ADR 0056): the settings of a Connection and what each Provider offers, the Waiting push's
// state on the Dive list and the Dive's status, Retry and the User's decisions through the queue, the entries "Needs
// your decision" lists, and what the Connection says about its last fetch. Real database, the test ledger.
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connection, dive, importJob, providerConflict, push, waitingPush } from '../src/db/schema.js';
import { record } from '../src/providers/conflicts.js';
import { createFakeHandover } from './fake-handover-provider.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Waiting = { provider: string; action: string; state: string; reason: string | null; dueAt: string };
type ConnectionRow = {
  id: string; provider: string; sendChanges: boolean; sendNewDives: boolean; deleteAtProvider: boolean; fetchEveryMinutes: number | null;
  offers: { sendChanges: boolean; sendNewDives: boolean; deleteAtProvider: boolean; fetchEvery: number[] };
  waiting: { waiting: number; held: number; stopped: number };
  lastFetch: { at: string; created: number; updated: number; waitingForYou: number; conflicts: number } | null;
  unsentDives: string[];
};

// A year per test: a Dive deleted earlier is not imported again.
let year = 3500;

describe.skipIf(!(await databaseReachable()))('the API of the automation', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let bob: string;
  let annId: string;
  let diverId: string;
  let connectionId: string;
  const ledger = createFakeLedger({ imports: true });
  const handover = createFakeHandover();

  const call = (method: Method, url: string, payload?: object, cookie = ann) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: Method, url: string, payload?: object, cookie = ann) => (await call(method, url, payload, cookie)).json() as T;
  const version = async (id: string) => (await json<{ version: number }>('GET', `/api/dives/${id}`)).version;
  const edit = async (id: string, notes: string) => call('PATCH', `/api/dives/${id}`, { version: await version(id), notes });
  const upload = async (start: Date, serialNumber = 100) => {
    const { payload, headers } = multipartFile(`dive-${start.getTime()}.fit`, makeSyntheticDive({ serialNumber, start }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
    await ctx.imports.processImport(created.json().id);
    return (await json<{ outcome: { diveId: string }[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!.diveId;
  };
  const set = (id: string, values: Partial<typeof connection.$inferInsert>) => t.db.update(connection).set(values).where(eq(connection.id, id));
  const rows = () => t.db.select().from(waitingPush);
  const connectionRow = async (id = connectionId) => (await json<ConnectionRow[]>('GET', '/api/connections')).find((c) => c.id === id)!;
  /** A Dive that is at the ledger and has a send waiting for it (send changes on). */
  const waitingDive = async () => {
    const id = await upload(new Date(Date.UTC(year, 4, 1, 9)));
    expect((await call('POST', `/api/dives/${id}/providers/ledger`, {})).statusCode).toBeLessThan(300);
    await set(connectionId, { sendChanges: true });
    await edit(id, 'Turtle');
    return id;
  };
  const diveRow = async (id: string) =>
    (await json<{ dives: { id: string; waiting: Waiting[] }[] }>('GET', `/api/dives?limit=100`)).dives.find((d) => d.id === id)!;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { extraProviders: [ledger.adapter, handover.adapter] });
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
    await t.db.delete(providerConflict);
    await t.db.delete(waitingPush);
    await t.db.delete(connection);
    await t.db.delete(push);
    const { dives } = await json<{ dives: { id: string }[] }>('GET', `/api/dives?limit=100&diverId=${diverId}`);
    for (const d of dives) await call('DELETE', `/api/dives/${d.id}`, { version: await version(d.id) });
    await t.db.delete(waitingPush);
    ledger.dives.clear();
    ledger.tokens.clear();
    ledger.tokens.set('ledger-token-1', { accountId: 'l-5', label: 'Ledger of Ann' });
    handover.tokens.set('handover-token-1', { accountId: 'h-77', label: 'Logbook of Ann' });
    connectionId = (await json<{ id: string }>('POST', '/api/connections/ledger', { diverId, token: 'ledger-token-1', keepSignedIn: false })).id;
  });

  it('settings round-trip and refuse what the Provider can\'t', async () => {
    const fresh = await connectionRow();
    expect(fresh).toMatchObject({
      sendChanges: false, sendNewDives: false, deleteAtProvider: false, fetchEveryMinutes: null,
      offers: { sendChanges: true, sendNewDives: true, deleteAtProvider: true, fetchEvery: [60, 360, 1440] },
      waiting: { waiting: 0, held: 0, stopped: 0 }, lastFetch: null, unsentDives: [],
    });
    const patched = await call('PATCH', `/api/connections/${connectionId}`, {
      sendChanges: true, sendNewDives: true, deleteAtProvider: true, fetchEveryMinutes: 360,
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ sendChanges: true, sendNewDives: true, deleteAtProvider: true, fetchEveryMinutes: 360 });
    expect(await connectionRow()).toMatchObject({ sendChanges: true, sendNewDives: true, deleteAtProvider: true, fetchEveryMinutes: 360 });
    expect((await call('PATCH', `/api/connections/${connectionId}`, { sendChanges: false, fetchEveryMinutes: null })).json())
      .toMatchObject({ sendChanges: false, sendNewDives: true, deleteAtProvider: true, fetchEveryMinutes: null });
    // Only the three intervals exist.
    expect((await call('PATCH', `/api/connections/${connectionId}`, { fetchEveryMinutes: 120 })).statusCode).toBe(400);

    // A Provider that hands dives over (no ID, no delete, no import, no schedule) offers none of it.
    const handed = (await json<{ id: string }>('POST', '/api/connections/handover', { diverId, token: 'handover-token-1', keepSignedIn: false })).id;
    expect(await connectionRow(handed)).toMatchObject({ offers: { sendChanges: false, sendNewDives: false, deleteAtProvider: false, fetchEvery: [] } });
    for (const body of [{ sendChanges: true }, { sendNewDives: true }, { deleteAtProvider: true }, { fetchEveryMinutes: 60 }]) {
      const refused = await call('PATCH', `/api/connections/${handed}`, body);
      expect([refused.statusCode, refused.json().code]).toEqual([400, 'provider_unsupported']);
    }
    // Turning off is always fine; nothing was changed by the refusals.
    expect((await call('PATCH', `/api/connections/${handed}`, { sendChanges: false, fetchEveryMinutes: null })).statusCode).toBe(200);
    expect(await connectionRow(handed)).toMatchObject({ sendChanges: false, fetchEveryMinutes: null });
  });

  it('a change refused in a later part leaves the automation part unsaved', async () => {
    const handed = (await json<{ id: string }>('POST', '/api/connections/handover', { diverId, token: 'handover-token-1', keepSignedIn: false })).id;
    await set(handed, { sendChanges: true });
    // Turning off is allowed, but the Provider declares no numbers and no import: those parts are refused.
    for (const body of [{ diveNumbers: { follow: true } }, { diveImport: { mode: 'create' } }]) {
      const refused = await call('PATCH', `/api/connections/${handed}`, { sendChanges: false, ...body });
      expect([refused.statusCode, refused.json().code]).toEqual([400, 'provider_unsupported']);
      expect(await connectionRow(handed)).toMatchObject({ sendChanges: true });
    }
  });

  it('refuses an interval below the Provider\'s minimum, and changes nothing', async () => {
    const limits = ledger.adapter.capabilities.limits;
    limits.fetchEveryMinutes = 360;
    try {
      expect((await connectionRow()).offers.fetchEvery).toEqual([360, 1440]);
      const refused = await call('PATCH', `/api/connections/${connectionId}`, { sendChanges: true, fetchEveryMinutes: 60 });
      expect([refused.statusCode, refused.json().code]).toEqual([400, 'fetch_interval_too_short']);
      expect(await connectionRow()).toMatchObject({ sendChanges: false, fetchEveryMinutes: null });
      expect((await call('PATCH', `/api/connections/${connectionId}`, { fetchEveryMinutes: 360 })).statusCode).toBe(200);
    } finally {
      limits.fetchEveryMinutes = 60;
    }
    // The shortest interval is part of what the Provider declares.
    const provider = (await json<{ id: string; limits: { fetchEveryMinutes: number | null } }[]>('GET', '/api/providers')).find((p) => p.id === 'ledger');
    expect(provider!.limits.fetchEveryMinutes).toBe(60);
  });

  it('the list rows carry the Dive\'s waiting state', async () => {
    const quiet = await upload(new Date(Date.UTC(year, 4, 2, 9)), 200);
    const id = await waitingDive();
    const [entry] = await rows();
    expect((await diveRow(quiet)).waiting).toEqual([]);
    expect((await diveRow(id)).waiting).toEqual([
      { provider: 'ledger', action: 'send', state: 'waiting', reason: null, dueAt: entry!.dueAt.toISOString() },
    ]);
    expect((await json<{ waiting: Waiting | null }>('GET', `/api/dives/${id}/providers/ledger`)).waiting)
      .toEqual({ provider: 'ledger', action: 'send', state: 'waiting', reason: null, dueAt: entry!.dueAt.toISOString() });
    expect((await json<{ waiting: Waiting | null }>('GET', `/api/dives/${quiet}/providers/ledger`)).waiting).toBeNull();
    expect(await connectionRow()).toMatchObject({ waiting: { waiting: 1, held: 0, stopped: 0 } });
    await t.db.update(waitingPush).set({ state: 'stopped', reason: 'provider_refused' }).where(eq(waitingPush.diveId, id));
    expect((await diveRow(id)).waiting).toMatchObject([{ state: 'stopped', reason: 'provider_refused' }]);
    expect((await json<{ waiting: Waiting | null }>('GET', `/api/dives/${id}/providers/ledger`)).waiting).toMatchObject({ state: 'stopped' });
    expect(await connectionRow()).toMatchObject({ waiting: { waiting: 0, held: 0, stopped: 1 } });
  });

  it('retry answers 404 for another User\'s Dive', async () => {
    const id = await waitingDive();
    await t.db.update(waitingPush).set({ state: 'stopped', reason: 'provider_refused' }).where(eq(waitingPush.diveId, id));
    // Another User sees the same answer for a Dive with an entry as for one that doesn't exist.
    const other = await call('POST', `/api/dives/${id}/providers/ledger/retry`, undefined, bob);
    const missing = await call('POST', `/api/dives/${'00000000-0000-4000-8000-000000000000'}/providers/ledger/retry`, undefined, bob);
    expect([other.statusCode, other.json().code]).toEqual([404, 'dive_not_found']);
    expect([missing.statusCode, missing.json().code]).toEqual([404, 'dive_not_found']);
    expect((await rows())[0]).toMatchObject({ state: 'stopped' });
    // The owner's Retry makes it wait again, due now; a second Retry (a double click, two tabs) changes nothing.
    expect((await call('POST', `/api/dives/${id}/providers/ledger/retry`)).statusCode).toBe(204);
    const [retried] = await rows();
    expect(retried).toMatchObject({ state: 'waiting', reason: null });
    expect((await call('POST', `/api/dives/${id}/providers/ledger/retry`)).statusCode).toBe(204);
    expect((await rows())[0]!.dueAt).toEqual(retried!.dueAt);
    // Only a missing entry is not found.
    await t.db.delete(waitingPush).where(eq(waitingPush.diveId, id));
    const gone = await call('POST', `/api/dives/${id}/providers/ledger/retry`);
    expect([gone.statusCode, gone.json().code]).toEqual([404, 'waiting_push_not_found']);
  });

  it('a decision queues the Dive due now with its options', async () => {
    const id = await waitingDive();
    await t.db.update(waitingPush).set({ state: 'held', reason: 'exists', detail: { remoteId: 'L1', remoteNumber: 4, startsAt: '2025-05-01 09:00' } })
      .where(eq(waitingPush.diveId, id));
    expect((await call('POST', `/api/dives/${id}/providers/ledger/decision`, { onExisting: 'link' })).statusCode).toBe(204);
    const [linked] = await rows();
    expect(linked).toMatchObject({ diveId: id, connectionId, action: 'send', state: 'waiting', reason: null, options: { onExisting: 'link' } });
    expect(Math.abs(linked!.dueAt.getTime() - Date.now())).toBeLessThan(10_000);
    // A choice for a Conflict adds to the options.
    expect((await call('POST', `/api/dives/${id}/providers/ledger/decision`, { conflicts: { notes: 'hub' } })).statusCode).toBe(204);
    expect((await rows())[0]!.options).toEqual({ onExisting: 'link', conflicts: { notes: 'hub' } });
    // A decision says something; another User's Dive isn't theirs to decide.
    expect((await call('POST', `/api/dives/${id}/providers/ledger/decision`, {})).statusCode).toBe(400);
    const other = await call('POST', `/api/dives/${id}/providers/ledger/decision`, { onExisting: 'create' }, bob);
    expect([other.statusCode, other.json().code]).toEqual([404, 'dive_not_found']);
    expect((await rows())[0]!.options).toEqual({ onExisting: 'link', conflicts: { notes: 'hub' } });
  });

  it("a co-manager's decision answers 404 connection_not_found and queues nothing", async () => {
    const id = await waitingDive();
    const bobsUser = ((await t.db.execute(sql`select id from "user" where email = 'bob@example.com'`)).rows[0] as { id: string }).id;
    // Bob co-manages the Diver, but a decision goes through the Connection of the entry, which is Ann's.
    await t.db.execute(sql`insert into diver_management (user_id, diver_id) values (${bobsUser}, ${diverId}) on conflict do nothing`);
    try {
      const refused = await call('POST', `/api/dives/${id}/providers/ledger/decision`, { onExisting: 'create' }, bob);
      expect([refused.statusCode, refused.json().code]).toEqual([404, 'connection_not_found']);
      expect((await rows())[0]!.options).toEqual({});
    } finally {
      await t.db.execute(sql`delete from diver_management where user_id = ${bobsUser} and diver_id = ${diverId}`);
    }
  });

  it('the exists entry is listed under Needs your decision and leaves after Link to it', async () => {
    const id = await waitingDive();
    await t.db.update(waitingPush).set({ state: 'held', reason: 'exists', detail: { remoteId: 'L7', remoteNumber: 4, startsAt: '2025-05-01 09:00' } })
      .where(eq(waitingPush.diveId, id));
    type Listed = { connectionId: string; entries: { kind: string; diveId: string; remoteId: string; fields: unknown[]; existing: unknown }[] }[];
    const listed = await json<Listed>('GET', '/api/provider-conflicts');
    expect(listed).toMatchObject([{
      connectionId,
      entries: [{ kind: 'exists', diveId: id, remoteId: 'L7', fields: [], existing: { remoteId: 'L7', remoteNumber: 4, startsAt: '2025-05-01 09:00' } }],
    }]);
    expect((await call('POST', `/api/dives/${id}/providers/ledger/decision`, { onExisting: 'link' })).statusCode).toBe(204);
    expect((await json<Listed>('GET', '/api/provider-conflicts'))).toEqual([]);
  });

  it('fetch-due answers how many it queued', async () => {
    await set(connectionId, { importMode: 'create', fetchEveryMinutes: 60, lastFetchedAt: null });
    await t.db.execute(sql`select graphile_worker.remove_job(key) from graphile_worker.jobs where task_identifier = 'scheduled_fetch'`);
    expect(await json('POST', '/api/connections/fetch-due')).toEqual({ queued: 1 });
    expect(await json('POST', '/api/connections/fetch-due', undefined, bob)).toEqual({ queued: 0 });
    await t.db.execute(sql`select graphile_worker.remove_job(key) from graphile_worker.jobs where task_identifier = 'scheduled_fetch'`);
  });

  it('the last fetch is told from its Import, not from the time it claimed its slot', async () => {
    const [made] = await t.db.insert(importJob).values({
      userId: annId, uploadName: 'Ledger', provider: 'ledger', connectionId, status: 'done', finishedAt: new Date(Date.UTC(year, 5, 1, 14, 2)),
      outcome: [
        { fileName: 'a', result: 'created', diveId: '00000000-0000-4000-8000-000000000001' },
        { fileName: 'b', result: 'created', diveId: '00000000-0000-4000-8000-000000000002' },
        { fileName: 'c', result: 'updated', diveId: '00000000-0000-4000-8000-000000000003' },
        { fileName: 'd', result: 'unchanged' },
        { fileName: 'e', result: 'skipped', reason: 'ambiguous' },
        { fileName: 'f', result: 'skipped', reason: 'no_computer_choice' },
      ],
    }).returning();
    await set(connectionId, { lastFetchImportId: made!.id, lastFetchedAt: new Date(Date.UTC(year, 5, 2, 8, 0)) });
    expect((await connectionRow()).lastFetch).toEqual({ at: new Date(Date.UTC(year, 5, 1, 14, 2)).toISOString(), created: 2, updated: 1, waitingForYou: 2, conflicts: 0 });
  });

  it('a Conflict waiting is counted apart from the entries a manual import asks about', async () => {
    ledger.tokens.set('ledger-token-1', { accountId: 'l-5', label: 'Ledger of Ann' });
    await set(connectionId, { importMode: 'create', fetchEveryMinutes: 60 });
    const id = await upload(new Date(Date.UTC(year, 4, 1, 9)));
    expect((await call('POST', `/api/dives/${id}/providers/ledger`, {})).statusCode).toBeLessThan(300);
    const remoteId = (await json<{ current: { remoteId: string } }>('GET', `/api/dives/${id}/providers/ledger`)).current.remoteId;
    await edit(id, 'Turtle');
    ledger.dives.get(remoteId)!.notes = 'Manta';
    await ctx.providers.scheduledFetch.fetch(connectionId);
    const importId = (await t.db.select().from(importJob).where(eq(importJob.connectionId, connectionId)))[0]!.id;
    await ctx.imports.processImport(importId);
    await ctx.providers.scheduledFetch.finished(importId);
    expect((await connectionRow()).lastFetch).toMatchObject({ created: 0, waitingForYou: 0, conflicts: 1 });
    expect((await t.db.select().from(importJob).where(and(eq(importJob.id, importId))))[0]!.status).toBe('done');
  });

  it('a Dive of a large Import is offered while it is not sent', async () => {
    const id = await upload(new Date(Date.UTC(year, 4, 3, 9)), 300);
    const [made] = await t.db.insert(importJob).values({
      userId: annId, uploadName: 'file.fit', status: 'done', outcome: [{ fileName: 'x', result: 'created', diveId: id }],
    }).returning();
    await set(connectionId, { unsentImportIds: [made!.id] });
    expect((await connectionRow()).unsentDives).toEqual([id]);
    // Sent meanwhile: nothing is offered any more, though the Import is still pointed at.
    expect((await call('POST', `/api/dives/${id}/providers/ledger`, {})).statusCode).toBeLessThan(300);
    expect((await connectionRow()).unsentDives).toEqual([]);
  });

  it('lists two Connections with offers and Conflicts as one each would', async () => {
    const lena = (await json<{ id: string }>('POST', '/api/divers', { name: 'Lena' })).id;
    ledger.tokens.set('ledger-token-2', { accountId: 'l-6', label: 'Ledger of Lena' });
    const other = (await json<{ id: string }>('POST', '/api/connections/ledger', { diverId: lena, token: 'ledger-token-2', keepSignedIn: false })).id;
    /** A Dive uploaded by Ann, then the Diver's. */
    const diveOf = async (owner: string, day: number) => {
      const id = await upload(new Date(Date.UTC(year, 4, day, 9)));
      if (owner !== diverId) await t.db.update(dive).set({ diverId: owner }).where(eq(dive.id, id));
      return id;
    };
    /** The Dive is sent through its Diver's Connection and has a Conflict there. */
    const clash = async (id: string, conn: string) => {
      expect((await call('POST', `/api/dives/${id}/providers/ledger`, {})).statusCode).toBeLessThan(300);
      const remoteId = (await json<{ current: { remoteId: string } }>('GET', `/api/dives/${id}/providers/ledger`)).current.remoteId;
      await record(t.db, { diveId: id, provider: 'ledger', connectionId: conn, remoteId, fields: [{ field: 'notes', hub: null, provider: 'Manta' }], runId: null, foundAt: new Date(ctx.clock.now()) });
    };
    const made = async (ids: string[]) => (await t.db.insert(importJob).values({
      userId: annId, uploadName: 'file.fit', status: 'done', outcome: ids.map((diveId, i) => ({ fileName: `${i}`, result: 'created' as const, diveId })),
    }).returning())[0]!.id;
    const [a1, a2, a3, l1, l2] = [await diveOf(diverId, 1), await diveOf(diverId, 2), await diveOf(diverId, 3), await diveOf(lena, 4), await diveOf(lena, 5)];
    await clash(a1!, connectionId);
    await clash(l1!, other);
    const [sent, ofAnn, ofLena] = [await made([a1!]), await made([a1!, a2!, a3!]), await made([l1!, l2!])];
    await set(connectionId, { unsentImportIds: [sent, ofAnn], lastFetchImportId: ofAnn });
    await set(other, { unsentImportIds: [ofLena], lastFetchImportId: ofLena });

    const imports = await json<{ id: string; unsentTo: unknown[] }[]>('GET', '/api/imports');
    const unsentTo = (id: string) => imports.find((i) => i.id === id)!.unsentTo;
    expect(unsentTo(sent)).toEqual([]);
    expect(unsentTo(ofAnn)).toEqual([{ connectionId, provider: 'ledger', count: 2 }]);
    expect(unsentTo(ofLena)).toEqual([{ connectionId: other, provider: 'ledger', count: 1 }]);
    const ofConn = async (id: string) => {
      const c = await connectionRow(id);
      return { unsentDives: c.unsentDives, created: c.lastFetch?.created, conflicts: c.lastFetch?.conflicts };
    };
    expect(await ofConn(connectionId)).toEqual({ unsentDives: [a2, a3], created: 3, conflicts: 1 });
    expect(await ofConn(other)).toEqual({ unsentDives: [l2], created: 2, conflicts: 1 });
    // The Import sent in full left the offer; the others stay.
    const stored = async (id: string) => (await t.db.select().from(connection).where(eq(connection.id, id)))[0]!.unsentImportIds;
    expect(await stored(connectionId)).toEqual([ofAnn]);
    expect(await stored(other)).toEqual([ofLena]);
  });

  it('a pair of a logbook check says where a Dive deletes itself at the Provider', async () => {
    // Two entries of the ledger that overlap become two Dives, both at the ledger through the Connection.
    await set(connectionId, { importMode: 'create', deleteAtProvider: true });
    ledger.seedRemote({ number: 1, startsAt: `${year}-05-04T12:13`, durationSeconds: 2640, maxDepthM: 13 });
    ledger.seedRemote({ number: 2, startsAt: `${year}-05-04T12:28`, durationSeconds: 2520, maxDepthM: 12.8 });
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
    expect(started.statusCode).toBe(202);
    await ctx.imports.processImport(started.json().id);
    type Check = { dive: { id: string }; other: { id: string; bothAt: string[]; deletesItself: string[] } | null };
    const pairs = async () => (await json<Check[]>('GET', '/api/logbook-checks')).filter((c) => c.other);
    expect((await pairs()).map((c) => c.other)).toMatchObject([{ bothAt: ['ledger'], deletesItself: ['ledger'] }]);
    await set(connectionId, { deleteAtProvider: false });
    expect((await pairs()).map((c) => c.other)).toMatchObject([{ bothAt: ['ledger'], deletesItself: [] }]);
  });
});
