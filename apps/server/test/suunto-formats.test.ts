// Suunto's files as the Suunto app exports them (ADR 0037): the JSON and the thin FIT of one dive, on hand-made
// fixtures in Suunto's shape. When real exports are in samples/private/suunto (never committed), each dive's JSON and FIT
// are cross-checked against each other.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assessProfile } from '../src/assessment/rules.js';
import { createFitAdapter } from '../src/fit/fit-adapter.js';
import { computerEventOf } from '../src/imports/computer-events.js';
import { createFileFormats, formatOf } from '../src/imports/formats.js';
import type { ParsedRecording } from '../src/imports/parsed-recording.js';
import { createSuuntoJsonAdapter, looksLikeSuuntoJson } from '../src/suunto/suunto-json.js';
import { decoModelFromSuunto, diveModeFromSuunto, diveModeFromSuuntoFit } from '../src/suunto/suunto-vocabulary.js';
import { makeSuuntoAppFit, makeSuuntoJson } from './fixtures/suunto-dive.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';

const json = createSuuntoJsonAdapter();
const fit = createFitAdapter();
const START = new Date('2026-02-10T09:00:00.280Z');
const START_SECOND = Math.floor(START.getTime() / 1000);
const series = (rec: ParsedRecording, channel: string) => rec.series.find((s) => s.channel === channel);
const text = (value: string) => new TextEncoder().encode(value);

describe('recognising file formats by their content', () => {
  const formats = createFileFormats();
  it('tells a FIT file, a Suunto JSON export and anything else apart', () => {
    expect(formatOf(formats, makeSyntheticDive())?.format).toBe('fit');
    expect(formatOf(formats, makeSuuntoAppFit())?.format).toBe('fit');
    expect(formatOf(formats, makeSuuntoJson())?.format).toBe('suunto_json');
    expect(formatOf(formats, text('{"dives": []}'))).toBeUndefined();
    expect(formatOf(formats, text('PK\u0003\u0004'))).toBeUndefined();
  });

  it('accepts a byte order mark and whitespace before the log, and no other JSON', () => {
    expect(looksLikeSuuntoJson(text('\uFEFF {\n  "DeviceLog" : {}}'))).toBe(true);
    expect(looksLikeSuuntoJson(text('[{"DeviceLog":{}}]'))).toBe(false);
    expect(looksLikeSuuntoJson(text('{"Other":1,"DeviceLog":{}}'))).toBe(false);
    expect(looksLikeSuuntoJson(text(''))).toBe(false);
  });

  it('gives every format a media type and a parser name', () => {
    expect(formats.map((f) => [f.format, f.mediaType, f.parser])).toEqual([
      ['fit', 'application/vnd.ant.fit', 'fit-file-parser'], ['suunto_json', 'application/json', 'suunto-json'],
    ]);
  });
});

