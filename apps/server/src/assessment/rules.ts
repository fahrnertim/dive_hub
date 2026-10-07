// The dive assessment's rules (ADR 0036): pure functions from a Recording's samples, and from a Diver's dives, to
// findings. Thresholds are fixed here with their sources; changing one raises ENGINE_VERSION, which recomputes every
// Dive. No score, and nothing here calls a dive safe or unsafe: findings state what was measured against which guidance.

/**
 * Raised with every change to a threshold or a rule's logic; stored with each finding. Also raised when the
 * assessment row gains something to fill for existing Dives (2: the logbook's profile sketch, ADR 0041).
 */
export const ENGINE_VERSION = 2;

export const SEVERITIES = ['info', 'note', 'caution'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** How strong the evidence behind a rule is (the research note's labels). */
export const EVIDENCE = ['experiment', 'observational', 'case_series', 'consensus', 'rule', 'opinion'] as const;
export type Evidence = (typeof EVIDENCE)[number];

/** Where the guidance comes from; clients show the title as a link. */
export const SOURCES = {
  carturan_2002: { title: 'Carturan et al. 2002: more bubbles at 17 than at 9 m/min', url: 'https://europepmc.org/abstract/MED/12235035' },
  marroni_2004: { title: 'Marroni et al. 2004: 10 m/min with a stop gave the fewest bubbles', url: 'https://europepmc.org/abstract/MED/15485086' },
  suunto_ascent: { title: 'Suunto D5: ascent alarm above 10 m/min for 5 s', url: 'https://www.suunto.com/Support/Product-support/suunto_d5/suunto_d5/features/ascent-rate/' },
  garmin_alerts: { title: 'Garmin Descent: alerts above 9.1 m/min for 5 s; ceiling tolerance 0.6 m', url: 'https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-US/GUID-80F7A2DF-6152-44DE-991E-F8B94A097A82.html' },
  bsac_deco: { title: 'BSAC Safe Diving: the last 6 m in a minute; at most 3 dives a day; a break after 4 deep days', url: 'https://bsac.com/safety/safe-diving-guide/decompression' },
  bennett_2007: { title: 'Bennett et al. 2007: a 3–5 minute stop cuts bubbles after no-stop dives', url: 'https://europepmc.org/abstract/MED/18251436' },
  dan_ndl: { title: 'DAN 2025: a critical look at no-decompression limits', url: 'https://dan.org/alert-diver/article/a-critical-look-at-no-decompression-limits/' },
  dan_equalise: { title: 'DAN: equalise early and often', url: 'https://blog.padi.com/10-tips-for-equalizing-ears/' },
  gue_fundamentals: { title: 'GUE Fundamentals standards: hold a stop within 1.5 m', url: 'https://www.gue.com/files/Standards_and_Procedures/standards10/BasicFund-Standards-v10.1.pdf' },
  noaa_oxygen: { title: 'NOAA oxygen exposure limits (1.4 bar working, 1.6 bar contingency)', url: 'https://shearwater.com/blogs/community/shearwater-and-the-cns-oxygen-clock' },
  walker_1992: { title: 'Walker 1992: instructors with DCS often had multiple ascents', url: 'https://www.dhmjournal.com/images/IndividArticles/22June/Walker_SPUMSJ.22.2.66-70.pdf' },
  smart_2014: { title: 'Smart et al. 2014: slow yo-yo schedules gave almost no bubbles', url: 'https://europepmc.org/abstract/MED/25311318' },
  reverse_1999: { title: 'Reverse Dive Profiles workshop 1999: no reason to forbid them within 40 m and 12 m difference', url: 'https://repository.si.edu/items/2929ad96-4e7c-47d7-bbc4-e80818002aaa/full' },
  dan_europe_2026: { title: 'DAN Europe 2026: longer surface intervals lower the odds of DCS', url: 'https://alertdiver.eu/en_US/articles/dans-dcs-database-deep-dive/' },
  dan_flying: { title: 'DAN 2002: guidelines for flying after diving', url: 'https://dan.org/health-medicine/health-resource/health-safety-guidelines/guidelines-for-flying-after-diving/' },
} as const;
export type SourceId = keyof typeof SOURCES;

/** `profile` rules read the Primary recording's samples; `series` rules read the Diver's dives around this one. */
export const RULES = {
  ascent_rate: { scope: 'profile', evidence: ['experiment', 'rule'], sources: ['carturan_2002', 'marroni_2004', 'garmin_alerts', 'suunto_ascent'] },
  last_metres: { scope: 'profile', evidence: ['rule'], sources: ['bsac_deco', 'garmin_alerts'] },
  safety_stop: { scope: 'profile', evidence: ['experiment', 'rule'], sources: ['bennett_2007', 'dan_ndl'] },
  descent_rate: { scope: 'profile', evidence: ['opinion'], sources: ['dan_equalise'] },
  stop_stability: { scope: 'profile', evidence: ['rule'], sources: ['gue_fundamentals'] },
  ndl: { scope: 'profile', evidence: ['opinion', 'observational'], sources: ['dan_ndl'] },
  ceiling: { scope: 'profile', evidence: ['rule'], sources: ['garmin_alerts'] },
  ppo2: { scope: 'profile', evidence: ['rule'], sources: ['noaa_oxygen'] },
  cns: { scope: 'profile', evidence: ['rule'], sources: ['noaa_oxygen'] },
  sawtooth: { scope: 'profile', evidence: ['case_series', 'rule'], sources: ['walker_1992', 'smart_2014', 'bsac_deco'] },
  reverse_profile: { scope: 'series', evidence: ['consensus'], sources: ['reverse_1999'] },
  surface_interval: { scope: 'series', evidence: ['observational'], sources: ['dan_europe_2026'] },
  dives_per_day: { scope: 'series', evidence: ['rule'], sources: ['bsac_deco'] },
  deep_days: { scope: 'series', evidence: ['rule'], sources: ['bsac_deco'] },
} as const satisfies Record<string, { scope: 'profile' | 'series'; evidence: readonly Evidence[]; sources: readonly SourceId[] }>;
export type RuleId = keyof typeof RULES;
export const RULE_IDS = Object.keys(RULES) as RuleId[];

/** The thresholds, in one place. Metres, minutes, seconds, bar, percent. */
export const LIMITS = {
  /** Rates are measured over this window, so 1 s and 5 s data behave alike. */
  windowS: 15,
  /** A rate counts once it holds this long. */
  sustainedS: 5,
  ascentNoteMMin: 10,
  ascentCautionMMin: 18,
  /** The last metres have a rule of their own; the ascent rule looks below them. */
  lastMetresFromM: 6,
  /**
   * BSAC's "last 6 m in a minute" is 6 m/min, which few divers keep after a stop, and many come up the last 5 m at
   * 10 m/min or more. Remarking on that would teach Users to ignore findings (owner, 2026-10-07): the last metres are
   * remarked on only when the diver shot up, faster than 18 m/min, and as information.
   */
  lastMetresMMin: 18,
  /** Stops and the last metres are judged on dives deeper than this. */
  stopDivesDeeperThanM: 10,
  /** A safety stop is credited between these depths (3–6 m with half a metre of tolerance). */
  stopBandM: [2.5, 6.5] as const,
  stopMinS: 180,
  stopLongS: 300,
  stopLongDeeperThanM: 30,
  stopLongNdlS: 300,
  stopStabilityM: 1.5,
  descentMMin: 18,
  descentFirstM: 10,
  ndlNoteS: 300,
  ceilingToleranceM: 0.6,
  ceilingBrokenS: 30,
  ppo2NoteBar: 1.4,
  ppo2NoteS: 60,
  ppo2CautionBar: 1.6,
  cnsNotePercent: 80,
  cnsCautionPercent: 100,
  sawtoothExcursionM: 6,
  sawtoothExcursions: 4,
  /** A depth sample that jumps in and straight back out faster than this is a sensor spike. */
  spikeMMin: 60,
  /** Shallower than this counts as at the surface; this long there splits a recording into dives. */
  surfaceM: 1,
  surfaceSplitS: 60,
  /** A dive follows another "repetitively" when it starts within this of the other's end. */
  repetitiveH: 12,
  reverseDeeperByM: 12,
  reverseDeeperThanM: 40,
  shortIntervalMin: 60,
  shortIntervalDeeperThanM: 18,
  divesPerDay: 3,
  deepDayM: 30,
  deepDays: 4,
  /** Ascent bands the profile is coloured by, m/min (Subsurface's 4, 9 and 18). */
  bandsMMin: [4, 9, 18] as const,
} as const;

export type FindingValues = Record<string, number | string | boolean | null>;

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** The stretch of the profile, in seconds from the Recording's start; null for a finding about the dive as a whole. */
  startS: number | null;
  endS: number | null;
  /** What was measured, and the threshold it is held against. */
  values: FindingValues;
}

export interface Series {
  offsetsMs: number[];
  values: number[];
}

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

const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
};

