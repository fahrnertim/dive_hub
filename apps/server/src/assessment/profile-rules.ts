// The profile rules (ADR 0036): each reads the signals of one Recording and gives at most one finding. assessProfile
// derives the signals once and runs every rule in PROFILE_RULES, which names a function for each `profile` rule in RULES.
import { LIMITS, type Finding, type RULES, type RuleId, type Severity } from './rules.js';
import { cleanDepth, excursions, median, round, runs, segments, stepAt, timeAbove, windowRates, type Series } from './signals.js';

export interface ProfileInput {
  depth: Series;
  /** The computer's no-decompression limit, seconds. */
  ndl?: Series | undefined;
  /** The depth of the next stop the computer asks for, metres: a ceiling once in decompression. */
  nextStopDepth?: Series | undefined;
  po2?: Series | undefined;
  cns?: Series | undefined;
}

/** A stretch of the ascent by how fast it was: 1 above 4, 2 above 9, 3 above 18 m/min. */
export type AscentBand = [startS: number, endS: number, band: 1 | 2 | 3];

export interface ProfileAssessment {
  findings: Finding[];
  /** The dive went into decompression (the computer's NDL reached zero). */
  enteredDeco: boolean;
  /** Typical seconds between depth samples; at 5 s and more short bursts can be missed. */
  sampleIntervalS: number;
  ascentBands: AscentBand[];
}

type Run = [number, number];

/** What the profile rules read: the cleaned depth (`t` seconds, `d` metres), its rates, and the dives in it. */
interface Profile {
  input: ProfileInput;
  t: number[];
  d: number[];
  /** windowRates: m/min from each sample, and the sample its window reaches. */
  rate: (number | null)[];
  end: number[];
  sampleIntervalS: number;
  /** The recording split at the surface (segments). */
  parts: Run[];
  minNdl: number | null;
  enteredDeco: boolean;
  /** Runs where `holds` is true for at least LIMITS.sustainedS. */
  sustained: (holds: (i: number) => boolean) => Run[];
}

function profileOf(input: ProfileInput, t: number[], d: number[]): Profile {
  const sampleIntervalS = round(median(t.slice(1).map((v, i) => v - t[i]!)), 1);
  const { rate, end } = windowRates(t, d);
  const duration = ([a, b]: Run) => t[b]! - t[a]! + sampleIntervalS;
  const minNdl = input.ndl && input.ndl.values.length > 0 ? Math.min(...input.ndl.values) : null;
  return {
    input, t, d, rate, end, sampleIntervalS, minNdl,
    parts: segments(t, d),
    enteredDeco: minNdl === 0,
    sustained: (holds) => runs(d.length, holds).filter((r) => duration(r) >= LIMITS.sustainedS),
  };
}

/** The stretch whose rate peaks highest (`sign` -1: the fastest descent), and that peak. */
function worstOf(p: Profile, stretches: Run[], sign: 1 | -1) {
  const peak = (r: Run) => Math.max(...p.rate.slice(r[0], r[1] + 1).map((v) => sign * (v ?? 0)));
  const run = stretches.reduce((a, b) => (peak(b) > peak(a) ? b : a));
  return { run, peak: peak(run) };
}

/** Ascent rate, below the last 6 m (which have their own rule). */
function ascentRate(p: Profile): Finding | null {
  const { t, d, rate, end } = p;
  const fast = p.sustained((i) => rate[i] !== null && rate[i]! > LIMITS.ascentNoteMMin && d[i]! > LIMITS.lastMetresFromM);
  if (fast.length === 0) return null;
  const { run: [a, b], peak } = worstOf(p, fast, 1);
  const veryFast = p.sustained((i) => rate[i] !== null && rate[i]! > LIMITS.ascentCautionMMin && d[i]! > LIMITS.lastMetresFromM).length > 0;
  return {
    rule: 'ascent_rate', severity: veryFast ? 'caution' : 'note', startS: t[a]!, endS: t[end[b]!]!,
    values: {
      max_m_min: round(peak), limit_m_min: veryFast ? LIMITS.ascentCautionMMin : LIMITS.ascentNoteMMin,
      seconds: Math.round(t[end[b]!]! - t[a]!), from_depth_m: round(d[a]!), to_depth_m: round(d[end[b]!]!),
      stretches: fast.length, sample_interval_s: p.sampleIntervalS,
    },
  };
}

