// Merging two Dives of one Diver, and moving a Dive to another Diver (ADR 0038, ADR 0016). A merge fills the kept Dive
// from the other, moves the other's links to Providers where the kept one has none, and deletes the other the normal
// way (ADR 0026). A Dive that is linked to a Provider moves as a copy, the old one deleted with its links, so no import
// of the old Diver's makes it again. Links are read as the Pushes say, for any Provider.
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { OVERRIDABLE_FIELDS, dive, diveSite, participant, push, recording, type OverridableField } from '../db/schema.js';
import { OVERLAP_TOLERANCE_SECONDS, alignedForMatching, overlaps } from '../imports/matching.js';
import { currentRemote, type PushRow } from '../providers/push-service.js';
import { liveSite } from '../sites/dive-site-link.js';
import {
  DiveError, applyToDive, attachRecording, lockManagedDive, managedDiverIds, participantsOf,
} from './dive-service.js';
import { valuesOfDive, type DiveValues } from './dive-values.js';
import { writeRevision, type Actor, type Changes } from './revisions.js';

type DiveRow = typeof dive.$inferSelect;

/** The widest UTC offset: a Dive whose offset is unknown keeps a wall-clock time at most this far from its instant. */
const MAX_OFFSET_MS = 14 * 3600_000;
/** Values a Dive may lack; the start and the duration it always has. */
const FILLABLE = ['number', 'maxDepthM', 'avgDepthM', 'waterTemperatureC'] as const satisfies readonly OverridableField[];

/** The Dive's Pushes, newest first, by Provider. */
function byProvider(pushes: PushRow[], diveId: string): Map<string, PushRow[]> {
  const found = new Map<string, PushRow[]>();
  for (const p of pushes) {
    if (p.diveId !== diveId) continue;
    found.set(p.provider, [...(found.get(p.provider) ?? []), p]);
  }
  return found;
}

const pushesOf = (tx: Tx | Db, diveIds: string[]) =>
  tx.select().from(push).where(inArray(push.diveId, diveIds)).orderBy(desc(push.createdAt), desc(push.id));

const liveRecordings = (tx: Tx | Db, diveId: string) =>
  tx.select({ id: recording.id }).from(recording).where(and(eq(recording.diveId, diveId), isNull(recording.deletedAt))).orderBy(recording.startsAt);

/** Of two Dives, the one a merge keeps: the one with a Recording when only one has; else the first. */
const keptOf = <T>(a: T, aRecordings: number, b: T, bRecordings: number): [kept: T, other: T] =>
  (aRecordings === 0 && bRecordings > 0 ? [b, a] : [a, b]);

