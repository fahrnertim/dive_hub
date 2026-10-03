// Where a Dive was (ADR 0020): positions on Recordings, a Dive's site, and the Import's auto-link.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { dive, diveSite, recording } from '../db/schema.js';
import { writeRevision, type Actor } from '../dives/revisions.js';
import { nearSql, distanceSql, type Position } from './site-service.js';

/** An Import links a new Dive to a site only if it is the one site within this distance. */
export const AUTO_LINK_M = 200;

/** Recording columns for the positions a parser found; the Original counts as read for them. */
export function positionColumns(parsed: { entryPosition: Position | undefined; exitPosition: Position | undefined }) {
  return {
    entryLatitude: parsed.entryPosition?.latitude ?? null,
    entryLongitude: parsed.entryPosition?.longitude ?? null,
    exitLatitude: parsed.exitPosition?.latitude ?? null,
    exitLongitude: parsed.exitPosition?.longitude ?? null,
    positionsReadAt: new Date(),
  };
}

type RecordingPositions = Pick<typeof recording.$inferSelect, 'entryLatitude' | 'entryLongitude' | 'exitLatitude' | 'exitLongitude'>;

/** Where a Recording places the dive: the exit (where most Devices get a fix), else the entry. */
export function recordingPosition(r: RecordingPositions): Position | null {
  if (r.exitLatitude !== null && r.exitLongitude !== null) return { latitude: r.exitLatitude, longitude: r.exitLongitude };
  if (r.entryLatitude !== null && r.entryLongitude !== null) return { latitude: r.entryLatitude, longitude: r.entryLongitude };
  return null;
}

/** A site as Revisions record it: id and the name it had then, so the history stays readable. */
export type SiteRef = { id: string; name: string };

export async function siteRef(tx: Tx, siteId: string | null): Promise<SiteRef | null> {
  if (!siteId) return null;
  const [row] = await tx.select({ id: diveSite.id, name: diveSite.name }).from(diveSite).where(eq(diveSite.id, siteId));
  return row ?? null;
}

/** A site Users can still pick (not deleted), or null. */
export async function liveSite(tx: Tx, siteId: string): Promise<SiteRef | null> {
  const [row] = await tx.select({ id: diveSite.id, name: diveSite.name }).from(diveSite)
    .where(and(eq(diveSite.id, siteId), isNull(diveSite.deletedAt)));
  return row ?? null;
}

/**
 * After an Import created a Dive: if exactly one site lies within AUTO_LINK_M of the Recording's
 * position, the Dive is at that site (Revision, cause auto-site). With several or none, nothing happens.
 */
export async function linkNearbySite(tx: Tx, diveId: string, rec: RecordingPositions, actor: Actor): Promise<void> {
  const position = recordingPosition(rec);
  if (!position) return;
  const close = await tx.select({ id: diveSite.id, name: diveSite.name }).from(diveSite)
    .where(and(isNull(diveSite.deletedAt), nearSql(position, AUTO_LINK_M)))
    .orderBy(distanceSql(position)).limit(2);
  if (close.length !== 1) return;
  const site = close[0]!;
  await tx.update(dive).set({ siteId: site.id, version: sql`${dive.version} + 1`, updatedAt: new Date() }).where(eq(dive.id, diveId));
  await writeRevision(tx, 'dive', diveId, actor, 'auto-site', { site: { from: null, to: site } });
}