/** A fast descent through the first 10 m: a tip about equalising. */
function descentRate(p: Profile): Finding | null {
  const { t, d, rate, end } = p;
  const dropped = p.sustained((i) => rate[i] !== null && -rate[i]! > LIMITS.descentMMin && d[i]! < LIMITS.descentFirstM);
  if (dropped.length === 0) return null;
  const { run: [a, b], peak } = worstOf(p, dropped, -1);
  return {
    rule: 'descent_rate', severity: 'info', startS: t[a]!, endS: t[end[b]!]!,
    values: { max_m_min: round(peak), limit_m_min: LIMITS.descentMMin, within_m: LIMITS.descentFirstM },
  };
}

/**
 * The parts the last metres and the safety stop are judged on: deeper than 10 m, and ending at the surface (recordings
 * that end under water, from a battery or a split file, say nothing about the way up).
 */
function judgedParts(p: Profile) {
  return p.parts
    .map((part) => ({ part, deepest: Math.max(...p.d.slice(part[0], part[1] + 1)) }))
    .filter(({ part, deepest }) => deepest > LIMITS.stopDivesDeeperThanM && p.d[part[1]]! <= 2);
}

/** The last metres of each judged part; the part that came up fastest is reported. */
function lastMetres(p: Profile): Finding | null {
  const { t, d } = p;
  let worst: Finding | null = null;
  for (const { part: [a, b] } of judgedParts(p)) {
    // The final ascent: from where the diver last held a depth (at most 6 m) up to the surface.
    let surfaced = b;
    while (surfaced > a && d[surfaced - 1]! < LIMITS.surfaceM) surfaced--;
    let below = surfaced;
    // Held: within 0.3 m of where the diver was ten seconds earlier.
    const held = (i: number) => {
      let k = i;
      while (k > a && t[i]! - t[k]! < 10) k--;
      return d[k]! - d[i]! < 0.3;
    };
    while (below > a && d[below - 1]! <= LIMITS.lastMetresFromM && !held(below)) below--;
    const seconds = t[surfaced]! - t[below]!;
    const metres = d[below]! - d[surfaced]!;
    const mMin = seconds > 0 ? (metres / seconds) * 60 : 0;
    // Judged once the stretch is at least 3 m.
    if (metres >= 3 && mMin > LIMITS.lastMetresMMin && (!worst || mMin > (worst.values.m_min as number))) {
      worst = {
        rule: 'last_metres', severity: 'info', startS: t[below]!, endS: t[surfaced]!,
        values: { seconds: Math.round(seconds), metres: round(metres), m_min: round(mMin), limit_m_min: LIMITS.lastMetresMMin, last_m: LIMITS.lastMetresFromM },
      };
    }
  }
  return worst;
}

/** The samples of a part's safety stop (3–6 m, after the last time deeper), the seconds spent there, and its last deep sample. */
function stopIn(p: Profile, [a, b]: Run) {
  const { t, d } = p;
  const [shallowEdge, deepEdge] = LIMITS.stopBandM;
  let lastDeep = b;
  while (lastDeep > a && d[lastDeep]! <= deepEdge) lastDeep--;
  const inBand = (i: number) => d[i]! >= shallowEdge && d[i]! <= deepEdge;
  const samples: number[] = [];
  let seconds = 0;
  for (let i = lastDeep + 1; i <= b; i++) {
    if (!inBand(i)) continue;
    samples.push(i);
    if (i > lastDeep + 1 && inBand(i - 1)) seconds += t[i]! - t[i - 1]!;
  }
  return { samples, seconds, lastDeep };
}

