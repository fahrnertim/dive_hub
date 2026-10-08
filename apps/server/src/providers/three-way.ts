// Changes made at a Provider, taken back into Dive Hub (ADR 0030, amended): a three-way comparison per field between
// what the Provider had when Dive Hub last saw its dive (the base: the Original of the last import, or what Dive Hub
// sent last), what it has now, and what the Dive here has now. Pure: no database.
import type { ImportedDive, ProviderCylinder } from './provider.js';
import { wallClockMs } from '../dives/time-zone.js';

/**
 * Fields a Provider's change can bring: on every Dive the site, notes and buddies; the tank on a Dive with at most one
 * Cylinder; the values only on a Dive without a Recording.
 */
export const SYNCED_FIELDS = ['site', 'notes', 'buddies', 'cylinder', 'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC'] as const;
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
}

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** A Provider's dive as the comparison sees it. */
export function comparableOf(d: ImportedDive): Comparable {
  const local = wallClockMs(d.localStart);
  return {
    site: Object.values(d.siteIds)[0] ?? null, notes: text(d.notes), buddies: [...new Set(d.people)].sort(),
    startsAt: local === null ? null : Math.floor(local / 60_000), durationSeconds: d.durationSeconds || null,
    maxDepthM: d.maxDepthM, avgDepthM: d.avgDepthM, waterTemperatureC: d.waterTemperatureC, cylinder: d.cylinder,
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
  const x = a[field];
  const y = b[field];
  if (field === 'buddies') return JSON.stringify(x) === JSON.stringify(y);
  if (x === null || y === null) return x === y;
  if (field === 'cylinder') return sameCylinder(x as ProviderCylinder, y as ProviderCylinder);
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
    // Nor does it remove a tank; and where Dive Hub never saw a tank there, the one here stays (the import only fills).
    if (field === 'cylinder' && (provider.cylinder === null || (base.cylinder === null && hub.cylinder !== null))) continue;
    if (same(field, base, hub)) take.push(field);
    else conflicts.push(field);
  }
  return { take, conflicts };
}
