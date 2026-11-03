// A lease per key (ADR 0027, backlog 0005): one holder per key at a time across app processes, a waiter refused after
// MAX_WAIT_MS, a lease that ran out taken over, and no pool connection held while waiting or holding.
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../src/db/schema.js';
import { providerLease } from '../src/db/schema.js';
import { LEASE_MS, LeaseBusy, MAX_WAIT_MS, POLL_MS, keyLease, realClock } from '../src/providers/lease-service.js';
import { createTestDatabase, databaseReachable, resettableClock, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('keyLease', () => {
  let t: TestDatabase;
  let clock: ReturnType<typeof resettableClock>;
  const log = { error: () => undefined, warn: () => undefined };
  const rowsOf = (key: string) => t.db.select().from(providerLease).where(eq(providerLease.key, key));

  beforeAll(async () => { t = await createTestDatabase(); });
  afterAll(async () => { await t?.drop(); });
  beforeEach(async () => {
    clock = resettableClock({ stopped: true });
    await t.db.delete(providerLease);
  });

  it('runs one holder per key at a time and the next after it', async () => {
    const order: string[] = [];
    let finish!: () => void;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => { entered = resolve; });
    // Real time here: the waiter looks again every POLL_MS while the first holds the key.
    const lease = { key: 'k', source: 'ssi', clock: realClock, log };
    const a = keyLease(t.db, lease, async () => { order.push('a-start'); entered(); await held; order.push('a-end'); });
    await inside;
    const b = keyLease(t.db, lease, async () => { order.push('b-start'); });
    await new Promise((resolve) => setTimeout(resolve, 2 * POLL_MS));
    finish();
    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start']);
  });

  it('refuses with LeaseBusy after MAX_WAIT_MS', async () => {
    await t.db.insert(providerLease).values({ key: 'k', holder: crypto.randomUUID(), lockedUntil: new Date(clock.now() + LEASE_MS) });
    const refused = await keyLease(t.db, { key: 'k', source: 'ssi', clock, log }, async () => 'ran').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(LeaseBusy);
    expect((refused as LeaseBusy).provider).toBe('ssi');
    expect(clock.slept.length).toBeGreaterThan(0);
    expect(clock.slept.every((ms) => ms === POLL_MS)).toBe(true);
    expect(clock.slept.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(MAX_WAIT_MS);
  });

  it('takes over a lease that ran out', async () => {
    await t.db.insert(providerLease).values({ key: 'k', holder: crypto.randomUUID(), lockedUntil: new Date(clock.now() - 1) });
    expect(await keyLease(t.db, { key: 'k', source: 'ssi', clock, log }, async () => 'ran')).toBe('ran');
    expect(await rowsOf('k')).toEqual([]);
  });

  it('gives the lease back when the work fails', async () => {
    const failed = await keyLease(t.db, { key: 'k', source: 'ssi', clock, log }, async () => { throw new Error('x'); })
      .catch((error: unknown) => error);
    expect((failed as Error).message).toBe('x');
    expect(await rowsOf('k')).toEqual([]);
  });

  it('logs a lease it could not give back, and answers what the work answered', async () => {
    const failing = { error: vi.fn(), warn: () => undefined };
    const answer = await keyLease(t.db, { key: 'k', source: 'ssi', clock, log: failing }, async () => {
      await t.db.execute(sql`alter table provider_lease rename to provider_lease_away`);
      return 'ran';
    });
    await t.db.execute(sql`alter table provider_lease_away rename to provider_lease`);
    expect(answer).toBe('ran');
    expect(failing.error).toHaveBeenCalledOnce();
    expect(failing.error.mock.calls[0]![0]).toMatchObject({ key: 'k' });
  });

  it('leaves a lease another holder took over after it ran out', async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    let second!: Promise<void>;
    let secondHolder: string | undefined;
    await keyLease(t.db, { key: 'k', source: 'ssi', clock, log }, async () => {
      clock.skip(LEASE_MS + 1);
      let entered!: () => void;
      const inside = new Promise<void>((resolve) => { entered = resolve; });
      second = keyLease(t.db, { key: 'k', source: 'ssi', clock, log }, async () => {
        secondHolder = (await rowsOf('k'))[0]?.holder;
        entered();
        await held;
      });
      await inside;
    });
    const rows = await rowsOf('k');
    expect(secondHolder).toBeDefined();
    expect(rows.map((r) => r.holder)).toEqual([secondHolder]);
    finish();
    await second;
    expect(await rowsOf('k')).toEqual([]);
  });

  it('holds no connection: two holders of different keys on a pool of one, whose work queries, both finish', async () => {
    const small = new pg.Pool({ connectionString: t.pool.options.connectionString, max: 1 });
    try {
      const db = drizzle(small, { schema });
      const work = async () => {
        await db.execute(sql`select 1`);
        await new Promise((resolve) => setImmediate(resolve));
        await db.execute(sql`select 1`);
        return 'done';
      };
      const both = await Promise.all([
        keyLease(db, { key: 'a', source: 'ssi', clock, log }, work),
        keyLease(db, { key: 'b', source: 'ssi', clock, log }, work),
      ]);
      expect(both).toEqual(['done', 'done']);
    } finally {
      await small.end();
    }
  });
});
