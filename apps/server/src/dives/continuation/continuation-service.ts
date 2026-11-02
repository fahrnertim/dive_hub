// Appending later Dives to the earlier one (ADR 0063): one Dive of the Diver's, whose Primary recording joins the parts'
// Recordings with a Surface break between each two. The later Dives go as in a merge (ADR 0038): the kept Dive is
// filled from each, takes its link at a Provider where it has none, and each is deleted the normal way (ADR 0026).
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, notInArray } from 'drizzle-orm';
import type { Db, Queryable, Tx } from '../../db/client.js';
import {
  continuationAppend, cylinder, dive, diveSite, diverManagement, participant, push, recording, sampleSeries,
} from '../../db/schema.js';
import { managesDiveDiver } from '../../divers/management.js';
import { liveSite } from '../../sites/dive-site-link.js';
import { keepApart } from '../checks/logbook-check-answers.js';
import { cylindersOf, takeCylinders } from '../cylinders.js';
import { renumber } from '../dive-numbers.js';
import {
  DiveError, applyToDive, followPrimary, lockManagedDive, nextVersion, participantsOf, undelete,
} from '../dive-service.js';
import {
  addedParticipants, deleteLeftBehind, fillValues, mergeNotes, moveLinks, type ProviderLinks,
} from '../merging-service.js';
import { changeListener, userActor, writeRevision, type Actor, type Changes } from '../revisions.js';
import { takeWeighting } from '../weighting.js';
import { isJoined } from '../recording-units.js';
import { buildJoined, partsOfJoined, rebuildJoined } from './joined-recording.js';

type DiveRow = typeof dive.$inferSelect;
type RecordingRow = typeof recording.$inferSelect;
type AppendRow = typeof continuationAppend.$inferSelect;

/** A Dive's unit: its one Recording, or its joined Recording with nothing but its parts beside it; null otherwise. */
async function unitOf(q: Queryable, diveId: string): Promise<RecordingRow | null> {
  const live = await q.select().from(recording).where(and(eq(recording.diveId, diveId), isNull(recording.deletedAt)));
  const joined = live.filter(isJoined);
  if (joined.length === 0) return live.length === 1 ? live[0]! : null;
  const [unit] = joined;
  return joined.length === 1 && live.every((r) => r === unit || r.joinedRecordingId === unit!.id) ? unit! : null;
}

const endOf = (r: RecordingRow) => r.startsAt.getTime() + r.durationSeconds * 1000;

/** Whether `later`, a Dive's one Recording, may follow `before`: the same Device, starting after it ends. */
const follows = (before: RecordingRow, later: RecordingRow | null): later is RecordingRow =>
  !!later && !isJoined(later) && !!before.deviceId && later.deviceId === before.deviceId
  && later.startsAt.getTime() > endOf(before);

/**
 * The append's preconditions (ADR 0063), on the locked Dives: one Diver; the kept Dive's unit one Recording or a joined
 * one; each later Dive with exactly one Recording of the same Device, starting after the one before ends; no other Dive
 * of the Diver starting between them. No time limit. Answers the kept Dive's unit and each later Dive's Recording.
 */
async function preconditions(tx: Tx, kept: DiveRow, laters: DiveRow[]): Promise<{ unit: RecordingRow; recs: RecordingRow[] }> {
  const refuse = () => new DiveError('continuation_not_possible');
  if (laters.some((l) => l.diverId !== kept.diverId)) throw refuse();
  const unit = await unitOf(tx, kept.id);
  if (!unit) throw refuse();
  const recs: RecordingRow[] = [];
  for (const later of laters) {
    const rec = await unitOf(tx, later.id);
    if (!follows(recs.at(-1) ?? unit, rec)) throw refuse();
    recs.push(rec);
  }
  const [between] = await tx.select({ id: dive.id }).from(dive).where(and(
    eq(dive.diverId, kept.diverId), isNull(dive.deletedAt), notInArray(dive.id, [kept.id, ...laters.map((l) => l.id)]),
    gt(dive.startsAt, kept.startsAt), lt(dive.startsAt, laters.at(-1)!.startsAt),
  )).limit(1);
  if (between) throw refuse();
  return { unit, recs };
}

/** The Providers a Dive is at now, by its Pushes. */
async function providersAt(q: Queryable, currentRemote: ProviderLinks['currentRemote'], diveId: string): Promise<string[]> {
  const rows = await q.select().from(push).where(eq(push.diveId, diveId)).orderBy(desc(push.createdAt), desc(push.id));
  return [...new Set(rows.map((r) => r.provider))].filter((provider) => currentRemote(rows.filter((r) => r.provider === provider)));
}

