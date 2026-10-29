// The worker's side of the Waiting pushes (ADR 0056): one step of a Connection's job sends one due entry through the
// ordinary `pushes.send` or `pushes.remove`, as the Connection's User (nothing goes out another way, as a Push run),
// and says when to come again. It holds what can't go out by itself (a blocking requirement, a sign-in, a dive already
// at the Provider, a lost verification), retries a Provider that is down for a day, and stops what would fail again.
// The minute tick wakes what a sign-in or the Provider's return cleared, and Retry is the User's.
import { and, arrayOverlaps, asc, count, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { connection, dive, importJob, providerConflict, push, pushRun, waitingPush, type WaitingPushOptions } from '../db/schema.js';
import { managedDiverIds } from '../dives/dive-service.js';
import { currentRemote } from './current-remote.js';
import { realClock, type Clock } from './leases.js';
import type { PushService } from './push-service.js';
import { ProviderServiceError, type ProviderRegistry } from './registry.js';
import { blocking } from './requirements.js';
import { deletingItself, mark, newDivesConnection, queueNow, scheduleConnection, settle, upsertSend, type QueueMark, type WaitingPushLog } from './waiting-push-queue.js';
import { waitingOf } from './waiting-push-view.js';
export type { WaitingPushLog };

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

/** More new Dives than this from one Import are not queued: the Connection offers a Push run instead (ADR 0056). */
export const OFFER_ABOVE = 20;


type Entry = typeof waitingPush.$inferSelect;
type Connection = typeof connection.$inferSelect;

export function createWaitingPushService(deps: { db: Db; registry: ProviderRegistry; pushes: PushService; clock?: Clock; log?: WaitingPushLog }) {
  const { db, registry, pushes } = deps;
  // Without a logger (a script or a test that doesn't look), the fault still goes somewhere an operator sees it.
  const log: WaitingPushLog = deps.log ?? { error: (detail, message) => console.error(message, detail), warn: (detail, message) => console.warn(message, detail) };
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
    db.update(waitingPush).set({ state: 'held', reason, detail: detail ?? null }).where(unchanged(entry, seen));

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
      // The last retry comes when the day is over, not later: that attempt either sends or stops the entry.
      const dueAt = new Date(Math.min(at.getTime() + RETRY_AFTER_MS[Math.min(attempts - 1, RETRY_AFTER_MS.length - 1)]!,
        firstFailedAt.getTime() + GIVE_UP_MS));
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

  /**
   * Per Connection, the Dives of its offer (its Imports' new ones of its Diver, oldest Import first) that still have no
   * remote dive at its Provider. An Import none of whose Dives is still unsent has been sent in full: it leaves the offer,
   * removed from the stored list as it is then (an Import added or dismissed meanwhile stays so). One query each for the
   * Imports' outcomes, their live Dives and the pushes, whatever the number of Connections (`created` when the caller has them).
   */
  async function unsentOf(conns: Connection[], created?: Map<string, { id: string; diverId: string }[]>): Promise<Map<string, string[]>> {
    const found = new Map(conns.map((c) => [c.id, [] as string[]]));
    const offering = conns.filter((c) => c.unsentImportIds.length > 0);
    if (offering.length === 0) return found;
    const made = created ?? await createdByMany([...new Set(offering.flatMap((c) => c.unsentImportIds))]);
    const offered = (c: Connection) => [...new Set(c.unsentImportIds.flatMap((importId) =>
      (made.get(importId) ?? []).filter((d) => d.diverId === c.diverId).map((d) => d.id)))];
    const ids = [...new Set(offering.flatMap(offered))];
    const pushes = ids.length === 0 ? [] : await db.select().from(push)
      .where(and(inArray(push.diveId, ids), inArray(push.provider, [...new Set(offering.map((c) => c.provider))])))
      .orderBy(desc(push.createdAt), desc(push.id));
    const byDive = new Map<string, (typeof pushes)[number][]>();
    for (const p of pushes) byDive.set(`${p.diveId} ${p.provider}`, [...(byDive.get(`${p.diveId} ${p.provider}`) ?? []), p]);
    for (const c of offering) {
      const unsent = offered(c).filter((id) => !currentRemote(byDive.get(`${id} ${c.provider}`) ?? []));
      found.set(c.id, unsent);
      const sent = c.unsentImportIds.filter((importId) => !(made.get(importId) ?? []).some((d) => unsent.includes(d.id)));
      if (sent.length > 0) {
        const left = sent.reduce((list, importId) => sql`array_remove(${list}, ${importId}::uuid)`, sql`${connection.unsentImportIds}`);
        await db.update(connection).set({ unsentImportIds: left }).where(eq(connection.id, c.id));
      }
    }
    return found;
  }

  /** The Dives of the Connection's offer that still have no remote dive at the Provider (`unsentOf` for one). */
  async function unsentDives(connectionId: string): Promise<string[]> {
    const conns = await db.select().from(connection).where(eq(connection.id, connectionId));
    return (await unsentOf(conns)).get(connectionId) ?? [];
  }

  /** The Diver of a Dive of one of the User's Divers; else `dive_not_found`, also for a Dive another User keeps. */
  async function visibleDive(userId: string, diveId: string): Promise<string> {
    const [row] = await db.select({ diverId: dive.diverId }).from(dive).where(eq(dive.id, diveId));
    if (!row || !(await managedDiverIds(db, userId)).has(row.diverId)) throw new ProviderServiceError('dive_not_found');
    return row.diverId;
  }

  /** Per Import, the live Dives it created, with their Diver (in the outcome's order): two queries for all of them. */
  async function createdByMany(importIds: string[]): Promise<Map<string, { id: string; diverId: string }[]>> {
    const found = new Map(importIds.map((id) => [id, [] as { id: string; diverId: string }[]]));
    if (importIds.length === 0) return found;
    const jobs = await db.select({ id: importJob.id, outcome: importJob.outcome }).from(importJob).where(inArray(importJob.id, importIds));
    const made = jobs.map((j) => [j.id, [...new Set((j.outcome ?? []).flatMap((o) => (o.result === 'created' && o.diveId ? [o.diveId] : [])))]] as const);
    const ids = [...new Set(made.flatMap(([, diveIds]) => diveIds))];
    if (ids.length === 0) return found;
    const live = new Map((await db.select({ id: dive.id, diverId: dive.diverId }).from(dive)
      .where(and(inArray(dive.id, ids), isNull(dive.deletedAt)))).map((d) => [d.id, d]));
    for (const [importId, diveIds] of made) found.set(importId, diveIds.flatMap((id) => (live.has(id) ? [live.get(id)!] : [])));
    return found;
  }

  /** A Connection's share of an Import's new Dives: queued, or above `OFFER_ABOVE` only offered. */
  async function queueOrOffer(q: Tx, conn: Connection, diveIds: string[], importId: string, at: Date): Promise<void> {
    if (diveIds.length > OFFER_ABOVE) {
      // Added to what the Connection already offers, once: an earlier Import's offer stays until it is sent or dismissed.
      await q.update(connection).set({ unsentImportIds: sql`array_append(${connection.unsentImportIds}, ${importId}::uuid)` })
        .where(and(eq(connection.id, conn.id), sql`not (${importId}::uuid = any(${connection.unsentImportIds}))`));
      return;
    }
    for (const id of diveIds) await upsertSend(q, conn, id, at);
  }

  return {
    /**
     * An Import finished (the worker calls it, as `imports/` may not reach the queue): its new Dives go to each Provider
     * the Diver has a Connection with "send new dives" to, through the oldest such Connection, except the Import's own
     * Provider. Up to 20 are queued; more are not, and the Connection offers them (`unsentImportIds`, added to an offer it has).
     */
    async afterImport(importId: string): Promise<void> {
      const [job] = await db.select({ provider: importJob.provider }).from(importJob).where(eq(importJob.id, importId));
      if (!job) return;
      const created = (await createdByMany([importId])).get(importId)!;
      const at = now();
      // One transaction: a failure in the middle leaves none of the Import's queueing half done.
      await db.transaction(async (tx) => {
        for (const diverId of new Set(created.map((d) => d.diverId))) {
          const conns = await tx.select().from(connection).where(eq(connection.diverId, diverId)).orderBy(asc(connection.createdAt), asc(connection.id));
          const diveIds = created.filter((d) => d.diverId === diverId).map((d) => d.id);
          for (const provider of new Set(conns.map((c) => c.provider))) {
            const conn = provider === job.provider ? undefined : newDivesConnection(conns, provider);
            if (conn) await queueOrOffer(tx, conn, diveIds, importId, at);
          }
        }
      });
    },

    /** The Dives of the Connection's offer (its Import's new ones) that still have no remote dive at the Provider. */
    unsentDives,

    /** The Providers where each of these Dives is deleted through the queue (5 minutes after deleting it here), not asked. */
    deletingItself: (diveIds: string[]) => deletingItself(db, diveIds),

    /** The entries of the Waiting pushes of these Dives, by Dive. */
    waitingOf: (diveIds: string[]) => waitingOf(db, diveIds, registry.list().map((a) => a.id)),

    /**
     * Where these Imports' new Dives weren't sent by themselves: per Import, the User's Connections whose offer holds it,
     * with how many of its Dives still have no remote dive there. An Import none offers is missing from the map.
     */
    async offersOf(userId: string, importIds: string[]): Promise<Map<string, { connectionId: string; provider: string; count: number }[]>> {
      const found = new Map<string, { connectionId: string; provider: string; count: number }[]>();
      if (importIds.length === 0) return found;
      const conns = await db.select().from(connection)
        .where(and(eq(connection.userId, userId), arrayOverlaps(connection.unsentImportIds, importIds)))
        .orderBy(asc(connection.createdAt), asc(connection.id));
      const created = await createdByMany([...new Set(conns.flatMap((c) => c.unsentImportIds))]);
      const unsent = await unsentOf(conns, created);
      for (const conn of conns) {
        const left = new Set(unsent.get(conn.id));
        for (const importId of conn.unsentImportIds.filter((id) => importIds.includes(id))) {
          const count = created.get(importId)!.filter((d) => left.has(d.id)).length;
          if (count > 0) found.set(importId, [...(found.get(importId) ?? []), { connectionId: conn.id, provider: conn.provider, count }]);
        }
      }
      return found;
    },

    /** The User dismisses the Connection's offer (every Import in it); `connection_not_found` unless the Connection is theirs. */
    async dismissOffer(userId: string, connectionId: string): Promise<void> {
      const done = await db.update(connection).set({ unsentImportIds: [] })
        .where(and(eq(connection.id, connectionId), eq(connection.userId, userId))).returning({ id: connection.id });
      if (done.length === 0) throw new ProviderServiceError('connection_not_found');
    },

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
     * The minute tick (its fetching part is scheduled-fetch.ts): entries held for a sign-in of a Connection signed in
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
      // Only at the Providers this instance has: an entry of a removed one would only be dropped by its step.
      const due = await db.selectDistinct({ id: waitingPush.connectionId }).from(waitingPush)
        .where(and(eq(waitingPush.state, 'waiting'), lte(waitingPush.dueAt, at), inArray(waitingPush.provider, registry.list().map((a) => a.id))));
      for (const { id } of due) await scheduleConnection(db, id, { keepTime: true });
    },

    /**
     * The User's Retry: a stopped or held entry of the Dive at the Provider waits again, due now. The Dive must be one
     * of the User's Divers' (`dive_not_found`, the same answer as for a Dive that doesn't exist), and the entry sent
     * through the User's own Connection: a User who co-manages the Diver but has another Connection gets
     * `connection_not_found`, as sends go out as the Connection's User. `waiting_push_not_found` when there is no such entry;
     * an entry that waits already stays as it is (Retry is idempotent).
     */
    async retry(userId: string, diveId: string, provider: string): Promise<void> {
      await visibleDive(userId, diveId);
      const [entry] = await db.select({ entry: waitingPush, userId: connection.userId }).from(waitingPush)
        .innerJoin(connection, eq(connection.id, waitingPush.connectionId))
        .where(and(eq(waitingPush.diveId, diveId), eq(waitingPush.provider, provider)));
      if (!entry) throw new ProviderServiceError('waiting_push_not_found');
      if (entry.userId !== userId) throw new ProviderServiceError('connection_not_found');
      // Waiting already (a second click, another tab): nothing to do, and no error.
      if (entry.entry.state === 'waiting') return;
      await db.update(waitingPush).set({ state: 'waiting', reason: null, dueAt: now(), attempts: 0, firstFailedAt: null, stoppedAt: null })
        .where(the(entry.entry));
      await scheduleConnection(db, entry.entry.connectionId);
    },

    /**
     * The User's decision for a Dive at a Provider ("Link to it", "Create a new one", the choice per Conflict): the Dive
     * is queued as a send due now, with these options added to the entry's. It goes through the Connection the entry or
     * the Conflict is on, else the User's own Connection of the Dive's Diver; one that isn't the User's is
     * `connection_not_found`.
     */
    async decide(userId: string, diveId: string, provider: string, options: WaitingPushOptions): Promise<void> {
      const diverId = await visibleDive(userId, diveId);
      const [entry] = await db.select({ id: waitingPush.connectionId }).from(waitingPush)
        .where(and(eq(waitingPush.diveId, diveId), eq(waitingPush.provider, provider)));
      const [open] = entry ? [] : await db.select({ id: providerConflict.connectionId }).from(providerConflict)
        .where(and(eq(providerConflict.diveId, diveId), eq(providerConflict.provider, provider)));
      const known = entry?.id ?? open?.id;
      const [conn] = known
        ? await db.select().from(connection).where(eq(connection.id, known))
        : await db.select().from(connection).where(and(eq(connection.userId, userId), eq(connection.diverId, diverId), eq(connection.provider, provider)));
      if (!conn || conn.userId !== userId) throw new ProviderServiceError('connection_not_found');
      await queueNow(db, diveId, provider, conn.id, options, now());
    },

    /**
     * What each Connection shows besides its settings: how many entries wait, are held and stopped, and the summary of
     * its last fetch, told from the fetch's Import (its time and outcome; the Connection's own time is set when a fetch
     * only claims its slot). `waitingForYou` counts the entries the fetch left to the User: ambiguous ones and dives of a
     * computer with no choice yet (the Conflicts that wait are the caller's, counted apart). `updated` counts Dives changed or filled.
     */
    async overview(conns: { id: string; lastFetchImportId: string | null }[]) {
      const found = new Map<string, {
        waiting: { waiting: number; held: number; stopped: number };
        lastFetch: { at: Date; created: number; updated: number; skipped: number } | null;
        unsentDives: string[];
      }>();
      if (conns.length === 0) return found;
      const counts = await db.select({ id: waitingPush.connectionId, state: waitingPush.state, n: count() }).from(waitingPush)
        .where(inArray(waitingPush.connectionId, conns.map((c) => c.id))).groupBy(waitingPush.connectionId, waitingPush.state);
      const importIds = conns.flatMap((c) => (c.lastFetchImportId ? [c.lastFetchImportId] : []));
      const imports = importIds.length === 0 ? [] : await db.select({
        id: importJob.id, outcome: importJob.outcome, createdAt: importJob.createdAt, finishedAt: importJob.finishedAt,
      }).from(importJob).where(inArray(importJob.id, importIds));
      const unsent = await unsentOf(await db.select().from(connection).where(inArray(connection.id, conns.map((c) => c.id))));
      for (const c of conns) {
        const made = imports.find((i) => i.id === c.lastFetchImportId);
        const outcome = made?.outcome ?? [];
        const of = (result: string) => outcome.filter((o) => o.result === result).length;
        found.set(c.id, {
          waiting: {
            waiting: counts.find((n) => n.id === c.id && n.state === 'waiting')?.n ?? 0,
            held: counts.find((n) => n.id === c.id && n.state === 'held')?.n ?? 0,
            stopped: counts.find((n) => n.id === c.id && n.state === 'stopped')?.n ?? 0,
          },
          lastFetch: !made ? null : {
            at: made.finishedAt ?? made.createdAt, created: of('created'), updated: of('updated') + of('linked'),
            skipped: outcome.filter((o) => o.result === 'skipped' && (o.reason === 'ambiguous' || o.reason === 'no_computer_choice')).length,
          },
          unsentDives: unsent.get(c.id) ?? [],
        });
      }
      return found;
    },
  };
}

export type WaitingPushService = ReturnType<typeof createWaitingPushService>;
