// The queue of Waiting pushes (ADR 0056): a Dive that is to go to a Provider by itself, one entry per Dive and Provider
// (several Users managing one Diver have Connections to the same account, and two entries would send twice), and the
// Graphile Worker job of the Connection that runs at the earliest due time. Written where a Dive changes (a Revision,
// a site's name or position) and by the User's decisions; the worker step that sends is elsewhere.
// It imports only the database layer: `dives/revisions.ts` calls it, so a `dives/` import here would be a cycle.
import { and, asc, desc, eq, inArray, min, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { connection, dive, importJob, push, waitingPush, type WaitingPushOptions } from '../db/schema.js';

type Q = Db | Tx;
type Connection = typeof connection.$inferSelect;
type PushRow = typeof push.$inferSelect;

/** The Graphile Worker task that sends a Connection's due entries. */
export const WAITING_PUSHES_TASK = 'waiting_pushes';
/** A Dive goes out once it has been quiet for this long; a delete waits longer, so an Undo cancels it. */
export const QUIET_MS = 30_000;
export const DELETE_QUIET_MS = 300_000;

/**
 * The causes of a Revision that an import makes (revisions.ts): the Dive is new here or was filled from what an import
 * brought. Task 5 queues an import's new Dives; the queue is not told by their Revisions.
 */
const IMPORT_CAUSES = new Set(['import-create', 'auto-attach', 'reimport', 'fill', 'update', 'auto-site']);

/**
 * The remote dive a Dive has at one Provider now, from its Pushes there (newest first): the last confirmed one with an
 * ID, unless a later delete or a "found gone" came after it. The same rule as `currentRemote` in remote-state.ts, which
 * can't be imported here (it reaches `dives/` through a type import, and a cycle counts).
 */
function currentOf(pushes: PushRow[]): PushRow | null {
  for (const p of pushes) {
    if (p.remoteGone) return null;
    if (p.state !== 'confirmed') continue;
    if (p.action === 'delete') return null;
    if (p.remoteId) return p;
  }
  return null;
}

/** Whether the Connection can't sign in by itself: its entries are held until the User signs in. */
const needsSignIn = (conn: Connection) => conn.state === 'needs_sign_in' && !conn.keepSignedIn;

/**
 * Schedules the Connection's job at the earliest due time of its waiting entries (replacing the job's time); nothing
 * when none waits. Held and stopped entries are not due by themselves.
 */
export async function scheduleConnection(q: Q, connectionId: string): Promise<void> {
  const [next] = await q.select({ due: min(waitingPush.dueAt) }).from(waitingPush)
    .where(and(eq(waitingPush.connectionId, connectionId), eq(waitingPush.state, 'waiting')));
  if (!next?.due) return;
  await q.execute(sql`select graphile_worker.add_job(${WAITING_PUSHES_TASK}, json_build_object('connectionId', ${connectionId}::text),
    job_key => ${'waiting-pushes:' + connectionId}, job_key_mode => 'replace', run_at => ${next.due.toISOString()}::timestamptz, max_attempts => 1)`);
}

/** Puts the Dive in the queue as a send, due `QUIET_MS` after `at`; a waiting delete stays (a send never replaces it). */
async function upsertSend(q: Q, conn: Connection, diveId: string, at: Date): Promise<void> {
  const held = needsSignIn(conn);
  const fresh = {
    connectionId: conn.id, state: held ? ('held' as const) : ('waiting' as const), reason: held ? 'sign_in' : null, dueAt: new Date(at.getTime() + QUIET_MS),
    attempts: 0, firstFailedAt: null, stoppedAt: null, changedAt: at,
  };
  await q.insert(waitingPush).values({ diveId, provider: conn.provider, action: 'send', ...fresh })
    .onConflictDoUpdate({ target: [waitingPush.diveId, waitingPush.provider], set: fresh, setWhere: ne(waitingPush.action, 'delete') });
  await scheduleConnection(q, conn.id);
}

/** Puts the Dive in the queue as a delete at the Provider, due `DELETE_QUIET_MS` after `at`; it replaces a send. */
async function upsertDelete(
  q: Q, conn: Connection, diveId: string, at: Date, detail: { remoteId: string; remoteNumber: number | null; startsAt: string },
): Promise<void> {
  const held = needsSignIn(conn);
  const fresh = {
    connectionId: conn.id, action: 'delete' as const, state: held ? ('held' as const) : ('waiting' as const), reason: held ? 'sign_in' : null,
    options: {}, detail, dueAt: new Date(at.getTime() + DELETE_QUIET_MS), attempts: 0, firstFailedAt: null, stoppedAt: null, changedAt: at,
  };
  await q.insert(waitingPush).values({ diveId, provider: conn.provider, ...fresh })
    .onConflictDoUpdate({ target: [waitingPush.diveId, waitingPush.provider], set: fresh });
  await scheduleConnection(q, conn.id);
}

/** The Provider an import came from, when the Revision's actor is an import that fills or updates the Dive from one. */
async function importedFrom(q: Q, cause: string, actor?: { type: string; id: string }): Promise<string | null> {
  if (actor?.type !== 'import' || (cause !== 'fill' && cause !== 'update')) return null;
  const [found] = await q.select({ provider: importJob.provider }).from(importJob).where(eq(importJob.id, actor.id));
  return found?.provider ?? null;
}

/**
 * A Dive changed (`cause` is the Revision's, a plain string because `RevisionCause` lives in `dives/revisions.ts`).
 * For each Provider where the Dive has a remote dive, the Dive's Connection (the one its Push was made through, still
 * the Diver's) decides: send on change queues it, delete at the Provider queues a delete, a restore cancels one. Where
 * the Dive has none, the Diver's oldest Connection with "send new dives" queues it, unless an import made the change.
 * What an import from a Provider filled or updated is not sent back to that Provider. Turning a setting on queues
 * nothing that changed before.
 */
export async function noteDiveChange(tx: Tx, diveId: string, cause: string, at: Date, actor?: { type: string; id: string }): Promise<void> {
  const [row] = await tx.select({ diverId: dive.diverId, deletedAt: dive.deletedAt, startsAt: dive.startsAt }).from(dive).where(eq(dive.id, diveId));
  if (!row) return;
  if (cause === 'restore') await tx.delete(waitingPush).where(and(eq(waitingPush.diveId, diveId), eq(waitingPush.action, 'delete')));
  const conns = await tx.select().from(connection).where(eq(connection.diverId, row.diverId)).orderBy(asc(connection.createdAt), asc(connection.id));
  if (conns.length === 0) return;
  const providers = [...new Set(conns.map((c) => c.provider))];
  const pushes = await tx.select().from(push).where(and(eq(push.diveId, diveId), inArray(push.provider, providers)))
    .orderBy(desc(push.createdAt), desc(push.id));
  const note: Note = { tx, diveId, cause, at, row, conns, from: await importedFrom(tx, cause, actor) };
  for (const provider of providers) {
    const current = currentOf(pushes.filter((p) => p.provider === provider));
    await (current ? noteSent(note, provider, current) : noteNew(note, provider));
  }
}

interface Note {
  tx: Tx; diveId: string; cause: string; at: Date; conns: Connection[]; from: string | null;
  row: { deletedAt: Date | null; startsAt: Date };
}

/** A Dive with a remote dive at the Provider: only the Connection it was sent through decides (none: nothing goes by itself). */
async function noteSent(n: Note, provider: string, current: PushRow): Promise<void> {
  const conn = n.conns.find((c) => c.id === current.connectionId && c.provider === provider);
  if (!conn || n.cause === 'restore') return;
  if (n.cause === 'delete') {
    if (!conn.deleteAtProvider) return;
    await upsertDelete(n.tx, conn, n.diveId, n.at, { remoteId: current.remoteId!, remoteNumber: current.remoteNumber, startsAt: n.row.startsAt.toISOString() });
  } else if (conn.sendChanges && !n.row.deletedAt && provider !== n.from) {
    await upsertSend(n.tx, conn, n.diveId, n.at);
  }
}

/** A Dive without one: the Diver's oldest Connection with "send new dives" queues it, unless an import made it. */
async function noteNew(n: Note, provider: string): Promise<void> {
  if (n.cause === 'delete' || n.row.deletedAt || IMPORT_CAUSES.has(n.cause)) return;
  const conn = n.conns.find((c) => c.provider === provider && c.sendNewDives);
  if (conn) await upsertSend(n.tx, conn, n.diveId, n.at);
}

/** A change to a site's name or position reaches the sent Dives there, as an edit of each. */
export async function noteSiteChange(tx: Tx, siteId: string, at: Date): Promise<void> {
  const dives = await tx.select({ id: dive.id }).from(dive).where(and(eq(dive.siteId, siteId), sql`${dive.deletedAt} is null`));
  for (const d of dives) await noteDiveChange(tx, d.id, 'edit', at);
}

/**
 * Queues the Dive as a send due now (the User's decision, Retry, a Push run's offer), merging `options` into the
 * entry's. A waiting delete stays. Schedules the Connection's job.
 */
export async function queueNow(q: Q, diveId: string, provider: string, connectionId: string, options: WaitingPushOptions): Promise<void> {
  const now = new Date();
  const [existing] = await q.select({ options: waitingPush.options }).from(waitingPush)
    .where(and(eq(waitingPush.diveId, diveId), eq(waitingPush.provider, provider)));
  const merged: WaitingPushOptions = {
    ...existing?.options, ...options,
    ...((existing?.options.conflicts || options.conflicts) && { conflicts: { ...existing?.options.conflicts, ...options.conflicts } }),
  };
  const fresh = {
    connectionId, state: 'waiting' as const, reason: null, options: merged, dueAt: now, attempts: 0, firstFailedAt: null, stoppedAt: null, changedAt: now,
  };
  await q.insert(waitingPush).values({ diveId, provider, action: 'send', ...fresh })
    .onConflictDoUpdate({ target: [waitingPush.diveId, waitingPush.provider], set: fresh, setWhere: ne(waitingPush.action, 'delete') });
  await scheduleConnection(q, connectionId);
}

/**
 * A send or delete of the Dive was confirmed, and began at `startedAt`: its entry is done, unless the Dive changed
 * after the send began. Then it stays `waiting`, due `QUIET_MS` after that change, so the change goes out once more.
 * `action` limits it to the entries of that action (a confirmed send leaves a waiting delete alone).
 */
export async function settle(q: Q, diveId: string, provider: string, startedAt: Date, action?: 'send' | 'delete'): Promise<void> {
  const mine = and(eq(waitingPush.diveId, diveId), eq(waitingPush.provider, provider), ...(action ? [eq(waitingPush.action, action)] : []));
  const [entry] = await q.select().from(waitingPush).where(mine);
  if (!entry) return;
  if (entry.changedAt.getTime() <= startedAt.getTime()) {
    await q.delete(waitingPush).where(mine);
    return;
  }
  if (entry.action === 'delete') return;
  await q.update(waitingPush).set({
    state: 'waiting', reason: null, attempts: 0, firstFailedAt: null, stoppedAt: null, dueAt: new Date(entry.changedAt.getTime() + QUIET_MS),
  }).where(mine);
  await scheduleConnection(q, entry.connectionId);
}
