// UDDF files (ADR 0003: a lenient reader) and the Oceanic+ app's dialect of them (docs/references/oceanic-plus.md), on
// hand-made fixtures. When real exports are in samples/private/oceanic-plus (never committed), each is read too.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFileFormats, formatOf } from '../src/imports/formats.js';
import { ParseError, type ParsedRecording } from '../src/imports/parsed-recording.js';
import { createUddfAdapter, looksLikeUddf } from '../src/imports/formats/uddf/uddf.js';
import { parseXml, XmlError } from '../src/imports/formats/uddf/xml.js';
import { makeOceanicPlusUddf, OCEANIC_DIVES } from './fixtures/oceanic-plus-uddf.js';

const uddf = createUddfAdapter();
const text = (value: string) => new TextEncoder().encode(value);
const series = (rec: ParsedRecording, channel: string) => rec.series.find((s) => s.channel === channel);

describe('reading XML', () => {
  it('reads elements, attributes, text, entities, CDATA and comments, without namespace prefixes', () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><u:a x="1" y=\'&amp;2\'><b>t &lt; &#65;&#x42;</b><![CDATA[<raw>]]><c/></u:a>');
    expect(root.name).toBe('a');
    expect(root.attributes).toEqual({ x: '1', y: '&2' });
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(root.children[0]!.text).toBe('t < AB');
    expect(root.text).toBe('<raw>');
  });

  it('refuses a document type (no entity expansion) and broken markup', () => {
    expect(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')).toThrow(XmlError);
    expect(() => parseXml('<a><b></a>')).toThrow(XmlError);
    expect(() => parseXml('<a>&unknown;</a>')).toThrow(XmlError);
    expect(() => parseXml('<a></a><b></b>')).toThrow(XmlError);
    expect(() => parseXml('')).toThrow(XmlError);
  });
});

describe('recognising UDDF by its content', () => {
  it('takes a document whose root is uddf, with or without a prolog, a namespace prefix or a byte order mark', () => {
    expect(formatOf(createFileFormats(), makeOceanicPlusUddf())?.format).toBe('uddf');
    expect(looksLikeUddf(text('﻿<?xml version="1.0"?>\n<!-- x -->\n<uddf version="3.2.3">'))).toBe(true);
    expect(looksLikeUddf(text('<u:uddf xmlns:u="http://www.streit.cc/uddf/3.2/">'))).toBe(true);
    expect(looksLikeUddf(text('<?xml version="1.0"?><divelog>'))).toBe(false);
    expect(looksLikeUddf(text('<uddfx>'))).toBe(false);
    expect(looksLikeUddf(text('{"DeviceLog": {}}'))).toBe(false);
  });
});

describe('an Oceanic+ logbook export', () => {
  it('holds one Recording per dive, keyed by the app\'s own dive id', async () => {
    const recs = await uddf.parse(makeOceanicPlusUddf());
    expect(recs.map((r) => r.recordingKey)).toEqual(OCEANIC_DIVES.map((d) => `oceanicplus:${d.id}`));
    expect(recs[0]!.device).toBeUndefined();
  });

  it('reads the offset `-00:04` as four hours behind UTC (the app puts the hours in the minutes\' place)', async () => {
    const [rec] = await uddf.parse(makeOceanicPlusUddf());
    expect(rec!.startsAt.toISOString()).toBe('2026-03-14T14:05:20.000Z');
    expect(rec!.utcOffsetSeconds).toBe(-4 * 3600);
    expect(rec!.utcOffsetSource).toBe('device');
  });

  it('reads the profile: decimal times in ms, depth in m, temperature in °C', async () => {
    const [rec] = await uddf.parse(makeOceanicPlusUddf());
    expect(series(rec!, 'depth')).toEqual({ channel: 'depth', offsetsMs: [0, 15000, 30000, 45000, 60000, 75000, 90000], values: [0, 0.4, 3.25, 7.5, 12.4, 8.1, 0.3] });
    expect(series(rec!, 'temperature')?.offsetsMs[0]).toBe(15000);
    expect(series(rec!, 'temperature')?.values).toEqual([27, 26.9, 26.8, 26.7, 26.8, 26.9]);
  });

  it('takes the summary from after the dive and the position from the dive\'s site', async () => {
    const [first, second] = await uddf.parse(makeOceanicPlusUddf());
    expect(first).toMatchObject({ durationSeconds: 85, maxDepthM: 12.4, entryPosition: { latitude: 18.3, longitude: -65.6 }, exitPosition: undefined });
    expect(first!.summary).toMatchObject({ diveMode: 'open_circuit', minTemperatureC: 26.7, gases: [{ o2: 21, he: 0 }] });
    // A rating has no place in a Recording: kept, not dropped.
    expect(first!.summary.extras).toMatchObject({ rating: '8', generator: 'Oceanic+ 0.0.1' });
    expect(second!.entryPosition).toBeUndefined();
  });
});

