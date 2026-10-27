// Pushes to Providers (ADR 0024, 0027): what every Provider needs when a Dive goes out. It records each action, knows
// the remote record a Dive has now, works out "outdated" from the adapter's fingerprint, runs one action per Dive and
// Provider at a time (a lease, leases.ts), deletes at several Providers only once each would, and turns adapter errors
// into problem codes. An update is three-way (ADR 0056): against the base, what changed only at the Provider is taken
// first, a removal goes out, and a field changed on both sides is a Conflict. What a Provider does with the Dive is the
// adapter's.
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { connection, dive, push } from '../db/schema.js';
import type { SiteSource } from '../sites/sources.js';
import type { BlobStore } from '../storage/blob-store.js';
import { close, entryOf, openFields, record as recordConflict, type ConflictField } from './conflicts.js';
import type { ConnectionRow, ConnectionService } from './connection-service.js';
import { createDiveChanges, type ProviderRun } from './dive-changes.js';
import { LeaseBusy, type Leases } from './leases.js';
import { loadOutgoingDive } from './outgoing-dive.js';
import {
  DIVE_FIELDS, ProviderError, referenceOf, type ActionContext, type Delivered, type DiveExport, type DiveExportAction, type DiveField, type ImportContext,
  type ImportedDive, type Leave, type OutgoingDive, type ProviderAdapter, type RemoteDive, type RemoteSite,
} from './provider.js';
import { withRemembered } from './list-entries.js';
import { asProblem, named, ProviderServiceError, type ProviderRegistry } from './registry.js';
import { currentRemote, type PushRow } from './remote-state.js';
import { blocking, forProvider, leftOutBy, offersListEntries, unmetRequirements } from './requirements.js';
import { siteForSend } from './site-for-send.js';
import { buddiesForSend, keepBuddies, type BuddiesForSend } from './buddies-for-send.js';
import { mark as markWaitingPush, settle as settleWaitingPush, type QueueMark } from './waiting-push-queue.js';
import { comparableOf, planSend, same, type Choice, type Comparable, type SendPlan, type SyncedField } from './three-way.js';

/** What deleting a Dive at Providers did: each copy deleted or kept, and why it stopped, if it did. */
export interface Removal {
  copies: { provider: string; copy: 'deleted' | 'kept' }[];
  /** The refusal that stopped it; the copies after it were kept. Null when every copy asked for is gone. */
  failure: ProviderServiceError | null;
}

/** How a send goes about what the Provider has (ADR 0056). */
export interface SendOptions {
  /** Before creating, a dive at the same time there: link to it, or create a second one. */
  onExisting?: 'link' | 'create';
  /** The User's choice per Conflict: Dive Hub's value (`hub`, sent) or the Provider's (taken). */
  conflicts?: Partial<Record<SyncedField, Choice>>;
  /**
   * A Conflict without a choice: `ask` (the Dive's page, the default) sends nothing and answers them; `defer` (a Push
   * run) leaves the field as the Provider has it, and an entry waits in "Needs your decision".
   */
  onConflict?: 'ask' | 'defer';
  /** The Push run that sends, kept on the entry. */
  runId?: string;
}

export type SendResult = (
  | { result: 'created' | 'linked'; push: PushRow }
  /** `taken`: the fields that came from the Provider first; `deferred`: those left as the Provider has them. */
  | { result: 'updated'; push: PushRow; taken: SyncedField[]; deferred: SyncedField[] }
  | { result: 'exists'; existing: RemoteDive }
  /** Nothing was sent: these fields changed on both sides. */
  | { result: 'conflicts'; conflicts: ConflictField[] }
) & {
  /** What the send did to the Provider's list of people; left out when it added nothing and nothing is known by another name. */
  buddies?: BuddiesForSend;
};

/** The answer of a send, with what the send settled in its list of people (left out when nothing). */
function withSettled(r: SendResult, settled: BuddiesForSend): SendResult {
  return (settled.added.length > 0 || settled.knownAs.length > 0) ? { ...r, buddies: settled } : r;
}

/** Whether the Provider's `dives.fields` let this field go out: no map means every field does. */
function exportsField(adapter: ProviderAdapter, field: DiveField): boolean {
  const directions = adapter.capabilities.data.dives?.fields;
  return !directions || !!directions[field]?.includes('export');
}

type Here = NonNullable<Awaited<ReturnType<ReturnType<typeof createDiveChanges>['hubOf']>>>;

/** The Provider's record compared with the Dive here and the base: what an update takes, clears, keeps or asks. */
interface Exchange {
  run: ProviderRun;
  remote: ImportedDive;
  here: Here;
  provider: Comparable;
  plan: SendPlan;
  /** Left as the Provider has them: deferred Conflicts, and fields that differ but don't go out to this Provider. */
  deferred: SyncedField[];
}

