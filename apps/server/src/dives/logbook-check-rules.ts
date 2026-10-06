// The rules of the logbook checks (ADR 0038), pure: which pairs of Dives can't both be right as they stand. They use the
// import's own matching, so a check never disagrees with what a fresh import would have done.
import { OVERLAP_TOLERANCE_SECONDS, alignedForMatching, depthsDisagree, overlaps } from '../imports/matching.js';

/** Changes when a rule changes what it finds. */
export const LOGBOOK_CHECKS_VERSION = 1;

/**
 * `recording_beside_entry`: a Dive without a Recording and a Dive with one at the same time, as an import would have
 * attached them (its tolerance). `overlapping_dives`: two Dives of one Diver that really overlap in time.
 */
export const LOGBOOK_CHECK_RULES = ['recording_beside_entry', 'overlapping_dives'] as const;
export type LogbookCheckRule = (typeof LOGBOOK_CHECK_RULES)[number];

/** A Dive as the rules see it. */
export interface CheckedDive {
  id: string;
  diverId: string;
  startsAt: Date;
  utcOffsetSeconds: number | null;
  utcOffsetSource: string;
  durationSeconds: number;
  maxDepthM: number | null;
  recordings: number;
}

/** The rule two Dives of one Diver break together, if any. Pure. */
export function ruleFor(a: CheckedDive, b: CheckedDive): LogbookCheckRule | null {
  if (a.id === b.id || a.diverId !== b.diverId) return null;
  const mixed = (a.recordings === 0) !== (b.recordings === 0);
  // Where either offset is unknown, the two compare in local time (ADR 0030).
  const [other] = alignedForMatching(a, [b]) as [CheckedDive];
  const span = (d: CheckedDive) => ({ startsAt: d.startsAt, durationSeconds: d.durationSeconds, maxDepthM: undefined });
  if (!overlaps(span(a), span(other), mixed ? OVERLAP_TOLERANCE_SECONDS : 0)) return null;
  return mixed ? 'recording_beside_entry' : 'overlapping_dives';
}

export interface LogbookCheck {
  rule: LogbookCheckRule;
  /** The two Dives, the earlier first. */
  dives: [CheckedDive, CheckedDive];
  /** An import would have put the two together by itself: one Recording's Dive, one entry's, no other in reach, depths agreeing. */
  obvious: boolean;
}

/** Every pair of Dives that breaks a rule. Pure; `dives` are one or more Divers' live Dives. */
export function findChecks(dives: CheckedDive[]): LogbookCheck[] {
  const sorted = [...dives].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime() || x.id.localeCompare(y.id));
  // A Dive whose offset is unknown keeps a wall-clock time up to 14 hours from its instant: looked that much further.
  const reach = (d: CheckedDive) => d.startsAt.getTime() + (d.durationSeconds + OVERLAP_TOLERANCE_SECONDS) * 1000 + 2 * 14 * 3600_000;
  const found: { rule: LogbookCheckRule; a: CheckedDive; b: CheckedDive }[] = [];
  sorted.forEach((a, i) => {
    for (let k = i + 1; k < sorted.length && sorted[k]!.startsAt.getTime() <= reach(a); k++) {
      const rule = ruleFor(a, sorted[k]!);
      if (rule) found.push({ rule, a, b: sorted[k]! });
    }
  });
  const partners = (id: string) => found.filter((f) => f.rule === 'recording_beside_entry' && (f.a.id === id || f.b.id === id)).length;
  return found.map(({ rule, a, b }) => ({
    rule, dives: [a, b],
    obvious: rule === 'recording_beside_entry' && partners(a.id) === 1 && partners(b.id) === 1
      && !depthsDisagree(a.maxDepthM ?? undefined, b.maxDepthM ?? undefined),
  }));
}

/** The pair as an answer is kept: the two ids in order. */
export const ordered = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
