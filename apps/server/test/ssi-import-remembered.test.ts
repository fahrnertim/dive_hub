// The dive import and entries remembered for a Diver (piece 5): an entry of the User's SSI buddy list without an
// account, remembered for a Diver, comes back on an imported dive as that Diver, a Participant. Other entries stay out.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { participant } from '../src/db/schema.js';
import { listAccountOf, remember } from '../src/providers/list-entries.js';
import { createFakeSsi, handTypedDive, type FakeSsiBuddy } from './fake-ssi.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

const ERIKA = 5_012_047;
const entry = (id: number, firstname: string): FakeSsiBuddy => ({
  owner: ERIKA, id, buddy_master_id: 0, firstname, lastname: '', email: '', dob: '0000-00-00', phone: ' ', city: '',
});
const ANNA = entry(8_100_001, 'Anna');
const BOB = entry(8_100_002, 'Bob');

describe.skipIf(!(await databaseReachable()))('the dive import maps remembered entries', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let connectionId: string;
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      fakeSsi: createFakeSsi({ accounts: [{ email: 'erika@example.com', password: 'ssi-password', accountId: ERIKA }], buddies: [ANNA, BOB] }),
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
    const anna = ((await call('POST', '/api/external-divers', { name: 'Anna' })).json() as { id: string }).id;
    await remember(t.db, (await listAccountOf(t.db, own, 'ssi'))!, anna, String(ANNA.id));
    ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at: '2026-01-15 11:05', depthM: 18, minutes: 30, nr: 1, buddies: [ANNA.id, BOB.id] }));
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [] });
    expect(started.statusCode).toBe(202);
    await ctx.imports.processImport(started.json().id);
    const done = (await call('GET', `/api/imports/${started.json().id}`)).json() as { outcome: { result: string; diveId: string }[] };
    expect(done.outcome[0]).toMatchObject({ result: 'created' });
    // Anna is a Participant; Bob, remembered for no one, is skipped; the dive's own Diver is none.
    const rows = await t.db.select({ diverId: participant.diverId }).from(participant).where(eq(participant.diveId, done.outcome[0]!.diveId));
    expect(rows.map((r) => r.diverId)).toEqual([anna]);
  });
});
