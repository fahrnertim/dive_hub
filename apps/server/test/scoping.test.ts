// Every route shows only what the signed-in User may see: their Imports and the Dives of the Divers
// they manage. Another User's Dives, Recordings, Imports and Originals stay invisible and untouched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

describe.skipIf(!(await databaseReachable()))('scoping to the signed-in User', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let alice: string;
  let bob: string;
  let alicesImport: { id: string; outcome: { result: string; diveId?: string; recordingId?: string }[] };

  const get = (url: string, cookie: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie } });

  /** Uploads like the web client, then runs the Import's job as the worker would. */
  async function upload(cookie: string, fileName: string, data: Uint8Array) {
    const { payload, headers } = multipartFile(fileName, data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    expect(response.statusCode).toBe(202);
    await ctx.imports.processImport(response.json().id);
    return (await get(`/api/imports/${response.json().id}`, cookie)).json();
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'alice@example.com');
    await createUser(ctx.auth, 'bob@example.com');
    alice = await signIn(ctx.app, 'alice@example.com');
    bob = await signIn(ctx.app, 'bob@example.com');
    alicesImport = await upload(alice, 'alice.fit', makeSyntheticDive({ serialNumber: 111 }));
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('files an upload under the User who sent it', async () => {
    expect(alicesImport.outcome).toEqual([expect.objectContaining({ result: 'created' })]);
    expect((await get('/api/dives', alice)).json()).toHaveLength(1);
  });

  it("hides another User's Dives and Recordings", async () => {
    const { diveId, recordingId } = alicesImport.outcome[0]!;
    expect((await get('/api/dives', bob)).json()).toEqual([]);
    expect((await get(`/api/dives/${diveId}`, bob)).statusCode).toBe(404);
    expect((await get(`/api/recordings/${recordingId}/samples`, bob)).statusCode).toBe(404);
    // Alice can still see both.
    expect((await get(`/api/dives/${diveId}`, alice)).statusCode).toBe(200);
    expect((await get(`/api/recordings/${recordingId}/samples`, alice)).statusCode).toBe(200);
  });

  it("hides another User's Imports", async () => {
    expect((await get('/api/imports', bob)).json()).toEqual([]);
    expect((await get(`/api/imports/${alicesImport.id}`, bob)).statusCode).toBe(404);
  });

  it("doesn't let an upload reach into another User's logbook", async () => {
    // Bob uploads the very same file: its Device belongs to Alice's Diver.
    const bobsImport = await upload(bob, 'copy-of-alice.fit', makeSyntheticDive({ serialNumber: 111 }));
    expect(bobsImport.outcome).toEqual([expect.objectContaining({ result: 'skipped' })]);
    expect((await get('/api/dives', bob)).json()).toEqual([]);

    // Alice's Dive is unchanged, and her Import still names her own file as its Original.
    const dive = (await get(`/api/dives/${alicesImport.outcome[0]!.diveId}`, alice)).json();
    expect(dive.recordings).toHaveLength(1);
    expect((await get('/api/imports', alice)).json()).toHaveLength(1);
  });

  it("doesn't file a new dive from another User's Device into their logbook", async () => {
    const later = makeSyntheticDive({ serialNumber: 111, start: new Date('2026-01-16T09:00:00Z') });
    const bobsImport = await upload(bob, 'later-on-alices-watch.fit', later);
    expect(bobsImport.outcome).toEqual([expect.objectContaining({ result: 'skipped' })]);
    expect((await get('/api/dives', alice)).json()).toHaveLength(1);
    expect((await get('/api/dives', bob)).json()).toEqual([]);
  });

  it("keeps each User's own uploads separate when they dive with different Devices", async () => {
    const bobsImport = await upload(bob, 'bob.fit', makeSyntheticDive({ serialNumber: 222 }));
    expect(bobsImport.outcome).toEqual([expect.objectContaining({ result: 'created' })]);
    expect((await get('/api/dives', bob)).json()).toHaveLength(1);
    expect((await get('/api/dives', alice)).json()).toHaveLength(1);
  });
});
