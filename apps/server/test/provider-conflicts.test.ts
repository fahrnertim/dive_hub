// Conflicts with a Provider, stored per Dive and Provider and listed for "Needs your decision": the service the send
// will call (record, openFields, close) and the listing route, against a fake ledger Provider and the real database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connection, providerConflict, push, waitingPush } from '../src/db/schema.js';
import { close, openFields, record, type ConflictField, type StoredConflictField } from '../src/providers/conflicts.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Listed = {
  connections: { connectionId: string; provider: string; providerName: string; entries: {
    diveId: string; number: number | null; remoteId: string; fields: ConflictField[]; site: { name: string } | null; durationSeconds: number;
  }[] }[];
};

let year = 3100;

describe.skipIf(!(await databaseReachable()))('Conflicts with a Provider', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let bob: string;
  let diverId: string;
  let connectionId: string;
  const ledger = createFakeLedger({ imports: true });

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    (await call(method, url, payload, cookie)).json() as T;
  const listed = (cookie = ann) => json<Listed>('GET', '/api/provider-conflicts', undefined, cookie);
  /** A Dive of Ann's that is at the ledger. */
  const sentDive = async () => {
    year++;
    const { payload, headers } = multipartFile(`dive-${year}.fit`, makeSyntheticDive({ serialNumber: 100, start: new Date(Date.UTC(year, 4, 1, 9)) }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
    await ctx.imports.processImport(created.json().id);
    const diveId = (await json<{ outcome: { diveId: string }[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!.diveId;
    expect((await call('POST', `/api/dives/${diveId}/providers/ledger`, {})).statusCode).toBeLessThan(300);
    const status = await json<{ current: { remoteId: string } }>('GET', `/api/dives/${diveId}/providers/ledger`);
    return { diveId, remoteId: status.current.remoteId };
  };
  const fields = (notes: string): ConflictField[] => [
    { field: 'notes', hub: 'Turtle', provider: notes },
    { field: 'maxDepthM', hub: 18, provider: 19.5 },
  ];
  const entry = (diveId: string, remoteId: string, f: StoredConflictField[] = fields('Manta')) => ({ diveId, provider: 'ledger', connectionId, remoteId, fields: f, runId: null, foundAt: new Date(ctx.clock.now()) });
  /** The Dive's max depth now (the FIT Dive's, from its Recording). */
  const maxDepthOf = async (diveId: string) => (await json<{ values: { maxDepthM: number } }>('GET', `/api/dives/${diveId}`)).values.maxDepthM;

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
    await t.db.delete(providerConflict);
    ledger.dives.clear();
    if (!ledger.tokens.size) ledger.tokens.set('ledger-token-1', { accountId: 'l-5', label: 'Ledger of Erika' });
  });

  it('a recorded conflict is listed for its User with both values', async () => {
    const { diveId, remoteId } = await sentDive();
    await record(t.db, entry(diveId, remoteId));
    const { connections } = await listed();
    expect(connections).toMatchObject([{ connectionId, provider: 'ledger', providerName: 'Ledger' }]);
    expect(connections[0]!.entries).toMatchObject([{ diveId, remoteId, fields: [
      { field: 'notes', hub: null, provider: 'Manta' }, { field: 'maxDepthM', hub: await maxDepthOf(diveId), provider: 19.5 },
    ] }]);
    expect(await openFields(t.db, diveId, 'ledger')).toEqual(['notes', 'maxDepthM']);
    await close(t.db, diveId, 'ledger');
    expect(await openFields(t.db, diveId, 'ledger')).toEqual([]);
    expect((await listed()).connections).toEqual([]);
  });

  it('a choice marks the entry queued, from the server; a Conflict found again is open again', async () => {
    const { diveId, remoteId } = await sentDive();
    await record(t.db, entry(diveId, remoteId));
    expect((await listed()).connections[0]!.entries).toMatchObject([{ diveId, queued: false }]);
    const decided = await call('POST', '/api/dives/' + diveId + '/providers/ledger/decision', { conflicts: { notes: 'hub', maxDepthM: 'hub' } });
    expect(decided.statusCode).toBe(204);
    expect((await listed()).connections[0]!.entries).toMatchObject([{ diveId, queued: true }]);
    // The send ends in a new Conflict for the Dive: the question is open again. The choice was queued a moment before.
    ctx.clock.skip(1_000);
    await record(t.db, entry(diveId, remoteId, fields('Ray')));
    expect((await listed()).connections[0]!.entries).toMatchObject([{ diveId, queued: false }]);
    await t.db.delete(waitingPush).where(eq(waitingPush.diveId, diveId));
  });

  it('recording twice keeps one entry with the newer fields', async () => {
    const { diveId, remoteId } = await sentDive();
    await record(t.db, entry(diveId, remoteId));
    await record(t.db, entry(diveId, remoteId, [{ field: 'notes', hub: 'Turtle', provider: 'Ray' }]));
    expect(await t.db.select().from(providerConflict)).toHaveLength(1);
    expect((await listed()).connections[0]!.entries).toMatchObject([{ fields: [{ field: 'notes', hub: null, provider: 'Ray' }] }]);
    expect(await openFields(t.db, diveId, 'ledger')).toEqual(['notes']);
  });

  it('a deleted Dive\'s entry and one whose remote dive changed are not listed', async () => {
    const gone = await sentDive();
    const moved = await sentDive();
    await record(t.db, entry(gone.diveId, gone.remoteId));
    await record(t.db, entry(moved.diveId, moved.remoteId));
    expect((await listed()).connections[0]!.entries).toHaveLength(2);
    const version = (await json<{ version: number }>('GET', `/api/dives/${gone.diveId}`)).version;
    await call('DELETE', `/api/dives/${gone.diveId}`, { version });
    // Deleted at the Provider and sent anew: the Dive has another remote dive now.
    await call('DELETE', `/api/dives/${moved.diveId}/providers/ledger`, {});
    await call('POST', `/api/dives/${moved.diveId}/providers/ledger`, {});
    expect((await json<{ current: { remoteId: string } }>('GET', `/api/dives/${moved.diveId}/providers/ledger`)).current.remoteId).not.toBe(moved.remoteId);
    expect((await listed()).connections).toEqual([]);
  });

  it('another User with a Connection of his own at the same Provider sees none of it', async () => {
    const { diveId, remoteId } = await sentDive();
    await record(t.db, entry(diveId, remoteId));
    ledger.tokens.set('ledger-token-2', { accountId: 'l-6', label: 'Ledger of Bob' });
    const bobDiver = (await json<{ id: string }[]>('GET', '/api/divers', undefined, bob))[0]!.id;
    const own = await json<{ id: string }>('POST', '/api/connections/ledger', { diverId: bobDiver, token: 'ledger-token-2', keepSignedIn: false }, bob);
    expect((await listed(bob)).connections).toEqual([]);
    expect((await listed()).connections[0]!.entries).toHaveLength(1);
    await call('DELETE', `/api/connections/${own.id}`, undefined, bob);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/provider-conflicts' })).statusCode).toBe(401);
  });

  /** A Dive sent with notes "Turtle", whose notes are "Manta" at the ledger now, with an open entry on its notes. */
  const openOnNotes = async () => {
    const { diveId, remoteId } = await sentDive();
    const version = (await json<{ version: number }>('GET', `/api/dives/${diveId}`)).version;
    await call('PATCH', `/api/dives/${diveId}`, { version, notes: 'Turtle' });
    expect((await call('POST', `/api/dives/${diveId}/providers/ledger`, {})).statusCode).toBeLessThan(300);
    ledger.dives.get(remoteId)!.notes = 'Manta';
    await record(t.db, entry(diveId, remoteId, [{ field: 'notes', hub: 'Turtle', provider: 'Manta', compared: { provider: 'Manta', siteSource: null } }]));
    await t.db.update(connection).set({ importMode: 'add', fetchEveryMinutes: 60, lastFetchedAt: null }).where(eq(connection.id, connectionId));
    return { diveId, remoteId };
  };
  const notesOf = async (diveId: string) => (await json<{ notes: string | null }>('GET', `/api/dives/${diveId}`)).notes;
  /** A manual import with these choices, run as the worker runs it. */
  const manualImport = async (conflicts: { remoteId: string; field: string; choice: string }[] = []) => {
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [], conflicts });
    expect(started.statusCode).toBe(202);
    return ctx.imports.processImport(started.json<{ id: string }>().id);
  };

  it('an open Conflict holds its fields in an import', async () => {
    const { diveId } = await openOnNotes();
    const [before] = await t.db.select().from(providerConflict);
    // Changed only at the ledger since the send, but held by the open entry: neither a fetch nor a manual import takes it.
    await ctx.providers.scheduledFetch.fetch(connectionId);
    const fetched = (await t.db.select().from(connection).where(eq(connection.id, connectionId)))[0]!.lastFetchImportId!;
    await ctx.imports.processImport(fetched);
    await manualImport();
    expect(await notesOf(diveId)).toBe('Turtle');
    // Raised once: the same entry, found when it was found.
    const after = await t.db.select().from(providerConflict);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ foundAt: before!.foundAt, fields: [{ field: 'notes', hub: 'Turtle', provider: 'Manta' }] });
    // Nor does a send as the worker makes it send the clashed field.
    const annId = (await t.db.select({ userId: connection.userId }).from(connection).where(eq(connection.id, connectionId)))[0]!.userId;
    await ctx.providers.pushes.send(annId, diveId, 'ledger', { onConflict: 'defer' });
    expect([...ledger.dives.values()].map((d) => d.notes)).toEqual(['Manta']);
    expect(await notesOf(diveId)).toBe('Turtle');
    expect(await openFields(t.db, diveId, 'ledger')).toEqual(['notes']);
  });

  it('a manual preview\'s choice closes the open entry', async () => {
    const { diveId, remoteId } = await openOnNotes();
    const preview = await json<{ counts: { changed: number }; conflicts: { diveId: string; field: string; hub: unknown; provider: unknown }[] }>(
      'GET', `/api/connections/${connectionId}/dive-import`,
    );
    expect(preview.conflicts).toMatchObject([{ diveId, field: 'notes', hub: 'Turtle', provider: 'Manta' }]);
    expect(preview.counts.changed).toBe(0);
    await manualImport([{ remoteId, field: 'notes', choice: 'provider' }]);
    expect(await notesOf(diveId)).toBe('Manta');
    expect(await openFields(t.db, diveId, 'ledger')).toEqual([]);
    expect((await listed()).connections).toEqual([]);
  });

  it('keeping Dive Hub\'s value in a manual preview closes the field and queues the Dive', async () => {
    const { diveId, remoteId } = await openOnNotes();
    await t.db.delete(waitingPush);
    await manualImport([{ remoteId, field: 'notes', choice: 'hub' }]);
    expect(await notesOf(diveId)).toBe('Turtle');
    expect(await openFields(t.db, diveId, 'ledger')).toEqual([]);
    expect(await t.db.select().from(waitingPush)).toMatchObject([
      { diveId, provider: 'ledger', connectionId, action: 'send', state: 'waiting', options: { conflicts: { notes: 'hub' } } },
    ]);
  });

  it('keeping Dive Hub\'s value queues nothing through a Connection that is no longer the Diver\'s', async () => {
    const { diveId, remoteId } = await openOnNotes();
    await t.db.delete(waitingPush);
    const bobsDiver = (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers', undefined, bob)).find((d) => d.isOwn)!.id;
    await t.db.update(connection).set({ diverId: bobsDiver }).where(eq(connection.id, connectionId));
    try {
      await manualImport([{ remoteId, field: 'notes', choice: 'hub' }]);
      expect(await t.db.select().from(waitingPush)).toEqual([]);
    } finally {
      await t.db.update(connection).set({ diverId }).where(eq(connection.id, connectionId));
    }
    expect(diveId).toBeTruthy();
  });

  const setNotes = async (diveId: string, notes: string) => {
    const version = (await json<{ version: number }>('GET', `/api/dives/${diveId}`)).version;
    expect((await call('PATCH', `/api/dives/${diveId}`, { version, notes })).statusCode).toBe(200);
  };

  it("says Dive Hub's value as the Dive is now, and leaves out a field whose sides became equal", async () => {
    const { diveId, remoteId } = await sentDive();
    await record(t.db, entry(diveId, remoteId, [{ field: 'notes', hub: 'Turtle', provider: 'Manta', compared: { provider: 'Manta', siteSource: null } }]));
    // The Connection's count comes with its last fetch: make one.
    await t.db.update(connection).set({ importMode: 'add', fetchEveryMinutes: 60, lastFetchedAt: null }).where(eq(connection.id, connectionId));
    await ctx.providers.scheduledFetch.fetch(connectionId);
    const counted = async () => (await json<{ id: string; lastFetch: { conflicts: number } }[]>('GET', '/api/connections'))
      .find((c) => c.id === connectionId)!.lastFetch.conflicts;
    await setNotes(diveId, 'Reef');
    expect((await listed()).connections[0]!.entries[0]!.fields).toEqual([{ field: 'notes', hub: 'Reef', provider: 'Manta' }]);
    expect(await counted()).toBe(1);
    await setNotes(diveId, 'Manta');
    expect((await listed()).connections).toEqual([]);
    expect(await counted()).toBe(0);
  });

  it('an entry stored without comparable values compares the shown ones', async () => {
    const { diveId, remoteId } = await sentDive();
    await record(t.db, entry(diveId, remoteId, fields('Manta')));
    await setNotes(diveId, 'Manta');
    // The max depth isn't compared (the FIT Dive has a Recording): it stays, with the Dive's value now.
    expect((await listed()).connections[0]!.entries[0]!.fields).toEqual([{ field: 'maxDepthM', hub: await maxDepthOf(diveId), provider: 19.5 }]);
  });

  it('leaves out the Connection of a Provider this instance does not offer', async () => {
    const { diveId, remoteId } = await sentDive();
    await record(t.db, entry(diveId, remoteId));
    expect((await listed()).connections).toHaveLength(1);
    // The Connection and the Dive's Push now belong to a Provider that is not registered: only that can leave it out.
    await t.db.update(connection).set({ provider: 'retired' }).where(eq(connection.id, connectionId));
    await t.db.update(push).set({ provider: 'retired' }).where(eq(push.diveId, diveId));
    await t.db.update(providerConflict).set({ provider: 'retired' }).where(eq(providerConflict.diveId, diveId));
    try {
      expect((await listed()).connections).toEqual([]);
    } finally {
      await t.db.update(connection).set({ provider: 'ledger' }).where(eq(connection.id, connectionId));
    }
  });
});
