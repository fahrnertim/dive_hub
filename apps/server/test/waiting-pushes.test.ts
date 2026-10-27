// The queue of Waiting pushes (ADR 0056): a change to a Dive puts it in the queue once per Provider, due after a quiet
// period, and the Connection's job runs at the earliest due time. Rows are read from the table (the API comes later).
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connection, dive, diveSiteExternalId, importJob, providerConflict, push, revision, waitingPush } from '../src/db/schema.js';
import { writeRevision } from '../src/dives/revisions.js';
import { mark, QUIET_MS, settle, WAITING_PUSHES_TASK } from '../src/providers/waiting-push-queue.js';
import { createWaitingPushService, GIVE_UP_MS, RETRY_AFTER_MS } from '../src/providers/waiting-push-service.js';
import type { ImportedValues, SiteSourceAdapter, SourceSite } from '../src/sites/import/site-source.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { handTypedDive } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Position = { latitude: number; longitude: number };
const HOUSE_REEF = { latitude: 28.495, longitude: 34.516 };
const northBy = (m: number): Position => ({ latitude: HOUSE_REEF.latitude + m / 111_195, longitude: HOUSE_REEF.longitude });

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
  let admin: string;
  // A Site source that answers with what the test put there.
  let osmSites: SourceSite[] = [];
  const stand = (source: 'osm' | 'wikidata' | 'ssi'): SiteSourceAdapter => ({ source, fetch: async () => (source === 'osm' ? osmSites : []) });

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
    ctx = await createTestApp(t, { extraProviders: [ledger.adapter], siteSources: { osm: stand('osm'), wikidata: stand('wikidata'), ssi: stand('ssi') } });
    await createUser(ctx.auth, 'admin@example.com', 'admin');
    admin = await signIn(ctx.app, 'admin@example.com');
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

  /** A sent Dive at a site without a position (or with one), the queue empty. */
  const sentAt = async (siteId: string) => {
    const id = await upload(day(1));
    await call('PATCH', `/api/dives/${id}`, { version: await version(id), siteId });
    await send(id);
    return id;
  };

  it('a site merge that gives the kept site a position queues the Dives already there', async () => {
    const kept = await json<{ id: string; version: number }>('POST', '/api/dive-sites', { name: 'Site K' });
    const merged = await json<{ id: string; version: number }>('POST', '/api/dive-sites', { name: 'Site M', position: northBy(0) });
    const id = await sentAt(kept.id);
    const done = await call('POST', `/api/dive-sites/${merged.id}/merge`, { intoId: kept.id, version: merged.version, intoVersion: kept.version });
    expect(done.statusCode).toBe(200);
    expect(await rows()).toMatchObject([{ diveId: id, action: 'send' }]);
  });

  it('taking up the position a Source offers for a site queues its Dives', async () => {
    const site = await json<{ id: string; version: number }>('POST', '/api/dive-sites', { name: 'Hausriff' });
    const id = await sentAt(site.id);
    await t.db.insert(diveSiteExternalId).values({
      siteId: site.id, source: 'osm', externalId: 'node/1', imported: { name: 'Hausriff', position: northBy(0), country: null, waterBody: null, description: null, maxDepthM: null, waterType: null } satisfies ImportedValues,
    });
    expect((await call('POST', `/api/dive-sites/${site.id}/adopt`, { source: 'osm', version: site.version })).statusCode).toBe(200);
    expect(await rows()).toMatchObject([{ diveId: id, action: 'send' }]);
  });

  it('a Site import that moves a site queues its Dives', async () => {
    const values = (position: Position): ImportedValues => ({ name: 'Import Reef', position, country: 'EG', waterBody: null, description: null, maxDepthM: null, waterType: null });
    const runImport = async () => {
      const started = await call('POST', '/api/admin/site-imports', { sources: ['osm'], area: { kind: 'country', country: 'EG' }, language: 'en', confirmOdbl: true }, admin);
      expect(started.statusCode).toBe(202);
      await ctx.siteImports.run(started.json().id);
    };
    osmSites = [{ source: 'osm', externalId: 'node/77', values: values(northBy(0)), sameAs: {} }];
    await runImport();
    const site = (await json<{ sites: { id: string; name: string }[] }>('GET', '/api/dive-sites?q=Import%20Reef')).sites.find((x) => x.name === 'Import Reef')!;
    const id = await sentAt(site.id);
    osmSites = [{ source: 'osm', externalId: 'node/77', values: values(northBy(800)), sameAs: {} }];
    await runImport();
    expect(await rows()).toMatchObject([{ diveId: id, action: 'send' }]);
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
    // Marked before the change, as a send that began then: the change may not have gone out.
    const before = await mark(t.db, id, 'ledger');
    expect(before).toBeNull();
    await edit(id, 'Turtle');
    const [row] = await rows();
    await t.db.update(waitingPush).set({ state: 'held', reason: 'exists', attempts: 2 }).where(eq(waitingPush.diveId, id));
    await settle(t.db, id, 'ledger', before);
    expect(await rows()).toMatchObject([{ diveId: id, state: 'waiting', reason: null, attempts: 0 }]);
    expect((await rows())[0]!.dueAt.getTime()).toBe(row!.changedAt.getTime() + QUIET_MS);
    // Marked after it: the send carried it.
    await settle(t.db, id, 'ledger', await mark(t.db, id, 'ledger'));
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

  describe('the worker step', () => {
    const step = (id = connectionId) => ctx.providers.waitingPushes.step(id);
    const of = async (provider = 'ledger') => (await rows()).filter((r) => r.provider === provider);
    /** Moves the clock to the entry's due time, as if the worker's job ran then. */
    const untilDue = async (provider = 'ledger') => {
      const [row] = await of(provider);
      ctx.clock.skip(Math.max(0, row!.dueAt.getTime() - ctx.clock.now()));
    };
    const remoteOf = async (id: string, provider = 'ledger') =>
      (await json<{ provider: string; current: { remoteId: string } | null }[]>('GET', `/api/dives/${id}/providers`)).find((s) => s.provider === provider)!.current;
    const ledgerNotes = async (id: string) => ledger.dives.get((await remoteOf(id))!.remoteId)?.notes;
    let saves = 0;
    const counting = async () => { saves++; };
    /** An edited sent Dive whose entry waits. */
    const waiting = async (notes = 'Turtle') => {
      const id = await upload(day(1));
      await send(id);
      await edit(id, notes);
      expect(await rows()).toHaveLength(1);
      return id;
    };
    /** Steps through the failures of an entry until it stops: the delay before each next attempt, in minutes. */
    const failUntilStopped = async (stepOnce: () => Promise<unknown> = step) => {
      const delays: number[] = [];
      for (let i = 0; i < 20; i++) {
        const [before] = await rows();
        if (before!.state === 'stopped') break;
        ctx.clock.skip(Math.max(0, before!.dueAt.getTime() - ctx.clock.now()));
        const at = ctx.clock.now();
        await stepOnce();
        const [after] = await rows();
        if (after!.state === 'waiting') delays.push(Math.round((after!.dueAt.getTime() - at) / 60_000));
      }
      return delays;
    };
    const bobsConnection = async () => {
      const bobsDiver = (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers', undefined, bob)).find((d) => d.isOwn)!.id;
      return (await json<{ id: string }>('POST', '/api/connections/ledger', { diverId: bobsDiver, token: 'ledger-token-2', keepSignedIn: false }, bob)).id;
    };

    // SSI reads its record before an update and finds a dive at the same time, which the ledger can't.
    let ssiSite: string | null = null;
    const atSsiSite = async (id: string) => {
      if (!ssiSite) {
        ssiSite = (await json<{ id: string }>('POST', '/api/dive-sites', { name: 'Hausreef' })).id;
        await call('PUT', `/api/dive-sites/${ssiSite}/external-ids/ssi`, { externalId: '3314' });
      }
      await call('PATCH', `/api/dives/${id}`, { version: await version(id), siteId: ssiSite });
    };
    /** The synthetic dives are two hours ahead of UTC; SSI keeps local time, "YYYY-MM-DD HH:MM". */
    const atSsi = (d: Date) => new Date(d.getTime() + 2 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
    const connectSsi = async (set: Partial<typeof connection.$inferInsert>) => {
      const id = (await json<{ id: string }>('POST', '/api/connections/ssi', { diverId, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false })).id;
      await t.db.update(connection).set(set).where(eq(connection.id, id));
      return id;
    };

    beforeEach(() => {
      // Back to real time: the queue's notes take the database's time, the step the clock's, which earlier tests moved
      // on. Each test has a new Connection and new Dives, so no lease taken at the skipped time is in the way.
      ctx.clock.skip(Date.now() - ctx.clock.now());
      saves = 0;
      ledger.down = false;
      ledger.refuseDelete = false;
      ledger.beforeSave = counting;
    });

    it('sends a due entry and removes it', async () => {
      const id = await waiting('Turtle');
      saves = 0;
      await untilDue();
      expect(await step()).toBeNull();
      expect(saves).toBe(1);
      expect(await ledgerNotes(id)).toBe('Turtle');
      expect(await rows()).toEqual([]);
      expect(RETRY_AFTER_MS).toEqual([300_000, 1_800_000, 7_200_000, 21_600_000]);
      expect(GIVE_UP_MS).toBe(86_400_000);
    });

    it('does nothing before 30 s', async () => {
      const id = await waiting('Turtle');
      saves = 0;
      expect(await step()).toBeNull();
      expect(saves).toBe(0);
      const [row] = await rows();
      expect(row).toMatchObject({ state: 'waiting', attempts: 0 });
      expect(await jobRunAt(connectionId)).toEqual(row!.dueAt);
      ctx.clock.skip(30_000);
      expect(await step()).toBeNull();
      expect(await ledgerNotes(id)).toBe('Turtle');
      expect(await rows()).toEqual([]);
    });

    it('sends the next due entry after the Provider\'s pause', async () => {
      const first = await waiting('Turtle');
      const second = await upload(day(2));
      await send(second);
      await edit(first, 'Turtle and ray');
      await edit(second, 'Ray');
      ctx.clock.skip(30_000);
      expect(await step()).toEqual({ afterMs: ledger.adapter.capabilities.limits.pauseMs });
      expect(await rows()).toHaveLength(1);
      expect(await step()).toBeNull();
      expect(await ledgerNotes(first)).toBe('Turtle and ray');
      expect(await ledgerNotes(second)).toBe('Ray');
    });

    it('a change during a send queues the Dive once more', async () => {
      const id = await waiting('Turtle');
      await untilDue();
      // An edit whose transaction began before the step and commits while the Provider saves what the step read.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let written!: () => void;
      const begun = new Promise<void>((resolve) => { written = resolve; });
      const editing = t.db.transaction(async (tx) => {
        await tx.update(dive).set({ notes: 'Turtle and ray', version: sql`${dive.version} + 1` }).where(eq(dive.id, id));
        await writeRevision(tx, 'dive', id, { type: 'user', id: annId }, 'edit', { notes: { from: 'Turtle', to: 'Turtle and ray' } });
        written();
        await gate;
      });
      await begun;
      ledger.beforeSave = async () => { release(); await editing; };
      await step();
      expect(await ledgerNotes(id)).toBe('Turtle');
      const [again] = await rows();
      expect(again).toMatchObject({ diveId: id, state: 'waiting', action: 'send' });
      expect(again!.changedAt).toEqual((await lastRevision(id)).at);
      expect(again!.dueAt.getTime()).toBe(again!.changedAt.getTime() + QUIET_MS);
      ledger.beforeSave = counting;
      await untilDue();
      expect(await step()).toBeNull();
      expect(await ledgerNotes(id)).toBe('Turtle and ray');
      expect(await rows()).toEqual([]);
    });

    it('a manual send removes the entry', async () => {
      const id = await waiting('Turtle');
      expect((await call('POST', `/api/dives/${id}/providers/ledger`, {})).statusCode).toBeLessThan(300);
      expect(await rows()).toEqual([]);
      saves = 0;
      ctx.clock.skip(30_000);
      expect(await step()).toBeNull();
      expect(saves).toBe(0);
    });

    it('drops the send of a Dive deleted meanwhile', async () => {
      const id = await waiting('Turtle');
      expect((await call('DELETE', `/api/dives/${id}`, { version: await version(id) })).statusCode).toBe(200);
      expect(await rows()).toMatchObject([{ diveId: id, action: 'send' }]);
      saves = 0;
      ctx.clock.skip(30_000);
      expect(await step()).toBeNull();
      expect(saves).toBe(0);
      expect(await rows()).toEqual([]);
    });

    it('holds a Dive without a site and sends it after the save that adds one', async () => {
      const ssiConnection = await connectSsi({ sendNewDives: true });
      const id = await upload(day(1));
      await edit(id, 'Turtle');
      await untilDue('ssi');
      expect(await step(ssiConnection)).toBeNull();
      expect(await of('ssi')).toMatchObject([{ diveId: id, state: 'held', reason: 'requirements' }]);
      await atSsiSite(id);
      expect(await of('ssi')).toMatchObject([{ diveId: id, state: 'waiting', reason: null }]);
      await untilDue('ssi');
      expect(await step(ssiConnection)).toBeNull();
      expect(await remoteOf(id, 'ssi')).not.toBeNull();
      expect(await of('ssi')).toEqual([]);
    });

    it('holds an exists answer with the remote dive', async () => {
      const ssiConnection = await connectSsi({ sendNewDives: true });
      const id = await upload(day(1));
      await atSsiSite(id);
      // The year's day doesn't fit a FIT file's clock: the Dive starts when the file says.
      const startsAt = new Date((await json<{ values: { startsAt: { at: string } } }>('GET', `/api/dives/${id}`)).values.startsAt.at);
      ctx.fakeSsi.addDive(ctx.fakeSsi.accounts[0]!.accountId, handTypedDive({ at: atSsi(startsAt), depthM: 20, minutes: 40, siteId: 3314, nr: 4 }));
      ctx.ssiClock.advance(3 * 60_000);
      const before = ctx.fakeSsi.dives.size;
      await untilDue('ssi');
      expect(await step(ssiConnection)).toBeNull();
      const [held] = await of('ssi');
      expect(held).toMatchObject({ diveId: id, state: 'held', reason: 'exists', detail: { remoteNumber: 4, startsAt: atSsi(startsAt) } });
      expect(ctx.fakeSsi.dives.has(Number(held!.detail!.remoteId))).toBe(true);
      expect(ctx.fakeSsi.dives.size).toBe(before);
      expect(await remoteOf(id, 'ssi')).toBeNull();
    });

    it('holds an update that would remove a verification', async () => {
      expect((await call('PATCH', `/api/connections/${connectionId}`, { diveNumbers: { follow: true } })).statusCode).toBeLessThan(300);
      // The ledger numbers the Dive 2, since it has a dive 1; the dive there is renumbered after.
      const other = ledger.seedRemote({ number: 1, startsAt: '2025-01-01T09:00:00Z' });
      const id = await upload(day(1));
      await send(id);
      ledger.renumber(other, 9);
      await edit(id, 'Turtle');
      saves = 0;
      await untilDue();
      expect(await step()).toBeNull();
      expect(saves).toBe(0);
      expect(await rows()).toMatchObject([{ diveId: id, state: 'held', reason: 'removes_verification' }]);
    });

    it('a Conflict goes out without the field and waits in Needs your decision', async () => {
      const ssiConnection = await connectSsi({ sendChanges: true });
      const id = await upload(day(1));
      await atSsiSite(id);
      await edit(id, 'Reef');
      expect((await call('POST', `/api/dives/${id}/providers/ssi`, {})).statusCode).toBeLessThan(300);
      await t.db.delete(waitingPush);
      const remote = ctx.fakeSsi.dives.get(Number((await remoteOf(id, 'ssi'))!.remoteId))!;
      remote.odin_user_log_comment = 'Reef in SSI';
      ctx.ssiClock.advance(3 * 60_000);
      await edit(id, 'Reef here');
      await untilDue('ssi');
      expect(await step(ssiConnection)).toBeNull();
      expect(remote.odin_user_log_comment).toBe('Reef in SSI');
      expect(await of('ssi')).toEqual([]);
      const [entry] = await t.db.select().from(providerConflict).where(eq(providerConflict.diveId, id));
      expect(entry).toMatchObject({ provider: 'ssi', connectionId: ssiConnection, runId: null, fields: [{ field: 'notes', hub: 'Reef here', provider: 'Reef in SSI' }] });
    });

    it('retries an unavailable Provider after 5 min, 30 min, 2 h, 6 h and stops after 24 h', async () => {
      const id = await waiting('Turtle');
      ledger.down = true;
      await untilDue();
      expect(await step()).toBeNull();
      const [first] = await rows();
      expect(first).toMatchObject({ state: 'waiting', attempts: 1 });
      expect(first!.firstFailedAt).not.toBeNull();
      expect(first!.dueAt.getTime() - first!.firstFailedAt!.getTime()).toBe(5 * 60_000);
      expect(await jobRunAt(connectionId)).toEqual(first!.dueAt);
      const delays = await failUntilStopped();
      expect(delays).toEqual([30, 120, 360, 360, 360, 360]);
      const [stopped] = await rows();
      expect(stopped).toMatchObject({ diveId: id, state: 'stopped', reason: 'provider_unavailable' });
      expect(stopped!.firstFailedAt).toEqual(first!.firstFailedAt);
      expect(stopped!.stoppedAt!.getTime() - stopped!.firstFailedAt!.getTime()).toBeGreaterThanOrEqual(GIVE_UP_MS);
      // Stopped, it isn't tried by itself.
      ctx.clock.skip(GIVE_UP_MS);
      ledger.down = false;
      await step();
      expect(await rows()).toMatchObject([{ state: 'stopped' }]);
    });

    it('wakes entries stopped as unavailable after another Connection\'s success', async () => {
      const id = await waiting('Turtle');
      ledger.down = true;
      await failUntilStopped();
      ledger.down = false;
      await ctx.providers.waitingPushes.tick();
      expect(await rows()).toMatchObject([{ state: 'stopped', reason: 'provider_unavailable' }]);
      await bobsConnection();
      await ctx.providers.waitingPushes.tick();
      const [woken] = await rows();
      expect(woken).toMatchObject({ diveId: id, state: 'waiting', reason: null, attempts: 0, firstFailedAt: null, stoppedAt: null });
      expect(woken!.dueAt.getTime()).toBeLessThanOrEqual(ctx.clock.now());
      expect(await jobRunAt(connectionId)).not.toBeNull();
      expect(await step()).toBeNull();
      expect(await ledgerNotes(id)).toBe('Turtle');
      expect(await rows()).toEqual([]);
    });

    it('an internal_error entry wakes only by Retry', async () => {
      const id = await waiting('Turtle');
      const bug = new Error('a bug in Dive Hub');
      ledger.beforeSave = async () => { throw bug; };
      // The worker as main.ts builds it, with a logger: the fault itself is for the operator, Users see the code.
      const logged: { detail: object; message: string }[] = [];
      const logging = createWaitingPushService({
        db: t.db, registry: ctx.providers.providers, pushes: ctx.providers.pushes, clock: ctx.clock,
        log: { error: (detail, message) => logged.push({ detail, message }) },
      });
      const delays = await failUntilStopped(() => logging.step(connectionId));
      expect(delays).toEqual([5, 30, 120, 360, 360, 360, 360]);
      expect(await rows()).toMatchObject([{ state: 'stopped', reason: 'internal_error' }]);
      expect(logged).toHaveLength(8);
      expect(logged[0]).toEqual({
        detail: { err: bug, diveId: id, provider: 'ledger', connectionId, action: 'send' }, message: 'a Waiting push failed with an internal error',
      });
      ledger.beforeSave = counting;
      await bobsConnection();
      await ctx.providers.waitingPushes.tick();
      expect(await rows()).toMatchObject([{ state: 'stopped', reason: 'internal_error' }]);
      await ctx.providers.waitingPushes.retry(annId, id, 'ledger');
      expect(await rows()).toMatchObject([{ state: 'waiting', attempts: 0 }]);
      expect(await step()).toBeNull();
      expect(await ledgerNotes(id)).toBe('Turtle');
    });

    it('a refused send stops at once', async () => {
      const id = await upload(day(1));
      await send(id);
      await settings({ deleteAtProvider: true });
      expect((await call('DELETE', `/api/dives/${id}`, { version: await version(id) })).statusCode).toBe(200);
      expect(await rows()).toMatchObject([{ diveId: id, action: 'delete', state: 'waiting' }]);
      ledger.refuseDelete = true;
      await untilDue();
      expect(await step()).toBeNull();
      const [stopped] = await rows();
      expect(stopped).toMatchObject({ diveId: id, action: 'delete', state: 'stopped', reason: 'provider_refused', attempts: 1 });
      expect(stopped!.stoppedAt).not.toBeNull();
      expect(ledger.dives.size).toBe(1);
      // Retry, and the ledger takes the delete this time.
      ledger.refuseDelete = false;
      await ctx.providers.waitingPushes.retry(annId, id, 'ledger');
      expect(await step()).toBeNull();
      expect(ledger.dives.size).toBe(0);
      expect(await rows()).toEqual([]);
    });

    it('a token-only Connection holds its entries and the tick wakes them after sign-in', async () => {
      const first = await waiting('Turtle');
      const second = await upload(day(2));
      await send(second);
      await edit(first, 'Turtle and ray');
      await edit(second, 'Ray');
      ledger.expireTokens();
      ctx.clock.skip(30_000);
      expect(await step()).toBeNull();
      expect((await rows()).map((r) => [r.state, r.reason])).toEqual([['held', 'sign_in'], ['held', 'sign_in']]);
      await ctx.providers.waitingPushes.tick();
      expect((await rows()).map((r) => r.state)).toEqual(['held', 'held']);
      ledger.tokens.set('ledger-token-1', { accountId: 'l-5', label: 'Ledger of Erika' });
      expect((await call('POST', `/api/connections/${connectionId}/sign-in`, { token: 'ledger-token-1', keepSignedIn: false })).statusCode).toBeLessThan(300);
      await ctx.providers.waitingPushes.tick();
      expect((await rows()).map((r) => [r.state, r.reason])).toEqual([['waiting', null], ['waiting', null]]);
      expect(await step()).toEqual({ afterMs: ledger.adapter.capabilities.limits.pauseMs });
      expect(await step()).toBeNull();
      expect(await ledgerNotes(first)).toBe('Turtle and ray');
      expect(await ledgerNotes(second)).toBe('Ray');
      expect(await rows()).toEqual([]);
    });

    it('waits while a Push run of the Connection runs', async () => {
      const id = await waiting('Turtle');
      await upload(day(2));
      const started = await call('POST', `/api/connections/${connectionId}/push-runs`, { dives: { list: {} } });
      expect(started.statusCode).toBe(202);
      await untilDue();
      saves = 0;
      expect(await step()).toEqual({ afterMs: 30_000 });
      expect(saves).toBe(0);
      expect(await rows()).toMatchObject([{ diveId: id, state: 'waiting', attempts: 0 }]);
      while (await ctx.providers.pushRuns.step((started.json() as { id: string }).id));
      expect(await step()).toBeNull();
      expect(await ledgerNotes(id)).toBe('Turtle');
    });

    it('a Dive a run sent meanwhile is removed as up to date', async () => {
      const id = await waiting('Turtle');
      const started = await call('POST', `/api/connections/${connectionId}/push-runs`, { dives: { list: {} }, updates: true });
      expect(started.statusCode).toBe(202);
      while (await ctx.providers.pushRuns.step((started.json() as { id: string }).id));
      expect(await ledgerNotes(id)).toBe('Turtle');
      // The run's send settled the entry; an entry left for a Dive sent as it is goes out as nothing.
      expect(await rows()).toEqual([]);
      await edit(id, 'Turtle and ray');
      await edit(id, 'Turtle');
      saves = 0;
      await untilDue();
      expect(await step()).toBeNull();
      expect(saves).toBe(0);
      expect(await rows()).toEqual([]);
    });

    it('Retry makes a stopped entry due now', async () => {
      const id = await waiting('Turtle');
      ledger.down = true;
      await failUntilStopped();
      ledger.down = false;
      const bobsUser = ((await t.db.execute(sql`select id from "user" where email = 'bob@example.com'`)).rows[0] as { id: string }).id;
      await expect(ctx.providers.waitingPushes.retry(bobsUser, id, 'ledger')).rejects.toMatchObject({ code: 'connection_not_found' });
      await expect(ctx.providers.waitingPushes.retry(annId, id, 'ssi')).rejects.toMatchObject({ code: 'waiting_push_not_found' });
      await ctx.providers.waitingPushes.retry(annId, id, 'ledger');
      const [row] = await rows();
      expect(row).toMatchObject({ state: 'waiting', reason: null, attempts: 0, firstFailedAt: null, stoppedAt: null });
      expect(row!.dueAt.getTime()).toBeLessThanOrEqual(ctx.clock.now());
      expect(await jobRunAt(connectionId)).toEqual(row!.dueAt);
      // A waiting entry is not one to retry.
      await expect(ctx.providers.waitingPushes.retry(annId, id, 'ledger')).rejects.toMatchObject({ code: 'waiting_push_not_found' });
      expect(await step()).toBeNull();
      expect(await rows()).toEqual([]);
    });
  });
});
