// Leases in PostgreSQL (ADR 0027, amended), proven with two app instances on one database, as two processes would run:
// one action per Dive and Provider (a second request is refused), actions on one Connection one after another with the
// Provider's pause (a request waits its turn, but only so long), leases a crashed process left run out, and no
// transaction is held open while a Provider is called.
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connection, diveLease } from '../src/db/schema.js';
import { LEASE_MS, MAX_WAIT_MS, POLL_MS, skippingClock } from '../src/providers/leases.js';
import { createFakeHandover, type FakeHandover } from './fake-handover-provider.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

describe.skipIf(!(await databaseReachable()))('leases across app instances', () => {
  let t: TestDatabase;
  /** Two app instances on one database, sharing a clock and the outside service, as two processes would. */
  let one: Awaited<ReturnType<typeof createTestApp>>;
  let two: Awaited<ReturnType<typeof createTestApp>>;
  const clock = skippingClock();
  let fake: FakeHandover;
  let tim: string;
  let dives: string[];

  const send = (app: typeof one, diveId: string) =>
    app.app.inject({ method: 'POST', url: `/api/dives/${diveId}/providers/handover`, headers: { cookie: tim, origin: BASE_URL }, payload: {} });
  /** Holds the next hand-over open until `release` is called; `entered` resolves once it is inside the Provider call. */
  function gate() {
    let release!: () => void;
    let entered!: () => void;
    const open = new Promise<void>((resolve) => { release = resolve; });
    const inside = new Promise<void>((resolve) => { entered = resolve; });
    fake.during = async () => { fake.during = null; entered(); await open; };
    return { release, inside };
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    fake = createFakeHandover();
    one = await createTestApp(t, { extraProviders: [fake.adapter], clock });
    two = await createTestApp(t, { extraProviders: [fake.adapter], clock });
    await createUser(one.auth, 'tim@example.com');
    tim = await signIn(one.app, 'tim@example.com');
    const headers = { cookie: tim, origin: BASE_URL };
    const diverId = ((await one.app.inject({ method: 'GET', url: '/api/divers', headers })).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    dives = [];
    for (const day of [15, 16, 17]) {
      const { payload, headers: h } = multipartFile(`${day}.fit`, makeSyntheticDive({ serialNumber: 111, start: new Date(`2026-01-${day}T09:00:00Z`) }));
      const created = await one.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...h, cookie: tim } });
      await one.imports.processImport(created.json().id);
      dives.push((await one.app.inject({ method: 'GET', url: `/api/imports/${created.json().id}`, headers })).json().outcome[0].diveId);
    }
    const connected = await two.app.inject({ method: 'POST', url: '/api/connections/handover', headers, payload: { diverId, token: 'handover-token-1', keepSignedIn: false } });
    expect(connected.statusCode).toBe(201);
  });
  afterAll(async () => {
    await one?.app.close();
    await two?.app.close();
    await t?.drop();
  });

  it('runs one action per Dive and Provider: the other instance is refused while it runs', async () => {
    const { release, inside } = gate();
    const first = send(one, dives[0]!);
    await inside;
    const second = await send(two, dives[0]!);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'provider_busy', provider: 'handover', providerName: 'Hand-over' });
    release();
    expect((await first).json()).toMatchObject({ outcome: 'created' });
    // The lease is gone with the action: the same Dive can be sent again at once.
    expect(await t.db.select().from(diveLease)).toEqual([]);
    expect((await send(two, dives[0]!)).json()).toMatchObject({ outcome: 'created' });
  });

  it('runs actions on one Connection one after another, the Provider\'s pause apart, whichever instance takes them', async () => {
    const starts: number[] = [];
    fake.during = async () => { starts.push(clock.now()); };
    const sent = await Promise.all([send(one, dives[0]!), send(two, dives[1]!), send(one, dives[2]!)]);
    fake.during = null;
    expect(sent.map((r) => r.json().outcome)).toEqual(['created', 'created', 'created']);
    starts.sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(500);
  });

  it('waits for a turn another action holds, and refuses once it takes too long', async () => {
    const { release, inside } = gate();
    const first = send(one, dives[0]!);
    await inside;
    // Waiting while the first runs (looking again every so often), then its pause, then it runs.
    const slept = clock.slept.length;
    const waiting = send(two, dives[1]!);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    expect((await first).json()).toMatchObject({ outcome: 'created' });
    expect((await waiting).json()).toMatchObject({ outcome: 'created' });
    expect(clock.slept.length).toBeGreaterThan(slept);

    // A crashed action still holds the turn: the request waits no longer than MAX_WAIT_MS, then is refused.
    const [conn] = await t.db.select().from(connection);
    await t.db.update(connection).set({ nextActionAt: new Date(clock.now() + LEASE_MS) }).where(eq(connection.id, conn!.id));
    const from = clock.slept.length;
    const startedAt = clock.now();
    const refused = await send(one, dives[2]!);
    const elapsed = clock.now() - startedAt;
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'provider_busy', provider: 'handover' });
    const waited = clock.slept.slice(from).reduce((sum, ms) => sum + ms, 0);
    // The clock moves with real time as well as with each sleep: under load each poll's query takes longer and fewer
    // sleeps fit, so the bound is checked on the time that passed, not on the sum of the sleeps.
    expect(elapsed).toBeGreaterThan(MAX_WAIT_MS - POLL_MS);
    expect(waited).toBeLessThanOrEqual(MAX_WAIT_MS);
    // Its turn runs out by itself.
    clock.skip(LEASE_MS);
    expect((await send(two, dives[2]!)).json()).toMatchObject({ outcome: 'created' });
  });

  it('frees a Dive lease a crashed process left behind once it runs out', async () => {
    await t.db.insert(diveLease).values({ diveId: dives[1]!, provider: 'handover', holder: randomUUID(), lockedUntil: new Date(clock.now() + LEASE_MS) });
    expect((await send(one, dives[1]!)).json()).toMatchObject({ code: 'provider_busy' });
    clock.skip(LEASE_MS + 1);
    expect((await send(two, dives[1]!)).json()).toMatchObject({ outcome: 'created' });
    expect(await t.db.select().from(diveLease)).toEqual([]);
  });

  it('holds no transaction open while the Provider is called', async () => {
    let open: number | undefined;
    fake.during = async () => {
      const [row] = (await t.db.execute(sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and xact_start is not null and pid <> pg_backend_pid()`)).rows as { n: number }[];
      open = row!.n;
    };
    expect((await send(one, dives[2]!)).json()).toMatchObject({ outcome: 'created' });
    fake.during = null;
    expect(open).toBe(0);
  });
});