/** Depth samples with sensor spikes interpolated (never dropped): in and straight back out faster than 60 m/min. */
export function cleanDepth(depth: Series): { t: number[]; d: number[] } {
  const t = depth.offsetsMs.map((ms) => ms / 1000);
  const raw = depth.values;
  const d = [...raw];
  for (let i = 1; i < raw.length - 1; i++) {
    const before = t[i]! - t[i - 1]!;
    const after = t[i + 1]! - t[i]!;
    if (before <= 0 || after <= 0) continue;
    const rateIn = ((raw[i]! - raw[i - 1]!) / before) * 60;
    const rateOut = ((raw[i + 1]! - raw[i]!) / after) * 60;
    if (Math.abs(rateIn) > LIMITS.spikeMMin && Math.abs(rateOut) > LIMITS.spikeMMin && Math.sign(rateIn) !== Math.sign(rateOut)) {
      d[i] = raw[i - 1]! + ((raw[i + 1]! - raw[i - 1]!) * before) / (before + after);
    }
  }
  return { t, d };
}

/**
 * The ascent rate from each sample over the next 15 seconds, in m/min (negative: descending); null where the
 * recording ends or has a gap. `end[i]` is the sample the window reaches.
 */
function windowRates(t: number[], d: number[]) {
  const rate: (number | null)[] = [];
  const end: number[] = [];
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    while (j < t.length && t[j]! - t[i]! < LIMITS.windowS) j++;
    const span = j < t.length ? t[j]! - t[i]! : 0;
    rate.push(j < t.length && span <= LIMITS.windowS * 3 ? ((d[i]! - d[j]!) / span) * 60 : null);
    end.push(Math.min(j, t.length - 1));
  }
  return { rate, end };
}

