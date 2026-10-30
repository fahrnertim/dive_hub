// Merging two Dives with the copy at Providers of the one not kept (ADR 0038, 0026).
import type { PushService, Removal } from '../providers/push-service.js';
import type { ProviderServiceError } from '../providers/registry.js';
import { DiveError } from './dive-service.js';
import type { LogbookService } from './logbook-service.js';
import type { Merging } from './merging.js';

export interface MergeDeps {
  merging: Pick<Merging, 'mergeCandidates' | 'merge'>;
  logbook: Pick<LogbookService, 'versionOf'>;
  pushes: Pick<PushService, 'removeAt'>;
}

/** What a merge did: the kept Dive, or the refusal at a Provider that merged nothing, with which copies are gone already. */
export type MergeOutcome =
  | { kept: string; failure: null }
  | { kept: null; failure: ProviderServiceError; providers: Removal['copies'] };

interface Side { id: string; version: number }

export function createMergeService({ merging, logbook, pushes }: MergeDeps) {
  return {
    /**
     * Deletes the copy of the Dive not kept at the Providers in `alsoAt` first, where the kept one has its own, then
     * merges. A refusal there merges nothing and is answered in `failure`.
     */
    async merge(userId: string, first: Side, second: Side, alsoAt: string[]): Promise<MergeOutcome> {
      const candidate = (await merging.mergeCandidates(userId, first.id)).find((c) => c.dive.id === second.id);
      // Where the Dive's Connection deletes by itself, the queue does it after 5 minutes, not asked.
      const asked = candidate ? candidate.bothAt.filter((provider) => alsoAt.includes(provider) && !candidate.deletesItself.includes(provider)) : [];
      if (candidate && asked.length > 0) {
        const leaving = candidate.keeps === second.id ? first : second;
        // Checked before any Provider is asked, so a changed Dive isn't deleted there and then kept here.
        if (await logbook.versionOf(leaving.id) !== leaving.version) throw new DiveError('dive_changed');
        const { copies, failure } = await pushes.removeAt(userId, leaving.id, asked);
        if (failure) {
          return { kept: null, failure, providers: asked.map((provider) => ({ provider, copy: copies.find((c) => c.provider === provider)?.copy ?? 'kept' as const })) };
        }
      }
      // Deleting there recorded a Push, not a change of the Dive: its version is the one sent.
      const { kept } = await merging.merge(userId, first, second);
      return { kept, failure: null };
    },
  };
}

export type MergeService = ReturnType<typeof createMergeService>;
