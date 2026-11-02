// The rules of the logbook checks (ADR 0038), pure: which pairs of Dives can't both be right as they stand, and which
// Dive is probably no dive. The pair rules use the import's own matching, so a check never disagrees with what a fresh
// import would have done.
import { MAX_OFFSET_MS, OVERLAP_TOLERANCE_SECONDS, alignedForMatching, depthsDisagree, localDay, localStartMs, overlaps } from '../../imports/matching.js';
import type { RecordingUnit } from '../recording-units.js';

/** Changes when a rule changes what it finds. */
export const LOGBOOK_CHECKS_VERSION = 5;

/**
 * `recording_beside_entry`: a Dive without a Recording and a Dive with one at the same time, as an import would have
 * attached them (its tolerance). `overlapping_dives`: two Dives of one Diver that really overlap in time.
 * `entry_apart_from_recording` (version 2): an entry and a Recording's Dive on the same local day that don't overlap but
 * agree in depth and duration: the same dive typed with another start. `short_shallow_dive` (version 3), about one Dive:
 * a Recording so short and shallow that it is probably no dive (a computer that got wet, a false start). Version 4: a
 * `recording_beside_entry` pair with such a Dive in it is never obvious. `surface_break` (version 5, ADR 0063): two Dives
 * of one Device, the later starting at most 10 minutes after the earlier ends: one dive cut in two, for Appending.
 */
export const LOGBOOK_CHECK_RULES = ['recording_beside_entry', 'overlapping_dives', 'entry_apart_from_recording', 'short_shallow_dive', 'surface_break'] as const;
export type LogbookCheckRule = (typeof LOGBOOK_CHECK_RULES)[number];
/** The rules about two Dives. */
export type PairRule = Exclude<LogbookCheckRule, 'short_shallow_dive'>;

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
  /** Its one unit, when it has exactly one with a Device (`surface_break` needs it). */
  unit?: RecordingUnit | null;
}

/** Fixed, no setting (ADR 0038, amendment): to be revisited with more than one Provider's data. */
const APART_DEPTH_M = 0.2;
const APART_DEPTH_RATIO = 0.03;
const APART_DURATION_SECONDS = 3 * 60;
/** Fixed and conservative (ADR 0038, amendment): ninety seconds to 12 m is an aborted descent, a real dive. */
const NO_DIVE_BELOW_SECONDS = 2 * 60;
const NO_DIVE_ABOVE_M = 3;
/** Fixed (ADR 0063): real repetitive dives usually lie 30 minutes or more apart. */
const SURFACE_BREAK_MAX_SECONDS = 10 * 60;

const sameLocalDay = (a: CheckedDive, b: CheckedDive) => localDay(a) === localDay(b);

/** Whether two Dives look like one dive typed with another start: depth (0.2 m or 3 %) and duration (3 minutes) agree. */
function agreeInDepthAndDuration(a: CheckedDive, b: CheckedDive): boolean {
  if (a.maxDepthM === null || b.maxDepthM === null) return false;
  return Math.abs(a.maxDepthM - b.maxDepthM) <= Math.max(APART_DEPTH_M, APART_DEPTH_RATIO * Math.max(a.maxDepthM, b.maxDepthM))
    && Math.abs(a.durationSeconds - b.durationSeconds) <= APART_DURATION_SECONDS;
}

/** The Surface break between two Dives' units, in seconds: from the end of the earlier one's to the start of the later one's. */
export const surfaceBreakSeconds = (earlier: CheckedDive, later: CheckedDive) =>
  Math.round((later.unit!.startsAt.getTime() - earlier.unit!.endsAt.getTime()) / 1000);

/**
 * Whether `later` may be appended to `earlier` by the rule: units of one Device, at most 10 minutes between them, neither
 * probably no dive (a false start is offered for deleting), and the later no joined Recording (the earlier may be one).
 */
function followsSoon(earlier: CheckedDive, later: CheckedDive): boolean {
  const [e, l] = [earlier.unit, later.unit];
  if (!e || !l || l.joined || e.deviceId !== l.deviceId || probablyNoDive(earlier) || probablyNoDive(later)) return false;
  const gap = surfaceBreakSeconds(earlier, later);
  return gap > 0 && gap <= SURFACE_BREAK_MAX_SECONDS;
}

