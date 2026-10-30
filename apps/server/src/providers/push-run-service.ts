// Push runs (ADR 0047, 0048): one User's request to send many Dives of one Diver to one Provider. The run is a record
// (the run and one item per Dive); the worker's step sends one Dive at a time through the ordinary `pushes.send` or
// `pushes.setNumber`, so nothing is sent a different way than from a Dive's page. Dive Hub's data alone says what a
// run would do (the preview), and it never calls a Provider.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Queryable } from '../db/client.js';
import { connection, dive, diveSite, push, pushRun, pushRunItem, type PushRunLeftOut, type ConnectionRow } from '../db/schema.js';
import { asksFor, diveListFilter } from '../dives/list-filter.js';
import type { ProblemCode } from '../http/problems.js';
import { managedDiverIds } from '../divers/management.js';
import { isUniqueViolation } from '../sites/site-service.js';
import type { ConflictService } from './conflict-service.js';
import { classify, failureOutcome, numberPlanOf, orderItems, planItem, type PlanOptions, type ScopedDive } from './push-run-plan.js';
import type { RemoteDive } from './provider.js';
import type { PushService } from './push-service.js';
import { named, ProviderServiceError, type ProviderRegistry } from './registry.js';
import type { ProviderLog } from './waiting-push-queue.js';

export const PUSH_RUN_STEP_TASK = 'push_run_step';
/** Runs kept per Connection; an older one is deleted when a new one starts. */
const KEPT_RUNS = 5;
/** The second failure in a row stops a run. */
const FAILURES_IN_A_ROW = 2;
export const MAX_IDS = 500;

export interface PushRunRequest {
  /** What to send: the logbook's list (Dives of the Connection's Diver), or Dive ids. Exactly one. */
  list?: { siteId?: string | undefined; q?: string | undefined; only?: string | undefined } | undefined;
  ids?: string[] | undefined;
  updates?: boolean | undefined;
  updatesRemovingVerification?: boolean | undefined;
  numbers?: boolean | undefined;
  /** Confirmed once: number changes that can remove a verification (ADR 0052). */
  numbersRemovingVerification?: boolean | undefined;
  /** With `ids`: also the Dives here whose number at the Provider the named ones want, and so on (ADR 0052). */
  withHolders?: boolean | undefined;
}

/** Failures the second of which stops a run; and the ones `continue` tries again. */
const RETRIED_ON_CONTINUE = ['provider_unavailable', 'provider_refused', 'provider_not_stored', 'provider_dive_gone', 'internal_error'];

type RunRow = typeof pushRun.$inferSelect;
type ItemRow = typeof pushRunItem.$inferSelect;
type Status = Awaited<ReturnType<PushService['status']>>;
/** An item `step` took up, as the claiming update returns it. */
type Claimed = { dive_id: string; action: string; attempts: number; position: number; shares_with_dive_id: string | null };

