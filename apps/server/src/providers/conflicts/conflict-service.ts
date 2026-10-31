// Conflicts with a Provider: a field changed on both sides, differently, found while sending a Dive (ADR 0056). One entry
// per Dive and Provider is stored and waits in "Needs your decision" on the Review page. Like the dives gone at a
// Provider (gone-dives.ts), whether an entry still waits is worked out on reading, from three checks: its Dive is live,
// its remote dive is still the Dive's current one, and at least one of its fields still differs between the Dive now and
// the Provider's value as the run found it (design 2026-10-28). Nothing is written on reading; nothing here calls a Provider.
// Two ways in: the send and the import write through the bare functions (`record`, `entryOf`, `openFields`, `closeFields`,
// `close`) with their own `Queryable`, inside their own flow; `createConflictService` is the one read side, for the Dive's
// page, "Needs your decision" and a Push run's count.
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { Db, Queryable } from '../../db/client.js';
import { connection, dive, diveSite, providerConflict, push, waitingPush, type ConnectionRow } from '../../db/schema.js';
import { siteRef } from '../../dives/dive-summary-view.js';
import type { BlobStore } from '../../storage/blob-store.js';
import type { ConnectionService } from '../connection-service.js';
import { createDiveChanges, type ProviderContext, type ShownValue } from '../dive-import/dive-changes.js';
import type { ProviderAdapter } from '../provider.js';
import type { ProviderRegistry } from '../registry.js';
import { currentRemote, type PushRow } from '../remote-state.js';
import { sameAtProvider, type Comparable, type SyncedField } from '../dive-import/three-way.js';
import type { SiteSource } from '../../sites/sources.js';

/** One field on which the two sides differ, both values said as in the import preview. */
export interface ConflictField {
  field: SyncedField;
  hub: ShownValue;
  provider: ShownValue;
}

/** A stored field: the shown values and, from 2026-10-28 on, the Provider's value as the comparison sees it. */
export interface StoredConflictField extends ConflictField {
  compared?: { provider: Comparable[SyncedField]; siteSource: SiteSource | null };
}

export interface ConflictEntry {
  diveId: string;
  provider: string;
  connectionId: string;
  remoteId: string;
  fields: StoredConflictField[];
  runId: string | null;
  /** The caller's now: the Clock's, not the machine's. */
  foundAt: Date;
}

const fieldsOf = (stored: unknown): StoredConflictField[] => stored as StoredConflictField[];

/** What the API says of a field: the shown values only. */
const shownFields = (fields: StoredConflictField[]): ConflictField[] => fields.map(({ field, hub, provider }) => ({ field, hub, provider }));

/** Stores the Conflict of a Dive at a Provider; a newer one for the same Dive and Provider replaces the older. */
export async function record(q: Queryable, entry: ConflictEntry): Promise<void> {
  const values = { connectionId: entry.connectionId, remoteId: entry.remoteId, fields: entry.fields, runId: entry.runId, foundAt: entry.foundAt };
  await q.insert(providerConflict).values({ diveId: entry.diveId, provider: entry.provider, ...values })
    .onConflictDoUpdate({ target: [providerConflict.diveId, providerConflict.provider], set: values });
}

/** The Dive's entry at the Provider: the remote dive it is about and its fields; null when there is none. */
export async function entryOf(q: Queryable, diveId: string, provider: string): Promise<{ remoteId: string; fields: StoredConflictField[] } | null> {
  const [row] = await q.select({ remoteId: providerConflict.remoteId, fields: providerConflict.fields }).from(providerConflict)
    .where(and(eq(providerConflict.diveId, diveId), eq(providerConflict.provider, provider)));
  return row ? { remoteId: row.remoteId, fields: fieldsOf(row.fields) } : null;
}

/**
 * The fields of the Dive's open entry at the Provider (none when there is no entry). With `remoteId`, only an entry
 * about that remote dive counts: one about a dive no longer the Dive's current one blocks nothing.
 */
