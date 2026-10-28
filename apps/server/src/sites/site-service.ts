// Dive sites, shared by every User of the instance (ADR 0020): anyone creates and edits them (with
// optimistic locking and Revisions), their creator or an admin deletes them while no Dive is there.
// Any User can take up the data a Source offers for a hand-made site (ADR 0025).
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { dive, diveCentreSite, diveSite, revision, siteImport } from '../db/schema.js';
import { writeRevision, type Changes } from '../dives/revisions.js';
import { noteSiteChange } from '../providers/waiting-push-queue.js';
import type { Position, SiteWaterType } from '../vocabulary.js';
import { IMPORTED_FIELDS, type ImportedValues } from './import/site-source.js';
import { isUniqueViolation, SiteError } from './site-error.js';
import { accountsOfUser, clearId, diversOf, idsOf, moveIds, storeId, takeOffer } from './site-ids.js';
import { revisionKey, SITE_SOURCES, SOURCE_INFO, typedId, type SiteSource } from './sources.js';

export { isUniqueViolation, SiteError };

export type { Position };

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
  maxDepthM: number | null;
  /** Fresh, salt or brackish (ADR 0025): every Dive at the site has this water type. */
  waterType: SiteWaterType | null;
}

/** An External ID as the site's columns carry it; `SOURCE_INFO` says what it means. */
export interface ExternalIdRow {
  source: SiteSource;
  externalId: string;
  providesData: boolean;
  /** A reference's values from its Source, which a User can take up ("Use SSI's data", ADR 0025); else null. */
  offered: ImportedValues | null;
  /** Null: public. Else private to this Diver's account at the Source, shown only to the Users who manage the Diver. */
  privateTo: { diverId: string } | null;
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

/** Neither deleted nor merged: a merge also sets `deletedAt`, so lists, the picker and auto-links skip merged sites. */
const live = isNull(diveSite.deletedAt);

export const SITE_SORTS = ['name', 'country', 'diveCount'] as const;
export type SiteSort = (typeof SITE_SORTS)[number];

/** Fields a merge fills on the kept site where it has nothing (ADR 0022); External IDs move on their own. */
const FILLED = ['position', 'country', 'waterBody', 'description', 'maxDepthM', 'waterType'] as const;

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

  /**
   * The sites as the User sees them: with their public IDs and the private IDs of the accounts of the Divers the User
   * manages (never another account's), by Source, public first.
   */
  async function views<R extends { site: typeof diveSite.$inferSelect; diveCount: number; inUse: boolean; distanceM?: number }>(actor: SiteActor, rows: R[]) {
    const accounts = await accountsOfUser(db, actor.userId);
    const [ids, divers] = await Promise.all([idsOf(db, rows.map((r) => r.site.id), accounts), diversOf(db, accounts)]);
    const order = (a: { source: SiteSource; accountId: string | null }, b: { source: SiteSource; accountId: string | null }) =>
      SITE_SOURCES.indexOf(a.source) - SITE_SOURCES.indexOf(b.source) || Number(a.accountId !== null) - Number(b.accountId !== null)
      || (a.accountId ?? '').localeCompare(b.accountId ?? '');
    return rows.map((row) => ({
      ...row,
      externalIds: (ids.get(row.site.id) ?? []).sort(order).map((e): ExternalIdRow => ({
        source: e.source, externalId: e.externalId, providesData: e.providesData, offered: e.providesData ? null : e.imported,
        privateTo: e.accountId === null ? null : { diverId: divers.get(e.accountId)! },
      })),
      canDelete: actor.isAdmin || row.site.createdBy === actor.userId,
    }));
  }

  async function lock(tx: Tx, id: string) {
    const [row] = await tx.select().from(diveSite).where(and(eq(diveSite.id, id), live)).for('update');
    if (!row) throw new SiteError('site_not_found');
    return row;
  }

