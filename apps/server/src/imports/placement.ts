// Placing a Recording (docs/spec/data-model.md, scenario 1): the same for a FIT file's and for a Provider's copy of a dive
// from a computer (ADR 0030). Its Diver and Device, the same Recording seen again, one deleted with its Dive, and then a
// new Dive, an attach, or a Duplicate candidate (always one for a probable non-dive beside a Dive). The same dive from a poorer and a fuller file of one Source ends in one
// Recording (ADR 0037).
import { and, desc, eq, gte, inArray, isNotNull, isNull, like, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import {
  device, dive, diverManagement, duplicateCandidate, original, recording, recordingEvent, sampleSeries, type ImportOutcome,
} from '../db/schema.js';
import { attachRecording, createDiveFromRecording, refreshFromPrimary } from '../dives/dive-service.js';
import { reviseDive, untieLostSeries } from '../dives/cylinders.js';
import { probablyNoDive } from '../dives/logbook-check-rules.js';
import { writeRevision, type Actor } from '../dives/revisions.js';
import type { ParsedRecording } from './parsed-recording.js';
import { linkNearbySite, positionColumns } from '../sites/dive-site-link.js';
import { alignedForMatching, decideMatch, overlapWindow } from './matching.js';

/** The widest UTC offset: a Dive whose offset is unknown keeps a wall-clock time at most this far from its instant. */
const MAX_OFFSET_MS = 14 * 3600_000;

export interface Placement {
  userId: string;
  importId: string;
  originalId: string;
  fileName: string;
  actor: Actor;
  /** The parser that read the Recording, as the Recording names it. */
  parser: { name: string; version: string };
  /** Where a Recording of a Device not seen before goes: the User's own Diver (files), the Connection's (a Provider). */
  diverId?: string;
}

export async function managedDivers(tx: Tx, userId: string): Promise<Set<string>> {
  const rows = await tx.select({ id: diverManagement.diverId }).from(diverManagement).where(eq(diverManagement.userId, userId));
  return new Set(rows.map((r) => r.id));
}

/** The Diver a live Device by this manufacturer and serial number belongs to, or null when there is none. */
export async function deviceDiver(tx: Db | Tx, d: { manufacturer: string; serialNumber: string }): Promise<string | null> {
  const [known] = await tx.select({ diverId: device.diverId }).from(device).where(and(
    eq(device.manufacturer, d.manufacturer), eq(device.serialNumber, d.serialNumber), isNull(device.deletedAt),
  ));
  return known?.diverId ?? null;
}

/** Places one Recording; runs inside the Import's transaction. */
export async function placeRecording(tx: Tx, c: Placement, rec: ParsedRecording): Promise<ImportOutcome[number]> {
  const { fileName, actor } = c;
  // A User only ever writes to the logbooks of Divers they manage.
  const managed = await managedDivers(tx, c.userId);
  // The same Recording seen before (e.g. a re-export with a different file hash), or this dive from a poorer file of
  // the same Source, which this one replaces (ADR 0037).
  const keys = [rec.recordingKey, ...(rec.replacesKey ? [rec.replacesKey] : [])];
  const [known] = (await tx.select().from(recording).where(and(inArray(recording.recordingKey, keys), isNull(recording.deletedAt))))
    .sort((a, b) => keys.indexOf(a.recordingKey) - keys.indexOf(b.recordingKey));
  if (known && !(await recordingIsManaged(tx, known, c.userId, managed))) return { fileName, result: 'skipped', reason: 'not_your_diver' };
  // A Device first seen on a Recording that is already on a Dive belongs to that Dive's Diver.
  const [onDive] = known?.diveId ? await tx.select({ diverId: dive.diverId }).from(dive).where(eq(dive.id, known.diveId)) : [];
  const diverId = await resolveDiver(tx, onDive ? { ...c, diverId: onDive.diverId } : c, rec, managed);
  if (!diverId) return { fileName, result: 'skipped', reason: 'not_your_diver' };
  const deviceId = rec.device ? await resolveDevice(tx, diverId, rec) : null;
  const values = {
    deviceId, originalId: c.originalId, importId: c.importId, recordingKey: rec.recordingKey,
    parser: c.parser.name, parserVersion: c.parser.version,
    startsAt: rec.startsAt, utcOffsetSeconds: rec.utcOffsetSeconds ?? null, utcOffsetSource: rec.utcOffsetSource ?? 'device' as const,
    durationSeconds: rec.durationSeconds, maxDepthM: rec.maxDepthM ?? null, avgDepthM: rec.avgDepthM ?? null,
    ...positionColumns(rec), summary: rec.summary, updatedAt: new Date(),
  };

  // Update in place.
  if (known) {
    await tx.update(recording).set(values).where(eq(recording.id, known.id));
    await writeSamples(tx, known.id, rec, true);
    await writeRevision(tx, 'recording', known.id, actor, 'reimport', { originalId: { from: known.originalId, to: c.originalId } });
    // If it is a Dive's Primary recording, the Dive's values without Override follow the new data.
    const [owner] = await tx.select({ id: dive.id }).from(dive).where(eq(dive.primaryRecordingId, known.id));
    // A Cylinder tied to a pressure series the new data no longer has loses its tie, in the same Revision.
    const untied = known.diveId ? await untieLostSeries(tx, known.diveId, known.id) : {};
    if (owner) await refreshFromPrimary(tx, owner.id, actor, 'reimport', owner.id === known.diveId ? untied : {});
    if (known.diveId && owner?.id !== known.diveId && Object.keys(untied).length > 0) await reviseDive(tx, known.diveId, actor, 'reimport', untied);
    return { fileName, result: 'updated', recordingId: known.id, ...(known.diveId && { diveId: known.diveId }) };
  }
  // Deleted with its Dive (ADR 0026): not created again, so re-importing a whole export doesn't bring it back.
  // Its key stays taken for everyone, or restoring it would clash with a newer Recording.
  const [deleted] = await tx.select().from(recording)
    .where(and(inArray(recording.recordingKey, keys), isNotNull(recording.deletedAt)))
    .orderBy(desc(recording.deletedAt)).limit(1);
  if (deleted) {
    return (await recordingIsManaged(tx, deleted, c.userId, managed))
      ? { fileName, result: 'skipped', reason: 'deleted_earlier', recordingId: deleted.id }
      : { fileName, result: 'skipped', reason: 'not_your_diver' };
  }

  // A fuller file's Recording of this dive is here: this one adds nothing (ADR 0037).
  if (rec.fullerCopyLike) {
    const fuller = await tx.select().from(recording).where(and(
      like(recording.recordingKey, rec.fullerCopyLike),
      sql`abs(${recording.durationSeconds} - ${rec.durationSeconds}) < 1`,
      ...(rec.maxDepthM === undefined ? [] : [sql`abs(${recording.maxDepthM} - ${rec.maxDepthM}) < 0.02`]),
    )).orderBy(sql`${recording.deletedAt} nulls first`);
    for (const f of fuller) {
      if (!(await recordingIsManaged(tx, f, c.userId, managed))) continue;
      return f.deletedAt
        ? { fileName, result: 'skipped', reason: 'deleted_earlier', recordingId: f.id }
        : { fileName, result: 'skipped', reason: 'fuller_copy_here', recordingId: f.id, ...(f.diveId && { diveId: f.diveId }) };
    }
  }

  const [created] = await tx.insert(recording).values(values).returning();
  await writeSamples(tx, created!.id, rec, false);

  // Dives whose offset is unknown keep their wall-clock time, up to 14 hours off the instant: looked for that much
  // wider, then compared in local time (ADR 0030).
  const window = overlapWindow(rec);
  const found = await tx
    .select({
      id: dive.id, startsAt: dive.startsAt, durationSeconds: dive.durationSeconds, maxDepthM: dive.maxDepthM,
      utcOffsetSeconds: dive.utcOffsetSeconds, utcOffsetSource: dive.utcOffsetSource,
    })
    .from(dive)
    .where(and(
      eq(dive.diverId, diverId), isNull(dive.deletedAt),
      lte(dive.startsAt, new Date(window.to.getTime() + MAX_OFFSET_MS)),
      gte(dive.startsAt, new Date(window.from.getTime() - 24 * 3600_000 - MAX_OFFSET_MS)),
    ));
  const candidates = alignedForMatching({ utcOffsetSeconds: values.utcOffsetSeconds, utcOffsetSource: values.utcOffsetSource }, found);
  // A probable non-dive, as the logbook check sees it (ADR 0038), is matched by the User, not by itself (ADR 0030, amended).
  const onFound = found.length === 0 ? [] : await tx.selectDistinct({ diveId: recording.diveId, deviceId: recording.deviceId }).from(recording)
    .where(and(inArray(recording.diveId, found.map((d) => d.id)), isNull(recording.deletedAt)));
  const withRecording = new Set(onFound.map((r) => r.diveId));
  // One Device doesn't record a dive twice: its next Recording is in reach of such a Dive only when they overlap (ADR 0044).
  const ofThisDevice = new Set(onFound.filter((r) => deviceId !== null && r.deviceId === deviceId).map((r) => r.diveId));
  const decision = decideMatch(
    { ...rec, probablyNoDive: probablyNoDive({ recordings: 1, durationSeconds: rec.durationSeconds, maxDepthM: rec.maxDepthM ?? null }) },
    candidates.map((d) => ({ ...d, maxDepthM: d.maxDepthM ?? undefined, sameDevice: ofThisDevice.has(d.id), probablyNoDive: probablyNoDive({ ...d, recordings: withRecording.has(d.id) ? 1 : 0 }) })),
  );

  if (decision.kind === 'create') {
    const newDiveId = await createDiveFromRecording(tx, created!, diverId, actor, 'import-create');
    await linkNearbySite(tx, newDiveId, created!, actor);
    return { fileName, result: 'created', diveId: newDiveId, recordingId: created!.id };
  }
  if (decision.kind === 'attach') {
    await attachRecording(tx, decision.diveId, created!.id, actor, 'auto-attach');
    return { fileName, result: 'attached', diveId: decision.diveId, recordingId: created!.id };
  }
  await tx.insert(duplicateCandidate).values({
    recordingId: created!.id, candidateDiveIds: decision.diveIds, reason: decision.reason,
  });
  return { fileName, result: 'duplicate-candidate', recordingId: created!.id, reason: decision.reason };
}

/**
 * Recordings go to the Diver their Device is assigned to; unknown Devices default to the Placement's Diver, else the
 * User's own. Null when the Device belongs to a Diver this User doesn't manage.
 */
async function resolveDiver(tx: Tx, c: Placement, rec: ParsedRecording, managed: Set<string>): Promise<string | null> {
  if (rec.device) {
    const known = await deviceDiver(tx, rec.device);
    if (known) return managed.has(known) ? known : null;
  }
  if (c.diverId) return c.diverId;
  const [own] = await tx.select({ diverId: diverManagement.diverId }).from(diverManagement)
    .where(and(eq(diverManagement.userId, c.userId), eq(diverManagement.isOwn, true)));
  if (!own) throw new Error('User has no own Diver');
  return own.diverId;
}

async function resolveDevice(tx: Tx, diverId: string, rec: ParsedRecording): Promise<string> {
  const d = rec.device!;
  const [known] = await tx.select().from(device).where(and(
    eq(device.manufacturer, d.manufacturer), eq(device.serialNumber, d.serialNumber), isNull(device.deletedAt),
  ));
  if (known) {
    if (d.firmware && d.firmware !== known.firmware) {
      await tx.update(device).set({ firmware: d.firmware, updatedAt: new Date() }).where(eq(device.id, known.id));
    }
    return known.id;
  }
  const [created] = await tx.insert(device).values({
    diverId, manufacturer: d.manufacturer, serialNumber: d.serialNumber,
    product: d.product ?? null, firmware: d.firmware ?? null,
  }).returning();
  return created!.id;
}

async function writeSamples(tx: Tx, recordingId: string, rec: ParsedRecording, replace: boolean) {
  if (replace) {
    await tx.delete(sampleSeries).where(eq(sampleSeries.recordingId, recordingId));
    await tx.delete(recordingEvent).where(eq(recordingEvent.recordingId, recordingId));
  }
  if (rec.series.length > 0) {
    await tx.insert(sampleSeries).values(rec.series.map((s) => ({
      recordingId, channel: s.channel, offsetsMs: s.offsetsMs, values: s.values,
    })));
  }
  if (rec.events.length > 0) {
    await tx.insert(recordingEvent).values(rec.events.map((e) => ({
      recordingId, offsetMs: e.offsetMs, type: e.type, data: e.data,
    })));
  }
}

/** Whether an existing Recording is in a logbook this User manages (via its Dive, else its Device, else its Original). */
async function recordingIsManaged(
  tx: Tx, rec: typeof recording.$inferSelect, userId: string, managed: Set<string>,
): Promise<boolean> {
  if (rec.diveId) {
    const [d] = await tx.select({ diverId: dive.diverId }).from(dive).where(eq(dive.id, rec.diveId));
    return !!d && managed.has(d.diverId);
  }
  if (rec.deviceId) {
    const [d] = await tx.select({ diverId: device.diverId }).from(device).where(eq(device.id, rec.deviceId));
    return !!d && managed.has(d.diverId);
  }
  const [o] = await tx.select({ userId: original.userId }).from(original).where(eq(original.id, rec.originalId));
  return o?.userId === userId;
}
