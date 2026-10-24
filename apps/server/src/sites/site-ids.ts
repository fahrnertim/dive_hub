// A Dive site's IDs at the Sources, public and private (ADR 0021, 0057). This is the only module that reads and writes
// `dive_site_external_id`. A row without `accountId` is public (every User and every send may use it); a row with one
// is private to that account (`diver_external_id`): only sends for its Diver use it, only Users who manage that Diver
// see it. A Source has one ID space, so `(source, external_id)` is held once, public or private.
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { diveSite, diveSiteExternalId, diverExternalId, diverManagement } from '../db/schema.js';
import { writeRevision, type Actor } from '../dives/revisions.js';
import type { Position } from '../vocabulary.js';
import { distanceM, MATCH_WITHIN_M, namesMatch } from './import/import-plan.js';
import type { ImportedValues } from './import/site-source.js';
import { isUniqueViolation, SiteError } from './site-error.js';
import { revisionKey, type SiteSource } from './sources.js';

type Q = Db | Tx;

export type SiteIdRow = {
  source: SiteSource;
  externalId: string;
  /** Null: public. Else the `diver_external_id` the ID is private to. */
  accountId: string | null;
  providesData: boolean;
  imported: ImportedValues | null;
};

/** The Diver's account at a Source (the id of their `diver_external_id` row), or null. Only SSI has accounts. */
export async function accountOf(q: Q, diverId: string, source: SiteSource): Promise<string | null> {
  if (source !== 'ssi') return null;
  const [r] = await q.select({ id: diverExternalId.id }).from(diverExternalId)
    .where(and(eq(diverExternalId.diverId, diverId), eq(diverExternalId.source, source)));
  return r?.id ?? null;
}

/** The accounts of the Divers the User manages, at one Source or all. */
export async function accountsOfUser(q: Q, userId: string, source?: SiteSource): Promise<string[]> {
  if (source !== undefined && source !== 'ssi') return [];
  const rows = await q.select({ id: diverExternalId.id }).from(diverExternalId)
    .innerJoin(diverManagement, eq(diverManagement.diverId, diverExternalId.diverId))
    .where(and(eq(diverManagement.userId, userId), source ? eq(diverExternalId.source, source) : undefined));
  return rows.map((r) => r.id);
}

/** The sites' public rows and the private rows of `accounts`, by site. */
export async function idsOf(q: Q, siteIds: string[], accounts: string[]): Promise<Map<string, SiteIdRow[]>> {
  const result = new Map<string, SiteIdRow[]>();
  if (siteIds.length === 0) return result;
  const rows = await q.select().from(diveSiteExternalId).where(and(
    inArray(diveSiteExternalId.siteId, siteIds),
    accounts.length === 0 ? isNull(diveSiteExternalId.accountId) : or(isNull(diveSiteExternalId.accountId), inArray(diveSiteExternalId.accountId, accounts)),
  ));
  for (const r of rows) {
    const list = result.get(r.siteId) ?? [];
    list.push({ source: r.source, externalId: r.externalId, accountId: r.accountId, providesData: r.providesData, imported: r.imported });
    result.set(r.siteId, list);
  }
  return result;
}

/**
 * The ID a send uses: the remote dive's site ID if it is one of the rows the account may use, else the public ID, else the
 * account's private one. Another account's rows, and rows of other Sources, are never picked.
 */
export function pickId(rows: SiteIdRow[], source: SiteSource, account: string | null, remote?: string | null): string | null {
  const usable = rows.filter((r) => r.source === source && (r.accountId === null || (account !== null && r.accountId === account)));
  if (remote && usable.some((r) => r.externalId === remote)) return remote;
  return (usable.find((r) => r.accountId === null) ?? usable[0])?.externalId ?? null;
}

/** The site that holds an ID, whoever's it is, and whether that site is deleted (or merged). */
export async function holderOf(q: Q, source: SiteSource, externalId: string): Promise<{ siteId: string; accountId: string | null; deleted: boolean } | null> {
  const [r] = await q.select({ siteId: diveSiteExternalId.siteId, accountId: diveSiteExternalId.accountId, deletedAt: diveSite.deletedAt })
    .from(diveSiteExternalId).innerJoin(diveSite, eq(diveSite.id, diveSiteExternalId.siteId))
    .where(and(eq(diveSiteExternalId.source, source), eq(diveSiteExternalId.externalId, externalId)));
  return r ? { siteId: r.siteId, accountId: r.accountId, deleted: r.deletedAt !== null } : null;
}

const sameKey = (siteId: string, source: SiteSource, accountId: string | null) => and(
  eq(diveSiteExternalId.siteId, siteId), eq(diveSiteExternalId.source, source),
  accountId === null ? isNull(diveSiteExternalId.accountId) : eq(diveSiteExternalId.accountId, accountId),
);