/**
 * The rule two Dives of one Diver break together, if any. Pure. `entry_apart_from_recording` and `surface_break` are only
 * whether the pair qualifies; which pairs stay is decided over the whole logbook (`findChecks`).
 */
export function ruleFor(a: CheckedDive, b: CheckedDive): PairRule | null {
  if (a.id === b.id || a.diverId !== b.diverId) return null;
  const mixed = (a.recordings === 0) !== (b.recordings === 0);
  // Where either offset is unknown, the two compare in local time (ADR 0030).
  const [other] = alignedForMatching(a, [b]) as [CheckedDive];
  const span = (d: CheckedDive) => ({ startsAt: d.startsAt, durationSeconds: d.durationSeconds, maxDepthM: undefined });
  if (!overlaps(span(a), span(other), mixed ? OVERLAP_TOLERANCE_SECONDS : 0)) {
    if (mixed) return sameLocalDay(a, b) && agreeInDepthAndDuration(a, b) ? 'entry_apart_from_recording' : null;
    return followsSoon(a, b) || followsSoon(b, a) ? 'surface_break' : null;
  }
  return mixed ? 'recording_beside_entry' : 'overlapping_dives';
}

/** How far apart two Dives start on the wall clock, in ms. */
export const startsApartMs = (a: CheckedDive, b: CheckedDive) => Math.abs(localStartMs(a) - localStartMs(b));

type Pair = { a: CheckedDive; b: CheckedDive };

/**
 * Of the pairs that qualify, those that stay: nearest first, each of a pair's two slots taken at most once
 * (`entry_apart_from_recording`: the Dive; `surface_break`: the earlier Dive's partner after it, the later one's before
 * it), and where a slot has two equally near partners, none.
 */
function oneToOne(pairs: Pair[], distance: (p: Pair) => number, slots: (p: Pair) => [string, string]): Pair[] {
  const byDistance = new Map<number, Pair[]>();
  for (const p of pairs) {
    const apart = distance(p);
    byDistance.set(apart, [...(byDistance.get(apart) ?? []), p]);
  }
  const used = new Set<string>();
  const kept: Pair[] = [];
  for (const apart of [...byDistance.keys()].sort((x, y) => x - y)) {
    const free = byDistance.get(apart)!.filter((p) => slots(p).every((slot) => !used.has(slot)));
    const count = new Map<string, number>();
    for (const p of free) for (const slot of slots(p)) count.set(slot, (count.get(slot) ?? 0) + 1);
    for (const p of free) if (slots(p).every((slot) => count.get(slot) === 1)) kept.push(p);
    // A tied slot gets no suggestion, and is not offered a farther partner either.
    for (const [slot] of count) used.add(slot);
  }
  return kept;
}

export interface LogbookCheck {
  rule: PairRule;
  /** The two Dives, the earlier first; a `surface_break` chain has more (`inChains`). */
  dives: [CheckedDive, CheckedDive, ...CheckedDive[]];
  /**
   * An import would have put the two together by itself: one Recording's Dive, one entry's, no other in reach, depths
   * agreeing, neither probably no dive.
   */
  obvious: boolean;
}

