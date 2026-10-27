// The worker's side of the Waiting pushes (ADR 0056): one step of a Connection's job sends one due entry through the
// ordinary `pushes.send` or `pushes.remove`, as the Connection's User (nothing goes out another way, as a Push run),
// and says when to come again. It holds what can't go out by itself (a blocking requirement, a sign-in, a dive already
// at the Provider, a lost verification), retries a Provider that is down for a day, and stops what would fail again.
// The minute tick wakes what a sign-in or the Provider's return cleared, and Retry is the User's.
import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { connection, dive, pushRun, waitingPush } from '../db/schema.js';
import { realClock, type Clock } from './leases.js';
import type { PushService } from './push-service.js';
import { ProviderServiceError, type ProviderRegistry } from './registry.js';
import { blocking } from './requirements.js';
import { mark, scheduleConnection, settle, type QueueMark } from './waiting-push-queue.js';

/** After a failure the Provider may be back: tried again after 5 min, 30 min, 2 h, then every 6 h (the last repeats). */
export const RETRY_AFTER_MS = [300_000, 1_800_000, 7_200_000, 21_600_000];
/** A day after the first failure, an entry is stopped and only waking or Retry brings it back. */
export const GIVE_UP_MS = 86_400_000;
/** How long the job waits for a Push run of the Connection, and an entry for a Dive another action holds. */
const WAIT_MS = 30_000;
/** The minute tick of automation (the worker's crontab). */
export const AUTOMATION_TICK_TASK = 'automation_tick';

/** Failures that may pass by themselves: tried again for a day. Any other code would fail the same way again. */
const RETRIED = new Set(['provider_unavailable', 'internal_error']);

/** Where Dive Hub's own faults go for the operator (the app's logger in production; Users see only the code). */
export interface WaitingPushLog {
  error(detail: object, message: string): void;
}

type Entry = typeof waitingPush.$inferSelect;
type Connection = typeof connection.$inferSelect;

