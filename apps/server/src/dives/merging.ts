// Merging two Dives of one Diver, and moving a Dive to another Diver (ADR 0038, ADR 0016). A merge fills the kept Dive
// from the other, moves the other's links to Providers where the kept one has none, and deletes the other the normal
// way (ADR 0026). A Dive that is linked to a Provider moves as a copy, the old one deleted with its links, so no import
// of the old Diver's makes it again. Links are read as the Pushes say, for any Provider.
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { Db, Queryable, Tx } from '../db/client.js';
import { OVERRIDABLE_FIELDS, dive, diveSite, participant, push, recording, type OverridableField } from '../db/schema.js';
import { DAY_MS, MAX_OFFSET_MS, OVERLAP_TOLERANCE_SECONDS, localStartMs } from '../imports/matching.js';
import { currentRemote, type PushRow } from '../providers/remote-state.js';
import { deletingItself } from '../providers/waiting-push-queue.js';
import { liveSite } from '../sites/dive-site-link.js';
import {
  DiveError, applyToDive, attachRecording, lockManagedDive, participantsOf,
} from './dive-service.js';
import { managedDiverIds } from '../divers/management.js';
import { valuesOfDive, type DiveValues } from './dive-values.js';
import type { LogbookChecks } from './logbook-checks.js';
import { takeCylinders } from './cylinders.js';
import { takeWeighting } from './weighting.js';
import { changeListener, writeRevision, type Actor, type Changes } from './revisions.js';
import { renumber } from './dive-numbers.js';

type DiveRow = typeof dive.$inferSelect;

/** Values a Dive may lack; the start and the duration it always has. */
const FILLABLE = ['maxDepthM', 'avgDepthM', 'waterTemperatureC'] as const satisfies readonly OverridableField[];

/** The Dive's Pushes, newest first, by Provider. */
function byProvider(pushes: PushRow[], diveId: string): Map<string, PushRow[]> {
  const found = new Map<string, PushRow[]>();
  for (const p of pushes) {
    if (p.diveId !== diveId) continue;
    found.set(p.provider, [...(found.get(p.provider) ?? []), p]);
  }
  return found;
}

const pushesOf = (tx: Queryable, diveIds: string[]) =>
  tx.select().from(push).where(inArray(push.diveId, diveIds)).orderBy(desc(push.createdAt), desc(push.id));

const liveRecordings = (tx: Queryable, diveId: string) =>
  tx.select({ id: recording.id }).from(recording).where(and(eq(recording.diveId, diveId), isNull(recording.deletedAt))).orderBy(recording.startsAt);

/** Of two Dives, the one a merge keeps: the one with a Recording when only one has; else the first. */
const keptOf = <T>(a: T, aRecordings: number, b: T, bRecordings: number): [kept: T, other: T] =>
  (aRecordings === 0 && bRecordings > 0 ? [b, a] : [a, b]);

/**
 * The other Dives of the Diver near this one, with their site's name: up to two local days and both offsets away either
 * way, or the Dive's length and the tolerance where that reaches further. The same local day is a check too
 * (entry_apart_from_recording), and nearby is the day before to the day after.
 */
