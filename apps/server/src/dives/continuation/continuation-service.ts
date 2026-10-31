// Appending later Dives to the earlier one (ADR 0063): one Dive of the Diver's, whose Primary recording joins the parts'
// Recordings with a Surface break between each two. The later Dives go as in a merge (ADR 0038): the kept Dive is
// filled from each, takes its link at a Provider where it has none, and each is deleted the normal way (ADR 0026).
import { and, desc, eq, gt, inArray, isNull, lt, notInArray } from 'drizzle-orm';
import type { Db, Queryable, Tx } from '../../db/client.js';
import { cylinder, dive, diveSite, diverManagement, participant, push, recording } from '../../db/schema.js';
import { managesDiveDiver } from '../../divers/management.js';
import { liveSite } from '../../sites/dive-site-link.js';
import type { LogbookCheckService } from '../checks/logbook-check-service.js';
import { cylindersOf, takeCylinders } from '../cylinders.js';
import { renumber } from '../dive-numbers.js';
import { DiveError, applyToDive, followPrimary, lockManagedDive, nextVersion, participantsOf } from '../dive-service.js';
import {
  addedParticipants, deleteLeftBehind, fillValues, mergeNotes, moveLinks, type ProviderLinks,
} from '../merging-service.js';
import { changeListener, userActor, writeRevision, type Actor, type Changes } from '../revisions.js';
import { takeWeighting } from '../weighting.js';
import { JOINED_PARSER, buildJoined } from './joined-recording.js';

type DiveRow = typeof dive.$inferSelect;
type RecordingRow = typeof recording.$inferSelect;

/** A Dive's unit: its one Recording, or its joined Recording with nothing but its parts beside it; null otherwise. */
async function unitOf(q: Queryable, diveId: string): Promise<RecordingRow | null> {
  const live = await q.select().from(recording).where(and(eq(recording.diveId, diveId), isNull(recording.deletedAt)));
  const joined = live.filter((r) => r.parser === JOINED_PARSER);
  if (joined.length === 0) return live.length === 1 ? live[0]! : null;
  const [unit] = joined;
  return joined.length === 1 && live.every((r) => r === unit || r.joinedRecordingId === unit!.id) ? unit! : null;
}

const endOf = (r: RecordingRow) => r.startsAt.getTime() + r.durationSeconds * 1000;

/** Whether `later`, a Dive's one Recording, may follow `before`: the same Device, starting after it ends. */
const follows = (before: RecordingRow, later: RecordingRow | null): later is RecordingRow =>
  !!later && later.parser !== JOINED_PARSER && !!before.deviceId && later.deviceId === before.deviceId
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

export function createContinuationService(db: Db, _checks: LogbookCheckService, { currentRemote, deletingItself }: ProviderLinks) {
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
          ...(unit.parser === JOINED_PARSER ? [] : [{ recordingId: unit.id, fromDiveId: keptRow.id }]),
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
