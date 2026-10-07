import { describe, expect, it } from 'vitest';
import { bandSeconds, clock, counts, formatRate, hidden, shown, stretch, summaryKey, summaryValues, type Finding } from '../src/lib/assessment.ts';
import en from '../src/i18n/locales/en.json' with { type: 'json' };
import de from '../src/i18n/locales/de.json' with { type: 'json' };

const finding = (rule: Finding['rule'], values: Finding['values'], state: Partial<Finding> = {}): Finding => ({
  rule, values, severity: 'note', startSeconds: null, endSeconds: null, evidence: [], sources: [], dismissed: false, muted: false, ...state,
});

describe('a finding\'s sentence', () => {
  it('is chosen by what was found', () => {
    expect(summaryKey(finding('ascent_rate', { stretches: 1 }))).toBe('ascent_rate');
    expect(summaryKey(finding('ascent_rate', { stretches: 3 }))).toBe('ascent_rate_several');
    expect(summaryKey(finding('safety_stop', { seconds: 120, recommended_s: 180, minimum_s: 180 }))).toBe('safety_stop');
    expect(summaryKey(finding('safety_stop', { seconds: 200, recommended_s: 300, minimum_s: 180 }))).toBe('safety_stop_long');
    expect(summaryKey(finding('safety_stop', { seconds: 0, recommended_s: 180, minimum_s: 180 }))).toBe('safety_stop_none');
    expect(summaryKey(finding('ndl', { entered_deco: true }))).toBe('ndl_deco');
    expect(summaryKey(finding('reverse_profile', { reason: 'depth' }))).toBe('reverse_profile_depth');
    expect(summaryKey(finding('sawtooth', {}))).toBe('sawtooth');
  });

  it('exists in both languages for every case, with guidance, a recommendation and a title per rule', () => {
    const rules = ['ascent_rate', 'last_metres', 'safety_stop', 'descent_rate', 'stop_stability', 'ndl', 'ceiling', 'ppo2', 'cns', 'sawtooth',
      'reverse_profile', 'surface_interval', 'dives_per_day', 'deep_days'];
    const summaries = ['ascent_rate', 'ascent_rate_several', 'last_metres', 'safety_stop', 'safety_stop_long', 'safety_stop_none', 'descent_rate', 'stop_stability',
      'ndl', 'ndl_deco', 'ceiling', 'ppo2', 'ppo2_contingency', 'cns', 'sawtooth', 'reverse_profile_difference', 'reverse_profile_depth',
      'reverse_profile_decompression', 'surface_interval', 'dives_per_day', 'deep_days'];
    for (const locale of [en, de]) {
      const a = locale.assessment as unknown as Record<string, Record<string, string>>;
      for (const rule of rules) for (const part of ['title', 'guidance', 'recommendation']) expect(a[part]![rule], `${part}.${rule}`).toBeTruthy();
      for (const key of summaries) expect(a.summary![key], `summary.${key}`).toBeTruthy();
      // The finding's row shows a short sentence under its title; it never addresses the diver, the title said what.
      for (const key of summaries) {
        expect(a.short![key], `short.${key}`).toBeTruthy();
        expect(a.short![key], `short.${key}`).not.toMatch(/^(You|Du|Your|Dein)/);
        expect(a.short![key]!.length, `short.${key}`).toBeLessThan(a.summary![key]!.length);
      }
      // The no-fly time is not a finding: it has texts of its own, one per reason.
      for (const reason of ['title', 'single', 'several', 'decompression', 'guidance']) expect(a.noFly![reason], `noFly.${reason}`).toBeTruthy();
      // The short note stands under every assessment; the full one is a step away and still says all of it.
      expect(a.noteShort, 'noteShort').toBeTruthy();
      expect((a.noteShort as unknown as string).length).toBeLessThan((a.note as unknown as string).length / 2);
    }
  });

  it('gets its numbers in the User\'s units', () => {
    const f = finding('ascent_rate', { max_m_min: 11.2, limit_m_min: 10, seconds: 25, from_depth_m: 14, to_depth_m: 4 });
    expect(summaryValues(f, 'metric', 'en')).toMatchObject({ rate: '11.2 m/min', limit: '10 m/min', from: '14 m', to: '4 m', seconds: '25' });
    expect(summaryValues(f, 'imperial', 'en')).toMatchObject({ rate: '37 ft/min', from: '45.9 ft' });
    expect(summaryValues(f, 'metric', 'de').rate).toBe('11,2 m/min');
    expect(formatRate(18, 'imperial', 'en')).toBe('59 ft/min');
  });
});

describe('what is shown', () => {
  it('keeps dismissed and muted findings apart', () => {
    const all = [finding('ascent_rate', {}), finding('ppo2', {}, { dismissed: true }), finding('sawtooth', {}, { muted: true })];
    expect(shown(all).map((f) => f.rule)).toEqual(['ascent_rate']);
    expect(hidden(all).map((f) => f.rule)).toEqual(['ppo2', 'sawtooth']);
  });

  it('counts what differs from guidance apart from what is for information, without what was put aside', () => {
    const all = [
      finding('ascent_rate', {}), finding('ceiling', {}, { severity: 'caution' }), finding('descent_rate', {}, { severity: 'info' }),
      finding('ppo2', {}, { dismissed: true }), finding('last_metres', {}, { severity: 'info', muted: true }),
    ];
    expect(counts(all)).toEqual({ differ: 2, info: 1 });
    expect(counts([])).toEqual({ differ: 0, info: 0 });
  });
});

describe('the time lane', () => {
  it('places a stretch by its share of the dive, wide enough to hit, and inside the lane', () => {
    expect(stretch(600, 900, 3000)).toEqual({ left: 20, width: 10 });
    expect(stretch(1500, 1500, 3000, 4)).toEqual({ left: 50, width: 4 });
    expect(stretch(2990, 3000, 3000, 4)).toEqual({ left: 96, width: 4 });
    expect(stretch(0, 10, 0)).toEqual({ left: 0, width: 100 });
  });

  it('reads minutes into the dive, and adds up the ascent bands', () => {
    expect(clock(800)).toBe('13:20');
    expect(clock(59)).toBe('0:59');
    expect(bandSeconds([[100, 160, 1], [160, 190, 2], [400, 420, 1], [500, 506, 3]])).toEqual([80, 30, 6]);
  });
});