describe('the Suunto app\'s JSON export', () => {
  it('maps the device, the time with its offset, and the computer\'s own summary', async () => {
    const [rec] = await json.parse(makeSuuntoJson());
    expect(rec!.device).toEqual({ manufacturer: 'suunto', serialNumber: '111122223333', product: 'Suunto D5', firmware: '3.0.1' });
    expect(rec!.recordingKey).toBe(`suunto:111122223333:${START_SECOND}`);
    expect(rec!.startsAt.toISOString()).toBe(START.toISOString());
    expect(rec!.utcOffsetSeconds).toBe(3600);
    expect(rec!.utcOffsetSource).toBe('device');
    expect(rec!.durationSeconds).toBe(1800);
    expect(rec!.maxDepthM).toBeCloseTo(21.49, 2);
    expect(rec!.avgDepthM).toBeGreaterThan(10);
    expect(rec!.entryPosition).toBeUndefined();
    expect(rec!.summary).toMatchObject({
      diveMode: 'open_circuit', decoModel: 'suunto_fused2_rgbm', conservatism: 1, surfacePressureBar: 1.013,
      gases: [{ o2: 32, he: 0, tankVolumeL: 12, startPressureBar: 200.4, endPressureBar: 50.1 }],
      surfaceIntervalSeconds: 7200, cnsStart: 1.2, cnsEnd: 8.7, otuStart: 3, otuEnd: 21.3, sacLpm: 17.5,
    });
  });

  it('keeps Suunto\'s number in a series out of the dive number', async () => {
    const [rec] = await json.parse(makeSuuntoJson());
    expect(rec!.summary.diveNumber).toBeUndefined();
    expect(rec!.summary.extras).toEqual({ 'Diving.NumberInSeries': '1' });
  });

  it('converts the samples from SI units: depth, °C, seconds, bar', async () => {
    const [rec] = await json.parse(makeSuuntoJson());
    expect(rec!.series.map((s) => s.channel).sort()).toEqual(['ceiling', 'depth', 'ndl', 'tankPressure', 'temperature', 'tts']);
    const depth = series(rec!, 'depth')!;
    expect(depth.values).toHaveLength(181);
    expect(depth.offsetsMs.slice(0, 3)).toEqual([500, 10500, 20500]);
    expect(series(rec!, 'temperature')!.values[0]).toBeCloseTo(19, 1);
    expect(Math.min(...series(rec!, 'ndl')!.values)).toBe(480);
    const pressure = series(rec!, 'tankPressure')!;
    expect(pressure.values[0]).toBeCloseTo(199.96, 1);
    expect(pressure.values.at(-1)).toBeCloseTo(50, 1);
    expect(rec!.summary.minTemperatureC).toBeCloseTo(18, 0);
  });

  it('leaves out pressures a transmitter sent after the dive', async () => {
    const log = JSON.parse(new TextDecoder().decode(makeSuuntoJson())) as { DeviceLog: { Samples: Record<string, unknown>[] } };
    log.DeviceLog.Samples.push({ Cylinders: [{ GasNumber: 1, Pressure: 4_000_000 }], Depth: 0, TimeISO8601: '2026-02-10T10:35:00.000+01:00' });
    const [rec] = await json.parse(text(JSON.stringify(log)));
    expect(series(rec!, 'tankPressure')!.values).toHaveLength(181);
    expect(series(rec!, 'depth')!.values).toHaveLength(182);
  });

  it('has no tank pressure, tank size or SAC without a pod', async () => {
    const [rec] = await json.parse(makeSuuntoJson({ tankPod: false, oxygen: 0.21 }));
    expect(series(rec!, 'tankPressure')).toBeUndefined();
    expect(rec!.summary.gases).toEqual([{ o2: 21, he: 0 }]);
    expect(rec!.summary.sacLpm).toBeUndefined();
  });

  it('stores every event and gives the computer\'s own notes our words', async () => {
    const [rec] = await json.parse(makeSuuntoJson());
    expect(rec!.events[0]).toEqual({ offsetMs: 0, type: 'gas_switch', data: { gasNumber: 1 } });
    expect(rec!.events.filter((e) => e.type === 'suunto_state')).toHaveLength(4);
    const noted = rec!.events.flatMap((e) => { const event = computerEventOf(e.type, e.data); return event ? [event] : []; });
    // The safety stop switched on twice: once is the computer noting it. Notices ahead, penalties and states have no word.
    expect(noted).toEqual([
      'ascent_critical', 'safety_stop_mandatory', 'deep_stop_started', 'deep_stop_broken', 'safety_stop_started', 'tank_pressure_low',
    ]);
  });

  it('names the FIT key of the same dive as the one it replaces', async () => {
    const [fromJson] = await json.parse(makeSuuntoJson());
    const [fromFit] = await fit.parse(makeSuuntoAppFit());
    expect(fromJson!.replacesKey).toBe(fromFit!.recordingKey);
  });

  it('keeps a time without an offset as wall-clock time, and a log without a serial without a Device', async () => {
    const log = JSON.parse(new TextDecoder().decode(makeSuuntoJson({ serialNumber: null }))) as { DeviceLog: { Header: { DateTime: string }; Samples: { TimeISO8601: string }[] } };
    const bare = (iso: string) => iso.replace(/[+-]\d\d:\d\d$/, '');
    log.DeviceLog.Header.DateTime = bare(log.DeviceLog.Header.DateTime);
    for (const s of log.DeviceLog.Samples) s.TimeISO8601 = bare(s.TimeISO8601);
    const [rec] = await json.parse(text(JSON.stringify(log)));
    expect(rec!.device).toBeUndefined();
    expect(rec!.recordingKey).toMatch(/^suunto:json:\d+:1800:\d+$/);
    expect(rec!.utcOffsetSource).toBe('unknown');
    expect(rec!.utcOffsetSeconds).toBeUndefined();
    expect(rec!.startsAt.toISOString()).toBe('2026-02-10T10:00:00.280Z');
    expect(series(rec!, 'depth')!.offsetsMs[0]).toBe(500);
  });

  it('holds no dive when the log has no depth, and refuses what is not a log', async () => {
    expect(await json.parse(text('{"DeviceLog":{"Header":{"DateTime":"2026-02-10T10:00:00+01:00","Duration":600},"Samples":[{"HR":1.2,"TimeISO8601":"2026-02-10T10:00:01+01:00"}]}}'))).toEqual([]);
    await expect(json.parse(text('{"DeviceLog": 5'))).rejects.toThrow(/not valid JSON/);
    await expect(json.parse(text('{"dives": []}'))).rejects.toThrow(/Not a Suunto JSON/);
  });

  it('keeps values without a word of ours as extras', async () => {
    const log = JSON.parse(new TextDecoder().decode(makeSuuntoJson())) as { DeviceLog: { Header: { Diving: Record<string, unknown> } } };
    Object.assign(log.DeviceLog.Header.Diving, { Algorithm: 'Bühlmann 16 GF', DiveMode: 'Sidemount' });
    const [rec] = await json.parse(text(JSON.stringify(log)));
    expect(rec!.summary.decoModel).toBeUndefined();
    expect(rec!.summary.diveMode).toBeUndefined();
    expect(rec!.summary.extras).toMatchObject({ 'Diving.Algorithm': 'Bühlmann 16 GF', 'Diving.DiveMode': 'Sidemount' });
  });
});

