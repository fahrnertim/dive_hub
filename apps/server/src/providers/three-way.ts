// Changes made at a Provider, taken back into Dive Hub (ADR 0030, amended): a three-way comparison per field between
// what the Provider had when Dive Hub last saw its dive (the base: the Original of the last import, or what Dive Hub
// sent last), what it has now, and what the Dive here has now. Pure: no database.
import type { DiveField, ImportedDive, ProviderCylinder } from './provider.js';
import { wallClockMs } from '../dives/time-zone.js';

/**
 * Fields a Provider's change can bring: on every Dive the site, notes and buddies; the tank on a Dive with at most one
 * Cylinder, and the lead on a Dive with at most one Lead entry; the values only on a Dive without a Recording.
 */
export const SYNCED_FIELDS = ['site', 'notes', 'buddies', 'cylinder', 'lead', 'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC'] as const satisfies readonly DiveField[];
export type SyncedField = (typeof SYNCED_FIELDS)[number];
export const VALUE_FIELDS: readonly SyncedField[] = ['startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC'];

/** One side's values as the comparison sees them. */
export interface Comparable {
  /** The site's ID at the Provider's site Source. */
  site: string | null;
  notes: string | null;
  /** The people on the dive, by their accounts at the Provider, sorted. */
  buddies: string[];
  /** The local start in whole minutes since 1970 (the Provider keeps minutes). */
  startsAt: number | null;
  durationSeconds: number | null;
  maxDepthM: number | null;
  avgDepthM: number | null;
  waterTemperatureC: number | null;
  /** The one tank: the Provider's, or the Dive's only Cylinder in the values a Provider keeps. */
  cylinder: ProviderCylinder | null;
  /** The lead in kg: the Provider's weight, or the total of the Dive's only Lead entry (none: null). */
  lead: number | null;
}

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** A Provider's dive as the comparison sees it. */
export function comparableOf(d: ImportedDive): Comparable {
  const local = wallClockMs(d.localStart);
  return {
    site: Object.values(d.siteIds)[0] ?? null, notes: text(d.notes), buddies: [...new Set(d.people)].sort(),
    startsAt: local === null ? null : Math.floor(local / 60_000), durationSeconds: d.durationSeconds || null,
    maxDepthM: d.maxDepthM, avgDepthM: d.avgDepthM, waterTemperatureC: d.waterTemperatureC, cylinder: d.cylinder, lead: d.leadKg,
  };
}

/** Two tanks alike: whole bar, 0.1 L, the same material and gas. */
function sameCylinder(a: ProviderCylinder, b: ProviderCylinder): boolean {
  const near = (x: number | null, y: number | null, by: number) => (x === null || y === null ? x === y : Math.abs(x - y) < by);
  return near(a.volumeL, b.volumeL, 0.06) && near(a.startPressureBar, b.startPressureBar, 0.6) && near(a.endPressureBar, b.endPressureBar, 0.6)
    && a.material === b.material && near(a.gas?.o2 ?? null, b.gas?.o2 ?? null, 0.6) && near(a.gas?.he ?? null, b.gas?.he ?? null, 0.6);
}

/** Equal as far as the Provider keeps it: minutes for times, a minute for durations, 0.1 for depths and temperatures. */
export function same(field: SyncedField, a: Comparable, b: Comparable): boolean {
  const x = field === 'notes' ? text(a.notes) : a[field];
  const y = field === 'notes' ? text(b.notes) : b[field];
  if (field === 'buddies') return JSON.stringify(x) === JSON.stringify(y);
  if (x === null || y === null) return x === y;
  if (field === 'cylinder') return sameCylinder(x as ProviderCylinder, y as ProviderCylinder);
  if (field === 'durationSeconds') return Math.abs((x as number) - (y as number)) < 60;
  if (field === 'lead') return Math.abs((x as number) - (y as number)) < 0.06;
  if (field === 'maxDepthM' || field === 'avgDepthM' || field === 'waterTemperatureC') return Math.abs((x as number) - (y as number)) < 0.06;
  return x === y;
}

/** Nothing there: null, or no buddies. */
function isEmpty(field: SyncedField, c: Comparable): boolean {
  if (field === 'buddies') return c.buddies.length === 0;
  return field === 'notes' ? text(c.notes) === null : c[field] === null;
}

/**
 * Per field against the base: changed only at the Provider, `take` its value (a removal there too, except the site);
 * changed only here, nothing, or `clear` when removed here; changed on both sides and differently, a conflict.
 * A removal is a change both ways (ADR 0056).
 */
export function threeWay(fields: readonly SyncedField[], base: Comparable, provider: Comparable, hub: Comparable) {
  const take: SyncedField[] = [];
  const conflicts: SyncedField[] = [];
  const clear: SyncedField[] = [];
  for (const field of fields) {
    if (same(field, provider, hub)) continue;
    const providerChanged = !same(field, base, provider);
    const hubChanged = !same(field, base, hub);
    if (!providerChanged && !hubChanged) continue;
    // The Provider no longer names a site: it never clears one here (SSI needs a site on every dive).
    if (field === 'site' && providerChanged && isEmpty('site', provider)) continue;
    // Where Dive Hub never saw a tank or weight there, the one here stays (the import only fills).
    if ((field === 'cylinder' || field === 'lead') && isEmpty(field, base) && !isEmpty(field, hub)) continue;
    if (providerChanged && !hubChanged) take.push(field);
    else if (hubChanged && !providerChanged) {
      if (isEmpty(field, hub)) clear.push(field);
    } else conflicts.push(field);
  }
  return { take, conflicts, clear };
}

export type Choice = 'hub' | 'provider';

export interface SendPlan {
  /** Taken from the Provider into the Dive here. */
  take: SyncedField[];
  /** Removed here: cleared at the Provider. */
  clear: SyncedField[];
  /** Left as the Provider has it in this send. */
  keep: SyncedField[];
  /** Both sides changed it; only with `onConflict: 'ask'`. */
  conflicts: SyncedField[];
}

/** What a send takes, sends (in no list), clears and keeps, given the User's choices and the fields of open entries. */
export function planSend(input: {
  fields: readonly SyncedField[]; base: Comparable | null; provider: Comparable; hub: Comparable;
  choices: Partial<Record<SyncedField, Choice>>; open: readonly SyncedField[]; onConflict: 'ask' | 'defer';
}): SendPlan {
  const { fields, base, provider, hub, choices, open, onConflict } = input;
  const plan: SendPlan = { take: [], clear: [], keep: [], conflicts: [] };
  if (base === null) {
    plan.take = fields.filter((f) => isEmpty(f, hub) && !isEmpty(f, provider));
    return plan;
  }
  const auto = threeWay(fields.filter((f) => !open.includes(f)), base, provider, hub);
  const settle = (field: SyncedField) => {
    const choice = choices[field];
    if (choice === 'provider') plan.take.push(field);
    else if (choice === 'hub') { if (isEmpty(field, hub)) plan.clear.push(field); }
    else (onConflict === 'ask' ? plan.conflicts : plan.keep).push(field);
  };
  for (const field of fields) {
    if (open.includes(field)) {
      if (!same(field, provider, hub)) settle(field);
    } else if (auto.take.includes(field)) plan.take.push(field);
    else if (auto.clear.includes(field)) plan.clear.push(field);
    else if (auto.conflicts.includes(field)) settle(field);
  }
  return plan;
}
