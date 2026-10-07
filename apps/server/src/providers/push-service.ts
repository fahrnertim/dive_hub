// Pushes to Providers (ADR 0024, 0027): what every Provider needs when a Dive goes out. It records each action, knows
// the remote record a Dive has now, works out "outdated" from the adapter's fingerprint, runs one action per Dive and
// Provider at a time (a lease, leases.ts), deletes at several Providers only once each would, and turns adapter errors
// into problem codes. What a Provider does with the Dive is the adapter's.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { push } from '../db/schema.js';
import type { ConnectionService } from './connection-service.js';
import { LeaseBusy, type Leases } from './leases.js';
import { loadOutgoingDive } from './outgoing-dive.js';
import { ProviderError, referenceOf, type Delivered, type OutgoingDive, type ProviderAdapter, type RemoteDive, type RemoteSite } from './provider.js';
import { asProblem, named, ProviderServiceError, type ProviderRegistry } from './registry.js';
import { forProvider, leftOutBy, unmetRequirements } from './requirements.js';

export type PushRow = typeof push.$inferSelect;

/** What deleting a Dive at Providers did: each copy deleted or kept, and why it stopped, if it did. */
export interface Removal {
  copies: { provider: string; copy: 'deleted' | 'kept' }[];
  /** The refusal that stopped it; the copies after it were kept. Null when every copy asked for is gone. */
  failure: ProviderServiceError | null;
}

export type SendResult =
  | { result: 'created' | 'updated' | 'linked'; push: PushRow }
  | { result: 'exists'; existing: RemoteDive };

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
 * The remote dive a Dive has at one Provider now, from its Pushes there (newest first): the last confirmed one with an
 * ID, unless a later delete or a "found gone" came after it.
 */
export function currentRemote(pushes: PushRow[]): PushRow | null {
  for (const p of pushes) {
    if (p.remoteGone) return null;
    if (p.state !== 'confirmed') continue;
    if (p.action === 'delete') return null;
    if (p.remoteId) return p;
  }
  return null;
}

/**
 * What the Provider's fingerprint of the Dive is now, as it would get it (without the Participants an advisory
 * requirement leaves out): a link made from the Provider's own dive records it, so the Dive shows up to date (ADR 0030).
 */
export function fingerprintNow(adapter: ProviderAdapter, loaded: Awaited<ReturnType<typeof loadOutgoingDive>>): string | null {
  const exports = adapter.capabilities.data.dives?.export;
  if (!adapter.dives || !exports) return null;
  return adapter.dives.fingerprint(forProvider(loaded.outgoing, unmetRequirements(exports.requirements, loaded.row.siteId, loaded.outgoing)));
}

