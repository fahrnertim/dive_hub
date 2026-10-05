// A Dive as it leaves Dive Hub (ADR 0027): the same values for every Provider, read once from the Dive, its Primary
// recording, Device, samples and site. Each adapter turns it into its own record.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { device, dive, diveSite, diveSiteExternalId, recording, sampleSeries } from '../db/schema.js';
import { managedDiverIds } from '../dives/dive-service.js';
import type { SiteSource } from '../sites/sources.js';
import type { OutgoingDive, Series } from './provider.js';
import { ProviderServiceError } from './registry.js';

export type DiveRow = typeof dive.$inferSelect;

/**
 * The Dive and what leaves Dive Hub of it, if the User manages its Diver (else `dive_not_found`). A deleted Dive only
 * with `deleted`: its state and deleting it at a Provider still work (the reminder, ADR 0026), sending doesn't.
 */
export async function loadOutgoingDive(db: Db, userId: string, diveId: string, options: { deleted?: boolean } = {}) {
  const [row] = await db.select().from(dive).where(and(eq(dive.id, diveId), options.deleted ? undefined : isNull(dive.deletedAt)));
  if (!row || !(await managedDiverIds(db, userId)).has(row.diverId)) throw new ProviderServiceError('dive_not_found');
  const [rec] = row.primaryRecordingId ? await db.select().from(recording).where(eq(recording.id, row.primaryRecordingId)) : [];
  const [dev] = rec?.deviceId ? await db.select().from(device).where(eq(device.id, rec.deviceId)) : [];
  const series = rec
    ? await db.select().from(sampleSeries).where(and(eq(sampleSeries.recordingId, rec.id), inArray(sampleSeries.channel, ['depth', 'temperature', 'ndl'])))
    : [];
  const channel = (name: string): Series | undefined => {
    const s = series.find((x) => x.channel === name);
    return s ? { offsetsMs: s.offsetsMs, values: s.values } : undefined;
  };
  const siteIds = row.siteId
    ? Object.fromEntries((await db.select({ source: diveSiteExternalId.source, externalId: diveSiteExternalId.externalId })
      .from(diveSiteExternalId).where(eq(diveSiteExternalId.siteId, row.siteId))).map((r) => [r.source, r.externalId])) as Partial<Record<SiteSource, string>>
    : {};
  const [site] = row.siteId
    ? await db.select({ latitude: diveSite.latitude, longitude: diveSite.longitude, waterType: diveSite.waterType }).from(diveSite).where(eq(diveSite.id, row.siteId))
    : [];
  const summary = rec?.summary ?? {};
  const outgoing: OutgoingDive = {
    startsAt: row.startsAt, utcOffsetSeconds: row.utcOffsetSeconds, durationSeconds: row.durationSeconds,
    maxDepthM: row.maxDepthM, avgDepthM: row.avgDepthM, waterTemperatureC: row.waterTemperatureC,
    // The Dive's water is its site's (ADR 0025), not the computer's setting.
    maxTemperatureC: summary.maxTemperatureC ?? null, waterType: site?.waterType ?? null, notes: row.notes,
    siteIds,
    entry: rec?.entryLatitude != null && rec.entryLongitude != null ? { latitude: rec.entryLatitude, longitude: rec.entryLongitude } : null,
    exit: rec?.exitLatitude != null && rec.exitLongitude != null ? { latitude: rec.exitLatitude, longitude: rec.exitLongitude } : null,
    gases: (summary.gases ?? []).map(({ o2, he }) => ({ o2, he })),
    gfLow: summary.gfLow ?? null, gfHigh: summary.gfHigh ?? null, cnsStart: summary.cnsStart ?? null, cnsEnd: summary.cnsEnd ?? null,
    device: dev ? { manufacturer: dev.manufacturer, product: dev.product, serialNumber: dev.serialNumber, firmware: dev.firmware } : null,
    samples: { depth: channel('depth'), temperature: channel('temperature'), ndl: channel('ndl') },
  };
  const sitePosition = site?.latitude != null && site.longitude != null ? { latitude: site.latitude, longitude: site.longitude } : null;
  // Where to look for the Provider's sites: the Dive site, else where the Device placed the dive.
  return { row, outgoing, position: sitePosition ?? outgoing.exit ?? outgoing.entry };
}