/** The safety stop of each judged part; the shortest one that falls short is reported. Not after decompression: the stops were obligations then, the ceiling rule looks at them. */
function safetyStop(p: Profile): Finding | null {
  if (p.enteredDeco) return null;
  const { t, minNdl } = p;
  let worst: Finding | null = null;
  for (const { part, deepest } of judgedParts(p)) {
    const { samples, seconds, lastDeep } = stopIn(p, part);
    const long = deepest > LIMITS.stopLongDeeperThanM || (minNdl !== null && minNdl <= LIMITS.stopLongNdlS);
    const severity: Severity | null = seconds < LIMITS.stopMinS ? 'note' : long && seconds < LIMITS.stopLongS ? 'info' : null;
    if (severity && (!worst || seconds < (worst.values.seconds as number))) {
      worst = {
        rule: 'safety_stop', severity, startS: t[samples[0] ?? lastDeep]!, endS: t[samples.at(-1) ?? part[1]]!,
        values: {
          seconds: Math.round(seconds), recommended_s: long ? LIMITS.stopLongS : LIMITS.stopMinS, minimum_s: LIMITS.stopMinS,
          max_depth_m: round(deepest), min_ndl_s: minNdl, from_m: 3, to_m: 6,
        },
      };
    }
  }
  return worst;
}

/** A safety stop of a minute or more that wandered by more than 1.5 m; the first such stop is reported. */
function stopStability(p: Profile): Finding | null {
  if (p.enteredDeco) return null;
  const { t, d } = p;
  for (const { part } of judgedParts(p)) {
    const { samples, seconds } = stopIn(p, part);
    if (seconds < 60) continue;
    // Between arriving at the stop's depth and leaving it: the way in and out is not wandering.
    const middle = median(samples.map((i) => d[i]!));
    const near = samples.filter((i) => Math.abs(d[i]! - middle) <= 0.5);
    const depths = samples.filter((i) => i >= near[0]! && i <= near.at(-1)!).map((i) => d[i]!);
    const off = Math.max(...depths.map((v) => Math.abs(v - middle)));
    if (off > LIMITS.stopStabilityM) {
      return {
        rule: 'stop_stability', severity: 'info', startS: t[samples[0]!]!, endS: t[samples.at(-1)!]!,
        values: { shallowest_m: round(Math.min(...depths)), deepest_m: round(Math.max(...depths)), within_m: LIMITS.stopStabilityM },
      };
    }
  }
  return null;
}

/** The computer's no-decompression limit. */
function ndl(p: Profile): Finding | null {
  const { minNdl, input } = p;
  if (minNdl === null || minNdl > LIMITS.ndlNoteS) return null;
  const at = input.ndl!.offsetsMs[input.ndl!.values.indexOf(minNdl)]! / 1000;
  return {
    rule: 'ndl', severity: 'note', startS: at, endS: at,
    values: { min_ndl_s: minNdl, limit_s: LIMITS.ndlNoteS, entered_deco: p.enteredDeco },
  };
}

/** Shallower than the ceiling the computer asked for, once in decompression. */
function ceiling(p: Profile): Finding | null {
  const { t, d, input } = p;
  if (!p.enteredDeco || !input.nextStopDepth) return null;
  let seconds = 0;
  let above = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (let i = 0; i < d.length - 1; i++) {
    const asked = stepAt(input.nextStopDepth, t[i]!);
    if (asked === null || asked <= 0 || d[i]! >= asked - LIMITS.ceilingToleranceM) continue;
    seconds += t[i + 1]! - t[i]!;
    above = Math.max(above, asked - d[i]!);
    first ??= t[i]!;
    last = t[i + 1]!;
  }
  if (seconds <= LIMITS.ceilingBrokenS) return null;
  return {
    rule: 'ceiling', severity: 'caution', startS: first, endS: last,
    values: { seconds: Math.round(seconds), limit_s: LIMITS.ceilingBrokenS, above_m: round(above) },
  };
}

