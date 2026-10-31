// Appending later Dives with their copies at Providers deleted first where asked (ADR 0063, as merge-service.ts does
// for a merge, ADR 0038).
import type { PushService, Removal } from '../../providers/push/push-service.js';
import type { ProviderServiceError } from '../../providers/registry.js';
import type { WaitingPushService } from '../../providers/waiting-push/waiting-push-service.js';
import { DiveError } from '../dive-service.js';
import type { LogbookService } from '../logbook-service.js';
import type { ContinuationService } from './continuation-service.js';

export interface AppendDeps {
  continuation: Pick<ContinuationService, 'append'>;
  logbook: Pick<LogbookService, 'findManagedDive'>;
  pushes: Pick<PushService, 'currentOf' | 'removeAt'>;
  waitingPushes: Pick<WaitingPushService, 'deletingItself'>;
}

/** What an append did: the kept Dive, or the refusal at a Provider that appended nothing, with which copies are gone already. */
export type AppendOutcome =
  | { kept: string; failure: null }
  | { kept: null; failure: ProviderServiceError; providers: Removal['copies'] };

interface Side { id: string; version: number }

export function createAppendService({ continuation, logbook, pushes, waitingPushes }: AppendDeps) {
  /**
   * The Providers in `alsoAt` to delete each later Dive's copy at, in start order: where the kept Dive or an earlier
   * later Dive is too, since only the first link at a Provider moves to the kept Dive and every later one would stay
   * behind. Not where the Dive's Connection deletes by itself: the queue does it after 5 minutes, not asked.
   */
  async function askedAt(userId: string, kept: Side, later: Side[], alsoAt: string[]): Promise<{ id: string; asked: string[] }[]> {
    const rows = [];
    for (const side of [kept, ...later]) {
      const row = await logbook.findManagedDive(userId, side.id);
      if (!row) throw new DiveError('dive_not_found');
      // Every version before any Provider is asked, so a changed Dive isn't deleted there and then kept here.
      if (row.version !== side.version) throw new DiveError('dive_changed');
      rows.push(row);
    }
    const [keptRow, ...laters] = rows;
    laters.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const remote = await pushes.currentOf(rows.map((r) => r.id));
    const itself = await waitingPushes.deletingItself(laters.map((r) => r.id));
    const providersOf = (id: string) => [...(remote.get(id)?.keys() ?? [])];
    const seen = new Set(providersOf(keptRow!.id));
    return laters.map(({ id }) => {
      const at = providersOf(id);
      const asked = at.filter((provider) => seen.has(provider) && alsoAt.includes(provider) && !itself.get(id)?.has(provider));
      for (const provider of at) seen.add(provider);
      return { id, asked };
    });
  }

  return {
    /**
     * Deletes each later Dive's copy at the Providers in `alsoAt` first (see askedAt), then appends. A refusal there
     * appends nothing and is answered in `failure`.
     */
    async append(userId: string, kept: Side, later: Side[], alsoAt: string[]): Promise<AppendOutcome> {
      for (const { id, asked } of alsoAt.length > 0 ? await askedAt(userId, kept, later, alsoAt) : []) {
        if (asked.length === 0) continue;
        const { copies, failure } = await pushes.removeAt(userId, id, asked);
        if (failure) {
          return { kept: null, failure, providers: asked.map((provider) => ({ provider, copy: copies.find((c) => c.provider === provider)?.copy ?? 'kept' as const })) };
        }
      }
      // Deleting there recorded a Push, not a change of the Dive: its version is the one sent.
      const { kept: keptId } = await continuation.append(userId, kept, later);
      return { kept: keptId, failure: null };
    },
  };
}

export type AppendService = ReturnType<typeof createAppendService>;