export function createPushRunService(deps: { db: Db; registry: ProviderRegistry; pushes: PushService; conflicts: ConflictService; log: ProviderLog }) {
  const { db, registry, pushes, conflicts } = deps;
  const { log } = deps;

  const error = (code: ConstructorParameters<typeof ProviderServiceError>[0], extra?: Record<string, unknown>) =>
    new ProviderServiceError(code, undefined, extra);

  async function ownConnection(userId: string, connectionId: string) {
    const [row] = await db.select().from(connection).where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
    if (!row || !(await managedDiverIds(db, userId)).has(row.diverId)) throw error('connection_not_found');
    return row;
  }

  /** The adapter and its run limits; `provider_unsupported` for a Provider that takes no runs. */
  function runner(provider: string) {
    const adapter = registry.get(provider);
    const exports = adapter.dives && adapter.capabilities.data.dives?.export;
    const limits = adapter.capabilities.limits;
    if (!exports || !limits.run) throw new ProviderServiceError('provider_unsupported', named(adapter));
    return { adapter, exports, run: limits.run, pauseMs: Math.max(limits.run.pauseMs, limits.pauseMs) };
  }

  /** The Dives in scope, oldest first. */
  async function scope(userId: string, conn: ConnectionRow, request: PushRunRequest) {
    const base = { id: dive.id, startsAt: dive.startsAt, number: dive.number, siteId: dive.siteId, siteName: diveSite.name };
    const order = [asc(dive.startsAt), asc(dive.id)];
    if (request.ids) {
      const ids = [...new Set(request.ids)];
      const select = (wanted: string[]) => db.select(base).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
        .where(and(inArray(dive.id, wanted), eq(dive.diverId, conn.diverId), isNull(dive.deletedAt))).orderBy(...order);
      const rows = await select(ids);
      if (!request.withHolders || rows.length === 0) return { dives: rows, notFound: ids.length - rows.length };
      // The Dives in their way (ADR 0052): whoever has, at the Provider, the number one of the set wants, again and again.
      const known = new Map<string, { number: number | null; remote: number | null }>();
      const everyDive = await db.select({ id: dive.id, number: dive.number }).from(dive).where(and(eq(dive.diverId, conn.diverId), isNull(dive.deletedAt)));
      const current = await pushes.currentOf(everyDive.map((d) => d.id));
      for (const d of everyDive) known.set(d.id, { number: d.number, remote: current.get(d.id)?.get(conn.provider)?.remoteNumber ?? null });
      const inSet = new Set(rows.map((r) => r.id));
      const queue = [...inSet];
      while (queue.length > 0) {
        const wanted = known.get(queue.shift()!)?.number;
        if (wanted == null) continue;
        for (const [id, d] of known) {
          // A holder with no number of its own here, or already at it, can't move out of the way: it stays out of the set.
          if (d.remote !== wanted || inSet.has(id) || d.number === null || d.number === d.remote) continue;
          inSet.add(id);
          queue.push(id);
        }
      }
      const all = await select([...inSet]);
      return { dives: all, notFound: ids.length - rows.length };
    }
    const changedIds = asksFor(request.list?.only, 'changed-since-sent') ? await pushes.changedSinceSent(userId, [conn.diverId]) : undefined;
    const { where } = diveListFilter({ userId, diverIds: [conn.diverId], ...request.list, changedIds });
    return { dives: await db.select(base).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(where).orderBy(...order), notFound: 0 };
  }

  const countsOf = (items: Pick<ItemRow, 'state'>[]) => ({
    total: items.length,
    waiting: items.filter((i) => i.state === 'waiting' || i.state === 'sending').length,
    sent: items.filter((i) => i.state === 'sent').length,
    skipped: items.filter((i) => i.state === 'skipped').length,
    failed: items.filter((i) => i.state === 'failed').length,
  });

  /** What a run with these options would do, from Dive Hub's data alone. */
  async function analyse(userId: string, conn: ConnectionRow, request: PushRunRequest) {
    const { adapter, exports, run, pauseMs } = runner(conn.provider);
    const options: PlanOptions = {
      updates: !!request.updates, updatesRemovingVerification: !!request.updatesRemovingVerification, numbers: !!request.numbers,
      numbersRemovingVerification: !!request.numbersRemovingVerification, canUpdate: exports.operations.includes('update'),
    };
    const { dives, notFound } = await scope(userId, conn, request);
    const scoped: ScopedDive<Status>[] = [];
    for (const d of dives) scoped.push({ dive: d, status: await pushes.status(userId, d.id, conn.provider) });
    const sorted = classify(scoped, options);

    const { held, fixed, holders } = sorted.numberOnly.length > 0
      ? await numbersHere(userId, conn, options.numbers)
      : { held: new Map<string, number | null>(), fixed: new Set<number>(), holders: new Map<number, RemoteDive>() };
    const whole = sorted.numberOnly.length > 0 ? orderItems(sorted.numberOnly, held, fixed) : null;
    const counts = { ...sorted.counts, notFound, numberTaken: whole?.numberTaken.length ?? 0, numberHeldAtProvider: whole?.numberHeld.length ?? 0 };
    const { ordered, numberTaken, numberHeld, shares } = orderItems(sorted.candidates, held, fixed);
    const sendList = ordered.slice(0, run.maxDives);
    // Taken numbers only leave out the run's own number items; the counts above are for the preview's whole picture.
    const leftOut: PushRunLeftOut = {
      ...sorted.leftOut, notFound, numberTaken: numberTaken.length, numberHeldAtProvider: numberHeld.length, beyondCeiling: ordered.length - sendList.length,
    };
    const diveOf = new Map(dives.map((d) => [d.id, d]));
    const heldAtProvider = numberHeld.map((i) => {
      const wanted = (i.planned as { wanted: number }).wanted;
      return { diveId: i.diveId, number: diveOf.get(i.diveId)?.number ?? null, wanted, holder: holders.get(wanted) ?? null };
    });
    return {
      adapter, run, pauseMs, options, counts, leftOut, blocked: sorted.blocked, sendList, withLeftOut: sendList.filter((i) => i.withLeftOut).length,
      inScope: dives.length + notFound, diveOf, numberPlan: numberPlanOf(sendList, diveOf, shares), heldAtProvider, shares,
    };
  }

  /**
   * Where the numbers of dives already there matter for the order: every current remote dive of the Diver here, and,
   * for a run that sets numbers, the Provider's logbook once, so that holders only there are known before the start.
   */
  async function numbersHere(userId: string, conn: ConnectionRow, readProvider: boolean) {
    const held = new Map<string, number | null>();
    const fixed = new Set<number>();
    const holders = new Map<number, RemoteDive>();
    const all = await db.select({ id: dive.id }).from(dive).where(eq(dive.diverId, conn.diverId));
    const knownRemote = new Set<string>();
    for (const [diveId, byProvider] of await pushes.currentOf(all.map((r) => r.id))) {
      const remote = byProvider.get(conn.provider);
      held.set(diveId, remote?.remoteNumber ?? null);
      if (remote?.remoteId) knownRemote.add(remote.remoteId);
    }
    if (!readProvider) return { held, fixed, holders };
    // A Provider that can't be read now (signed out, down) leaves the preview as before: the send finds a holder as it did.
    const read = await pushes.heldNumbers(userId, conn.diverId, conn.provider).catch((err: unknown) => {
      log.warn({ err, connectionId: conn.id, provider: conn.provider }, 'a Push run preview could not read the numbers held at the Provider');
      return null;
    });
    for (const r of read ?? []) {
      if (r.number === null || knownRemote.has(r.remoteId)) continue;
      fixed.add(r.number);
      holders.set(r.number, r);
    }
    return { held, fixed, holders };
  }

  async function activeRunOf(connectionId: string) {
    const [row] = await db.select({ id: pushRun.id }).from(pushRun)
      .where(and(eq(pushRun.connectionId, connectionId), inArray(pushRun.status, ['queued', 'running'])));
    return row?.id ?? null;
  }

  /** Queues the next step of a run (as the worker's step does itself, after the pause). */
  const queueStep = (tx: Queryable, runId: string) =>
    tx.execute(sql`select graphile_worker.add_job(${PUSH_RUN_STEP_TASK}, json_build_object('runId', ${runId}::text), job_key => ${'push-run:' + runId}, max_attempts => 1)`);

  /** A signed-in Connection, or `provider_sign_in_needed` before anything is queued. */
  function needSignedIn(conn: ConnectionRow) {
    if (conn.state === 'needs_sign_in') throw new ProviderServiceError('provider_sign_in_needed', named(registry.get(conn.provider)));
  }

  /**
   * Conflicts that still wait and carry these runs' ids (as "Needs your decision" lists them): an entry a later send
   * closed is gone, one another run found again carries that run's id.
   */
  const conflictsOf = (runIds: string[]) => conflicts.waitingByRun(runIds);
  async function view(row: RunRow) {
    const items = await db.select({ state: pushRunItem.state }).from(pushRunItem).where(eq(pushRunItem.runId, row.id));
    return viewOf(row, countsOf(items), (await conflictsOf([row.id])).get(row.id) ?? 0);
  }
  function viewOf(row: RunRow, counts: ReturnType<typeof countsOf>, conflicts: number) {
    let pauseMs = 0;
    try { pauseMs = runner(row.provider).run.pauseMs; } catch { /* the Provider is gone from this instance */ }
    return {
      id: row.id, connectionId: row.connectionId, provider: row.provider, diverId: row.diverId, status: row.status, stopCode: row.stopCode,
      updates: row.updates, updatesRemovingVerification: row.updatesRemovingVerification, numbers: row.numbers,
      numbersRemovingVerification: row.numbersRemovingVerification,
      cancelRequested: row.cancelRequestedAt !== null, counts, conflicts, leftOut: row.leftOut, pauseMs,
      createdAt: row.createdAt, startedAt: row.startedAt, finishedAt: row.finishedAt, dismissedAt: row.dismissedAt,
    };
  }

  async function ownRun(userId: string, runId: string) {
    const [row] = await db.select().from(pushRun).where(and(eq(pushRun.id, runId), eq(pushRun.userId, userId)));
    if (!row) throw error('push_run_not_found');
    return row;
  }

  async function finish(runId: string, status: 'done' | 'cancelled') {
    await db.update(pushRun).set({ status, finishedAt: new Date() }).where(and(eq(pushRun.id, runId), inArray(pushRun.status, ['queued', 'running'])));
  }
  async function stop(runId: string, code: ProblemCode) {
    await db.update(pushRun).set({ status: 'stopped', stopCode: code, finishedAt: new Date() }).where(and(eq(pushRun.id, runId), inArray(pushRun.status, ['queued', 'running'])));
  }

  /** The next waiting item of a run, now "sending" with one more try; null when none waits. */
  async function claimNext(runId: string): Promise<Claimed | null> {
    const [item] = await db.execute<Claimed>(sql`
      update push_run_item set state = 'sending', attempts = attempts + 1
      where run_id = ${runId}::uuid and dive_id = (
        select dive_id from push_run_item where run_id = ${runId}::uuid and state = 'waiting' order by position limit 1 for update skip locked)
      returning dive_id, action, attempts, position, shares_with_dive_id`).then((r) => r.rows);
    return item ?? null;
  }

  const itemOf = (runId: string, diveId: string) => and(eq(pushRunItem.runId, runId), eq(pushRunItem.diveId, diveId));

  /** Sends or numbers one claimed Dive and settles its item; throws what the send threw. */
  async function sendOne(run: RunRow, item: Claimed, canUpdate: boolean, settle: (values: Partial<ItemRow>) => Promise<unknown>) {
    const diveId = item.dive_id;
    const skip = (reason: string) => settle({ state: 'skipped', reason });
    const [row] = await db.select({ deletedAt: dive.deletedAt }).from(dive).where(eq(dive.id, diveId));
    if (!row || row.deletedAt) { await skip('dive_not_found'); return; }
    const planned = planItem(await pushes.status(run.userId, diveId, run.provider), {
      updates: run.updates, updatesRemovingVerification: run.updatesRemovingVerification, numbers: run.numbers,
      numbersRemovingVerification: run.numbersRemovingVerification, canUpdate,
    });
    if ('leftOut' in planned) { await skip(planned.leftOut); return; }
    if (planned.send === 'number') {
      const { push } = await pushes.setNumber(run.userId, diveId, run.provider, { sharesWithDiveId: item.shares_with_dive_id ?? undefined });
      await settle({ state: 'sent', outcome: 'numbered', pushId: push.id });
      return;
    }
    // A Conflict doesn't stop a run (ADR 0056): the field is left as the Provider has it, and an entry waits.
    const sent = await pushes.send(run.userId, diveId, run.provider, { onConflict: 'defer', runId: run.id });
    if (sent.result === 'exists') await skip('exists');
    else if (sent.result === 'conflicts') throw new Error('a Push run defers Conflicts');
    else await settle({ state: 'sent', outcome: sent.result, pushId: sent.push.id });
  }

  /**
   * One claimed Dive sent and its item settled, a failure as `failureOutcome` says: `stopped` when the run stopped at
   * once, else the failure that counts towards the ones in a row (null for none). It never throws for a Dive's sake.
   */
  async function sendItem(run: RunRow, item: Claimed, canUpdate: boolean): Promise<{ stopped: true } | { stopped: false; failure: ProblemCode | null }> {
    const diveId = item.dive_id;
    const settle = (values: Partial<ItemRow>) => db.update(pushRunItem).set({ finishedAt: new Date(), ...values }).where(itemOf(run.id, diveId));
    try {
      await sendOne(run, item, canUpdate, settle);
      return { stopped: false, failure: null };
    } catch (e) {
      const code = e instanceof ProviderServiceError ? e.code : 'internal_error';
      // Dive Hub's own fault: the run shows the code; the error is for the operator.
      if (code === 'internal_error') log.error({ err: e, runId: run.id, diveId, provider: run.provider }, 'a Push run step failed with an internal error');
      const outcome = failureOutcome(code, item.attempts);
      switch (outcome.then) {
        case 'later': {
          // Behind the Dives still waiting.
          const [last] = await db.select({ p: sql<number>`max(${pushRunItem.position})`.mapWith(Number) }).from(pushRunItem).where(eq(pushRunItem.runId, run.id));
          await db.update(pushRunItem).set({ state: 'waiting', position: (last?.p ?? item.position) + 1 }).where(itemOf(run.id, diveId));
          return { stopped: false, failure: null };
        }
        case 'stop':
          await db.update(pushRunItem).set({ state: 'waiting', attempts: sql`${pushRunItem.attempts} - 1` }).where(itemOf(run.id, diveId));
          await stop(run.id, code);
          return { stopped: true };
        case 'skip':
          await settle({ state: 'skipped', reason: outcome.reason });
          return { stopped: false, failure: null };
        case 'fail':
          await settle({ state: 'failed', reason: code });
          return { stopped: false, failure: outcome.inARow ? code : null };
      }
    }
  }

  return {
    /** What a start with this request would do. Stores nothing and calls no Provider. */
    async preview(userId: string, connectionId: string, request: PushRunRequest) {
      const conn = await ownConnection(userId, connectionId);
      const a = await analyse(userId, conn, request);
      return {
        provider: conn.provider, diverId: conn.diverId, limits: { pauseMs: a.run.pauseMs, maxDives: a.run.maxDives },
        counts: a.counts, leftOut: a.leftOut, send: a.sendList.length, beyondCeiling: a.leftOut.beyondCeiling, withLeftOut: a.withLeftOut,
        estimatedSeconds: Math.round(a.sendList.length * (a.pauseMs / 1000 + 4)),
        blocked: { total: a.blocked.length, dives: a.blocked.slice(0, 100) },
        inScope: a.inScope,
        // Every number a start would set, in the order they go; the dive each shares a number with for one save, if any.
        numberPlan: a.numberPlan,
        // Number changes held back because a dive only at the Provider has the number (the logbook was read for this).
        heldAtProvider: a.heldAtProvider.slice(0, 100),
        // The Dives a start would queue, in the order they go (at most the Provider's ceiling).
        dives: a.sendList.map((i) => {
          const d = a.diveOf.get(i.diveId)!;
          return { diveId: i.diveId, number: d.number, startsAt: d.startsAt, siteId: d.siteId, siteName: d.siteName, action: i.planned.send };
        }),
      };
    },

    async start(userId: string, connectionId: string, request: PushRunRequest) {
      const conn = await ownConnection(userId, connectionId);
      runner(conn.provider);
      needSignedIn(conn);
      const active = await activeRunOf(conn.id);
      if (active) throw error('push_run_active', { runId: active });
      const a = await analyse(userId, conn, request);
      if (a.sendList.length === 0) throw error('push_run_nothing_to_send');
      let created: RunRow;
      try {
        created = await db.transaction(async (tx) => {
          const [row] = await tx.insert(pushRun).values({
            userId, connectionId: conn.id, provider: conn.provider, diverId: conn.diverId, updates: a.options.updates,
            updatesRemovingVerification: a.options.updatesRemovingVerification, numbers: a.options.numbers,
            numbersRemovingVerification: a.options.numbersRemovingVerification, leftOut: a.leftOut,
          }).returning();
          await tx.insert(pushRunItem).values(a.sendList.map((i, position) => ({
            runId: row!.id, diveId: i.diveId, position, action: i.planned.send, sharesWithDiveId: a.shares.get(i.diveId) ?? null,
          })));
          await queueStep(tx, row!.id);
          return row!;
        });
      } catch (e) {
        if (isUniqueViolation(e, 'push_run_one_active_uq')) throw error('push_run_active', { runId: await activeRunOf(conn.id) });
        throw e;
      }
      // Older finished runs go: the newest five of a Connection stay.
      await db.execute(sql`delete from push_run where connection_id = ${conn.id}::uuid and status not in ('queued', 'running')
        and id not in (select id from push_run where connection_id = ${conn.id}::uuid order by created_at desc, id desc limit ${KEPT_RUNS})`);
      return view(created);
    },

    async list(userId: string) {
      const runs = await db.select().from(pushRun).where(eq(pushRun.userId, userId)).orderBy(desc(pushRun.createdAt), desc(pushRun.id));
      if (runs.length === 0) return [];
      const items = await db.select({ runId: pushRunItem.runId, state: pushRunItem.state }).from(pushRunItem).where(inArray(pushRunItem.runId, runs.map((r) => r.id)));
      const waiting = await conflictsOf(runs.map((r) => r.id));
      return runs.map((r) => viewOf(r, countsOf(items.filter((i) => i.runId === r.id)), waiting.get(r.id) ?? 0));
    },

    async get(userId: string, runId: string) {
      const row = await ownRun(userId, runId);
      const items = await db.select({
        diveId: pushRunItem.diveId, position: pushRunItem.position, action: pushRunItem.action, state: pushRunItem.state,
        outcome: pushRunItem.outcome, reason: pushRunItem.reason, sharesWithDiveId: pushRunItem.sharesWithDiveId, pushId: pushRunItem.pushId,
        number: dive.number, startsAt: dive.startsAt, siteName: diveSite.name,
      }).from(pushRunItem).innerJoin(dive, eq(dive.id, pushRunItem.diveId)).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
        .where(eq(pushRunItem.runId, runId)).orderBy(asc(pushRunItem.position));
      // The sent Dives whose Push left someone out (no SSI account and no entry, or not at the Provider), in the run's order.
      const pushIds = items.flatMap((i) => (i.state === 'sent' && i.pushId ? [i.pushId] : []));
      const pushes = pushIds.length === 0 ? [] : await db.select({ id: push.id, leftOut: push.leftOut }).from(push).where(inArray(push.id, pushIds));
      const leftOutOf = new Map(pushes.map((p) => [p.id, p.leftOut ?? []]));
      const withoutSomeone = items.flatMap((i) => {
        const left = i.pushId ? leftOutOf.get(i.pushId) ?? [] : [];
        return i.state === 'sent' && left.length > 0 ? [{ diveId: i.diveId, startsAt: i.startsAt, names: left.map((l) => l.name) }] : [];
      });
      return {
        ...viewOf(row, countsOf(items), (await conflictsOf([row.id])).get(row.id) ?? 0),
        withoutSomeone,
        items: items.map(({ number, startsAt, siteName, pushId: _pushId, ...item }) => ({ ...item, dive: { number, startsAt, siteName } })),
      };
    },

    /** Asks a run to stop: at once between two Dives, else when the Dive being sent is done. */
    async cancel(userId: string, runId: string) {
      const row = await ownRun(userId, runId);
      if (row.status !== 'queued' && row.status !== 'running') throw error('push_run_not_active');
      await db.update(pushRun).set({ cancelRequestedAt: new Date() }).where(and(eq(pushRun.id, runId), isNull(pushRun.cancelRequestedAt)));
      const [sending] = await db.select({ id: pushRunItem.diveId }).from(pushRunItem).where(and(eq(pushRunItem.runId, runId), eq(pushRunItem.state, 'sending'))).limit(1);
      if (!sending) await finish(runId, 'cancelled');
      return view(await ownRun(userId, runId));
    },

    /** Puts an ended run away from the strip, for every browser and client of the User; again does not move the time. */
    async dismiss(userId: string, runId: string) {
      const row = await ownRun(userId, runId);
      if (row.status === 'queued' || row.status === 'running') throw error('push_run_going');
      if (!row.dismissedAt) await db.update(pushRun).set({ dismissedAt: new Date() }).where(eq(pushRun.id, runId));
      return view(await ownRun(userId, runId));
    },

    /** Takes up a stopped run: the failures worth another try are waiting again, and a step is queued. */
    async continue(userId: string, runId: string) {
      const row = await ownRun(userId, runId);
      if (row.status !== 'stopped') throw error('push_run_not_stopped');
      const [conn] = await db.select().from(connection).where(eq(connection.id, row.connectionId));
      if (!conn) throw error('connection_not_found');
      needSignedIn(conn);
      try {
        await db.transaction(async (tx) => {
          await tx.update(pushRunItem).set({ state: 'waiting', reason: null, attempts: 0, finishedAt: null })
            .where(and(eq(pushRunItem.runId, runId), eq(pushRunItem.state, 'failed'), inArray(pushRunItem.reason, RETRIED_ON_CONTINUE)));
          await tx.update(pushRun).set({ status: 'queued', stopCode: null, consecutiveFailures: 0, finishedAt: null, dismissedAt: null }).where(eq(pushRun.id, runId));
          await queueStep(tx, runId);
        });
      } catch (e) {
        if (isUniqueViolation(e, 'push_run_one_active_uq')) throw error('push_run_active', { runId: await activeRunOf(row.connectionId) });
        throw e;
      }
      return view(await ownRun(userId, runId));
    },

    /**
     * One Dive of a run, as the ADR's table "What stops a run" says. Null when the run ended or isn't active; else how
     * long to wait before the next step. It never throws for a Dive's sake.
     */
    async step(runId: string): Promise<{ afterMs: number } | null> {
      const [run] = await db.select().from(pushRun).where(eq(pushRun.id, runId));
      if (!run || (run.status !== 'queued' && run.status !== 'running')) return null;
      if (run.cancelRequestedAt) { await finish(runId, 'cancelled'); return null; }
      await db.update(pushRun).set({ status: 'running', startedAt: run.startedAt ?? new Date() }).where(eq(pushRun.id, runId));
      const item = await claimNext(runId);
      if (!item) {
        await finish(runId, 'done');
        return null;
      }
      const { exports, pauseMs } = runner(run.provider);
      const sent = await sendItem(run, item, exports.operations.includes('update'));
      if (sent.stopped) return null;
      const { failure } = sent;
      // Failures in a row: a sent Dive ends the row, a skipped one doesn't touch it.
      const [now] = await db.select({ state: pushRunItem.state }).from(pushRunItem).where(itemOf(runId, item.dive_id));
      const failures = failure ? run.consecutiveFailures + 1 : now?.state === 'sent' ? 0 : run.consecutiveFailures;
      await db.update(pushRun).set({ consecutiveFailures: failures }).where(eq(pushRun.id, runId));
      if (failure && failures >= FAILURES_IN_A_ROW) {
        await stop(runId, failure);
        return null;
      }
      const [again] = await db.select({ cancel: pushRun.cancelRequestedAt }).from(pushRun).where(eq(pushRun.id, runId));
      if (again?.cancel) { await finish(runId, 'cancelled'); return null; }
      const [waiting] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(pushRunItem).where(and(eq(pushRunItem.runId, runId), eq(pushRunItem.state, 'waiting')));
      if (!waiting?.n) { await finish(runId, 'done'); return null; }
      return { afterMs: pauseMs };
    },

    /** At worker start: every active run gets its step queued again, and an item a crash left "sending" waits again. */
    async requeueActive() {
      const active = await db.select({ id: pushRun.id }).from(pushRun).where(inArray(pushRun.status, ['queued', 'running']));
      for (const { id } of active) {
        await db.update(pushRunItem).set({ state: 'waiting' }).where(and(eq(pushRunItem.runId, id), eq(pushRunItem.state, 'sending')));
        await queueStep(db, id);
      }
      return active.length;
    },
  };
}

export type PushRunService = ReturnType<typeof createPushRunService>;
