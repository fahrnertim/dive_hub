// Divers (ADR 0016, 0028): the Divers a User manages and their Devices; every Diver of the instance found by name;
// external Divers (no managing User), shared like Dive sites; a Diver's accounts at services set by hand.
import { and, eq, ilike, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  connection, device, dive, diver, diverExternalId, diverManagement, participant, recording,
} from '../db/schema.js';
import { managedDiverIds } from '../dives/dive-service.js';
import { writeRevision } from '../dives/revisions.js';
import { mergeExternalDiver } from './merge.js';
import type { DiverSource } from '../providers/provider.js';

export class DiverError extends Error {
  constructor(
    readonly code:
      | 'diver_not_found' | 'own_diver' | 'diver_not_empty' | 'device_not_found' | 'diver_in_use' | 'diver_not_deletable'
      | 'diver_not_editable' | 'diver_external_id_taken' | 'diver_external_id_connected' | 'invalid_input' | 'diver_not_external',
    /** The Diver that already has an account (`diver_external_id_taken`), so a client can offer to use it instead. */
    readonly diver?: { id: string; name: string },
  ) {
    super(code);
  }
}

/** The signed-in User as far as shared Divers care (as for Dive sites). */
export interface DiverActor {
  userId: string;
  isAdmin: boolean;
}

/** What an account at each service looks like (ADR 0024): SSI's user master ID; PADI's isn't known yet. */
const ACCOUNT_PATTERN: Record<DiverSource, RegExp> = { ssi: /^[1-9]\d{0,9}$/, padi: /^[A-Za-z0-9-]{1,40}$/ };

/** The key an account has in a Diver's history: `ssiAccount`, `padiAccount`. */
const accountKey = (source: DiverSource) => `${source}Account`;

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Not deleted. */
const live = isNull(diver.deletedAt);
/**
 * The Diver row in subqueries. Named, not `${diver.id}`: in a single-table select Drizzle leaves columns unqualified,
 * so `id` would mean the subquery's own table's.
 */
const diverId = sql.raw('"diver"."id"');
/** No User manages it: an external Diver (ADR 0028). */
const unmanaged = sql`not exists (select 1 from ${diverManagement} m where m.diver_id = ${diverId})`;