describe('the Suunto app\'s FIT export (a dialect of FIT)', () => {
  it('reads the summary from the session and has no Device', async () => {
    const [rec] = await fit.parse(makeSuuntoAppFit());
    expect(rec!.device).toBeUndefined();
    expect(rec!.recordingKey).toBe(`suunto:fit:${START_SECOND}:1800:${Math.round(rec!.maxDepthM! * 100)}`);
    expect(rec!.fullerCopyLike).toBe(`suunto:%:${START_SECOND}`);
    expect(rec!.startsAt.toISOString()).toBe('2026-02-10T09:00:00.000Z');
    expect(rec!.utcOffsetSeconds).toBe(3600);
    expect(rec!.durationSeconds).toBe(1800);
    expect(rec!.summary).toMatchObject({
      diveMode: 'open_circuit', gases: [{ o2: 32, he: 0 }], surfaceIntervalSeconds: 7200, cnsEnd: 9, otuEnd: 21,
    });
    expect(rec!.summary.diveNumber).toBeUndefined();
    expect(rec!.summary.extras).toEqual({ 'session.dive_number': '1' });
    expect(rec!.series.map((s) => s.channel).sort()).toEqual(['depth', 'temperature']);
  });

  it('takes the computer\'s maximum depth, not the deepest sample', async () => {
    const [rec] = await fit.parse(makeSuuntoAppFit());
    const deepest = Math.max(...series(rec!, 'depth')!.values);
    expect(rec!.maxDepthM).toBeCloseTo(deepest + 0.09, 2);
    expect(rec!.avgDepthM).toBeGreaterThan(10);
  });

  it('is a subset of the JSON of the same dive', async () => {
    const [fromFit] = await fit.parse(makeSuuntoAppFit());
    const [fromJson] = await json.parse(makeSuuntoJson());
    expect(fromFit!.maxDepthM).toBeCloseTo(fromJson!.maxDepthM!, 2);
    expect(fromFit!.avgDepthM).toBeCloseTo(fromJson!.avgDepthM!, 2);
    expect(fromFit!.durationSeconds).toBe(fromJson!.durationSeconds);
    const a = series(fromFit!, 'depth')!;
    const b = series(fromJson!, 'depth')!;
    expect(a.values).toHaveLength(b.values.length - 1);
    a.values.forEach((v, i) => expect(v).toBeCloseTo(b.values[i]!, 2));
  });

  it('leaves a Garmin file as it was: its own key, dive number and Device', async () => {
    const [rec] = await fit.parse(makeSyntheticDive());
    expect(rec!.recordingKey).toMatch(/^garmin:1234567890:/);
    expect(rec!.fullerCopyLike).toBeUndefined();
    expect(rec!.summary.diveNumber).toBe(42);
  });
});