const SUGGESTIONS = 20;
/** Left to `withAccess`, which signs in again and retries the action; not a failed Push. */
const signedOut = (error: unknown) => error instanceof ProviderError && error.reason === 'signed_out';
/** What we send to find the dive again when an answer is lost. */
const reference = referenceOf;

function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * What numbering at a Provider means for a Dive (ADR 0048): null unless the Connection follows Dive Hub's numbers, the
 * Provider declares `numbers` and the Dive has a number; else the number and what the Provider does with it.
 */
export function numbersFor(conn: { followNumbers: boolean } | null, exports: DiveExport, number: number | null) {
  const declared = exports.numbers;
  if (!conn?.followNumbers || !declared || number === null) return null;
  return {
    wanted: number, onCreate: declared.set.includes('create'), onUpdate: declared.set.includes('update'),
    removesVerification: declared.changeRemovesVerification,
  };
}
type NumbersFor = NonNullable<ReturnType<typeof numbersFor>>;

export function createPushService(deps: { db: Db; blobs: BlobStore; registry: ProviderRegistry; connections: ConnectionService; leases: Leases }) {
  const { db, registry, connections, leases } = deps;
  const changes = createDiveChanges({ db, blobs: deps.blobs });

  /** The Provider's dive export, or `provider_unsupported`. */
  function exporter(provider: string) {
    const adapter = registry.get(provider);
    const exports = adapter.dives && adapter.capabilities.data.dives?.export;
    if (!adapter.dives || !exports) throw new ProviderServiceError('provider_unsupported', named(adapter));
    return { adapter, dives: adapter.dives, exports };
  }

  async function pushesOf(diveId: string, provider: string) {
    return db.select().from(push).where(and(eq(push.diveId, diveId), eq(push.provider, provider))).orderBy(desc(push.createdAt), desc(push.id));
  }

  async function record(adapter: ProviderAdapter, values: Omit<typeof push.$inferInsert, 'provider' | 'mode'>) {
    const [row] = await db.insert(push).values({ provider: adapter.id, mode: adapter.dives!.mode, ...values }).returning();
    return row!;
  }

  async function connectionOrThrow(userId: string, diverId: string, adapter: ProviderAdapter) {
    const conn = await connections.forDiver(userId, diverId, adapter.id);
    if (!conn) throw new ProviderServiceError('provider_not_connected', named(adapter));
    return conn;
  }

  /**
   * Runs `fn` holding the Dive's lease at each of these Providers: one action per Dive and Provider at a time, in every
   * app process. A second request is refused (`provider_busy`, naming the Provider), not queued.
   */
  async function leased<T>(diveId: string, adapters: ProviderAdapter[], fn: () => Promise<T>): Promise<T> {
    try {
      return await leases.dive(diveId, adapters.map((a) => a.id), fn);
    } catch (error) {
      throw error instanceof LeaseBusy ? new ProviderServiceError('provider_busy', named(registry.get(error.provider))) : error;
    }
  }

  /** The Provider's dive export, if it deletes. */
  function deleter(provider: string) {
    const found = exporter(provider);
    if (!found.exports.operations.includes('delete')) throw new ProviderServiceError('provider_unsupported', named(found.adapter));
    return found;
  }

  /** What deleting at one Provider needs: its Connection and the remote dive the Dive has there. */
  async function deletion(userId: string, row: { id: string; diverId: string }, provider: string) {
    const { adapter, dives } = deleter(provider);
    const conn = await connectionOrThrow(userId, row.diverId, adapter);
    const current = currentRemote(await pushesOf(row.id, adapter.id));
    if (!current) throw new ProviderServiceError('provider_not_sent', named(adapter));
    return { adapter, dives, conn, remoteId: current.remoteId!, remoteNumber: current.remoteNumber };
  }

  /**
   * Deletes the Dive's remote copy at one Provider and records the Push; `knownGone` when the check just found it gone.
   * Runs under the Dive's lease there.
   */
  async function deleteThere(userId: string, row: { id: string; diverId: string; version: number }, provider: string, knownGone: boolean) {
    const { adapter, dives, conn, remoteId, remoteNumber } = await deletion(userId, row, provider);
    const base = { diveId: row.id, connectionId: conn.id, userId, diveVersion: row.version, remoteId, remoteNumber };
    // Already deleted at the Provider: nothing was left to delete.
    if (knownGone) return record(adapter, { ...base, action: 'delete', state: 'confirmed', remoteGone: true });
    return connections.withAccess(conn, async (ctx) => {
      let outcome: 'deleted' | 'gone';
      try {
        outcome = await dives.open(ctx).remove!(remoteId);
      } catch (error) {
        if (signedOut(error)) throw error;
        const problem = asProblem(error, adapter);
        await record(adapter, { ...base, action: 'delete', state: 'failed', errorCode: problem instanceof ProviderServiceError ? problem.code : 'internal_error' });
        throw problem;
      }
      return record(adapter, { ...base, action: 'delete', state: 'confirmed', remoteGone: outcome === 'gone' });
    });
  }

  /**
   * Before deleting at several Providers: each has a Connection that is signed in, and says whether the remote dive is
   * still there (the adapter knows how). Refuses as the delete would; answers the Providers where it is gone already.
   */
  async function checkAll(userId: string, row: { id: string; diverId: string }, providers: string[]): Promise<Set<string>> {
    const gone = new Set<string>();
    for (const provider of providers) {
      const { dives, conn, remoteId } = await deletion(userId, row, provider);
      if (!(await connections.withAccess(conn, (ctx) => dives.open(ctx).exists!(remoteId)))) gone.add(provider);
    }
    return gone;
  }

  /**
   * Deletes the Dive's copies at these Providers. With several, every one is checked first, so none is deleted while
   * another would refuse; one that still fails stops it, and the answer says which copies are gone (their Pushes record
   * it). With one, it is simply deleted there.
   */
  async function removeAt(userId: string, diveId: string, providers: string[]): Promise<Removal> {
    const copies = new Map<string, 'deleted' | 'kept'>(providers.map((p) => [p, 'kept']));
    const answer = (failure: ProviderServiceError | null): Removal =>
      ({ copies: providers.map((provider) => ({ provider, copy: copies.get(provider)! })), failure });
    try {
      const adapters = providers.map((p) => deleter(p).adapter);
      const { row } = await loadOutgoingDive(db, userId, diveId, { deleted: true });
      return await leased(diveId, adapters, async () => {
        // The entries as they are before anything is deleted: a change after this goes out once more.
        const seen = new Map<string, QueueMark>();
        for (const provider of providers) seen.set(provider, await markWaitingPush(db, diveId, provider, 'delete'));
        const gone = providers.length > 1 ? await checkAll(userId, row, providers) : new Set<string>();
        for (const provider of providers) {
          await deleteThere(userId, row, provider, gone.has(provider));
          copies.set(provider, 'deleted');
          // A confirmed delete finishes the Dive's waiting delete there (a change noted after it began would not be a delete).
          await settleWaitingPush(db, diveId, provider, seen.get(provider)!, 'delete');
        }
        return answer(null);
      });
    } catch (error) {
      if (error instanceof ProviderServiceError) return answer(error);
      throw error;
    }
  }

  /**
   * The Dive as this Provider gets it, and what of its requirements is unmet (ADR 0029): from Dive Hub's data alone.
   * Participants an advisory requirement leaves out aren't in it.
   */
  function prepared(adapter: ProviderAdapter, exports: { requirements: Parameters<typeof unmetRequirements>[0] }, loaded: Awaited<ReturnType<typeof loadOutgoingDive>>) {
    const unmet = unmetRequirements(exports.requirements, loaded.site, loaded.outgoing, { listEntries: offersListEntries(adapter.capabilities) });
    return { unmet, outgoing: forProvider(loaded.outgoing, unmet) };
  }

  type Prepared = ReturnType<typeof prepared>;

  /**
   * Refuses a Dive whose blocking requirements are unmet (ADR 0029). `beforeSite`: before the send found or made the
   * site at the Provider, a site requirement the send fixes itself doesn't refuse yet.
   */
  function requirementsMet(adapter: ProviderAdapter, p: Prepared, options: { beforeSite?: boolean } = {}) {
    if (blocking(p.unmet, options).length > 0) {
      throw new ProviderServiceError('provider_requirements_unmet', named(adapter), { unmet: p.unmet });
    }
  }

  /** Recording one send's Pushes: delivered, failed (a sign-out is left to `withAccess`, which retries) or gone. */
  function pushSteps(adapter: ProviderAdapter, conn: ConnectionRow, row: { id: string; version: number }, userId: string) {
    const exports = adapter.capabilities.data.dives!.export!;
    const base = { diveId: row.id, connectionId: conn.id, userId, diveVersion: row.version, remoteReference: reference(row.id) };
    /** Who this Push couldn't carry: advisory ones nobody could send, and those the Provider doesn't have. */
    const leftOut = (d: Delivered, p: Prepared) => {
      const all = [...leftOutBy(p.unmet), ...(d.leftOut ?? []).map((l) => ({
        diverId: l.diverId, name: p.outgoing.participants.find((x) => x.diverId === l.diverId)?.name ?? '', reason: l.reason,
      }))];
      return all.length > 0 ? all : null;
    };
    const delivered = (action: 'create' | 'update', d: Delivered, p: Prepared, diveVersion: number) => record(adapter, {
      ...base, diveVersion, action, state: exports.delivery === 'confirmed' ? 'confirmed' : 'handed_over',
      remoteId: d.remoteId, remoteNumber: d.remoteNumber, fingerprint: adapter.dives!.fingerprint(p.outgoing), payload: d.payload,
      differences: d.differences, leftOut: leftOut(d, p),
    });
    const failed = async (action: 'create' | 'update', error: unknown, remoteId: string | null = null): Promise<never> => {
      if (signedOut(error)) throw error;
      const problem = asProblem(error, adapter);
      await record(adapter, {
        ...base, action, state: 'failed', remoteId, errorCode: problem instanceof ProviderServiceError ? problem.code : 'internal_error',
      });
      throw problem;
    };
    const gone = async (remoteId: string): Promise<never> => {
      await record(adapter, { ...base, action: 'update', state: 'failed', remoteId, errorCode: 'provider_dive_gone', remoteGone: true });
      throw new ProviderServiceError('provider_dive_gone', named(adapter));
    };
    return { base, delivered, failed, gone };
  }

  /**
   * Compares the Provider's record as it is now with the Dive and the base (ADR 0056): the fields that travel both ways
   * (as the import compares them), with the open entry's fields and the User's choices.
   */
  async function exchange(
    conn: ConnectionRow, adapter: ProviderAdapter, diveId: string, remoteId: string, read: { dive: ImportedDive; context: ImportContext; record: Record<string, unknown> },
    options: SendOptions,
  ): Promise<Exchange> {
    // The adapter parsed the dive without the entries remembered for Divers; parse it again with them.
    const context = await withRemembered(db, conn.diverId, adapter.accountSource, read.context);
    read = { ...read, context, dive: adapter.dives!.parse!(read.record, context, read.dive.remoteId) ?? read.dive };
    const run = await changes.runOf(db, conn.userId, adapter, {
      diverId: conn.diverId, connectionId: conn.id, mode: conn.importMode, windowMinutes: conn.importWindowMinutes, choices: {}, context,
    });
    const base = await changes.baseOf(db, run, diveId, remoteId);
    const source = (Object.keys(read.dive.siteIds)[0] ?? Object.keys(base?.siteIds ?? {})[0] ?? null) as SiteSource | null;
    // The remote dive's site ID, when the Diver's account may use it: an update never moves a dive between a site's IDs.
    const here = (await changes.hubOf(db, run, diveId, source, source ? read.dive.siteIds[source] : null))!;
    const provider = comparableOf(read.dive);
    const plan = planSend({
      fields: here.fields.filter((f) => exportsField(adapter, f)), base: base && comparableOf(base), provider, hub: here.hub,
      choices: options.conflicts ?? {}, open: await openFields(db, diveId, adapter.id, remoteId), onConflict: options.onConflict ?? 'ask',
    });
    const deferred = [...plan.keep, ...here.fields.filter((f) => !exportsField(adapter, f) && !same(f, provider, here.hub))];
    return { run, remote: read.dive, here, provider, plan, deferred };
  }

  /** These fields with both values, said as the import preview says them. */
  const shownOf = (x: Exchange, fields: SyncedField[]): Promise<ConflictField[]> => Promise.all(fields.map(async (field) => ({
    field, hub: await changes.shown(x.run, field, x.here.hub, x.here.row.siteId), provider: await changes.shown(x.run, field, x.provider, null),
  })));

  /** After an update: a Push run's Conflicts wait as the Dive's entry; any other successful send settles the entry. */
  async function settle(x: Exchange, conn: ConnectionRow, diveId: string, remoteId: string, options: SendOptions) {
    if (options.onConflict === 'defer' && x.plan.keep.length > 0) {
      await recordConflict(db, {
        diveId, provider: conn.provider, connectionId: conn.id, remoteId, fields: await shownOf(x, x.plan.keep), runId: options.runId ?? null,
      });
    } else await close(db, diveId, conn.provider);
  }

  /**
   * Updates the Dive's remote dive (ADR 0056), under the lease and the action of `send`. Where the Provider reads its
   * record (`current`) and parses a base: 1. its record now (gone: `provider_dive_gone`); 2.-4. compared with the Dive
   * and the base, with the open entry and the choices; 5. a Conflict to ask sends nothing; 6. what changed only there is
   * taken first (one Revision, the User's); 7. the Dive is read again; 8. the update keeps what is deferred or doesn't go
   * out, and clears what was removed here; 9. the Push with the fingerprint of the Dive as sent; 10. the entry waits
   * (a Push run's Conflicts) or is settled. A retry after a sign-in compares again: what was taken is equal there now,
   * so `taken` carries what the first attempt took into the answer.
   */
  async function updateThere(u: {
    adapter: ProviderAdapter; conn: ConnectionRow; userId: string; diveId: string; action: DiveExportAction; current: PushRow;
    steps: ReturnType<typeof pushSteps>; options: SendOptions; taken: Set<SyncedField>;
  }): Promise<SendResult> {
    const { adapter, conn, userId, diveId, action, current, steps, options, taken } = u;
    const exports = adapter.capabilities.data.dives!.export!;
    const remoteId = current.remoteId!;
    const read = action.current && adapter.dives!.parse
      ? await action.current(remoteId).catch((error: unknown) => steps.failed('update', error, remoteId)) : undefined;
    if (read === null) return steps.gone(remoteId);
    const x = read ? await exchange(conn, adapter, diveId, remoteId, read, options) : null;
    if (x && x.plan.conflicts.length > 0) return { result: 'conflicts', conflicts: await shownOf(x, x.plan.conflicts) };
    // The take commits on its own, before `requirementsMet` and the update: should either fail, the Dive holds the
    // Provider's values, and the next comparison sees both sides equal there, so nothing is taken twice nor lost.
    const applied = x && x.plan.take.length > 0
      ? await db.transaction((tx) => changes.takeChanges(tx, x.run, diveId, x.remote, x.plan.take, { type: 'user', id: userId }, true))
      : [];
    for (const field of applied) taken.add(field);
    // A take that changed nothing (a site Dive Hub can't use) stays as the Provider has it; a tank a Recording
    // brought, removed there, is sent again.
    const missed = (x?.plan.take ?? []).filter((f) => !applied.includes(f) && !(f === 'cylinder' && x!.remote.cylinder === null));
    const deferred = [...(x?.deferred ?? []), ...missed];
    const reloaded = await loadOutgoingDive(db, userId, diveId, read ? { remoteSiteIds: read.dive.siteIds } : {});
    const now = prepared(adapter, exports, reloaded);
    requirementsMet(adapter, now);
    const wanted = numbersFor(conn, exports, reloaded.row.number);
    const leave: Leave = {
      keep: [...(x?.plan.keep ?? []), ...missed, ...DIVE_FIELDS.filter((f) => !exportsField(adapter, f))], clear: x?.plan.clear ?? [],
    };
    const updated = await action.update!(remoteId, now.outgoing, current.payload, wanted?.onUpdate ? wanted.wanted : undefined, leave)
      .catch((error: unknown) => steps.failed('update', error, remoteId));
    if (!updated) return steps.gone(remoteId);
    const pushed = await steps.delivered('update', { ...updated, remoteNumber: updated.remoteNumber ?? current.remoteNumber }, now, reloaded.row.version);
    if (x) await settle(x, conn, diveId, remoteId, options);
    return { result: 'updated', push: pushed, taken: [...taken].filter((f) => !deferred.includes(f)), deferred };
  }

  /** The remote dive a Dive has now: whether it is up to date, and what an update would cost there (ADR 0043). */
  function remoteState(current: PushRow, dives: NonNullable<ProviderAdapter['dives']>, outgoing: OutgoingDive, numbers: NumbersFor | null) {
    const upToDate = current.fingerprint !== null && current.fingerprint === dives.fingerprint(outgoing);
    // Whether the Provider's number is Dive Hub's is a state of its own, not "changed since sent" (ADR 0048).
    const number = numbers && {
      wanted: numbers.wanted, differs: current.remoteNumber !== numbers.wanted, canSet: numbers.onUpdate,
      removesVerification: numbers.removesVerification,
    };
    return {
      remoteId: current.remoteId!, remoteNumber: current.remoteNumber, sentAt: current.createdAt, upToDate,
      updateRemovesVerification: !upToDate && ((dives.updateRemovesVerification?.(outgoing, current.payload) ?? false)
        || (!!number?.differs && number.canSet && number.removesVerification)),
      number,
    };
  }

  /** The Dive of this Diver whose current remote dive at the Provider is this one, if Dive Hub knows it. */
  async function diveAtRemote(diverId: string, provider: string, remoteId: string): Promise<string | null> {
    const candidates = await db.selectDistinct({ id: push.diveId }).from(push).innerJoin(dive, eq(dive.id, push.diveId))
      .where(and(eq(push.provider, provider), eq(push.remoteId, remoteId), eq(dive.diverId, diverId)));
    for (const { id } of candidates) {
      if (currentRemote(await pushesOf(id, provider))?.remoteId === remoteId) return id;
    }
    return null;
  }

  /** A Dive's state at one Provider. */
  async function statusAt(userId: string, provider: string, loaded: Awaited<ReturnType<typeof loadOutgoingDive>>) {
    const { adapter, dives, exports } = exporter(provider);
    const { row } = loaded;
    const { unmet, outgoing } = prepared(adapter, exports, loaded);
    const conn = await connections.forDiver(userId, row.diverId, adapter.id);
    const pushes = await pushesOf(row.id, adapter.id);
    const current = currentRemote(pushes);
    // The open entry about the current remote dive: the Conflicts that wait (ADR 0056).
    const entry = current ? await entryOf(db, row.id, adapter.id) : null;
    return {
      provider: adapter.id,
      connection: conn ? { id: conn.id, state: conn.state, accountLabel: conn.accountLabel } : null,
      siteId: row.siteId,
      unmet,
      current: current ? remoteState(current, dives, outgoing, numbersFor(conn, exports, row.number)) : null,
      conflicts: entry && entry.remoteId === current?.remoteId ? entry.fields : null,
      pushes,
    };
  }

  return {
    /** A Dive's state at one Provider: its Diver's Connection, what is unmet, its current remote dive, every Push. */
    async status(userId: string, diveId: string, provider: string) {
      exporter(provider);
      return statusAt(userId, provider, await loadOutgoingDive(db, userId, diveId, { deleted: true }));
    },

    /** A Dive's state at every Provider that exports dives. */
    async statusAll(userId: string, diveId: string) {
      const loaded = await loadOutgoingDive(db, userId, diveId, { deleted: true });
      const providers = registry.list().filter((a) => a.dives && a.capabilities.data.dives?.export);
      return Promise.all(providers.map((a) => statusAt(userId, a.id, loaded)));
    },

    /**
     * The Dives of these Divers that changed since they were sent (the logbook's filter, ADR 0040): at a Provider the User
     * is connected to for the Diver, a current remote dive that is not up to date, or whose number differs and can be
     * set by an update (the Connection follows numbers). Worked out from the adapters' fingerprints, so only the Dives
     * with a confirmed Push at a connected Provider are loaded.
     */
    async changedSinceSent(userId: string, diverIds: string[]): Promise<string[]> {
      if (diverIds.length === 0) return [];
      const providers = registry.list().filter((a) => a.dives && a.capabilities.data.dives?.export).map((a) => a.id);
      if (providers.length === 0) return [];
      const candidates = await db.selectDistinct({ id: dive.id }).from(dive)
        .innerJoin(push, and(eq(push.diveId, dive.id), eq(push.state, 'confirmed'), isNotNull(push.remoteId), inArray(push.provider, providers)))
        .innerJoin(connection, and(eq(connection.userId, userId), eq(connection.diverId, dive.diverId), eq(connection.provider, push.provider)))
        .where(and(inArray(dive.diverId, diverIds), isNull(dive.deletedAt)));
      const changed: string[] = [];
      for (const { id } of candidates) {
        const loaded = await loadOutgoingDive(db, userId, id);
        for (const provider of providers) {
          const { connection: conn, current } = await statusAt(userId, provider, loaded);
          if (conn && current && (!current.upToDate || (current.number?.differs && current.number.canSet))) {
            changed.push(id);
            break;
          }
        }
      }
      return changed;
    },

    /** The Provider's dive sites near the Dive, nearest first (to pick its site ID from). */
    async siteSuggestions(userId: string, diveId: string, provider: string): Promise<(RemoteSite & { distanceM: number | null })[]> {
      const adapter = registry.get(provider);
      if (!adapter.diveSites) throw new ProviderServiceError('provider_unsupported', named(adapter));
      const { row, position } = await loadOutgoingDive(db, userId, diveId);
      const conn = await connectionOrThrow(userId, row.diverId, adapter);
      const sites = await connections.withAccess(conn, (ctx) => adapter.diveSites!.find(ctx));
      return sites
        .map((s) => ({
          ...s,
          distanceM: position && s.latitude !== null && s.longitude !== null
            ? Math.round(distanceM(position, { latitude: s.latitude, longitude: s.longitude })) : null,
        }))
        .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) || a.name.localeCompare(b.name))
        .slice(0, SUGGESTIONS);
    },

    /**
     * Sends the Dive: updates the remote dive it already has, or creates one. Before creating, a dive the Provider
     * already has at the same time is offered instead (`exists`), unless `onExisting` says to link to it or to create
     * anyway. A dive we sent before whose answer got lost (found by our reference) is linked without asking.
     * An update is three-way where the Provider reads its record (ADR 0056): see `updateThere`.
     */
    async send(userId: string, diveId: string, provider: string, options: SendOptions = {}): Promise<SendResult> {
      const { onExisting } = options;
      const { adapter, dives, exports } = exporter(provider);
      // The Dive's waiting send as it is before the send reads the Dive: a change after this goes out once more.
      const seen = await markWaitingPush(db, diveId, adapter.id, 'send');
      const first = await loadOutgoingDive(db, userId, diveId);
      const conn = await connectionOrThrow(userId, first.row.diverId, adapter);
      requirementsMet(adapter, prepared(adapter, exports, first), { beforeSite: true });
      const bySend = exports.requirements.find((r) => r.type === 'site_external_id' && r.createdBySend);
      // What an update took, kept across a retry after a sign-in.
      const taken = new Set<SyncedField>();
      // The entries the send made or found named otherwise, kept across a retry too.
      const settled: BuddiesForSend = { added: [], knownAs: [] };
      const withBuddies = (r: SendResult) => withSettled(r, settled);
      // The Participants' entries in the Provider's list, settled after the site and before the Dive is read.
      const settleBuddies = async (context: ActionContext) => {
        if (!adapter.accountSource) return;
        keepBuddies(settled, await buddiesForSend(db, { adapter, context, ownerDiverId: first.row.diverId, diveId, source: adapter.accountSource }));
      };
      const result = await leased(diveId, [adapter], () => connections.withAccess(conn, async (ctx) => {
        // The site at the Provider first, found or made (stored at once, so a retry after a sign-in makes none), then
        // the Dive as it goes out with it.
        if (bySend?.type === 'site_external_id') {
          // The Dive's site as it is under the lease, not as it was before.
          const [now] = await db.select({ siteId: dive.siteId }).from(dive).where(eq(dive.id, diveId));
          await siteForSend(db, {
            adapter, context: ctx, diverId: first.row.diverId, siteId: now?.siteId ?? null, source: bySend.source, actor: { type: 'user', id: userId },
          });
        }
        await settleBuddies(ctx);
        const loaded = await loadOutgoingDive(db, userId, diveId);
        const { row } = loaded;
        const sending = prepared(adapter, exports, loaded);
        const { outgoing } = sending;
        requirementsMet(adapter, sending);
        const wanted = numbersFor(conn, exports, row.number);
        const action = dives.open(ctx);
        const steps = pushSteps(adapter, conn, row, userId);

        const current = currentRemote(await pushesOf(diveId, adapter.id));
        if (current && action.update) return withBuddies(await updateThere({ adapter, conn, userId, diveId, action, current, steps, options, taken }));

        if (action.find) {
          const { ours, sameTime } = await action.find(outgoing, reference(diveId));
          const found = ours ?? (onExisting === 'create' ? null : sameTime);
          if (found && !ours && onExisting !== 'link') return withBuddies({ result: 'exists', existing: found });
          if (found) {
            // Linked, not sent: our values aren't there yet, so the Dive shows as changed until it is updated.
            return withBuddies({
              result: 'linked', push: await record(adapter, {
                ...steps.base, action: 'link', state: 'confirmed', remoteId: found.remoteId, remoteNumber: found.number,
                fingerprint: ours ? dives.fingerprint(outgoing) : null,
              }),
            });
          }
        }

        const created = await action.create(outgoing, reference(diveId), wanted?.onCreate ? wanted.wanted : undefined).catch((error: unknown) => steps.failed('create', error));
        return withBuddies({ result: 'created', push: await steps.delivered('create', created, sending, row.version) });
      }));
      // A confirmed send (manual, a Push run's or the worker's) finishes the Dive's waiting send, unless it changed meanwhile.
      if ('push' in result && result.push.state === 'confirmed') await settleWaitingPush(db, diveId, adapter.id, seen, 'send');
      return result;
    },

    /**
     * Sets the number of the Dive's remote dive to the Dive's own (ADR 0048) and nothing else, as a Push of its own: the
     * fingerprint and payload of the Push before it stay, so the Dive's state is what it was. Refused while the
     * Connection doesn't follow, when the Provider sets no numbers on an update, when there is nothing to set, and
     * when another dive at the Provider has the number (`provider_number_taken`, naming it).
     */
    async setNumber(
      userId: string, diveId: string, provider: string, options: { sharesWithDiveId?: string | undefined } = {},
    ): Promise<{ result: 'set'; push: PushRow }> {
      const { adapter, dives, exports } = exporter(provider);
      const loaded = await loadOutgoingDive(db, userId, diveId);
      const { row } = loaded;
      const conn = await connectionOrThrow(userId, row.diverId, adapter);
      if (!conn.followNumbers) throw new ProviderServiceError('provider_numbers_off', named(adapter));
      if (!exports.numbers?.set.includes('update')) throw new ProviderServiceError('provider_unsupported', named(adapter));
      const first = currentRemote(await pushesOf(diveId, adapter.id));
      if (!first) throw new ProviderServiceError('provider_not_sent', named(adapter));
      if (row.number === null || first.remoteNumber === row.number) throw new ProviderServiceError('provider_number_nothing_to_set', named(adapter));
      return leased(diveId, [adapter], () => connections.withAccess(conn, async (ctx) => {
        // Under the lease: what is current now may be another Push than a moment ago.
        const current = currentRemote(await pushesOf(diveId, adapter.id));
        if (!current) throw new ProviderServiceError('provider_not_sent', named(adapter));
        if (current.remoteNumber === row.number) throw new ProviderServiceError('provider_number_nothing_to_set', named(adapter));
        const base = { diveId, connectionId: conn.id, userId, diveVersion: current.diveVersion, remoteId: current.remoteId, remoteReference: current.remoteReference };
        const failed = async (error: unknown): Promise<never> => {
          if (signedOut(error)) throw error;
          const problem = asProblem(error, adapter);
          await record(adapter, {
            ...base, action: 'number', state: 'failed',
            errorCode: problem instanceof ProviderServiceError ? problem.code : 'internal_error',
          });
          throw problem;
        };
        // A swap's first step (ADR 0052, from a run): the one dive whose number this takes for the length of the save.
        const sharesWith = options.sharesWithDiveId ? currentRemote(await pushesOf(options.sharesWithDiveId, adapter.id))?.remoteId ?? undefined : undefined;
        const outcome = await dives.open(ctx).setNumber!(current.remoteId!, row.number!, sharesWith).catch((error: unknown) => failed(error));
        if (!outcome) {
          await record(adapter, { ...base, action: 'number', state: 'failed', errorCode: 'provider_dive_gone', remoteGone: true });
          throw new ProviderServiceError('provider_dive_gone', named(adapter));
        }
        if (outcome.result === 'taken') {
          await record(adapter, { ...base, action: 'number', state: 'failed', errorCode: 'provider_number_taken' });
          throw new ProviderServiceError('provider_number_taken', named(adapter), {
            existing: outcome.by, diveId: await diveAtRemote(row.diverId, adapter.id, outcome.by.remoteId),
          });
        }
        return {
          result: 'set' as const,
          push: await record(adapter, {
            ...base, action: 'number', state: 'confirmed', remoteNumber: outcome.remoteNumber,
            fingerprint: current.fingerprint, payload: current.payload,
          }),
        };
      }));
    },

    /**
     * The dives at the Provider with their numbers, read afresh (ADR 0052), for the preview of a run that sets numbers:
     * holders only there are named before anything is sent. Null where the Provider can't be read this way.
     */
    async heldNumbers(userId: string, diverId: string, provider: string): Promise<RemoteDive[] | null> {
      const { adapter, dives } = exporter(provider);
      const conn = await connectionOrThrow(userId, diverId, adapter);
      return connections.withAccess(conn, async (ctx) => {
        const read = dives.open(ctx).heldNumbers;
        return read ? read() : null;
      });
    },

    /** The remote dive each of these Dives has now, per Provider (Dives without any are left out). No access check. */
    async currentOf(diveIds: string[]): Promise<Map<string, Map<string, PushRow>>> {
      const current = new Map<string, Map<string, PushRow>>();
      if (diveIds.length === 0) return current;
      const rows = await db.select().from(push).where(inArray(push.diveId, diveIds)).orderBy(desc(push.createdAt), desc(push.id));
      for (const id of diveIds) {
        for (const adapter of registry.list()) {
          const remote = currentRemote(rows.filter((p) => p.diveId === id && p.provider === adapter.id));
          if (!remote) continue;
          if (!current.has(id)) current.set(id, new Map());
          current.get(id)!.set(adapter.id, remote);
        }
      }
      return current;
    },

    /**
     * Deletes the Dive's remote copy at the Provider. The Dive stays in the hub; a Dive deleted in the hub can still be
     * deleted there (the reminder, ADR 0026).
     */
    async remove(userId: string, diveId: string, provider: string): Promise<void> {
      const { failure } = await removeAt(userId, diveId, [provider]);
      if (failure) throw failure;
    },

    /** Deletes the Dive's copies at these Providers, before the Dive itself is deleted (ADR 0026, 0027). */
    removeAt,
  };
}

export type PushService = ReturnType<typeof createPushService>;