export function createMerging(db: Db) {
  return {
    /**
     * The Dives of the same Diver this one may be merged with: those overlapping it in time, by the import's own
     * tolerance, compared in local time where an offset is unknown (ADR 0030). With how many Recordings each has, the
     * Providers each is at, and which of the two a merge would keep.
     */
    async candidates(userId: string, diveId: string) {
      const [row] = await db.select().from(dive).where(and(eq(dive.id, diveId), isNull(dive.deletedAt)));
      if (!row || !(await managedDiverIds(db, userId)).has(row.diverId)) throw new DiveError('dive_not_found');
      const reach = (row.durationSeconds + OVERLAP_TOLERANCE_SECONDS) * 1000 + MAX_OFFSET_MS;
      const near = await db.select({ d: dive, siteName: diveSite.name }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
        .where(and(
          eq(dive.diverId, row.diverId), isNull(dive.deletedAt), ne(dive.id, row.id),
          lte(dive.startsAt, new Date(row.startsAt.getTime() + reach)),
          gte(dive.startsAt, new Date(row.startsAt.getTime() - 48 * 3600_000 - MAX_OFFSET_MS)),
        ));
      const aligned = alignedForMatching(row, near.map(({ d, siteName }) => ({ ...d, siteName })));
      const span = { startsAt: row.startsAt, durationSeconds: row.durationSeconds, maxDepthM: undefined };
      const hits = aligned.filter((d) => overlaps(span, { ...d, maxDepthM: undefined }, OVERLAP_TOLERANCE_SECONDS));
      if (hits.length === 0) return [];
      const ids = [row.id, ...hits.map((h) => h.id)];
      const recs = await db.select({ diveId: recording.diveId }).from(recording).where(and(inArray(recording.diveId, ids), isNull(recording.deletedAt)));
      const count = (id: string) => recs.filter((r) => r.diveId === id).length;
      const pushes = await pushesOf(db, ids);
      const at = (id: string) => [...byProvider(pushes, id)].flatMap(([provider, rows]) => {
        const remote = currentRemote(rows);
        return remote ? [{ provider, remoteNumber: remote.remoteNumber }] : [];
      });
      const mine = at(row.id);
      return hits.map((h) => {
        const original = near.find(({ d }) => d.id === h.id)!.d;
        const theirs = at(h.id);
        return {
          dive: original, siteName: h.siteName, recordings: count(h.id), at: theirs,
          keeps: keptOf(row.id, count(row.id), h.id, count(h.id))[0],
          // Where both are at a Provider, the other's dive there stays behind: the client asks whether to delete it there.
          bothAt: theirs.filter((t) => mine.some((m) => m.provider === t.provider)).map((t) => t.provider),
        };
      });
    },

    /**
     * Merges two Dives of one Diver into one (ADR 0038) and answers which was kept: the one with a Recording when only
     * one has, else the first. The kept Dive gets the other's Recordings, fills its gaps from it (site, Participants,
     * values; the other's notes are appended), and takes its link at every Provider where it has none itself. The other
     * is deleted like any Dive, naming the kept one. One transaction.
     */
    async merge(userId: string, first: { id: string; version: number }, second: { id: string; version: number }): Promise<{ kept: string; merged: string }> {
      if (first.id === second.id) throw new DiveError('merge_not_possible');
      return db.transaction(async (tx) => {
        // Locked in the order of their ids, so two merges of the same pair can't wait for each other.
        const locked = new Map<string, DiveRow>();
        for (const id of [first.id, second.id].sort()) locked.set(id, await lockManagedDive(tx, userId, id));
        const a = locked.get(first.id)!;
        const b = locked.get(second.id)!;
        if (a.version !== first.version || b.version !== second.version) throw new DiveError('dive_changed');
        if (a.diverId !== b.diverId) throw new DiveError('merge_not_possible');
        const [kept, other] = keptOf(a, (await liveRecordings(tx, a.id)).length, b, (await liveRecordings(tx, b.id)).length);
        const actor: Actor = { type: 'user', id: userId };

        // The other's Recordings first: which becomes primary is attaching's rule (ADR 0016, 0030). Each is a Recording
        // added in the history; the merge itself is one entry after them.
        for (const rec of await liveRecordings(tx, other.id)) await attachRecording(tx, kept.id, rec.id, actor, 'attach');

        const extra: Changes = { mergedFrom: { from: null, to: other.id } };
        const before = await participantsOf(tx, kept.id);
        const added = (await participantsOf(tx, other.id)).filter((p) => p.diverId !== kept.diverId && !before.some((k) => k.diverId === p.diverId));
        if (added.length > 0) {
          await tx.insert(participant).values(added.map((p) => ({ diveId: kept.id, diverId: p.diverId, role: p.role })));
          extra.participants = { from: before, to: await participantsOf(tx, kept.id) };
        }

        const moved = await moveLinks(tx, userId, kept.id, other.id);
        if (moved.length > 0) extra.providers = { from: [], to: moved };

        const [current] = await tx.select().from(dive).where(eq(dive.id, kept.id));
        const values: DiveValues = valuesOfDive(current!);
        const theirs = valuesOfDive(other);
        const overrides = new Set(current!.overrides);
        for (const field of FILLABLE) {
          if (values[field] !== null || theirs[field] === null) continue;
          values[field] = theirs[field];
          // Beside a Recording the value is one set by hand, or the next refresh from the Recording would drop it.
          if (current!.primaryRecordingId) overrides.add(field);
        }
        const own = current!.notes?.trim() ?? '';
        const more = other.notes?.trim() ?? '';
        const notes = !more || own === more ? current!.notes : own ? `${own}\n\n${more}` : more;
        const siteId = current!.siteId ?? (other.siteId && (await liveSite(tx, other.siteId)) ? other.siteId : null);
        await applyToDive(tx, current!, {
          values, overrides: OVERRIDABLE_FIELDS.filter((f) => overrides.has(f)), notes, primaryRecordingId: current!.primaryRecordingId, siteId,
        }, actor, 'merge', extra);

        const at = new Date();
        await tx.update(dive).set({ deletedAt: at, primaryRecordingId: null, version: sql`${dive.version} + 1`, updatedAt: at }).where(eq(dive.id, other.id));
        await writeRevision(tx, 'dive', other.id, actor, 'merge', {
          deletedAt: { from: null, to: at.toISOString() }, mergedInto: { from: null, to: kept.id },
        });
        return { kept: kept.id, merged: other.id };
      });
    },

    /**
     * Files a Dive under another Diver the User manages (ADR 0016) and answers the Dive's id there. A Dive linked to a
     * Provider moves as a copy (ADR 0038): the copy takes the Recordings, the old Dive is deleted and keeps its links, so
     * the old Diver's imports skip the entry instead of making the Dive again.
     */
    async move(userId: string, diveId: string, diverId: string, version: number): Promise<string> {
      return db.transaction(async (tx) => {
        const current = await lockManagedDive(tx, userId, diveId);
        if (current.version !== version) throw new DiveError('dive_changed');
        if (!(await managedDiverIds(tx, userId)).has(diverId)) throw new DiveError('diver_not_found');
        if (diverId === current.diverId) return diveId;
        const actor: Actor = { type: 'user', id: userId };
        const linked = [...byProvider(await pushesOf(tx, [diveId]), diveId).values()].some((rows) => currentRemote(rows));
        if (!linked) {
          await tx.update(dive).set({ diverId, version: sql`${dive.version} + 1`, updatedAt: new Date() }).where(eq(dive.id, diveId));
          await writeRevision(tx, 'dive', diveId, actor, 'move', { diverId: { from: current.diverId, to: diverId } });
          return diveId;
        }
        const { id: _id, version: _version, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, ...rest } = current;
        const [copy] = await tx.insert(dive).values({ ...rest, diverId }).returning({ id: dive.id });
        // The Recordings go across before the delete, or they would be deleted with the old Dive and their keys refused.
        await tx.update(recording).set({ diveId: copy!.id, updatedAt: new Date() }).where(and(eq(recording.diveId, diveId), isNull(recording.deletedAt)));
        const others = (await participantsOf(tx, diveId)).filter((p) => p.diverId !== diverId);
        if (others.length > 0) await tx.insert(participant).values(others.map((p) => ({ diveId: copy!.id, diverId: p.diverId, role: p.role })));
        await writeRevision(tx, 'dive', copy!.id, actor, 'move', {
          diverId: { from: current.diverId, to: diverId }, movedFrom: { from: null, to: diveId },
        });
        const at = new Date();
        await tx.update(dive).set({ deletedAt: at, primaryRecordingId: null, version: sql`${dive.version} + 1`, updatedAt: at }).where(eq(dive.id, diveId));
        await writeRevision(tx, 'dive', diveId, actor, 'move', {
          deletedAt: { from: null, to: at.toISOString() }, movedTo: { from: null, to: copy!.id },
        });
        return copy!.id;
      });
    },
  };
}

/**
 * Moves the other Dive's links to the kept Dive, Provider by Provider (ADR 0038): where the other has a remote dive
 * and the kept Dive has none, the other's Pushes there become the kept Dive's, so what Dive Hub sent and saw stays
 * with the link. Where both have one, the other's stays behind on the Dive that is deleted.
 */
async function moveLinks(tx: Tx, userId: string, keptId: string, otherId: string) {
  const pushes = await pushesOf(tx, [keptId, otherId]);
  const mine = byProvider(pushes, keptId);
  const moved: { provider: string; remoteId: string; remoteNumber: number | null }[] = [];
  for (const [provider, rows] of byProvider(pushes, otherId)) {
    const remote = currentRemote(rows);
    if (!remote || currentRemote(mine.get(provider) ?? [])) continue;
    await tx.update(push).set({ diveId: keptId }).where(and(eq(push.diveId, otherId), eq(push.provider, provider)));
    // Older Pushes of the kept Dive there (a remote dive deleted since) may be newer than the link that came across.
    const now = (await pushesOf(tx, [keptId])).filter((p) => p.provider === provider);
    if (currentRemote(now)?.remoteId !== remote.remoteId) {
      const [{ version }] = await tx.select({ version: dive.version }).from(dive).where(eq(dive.id, keptId)) as [{ version: number }];
      await tx.insert(push).values({
        diveId: keptId, connectionId: remote.connectionId, userId, provider, mode: remote.mode, action: 'link', state: 'confirmed',
        remoteId: remote.remoteId, remoteNumber: remote.remoteNumber, diveVersion: version,
      });
    }
    moved.push({ provider, remoteId: remote.remoteId!, remoteNumber: remote.remoteNumber });
  }
  return moved;
}

export type Merging = ReturnType<typeof createMerging>;
