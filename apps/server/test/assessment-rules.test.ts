// The dive assessment's rules (ADR 0036) on synthetic profiles: what must be found and, as important, what must not.
// When real files are in samples/private, every rule runs over them and the counts are printed (look before shipping).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LIMITS, RULES, RULE_IDS, SOURCES, assessProfile, assessSeries, cleanDepth, noFlyAfter, segments, type Finding, type Series, type SeriesDive,
} from '../src/assessment/rules.js';
import { createFitAdapter } from '../src/fit/fit-adapter.js';

/** A depth series through waypoints [minute, metres], sampled every `stepS` seconds. */
function profile(waypoints: [number, number][], stepS = 1): Series {
  const offsetsMs: number[] = [];
  const values: number[] = [];
  const end = waypoints.at(-1)![0] * 60;
  for (let s = 0; s <= end; s += stepS) {
    const k = Math.max(1, waypoints.findIndex(([m]) => m * 60 >= s));
    const [m0, d0] = waypoints[k - 1]!;
    const [m1, d1] = waypoints[k]!;
    offsetsMs.push(s * 1000);
    values.push(d0 + ((d1 - d0) * (s - m0 * 60)) / ((m1 - m0) * 60));
  }
  return { offsetsMs, values };
}
/** A series holding `value` for the whole of `depth`, except where `at` says otherwise. */
const channel = (depth: Series, value: (seconds: number) => number): Series => ({
  offsetsMs: depth.offsetsMs, values: depth.offsetsMs.map((ms) => value(ms / 1000)),
});

/** 20 m for half an hour, up at 8 m/min, three and a half minutes at 5 m, a slow last stretch. */
const CLEAN: [number, number][] = [[0, 0], [2, 20], [30, 20], [31.9, 5], [35.4, 5], [36.6, 0]];
const rules = (findings: Finding[]) => findings.map((f) => f.rule);
const find = (findings: Finding[], rule: string) => findings.find((f) => f.rule === rule);

