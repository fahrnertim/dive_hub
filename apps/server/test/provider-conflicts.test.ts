// Conflicts with a Provider, stored per Dive and Provider and listed for "Needs your decision": the service the send
// will call (record, openFields, close) and the listing route, against a fake ledger Provider and the real database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { providerConflict } from '../src/db/schema.js';
import { close, openFields, record, type ConflictField } from '../src/providers/conflicts.js';
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
  const ledger = createFakeLedger();

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
  const entry = (diveId: string, remoteId: string, f = fields('Manta')) => ({ diveId, provider: 'ledger', connectionId, remoteId, fields: f, runId: null });

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
    expect(connections[0]!.entries).toMatchObject([{ diveId, remoteId, fields: fields('Manta') }]);
    expect(await openFields(t.db, diveId, 'ledger')).toEqual(['notes', 'maxDepthM']);
    await close(t.db, diveId, 'ledger');
    expect(await openFields(t.db, diveId, 'ledger')).toEqual([]);
    expect((await listed()).connections).toEqual([]);
  });

  it('recording twice keeps one entry with the newer fields', async () => {
    const { diveId, remoteId } = await sentDive();
    await record(t.db, entry(diveId, remoteId));
    await record(t.db, entry(diveId, remoteId, [{ field: 'notes', hub: 'Turtle', provider: 'Ray' }]));
    expect(await t.db.select().from(providerConflict)).toHaveLength(1);
    expect((await listed()).connections[0]!.entries).toMatchObject([{ fields: [{ field: 'notes', hub: 'Turtle', provider: 'Ray' }] }]);
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

  it('another User sees none of it', async () => {
    const { diveId, remoteId } = await sentDive();
    await record(t.db, entry(diveId, remoteId));
    expect((await listed(bob)).connections).toEqual([]);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/provider-conflicts' })).statusCode).toBe(401);
  });
});
