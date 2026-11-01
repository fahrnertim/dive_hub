// A Continuation's joined Recording (ADR 0063): derived from its parts, with no Original and no key an import can match.
// This is the only writer of its row, its sample series and its events; it is rebuilt from the parts, never edited.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { continuationAppend, dive, recording, recordingEvent, sampleSeries } from '../../db/schema.js';
import { reviseDive } from '../cylinders.js';
import { followPrimary, refreshFromPrimary } from '../dive-service.js';
import type { Actor, Changes, RevisionCause } from '../revisions.js';
import { joinParts, type PartInput } from './join-parts.js';

/** The parser a joined Recording names, and its version. */
export const JOINED_PARSER = 'continuation';
const JOINED_PARSER_VERSION = '1';

type RecordingRow = typeof recording.$inferSelect;

/** A part as joinParts takes it: its Recording's values, sample series and events. */
async function partInput(tx: Tx, rec: RecordingRow): Promise<PartInput> {
  const series = await tx.select({ channel: sampleSeries.channel, offsetsMs: sampleSeries.offsetsMs, values: sampleSeries.values })
    .from(sampleSeries).where(eq(sampleSeries.recordingId, rec.id));
  const events = await tx.select({ offsetMs: recordingEvent.offsetMs, type: recordingEvent.type, data: recordingEvent.data })
    .from(recordingEvent).where(eq(recordingEvent.recordingId, rec.id)).orderBy(recordingEvent.offsetMs, recordingEvent.id);
  return {
    startsAt: rec.startsAt, durationSeconds: rec.durationSeconds, maxDepthM: rec.maxDepthM, avgDepthM: rec.avgDepthM,
    utcOffsetSeconds: rec.utcOffsetSeconds, utcOffsetSource: rec.utcOffsetSource,
    entryLatitude: rec.entryLatitude, entryLongitude: rec.entryLongitude, exitLatitude: rec.exitLatitude, exitLongitude: rec.exitLongitude,
    summary: rec.summary, series, events,
  };
}

/** The joined Recording's parts, in start order: live, or deleted with it when its Dive is deleted. */
export async function partsOfJoined(tx: Tx, joined: RecordingRow): Promise<RecordingRow[]> {
  return tx.select().from(recording).where(and(
    eq(recording.joinedRecordingId, joined.id), joined.deletedAt ? eq(recording.deletedAt, joined.deletedAt) : isNull(recording.deletedAt),
  )).orderBy(recording.startsAt);
}

/** Writes the joined Recording from its parts: its values, and its series and events replaced. */
async function writeJoined(tx: Tx, joinedId: string): Promise<void> {
  const [joined] = await tx.select().from(recording).where(eq(recording.id, joinedId));
  const rows = await partsOfJoined(tx, joined!);
  const parts: PartInput[] = [];
  for (const row of rows) parts.push(await partInput(tx, row));
  const { series, events, ...values } = joinParts(parts);
  await tx.update(recording).set({ ...values, updatedAt: new Date() }).where(eq(recording.id, joinedId));
  await tx.delete(sampleSeries).where(eq(sampleSeries.recordingId, joinedId));
  await tx.delete(recordingEvent).where(eq(recordingEvent.recordingId, joinedId));
  if (series.length > 0) await tx.insert(sampleSeries).values(series.map((s) => ({ recordingId: joinedId, ...s })));
  if (events.length > 0) await tx.insert(recordingEvent).values(events.map((e) => ({ recordingId: joinedId, ...e })));
}

/**
 * Appends parts to the kept Dive's joined Recording, making it on a first append (the kept Dive's own Recording is then
 * the first of `parts`), and records the append. The parts are Recordings already on the kept Dive, each with the Dive
 * it came from. Answers the joined Recording and the append (whose row names the joined Recording, so that comes first).
 */
export async function buildJoined(
  tx: Tx, keptDiveId: string, parts: { recordingId: string; fromDiveId: string }[], userId: string | null,
): Promise<{ joinedId: string; appendId: string }> {
  const [existing] = await tx.select({ id: recording.id }).from(recording)
    .where(and(eq(recording.diveId, keptDiveId), eq(recording.parser, JOINED_PARSER), isNull(recording.deletedAt)));
  let joinedId = existing?.id;
  if (!joinedId) {
    const [first] = await tx.select().from(recording)
      .where(inArray(recording.id, parts.map((p) => p.recordingId))).orderBy(recording.startsAt).limit(1);
    // Its own id is in its key, so the row is made first; its values come from the parts below.
    const [made] = await tx.insert(recording).values({
      diveId: keptDiveId, deviceId: first!.deviceId, recordingKey: `${JOINED_PARSER}:${randomUUID()}`,
      parser: JOINED_PARSER, parserVersion: JOINED_PARSER_VERSION, startsAt: first!.startsAt, durationSeconds: first!.durationSeconds,
    }).returning({ id: recording.id });
    joinedId = made!.id;
    await tx.update(recording).set({ recordingKey: `${JOINED_PARSER}:${joinedId}` }).where(eq(recording.id, joinedId));
  }
  const [append] = await tx.insert(continuationAppend).values({ joinedRecordingId: joinedId, keptDiveId, userId }).returning({ id: continuationAppend.id });
  for (const part of parts) {
    await tx.update(recording).set({ joinedRecordingId: joinedId, appendId: append!.id, fromDiveId: part.fromDiveId, updatedAt: new Date() })
      .where(eq(recording.id, part.recordingId));
  }
  await writeJoined(tx, joinedId);
  return { joinedId, appendId: append!.id };
}

/**
 * Rebuilds the joined Recording from its parts; the Dive whose Primary recording it is follows it, with `extra` (the
 * caller's changes of the Dive that holds it) in the Revision. With one part left (an undo took the others back), the
 * joined Recording is deleted instead and that part is an ordinary Recording again, the Primary one where the joined one
 * was; values without Override follow it and Overrides stay. The caller ties Cylinders to that part first.
 */
export async function rebuildJoined(tx: Tx, joinedId: string, actor: Actor, cause: RevisionCause, extra: Changes = {}): Promise<void> {
  const [joined] = await tx.select().from(recording).where(eq(recording.id, joinedId));
  const parts = await partsOfJoined(tx, joined!);
  if (parts.length > 1) {
    await writeJoined(tx, joinedId);
    const [owner] = await tx.select({ id: dive.id }).from(dive).where(eq(dive.primaryRecordingId, joinedId));
    if (owner) await refreshFromPrimary(tx, owner.id, actor, cause, extra);
    else if (Object.keys(extra).length > 0) await reviseDive(tx, joined!.diveId!, actor, cause, extra);
    return;
  }
  const [last] = parts;
  const at = new Date();
  await tx.update(recording).set({ joinedRecordingId: null, appendId: null, fromDiveId: null, updatedAt: at }).where(eq(recording.id, last!.id));
  // A tombstone of its own: restoring its Dive later brings back the part, not the joined Recording.
  await tx.update(recording).set({ deletedAt: at, updatedAt: at }).where(eq(recording.id, joinedId));
  const [holder] = await tx.select().from(dive).where(eq(dive.id, joined!.diveId!)).for('update');
  const primary = holder!.primaryRecordingId === joinedId ? last!.id : holder!.primaryRecordingId;
  await followPrimary(tx, holder!, primary, actor, cause, { recordings: { from: joinedId, to: null }, ...extra });
}
