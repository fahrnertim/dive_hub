// Dives gone at a Provider (ADR 0051): which Dives' remote dives are no longer in the Provider's logbook. A finding is
// stored and changes nothing; the User's choice first confirms it with one more fresh read, under each Dive's lease,
// and only a second read that agrees records the delete Push (`remoteGone`) that ADR 0027 knows. Findings come from
// every complete read of the logbook: the import preview, the scheduled fetch and the check below. Only the User's
// choice deletes anything.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { dive, diveSite, providerGoneDive, push, type ConnectionRow } from '../../db/schema.js';
import { siteRef } from '../../dives/dive-summary-view.js';
import type { ConnectionService } from '../connection-service.js';
import { compareGone, goneWarning, type GoneCandidate } from './gone-dive-rules.js';
import { LeaseBusy, type LeaseService } from '../lease-service.js';
import { recordedMode, type ProviderAdapter } from '../provider.js';
import { named, ProviderServiceError, type ProviderRegistry } from '../registry.js';
import { currentRemote, type PushRow } from '../remote-state.js';


/** What a check or a preview found. Nothing is deleted or sent by finding it. */
export interface GoneSummary {
  /** The listing had no records: nothing was compared (an empty logbook is never a finding). */
  empty: boolean;
  compared: number;
  /** How many Dives are gone now (new findings and those found before that still hold). */
  gone: number;
  warning: boolean;
}

export type ConfirmResult = 'gone' | 'there' | 'not_waiting' | 'unconfirmed';

/** The Dives of a Diver with their current remote dive at a Provider (Dives without any are left out). */
async function candidatesOf(db: Db, diverId: string, provider: string) {
  const dives = await db.select({ id: dive.id, version: dive.version, deletedAt: dive.deletedAt }).from(dive).where(eq(dive.diverId, diverId));
  if (dives.length === 0) return [];
  const pushes = await db.select().from(push).innerJoin(dive, eq(dive.id, push.diveId))
    .where(and(eq(dive.diverId, diverId), eq(push.provider, provider))).orderBy(desc(push.createdAt), desc(push.id));
  const byDive = new Map<string, PushRow[]>();
  for (const { push: p } of pushes) byDive.set(p.diveId, [...(byDive.get(p.diveId) ?? []), p]);
  return dives.flatMap((d) => {
    const current = currentRemote(byDive.get(d.id) ?? []);
    return current ? [{ diveId: d.id, version: d.version, remoteId: current.remoteId!, remoteNumber: current.remoteNumber,
      connectionId: current.connectionId, deleted: d.deletedAt !== null } satisfies GoneCandidate & { version: number }] : [];
  });
}

/**
 * Compares the Connection's Dives with a complete, fresh listing and stores what it finds: a Dive absent from it is a
 * finding, one that is listed has its finding removed. An empty listing changes nothing. Used by the import preview
 * (which reads the logbook anyway) and by the check.
 */
export async function recordFindings(db: Db, row: ConnectionRow, records: { remoteId: string }[]): Promise<GoneSummary> {
  const candidates = await candidatesOf(db, row.diverId, row.provider);
  const found = compareGone({ connectionId: row.id, candidates, listed: records });
  if (found.empty) return { empty: true, compared: 0, gone: await waitingCount(db, row, candidates), warning: false };
  await db.transaction(async (tx) => {
    if (found.gone.length > 0) {
      await tx.insert(providerGoneDive).values(found.gone.map((g) => ({
        diveId: g.diveId, provider: row.provider, connectionId: row.id, remoteId: g.remoteId, remoteNumber: g.remoteNumber,
      }))).onConflictDoUpdate({
        target: [providerGoneDive.diveId, providerGoneDive.provider],
        set: {
          connectionId: sql`excluded.connection_id`, remoteId: sql`excluded.remote_id`, remoteNumber: sql`excluded.remote_number`,
          // Found again with the same remote dive: it was found at the first read.
          foundAt: sql`case when ${providerGoneDive.remoteId} = excluded.remote_id then ${providerGoneDive.foundAt} else now() end`,
        },
      });
    }
    // A Dive the logbook lists again is no longer a finding.
    if (found.there.length > 0) {
      await tx.delete(providerGoneDive).where(and(
        eq(providerGoneDive.provider, row.provider), inArray(providerGoneDive.diveId, found.there.map((t) => t.diveId)),
      ));
    }
  });
  return { empty: false, compared: found.compared, gone: found.gone.length, warning: found.warning };
}

/** The findings that still wait now: live Dive, and the finding's remote dive is still the Dive's current one. */
async function waitingRows(db: Db, row: ConnectionRow, candidates: (GoneCandidate & { version: number })[]) {
  const findings = await db.select().from(providerGoneDive)
    .where(and(eq(providerGoneDive.connectionId, row.id), eq(providerGoneDive.provider, row.provider)));
  const current = new Map(candidates.filter((c) => !c.deleted && c.connectionId === row.id).map((c) => [c.diveId, c]));
  return findings.filter((f) => current.get(f.diveId)?.remoteId === f.remoteId);
}

async function waitingCount(db: Db, row: ConnectionRow, candidates: (GoneCandidate & { version: number })[]) {
  return (await waitingRows(db, row, candidates)).length;
}

