// Keeping a Dive: Overrides, resetting them, the Primary recording, and refreshing from it (ADR 0015).
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { OVERRIDABLE_FIELDS, dive, diverManagement, recording, type OverridableField } from '../db/schema.js';
import {
  columnsOf, plain, sameValue, valuesFromRecording, valuesOfDive, type DiveValues,
} from './dive-values.js';
import { writeRevision, type Actor, type Changes, type RevisionCause } from './revisions.js';
import { liveSite, siteRef } from '../sites/dive-site-link.js';

export class DiveError extends Error {
  constructor(readonly code:
    | 'dive_not_found' | 'dive_changed' | 'dive_values_inconsistent' | 'recording_not_on_dive'
    | 'recording_not_found' | 'last_recording' | 'diver_not_found' | 'site_not_found') {
    super(code);
  }
}

export interface DiveEdit {
  /** The version the User started editing from; a different current version means someone else changed it. */
  version: number;
  /** New values; each becomes an Override. */
  set?: Partial<DiveValues>;
  /** Overrides to drop: the field takes the Primary recording's value again. */
  reset?: OverridableField[];
  /** The Dive's own notes (not an Override). */
  notes?: string | null;
  /** The Dive site, or null for none (the Dive's own value, ADR 0020). */
  siteId?: string | null;
}

type DiveRow = typeof dive.$inferSelect;

/**
 * Locks the Dive for this transaction if the User manages its Diver. Not managed and not found look
 * the same to the caller, so Dive ids of other Users can't be probed.
 */
async function lockManagedDive(tx: Tx, userId: string, diveId: string): Promise<DiveRow> {
  const [row] = await tx.select({ d: dive }).from(dive)
    .innerJoin(diverManagement, and(eq(diverManagement.diverId, dive.diverId), eq(diverManagement.userId, userId)))
    .where(and(eq(dive.id, diveId), isNull(dive.deletedAt)))
    .for('update', { of: dive });
  if (!row) throw new DiveError('dive_not_found');
  return row.d;
}

async function primaryValues(tx: Tx, recordingId: string | null): Promise<DiveValues | null> {
  if (!recordingId) return null;
  const [rec] = await tx.select().from(recording).where(and(eq(recording.id, recordingId), isNull(recording.deletedAt)));
  return rec ? valuesFromRecording(rec) : null;
}

/**
 * Applies `next` to the Dive row: writes changed columns, bumps the version and records one Revision.
 * Returns the changes (empty when nothing differed, in which case nothing is written).
 */
async function apply(
  tx: Tx, current: DiveRow,
  next: { values: DiveValues; overrides: OverridableField[]; notes: string | null; primaryRecordingId: string | null; siteId?: string | null },
  actor: Actor, cause: RevisionCause, extra: Changes = {},
): Promise<Changes> {
  const before = valuesOfDive(current);
  const changes: Changes = { ...extra };
  let columns: Record<string, unknown> = {};
  for (const field of OVERRIDABLE_FIELDS) {
    const from = plain(field, before[field]);
    const to = plain(field, next.values[field]);
    if (!sameValue(from, to)) {
      changes[field] = { from, to };
      columns = { ...columns, ...columnsOf(field, next.values[field]) };
    }
  }
  const overrides = OVERRIDABLE_FIELDS.filter((f) => next.overrides.includes(f));
  if (!sameValue(current.overrides, overrides)) {
    changes.overrides = { from: current.overrides, to: overrides };
    columns.overrides = overrides;
  }
  if (current.notes !== next.notes) {
    changes.notes = { from: current.notes, to: next.notes };
    columns.notes = next.notes;
  }
  if (next.siteId !== undefined && current.siteId !== next.siteId) {
    changes.site = { from: await siteRef(tx, current.siteId), to: await siteRef(tx, next.siteId) };
    columns.siteId = next.siteId;
  }
  if (current.primaryRecordingId !== next.primaryRecordingId) {
    changes.primaryRecordingId = { from: current.primaryRecordingId, to: next.primaryRecordingId };
    columns.primaryRecordingId = next.primaryRecordingId;
  }
  if (Object.keys(changes).length === 0) return changes;
  await tx.update(dive).set({ ...columns, version: sql`${dive.version} + 1`, updatedAt: new Date() }).where(eq(dive.id, current.id));
  await writeRevision(tx, 'dive', current.id, actor, cause, changes);
  return changes;
}

