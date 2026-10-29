// The queue of Waiting pushes (ADR 0056): a Dive that is to go to a Provider by itself, one entry per Dive and Provider
// (several Users managing one Diver have Connections to the same account, and two entries would send twice), and the
// Graphile Worker job of the Connection that runs at the earliest due time. Written where a Dive changes (a Revision,
// a site's name or position) and by the User's decisions; the worker step that sends is elsewhere.
// It imports only the database layer: `dives/revisions.ts` calls it, so a `dives/` import here would be a cycle.
import { and, asc, desc, eq, inArray, min, ne, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { currentRemote, type PushRow } from './current-remote.js';
import { connection, dive, importJob, push, waitingPush, type WaitingPushOptions, type ConnectionRow } from '../db/schema.js';

/** Where Dive Hub's own faults go for the operator (the app's logger in production; Users see only the code). */
export interface ProviderLog {
  error(detail: object, message: string): void;
  warn(detail: object, message: string): void;
}

/** Without a logger (a script or a test that doesn't look), the fault still goes somewhere an operator sees it. */
export const consoleLog: ProviderLog = { error: (detail, message) => console.error(message, detail), warn: (detail, message) => console.warn(message, detail) };

type Q = Db | Tx;

/** The Graphile Worker task that sends a Connection's due entries. */
export const WAITING_PUSHES_TASK = 'waiting_pushes';
/** The job key and queue name of a Connection's job: one job per Connection, and one step at a time. */
export const waitingPushesKey = (connectionId: string) => `waiting-pushes:${connectionId}`;
/** A Dive goes out once it has been quiet for this long; a delete waits longer, so an Undo cancels it. */
export const QUIET_MS = 30_000;
export const DELETE_QUIET_MS = 300_000;

/**
 * The causes of a Revision that an import makes (revisions.ts): the Dive is new here or was filled from what an import
 * brought. Task 5 queues an import's new Dives; the queue is not told by their Revisions.
 */
const IMPORT_CAUSES = new Set(['import-create', 'auto-attach', 'reimport', 'fill', 'update', 'auto-site']);

/** Whether the Connection can't sign in by itself: its entries are held until the User signs in. */
const needsSignIn = (conn: ConnectionRow) => conn.state === 'needs_sign_in' && !conn.keepSignedIn;

/**
 * Schedules the Connection's job at the earliest due time of its waiting entries (replacing the job's time); nothing
 * when none waits. Held and stopped entries are not due by themselves. `keepTime`: a job already queued keeps its time
 * (the minute tick's safety net, which must not cut a pause short); only a missing one is added.
 */
export async function scheduleConnection(q: Q, connectionId: string, options: { keepTime?: boolean } = {}): Promise<void> {
  const [next] = await q.select({ due: min(waitingPush.dueAt) }).from(waitingPush)
    .where(and(eq(waitingPush.connectionId, connectionId), eq(waitingPush.state, 'waiting')));
  if (!next?.due) return;
  const mode = options.keepTime ? 'preserve_run_at' : 'replace';
  // The queue name keeps a Connection's steps one at a time: a job added while one runs waits until that one is done.
  await q.execute(sql`select graphile_worker.add_job(${WAITING_PUSHES_TASK}, json_build_object('connectionId', ${connectionId}::text),
    queue_name => ${waitingPushesKey(connectionId)}, job_key => ${waitingPushesKey(connectionId)}, job_key_mode => ${mode},
    run_at => ${next.due.toISOString()}::timestamptz, max_attempts => 1)`);
}

/** Puts the Dive in the queue as a send, due `QUIET_MS` after `at`; a waiting delete stays (a send never replaces it). */
export async function upsertSend(q: Q, conn: ConnectionRow, diveId: string, at: Date): Promise<void> {
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
  q: Q, conn: ConnectionRow, diveId: string, at: Date, detail: { remoteId: string; remoteNumber: number | null; startsAt: string },
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
  if (cause === 'restore') await tx.delete(waitingPush).where(and(eq(waitingPush.diveId, diveId), eq(waitingPush.action, 'delete')));
  // One query: the Dive with the Diver's Connections that have a sending setting on; none, and nothing more is read.
  const found = await tx.select({ dive: { id: dive.id, diverId: dive.diverId, deletedAt: dive.deletedAt, startsAt: dive.startsAt }, conn: connection })
    .from(dive).innerJoin(connection, and(eq(connection.diverId, dive.diverId), sendingOn)).where(eq(dive.id, diveId))
    .orderBy(asc(connection.createdAt), asc(connection.id));
  if (found.length === 0) return;
  await decide(tx, [found[0]!.dive], found.map((f) => f.conn), cause, at, await importedFrom(tx, cause, actor));
}

/** The Connections with a setting that sends something by itself on; the others never queue. */
const sendingOn = or(eq(connection.sendChanges, true), eq(connection.sendNewDives, true), eq(connection.deleteAtProvider, true));

type NotedDive = { id: string; diverId: string; deletedAt: Date | null; startsAt: Date };

/** Several Dives changed alike: the Connections with a sending setting on and the Dives' pushes are read once each. */
async function noteDives(tx: Tx, dives: NotedDive[], cause: string, at: Date, from: string | null): Promise<void> {
  if (dives.length === 0) return;
  const conns = await tx.select().from(connection)
    .where(and(inArray(connection.diverId, [...new Set(dives.map((d) => d.diverId))]), sendingOn)).orderBy(asc(connection.createdAt), asc(connection.id));
  if (conns.length > 0) await decide(tx, dives, conns, cause, at, from);
}

/** `conns` are the Divers' Connections with a sending setting on, oldest first. */
async function decide(tx: Tx, dives: NotedDive[], conns: ConnectionRow[], cause: string, at: Date, from: string | null): Promise<void> {
  const pushes = await tx.select().from(push)
    .where(and(inArray(push.diveId, dives.map((d) => d.id)), inArray(push.provider, [...new Set(conns.map((c) => c.provider))])))
    .orderBy(desc(push.createdAt), desc(push.id));
  for (const row of dives) {
    const own = conns.filter((c) => c.diverId === row.diverId);
    const note: Note = { tx, diveId: row.id, cause, at, row, conns: own, from };
    for (const provider of new Set(own.map((c) => c.provider))) {
      const current = currentRemote(pushes.filter((p) => p.diveId === row.id && p.provider === provider));
      await (current ? noteSent(note, provider, current) : noteNew(note, provider));
    }
  }
}

interface Note {
  tx: Tx; diveId: string; cause: string; at: Date; conns: ConnectionRow[]; from: string | null;
  row: { deletedAt: Date | null; startsAt: Date };
}

/** A Dive with a remote dive at the Provider: only the Connection it was sent through decides (none: nothing goes by itself). */
async function noteSent(n: Note, provider: string, current: PushRow): Promise<void> {
  const conn = n.conns.find((c) => c.id === current.connectionId && c.provider === provider);
  if (!conn) return;
  // A restore cancelled the delete (above); a change waiting before it, which the delete replaced, waits again.
  if (n.cause === 'restore') {
    if (conn.sendChanges) await upsertSend(n.tx, conn, n.diveId, n.at);
  } else if (n.cause === 'delete') {
    if (!conn.deleteAtProvider) return;
    await upsertDelete(n.tx, conn, n.diveId, n.at, { remoteId: current.remoteId!, remoteNumber: current.remoteNumber, startsAt: n.row.startsAt.toISOString() });
  } else if (conn.sendChanges && !n.row.deletedAt && provider !== n.from) {
    await upsertSend(n.tx, conn, n.diveId, n.at);
  }
}

/** The Connection that sends the Diver's new Dives to the Provider: the oldest with "send new dives" (`conns` oldest first). */
export const newDivesConnection = (conns: ConnectionRow[], provider: string): ConnectionRow | undefined =>
  conns.find((c) => c.provider === provider && c.sendNewDives);

/** A Dive without one: the Diver's oldest Connection with "send new dives" queues it, unless an import made it. */
async function noteNew(n: Note, provider: string): Promise<void> {
  if (n.cause === 'delete' || n.row.deletedAt || IMPORT_CAUSES.has(n.cause)) return;
  const conn = newDivesConnection(n.conns, provider);
  if (conn) await upsertSend(n.tx, conn, n.diveId, n.at);
}

/**
 * The Providers where each of these Dives would be deleted through the queue rather than asked: the Dive's current
 * remote dive there was made through a Connection, still the Dive's Diver's, with "delete at the Provider" on (the one
 * `noteDiveChange` decides by).
 */
export async function deletingItself(q: Q, diveIds: string[]): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  if (diveIds.length === 0) return found;
  const pushes = await q.select().from(push).where(inArray(push.diveId, diveIds)).orderBy(desc(push.createdAt), desc(push.id));
  const used = [...new Set(pushes.flatMap((p) => (p.connectionId ? [p.connectionId] : [])))];
  if (used.length === 0) return found;
  const conns = await q.select({ id: connection.id, diverId: connection.diverId, deleteAtProvider: connection.deleteAtProvider }).from(connection)
    .where(inArray(connection.id, used));
  const divers = await q.select({ id: dive.id, diverId: dive.diverId }).from(dive).where(inArray(dive.id, diveIds));
  for (const id of diveIds) {
    const diverId = divers.find((d) => d.id === id)?.diverId;
    for (const provider of new Set(pushes.filter((p) => p.diveId === id).map((p) => p.provider))) {
      const current = currentRemote(pushes.filter((p) => p.diveId === id && p.provider === provider));
      // Only a Connection still the Diver's decides, as in `noteSent`: another one queues no delete.
      const conn = conns.find((c) => c.id === current?.connectionId && c.diverId === diverId);
      if (!current || !conn?.deleteAtProvider) continue;
      found.set(id, (found.get(id) ?? new Set()).add(provider));
    }
  }
  return found;
}

