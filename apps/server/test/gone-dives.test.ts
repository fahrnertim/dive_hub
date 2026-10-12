// Dives gone at SSI (ADR 0051), against a fake SSI logbook: six Dives linked by an import, then dives deleted "in SSI's
// app". The check and the import preview find them and store findings without changing a Dive; the confirmation reads
// the logbook once more under each Dive's lease and only then records a delete Push with `remoteGone`; an empty logbook
// is never a finding; another User sees and may do nothing.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diveLease, push } from '../src/db/schema.js';
import { createFakeSsi, handTypedDive } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

const ERIKA = 5_012_047;

type Summary = { empty: boolean; compared: number; gone: number; warning: boolean };
type Waiting = {
  connectionId: string; provider: string; compared: number; warning: boolean;
  dives: { diveId: string; number: number | null; remoteId: string; remoteNumber: number | null }[];
}[];
type Confirmed = { empty: boolean; results: { diveId: string; confirmation: string }[] };
type Status = { current: { remoteId: string } | null; pushes: { action: string; state: string; remoteGone: boolean }[] };

describe.skipIf(!(await databaseReachable()))('Dives gone at SSI', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let other: string;
  let connectionId: string;
  /** Our Dives by name (d1 … d6), and their SSI dives. */
  const hub: Record<string, string> = {};
  const ssi: Record<string, number> = {};

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie = tim) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const check = async () => (await call('POST', `/api/connections/${connectionId}/gone-dives/check`)).json() as Summary;
  const waiting = async (cookie = tim) => (await call('GET', '/api/gone-dives', undefined, cookie)).json() as Waiting;
  const waitingIds = async () => (await waiting()).flatMap((c) => c.dives.map((d) => d.diveId)).sort();
  const confirm = (ids: string[], cookie = tim, id = connectionId) => call('POST', `/api/connections/${id}/gone-dives/confirm`, { diveIds: ids }, cookie);
  const status = async (diveId: string) => (await call('GET', `/api/dives/${diveId}/providers/ssi`)).json() as Status;
  /** SSI's app deletes the dive: the logbook no longer lists it. */
  const deleteAtSsi = (name: string) => { ctx.fakeSsi.dives.delete(ssi[name]!); ctx.ssiClock.advance(5 * 60_000); };
  const sorted = (...names: string[]) => names.map((n) => hub[n]!).sort();

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { fakeSsi: createFakeSsi({ buddies: [], sites: [] }) });
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'other@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    other = await signIn(ctx.app, 'other@example.com');
    const own = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    connectionId = (await call('POST', '/api/connections/ssi', {
      diverId: own, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false,
    })).json().id;
    // Six Dives from files (UTC+2), each with its entry in Erika's logbook, linked by an import.
    for (let n = 1; n <= 6; n++) {
      const { payload, headers } = multipartFile(`d${n}.fit`, makeSyntheticDive({
        serialNumber: 2222, start: new Date(`2026-03-0${n}T08:00:00Z`), diveNumber: n,
      }));
      const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
      await ctx.imports.processImport(created.json().id);
      hub[`d${n}`] = ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: { diveId: string }[] }).outcome[0]!.diveId;
      ssi[`d${n}`] = ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at: `2026-03-0${n} 10:05`, depthM: 18, minutes: 30, nr: n }));
    }
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'add' } });
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
    await ctx.imports.processImport(started.json().id);
    // Back to off: the check works whatever the import mode is.
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'off' } });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('finds nothing while every linked dive is in the logbook, with the import off', async () => {
    for (const n of [1, 2, 3, 4, 5, 6]) expect((await status(hub[`d${n}`]!)).current?.remoteId).toBe(String(ssi[`d${n}`]));
    expect(await check()).toEqual({ empty: false, compared: 6, gone: 0, warning: false });
    expect(await waiting()).toEqual([]);
  });

  it('finds a dive deleted in SSI, stores it, and changes nothing about the Dive', async () => {
    deleteAtSsi('d1');
    const before = ctx.fakeSsi.calls.length;
    expect(await check()).toEqual({ empty: false, compared: 6, gone: 1, warning: false });
    // One fresh read of the logbook, nothing written there.
    expect(ctx.fakeSsi.calls.slice(before).map((c) => c.what)).toEqual(['get_divelog']);
    const found = await waiting();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ connectionId, provider: 'ssi', compared: 6, warning: false });
    expect(found[0]!.dives).toMatchObject([{ diveId: hub.d1, number: 1, remoteId: String(ssi.d1) }]);
    const s = await status(hub.d1!);
    expect(s.current?.remoteId).toBe(String(ssi.d1));
    expect(s.pushes.some((p) => p.action === 'delete')).toBe(false);
  });

  it('is found again by a second check without a second finding', async () => {
    expect((await check()).gone).toBe(1);
    expect(await waitingIds()).toEqual(sorted('d1'));
  });

  it('never makes a finding of an empty logbook, and leaves the ones found alone', async () => {
    const kept = new Map(ctx.fakeSsi.dives);
    ctx.fakeSsi.dives.clear();
    ctx.ssiClock.advance(5 * 60_000);
    expect(await check()).toEqual({ empty: true, compared: 0, gone: 1, warning: false });
    expect(await waitingIds()).toEqual(sorted('d1'));
    // Confirming against an empty logbook confirms nothing.
    const answer = (await confirm([hub.d1!])).json() as Confirmed;
    expect(answer).toEqual({ empty: true, results: [{ diveId: hub.d1, confirmation: 'unconfirmed' }] });
    expect((await status(hub.d1!)).current).not.toBeNull();
    for (const [id, record] of kept) ctx.fakeSsi.dives.set(id, record);
    ctx.ssiClock.advance(5 * 60_000);
    ctx.fakeSsi.dives.delete(ssi.d1!);
  });

  it('removes a finding once a later read lists the dive again', async () => {
    const record = ctx.fakeSsi.dives.get(ssi.d2!)!;
    deleteAtSsi('d2');
    expect(await waitingIds()).toEqual(sorted('d1'));
    expect((await check()).gone).toBe(2);
    expect(await waitingIds()).toEqual(sorted('d1', 'd2'));
    ctx.fakeSsi.dives.set(ssi.d2!, record);
    ctx.ssiClock.advance(5 * 60_000);
    expect((await check()).gone).toBe(1);
    expect(await waitingIds()).toEqual(sorted('d1'));
  });

  it('warns when more than half of the compared dives are gone, with the findings shown all the same', async () => {
    const names = ['d2', 'd3', 'd4', 'd5'];
    const kept = Object.fromEntries(names.map((n) => [n, ctx.fakeSsi.dives.get(ssi[n]!)!]));
    for (const n of names) deleteAtSsi(n);
    expect(await check()).toEqual({ empty: false, compared: 6, gone: 5, warning: true });
    const found = await waiting();
    expect(found[0]).toMatchObject({ compared: 6, warning: true });
    expect(found[0]!.dives).toHaveLength(5);
    // Nothing else differs: the dives are still linked, and nothing was recorded.
    expect((await status(hub.d2!)).pushes.some((p) => p.action === 'delete')).toBe(false);
    for (const n of names) ctx.fakeSsi.dives.set(ssi[n]!, kept[n]!);
    ctx.ssiClock.advance(5 * 60_000);
    expect(await check()).toEqual({ empty: false, compared: 6, gone: 1, warning: false });
    expect(await waitingIds()).toEqual(sorted('d1'));
  });

  it('finds them in the import preview too, which turns the check\'s read into its own', async () => {
    deleteAtSsi('d3');
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'add' } });
    const before = ctx.fakeSsi.calls.length;
    const preview = (await call('GET', `/api/connections/${connectionId}/dive-import`)).json() as { goneDives: Summary };
    expect(ctx.fakeSsi.calls.slice(before).map((c) => c.what)).toEqual(['get_divelog']);
    expect(preview.goneDives).toEqual({ empty: false, compared: 6, gone: 2, warning: false });
    expect(await waitingIds()).toEqual(sorted('d1', 'd3'));
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'off' } });
  });

  it('confirms with a second read: still gone records a confirmed delete Push with remoteGone, and no remote dive remains', async () => {
    const before = ctx.fakeSsi.calls.length;
    const res = await confirm([hub.d1!]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ empty: false, results: [{ diveId: hub.d1, confirmation: 'gone' }] });
    // One read for the confirmation; nothing was deleted or sent at SSI.
    expect(ctx.fakeSsi.calls.slice(before).map((c) => c.what)).toEqual(['get_divelog']);
    const s = await status(hub.d1!);
    expect(s.current).toBeNull();
    expect(s.pushes[0]).toMatchObject({ action: 'delete', state: 'confirmed', remoteGone: true });
    expect(await waitingIds()).toEqual(sorted('d3'));
    // The Dive is still here, and nothing else about it changed.
    expect((await call('GET', `/api/dives/${hub.d1}`)).statusCode).toBe(200);
  });

  it('there after all: nothing is recorded, the finding is removed and the answer says so', async () => {
    // Found gone, then back in the logbook by the time the User chooses (a read that came back short).
    const record = { ...ctx.fakeSsi.dives.get(ssi.d4!)! };
    deleteAtSsi('d4');
    expect((await check()).gone).toBe(2);
    ctx.fakeSsi.dives.set(ssi.d4!, record);
    ctx.ssiClock.advance(5 * 60_000);
    const pushesBefore = (await status(hub.d4!)).pushes.length;
    expect((await confirm([hub.d4!, hub.d3!])).json()).toEqual({
      empty: false,
      results: [{ diveId: hub.d4, confirmation: 'there' }, { diveId: hub.d3, confirmation: 'gone' }],
    });
    const s = await status(hub.d4!);
    expect(s.pushes).toHaveLength(pushesBefore);
    expect(s.current?.remoteId).toBe(String(ssi.d4));
    expect(await waitingIds()).toEqual([]);
  });

  it('answers not_waiting for a Dive without a finding, and refuses a Dive that is busy', async () => {
    expect((await confirm([hub.d5!])).json()).toEqual({ empty: false, results: [{ diveId: hub.d5, confirmation: 'not_waiting' }] });
    deleteAtSsi('d5');
    expect((await check()).gone).toBe(1);
    await t.db.insert(diveLease).values({ diveId: hub.d5!, provider: 'ssi', holder: randomUUID(), lockedUntil: new Date(Date.now() + 3_600_000) });
    const busy = await confirm([hub.d5!]);
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({ code: 'provider_busy' });
    expect(await waitingIds()).toEqual(sorted('d5'));
    await t.db.delete(diveLease).where(eq(diveLease.diveId, hub.d5!));
  });

  it('compares neither a deleted Dive nor one whose remote dive is not its current one', async () => {
    expect((await call('DELETE', `/api/dives/${hub.d5}`, { version: (await call('GET', `/api/dives/${hub.d5}`)).json().version })).statusCode)
      .toBeLessThan(300);
    expect(await waitingIds()).toEqual([]);
    expect((await check()).compared).toBe(3);
  });

  it('is the Connection\'s owner\'s alone: another User gets 404 and sees no findings', async () => {
    expect((await call('POST', `/api/connections/${connectionId}/gone-dives/check`, undefined, other)).statusCode).toBe(404);
    expect((await confirm([hub.d2!], other)).statusCode).toBe(404);
    expect(await waiting(other)).toEqual([]);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/gone-dives' })).statusCode).toBe(401);
  });
});
