// The Tools page's inputs live in the address (ADR 0032, like the logbook's, ADR 0017). The address holds metres and bar
// whatever the User's units are; the page converts. Nothing is stored. A gas plan's levels and Divers live there too
// (ADR 0033), never another Diver's logbook values: a Diver is named by id, and the server looks up the SAC of one the User manages.

export const TOOLS_WATERS = ['salt', 'fresh', 'en13319'] as const;
export type ToolsWater = (typeof TOOLS_WATERS)[number];

/** Where the gas ends (ADR 0033); a single bottom time knows the first three only. */
export const TOOLS_RULES = ['rock_bottom', 'reserve', 'ascent_pressure', 'halves', 'thirds', 'sixths'] as const;
export type ToolsRule = (typeof TOOLS_RULES)[number];
/** The rules that need a pressure. */
export const RULES_WITH_BAR: readonly ToolsRule[] = ['reserve', 'ascent_pressure'];
export const BOTTOM_TIME_RULES: readonly ToolsRule[] = ['rock_bottom', 'reserve', 'ascent_pressure'];

export interface PlanLevel {
  /** Metres, and the minutes spent there after arriving. */
  depth: number;
  minutes: number;
}

export interface PlanDiver {
  name: string;
  /** Litres and bar. */
  volume: number;
  pressure: number;
  /** Litres a minute; empty: the planning SAC of a Diver the User manages, else 20. */
  sac?: number | undefined;
  /** A Diver of the instance (ADR 0028); without, a guest who is only in this address. */
  diverId?: string | undefined;
}

/** The parts of the Tools page: gas numbers and a bottom time (`#/tools`), and the gas plan (`#/tools/plan`). */
export type Tool = 'gas' | 'plan';

export interface ToolsParams {
  /** The part of the page; without, gas numbers and a bottom time. */
  tool?: 'plan' | undefined;
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
  /** The gas rule, and its bar for `reserve` and `ascent_pressure`. */
  rule?: ToolsRule | undefined;
  bar?: number | undefined;
  /** Gradient factor high, percent. */
  gf?: number | undefined;
  /** The ppO2 limits in bar. */
  pw?: number | undefined;
  pc?: number | undefined;
  /** false: oxygen does not count as narcotic for END. */
  narcotic?: boolean | undefined;
  /** A gas plan: metres a minute down and up, its levels and its Divers. */
  dr?: number | undefined;
  ar?: number | undefined;
  levels?: PlanLevel[] | undefined;
  divers?: PlanDiver[] | undefined;
  /** The gas plan's own mix: oxygen in percent, air when empty. Not the mix of "Your dive" (`o2`). */
  mix?: number | undefined;
}

const NUMBERS = ['o2', 'he', 'depth', 'altitude', 'volume', 'pressure', 'sac', 'bar', 'gf', 'pw', 'pc', 'dr', 'ar', 'mix'] as const;

