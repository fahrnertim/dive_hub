// The send's own fix for the site requirement (ADR 0057, piece 4): before a Dive goes out, its site gets an ID at the
// Provider the Diver's account may use. One it has already; else a site of the account's logbook nearby with a matching
// name whose ID no site here holds (stored public or private as the Provider marks it); else a site the send makes there,
// private to the account (stored private at once, so a retry, a later Dive of a run or a failed dive save makes none).
// Generic: the adapter's `diveSites` say what the Provider has.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { diveSite } from '../db/schema.js';
import type { Actor } from '../dives/revisions.js';
import { accountOf, heldIds, idsOf, nearbyMatch, pickId, settleVisibility, storeId } from '../sites/site-ids.js';
import type { SiteSource } from '../sites/sources.js';
import type { ActionContext, ProviderAdapter, RemoteSite } from './provider.js';

export type SiteForSend = 'had' | 'matched' | 'created' | 'none';

/**
 * Gives the Dive's site an ID at the Provider for the Diver's account, under the send's action. `none`: no site, no
 * position, no account or a Provider that can't find and make sites; the requirement then refuses as before. Reading the
 * logbook also settles the Provider's private flag on the IDs held here (as the import does).
 */
export async function siteForSend(db: Db, s: {
  adapter: ProviderAdapter; context: ActionContext; diverId: string; siteId: string | null; source: SiteSource; actor: Actor;
}): Promise<SiteForSend> {
  const sites = s.adapter.diveSites;
  if (!s.siteId || !sites?.create) return 'none';
  const account = await accountOf(db, s.diverId, s.source);
  if (!account) return 'none';
  const rows = (await idsOf(db, [s.siteId], [account])).get(s.siteId) ?? [];
  if (pickId(rows, s.source, account) !== null) return 'had';
  const [site] = await db.select().from(diveSite).where(eq(diveSite.id, s.siteId));
  if (!site || site.latitude === null || site.longitude === null) return 'none';
  const position = { latitude: site.latitude, longitude: site.longitude };

  // Another account's private site is never listed (the adapter drops it).
  const remote = await sites.find(s.context);
  const held = await heldIds(db, remote.map((r) => ({ source: s.source, externalId: r.id })));
  const matched = await db.transaction(async (tx) => {
    await settleVisibility(tx, s.source, account, remote.filter((r) => r.visibility !== 'unknown')
      .map((r) => ({ externalId: r.id, private: r.visibility === 'private' })));
    const free = remote.filter((r) => !held.has(`${s.source}:${r.id}`)).map((r) => ({ ...r, externalId: r.id }));
    const match: RemoteSite | undefined = nearbyMatch({ name: site.name, position }, free);
    if (!match) return false;
    // Only a site the Provider calls public is stored public: one it doesn't say about stays the account's.
    await storeId(tx, { siteId: site.id, source: s.source, externalId: match.id, accountId: match.visibility === 'public' ? null : account, actor: s.actor });
    return true;
  });
  if (matched) return 'matched';

  // The ID `create` answers is the one used: the adapter's kept logbook read doesn't list the new site yet.
  const created = await sites.create(s.context, { name: site.name, position, country: site.country, waterType: site.waterType });
  await db.transaction((tx) => storeId(tx, { siteId: site.id, source: s.source, externalId: created, accountId: account, actor: null }));
  return 'created';
}
