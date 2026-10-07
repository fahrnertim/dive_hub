// The rules of the logbook checks (ADR 0038), pure: which pairs of Dives can't both be right as they stand, and which
// of them an import would have put together by itself.
import { describe, expect, it } from 'vitest';
import { findChecks, probablyNoDive, ruleFor, suggestsDeleting, type CheckedDive, type DeletableDive } from '../src/dives/logbook-check-rules.js';

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

describe('an entry apart from a Recording (rule version 2)', () => {
  // The Egypt dive of the research note: the watch says 08:49, the typed entry 10:55; depth and duration agree.
  const file1 = file('file', '06:49:00', 38, { maxDepthM: 24.1, utcOffsetSeconds: 10800 });
  const entry = (id: string, time: string, minutes: number, depth: number | null) =>
    dive(id, time, minutes, { maxDepthM: depth, utcOffsetSeconds: 10800 });

  it('pairs an entry and a Recording on the same local day whose depth and duration agree', () => {
    expect(ruleFor(entry('entry', '08:55:00', 37, 24.0), file1)).toBe('entry_apart_from_recording');
    expect(ruleFor(file1, entry('entry', '08:55:00', 37, 24.0))).toBe('entry_apart_from_recording');
  });

  it('needs depth within 0.2 m or 3 % (the larger), and duration within 3 minutes', () => {
    expect(ruleFor(entry('e', '08:55:00', 38, 24.3), file1)).toBe('entry_apart_from_recording'); // 0.2 m off
    expect(ruleFor(entry('e', '08:55:00', 38, 24.8), file1)).toBe('entry_apart_from_recording'); // 3 % of 24.8 is 0.74
    expect(ruleFor(entry('e', '08:55:00', 38, 25.2), file1)).toBeNull();
    expect(ruleFor(entry('e', '08:55:00', 41, 24.1), file1)).toBe('entry_apart_from_recording');
    expect(ruleFor(entry('e', '08:55:00', 42, 24.1), file1)).toBeNull();
    expect(ruleFor(entry('e', '08:55:00', 38, null), file1)).toBeNull();
  });

  it('only when exactly one has a Recording, and never beside a pair the first rule finds', () => {
    const second = file('b', '08:55:00', 38, { maxDepthM: 24.1, utcOffsetSeconds: 10800 });
    expect(ruleFor(file('a', '08:55:00', 38, { maxDepthM: 24.1, utcOffsetSeconds: 10800 }), second)).toBe('overlapping_dives');
    expect(ruleFor(file('a', '10:55:00', 38, { maxDepthM: 24.1, utcOffsetSeconds: 10800 }), second)).toBeNull();
    expect(ruleFor(entry('a', '08:55:00', 38, 24.1), entry('b', '10:55:00', 38, 24.1))).toBeNull();
    expect(ruleFor(entry('e', '06:50:00', 38, 24.1), file1)).toBe('recording_beside_entry');
  });

  it('only on the same local day, each by its own offset; a missing offset reads as wall-clock time', () => {
    // 21:30 UTC at +3 is 00:30 the next day: not the file's day.
    expect(ruleFor(entry('e', '21:30:00', 38, 24.1), file1)).toBeNull();
    expect(ruleFor(entry('e', '20:30:00', 38, 24.1), file1)).toBe('entry_apart_from_recording'); // 23:30 local
    const unknown = dive('e', '10:55:00', 38, { maxDepthM: 24.1, utcOffsetSeconds: null, utcOffsetSource: 'unknown' });
    expect(ruleFor(unknown, file1)).toBe('entry_apart_from_recording');
  });

  it('is never obvious, and the nearest start wins, one to one', () => {
    const morning = file('m', '05:00:00', 40, { maxDepthM: 20, utcOffsetSeconds: 10800 });
    const noon = file('n', '09:00:00', 40, { maxDepthM: 20, utcOffsetSeconds: 10800 });
    const typed = entry('typed', '08:00:00', 40, 20); // 11:00 local: the noon file (12:00) is nearer than the morning one (08:00)
    const found = findChecks([morning, noon, typed]).filter((c) => c.rule === 'entry_apart_from_recording');
    expect(found.map((c) => [c.dives.map((d) => d.id).sort(), c.obvious])).toEqual([[['n', 'typed'], false]]);
  });

  it('gives each Dive at most one pair: the farther entry stays unpaired', () => {
    const f = file('f', '08:00:00', 40, { maxDepthM: 20, utcOffsetSeconds: 10800 });
    const near = entry('near', '09:00:00', 40, 20);
    const far = entry('far', '12:00:00', 40, 20);
    const found = findChecks([f, near, far]).filter((c) => c.rule === 'entry_apart_from_recording');
    expect(found.map((c) => c.dives.map((d) => d.id).sort())).toEqual([['f', 'near']]);
  });

  it('a tie gives no suggestion', () => {
    const f = file('f', '08:00:00', 40, { maxDepthM: 20, utcOffsetSeconds: 10800 });
    const before = entry('before', '06:00:00', 40, 20);
    const after = entry('after', '10:00:00', 40, 20);
    expect(findChecks([f, before, after]).filter((c) => c.rule === 'entry_apart_from_recording')).toEqual([]);
  });

  it('finds the research note\'s eleven Egypt pairs when each typed entry is the only one that fits', () => {
    const days = [['06:49', '08:55', 38], ['11:53', '13:10', 47], ['04:29', '06:35', 41]] as const;
    const dives = days.flatMap(([w, s, m], i) => [
      file(`w${i}`, `${w}:00`, m - 1, { maxDepthM: 20 + i * 5, utcOffsetSeconds: 10800, startsAt: new Date(`2023-10-0${i + 1}T${w}:00Z`) }),
      entry(`s${i}`, `${s}:00`, m, 20 + i * 5.1),
    ].map((d, k) => (k === 1 ? { ...d, startsAt: new Date(`2023-10-0${i + 1}T${s}:00Z`) } : d)));
    const found = findChecks(dives).filter((c) => c.rule === 'entry_apart_from_recording');
    expect(found).toHaveLength(3);
  });
});