export function createDiverService(db: Db) {
  async function managedOrThrow(userId: string, diverId: string) {
    const [row] = await db.select({ isOwn: diverManagement.isOwn }).from(diverManagement)
      .innerJoin(diver, eq(diver.id, diverManagement.diverId))
      .where(and(eq(diverManagement.userId, userId), eq(diverManagement.diverId, diverId), live));
    if (!row) throw new DiverError('diver_not_found');
    return row;
  }

  async function externalOrThrow(id: string) {
    const [row] = await db.select().from(diver).where(and(eq(diver.id, id), live, unmanaged));
    if (!row) throw new DiverError('diver_not_found');
    return row;
  }

  /** External Divers with what a User may see of them: their name, which services they have accounts at, use. */
  const externalColumns = (actor: DiverActor) => ({
    id: diver.id,
    name: diver.name,
    accounts: sql<DiverSource[]>`coalesce((select array_agg(e.source::text order by e.source) from ${diverExternalId} e where e.diver_id = ${diverId}), '{}')`,
    inUse: sql<boolean>`exists (select 1 from ${participant} p where p.diver_id = ${diverId})`,
    canDelete: sql<boolean>`(${actor.isAdmin}::boolean or coalesce(${diver.createdBy} = ${actor.userId}, false))`,
  });

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
        .where(and(eq(diverManagement.userId, userId), live))
        .orderBy(sql`${diverManagement.isOwn} desc`, diver.name);
    },

    /**
     * Every Diver of the instance whose name matches (ADR 0028), the User's own first: id, name, whether the User
     * manages it and whether it is external. Nothing else of another User's Diver.
     */
    async search(userId: string, q: string | undefined, limit: number) {
      const text = q?.trim();
      const managed = sql<boolean>`exists (select 1 from ${diverManagement} m where m.diver_id = ${diverId} and m.user_id = ${userId})`;
      return db.select({ id: diver.id, name: diver.name, managed, external: sql<boolean>`${unmanaged}` }).from(diver)
        .where(and(live, text ? ilike(diver.name, like(text)) : undefined))
        .orderBy(sql`${managed} desc`, sql`lower(${diver.name})`, diver.id)
        .limit(limit);
    },

    /**
     * Admins: merges an external Diver into another Diver, the same person (ADR 0028, amended), e.g. a buddy without an
     * account at a Provider who became a User. Its places on Dives and its accounts move; it is deleted.
     */
    async mergeExternal(actor: DiverActor, fromId: string, intoId: string) {
      if (!actor.isAdmin) throw new DiverError('diver_not_editable');
      return db.transaction((tx) => mergeExternalDiver(tx, fromId, intoId, { type: 'user', id: actor.userId }));
    },

    /** A Diver whose logbook the User keeps (e.g. their child). */
    async create(userId: string, name: string) {
      return db.transaction(async (tx) => {
        const [created] = await tx.insert(diver).values({ name, createdBy: userId }).returning();
        await tx.insert(diverManagement).values({ userId, diverId: created!.id, isOwn: false });
        return created!;
      });
    },

    async rename(userId: string, diverId: string, name: string) {
      await managedOrThrow(userId, diverId);
      await db.update(diver).set({ name, updatedAt: new Date() }).where(eq(diver.id, diverId));
    },

    /** Only empty Divers go: no Dives, no Devices, on no Dive. The User's own Diver stays. */
    async remove(userId: string, diverId: string) {
      const { isOwn } = await managedOrThrow(userId, diverId);
      if (isOwn) throw new DiverError('own_diver');
      await db.transaction(async (tx) => {
        const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(dive).where(eq(dive.diverId, diverId));
        const [devices] = await tx.select({ n: sql<number>`count(*)::int` }).from(device).where(eq(device.diverId, diverId));
        const [on] = await tx.select({ n: sql<number>`count(*)::int` }).from(participant).where(eq(participant.diverId, diverId));
        if ((used?.n ?? 0) > 0 || (devices?.n ?? 0) > 0 || (on?.n ?? 0) > 0) throw new DiverError('diver_not_empty');
        // Its accounts at Targets go with it, and so do the User's Connections for it (ADR 0024).
        await tx.delete(connection).where(eq(connection.diverId, diverId));
        await tx.delete(diverExternalId).where(eq(diverExternalId.diverId, diverId));
        await tx.delete(diverManagement).where(eq(diverManagement.diverId, diverId));
        await tx.delete(diver).where(eq(diver.id, diverId));
      });
    },

    /** One page of external Divers whose name matches, and how many match. */
    async externals(actor: DiverActor, options: { q?: string | undefined; limit: number; offset: number }) {
      const text = options.q?.trim();
      const where = and(live, unmanaged, text ? ilike(diver.name, like(text)) : undefined);
      const [rows, [count]] = await Promise.all([
        db.select(externalColumns(actor)).from(diver).where(where)
          .orderBy(sql`lower(${diver.name})`, diver.id).limit(options.limit).offset(options.offset),
        db.select({ total: sql<number>`count(*)::int`.mapWith(Number) }).from(diver).where(where),
      ]);
      return { divers: rows, total: count?.total ?? 0 };
    },

    async external(actor: DiverActor, id: string) {
      const [row] = await db.select(externalColumns(actor)).from(diver).where(and(eq(diver.id, id), live, unmanaged));
      if (!row) throw new DiverError('diver_not_found');
      return row;
    },

    /** Someone a User dived with, not managed by anyone (ADR 0028); any User may. */
    async createExternal(actor: DiverActor, name: string, account?: { source: DiverSource; externalId: string }) {
      return db.transaction(async (tx) => {
        const [created] = await tx.insert(diver).values({ name, createdBy: actor.userId }).returning({ id: diver.id });
        if (account) await tx.insert(diverExternalId).values({ diverId: created!.id, ...account });
        await writeRevision(tx, 'diver', created!.id, { type: 'user', id: actor.userId }, 'create', {
          name: { from: null, to: name }, ...(account && { [accountKey(account.source)]: { from: null, to: account.externalId } }),
        });
        return created!.id;
      });
    },

    /** Any User renames an external Diver, with a Revision. */
    async renameExternal(actor: DiverActor, id: string, name: string) {
      const current = await externalOrThrow(id);
      if (current.name === name) return;
      await db.transaction(async (tx) => {
        await tx.update(diver).set({ name, updatedAt: new Date() }).where(eq(diver.id, id));
        await writeRevision(tx, 'diver', id, { type: 'user', id: actor.userId }, 'edit', { name: { from: current.name, to: name } });
      });
    },

    /** Its creator or an admin, while no Dive lists it. */
    async removeExternal(actor: DiverActor, id: string) {
      const current = await externalOrThrow(id);
      if (!actor.isAdmin && current.createdBy !== actor.userId) throw new DiverError('diver_not_deletable');
      await db.transaction(async (tx) => {
        const [on] = await tx.select({ diveId: participant.diveId }).from(participant).where(eq(participant.diverId, id)).limit(1);
        if (on) throw new DiverError('diver_in_use');
        // Its accounts go, so another Diver can have them; the row stays for the history.
        await tx.delete(diverExternalId).where(eq(diverExternalId.diverId, id));
        const at = new Date();
        await tx.update(diver).set({ deletedAt: at, updatedAt: at }).where(eq(diver.id, id));
        await writeRevision(tx, 'diver', id, { type: 'user', id: actor.userId }, 'delete', { deletedAt: { from: null, to: at.toISOString() } });
      });
    },

    /**
     * Sets or clears a Diver's account at a service (ADR 0028): an external Diver's by any User, a managed one's by
     * its Users. Refused while a Connection of the Diver uses the account, and when another Diver has it.
     */
    async setExternalId(actor: DiverActor, diverId: string, source: DiverSource, externalId: string | null) {
      if (externalId !== null && !ACCOUNT_PATTERN[source].test(externalId)) throw new DiverError('invalid_input');
      await db.transaction(async (tx) => {
        const [target] = await tx.select({ id: diver.id }).from(diver).where(and(eq(diver.id, diverId), live)).for('update');
        if (!target) throw new DiverError('diver_not_found');
        const managers = await tx.select({ userId: diverManagement.userId }).from(diverManagement).where(eq(diverManagement.diverId, diverId));
        if (managers.length > 0 && !managers.some((m) => m.userId === actor.userId)) throw new DiverError('diver_not_editable');
        const [current] = await tx.select().from(diverExternalId)
          .where(and(eq(diverExternalId.diverId, diverId), eq(diverExternalId.source, source)));
        const from = current?.externalId ?? null;
        if (from === externalId) return;
        if (from !== null) {
          const [connected] = await tx.select({ id: connection.id }).from(connection)
            .where(and(eq(connection.diverId, diverId), eq(connection.accountId, from)));
          if (connected) throw new DiverError('diver_external_id_connected');
        }
        if (externalId !== null) {
          const [taken] = await tx.select({ id: diver.id, name: diver.name }).from(diverExternalId)
            .innerJoin(diver, eq(diver.id, diverExternalId.diverId))
            .where(and(eq(diverExternalId.source, source), eq(diverExternalId.externalId, externalId), ne(diverExternalId.diverId, diverId)));
          if (taken) throw new DiverError('diver_external_id_taken', taken);
        }
        await tx.delete(diverExternalId).where(and(eq(diverExternalId.diverId, diverId), eq(diverExternalId.source, source)));
        if (externalId !== null) await tx.insert(diverExternalId).values({ diverId, source, externalId });
        await writeRevision(tx, 'diver', diverId, { type: 'user', id: actor.userId }, 'edit', { [accountKey(source)]: { from, to: externalId } });
      });
    },

    /** The Divers with these accounts at a service, by account. */
    async byAccounts(source: DiverSource, accounts: string[]) {
      if (accounts.length === 0) return new Map<string, { id: string; name: string }>();
      const rows = await db.select({ account: diverExternalId.externalId, id: diver.id, name: diver.name }).from(diverExternalId)
        .innerJoin(diver, eq(diver.id, diverExternalId.diverId))
        .where(and(eq(diverExternalId.source, source), inArray(diverExternalId.externalId, accounts), live));
      return new Map(rows.map((r) => [r.account, { id: r.id, name: r.name }]));
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
