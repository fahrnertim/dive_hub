// The dive assessment in the web client (ADR 0036): which sentence a finding gets and with which numbers, where its
// stretch sits on the profile's time axis, and the ascent bands as text. Texts live in the translations; the numbers
// come from the server's values (metres, seconds, m/min, bar, percent) and are formatted for the User here.
import type { AssessmentView } from '../api.ts';
import { depthIn, formatDepth, formatDuration, type UnitSystem } from './units.ts';

export type Finding = AssessmentView['findings'][number];
export type Rule = Finding['rule'];

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** A vertical speed for the User: "11 m/min", "36 ft/min". */
export function formatRate(metresPerMinute: number, units: UnitSystem, locale: string): string {
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: units === 'imperial' ? 0 : 1 }).format(depthIn(metresPerMinute, units));
  return `${value} ${units === 'imperial' ? 'ft/min' : 'm/min'}`;
}

/** Minutes and seconds into the dive: "13:20". */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** Some rules have more than one sentence: which one this finding gets (a key under assessment.summary). */
export function summaryKey(f: Pick<Finding, 'rule' | 'values'>): string {
  const v = f.values;
  switch (f.rule) {
    case 'ascent_rate': return num(v.stretches) > 1 ? 'ascent_rate_several' : 'ascent_rate';
    case 'safety_stop': return num(v.seconds) < 30 ? 'safety_stop_none' : num(v.recommended_s) > num(v.minimum_s) ? 'safety_stop_long' : 'safety_stop';
    case 'ndl': return v.entered_deco ? 'ndl_deco' : 'ndl';
    case 'ppo2': return num(v.seconds_above_contingency) > 0 ? 'ppo2_contingency' : 'ppo2';
    case 'reverse_profile': return `reverse_profile_${String(v.reason)}`;
    default: return f.rule;
  }
}

/** The finding's numbers as the sentences use them, in the User's units and language. */
export function summaryValues(f: Pick<Finding, 'values'>, units: UnitSystem, locale: string): Record<string, string | number> {
  const v = f.values;
  const depth = (key: string) => formatDepth(num(v[key]), units, locale);
  const rate = (key: string) => formatRate(num(v[key]), units, locale);
  // To the second: "2:05 min" of a 3-minute stop says more than "2 min".
  const time = (key: string) => `${clock(num(v[key]))} min`;
  const plain = (value: unknown, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(num(value));
  return {
    rate: rate('max_m_min'), limit: rate('limit_m_min'), lastRate: rate('m_min'), seconds: plain(v.seconds), time: time('seconds'),
    from: depth('from_depth_m'), to: depth('to_depth_m'), metres: depth('metres'), maxDepth: depth('max_depth_m'), within: depth('within_m'),
    recommended: plain(num(v.recommended_s) / 60), shallowest: depth('shallowest_m'), deepest: depth('deepest_m'),
    ndl: plain(Math.floor(num(v.min_ndl_s) / 60)), above: depth('above_m'), bar: plain(v.max_bar, 2),
    working: time('seconds_above_working'), contingency: time('seconds_above_contingency'), percent: plain(v.max_percent),
    count: num(v.stretches) || num(v.excursions), excursion: depth('of_m'), previousDepth: depth('previous_max_depth_m'),
    deeperBy: depth('deeper_by_m'), interval: formatDuration(num(v.interval_min) * 60, locale),
    diveOfDay: plain(v.dive_of_day), days: plain(v.days), deeperThan: depth('deeper_than_m'), sampling: plain(v.sample_interval_s),
  };
}

/** Findings the User sees first: neither put aside on this Dive nor muted for its Diver. */
export const shown = (findings: Finding[]) => findings.filter((f) => !f.dismissed && !f.muted);
export const hidden = (findings: Finding[]) => findings.filter((f) => f.dismissed || f.muted);
/** Of the findings shown: those that differ from guidance (note, caution), and those told for information only. */
export const differing = (findings: Finding[]) => shown(findings).filter((f) => f.severity !== 'info');
export const informing = (findings: Finding[]) => shown(findings).filter((f) => f.severity === 'info');
/** What the panel's head counts. */
export const counts = (findings: Finding[]) => ({ differ: differing(findings).length, info: informing(findings).length });

/** Where a stretch sits on a time axis of `totalSeconds`, in percent; at least `minPercent` wide so it can be hit. */
export function stretch(startSeconds: number, endSeconds: number, totalSeconds: number, minPercent = 0) {
  if (totalSeconds <= 0) return { left: 0, width: 100 };
  const width = Math.min(100, Math.max(minPercent, ((endSeconds - startSeconds) / totalSeconds) * 100));
  const left = Math.min(100 - width, Math.max(0, (startSeconds / totalSeconds) * 100));
  return { left, width };
}

/** How long the ascent was in each band: [above 4, above 9, above 18 m/min], in seconds. */
export function bandSeconds(bands: AssessmentView['ascentBands']): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  for (const [start = 0, end = 0, band = 1] of bands) total[(band - 1) as 0 | 1 | 2] += end - start;
  return total;
}
