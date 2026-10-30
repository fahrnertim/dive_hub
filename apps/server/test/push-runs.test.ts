// Push runs (ADR 0047, 0048) through the HTTP API with the test-only ledger and the fake SSI: the preview, the worker's step
// (called as the worker calls it, without Graphile's runner), what stops a run and what doesn't, cancel and continue, a
// crash, scoping and the numbers. Results are read through the API, not from tables.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { diveLease, push, pushRun, pushRunItem } from '../src/db/schema.js';
import { referenceOf } from '../src/providers/provider.js';
import { createPushRunService } from '../src/providers/push/push-run-service.js';
import { createFakeHandover } from './fake-handover-provider.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { createFakeSsi, handTypedDive } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Run = {
  id: string; status: string; stopCode: string | null; cancelRequested: boolean;
  counts: { total: number; waiting: number; sent: number; skipped: number; failed: number };
  leftOut: Record<string, number>; pauseMs: number; conflicts: number;
  items: { diveId: string; position: number; action: string; state: string; outcome: string | null; reason: string | null }[];
};
type Preview = {
  counts: Record<string, number>; leftOut: Record<string, number>; send: number; beyondCeiling: number; withLeftOut: number; estimatedSeconds: number;
  limits: { pauseMs: number; maxDives: number }; blocked: { total: number; dives: { diveId: string; unmet: { type: string }[] }[] };
  inScope: number;
  dives: { diveId: string; number: number | null; startsAt: string; siteId: string | null; siteName: string | null; action: string }[];
};
type Status = { provider: string; unmet: unknown[]; current: { remoteId: string; remoteNumber: number | null; upToDate: boolean } | null };

