// Dives gone at a Provider (ADR 0051): the comparison of a Connection's linked Dives with a complete listing. Pure, so a
// later sync job could call it too. By remote ID over the raw records, never over parsed dives and never by time or number.

/** A live or deleted Dive with the remote dive it has at the Provider now, and the Connection that Push went through. */
export interface GoneCandidate {
  diveId: string;
  remoteId: string;
  remoteNumber: number | null;
  /** The Connection of the Push that made the current remote dive; null when that Connection no longer exists. */
  connectionId: string | null;
  deleted: boolean;
}

/** From this many compared Dives on, finding more than half of them gone is a warning (the logbook may be the one at fault). */
export const GONE_WARNING_MIN = 5;

export interface GoneComparison {
  /** The listing had no records: nothing was compared, and nothing is a finding. */
  empty: boolean;
  /** The Dives that were compared: live, and made through this Connection. */
  compared: number;
  gone: GoneCandidate[];
  there: GoneCandidate[];
  warning: boolean;
}

/** More than half of at least GONE_WARNING_MIN compared Dives gone: look at the Provider's app first. */
export const goneWarning = (compared: number, gone: number) => compared >= GONE_WARNING_MIN && gone * 2 > compared;

export function compareGone(input: { connectionId: string; candidates: GoneCandidate[]; listed: { remoteId: string }[] }): GoneComparison {
  if (input.listed.length === 0) return { empty: true, compared: 0, gone: [], there: [], warning: false };
  const listed = new Set(input.listed.map((r) => r.remoteId));
  const comparable = input.candidates.filter((c) => !c.deleted && c.connectionId === input.connectionId);
  const gone = comparable.filter((c) => !listed.has(c.remoteId));
  return {
    empty: false, compared: comparable.length, gone, there: comparable.filter((c) => listed.has(c.remoteId)),
    warning: goneWarning(comparable.length, gone.length),
  };
}
