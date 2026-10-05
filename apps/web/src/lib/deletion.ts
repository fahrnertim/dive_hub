// Deleting a Dive (ADR 0026): what the confirmation offers about the Dive's SSI copy, and what the logbook shows
// afterwards (the deleted Dive with "Undo", the reminder about dives still in SSI, the list of deleted dives).
import { useSyncExternalStore } from 'react';
import type { SsiStatusView } from '../api.ts';

/** What the delete dialog asks about SSI. */
export type SsiChoice =
  /** Not in SSI: one "Delete dive" button. */
  | { kind: 'none' }
  /** In SSI and its Diver is connected: "Delete here and in SSI" or "Delete only here". */
  | { kind: 'ask'; remoteNumber: number | null }
  /** In SSI, but its Diver isn't connected any more: it can only be deleted here, and stays there. */
  | { kind: 'cannot'; remoteNumber: number | null };

/** Undefined while the Dive's SSI state is loading: the dialog waits before offering anything. */
export function ssiChoice(status: Pick<SsiStatusView, 'connection' | 'current'> | undefined): SsiChoice | undefined {
  if (!status) return undefined;
  if (!status.current) return { kind: 'none' };
  const remoteNumber = status.current.remoteNumber;
  return status.connection ? { kind: 'ask', remoteNumber } : { kind: 'cannot', remoteNumber };
}

/** The Dive just deleted, for the logbook's notice with "Undo". */
export interface JustDeleted {
  id: string;
  /** "Dive 9", or its time when it has no number. */
  name: string;
  /** What happened to its SSI copy (the server's answer). */
  ssi: 'deleted' | 'kept' | null;
  remoteNumber: number | null;
}

/** The notice's sentence for a Dive just deleted. */
export const deletedNoticeKey = (ssi: JustDeleted['ssi']) =>
  ssi === 'deleted' ? 'deleted.noticeBoth' as const : ssi === 'kept' ? 'deleted.noticeKept' as const : 'deleted.notice' as const;

interface State {
  justDeleted: JustDeleted | undefined;
  /** The reminder about deleted dives still in SSI, dismissed for this visit (it comes back on reload). */
  reminderDismissed: boolean;
  /** The list of deleted dives is open. */
  listOpen: boolean;
}

// Shared by the dive page (which deletes and leaves) and the logbook (which shows the outcome): the page changes in between.
let state: State = { justDeleted: undefined, reminderDismissed: false, listOpen: false };
const listeners = new Set<() => void>();

export function updateDeletion(change: Partial<State>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

export function useDeletion(): State {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => state,
  );
}