/** Every pair of Dives that breaks a rule. Pure; `dives` are one or more Divers' live Dives. */
export function findChecks(dives: CheckedDive[]): LogbookCheck[] {
  const sorted = [...dives].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime() || x.id.localeCompare(y.id));
  // A Dive whose offset is unknown keeps a wall-clock time up to 14 hours from its instant: looked that much further.
  const reach = (d: CheckedDive) => d.startsAt.getTime() + (d.durationSeconds + OVERLAP_TOLERANCE_SECONDS) * 1000 + 2 * MAX_OFFSET_MS;
  const found: { rule: PairRule; a: CheckedDive; b: CheckedDive }[] = [];
  const breaks: Pair[] = [];
  sorted.forEach((a, i) => {
    for (let k = i + 1; k < sorted.length && sorted[k]!.startsAt.getTime() <= reach(a); k++) {
      const b = sorted[k]!;
      const rule = ruleFor(a, b);
      if (rule === 'surface_break') breaks.push(a.unit!.startsAt <= b.unit!.startsAt ? { a, b } : { a: b, b: a });
      else if (rule && rule !== 'entry_apart_from_recording') found.push({ rule, a, b });
    }
  });
  // Pairs far apart on the clock: the same local day, found apart from the overlap scan above, which only reaches a few hours.
  const byDay = new Map<string, CheckedDive[]>();
  for (const d of sorted) {
    const key = `${d.diverId}:${localDay(d)}`;
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
  // An import neither attaches a probable non-dive by itself nor counts it as a candidate (ADR 0030, amended): such a
  // pair is never obvious, and no partner that makes another pair ambiguous.
  const real = (f: { a: CheckedDive; b: CheckedDive }) => !probablyNoDive(f.a) && !probablyNoDive(f.b);
  const partners = (id: string) => found.filter((f) => f.rule === 'recording_beside_entry' && real(f) && (f.a.id === id || f.b.id === id)).length;
  const checks: LogbookCheck[] = found.map(({ rule, a, b }) => ({
    rule, dives: [a, b],
    obvious: rule === 'recording_beside_entry' && real({ a, b }) && partners(a.id) === 1 && partners(b.id) === 1
      && !depthsDisagree(a.maxDepthM ?? undefined, b.maxDepthM ?? undefined),
  }));
  // Never obvious: each needs the User's own click.
  for (const { a, b } of oneToOne(apart, (p) => startsApartMs(p.a, p.b), (p) => [p.a.id, p.b.id])) {
    checks.push({ rule: 'entry_apart_from_recording', dives: [a, b], obvious: false });
  }
  // One partner before a Dive and one after it, the nearer winning.
  for (const { a, b } of oneToOne(breaks, (p) => surfaceBreakSeconds(p.a, p.b), (p) => [`${p.a.id}:after`, `${p.b.id}:before`])) {
    checks.push({ rule: 'surface_break', dives: [a, b], obvious: false });
  }
  return checks;
}

/**
 * The checks with the `surface_break` pairs that follow one another (A–B, B–C) as one check of all their Dives, in order;
 * the others as they are. Pure; given the pairs of one status, a pair answered "two dives" ends a chain there.
 */
export function inChains(checks: LogbookCheck[]): LogbookCheck[] {
  const breaks = checks.filter((c) => c.rule === 'surface_break');
  const after = new Map(breaks.map((c) => [c.dives[0].id, c.dives[1]]));
  const later = new Set(breaks.map((c) => c.dives[1].id));
  const chains = breaks.filter((c) => !later.has(c.dives[0].id)).map((c) => {
    const dives: LogbookCheck['dives'] = [...c.dives];
    for (let next = after.get(c.dives[1].id); next; next = after.get(next.id)) dives.push(next);
    return { ...c, dives };
  });
  return [...checks.filter((c) => c.rule !== 'surface_break'), ...chains];
}

/** The pair as an answer is kept: the two ids in order. */
export const ordered = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/**
 * Whether a Dive is probably no dive: it has a Recording, lasted under 2 minutes and stayed above 3 m. Needs the depth;
 * a Dive without a Recording was typed by someone, and a short one is a typo.
 */
export function probablyNoDive(d: Pick<CheckedDive, 'recordings' | 'durationSeconds' | 'maxDepthM'>): boolean {
  return d.recordings > 0 && d.durationSeconds < NO_DIVE_BELOW_SECONDS && d.maxDepthM !== null && d.maxDepthM < NO_DIVE_ABOVE_M;
}

/** A Dive as `short_shallow_dive` sees it. */
export interface DeletableDive extends CheckedDive {
  fromProvider: string | null;
}

/**
 * `short_shallow_dive`: whether to suggest deleting the Dive. Not one at a Provider or made from a Provider's entry: that
 * is more likely a wrong link than clutter, and a delete there can't be undone.
 */
export function suggestsDeleting(d: DeletableDive, atProvider: boolean): boolean {
  return probablyNoDive(d) && !atProvider && d.fromProvider === null;
}
