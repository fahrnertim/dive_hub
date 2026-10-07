// The Review page (UI redesign 4): what waits for the User, in the logbook's one line and the navigation's count, and
// the page's parts, kept in the address like the logbook's settings (ADR 0017).
import { useQuery } from '@tanstack/react-query';
import { candidatesQuery, deletedDivesQuery, logbookChecksQuery } from '../api.ts';

export const REVIEW_TABS = ['decide', 'imports', 'decided', 'deleted'] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export function reviewTab(params: URLSearchParams): ReviewTab {
  const tab = params.get('tab');
  return REVIEW_TABS.find((t) => t === tab) ?? 'decide';
}

export function reviewHref(tab: ReviewTab): string {
  return tab === 'decide' ? '#/review' : `#/review?tab=${tab}`;
}

/** What waits for a decision: Recordings that don't clearly belong to a Dive (ADR 0016), pairs of Dives at the same time (ADR 0038). */
export function useWaiting() {
  const recordings = useQuery(candidatesQuery('open')).data?.length ?? 0;
  const pairs = useQuery(logbookChecksQuery('open')).data?.length ?? 0;
  return { recordings, pairs, total: recordings + pairs };
}

/** Counts that go into the tabs and the links under the logbook: what was decided and what was deleted. */
export function useReviewCounts() {
  const decided = (useQuery(candidatesQuery('discarded')).data?.length ?? 0) + (useQuery(logbookChecksQuery('answered')).data?.length ?? 0);
  const deleted = useQuery(deletedDivesQuery()).data?.dives.length ?? 0;
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
