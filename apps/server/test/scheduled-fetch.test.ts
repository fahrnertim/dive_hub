// The scheduled fetch (ADR 0056): the minute tick and the fetch on opening queue one job per due Connection, and the job
// starts the same Import a manual one would, unattended: what only the User can decide (an ambiguous entry, a computer
// without a choice, a Conflict) waits and is counted. Against the test ledger with dive import and the real database;
// the job is run as the worker runs it, without Graphile's runner.
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connection, diver, importJob, providerConflict, push, waitingPush, type ImportOutcome } from '../src/db/schema.js';
import { createScheduledFetch, SCHEDULED_FETCH_TASK } from '../src/providers/scheduled-fetch.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

const MINUTE = 60_000;
type DiveView = { id: string; version: number; notes: string | null; values: { startsAt: { at: string; utcOffsetSeconds: number | null } } };

// A year per test: a Dive deleted earlier is not imported again.
let year = 3300;

describe.skipIf(!(await databaseReachable()))('the scheduled fetch', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let bob: string;
  let annId: string;
  let diverId: string;
  let connectionId: string;
  const ledger = createFakeLedger({ imports: true });

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    (await call(method, url, payload, cookie)).json() as T;
  const now = () => ctx.clock.now();
  const ago = (minutes: number) => new Date(now() - minutes * MINUTE);
  const set = (id: string, values: Partial<typeof connection.$inferInsert>) => t.db.update(connection).set(values).where(eq(connection.id, id));
  const connOf = async (id: string) => (await t.db.select().from(connection).where(eq(connection.id, id)))[0]!;
  /** The Connections with a fetch job queued. */
  const queued = async () => (await t.db.execute(sql`select key from graphile_worker.jobs where task_identifier = ${SCHEDULED_FETCH_TASK} order by key`))
    .rows.map((r) => (r as { key: string }).key);
  const dropFetchJobs = () => t.db.execute(sql`select graphile_worker.remove_job(key) from graphile_worker.jobs where task_identifier = ${SCHEDULED_FETCH_TASK}`);
  const upload = async (start: Date, durationSeconds?: number) => {
    const { payload, headers } = multipartFile(`dive-${start.getTime()}.fit`, makeSyntheticDive({ serialNumber: 100, start, ...(durationSeconds && { durationSeconds }) }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
    await ctx.imports.processImport(created.json().id);
    return (await json<{ outcome: { diveId: string }[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!.diveId;
  };
  const diveOf = (id: string) => json<DiveView>('GET', `/api/dives/${id}`);
  /** The Dive's local start as the ledger keeps a start: "YYYY-MM-DDTHH:MM" plus `minutes`. */
  const localStartOf = async (id: string, minutes = 0) => {
    const { at, utcOffsetSeconds } = (await diveOf(id)).values.startsAt;
    return new Date(new Date(at).getTime() + (utcOffsetSeconds ?? 0) * 1000 + minutes * MINUTE).toISOString().slice(0, 16);
  };
  const edit = async (id: string, notes: string) => call('PATCH', `/api/dives/${id}`, { version: (await diveOf(id)).version, notes });
  /** Sends the Dive to the ledger: its remote dive. */
  const send = async (id: string) => {
    expect((await call('POST', `/api/dives/${id}/providers/ledger`, {})).statusCode).toBeLessThan(300);
    return (await json<{ current: { remoteId: string } }>('GET', `/api/dives/${id}/providers/ledger`)).current.remoteId;
  };
  /** The fetch job as the worker runs it, then its Import; the outcome, or null when it fetched nothing. */
  const runFetch = async (id = connectionId): Promise<ImportOutcome | null> => {
    const before = (await importsOf(id)).length;
    await ctx.providers.scheduledFetch.fetch(id);
    const started = await importsOf(id);
    if (started.length === before) return null;
    return ctx.imports.processImport(started.at(-1)!.id);
  };
  /** The Connection's Imports, oldest first. */
  const importsOf = (id: string) => t.db.select().from(importJob).where(eq(importJob.connectionId, id)).orderBy(importJob.createdAt);

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
    await dropFetchJobs();
    await t.db.delete(providerConflict);
    await t.db.delete(waitingPush);
    await t.db.delete(connection);
    await t.db.delete(push);
    const { dives } = await json<{ dives: { id: string }[] }>('GET', `/api/dives?limit=100&diverId=${diverId}`);
    for (const d of dives) await call('DELETE', `/api/dives/${d.id}`, { version: (await diveOf(d.id)).version });
    ledger.dives.clear();
    ledger.beforeList = null;
    ledger.tokens.clear();
    ledger.tokens.set('ledger-token-1', { accountId: 'l-5', label: 'Ledger of Ann' });
    ledger.tokens.set('ledger-token-2', { accountId: 'l-6', label: 'Ledger of Bob' });
    connectionId = (await json<{ id: string }>('POST', '/api/connections/ledger', { diverId, token: 'ledger-token-1', keepSignedIn: false })).id;
    await set(connectionId, { importMode: 'create', fetchEveryMinutes: 60 });
  });

  it('the tick fetches a Connection whose interval passed and not one fetched an hour ago with 6 h set', async () => {
    const bobDiver = (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers', undefined, bob)).find((d) => d.isOwn)!.id;
    const bobs = (await json<{ id: string }>('POST', '/api/connections/ledger', { diverId: bobDiver, token: 'ledger-token-2', keepSignedIn: false }, bob)).id;
    await set(connectionId, { lastFetchedAt: ago(61) });
    await set(bobs, { importMode: 'create', fetchEveryMinutes: 360, lastFetchedAt: ago(61) });
    await ctx.providers.scheduledFetch.tick();
    expect(await queued()).toEqual([`fetch:${connectionId}`]);
    expect(SCHEDULED_FETCH_TASK).toBe('scheduled_fetch');
    const reads = ledger.listReads;
    expect(await runFetch()).toEqual([]);
    expect(ledger.listReads).toBe(reads + 1);
    const after = await connOf(connectionId);
    expect(now() - after.lastFetchedAt!.getTime()).toBeLessThan(MINUTE);
    const made = (await importsOf(connectionId)).at(-1)!;
    expect(made).toMatchObject({ provider: 'ledger', connectionId, userId: annId, status: 'done' });
    expect(made!.plan).toMatchObject({ unattended: true, mode: 'create' });
  });

  it('fetch-due fetches after more than an hour, not after 30 minutes', async () => {
    await set(connectionId, { fetchEveryMinutes: 360, lastFetchedAt: ago(30) });
    expect(await json('POST', '/api/connections/fetch-due')).toEqual({ queued: 0 });
    expect(await queued()).toEqual([]);
    await set(connectionId, { lastFetchedAt: ago(61) });
    expect(await json('POST', '/api/connections/fetch-due')).toEqual({ queued: 1 });
    expect(await queued()).toEqual([`fetch:${connectionId}`]);
    // Without the schedule, opening fetches nothing; nor another User's opening.
    await dropFetchJobs();
    expect(await json('POST', '/api/connections/fetch-due', undefined, bob)).toEqual({ queued: 0 });
    await set(connectionId, { fetchEveryMinutes: null, lastFetchedAt: null });
    expect(await json('POST', '/api/connections/fetch-due')).toEqual({ queued: 0 });
    expect((await ctx.app.inject({ method: 'POST', url: '/api/connections/fetch-due', headers: { origin: BASE_URL } })).statusCode).toBe(401);
  });

  it('a new dive at the Provider becomes a Dive as a manual import makes it', async () => {
    const remoteId = ledger.seedRemote({ number: 1, startsAt: `${year}-05-01T09:00`, durationSeconds: 2400, maxDepthM: 18, notes: 'Reef' });
    const outcome = await runFetch();
    expect(outcome).toMatchObject([{ result: 'created', remoteId }]);
    const made = await diveOf(outcome![0]!.diveId!);
    expect(made.notes).toBe('Reef');
    expect((await json<{ current: { remoteId: string } }>('GET', `/api/dives/${made.id}/providers/ledger`)).current.remoteId).toBe(remoteId);
  });

  it('an ambiguous entry and a dive of a computer without a choice wait and are counted', async () => {
    const first = await upload(new Date(Date.UTC(year, 4, 1, 9)), 300);
    await upload(new Date(Date.UTC(year, 4, 1, 9, 10)), 300);
    const entry = ledger.seedRemote({ number: 1, startsAt: await localStartOf(first, 5), durationSeconds: 2400, maxDepthM: 18 });
    const computer = ledger.seedRemote({
      number: 2, startsAt: `${year}-06-01T09:00`, durationSeconds: 2400, maxDepthM: 20, device: { manufacturer: 'garmin', serialNumber: '777' },
    });
    const outcome = await runFetch();
    expect(outcome).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: 'skipped', reason: 'ambiguous', remoteId: entry }),
      expect.objectContaining({ result: 'skipped', reason: 'no_computer_choice', remoteId: computer }),
    ]));
    expect(outcome).toHaveLength(2);
    // The fetch chose nothing for the User; once they have, the next fetch takes the computer's dive.
    expect((await connOf(connectionId)).importComputers).toEqual({});
    await set(connectionId, { importComputers: { 'garmin:777': 'entries' }, lastFetchedAt: null });
    expect(await runFetch()).toEqual(expect.arrayContaining([expect.objectContaining({ result: 'created', remoteId: computer })]));
  });

  it('a Conflict from a fetch waits in Needs your decision', async () => {
    const id = await upload(new Date(Date.UTC(year, 4, 1, 9)));
    const remoteId = await send(id);
    await edit(id, 'Turtle');
    ledger.dives.get(remoteId)!.notes = 'Manta';
    await runFetch();
    expect((await diveOf(id)).notes).toBe('Turtle');
    const connections = await json<{ connectionId: string; entries: { diveId: string; fields: unknown[] }[] }[]>('GET', '/api/provider-conflicts');
    expect(connections).toMatchObject([{ connectionId, entries: [{ diveId: id, fields: [{ field: 'notes', hub: 'Turtle', provider: 'Manta' }] }] }]);
    expect((await t.db.select().from(providerConflict))[0]!.runId).toBeNull();
  });

  it('a token-only Connection that needs a sign-in is not fetched', async () => {
    await set(connectionId, { state: 'needs_sign_in', lastFetchedAt: ago(120) });
    await ctx.providers.scheduledFetch.tick();
    expect(await queued()).toEqual([]);
    expect(await json('POST', '/api/connections/fetch-due')).toEqual({ queued: 0 });
    const reads = ledger.listReads;
    expect(await runFetch()).toBeNull();
    expect(ledger.listReads).toBe(reads);
  });

  it('a Connection with import off, or with an import waiting, is not fetched', async () => {
    await set(connectionId, { importMode: 'off' });
    const reads = ledger.listReads;
    expect(await runFetch()).toBeNull();
    await set(connectionId, { importMode: 'create' });
    const [waiting] = await t.db.insert(importJob).values({ userId: annId, uploadName: 'Ledger', provider: 'ledger', connectionId }).returning();
    await ctx.providers.scheduledFetch.tick();
    expect(await queued()).toEqual([]);
    expect(await runFetch()).toBeNull();
    expect(ledger.listReads).toBe(reads);
    await t.db.delete(importJob).where(and(eq(importJob.id, waiting!.id)));
  });

  it('a scheduled read never comes sooner than fetchEveryMinutes', async () => {
    expect(await runFetch()).toEqual([]);
    const reads = ledger.listReads;
    ctx.clock.skip(30 * MINUTE);
    await ctx.providers.scheduledFetch.tick();
    expect(await queued()).toEqual([]);
    // A job queued earlier (by the opening) reads nothing either.
    expect(await runFetch()).toBeNull();
    expect(ledger.listReads).toBe(reads);
    ctx.clock.skip(30 * MINUTE);
    await ctx.providers.scheduledFetch.tick();
    expect(await queued()).toEqual([`fetch:${connectionId}`]);
  });

  it('a second fetch while the first is reading does not read again', async () => {
    ledger.seedRemote({ number: 1, startsAt: `${year}-05-01T09:00`, durationSeconds: 2400, maxDepthM: 18 });
    const reads = ledger.listReads;
    let second: Promise<void> | undefined;
    // A tick or the opening queued the Connection again while its job was reading.
    ledger.beforeList = async () => {
      ledger.beforeList = null;
      second = ctx.providers.scheduledFetch.fetch(connectionId);
    };
    await ctx.providers.scheduledFetch.fetch(connectionId);
    await second;
    expect(ledger.listReads).toBe(reads + 1);
    expect(await t.db.select().from(importJob).where(eq(importJob.connectionId, connectionId))).toHaveLength(1);
  });

  it('a successful fetch wakes the Provider\'s entries stopped as unavailable', async () => {
    const id = await upload(new Date(Date.UTC(year, 4, 1, 9)));
    await send(id);
    await set(connectionId, { lastUsedAt: ago(10) });
    await t.db.insert(waitingPush).values({
      diveId: id, provider: 'ledger', connectionId, action: 'send', state: 'stopped', reason: 'provider_unavailable',
      dueAt: ago(5), stoppedAt: ago(5), changedAt: ago(5),
    });
    await ctx.providers.waitingPushes.tick();
    expect((await t.db.select().from(waitingPush))[0]!.state).toBe('stopped');
    await runFetch();
    await ctx.providers.waitingPushes.tick();
    expect((await t.db.select().from(waitingPush))[0]).toMatchObject({ state: 'waiting', reason: null });
  });

  it('a fetch finds a Dive gone at the Provider as a manual read does', async () => {
    const id = await upload(new Date(Date.UTC(year, 4, 1, 9)));
    const remoteId = await send(id);
    ledger.seedRemote({ number: 7, startsAt: `${year}-07-01T09:00`, durationSeconds: 2400, maxDepthM: 12 });
    ledger.dives.delete(remoteId);
    await set(connectionId, { importMode: 'add' });
    await runFetch();
    const gone = await json<{ connectionId: string; dives: { diveId: string }[] }[]>('GET', '/api/gone-dives');
    expect(gone).toMatchObject([{ connectionId, dives: [{ diveId: id }] }]);
  });

  it('a fetch the Provider refuses is logged for the operator', async () => {
    const warn = vi.fn();
    const fetching = createScheduledFetch({ db: t.db, registry: ctx.providers.providers, diveImports: ctx.providers.diveImports, clock: ctx.clock, log: { error: () => {}, warn } });
    ledger.down = true;
    try {
      await fetching.fetch(connectionId);
    } finally {
      ledger.down = false;
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ connectionId, code: 'provider_unavailable' }), expect.any(String));
  });

  it('the tick asks about running Imports once, not per Connection', async () => {
    const extra = [];
    for (let i = 0; i < 2; i++) {
      const [other] = await t.db.insert(diver).values({ name: `Diver ${i}` }).returning();
      const made = (await t.db.insert(connection).values({
        userId: annId, diverId: other!.id, provider: 'ledger', accountId: `extra-${i}`, accountLabel: `Ledger ${i}`, keepSignedIn: false, importMode: 'create', fetchEveryMinutes: 60,
      }).returning())[0]!;
      extra.push(made.id);
    }
    const [running] = await t.db.insert(importJob).values({ userId: annId, uploadName: 'Ledger', provider: 'ledger', connectionId: extra[1]!, status: 'processing' }).returning();
    await ctx.providers.scheduledFetch.tick();
    expect(await queued()).toEqual([`fetch:${connectionId}`, `fetch:${extra[0]}`].sort());
    await t.db.delete(importJob).where(eq(importJob.id, running!.id));
  });

  it('a running or failed fetch leaves the last finished one as the summary', async () => {
    const fetched = async () => {
      await set(connectionId, { lastFetchedAt: null });
      await ctx.providers.scheduledFetch.fetch(connectionId);
      return (await importsOf(connectionId)).at(-1)!;
    };
    const first = await fetched();
    expect((await connOf(connectionId)).lastFetchImportId).toBeNull();
    await ctx.imports.processImport(first.id);
    await ctx.providers.scheduledFetch.finished(first.id);
    expect((await connOf(connectionId)).lastFetchImportId).toBe(first.id);
    // The second fetch's Import fails: the first stays.
    const second = await fetched();
    await t.db.update(importJob).set({ status: 'failed' }).where(eq(importJob.id, second.id));
    await ctx.providers.scheduledFetch.finished(second.id);
    expect((await connOf(connectionId)).lastFetchImportId).toBe(first.id);
    // A finished Import older than the stored one changes nothing.
    await t.db.update(importJob).set({ status: 'done' }).where(eq(importJob.id, second.id));
    await ctx.providers.scheduledFetch.finished(second.id);
    expect((await connOf(connectionId)).lastFetchImportId).toBe(second.id);
    await ctx.providers.scheduledFetch.finished(first.id);
    expect((await connOf(connectionId)).lastFetchImportId).toBe(second.id);
  });
});
