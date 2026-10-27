// A Dive as it leaves Dive Hub (ADR 0027): the same values for every Provider, read once from the Dive, its Primary
// recording, Device, samples and site. Each adapter turns it into its own record.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { device, dive, diveSite, diverExternalId, recording, sampleSeries } from '../db/schema.js';
import { cylindersOf, providerCylinderOf } from '../dives/cylinders.js';
import { managedDiverIds, participantsOf } from '../dives/dive-service.js';
import { leadOf, leadTotalKg } from '../dives/weighting.js';
import { accountOf, idsOf, pickId } from '../sites/site-ids.js';
import { SITE_SOURCES, type SiteSource } from '../sites/sources.js';
import type { DiverSource, OutgoingDive, OutgoingParticipant, Series } from './provider.js';
import { listAccountOf, rememberedFor } from './list-entries.js';
import { ProviderServiceError } from './registry.js';

/** The sources whose accounts have a list of people of their own. */
const LIST_SOURCES: DiverSource[] = ['ssi'];

export type DiveRow = typeof dive.$inferSelect;

/**
 * The Dive site's ids at the services that know it, as a send for the Diver uses them (`pickId`: the remote dive's when
 * the Diver's account may use it, else the public one, else the account's private one), and its position and water.
 */
async function outgoingSite(db: Db | Tx, siteId: string | null, diverId: string, remoteSiteIds: Partial<Record<SiteSource, string>>) {
  const siteIds: Partial<Record<SiteSource, string>> = {};
  if (!siteId) return { siteIds, site: undefined };
  const accounts = Object.fromEntries(await Promise.all(SITE_SOURCES.map(async (s) => [s, await accountOf(db, diverId, s)] as const)));
  const rows = (await idsOf(db, [siteId], Object.values(accounts).filter((a): a is string => a !== null))).get(siteId) ?? [];
  for (const source of SITE_SOURCES) {
    const id = pickId(rows, source, accounts[source] ?? null, remoteSiteIds[source]);
    if (id !== null) siteIds[source] = id;
  }
  const [site] = await db.select({ latitude: diveSite.latitude, longitude: diveSite.longitude, waterType: diveSite.waterType }).from(diveSite).where(eq(diveSite.id, siteId));
  return { siteIds, site };
}

/** Who else was on the Dive, with their accounts at services: all an adapter may know of them (ADR 0029). */
async function outgoingParticipants(db: Db | Tx, diveId: string, ownerId: string): Promise<OutgoingParticipant[]> {
  const people = await participantsOf(db, diveId);
  const accounts = people.length === 0 ? [] : await db.select().from(diverExternalId)
    .where(inArray(diverExternalId.diverId, people.map((p) => p.diverId)));
  // The entries of the dive's own Diver's list at each source that has one (today SSI's buddy list).
  const remembered = new Map<DiverSource, Map<string, string>>();
  for (const source of LIST_SOURCES) {
    const account = await listAccountOf(db, ownerId, source);
    if (account) remembered.set(source, await rememberedFor(db, account, people.map((p) => p.diverId)));
  }
  return people.map((p) => {
    const entries = Object.fromEntries([...remembered].flatMap(([source, byDiver]) => (byDiver.has(p.diverId) ? [[source, byDiver.get(p.diverId)!]] : [])));
    return {
      ...p,
      ids: Object.fromEntries(accounts.filter((a) => a.diverId === p.diverId).map((a) => [a.source, a.externalId])) as Partial<Record<DiverSource, string>>,
      ...(Object.keys(entries).length > 0 && { entries }),
    };
  });
}

/**
 * The Dive and what leaves Dive Hub of it, if the User manages its Diver (else `dive_not_found`). A deleted Dive only
 * with `deleted`: its state and deleting it at a Provider still work (the reminder, ADR 0026), sending doesn't.
 * `remoteSiteIds`: the site IDs of the dive at the Provider, kept when the Diver's account may use them.
 */