const finite = (raw: string | undefined): number | undefined => {
  const n = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** `20x20,30x10`: depth in metres, an x, the minutes there. */
const levelsText = (levels: PlanLevel[]) => levels.map((l) => `${l.depth}x${l.minutes}`).join(',');
const levelsOf = (text: string): PlanLevel[] => text.split(',').flatMap((part) => {
  const [depth, minutes] = part.split('x').map(finite);
  return depth !== undefined && depth > 0 && minutes !== undefined ? [{ depth, minutes }] : [];
});

/** `name~litres~bar~sac~diverId`; what is empty stays empty. */
const diverText = (d: PlanDiver) => [d.name, d.volume, d.pressure, d.sac ?? '', d.diverId ?? ''].join('~');
const diverOf = (text: string): PlanDiver[] => {
  const [name = '', volume, pressure, sac, diverId] = text.split('~');
  const v = finite(volume);
  const p = finite(pressure);
  if (v === undefined || p === undefined || v <= 0 || p <= 0) return [];
  return [{ name, volume: v, pressure: p, sac: finite(sac), diverId: diverId || undefined }];
};

/** What only one part reads, and what both do: a part's address carries its own inputs and the shared settings. */
const OWN = {
  gas: ['o2', 'he', 'depth', 'volume', 'pressure', 'sac', 'gf', 'pw', 'narcotic'],
  plan: ['mix', 'dr', 'ar', 'levels', 'divers'],
} as const satisfies Record<Tool, readonly (keyof ToolsParams)[]>;
const SHARED = ['water', 'altitude', 'rule', 'bar', 'pc'] as const satisfies readonly (keyof ToolsParams)[];

function pick(from: ToolsParams, keys: readonly (keyof ToolsParams)[]): ToolsParams {
  const result: ToolsParams = {};
  for (const key of keys) if (from[key] !== undefined) Object.assign(result, { [key]: from[key] });
  return result;
}

/** What each part last had in its address, while the app is open: going to the other part and back keeps what was typed. */
const kept: Partial<Record<Tool, ToolsParams>> = {};
export function keepToolsParams(p: ToolsParams): void {
  kept[p.tool ?? 'gas'] = p;
}

/** The address of a part from the one shown: the settings both share as they are now, and the part's own inputs as it last had them. */
export function toolsTabHref(current: ToolsParams, tool: Tool, last: ToolsParams = kept[tool] ?? {}): string {
  if ((current.tool ?? 'gas') === tool) return toolsHref(current);
  return toolsHref({ ...pick(last, OWN[tool]), ...pick(current, SHARED), ...(tool === 'plan' && { tool }) });
}

/** The page's address for these inputs; what is empty is left out. */
export function toolsHref(p: ToolsParams): string {
  const query = new URLSearchParams();
  for (const key of NUMBERS) if (p[key] !== undefined && Number.isFinite(p[key])) query.set(key, String(p[key]));
  if (p.water && p.water !== 'salt') query.set('water', p.water);
  if (p.rule && p.rule !== 'rock_bottom') query.set('rule', p.rule);
  if (p.narcotic === false) query.set('narcotic', '0');
  if (p.levels?.length) query.set('lv', levelsText(p.levels));
  for (const d of p.divers ?? []) query.append('dv', diverText(d));
  const text = query.toString();
  const base = p.tool === 'plan' ? '#/tools/plan' : '#/tools';
  return text ? `${base}?${text}` : base;
}

/**
 * The inputs in the address (see toolsHref), of the part it names. An address from before the plan had its own part
 * (`#/tools?lv=…`) is the plan's. What the other part reads is left out.
 */
export function toolsParams(query: URLSearchParams, tool: Tool = 'gas'): ToolsParams {
  const water = query.get('water');
  const rule = query.get('rule');
  const result: ToolsParams = {};
  for (const key of NUMBERS) {
    const n = finite(query.get(key) ?? undefined);
    if (n !== undefined) result[key] = n;
  }
  if (water && (TOOLS_WATERS as readonly string[]).includes(water)) result.water = water as ToolsWater;
  if (rule && (TOOLS_RULES as readonly string[]).includes(rule)) result.rule = rule as ToolsRule;
  if (query.get('narcotic') === '0') result.narcotic = false;
  const levels = levelsOf(query.get('lv') ?? '');
  if (levels.length > 0) result.levels = levels;
  const divers = query.getAll('dv').flatMap(diverOf);
  if (divers.length > 0) result.divers = divers;
  const plan = tool === 'plan' || result.levels !== undefined || result.divers !== undefined;
  return { ...pick(result, [...SHARED, ...OWN[plan ? 'plan' : 'gas']]), ...(plan && { tool: 'plan' as const }) };
}

export interface PlanStretch {
  kind: 'descent' | 'level' | 'ascent' | 'safety_stop';
  fromDepthM: number;
  depthM: number;
  minutes: number;
}

/**
 * The stretches of the levels alone, as the server counts them (planning/gas-plan.ts): for the profile and the list while
 * there is no answer yet (no mix, no Diver, or a change on its way). No gas and no limit comes from here; deeper than 40 m
 * there is no picture, as there is no answer.
 */
export function planSketch(levels: PlanLevel[], rates: { descentRate?: number | undefined; ascentRate?: number | undefined }): PlanStretch[] | undefined {
  if (levels.length === 0 || levels.some((l) => l.depth > 40)) return undefined;
  const down = rates.descentRate ?? 18;
  const up = rates.ascentRate ?? 9;
  const stretches: PlanStretch[] = [];
  let at = 0;
  const move = (to: number) => {
    if (to === at) return;
    stretches.push({ kind: to > at ? 'descent' : 'ascent', fromDepthM: at, depthM: to, minutes: Math.abs(to - at) / (to > at ? down : up) });
    at = to;
  };
  for (const level of levels) {
    move(level.depth);
    stretches.push({ kind: 'level', fromDepthM: at, depthM: at, minutes: level.minutes });
  }
  if (at > 5) {
    move(5);
    stretches.push({ kind: 'safety_stop', fromDepthM: 5, depthM: 5, minutes: 3 });
  }
  move(0);
  return stretches;
}

/** A change in the page: the new address replaces the current one, so typing does not fill the history. */
export function replaceToolsAddress(p: ToolsParams): void {
  const oldURL = location.href;
  history.replaceState(null, '', toolsHref(p));
  dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
}