export function createWaitingPushService(deps: { db: Db; registry: ProviderRegistry; pushes: PushService; clock?: Clock; log?: WaitingPushLog }) {
  const { db, registry, pushes } = deps;
  // Without a logger (a script or a test that doesn't look), the fault still goes somewhere an operator sees it.
  const log: WaitingPushLog = deps.log ?? { error: (detail, message) => console.error(message, detail) };
  const clock = deps.clock ?? realClock;
  const now = () => new Date(clock.now());
  const the = (entry: Entry) => and(eq(waitingPush.diveId, entry.diveId), eq(waitingPush.provider, entry.provider));
  /** The entry as the step found it: an update after the attempt leaves alone an entry a change made fresh meanwhile. */
  const unchanged = (entry: Entry, seen: QueueMark) => and(the(entry), sql`${waitingPush.changedAt} = ${seen}::timestamptz`);

  /** The Connection's due entries, oldest due first. */
  const dueOf = (connectionId: string, limit: number) => db.select().from(waitingPush)
    .where(and(eq(waitingPush.connectionId, connectionId), eq(waitingPush.state, 'waiting'), lte(waitingPush.dueAt, now())))
    .orderBy(asc(waitingPush.dueAt)).limit(limit);

  /** The Connection needs the User to sign in: its waiting entries wait for that; the tick wakes them after it. */
  async function holdForSignIn(connectionId: string) {
    await db.update(waitingPush).set({ state: 'held', reason: 'sign_in' })
      .where(and(eq(waitingPush.connectionId, connectionId), eq(waitingPush.state, 'waiting')));
  }

  const hold = (entry: Entry, seen: QueueMark, reason: string, detail?: Entry['detail']) =>
    db.update(waitingPush).set({ state: 'held', reason, ...(detail && { detail }) }).where(unchanged(entry, seen));

  /** A failed attempt, by its problem code (the spec's "Failures and retries"). */
  async function failed(entry: Entry, seen: QueueMark, code: string): Promise<'signed_out' | void> {
    if (code === 'provider_sign_in_needed') {
      await holdForSignIn(entry.connectionId);
      return 'signed_out';
    }
    const at = now();
    // Another action has the Dive at the Provider right now: later, and it doesn't count as an attempt.
    if (code === 'provider_busy') {
      await db.update(waitingPush).set({ dueAt: new Date(at.getTime() + WAIT_MS) }).where(unchanged(entry, seen));
      return;
    }
    // The send found the Dive short of a blocking requirement after all: it goes out after the save that meets it.
    if (code === 'provider_requirements_unmet') {
      await hold(entry, seen, 'requirements');
      return;
    }
    const attempts = entry.attempts + 1;
    const firstFailedAt = entry.firstFailedAt ?? at;
    if (RETRIED.has(code) && at.getTime() - firstFailedAt.getTime() < GIVE_UP_MS) {
      const dueAt = new Date(at.getTime() + RETRY_AFTER_MS[Math.min(attempts - 1, RETRY_AFTER_MS.length - 1)]!);
      await db.update(waitingPush).set({ attempts, firstFailedAt, dueAt }).where(unchanged(entry, seen));
      return;
    }
    await db.update(waitingPush).set({ state: 'stopped', reason: code, attempts, firstFailedAt, stoppedAt: at }).where(unchanged(entry, seen));
  }

  /** A `send` entry: held, dropped as up to date, or sent as the Connection's User. */
  async function sendOne(conn: Connection, entry: Entry, seen: QueueMark) {
    const [row] = await db.select({ deletedAt: dive.deletedAt }).from(dive).where(eq(dive.id, entry.diveId));
    // Deleted here (delete at the Provider off, or never there): nothing to send.
    if (!row || row.deletedAt) {
      await db.delete(waitingPush).where(unchanged(entry, seen));
      return;
    }
    const status = await pushes.status(conn.userId, entry.diveId, entry.provider);
    if (blocking(status.unmet, { beforeSite: true }).length > 0) {
      await hold(entry, seen, 'requirements');
      return;
    }
    const { current } = status;
    const decided = entry.options.onExisting !== undefined || Object.keys(entry.options.conflicts ?? {}).length > 0;
    // A number the Connection follows that an update would set counts as a change, as in the logbook's filter.
    if (current && current.upToDate && !(current.number?.differs && current.number.canSet) && !decided) {
      await settle(db, entry.diveId, entry.provider, seen, 'send');
      return;
    }
    if (current?.updateRemovesVerification) {
      await hold(entry, seen, 'removes_verification');
      return;
    }
    const sent = await pushes.send(conn.userId, entry.diveId, entry.provider, { onConflict: 'defer', ...entry.options });
    if (sent.result === 'exists') {
      const { remoteId, number, startsAt } = sent.existing;
      await hold(entry, seen, 'exists', { remoteId, remoteNumber: number, startsAt: startsAt ?? '' });
    } else if (sent.result === 'conflicts') {
      throw new Error('a deferred send answers no Conflicts');
    } else if (sent.push.state !== 'confirmed') {
      // Handed over without an ID: the send settles only confirmed Pushes, but this one is done too.
      await settle(db, entry.diveId, entry.provider, seen, 'send');
    }
  }

  /** One attempt at the entry; never throws for its sake. */
  async function attempt(conn: Connection, entry: Entry): Promise<'signed_out' | void> {
    const seen = await mark(db, entry.diveId, entry.provider);
    try {
      if (entry.action === 'delete') await pushes.remove(conn.userId, entry.diveId, entry.provider);
      else await sendOne(conn, entry, seen);
    } catch (error) {
      if (error instanceof ProviderServiceError) return failed(entry, seen, error.code);
      // Dive Hub's own fault: the entry is retried and then stopped as `internal_error`; the error is for the operator.
      log.error({ err: error, diveId: entry.diveId, provider: entry.provider, connectionId: conn.id, action: entry.action },
        'a Waiting push failed with an internal error');
      return failed(entry, seen, 'internal_error');
    }
  }

  return {
    /**
     * One step of the Connection's job: sends its oldest due entry and answers when to come again (the Provider's
     * pause while more are due), or null when the job is scheduled for the next due entry or not needed.
     */
    async step(connectionId: string): Promise<{ afterMs: number } | null> {
      const [conn] = await db.select().from(connection).where(eq(connection.id, connectionId));
      // Gone, or at a Provider this instance no longer has: nothing to send through it.
      if (!conn || registry.list().every((a) => a.id !== conn.provider)) return null;
      if (conn.state === 'needs_sign_in' && !conn.keepSignedIn) {
        await holdForSignIn(conn.id);
        return null;
      }
      const [run] = await db.select({ id: pushRun.id }).from(pushRun)
        .where(and(eq(pushRun.connectionId, conn.id), inArray(pushRun.status, ['queued', 'running']))).limit(1);
      if (run) return { afterMs: WAIT_MS };
      const [entry] = await dueOf(conn.id, 1);
      if (!entry) {
        await scheduleConnection(db, conn.id);
        return null;
      }
      if ((await attempt(conn, entry)) === 'signed_out') return null;
      if ((await dueOf(conn.id, 1)).length > 0) return { afterMs: registry.get(conn.provider).capabilities.limits.pauseMs };
      await scheduleConnection(db, conn.id);
      return null;
    },

    /**
     * The minute tick (fetching comes with the scheduled fetch): entries held for a sign-in of a Connection signed in
     * again, and entries stopped as unavailable at a Provider that answered any Connection since, wait again, due now.
     * Every Connection with a due entry has its job (a safety net for a job that got lost).
     */
    async tick(): Promise<void> {
      const at = now();
      const signedIn = db.select({ id: connection.id }).from(connection).where(eq(connection.state, 'active'));
      await db.update(waitingPush).set({ state: 'waiting', reason: null, dueAt: at })
        .where(and(eq(waitingPush.state, 'held'), eq(waitingPush.reason, 'sign_in'), inArray(waitingPush.connectionId, signedIn)));
      const answered = sql`exists (select 1 from ${connection} where ${connection.provider} = ${waitingPush.provider}
        and ${connection.lastUsedAt} > ${waitingPush.stoppedAt})`;
      await db.update(waitingPush).set({ state: 'waiting', reason: null, dueAt: at, attempts: 0, firstFailedAt: null, stoppedAt: null })
        .where(and(eq(waitingPush.state, 'stopped'), eq(waitingPush.reason, 'provider_unavailable'), isNotNull(waitingPush.stoppedAt), answered));
      const due = await db.selectDistinct({ id: waitingPush.connectionId }).from(waitingPush)
        .where(and(eq(waitingPush.state, 'waiting'), lte(waitingPush.dueAt, at)));
      for (const { id } of due) await scheduleConnection(db, id, { keepTime: true });
    },

    /**
     * The User's Retry: a stopped or held entry of the Dive at the Provider waits again, due now. Only through the
     * User's own Connection (`connection_not_found`); `waiting_push_not_found` when there is no such entry.
     */
    async retry(userId: string, diveId: string, provider: string): Promise<void> {
      const [entry] = await db.select({ entry: waitingPush, userId: connection.userId }).from(waitingPush)
        .innerJoin(connection, eq(connection.id, waitingPush.connectionId))
        .where(and(eq(waitingPush.diveId, diveId), eq(waitingPush.provider, provider)));
      if (!entry || entry.entry.state === 'waiting') throw new ProviderServiceError('waiting_push_not_found');
      if (entry.userId !== userId) throw new ProviderServiceError('connection_not_found');
      await db.update(waitingPush).set({ state: 'waiting', reason: null, dueAt: now(), attempts: 0, firstFailedAt: null, stoppedAt: null })
        .where(the(entry.entry));
      await scheduleConnection(db, entry.entry.connectionId);
    },
  };
}

export type WaitingPushService = ReturnType<typeof createWaitingPushService>;
