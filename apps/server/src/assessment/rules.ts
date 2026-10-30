// The dive assessment's rules (ADR 0036): what each rule is, its sources and thresholds, and the Finding it gives. The
// logic is pure functions from a Recording's samples (profile-rules.ts, on signals.ts) and from a Diver's dives
// (series-rules.ts). Thresholds are fixed here with their sources; changing one raises ENGINE_VERSION, which recomputes every
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