export function createGoneDiveService(deps: { db: Db; registry: ProviderRegistry; connections: ConnectionService; leases: LeaseService }) {
  const { db, registry, connections, leases } = deps;

  /** The Provider's dive listing, or `provider_unsupported`. Works whatever the Connection's import mode is. */
  function lister(provider: string) {
    const adapter = registry.get(provider);
    const list = adapter.dives?.list;
    if (!list || !adapter.capabilities.data.dives?.import?.operations.includes('list')) {
      throw new ProviderServiceError('provider_unsupported', named(adapter));
    }
    return { adapter, list };
  }

  /** One fresh read of the account's whole logbook, in one paced action. */
  async function freshRead(row: ConnectionRow) {
    const { list } = lister(row.provider);
    return (await connections.withAccess(row, (ctx) => list(ctx))).records;
  }

  /** Runs `fn` holding every one of these Dives' leases at the Provider; `provider_busy` when another action holds one. */
  async function underLeases<T>(diveIds: string[], adapter: ProviderAdapter, fn: () => Promise<T>): Promise<T> {
    const [first, ...rest] = diveIds;
    if (first === undefined) return fn();
    try {
      return await leases.dive(first, [adapter.id], () => underLeases(rest, adapter, fn));
    } catch (error) {
      throw error instanceof LeaseBusy ? new ProviderServiceError('provider_busy', named(adapter), undefined, { cause: error }) : error;
    }
  }

  return {
    /**
     * Reads the account's logbook afresh (one paced action) and stores what it finds. Works with the Connection's import
     * off. Changes no Dive.
     */
    async check(userId: string, connectionId: string): Promise<GoneSummary> {
      const row = await connections.own(userId, connectionId);
      lister(row.provider);
      return recordFindings(db, row, await freshRead(row));
    },

    /** The findings that wait, for each of the User's Connections that has any (no call to a Provider). */
    async waiting(userId: string) {
      const out = [];
      for (const c of await connections.list(userId)) {
        const row = await connections.own(userId, c.id);
        const candidates = await candidatesOf(db, row.diverId, row.provider);
        const waiting = await waitingRows(db, row, candidates);
        if (waiting.length === 0) continue;
        const dives = await db.select({
          id: dive.id, version: dive.version, number: dive.number, startsAt: dive.startsAt, utcOffsetSeconds: dive.utcOffsetSeconds,
          utcOffsetSource: dive.utcOffsetSource, durationSeconds: dive.durationSeconds, maxDepthM: dive.maxDepthM,
          siteId: dive.siteId, siteName: diveSite.name,
        }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(inArray(dive.id, waiting.map((w) => w.diveId)));
        const compared = candidates.filter((x) => !x.deleted && x.connectionId === row.id).length;
        out.push({
          connectionId: row.id, provider: row.provider, diverId: row.diverId, diverName: c.diverName, accountLabel: c.accountLabel,
          compared, warning: goneWarning(compared, waiting.length),
          dives: waiting.flatMap((w) => {
            const d = dives.find((x) => x.id === w.diveId);
            return d ? [{
              diveId: d.id, version: d.version, number: d.number, startsAt: d.startsAt, utcOffsetSeconds: d.utcOffsetSeconds, utcOffsetSource: d.utcOffsetSource,
              durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, site: siteRef(d.siteId, d.siteName),
              remoteId: w.remoteId, remoteNumber: w.remoteNumber, foundAt: w.foundAt,
            }] : [];
          }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
        });
      }
      return out;
    },

    /**
     * Confirms the chosen findings with one fresh read for all of them, each Dive under its lease: still gone, a
     * confirmed delete Push with `remoteGone` is recorded (the Dive has no remote dive there from then on); there after
     * all, nothing is recorded and the finding is removed. An empty logbook confirms nothing.
     */
    async confirm(userId: string, connectionId: string, diveIds: string[]): Promise<{ empty: boolean; results: { diveId: string; confirmation: ConfirmResult }[] }> {
      const row = await connections.own(userId, connectionId);
      const { adapter } = lister(row.provider);
      const ids = [...new Set(diveIds)];
      return underLeases(ids, adapter, async () => {
        // Under the leases: what waits and what is current now.
        const candidates = await candidatesOf(db, row.diverId, row.provider);
        const waiting = new Map((await waitingRows(db, row, candidates)).map((w) => [w.diveId, w]));
        const chosen = ids.filter((id) => waiting.has(id));
        const results = new Map<string, ConfirmResult>(ids.map((id) => [id, waiting.has(id) ? 'unconfirmed' : 'not_waiting']));
        const answer = (empty: boolean) => ({ empty, results: ids.map((diveId) => ({ diveId, confirmation: results.get(diveId)! })) });
        if (chosen.length === 0) return answer(false);
        const records = await freshRead(row);
        if (records.length === 0) return answer(true);
        const listed = new Set(records.map((r) => r.remoteId));
        for (const id of chosen) {
          const finding = waiting.get(id)!;
          const candidate = candidates.find((c) => c.diveId === id)!;
          if (listed.has(finding.remoteId)) {
            await db.delete(providerGoneDive).where(and(eq(providerGoneDive.diveId, id), eq(providerGoneDive.provider, row.provider)));
            results.set(id, 'there');
            continue;
          }
          await db.transaction(async (tx) => {
            await tx.insert(push).values({
              diveId: id, connectionId: row.id, userId, provider: row.provider, mode: recordedMode(adapter), action: 'delete',
              state: 'confirmed', remoteId: finding.remoteId, remoteNumber: finding.remoteNumber, diveVersion: candidate.version, remoteGone: true,
            });
            await tx.delete(providerGoneDive).where(and(eq(providerGoneDive.diveId, id), eq(providerGoneDive.provider, row.provider)));
          });
          results.set(id, 'gone');
        }
        return answer(false);
      });
    },
  };
}

export type GoneDiveService = ReturnType<typeof createGoneDiveService>;
