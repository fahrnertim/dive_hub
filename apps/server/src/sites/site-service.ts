// Dive sites, shared by every User of the instance (ADR 0020): anyone creates and edits them (with
// optimistic locking and Revisions), their creator or an admin deletes them while no Dive is there.
import { and, asc, eq, ilike, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { dive, diveSite } from '../db/schema.js';
import { writeRevision, type Changes } from '../dives/revisions.js';

export class SiteError extends Error {
  constructor(readonly code: 'site_not_found' | 'site_changed' | 'site_in_use' | 'site_not_deletable') {
    super(code);
  }
}

/** WGS84 degrees. */
export interface Position {
  latitude: number;
  longitude: number;
}

/** The signed-in User as far as sites care: who they are and whether they are an admin. */
export interface SiteActor {
  userId: string;
  isAdmin: boolean;
}

export interface SiteInput {
  name: string;
  position: Position | null;
  country: string | null;
  waterBody: string | null;
  description: string | null;
}

/** Mean Earth radius in metres (IUGG), for the haversine distance. */
const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_DEGREE = (Math.PI * EARTH_RADIUS_M) / 180;

/** A number parameter as double precision (untyped, `2 * $1` would be integer arithmetic). */
const float = (v: number) => sql`${v}::float8`;

/** Great-circle distance in metres from a position to a site's position, in SQL. */
export function distanceSql(from: Position): SQL<number> {
  const rad = (v: SQLWrapper | number) => sql`radians(${typeof v === 'number' ? float(v) : v})`;
  return sql<number>`(2 * ${float(EARTH_RADIUS_M)} * asin(sqrt(
    power(sin((${rad(diveSite.latitude)} - ${rad(from.latitude)}) / 2), 2)
    + cos(${rad(from.latitude)}) * cos(${rad(diveSite.latitude)}) * power(sin((${rad(diveSite.longitude)} - ${rad(from.longitude)}) / 2), 2)
  )))`.mapWith(Number);
}

/**
 * Sites within `withinM` metres: a bounding box the position index can use, then the exact distance.
 * Near the poles or across the date line the box only limits latitude.
 */
export function nearSql(from: Position, withinM: number): SQL {
  const dLat = withinM / METRES_PER_DEGREE;
  const cosLat = Math.cos((from.latitude * Math.PI) / 180);
  const dLon = cosLat > 0.01 ? dLat / cosLat : 360;
  const box = [
    sql`${diveSite.latitude} between ${float(from.latitude - dLat)} and ${float(from.latitude + dLat)}`,
    ...(from.longitude - dLon >= -180 && from.longitude + dLon <= 180
      ? [sql`${diveSite.longitude} between ${float(from.longitude - dLon)} and ${float(from.longitude + dLon)}`] : []),
  ];
  return and(...box, sql`${distanceSql(from)} <= ${float(withinM)}`)!;
}

const live = isNull(diveSite.deletedAt);

/** Sites within this distance of a Dive's position are offered on the dive page. */
export const NEARBY_M = 2000;

export function createSiteService(db: Db) {
  /**
   * The columns every site view needs, for the signed-in User. The subqueries name their tables: in a
   * single-table select Drizzle leaves columns unqualified, so `${dive.siteId}` would be ambiguous.
   */
  const columns = (actor: SiteActor) => ({
    site: diveSite,
    /** How many of this User's Dives are at the site (other Users' Dives stay private). */
    diveCount: sql<number>`(select count(*)::int from dive d
      join diver_management m on m.diver_id = d.diver_id and m.user_id = ${actor.userId}
      where d.site_id = "dive_site"."id" and d.deleted_at is null)`.mapWith(Number),
    inUse: sql<boolean>`exists (select 1 from dive d where d.site_id = "dive_site"."id" and d.deleted_at is null)`,
  });

  const view = (actor: SiteActor, row: { site: typeof diveSite.$inferSelect; diveCount: number; inUse: boolean; distanceM?: number }) => ({
    ...row,
    canDelete: actor.isAdmin || row.site.createdBy === actor.userId,
  });

  async function lock(tx: Tx, id: string) {
    const [row] = await tx.select().from(diveSite).where(and(eq(diveSite.id, id), live)).for('update');
    if (!row) throw new SiteError('site_not_found');
    return row;
  }

  const fields = (site: typeof diveSite.$inferSelect): SiteInput => ({
    name: site.name,
    position: site.latitude === null || site.longitude === null ? null : { latitude: site.latitude, longitude: site.longitude },
    country: site.country, waterBody: site.waterBody, description: site.description,
  });

  const toColumns = (input: Partial<SiteInput>) => {
    const { position, ...rest } = input;
    return {
      ...rest,
      ...(position !== undefined && { latitude: position?.latitude ?? null, longitude: position?.longitude ?? null }),
    };
  };

  return {
    /** Sites by name, or by distance from `near` (within `withinM` metres); `q` searches name and body of water. */
    async list(actor: SiteActor, options: { q?: string | undefined; near?: { position: Position; withinM: number } | undefined; limit?: number }) {
      const text = options.q?.trim();
      const pattern = text && `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const near = options.near;
      const where = and(
        live,
        pattern ? or(ilike(diveSite.name, pattern), ilike(diveSite.waterBody, pattern)) : undefined,
        near ? nearSql(near.position, near.withinM) : undefined,
      );
      const distance = near ? distanceSql(near.position) : undefined;
      const rows = await db.select({ ...columns(actor), ...(distance && { distanceM: distance }) })
        .from(diveSite).where(where)
        .orderBy(...(distance ? [asc(distance)] : []), sql`lower(${diveSite.name})`, diveSite.id)
        .limit(options.limit ?? 500);
      return rows.map((r) => view(actor, r));
    },

    async get(actor: SiteActor, id: string) {
      const [row] = await db.select(columns(actor)).from(diveSite).where(and(eq(diveSite.id, id), live));
      if (!row) throw new SiteError('site_not_found');
      return view(actor, row);
    },

    async create(actor: SiteActor, input: SiteInput) {
      return db.transaction(async (tx) => {
        const { position, ...rest } = input;
        const [created] = await tx.insert(diveSite).values({
          ...rest, latitude: position?.latitude ?? null, longitude: position?.longitude ?? null, createdBy: actor.userId,
        }).returning();
        const changes: Changes = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, { from: null, to: v }]));
        await writeRevision(tx, 'dive_site', created!.id, { type: 'user', id: actor.userId }, 'create', changes);
        return created!.id;
      });
    },

    /** Any User may edit; `version` is the one they started from (409 site_changed otherwise). */
    async edit(actor: SiteActor, id: string, version: number, input: Partial<SiteInput>) {
      await db.transaction(async (tx) => {
        const current = await lock(tx, id);
        if (current.version !== version) throw new SiteError('site_changed');
        const before = fields(current);
        const changes: Changes = {};
        for (const [key, to] of Object.entries(input) as [keyof SiteInput, unknown][]) {
          if (to !== undefined && JSON.stringify(before[key]) !== JSON.stringify(to)) changes[key] = { from: before[key], to };
        }
        if (Object.keys(changes).length === 0) return;
        await tx.update(diveSite)
          .set({ ...toColumns(input), version: sql`${diveSite.version} + 1`, updatedAt: new Date() })
          .where(eq(diveSite.id, id));
        await writeRevision(tx, 'dive_site', id, { type: 'user', id: actor.userId }, 'edit', changes);
      });
    },

    /** The creator or an admin, and only while no Dive (of any User) is at the site. */
    async remove(actor: SiteActor, id: string) {
      await db.transaction(async (tx) => {
        const current = await lock(tx, id);
        if (!actor.isAdmin && current.createdBy !== actor.userId) throw new SiteError('site_not_deletable');
        const [used] = await tx.select({ id: dive.id }).from(dive).where(and(eq(dive.siteId, id), isNull(dive.deletedAt))).limit(1);
        if (used) throw new SiteError('site_in_use');
        await tx.update(diveSite).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(diveSite.id, id));
        await writeRevision(tx, 'dive_site', id, { type: 'user', id: actor.userId }, 'delete', { deletedAt: { from: null, to: new Date().toISOString() } });
      });
    },
  };
}

export type SiteService = ReturnType<typeof createSiteService>;