export async function loadOutgoingDive(db: Db | Tx, userId: string, diveId: string, options: {
  deleted?: boolean; remoteSiteIds?: Partial<Record<SiteSource, string>>;
} = {}) {
  const [row] = await db.select().from(dive).where(and(eq(dive.id, diveId), options.deleted ? undefined : isNull(dive.deletedAt)));
  if (!row || !(await managedDiverIds(db, userId)).has(row.diverId)) throw new ProviderServiceError('dive_not_found');
  const [rec] = row.primaryRecordingId ? await db.select().from(recording).where(eq(recording.id, row.primaryRecordingId)) : [];
  const [dev] = rec?.deviceId ? await db.select().from(device).where(eq(device.id, rec.deviceId)) : [];
  const series = rec
    ? await db.select().from(sampleSeries).where(and(eq(sampleSeries.recordingId, rec.id), inArray(sampleSeries.channel, ['depth', 'temperature', 'ndl', 'tankPressure', 'heartRate', 'cns'])))
    : [];
  const channel = (name: string): Series | undefined => {
    const s = series.find((x) => x.channel === name);
    return s ? { offsetsMs: s.offsetsMs, values: s.values } : undefined;
  };
  const { siteIds, site } = await outgoingSite(db, row.siteId, row.diverId, options.remoteSiteIds ?? {});
  const participants = await outgoingParticipants(db, row.id, row.diverId);
  const summary = rec?.summary ?? {};
  // One tank only: with two or more Cylinders the Provider's one tank can't be told (ADR 0031, 0057).
  const cylinders = await cylindersOf(db, row.id);
  const tank = cylinders.length === 1 ? cylinders[0]! : null;
  const outgoing: OutgoingDive = {
    startsAt: row.startsAt, utcOffsetSeconds: row.utcOffsetSeconds, durationSeconds: row.durationSeconds,
    maxDepthM: row.maxDepthM, avgDepthM: row.avgDepthM, waterTemperatureC: row.waterTemperatureC,
    // The Dive's water is its site's (ADR 0025), not the computer's setting.
    maxTemperatureC: summary.maxTemperatureC ?? null, waterType: site?.waterType ?? null, notes: row.notes,
    siteIds,
    participants,
    entry: rec?.entryLatitude != null && rec.entryLongitude != null ? { latitude: rec.entryLatitude, longitude: rec.entryLongitude } : null,
    exit: rec?.exitLatitude != null && rec.exitLongitude != null ? { latitude: rec.exitLatitude, longitude: rec.exitLongitude } : null,
    gases: (summary.gases ?? []).map(({ o2, he }) => ({ o2, he })),
    gfLow: summary.gfLow ?? null, gfHigh: summary.gfHigh ?? null, cnsStart: summary.cnsStart ?? null, cnsEnd: summary.cnsEnd ?? null,
    device: dev ? { manufacturer: dev.manufacturer, product: dev.product, serialNumber: dev.serialNumber, firmware: dev.firmware } : null,
    samples: {
      depth: channel('depth'), temperature: channel('temperature'), ndl: channel('ndl'),
      tankPressure: channel('tankPressure'), heartRate: channel('heartRate'), cns: channel('cns'),
    },
    cylinder: tank && { ...providerCylinderOf(tank), workingPressureBar: tank.workingPressureBar },
    leadKg: leadTotalKg(await leadOf(db, row.id)),
    diveMode: summary.diveMode ?? null, surfaceIntervalSeconds: summary.surfaceIntervalSeconds ?? null, avgHeartRate: summary.avgHeartRate ?? null,
  };
  const sitePosition = site?.latitude != null && site.longitude != null ? { latitude: site.latitude, longitude: site.longitude } : null;
  // Where to look for the Provider's sites: the Dive site, else where the Device placed the dive.
  return {
    row, outgoing, position: sitePosition ?? outgoing.exit ?? outgoing.entry,
    /** The Dive's site for the requirements: whether it has a position (a send can then make it at the Provider). */
    site: row.siteId ? { id: row.siteId, positioned: sitePosition !== null } : null,
  };
}