/** Cylinders tied to a part's series are tied to the joined Recording's series of the same channel. */
async function tieToJoined(tx: Tx, keptId: string, partIds: string[], joinedId: string): Promise<Changes> {
  const before = await cylindersOf(tx, keptId);
  const tied = await tx.update(cylinder).set({ recordingId: joinedId })
    .where(and(eq(cylinder.diveId, keptId), inArray(cylinder.recordingId, partIds))).returning({ position: cylinder.position });
  return tied.length === 0 ? {} : { cylinders: { from: before, to: await cylindersOf(tx, keptId) } };
}

/** The live append that took this Dive: its Recording is a part that came from it, in an append that kept another Dive. */
async function taking(q: Queryable, diveId: string): Promise<{ appendId: string } | null> {
  const [row] = await q.select({ appendId: continuationAppend.id }).from(recording)
    .innerJoin(continuationAppend, eq(continuationAppend.id, recording.appendId))
    .where(and(eq(recording.fromDiveId, diveId), ne(continuationAppend.keptDiveId, diveId))).limit(1);
  return row ?? null;
}

/** What undoing this append reverses (ADR 0063): it and every later append to its joined Recording, newest first. */
async function undoneWith(q: Queryable, appendId: string): Promise<AppendRow[]> {
  const [first] = await q.select().from(continuationAppend).where(eq(continuationAppend.id, appendId));
  if (!first) return [];
  return q.select().from(continuationAppend)
    .where(and(eq(continuationAppend.joinedRecordingId, first.joinedRecordingId), gte(continuationAppend.createdAt, first.createdAt)))
    .orderBy(desc(continuationAppend.createdAt), desc(continuationAppend.id));
}

/** The parts these appends took from other Dives (not the kept Dive's own first part), each going back to `fromDiveId`. */
async function takenParts(q: Queryable, appends: AppendRow[]): Promise<RecordingRow[]> {
  const rows = await q.select().from(recording).where(inArray(recording.appendId, appends.map((a) => a.id)));
  return rows.filter((r) => r.fromDiveId !== appends.find((a) => a.id === r.appendId)!.keptDiveId);
}

const channelsOf = async (q: Queryable, recordingIds: string[]) => recordingIds.length === 0 ? [] : (await q
  .selectDistinct({ channel: sampleSeries.channel }).from(sampleSeries).where(inArray(sampleSeries.recordingId, recordingIds))).map((s) => s.channel);

/**
 * Cylinders tied to the joined Recording's series of a channel no staying part has go back with the part to its Dive,
 * tied to the part, when that Dive has none: they came from it with the part (takeCylinders). Answers how many went.
 */
async function cylindersBack(tx: Tx, holderId: string, joinedId: string, part: RecordingRow, staying: string[]): Promise<number> {
  if ((await cylindersOf(tx, part.fromDiveId!)).length > 0) return 0;
  const channels = (await channelsOf(tx, [part.id])).filter((c) => !staying.includes(c));
  if (channels.length === 0) return 0;
  const moved = await tx.update(cylinder).set({ diveId: part.fromDiveId!, recordingId: part.id })
    .where(and(eq(cylinder.diveId, holderId), eq(cylinder.recordingId, joinedId), inArray(cylinder.channel, channels)))
    .returning({ position: cylinder.position });
  return moved.length;
}