/** Values in effect: Overrides keep the Dive's value, every other field takes the recording's. */
function merge(current: DiveValues, fromRecording: DiveValues | null, overrides: readonly OverridableField[]): DiveValues {
  if (!fromRecording) return current;
  const merged = { ...current };
  for (const field of OVERRIDABLE_FIELDS) {
    if (!overrides.includes(field)) (merged as Record<string, unknown>)[field] = fromRecording[field];
  }
  return merged;
}

/** Divers the User manages. */
export async function managedDiverIds(tx: Tx | Db, userId: string): Promise<Set<string>> {
  const rows = await tx.select({ id: diverManagement.diverId }).from(diverManagement).where(eq(diverManagement.userId, userId));
  return new Set(rows.map((r) => r.id));
}

/** A new Dive for one Diver from a Recording, which becomes its Primary recording. */
export async function createDiveFromRecording(
  tx: Tx, rec: typeof recording.$inferSelect, diverId: string, actor: Actor, cause: RevisionCause,
): Promise<string> {
  const v = valuesFromRecording(rec);
  const [created] = await tx.insert(dive).values({
    diverId, number: v.number, startsAt: v.startsAt.at, utcOffsetSeconds: v.startsAt.utcOffsetSeconds,
    durationSeconds: v.durationSeconds, maxDepthM: v.maxDepthM, avgDepthM: v.avgDepthM,
    waterTemperatureC: v.waterTemperatureC, waterType: v.waterType, primaryRecordingId: rec.id,
  }).returning({ id: dive.id });
  await tx.update(recording).set({ diveId: created!.id, updatedAt: new Date() }).where(eq(recording.id, rec.id));
  await writeRevision(tx, 'dive', created!.id, actor, cause, { primaryRecordingId: { from: null, to: rec.id } });
  return created!.id;
}

/** Adds a Recording to a Dive; the Dive's values stay with its Primary recording. */
export async function attachRecording(tx: Tx, diveId: string, recordingId: string, actor: Actor, cause: RevisionCause) {
  await tx.update(recording).set({ diveId, updatedAt: new Date() }).where(eq(recording.id, recordingId));
  await tx.update(dive).set({ version: sql`${dive.version} + 1`, updatedAt: new Date() }).where(eq(dive.id, diveId));
  await writeRevision(tx, 'dive', diveId, actor, cause, { recordings: { from: null, to: recordingId } });
}