/** Runs of consecutive samples for which `holds` is true, as index pairs. */
function runs(length: number, holds: (i: number) => boolean): [number, number][] {
  const found: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= length; i++) {
    if (i < length && holds(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      found.push([start, i - 1]);
      start = -1;
    }
  }
  return found;
}

/** A recording split where it stayed at the surface for a minute or more: each part is a dive of its own. */
export function segments(t: number[], d: number[]): [number, number][] {
  const breaks = runs(d.length, (i) => d[i]! < LIMITS.surfaceM)
    .filter(([a, b]) => a > 0 && b < d.length - 1 && t[b]! - t[a]! >= LIMITS.surfaceSplitS);
  const parts: [number, number][] = [];
  let from = 0;
  for (const [a, b] of breaks) {
    parts.push([from, a]);
    from = b;
  }
  parts.push([from, d.length - 1]);
  return parts;
}

/** A series' value at time `at` (seconds): its latest sample up to then. */
function stepAt(series: Series, at: number): number | null {
  let value: number | null = null;
  for (let i = 0; i < series.offsetsMs.length && series.offsetsMs[i]! / 1000 <= at; i++) value = series.values[i]!;
  return value;
}

/** Seconds a series spent above `limit`, and the stretch from the first to the last such sample. */
function timeAbove(series: Series, limit: number) {
  let seconds = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (let i = 0; i < series.values.length; i++) {
    if (series.values[i]! <= limit) continue;
    const at = series.offsetsMs[i]! / 1000;
    const next = i + 1 < series.offsetsMs.length ? series.offsetsMs[i + 1]! / 1000 : at;
    seconds += next - at;
    first ??= at;
    last = next;
  }
  return { seconds, first, last };
}

