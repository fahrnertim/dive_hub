// Appending later Dives with their copies at Providers deleted first where asked (ADR 0063, as merge-service.ts does
// for a merge, ADR 0038).
import type { PushService, Removal } from '../../providers/push/push-service.js';
import type { ProviderServiceError } from '../../providers/registry.js';
import { DiveError } from '../dive-service.js';
import type { LogbookService } from '../logbook-service.js';
import type { ContinuationService } from './continuation-service.js';

export interface AppendDeps {
  continuation: Pick<ContinuationService, 'previousCandidate' | 'append'>;
  logbook: Pick<LogbookService, 'versionOf'>;
  pushes: Pick<PushService, 'removeAt'>;
}

/** What an append did: the kept Dive, or the refusal at a Provider that appended nothing, with which copies are gone already. */
export type AppendOutcome =
  | { kept: string; failure: null }
  | { kept: null; failure: ProviderServiceError; providers: Removal['copies'] };

interface Side { id: string; version: number }

export function createAppendService({ continuation, logbook, pushes }: AppendDeps) {
  return {
    /**
     * Deletes each later Dive's copy at the Providers in `alsoAt` first, where the Dive before it has its own, then
     * appends. A refusal there appends nothing and is answered in `failure`.
     */
    async append(userId: string, kept: Side, later: Side[], alsoAt: string[]): Promise<AppendOutcome> {
      for (const side of later) {
        const candidate = await continuation.previousCandidate(userId, side.id);
        // Where the Dive's Connection deletes by itself, the queue does it after 5 minutes, not asked.
        const asked = candidate ? candidate.bothAt.filter((provider) => alsoAt.includes(provider) && !candidate.deletesItself.includes(provider)) : [];
        if (asked.length === 0) continue;
        // Checked before any Provider is asked, so a changed Dive isn't deleted there and then kept here.
        if (await logbook.versionOf(side.id) !== side.version) throw new DiveError('dive_changed');
        const { copies, failure } = await pushes.removeAt(userId, side.id, asked);
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