export async function openFields(q: Queryable, diveId: string, provider: string, remoteId?: string): Promise<SyncedField[]> {
  const entry = await entryOf(q, diveId, provider);
  if (!entry || (remoteId !== undefined && entry.remoteId !== remoteId)) return [];
  return entry.fields.map((f) => f.field);
}

/** Removes these fields from the Dive's entry at the Provider (the User chose for them); without fields left, the entry. */
export async function closeFields(q: Queryable, diveId: string, provider: string, fields: readonly SyncedField[]): Promise<void> {
  const entry = await entryOf(q, diveId, provider);
  if (!entry || fields.length === 0) return;
  const left = entry.fields.filter((f) => !fields.includes(f.field));
  if (left.length === 0) return close(q, diveId, provider);
  await q.update(providerConflict).set({ fields: left })
    .where(and(eq(providerConflict.diveId, diveId), eq(providerConflict.provider, provider)));
}

/** Removes the Dive's entry at the Provider. */
export async function close(q: Queryable, diveId: string, provider: string): Promise<void> {
  await q.delete(providerConflict).where(and(eq(providerConflict.diveId, diveId), eq(providerConflict.provider, provider)));
}

/** A queue row held because the Provider already has a dive at the Dive's time. */
const isExists = (w: { state: string; reason: string | null }) => w.state === 'held' && w.reason === 'exists';

/** Whether an entry still waits: its Dive is live and its remote dive is still the Dive's current one at that Connection. */
function stillWaits(entry: { remoteId: string; connectionId: string }, d: { deletedAt: Date | null } | undefined, pushes: PushRow[]): boolean {
  const current = currentRemote(pushes);
  return !!d && d.deletedAt === null && current?.remoteId === entry.remoteId && current.connectionId === entry.connectionId;
}

