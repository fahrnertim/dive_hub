// A finding in English sentences, for the MCP tool (ADR 0035, 0036): what was measured, the guidance it is held
// against, and a recommendation. The web client renders its own from the same values, in the User's language and
// units. Wording rules: facts first, guidance with its source, no blame, no medical claims.
import type { FindingValues, NoFly, RuleId } from './rules.js';

/** Said with every assessment, wherever it is shown. */
export const ASSESSMENT_NOTE = 'Findings compare a logged dive with published guidance. They are not medical advice and no measure of how safe the dive was: '
  + 'decompression sickness can happen on dives within every limit, and most dives with findings end without harm. '
  + 'With symptoms after a dive (unusual tiredness, joint pain, skin changes, numbness, dizziness), call DAN or the local emergency services.';

const n = (value: unknown, digits = 0) => (typeof value === 'number' ? value.toFixed(digits).replace(/\.0+$/, '') : '?');
const minutes = (seconds: unknown) => (typeof seconds === 'number' ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')} min` : '?');

interface Text {
  summary: (v: FindingValues) => string;
  guidance: string;
  recommendation: string;
}

export const FINDING_TEXT: Record<RuleId, Text> = {
  ascent_rate: {
    summary: (v) => `Ascended at up to ${n(v.max_m_min, 1)} m/min for ${n(v.seconds)} s, from ${n(v.from_depth_m, 1)} m to ${n(v.to_depth_m, 1)} m`
      + `${Number(v.stretches) > 1 ? ` (${n(v.stretches)} such stretches on this dive)` : ''}.`
      + `${Number(v.sample_interval_s) >= 5 ? ` The recording has a depth every ${n(v.sample_interval_s)} s, so shorter bursts can be missing.` : ''}`,
    guidance: 'Tables and dive computers assume about 9 to 10 m/min; in experiments faster ascents gave more bubbles, and 10 m/min with a stop the fewest. Above 18 m/min is twice that.',
    recommendation: 'Start the ascent early enough to take it slowly, and watch the computer\'s ascent indicator, most of all in the shallower half.',
  },
  last_metres: {
    summary: (v) => `Came up the last ${n(v.metres, 1)} m in ${n(v.seconds)} s (${n(v.m_min, 1)} m/min).`,
    guidance: 'Pressure changes fastest near the surface, so the last metres matter most. BSAC asks for a minute for the last 6 m; many divers are faster after a stop, so Dive Hub remarks on them only above 18 m/min, twice what the rest of the ascent is held to.',
    recommendation: 'After the stop, let the last metres take their time.',
  },
  safety_stop: {
    summary: (v) => `Spent ${minutes(v.seconds)} between 3 and 6 m before surfacing from ${n(v.max_depth_m, 1)} m; ${n(Number(v.recommended_s) / 60)} minutes are recommended`
      + `${Number(v.recommended_s) > Number(v.minimum_s) ? ` (deeper than 30 m, or the no-decompression limit fell to 5 minutes or less)` : ''}.`,
    guidance: 'A stop of 3 minutes at 3 to 6 m cut bubbles by about a factor of ten after no-stop dives; 5 minutes are advised after dives deeper than 30 m or close to the no-decompression limit. Longer than 5 minutes showed no further gain.',
    recommendation: 'Plan the gas and the time for the stop, and hold it for the full time when conditions allow.',
  },
  descent_rate: {
    summary: (v) => `Descended at up to ${n(v.max_m_min, 1)} m/min within the first ${n(v.within_m)} m.`,
    guidance: 'There is no outcome study on descent speed; ear and sinus squeeze are the most common diving injuries, and DAN advises equalising early and often.',
    recommendation: 'If equalising was easy, nothing to change. If not, descend more slowly through the first 10 m.',
  },
  stop_stability: {
    summary: (v) => `On the safety stop the depth moved between ${n(v.shallowest_m, 1)} and ${n(v.deepest_m, 1)} m.`,
    guidance: 'Training standards (GUE Fundamentals) ask to hold a stop within 1.5 m. Small movements have no shown effect on decompression; this is feedback on buoyancy control.',
    recommendation: 'A visual reference (a line, the reef) and slow breathing make a stop easier to hold.',
  },
  ndl: {
    summary: (v) => (v.entered_deco ? 'The dive computer\'s no-decompression limit reached zero: the dive went into decompression.'
      : `The dive computer's no-decompression limit fell to ${n(Number(v.min_ndl_s) / 60)} min.`),
    guidance: 'Risk rises toward the no-decompression limit (DAN 2025); the limit is not a line between safe and unsafe.',
    recommendation: 'Leave more margin where you can: start up earlier, and extend the safety stop to 5 minutes.',
  },
  ceiling: {
    summary: (v) => `Was up to ${n(v.above_m, 1)} m shallower than the ceiling the dive computer asked for, for ${n(v.seconds)} s in all.`,
    guidance: 'Decompression stops are obligations of the plan the computer follows; Garmin tolerates 0.6 m above a ceiling before it alerts.',
    recommendation: 'Hold stops at or just below the depth the computer shows. If a stop was missed, follow the computer\'s and your agency\'s procedure, and watch for symptoms.',
  },
  ppo2: {
    summary: (v) => `The oxygen partial pressure reached ${n(v.max_bar, 2)} bar: ${n(v.seconds_above_working)} s above 1.4 bar`
      + `${Number(v.seconds_above_contingency) > 0 ? `, ${n(v.seconds_above_contingency)} s of them above 1.6 bar` : ''}.`,
    guidance: 'NOAA\'s limits use 1.4 bar as the working limit and 1.6 bar for contingencies; the risk of oxygen toxicity rises with pressure and time.',
    recommendation: 'Check the gas\'s maximum operating depth before the dive and keep above it.',
  },
  cns: {
    summary: (v) => `The dive computer's oxygen clock (CNS) reached ${n(v.max_percent)} %.`,
    guidance: 'The CNS percentage counts oxygen exposure against NOAA\'s limits; 80 % is the usual planning limit, 100 % the limit itself.',
    recommendation: 'Plan repetitive nitrox dives with the oxygen clock in mind: a leaner mix, shallower, or a longer surface interval.',
  },
  sawtooth: {
    summary: (v) => `The profile went up and down ${n(v.excursions)} times by ${n(v.of_m)} m or more.`,
    guidance: 'Agencies advise against sawtooth profiles, from case series of instructors with many ascents; slow yo-yo schedules with a stop gave almost no bubbles in a field study. There is no threshold backed by evidence; this rule is conservative on purpose (4 excursions of 6 m).',
    recommendation: 'Where the site allows, follow its contour instead of going up and down, and keep ascents slow.',
  },
  reverse_profile: {
    summary: (v) => `This dive (${n(v.max_depth_m, 1)} m) was ${n(v.deeper_by_m, 1)} m deeper than the one ${n(v.interval_min)} min before it (${n(v.previous_max_depth_m, 1)} m)`
      + `${v.reason === 'depth' ? ', and deeper than 40 m' : v.reason === 'decompression' ? ', and one of the two had decompression stops' : ''}.`,
    guidance: 'The 1999 Smithsonian/DAN workshop found no reason to forbid a deeper dive after a shallower one for no-stop dives shallower than 40 m with less than 12 m difference. Outside that, there is little data either way.',
    recommendation: 'Nothing to change by itself. Outside the envelope, plan the second dive with extra margin.',
  },
  surface_interval: {
    summary: (v) => `Started ${n(v.interval_min)} min after the dive before, and went to ${n(v.max_depth_m, 1)} m.`,
    guidance: 'Longer surface intervals lower the odds of decompression sickness (about 6 % per hour in DAN Europe\'s data). An hour before a dive deeper than 18 m is a convention, not a tested minimum.',
    recommendation: 'Where the day allows, take the longer break before the deeper dive.',
  },
  dives_per_day: {
    summary: (v) => `This was dive ${n(v.dive_of_day)} of the day.`,
    guidance: 'BSAC advises at most 3 dives a day. It is an agency rule; liveaboard diving with more had the lowest DCS rate in DAN\'s Project Dive Exploration.',
    recommendation: 'On days with many dives, keep the later ones shallower and the stops long.',
  },
  deep_days: {
    summary: (v) => `Day ${n(v.days)} in a row with a dive deeper than ${n(v.deeper_than_m)} m.`,
    guidance: 'BSAC advises a break after 4 days of dives deeper than 30 m. It is an agency rule; measured bubbles fell over consecutive diving days.',
    recommendation: 'Consider a shallower day or a day off in a long series of deep dives.',
  },
};

/** DAN's no-fly time in a sentence, with the guideline it comes from. */
export const NO_FLY_TEXT = {
  summary: (f: NoFly) => `DAN's guideline is not to fly for ${f.reason === 'decompression' ? 'well over 18 hours (24 are used here)' : `${f.hours} hours`} after this dive, until ${f.until.slice(0, 16).replace('T', ' ')} UTC`
    + `${f.reason === 'several' ? ' (several dives or diving days)' : f.reason === 'single' ? ' (a single dive without decompression stops)' : ' (decompression stops)'}.`,
  guidance: 'DAN\'s 2002 consensus: 12 hours after a single no-stop dive, 18 hours after several dives or days of diving, substantially longer after decompression dives. It also applies to driving over high passes.',
};