describe('the checks of a logbook', () => {
  it('finds each pair once, the earlier Dive first, and nothing among dives one after the other', () => {
    const checks = findChecks([
      dive('later', '11:28:00', 42), dive('earlier', '11:13:00', 44), file('morning', '06:00:00', 40, { maxDepthM: 35 }), dive('evening', '17:00:00', 40),
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

  it('never obvious with a probable non-dive in it, which holds up no other pair (rule version 4)', () => {
    // An entry without a depth and a false start of 50 s at 1.8 m: an import asks, so merging in one go must not.
    const falseStart = file('false-start', '08:07:00', 0, { durationSeconds: 50, maxDepthM: 1.8 });
    const [alone] = findChecks([dive('entry', '08:09:00', 40, { maxDepthM: null }), falseStart]);
    expect(alone).toMatchObject({ rule: 'recording_beside_entry', obvious: false });
    // The real Recording beside the same entry stays obvious: the false start is no second partner.
    const both = findChecks([dive('entry', '08:12:00', 40), falseStart, file('real', '08:12:24', 42)]);
    expect(both.filter((c) => c.rule === 'recording_beside_entry').map((c) => [c.dives.map((d) => d.id), c.obvious]))
      .toEqual([[['false-start', 'entry'], false], [['entry', 'real'], true]]);
  });

  it('keeps Divers apart', () => {
    expect(findChecks([dive('mine', '11:13:00', 44), dive('hers', '11:13:00', 44, { diverId: 'lena' })])).toEqual([]);
  });
});

describe('a short and shallow Dive (rule version 3)', () => {
  // The owner's false start: 50 seconds at 1.8 m, the real dive starting five minutes later.
  const falseStart = (more: Partial<DeletableDive> = {}): DeletableDive => ({ ...file('short', '10:58:07', 0, { durationSeconds: 50, maxDepthM: 1.8 }), fromProvider: null, ...more });

  it('is probably no dive: a Recording under 2 minutes that stayed above 3 m', () => {
    expect(probablyNoDive(falseStart())).toBe(true);
    expect(probablyNoDive(falseStart({ durationSeconds: 119, maxDepthM: 2.9 }))).toBe(true);
    expect(probablyNoDive(falseStart({ durationSeconds: 120 }))).toBe(false);
  });

  it('is a real dive when it went deeper, however short: an aborted descent', () => {
    expect(probablyNoDive(falseStart({ durationSeconds: 90, maxDepthM: 12 }))).toBe(false);
    expect(probablyNoDive(falseStart({ maxDepthM: 3 }))).toBe(false);
  });

  it('says nothing without a depth, or about a Dive without a Recording (a typed entry is a typo, not clutter)', () => {
    expect(probablyNoDive(falseStart({ maxDepthM: null }))).toBe(false);
    expect(probablyNoDive(falseStart({ recordings: 0 }))).toBe(false);
  });

  it('suggests deleting it only when it is at no Provider and was not made from an entry', () => {
    expect(suggestsDeleting(falseStart(), false)).toBe(true);
    expect(suggestsDeleting(falseStart(), true)).toBe(false);
    expect(suggestsDeleting(falseStart({ fromProvider: 'ssi' }), false)).toBe(false);
    expect(suggestsDeleting({ ...file('real', '11:04:21', 36, { maxDepthM: 14.5 }), fromProvider: null }, false)).toBe(false);
  });
});
