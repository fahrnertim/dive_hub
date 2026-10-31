// The series rules (ADR 0036): a Diver's dives in relation to each other, and DAN's no-fly time after a day's diving.
import { LIMITS, type Finding, type RULES, type RuleId } from './rules.js';
import { round } from './signals.js';

/** A dive as the series rules see it. */
export interface SeriesDive {
  id: string;
  startMs: number;
  endMs: number;
  /** The local calendar day the dive started on (YYYY-MM-DD). */
  day: string;
  maxDepthM: number | null;
  enteredDeco: boolean;
}

const HOUR = 3_600_000;
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / (24 * HOUR));

/** What a series rule reads about one dive: the dive before it, the time between them, and the Diver's days. */
interface SeriesContext {
  dive: SeriesDive;
  previous: SeriesDive | undefined;
  /** Minutes from the previous dive's end; null for the first dive. */
  intervalMin: number | null;
  /** The dive's day, in start order. */
  sameDay: SeriesDive[];
  /** Day numbers with a dive deeper than LIMITS.deepDayM. */
  deepDays: Set<number>;
}

type SeriesFinding = Omit<Finding, 'startS' | 'endS'>;

/** A deeper dive after a shallower one, outside what the 1999 workshop found no reason to forbid. */
function reverseProfile({ dive, previous, intervalMin }: SeriesContext): SeriesFinding | null {
  if (!previous || intervalMin === null || intervalMin < 0 || intervalMin >= LIMITS.repetitiveH * 60) return null;
  if (dive.maxDepthM === null || previous.maxDepthM === null || dive.maxDepthM <= previous.maxDepthM) return null;
  const deeperBy = dive.maxDepthM - previous.maxDepthM;
  const reason = deeperBy > LIMITS.reverseDeeperByM ? 'difference' : dive.maxDepthM > LIMITS.reverseDeeperThanM ? 'depth'
    : dive.enteredDeco || previous.enteredDeco ? 'decompression' : null;
  if (!reason) return null;
  return {
    rule: 'reverse_profile', severity: 'info',
    values: {
      reason, max_depth_m: round(dive.maxDepthM), previous_max_depth_m: round(previous.maxDepthM), deeper_by_m: round(deeperBy),
      interval_min: Math.round(intervalMin), within_m: LIMITS.reverseDeeperByM, within_depth_m: LIMITS.reverseDeeperThanM, previous_dive_id: previous.id,
    },
  };
}

function surfaceInterval({ dive, intervalMin }: SeriesContext): SeriesFinding | null {
  if (intervalMin === null || intervalMin < 0 || intervalMin >= LIMITS.shortIntervalMin || (dive.maxDepthM ?? 0) <= LIMITS.shortIntervalDeeperThanM) return null;
  return {
    rule: 'surface_interval', severity: 'info',
    values: { interval_min: Math.round(intervalMin), limit_min: LIMITS.shortIntervalMin, max_depth_m: round(dive.maxDepthM!), deeper_than_m: LIMITS.shortIntervalDeeperThanM },
  };
}

function divesPerDay({ dive, sameDay }: SeriesContext): SeriesFinding | null {
  const nth = sameDay.indexOf(dive) + 1;
  return nth > LIMITS.divesPerDay ? { rule: 'dives_per_day', severity: 'info', values: { dive_of_day: nth, limit: LIMITS.divesPerDay } } : null;
}

function deepDays({ dive, deepDays: deep }: SeriesContext): SeriesFinding | null {
  if ((dive.maxDepthM ?? 0) <= LIMITS.deepDayM) return null;
  let days = 1;
  while (deep.has(dayNumber(dive.day) - days)) days++;
  return days >= LIMITS.deepDays ? { rule: 'deep_days', severity: 'info', values: { days, limit_days: LIMITS.deepDays, deeper_than_m: LIMITS.deepDayM } } : null;
}

type SeriesRuleId = { [K in RuleId]: (typeof RULES)[K]['scope'] extends 'series' ? K : never }[RuleId];

/** Every series rule's function, in the order its findings are listed. */
const SERIES_RULES = {
  reverse_profile: reverseProfile,
  surface_interval: surfaceInterval,
  dives_per_day: divesPerDay,
  deep_days: deepDays,
} satisfies Record<SeriesRuleId, (c: SeriesContext) => SeriesFinding | null>;

/** The findings about a Diver's dives in relation to each other, by dive. `dives` in any order. */
export function assessSeries(dives: SeriesDive[]): Map<string, Finding[]> {
  const sorted = [...dives].sort((a, b) => a.startMs - b.startMs);
  const byDay = new Map<string, SeriesDive[]>();
  for (const d of sorted) byDay.set(d.day, [...(byDay.get(d.day) ?? []), d]);
  const deep = new Set([...byDay].filter(([, list]) => list.some((d) => (d.maxDepthM ?? 0) > LIMITS.deepDayM)).map(([day]) => dayNumber(day)));

  return new Map(sorted.map((dive, index) => {
    const previous = sorted[index - 1];
    const context: SeriesContext = {
      dive, previous, intervalMin: previous ? (dive.startMs - previous.endMs) / 60_000 : null, sameDay: byDay.get(dive.day)!, deepDays: deep,
    };
    const findings = Object.values(SERIES_RULES).flatMap((rule) => {
      const finding = rule(context);
      return finding ? [{ ...finding, startS: null, endS: null }] : [];
    });
    return [dive.id, findings];
  }));
}

/** How long after a dive DAN's guideline says not to fly (ADR 0036): information beside the findings, not a finding. */
export interface NoFly {
  hours: 12 | 18 | 24;
  /** A single dive without stops; several dives that day or diving the day before; a dive with decompression stops. */
  reason: 'single' | 'several' | 'decompression';
  /** ISO time (UTC) from which the guideline is met. */
  until: string;
}

/**
 * DAN's no-fly time after dive `id`, if it is the last dive of its day (the time runs from the day's last dive): 12 hours
 * after a single dive, 18 after several dives or days of diving, and 24 here after decompression, where DAN says
 * "substantially longer than 18". `dives`: the Diver's dives of that day and the day before, at least.
 */
export function noFlyAfter(dives: SeriesDive[], id: string): NoFly | null {
  const dive = dives.find((d) => d.id === id);
  if (!dive) return null;
  const sameDay = dives.filter((d) => d.day === dive.day).sort((a, b) => a.startMs - b.startMs);
  if (sameDay.at(-1) !== dive) return null;
  const several = sameDay.length > 1 || dives.some((d) => dayNumber(d.day) === dayNumber(dive.day) - 1);
  const hours = sameDay.some((d) => d.enteredDeco) ? 24 : several ? 18 : 12;
  return { hours, reason: hours === 24 ? 'decompression' : several ? 'several' : 'single', until: new Date(dive.endMs + hours * HOUR).toISOString() };
}