// A year per test: a Dive deleted earlier is not imported again.
let year = 2000;
const day = (n: number) => new Date(Date.UTC(year, 4, n, 9));
/** The synthetic dives are two hours ahead of UTC; SSI keeps local time, "YYYY-MM-DD HH:MM". */
const atSsi = (d: Date) => new Date(d.getTime() + 2 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

describe.skipIf(!(await databaseReachable()))('Push runs', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let bob: string;
  let diverId: string;
  let connectionId: string;
  let ssiConnectionId: string;
  let handoverConnectionId: string;
  const ledger = createFakeLedger();
  const handover = createFakeHandover();
  const ssi = createFakeSsi();

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = ann) =>
    (await call(method, url, payload, cookie)).json() as T;
  const upload = async (start: Date) => {
    const { payload, headers } = multipartFile(`dive-${start.getTime()}.fit`, makeSyntheticDive({ serialNumber: 100, start }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
    await ctx.imports.processImport(created.json().id);
    return (await json<{ outcome: { diveId: string }[] }>('GET', `/api/imports/${created.json().id}`)).outcome[0]!.diveId;
  };
  const statusOf = async (id: string, provider = 'ledger') => (await json<Status[]>('GET', `/api/dives/${id}/providers`)).find((s) => s.provider === provider)!;
  const send = (id: string) => call('POST', `/api/dives/${id}/providers/ledger`, {});
  const follow = (on: boolean) => call('PATCH', `/api/connections/${connectionId}`, { diveNumbers: { follow: on } });
  const version = async (id: string) => (await json<{ version: number }>('GET', `/api/dives/${id}`)).version;
  const edit = async (id: string, notes: string) => call('PATCH', `/api/dives/${id}`, { version: await version(id), notes });
  const all = { list: {} };
  const preview = (body: object = { dives: all }, id = connectionId, cookie = ann) => call('POST', `/api/connections/${id}/push-runs/preview`, body, cookie);
  const start = (body: object = { dives: all }, id = connectionId, cookie = ann) => call('POST', `/api/connections/${id}/push-runs`, body, cookie);
  const run = (id: string, cookie = ann) => json<Run>('GET', `/api/push-runs/${id}`, undefined, cookie);
  /** The worker's steps, one after the other, until the run asks for no more. */
  const runToEnd = async (id: string) => {
    let steps = 0;
    while (await ctx.providers.pushRuns.step(id)) steps++;
    return steps;
  };
  const started = async (body: object = { dives: all }) => {
    const response = await start(body);
    expect(response.statusCode).toBe(202);
    return response.json() as Run;
  };
  /** A Dive site with SSI's site ID, made once: an External ID is held by one site. */
  let ssiSite: string | null = null;
  const atSsiSite = async (id: string) => {
    if (!ssiSite) {
      ssiSite = (await json<{ id: string }>('POST', '/api/dive-sites', { name: 'Hausreef' })).id;
      await call('PUT', `/api/dive-sites/${ssiSite}/external-ids/ssi`, { externalId: '3314' });
    }
    await call('PATCH', `/api/dives/${id}`, { version: await version(id), siteId: ssiSite });
  };
  const ledgerNumbers = () => [...ledger.dives.values()].map((d) => d.number).sort((a, b) => a - b);

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { extraProviders: [ledger.adapter, handover.adapter], fakeSsi: ssi });
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'bob@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    bob = await signIn(ctx.app, 'bob@example.com');
    diverId = (await json<{ id: string }[]>('GET', '/api/divers'))[0]!.id;
    connectionId = (await json<{ id: string }>('POST', '/api/connections/ledger', { diverId, token: 'ledger-token-1', keepSignedIn: false })).id;
    handoverConnectionId = (await json<{ id: string }>('POST', '/api/connections/handover', { diverId, token: 'handover-token-1', keepSignedIn: false })).id;
    ssiConnectionId = (await json<{ id: string }>('POST', '/api/connections/ssi', { diverId, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false })).id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });
  beforeEach(async () => {
    year++;
    // A clean logbook, ledger and list of runs for each test.
    await t.db.delete(pushRun);
    await t.db.delete(push);
    const { dives } = await json<{ dives: { id: string }[] }>('GET', `/api/dives?limit=100&diverId=${diverId}`);
    for (const d of dives) await call('DELETE', `/api/dives/${d.id}`, { version: await version(d.id) });
    ledger.dives.clear();
    ledger.numberSaves.length = 0;
    ledger.heldReads = 0;
    ledger.down = false;
    if (!ledger.tokens.size) ledger.tokens.set('ledger-token-1', { accountId: 'l-5', label: 'Ledger of Erika' });
    await follow(false);
  });

  it('carries the limits in the capabilities, and refuses a Provider that takes no runs', async () => {
    const providers = await json<{ id: string; limits: { pauseMs: number; run: unknown } }[]>('GET', '/api/providers');
    expect(providers.find((p) => p.id === 'ssi')!.limits.run).toEqual({ pauseMs: 5000, maxDives: 100 });
    expect(providers.find((p) => p.id === 'ledger')!.limits.run).toEqual({ pauseMs: 1000, maxDives: 3 });
    expect(providers.find((p) => p.id === 'handover')!.limits.run).toBeNull();
    await upload(day(1));
    const refused = await start({ dives: all }, handoverConnectionId);
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: 'provider_unsupported' });
    expect((await preview({ dives: all }, handoverConnectionId)).json()).toMatchObject({ code: 'provider_unsupported' });
  });

  it('previews from Dive Hub\'s data and calls no Provider', async () => {
    for (const n of [1, 2, 3, 4]) await upload(day(n));
    const ssiCalls = ssi.calls.length;
    const dives = ledger.dives.size;
    const response = await preview();
    expect(response.statusCode).toBe(200);
    const view = response.json() as Preview;
    expect(view.counts).toMatchObject({ create: 4, update: 0, upToDate: 0, requirementsUnmet: 0, notFound: 0, number: 0 });
    expect(view.limits).toEqual({ pauseMs: 1000, maxDives: 3 });
    expect(view.send).toBe(3);
    expect(view.beyondCeiling).toBe(1);
    expect(view.estimatedSeconds).toBe(3 * (1 + 4));
    expect(ssi.calls.length).toBe(ssiCalls);
    expect(ledger.dives.size).toBe(dives);
    expect(await json('GET', '/api/push-runs')).toEqual([]);
  });

  it('names the Dives a start would send, in the order they go, and how many the list holds (UI/UX pass, slice 25b)', async () => {
    const third = await upload(day(3));
    const first = await upload(day(1));
    const second = await upload(day(2));
    await upload(day(4));
    const view = (await preview()).json() as Preview;
    // The ceiling is 3: the oldest three go, and the list says it holds four.
    expect(view.inScope).toBe(4);
    expect(view.beyondCeiling).toBe(1);
    expect(view.dives.map((d) => d.diveId)).toEqual([first, second, third]);
    expect(view.dives[0]).toMatchObject({ action: 'create', number: expect.any(Number) as number, siteName: null });
    expect(typeof view.dives[0]!.startsAt).toBe('string');
    // A Dive held back is not in it; ids of the shown Dives start exactly those.
    const picked = (await preview({ dives: { ids: [third, first] } })).json() as Preview;
    expect(picked.dives.map((d) => d.diveId)).toEqual([first, third]);
    expect(picked.inScope).toBe(2);
    const created = await started({ dives: { ids: [third, first] } });
    expect(created.counts.total).toBe(2);
  });

  it('sends each Dive once, oldest first, and ends done', async () => {
    const ids = [await upload(day(3)), await upload(day(1)), await upload(day(2))];
    const created = await started();
    expect(created).toMatchObject({ status: 'queued', counts: { total: 3, waiting: 3 }, pauseMs: 1000 });
    expect(await runToEnd(created.id)).toBe(2);
    const done = await run(created.id);
    expect(done).toMatchObject({ status: 'done', counts: { total: 3, sent: 3, waiting: 0 } });
    expect(done.items.map((i) => i.diveId)).toEqual([ids[1], ids[2], ids[0]]);
    expect(done.items.every((i) => i.state === 'sent' && i.outcome === 'created')).toBe(true);
    for (const id of ids) expect((await statusOf(id)).current).toMatchObject({ upToDate: true });
    expect(ledger.dives.size).toBe(3);
    expect((await json<{ id: string }[]>('GET', '/api/push-runs')).map((r) => r.id)).toEqual([created.id]);
  });

  it('answers the step with the Provider\'s run pause', async () => {
    await upload(day(1));
    await upload(day(2));
    const created = await started();
    expect(await ctx.providers.pushRuns.step(created.id)).toEqual({ afterMs: 1000 });
    expect(await ctx.providers.pushRuns.step(created.id)).toBeNull();
  });

  it('takes a list or ids, and nothing else', async () => {
    const a = await upload(day(1));
    await upload(day(2));
    expect((await start({ dives: {} })).statusCode).toBe(400);
    expect((await start({ dives: { list: {}, ids: [a] } })).statusCode).toBe(400);
    const view = (await preview({ dives: { ids: [a] } })).json() as Preview;
    expect(view.send).toBe(1);
    const nothing = await start({ dives: { list: { only: 'no-site', q: 'nothing like this' } } });
    expect(nothing.statusCode).toBe(409);
    expect(nothing.json()).toMatchObject({ code: 'push_run_nothing_to_send' });
  });

  it('sends only the Dives the list shows', async () => {
    const withNumber = await upload(day(2));
    await upload(day(1));
    const response = await started({ dives: { list: { q: String((await json<{ values: { number: number } }>('GET', `/api/dives/${withNumber}`)).values.number) } } });
    expect(response.counts.total).toBe(1);
    await runToEnd(response.id);
    expect((await statusOf(withNumber)).current).not.toBeNull();
    expect(ledger.dives.size).toBe(1);
  });

  it('sends a Dive with a blocking requirement unmet to no one, lists it, and sends the others (SSI)', async () => {
    const good = await upload(day(1));
    const blocked = await upload(day(2));
    await atSsiSite(good);
    const view = (await preview({ dives: all }, ssiConnectionId)).json() as Preview;
    expect(view.counts).toMatchObject({ create: 1, requirementsUnmet: 1 });
    expect(view.blocked.total).toBe(1);
    expect(view.blocked.dives[0]).toMatchObject({ diveId: blocked, unmet: [{ type: 'site_external_id' }] });
    // The same items, in the same shape, as the Dive's own status at the Provider.
    expect(view.blocked.dives[0]!.unmet).toEqual((await statusOf(blocked, 'ssi')).unmet);
    const created = (await start({ dives: all }, ssiConnectionId).then((r) => r.json())) as Run;
    await runToEnd(created.id);
    const done = await run(created.id);
    expect(done).toMatchObject({ status: 'done', counts: { total: 1, sent: 1 }, leftOut: { requirementsUnmet: 1 } });
    expect((await statusOf(good, 'ssi')).current).not.toBeNull();
    expect((await statusOf(blocked, 'ssi')).current).toBeNull();
  });

  /** A Dive sent by a first run, then its notes changed in SSI and here, and a second run that leaves the Conflict waiting. */
  const runWithConflict = async () => {
    const id = await upload(day(1));
    await atSsiSite(id);
    await edit(id, 'Reef');
    const first = (await start({ dives: all }, ssiConnectionId).then((r) => r.json())) as Run;
    await runToEnd(first.id);
    expect((await run(first.id)).conflicts).toBe(0);
    const remote = ssi.dives.get(Number((await statusOf(id, 'ssi')).current!.remoteId))!;
    remote.odin_user_log_comment = 'Reef in SSI';
    ctx.ssiClock.advance(3 * 60_000);
    await edit(id, 'Reef here');
    const second = (await start({ dives: all, updates: true }, ssiConnectionId).then((r) => r.json())) as Run;
    await runToEnd(second.id);
    return { id, remote, second };
  };

  it("a run sends a Dive with a conflict without that field, the entry waits, and the run's report counts it", async () => {
    const { id, remote, second } = await runWithConflict();
    const done = await run(second.id);
    expect(done).toMatchObject({ status: 'done', conflicts: 1, counts: { sent: 1 } });
    expect(done.items[0]).toMatchObject({ state: 'sent', outcome: 'updated' });
    expect(remote.odin_user_log_comment).toBe('Reef in SSI');
    const waiting = await json<{ connectionId: string; entries: { diveId: string; fields: object[] }[] }[]>('GET', '/api/provider-conflicts');
    expect(waiting.find((c) => c.connectionId === ssiConnectionId)!.entries).toMatchObject([
      { diveId: id, fields: [{ field: 'notes', hub: 'Reef here', provider: 'Reef in SSI' }] },
    ]);
    expect((await json<Run[]>('GET', '/api/push-runs')).find((r) => r.id === second.id)!.conflicts).toBe(1);
  });

  it("a Conflict whose Dive was deleted no longer counts in its run", async () => {
    const { id, second } = await runWithConflict();
    expect((await call('DELETE', `/api/dives/${id}`, { version: await version(id) })).statusCode).toBe(200);
    expect((await run(second.id)).conflicts).toBe(0);
  });

  it("an edit to the Provider's value ends the Conflict: not listed, its run counts 0", async () => {
    const { id, second } = await runWithConflict();
    await edit(id, 'Reef in SSI');
    expect((await run(second.id)).conflicts).toBe(0);
    expect((await json<Run[]>('GET', '/api/push-runs')).find((r) => r.id === second.id)!.conflicts).toBe(0);
    const waiting = await json<{ entries: { diveId: string }[] }[]>('GET', '/api/provider-conflicts');
    expect(waiting.flatMap((c) => c.entries).filter((e) => e.diveId === id)).toEqual([]);
  });

  it('an entry a later send closed counts 0 in its run', async () => {
    const { id, second } = await runWithConflict();
    expect((await call('POST', `/api/dives/${id}/providers/ssi`, { conflicts: { notes: 'hub' } })).json()).toMatchObject({ outcome: 'updated' });
    expect((await run(second.id)).conflicts).toBe(0);
  });

  /** A Participant on a Dive: an external Diver, with an SSI account when given. */
  const buddyOn = async (diveIds: string[], name: string, account?: number) => {
    const buddy = (await json<{ id: string }>('POST', '/api/external-divers', { name })).id;
    if (account) await call('PUT', `/api/divers/${buddy}/external-ids/ssi`, { externalId: String(account) });
    for (const id of diveIds) {
      const participants = [{ diverId: buddy, role: 'buddy' }];
      expect((await call('PUT', `/api/dives/${id}/participants`, { version: await version(id), participants })).statusCode).toBe(200);
    }
    return buddy;
  };

  it('a run adds one entry for a Diver on two dives', async () => {
    const a = await upload(day(1));
    const b = await upload(day(2));
    await atSsiSite(a);
    await atSsiSite(b);
    ssi.profiles.set(4_700_001, { firstname: 'Pia', lastname: 'Kern' });
    await buddyOn([a, b], 'Pia Kern', 4_700_001);
    ssi.calls.length = 0;
    const ssiRun = (await start({ dives: all }, ssiConnectionId).then((r) => r.json())) as Run;
    await runToEnd(ssiRun.id);
    expect((await run(ssiRun.id)).counts.sent).toBe(2);
    expect(ssi.calls.filter((c) => c.what === 'save_buddy')).toHaveLength(1);
  });

  it('a run lists the dives that went without someone', async () => {
    const id = await upload(day(1));
    await atSsiSite(id);
    await buddyOn([id], 'Nils Ohne');
    const created = (await start({ dives: all }, ssiConnectionId).then((r) => r.json())) as Run;
    await runToEnd(created.id);
    const done = (await run(created.id)) as Run & { withoutSomeone: { diveId: string; startsAt: string; names: string[] }[] };
    expect(done.counts.sent).toBe(1);
    expect(done.withoutSomeone).toEqual([{ diveId: id, startsAt: day(1).toISOString(), names: ['Nils Ohne'] }]);
  });

  it('skips a dive already at SSI at the same time, and saves nothing for it', async () => {
    const id = await upload(day(1));
    await atSsiSite(id);
    ssi.addDive(ssi.accounts[0]!.accountId, handTypedDive({ at: atSsi(day(1)), depthM: 20, minutes: 40, siteId: 3314 }));
    ctx.ssiClock.advance(3 * 60_000);
    const before = ssi.dives.size;
    const created = (await start({ dives: all }, ssiConnectionId).then((r) => r.json())) as Run;
    await runToEnd(created.id);
    const done = await run(created.id);
    expect(done).toMatchObject({ status: 'done', counts: { skipped: 1, sent: 0 } });
    expect(done.items[0]).toMatchObject({ state: 'skipped', reason: 'exists' });
    expect(ssi.dives.size).toBe(before);
    expect((await statusOf(id, 'ssi')).current).toBeNull();
  });

  it('updates changed Dives only with updates, and one that loses a verification only with both choices', async () => {
    await follow(true);
    // The ledger numbers the Dive 2, since it has a dive 1; the dive there is renumbered after.
    const other = ledger.seedRemote({ number: 1, startsAt: '2025-01-01T09:00:00Z' });
    const plain = await upload(day(1));
    await send(plain);
    ledger.renumber(other, 9);
    await edit(plain, 'Turtle');
    const nothing = await start();
    expect(nothing.statusCode).toBe(409);
    expect(nothing.json()).toMatchObject({ code: 'push_run_nothing_to_send' });
    expect(((await preview()).json() as Preview).counts).toMatchObject({ update: 0, updateRemovingVerification: 1, number: 1 });

    // The ledger declares that a number change removes a verification: the dive's number differs (it got 2, wants 1).
    const first = (await start({ dives: all, updates: true }));
    expect(first.statusCode).toBe(409);
    const both = await started({ dives: all, updates: true, updatesRemovingVerification: true });
    await runToEnd(both.id);
    expect(await run(both.id)).toMatchObject({ status: 'done', counts: { sent: 1 } });
    expect((await statusOf(plain)).current).toMatchObject({ upToDate: true, remoteNumber: 1 });
    expect(ledger.dives.get((await statusOf(plain)).current!.remoteId)).toMatchObject({ notes: 'Turtle' });
  });

  it('updates a changed Dive when it loses no verification', async () => {
    const id = await upload(day(1));
    await send(id);
    await edit(id, 'Turtle');
    expect(((await preview()).json() as Preview).counts).toMatchObject({ update: 1, updateRemovingVerification: 0 });
    expect((await start()).statusCode).toBe(409);
    const created = await started({ dives: all, updates: true });
    await runToEnd(created.id);
    expect((await run(created.id)).items[0]).toMatchObject({ action: 'update', outcome: 'updated', state: 'sent' });
    expect(ledger.dives.get((await statusOf(id)).current!.remoteId)!.notes).toBe('Turtle');
  });

  it('cuts at the ceiling, oldest first, and a second run takes the rest', async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3, 4, 5]) ids.push(await upload(day(n)));
    const first = await started();
    expect(first.leftOut.beyondCeiling).toBe(2);
    await runToEnd(first.id);
    expect((await run(first.id)).items.map((i) => i.diveId)).toEqual(ids.slice(0, 3));
    const view = (await preview()).json() as Preview;
    expect(view).toMatchObject({ send: 2, beyondCeiling: 0 });
    const second = await started();
    await runToEnd(second.id);
    expect((await run(second.id)).items.map((i) => i.diveId)).toEqual(ids.slice(3));
    expect(ledger.dives.size).toBe(5);
  });

  it('refuses a second run on a Connection with the first one\'s id, and starts one on another', async () => {
    await upload(day(1));
    const first = await started();
    const second = await start();
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'push_run_active', runId: first.id });
    // Another Connection of the same User is not held up.
    const other = await start({ dives: all }, ssiConnectionId);
    expect(other.json()).not.toMatchObject({ code: 'push_run_active' });
    await runToEnd(first.id);
    expect((await start()).statusCode === 409 && (await start()).json().code).not.toBe('push_run_active');
  });

  it('stops after the second failure in a row, keeps the rest waiting, and continues after the Provider is back', async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3]) ids.push(await upload(day(n)));
    await runToEnd((await started()).id);
    // The first run took everything; use a fresh logbook of three for the failing one.
    ledger.dives.clear();
    for (const n of [4, 5, 6]) ids.push(await upload(day(n)));
    const created = await started();
    ledger.down = true;
    expect(await ctx.providers.pushRuns.step(created.id)).not.toBeNull();
    expect(await ctx.providers.pushRuns.step(created.id)).toBeNull();
    const stopped = await run(created.id);
    expect(stopped).toMatchObject({ status: 'stopped', stopCode: 'provider_unavailable', counts: { failed: 2, waiting: 1 } });
    ledger.down = false;
    const again = await json<Run>('POST', `/api/push-runs/${created.id}/continue`);
    expect(again.status).toBe('queued');
    await runToEnd(created.id);
    const done = await run(created.id);
    expect(done).toMatchObject({ status: 'done', counts: { sent: 3, failed: 0 } });
    expect(ledger.dives.size).toBe(3);
    expect((await call('POST', `/api/push-runs/${created.id}/continue`)).json()).toMatchObject({ code: 'push_run_not_stopped' });
  });

  it('logs a fault of its own for the operator; the run shows only internal_error', async () => {
    const id = await upload(day(1));
    const created = await started();
    const bug = new Error('a bug in Dive Hub');
    ledger.beforeSave = async () => { throw bug; };
    // The worker as main.ts builds it, with a logger.
    const logged: { detail: object; message: string }[] = [];
    const logging = createPushRunService({
      db: t.db, registry: ctx.providers.providers, pushes: ctx.providers.pushes, conflicts: ctx.providers.conflicts,
      log: { error: (detail, message) => logged.push({ detail, message }), warn: () => {} },
    });
    try {
      await logging.step(created.id);
    } finally {
      ledger.beforeSave = null;
    }
    expect((await run(created.id)).items).toMatchObject([{ diveId: id, state: 'failed', reason: 'internal_error' }]);
    expect(logged).toEqual([{ detail: { err: bug, runId: created.id, diveId: id, provider: 'ledger' }, message: 'a Push run step failed with an internal error' }]);
  });

  it('stops at once when the Provider wants a sign-in, keeps the Dive waiting, and continues after signing in', async () => {
    await upload(day(1));
    await upload(day(2));
    const created = await started();
    ledger.expireTokens();
    expect(await ctx.providers.pushRuns.step(created.id)).toBeNull();
    const stopped = await run(created.id);
    expect(stopped).toMatchObject({ status: 'stopped', stopCode: 'provider_sign_in_needed', counts: { waiting: 2, failed: 0 } });
    const refused = await call('POST', `/api/push-runs/${created.id}/continue`);
    expect(refused.json()).toMatchObject({ code: 'provider_sign_in_needed' });
    ledger.tokens.set('ledger-token-2', { accountId: 'l-5', label: 'Ledger of Erika' });
    await json('POST', `/api/connections/${connectionId}/sign-in`, { token: 'ledger-token-2', keepSignedIn: false });
    expect((await call('POST', `/api/push-runs/${created.id}/continue`)).statusCode).toBe(202);
    await runToEnd(created.id);
    expect(await run(created.id)).toMatchObject({ status: 'done', counts: { sent: 2 } });
    // And a start while the Connection needs signing in is refused before anything is queued.
    ledger.expireTokens();
    await upload(day(3));
    await send((await json<{ dives: { id: string }[] }>('GET', `/api/dives?limit=1&diverId=${diverId}`)).dives[0]!.id);
    const refusedStart = await start();
    expect(refusedStart.statusCode).toBe(409);
    expect(refusedStart.json()).toMatchObject({ code: 'provider_sign_in_needed' });
    ledger.tokens.set('ledger-token-1', { accountId: 'l-5', label: 'Ledger of Erika' });
    await json('POST', `/api/connections/${connectionId}/sign-in`, { token: 'ledger-token-1', keepSignedIn: false });
  });

  it('cancels between two steps; a step after that does nothing; a finished run cannot be cancelled', async () => {
    await upload(day(1));
    await upload(day(2));
    const created = await started();
    expect(await ctx.providers.pushRuns.step(created.id)).not.toBeNull();
    const cancelled = await call('POST', `/api/push-runs/${created.id}/cancel`);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: 'cancelled', counts: { sent: 1, waiting: 1 } });
    expect(await ctx.providers.pushRuns.step(created.id)).toBeNull();
    expect(ledger.dives.size).toBe(1);
    expect((await call('POST', `/api/push-runs/${created.id}/cancel`)).json()).toMatchObject({ code: 'push_run_not_active' });
  });

  it('links a dive whose answer was lost, found by our reference, instead of creating it twice (SSI)', async () => {
    const id = await upload(day(1));
    await atSsiSite(id);
    // The save reached SSI and the answer was lost: SSI has the dive with our reference, the Dive has no Push.
    ssi.addDive(ssi.accounts[0]!.accountId, {
      ...handTypedDive({ at: atSsi(day(1)), depthM: 20, minutes: 40, siteId: 3314 }),
      odin_user_log_divecomputer_dive_ref: referenceOf(id),
    });
    ctx.ssiClock.advance(3 * 60_000);
    const before = ssi.dives.size;
    const created = (await start({ dives: all }, ssiConnectionId).then((r) => r.json())) as Run;
    // The worker died with the item taken: it is "sending" until the worker starts again.
    await t.db.update(pushRunItem).set({ state: 'sending' }).where(eq(pushRunItem.runId, created.id));
    await ctx.providers.pushRuns.requeueActive();
    expect((await run(created.id)).items[0]!.state).toBe('waiting');
    await runToEnd(created.id);
    const done = await run(created.id);
    expect(done).toMatchObject({ status: 'done', counts: { sent: 1 } });
    expect(done.items[0]).toMatchObject({ outcome: 'linked' });
    expect(ssi.dives.size).toBe(before);
    expect((await statusOf(id, 'ssi')).current).not.toBeNull();
  });

  it('retries a busy Dive later, and fails it after three tries', async () => {
    const busy = await upload(day(1));
    const free = await upload(day(2));
    await t.db.insert(diveLease).values({ diveId: busy, provider: 'ledger', holder: randomUUID(), lockedUntil: new Date(Date.now() + 3_600_000) });
    const created = await started();
    await ctx.providers.pushRuns.step(created.id);
    let now = await run(created.id);
    expect(now.items.find((i) => i.diveId === busy)).toMatchObject({ state: 'waiting' });
    await runToEnd(created.id);
    now = await run(created.id);
    expect(now).toMatchObject({ status: 'done', counts: { sent: 1, failed: 1 } });
    expect(now.items.find((i) => i.diveId === busy)).toMatchObject({ state: 'failed', reason: 'provider_busy' });
    expect(now.items.find((i) => i.diveId === free)).toMatchObject({ state: 'sent' });
    // A busy Dive that gave up is not a failure of the Provider: the run was not stopped.
  });

  it('skips a Dive deleted while the run goes', async () => {
    const a = await upload(day(1));
    await upload(day(2));
    const created = await started();
    await call('DELETE', `/api/dives/${a}`, { version: await version(a) });
    await runToEnd(created.id);
    const done = await run(created.id);
    expect(done).toMatchObject({ status: 'done', counts: { sent: 1, skipped: 1 } });
    expect(done.items.find((i) => i.diveId === a)).toMatchObject({ state: 'skipped', reason: 'dive_not_found' });
  });

  it('is the User\'s own: another User gets 404, and ids of another User\'s Dives are counted and never sent', async () => {
    const mine = await upload(day(1));
    const created = await started();
    for (const [method, url] of [
      ['GET', `/api/push-runs/${created.id}`], ['POST', `/api/push-runs/${created.id}/cancel`], ['POST', `/api/push-runs/${created.id}/continue`],
      ['POST', `/api/connections/${connectionId}/push-runs`], ['POST', `/api/connections/${connectionId}/push-runs/preview`],
    ] as const) {
      const response = await call(method, url, { dives: all }, bob);
      expect(response.statusCode, url).toBe(404);
    }
    expect(await json('GET', '/api/push-runs', undefined, bob)).toEqual([]);
    const strange = randomUUID();
    const view = (await preview({ dives: { ids: [mine, strange] } })).json() as Preview;
    expect(view.counts.notFound).toBe(1);
    await runToEnd(created.id);
    const deleted = await upload(day(2));
    await call('DELETE', `/api/dives/${deleted}`, { version: await version(deleted) });
    expect(((await preview({ dives: { ids: [deleted] } })).json() as Preview)).toMatchObject({ send: 0, counts: { notFound: 1 } });
  });

  it('stores a run\'s dismissal with the run: only an ended run, the User\'s own, undone when the run is taken up again (slice 25d)', async () => {
    await upload(day(1));
    await upload(day(2));
    const created = await started();
    expect((await json<{ dismissedAt: string | null }>('GET', `/api/push-runs/${created.id}`)).dismissedAt).toBeNull();
    // A run that goes cannot be put away.
    const going = await call('POST', `/api/push-runs/${created.id}/dismiss`);
    expect(going.statusCode).toBe(409);
    expect(going.json()).toMatchObject({ code: 'push_run_going' });
    await runToEnd(created.id);
    // Another User's run is none of theirs.
    expect((await call('POST', `/api/push-runs/${created.id}/dismiss`, undefined, bob)).statusCode).toBe(404);
    const dismissed = await call('POST', `/api/push-runs/${created.id}/dismiss`);
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json().dismissedAt).toEqual(expect.any(String));
    // The list carries it, so every browser and client sees the same strip; dismissing again changes nothing.
    const [listed] = await json<{ id: string; dismissedAt: string | null }[]>('GET', '/api/push-runs');
    expect(listed).toMatchObject({ id: created.id, dismissedAt: dismissed.json().dismissedAt });
    expect((await call('POST', `/api/push-runs/${created.id}/dismiss`)).json().dismissedAt).toBe(dismissed.json().dismissedAt);
  });

  it('shows a continued run again: taking a stopped run up clears its dismissal', async () => {
    for (const n of [1, 2, 3]) await upload(day(n));
    const created = await started();
    ledger.down = true;
    await ctx.providers.pushRuns.step(created.id);
    await ctx.providers.pushRuns.step(created.id);
    expect((await run(created.id)).status).toBe('stopped');
    expect((await call('POST', `/api/push-runs/${created.id}/dismiss`)).statusCode).toBe(200);
    ledger.down = false;
    expect((await call('POST', `/api/push-runs/${created.id}/continue`)).json().dismissedAt).toBeNull();
  });

  it('keeps the last five runs of a Connection', async () => {
    const first = await upload(day(1));
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      if (i > 0) await edit(first, `note ${i}`);
      const created = await started({ dives: { ids: [first] }, updates: true });
      ids.push(created.id);
      await runToEnd(created.id);
    }
    const listed = (await json<{ id: string }[]>('GET', '/api/push-runs')).map((r) => r.id);
    expect(listed).toHaveLength(5);
    expect(listed).not.toContain(ids[0]);
    expect(listed).toContain(ids[5]);
    expect((await call('GET', `/api/push-runs/${ids[0]}`)).statusCode).toBe(404);
  });

  describe('with numbers (ADR 0048)', () => {
    /** Two Dives sent, then an older one added: the sent ones are one number too low. */
    const threeBehind = async () => {
      await follow(true);
      const a = await upload(day(2));
      const b = await upload(day(3));
      await send(a);
      await send(b);
      const older = await upload(day(1));
      return { a, b, older };
    };

    it('carries the number on a create, with nothing ticked', async () => {
      await follow(true);
      await upload(day(1));
      const second = await upload(day(2));
      await runToEnd((await started()).id);
      expect(ledger.dives.get((await statusOf(second)).current!.remoteId)!.number).toBe(2);
      expect(ledgerNumbers()).toEqual([1, 2]);
    });

    it('sets the numbers from the highest down, then creates the new Dive with its own number', async () => {
      const { a, b, older } = await threeBehind();
      const view = (await preview()).json() as Preview;
      expect(view.counts).toMatchObject({ number: 2, create: 1, numberTaken: 0 });
      const created = await started({ dives: all, numbers: true, numbersRemovingVerification: true });
      expect(created.counts.total).toBe(3);
      await runToEnd(created.id);
      const done = await run(created.id);
      expect(done.items.map((i) => [i.diveId, i.action])).toEqual([[b, 'number'], [a, 'number'], [older, 'create']]);
      expect(done.items.map((i) => i.outcome)).toEqual(['numbered', 'numbered', 'created']);
      expect(ledgerNumbers()).toEqual([1, 2, 3]);
      for (const id of [a, b, older]) {
        const status = await json<{ current: { number: { differs: boolean } } }[]>('GET', `/api/dives/${id}/providers`).then((s) => s.find((x) => (x as unknown as Status).provider === 'ledger')!);
        expect(status.current.number.differs).toBe(false);
      }
    });

    it('without numbers only the create goes, numbered the ledger\'s own way, and the run says what was not chosen', async () => {
      await threeBehind();
      const created = await started();
      expect(created.leftOut.numberNotChosen).toBe(2);
      expect(created.counts.total).toBe(1);
      await runToEnd(created.id);
      expect(ledgerNumbers()).toEqual([1, 2, 3]);
    });

    it('needs the second choice for number changes where they remove a verification', async () => {
      await threeBehind();
      const view = (await preview({ dives: all, numbers: true })).json() as Preview;
      expect(view.counts.numberRemovingVerification).toBe(2);
      expect(view.leftOut.removesVerification).toBe(2);
      expect(view.send).toBe(1);
    });

    /** Dives sent as 1 and 2 (each the other's number there): `ids` = [a, b]; a wants 1 and has 2, b wants 2 and has 1. */
    const swapped = async () => {
      await follow(true);
      const a = await upload(day(1));
      const b = await upload(day(2));
      await send(a);
      await send(b);
      const remoteA = (await statusOf(a)).current!.remoteId;
      const remoteB = (await statusOf(b)).current!.remoteId;
      ledger.renumber(remoteA, 2);
      ledger.renumber(remoteB, 1);
      await t.db.update(push).set({ remoteNumber: 2 }).where(eq(push.diveId, a));
      await t.db.update(push).set({ remoteNumber: 1 }).where(eq(push.diveId, b));
      return { a, b, remoteA, remoteB };
    };
    const confirmed = { dives: all, numbers: true, numbersRemovingVerification: true };

    it('breaks a swap: the plan shows each number, one shares a number for one save, and none is left twice (ADR 0052)', async () => {
      const { a, b } = await swapped();
      const view = (await preview(confirmed)).json() as Preview & { numberPlan: { diveId: string; from: number; to: number; sharesWith: string | null }[] };
      expect(view.counts).toMatchObject({ number: 2, numberTaken: 0, numberHeldAtProvider: 0 });
      expect(view.send).toBe(2);
      // b (wanting 2, which a has) goes first, sharing it with a; then a takes the number b left.
      expect(view.numberPlan).toEqual([
        expect.objectContaining({ diveId: b, from: 1, to: 2, sharesWith: a }),
        expect.objectContaining({ diveId: a, from: 2, to: 1, sharesWith: null }),
      ]);
      const created = await started(confirmed);
      await runToEnd(created.id);
      const done = await run(created.id);
      expect(done.items.map((i) => [i.diveId, i.state, i.outcome])).toEqual([[b, 'sent', 'numbered'], [a, 'sent', 'numbered']]);
      expect(ledger.numberSaves.map((s) => s.shared)).toEqual([true, false]);
      expect(ledgerNumbers()).toEqual([1, 2]);
    });

    it('breaks a cycle of three with one shared save', async () => {
      await follow(true);
      const ids = [await upload(day(1)), await upload(day(2)), await upload(day(3))];
      for (const id of ids) await send(id);
      const remotes = await Promise.all(ids.map(async (id) => (await statusOf(id)).current!.remoteId));
      // Each has the number the next one wants: 1 has 2, 2 has 3, 3 has 1.
      const rotated = [2, 3, 1];
      remotes.forEach((r, i) => ledger.renumber(r, rotated[i]!));
      for (const [i, id] of ids.entries()) await t.db.update(push).set({ remoteNumber: rotated[i]! }).where(eq(push.diveId, id));
      const created = await started(confirmed);
      expect(created.counts.total).toBe(3);
      await runToEnd(created.id);
      expect((await run(created.id)).counts.sent).toBe(3);
      expect(ledger.numberSaves.filter((s) => s.shared)).toHaveLength(1);
      expect(ledgerNumbers()).toEqual([1, 2, 3]);
      expect(ledger.numberSaves[0]!.shared).toBe(true);
    });

    it('a run stopped after the shared save is finished by the next run, from the numbers alone', async () => {
      const { a, b } = await swapped();
      const first = await started(confirmed);
      expect(await ctx.providers.pushRuns.step(first.id)).not.toBeNull();
      await call('POST', `/api/push-runs/${first.id}/cancel`);
      // Now two dives hold number 2 at the ledger, as the report says it can until the run goes on.
      expect(ledgerNumbers()).toEqual([2, 2]);
      const again = await started(confirmed);
      expect(again.counts.total).toBe(1);
      await runToEnd(again.id);
      expect((await run(again.id)).items.map((i) => i.diveId)).toEqual([a]);
      expect(ledgerNumbers()).toEqual([1, 2]);
      expect((await statusOf(b)).current!.remoteNumber).toBe(2);
    });

    it('does not take a number a dive of the ledger has that the run does not move', async () => {
      await follow(true);
      const a = await upload(day(2));
      const b = await upload(day(3));
      await send(a);
      await send(b);
      await upload(day(1));
      // a wants 2 (b's), but only a is named: b is a Dive here, not in the run, so nothing is shared.
      const view = (await preview({ dives: { ids: [a] }, numbers: true, numbersRemovingVerification: true })).json() as Preview;
      expect(view.counts).toMatchObject({ number: 1, numberTaken: 1 });
      expect(view.send).toBe(0);
    });

    it('names a number a dive only at the ledger holds before the start, and leaves its dive out', async () => {
      await follow(true);
      const a = await upload(day(2));
      await send(a);
      await upload(day(1));
      ledger.seedRemote({ number: 2, startsAt: '2025-01-01T09:00:00Z' });
      const view = (await preview(confirmed)).json() as Preview & { heldAtProvider: { diveId: string; wanted: number; holder: { number: number; startsAt: string } }[] };
      expect(ledger.heldReads).toBe(1);
      expect(view.counts).toMatchObject({ numberHeldAtProvider: 1 });
      expect(view.heldAtProvider).toEqual([expect.objectContaining({ diveId: a, wanted: 2, holder: expect.objectContaining({ number: 2, startsAt: '2025-01-01 09:00' }) })]);
      const created = await started(confirmed);
      await runToEnd(created.id);
      const done = await run(created.id);
      expect(done.status).toBe('done');
      expect(done.items.find((i) => i.diveId === a)).toBeUndefined();
      expect(done.leftOut.numberHeldAtProvider).toBe(1);
    });

    it('reads the ledger only for a run that sets numbers', async () => {
      await follow(true);
      await send(await upload(day(2)));
      await upload(day(1));
      await preview({ dives: all });
      expect(ledger.heldReads).toBe(0);
      await preview({ dives: all, numbers: true });
      expect(ledger.heldReads).toBe(1);
    });

    it('still skips a number that was taken between the preview and the send', async () => {
      await follow(true);
      const a = await upload(day(2));
      await send(a);
      await upload(day(1));
      const created = await started(confirmed);
      ledger.seedRemote({ number: 2, startsAt: '2025-01-01T09:00:00Z' });
      await runToEnd(created.id);
      const done = await run(created.id);
      expect(done.status).toBe('done');
      expect(done.items.find((i) => i.diveId === a)).toMatchObject({ action: 'number', state: 'skipped', reason: 'number_taken' });
    });

    it('with holders, one Dive\'s chain is the dives in its way, in order; without, the holder is named as taken', async () => {
      const { a, b } = await threeBehind();
      const alone = (await preview({ dives: { ids: [a] }, numbers: true, numbersRemovingVerification: true })).json() as Preview;
      expect(alone).toMatchObject({ send: 0, counts: { numberTaken: 1 } });
      const chain = (await preview({ dives: { ids: [a] }, numbers: true, numbersRemovingVerification: true, withHolders: true })).json() as
        Preview & { numberPlan: { diveId: string; from: number; to: number }[] };
      expect(chain.numberPlan).toEqual([expect.objectContaining({ diveId: b, from: 2, to: 3 }), expect.objectContaining({ diveId: a, from: 1, to: 2 })]);
      const created = await started({ dives: { ids: [a] }, numbers: true, numbersRemovingVerification: true, withHolders: true });
      await runToEnd(created.id);
      expect(ledgerNumbers()).toEqual([2, 3]);
    });

    it('lets a number be shared only with the dive named, whatever else holds it', async () => {
      await follow(true);
      const a = await upload(day(1));
      const b = await upload(day(2));
      await send(a);
      await send(b);
      const remoteA = (await statusOf(a)).current!.remoteId;
      const remoteB = (await statusOf(b)).current!.remoteId;
      const open = ledger.adapter.dives!.open({ connectionId: 'x', accountId: 'l-5', access: 'ledger-token-1' });
      // a takes b's number: refused when it names a dive that is not the holder, allowed when it names b.
      expect(await open.setNumber!(remoteA, 2, 'someone-else')).toMatchObject({ result: 'taken', by: { remoteId: remoteB } });
      expect(await open.setNumber!(remoteA, 2, remoteB)).toEqual({ result: 'set', remoteNumber: 2 });
    });

    it('updates a changed Dive and sets its number in one save', async () => {
      await follow(true);
      const a = await upload(day(2));
      await send(a);
      await upload(day(1));
      await edit(a, 'Turtle');
      // Only this Dive: the older one, created first, would take the number 2 the update then finds taken.
      const created = await started({ dives: { ids: [a] }, numbers: true, updates: true, updatesRemovingVerification: true });
      await runToEnd(created.id);
      const done = await run(created.id);
      expect(done.items.filter((i) => i.diveId === a)).toEqual([expect.objectContaining({ action: 'update', outcome: 'updated' })]);
      expect(ledger.dives.get((await statusOf(a)).current!.remoteId)).toMatchObject({ number: 2, notes: 'Turtle' });
    });
  });
});