export function createDiveService(db: Db) {
  return {
    /** A User's edit of their Dive, in one transaction and one Revision. */
    async edit(userId: string, diveId: string, edit: DiveEdit): Promise<void> {
      await db.transaction(async (tx) => {
        const current = await lockManagedDive(tx, userId, diveId);
        if (current.version !== edit.version) throw new DiveError('dive_changed');
        const reset = new Set(edit.reset ?? []);
        const set = Object.fromEntries(Object.entries(edit.set ?? {}).filter(([f]) => !reset.has(f as OverridableField))) as Partial<DiveValues>;
        const overrides = [...new Set([...current.overrides.filter((f) => !reset.has(f)), ...(Object.keys(set) as OverridableField[])])];
        const fromRecording = await primaryValues(tx, current.primaryRecordingId);
        const values = merge({ ...valuesOfDive(current), ...set }, fromRecording, overrides);
        if (values.maxDepthM !== null && values.avgDepthM !== null && values.avgDepthM > values.maxDepthM) {
          throw new DiveError('dive_values_inconsistent');
        }
        if (edit.siteId && edit.siteId !== current.siteId && !(await liveSite(tx, edit.siteId))) throw new DiveError('site_not_found');
        await apply(tx, current, {
          values, overrides, notes: edit.notes === undefined ? current.notes : edit.notes,
          primaryRecordingId: current.primaryRecordingId, ...(edit.siteId !== undefined && { siteId: edit.siteId }),
        }, { type: 'user', id: userId }, 'edit');
      });
    },

    /** Makes another of the Dive's Recordings the Primary one; values without Override follow it. */
    async setPrimary(userId: string, diveId: string, recordingId: string, version: number): Promise<void> {
      await db.transaction(async (tx) => {
        const current = await lockManagedDive(tx, userId, diveId);
        if (current.version !== version) throw new DiveError('dive_changed');
        const [rec] = await tx.select({ id: recording.id }).from(recording)
          .where(and(eq(recording.id, recordingId), eq(recording.diveId, diveId), isNull(recording.deletedAt)));
        if (!rec) throw new DiveError('recording_not_on_dive');
        const values = merge(valuesOfDive(current), await primaryValues(tx, recordingId), current.overrides);
        await apply(tx, current, {
          values, overrides: current.overrides, notes: current.notes, primaryRecordingId: recordingId,
        }, { type: 'user', id: userId }, 'primary-change');
      });
    },

    /**
     * Splits a Recording off its Dive into a new Dive of the same Diver (data model: detaching is
     * always possible). If it was the Primary recording, the earliest remaining one takes over.
     * A Dive's last Recording can't be split off; that would only move the Dive.
     */
    async detach(userId: string, recordingId: string, version: number): Promise<string> {
      return db.transaction(async (tx) => {
        const [rec] = await tx.select().from(recording).where(and(eq(recording.id, recordingId), isNull(recording.deletedAt)));
        if (!rec?.diveId) throw new DiveError('recording_not_found');
        const current = await lockManagedDive(tx, userId, rec.diveId).catch(() => { throw new DiveError('recording_not_found'); });
        if (current.version !== version) throw new DiveError('dive_changed');
        const remaining = (await tx.select().from(recording)
          .where(and(eq(recording.diveId, current.id), isNull(recording.deletedAt)))
          .orderBy(recording.startsAt)).filter((r) => r.id !== rec.id);
        if (remaining.length === 0) throw new DiveError('last_recording');
        const actor: Actor = { type: 'user', id: userId };
        await tx.update(recording).set({ diveId: null }).where(eq(recording.id, rec.id));
        const primary = current.primaryRecordingId === rec.id ? remaining[0]!.id : current.primaryRecordingId;
        const values = merge(valuesOfDive(current), await primaryValues(tx, primary), current.overrides);
        await apply(tx, current, {
          values, overrides: current.overrides, notes: current.notes, primaryRecordingId: primary,
        }, actor, 'detach', { recordings: { from: rec.id, to: null } });
        return createDiveFromRecording(tx, rec, current.diverId, actor, 'detach');
      });
    },

    /** Files a Dive under another Diver the User manages (e.g. dived with a lent computer). */
    async move(userId: string, diveId: string, diverId: string, version: number): Promise<void> {
      await db.transaction(async (tx) => {
        const current = await lockManagedDive(tx, userId, diveId);
        if (current.version !== version) throw new DiveError('dive_changed');
        if (!(await managedDiverIds(tx, userId)).has(diverId)) throw new DiveError('diver_not_found');
        if (diverId === current.diverId) return;
        await tx.update(dive).set({ diverId, version: sql`${dive.version} + 1`, updatedAt: new Date() }).where(eq(dive.id, diveId));
        await writeRevision(tx, 'dive', diveId, { type: 'user', id: userId }, 'move', { diverId: { from: current.diverId, to: diverId } });
      });
    },
  };
}

/**
 * After an Import changed a Dive's Primary recording, values without Override follow it.
 * Runs inside the Import's transaction.
 */
export async function refreshFromPrimary(tx: Tx, diveId: string, actor: Actor, cause: RevisionCause): Promise<void> {
  const [current] = await tx.select().from(dive).where(eq(dive.id, diveId)).for('update');
  if (!current) return;
  const values = merge(valuesOfDive(current), await primaryValues(tx, current.primaryRecordingId), current.overrides);
  await apply(tx, current, {
    values, overrides: current.overrides, notes: current.notes, primaryRecordingId: current.primaryRecordingId,
  }, actor, cause);
}

export type DiveService = ReturnType<typeof createDiveService>;