  const fields = (site: typeof diveSite.$inferSelect): SiteInput => ({
    name: site.name,
    position: site.latitude === null || site.longitude === null ? null : { latitude: site.latitude, longitude: site.longitude },
    country: site.country, waterBody: site.waterBody, description: site.description, maxDepthM: site.maxDepthM,
    waterType: site.waterType,
  });

  const toColumns = (input: Partial<SiteInput>) => {
    const { position, ...rest } = input;
    return {
      ...rest,
      ...(position !== undefined && { latitude: position?.latitude ?? null, longitude: position?.longitude ?? null }),
    };
  };

  return {
    /**
     * One page of sites and how many match (ADR 0022): by name (default), country or the User's dives there;
     * near a position, nearest first. `q` searches name and body of water; `mine` keeps sites with the User's dives.
     */
    async list(actor: SiteActor, options: {
      q?: string | undefined; near?: { position: Position; withinM: number } | undefined; country?: string | undefined;
      mine?: boolean | undefined; sort?: SiteSort | undefined; order?: 'asc' | 'desc' | undefined; limit?: number | undefined; offset?: number | undefined;
    }) {
      const text = options.q?.trim();
      const pattern = text && `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const near = options.near;
      const cols = columns(actor);
      const where = and(
        live,
        pattern ? or(ilike(diveSite.name, pattern), ilike(diveSite.waterBody, pattern)) : undefined,
        near ? nearSql(near.position, near.withinM) : undefined,
        options.country ? eq(diveSite.country, options.country) : undefined,
        options.mine ? sql`${cols.diveCount} > 0` : undefined,
      );
      const distance = near ? distanceSql(near.position) : undefined;
      const desc_ = options.order === 'desc';
      const sortBy: SQL[] = distance ? [asc(distance)]
        : options.sort === 'country' ? [sql`${diveSite.country} ${sql.raw(desc_ ? 'desc' : 'asc')} nulls last`]
        : options.sort === 'diveCount' ? [sql`${cols.diveCount} ${sql.raw(desc_ ? 'desc' : 'asc')}`]
        : desc_ ? [sql`lower(${diveSite.name}) desc`] : [];
      const [rows, [count]] = await Promise.all([
        db.select({ ...cols, ...(distance && { distanceM: distance }) })
          .from(diveSite).where(where)
          .orderBy(...sortBy, sql`lower(${diveSite.name})`, diveSite.id)
          .limit(options.limit ?? 50).offset(options.offset ?? 0),
        db.select({ total: sql<number>`count(*)::int`.mapWith(Number) }).from(diveSite).where(where),
      ]);
      return { sites: await views(actor, rows), total: count?.total ?? 0 };
    },

    /** One site; a merged one too, so its links can lead to the site it was merged into (`mergedInto`). */
    async get(actor: SiteActor, id: string) {
      const [row] = await db.select(columns(actor)).from(diveSite)
        .where(and(eq(diveSite.id, id), or(live, isNotNull(diveSite.mergedInto))));
      if (!row) throw new SiteError('site_not_found');
      return (await views(actor, [row]))[0]!;
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
        // The name and position go out with each Dive there (ADR 0056).
        if (changes.name || changes.position) await noteSiteChange(tx, id, new Date());
      });
    },

    /**
     * Merges site `id` into `intoId` (ADR 0022). Any User may. The kept site keeps its values and fills its gaps
     * from the merged one; Dives move (a Revision by the system each, so no User is named in a Dive's history);
     * External IDs move where the kept site has none of the same Source and account (a private one without a mention in
     * the Revision: site history is shared); earlier merges are re-pointed.
     */
    async merge(actor: SiteActor, id: string, version: number, intoId: string, intoVersion: number) {
      if (id === intoId) throw new SiteError('site_merge_self');
      await db.transaction(async (tx) => {
        // Locked in id order, so two opposite merges can't deadlock.
        const [first, second] = id < intoId ? [id, intoId] : [intoId, id];
        const a = await lock(tx, first);
        const b = await lock(tx, second);
        const merged = a.id === id ? a : b;
        const kept = a.id === id ? b : a;
        if (merged.version !== version || kept.version !== intoVersion) throw new SiteError('site_changed');

        const mergedFields = fields(merged);
        const keptFields = fields(kept);
        const changes: Changes = { mergedSite: { from: null, to: { id: merged.id, name: merged.name } } };
        const fill: Partial<SiteInput> = {};
        for (const key of FILLED) {
          const value = mergedFields[key];
          if (keptFields[key] !== null || value === null) continue;
          (fill as Record<string, unknown>)[key] = value;
          changes[key] = { from: null, to: value };
        }

        // External IDs: to the kept site where it has none of the same Source and account.
        for (const e of await moveIds(tx, merged.id, kept.id)) {
          if (e.accountId === null) changes[revisionKey(e.source)] = { from: null, to: e.externalId };
        }

        // The Dives, every User's, each with its own Revision and version.
        const moved = await tx.update(dive).set({ siteId: kept.id, version: sql`${dive.version} + 1`, updatedAt: new Date() })
          .where(eq(dive.siteId, merged.id)).returning({ id: dive.id });
        for (const d of moved) {
          await writeRevision(tx, 'dive', d.id, { type: 'system', id: 'site-merge' }, 'site-merge', {
            site: { from: { id: merged.id, name: merged.name }, to: { id: kept.id, name: kept.name } },
          });
        }

        // The Dive centres responsible for the merged site are responsible for the kept one (ADR 0043).
        await tx.execute(sql`insert into ${diveCentreSite} (centre_id, site_id)
          select l.centre_id, ${kept.id}::uuid from ${diveCentreSite} l where l.site_id = ${merged.id} on conflict do nothing`);
        await tx.delete(diveCentreSite).where(eq(diveCentreSite.siteId, merged.id));

        await tx.update(diveSite).set({ ...toColumns(fill), version: sql`${diveSite.version} + 1`, updatedAt: new Date() }).where(eq(diveSite.id, kept.id));
        await tx.update(diveSite).set({ mergedInto: kept.id, deletedAt: new Date(), version: sql`${diveSite.version} + 1`, updatedAt: new Date() })
          .where(eq(diveSite.id, merged.id));
        // No chains: whatever was merged into the merged site now points to the kept one.
        await tx.update(diveSite).set({ mergedInto: kept.id }).where(eq(diveSite.mergedInto, merged.id));

        const by = { type: 'user' as const, id: actor.userId };
        await writeRevision(tx, 'dive_site', kept.id, by, 'merge', changes);
        await writeRevision(tx, 'dive_site', merged.id, by, 'merge', { mergedInto: { from: null, to: { id: kept.id, name: kept.name } } });
        // Dives already at the kept site now carry the position it took from the merged one (ADR 0056).
        if (fill.position !== undefined) await noteSiteChange(tx, kept.id, new Date());
      });
    },

    /**
     * Takes up what a Source offers for a hand-made site (ADR 0025), like merging the Source's record into it:
     * empty fields take the Source's values, filled ones stay. The reference then provides data, so the site says
     * "From SSI" and later imports keep the taken fields current. Any User may; `version` as with editing.
     */
    async adopt(actor: SiteActor, id: string, version: number, source: SiteSource) {
      await db.transaction(async (tx) => {
        const current = await lock(tx, id);
        if (current.version !== version) throw new SiteError('site_changed');
        const offer = await takeOffer(tx, id, source);
        if (!offer) throw new SiteError('site_offer_not_found');
        const before = fields(current);
        const fill: Partial<SiteInput> = {};
        const changes: Changes = { adopted: { from: null, to: { source, externalId: offer.externalId } } };
        for (const field of IMPORTED_FIELDS) {
          const value = offer.imported[field] ?? null;
          if (before[field] !== null || value === null) continue;
          (fill as Record<string, unknown>)[field] = value;
          changes[field] = { from: null, to: value };
        }
        await tx.update(diveSite).set({ ...toColumns(fill), version: sql`${diveSite.version} + 1`, updatedAt: new Date() }).where(eq(diveSite.id, id));
        await writeRevision(tx, 'dive_site', id, { type: 'user', id: actor.userId }, 'adopt', changes);
        if (changes.name || changes.position) await noteSiteChange(tx, id, new Date());
      });
    },

    /**
     * A User sets or clears the site's External ID at a Source Users may type (ADR 0021, 0029), in a form the Source
     * shows it in. Any User may. It has its own Revision and leaves the site's version alone, so it never conflicts
     * with an edit of the other fields.
     */
    async setExternalId(actor: SiteActor, id: string, source: SiteSource, typed: string | null) {
      if (!SOURCE_INFO[source].typed) throw new SiteError('site_source_not_typed');
      const externalId = typed === null ? null : typedId(source, typed);
      if (externalId === null && typed !== null) throw new SiteError('invalid_input');
      await db.transaction(async (tx) => {
        await lock(tx, id);
        const before = (await idsOf(tx, [id], [])).get(id)?.find((e) => e.source === source)?.externalId ?? null;
        if (before === externalId) return;
        const by = { type: 'user' as const, id: actor.userId };
        if (externalId === null) await clearId(tx, id, source, null, by);
        else await storeId(tx, { siteId: id, source, externalId, accountId: null, actor: by });
      });
    },

    /**
     * The site's history, newest first. A User is named only to themselves ("you"): Users don't see who
     * else created or edits a site (ADR 0020). A Site import is named by its Sources (ADR 0021).
     */
    async revisions(actor: SiteActor, id: string) {
      const [site] = await db.select({ id: diveSite.id }).from(diveSite).where(and(eq(diveSite.id, id), or(live, isNotNull(diveSite.mergedInto))));
      if (!site) throw new SiteError('site_not_found');
      const rows = await db.select({ r: revision, sources: siteImport.sources }).from(revision)
        .leftJoin(siteImport, and(eq(revision.actorType, 'site_import'), sql`${siteImport.id}::text = ${revision.actorId}`))
        .where(and(eq(revision.entityType, 'dive_site'), eq(revision.entityId, id)))
        .orderBy(desc(revision.at), desc(revision.id)).limit(200);
      return rows.map(({ r, sources }) => ({
        id: r.id, at: r.at.toISOString(), cause: r.cause, changes: r.changes,
        actor: r.actorType === 'user' ? { type: r.actorId === actor.userId ? 'you' as const : 'user' as const, name: null }
          : r.actorType === 'site_import' ? { type: 'site_import' as const, name: sources?.map((s) => SOURCE_INFO[s].name).join(', ') ?? null }
          : { type: r.actorType, name: null },
      }));
    },

    /** The creator or an admin, and only while no Dive (of any User) is at the site. */
    async remove(actor: SiteActor, id: string) {
      await db.transaction(async (tx) => {
        const current = await lock(tx, id);
        if (!actor.isAdmin && current.createdBy !== actor.userId) throw new SiteError('site_not_deletable');
        const [used] = await tx.select({ id: dive.id }).from(dive).where(and(eq(dive.siteId, id), isNull(dive.deletedAt))).limit(1);
        if (used) throw new SiteError('site_in_use');
        await tx.update(diveSite).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(diveSite.id, id));
        await tx.delete(diveCentreSite).where(eq(diveCentreSite.siteId, id));
        await writeRevision(tx, 'dive_site', id, { type: 'user', id: actor.userId }, 'delete', { deletedAt: { from: null, to: new Date().toISOString() } });
      });
    },
  };
}

export type SiteService = ReturnType<typeof createSiteService>;
