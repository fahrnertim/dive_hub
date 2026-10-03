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

const unitFormat = (locale: string, unit: string, digits: number) =>
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
export function unitLabel(quantity: 'depth' | 'temperature', units: UnitSystem, locale: string): string {
  const unit = quantity === 'depth' ? (units === 'imperial' ? 'foot' : 'meter') : (units === 'imperial' ? 'fahrenheit' : 'celsius');
  return unitFormat(locale, unit, 0).formatToParts(1).find((p) => p.type === 'unit')?.value ?? unit;
}

/** "45 min", "1 h 5 min" (and their translations). */
export function formatDuration(seconds: number, locale: string): string {
  const minutes = Math.round(seconds / 60);
  const min = unitFormat(locale, 'minute', 0);
  if (minutes < 60) return min.format(minutes);
  return `${unitFormat(locale, 'hour', 0).format(Math.floor(minutes / 60))} ${min.format(minutes % 60)}`;
}

/**
 * Dive time as the diver experienced it: local time at the dive site (UTC + the dive's offset),
 * or the browser's time zone when the offset is unknown.
 */
export function formatDiveTime(isoUtc: string, offsetSeconds: number | null, locale: string): string {
  const utc = new Date(isoUtc);
  const style = { dateStyle: 'medium', timeStyle: 'short' } as const;
  if (offsetSeconds === null) return utc.toLocaleString(locale, style);
  const local = new Date(utc.getTime() + offsetSeconds * 1000);
  const text = local.toLocaleString(locale, { ...style, timeZone: 'UTC' });
  const hours = offsetSeconds / 3600;
  const offset = new Intl.NumberFormat(locale, { signDisplay: 'always', maximumFractionDigits: 1 }).format(hours);
  return `${text} (UTC${offset})`;
}

/** A moment in the browser's time zone, e.g. when a session was created. */
export const formatDateTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