describe('a UDDF file from another program', () => {
  const file = text(`<?xml version="1.0" encoding="utf-8"?>
<uddf version="3.2.3" xmlns="http://www.streit.cc/uddf/3.2/">
  <generator><name>Some Logbook</name><version>2.1</version></generator>
  <gasdefinitions><mix id="ean32"><o2>0.32</o2><he>0.0</he></mix></gasdefinitions>
  <profiledata><repetitiongroup id="rg1"><dive id="d1">
    <informationbeforedive><divenumber>412</divenumber><datetime>2026-05-02T09:30:00+02:00</datetime>
      <surfaceintervalbeforedive><passedtime>5400</passedtime></surfaceintervalbeforedive></informationbeforedive>
    <tankdata id="t1"><link ref="ean32"/><tankvolume>0.012</tankvolume><tankpressurebegin>20000000</tankpressurebegin><tankpressureend>5000000</tankpressureend></tankdata>
    <samples>
      <waypoint><divetime>0</divetime><depth>0</depth><switchmix ref="ean32"/><tankpressure ref="t1">20000000</tankpressure></waypoint>
      <waypoint><divetime>60</divetime><depth>18.5</depth><nodecotime>1200</nodecotime><calculatedpo2>91000</calculatedpo2><heartrate>88</heartrate><tankpressure ref="t1">18000000</tankpressure></waypoint>
      <waypoint><divetime>120</divetime><depth>0.5</depth></waypoint>
    </samples>
    <informationafterdive><greatestdepth>18.5</greatestdepth><averagedepth>9.2</averagedepth></informationafterdive>
  </dive></repetitiongroup></profiledata>
</uddf>`);

  it('keeps a real offset, keys the dive by when and how deep, and reads tanks and pressures in bar', async () => {
    const [rec] = await uddf.parse(file);
    expect(rec!.startsAt.toISOString()).toBe('2026-05-02T07:30:00.000Z');
    expect(rec!.utcOffsetSeconds).toBe(7200);
    // UDDF ids hold only within one file (ADR 0003): not an identity across files.
    expect(rec!.recordingKey).toBe(`uddf:${Date.parse('2026-05-02T07:30:00Z') / 1000}:120:1850`);
    expect(rec).toMatchObject({ durationSeconds: 120, maxDepthM: 18.5, avgDepthM: 9.2 });
    expect(rec!.summary).toMatchObject({ diveNumber: 412, surfaceIntervalSeconds: 5400, gases: [{ o2: 32, he: 0, tankVolumeL: 12, startPressureBar: 200, endPressureBar: 50 }] });
    expect(series(rec!, 'tankPressure')).toEqual({ channel: 'tankPressure', offsetsMs: [0, 60000], values: [200, 180] });
    expect(series(rec!, 'ndl')?.values).toEqual([1200]);
    expect(series(rec!, 'po2')?.values).toEqual([0.91]);
    expect(series(rec!, 'heartRate')?.values).toEqual([88]);
  });

  it('reads a time without an offset as wall-clock time', async () => {
    const [rec] = await uddf.parse(text(new TextDecoder().decode(file).replace('+02:00', '')));
    expect(rec!.startsAt.toISOString()).toBe('2026-05-02T09:30:00.000Z');
    expect(rec!.utcOffsetSeconds).toBeUndefined();
    expect(rec!.utcOffsetSource).toBe('unknown');
  });
});

describe('UDDF that is not a logbook', () => {
  it('without dives is empty; broken XML or a dive without a time is a ParseError', async () => {
    expect(await uddf.parse(text('<uddf version="3.2.3"><generator/></uddf>'))).toEqual([]);
    await expect(uddf.parse(text('<uddf><profiledata>'))).rejects.toThrow(ParseError);
    await expect(uddf.parse(text('<uddf><profiledata><repetitiongroup><dive><samples/></dive></repetitiongroup></profiledata></uddf>'))).rejects.toThrow(ParseError);
  });
});

// Real exports, when there are any (samples/README.md): each dive has a start, a profile and a plausible depth.
const privateDir = fileURLToPath(new URL('../../../samples/private/oceanic-plus', import.meta.url));
const privateFiles = existsSync(privateDir) ? readdirSync(privateDir).filter((f) => /\.uddf$/i.test(f)) : [];
describe.skipIf(privateFiles.length === 0)('real Oceanic+ exports in samples/private', () => {
  it.each(privateFiles)('%s', async (name) => {
    const recs = await uddf.parse(readFileSync(`${privateDir}/${name}`));
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(rec.recordingKey).toMatch(/^oceanicplus:/);
      expect(series(rec, 'depth')?.values.length).toBeGreaterThan(1);
      expect(rec.maxDepthM).toBeLessThan(200);
    }
  });
});
