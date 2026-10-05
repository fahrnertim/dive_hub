// Leases in PostgreSQL (ADR 0027, amended): one action per Dive and Provider at a time, and actions on one Connection
// one after another with the Provider's pause between them, across every app process on the database. A lease is a
// time it holds until, taken with one conditional statement. Nothing holds a transaction or a pool connection while a
// Provider is called, and a lease a crashed process left behind runs out by itself.
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { connection, diveLease } from '../db/schema.js';

/** Where leases take their time from. Every app process on one database must agree on it (NTP is enough). */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = { now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/** Real time, but sleeping skips ahead instead of waiting, and is recorded (tests and the browser tests' server). */
export function skippingClock() {
  let skipped = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => Date.now() + skipped,
    async sleep(ms: number) { slept.push(ms); skipped += ms; },
    /** Moves time on, as if that long had passed. */
    skip(ms: number) { skipped += ms; },
  };
}

/** How long a lease holds at most: longer than the slowest action (a few Provider calls of up to a minute each). */
export const LEASE_MS = 5 * 60_000;
/** How long a request waits for its Connection's turn before it is refused (`provider_busy`). */
export const MAX_WAIT_MS = 30_000;
/** How often a waiting request looks again while another action holds the turn. */
export const POLL_MS = 250;

/** The lease is held by another action; the request is refused, not queued. */
export class LeaseBusy extends Error {
  constructor(readonly provider: string) {
    super(`busy at ${provider}`);
  }
}

/** The Connection's turn didn't come within MAX_WAIT_MS. */
export class TurnTimeout extends Error {}

export function createLeases(deps: { db: Db; clock?: Clock }) {
  const { db } = deps;
  const clock = deps.clock ?? realClock;

  /** Takes the lease of a Dive at a Provider unless another action holds it: one statement, so only one can win. */
  async function take(diveId: string, provider: string, holder: string): Promise<boolean> {
    const now = clock.now();
    const lockedUntil = new Date(now + LEASE_MS);
    const won = await db.insert(diveLease).values({ diveId, provider, holder, lockedUntil })
      .onConflictDoUpdate({
        target: [diveLease.diveId, diveLease.provider], set: { holder, lockedUntil },
        setWhere: lt(diveLease.lockedUntil, new Date(now)),
      })
      .returning({ holder: diveLease.holder });
    return won.length > 0;
  }

  const release = (diveId: string, provider: string, holder: string) =>
    db.delete(diveLease).where(and(eq(diveLease.diveId, diveId), eq(diveLease.provider, provider), eq(diveLease.holder, holder)));

  return {
    /**
     * Runs `fn` holding the Dive's lease at each of these Providers, or throws LeaseBusy naming the first one another
     * action holds (and takes none).
     */
    async dive<T>(diveId: string, providers: string[], fn: () => Promise<T>): Promise<T> {
      const holder = randomUUID();
      const taken: string[] = [];
      try {
        for (const provider of providers) {
          if (!(await take(diveId, provider, holder))) throw new LeaseBusy(provider);
          taken.push(provider);
        }
        return await fn();
      } finally {
        for (const provider of taken) await release(diveId, provider, holder);
      }
    },

    /**
     * Runs `fn` on the Connection's turn: after the action before it ended and its pause passed. Waits up to
     * MAX_WAIT_MS, then throws TurnTimeout. `fn` gets the Connection as it is now, or null once it is gone (then
     * without a turn).
     */
    async turn<T>(connectionId: string, pauseMs: number, fn: (row: typeof connection.$inferSelect | null) => Promise<T>): Promise<T> {
      const started = clock.now();
      for (;;) {
        const now = clock.now();
        const until = new Date(now + LEASE_MS);
        const [row] = await db.update(connection).set({ nextActionAt: until })
          .where(and(eq(connection.id, connectionId), or(isNull(connection.nextActionAt), lte(connection.nextActionAt, new Date(now)))))
          .returning();
        if (row) {
          try {
            return await fn(row);
          } finally {
            // Only while the turn is still this action's: one that outlasted its lease leaves the next one alone.
            await db.update(connection).set({ nextActionAt: new Date(clock.now() + pauseMs) })
              .where(and(eq(connection.id, connectionId), eq(connection.nextActionAt, until)));
          }
        }
        const [held] = await db.select({ at: connection.nextActionAt }).from(connection).where(eq(connection.id, connectionId));
        if (!held) return fn(null);
        const left = (held.at?.getTime() ?? now) - now;
        if (left <= 0) continue;
        // What is left of a pause is waited out at once; a running action is looked at again every POLL_MS.
        const wait = left <= pauseMs ? left : POLL_MS;
        if (now + wait - started > MAX_WAIT_MS) throw new TurnTimeout();
        await clock.sleep(wait);
      }
    },
  };
}

export type Leases = ReturnType<typeof createLeases>;