describe('Suunto\'s vocabulary', () => {
  it('maps dive modes and models, and nothing it does not know', () => {
    expect(['Air', 'Nitrox', 'Mixed', 'Gauge', 'Free', 'CCR'].map(diveModeFromSuunto)).toEqual(['open_circuit', 'open_circuit', 'open_circuit', 'gauge', 'apnea', 'ccr']);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(diveModeFromSuuntoFit)).toEqual([
      undefined, 'gauge', 'apnea', 'open_circuit', 'open_circuit', 'open_circuit', 'ccr', 'open_circuit', 'open_circuit', 'ccr', 'ccr', undefined,
    ]);
    expect(decoModelFromSuunto('Suunto Fused2 RGBM')).toBe('suunto_fused2_rgbm');
    expect(decoModelFromSuunto('Suunto Fused RGBM')).toBe('suunto_fused_rgbm');
    expect(decoModelFromSuunto('constructor')).toBeUndefined();
    expect(diveModeFromSuunto(undefined)).toBeUndefined();
  });

  it('takes an event only when the computer switched it on', () => {
    expect(computerEventOf('suunto_alarm', { name: 'Ascent Speed', active: true })).toBe('ascent_critical');
    expect(computerEventOf('suunto_alarm', { name: 'Ascent Speed', active: false })).toBeUndefined();
    expect(computerEventOf('suunto_alarm', { name: 'Violated Deep Stop', active: true })).toBe('deep_stop_broken');
    expect(computerEventOf('suunto_warning', { name: 'PO2 High', active: true })).toBe('po2_high');
    expect(computerEventOf('suunto_notify', { name: 'Safety Stop', active: true, repeat: true })).toBeUndefined();
    expect(computerEventOf('suunto_notify', { name: 'Tank Pressure', active: true })).toBeUndefined();
    expect(computerEventOf('suunto_state', { name: 'Dive Active', active: true })).toBeUndefined();
    // Garmin's alerts still go through the same door.
    expect(computerEventOf('dive_alert', { data: 17 })).toBe('ascent_critical');
  });
});

describe('the dive assessment on Suunto\'s 10 s samples', () => {
  const assess = async (data: Uint8Array) => {
    const [rec] = await json.parse(data);
    return assessProfile({ depth: series(rec!, 'depth')!, ndl: series(rec!, 'ndl'), nextStopDepth: series(rec!, 'ceiling') });
  };

  it('finds nothing on a clean dive and reports the interval', async () => {
    const a = await assess(makeSuuntoJson());
    expect(a.findings.map((f) => f.rule)).toEqual([]);
    expect(a.sampleIntervalS).toBe(10);
    expect(a.enteredDeco).toBe(false);
  });

  it('finds a fast ascent and a missing safety stop', async () => {
    // 25 m for 20 minutes, then straight up at 20 m/min.
    const a = await assess(makeSuuntoJson({ durationSeconds: 1395, waypoints: [[0, 1.3], [2, 25], [22, 25], [23.25, 0.2]] }));
    expect(a.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(['ascent_rate', 'safety_stop']));
  });

  it('reads the lowest no-decompression time, and a ceiling once it reached zero', async () => {
    expect((await assess(makeSuuntoJson({ minNoDecTime: 120 }))).findings.map((f) => f.rule)).toContain('ndl');
    const deco = await assess(makeSuuntoJson({ minNoDecTime: 0, durationSeconds: 1500, waypoints: [[0, 1.3], [2, 30], [20, 30], [23, 1], [25, 1]] }));
    expect(deco.enteredDeco).toBe(true);
    expect(deco.findings.map((f) => f.rule)).toContain('ceiling');
  });
});

