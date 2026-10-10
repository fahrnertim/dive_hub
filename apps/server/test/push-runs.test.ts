// Push runs (ADR 0047, 0048) through the HTTP API with the test-only ledger and the fake SSI: the preview, the worker's step
// (called as the worker calls it, without Graphile's runner), what stops a run and what doesn't, cancel and continue, a
// crash, scoping and the numbers. Results are read through the API, not from tables.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { diveLease, push, pushRun, pushRunItem } from '../src/db/schema.js';
import { referenceOf } from '../src/providers/provider.js';
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
  leftOut: Record<string, number>; pauseMs: number;
  items: { diveId: string; position: number; action: string; state: string; outcome: string | null; reason: string | null }[];
};
type Preview = {
  counts: Record<string, number>; leftOut: Record<string, number>; send: number; beyondCeiling: number; withLeftOut: number; estimatedSeconds: number;
  limits: { pauseMs: number; maxDives: number }; blocked: { total: number; dives: { diveId: string; unmet: { type: string }[] }[] };
};
type Status = { provider: string; current: { remoteId: string; remoteNumber: number | null; upToDate: boolean } | null };

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
    const created = (await start({ dives: all }, ssiConnectionId).then((r) => r.json())) as Run;
    await runToEnd(created.id);
    const done = await run(created.id);
    expect(done).toMatchObject({ status: 'done', counts: { total: 1, sent: 1 }, leftOut: { requirementsUnmet: 1 } });
    expect((await statusOf(good, 'ssi')).current).not.toBeNull();
    expect((await statusOf(blocked, 'ssi')).current).toBeNull();
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
      const created = await started({ dives: all, numbers: true, updatesRemovingVerification: true });
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

    it('leaves out Dives that swap numbers among themselves', async () => {
      await follow(true);
      const a = await upload(day(1));
      const b = await upload(day(2));
      await send(a);
      await send(b);
      // As if each had been given the other's number: a wants 1 and has 2, b wants 2 and has 1.
      await t.db.update(push).set({ remoteNumber: 2 }).where(eq(push.diveId, a));
      await t.db.update(push).set({ remoteNumber: 1 }).where(eq(push.diveId, b));
      const view = (await preview({ dives: all, numbers: true, updatesRemovingVerification: true })).json() as Preview;
      expect(view.counts).toMatchObject({ number: 2, numberTaken: 2 });
      expect(view.send).toBe(0);
      expect(view.leftOut.numberTaken).toBe(2);
    });

    it('skips a number a dive only at the ledger holds, and goes on', async () => {
      await follow(true);
      const a = await upload(day(2));
      await send(a);
      await upload(day(1));
      ledger.seedRemote({ number: 2, startsAt: '2025-01-01T09:00:00Z' });
      const created = await started({ dives: all, numbers: true, updatesRemovingVerification: true });
      await runToEnd(created.id);
      const done = await run(created.id);
      expect(done.status).toBe('done');
      expect(done.items.find((i) => i.diveId === a)).toMatchObject({ action: 'number', state: 'skipped', reason: 'number_taken' });
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