export function createConflictService(deps: { db: Db; connections: ConnectionService; registry: ProviderRegistry; blobs: BlobStore }) {
  const { db, connections, registry } = deps;
  const changes = createDiveChanges({ db, blobs: deps.blobs });

  /** The comparison's context for the Dive's Diver at the Provider, through this Connection if any; no context from the Provider. */
  const contextFor = (userId: string, adapter: ProviderAdapter, conn: Pick<ConnectionRow, 'id' | 'importMode' | 'importWindowMinutes'> | null, diverId: string) =>
    changes.contextOf(db, userId, adapter, {
      diverId, connectionId: conn?.id ?? null, mode: conn?.importMode ?? 'off', windowMinutes: conn?.importWindowMinutes ?? 15, choices: {},
      context: { people: {}, sites: {} },
    });

  /**
   * The entry's fields that still differ, Dive Hub's side said from the Dive as it is now, the Provider's as the run found
   * it. Compared as the send compares (the site by its ID at the stored site Source); an entry stored without comparable
   * values compares the shown ones. A field the comparison no longer covers stays; a Dive `hubSideOf` can't read keeps the
   * stored fields.
   */
  async function stillDiffering(pc: ProviderContext, diveId: string, stored: StoredConflictField[]): Promise<ConflictField[]> {
    const site = stored.find((f) => f.field === 'site')?.compared;
    const here = await changes.hubSideOf(db, pc, diveId, site?.siteSource ?? null, site ? (site.provider as string | null) : null);
    if (!here) return shownFields(stored);
    const left: ConflictField[] = [];
    for (const f of stored) {
      const hub = await changes.shown(pc, f.field, here.hub, here.row.siteId);
      const equal = here.fields.includes(f.field) && (f.compared
        ? sameAtProvider(f.field, { ...here.hub, [f.field]: f.compared.provider } as Comparable, here.hub)
        : JSON.stringify(hub) === JSON.stringify(f.provider));
      if (!equal) left.push({ field: f.field, hub, provider: f.provider });
    }
    return left;
  }

  /** The fields of an entry that wait: none unless its Dive is live and its remote dive current, else those still differing. */
  const waitingFields = async (pc: ProviderContext, e: typeof providerConflict.$inferSelect, d: { deletedAt: Date | null } | undefined, pushes: PushRow[]) =>
    (stillWaits(e, d, pushes) ? stillDiffering(pc, e.diveId, fieldsOf(e.fields)) : []);

  /** The Dives of these ids as "Needs your decision" shows them. */
  const divesOf = (ids: string[]) => db.select({
    id: dive.id, number: dive.number, startsAt: dive.startsAt, utcOffsetSeconds: dive.utcOffsetSeconds,
    utcOffsetSource: dive.utcOffsetSource, durationSeconds: dive.durationSeconds, maxDepthM: dive.maxDepthM,
    siteId: dive.siteId, siteName: diveSite.name, deletedAt: dive.deletedAt,
  }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(inArray(dive.id, ids));
  type ShownDive = Awaited<ReturnType<typeof divesOf>>[number];
  const shown = (d: ShownDive) => ({
    diveId: d.id, number: d.number, startsAt: d.startsAt, utcOffsetSeconds: d.utcOffsetSeconds, utcOffsetSource: d.utcOffsetSource,
    durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, site: siteRef(d.siteId, d.siteName),
  });

  /**
   * For these Connections at once: their Conflict entries, their queue rows held as `exists` or sending, and the Dives and
   * pushes of those entries (pushes per Dive and Provider). Null when no entry waits.
   */
  async function loadWaiting(conns: { id: string; provider: string }[]) {
    const ids = conns.map((c) => c.id);
    const entries = await db.select().from(providerConflict).where(inArray(providerConflict.connectionId, ids));
    const queue = await db.select().from(waitingPush).where(and(inArray(waitingPush.connectionId, ids), or(
      and(eq(waitingPush.state, 'held'), eq(waitingPush.reason, 'exists')), eq(waitingPush.action, 'send'),
    )));
    const diveIds = [...new Set([...entries.map((e) => e.diveId), ...queue.filter(isExists).map((w) => w.diveId)])];
    if (diveIds.length === 0) return null;
    const dives = await divesOf(diveIds);
    const pushes = await db.select().from(push)
      .where(and(inArray(push.diveId, diveIds), inArray(push.provider, [...new Set(conns.map((c) => c.provider))]))).orderBy(desc(push.createdAt), desc(push.id));
    const byDive = new Map<string, PushRow[]>();
    for (const p of pushes) byDive.set(`${p.diveId} ${p.provider}`, [...(byDive.get(`${p.diveId} ${p.provider}`) ?? []), p]);
    return { entries, queue, dives, byDive };
  }

  /** The Connection's Conflict entries that wait; `queued` when a choice was queued after the entry was found. */
  async function waitingConflicts(
    pc: ProviderContext, provider: string, entries: (typeof providerConflict.$inferSelect)[], chosen: Map<string, Date>,
    loaded: { dives: ShownDive[]; byDive: Map<string, PushRow[]> },
  ) {
    const conflicts = [];
    for (const e of entries) {
      const d = loaded.dives.find((x) => x.id === e.diveId);
      const fields = await waitingFields(pc, e, d, loaded.byDive.get(`${e.diveId} ${provider}`) ?? []);
      if (d && fields.length > 0) conflicts.push({ ...shown(d), kind: 'conflict' as const, remoteId: e.remoteId, fields, existing: null, foundAt: e.foundAt,
        queued: (chosen.get(e.diveId)?.getTime() ?? -1) >= e.foundAt.getTime() });
    }
    return conflicts;
  }

  return {
    /**
     * The entries that wait, for each of the User's Connections that has any (no call to a Provider). Two kinds: a
     * `conflict` (fields changed on both sides) and `exists` (the Provider already has a dive at the Dive's time, so the
     * Waiting push is held until the User links to it or creates a new one; `existing` names that dive).
     */
    async waiting(userId: string) {
      // The User's Connections of the Providers this instance offers: the others cannot be acted on. Their entries, queue
      // rows, Dives and pushes are loaded at once; the comparison runs per Connection that has entries.
      const conns = await connections.list(userId);
      const loaded = conns.length === 0 ? null : await loadWaiting(conns);
      if (!loaded) return [];
      const { dives } = loaded;
      const ofConn = <T extends { connectionId: string; provider: string }>(rows: T[], c: (typeof conns)[number]) =>
        rows.filter((r) => r.connectionId === c.id && r.provider === c.provider);
      const out = [];
      for (const c of conns) {
        const entries = ofConn(loaded.entries, c);
        const rows = ofConn(loaded.queue, c);
        const asked = rows.filter(isExists);
        if (entries.length === 0 && asked.length === 0) continue;
        // A choice queued after the Conflict was found: the entry waits for the worker (a newer Conflict is open again).
        const chosen = new Map(rows.filter((w) => w.action === 'send' && Object.keys(w.options.conflicts ?? {}).length > 0).map((w) => [w.diveId, w.changedAt]));
        const conflicts = entries.length === 0 ? [] : await waitingConflicts(await contextFor(userId, registry.get(c.provider), c, c.diverId), c.provider, entries, chosen, loaded);
        const exists = asked.flatMap((e) => {
          const d = dives.find((x) => x.id === e.diveId);
          if (!d || d.deletedAt !== null || !e.detail) return [];
          return [{ ...shown(d), kind: 'exists' as const, remoteId: e.detail.remoteId, fields: [] as ConflictField[], existing: e.detail, foundAt: e.changedAt, queued: false }];
        });
        const listed = [...conflicts, ...exists].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        if (listed.length > 0) out.push({ connectionId: c.id, provider: c.provider, entries: listed });
      }
      return out;
    },

    /** Per run id: how many entries carrying it still wait (the same checks as `waiting`). */
    async waitingByRun(runIds: string[]): Promise<Map<string, number>> {
      const counts = new Map<string, number>();
      if (runIds.length === 0) return counts;
      const entries = await db.select().from(providerConflict).where(inArray(providerConflict.runId, runIds));
      if (entries.length === 0) return counts;
      const ids = entries.map((e) => e.diveId);
      const dives = new Map((await db.select({ id: dive.id, deletedAt: dive.deletedAt }).from(dive).where(inArray(dive.id, ids))).map((d) => [d.id, d]));
      const pushes = await db.select().from(push).where(inArray(push.diveId, ids)).orderBy(desc(push.createdAt), desc(push.id));
      const conns = new Map((await db.select().from(connection).where(inArray(connection.id, entries.map((e) => e.connectionId)))).map((c) => [c.id, c]));
      const offered = new Set(registry.list().map((a) => a.id));
      const contexts = new Map<string, ProviderContext>();
      for (const e of entries) {
        const own = pushes.filter((p) => p.diveId === e.diveId && p.provider === e.provider);
        if (!e.runId || !stillWaits(e, dives.get(e.diveId), own)) continue;
        // An entry at a Provider this instance no longer offers can't be compared: the cheap checks decide.
        const c = conns.get(e.connectionId);
        if (c && offered.has(e.provider)) {
          const pc = contexts.get(c.id) ?? await contextFor(c.userId, registry.get(e.provider), c, c.diverId);
          contexts.set(c.id, pc);
          if ((await stillDiffering(pc, e.diveId, fieldsOf(e.fields))).length === 0) continue;
        }
        counts.set(e.runId, (counts.get(e.runId) ?? 0) + 1);
      }
      return counts;
    },

    /** The Dive's entry about this remote dive at the adapter's Provider, its fields that still differ; null without one or with none left. */
    async ofDive(userId: string, adapter: ProviderAdapter, conn: ConnectionRow | null, diverId: string, diveId: string, remoteId: string): Promise<ConflictField[] | null> {
      const entry = await entryOf(db, diveId, adapter.id);
      if (!entry || entry.remoteId !== remoteId) return null;
      const fields = await stillDiffering(await contextFor(userId, adapter, conn, diverId), diveId, entry.fields);
      return fields.length > 0 ? fields : null;
    },
  };
}

export type ConflictService = ReturnType<typeof createConflictService>;
