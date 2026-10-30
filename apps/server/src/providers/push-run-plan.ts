// What a Push run does with one Dive, and in which order (ADR 0047, 0048). Pure: it works from a Dive's status at the
// Provider (what Dive Hub knows, no call) and the run's options.
import { blocking } from './requirements.js';

export type LeftOutReason = 'up_to_date' | 'requirements_unmet' | 'update_not_chosen' | 'removes_verification' | 'update_unsupported';

/** The part of `pushes.status` the plan looks at. */
export interface PlanStatus {
  /** `bySend`: a site requirement the send fixes itself. */
  unmet: { severity: 'blocking' | 'advisory'; bySend?: boolean }[];
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
  // A site the send finds or makes at the Provider doesn't keep a Dive out of the run.
  if (blocking(status.unmet, { beforeSite: true }).length > 0) return out('requirements_unmet');
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

/** A Dive in a run's scope, with its status at the Provider. */
export interface ScopedDive<S extends PlanStatus> {
  dive: { id: string; startsAt: Date; number: number | null; siteId: string | null; siteName: string | null };
  status: S;
}

/** A Dive that unmet requirements keep out of a run, with what is unmet. */
export type Blocked<S extends PlanStatus> = Omit<ScopedDive<S>['dive'], 'id'> & { diveId: string; unmet: S['unmet'] };

/** What the preview counts a Dive as, whatever the run's choices. */
const KINDS = ['create', 'update', 'updateRemovingVerification', 'upToDate', 'requirementsUnmet', 'updateUnsupported'] as const;

function kindOf(status: PlanStatus, canUpdate: boolean): (typeof KINDS)[number] {
  const { current } = status;
  if (blocking(status.unmet, { beforeSite: true }).length > 0) return 'requirementsUnmet';
  if (!current) return 'create';
  if (current.upToDate) return 'upToDate';
  if (!canUpdate) return 'updateUnsupported';
  return current.updateRemovesVerification ? 'updateRemovingVerification' : 'update';
}

const LEFT_OUT_KEY = {
  up_to_date: 'upToDate', requirements_unmet: 'requirementsUnmet', update_not_chosen: 'updateNotChosen',
  removes_verification: 'removesVerification', update_unsupported: 'updateUnsupported',
} as const satisfies Record<LeftOutReason, string>;
const LEFT_OUT_KEYS = Object.values(LEFT_OUT_KEY);

/** How many of `keys` are each of `all`, every one of `all` counted (0 when none is). */
function tally<K extends string>(all: readonly K[], keys: K[]): Record<K, number> {
  return Object.fromEntries(all.map((k) => [k, keys.filter((key) => key === k).length])) as Record<K, number>;
}

/**
 * Every Dive of a run's scope, sorted for the preview and the run: the counts of the whole picture, the Dives left out
 * by reason, the blocked ones, the run's candidates, and the number changes that could be ordered (whatever the run's
 * choices). `along` on a candidate: the number an update carries with it (its own save), shown in the plan though no
 * item of its own.
 */
export function classify<S extends PlanStatus>(dives: ScopedDive<S>[], options: PlanOptions) {
  const rows = dives.map(({ dive, status }) => ({
    dive, status, kind: kindOf(status, options.canUpdate), settable: settableNumber(status), planned: planItem(status, options),
  }));
  const settable = rows.flatMap((r) => (r.settable ? [{ ...r, settable: r.settable }] : []));
  const leftOutOnes = rows.flatMap((r) => ('leftOut' in r.planned ? [r.planned] : []));
  return {
    counts: {
      ...tally(KINDS, rows.map((r) => r.kind)),
      number: settable.length, numberRemovingVerification: settable.filter((r) => r.settable.removesVerification).length,
    },
    leftOut: {
      ...tally(LEFT_OUT_KEYS, leftOutOnes.map((p) => LEFT_OUT_KEY[p.leftOut])),
      numberNotChosen: leftOutOnes.filter((p) => p.numberNotChosen).length,
    },
    blocked: rows.filter((r) => r.kind === 'requirementsUnmet').map(({ dive: d, status }): Blocked<S> => (
      { diveId: d.id, number: d.number, startsAt: d.startsAt, siteId: d.siteId, siteName: d.siteName, unmet: status.unmet })),
    candidates: rows.flatMap(({ dive: d, status, settable: number, planned }) => {
      if ('leftOut' in planned) return [];
      const along = planned.send === 'update' && number ? { from: status.current!.remoteNumber, to: number.wanted } : null;
      return [{ diveId: d.id, startsAt: d.startsAt, planned, withLeftOut: status.unmet.length > 0, along }];
    }),
    numberOnly: settable.flatMap(({ dive: d, status }) => {
      const planned = numberOnlyPlan(status, options);
      return planned ? [{ diveId: d.id, startsAt: d.startsAt, planned }] : [];
    }),
  };
}

/** The number the Provider has that differs from the Dive's and can be set, or null. */
function settableNumber(status: PlanStatus) {
  const number = status.current?.number;
  return number?.differs && number.canSet ? number : null;
}

/** The Dive as a number change alone; whether these could be ordered doesn't depend on the run's choices. */
function numberOnlyPlan(status: PlanStatus, options: PlanOptions) {
  const planned = planItem(status, { ...options, updates: false, numbers: true, numbersRemovingVerification: true });
  return 'send' in planned && planned.send === 'number' ? planned : null;
}

/** A Dive that is busy is tried again later; this many tries in all. */
const BUSY_TRIES = 3;
/** What stops a run at once: the account needs the User, not another try. */
const STOPS_AT_ONCE: ReadonlySet<string> = new Set(['provider_sign_in_needed', 'provider_wrong_credentials', 'provider_not_connected']);
/** Refusals that skip the Dive, and the reason the item shows. */
const SKIPPED_AS: Readonly<Record<string, string>> = {
  provider_requirements_unmet: 'requirements_unmet', provider_number_taken: 'number_taken', provider_number_nothing_to_set: 'up_to_date',
};

/**
 * What a step does with a Dive whose send failed with this code, on this try (ADR 0047's table "What stops a run"):
 * try it `later` behind the Dives still waiting, `stop` the run with the Dive waiting again, `skip` it, or `fail` it
 * (`inARow`: the failure counts towards the ones in a row that stop a run).
 */
export type FailureOutcome = { then: 'later' } | { then: 'stop' } | { then: 'skip'; reason: string } | { then: 'fail'; inARow: boolean };

export function failureOutcome(code: string, attempts: number): FailureOutcome {
  if (code === 'provider_busy') return attempts < BUSY_TRIES ? { then: 'later' } : { then: 'fail', inARow: false };
  if (STOPS_AT_ONCE.has(code)) return { then: 'stop' };
  const reason = SKIPPED_AS[code];
  return reason ? { then: 'skip', reason } : { then: 'fail', inARow: true };
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

/** One number a run sets, with the save it goes in (`with`) and the dive it shares the number with for that save. */
export interface NumberStep { diveId: string; number: number | null; from: number | null; to: number; sharesWith: string | null; with: 'number' | 'update' }

/** Every number a run would set, in the order it goes (ADR 0052): the User sees it before anything is sent. */
export function numberPlanOf(
  sendList: (Orderable & { along: { from: number | null; to: number } | null })[],
  diveOf: ReadonlyMap<string, { number: number | null }>, shares: ReadonlyMap<string, string>,
): NumberStep[] {
  return sendList.flatMap((i): NumberStep[] => {
    const number = diveOf.get(i.diveId)?.number ?? null;
    if (i.planned.send === 'number') return [{ diveId: i.diveId, number, from: i.planned.held, to: i.planned.wanted, sharesWith: shares.get(i.diveId) ?? null, with: 'number' }];
    return i.along ? [{ diveId: i.diveId, number, from: i.along.from, to: i.along.to, sharesWith: null, with: 'update' }] : [];
  });
}
