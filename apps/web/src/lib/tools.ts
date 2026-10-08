// The Tools page's inputs live in the address (ADR 0032, like the logbook's, ADR 0017). The address holds metres and bar
// whatever the User's units are; the page converts. Nothing is stored.

export const TOOLS_WATERS = ['salt', 'fresh', 'en13319'] as const;
export type ToolsWater = (typeof TOOLS_WATERS)[number];

export interface ToolsParams {
  /** Oxygen and helium in percent. */
  o2?: number | undefined;
  he?: number | undefined;
  /** Metres. */
  depth?: number | undefined;
  water?: ToolsWater | undefined;
  /** Metres above sea level. */
  altitude?: number | undefined;
  /** Cylinder volume in litres and fill pressure in bar. */
  volume?: number | undefined;
  pressure?: number | undefined;
  /** Litres a minute at the surface. */
  sac?: number | undefined;
  /** Bar. */
  reserve?: number | undefined;
  /** Gradient factor high, percent. */
  gf?: number | undefined;
  /** The ppO2 limits in bar. */
  pw?: number | undefined;
  pc?: number | undefined;
  /** false: oxygen does not count as narcotic for END. */
  narcotic?: boolean | undefined;
}

const NUMBERS = ['o2', 'he', 'depth', 'altitude', 'volume', 'pressure', 'sac', 'reserve', 'gf', 'pw', 'pc'] as const;

/** The page's address for these inputs; what is empty is left out. */
export function toolsHref(p: ToolsParams): string {
  const query = new URLSearchParams();
  for (const key of NUMBERS) if (p[key] !== undefined && Number.isFinite(p[key])) query.set(key, String(p[key]));
  if (p.water && p.water !== 'salt') query.set('water', p.water);
  if (p.narcotic === false) query.set('narcotic', '0');
  const text = query.toString();
  return text ? `#/tools?${text}` : '#/tools';
}

/** The inputs in the address (see toolsHref). */
export function toolsParams(query: URLSearchParams): ToolsParams {
  const water = query.get('water');
  const result: ToolsParams = {};
  for (const key of NUMBERS) {
    const raw = query.get(key);
    const n = raw === null || raw === '' ? Number.NaN : Number(raw);
    if (Number.isFinite(n) && n >= 0) result[key] = n;
  }
  if (water && (TOOLS_WATERS as readonly string[]).includes(water)) result.water = water as ToolsWater;
  if (query.get('narcotic') === '0') result.narcotic = false;
  return result;
}

/** A change in the page: the new address replaces the current one, so typing does not fill the history. */
export function replaceToolsAddress(p: ToolsParams): void {
  const oldURL = location.href;
  history.replaceState(null, '', toolsHref(p));
  dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
}
