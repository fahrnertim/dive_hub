// Changes made at a Provider, taken back into Dive Hub (ADR 0030, amended): a three-way comparison per field between
// what the Provider had when Dive Hub last saw its dive (the base: the Original of the last import, or what Dive Hub
// sent last), what it has now, and what the Dive here has now. Pure: no database.
import type { ImportedDive } from './provider.js';
import { wallClockMs } from '../dives/time-zone.js';

/** Fields a Provider's change can bring: on every Dive the site, notes and buddies; the values only on a Dive without a Recording. */
export const SYNCED_FIELDS = ['site', 'notes', 'buddies', 'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC'] as const;
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
}

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** A Provider's dive as the comparison sees it. */
export function comparableOf(d: ImportedDive): Comparable {
  const local = wallClockMs(d.localStart);
  return {
    site: Object.values(d.siteIds)[0] ?? null, notes: text(d.notes), buddies: [...new Set(d.people)].sort(),
    startsAt: local === null ? null : Math.floor(local / 60_000), durationSeconds: d.durationSeconds || null,
    maxDepthM: d.maxDepthM, avgDepthM: d.avgDepthM, waterTemperatureC: d.waterTemperatureC,
  };
}

/** Equal as far as the Provider keeps it: minutes for times, a minute for durations, 0.1 for depths and temperatures. */
export function same(field: SyncedField, a: Comparable, b: Comparable): boolean {
  const x = a[field];
  const y = b[field];
  if (field === 'buddies') return JSON.stringify(x) === JSON.stringify(y);
  if (x === null || y === null) return x === y;
  if (field === 'durationSeconds') return Math.abs((x as number) - (y as number)) < 60;
  if (field === 'maxDepthM' || field === 'avgDepthM' || field === 'waterTemperatureC') return Math.abs((x as number) - (y as number)) < 0.06;
  return x === y;
}

/**
 * Per field: unchanged at the Provider since the base, nothing; changed there and not here, `take` the Provider's value;
 * changed in both, and differently, a conflict. Without a base there is nothing to tell (the import only fills).
 */
export function threeWay(fields: readonly SyncedField[], base: Comparable, provider: Comparable, hub: Comparable) {
  const take: SyncedField[] = [];
  const conflicts: SyncedField[] = [];
  for (const field of fields) {
    if (same(field, base, provider) || same(field, provider, hub)) continue;
    // The Provider no longer names a site: it never clears one here (SSI needs a site on every dive).
    if (field === 'site' && provider.site === null) continue;
    if (same(field, base, hub)) take.push(field);
    else conflicts.push(field);
  }
  return { take, conflicts };
}
