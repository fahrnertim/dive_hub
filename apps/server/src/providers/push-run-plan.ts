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
    if (number.removesVerification && !options.updatesRemovingVerification) return out('removes_verification', false);
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
 * moving up go from the top and numbers moving down from the bottom); then creates and updates, oldest first. A number
 * change that never becomes free (dives swapping numbers among themselves) comes back as `numberTaken`.
 * `held` is the number each Dive Hub knows to be at the Provider, by Dive.
 */
export function orderItems<T extends Orderable>(items: T[], held: Map<string, number | null>): { ordered: T[]; numberTaken: T[] } {
  const numbers = items.filter((i) => i.planned.send === 'number');
  const rest = items.filter((i) => i.planned.send !== 'number')
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.diveId.localeCompare(b.diveId));
  const now = new Map(held);
  const wanted = (i: T) => (i.planned as { wanted: number }).wanted;
  const free = (i: T) => ![...now].some(([diveId, number]) => diveId !== i.diveId && number === wanted(i));
  const ordered: T[] = [];
  let waiting = numbers;
  for (;;) {
    const next = waiting.filter(free).sort((a, b) => wanted(b) - wanted(a) || a.diveId.localeCompare(b.diveId))[0];
    if (!next) break;
    ordered.push(next);
    now.set(next.diveId, wanted(next));
    waiting = waiting.filter((i) => i !== next);
  }
  return { ordered: [...ordered, ...rest], numberTaken: waiting };
}
