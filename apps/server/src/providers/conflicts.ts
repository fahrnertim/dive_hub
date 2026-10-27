// Conflicts with a Provider: a field changed on both sides, differently, found while sending a Dive (ADR 0056). One entry
// per Dive and Provider is stored and waits in "Needs your decision" on the Review page. Like the dives gone at a
// Provider (gone-dives.ts), whether an entry still waits is worked out on reading: its Dive is live and its remote dive
// is still the Dive's current one. The send records, reads and closes entries; nothing here calls a Provider.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { dive, diveSite, providerConflict, push } from '../db/schema.js';
import type { ConnectionService } from './connection-service.js';
import type { ShownValue } from './dive-changes.js';
import { currentRemote, type PushRow } from './remote-state.js';
import type { SyncedField } from './three-way.js';

/** One field on which the two sides differ, both values said as in the import preview. */
export interface ConflictField {
  field: SyncedField;
  hub: ShownValue;
  provider: ShownValue;
}

export interface ConflictEntry {
  diveId: string;
  provider: string;
  connectionId: string;
  remoteId: string;
  fields: ConflictField[];
  runId: string | null;
}

const fieldsOf = (stored: unknown): ConflictField[] => stored as ConflictField[];

/** Stores the Conflict of a Dive at a Provider; a newer one for the same Dive and Provider replaces the older. */
export async function record(q: Db | Tx, entry: ConflictEntry): Promise<void> {
  const values = { connectionId: entry.connectionId, remoteId: entry.remoteId, fields: entry.fields, runId: entry.runId, foundAt: new Date() };
  await q.insert(providerConflict).values({ diveId: entry.diveId, provider: entry.provider, ...values })
    .onConflictDoUpdate({ target: [providerConflict.diveId, providerConflict.provider], set: values });
}

/** The Dive's entry at the Provider: the remote dive it is about and its fields; null when there is none. */
export async function entryOf(q: Db | Tx, diveId: string, provider: string): Promise<{ remoteId: string; fields: ConflictField[] } | null> {
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

export function createConflictService(deps: { db: Db; connections: ConnectionService }) {
  const { db, connections } = deps;
  return {
    /** The entries that wait, for each of the User's Connections that has any (no call to a Provider). */
    async waiting(userId: string) {
      const out = [];
      // The User's Connections of the Providers this instance offers: the others cannot be acted on.
      for (const c of await connections.list(userId)) {
        const entries = await db.select().from(providerConflict)
          .where(and(eq(providerConflict.connectionId, c.id), eq(providerConflict.provider, c.provider)));
        if (entries.length === 0) continue;
        const ids = entries.map((e) => e.diveId);
        const dives = await db.select({
          id: dive.id, number: dive.number, startsAt: dive.startsAt, utcOffsetSeconds: dive.utcOffsetSeconds,
          utcOffsetSource: dive.utcOffsetSource, durationSeconds: dive.durationSeconds, maxDepthM: dive.maxDepthM,
          siteId: dive.siteId, siteName: diveSite.name, deletedAt: dive.deletedAt,
        }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(inArray(dive.id, ids));
        const pushes = await db.select().from(push)
          .where(and(inArray(push.diveId, ids), eq(push.provider, c.provider))).orderBy(desc(push.createdAt), desc(push.id));
        const byDive = new Map<string, PushRow[]>();
        for (const p of pushes) byDive.set(p.diveId, [...(byDive.get(p.diveId) ?? []), p]);
        const listed = entries.flatMap((e) => {
          const d = dives.find((x) => x.id === e.diveId);
          const current = currentRemote(byDive.get(e.diveId) ?? []);
          if (!d || d.deletedAt !== null || current?.remoteId !== e.remoteId || current.connectionId !== c.id) return [];
          return [{
            diveId: d.id, number: d.number, startsAt: d.startsAt, utcOffsetSeconds: d.utcOffsetSeconds, utcOffsetSource: d.utcOffsetSource,
            durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, site: d.siteId && d.siteName !== null ? { id: d.siteId, name: d.siteName } : null,
            remoteId: e.remoteId, fields: fieldsOf(e.fields), foundAt: e.foundAt,
          }];
        }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        if (listed.length > 0) out.push({ connectionId: c.id, provider: c.provider, entries: listed });
      }
      return out;
    },
  };
}

export type ConflictService = ReturnType<typeof createConflictService>;
