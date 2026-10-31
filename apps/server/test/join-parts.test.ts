// Joining a Dive's parts into one Recording (ADR 0063): the parts' samples end to end on the first part's clock, the
// surface break between them at 0 m, the summary values as the design's table says.
import { describe, expect, it } from 'vitest';
import { joinParts, type PartInput } from '../src/dives/continuation/join-parts.js';
import { createFitAdapter } from '../src/imports/formats/fit/fit-adapter.js';
import type { ParsedRecording } from '../src/imports/parsed-recording.js';
import { ownersDiveParts } from './fixtures/surface-break-dive.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';

const toPart = (r: ParsedRecording): PartInput => ({
  startsAt: r.startsAt, durationSeconds: r.durationSeconds, maxDepthM: r.maxDepthM ?? null, avgDepthM: r.avgDepthM ?? null,
  utcOffsetSeconds: r.utcOffsetSeconds ?? null, utcOffsetSource: r.utcOffsetSource ?? 'device',
  entryLatitude: r.entryPosition?.latitude ?? null, entryLongitude: r.entryPosition?.longitude ?? null,
  exitLatitude: r.exitPosition?.latitude ?? null, exitLongitude: r.exitPosition?.longitude ?? null,
  summary: r.summary, series: r.series, events: r.events,
});

async function parse(bytes: Uint8Array): Promise<PartInput> {
  const [recording] = await createFitAdapter().parse(bytes);
  return toPart(recording!);
}

async function ownersParts(): Promise<[PartInput, PartInput]> {
  const { first, second } = ownersDiveParts();
  return [await parse(first), await parse(second)];
}

const channel = (parts: ReturnType<typeof joinParts>, name: string) => parts.series.find((s) => s.channel === name)!;

describe('joining parts', () => {
  it("joins the owner's dive into one profile with the break at 0 m", async () => {
    const [first, second] = await ownersParts();
    const joined = joinParts([second, first]);
    expect(joined.startsAt).toEqual(new Date('2026-10-26T06:05:49Z'));
    expect(joined.durationSeconds).toBe(2951);
    expect(joined.maxDepthM).toBe(7.9);
    expect(joined.summary.surfaceBreaks).toEqual([{ startS: 1180, endS: 1421 }]);
    const depth = channel(joined, 'depth');
    expect(depth.offsetsMs).toHaveLength(1476);
    expect(depth.values).toHaveLength(1476);
    const inBreak = depth.offsetsMs.flatMap((o, i) => (o >= 1_182_000 && o <= 1_418_000 ? [depth.values[i]!] : []));
    expect(inBreak).toHaveLength(119);
    expect(inBreak.every((v) => v === 0)).toBe(true);
    expect(depth.values[depth.offsetsMs.indexOf(1_421_000)]).toBe(1.9);
  });

  it('leaves other channels without samples in the break', async () => {
    const joined = joinParts(await ownersParts());
    const temperature = channel(joined, 'temperature');
    expect(temperature.offsetsMs.some((o) => o > 1_180_000 && o < 1_421_000)).toBe(false);
    expect(temperature.offsetsMs).toHaveLength(591 + 766);
  });

  it('averages depth over the time under water only', async () => {
    const [first, second] = await ownersParts();
    const expected = Math.round(((first.avgDepthM! * 1180 + second.avgDepthM! * 1530) / 2710) * 1000) / 1000;
    expect(joinParts([first, second]).avgDepthM).toBe(expected);
    expect(joinParts([first, { ...second, avgDepthM: null }]).avgDepthM).toBeNull();
  });

  it("takes summary values as the design's table says", async () => {
    const [first, second] = await ownersParts();
    const a: PartInput = {
      ...first,
      entryLatitude: 1, entryLongitude: 2, exitLatitude: 3, exitLongitude: 4,
      summary: {
        minTemperatureC: 20, maxTemperatureC: 26, cnsStart: 1, cnsEnd: 4, otuStart: 10, otuEnd: 15, n2Start: 5, n2End: 30,
        gases: [{ o2: 32, he: 0, startPressureBar: 200, endPressureBar: 120 }, { o2: 50, he: 0 }],
        diveMode: 'openCircuit' as never, decoModel: 'zhl16c' as never, gfLow: 40, gfHigh: 85, waterType: 'salt' as never,
        waterDensity: 1025, conservatism: 1, surfacePressureBar: 1.01, diveNumber: 85, surfaceIntervalSeconds: 3600,
        extras: { a: 'first' }, sacLpm: 15, rmvLpm: 16, avgAscentRateMps: 0.1, avgHeartRate: 60,
      },
    };
    const b: PartInput = {
      ...second,
      entryLatitude: 5, entryLongitude: 6, exitLatitude: 7, exitLongitude: 8,
      summary: {
        minTemperatureC: 18, maxTemperatureC: 24, cnsStart: 4, cnsEnd: 9, otuStart: 15, otuEnd: 22, n2Start: 30, n2End: 45,
        gases: [{ o2: 32, he: 0, startPressureBar: 120, endPressureBar: 60 }, { o2: 50, he: 0 }],
        diveMode: 'closedCircuit' as never, gfLow: 30, diveNumber: 86, surfaceIntervalSeconds: 241, extras: { a: 'second' },
        sacLpm: 20, rmvLpm: 21, avgAscentRateMps: 0.2, avgHeartRate: 90,
      },
    };
    const { summary, entryLatitude, entryLongitude, exitLatitude, exitLongitude } = joinParts([a, b]);
    expect(summary).toMatchObject({
      minTemperatureC: 18, maxTemperatureC: 26, cnsStart: 1, cnsEnd: 9, otuStart: 10, otuEnd: 10 + 5 + 7, n2Start: 5, n2End: 45,
      diveMode: 'openCircuit', decoModel: 'zhl16c', gfLow: 40, gfHigh: 85, waterType: 'salt', waterDensity: 1025,
      conservatism: 1, surfacePressureBar: 1.01, diveNumber: 85, surfaceIntervalSeconds: 3600, extras: { a: 'first' },
      avgHeartRate: Math.round((60 * 1180 + 90 * 1530) / 2710),
    });
    expect(summary.gases).toEqual([
      { o2: 32, he: 0, startPressureBar: 200, endPressureBar: 60 }, { o2: 50, he: 0 },
    ]);
    expect(summary).not.toHaveProperty('sacLpm');
    expect(summary).not.toHaveProperty('rmvLpm');
    expect(summary).not.toHaveProperty('avgAscentRateMps');
    expect([entryLatitude, entryLongitude, exitLatitude, exitLongitude]).toEqual([1, 2, 7, 8]);
  });

  it('joins three parts with two breaks', async () => {
    const part = (start: string, durationSeconds: number) => parse(makeSyntheticDive({ start: new Date(start), durationSeconds }));
    const [one, two, three] = [
      await part('2026-01-15T09:00:00Z', 600), await part('2026-01-15T09:15:00Z', 600), await part('2026-01-15T09:30:00Z', 300),
    ] as [PartInput, PartInput, PartInput];
    const joined = joinParts([three, one, two]);
    expect(joined.durationSeconds).toBe(2100);
    expect(joined.summary.surfaceBreaks).toEqual([{ startS: 600, endS: 900 }, { startS: 1500, endS: 1800 }]);
    const stops = joined.events.filter((e) => e.type === 'timer' && /stop/i.test(String((e.data as { eventType?: string }).eventType)));
    expect(stops.map((e) => e.offsetMs)).toEqual([600_000, 1_500_000, 2_100_000]);
  });
});