/** Shallow turning points between two deeper stretches, each at least `amplitude` metres deeper (a zigzag filter). */
function excursions(t: number[], d: number[], from: number, to: number, amplitude: number): number[] {
  const shallow: number[] = [];
  let direction: 'down' | 'up' = 'down';
  let extreme = from;
  for (let i = from + 1; i <= to; i++) {
    if (direction === 'down') {
      if (d[i]! > d[extreme]!) extreme = i;
      else if (d[extreme]! - d[i]! >= amplitude) { direction = 'up'; extreme = i; }
    } else if (d[i]! < d[extreme]!) extreme = i;
    else if (d[i]! - d[extreme]! >= amplitude) { shallow.push(extreme); direction = 'down'; extreme = i; }
  }
  return shallow;
}

/** The findings a Recording's samples give, for an open-circuit dive. */
export function assessProfile(input: ProfileInput): ProfileAssessment {
  const { t, d } = cleanDepth(input.depth);
  const findings: Finding[] = [];
  if (d.length < 2) return { findings, enteredDeco: false, sampleIntervalS: 0, ascentBands: [] };
  const sampleIntervalS = round(median(t.slice(1).map((v, i) => v - t[i]!)), 1);
  const { rate, end } = windowRates(t, d);
  const duration = ([a, b]: [number, number]) => t[b]! - t[a]! + sampleIntervalS;
  const sustained = (holds: (i: number) => boolean) => runs(d.length, holds).filter((r) => duration(r) >= LIMITS.sustainedS);
  const parts = segments(t, d);
  const maxOf = ([a, b]: [number, number]) => Math.max(...d.slice(a, b + 1));

  const minNdl = input.ndl && input.ndl.values.length > 0 ? Math.min(...input.ndl.values) : null;
  const enteredDeco = minNdl === 0;

  // Ascent rate, below the last 6 m (which have their own rule).
  const fast = sustained((i) => rate[i] !== null && rate[i]! > LIMITS.ascentNoteMMin && d[i]! > LIMITS.lastMetresFromM);
  if (fast.length > 0) {
    const peak = (r: [number, number]) => Math.max(...rate.slice(r[0], r[1] + 1).map((v) => v ?? 0));
    const worst = fast.reduce((a, b) => (peak(b) > peak(a) ? b : a));
    const veryFast = sustained((i) => rate[i] !== null && rate[i]! > LIMITS.ascentCautionMMin && d[i]! > LIMITS.lastMetresFromM).length > 0;
    findings.push({
      rule: 'ascent_rate', severity: veryFast ? 'caution' : 'note', startS: t[worst[0]]!, endS: t[end[worst[1]]!]!,
      values: {
        max_m_min: round(peak(worst)), limit_m_min: veryFast ? LIMITS.ascentCautionMMin : LIMITS.ascentNoteMMin,
        seconds: Math.round(t[end[worst[1]]!]! - t[worst[0]]!), from_depth_m: round(d[worst[0]]!), to_depth_m: round(d[end[worst[1]]!]!),
        stretches: fast.length, sample_interval_s: sampleIntervalS,
      },
    });
  }

  // A fast descent through the first 10 m: a tip about equalising.
  const dropped = sustained((i) => rate[i] !== null && -rate[i]! > LIMITS.descentMMin && d[i]! < LIMITS.descentFirstM);
  if (dropped.length > 0) {
    const peak = (r: [number, number]) => Math.max(...rate.slice(r[0], r[1] + 1).map((v) => -(v ?? 0)));
    const worst = dropped.reduce((a, b) => (peak(b) > peak(a) ? b : a));
    findings.push({
      rule: 'descent_rate', severity: 'info', startS: t[worst[0]]!, endS: t[end[worst[1]]!]!,
      values: { max_m_min: round(peak(worst)), limit_m_min: LIMITS.descentMMin, within_m: LIMITS.descentFirstM },
    });
  }

  // The last 6 m and the safety stop, on each part deeper than 10 m; the part that did worst is reported.
  let lastMetres: Finding | undefined;
  let stop: Finding | undefined;
  let stability: Finding | undefined;
  for (const part of parts) {
    const [a, b] = part;
    const deepest = maxOf(part);
    if (deepest <= LIMITS.stopDivesDeeperThanM) continue;
    // Recordings that end under water (a battery, a split file) say nothing about the way up.
    if (d[b]! > 2) continue;

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
    if (metres >= 3 && mMin > LIMITS.lastMetresMMin && (!lastMetres || mMin > (lastMetres.values.m_min as number))) {
      lastMetres = {
        rule: 'last_metres', severity: 'info', startS: t[below]!, endS: t[surfaced]!,
        values: { seconds: Math.round(seconds), metres: round(metres), m_min: round(mMin), limit_m_min: LIMITS.lastMetresMMin, last_m: LIMITS.lastMetresFromM },
      };
    }

    if (enteredDeco) continue; // Stops were obligations then; the ceiling rule looks at them.
    const [shallowEdge, deepEdge] = LIMITS.stopBandM;
    let lastDeep = b;
    while (lastDeep > a && d[lastDeep]! <= deepEdge) lastDeep--;
    const inBand = (i: number) => d[i]! >= shallowEdge && d[i]! <= deepEdge;
    const stopSamples: number[] = [];
    let stopS = 0;
    for (let i = lastDeep + 1; i <= b; i++) {
      if (!inBand(i)) continue;
      stopSamples.push(i);
      if (i > lastDeep + 1 && inBand(i - 1)) stopS += t[i]! - t[i - 1]!;
    }
    const long = deepest > LIMITS.stopLongDeeperThanM || (minNdl !== null && minNdl <= LIMITS.stopLongNdlS);
    const severity: Severity | null = stopS < LIMITS.stopMinS ? 'note' : long && stopS < LIMITS.stopLongS ? 'info' : null;
    if (severity && (!stop || stopS < (stop.values.seconds as number))) {
      stop = {
        rule: 'safety_stop', severity, startS: t[stopSamples[0] ?? lastDeep]!, endS: t[stopSamples.at(-1) ?? b]!,
        values: {
          seconds: Math.round(stopS), recommended_s: long ? LIMITS.stopLongS : LIMITS.stopMinS, minimum_s: LIMITS.stopMinS,
          max_depth_m: round(deepest), min_ndl_s: minNdl, from_m: 3, to_m: 6,
        },
      };
    }
    if (stopS >= 60) {
      // Between arriving at the stop's depth and leaving it: the way in and out is not wandering.
      const middle = median(stopSamples.map((i) => d[i]!));
      const near = stopSamples.filter((i) => Math.abs(d[i]! - middle) <= 0.5);
      const depths = stopSamples.filter((i) => i >= near[0]! && i <= near.at(-1)!).map((i) => d[i]!);
      const off = Math.max(...depths.map((v) => Math.abs(v - middle)));
      if (off > LIMITS.stopStabilityM && !stability) {
        stability = {
          rule: 'stop_stability', severity: 'info', startS: t[stopSamples[0]!]!, endS: t[stopSamples.at(-1)!]!,
          values: { shallowest_m: round(Math.min(...depths)), deepest_m: round(Math.max(...depths)), within_m: LIMITS.stopStabilityM },
        };
      }
    }
  }
  for (const found of [lastMetres, stop, stability]) if (found) findings.push(found);

  // The computer's no-decompression limit.
  if (minNdl !== null && minNdl <= LIMITS.ndlNoteS) {
    const at = input.ndl!.offsetsMs[input.ndl!.values.indexOf(minNdl)]! / 1000;
    findings.push({
      rule: 'ndl', severity: 'note', startS: at, endS: at,
      values: { min_ndl_s: minNdl, limit_s: LIMITS.ndlNoteS, entered_deco: enteredDeco },
    });
  }

  // Shallower than the ceiling the computer asked for, once in decompression.
  if (enteredDeco && input.nextStopDepth) {
    let seconds = 0;
    let above = 0;
    let first: number | null = null;
    let last: number | null = null;
    for (let i = 0; i < d.length - 1; i++) {
      const ceiling = stepAt(input.nextStopDepth, t[i]!);
      if (ceiling === null || ceiling <= 0 || d[i]! >= ceiling - LIMITS.ceilingToleranceM) continue;
      seconds += t[i + 1]! - t[i]!;
      above = Math.max(above, ceiling - d[i]!);
      first ??= t[i]!;
      last = t[i + 1]!;
    }
    if (seconds > LIMITS.ceilingBrokenS) {
      findings.push({
        rule: 'ceiling', severity: 'caution', startS: first, endS: last,
        values: { seconds: Math.round(seconds), limit_s: LIMITS.ceilingBrokenS, above_m: round(above) },
      });
    }
  }

  if (input.po2) {
    const working = timeAbove(input.po2, LIMITS.ppo2NoteBar);
    const contingency = timeAbove(input.po2, LIMITS.ppo2CautionBar);
    const caution = contingency.seconds >= LIMITS.sustainedS;
    if (caution || working.seconds > LIMITS.ppo2NoteS) {
      findings.push({
        rule: 'ppo2', severity: caution ? 'caution' : 'note', startS: working.first, endS: working.last,
        values: {
          max_bar: round(Math.max(...input.po2.values), 2), limit_bar: caution ? LIMITS.ppo2CautionBar : LIMITS.ppo2NoteBar,
          seconds_above_working: Math.round(working.seconds), seconds_above_contingency: Math.round(contingency.seconds),
        },
      });
    }
  }

  if (input.cns && input.cns.values.length > 0) {
    const max = Math.max(...input.cns.values);
    if (max >= LIMITS.cnsNotePercent) {
      findings.push({
        rule: 'cns', severity: max >= LIMITS.cnsCautionPercent ? 'caution' : 'note', startS: null, endS: null,
        values: { max_percent: Math.round(max), limit_percent: max >= LIMITS.cnsCautionPercent ? LIMITS.cnsCautionPercent : LIMITS.cnsNotePercent },
      });
    }
  }

  // Sawtooth: conservative on purpose (4 excursions of 6 m), counted within one dive.
  const teeth = parts.map(([a, b]) => excursions(t, d, a, b, LIMITS.sawtoothExcursionM)).reduce((most, e) => (e.length > most.length ? e : most), []);
  if (teeth.length >= LIMITS.sawtoothExcursions) {
    findings.push({
      rule: 'sawtooth', severity: 'note', startS: t[teeth[0]!]!, endS: t[teeth.at(-1)!]!,
      values: { excursions: teeth.length, at_least: LIMITS.sawtoothExcursions, of_m: LIMITS.sawtoothExcursionM },
    });
  }

  // How fast each stretch of the ascent was, for colouring the profile.
  const [brisk, quick, veryQuick] = LIMITS.bandsMMin;
  const bandOf = (i: number): 0 | 1 | 2 | 3 => {
    const r = rate[i];
    return r === null || r === undefined || r <= brisk ? 0 : r <= quick ? 1 : r <= veryQuick ? 2 : 3;
  };
  const ascentBands: AscentBand[] = [];
  for (const level of [1, 2, 3] as const) {
    for (const [a, b] of sustained((i) => bandOf(i) === level)) ascentBands.push([Math.round(t[a]!), Math.round(t[end[b]!]!), level]);
  }
  ascentBands.sort((x, y) => x[0] - y[0] || x[2] - y[2]);

  return { findings, enteredDeco, sampleIntervalS, ascentBands };
}

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