/** A change to a site's name or position reaches the sent Dives there, as an edit of each. */
export async function noteSiteChange(tx: Tx, siteId: string, at: Date): Promise<void> {
  const dives = await tx.select({ id: dive.id, diverId: dive.diverId, deletedAt: dive.deletedAt, startsAt: dive.startsAt }).from(dive)
    .where(and(eq(dive.siteId, siteId), sql`${dive.deletedAt} is null`));
  await noteDives(tx, dives, 'edit', at, null);
}

/**
 * Queues the Dive as a send due at `at`, the caller's now (the User's decision, Retry, a Push run's offer), merging `options` into the
 * entry's. A waiting delete stays. Schedules the Connection's job.
 */
export async function queueNow(q: Q, diveId: string, provider: string, connectionId: string, options: WaitingPushOptions, at: Date): Promise<void> {
  // Merged in the upsert itself, not read first: two decisions at once both end in the entry.
  const fresh = {
    connectionId, state: 'waiting' as const, reason: null, dueAt: at, attempts: 0, firstFailedAt: null, stoppedAt: null, changedAt: at,
  };
  const given = JSON.stringify(options);
  const merged = sql`case when ${waitingPush.options} ? 'conflicts' or ${given}::jsonb ? 'conflicts'
    then (${waitingPush.options} || ${given}::jsonb) || jsonb_build_object('conflicts', coalesce(${waitingPush.options} -> 'conflicts', '{}'::jsonb) || coalesce(${given}::jsonb -> 'conflicts', '{}'::jsonb))
    else ${waitingPush.options} || ${given}::jsonb end`;
  await q.insert(waitingPush).values({ diveId, provider, action: 'send', options, ...fresh })
    .onConflictDoUpdate({ target: [waitingPush.diveId, waitingPush.provider], set: { ...fresh, options: merged }, setWhere: ne(waitingPush.action, 'delete') });
  await scheduleConnection(q, connectionId);
}

