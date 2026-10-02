// Decides where a new Recording belongs (docs/spec/data-model.md, scenario 1):
// no overlapping Dive → new Dive; exactly one plausible Dive → auto-attach; otherwise the User decides.

export interface TimeSpan {
  startsAt: Date;
  durationSeconds: number;
  maxDepthM: number | undefined;
}

export interface CandidateDive extends TimeSpan {
  id: string;
}

export type MatchDecision =
  | { kind: 'create' }
  | { kind: 'attach'; diveId: string }
  | { kind: 'duplicate-candidate'; diveIds: string[]; reason: string };

/** Allowed clock drift between devices. Tune with real files (open question in the data model). */
export const OVERLAP_TOLERANCE_SECONDS = 5 * 60;

export function overlapWindow(span: TimeSpan, tolerance = OVERLAP_TOLERANCE_SECONDS): { from: Date; to: Date } {
  const start = span.startsAt.getTime();
  return {
    from: new Date(start - tolerance * 1000),
    to: new Date(start + (span.durationSeconds + tolerance) * 1000),
  };
}

function overlaps(a: TimeSpan, b: TimeSpan, tolerance: number): boolean {
  const aStart = a.startsAt.getTime() - tolerance * 1000;
  const aEnd = a.startsAt.getTime() + (a.durationSeconds + tolerance) * 1000;
  const bStart = b.startsAt.getTime();
  const bEnd = bStart + b.durationSeconds * 1000;
  return aStart < bEnd && bStart < aEnd;
}

function depthsDisagree(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) > Math.max(3, 0.25 * Math.max(a, b));
}

export function decideMatch(
  recording: TimeSpan,
  dives: CandidateDive[],
  tolerance = OVERLAP_TOLERANCE_SECONDS,
): MatchDecision {
  const hits = dives.filter((d) => overlaps(recording, d, tolerance));
  if (hits.length === 0) return { kind: 'create' };
  if (hits.length > 1) {
    return { kind: 'duplicate-candidate', diveIds: hits.map((d) => d.id), reason: 'overlaps several dives' };
  }
  const [dive] = hits as [CandidateDive];
  if (depthsDisagree(recording.maxDepthM, dive.maxDepthM)) {
    return { kind: 'duplicate-candidate', diveIds: [dive.id], reason: 'max depth differs too much' };
  }
  return { kind: 'attach', diveId: dive.id };
}
