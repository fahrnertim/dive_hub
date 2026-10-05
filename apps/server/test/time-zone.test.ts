// Local times without a time zone (ADR 0030): the offset from the position through geo-tz, summer time from the date,
// else the Diver's nearest Dive within 7 days, else unknown. Places where dive sites are: on a coast, at a border, at
// sea. The fallbacks run against PostgreSQL (skipped when it is unreachable).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dive, diver } from '../src/db/schema.js';
import { inZone, offsetIn, placeLocalTime, wallClockMs, zoneAt } from '../src/dives/time-zone.js';
import { createTestDatabase, databaseReachable, type TestDatabase } from './support.js';

const HAUSREEF = { latitude: 27.29, longitude: 33.82 }; // a reef off Hurghada, Egypt
const EILAT = { latitude: 29.5, longitude: 34.92 }; // Israel's coast in the Gulf of Aqaba
const AQABA = { latitude: 29.45, longitude: 34.99 }; // Jordan's, a few kilometres east
const ATTERSEE = { latitude: 47.85, longitude: 13.55 }; // an Austrian lake
const MID_ATLANTIC = { latitude: 30, longitude: -40 };
const local = (text: string) => wallClockMs(text)!;
const hours = (seconds: number | null) => (seconds === null ? null : seconds / 3600);

describe('time zones by position', () => {
  it('reads wall-clock times as SSI keeps them, with or without seconds', () => {
    expect(wallClockMs('2025-08-10 10:05')).toBe(Date.UTC(2025, 7, 10, 10, 5));
    expect(wallClockMs('2025-08-10T10:05:30')).toBe(Date.UTC(2025, 7, 10, 10, 5, 30));
    expect(wallClockMs('10:05')).toBeNull();
  });

  it('finds the zone of a reef off the coast, inside the territorial waters', () => {
    expect(zoneAt(HAUSREEF)).toBe('Africa/Cairo');
    // Egypt keeps summer time again since 2023.
    expect(hours(inZone(local('2025-01-15 10:00'), 'Africa/Cairo').utcOffsetSeconds)).toBe(2);
    expect(hours(inZone(local('2025-07-15 10:00'), 'Africa/Cairo').utcOffsetSeconds)).toBe(3);
  });

  it('tells two countries apart at a border on the water', () => {
    expect(zoneAt(EILAT)).toBe('Asia/Jerusalem');
    expect(zoneAt(AQABA)).toBe('Asia/Amman');
    // In winter they differ by an hour: Israel +2, Jordan +3 all year.
    const winter = local('2025-01-15 10:00');
    expect(hours(inZone(winter, 'Asia/Jerusalem').utcOffsetSeconds)).toBe(2);
    expect(hours(inZone(winter, 'Asia/Amman').utcOffsetSeconds)).toBe(3);
  });

  it('gives the open sea its nautical zone', () => {
    expect(zoneAt(MID_ATLANTIC)).toBe('Etc/GMT+3');
    expect(hours(offsetIn('Etc/GMT+3', new Date('2025-07-01T12:00:00Z')))).toBe(-3);
  });

  it('takes summer time from the date, also on the day it changes', () => {
    expect(zoneAt(ATTERSEE)).toBe('Europe/Vienna');
    expect(inZone(local('2025-07-20 10:00'), 'Europe/Vienna')).toEqual({ startsAt: new Date('2025-07-20T08:00:00Z'), utcOffsetSeconds: 7200 });
    expect(inZone(local('2025-01-20 10:00'), 'Europe/Vienna')).toEqual({ startsAt: new Date('2025-01-20T09:00:00Z'), utcOffsetSeconds: 3600 });
    // 30 March 2025: clocks go from 02:00 to 03:00. A dive at 09:00 that morning is in summer time.
    expect(hours(inZone(local('2025-03-30 09:00'), 'Europe/Vienna').utcOffsetSeconds)).toBe(2);
    // 02:30 never happened that day; it is read as the same moment as 03:30 summer time.
    expect(inZone(local('2025-03-30 02:30'), 'Europe/Vienna').startsAt).toEqual(new Date('2025-03-30T00:30:00Z'));
  });

  it('refuses positions that aren\'t on Earth', () => {
    expect(zoneAt({ latitude: 91, longitude: 0 })).toBeNull();
  });
});

describe.skipIf(!(await databaseReachable()))('time zones from nearby dives (PostgreSQL)', () => {
  let t: TestDatabase;
  let diverId: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    [{ id: diverId }] = await t.db.insert(diver).values({ name: 'Erika' }).returning({ id: diver.id }) as [{ id: string }];
    // A dive in the Maldives (+5) on 10 March, one without a known offset on 11 March, and one deleted on 12 March.
    await t.db.insert(dive).values([
      { diverId, startsAt: new Date('2025-03-10T04:00:00Z'), utcOffsetSeconds: 5 * 3600, durationSeconds: 3000 },
      { diverId, startsAt: new Date('2025-03-11T04:00:00Z'), utcOffsetSeconds: null, durationSeconds: 3000 },
      { diverId, startsAt: new Date('2025-03-12T04:00:00Z'), utcOffsetSeconds: 2 * 3600, durationSeconds: 3000, deletedAt: new Date() },
    ]);
  });
  afterAll(async () => {
    await t?.drop();
  });

  it('uses the position first', async () => {
    expect(await placeLocalTime(t.db, diverId, local('2025-03-12 10:00'), [null, HAUSREEF]))
      .toEqual({ startsAt: new Date('2025-03-12T08:00:00Z'), utcOffsetSeconds: 7200, utcOffsetSource: 'position' });
  });

  it('without a position, takes the offset of the closest Dive within 7 days', async () => {
    expect(await placeLocalTime(t.db, diverId, local('2025-03-12 10:00'), []))
      .toEqual({ startsAt: new Date('2025-03-12T05:00:00Z'), utcOffsetSeconds: 5 * 3600, utcOffsetSource: 'nearby' });
  });

  it('keeps the wall-clock time as if it were UTC when nothing tells the offset', async () => {
    expect(await placeLocalTime(t.db, diverId, local('2025-03-20 10:00'), [null]))
      .toEqual({ startsAt: new Date('2025-03-20T10:00:00Z'), utcOffsetSeconds: null, utcOffsetSource: 'unknown' });
  });
});
