// The Dive site a Provider's dive names (ADR 0030): the site here with that site ID; else one here that is the same site
// by the Site import's rule (matchingSite: within 100 m, the same name, no ID at that Source yet), which then gets the
// ID; else, where an admin allowed the Provider's site data, a new site from the values the Provider gives.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { diveSite, diveSiteExternalId, providerSiteData } from '../db/schema.js';
import { writeRevision, type Actor, type Changes } from '../dives/revisions.js';
import { matchingSite, MATCH_WITHIN_M } from './import/import-plan.js';
import type { ImportedValues } from './import/site-source.js';
import { nearSql, type Position } from './site-service.js';
import { revisionKey, type SiteSource } from './sources.js';

/** What a Provider says about one of its sites. */
export interface ProviderSite {
  source: SiteSource;
  externalId: string;
  name: string;
  position: Position | null;
  /** ISO 3166-1 alpha-2, or null. */
  country: string | null;
}

/** Where the site of a Provider's dive is here: already (`known`), the same site by name and position (`match`), or none. */
export type SiteOutlook = { kind: 'known' | 'match'; siteId: string } | { kind: 'new' } | { kind: 'taken' };

/** Whether an admin allowed creating sites from this Provider's site data (ADR 0030). */
export async function siteDataAllowed(q: Db | Tx, provider: string): Promise<boolean> {
  const [row] = await q.select({ provider: providerSiteData.provider }).from(providerSiteData).where(eq(providerSiteData.provider, provider));
  return !!row;
}

/**
 * What the site would be, without changing anything. `taken`: a site deleted here holds the ID (it can't be given to
 * another, and a deleted site isn't used).
 */
export async function siteOutlook(q: Db | Tx, s: ProviderSite): Promise<SiteOutlook> {
  const [known] = await q.select({ siteId: diveSite.id, deletedAt: diveSite.deletedAt }).from(diveSiteExternalId)
    .innerJoin(diveSite, eq(diveSite.id, diveSiteExternalId.siteId))
    .where(and(eq(diveSiteExternalId.source, s.source), eq(diveSiteExternalId.externalId, s.externalId)));
  if (known) return known.deletedAt ? { kind: 'taken' } : { kind: 'known', siteId: known.siteId };
  if (!s.position) return { kind: 'new' };
  const near = await q.select({ id: diveSite.id, name: diveSite.name, latitude: diveSite.latitude, longitude: diveSite.longitude })
    .from(diveSite).where(and(isNull(diveSite.deletedAt), nearSql(s.position, MATCH_WITHIN_M)));
  const ids = near.length === 0 ? [] : await q.select({ siteId: diveSiteExternalId.siteId, source: diveSiteExternalId.source })
    .from(diveSiteExternalId).where(inArray(diveSiteExternalId.siteId, near.map((n) => n.id)));
  const site = matchingSite({ source: s.source, name: s.name, position: s.position }, near.map((n) => ({
    id: n.id,
    values: { name: n.name, position: n.latitude !== null && n.longitude !== null ? { latitude: n.latitude, longitude: n.longitude } : null },
    externalIds: ids.filter((e) => e.siteId === n.id),
  })));
  return site ? { kind: 'match', siteId: site.id } : { kind: 'new' };
}

/**
 * The site for a Provider's dive, made so (ADR 0030): a matched site gets the Provider's ID as a reference (no data
 * taken); a new one is made from the Provider's values only with `allowCreate`, marked as from that Source, with the
 * User as its creator. One Revision on the site. Null when there is none to use.
 */
export async function siteForProvider(
  tx: Tx, s: ProviderSite, options: { allowCreate: boolean; userId: string; actor: Actor },
): Promise<string | null> {
  const outlook = await siteOutlook(tx, s);
  if (outlook.kind === 'known') return outlook.siteId;
  if (outlook.kind === 'taken') return null;
  const idChange: Changes = { [revisionKey(s.source)]: { from: null, to: s.externalId } };
  if (outlook.kind === 'match') {
    await tx.insert(diveSiteExternalId).values({ siteId: outlook.siteId, source: s.source, externalId: s.externalId });
    await writeRevision(tx, 'dive_site', outlook.siteId, options.actor, 'link', idChange);
    return outlook.siteId;
  }
  if (!options.allowCreate) return null;
  const imported: ImportedValues = {
    name: s.name, position: s.position, country: s.country, waterBody: null, description: null, maxDepthM: null, waterType: null,
  };
  const [created] = await tx.insert(diveSite).values({
    name: s.name, latitude: s.position?.latitude ?? null, longitude: s.position?.longitude ?? null, country: s.country,
    createdBy: options.userId,
  }).returning({ id: diveSite.id });
  await tx.insert(diveSiteExternalId).values({
    siteId: created!.id, source: s.source, externalId: s.externalId, providesData: true, imported,
  });
  const changes: Changes = { name: { from: null, to: s.name }, ...idChange };
  if (s.position) changes.position = { from: null, to: s.position };
  if (s.country) changes.country = { from: null, to: s.country };
  await writeRevision(tx, 'dive_site', created!.id, options.actor, 'create', changes);
  return created!.id;
}
