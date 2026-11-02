// Joining a Dive's parts into one Recording (ADR 0063): the parts' samples end to end on the first part's clock, the
// time between them a Surface break drawn as 0 m depth samples. Pure; the summary values follow the design's table.
import type { RecordingSummary, UtcOffsetSource } from '../../db/schema.js';

export interface PartInput {
  startsAt: Date; durationSeconds: number; maxDepthM: number | null; avgDepthM: number | null;
  utcOffsetSeconds: number | null; utcOffsetSource: UtcOffsetSource;
  entryLatitude: number | null; entryLongitude: number | null; exitLatitude: number | null; exitLongitude: number | null;
  summary: RecordingSummary;
  series: { channel: string; offsetsMs: number[]; values: number[] }[];
  events: { offsetMs: number; type: string; data: Record<string, unknown> }[];
}

export type Joined = Omit<PartInput, 'utcOffsetSeconds' | 'utcOffsetSource'> & Pick<PartInput, 'utcOffsetSeconds' | 'utcOffsetSource'>;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const defined = <T>(values: (T | undefined | null)[]): T[] => values.filter((v): v is T => v !== undefined && v !== null);

function median(values: number[]): number | undefined {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function joinedSummary(parts: PartInput[]): RecordingSummary {
  const first = parts[0]!;
  const last = parts.at(-1)!;
  const temperatures = (key: 'minTemperatureC' | 'maxTemperatureC') => defined(parts.map((p) => p.summary[key]));
  const heartRates = parts.filter((p) => p.summary.avgHeartRate !== undefined);
  const heartSeconds = heartRates.reduce((sum, p) => sum + p.durationSeconds, 0);
  const otuParts = parts.filter((p) => p.summary.otuEnd !== undefined);

  const gases = first.summary.gases?.map((gas, i) => {
    const endPressureBar = last.summary.gases?.[i]?.endPressureBar;
    const { endPressureBar: _end, ...rest } = gas;
    return endPressureBar === undefined ? rest : { ...rest, endPressureBar };
  });

  // SAC, RMV and the computer's ascent rate are device-only values that can't be combined: left out.
  const { sacLpm: _sac, rmvLpm: _rmv, avgAscentRateMps: _ascent, ...fromFirst } = first.summary;
  const summary: RecordingSummary = { ...fromFirst };
  delete summary.gases;
  delete summary.minTemperatureC;
  delete summary.maxTemperatureC;
  delete summary.avgHeartRate;
  delete summary.cnsEnd;
  delete summary.otuEnd;
  delete summary.n2End;
  if (gases) summary.gases = gases;
  if (temperatures('minTemperatureC').length) summary.minTemperatureC = Math.min(...temperatures('minTemperatureC'));
  if (temperatures('maxTemperatureC').length) summary.maxTemperatureC = Math.max(...temperatures('maxTemperatureC'));
  if (heartRates.length) {
    summary.avgHeartRate = Math.round(heartRates.reduce((sum, p) => sum + p.summary.avgHeartRate! * p.durationSeconds, 0) / heartSeconds);
  }
  if (last.summary.cnsEnd !== undefined) summary.cnsEnd = last.summary.cnsEnd;
  if (last.summary.n2End !== undefined) summary.n2End = last.summary.n2End;
  if (otuParts.length) {
    summary.otuEnd = (first.summary.otuStart ?? 0) + otuParts.reduce((sum, p) => sum + (p.summary.otuEnd! - (p.summary.otuStart ?? 0)), 0);
  }
  return summary;
}

/** Parts in any order, at least two: one Recording on the earliest part's clock, a Surface break between each two. */
export function joinParts(parts: PartInput[]): Joined {
  const sorted = [...parts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const shiftMs = (p: PartInput) => p.startsAt.getTime() - first.startsAt.getTime();

  const surfaceBreaks = sorted.slice(1).map((next, i) => ({
    startS: shiftMs(sorted[i]!) / 1000 + sorted[i]!.durationSeconds,
    endS: shiftMs(next) / 1000,
  }));

  const channels = [...new Set(sorted.flatMap((p) => p.series.map((s) => s.channel)))];
  const series = channels.map((channel) => {
    const offsetsMs: number[] = [];
    const values: number[] = [];
    // The break is at 0 m every first-part sample interval, from one interval after the part's last sample to one
    // interval before the next part's first.
    const depthOf = (p: PartInput) => p.series.find((s) => s.channel === 'depth');
    const interval = channel === 'depth' ? median(depthOf(first)?.offsetsMs.slice(1).map((o, i) => o - depthOf(first)!.offsetsMs[i]!) ?? []) : undefined;
    sorted.forEach((part, i) => {
      const s = part.series.find((x) => x.channel === channel);
      if (!s) return;
      const shift = shiftMs(part);
      if (interval && i > 0) {
        const before = values.length ? offsetsMs.at(-1)! : undefined;
        if (before !== undefined && s.offsetsMs.length) {
          for (let o = before + interval; o <= s.offsetsMs[0]! + shift - interval; o += interval) {
            offsetsMs.push(o);
            values.push(0);
          }
        }
      }
      for (let k = 0; k < s.offsetsMs.length; k++) {
        offsetsMs.push(s.offsetsMs[k]! + shift);
        values.push(s.values[k]!);
      }
    });
    return { channel, offsetsMs, values };
  });

  const depthParts = sorted.filter((p) => p.avgDepthM !== null);
  const maxDepths = defined(sorted.map((p) => p.maxDepthM));
  const summary = joinedSummary(sorted);
  summary.surfaceBreaks = surfaceBreaks;

  return {
    startsAt: first.startsAt,
    durationSeconds: shiftMs(last) / 1000 + last.durationSeconds,
    maxDepthM: maxDepths.length ? Math.max(...maxDepths) : null,
    avgDepthM: depthParts.length === sorted.length
      ? round3(sorted.reduce((sum, p) => sum + p.avgDepthM! * p.durationSeconds, 0) / sorted.reduce((sum, p) => sum + p.durationSeconds, 0))
      : null,
    utcOffsetSeconds: first.utcOffsetSeconds,
    utcOffsetSource: first.utcOffsetSource,
    entryLatitude: first.entryLatitude, entryLongitude: first.entryLongitude,
    exitLatitude: last.exitLatitude, exitLongitude: last.exitLongitude,
    summary,
    series,
    events: sorted.flatMap((p) => p.events.map((e) => ({ ...e, offsetMs: e.offsetMs + shiftMs(p) }))),
  };
}
