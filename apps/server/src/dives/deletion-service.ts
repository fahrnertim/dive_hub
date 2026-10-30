// Deleting a Dive with its copies at Providers, and the list of deleted Dives with where they still are (ADR 0026, 0027).
import type { PushService, Removal } from '../providers/push-service.js';
import type { WaitingPushService } from '../providers/waiting-push-service.js';
import { DiveError, type DiveService } from './dive-service.js';
import { diveSummaryOf, providersOf } from './dive-summary-view.js';
import type { LogbookService } from './logbook-service.js';

export interface DeletionDeps {
  dives: Pick<DiveService, 'remove'>;
  logbook: Pick<LogbookService, 'findManagedDive' | 'deletedDives'>;
  pushes: Pick<PushService, 'currentOf' | 'removeAt'>;
  waitingPushes: Pick<WaitingPushService, 'deletingItself' | 'waitingOf'>;
}

/** What a delete did: each Provider the Dive was at, its copy deleted or kept, and the refusal that kept the Dive here. */
export interface Deletion {
  providers: Removal['copies'];
  failure: Removal['failure'];
}

export function createDeletionService({ dives, logbook, pushes, waitingPushes }: DeletionDeps) {
  return {
    /**
     * Deletes the Dive's copies at the Providers in `alsoAt` first, then the Dive. A refusal there keeps the Dive and is
     * answered in `failure`, with which copies are gone already.
     */
    async remove(userId: string, diveId: string, version: number, alsoAt: string[]): Promise<Deletion> {
      const row = await logbook.findManagedDive(userId, diveId);
      if (!row) throw new DiveError('dive_not_found');
      // Checked before any Provider is asked, so a changed Dive isn't deleted there and then kept here.
      if (row.version !== version) throw new DiveError('dive_changed');
      const at = [...((await pushes.currentOf([row.id])).get(row.id)?.keys() ?? [])];
      // Where the Dive's Connection deletes by itself, the queue does it after 5 minutes, even when `alsoAt` names it (Undo cancels it).
      const itself = (await waitingPushes.deletingItself([row.id])).get(row.id);
      const asked = at.filter((provider) => alsoAt.includes(provider) && !itself?.has(provider));
      const { copies, failure } = asked.length > 0 ? await pushes.removeAt(userId, row.id, asked) : { copies: [], failure: null };
      const providers = at.map((provider) => ({ provider, copy: copies.find((c) => c.provider === provider)?.copy ?? 'kept' as const }));
      if (!failure) await dives.remove(userId, row.id, version);
      return { providers, failure };
    },

    /** The User's deleted Dives, most recently deleted first, with the Providers each is still at and what waits to go there. */
    async deleted(userId: string, limit: number) {
      const rows = await logbook.deletedDives(userId, limit);
      const remote = await pushes.currentOf(rows.map((r) => r.d.id));
      const waiting = await waitingPushes.waitingOf(rows.map((r) => r.d.id));
      return rows.map(({ d, siteName, mergedInto, movedTo }) => ({
        id: d.id, diverId: d.diverId, version: d.version, ...diveSummaryOf(d, siteName),
        deletedAt: d.deletedAt!.toISOString(), mergedInto, movedTo,
        stillAt: providersOf(remote, d.id),
        waiting: waiting.get(d.id) ?? [],
      }));
    },
  };
}

export type DeletionService = ReturnType<typeof createDeletionService>;
