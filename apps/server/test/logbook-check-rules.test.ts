// The rules of the logbook checks (ADR 0038), pure: which pairs of Dives can't both be right as they stand, and which
// of them an import would have put together by itself.
import { describe, expect, it } from 'vitest';
import { findChecks, ruleFor, type CheckedDive } from '../src/dives/logbook-check-rules.js';

const at = (time: string) => new Date(`2026-03-12T${time}Z`);
const dive = (id: string, time: string, minutes: number, more: Partial<CheckedDive> = {}): CheckedDive => ({
  id, diverId: 'tim', startsAt: at(time), utcOffsetSeconds: 3600, utcOffsetSource: 'device', durationSeconds: minutes * 60,
  maxDepthM: 20, recordings: 0, ...more,
});
const file = (id: string, time: string, minutes: number, more: Partial<CheckedDive> = {}) => dive(id, time, minutes, { recordings: 1, ...more });

describe('the rule two Dives break together', () => {
  it('a Dive without a Recording and one with a Recording at the same time, as an import matches them', () => {
    expect(ruleFor(dive('entry', '08:14:00', 33), file('file', '08:07:15', 34))).toBe('recording_beside_entry');
    // Four minutes after the file's dive ended: inside the import's five minutes.
    expect(ruleFor(dive('entry', '08:45:00', 30), file('file', '08:07:00', 34))).toBe('recording_beside_entry');
    expect(ruleFor(dive('entry', '08:47:00', 30), file('file', '08:07:00', 34))).toBeNull();
  });

  it('two Dives alike only when they really overlap: one after the other is no contradiction', () => {
    expect(ruleFor(dive('a', '11:13:00', 44), dive('b', '11:28:00', 42))).toBe('overlapping_dives');
    expect(ruleFor(dive('a', '11:13:00', 44), dive('b', '11:58:00', 42))).toBeNull();
    expect(ruleFor(file('a', '08:00:00', 30), file('b', '08:00:20', 30))).toBe('overlapping_dives');
    expect(ruleFor(file('a', '08:00:00', 30), file('b', '08:32:00', 30))).toBeNull();
  });

  it('never a Dive with itself, or Dives of two Divers', () => {
    const a = dive('a', '11:13:00', 44);
    expect(ruleFor(a, a)).toBeNull();
    expect(ruleFor(a, dive('b', '11:13:00', 44, { diverId: 'lena' }))).toBeNull();
  });

  it('compares local times where a time zone is unknown', () => {
    // Logged as 09:14 without a zone (kept as if UTC); the file's dive started 09:07 at UTC+1.
    const entry = dive('entry', '09:14:00', 33, { utcOffsetSeconds: null, utcOffsetSource: 'unknown' });
    expect(ruleFor(entry, file('file', '08:07:15', 34))).toBe('recording_beside_entry');
    expect(ruleFor(file('file', '08:07:15', 34), entry)).toBe('recording_beside_entry');
  });
});

describe('the checks of a logbook', () => {
  it('finds each pair once, the earlier Dive first, and nothing among dives one after the other', () => {
    const checks = findChecks([
      dive('later', '11:28:00', 42), dive('earlier', '11:13:00', 44), file('morning', '06:00:00', 40), dive('evening', '17:00:00', 40),
    ]);
    expect(checks.map((c) => [c.rule, c.dives.map((d) => d.id)])).toEqual([['overlapping_dives', ['earlier', 'later']]]);
  });

  it('an entry beside its file is obvious; two entries never are', () => {
    const [mixed] = findChecks([dive('entry', '08:14:00', 33, { maxDepthM: 34 }), file('file', '08:07:15', 34, { maxDepthM: 34.2 })]);
    expect(mixed).toMatchObject({ rule: 'recording_beside_entry', obvious: true });
    const [alike] = findChecks([dive('a', '11:13:00', 44), dive('b', '11:28:00', 42)]);
    expect(alike).toMatchObject({ rule: 'overlapping_dives', obvious: false });
  });

  it('not obvious when the depths disagree, or when a second Dive is in reach', () => {
    const [deep] = findChecks([dive('entry', '08:14:00', 33, { maxDepthM: 18 }), file('file', '08:07:15', 34, { maxDepthM: 34.2 })]);
    expect(deep!.obvious).toBe(false);
    const several = findChecks([dive('one', '08:10:00', 20), dive('two', '08:35:00', 10), file('file', '08:07:15', 40)]);
    expect(several.filter((c) => c.rule === 'recording_beside_entry').map((c) => c.obvious)).toEqual([false, false]);
  });

  it('keeps Divers apart', () => {
    expect(findChecks([dive('mine', '11:13:00', 44), dive('hers', '11:13:00', 44, { diverId: 'lena' })])).toEqual([]);
  });
});
