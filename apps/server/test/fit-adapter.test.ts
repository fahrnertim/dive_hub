import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Decoder, Stream } from '@garmin/fitsdk';
import { describe, expect, it } from 'vitest';
import { createFitAdapter, looksLikeFit, type ParsedRecording } from '../src/fit/fit-adapter.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
const privateDir = fileURLToPath(new URL('../../../samples/private/', import.meta.url));
const privateFits = existsSync(privateDir)
  ? readdirSync(privateDir).filter((f) => f.toLowerCase().endsWith('.fit'))
  : [];

const adapter = createFitAdapter();

/** Decode with Garmin's official SDK (test-only) for cross-checking. */
function decodeOfficial(data: Uint8Array) {
  const { messages, errors } = new Decoder(Stream.fromByteArray(Array.from(data))).read();
  expect(errors).toEqual([]);
  return messages;
}

function crossCheck(data: Uint8Array, rec: ParsedRecording) {
  const official = decodeOfficial(data);
  const session = official.sessionMesgs![0]!;
  const summary = official.diveSummaryMesgs!.find((s) => s.referenceMesg === 'session')!;
  expect(rec.startsAt.toISOString()).toBe((session.startTime as Date).toISOString());
  expect(rec.durationSeconds).toBeCloseTo(session.totalElapsedTime as number, 3);
  expect(rec.maxDepthM).toBeCloseTo(summary.maxDepth as number, 3);
  expect(rec.summary.diveNumber).toBe(summary.diveNumber);
  const depth = rec.series.find((s) => s.channel === 'depth')!;
  const officialDepths = official.recordMesgs!.filter((r) => r.depth !== undefined);
  expect(depth.values.length).toBe(officialDepths.length);
  expect(depth.values.at(-1)).toBeCloseTo(officialDepths.at(-1)!.depth as number, 3);
}

describe('looksLikeFit', () => {
  it('accepts a FIT header and rejects other bytes', () => {
    expect(looksLikeFit(fixture('synthetic-dive.fit'))).toBe(true);
    expect(looksLikeFit(new TextEncoder().encode('PK\u0003\u0004 not a fit file'))).toBe(false);
  });
});

describe('FIT adapter on the synthetic dive', () => {
  it('maps device, time, depth and summary', async () => {
    const [rec] = await adapter.parse(fixture('synthetic-dive.fit'));
    expect(rec).toBeDefined();
    expect(rec!.device).toEqual({
      manufacturer: 'garmin', serialNumber: '1234567890', product: 'Descent Mk3', firmware: '27.19',
    });
    expect(rec!.recordingKey).toBe(`garmin:1234567890:${Date.parse('2026-01-15T09:00:00Z') / 1000}`);
    expect(rec!.startsAt.toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(rec!.utcOffsetSeconds).toBe(7200);
    expect(rec!.durationSeconds).toBe(1800);
    expect(rec!.maxDepthM).toBeCloseTo(18.5, 2);
    expect(rec!.summary).toMatchObject({
      diveNumber: 42, decoModel: 'zhl16c', gfLow: 40, gfHigh: 85, waterType: 'salt',
      gases: [{ o2: 32, he: 0 }], cnsEnd: 5,
    });
    const channels = rec!.series.map((s) => s.channel).sort();
    expect(channels).toEqual(['depth', 'heartRate', 'po2', 'temperature']);
    expect(rec!.series.find((s) => s.channel === 'depth')!.offsetsMs.slice(0, 3)).toEqual([0, 2000, 4000]);
    expect(rec!.events.map((e) => e.type)).toEqual(['timer', 'timer']);
  });

  it('agrees with the official Garmin SDK', async () => {
    const data = fixture('synthetic-dive.fit');
    const [rec] = await adapter.parse(data);
    crossCheck(data, rec!);
  });
});

describe.skipIf(privateFits.length === 0)('FIT adapter on private samples (samples/private, not committed)', () => {
  it.each(privateFits)('%s agrees with the official Garmin SDK', async (name) => {
    const data = readFileSync(privateDir + name);
    const [rec] = await adapter.parse(data);
    expect(rec).toBeDefined();
    crossCheck(data, rec!);
  });
});
