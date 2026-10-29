// The scheduled fetch (ADR 0056): a Connection with "Fetch from <Provider>" on imports the account's dives by itself, at
// its interval and when the User opens Dive Hub. The minute tick and the opening queue one job per due Connection; the
// job starts the same Import a manual one would, unattended (dive-import.ts leaves what only the User can decide). A read
// never comes sooner than the Provider's minimum. A successful read sets the Connection's `lastUsedAt`, which wakes the
// Provider's stopped Waiting pushes at the next tick.
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { connection, importJob, type ConnectionRow } from '../db/schema.js';
import type { DiveImportService } from './dive-import.js';
import { realClock, type Clock } from './leases.js';
import { ProviderServiceError, type ProviderRegistry } from './registry.js';
import type { WaitingPushLog } from './waiting-push-queue.js';

/** One fetch of a Connection (job key `fetch:<connection>`). */
export const FETCH_TASK = 'scheduled_fetch';
/** The fetch on opening reads only when the last fetch is older than this (and than the Provider's minimum). */
export const OPENING_AFTER_MINUTES = 60;

const MINUTE_MS = 60_000;

export function createScheduledFetch(deps: { db: Db; registry: ProviderRegistry; diveImports: DiveImportService; clock?: Clock; log?: WaitingPushLog }) {
  const { db, registry, diveImports } = deps;
  // Without a logger (a script or a test that doesn't look), the fault still goes somewhere an operator sees it.
  const log: WaitingPushLog = deps.log ?? { error: (detail, message) => console.error(message, detail), warn: (detail, message) => console.warn(message, detail) };
  const clock = deps.clock ?? realClock;

  /** The shortest interval the Provider allows, when this instance has it and it imports dives; else null (no fetch). */
  function minimumOf(provider: string): number | null {
    const adapter = registry.list().find((a) => a.id === provider);
    if (!adapter?.capabilities.data.dives?.import?.operations.includes('list')) return null;
    return adapter.capabilities.limits.fetchEveryMinutes;
  }

  /**
   * What keeps the Connection from fetching now, whatever the time: a sign-in only the User can give, import off, or an
   * import under way (`running`: the Connections with one, when the caller has asked for them all at once).
   */
  async function blocked(conn: ConnectionRow, running?: Set<string>): Promise<boolean> {
    if (conn.fetchEveryMinutes === null || conn.importMode === 'off') return true;
    if (conn.state === 'needs_sign_in' && !conn.keepSignedIn) return true;
    if (running) return running.has(conn.id);
    const [busy] = await db.select({ id: importJob.id }).from(importJob)
      .where(and(eq(importJob.connectionId, conn.id), inArray(importJob.status, ['pending', 'processing']))).limit(1);
    return !!busy;
  }

  /** Whether the Connection's last fetch is older than `minutes` (and than the Provider's minimum), and nothing blocks it. */
  async function due(conn: ConnectionRow, minutes: number, at: number, running?: Set<string>): Promise<boolean> {
    const minimum = minimumOf(conn.provider);
    if (minimum === null) return false;
    const every = Math.max(minutes, minimum) * MINUTE_MS;
    if (conn.lastFetchedAt && at - conn.lastFetchedAt.getTime() <= every) return false;
    return !(await blocked(conn, running));
  }

  const queue = (connectionId: string) => db.execute(sql`select graphile_worker.add_job(${FETCH_TASK},
    json_build_object('connectionId', ${connectionId}::text), job_key => ${'fetch:' + connectionId}, max_attempts => 1)`);

  return {
    /**
     * The job: starts an unattended Import of the Connection's dives, unless something blocks it or the last fetch is
     * younger than the Provider's minimum. Every attempt claims the interval before it reads (a Provider that is down is
     * not read every minute). Its Import becomes the summary (`lastFetchImportId`) when it finishes (`finished`).
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
        await diveImports.start(conn.userId, conn.id, { computers: {}, decisions: {}, unattended: true });
      } catch (error) {
        // The Provider's answer (signed out, down): the Connection shows it, and the next interval tries again.
        if (!(error instanceof ProviderServiceError)) throw error;
        log.warn({ connectionId: conn.id, provider: conn.provider, code: error.code }, 'a scheduled fetch failed');
      }
    },

    /**
     * An Import finished: when it is a scheduled fetch's and done, it is the Connection's last fetch for the summary,
     * unless the one there is newer. A running or failed fetch leaves the last finished one.
     */
    async finished(importId: string): Promise<void> {
      const [made] = await db.select().from(importJob).where(eq(importJob.id, importId));
      if (!made?.connectionId || made.status !== 'done' || !made.plan?.unattended) return;
      const [stored] = await db.select({ createdAt: importJob.createdAt }).from(connection)
        .leftJoin(importJob, eq(importJob.id, connection.lastFetchImportId)).where(eq(connection.id, made.connectionId));
      if (stored?.createdAt && stored.createdAt >= made.createdAt) return;
      await db.update(connection).set({ lastFetchImportId: made.id }).where(eq(connection.id, made.connectionId));
    },

    /** The minute tick's part: a fetch job for each Connection whose interval passed since its last fetch. */
    async tick(): Promise<void> {
      const at = clock.now();
      const running = new Set((await db.selectDistinct({ id: importJob.connectionId }).from(importJob)
        .where(and(isNotNull(importJob.connectionId), inArray(importJob.status, ['pending', 'processing'])))).map((r) => r.id!));
      for (const conn of await db.select().from(connection).where(isNotNull(connection.fetchEveryMinutes))) {
        if (await due(conn, conn.fetchEveryMinutes!, at, running)) await queue(conn.id);
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
