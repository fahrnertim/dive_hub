// The Review page (UI redesign 4): what waits for the User, in the logbook's one line and the navigation's count, and
// the page's parts, kept in the address like the logbook's settings (ADR 0017).
import { useQuery } from '@tanstack/react-query';
import { candidatesQuery, deletedDivesQuery, goneDivesQuery, isPairCheck, logbookChecksQuery, providerConflictsQuery } from '../api.ts';

export const REVIEW_TABS = ['decide', 'imports', 'decided', 'deleted'] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export function reviewTab(params: URLSearchParams): ReviewTab {
  const tab = params.get('tab');
  return REVIEW_TABS.find((t) => t === tab) ?? 'decide';
}

export function reviewHref(tab: ReviewTab): string {
  return tab === 'decide' ? '#/review' : `#/review?tab=${tab}`;
}

/**
 * What waits for a decision: Recordings that don't clearly belong to a Dive (ADR 0016), pairs of Dives at the same time and
 * Dives that are probably no dive (ADR 0038), Dives gone at a Provider (ADR 0051), counted per Provider, and Dives a run
 * left with values changed in both places, or that the Provider already has a dive for (ADR 0056).
 */
export function useToDecideCounts() {
  const recordings = useQuery(candidatesQuery('open')).data?.length ?? 0;
  const checks = useQuery(logbookChecksQuery('open')).data ?? [];
  const pairs = checks.filter(isPairCheck).length;
  const shortDives = checks.length - pairs;
  const goneAt: Record<string, number> = {};
  for (const g of useQuery(goneDivesQuery()).data ?? []) goneAt[g.provider] = (goneAt[g.provider] ?? 0) + g.dives.length;
  const gone = Object.values(goneAt).reduce((a, b) => a + b, 0);
  const entries = (useQuery(providerConflictsQuery()).data ?? []).flatMap((g) => g.entries);
  const conflicts = entries.filter((e) => e.kind === 'conflict').length;
  // Dives the Provider already has a dive for: the send waits for the User's choice.
  const exists = entries.length - conflicts;
  return { recordings, pairs, shortDives, goneAt, gone, conflicts, exists, total: recordings + checks.length + gone + conflicts + exists };
}

/** Counts that go into the tabs and the links under the logbook: what was decided and what was deleted. */
export function useReviewCounts() {
  const decided = (useQuery(candidatesQuery('discarded')).data?.length ?? 0) + (useQuery(logbookChecksQuery('answered')).data?.length ?? 0);
  const deleted = useQuery(deletedDivesQuery()).data?.length ?? 0;
  return { decided, deleted };
}

/**
 * The facts of two candidates that differ in text, so the page can mark them ("16.4 m" against "16.1 m"). A fact one
 * has and the other lacks counts; one both lack doesn't.
 */
export function differingFacts(a: Record<string, string | undefined>, b: Record<string, string | undefined>): Set<string> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return new Set([...keys].filter((k) => a[k] !== b[k]));
}