function ppo2({ input: { po2 } }: Profile): Finding | null {
  if (!po2) return null;
  const working = timeAbove(po2, LIMITS.ppo2NoteBar);
  const contingency = timeAbove(po2, LIMITS.ppo2CautionBar);
  const caution = contingency.seconds >= LIMITS.sustainedS;
  if (!caution && working.seconds <= LIMITS.ppo2NoteS) return null;
  return {
    rule: 'ppo2', severity: caution ? 'caution' : 'note', startS: working.first, endS: working.last,
    values: {
      max_bar: round(Math.max(...po2.values), 2), limit_bar: caution ? LIMITS.ppo2CautionBar : LIMITS.ppo2NoteBar,
      seconds_above_working: Math.round(working.seconds), seconds_above_contingency: Math.round(contingency.seconds),
    },
  };
}

function cns({ input }: Profile): Finding | null {
  if (!input.cns || input.cns.values.length === 0) return null;
  const max = Math.max(...input.cns.values);
  if (max < LIMITS.cnsNotePercent) return null;
  const caution = max >= LIMITS.cnsCautionPercent;
  return {
    rule: 'cns', severity: caution ? 'caution' : 'note', startS: null, endS: null,
    values: { max_percent: Math.round(max), limit_percent: caution ? LIMITS.cnsCautionPercent : LIMITS.cnsNotePercent },
  };
}

/** Sawtooth: conservative on purpose (4 excursions of 6 m), counted within one dive. */
function sawtooth({ t, d, parts }: Profile): Finding | null {
  const teeth = parts.map(([a, b]) => excursions(t, d, a, b, LIMITS.sawtoothExcursionM)).reduce((most, e) => (e.length > most.length ? e : most), []);
  if (teeth.length < LIMITS.sawtoothExcursions) return null;
  return {
    rule: 'sawtooth', severity: 'note', startS: t[teeth[0]!]!, endS: t[teeth.at(-1)!]!,
    values: { excursions: teeth.length, at_least: LIMITS.sawtoothExcursions, of_m: LIMITS.sawtoothExcursionM },
  };
}

type ProfileRuleId = { [K in RuleId]: (typeof RULES)[K]['scope'] extends 'profile' ? K : never }[RuleId];

/** Every profile rule's function, in the order its findings are listed. */
const PROFILE_RULES = {
  ascent_rate: ascentRate,
  descent_rate: descentRate,
  last_metres: lastMetres,
  safety_stop: safetyStop,
  stop_stability: stopStability,
  ndl,
  ceiling,
  ppo2,
  cns,
  sawtooth,
} satisfies Record<ProfileRuleId, (p: Profile) => Finding | null>;

/** How fast each stretch of the ascent was, for colouring the profile. */
function ascentBandsOf({ t, rate, end, sustained }: Profile): AscentBand[] {
  const [brisk, quick, veryQuick] = LIMITS.bandsMMin;
  const bandOf = (i: number): 0 | 1 | 2 | 3 => {
    const r = rate[i];
    return r === null || r === undefined || r <= brisk ? 0 : r <= quick ? 1 : r <= veryQuick ? 2 : 3;
  };
  const bands: AscentBand[] = [];
  for (const level of [1, 2, 3] as const) {
    for (const [a, b] of sustained((i) => bandOf(i) === level)) bands.push([Math.round(t[a]!), Math.round(t[end[b]!]!), level]);
  }
  return bands.sort((x, y) => x[0] - y[0] || x[2] - y[2]);
}

/** The findings a Recording's samples give, for an open-circuit dive. */
export function assessProfile(input: ProfileInput): ProfileAssessment {
  const { t, d } = cleanDepth(input.depth);
  if (d.length < 2) return { findings: [], enteredDeco: false, sampleIntervalS: 0, ascentBands: [] };
  const p = profileOf(input, t, d);
  const findings = Object.values(PROFILE_RULES).flatMap((rule) => rule(p) ?? []);
  return { findings, enteredDeco: p.enteredDeco, sampleIntervalS: p.sampleIntervalS, ascentBands: ascentBandsOf(p) };
}
