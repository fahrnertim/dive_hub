// Dive sites (ADR 0020): positions, distances and countries for display.
import type { UnitSystem } from './units.ts';

export interface Position {
  latitude: number;
  longitude: number;
}

/** The hemisphere letters in the UI language ("O" for Ost in German). */
export interface Hemispheres {
  north: string;
  south: string;
  east: string;
  west: string;
}

/** "28.4950° N, 34.5160° E": four decimals are about 10 m, as precise as a dive computer's fix. */
export function formatPosition(p: Position, locale: string, h: Hemispheres): string {
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const lat = `${number.format(Math.abs(p.latitude))}° ${p.latitude < 0 ? h.south : h.north}`;
  const lon = `${number.format(Math.abs(p.longitude))}° ${p.longitude < 0 ? h.west : h.east}`;
  return `${lat}, ${lon}`;
}

/** The place on openstreetmap.org: a plain link, so the page itself sends nothing anywhere (ADR 0020). */
export function mapsUrl(p: Position): string {
  const lat = p.latitude.toFixed(5);
  const lon = p.longitude.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

const unit = (locale: string, name: string, digits: number) =>
  new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits: digits });

/** How far away a site is: "120 m", "1.5 km"; "100 ft", "1.5 mi" for imperial. */
export function formatDistance(metres: number, units: UnitSystem, locale: string): string {
  if (units === 'imperial') {
    const miles = metres / METRES_PER_MILE;
    return miles >= 0.1 ? unit(locale, 'mile', 1).format(miles) : unit(locale, 'foot', 0).format(Math.round(metres / METRES_PER_FOOT / 10) * 10);
  }
  return metres >= 1000 ? unit(locale, 'kilometer', 1).format(metres / 1000) : unit(locale, 'meter', 0).format(Math.round(metres / 10) * 10);
}

/** Region codes that name groups or test values, not countries. */
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB']);

/** Every current ISO 3166-1 code the browser can name: retired codes (BU, YU) canonicalize away. */
function countryCodes(): string[] {
  const names = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
  const codes: string[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (NOT_COUNTRIES.has(code) || !names.of(code)) continue;
      if (Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) continue;
      codes.push(code);
    }
  }
  return codes;
}

let codes: string[] | undefined;

/** "Egypt", "Ägypten": the country's name in the UI language; the code itself if unknown. */
export function countryName(code: string, locale: string): string {
  return new Intl.DisplayNames(locale, { type: 'region', fallback: 'code' }).of(code) ?? code;
}

/** Countries to pick from, sorted by their name in the UI language. */
export function countryOptions(locale: string): { id: string; label: string }[] {
  codes ??= countryCodes();
  const collator = new Intl.Collator(locale);
  return codes.map((id) => ({ id, label: countryName(id, locale) })).sort((a, b) => collator.compare(a.label, b.label));
}
