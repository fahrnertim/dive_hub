// The Sources of Dive site data (ADR 0021): how an External ID links to its Source, and what it requires.
import { describe, expect, it } from 'vitest';
import { SOURCE_INFO } from '../src/sites/sources.js';

describe('Sources of site data', () => {
  it('links an OpenStreetMap object and asks for its Attribution', () => {
    const osm = SOURCE_INFO.osm;
    expect(osm.link?.('node/123')).toBe('https://www.openstreetmap.org/node/123');
    expect(osm.attribution).toEqual({ text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' });
    expect(osm.license?.name).toBe('ODbL 1.0');
  });

  it('links a Wikidata item and asks for nothing (CC0)', () => {
    expect(SOURCE_INFO.wikidata.link?.('Q2141554')).toBe('https://www.wikidata.org/wiki/Q2141554');
    expect(SOURCE_INFO.wikidata.attribution).toBeNull();
  });

  it('has no page for an SSI site ID', () => {
    expect(SOURCE_INFO.ssi.link).toBeNull();
  });

  it('knows what a valid ID looks like', () => {
    expect(SOURCE_INFO.osm.idPattern.test('way/42')).toBe(true);
    expect(SOURCE_INFO.osm.idPattern.test('42')).toBe(false);
    expect(SOURCE_INFO.wikidata.idPattern.test('Q42')).toBe(true);
    expect(SOURCE_INFO.ssi.idPattern.test('3314')).toBe(true);
    expect(SOURCE_INFO.ssi.idPattern.test('site:3314')).toBe(false);
  });
});
