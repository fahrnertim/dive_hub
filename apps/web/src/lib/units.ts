// Units and number formatting (ADR 0014). Values are stored in SI-based units (m, °C) and converted
// only for display, following the User's unit system; numbers follow the UI language.

export type UnitSystem = 'metric' | 'imperial';

/** Regions that use imperial units for depth and temperature. */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

/** The User's choice if any, else what the browser's region suggests. */
export function pickUnits(preferred: UnitSystem | null | undefined, browser: readonly string[]): UnitSystem {
  if (preferred) return preferred;
  const region = browser[0] ? new Intl.Locale(browser[0]).maximize().region : undefined;
  return region && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
}

const FEET_PER_METRE = 1 / 0.3048;

export const depthIn = (metres: number, units: UnitSystem) => (units === 'imperial' ? metres * FEET_PER_METRE : metres);
export const temperatureIn = (celsius: number, units: UnitSystem) => (units === 'imperial' ? celsius * 9 / 5 + 32 : celsius);

/** A depth or temperature typed in the User's units, back in metres or °C for storage. */
export const depthFromDisplay = (value: number, units: UnitSystem) => (units === 'imperial' ? value / FEET_PER_METRE : value);
export const temperatureFromDisplay = (value: number, units: UnitSystem) => (units === 'imperial' ? (value - 32) * 5 / 9 : value);

const unitFormat =(locale: string, unit: string, digits: number) =>
  new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits });

/** "18.5 m", "60.7 ft", "18,5 m" in German. */
export function formatDepth(metres: number | null, units: UnitSystem, locale: string): string {
  if (metres === null) return '–';
  return unitFormat(locale, units === 'imperial' ? 'foot' : 'meter', 1).format(depthIn(metres, units));
}

export function formatTemperature(celsius: number | null, units: UnitSystem, locale: string): string {
  if (celsius === null) return '–';
  return unitFormat(locale, units === 'imperial' ? 'fahrenheit' : 'celsius', 0).format(temperatureIn(celsius, units));
}

/** Just the unit symbol, e.g. for a chart axis: "m", "ft", "°C", "°F". */
export function unitLabel(quantity: 'depth' | 'temperature' | 'minutes', units: UnitSystem, locale: string): string {
  const unit = quantity === 'minutes' ? 'minute'
    : quantity === 'depth' ? (units === 'imperial' ? 'foot' : 'meter')
    : (units === 'imperial' ? 'fahrenheit' : 'celsius');
  return unitFormat(locale, unit, 0).formatToParts(1).find((p) => p.type === 'unit')?.value ?? unit;
}

/** Intl.DurationFormat (2025 browsers); Node 22 and older browsers don't have it yet. */
type DurationFormatter = { format(duration: { hours?: number; minutes: number }): string };
const durationFormat = () => (Intl as unknown as { DurationFormat?: new (locale: string, options: object) => DurationFormatter }).DurationFormat;

/** "45 min", "1 hr, 5 min" (and their translations): the locale's own way where possible. */
export function formatDuration(seconds: number, locale: string): string {
  const minutes = Math.round(seconds / 60);
  const DurationFormat = durationFormat();
  if (DurationFormat) {
    const parts = minutes < 60 ? { minutes } : { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
    return new DurationFormat(locale, { style: 'short', minutesDisplay: 'always' }).format(parts);
  }
  const min = unitFormat(locale, 'minute', 0);
  if (minutes < 60) return min.format(minutes);
  return `${unitFormat(locale, 'hour', 0).format(Math.floor(minutes / 60))} ${min.format(minutes % 60)}`;
}

/**
 * Dive time as the diver experienced it: local time at the dive site (UTC + the dive's offset),
 * or the browser's time zone when the offset is unknown.
 */
export function formatDiveTime(isoUtc: string, offsetSeconds: number | null, locale: string, wallClock = false): string {
  const utc = new Date(isoUtc);
  const style = { dateStyle: 'medium', timeStyle: 'short' } as const;
  // A time logged without a time zone (ADR 0030) is kept as if it were UTC: shown as it was logged, without an offset.
  if (offsetSeconds === null && wallClock) return utc.toLocaleString(locale, { ...style, timeZone: 'UTC' });
  if (offsetSeconds === null) return utc.toLocaleString(locale, style);
  const local = new Date(utc.getTime() + offsetSeconds * 1000);
  const text = local.toLocaleString(locale, { ...style, timeZone: 'UTC' });
  const hours = offsetSeconds / 3600;
  const offset = new Intl.NumberFormat(locale, { signDisplay: 'always', maximumFractionDigits: 1 }).format(hours);
  return `${text} (UTC${offset})`;
}

/**
 * A dive's day in a logbook row: weekday, day and the local time at the dive site, as formatDiveTime reads them. The
 * year only where no month heading says it; the offset is left to the dive page.
 */
export function formatDiveDay(isoUtc: string, offsetSeconds: number | null, locale: string, wallClock: boolean, year: boolean): string {
  // "08:00" where the day has 24 hours, "8:00 AM" where it has twelve.
  const twelve = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12;
  const style = {
    weekday: 'short', day: 'numeric', month: 'short', ...(year && { year: 'numeric' as const }), hour: twelve ? 'numeric' : '2-digit', minute: '2-digit',
  } as const;
  const utc = new Date(isoUtc);
  if (offsetSeconds === null && !wallClock) return utc.toLocaleString(locale, style);
  return new Date(utc.getTime() + (offsetSeconds ?? 0) * 1000).toLocaleString(locale, { ...style, timeZone: 'UTC' });
}

/** "April 2026" for a local month "2026-04". */
export const formatMonth = (month: string, locale: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The day of a moment in the browser's time zone, where the time of day says nothing more. */
export const formatDate = (iso: string, locale: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' });

/** A moment in the browser's time zone, e.g. when a session was created. */
export const formatDateTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