/** The findings about a Diver's dives in relation to each other, by dive. `dives` in any order. */
export function assessSeries(dives: SeriesDive[]): Map<string, Finding[]> {
  const sorted = [...dives].sort((a, b) => a.startMs - b.startMs);
  const found = new Map<string, Finding[]>(sorted.map((d) => [d.id, []]));
  const add = (dive: SeriesDive, finding: Omit<Finding, 'startS' | 'endS'>) => found.get(dive.id)!.push({ ...finding, startS: null, endS: null });

  const byDay = new Map<string, SeriesDive[]>();
  for (const d of sorted) byDay.set(d.day, [...(byDay.get(d.day) ?? []), d]);
  const deepDays = new Set([...byDay].filter(([, list]) => list.some((d) => (d.maxDepthM ?? 0) > LIMITS.deepDayM)).map(([day]) => dayNumber(day)));

  sorted.forEach((dive, index) => {
    const previous = sorted[index - 1];
    const intervalMin = previous ? (dive.startMs - previous.endMs) / 60_000 : null;

    // A deeper dive after a shallower one, outside what the 1999 workshop found no reason to forbid.
    if (previous && intervalMin !== null && intervalMin >= 0 && intervalMin < LIMITS.repetitiveH * 60
      && dive.maxDepthM !== null && previous.maxDepthM !== null && dive.maxDepthM > previous.maxDepthM) {
      const deeperBy = dive.maxDepthM - previous.maxDepthM;
      const reason = deeperBy > LIMITS.reverseDeeperByM ? 'difference' : dive.maxDepthM > LIMITS.reverseDeeperThanM ? 'depth'
        : dive.enteredDeco || previous.enteredDeco ? 'decompression' : null;
      if (reason) {
        add(dive, {
          rule: 'reverse_profile', severity: 'info',
          values: {
            reason, max_depth_m: round(dive.maxDepthM), previous_max_depth_m: round(previous.maxDepthM), deeper_by_m: round(deeperBy),
            interval_min: Math.round(intervalMin), within_m: LIMITS.reverseDeeperByM, within_depth_m: LIMITS.reverseDeeperThanM, previous_dive_id: previous.id,
          },
        });
      }
    }

    if (intervalMin !== null && intervalMin >= 0 && intervalMin < LIMITS.shortIntervalMin && (dive.maxDepthM ?? 0) > LIMITS.shortIntervalDeeperThanM) {
      add(dive, {
        rule: 'surface_interval', severity: 'info',
        values: { interval_min: Math.round(intervalMin), limit_min: LIMITS.shortIntervalMin, max_depth_m: round(dive.maxDepthM!), deeper_than_m: LIMITS.shortIntervalDeeperThanM },
      });
    }

    const sameDay = byDay.get(dive.day)!;
    const nth = sameDay.indexOf(dive) + 1;
    if (nth > LIMITS.divesPerDay) add(dive, { rule: 'dives_per_day', severity: 'info', values: { dive_of_day: nth, limit: LIMITS.divesPerDay } });

    if ((dive.maxDepthM ?? 0) > LIMITS.deepDayM) {
      let days = 1;
      while (deepDays.has(dayNumber(dive.day) - days)) days++;
      if (days >= LIMITS.deepDays) add(dive, { rule: 'deep_days', severity: 'info', values: { days, limit_days: LIMITS.deepDays, deeper_than_m: LIMITS.deepDayM } });
    }

  });
  return found;
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
