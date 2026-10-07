// The rules of the logbook checks (ADR 0038), pure: which pairs of Dives can't both be right as they stand. They use the
// import's own matching, so a check never disagrees with what a fresh import would have done.
import { OVERLAP_TOLERANCE_SECONDS, alignedForMatching, depthsDisagree, localStartMs, overlaps } from '../imports/matching.js';

/** Changes when a rule changes what it finds. */
export const LOGBOOK_CHECKS_VERSION = 2;

/**
 * `recording_beside_entry`: a Dive without a Recording and a Dive with one at the same time, as an import would have
 * attached them (its tolerance). `overlapping_dives`: two Dives of one Diver that really overlap in time.
 * `entry_apart_from_recording` (version 2): an entry and a Recording's Dive on the same local day that don't overlap but
 * agree in depth and duration: the same dive typed with another start.
 */
export const LOGBOOK_CHECK_RULES = ['recording_beside_entry', 'overlapping_dives', 'entry_apart_from_recording'] as const;
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

/** Fixed, no setting (ADR 0038, amendment): to be revisited with more than one Provider's data. */
const APART_DEPTH_M = 0.2;
const APART_DEPTH_RATIO = 0.03;
const APART_DURATION_SECONDS = 3 * 60;
const DAY_MS = 86_400_000;

const sameLocalDay = (a: CheckedDive, b: CheckedDive) => Math.floor(localStartMs(a) / DAY_MS) === Math.floor(localStartMs(b) / DAY_MS);

/** Whether two Dives look like one dive typed with another start: depth (0.2 m or 3 %) and duration (3 minutes) agree. */
function agreeInDepthAndDuration(a: CheckedDive, b: CheckedDive): boolean {
  if (a.maxDepthM === null || b.maxDepthM === null) return false;
  return Math.abs(a.maxDepthM - b.maxDepthM) <= Math.max(APART_DEPTH_M, APART_DEPTH_RATIO * Math.max(a.maxDepthM, b.maxDepthM))
    && Math.abs(a.durationSeconds - b.durationSeconds) <= APART_DURATION_SECONDS;
}

/**
 * The rule two Dives of one Diver break together, if any. Pure. `entry_apart_from_recording` is only whether the pair
 * qualifies; that each Dive is in one pair at most is decided over the whole logbook (`findChecks`).
 */
export function ruleFor(a: CheckedDive, b: CheckedDive): LogbookCheckRule | null {
  if (a.id === b.id || a.diverId !== b.diverId) return null;
  const mixed = (a.recordings === 0) !== (b.recordings === 0);
  // Where either offset is unknown, the two compare in local time (ADR 0030).
  const [other] = alignedForMatching(a, [b]) as [CheckedDive];
  const span = (d: CheckedDive) => ({ startsAt: d.startsAt, durationSeconds: d.durationSeconds, maxDepthM: undefined });
  if (!overlaps(span(a), span(other), mixed ? OVERLAP_TOLERANCE_SECONDS : 0)) {
    return mixed && sameLocalDay(a, b) && agreeInDepthAndDuration(a, b) ? 'entry_apart_from_recording' : null;
  }
  return mixed ? 'recording_beside_entry' : 'overlapping_dives';
}

/** How far apart two Dives start on the wall clock, in ms. */
export const startsApartMs = (a: CheckedDive, b: CheckedDive) => Math.abs(localStartMs(a) - localStartMs(b));

/**
 * Of the pairs that qualify for `entry_apart_from_recording`, those that stay: nearest start first, a Dive in at most one
 * pair, and where a Dive has two equally near partners, none.
 */
function oneToOne(pairs: { a: CheckedDive; b: CheckedDive }[]): { a: CheckedDive; b: CheckedDive }[] {
  const byDistance = new Map<number, { a: CheckedDive; b: CheckedDive }[]>();
  for (const p of pairs) {
    const apart = startsApartMs(p.a, p.b);
    byDistance.set(apart, [...(byDistance.get(apart) ?? []), p]);
  }
  const used = new Set<string>();
  const kept: { a: CheckedDive; b: CheckedDive }[] = [];
  for (const apart of [...byDistance.keys()].sort((x, y) => x - y)) {
    const free = byDistance.get(apart)!.filter(({ a, b }) => !used.has(a.id) && !used.has(b.id));
    const count = new Map<string, number>();
    for (const { a, b } of free) for (const id of [a.id, b.id]) count.set(id, (count.get(id) ?? 0) + 1);
    for (const p of free) if (count.get(p.a.id) === 1 && count.get(p.b.id) === 1) kept.push(p);
    // A tied Dive gets no suggestion, and is not offered a farther partner either.
    for (const [id] of count) used.add(id);
  }
  return kept;
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
      if (rule && rule !== 'entry_apart_from_recording') found.push({ rule, a, b: sorted[k]! });
    }
  });
  // Pairs far apart on the clock: the same local day, found apart from the overlap scan above, which only reaches a few hours.
  const byDay = new Map<string, CheckedDive[]>();
  for (const d of sorted) {
    const key = `${d.diverId}:${Math.floor(localStartMs(d) / DAY_MS)}`;
    byDay.set(key, [...(byDay.get(key) ?? []), d]);
  }
  const apart: { a: CheckedDive; b: CheckedDive }[] = [];
  for (const day of byDay.values()) {
    for (const entry of day.filter((d) => d.recordings === 0)) {
      for (const file of day.filter((d) => d.recordings > 0)) {
        if (ruleFor(entry, file) === 'entry_apart_from_recording') apart.push(entry.startsAt <= file.startsAt ? { a: entry, b: file } : { a: file, b: entry });
      }
    }
  }
  const partners = (id: string) => found.filter((f) => f.rule === 'recording_beside_entry' && (f.a.id === id || f.b.id === id)).length;
  const checks: LogbookCheck[] = found.map(({ rule, a, b }) => ({
    rule, dives: [a, b],
    obvious: rule === 'recording_beside_entry' && partners(a.id) === 1 && partners(b.id) === 1
      && !depthsDisagree(a.maxDepthM ?? undefined, b.maxDepthM ?? undefined),
  }));
  // Never obvious: each needs the User's own click.
  for (const { a, b } of oneToOne(apart)) checks.push({ rule: 'entry_apart_from_recording', dives: [a, b], obvious: false });
  return checks;
}

/** The pair as an answer is kept: the two ids in order. */
export const ordered = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
