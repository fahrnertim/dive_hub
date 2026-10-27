// The dive import and entries remembered for a Diver (piece 5): an entry of the User's SSI buddy list without an
// account, remembered for a Diver, comes back on an imported dive as that Diver, a Participant. Other entries stay out.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diver, diverExternalId, participant } from '../src/db/schema.js';
import { listAccountOf, remember } from '../src/providers/list-entries.js';
import { createFakeSsi, handTypedDive, type FakeSsiBuddy } from './fake-ssi.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

const ERIKA = 5_012_047;
const entry = (id: number, firstname: string): FakeSsiBuddy => ({
  owner: ERIKA, id, buddy_master_id: 0, firstname, lastname: '', email: '', dob: '0000-00-00', phone: ' ', city: '',
});
const ANNA = entry(8_100_001, 'Anna');
const BOB = entry(8_100_002, 'Bob');
const KAI: FakeSsiBuddy = { ...entry(8_100_003, 'Kai'), buddy_master_id: 4_989_164 };

describe.skipIf(!(await databaseReachable()))('the dive import maps remembered entries', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let connectionId: string;
  let anna = '';
  let diveId = '';
  let remoteId = '';
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      fakeSsi: createFakeSsi({ accounts: [{ email: 'erika@example.com', password: 'ssi-password', accountId: ERIKA }], buddies: [ANNA, BOB, KAI] }),
    });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    const own = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    connectionId = (await call('POST', '/api/connections/ssi', { diverId: own, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: true })).json().id;
    await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'create', windowMinutes: 15 } });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('imports a buddy added from scratch as the Diver it is remembered for', async () => {
    const own = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    anna = ((await call('POST', '/api/external-divers', { name: 'Anna' })).json() as { id: string }).id;
    await remember(t.db, (await listAccountOf(t.db, own, 'ssi'))!, anna, String(ANNA.id));
    remoteId = String(ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at: '2026-01-15 11:05', depthM: 18, minutes: 30, nr: 1, buddies: [ANNA.id, BOB.id] })));
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
    expect(started.statusCode).toBe(202);
    await ctx.imports.processImport(started.json().id);
    const done = (await call('GET', `/api/imports/${started.json().id}`)).json() as { outcome: { result: string; diveId: string }[] };
    expect(done.outcome[0]).toMatchObject({ result: 'created' });
    diveId = done.outcome[0]!.diveId;
    // Anna is a Participant; Bob, remembered for no one, is skipped; the dive's own Diver is none.
    const rows = await t.db.select({ diverId: participant.diverId }).from(participant).where(eq(participant.diveId, done.outcome[0]!.diveId));
    expect(rows.map((r) => r.diverId)).toEqual([anna]);
  });

  it('keeps that Diver when the import takes a buddy added at SSI', async () => {
    await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: ['4989164'] });
    const kai = ((await t.db.select({ id: diverExternalId.diverId }).from(diverExternalId).where(eq(diverExternalId.externalId, '4989164')))[0])!.id;
    ctx.fakeSsi.dives.get(Number(remoteId))!.odin_user_log_buddy_ids = [ANNA.id, BOB.id, KAI.id];
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
    await ctx.imports.processImport(started.json().id);
    const done = (await call('GET', `/api/imports/${started.json().id}`)).json() as { outcome: { result: string }[] };
    expect(done.outcome[0]).toMatchObject({ result: 'updated' });
    const rows = await t.db.select({ diverId: participant.diverId }).from(participant).where(eq(participant.diveId, diveId));
    expect(rows.map((r) => r.diverId).sort()).toEqual([anna, kai].sort());
  });

  it('imports an entry remembered for a merged-away Diver as the Diver it went into', async () => {
    const survivor = ((await call('POST', '/api/external-divers', { name: 'Anna Berg' })).json() as { id: string }).id;
    // As divers/merge.ts leaves Anna: deleted with merged_into, her remembered entry kept.
    await t.db.update(diver).set({ deletedAt: new Date(), mergedInto: survivor }).where(eq(diver.id, anna));
    ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at: '2026-02-20 10:00', depthM: 12, minutes: 40, nr: 2, buddies: [ANNA.id] }));
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
    await ctx.imports.processImport(started.json().id);
    const done = (await call('GET', `/api/imports/${started.json().id}`)).json() as { outcome: { result: string; diveId: string }[] };
    const created = done.outcome.find((o) => o.result === 'created')!;
    const rows = await t.db.select({ diverId: participant.diverId }).from(participant).where(eq(participant.diveId, created.diveId));
    expect(rows.map((r) => r.diverId)).toEqual([survivor]);
  });
});
