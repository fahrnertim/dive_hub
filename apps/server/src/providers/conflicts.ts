// Conflicts with a Provider: a field changed on both sides, differently, found while sending a Dive (ADR 0056). One entry
// per Dive and Provider is stored and waits in "Needs your decision" on the Review page. Like the dives gone at a
// Provider (gone-dives.ts), whether an entry still waits is worked out on reading: its Dive is live and its remote dive
// is still the Dive's current one. The send records, reads and closes entries; nothing here calls a Provider.
// Two ways in: the send uses the bare functions (`record`, `entryOf`, `openFields`, `closeFields`, `close`) with its own
// `Db | Tx`, inside its own flow, so they need nothing but a query handle; the routes' read side is `createConflictService`,
// which also needs the User's Connections.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { dive, diveSite, providerConflict, push, waitingPush } from '../db/schema.js';
import type { ConnectionService } from './connection-service.js';
import type { ShownValue } from './dive-changes.js';
import { currentRemote, type PushRow } from './remote-state.js';
import type { Comparable, SyncedField } from './three-way.js';
import type { SiteSource } from '../sites/sources.js';

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
}

const fieldsOf = (stored: unknown): StoredConflictField[] => stored as StoredConflictField[];

/** What the API says of a field: the shown values only. */
const shownFields = (fields: StoredConflictField[]): ConflictField[] => fields.map(({ field, hub, provider }) => ({ field, hub, provider }));

/** Stores the Conflict of a Dive at a Provider; a newer one for the same Dive and Provider replaces the older. */
export async function record(q: Db | Tx, entry: ConflictEntry): Promise<void> {
  const values = { connectionId: entry.connectionId, remoteId: entry.remoteId, fields: entry.fields, runId: entry.runId, foundAt: new Date() };
  await q.insert(providerConflict).values({ diveId: entry.diveId, provider: entry.provider, ...values })
    .onConflictDoUpdate({ target: [providerConflict.diveId, providerConflict.provider], set: values });
}

/** The Dive's entry at the Provider: the remote dive it is about and its fields; null when there is none. */
export async function entryOf(q: Db | Tx, diveId: string, provider: string): Promise<{ remoteId: string; fields: StoredConflictField[] } | null> {
  const [row] = await q.select({ remoteId: providerConflict.remoteId, fields: providerConflict.fields }).from(providerConflict)
    .where(and(eq(providerConflict.diveId, diveId), eq(providerConflict.provider, provider)));
  return row ? { remoteId: row.remoteId, fields: fieldsOf(row.fields) } : null;
}

/**
 * The fields of the Dive's open entry at the Provider (none when there is no entry). With `remoteId`, only an entry
 * about that remote dive counts: one about a dive no longer the Dive's current one blocks nothing.
 */
export async function openFields(q: Db | Tx, diveId: string, provider: string, remoteId?: string): Promise<SyncedField[]> {
  const entry = await entryOf(q, diveId, provider);
  if (!entry || (remoteId !== undefined && entry.remoteId !== remoteId)) return [];
  return entry.fields.map((f) => f.field);
}

/** Removes these fields from the Dive's entry at the Provider (the User chose for them); without fields left, the entry. */
export async function closeFields(q: Db | Tx, diveId: string, provider: string, fields: readonly SyncedField[]): Promise<void> {
  const entry = await entryOf(q, diveId, provider);
  if (!entry || fields.length === 0) return;
  const left = entry.fields.filter((f) => !fields.includes(f.field));
  if (left.length === 0) return close(q, diveId, provider);
  await q.update(providerConflict).set({ fields: left })
    .where(and(eq(providerConflict.diveId, diveId), eq(providerConflict.provider, provider)));
}

/** Removes the Dive's entry at the Provider. */
export async function close(q: Db | Tx, diveId: string, provider: string): Promise<void> {
  await q.delete(providerConflict).where(and(eq(providerConflict.diveId, diveId), eq(providerConflict.provider, provider)));
}

/** Whether an entry still waits: its Dive is live and its remote dive is still the Dive's current one at that Connection. */
function stillWaits(entry: { remoteId: string; connectionId: string }, d: { deletedAt: Date | null } | undefined, pushes: PushRow[]): boolean {
  const current = currentRemote(pushes);
  return !!d && d.deletedAt === null && current?.remoteId === entry.remoteId && current.connectionId === entry.connectionId;
}

