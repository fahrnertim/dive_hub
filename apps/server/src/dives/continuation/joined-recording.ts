// A Continuation's joined Recording (ADR 0063): derived from its parts, with no Original and no key an import can match.
// This is the only writer of its row, its sample series and its events; it is rebuilt from the parts, never edited.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { continuationAppend, dive, recording, recordingEvent, sampleSeries } from '../../db/schema.js';
import { refreshFromPrimary } from '../dive-service.js';
import type { Actor, RevisionCause } from '../revisions.js';
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

/** Writes the joined Recording from its live parts: its values, and its series and events replaced. */
async function writeJoined(tx: Tx, joinedId: string): Promise<void> {
  const rows = await tx.select().from(recording)
    .where(and(eq(recording.joinedRecordingId, joinedId), isNull(recording.deletedAt))).orderBy(recording.startsAt);
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

/** Rebuilds the joined Recording from its live parts; the Dive whose Primary recording it is follows it. */
export async function rebuildJoined(tx: Tx, joinedId: string, actor: Actor, cause: RevisionCause): Promise<void> {
  await writeJoined(tx, joinedId);
  const [owner] = await tx.select({ id: dive.id }).from(dive).where(eq(dive.primaryRecordingId, joinedId));
  if (owner) await refreshFromPrimary(tx, owner.id, actor, cause);
}
