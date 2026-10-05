// Local wall-clock times without a time zone (a Provider's logbook, ADR 0030) as instants: the offset comes from the
// time zone at the dive's position (geo-tz: exact boundaries with territorial waters, `Etc/GMT±n` at sea; summer time
// from the date through Intl), else from the Diver's closest Dive within 7 days, else it stays unknown and the
// wall-clock time is kept as if it were UTC.
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { find } from 'geo-tz';
import type { Db, Tx } from '../db/client.js';
import { dive, type UtcOffsetSource } from '../db/schema.js';

export interface Position {
  latitude: number;
  longitude: number;
}

/** A start time placed in time: the instant, the offset at the dive (null when unknown), and where it came from. */
export interface PlacedTime {
  startsAt: Date;
  utcOffsetSeconds: number | null;
  utcOffsetSource: UtcOffsetSource;
}

/** How far the nearest Dive may be for its offset to count (ADR 0030). */
export const NEARBY_DAYS = 7;
const DAY_MS = 24 * 3600_000;
/** The widest offsets there are: a wall-clock time is at most this far from its instant. */
const MAX_OFFSET_MS = 14 * 3600_000;

/** "YYYY-MM-DD HH:MM[:SS]" (or with a T) as milliseconds since 1970, read as if it were UTC; null when it isn't one. */
export function wallClockMs(local: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local);
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  return Number.isFinite(ms) ? ms : null;
}

/** The IANA time zone at a position (the first, where a place has several), or null for a position that isn't one. */
export function zoneAt(p: Position): string | null {
  if (!(Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180)) return null;
  try {
    return find(p.latitude, p.longitude)[0] ?? null;
  } catch {
    return null;
  }
}

/** The zone's offset from UTC at an instant, in seconds (summer time included). */
export function offsetIn(zone: string, at: Date): number {
  const name = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2]! * 3600 + +m[3]! * 60) : 0;
}

/**
 * The instant a wall-clock time in a zone stands for. Around a change of summer time the offset before the change is
 * tried first, then the one after: a time that never happened (the hour skipped) moves on by the change.
 */
export function inZone(localMs: number, zone: string): { startsAt: Date; utcOffsetSeconds: number } {
  const first = offsetIn(zone, new Date(localMs));
  const at = localMs - first * 1000;
  const second = offsetIn(zone, new Date(at));
  if (second === first) return { startsAt: new Date(at), utcOffsetSeconds: first };
  const again = localMs - second * 1000;
  return offsetIn(zone, new Date(again)) === second
    ? { startsAt: new Date(again), utcOffsetSeconds: second }
    : { startsAt: new Date(at), utcOffsetSeconds: first };
}

/**
 * A wall-clock time as an instant (ADR 0030): from the first position that has a time zone (the dive's own, then its
 * site's), else the offset of the Diver's closest Dive within 7 days whose offset is known, else unknown (kept as if UTC).
 */
export async function placeLocalTime(
  tx: Tx | Db, diverId: string, localMs: number, positions: (Position | null | undefined)[],
): Promise<PlacedTime> {
  for (const p of positions) {
    const zone = p ? zoneAt(p) : null;
    if (zone) return { ...inZone(localMs, zone), utcOffsetSource: 'position' };
  }
  const near = await nearbyOffset(tx, diverId, localMs);
  if (near !== null) return { startsAt: new Date(localMs - near * 1000), utcOffsetSeconds: near, utcOffsetSource: 'nearby' };
  return { startsAt: new Date(localMs), utcOffsetSeconds: null, utcOffsetSource: 'unknown' };
}

/** The offset of the Diver's live Dive closest to this wall-clock time, within NEARBY_DAYS, whose offset is known. */
async function nearbyOffset(tx: Tx | Db, diverId: string, localMs: number): Promise<number | null> {
  const from = new Date(localMs - NEARBY_DAYS * DAY_MS - MAX_OFFSET_MS);
  const to = new Date(localMs + NEARBY_DAYS * DAY_MS + MAX_OFFSET_MS);
  const local = sql`${dive.startsAt} + make_interval(secs => ${dive.utcOffsetSeconds})`;
  const [closest] = await tx.select({ offset: dive.utcOffsetSeconds, distance: sql<number>`abs(extract(epoch from (${local} - ${new Date(localMs).toISOString()}::timestamptz)))` })
    .from(dive)
    .where(and(
      eq(dive.diverId, diverId), isNull(dive.deletedAt), isNotNull(dive.utcOffsetSeconds),
      sql`${dive.startsAt} between ${from.toISOString()}::timestamptz and ${to.toISOString()}::timestamptz`,
    ))
    .orderBy(sql`2`).limit(1);
  if (!closest || closest.offset === null || Number(closest.distance) > NEARBY_DAYS * 24 * 3600) return null;
  return closest.offset;
}
