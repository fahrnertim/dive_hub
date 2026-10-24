// Conflicts with a Provider: a field changed on both sides, differently, found while sending a Dive (ADR 0056). One entry
// per Dive and Provider is stored and waits in "Needs your decision" on the Review page. Like the dives gone at a
// Provider (gone-dives.ts), whether an entry still waits is worked out on reading: its Dive is live and its remote dive
// is still the Dive's current one. The send records, reads and closes entries; nothing here calls a Provider.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { connection, dive, diveSite, providerConflict, push } from '../db/schema.js';
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

/** Stores the Conflict of a Dive at a Provider; a newer one for the same Dive and Provider replaces the older. */
export async function record(q: Db | Tx, entry: ConflictEntry): Promise<void> {
  const values = { connectionId: entry.connectionId, remoteId: entry.remoteId, fields: entry.fields, runId: entry.runId, foundAt: new Date() };
  await q.insert(providerConflict).values({ diveId: entry.diveId, provider: entry.provider, ...values })
    .onConflictDoUpdate({ target: [providerConflict.diveId, providerConflict.provider], set: values });
}

/** The fields of the Dive's open entry at the Provider (none when there is no entry). */
export async function openFields(q: Db | Tx, diveId: string, provider: string): Promise<SyncedField[]> {
  const rows = await q.select({ fields: providerConflict.fields }).from(providerConflict)
    .where(and(eq(providerConflict.diveId, diveId), eq(providerConflict.provider, provider)));
  return ((rows[0]?.fields ?? []) as ConflictField[]).map((f) => f.field);
}

/** Removes the Dive's entry at the Provider. */
export async function close(q: Db | Tx, diveId: string, provider: string): Promise<void> {
  await q.delete(providerConflict).where(and(eq(providerConflict.diveId, diveId), eq(providerConflict.provider, provider)));
}

export function createConflictService(deps: { db: Db }) {
  const { db } = deps;
  return {
    /** The entries that wait, for each of the User's Connections that has any (no call to a Provider). */
    async waiting(userId: string) {
      const connections = await db.select({ id: connection.id, provider: connection.provider, diverId: connection.diverId })
        .from(connection).where(eq(connection.userId, userId)).orderBy(connection.createdAt);
      const out = [];
      for (const c of connections) {
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
            remoteId: e.remoteId, fields: e.fields as ConflictField[], foundAt: e.foundAt,
          }];
        }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        if (listed.length > 0) out.push({ connectionId: c.id, provider: c.provider, entries: listed });
      }
      return out;
    },
  };
}

export type ConflictService = ReturnType<typeof createConflictService>;
