import { and, inArray, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { recording } from '../db/schema.js';

/**
 * A Recording that counts on its own (ADR 0063): not a part of a joined Recording. A joined Dive's parts stay live on it,
 * but the joined Recording stands for them in every count, as Primary, and when it is split off, moved or merged.
 */
export const isUnit = () => isNull(recording.joinedRecordingId);

/** The parser a joined Recording names (ADR 0063); the one mark of "joined" (the schema ties it to having no Original). */
export const JOINED_PARSER = 'continuation';
export const isJoined = (r: { parser: string }) => r.parser === JOINED_PARSER;

/** A Dive's one unit as the logbook checks see it (ADR 0063); `joined` for a Continuation's joined Recording. */
export interface RecordingUnit {
  deviceId: string;
  startsAt: Date;
  endsAt: Date;
  joined: boolean;
}

/**
 * Of these Dives, how many live units each has, and its unit when it has exactly one with a Device. Counted apart from
 * the Dives' own select: in a subquery of a one-table select the columns lose their table, and every Dive counted 0.
 */
export async function unitsOf(q: Queryable, diveIds: string[]): Promise<(diveId: string) => { recordings: number; unit: RecordingUnit | null }> {
  const rows = diveIds.length === 0 ? [] : await q.select({
    diveId: recording.diveId, deviceId: recording.deviceId, parser: recording.parser, startsAt: recording.startsAt, durationSeconds: recording.durationSeconds,
  }).from(recording).where(and(inArray(recording.diveId, diveIds), isNull(recording.deletedAt), isUnit()));
  const byDive = new Map<string, typeof rows>();
  for (const r of rows) byDive.set(r.diveId!, [...(byDive.get(r.diveId!) ?? []), r]);
  return (diveId) => {
    const own = byDive.get(diveId) ?? [];
    const [r] = own;
    return {
      recordings: own.length,
      unit: own.length === 1 && r!.deviceId ? {
        deviceId: r!.deviceId, startsAt: r!.startsAt, endsAt: new Date(r!.startsAt.getTime() + r!.durationSeconds * 1000), joined: isJoined(r!),
      } : null,
    };
  };
}