function nearbyDives(db: Queryable, row: DiveRow) {
  const reach = Math.max((row.durationSeconds + OVERLAP_TOLERANCE_SECONDS) * 1000 + MAX_OFFSET_MS, 2 * DAY_MS + 2 * MAX_OFFSET_MS);
  return db.select({ d: dive, siteName: diveSite.name }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
    .where(and(
      eq(dive.diverId, row.diverId), isNull(dive.deletedAt), ne(dive.id, row.id),
      lte(dive.startsAt, new Date(row.startsAt.getTime() + reach)),
      gte(dive.startsAt, new Date(row.startsAt.getTime() - 2 * DAY_MS - 2 * MAX_OFFSET_MS)),
    )).orderBy(dive.startsAt, dive.id);
}

type Participant = Awaited<ReturnType<typeof participantsOf>>[number];

/** The other's Participants the kept Dive lacks: not its own Diver, nor one it has already. */
const addedParticipants = (kept: Participant[], theirs: Participant[], diverId: string) =>
  theirs.filter((p) => p.diverId !== diverId && !kept.some((k) => k.diverId === p.diverId));

/**
 * The kept Dive's values with its gaps filled from the other's, and its overrides: beside a Recording a filled value is
 * one set by hand, or the next refresh from the Recording would drop it.
 */
function fillValues(current: DiveRow, other: DiveRow): { values: DiveValues; overrides: OverridableField[] } {
  const values: DiveValues = valuesOfDive(current);
  const theirs = valuesOfDive(other);
  const overrides = new Set(current.overrides);
  for (const field of FILLABLE) {
    if (values[field] !== null || theirs[field] === null) continue;
    values[field] = theirs[field];
    if (current.primaryRecordingId) overrides.add(field);
  }
  return { values, overrides: OVERRIDABLE_FIELDS.filter((f) => overrides.has(f)) };
}

/** The kept Dive's notes with the other's appended, unless they are empty or the same. */
function mergeNotes(kept: string | null, other: string | null): string | null {
  const own = kept?.trim() ?? '';
  const more = other?.trim() ?? '';
  return !more || own === more ? kept : own ? `${own}\n\n${more}` : more;
}

export function createMerging(db: Db, checks: LogbookChecks) {
  return {
    /**
     * The Dives of the same Diver this one breaks a rule of the logbook checks with (ADR 0038): at the same time, as the
     * checks see it. With how many Recordings each has, the Providers each is at, which of the two a merge would keep,
     * and whether the User answered that they are two dives. `nearby` lists instead every Dive of the Diver from the
     * local day before to the day after, with the rule where there is one: the Dives to choose from for a merge by hand.
     */
    async mergeCandidates(userId: string, diveId: string, scope: 'rule' | 'nearby' = 'rule') {
      const [row] = await db.select().from(dive).where(and(eq(dive.id, diveId), isNull(dive.deletedAt)));
      if (!row || !(await managedDiverIds(db, userId)).has(row.diverId)) throw new DiveError('dive_not_found');
      const near = await nearbyDives(db, row);
      if (near.length === 0) return [];
      const all = [row.id, ...near.map(({ d }) => d.id)];
      const recs = await db.select({ diveId: recording.diveId }).from(recording).where(and(inArray(recording.diveId, all), isNull(recording.deletedAt)));
      const count = (id: string) => recs.filter((r) => r.diveId === id).length;
      const found = await checks.against(row.id, near.map(({ d }) => ({ ...d, recordings: count(d.id) })), { ...row, recordings: count(row.id) });
      const localDay = (d: DiveRow) => Math.floor(localStartMs(d) / DAY_MS);
      const hits = near
        .map(({ d, siteName }) => ({ d, siteName, hit: found.find((f) => f.other.id === d.id) }))
        .filter(({ d, hit }) => (scope === 'nearby' ? Math.abs(localDay(d) - localDay(row)) <= 1 : hit !== undefined))
        .map(({ d, siteName, hit }) => ({ id: d.id, rule: hit?.rule ?? null, answered: hit?.answered ?? false, siteName }));
      if (hits.length === 0) return [];
      const pushes = await pushesOf(db, [row.id, ...hits.map((h) => h.id)]);
      const at = (id: string) => [...byProvider(pushes, id)].flatMap(([provider, rows]) => {
        const remote = currentRemote(rows);
        return remote ? [{ provider, remoteNumber: remote.remoteNumber }] : [];
      });
      const mine = at(row.id);
      const itself = await deletingItself(db, [row.id, ...hits.map((h) => h.id)]);
      return hits.map((h) => {
        const original = near.find(({ d }) => d.id === h.id)!.d;
        const theirs = at(h.id);
        const keeps = keptOf(row.id, count(row.id), h.id, count(h.id))[0];
        const bothAt = theirs.filter((t) => mine.some((m) => m.provider === t.provider)).map((t) => t.provider);
        return {
          dive: original, siteName: h.siteName, recordings: count(h.id), at: theirs, rule: h.rule, answered: h.answered,
          keeps,
          // Where both are at a Provider, the other's dive there stays behind: the client asks whether to delete it there,
          // unless the Dive left behind is deleted there by the queue (its Connection's setting), 5 minutes after the merge.
          bothAt,
          deletesItself: bothAt.filter((provider) => itself.get(keeps === row.id ? h.id : row.id)?.has(provider)),
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
        // Its Cylinders before them, so that a tank pod's data makes none beside the ones the other Dive has (ADR 0045).
        const cylinders = await takeCylinders(tx, kept.id, other.id);
        for (const rec of await liveRecordings(tx, other.id)) await attachRecording(tx, kept.id, rec.id, actor, 'attach');

        const extra: Changes = { mergedFrom: { from: null, to: other.id }, ...cylinders };
        const before = await participantsOf(tx, kept.id);
        const added = addedParticipants(before, await participantsOf(tx, other.id), kept.diverId);
        if (added.length > 0) {
          await tx.insert(participant).values(added.map((p) => ({ diveId: kept.id, diverId: p.diverId, role: p.role })));
          extra.participants = { from: before, to: await participantsOf(tx, kept.id) };
        }

        const moved = await moveLinks(tx, userId, kept.id, other.id);
        if (moved.length > 0) extra.providers = { from: [], to: moved };

        const [current] = await tx.select().from(dive).where(eq(dive.id, kept.id));
        Object.assign(extra, await takeWeighting(tx, current!, other));
        const siteId = current!.siteId ?? (other.siteId && (await liveSite(tx, other.siteId)) ? other.siteId : null);
        await applyToDive(tx, current!, {
          ...fillValues(current!, other), notes: mergeNotes(current!.notes, other.notes), primaryRecordingId: current!.primaryRecordingId, siteId,
        }, actor, 'merge', extra);

        const at = new Date();
        await tx.update(dive).set({ deletedAt: at, primaryRecordingId: null, version: sql`${dive.version} + 1`, updatedAt: at }).where(eq(dive.id, other.id));
        await writeRevision(tx, 'dive', other.id, actor, 'merge', {
          deletedAt: { from: null, to: at.toISOString() }, mergedInto: { from: null, to: kept.id },
        });
        // The Revision's cause is `merge`, which the queue doesn't read as a delete: told so, the copy at a Provider whose
        // Connection deletes by itself goes after the quiet period, and restoring the Dive cancels it.
        await changeListener().diveChanged(tx, other.id, 'delete', at, actor);
        await renumber(tx, [kept.diverId]);
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
          await renumber(tx, [current.diverId, diverId]);
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
        await renumber(tx, [current.diverId, diverId]);
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
