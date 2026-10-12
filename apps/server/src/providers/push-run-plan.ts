// What a Push run does with one Dive, and in which order (ADR 0047, 0048). Pure: it works from a Dive's status at the
// Provider (what Dive Hub knows, no call) and the run's options.

export type LeftOutReason = 'up_to_date' | 'requirements_unmet' | 'update_not_chosen' | 'removes_verification' | 'update_unsupported';

/** The part of `pushes.status` the plan looks at. */
export interface PlanStatus {
  unmet: { severity: 'blocking' | 'advisory' }[];
  current: {
    upToDate: boolean;
    updateRemovesVerification: boolean;
    remoteNumber: number | null;
    number: { wanted: number; differs: boolean; canSet: boolean; removesVerification: boolean } | null;
  } | null;
}

export interface PlanOptions {
  updates: boolean;
  updatesRemovingVerification: boolean;
  numbers: boolean;
  /** The run was confirmed for number changes that can remove a verification (ADR 0052). */
  numbersRemovingVerification: boolean;
  /** The Provider updates dives at all. */
  canUpdate: boolean;
}

export type Planned =
  | { send: 'create' | 'update' }
  | { send: 'number'; wanted: number; held: number | null }
  | { leftOut: LeftOutReason; numberNotChosen: boolean };

const out = (leftOut: LeftOutReason, numberNotChosen = false): Planned => ({ leftOut, numberNotChosen });

export function planItem(status: PlanStatus, options: PlanOptions): Planned {
  if (status.unmet.some((u) => u.severity === 'blocking')) return out('requirements_unmet');
  const { current } = status;
  if (!current) return { send: 'create' };
  let base: LeftOutReason;
  if (current.upToDate) base = 'up_to_date';
  else if (!options.canUpdate) base = 'update_unsupported';
  else if (!options.updates) base = 'update_not_chosen';
  else if (current.updateRemovesVerification && !options.updatesRemovingVerification) return out('removes_verification');
  else return { send: 'update' };

  // Only the number differs, or an update isn't chosen: the number alone can still go (ADR 0048).
  const number = current.number;
  if (number?.differs && number.canSet) {
    if (!options.numbers) return out(base, true);
    // Its own confirmation, asked once per run (ADR 0052); the tick for updates is no part of it.
    if (number.removesVerification && !options.numbersRemovingVerification) return out('removes_verification', false);
    return { send: 'number', wanted: number.wanted, held: current.remoteNumber };
  }
  return out(base);
}

export interface Orderable {
  diveId: string;
  startsAt: Date;
  planned: { send: 'create' | 'update' } | { send: 'number'; wanted: number; held: number | null };
}

/**
 * Number changes first, each when its number is free (the highest wanted first among those that can go, so numbers
 * moving up go from the top and numbers moving down from the bottom); then creates and updates, oldest first.
 *
 * Dives that only move among themselves (a swap, a cycle) are broken at one dive (ADR 0052): it goes first and
 * `shares` says which dive holds the number it takes, for the length of that save; the rest then follow by the free
 * rule, so at most one pair shares a number at any moment and none does at the end. A change that waits for a dive the
 * run doesn't move comes back as `numberTaken`; one whose number a dive only at the Provider holds (`fixed`) as
 * `numberHeld`. `held` is the number each Dive Hub knows to be at the Provider, by Dive.
 */
export function orderItems<T extends Orderable>(
  items: T[], held: Map<string, number | null>, fixed: ReadonlySet<number> = new Set(),
): { ordered: T[]; numberTaken: T[]; numberHeld: T[]; shares: Map<string, string> } {
  const wanted = (i: T) => (i.planned as { wanted: number }).wanted;
  const all = items.filter((i) => i.planned.send === 'number');
  const numberHeld = all.filter((i) => fixed.has(wanted(i)));
  const rest = items.filter((i) => i.planned.send !== 'number')
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.diveId.localeCompare(b.diveId));
  const now = new Map(held);
  const holderOf = (i: T) => [...now].filter(([diveId, number]) => diveId !== i.diveId && number === wanted(i)).map(([diveId]) => diveId).sort((a, b) => a.localeCompare(b))[0];
  const ordered: T[] = [];
  const shares = new Map<string, string>();
  let waiting = all.filter((i) => !fixed.has(wanted(i)));
  /** The items that wait for each other in a ring back to `start`, or null when `start` is not in one. */
  const ringOf = (start: T) => {
    const path: T[] = [];
    let at: T | undefined = start;
    while (at && !path.includes(at)) {
      path.push(at);
      const holder: string | undefined = holderOf(at);
      at = waiting.find((w) => w.diveId === holder);
    }
    return at === start ? path : null;
  };
  for (;;) {
    const sorted = [...waiting].sort((a, b) => wanted(b) - wanted(a) || a.diveId.localeCompare(b.diveId));
    const free = sorted.find((i) => holderOf(i) === undefined);
    const next = free ?? sorted.find((i) => ringOf(i));
    if (!next) break;
    if (!free) shares.set(next.diveId, holderOf(next)!);
    ordered.push(next);
    now.set(next.diveId, wanted(next));
    waiting = waiting.filter((i) => i !== next);
  }
  return { ordered: [...ordered, ...rest], numberTaken: waiting, numberHeld, shares };
}
