// Push runs (ADR 0047, 0048): one User's request to send many Dives of one Diver to one Provider. The run is a record
// (the run and one item per Dive); the worker's step sends one Dive at a time through the ordinary `pushes.send` or
// `pushes.setNumber`, so nothing is sent a different way than from a Dive's page. Dive Hub's data alone says what a
// run would do (the preview), and it never calls a Provider.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { connection, dive, diveSite, pushRun, pushRunItem, type PushRunLeftOut } from '../db/schema.js';
import { asksFor, diveListFilter } from '../dives/list-filter.js';
import { managedDiverIds } from '../dives/dive-service.js';
import { isUniqueViolation } from '../sites/site-service.js';
import { planItem, orderItems, type PlanOptions, type Planned } from './push-run-plan.js';
import type { PushService } from './push-service.js';
import { named, ProviderServiceError, type ProviderRegistry } from './registry.js';

export const PUSH_RUN_STEP_TASK = 'push_run_step';
/** Runs kept per Connection; an older one is deleted when a new one starts. */
const KEPT_RUNS = 5;
/** A Dive that is busy is tried again later; this many tries in all. */
const BUSY_TRIES = 3;
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
}

/** What stops a run at once: the account needs the User, not another try. */
const STOPS_AT_ONCE = new Set(['provider_sign_in_needed', 'provider_wrong_credentials', 'provider_not_connected']);
/** Failures the second of which stops a run; and the ones `continue` tries again. */
const RETRIED_ON_CONTINUE = ['provider_unavailable', 'provider_refused', 'provider_not_stored', 'provider_dive_gone', 'internal_error'];

type RunRow = typeof pushRun.$inferSelect;
type ItemRow = typeof pushRunItem.$inferSelect;
type Status = Awaited<ReturnType<PushService['status']>>;