/**
 * The Dive's entry at the Provider as it is before a send or delete begins: its last change (exact, as the database
 * keeps it), or null without one. `settle` tells by it whether the Dive changed while the action ran.
 */
export type QueueMark = string | null;

export async function mark(q: Q, diveId: string, provider: string, action?: 'send' | 'delete'): Promise<QueueMark> {
  const [entry] = await q.select({ at: sql<string>`${waitingPush.changedAt}::text` }).from(waitingPush)
    .where(and(eq(waitingPush.diveId, diveId), eq(waitingPush.provider, provider), ...(action ? [eq(waitingPush.action, action)] : [])));
  return entry?.at ?? null;
}

/**
 * A send or delete of the Dive was confirmed; `seen` is the entry's mark from before it began. The entry is done,
 * unless the Dive changed since (its mark differs, or an entry came that wasn't there): then it stays `waiting`, due
 * `QUIET_MS` after that change, so the change goes out once more (without the entry's options: the confirmed send
 * applied the decisions). Told by the entry's own last change, not by a clock:
 * an edit whose transaction began before the send and committed during it carries an older time, but a new mark.
 * `action` limits it to the entries of that action (a confirmed send leaves a waiting delete alone).
 */
export async function settle(q: Q, diveId: string, provider: string, seen: QueueMark, action?: 'send' | 'delete'): Promise<void> {
  const mine = and(eq(waitingPush.diveId, diveId), eq(waitingPush.provider, provider), ...(action ? [eq(waitingPush.action, action)] : []));
  if (seen !== null) {
    const done = await q.delete(waitingPush).where(and(mine, sql`${waitingPush.changedAt} = ${seen}::timestamptz`)).returning({ diveId: waitingPush.diveId });
    if (done.length > 0) return;
  }
  const [entry] = await q.select().from(waitingPush).where(mine);
  if (!entry || entry.action === 'delete') return;
  await q.update(waitingPush).set({
    state: 'waiting', reason: null, options: {}, attempts: 0, firstFailedAt: null, stoppedAt: null, dueAt: new Date(entry.changedAt.getTime() + QUIET_MS),
  }).where(mine);
  await scheduleConnection(q, entry.connectionId);
}