/**
 * Sets the site's ID at a Source for an account (null: public), replacing the row of the same site, Source and account.
 * An ID another row holds is refused (`external_id_taken`). A public ID gets a Revision on the site when an `actor` is
 * given; a private one never does (site history is shared).
 */
export async function storeId(tx: Tx, s: {
  siteId: string; source: SiteSource; externalId: string; accountId: string | null; actor: Actor | null;
  providesData?: boolean; imported?: ImportedValues;
}): Promise<void> {
  if (s.accountId !== null) {
    const [account] = await tx.select({ source: diverExternalId.source }).from(diverExternalId).where(eq(diverExternalId.id, s.accountId));
    if (!account || account.source !== s.source) throw new Error('The account belongs to another Source');
  }
  const [before] = await tx.select({ externalId: diveSiteExternalId.externalId }).from(diveSiteExternalId).where(sameKey(s.siteId, s.source, s.accountId));
  const [taken] = await tx.select({ id: diveSiteExternalId.id }).from(diveSiteExternalId).where(and(
    eq(diveSiteExternalId.source, s.source), eq(diveSiteExternalId.externalId, s.externalId),
    sql`not (${diveSiteExternalId.siteId} = ${s.siteId} and ${diveSiteExternalId.accountId} is not distinct from ${s.accountId})`,
  ));
  if (taken) throw new SiteError('external_id_taken');
  await tx.delete(diveSiteExternalId).where(sameKey(s.siteId, s.source, s.accountId));
  try {
    await tx.insert(diveSiteExternalId).values({
      siteId: s.siteId, source: s.source, externalId: s.externalId, accountId: s.accountId,
      providesData: s.providesData ?? false, imported: s.imported ?? null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SiteError('external_id_taken');
    throw error;
  }
  const from = before?.externalId ?? null;
  if (s.accountId === null && s.actor && from !== s.externalId) {
    await writeRevision(tx, 'dive_site', s.siteId, s.actor, 'edit', { [revisionKey(s.source)]: { from, to: s.externalId } });
  }
}

/** Removes the site's ID at a Source for an account (null: public); returns the ID removed, or null when there was none. */
export async function clearId(tx: Tx, siteId: string, source: SiteSource, accountId: string | null, actor: Actor | null): Promise<string | null> {
  const [removed] = await tx.delete(diveSiteExternalId).where(sameKey(siteId, source, accountId)).returning({ externalId: diveSiteExternalId.externalId });
  if (!removed) return null;
  if (accountId === null && actor) {
    await writeRevision(tx, 'dive_site', siteId, actor, 'edit', { [revisionKey(source)]: { from: removed.externalId, to: null } });
  }
  return removed.externalId;
}

/**
 * Makes the rows agree with what the Source says about the account's logbook sites: a public row of a site the account
 * has as private becomes private to it; a private row of the account's whose site is public becomes public. Rows of other
 * accounts stay. A change that would give a site two rows of one kind is skipped.
 */
export async function settleVisibility(tx: Tx, source: SiteSource, accountId: string, remote: { externalId: string; private: boolean }[]): Promise<void> {
  for (const r of remote) {
    const [row] = await tx.select().from(diveSiteExternalId)
      .where(and(eq(diveSiteExternalId.source, source), eq(diveSiteExternalId.externalId, r.externalId)));
    if (!row) continue;
    const target = r.private ? accountId : null;
    if (r.private ? row.accountId !== null : row.accountId !== accountId) continue;
    const [clash] = await tx.select({ id: diveSiteExternalId.id }).from(diveSiteExternalId)
      .where(and(sameKey(row.siteId, source, target), ne(diveSiteExternalId.id, row.id)));
    if (clash) continue;
    await tx.update(diveSiteExternalId).set({ accountId: target, updatedAt: new Date() }).where(eq(diveSiteExternalId.id, row.id));
  }
}

/** The remote site nearest to the logbook site within `MATCH_WITHIN_M` whose name matches, or none. */
export function nearbyMatch<T extends { externalId: string; name: string; latitude: number | null; longitude: number | null }>(
  site: { name: string; position: Position }, remotes: T[],
): T | undefined {
  let best: { remote: T; distance: number } | undefined;
  for (const remote of remotes) {
    if (remote.latitude === null || remote.longitude === null) continue;
    const d = distanceM(site.position, { latitude: remote.latitude, longitude: remote.longitude });
    if (d > MATCH_WITHIN_M || (best && d >= best.distance) || !namesMatch(site.name, remote.name)) continue;
    best = { remote, distance: d };
  }
  return best?.remote;
}
