// Decides where a new Recording belongs (docs/spec/data-model.md, scenario 1):
// no overlapping Dive → new Dive; exactly one plausible Dive → auto-attach; otherwise the User decides.

export interface TimeSpan {
  startsAt: Date;
  durationSeconds: number;
  maxDepthM: number | undefined;
  /** Probably no dive (`probablyNoDive`, ADR 0038): the caller says so, as the logbook check does. */
  probablyNoDive?: boolean;
}

export interface CandidateDive extends TimeSpan {
  id: string;
}

export type MatchDecision =
  | { kind: 'create' }
  | { kind: 'attach'; diveId: string }
  | { kind: 'duplicate-candidate'; diveIds: string[]; reason: DuplicateReason };

export type DuplicateReason = 'overlaps_several_dives' | 'max_depth_differs' | 'probably_no_dive';

/** Allowed clock drift between devices. Tune with real files (open question in the data model). */
export const OVERLAP_TOLERANCE_SECONDS = 5 * 60;

export function overlapWindow(span: TimeSpan, tolerance = OVERLAP_TOLERANCE_SECONDS): { from: Date; to: Date } {
  const start = span.startsAt.getTime();
  return {
    from: new Date(start - tolerance * 1000),
    to: new Date(start + (span.durationSeconds + tolerance) * 1000),
  };
}

/** Whether two spans meet, the first widened by the tolerance on both ends. */
export function overlaps(a: TimeSpan, b: TimeSpan, tolerance: number): boolean {
  const aStart = a.startsAt.getTime() - tolerance * 1000;
  const aEnd = a.startsAt.getTime() + (a.durationSeconds + tolerance) * 1000;
  const bStart = b.startsAt.getTime();
  const bEnd = bStart + b.durationSeconds * 1000;
  return aStart < bEnd && bStart < aEnd;
}

export function depthsDisagree(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) > Math.max(3, 0.25 * Math.max(a, b));
}

export function decideMatch(
  recording: TimeSpan,
  dives: CandidateDive[],
  tolerance = OVERLAP_TOLERANCE_SECONDS,
): MatchDecision {
  const inReach = dives.filter((d) => overlaps(recording, d, tolerance));
  // A probable non-dive never attaches by itself (ADR 0030, amended): the User decides beside every Dive in reach.
  if (recording.probablyNoDive && inReach.length > 0) {
    return { kind: 'duplicate-candidate', diveIds: inReach.map((d) => d.id), reason: 'probably_no_dive' };
  }
  // Nor is a Dive that is one a candidate for a real Recording, which is placed as if it weren't there.
  const hits = inReach.filter((d) => !d.probablyNoDive);
  if (hits.length === 0) return { kind: 'create' };
  if (hits.length > 1) {
    return { kind: 'duplicate-candidate', diveIds: hits.map((d) => d.id), reason: 'overlaps_several_dives' };
  }
  const [dive] = hits as [CandidateDive];
  if (depthsDisagree(recording.maxDepthM, dive.maxDepthM)) {
    return { kind: 'duplicate-candidate', diveIds: [dive.id], reason: 'max_depth_differs' };
  }
  return { kind: 'attach', diveId: dive.id };
}

/** A Dive's start as its local wall-clock time, in ms as if UTC (ADR 0030). Without an offset, its stored time. */
export const localStartMs = (d: { startsAt: Date; utcOffsetSeconds: number | null }) =>
  d.startsAt.getTime() + (d.utcOffsetSeconds ?? 0) * 1000;

/**
 * The Dives a Provider's logbook entry may be (ADR 0030): on the same local day, starting within the window, compared in
 * local time. Closest first.
 */
export function entryMatches<D extends { id: string; startsAt: Date; utcOffsetSeconds: number | null }>(
  entryLocalMs: number, dives: D[], windowMinutes: number,
): D[] {
  const day = (ms: number) => Math.floor(ms / 86_400_000);
  return dives
    .map((d) => ({ d, apart: Math.abs(localStartMs(d) - entryLocalMs) }))
    .filter(({ d, apart }) => day(localStartMs(d)) === day(entryLocalMs) && apart <= windowMinutes * 60_000)
    .sort((a, b) => a.apart - b.apart)
    .map(({ d }) => d);
}

/**
 * Candidates as a Recording compares with them: where either side's offset is unknown (its wall-clock time kept as if
 * UTC, ADR 0030), the Dive's local time is moved into the Recording's offset, so the two compare in local time.
 */
export function alignedForMatching<D extends { startsAt: Date; utcOffsetSeconds: number | null; utcOffsetSource: string }>(
  rec: { utcOffsetSeconds: number | null; utcOffsetSource: string }, dives: D[],
): D[] {
  return dives.map((d) => (rec.utcOffsetSource === 'unknown' || d.utcOffsetSource === 'unknown'
    ? { ...d, startsAt: new Date(localStartMs(d) - (rec.utcOffsetSeconds ?? 0) * 1000) }
    : d));
}