export function createPushRunService(deps: { db: Db; registry: ProviderRegistry; pushes: PushService }) {
  const { db, registry, pushes } = deps;

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
  async function scope(userId: string, conn: typeof connection.$inferSelect, request: PushRunRequest) {
    const base = { id: dive.id, startsAt: dive.startsAt, number: dive.number, siteId: dive.siteId, siteName: diveSite.name };
    const order = [asc(dive.startsAt), asc(dive.id)];
    if (request.ids) {
      const ids = [...new Set(request.ids)];
      const rows = await db.select(base).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
        .where(and(inArray(dive.id, ids), eq(dive.diverId, conn.diverId), isNull(dive.deletedAt))).orderBy(...order);
      return { dives: rows, notFound: ids.length - rows.length };
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
  async function analyse(userId: string, conn: typeof connection.$inferSelect, request: PushRunRequest) {
    const { adapter, exports, run, pauseMs } = runner(conn.provider);
    const options: PlanOptions = {
      updates: !!request.updates, updatesRemovingVerification: !!request.updatesRemovingVerification, numbers: !!request.numbers,
      canUpdate: exports.operations.includes('update'),
    };
    const { dives, notFound } = await scope(userId, conn, request);
    const leftOut: PushRunLeftOut = {
      upToDate: 0, requirementsUnmet: 0, updateNotChosen: 0, removesVerification: 0, updateUnsupported: 0, beyondCeiling: 0, notFound,
      numberNotChosen: 0, numberTaken: 0,
    };
    const counts = {
      create: 0, update: 0, updateRemovingVerification: 0, upToDate: 0, requirementsUnmet: 0, updateUnsupported: 0, notFound,
      number: 0, numberRemovingVerification: 0, numberTaken: 0,
    };
    const blocked: { diveId: string; number: number | null; startsAt: Date; siteId: string | null; siteName: string | null; unmet: Status['unmet'] }[] = [];
    const candidates: { diveId: string; startsAt: Date; planned: Exclude<Planned, { leftOut: unknown }>; withLeftOut: boolean }[] = [];
    const numberOnly: { diveId: string; startsAt: Date; planned: { send: 'number'; wanted: number; held: number | null } }[] = [];
    const held = new Map<string, number | null>();

    for (const d of dives) {
      const status = await pushes.status(userId, d.id, conn.provider);
      const current = status.current;
      if (status.unmet.some((u) => u.severity === 'blocking')) {
        counts.requirementsUnmet++;
        blocked.push({ diveId: d.id, number: d.number, startsAt: d.startsAt, siteId: d.siteId, siteName: d.siteName, unmet: status.unmet });
      } else if (!current) counts.create++;
      else if (current.upToDate) counts.upToDate++;
      else if (!options.canUpdate) counts.updateUnsupported++;
      else if (current.updateRemovesVerification) counts.updateRemovingVerification++;
      else counts.update++;
      if (current?.number?.differs && current.number.canSet) {
        counts.number++;
        if (current.number.removesVerification) counts.numberRemovingVerification++;
        // Whether these could be ordered doesn't depend on the run's choices.
        const asNumber = planItem(status, { ...options, updates: false, updatesRemovingVerification: true, numbers: true });
        if ('send' in asNumber && asNumber.send === 'number') numberOnly.push({ diveId: d.id, startsAt: d.startsAt, planned: asNumber });
      }
      const planned = planItem(status, options);
      if ('leftOut' in planned) {
        const key = { up_to_date: 'upToDate', requirements_unmet: 'requirementsUnmet', update_not_chosen: 'updateNotChosen',
          removes_verification: 'removesVerification', update_unsupported: 'updateUnsupported' } as const;
        leftOut[key[planned.leftOut]]++;
        if (planned.numberNotChosen) leftOut.numberNotChosen++;
      } else candidates.push({ diveId: d.id, startsAt: d.startsAt, planned, withLeftOut: status.unmet.length > 0 });
    }

    // Where the numbers of dives already there matter for the order: every current remote dive of the Diver here.
    if (numberOnly.length > 0) {
      const all = await db.select({ id: dive.id }).from(dive).where(eq(dive.diverId, conn.diverId));
      for (const [diveId, byProvider] of await pushes.currentOf(all.map((r) => r.id))) held.set(diveId, byProvider.get(conn.provider)?.remoteNumber ?? null);
      counts.numberTaken = orderItems(numberOnly, held).numberTaken.length;
    }
    const { ordered, numberTaken } = orderItems(candidates, held);
    // Taken numbers only leave out the run's own number items; the count above is for the preview's whole picture.
    leftOut.numberTaken = numberTaken.length;
    const sendList = ordered.slice(0, run.maxDives);
    leftOut.beyondCeiling = ordered.length - sendList.length;
    return { adapter, run, pauseMs, options, counts, leftOut, blocked, sendList, withLeftOut: sendList.filter((i) => i.withLeftOut).length };
  }

  async function activeRunOf(connectionId: string) {
    const [row] = await db.select({ id: pushRun.id }).from(pushRun)
      .where(and(eq(pushRun.connectionId, connectionId), inArray(pushRun.status, ['queued', 'running'])));
    return row?.id ?? null;
  }

  /** Queues the next step of a run (as the worker's step does itself, after the pause). */
  const queueStep = (tx: Pick<Db, 'execute'>, runId: string) =>
    tx.execute(sql`select graphile_worker.add_job(${PUSH_RUN_STEP_TASK}, json_build_object('runId', ${runId}::text), job_key => ${'push-run:' + runId}, max_attempts => 1)`);

  /** A signed-in Connection, or `provider_sign_in_needed` before anything is queued. */
  function needSignedIn(conn: typeof connection.$inferSelect) {
    if (conn.state === 'needs_sign_in') throw new ProviderServiceError('provider_sign_in_needed', named(registry.get(conn.provider)));
  }

  async function view(row: RunRow) {
    const items = await db.select({ state: pushRunItem.state }).from(pushRunItem).where(eq(pushRunItem.runId, row.id));
    return viewOf(row, countsOf(items));
  }
  function viewOf(row: RunRow, counts: ReturnType<typeof countsOf>) {
    let pauseMs = 0;
    try { pauseMs = runner(row.provider).run.pauseMs; } catch { /* the Provider is gone from this instance */ }
    return {
      id: row.id, connectionId: row.connectionId, provider: row.provider, diverId: row.diverId, status: row.status, stopCode: row.stopCode,
      updates: row.updates, updatesRemovingVerification: row.updatesRemovingVerification, numbers: row.numbers,
      cancelRequested: row.cancelRequestedAt !== null, counts, leftOut: row.leftOut, pauseMs,
      createdAt: row.createdAt, startedAt: row.startedAt, finishedAt: row.finishedAt,
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
  async function stop(runId: string, code: string) {
    await db.update(pushRun).set({ status: 'stopped', stopCode: code, finishedAt: new Date() }).where(and(eq(pushRun.id, runId), inArray(pushRun.status, ['queued', 'running'])));
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
            updatesRemovingVerification: a.options.updatesRemovingVerification, numbers: a.options.numbers, leftOut: a.leftOut,
          }).returning();
          await tx.insert(pushRunItem).values(a.sendList.map((i, position) => ({
            runId: row!.id, diveId: i.diveId, position, action: i.planned.send,
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
      return runs.map((r) => viewOf(r, countsOf(items.filter((i) => i.runId === r.id))));
    },

    async get(userId: string, runId: string) {
      const row = await ownRun(userId, runId);
      const items = await db.select({
        diveId: pushRunItem.diveId, position: pushRunItem.position, action: pushRunItem.action, state: pushRunItem.state,
        outcome: pushRunItem.outcome, reason: pushRunItem.reason,
        number: dive.number, startsAt: dive.startsAt, siteName: diveSite.name,
      }).from(pushRunItem).innerJoin(dive, eq(dive.id, pushRunItem.diveId)).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
        .where(eq(pushRunItem.runId, runId)).orderBy(asc(pushRunItem.position));
      return {
        ...viewOf(row, countsOf(items)),
        items: items.map(({ number, startsAt, siteName, ...item }) => ({ ...item, dive: { number, startsAt, siteName } })),
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
          await tx.update(pushRun).set({ status: 'queued', stopCode: null, consecutiveFailures: 0, finishedAt: null }).where(eq(pushRun.id, runId));
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
      const [item] = await db.execute<{ dive_id: string; action: string; attempts: number; position: number }>(sql`
        update push_run_item set state = 'sending', attempts = attempts + 1
        where run_id = ${runId}::uuid and dive_id = (
          select dive_id from push_run_item where run_id = ${runId}::uuid and state = 'waiting' order by position limit 1 for update skip locked)
        returning dive_id, action, attempts, position`).then((r) => r.rows);
      if (!item) {
        await finish(runId, 'done');
        return null;
      }
      const diveId = item.dive_id;
      const { run: limits, pauseMs } = runner(run.provider);
      const settle = (values: Partial<ItemRow>) => db.update(pushRunItem).set({ finishedAt: new Date(), ...values })
        .where(and(eq(pushRunItem.runId, runId), eq(pushRunItem.diveId, diveId)));
      const skip = (reason: string) => settle({ state: 'skipped', reason });
      let failure: string | null = null;
      try {
        const [row] = await db.select({ deletedAt: dive.deletedAt }).from(dive).where(eq(dive.id, diveId));
        if (!row || row.deletedAt) {
          await skip('dive_not_found');
        } else {
          const exports = runner(run.provider).exports;
          const planned = planItem(await pushes.status(run.userId, diveId, run.provider), {
            updates: run.updates, updatesRemovingVerification: run.updatesRemovingVerification, numbers: run.numbers,
            canUpdate: exports.operations.includes('update'),
          });
          if ('leftOut' in planned) await skip(planned.leftOut);
          else if (planned.send === 'number') {
            const { push } = await pushes.setNumber(run.userId, diveId, run.provider);
            await settle({ state: 'sent', outcome: 'numbered', pushId: push.id });
          } else {
            const sent = await pushes.send(run.userId, diveId, run.provider);
            if (sent.result === 'exists') await skip('exists');
            else await settle({ state: 'sent', outcome: sent.result, pushId: sent.push.id });
          }
        }
      } catch (e) {
        const code = e instanceof ProviderServiceError ? e.code : 'internal_error';
        if (code === 'provider_busy' && item.attempts < BUSY_TRIES) {
          // Later: behind the Dives still waiting.
          const [last] = await db.select({ p: sql<number>`max(${pushRunItem.position})`.mapWith(Number) }).from(pushRunItem).where(eq(pushRunItem.runId, runId));
          await db.update(pushRunItem).set({ state: 'waiting', position: (last?.p ?? item.position) + 1 })
            .where(and(eq(pushRunItem.runId, runId), eq(pushRunItem.diveId, diveId)));
        } else if (STOPS_AT_ONCE.has(code)) {
          await db.update(pushRunItem).set({ state: 'waiting', attempts: sql`${pushRunItem.attempts} - 1` })
            .where(and(eq(pushRunItem.runId, runId), eq(pushRunItem.diveId, diveId)));
          await stop(runId, code);
          return null;
        } else if (code === 'provider_requirements_unmet') await skip('requirements_unmet');
        else if (code === 'provider_number_taken') await skip('number_taken');
        else if (code === 'provider_number_nothing_to_set') await skip('up_to_date');
        else {
          await settle({ state: 'failed', reason: code });
          if (code !== 'provider_busy') failure = code;
        }
      }
      // Failures in a row: a sent Dive ends the row, a skipped one doesn't touch it.
      const [now] = await db.select({ state: pushRunItem.state }).from(pushRunItem).where(and(eq(pushRunItem.runId, runId), eq(pushRunItem.diveId, diveId)));
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
      return { afterMs: Math.max(limits.pauseMs, pauseMs) };
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
