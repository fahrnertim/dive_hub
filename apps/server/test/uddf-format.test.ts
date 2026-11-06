// UDDF files (ADR 0003: a lenient reader) and the Oceanic+ app's dialect of them (docs/references/oceanic-plus.md), on
// hand-made fixtures and on one derived from a real export (samples/README.md). When real exports are in
// samples/private/oceanic-plus (never committed), each is read too.
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
const exported = readFileSync(new URL('../../web/e2e/fixtures/oceanic-plus.uddf', import.meta.url));

describe('reading XML', () => {
  it('reads elements, attributes, text, entities, CDATA and comments, without namespace prefixes', () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><u:a x="1" y=\'&amp;2\'><b>t &lt; &#65;&#x42;</b><![CDATA[<raw>]]><c/></u:a>');
    expect(root.name).toBe('a');
    expect(root.attributes).toEqual({ x: '1', y: '&2' });
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(root.children[0]!.text).toBe('t < AB');
    expect(root.text).toBe('<raw>');
  });

  it('refuses a document nested too deeply or with too many elements', () => {
    expect(() => parseXml(`${'<a>'.repeat(65)}${'</a>'.repeat(65)}`)).toThrow(/nested too deeply/);
    expect(() => parseXml(`<a>${'<b/>'.repeat(11)}</a>`, { maxElements: 10 })).toThrow(/too many elements/);
    expect(parseXml(`<a>${'<b/>'.repeat(9)}</a>`, { maxElements: 10 }).children).toHaveLength(9);
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

describe('an Oceanic+ export, anonymised from a real one (apps/web/e2e/fixtures/oceanic-plus.uddf)', () => {
  it('holds two nitrox dives, an air dive and a breath-hold session, at the offset +00:02 read as two hours', async () => {
    const recs = await uddf.parse(exported);
    expect(recs.map((r) => [r.startsAt.toISOString(), r.utcOffsetSeconds, r.durationSeconds, r.maxDepthM, r.summary.diveMode])).toEqual([
      ['2021-08-12T10:31:25.000Z', 7200, 2317, 7.357322, 'open_circuit'],
      ['2021-08-12T09:07:57.000Z', 7200, 2113, 19.635355, 'open_circuit'],
      ['2021-04-21T13:27:47.000Z', 7200, 2830, 13.867274, 'open_circuit'],
      ['2021-04-19T11:29:37.000Z', 7200, 2242, 3.5979068, 'apnea'],
    ]);
    expect(recs.every((r) => /^oceanicplus:[0-9a-f]{24}$/.test(r.recordingKey))).toBe(true);
  });

  it('reads each tank\'s mix, and the mix a dive starts on is no gas switch', async () => {
    const recs = await uddf.parse(exported);
    expect(recs.map((r) => r.summary.gases?.map((g) => g.o2))).toEqual([[32], [31], [21], undefined]);
    expect(recs.flatMap((r) => r.events)).toEqual([]);
  });

  it('gives a dive without tankdata no gas, even when its starting switchmix names one', async () => {
    const [rec] = await uddf.parse(makeOceanicPlusUddf([{
      id: '6a1f00c0ffee00000000f00d',
      local: '2026-03-15T09:00:00.000',
      offset: '-00:04',
      waypoints: [[0, 0, undefined], [15, 8.5, 300.15], [30, 1.0, 300.15]],
      greatestDepth: 8.5,
      duration: 30,
      lowestTemperature: 300.15,
      tankData: false,
    }]));
    expect(rec!.summary.diveMode).toBe('open_circuit');
    expect(rec!.summary.gases).toBeUndefined();
    expect(rec!.events).toEqual([]);
  });

  it('drops a tank\'s pressures when start and end are the same (the app\'s 220/220 default, not a reading)', async () => {
    const [, defaulted] = await uddf.parse(exported);
    expect(defaulted!.summary.gases).toEqual([{ o2: 31, he: 0 }]);
    const read = await uddf.parse(text(new TextDecoder().decode(exported).replace('<tankpressureend>2.2E7', '<tankpressureend>5.5E6')));
    expect(read[1]!.summary.gases).toEqual([{ o2: 31, he: 0, startPressureBar: 220, endPressureBar: 55 }]);
  });

  it('keeps no profile for a breath-hold session: its two waypoints are made up', async () => {
    const recs = await uddf.parse(exported);
    expect(recs[3]!.series).toEqual([]);
    expect(recs[3]!.summary).toMatchObject({ minTemperatureC: 24.1 });
    expect(series(recs[0]!, 'depth')?.values.length).toBeGreaterThan(40);
  });

  it('keeps notes and lead as extras; a rating or lead of 0 is no value', async () => {
    const recs = await uddf.parse(exported);
    expect(recs.map((r) => r.summary.extras)).toEqual([
      { generator: 'Oceanic+ 0.0.1' },
      { generator: 'Oceanic+ 0.0.1', leadKg: '6' },
      { generator: 'Oceanic+ 0.0.1', leadKg: '10', notes: expect.stringMatching(/^Lorem ipsum/) },
      { generator: 'Oceanic+ 0.0.1' },
    ]);
  });

  it('takes positions from the sites and never their names, which are ids', async () => {
    const recs = await uddf.parse(exported);
    expect(recs.map((r) => r.entryPosition && [Math.round(r.entryPosition.latitude), Math.round(r.entryPosition.longitude)])).toEqual([[50, 8], [50, 8], [27, 34], [27, 34]]);
    expect(JSON.stringify(recs)).not.toMatch(/site_/);
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

  it('reads the pressures of the dive\'s own tanks only, and of at most a few without tank data', async () => {
    const declared = await uddf.parse(text(new TextDecoder().decode(file).replace('<tankpressure ref="t1">18000000</tankpressure>', '<tankpressure ref="t1">18000000</tankpressure><tankpressure ref="other">1000000</tankpressure>')));
    expect(declared[0]!.series.filter((s) => s.channel.startsWith('tankPressure')).map((s) => s.channel)).toEqual(['tankPressure']);
    const waypoints = Array.from({ length: 50 }, (_, n) => `<waypoint><divetime>${n}</divetime><depth>1</depth><tankpressure ref="r${n}">10000000</tankpressure></waypoint>`).join('');
    const [many] = await uddf.parse(text(`<uddf><profiledata><repetitiongroup><dive><informationbeforedive><datetime>2026-05-02T09:30:00Z</datetime></informationbeforedive><samples>${waypoints}</samples></dive></repetitiongroup></profiledata></uddf>`));
    expect(many!.series.filter((s) => s.channel.startsWith('tankPressure'))).toHaveLength(8);
  });

  it('keeps the same start and end pressure and a two-waypoint profile: the Oceanic+ defaults are its own', async () => {
    const source = new TextDecoder().decode(file).replace('<tankpressureend>5000000', '<tankpressureend>20000000')
      .replace(/<waypoint><divetime>120<\/divetime>.*?<\/waypoint>/, '');
    const [rec] = await uddf.parse(text(source));
    expect(rec!.summary.gases).toMatchObject([{ startPressureBar: 200, endPressureBar: 200 }]);
    expect(series(rec!, 'depth')?.values).toEqual([0, 18.5]);
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

// The owner's export, when it is there (samples/README.md): 14 scuba dives and 4 breath-hold sessions, all at +02:00.
const privateDir = fileURLToPath(new URL('../../../samples/private/oceanic-plus', import.meta.url));
const privateFiles = existsSync(privateDir) ? readdirSync(privateDir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.uddf$/i.test(f)) : [];
describe.skipIf(privateFiles.length === 0)('real Oceanic+ exports in samples/private', () => {
  it.each(privateFiles)('%s', async (name) => {
    const recs = await uddf.parse(readFileSync(`${privateDir}/${name}`));
    expect(recs.map((r) => r.summary.diveMode).sort()).toEqual([...Array(4).fill('apnea'), ...Array(14).fill('open_circuit')]);
    for (const rec of recs) {
      expect(rec.recordingKey).toMatch(/^oceanicplus:/);
      expect(rec.utcOffsetSeconds).toBe(7200);
      expect(rec.events).toEqual([]);
      expect(rec.maxDepthM).toBeLessThan(200);
      if (rec.summary.diveMode === 'apnea') expect(rec.series).toEqual([]);
      else expect(series(rec, 'depth')?.values.length).toBeGreaterThan(2);
      expect(rec.summary.gases?.every((g) => g.startPressureBar !== g.endPressureBar || g.startPressureBar === undefined) ?? true).toBe(true);
    }
    expect(JSON.stringify(recs)).not.toMatch(/site_/);
  });
});
