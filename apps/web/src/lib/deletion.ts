// Deleting a Dive (ADR 0026, 0027): what the confirmation offers about the Dive's copies at Providers, and what the
// logbook shows afterwards (the deleted Dive with "Undo", the reminder about dives still at a Provider, the list of
// deleted dives).
import { useSyncExternalStore } from 'react';
import type { ProviderStatusView } from '../api.ts';

/** A Provider the Dive is at, with its dive number there. */
export interface CopyAt {
  provider: string;
  remoteNumber: number | null;
}

/**
 * What the delete dialog asks: `ask` lists the Providers it can delete the copy at too (its Diver is connected),
 * `cannot` those where the copy stays (not connected any more). Both empty: one "Delete dive" button.
 */
export interface DeleteChoice {
  ask: CopyAt[];
  cannot: CopyAt[];
}

/** Undefined while the Dive's state at the Providers is loading: the dialog waits before offering anything. */
export function deleteChoice(statuses: Pick<ProviderStatusView, 'provider' | 'connection' | 'current'>[] | undefined): DeleteChoice | undefined {
  if (!statuses) return undefined;
  const at = statuses.filter((s) => s.current);
  const copy = (s: (typeof at)[number]) => ({ provider: s.provider, remoteNumber: s.current!.remoteNumber });
  return { ask: at.filter((s) => s.connection).map(copy), cannot: at.filter((s) => !s.connection).map(copy) };
}

/** The Dive just deleted, for the logbook's notice with "Undo". */
export interface JustDeleted {
  id: string;
  /** "Dive 9", or its time when it has no number. */
  name: string;
  /** What happened to its copy at each Provider it was at (the server's answer), with the Provider's name. */
  copies: { provider: string; name: string; copy: 'deleted' | 'kept'; remoteNumber: number | null }[];
}

/** The notice's sentence for a Dive just deleted, and the copy it names (deleted ones first). */
export function deletedNotice(copies: JustDeleted['copies']) {
  const deleted = copies.filter((c) => c.copy === 'deleted');
  if (deleted.length > 0) return { key: 'deleted.noticeBoth' as const, copies: deleted };
  const kept = copies.filter((c) => c.copy === 'kept');
  if (kept.length > 0) return { key: 'deleted.noticeKept' as const, copies: kept };
  return { key: 'deleted.notice' as const, copies: [] };
}

interface State {
  justDeleted: JustDeleted | undefined;
  /** The reminder about deleted dives still at a Provider, dismissed for this visit (it comes back on reload). */
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
