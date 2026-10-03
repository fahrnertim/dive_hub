// Deciding about Duplicate candidates (ADR 0016): add to one of the candidate Dives, make a new Dive,
// or discard (the Recording stays, detached, so a re-import doesn't ask again), and reopen.
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { device, dive, diverManagement, duplicateCandidate, original, recording } from '../db/schema.js';
import { attachRecording, createDiveFromRecording, managedDiverIds } from './dive-service.js';
import type { Actor } from './revisions.js';

export class CandidateError extends Error {
  constructor(readonly code: 'candidate_not_found' | 'candidate_resolved' | 'not_a_candidate' | 'dive_not_found') {
    super(code);
  }
}

type CandidateRow = typeof duplicateCandidate.$inferSelect;
type RecordingRow = typeof recording.$inferSelect;

export function createCandidates(db: Db) {
  /** The candidate, locked, if its Recording came from one of the User's Imports. */
  async function lockMine(tx: Tx, userId: string, id: string): Promise<{ c: CandidateRow; r: RecordingRow }> {
    const [row] = await tx.select({ c: duplicateCandidate, r: recording }).from(duplicateCandidate)
      .innerJoin(recording, eq(recording.id, duplicateCandidate.recordingId))
      .innerJoin(original, eq(original.id, recording.originalId))
      .where(and(eq(duplicateCandidate.id, id), eq(original.userId, userId), isNull(recording.deletedAt)))
      .for('update', { of: duplicateCandidate });
    if (!row) throw new CandidateError('candidate_not_found');
    return row;
  }

  async function resolve(tx: Tx, id: string, resolution: 'attached' | 'new_dive' | 'discarded' | null) {
    await tx.update(duplicateCandidate)
      .set({ resolution, resolvedAt: resolution ? new Date() : null })
      .where(eq(duplicateCandidate.id, id));
  }

  const open = async (tx: Tx, userId: string, id: string) => {
    const row = await lockMine(tx, userId, id);
    if (row.c.resolution) throw new CandidateError('candidate_resolved');
    return row;
  };

  return {
    /** Open candidates (or discarded ones) from the User's Imports, newest first, with their Dives. */
    async list(userId: string, status: 'open' | 'discarded') {
      const rows = await db.select({ c: duplicateCandidate, r: recording, d: device }).from(duplicateCandidate)
        .innerJoin(recording, eq(recording.id, duplicateCandidate.recordingId))
        .innerJoin(original, eq(original.id, recording.originalId))
        .leftJoin(device, eq(device.id, recording.deviceId))
        .where(and(
          eq(original.userId, userId), isNull(recording.deletedAt),
          status === 'open' ? isNull(duplicateCandidate.resolution) : eq(duplicateCandidate.resolution, 'discarded'),
        ))
        .orderBy(desc(duplicateCandidate.createdAt)).limit(100);
      const diveIds = [...new Set(rows.flatMap(({ c }) => c.candidateDiveIds))];
      const managed = await managedDiverIds(db, userId);
      const dives = diveIds.length === 0 ? [] : await db.select().from(dive)
        .where(and(inArray(dive.id, diveIds), isNull(dive.deletedAt)));
      const visible = new Map(dives.filter((d) => managed.has(d.diverId)).map((d) => [d.id, d]));
      return rows.map(({ c, r, d }) => ({
        candidate: c, recording: r, device: d,
        dives: c.candidateDiveIds.flatMap((id) => (visible.has(id) ? [visible.get(id)!] : [])),
      }));
    },

    async attach(userId: string, id: string, diveId: string): Promise<string> {
      return db.transaction(async (tx) => {
        const { c, r } = await open(tx, userId, id);
        if (!c.candidateDiveIds.includes(diveId)) throw new CandidateError('not_a_candidate');
        const [target] = await tx.select({ id: dive.id }).from(dive)
          .innerJoin(diverManagement, and(eq(diverManagement.diverId, dive.diverId), eq(diverManagement.userId, userId)))
          .where(and(eq(dive.id, diveId), isNull(dive.deletedAt))).for('update', { of: dive });
        if (!target) throw new CandidateError('dive_not_found');
        await attachRecording(tx, diveId, r.id, { type: 'user', id: userId }, 'attach');
        await resolve(tx, c.id, 'attached');
        return diveId;
      });
    },

    /** A new Dive for the Diver the Recording's Device belongs to (if managed), else the User's own. */
    async newDive(userId: string, id: string): Promise<string> {
      return db.transaction(async (tx) => {
        const { c, r } = await open(tx, userId, id);
        const managed = await managedDiverIds(tx, userId);
        const [dev] = r.deviceId ? await tx.select({ diverId: device.diverId }).from(device).where(eq(device.id, r.deviceId)) : [];
        const [own] = await tx.select({ diverId: diverManagement.diverId }).from(diverManagement)
          .where(and(eq(diverManagement.userId, userId), eq(diverManagement.isOwn, true)));
        const diverId = dev && managed.has(dev.diverId) ? dev.diverId : own!.diverId;
        const actor: Actor = { type: 'user', id: userId };
        const diveId = await createDiveFromRecording(tx, r, diverId, actor, 'create');
        await resolve(tx, c.id, 'new_dive');
        return diveId;
      });
    },

    async discard(userId: string, id: string): Promise<void> {
      await db.transaction(async (tx) => {
        const { c } = await open(tx, userId, id);
        await resolve(tx, c.id, 'discarded');
      });
    },

    /** Brings a discarded Recording back to decide again. */
    async reopen(userId: string, id: string): Promise<void> {
      await db.transaction(async (tx) => {
        const { c } = await lockMine(tx, userId, id);
        if (c.resolution !== 'discarded') throw new CandidateError('candidate_resolved');
        await resolve(tx, c.id, null);
      });
    },
  };
}

export type Candidates = ReturnType<typeof createCandidates>;
