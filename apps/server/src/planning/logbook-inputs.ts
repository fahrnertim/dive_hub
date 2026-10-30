// What the Diver's own logbook and the planned site say, for bottom time and gas plans (ADR 0032, 0033): read only for
// a Diver the User manages, and never stored.
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { cylinder, dive, diveSite, recording } from '../db/schema.js';
import { sacOfDive } from '../dives/sac.js';
import { PlanningError } from './planning-error.js';

/** How many of a Diver's latest Dives are looked through for the 20 that have a SAC. */
const SAC_LOOKBACK_DIVES = 100;
const RECENT_DIVE_HOURS = 48;

/** The SAC of each of a Diver's latest Dives, newest first: from its Cylinders, else a tank pod's on its Recording (ADR 0033). */
export async function diveSacs(reader: Queryable, diverId: string): Promise<{ sacLpm: number | null }[]> {
  const dives = await reader.select({ id: dive.id, durationSeconds: dive.durationSeconds, avgDepthM: dive.avgDepthM }).from(dive)
    .where(and(eq(dive.diverId, diverId), isNull(dive.deletedAt))).orderBy(desc(dive.startsAt)).limit(SAC_LOOKBACK_DIVES);
  if (dives.length === 0) return [];
  const ids = dives.map((d) => d.id);
  const cylinders = await reader.select().from(cylinder).where(inArray(cylinder.diveId, ids)).orderBy(cylinder.position);
  const recordings = await reader.select({ diveId: recording.diveId, summary: recording.summary }).from(recording)
    .where(and(inArray(recording.diveId, ids), isNull(recording.deletedAt))).orderBy(desc(recording.startsAt));
  return dives.map((d) => {
    const own = cylinders.filter((c) => c.diveId === d.id).map((c) => ({
      volumeL: c.volumeL, startPressureBar: c.startPressureBar, endPressureBar: c.endPressureBar,
      gas: c.o2 === null || c.he === null ? null : { o2: c.o2, he: c.he },
    }));
    const fromCylinders = sacOfDive(d, own).sac?.litresPerMinute;
    const fromPod = recordings.find((r) => r.diveId === d.id && r.summary.sacLpm !== undefined)?.summary.sacLpm;
    return { sacLpm: fromCylinders ?? fromPod ?? null };
  });
}

/** When the Diver's Dive within the last 48 hours ended, if there is one: the real limit is then shorter than shown. */
export async function recentDiveEnd(reader: Queryable, diverId: string): Promise<Date | null> {
  const now = Date.now();
  const dives = await reader.select({ startsAt: dive.startsAt, durationSeconds: dive.durationSeconds }).from(dive)
    .where(and(eq(dive.diverId, diverId), isNull(dive.deletedAt), gte(dive.startsAt, new Date(now - (RECENT_DIVE_HOURS + 12) * 3600_000))));
  let latest: Date | null = null;
  for (const d of dives) {
    const end = d.startsAt.getTime() + d.durationSeconds * 1000;
    if (end <= now && end >= now - RECENT_DIVE_HOURS * 3600_000 && (!latest || end > latest.getTime())) latest = new Date(end);
  }
  return latest;
}

/** The planned site's water; brackish counts as salt for the limit. */
export async function siteWaterOf(reader: Queryable, siteId: string | undefined): Promise<'fresh' | 'salt' | undefined> {
  if (!siteId) return undefined;
  const [site] = await reader.select({ waterType: diveSite.waterType }).from(diveSite).where(eq(diveSite.id, siteId));
  if (!site) throw new PlanningError('site_not_found');
  if (!site.waterType) return undefined;
  return site.waterType === 'fresh' ? 'fresh' : 'salt';
}
