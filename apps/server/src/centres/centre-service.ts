// Dive centres (ADR 0043), shared by every User of the instance like Dive sites: anyone creates and renames them
// (with optimistic locking and Revisions), sets their SSI centre number and links them to the Dive sites they are
// responsible for; their creator or an admin deletes them. A Dive's centres are those of its site.
import { and, eq, ilike, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { dive, diveCentre, diveCentreExternalId, diveCentreSite, diveSite } from '../db/schema.js';
import { writeRevision, type Changes } from '../dives/revisions.js';
import { isUniqueViolation } from '../sites/site-service.js';
import { ssiCentreDisplayName } from '../providers/ssi/ssi-centre.js';
import { centreCodeText, readVerificationCode, typedCentreNumber } from './verification-code.js';

export const CENTRE_SOURCES = ['ssi'] as const;
export type CentreSource = (typeof CENTRE_SOURCES)[number];

/** A Source's proper name, the same in every UI language. */
export const CENTRE_SOURCE_NAME: Record<CentreSource, string> = { ssi: 'SSI' };

export class CentreError extends Error {
  constructor(
    readonly code: 'centre_not_found' | 'centre_changed' | 'centre_not_deletable' | 'centre_external_id_taken' | 'site_not_found' | 'invalid_input',
    /** The centre that already has a number (`centre_external_id_taken`), so a client can offer to open it instead. */
    readonly centre?: { id: string; name: string },
  ) {
    super(code);
  }
}

/** The signed-in User as far as shared centres care (as for Dive sites). */
export interface CentreActor {
  userId: string;
  isAdmin: boolean;
}

export interface CentreExternalId {
  source: CentreSource;
  externalId: string;
}

/** A Dive centre's verification code for a Provider's app: the text a client draws as a QR code. */
export interface VerificationCodeView {
  provider: CentreSource;
  text: string;
}

/** The key an External ID has in a centre's history: `ssiCentreNumber`. */
const revisionKey = (source: CentreSource) => (source === 'ssi' ? 'ssiCentreNumber' : `${source}Id`);

/** What a User typed for a Source, as the bare ID; null when it isn't one. */
const typedId = (_source: CentreSource, typed: string) => typedCentreNumber(typed);

/** The centre's code, when it has what the code is built from. */
/** How each Source names a centre for showing: its rule makes the display name from the whole name. */
const CENTRE_DISPLAY_NAME: Record<CentreSource, (name: string) => string> = { ssi: ssiCentreDisplayName };

/**
 * The name to show (owner, 2026-10-08): made by the rule of the Source the centre has an ID at, since the name is
 * spelled as that Source spells it. A centre without one shows its whole name. The whole name is what is edited.
 */
export const displayNameOf = (name: string, externalIds: CentreExternalId[]): string => {
  const source = CENTRE_SOURCES.find((s) => externalIds.some((e) => e.source === s));
  return source ? CENTRE_DISPLAY_NAME[source](name) : name;
};

export const verificationCodeOf = (name: string, externalIds: CentreExternalId[]): VerificationCodeView | null => {
  const ssi = externalIds.find((e) => e.source === 'ssi');
  return ssi ? { provider: 'ssi', text: centreCodeText(ssi.externalId, name) } : null;
};

const live = isNull(diveCentre.deletedAt);

export function createCentreService(db: Db) {
  /** The subqueries name their tables: in a single-table select Drizzle leaves columns unqualified. */
  const columns = {
    centre: diveCentre,
    externalIds: sql<CentreExternalId[]>`coalesce((select json_agg(json_build_object('source', e.source, 'externalId', e.external_id) order by e.source)
      from dive_centre_external_id e where e.centre_id = "dive_centre"."id"), '[]'::json)`,
    sites: sql<{ id: string; name: string }[]>`coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name) order by lower(s.name), s.id)
      from dive_centre_site l join dive_site s on s.id = l.site_id and s.deleted_at is null
      where l.centre_id = "dive_centre"."id"), '[]'::json)`,
  };

  const view = (actor: CentreActor, row: { centre: typeof diveCentre.$inferSelect; externalIds: CentreExternalId[]; sites: { id: string; name: string }[] }) => ({
    ...row,
    canDelete: actor.isAdmin || row.centre.createdBy === actor.userId,
    displayName: displayNameOf(row.centre.name, row.externalIds),
    verificationCode: verificationCodeOf(row.centre.name, row.externalIds),
  });

  async function lock(tx: Tx, id: string) {
    const [row] = await tx.select().from(diveCentre).where(and(eq(diveCentre.id, id), live)).for('update');
    if (!row) throw new CentreError('centre_not_found');
    return row;
  }

  async function holder(tx: Tx | Db, source: CentreSource, externalId: string, notCentreId?: string) {
    const [row] = await tx.select({ id: diveCentre.id, name: diveCentre.name }).from(diveCentreExternalId)
      .innerJoin(diveCentre, eq(diveCentre.id, diveCentreExternalId.centreId))
      .where(and(eq(diveCentreExternalId.source, source), eq(diveCentreExternalId.externalId, externalId),
        notCentreId ? ne(diveCentreExternalId.centreId, notCentreId) : undefined));
    return row;
  }

  /** Sets or clears the centre's External ID at a Source; another centre having it is refused, and named. */
  async function setExternal(tx: Tx, centreId: string, source: CentreSource, externalId: string | null) {
    if (externalId !== null) {
      const taken = await holder(tx, source, externalId, centreId);
      if (taken) throw new CentreError('centre_external_id_taken', taken);
    }
    await tx.delete(diveCentreExternalId).where(and(eq(diveCentreExternalId.centreId, centreId), eq(diveCentreExternalId.source, source)));
    if (externalId !== null) {
      try {
        await tx.insert(diveCentreExternalId).values({ centreId, source, externalId });
      } catch (error) {
        if (isUniqueViolation(error)) throw new CentreError('centre_external_id_taken');
        throw error;
      }
    }
  }

  async function liveSite(tx: Tx, siteId: string) {
    const [site] = await tx.select({ id: diveSite.id, name: diveSite.name }).from(diveSite).where(and(eq(diveSite.id, siteId), isNull(diveSite.deletedAt)));
    if (!site) throw new CentreError('site_not_found');
    return site;
  }

  return {
    /** One page of centres by name and how many match. `q` searches the name; `siteId` keeps the centres of that Dive site. */
    async list(actor: CentreActor, options: { q?: string | undefined; siteId?: string | undefined; limit?: number | undefined; offset?: number | undefined }) {
      const text = options.q?.trim();
      const pattern = text && `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const where = and(
        live,
        pattern ? ilike(diveCentre.name, pattern) : undefined,
        options.siteId ? sql`exists (select 1 from dive_centre_site l where l.centre_id = "dive_centre"."id" and l.site_id = ${options.siteId})` : undefined,
      );
      const [rows, [count]] = await Promise.all([
        db.select(columns).from(diveCentre).where(where).orderBy(sql`lower(${diveCentre.name})`, diveCentre.id)
          .limit(options.limit ?? 50).offset(options.offset ?? 0),
        db.select({ total: sql<number>`count(*)::int`.mapWith(Number) }).from(diveCentre).where(where),
      ]);
      return { centres: rows.map((r) => view(actor, r)), total: count?.total ?? 0 };
    },

    async get(actor: CentreActor, id: string) {
      const [row] = await db.select(columns).from(diveCentre).where(and(eq(diveCentre.id, id), live));
      if (!row) throw new CentreError('centre_not_found');
      return view(actor, row);
    },

    /** Name, numbers and sites in one step, so a centre made from a pasted code is whole or not there. */
    async create(actor: CentreActor, input: { name: string; externalIds?: { source: CentreSource; externalId: string }[] | undefined; siteIds?: string[] | undefined }) {
      const ids = (input.externalIds ?? []).map((e) => ({ source: e.source, externalId: typedId(e.source, e.externalId) }));
      if (ids.some((e) => e.externalId === null) || new Set(ids.map((e) => e.source)).size !== ids.length) throw new CentreError('invalid_input');
      return db.transaction(async (tx) => {
        const [created] = await tx.insert(diveCentre).values({ name: input.name, createdBy: actor.userId }).returning();
        const changes: Changes = { name: { from: null, to: input.name } };
        for (const e of ids) {
          await setExternal(tx, created!.id, e.source, e.externalId);
          changes[revisionKey(e.source)] = { from: null, to: e.externalId };
        }
        const siteIds = [...new Set(input.siteIds ?? [])];
        if (siteIds.length > 0) {
          const sites = await tx.select({ id: diveSite.id, name: diveSite.name }).from(diveSite).where(and(inArray(diveSite.id, siteIds), isNull(diveSite.deletedAt)));
          if (sites.length !== siteIds.length) throw new CentreError('site_not_found');
          await tx.insert(diveCentreSite).values(sites.map((s) => ({ centreId: created!.id, siteId: s.id })));
          changes.sites = { from: null, to: sites };
        }
        await writeRevision(tx, 'dive_centre', created!.id, { type: 'user', id: actor.userId }, 'create', changes);
        return created!.id;
      });
    },

    /** Any User may rename; `version` is the one they started from (409 centre_changed otherwise). */
    async rename(actor: CentreActor, id: string, version: number, name: string) {
      await db.transaction(async (tx) => {
        const current = await lock(tx, id);
        if (current.version !== version) throw new CentreError('centre_changed');
        if (current.name === name) return;
        await tx.update(diveCentre).set({ name, version: sql`${diveCentre.version} + 1`, updatedAt: new Date() }).where(eq(diveCentre.id, id));
        await writeRevision(tx, 'dive_centre', id, { type: 'user', id: actor.userId }, 'edit', { name: { from: current.name, to: name } });
      });
    },

    /**
     * A User sets or clears the centre's External ID at a Source, typed bare or pasted as the centre's whole code (only
     * the number is taken from it). It has its own Revision and leaves the version alone, as for a Dive site (ADR 0029).
     */
    async setExternalId(actor: CentreActor, id: string, source: CentreSource, typed: string | null) {
      const externalId = typed === null ? null : typedId(source, typed);
      if (externalId === null && typed !== null) throw new CentreError('invalid_input');
      await db.transaction(async (tx) => {
        await lock(tx, id);
        const [before] = await tx.select({ id: diveCentreExternalId.externalId }).from(diveCentreExternalId)
          .where(and(eq(diveCentreExternalId.centreId, id), eq(diveCentreExternalId.source, source)));
        const from = before?.id ?? null;
        if (from === externalId) return;
        await setExternal(tx, id, source, externalId);
        await writeRevision(tx, 'dive_centre', id, { type: 'user', id: actor.userId }, 'edit', { [revisionKey(source)]: { from, to: externalId } });
      });
    },

    /** Any User says the centre is responsible for the site, or no longer is. Asking twice changes nothing. */
    async setSite(actor: CentreActor, id: string, siteId: string, linked: boolean) {
      await db.transaction(async (tx) => {
        await lock(tx, id);
        const link = and(eq(diveCentreSite.centreId, id), eq(diveCentreSite.siteId, siteId));
        if (linked) {
          const site = await liveSite(tx, siteId);
          const added = await tx.insert(diveCentreSite).values({ centreId: id, siteId }).onConflictDoNothing().returning();
          if (added.length > 0) await writeRevision(tx, 'dive_centre', id, { type: 'user', id: actor.userId }, 'edit', { site: { from: null, to: site } });
          return;
        }
        const removed = await tx.delete(diveCentreSite).where(link).returning();
        if (removed.length === 0) return;
        const [site] = await tx.select({ id: diveSite.id, name: diveSite.name }).from(diveSite).where(eq(diveSite.id, siteId));
        await writeRevision(tx, 'dive_centre', id, { type: 'user', id: actor.userId }, 'edit', { site: { from: site ?? { id: siteId }, to: null } });
      });
    },

    /** The creator or an admin. Its links and numbers go with it; Dive sites and Dives are untouched. */
    async remove(actor: CentreActor, id: string) {
      await db.transaction(async (tx) => {
        const current = await lock(tx, id);
        if (!actor.isAdmin && current.createdBy !== actor.userId) throw new CentreError('centre_not_deletable');
        await tx.delete(diveCentreSite).where(eq(diveCentreSite.centreId, id));
        await tx.delete(diveCentreExternalId).where(eq(diveCentreExternalId.centreId, id));
        await tx.update(diveCentre).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(diveCentre.id, id));
        await writeRevision(tx, 'dive_centre', id, { type: 'user', id: actor.userId }, 'delete', { deletedAt: { from: null, to: new Date().toISOString() } });
      });
    },

    /**
     * What a pasted code's text is (ADR 0043): a centre's, with the centre here that already has its number; a buddy's
     * or a professional's, with their fields. Null for a text that is none of them. Nothing of it is kept.
     */
    async readCode(text: string) {
      const read = readVerificationCode(text);
      if (read?.kind !== 'centre') return read;
      return { ...read, existing: (await holder(db, 'ssi', read.centreNumber)) ?? null };
    },

    /** The codes a Dive shows: one per centre of its site that has one, by the centre's name. No other condition (ADR 0043). */
    async codesOfDive(diveId: string) {
      const rows = await db.select({ id: diveCentre.id, name: diveCentre.name, externalIds: columns.externalIds }).from(dive)
        .innerJoin(diveCentreSite, eq(diveCentreSite.siteId, dive.siteId))
        .innerJoin(diveCentre, and(eq(diveCentre.id, diveCentreSite.centreId), live))
        .where(eq(dive.id, diveId))
        .orderBy(sql`lower(${diveCentre.name})`, diveCentre.id);
      return rows.flatMap((r) => {
        const code = verificationCodeOf(r.name, r.externalIds);
        return code ? [{ centre: { id: r.id, name: r.name, displayName: displayNameOf(r.name, r.externalIds) }, ...code }] : [];
      });
    },
  };
}

export type CentreService = ReturnType<typeof createCentreService>;
