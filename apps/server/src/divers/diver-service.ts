// The Divers a User manages, and their Devices (ADR 0016). Sharing a Diver with another User comes later.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { device, dive, diver, diverManagement, recording } from '../db/schema.js';
import { managedDiverIds } from '../dives/dive-service.js';
import { writeRevision } from '../dives/revisions.js';

export class DiverError extends Error {
  constructor(readonly code: 'diver_not_found' | 'own_diver' | 'diver_not_empty' | 'device_not_found') {
    super(code);
  }
}

export function createDiverService(db: Db) {
  async function managedOrThrow(userId: string, diverId: string) {
    const [row] = await db.select({ isOwn: diverManagement.isOwn }).from(diverManagement)
      .innerJoin(diver, eq(diver.id, diverManagement.diverId))
      .where(and(eq(diverManagement.userId, userId), eq(diverManagement.diverId, diverId), isNull(diver.deletedAt)));
    if (!row) throw new DiverError('diver_not_found');
    return row;
  }

  return {
    /** The User's Divers, own first, with how many Dives and Devices each has. */
    async list(userId: string) {
      return db.select({
        id: diver.id,
        name: diver.name,
        isOwn: diverManagement.isOwn,
        diveCount: sql<number>`(select count(*)::int from ${dive} where ${dive.diverId} = ${diver.id} and ${dive.deletedAt} is null)`,
        deviceCount: sql<number>`(select count(*)::int from ${device} where ${device.diverId} = ${diver.id} and ${device.deletedAt} is null)`,
      }).from(diverManagement)
        .innerJoin(diver, eq(diver.id, diverManagement.diverId))
        .where(and(eq(diverManagement.userId, userId), isNull(diver.deletedAt)))
        .orderBy(sql`${diverManagement.isOwn} desc`, diver.name);
    },

    /** A Diver whose logbook the User keeps (e.g. their child). */
    async create(userId: string, name: string) {
      return db.transaction(async (tx) => {
        const [created] = await tx.insert(diver).values({ name }).returning();
        await tx.insert(diverManagement).values({ userId, diverId: created!.id, isOwn: false });
        return created!;
      });
    },

    async rename(userId: string, diverId: string, name: string) {
      await managedOrThrow(userId, diverId);
      await db.update(diver).set({ name, updatedAt: new Date() }).where(eq(diver.id, diverId));
    },

    /** Only empty Divers go: no Dives, no Devices. The User's own Diver stays. */
    async remove(userId: string, diverId: string) {
      const { isOwn } = await managedOrThrow(userId, diverId);
      if (isOwn) throw new DiverError('own_diver');
      await db.transaction(async (tx) => {
        const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(dive).where(eq(dive.diverId, diverId));
        const [devices] = await tx.select({ n: sql<number>`count(*)::int` }).from(device).where(eq(device.diverId, diverId));
        if ((used?.n ?? 0) > 0 || (devices?.n ?? 0) > 0) throw new DiverError('diver_not_empty');
        await tx.delete(diverManagement).where(eq(diverManagement.diverId, diverId));
        await tx.delete(diver).where(eq(diver.id, diverId));
      });
    },

    /** Devices of the User's Divers, with how often and when they were last used. */
    async devices(userId: string) {
      const divers = [...(await managedDiverIds(db, userId))];
      if (divers.length === 0) return [];
      // A join, not correlated subqueries: in a single-table select Drizzle leaves columns
      // unqualified, so a subquery's `id` would mean the recording's own id.
      return db.select({
        id: device.id,
        manufacturer: device.manufacturer,
        product: device.product,
        serialNumber: device.serialNumber,
        firmware: device.firmware,
        diverId: device.diverId,
        recordingCount: sql<number>`count(${recording.id})::int`,
        lastUsedAt: sql<Date | null>`max(${recording.startsAt})`.mapWith(recording.startsAt),
      }).from(device)
        .leftJoin(recording, and(eq(recording.deviceId, device.id), isNull(recording.deletedAt)))
        .where(and(inArray(device.diverId, divers), isNull(device.deletedAt)))
        .groupBy(device.id)
        .orderBy(device.manufacturer, device.serialNumber);
    },

    /**
     * From now on, Imports from this Device go to `diverId`. Dives already recorded stay where they
     * are; single Dives can be moved (ADR 0016).
     */
    async assignDevice(userId: string, deviceId: string, diverId: string) {
      const managed = await managedDiverIds(db, userId);
      if (!managed.has(diverId)) throw new DiverError('diver_not_found');
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(device)
          .where(and(eq(device.id, deviceId), isNull(device.deletedAt))).for('update');
        if (!current || !managed.has(current.diverId)) throw new DiverError('device_not_found');
        if (current.diverId === diverId) return;
        await tx.update(device).set({ diverId, updatedAt: new Date() }).where(eq(device.id, deviceId));
        await writeRevision(tx, 'device', deviceId, { type: 'user', id: userId }, 'assign-device', {
          diverId: { from: current.diverId, to: diverId },
        });
      });
    },
  };
}

export type DiverService = ReturnType<typeof createDiverService>;
