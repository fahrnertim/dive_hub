// Dive sites (ADR 0020): positions, distances and countries as the User reads them.
import { describe, expect, it } from 'vitest';
import { countryName, countryOptions, formatDistance, formatPosition, mapsUrl } from '../src/lib/geo.ts';

const plain = (s: string) => s.replace(/[  ]/g, ' ');
const EN = { north: 'N', south: 'S', east: 'E', west: 'W' };
const DE = { north: 'N', south: 'S', east: 'O', west: 'W' };

describe('position', () => {
  it('shows degrees with four decimals (about 10 m) and the hemisphere, in the UI language', () => {
    expect(plain(formatPosition({ latitude: 28.495, longitude: 34.516 }, 'en', EN))).toBe('28.4950° N, 34.5160° E');
    expect(plain(formatPosition({ latitude: -8.51213, longitude: -115.01234 }, 'en', EN))).toBe('8.5121° S, 115.0123° W');
    expect(plain(formatPosition({ latitude: 47.9, longitude: 13.55 }, 'de', DE))).toBe('47,9000° N, 13,5500° O');
  });

  it('links to the place on OpenStreetMap', () => {
    expect(mapsUrl({ latitude: 28.495, longitude: -34.516 }))
      .toBe('https://www.openstreetmap.org/?mlat=28.49500&mlon=-34.51600#map=16/28.49500/-34.51600');
  });
});

describe('distance', () => {
  it('shows metres, and kilometres from 1 km on', () => {
    expect(plain(formatDistance(120.4, 'metric', 'en'))).toBe('120 m');
    expect(plain(formatDistance(1530, 'metric', 'en'))).toBe('1.5 km');
    expect(plain(formatDistance(1530, 'metric', 'de'))).toBe('1,5 km');
  });

  it('shows feet, and miles from a tenth of a mile on, for imperial', () => {
    expect(plain(formatDistance(30.48, 'imperial', 'en'))).toBe('100 ft');
    expect(plain(formatDistance(1609.344, 'imperial', 'en'))).toBe('1 mi');
    expect(plain(formatDistance(2414, 'imperial', 'en'))).toBe('1.5 mi');
  });
});

describe('country', () => {
  it('names a country in the UI language', () => {
    expect(countryName('EG', 'en')).toBe('Egypt');
    expect(countryName('EG', 'de')).toBe('Ägypten');
  });

  it('offers every current country once, sorted by name, without groups or retired codes', () => {
    const options = countryOptions('de');
    const ids = options.map((o) => o.id);
    expect(ids).toContain('EG');
    expect(ids).toContain('AT');
    for (const notACountry of ['EU', 'UN', 'EZ', 'QO', 'ZZ', 'XA', 'BU', 'YU', 'SU']) expect(ids).not.toContain(notACountry);
    expect(new Set(ids).size).toBe(ids.length);
    expect(options.length).toBeGreaterThan(240);
    const names = options.map((o) => o.label);
    expect(names).toEqual([...names].sort(new Intl.Collator('de').compare));
  });
});