describe('the rules\' catalogue', () => {
  it('gives every rule a source that exists and an evidence label', () => {
    for (const id of RULE_IDS) {
      expect(RULES[id].evidence.length).toBeGreaterThan(0);
      for (const source of RULES[id].sources) expect(SOURCES[source].url).toMatch(/^https:\/\//);
    }
  });
});

describe('cleaning and splitting', () => {
  it('interpolates a spike in and out, and keeps every sample', () => {
    const depth = profile(CLEAN);
    depth.values[600] = 3; // 20 m, one sample at 3 m, 20 m again
    const { d } = cleanDepth(depth);
    expect(d).toHaveLength(depth.values.length);
    expect(d[600]).toBeCloseTo(20, 5);
  });

  it('does not turn a spike into a fast ascent', () => {
    const depth = profile(CLEAN);
    depth.values[600] = 3;
    expect(rules(assessProfile({ depth }).findings)).toEqual([]);
  });

  it('splits a recording at a minute at the surface, not at a short touch', () => {
    const twoDives = profile([[0, 0], [2, 15], [20, 15], [22, 0], [24, 0], [26, 15], [40, 15], [42, 0]]);
    const { t, d } = cleanDepth(twoDives);
    expect(segments(t, d)).toHaveLength(2);
    const touch = profile([[0, 0], [2, 15], [20, 15], [22, 0], [22.5, 0], [24, 15], [40, 15], [42, 0]]);
    const cleaned = cleanDepth(touch);
    expect(segments(cleaned.t, cleaned.d)).toHaveLength(1);
  });
});

describe('profile practice', () => {
  it('finds nothing on a clean dive', () => {
    const assessed = assessProfile({ depth: profile(CLEAN) });
    expect(assessed.findings).toEqual([]);
    expect(assessed).toMatchObject({ enteredDeco: false, sampleIntervalS: 1 });
  });

  it('notes an ascent faster than 10 m/min that lasts, with where and how fast', () => {
    // 20 m to 9 m in a minute.
    const depth = profile([[0, 0], [2, 20], [30, 20], [31, 9], [33, 5], [36.5, 5], [37.7, 0]]);
    const found = find(assessProfile({ depth }).findings, 'ascent_rate')!;
    expect(found).toMatchObject({ severity: 'note', values: { limit_m_min: 10, from_depth_m: 20, stretches: 1, sample_interval_s: 1 } });
    expect(found.values.max_m_min).toBeCloseTo(11, 0);
    expect(found.startS).toBeCloseTo(1800, -1);
    expect(found.values.to_depth_m as number).toBeLessThan(10);
  });

  it('makes it a caution above 18 m/min', () => {
    const depth = profile([[0, 0], [2, 30], [20, 30], [20.5, 19], [24, 5], [27.5, 5], [28.7, 0]]);
    expect(find(assessProfile({ depth }).findings, 'ascent_rate')).toMatchObject({ severity: 'caution', values: { limit_m_min: 18 } });
  });

  it('ignores a burst shorter than five seconds', () => {
    const depth = profile(CLEAN);
    // Two seconds, one metre up and back: wave action, not an ascent.
    depth.values[900] = 19;
    depth.values[901] = 19;
    expect(rules(assessProfile({ depth }).findings)).not.toContain('ascent_rate');
  });

  it('finds the same fast ascent in 5 s data, and says how coarse the data is', () => {
    const depth = profile([[0, 0], [2, 20], [30, 20], [31, 9], [33, 5], [36.5, 5], [37.7, 0]], 5);
    const assessed = assessProfile({ depth });
    expect(assessed.sampleIntervalS).toBe(5);
    expect(find(assessed.findings, 'ascent_rate')).toMatchObject({ severity: 'note', values: { sample_interval_s: 5 } });
    expect(assessProfile({ depth: profile(CLEAN, 5) }).findings).toEqual([]);
  });

  it('tells about shooting up the last metres, faster than 18 m/min, as information', () => {
    // 5 m in about 12 seconds.
    const depth = profile([[0, 0], [2, 20], [30, 20], [31.9, 5], [35.4, 5], [35.6, 0]]);
    const assessed = assessProfile({ depth });
    expect(find(assessed.findings, 'last_metres')).toMatchObject({ severity: 'info', values: { limit_m_min: 18, last_m: 6 } });
    expect(find(assessed.findings, 'last_metres')!.values.seconds as number).toBeLessThan(15);
    expect(find(assessed.findings, 'last_metres')!.values.m_min as number).toBeGreaterThan(20);
    // Its own rule: not also an ascent-rate finding.
    expect(rules(assessed.findings)).not.toContain('ascent_rate');
  });

  it('stays quiet about a brisk way from the stop to the surface', () => {
    // 5 m in 40 s (7.5 m/min) and in 20 s (15 m/min): faster than BSAC's minute for 6 m, and what many divers do.
    expect(assessProfile({ depth: profile([[0, 0], [2, 20], [30, 20], [31.9, 5], [35.4, 5], [36.07, 0]]) }).findings).toEqual([]);
    expect(assessProfile({ depth: profile([[0, 0], [2, 20], [30, 20], [31.9, 5], [35.4, 5], [35.74, 0]]) }).findings).toEqual([]);
  });

  it('notes a safety stop shorter than three minutes on a dive deeper than 10 m', () => {
    const depth = profile([[0, 0], [2, 20], [30, 20], [31.9, 5], [33.9, 5], [35.1, 0]]);
    const found = find(assessProfile({ depth }).findings, 'safety_stop')!;
    expect(found).toMatchObject({ severity: 'note', values: { recommended_s: 180, minimum_s: 180, max_depth_m: 20 } });
    expect(found.values.seconds as number).toBeGreaterThan(115);
    // Two minutes at 5 m, plus the swim through the 3–6 m band, which counts.
    expect(found.values.seconds as number).toBeLessThan(180);
  });

  it('notes a missing stop, and asks for none on a shallow dive', () => {
    expect(find(assessProfile({ depth: profile([[0, 0], [2, 20], [30, 20], [32.5, 0]]) }).findings, 'safety_stop')).toMatchObject({ severity: 'note' });
    expect(assessProfile({ depth: profile([[0, 0], [1, 8], [30, 8], [31.5, 0]]) }).findings).toEqual([]);
  });

  it('says five minutes are recommended after 30 m or a low NDL, as information', () => {
    const deep = profile([[0, 0], [3, 34], [15, 34], [18.6, 5], [22.6, 5], [23.8, 0]]);
    expect(find(assessProfile({ depth: deep }).findings, 'safety_stop')).toMatchObject({ severity: 'info', values: { recommended_s: 300 } });
    const lowNdl = profile(CLEAN);
    const assessed = assessProfile({ depth: lowNdl, ndl: channel(lowNdl, (s) => (s > 1500 && s < 1800 ? 240 : 3000)) });
    expect(find(assessed.findings, 'safety_stop')).toMatchObject({ severity: 'info', values: { recommended_s: 300, min_ndl_s: 240 } });
    expect(find(assessed.findings, 'ndl')).toMatchObject({ severity: 'note', values: { min_ndl_s: 240, entered_deco: false } });
  });

  it('gives a tip for a descent faster than 18 m/min through the first 10 m', () => {
    const depth = profile([[0, 0], [0.4, 10], [2, 20], [30, 20], [31.9, 5], [35.4, 5], [36.6, 0]]);
    expect(find(assessProfile({ depth }).findings, 'descent_rate')).toMatchObject({ severity: 'info', values: { limit_m_min: 18 } });
  });

  it('says when the depth wandered more than 1.5 m on the stop', () => {
    const depth = profile([[0, 0], [2, 20], [30, 20], [31.9, 6.2], [33, 3], [34, 6.2], [35.4, 3], [36.2, 0]]);
    expect(find(assessProfile({ depth }).findings, 'stop_stability')).toMatchObject({ severity: 'info', values: { within_m: 1.5 } });
  });

  it('judges each dive of a recording with a surface interval inside it', () => {
    // The first dive ends with a stop and a slow way up; the second shoots up from 5 m in 12 seconds.
    const depth = profile([[0, 0], [2, 18], [20, 18], [21.6, 5], [25.1, 5], [26.3, 0], [29, 0], [31, 18], [45, 18], [46.6, 5], [50.1, 5], [50.3, 0]]);
    const found = find(assessProfile({ depth }).findings, 'last_metres')!;
    expect(found.startS).toBeGreaterThan(50 * 60);
  });
});

describe('decompression and oxygen', () => {
  const deco = profile([[0, 0], [3, 40], [25, 40], [29, 6], [40, 6], [42, 3], [50, 3], [51, 0]]);
  const ndl = channel(deco, (s) => (s < 600 ? 1200 - s * 2 : s < 2700 ? 0 : 5940));

  it('says that the dive entered decompression, and looks at ceilings instead of a safety stop', () => {
    const stops = channel(deco, (s) => (s < 600 ? 0 : s < 2400 ? 6 : s < 3000 ? 3 : 0));
    const assessed = assessProfile({ depth: deco, ndl, nextStopDepth: stops });
    expect(assessed.enteredDeco).toBe(true);
    expect(find(assessed.findings, 'ndl')).toMatchObject({ severity: 'note', values: { min_ndl_s: 0, entered_deco: true } });
    expect(rules(assessed.findings)).not.toContain('safety_stop');
    expect(rules(assessed.findings)).not.toContain('ceiling');
  });

  it('cautions when the diver stayed above the ceiling for more than half a minute', () => {
    // The computer still asks for 6 m while the diver is at 3 m.
    const stops = channel(deco, (s) => (s < 600 ? 0 : s < 2700 ? 6 : 0));
    const found = find(assessProfile({ depth: deco, ndl, nextStopDepth: stops }).findings, 'ceiling')!;
    expect(found).toMatchObject({ severity: 'caution', values: { limit_s: 30, above_m: 3 } });
    expect(found.values.seconds as number).toBeGreaterThan(60);
  });

  it('notes ppO2 above 1.4 bar for more than a minute, and cautions above 1.6', () => {
    const depth = profile(CLEAN);
    const working = find(assessProfile({ depth, po2: channel(depth, (s) => (s > 600 && s < 720 ? 1.45 : 1.1)) }).findings, 'ppo2')!;
    expect(working).toMatchObject({ severity: 'note', values: { max_bar: 1.45, limit_bar: 1.4 } });
    expect(assessProfile({ depth, po2: channel(depth, (s) => (s > 600 && s < 640 ? 1.45 : 1.1)) }).findings).toEqual([]);
    expect(find(assessProfile({ depth, po2: channel(depth, (s) => (s > 600 && s < 620 ? 1.65 : 1.1)) }).findings, 'ppo2'))
      .toMatchObject({ severity: 'caution', values: { limit_bar: 1.6 } });
  });

  it('notes the oxygen clock at 80 %, and cautions at 100 %', () => {
    const depth = profile(CLEAN);
    expect(assessProfile({ depth, cns: channel(depth, () => 60) }).findings).toEqual([]);
    expect(find(assessProfile({ depth, cns: channel(depth, (s) => 40 + s / 50) }).findings, 'cns')).toMatchObject({ severity: 'note', values: { limit_percent: 80 } });
    expect(find(assessProfile({ depth, cns: channel(depth, () => 104) }).findings, 'cns')).toMatchObject({ severity: 'caution', values: { max_percent: 104 } });
  });
});

describe('sawtooth', () => {
  const teeth = (count: number, shallow: number, deep: number): [number, number][] => [
    [0, 0], [2, deep],
    ...Array.from({ length: count }, (_, i): [number, number][] => [[5 + i * 6, deep], [7 + i * 6, shallow], [9 + i * 6, deep]]).flat(),
    [6 + count * 6, deep], [8 + count * 6, 5], [11.5 + count * 6, 5], [12.7 + count * 6, 0],
  ];

  it('stays quiet on three excursions of 3 m, and on three of 6 m', () => {
    expect(rules(assessProfile({ depth: profile(teeth(3, 15, 18)) }).findings)).not.toContain('sawtooth');
    expect(rules(assessProfile({ depth: profile(teeth(3, 12, 18)) }).findings)).not.toContain('sawtooth');
  });

  it('notes four excursions of 6 m', () => {
    expect(find(assessProfile({ depth: profile(teeth(4, 12, 18)) }).findings, 'sawtooth'))
      .toMatchObject({ severity: 'note', values: { excursions: 4, at_least: 4, of_m: 6 } });
  });

  it('does not count many small wiggles as teeth', () => {
    expect(rules(assessProfile({ depth: profile(teeth(8, 16, 18)) }).findings)).not.toContain('sawtooth');
  });
});

describe('ascent bands for colouring the profile', () => {
  it('marks the stretches above 4, 9 and 18 m/min', () => {
    const depth = profile([[0, 0], [2, 30], [20, 30], [20.5, 19], [22, 10], [24, 5], [27.5, 5], [28.7, 0]]);
    const bands = assessProfile({ depth }).ascentBands;
    expect(bands.map((b) => b[2])).toEqual(expect.arrayContaining([1, 3]));
    for (const [start, end] of bands) expect(end).toBeGreaterThan(start);
    expect(assessProfile({ depth: profile([[0, 0], [2, 10], [30, 10], [34, 0]]) }).ascentBands).toEqual([]);
  });
});

describe('series: dives in relation to each other', () => {
  const HOUR = 3_600_000;
  const dive = (id: string, day: string, hour: number, maxDepthM: number | null, minutes = 45, enteredDeco = false): SeriesDive => {
    const startMs = Date.parse(`${day}T00:00:00Z`) + hour * HOUR;
    return { id, startMs, endMs: startMs + minutes * 60_000, day, maxDepthM, enteredDeco };
  };
  const of = (dives: SeriesDive[], id: string) => assessSeries(dives).get(id)!;
  const ruleOf = (dives: SeriesDive[], id: string, rule: string) => of(dives, id).find((f) => f.rule === rule);

  it('says nothing about a deeper second dive inside the 1999 envelope', () => {
    const dives = [dive('a', '2026-03-14', 9, 18), dive('b', '2026-03-14', 13, 28)];
    expect(ruleOf(dives, 'b', 'reverse_profile')).toBeUndefined();
  });

  it('tells about one outside it: deeper by more than 12 m, deeper than 40 m, or with decompression', () => {
    expect(ruleOf([dive('a', '2026-03-14', 9, 12), dive('b', '2026-03-14', 13, 30)], 'b', 'reverse_profile'))
      .toMatchObject({ severity: 'info', values: { reason: 'difference', deeper_by_m: 18, previous_dive_id: 'a' } });
    expect(ruleOf([dive('a', '2026-03-14', 9, 35), dive('b', '2026-03-14', 13, 42)], 'b', 'reverse_profile')).toMatchObject({ values: { reason: 'depth' } });
    expect(ruleOf([dive('a', '2026-03-14', 9, 25, 45, true), dive('b', '2026-03-14', 13, 30)], 'b', 'reverse_profile')).toMatchObject({ values: { reason: 'decompression' } });
    // Not the next day, and not when the second dive is the shallower one.
    expect(ruleOf([dive('a', '2026-03-14', 9, 12), dive('b', '2026-03-15', 13, 30)], 'b', 'reverse_profile')).toBeUndefined();
    expect(ruleOf([dive('a', '2026-03-14', 9, 30), dive('b', '2026-03-14', 13, 12)], 'b', 'reverse_profile')).toBeUndefined();
  });

  it('tells about a surface interval under an hour before a dive deeper than 18 m', () => {
    expect(ruleOf([dive('a', '2026-03-14', 9, 20), dive('b', '2026-03-14', 10.5, 22)], 'b', 'surface_interval'))
      .toMatchObject({ severity: 'info', values: { interval_min: 45, limit_min: 60 } });
    expect(ruleOf([dive('a', '2026-03-14', 9, 20), dive('b', '2026-03-14', 10.5, 12)], 'b', 'surface_interval')).toBeUndefined();
    expect(ruleOf([dive('a', '2026-03-14', 9, 20), dive('b', '2026-03-14', 11, 22)], 'b', 'surface_interval')).toBeUndefined();
  });

  it('tells about the fourth dive of a day, not the third', () => {
    const dives = [9, 11.5, 14, 16.5].map((hour, i) => dive(`d${i}`, '2026-03-14', hour, 12));
    expect(ruleOf(dives, 'd2', 'dives_per_day')).toBeUndefined();
    expect(ruleOf(dives, 'd3', 'dives_per_day')).toMatchObject({ severity: 'info', values: { dive_of_day: 4, limit: 3 } });
  });

  it('tells about the fourth day in a row with a dive deeper than 30 m', () => {
    const dives = ['11', '12', '13', '14'].map((d) => dive(`d${d}`, `2026-03-${d}`, 9, 32));
    expect(ruleOf(dives, 'd13', 'deep_days')).toBeUndefined();
    expect(ruleOf(dives, 'd14', 'deep_days')).toMatchObject({ severity: 'info', values: { days: 4 } });
    // A shallow day in between starts the count again.
    const broken = [dive('a', '2026-03-11', 9, 32), dive('b', '2026-03-12', 9, 20), dive('c', '2026-03-13', 9, 32), dive('d', '2026-03-14', 9, 32)];
    expect(ruleOf(broken, 'd', 'deep_days')).toBeUndefined();
  });

  it('gives DAN\'s no-fly time after the last dive of a diving day, apart from the findings', () => {
    const single = [dive('a', '2026-03-14', 9, 18)];
    expect(noFlyAfter(single, 'a')).toEqual({ hours: 12, reason: 'single', until: '2026-03-14T21:45:00.000Z' });
    expect(of(single, 'a')).toEqual([]);
    const two = [dive('a', '2026-03-14', 9, 18), dive('b', '2026-03-14', 13, 15)];
    expect(noFlyAfter(two, 'a')).toBeNull();
    expect(noFlyAfter(two, 'b')).toMatchObject({ hours: 18, reason: 'several' });
    expect(noFlyAfter([dive('a', '2026-03-13', 9, 18), dive('b', '2026-03-14', 9, 18)], 'b')).toMatchObject({ hours: 18 });
    expect(noFlyAfter([dive('a', '2026-03-14', 9, 45, 60, true)], 'a')).toMatchObject({ hours: 24, reason: 'decompression' });
    expect(noFlyAfter(single, 'unknown')).toBeNull();
  });

  it('judges a dive without a depth by what it has', () => {
    const dives = [dive('a', '2026-03-14', 9, null), dive('b', '2026-03-14', 9.9, null)];
    expect(of(dives, 'b')).toEqual([]);
  });
});

// Real dives, when the owner's files are there (git-ignored): how often does each rule fire?
const samples = fileURLToPath(new URL('../../../samples/private', import.meta.url));
const files = existsSync(samples) ? readdirSync(samples).filter((f) => f.endsWith('.fit')) : [];
describe.skipIf(files.length === 0)('real dives in samples/private', () => {
  it('runs every profile rule over them and prints how often each fires', async () => {
    const adapter = createFitAdapter();
    const fired = new Map<string, number>();
    let dives = 0;
    for (const file of files) {
      for (const recording of await adapter.parse(readFileSync(`${samples}/${file}`))) {
        const series = (name: string) => recording.series.find((s) => s.channel === name);
        const depth = series('depth');
        if (!depth) continue;
        dives++;
        const assessed = assessProfile({ depth, ndl: series('ndl'), nextStopDepth: series('nextStopDepth'), po2: series('po2'), cns: series('cns') });
        for (const f of assessed.findings) fired.set(f.rule, (fired.get(f.rule) ?? 0) + 1);
        console.log(`${file}: max ${recording.maxDepthM} m, every ${assessed.sampleIntervalS} s →`, assessed.findings.map((f) => `${f.rule} (${f.severity}) ${JSON.stringify(f.values)}`));
      }
    }
    console.log(`Rules fired on ${dives} real dive(s):`, Object.fromEntries(fired), `(limits: ascent ${LIMITS.ascentNoteMMin} m/min)`);
    expect(dives).toBeGreaterThan(0);
  });
});
