// Picking or typing a Dive site's ID at a Provider through the Connection (ADR 0057, piece 4): the Provider is asked about
// the ID first. One it calls public is stored public; the account's own private one is stored private to the account;
// an unknown ID, another account's private site or a deleted one is refused and nothing is stored. A Provider that
// doesn't say, or can't be asked, leaves the ID private to the account: never public on a guess.
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { diveSite } from '../db/schema.js';
import { SiteError } from '../sites/site-error.js';
import { accountOf, clearId, storeId } from '../sites/site-ids.js';
import { typedId, type SiteSource } from '../sites/sources.js';
import type { ConnectionService } from './connection-service.js';
import type { ProviderAdapter } from './provider.js';
import { named, ProviderServiceError, type ProviderRegistry } from './registry.js';

export function createSitePickService(deps: { db: Db; registry: ProviderRegistry; connections: ConnectionService }) {
  const { db, registry, connections } = deps;

  /** The Source of the Provider's site IDs, from the requirement its exports have. */
  function sourceOf(adapter: ProviderAdapter): SiteSource | null {
    const requirement = adapter.capabilities.data.dives?.export?.requirements.find((r) => r.type === 'site_external_id');
    return requirement?.type === 'site_external_id' ? requirement.source : null;
  }

  /**
   * What the Provider says about the ID: null when it has no such site for the account (unknown, deleted, another
   * account's private). When it doesn't say or can't be asked, its logbook list decides if it lists the ID, else `unknown`.
   */
  async function visibilityOf(conn: Parameters<ConnectionService['withAccess']>[0], adapter: ProviderAdapter, externalId: string) {
    const sites = adapter.diveSites!;
    try {
      const found = await connections.withAccess(conn, (ctx) => sites.get!(ctx, externalId));
      if (!found) return null;
      if (found.visibility !== 'unknown') return found.visibility;
    } catch (error) {
      if (!(error instanceof ProviderServiceError && error.code === 'provider_unavailable')) throw error;
    }
    try {
      const listed = (await connections.withAccess(conn, (ctx) => sites.find(ctx))).find((s) => s.id === externalId);
      return listed?.visibility ?? 'unknown';
    } catch (error) {
      if (error instanceof ProviderServiceError && error.code === 'provider_unavailable') return 'unknown';
      throw error;
    }
  }

  return {
    /**
     * Sets the Dive site's ID at the Connection's Provider (null clears the account's private one; the public ID is cleared
     * with `PUT /api/dive-sites/{id}/external-ids/{source}`). Answers what is stored, and whether it is private.
     */
    async set(userId: string, connectionId: string, siteId: string, typed: string | null): Promise<{ externalId: string | null; private: boolean }> {
      const conn = await connections.own(userId, connectionId);
      const adapter = registry.get(conn.provider);
      const source = sourceOf(adapter);
      if (!adapter.diveSites?.get || !source) throw new ProviderServiceError('provider_unsupported', named(adapter));
      const [site] = await db.select({ id: diveSite.id }).from(diveSite).where(and(eq(diveSite.id, siteId), isNull(diveSite.deletedAt)));
      if (!site) throw new ProviderServiceError('site_not_found');
      const account = await accountOf(db, conn.diverId, source);
      if (!account) throw new ProviderServiceError('provider_unsupported', named(adapter));

      if (typed === null) {
        await db.transaction((tx) => clearId(tx, siteId, source, account, null));
        return { externalId: null, private: false };
      }
      const externalId = typedId(source, typed);
      if (externalId === null) throw new ProviderServiceError('invalid_input', named(adapter));

      const visibility = await visibilityOf(conn, adapter, externalId);
      if (visibility === null) throw new ProviderServiceError('provider_site_unknown', named(adapter));
      const isPrivate = visibility !== 'public';
      try {
        await db.transaction((tx) => storeId(tx, {
          siteId, source, externalId, accountId: isPrivate ? account : null, actor: isPrivate ? null : { type: 'user', id: userId },
        }));
      } catch (error) {
        throw error instanceof SiteError && error.code === 'external_id_taken' ? new ProviderServiceError('external_id_taken') : error;
      }
      return { externalId, private: isPrivate };
    },
  };
}

export type SitePickService = ReturnType<typeof createSitePickService>;
