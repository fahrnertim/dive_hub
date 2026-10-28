// The scheduled fetch (ADR 0056): a Connection with "Fetch from <Provider>" on imports the account's dives by itself, at
// its interval and when the User opens Dive Hub. The minute tick and the opening queue one job per due Connection; the
// job starts the same Import a manual one would, unattended (dive-import.ts leaves what only the User can decide). A read
// never comes sooner than the Provider's minimum. A successful read sets the Connection's `lastUsedAt`, which wakes the
// Provider's stopped Waiting pushes at the next tick.
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { connection, importJob } from '../db/schema.js';
import type { DiveImportService } from './dive-import.js';
import { realClock, type Clock } from './leases.js';
import { ProviderServiceError, type ProviderRegistry } from './registry.js';

/** One fetch of a Connection (job key `fetch:<connection>`). */
export const FETCH_TASK = 'scheduled_fetch';
/** The fetch on opening reads only when the last fetch is older than this (and than the Provider's minimum). */
export const OPENING_AFTER_MINUTES = 60;

const MINUTE_MS = 60_000;
type Connection = typeof connection.$inferSelect;

export function createScheduledFetch(deps: { db: Db; registry: ProviderRegistry; diveImports: DiveImportService; clock?: Clock }) {
  const { db, registry, diveImports } = deps;
  const clock = deps.clock ?? realClock;

  /** The shortest interval the Provider allows, when this instance has it and it imports dives; else null (no fetch). */
  function minimumOf(provider: string): number | null {
    const adapter = registry.list().find((a) => a.id === provider);
    if (!adapter?.capabilities.data.dives?.import?.operations.includes('list')) return null;
    return adapter.capabilities.limits.fetchEveryMinutes;
  }

  /** What keeps the Connection from fetching now, whatever the time: a sign-in only the User can give, import off, or an import under way. */
  async function blocked(conn: Connection): Promise<boolean> {
    if (conn.fetchEveryMinutes === null || conn.importMode === 'off') return true;
    if (conn.state === 'needs_sign_in' && !conn.keepSignedIn) return true;
    const [busy] = await db.select({ id: importJob.id }).from(importJob)
      .where(and(eq(importJob.connectionId, conn.id), inArray(importJob.status, ['pending', 'processing']))).limit(1);
    return !!busy;
  }

  /** Whether the Connection's last fetch is older than `minutes` (and than the Provider's minimum), and nothing blocks it. */
  async function due(conn: Connection, minutes: number, at: number): Promise<boolean> {
    const minimum = minimumOf(conn.provider);
    if (minimum === null) return false;
    const every = Math.max(minutes, minimum) * MINUTE_MS;
    if (conn.lastFetchedAt && at - conn.lastFetchedAt.getTime() <= every) return false;
    return !(await blocked(conn));
  }

  const queue = (connectionId: string) => db.execute(sql`select graphile_worker.add_job(${FETCH_TASK},
    json_build_object('connectionId', ${connectionId}::text), job_key => ${'fetch:' + connectionId}, max_attempts => 1)`);

  return {
    /**
     * The job: starts an unattended Import of the Connection's dives, unless something blocks it or the last fetch is
     * younger than the Provider's minimum. Every attempt claims the interval before it reads (a Provider that is down is
     * not read every minute); a successful one also keeps its Import for the summary (`lastFetchImportId`).
     */
    async fetch(connectionId: string): Promise<void> {
      const [conn] = await db.select().from(connection).where(eq(connection.id, connectionId));
      if (!conn) return;
      const minimum = minimumOf(conn.provider);
      const at = clock.now();
      if (minimum === null || (await blocked(conn))) return;
      // The slot is claimed before the read: a second job of the Connection (queued again while this one reads) finds
      // it taken and reads nothing, so no read comes sooner than the minimum and no dive is imported twice.
      const claimed = await db.update(connection).set({ lastFetchedAt: new Date(at) })
        .where(and(eq(connection.id, conn.id), or(isNull(connection.lastFetchedAt), lte(connection.lastFetchedAt, new Date(at - minimum * MINUTE_MS)))))
        .returning({ id: connection.id });
      if (claimed.length === 0) return;
      try {
        const made = await diveImports.start(conn.userId, conn.id, { computers: {}, decisions: {}, unattended: true });
        await db.update(connection).set({ lastFetchImportId: made.id }).where(eq(connection.id, conn.id));
      } catch (error) {
        // The Provider's answer (signed out, down): the Connection shows it, and the next interval tries again.
        if (!(error instanceof ProviderServiceError)) throw error;
      }
    },

    /** The minute tick's part: a fetch job for each Connection whose interval passed since its last fetch. */
    async tick(): Promise<void> {
      const at = clock.now();
      for (const conn of await db.select().from(connection).where(isNotNull(connection.fetchEveryMinutes))) {
        if (await due(conn, conn.fetchEveryMinutes!, at)) await queue(conn.id);
      }
    },

    /**
     * The User opened Dive Hub: a fetch job for each of their Connections with the schedule on whose last fetch is more
     * than an hour old (and older than the Provider's minimum). Answers how many were queued.
     */
    async fetchDue(userId: string): Promise<number> {
      const at = clock.now();
      let queued = 0;
      const conns = await db.select().from(connection).where(and(eq(connection.userId, userId), isNotNull(connection.fetchEveryMinutes)));
      for (const conn of conns) {
        if (!(await due(conn, OPENING_AFTER_MINUTES, at))) continue;
        await queue(conn.id);
        queued += 1;
      }
      return queued;
    },
  };
}

export type ScheduledFetch = ReturnType<typeof createScheduledFetch>;