const privateDir = fileURLToPath(new URL('../../../samples/private/suunto/', import.meta.url));
const names = existsSync(privateDir) ? readdirSync(privateDir) : [];
const privateJsons = names.filter((n) => n.toLowerCase().endsWith('.json'));
const privateFits = names.filter((n) => n.toLowerCase().endsWith('.fit'));

describe.skipIf(privateJsons.length + privateFits.length === 0)('Suunto adapters on private samples (samples/private/suunto, not committed)', () => {
  it.each(privateJsons)('%s reads as one dive with a Device, a profile and sane values', async (name) => {
    const [rec] = await json.parse(readFileSync(privateDir + name));
    expect(rec).toBeDefined();
    expect(rec!.device?.serialNumber).toBeTruthy();
    expect(rec!.maxDepthM).toBeGreaterThan(1);
    const depth = series(rec!, 'depth')!;
    expect(depth.values.length).toBeGreaterThan(20);
    expect(Math.max(...depth.values)).toBeLessThanOrEqual(rec!.maxDepthM! + 0.01);
    for (const t of series(rec!, 'temperature')?.values ?? []) expect(t).toBeGreaterThan(-3), expect(t).toBeLessThan(40);
    for (const p of series(rec!, 'tankPressure')?.values ?? []) expect(p).toBeGreaterThan(0), expect(p).toBeLessThan(350);
    const assessed = assessProfile({ depth, ndl: series(rec!, 'ndl'), nextStopDepth: series(rec!, 'ceiling') });
    const noted = rec!.events.flatMap((e) => computerEventOf(e.type, e.data) ?? []);
    console.log(`${name}: ${depth.values.length} samples every ${assessed.sampleIntervalS} s; channels ${rec!.series.map((s) => s.channel).join(', ')}; ` +
      `findings ${assessed.findings.map((f) => f.rule).join(', ') || 'none'}; computer events ${noted.join(', ') || 'none'}; extras ${JSON.stringify(rec!.summary.extras ?? {})}`);
  });

  it.each(privateFits)('%s reads as one dive and agrees with its JSON when that is here', async (name) => {
    const [fromFit] = await fit.parse(readFileSync(privateDir + name));
    expect(fromFit).toBeDefined();
    expect(fromFit!.summary.diveMode).toBeDefined();
    const jsonName = privateJsons.find((n) => n.replace(/\.json$/i, '') === name.replace(/\.fit$/i, ''));
    if (!jsonName) return;
    const [fromJson] = await json.parse(readFileSync(privateDir + jsonName));
    if (!fromFit!.device) expect(fromJson!.replacesKey).toBe(fromFit!.recordingKey);
    expect(fromFit!.utcOffsetSeconds).toBe(fromJson!.utcOffsetSeconds);
    expect(fromFit!.maxDepthM).toBeCloseTo(fromJson!.maxDepthM!, 2);
    expect(fromFit!.avgDepthM).toBeCloseTo(fromJson!.avgDepthM!, 2);
    expect(fromFit!.summary.gases?.map((g) => g.o2)).toEqual(fromJson!.summary.gases?.map((g) => g.o2));
    expect(fromFit!.summary.cnsEnd).toBeCloseTo(fromJson!.summary.cnsEnd!, 0);
    const a = series(fromFit!, 'depth')!.values;
    const b = series(fromJson!, 'depth')!.values;
    expect(b.length - a.length).toBeLessThanOrEqual(1);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 2));
  });
});
