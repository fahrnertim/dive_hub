// What a logbook row and its month heading are made of (ADR 0040): the local month, the mixes, the sort choices.
import { describe, expect, it } from 'vitest';
import { mixName, monthGroups, sortChoice, SORT_CHOICES, toggled } from '../src/lib/logbook.ts';
import { formatDiveDay } from '../src/lib/units.ts';

describe('mix names', () => {
  it('names air, nitrox and trimix', () => {
    expect(mixName({ o2: 21, he: 0 }, 'Air')).toBe('Air');
    expect(mixName({ o2: 32, he: 0 }, 'Air')).toBe('EAN32');
    expect(mixName({ o2: 18, he: 45 }, 'Air')).toBe('18/45');
  });
});

describe('month groups', () => {
  const dive = (id: string, startsAt: string, utcOffsetSeconds: number | null) => ({ id, startsAt, utcOffsetSeconds });

  it('puts each Dive under its local month, with the month’s own figures', () => {
    const dives = [
      // 23:30 UTC on 31 March is 1:30 on 1 April at UTC+2.
      dive('a', '2026-03-31T23:30:00.000Z', 7200),
      dive('b', '2026-03-31T10:00:00.000Z', 7200),
      // No offset: the time as stored.
      dive('c', '2026-02-28T23:59:00.000Z', null),
    ];
    const months = [
      { month: '2026-04', dives: 3, durationSeconds: 5400 }, { month: '2026-03', dives: 1, durationSeconds: 1800 },
      { month: '2026-02', dives: 7, durationSeconds: 9000 },
    ];
    expect(monthGroups(dives, months)).toEqual([
      { month: '2026-04', figures: months[0], dives: [dives[0]] },
      { month: '2026-03', figures: months[1], dives: [dives[1]] },
      { month: '2026-02', figures: months[2], dives: [dives[2]] },
    ]);
  });

  it('is one group without a month when the list isn’t sorted by date', () => {
    const dives = [dive('a', '2026-03-31T23:30:00.000Z', 7200), dive('b', '2025-01-01T10:00:00.000Z', 0)];
    expect(monthGroups(dives, [])).toEqual([{ month: null, figures: undefined, dives }]);
  });
});

describe('sort choices', () => {
  it('names what the address sorts by; newest first is the default', () => {
    expect(sortChoice({})).toBe('newest');
    expect(sortChoice({ order: 'asc' })).toBe('oldest');
    expect(sortChoice({ sort: 'maxDepth' })).toBe('deepest');
    expect(sortChoice({ sort: 'duration', order: 'asc' })).toBe('shortest');
    expect(sortChoice({ sort: 'number', order: 'desc' })).toBe('highestNumber');
  });

  it('has a choice for every way the API sorts', () => {
    expect(SORT_CHOICES.map((c) => `${c.sort ?? 'startsAt'} ${c.order ?? 'desc'}`).sort()).toEqual([
      'duration asc', 'duration desc', 'maxDepth asc', 'maxDepth desc', 'number asc', 'number desc', 'startsAt asc', 'startsAt desc',
    ]);
  });
});

describe('pressing a filter', () => {
  it('adds it, and takes it off again', () => {
    expect(toggled(undefined, 'no-site')).toEqual(['no-site']);
    expect(toggled(['no-site', 'with-findings'], 'no-site')).toEqual(['with-findings']);
  });
});

describe('the day of a dive in a row', () => {
  it('is the weekday, the day and the local time; the year only when no month heading says it', () => {
    expect(formatDiveDay('2026-04-02T08:00:00.000Z', 7200, 'en-GB', false, false)).toBe('Thu 2 Apr, 10:00');
    expect(formatDiveDay('2026-04-02T08:00:00.000Z', 7200, 'en-GB', false, true)).toBe('Thu, 2 Apr 2026, 10:00');
    expect(formatDiveDay('2026-04-02T08:00:00.000Z', 7200, 'de-DE', false, false)).toBe('Do., 2. Apr., 10:00');
  });

  it('keeps a time logged without a time zone as it is', () => {
    expect(formatDiveDay('2026-04-02T08:00:00.000Z', null, 'en-GB', true, false)).toBe('Thu 2 Apr, 08:00');
    expect(formatDiveDay('2026-04-02T08:05:00.000Z', null, 'en-US', true, false)).toBe('Thu, Apr 2, 8:05 AM');
  });
});