/** Per run id: how many entries carrying it still wait (as "Needs your decision" lists them). */
export async function waitingByRun(q: Db | Tx, runIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (runIds.length === 0) return counts;
  const entries = await q.select().from(providerConflict).where(inArray(providerConflict.runId, runIds));
  if (entries.length === 0) return counts;
  const ids = entries.map((e) => e.diveId);
  const dives = new Map((await q.select({ id: dive.id, deletedAt: dive.deletedAt }).from(dive).where(inArray(dive.id, ids))).map((d) => [d.id, d]));
  const pushes = await q.select().from(push).where(inArray(push.diveId, ids)).orderBy(desc(push.createdAt), desc(push.id));
  for (const e of entries) {
    const own = pushes.filter((p) => p.diveId === e.diveId && p.provider === e.provider);
    if (e.runId && stillWaits(e, dives.get(e.diveId), own)) counts.set(e.runId, (counts.get(e.runId) ?? 0) + 1);
  }
  return counts;
}

export function createConflictService(deps: { db: Db; connections: ConnectionService }) {
  const { db, connections } = deps;
  return {
    /**
     * The entries that wait, for each of the User's Connections that has any (no call to a Provider). Two kinds: a
     * `conflict` (fields changed on both sides) and `exists` (the Provider already has a dive at the Dive's time, so the
     * Waiting push is held until the User links to it or creates a new one; `existing` names that dive).
     */
    async waiting(userId: string) {
      const out = [];
      // The User's Connections of the Providers this instance offers: the others cannot be acted on.
      for (const c of await connections.list(userId)) {
        const entries = await db.select().from(providerConflict)
          .where(and(eq(providerConflict.connectionId, c.id), eq(providerConflict.provider, c.provider)));
        const asked = await db.select().from(waitingPush).where(and(
          eq(waitingPush.connectionId, c.id), eq(waitingPush.provider, c.provider), eq(waitingPush.state, 'held'), eq(waitingPush.reason, 'exists'),
        ));
        if (entries.length === 0 && asked.length === 0) continue;
        // A choice queued after the Conflict was found: the entry waits for the worker (a newer Conflict is open again).
        const chosen = new Map((await db.select().from(waitingPush).where(and(
          eq(waitingPush.connectionId, c.id), eq(waitingPush.provider, c.provider), eq(waitingPush.action, 'send'), eq(waitingPush.state, 'waiting'),
        ))).filter((w) => Object.keys(w.options.conflicts ?? {}).length > 0).map((w) => [w.diveId, w.changedAt]));
        const ids = [...entries.map((e) => e.diveId), ...asked.map((e) => e.diveId)];
        const dives = await db.select({
          id: dive.id, number: dive.number, startsAt: dive.startsAt, utcOffsetSeconds: dive.utcOffsetSeconds,
          utcOffsetSource: dive.utcOffsetSource, durationSeconds: dive.durationSeconds, maxDepthM: dive.maxDepthM,
          siteId: dive.siteId, siteName: diveSite.name, deletedAt: dive.deletedAt,
        }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(inArray(dive.id, ids));
        const pushes = await db.select().from(push)
          .where(and(inArray(push.diveId, ids), eq(push.provider, c.provider))).orderBy(desc(push.createdAt), desc(push.id));
        const byDive = new Map<string, PushRow[]>();
        for (const p of pushes) byDive.set(p.diveId, [...(byDive.get(p.diveId) ?? []), p]);
        const shown = (d: (typeof dives)[number]) => ({
          diveId: d.id, number: d.number, startsAt: d.startsAt, utcOffsetSeconds: d.utcOffsetSeconds, utcOffsetSource: d.utcOffsetSource,
          durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, site: d.siteId && d.siteName !== null ? { id: d.siteId, name: d.siteName } : null,
        });
        const conflicts = entries.flatMap((e) => {
          const d = dives.find((x) => x.id === e.diveId);
          if (!d || !stillWaits(e, d, byDive.get(e.diveId) ?? [])) return [];
          return [{ ...shown(d), kind: 'conflict' as const, remoteId: e.remoteId, fields: shownFields(fieldsOf(e.fields)), existing: null, foundAt: e.foundAt,
            queued: (chosen.get(e.diveId)?.getTime() ?? -1) >= e.foundAt.getTime() }];
        });
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
  };
}

export type ConflictService = ReturnType<typeof createConflictService>;