export function createPushService(deps: { db: Db; registry: ProviderRegistry; connections: ConnectionService; leases: Leases }) {
  const { db, registry, connections, leases } = deps;

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
        const gone = providers.length > 1 ? await checkAll(userId, row, providers) : new Set<string>();
        for (const provider of providers) {
          await deleteThere(userId, row, provider, gone.has(provider));
          copies.set(provider, 'deleted');
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
  function prepared(exports: { requirements: Parameters<typeof unmetRequirements>[0] }, loaded: Awaited<ReturnType<typeof loadOutgoingDive>>) {
    const unmet = unmetRequirements(exports.requirements, loaded.row.siteId, loaded.outgoing);
    return { unmet, outgoing: forProvider(loaded.outgoing, unmet) };
  }

  /** The remote dive a Dive has now: whether it is up to date, and what an update would cost there (ADR 0043). */
  function remoteState(current: PushRow, dives: NonNullable<ProviderAdapter['dives']>, outgoing: OutgoingDive) {
    const upToDate = current.fingerprint !== null && current.fingerprint === dives.fingerprint(outgoing);
    return {
      remoteId: current.remoteId!, remoteNumber: current.remoteNumber, sentAt: current.createdAt, upToDate,
      updateRemovesVerification: !upToDate && (dives.updateRemovesVerification?.(outgoing, current.payload) ?? false),
    };
  }

  /** A Dive's state at one Provider. */
  async function statusAt(userId: string, provider: string, loaded: Awaited<ReturnType<typeof loadOutgoingDive>>) {
    const { adapter, dives, exports } = exporter(provider);
    const { row } = loaded;
    const { unmet, outgoing } = prepared(exports, loaded);
    const conn = await connections.forDiver(userId, row.diverId, adapter.id);
    const pushes = await pushesOf(row.id, adapter.id);
    const current = currentRemote(pushes);
    return {
      provider: adapter.id,
      connection: conn ? { id: conn.id, state: conn.state, accountLabel: conn.accountLabel } : null,
      siteId: row.siteId,
      unmet,
      current: current ? remoteState(current, dives, outgoing) : null,
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
     */
    async send(userId: string, diveId: string, provider: string, onExisting?: 'link' | 'create'): Promise<SendResult> {
      const { adapter, dives, exports } = exporter(provider);
      const loaded = await loadOutgoingDive(db, userId, diveId);
      const { row } = loaded;
      const { unmet, outgoing } = prepared(exports, loaded);
      const conn = await connectionOrThrow(userId, row.diverId, adapter);
      if (unmet.some((u) => u.severity === 'blocking')) {
        throw new ProviderServiceError('provider_requirements_unmet', named(adapter), { unmet });
      }
      const advisory = leftOutBy(unmet);
      /** Who this Push couldn't carry: advisory ones nobody could send, and those the Provider doesn't have. */
      const leftOut = (d: Delivered) => {
        const all = [...advisory, ...(d.leftOut ?? []).map((l) => ({
          diverId: l.diverId, name: outgoing.participants.find((p) => p.diverId === l.diverId)?.name ?? '', reason: l.reason,
        }))];
        return all.length > 0 ? all : null;
      };
      return leased(diveId, [adapter], () => connections.withAccess(conn, async (ctx) => {
        const action = dives.open(ctx);
        const base = { diveId, connectionId: conn.id, userId, diveVersion: row.version, remoteReference: reference(diveId) };
        const delivered = (action_: 'create' | 'update', d: Delivered) => record(adapter, {
          ...base, action: action_, state: exports.delivery === 'confirmed' ? 'confirmed' : 'handed_over',
          remoteId: d.remoteId, remoteNumber: d.remoteNumber, fingerprint: dives.fingerprint(outgoing), payload: d.payload,
          differences: d.differences, leftOut: leftOut(d),
        });
        const failed = async (action_: 'create' | 'update', error: unknown, remoteId: string | null = null): Promise<never> => {
          if (signedOut(error)) throw error;
          const problem = asProblem(error, adapter);
          await record(adapter, {
            ...base, action: action_, state: 'failed', remoteId,
            errorCode: problem instanceof ProviderServiceError ? problem.code : 'internal_error',
          });
          throw problem;
        };

        const current = currentRemote(await pushesOf(diveId, adapter.id));
        if (current && action.update) {
          const updated = await action.update(current.remoteId!, outgoing, current.payload)
            .catch((error: unknown) => failed('update', error, current.remoteId));
          if (!updated) {
            await record(adapter, { ...base, action: 'update', state: 'failed', remoteId: current.remoteId, errorCode: 'provider_dive_gone', remoteGone: true });
            throw new ProviderServiceError('provider_dive_gone', named(adapter));
          }
          return { result: 'updated', push: await delivered('update', { ...updated, remoteNumber: updated.remoteNumber ?? current.remoteNumber }) };
        }

        if (action.find) {
          const { ours, sameTime } = await action.find(outgoing, reference(diveId));
          const same = ours ?? (onExisting === 'create' ? null : sameTime);
          if (same && !ours && onExisting !== 'link') return { result: 'exists', existing: same };
          if (same) {
            // Linked, not sent: our values aren't there yet, so the Dive shows as changed until it is updated.
            return {
              result: 'linked', push: await record(adapter, {
                ...base, action: 'link', state: 'confirmed', remoteId: same.remoteId, remoteNumber: same.number,
                fingerprint: ours ? dives.fingerprint(outgoing) : null,
              }),
            };
          }
        }

        const created = await action.create(outgoing, reference(diveId)).catch((error: unknown) => failed('create', error));
        return { result: 'created', push: await delivered('create', created) };
      }));
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