export function createContinuationService(db: Db, { currentRemote, deletingItself }: ProviderLinks) {
  /**
   * Takes one later Dive into the kept one, as a merge does (ADR 0038): its Cylinders where the kept Dive has none, its
   * Recording (an entry of its own in the history), Participants, links, weighting, site, values and notes; then
   * deletes it, naming the kept Dive.
   */
  async function takeIn(tx: Tx, userId: string, keptId: string, other: DiveRow, rec: RecordingRow, actor: Actor) {
    const cylinders = await takeCylinders(tx, keptId, other.id);
    // Not through attachRecording: the part is never Primary; the joined Recording becomes it after the last part.
    await tx.update(recording).set({ diveId: keptId, updatedAt: new Date() }).where(eq(recording.id, rec.id));
    await tx.update(dive).set(nextVersion()).where(eq(dive.id, keptId));
    await writeRevision(tx, 'dive', keptId, actor, 'continuation', { recordings: { from: null, to: rec.id }, ...cylinders });

    const extra: Changes = {};
    const before = await participantsOf(tx, keptId);
    const added = addedParticipants(before, await participantsOf(tx, other.id), other.diverId);
    if (added.length > 0) {
      await tx.insert(participant).values(added.map((p) => ({ diveId: keptId, diverId: p.diverId, role: p.role })));
      extra.participants = { from: before, to: await participantsOf(tx, keptId) };
    }
    const moved = await moveLinks(tx, currentRemote, userId, keptId, other.id);
    if (moved.length > 0) extra.providers = { from: [], to: moved };
    const [current] = await tx.select().from(dive).where(eq(dive.id, keptId));
    Object.assign(extra, await takeWeighting(tx, current!, other));
    const siteId = current!.siteId ?? (other.siteId && (await liveSite(tx, other.siteId)) ? other.siteId : null);
    await applyToDive(tx, current!, {
      ...fillValues(current!, other), notes: mergeNotes(current!.notes, other.notes), siteId,
    }, actor, 'continuation', extra);

    const at = await deleteLeftBehind(tx, other.id, actor, 'continuation', { continuedInto: { from: null, to: keptId } });
    // As after a merge: the queue reads `continuation` as no delete, so it is told (ADR 0056).
    await changeListener().diveChanged(tx, other.id, 'delete', at, actor);
  }

  return {
    taking,

    /** Every Dive restoring this deleted one brings back, in start order: the Dives of its append and of later ones (ADR 0063). */
    async restorePreview(userId: string, diveId: string): Promise<string[]> {
      const [row] = await db.select({ id: dive.id }).from(dive).innerJoin(diverManagement, managesDiveDiver(userId))
        .where(and(eq(dive.id, diveId), isNotNull(dive.deletedAt)));
      if (!row) throw new DiveError('dive_not_found');
      const taken = await taking(db, diveId);
      if (!taken) return [diveId];
      const ids = [...new Set((await takenParts(db, await undoneWith(db, taken.appendId))).map((p) => p.fromDiveId!))];
      return (await db.select({ id: dive.id }).from(dive).where(inArray(dive.id, ids)).orderBy(dive.startsAt, dive.id)).map((d) => d.id);
    },

    /**
     * Undoes the append and every later one to its joined Recording, newest first (ADR 0063), wherever that Recording is
     * now. Each part goes back to the Dive it came from, revived if it was deleted with its Dive, and is that Dive's
     * Primary recording; the Dive is restored. The joined Recording is rebuilt from the parts that stay, or deleted when
     * one stays. Provider links that moved stay; those left on a restored Dive come back with it. The separated Dives are
     * two dives to the logbook checks. Runs in the restore's transaction, which holds the restored Dive's lock.
     */
    async undo(tx: Tx, userId: string, appendId: string): Promise<void> {
      const appends = await undoneWith(tx, appendId);
      const joinedId = appends[0]!.joinedRecordingId;
      const [joined] = await tx.select().from(recording).where(eq(recording.id, joinedId));
      const holderId = joined!.diveId!;
      const parts = await takenParts(tx, appends);
      const backIds = [...new Set(parts.map((p) => p.fromDiveId!))];
      // Locked in the order of their ids, as an append locks them.
      const locked = new Map<string, DiveRow>();
      for (const id of [holderId, ...backIds].sort()) {
        const [row] = await tx.select().from(dive).where(eq(dive.id, id)).for('update');
        locked.set(id, row!);
      }
      const staying = (await partsOfJoined(tx, joined!)).filter((p) => !parts.some((back) => back.id === p.id));
      const stayingChannels = await channelsOf(tx, staying.map((p) => p.id));
      const holderCylinders = await cylindersOf(tx, holderId);
      const actor = userActor(userId);

      for (const append of appends) {
        for (const part of parts.filter((p) => p.appendId === append.id)) {
          const back = part.fromDiveId!;
          const moved = await cylindersBack(tx, holderId, joinedId, part, stayingChannels);
          await tx.update(recording).set({ diveId: back, deletedAt: null, joinedRecordingId: null, appendId: null, fromDiveId: null, updatedAt: new Date() })
            .where(eq(recording.id, part.id));
          await undelete(tx, locked.get(back)!, part.id, actor, 'continuation-undo', {
            recordings: { from: null, to: part.id }, ...(moved > 0 && { cylinders: { from: [], to: await cylindersOf(tx, back) } }),
          });
          // As after a restore: the queue reads `continuation-undo` as no restore, so it is told (a delete waiting there goes).
          await changeListener().diveChanged(tx, back, 'restore', new Date(), actor);
        }
      }

      // The holder's Cylinders still tied to a series the joined Recording loses are untied; with one part left, tied to it.
      await tx.update(cylinder).set({ recordingId: null, channel: null, fromPod: false }).where(and(
        eq(cylinder.diveId, holderId), eq(cylinder.recordingId, joinedId),
        stayingChannels.length > 0 ? notInArray(cylinder.channel, stayingChannels) : undefined,
      ));
      if (staying.length === 1) {
        await tx.update(cylinder).set({ recordingId: staying[0]!.id }).where(and(eq(cylinder.diveId, holderId), eq(cylinder.recordingId, joinedId)));
      }
      const after = await cylindersOf(tx, holderId);
      await rebuildJoined(tx, joinedId, actor, 'continuation-undo', {
        recordings: { from: parts.map((p) => p.id), to: null },
        ...(JSON.stringify(after) !== JSON.stringify(holderCylinders) && { cylinders: { from: holderCylinders, to: after } }),
      });
      await tx.delete(continuationAppend).where(inArray(continuationAppend.id, appends.map((a) => a.id)));
      // Taken apart on purpose: each pair is two dives to the logbook checks, as after splitting off (ADR 0038).
      const all = [holderId, ...backIds];
      for (const id of all) await keepApart(tx, userId, id, all.filter((other) => other !== id));
      await renumber(tx, [...new Set([...locked.values()].map((d) => d.diverId))]);
    },

    /**
     * The Dive just before this one that it could be appended to, by hand (no time limit): null when there is none, or
     * when the two aren't one Device's one Recording each (or a joined one before). With the Surface break's length and
     * the Providers both are at: the client asks whether to delete this one there, but not where its Connection deletes
     * there by itself (`deletesItself`), as for a merge.
     */
    async previousCandidate(userId: string, diveId: string) {
      const [row] = await db.select({ d: dive }).from(dive).innerJoin(diverManagement, managesDiveDiver(userId))
        .where(and(eq(dive.id, diveId), isNull(dive.deletedAt)));
      if (!row) throw new DiveError('dive_not_found');
      const later = row.d;
      const rec = await unitOf(db, later.id);
      const [previous] = await db.select({ d: dive, siteName: diveSite.name }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
        .where(and(eq(dive.diverId, later.diverId), isNull(dive.deletedAt), lt(dive.startsAt, later.startsAt)))
        .orderBy(desc(dive.startsAt), desc(dive.id)).limit(1);
      const unit = previous ? await unitOf(db, previous.d.id) : null;
      if (!previous || !unit || !follows(unit, rec)) return null;
      const mine = await providersAt(db, currentRemote, previous.d.id);
      const bothAt = (await providersAt(db, currentRemote, later.id)).filter((provider) => mine.includes(provider));
      const itself = (await deletingItself([later.id])).get(later.id);
      return {
        dive: previous.d, siteName: previous.siteName, breakSeconds: Math.round((rec.startsAt.getTime() - endOf(unit)) / 1000),
        bothAt, deletesItself: bothAt.filter((provider) => itself?.has(provider)),
      };
    },

    /**
     * Appends the later Dives to the kept one in one transaction (ADR 0063) and answers which Dives that were. Each later
     * Dive is taken in as in a merge and deleted; their Recordings become parts of the kept Dive's joined Recording
     * (made by a first append, with the kept Dive's own Recording as its first part), which becomes the Primary one.
     */
    async append(userId: string, kept: { id: string; version: number }, later: { id: string; version: number }[]): Promise<{ kept: string; appended: string[] }> {
      const ids = [kept.id, ...later.map((l) => l.id)];
      if (later.length === 0 || new Set(ids).size !== ids.length) throw new DiveError('continuation_not_possible');
      return db.transaction(async (tx) => {
        // Locked in the order of their ids, so two appends of the same Dives can't wait for each other.
        const locked = new Map<string, DiveRow>();
        for (const id of [...ids].sort()) locked.set(id, await lockManagedDive(tx, userId, id));
        if ([kept, ...later].some((side) => locked.get(side.id)!.version !== side.version)) throw new DiveError('dive_changed');
        const keptRow = locked.get(kept.id)!;
        const laters = later.map((side) => locked.get(side.id)!).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        const { unit, recs } = await preconditions(tx, keptRow, laters);
        const actor = userActor(userId);

        for (const [i, other] of laters.entries()) await takeIn(tx, userId, keptRow.id, other, recs[i]!, actor);
        const parts = [
          ...(isJoined(unit) ? [] : [{ recordingId: unit.id, fromDiveId: keptRow.id }]),
          ...laters.map((other, i) => ({ recordingId: recs[i]!.id, fromDiveId: other.id })),
        ];
        const { joinedId } = await buildJoined(tx, keptRow.id, parts, userId);
        const cylinders = await tieToJoined(tx, keptRow.id, parts.map((p) => p.recordingId), joinedId);
        const [current] = await tx.select().from(dive).where(eq(dive.id, keptRow.id));
        const appended = laters.map((l) => l.id);
        await followPrimary(tx, current!, joinedId, actor, 'continuation', { appendedFrom: { from: null, to: appended }, ...cylinders });
        await renumber(tx, [keptRow.diverId]);
        return { kept: keptRow.id, appended };
      });
    },
  };
}

export type ContinuationService = ReturnType<typeof createContinuationService>;
