// Synthetic Garmin-style dive FIT files with no personal data, built with Garmin's FIT SDK
// (a dev-only dependency, ADR 0006). Running this file writes test/fixtures/synthetic-dive.fit:
//   pnpm tsx test/fixtures/synthetic-dive.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Encoder, Profile, type Mesg } from '@garmin/fitsdk';

export interface SyntheticDiveOptions {
  serialNumber?: number;
  start?: Date;
  durationSeconds?: number;
  maxDepthM?: number;
  diveNumber?: number;
  /** Where the dive started and ended (session start/end position), in degrees. */
  entry?: { latitude: number; longitude: number };
  exit?: { latitude: number; longitude: number };
}

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const UTC_OFFSET_SECONDS = 2 * 3600;
/** FIT stores positions in semicircles: 2^31 of them are 180°. */
const semicircles = (degrees: number) => Math.round((degrees * 2 ** 31) / 180);

export function makeSyntheticDive(options: SyntheticDiveOptions = {}): Uint8Array {
  const serialNumber = options.serialNumber ?? 1234567890;
  const start = options.start ?? new Date('2026-01-15T09:00:00Z');
  const duration = options.durationSeconds ?? 30 * 60;
  const bottom = (options.maxDepthM ?? 18.5) - 0.5;
  const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

  /** Square-ish profile: descent, bottom with slight waves, ascent, safety stop at 5 m. */
  const depthAt = (t: number): number => {
    const f = t / duration;
    if (f < 0.067) return (bottom * f) / 0.067;
    if (f < 0.667) return bottom - 0.5 * Math.sin(t / 60);
    if (f < 0.8) return bottom - ((bottom - 5) * (f - 0.667)) / 0.133;
    if (f < 0.9) return 5;
    return Math.max(0, 5 - (5 * (f - 0.9)) / 0.1);
  };

  const encoder = new Encoder();
  const write = (mesgNum: number | undefined, fields: Record<string, unknown>) => encoder.onMesg(mesgNum!, fields as Mesg);

  write(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'garmin', product: 4222, serialNumber, timeCreated: start });
  write(Profile.MesgNum.DEVICE_INFO, {
    timestamp: start, deviceIndex: 'creator', manufacturer: 'garmin', product: 4222, serialNumber, softwareVersion: 27.19,
  });
  write(Profile.MesgNum.SPORT, { sport: 'diving', subSport: 'singleGasDiving', name: 'Single-Gas' });
  write(Profile.MesgNum.DIVE_SETTINGS, { messageIndex: 0, model: 'zhl16c', gfLow: 40, gfHigh: 85, waterType: 'salt', waterDensity: 1025 });
  write(Profile.MesgNum.DIVE_GAS, { messageIndex: 0, oxygenContent: 32, heliumContent: 0, status: 'enabled', mode: 'openCircuit' });
  write(Profile.MesgNum.EVENT, { timestamp: start, event: 'timer', eventType: 'start' });

  let maxDepth = 0;
  let depthSum = 0;
  let samples = 0;
  for (let t = 0; t <= duration; t += 2) {
    const depth = Math.round(depthAt(t) * 1000) / 1000;
    maxDepth = Math.max(maxDepth, depth);
    depthSum += depth;
    samples++;
    write(Profile.MesgNum.RECORD, { timestamp: at(t), depth, temperature: t < 600 ? 26 : 25, heartRate: 80, po2: 0.32 * (1 + depth / 10) });
  }
  write(Profile.MesgNum.EVENT, { timestamp: at(duration), event: 'timer', eventType: 'stopAll' });

  const summary = {
    timestamp: at(duration), maxDepth, avgDepth: Math.round((depthSum / samples) * 1000) / 1000,
    bottomTime: duration, surfaceInterval: 86_400,
  };
  write(Profile.MesgNum.DIVE_SUMMARY, {
    ...summary, referenceMesg: 'session', referenceIndex: 0, diveNumber: options.diveNumber ?? 42,
    startCns: 0, endCns: 5, startN2: 0, endN2: 40,
  });
  write(Profile.MesgNum.DIVE_SUMMARY, { ...summary, referenceMesg: 'lap', referenceIndex: 0 });
  write(Profile.MesgNum.SESSION, {
    timestamp: at(duration), startTime: start, totalElapsedTime: duration, totalTimerTime: duration,
    sport: 'diving', subSport: 'singleGasDiving', minTemperature: 25, maxTemperature: 26, avgHeartRate: 80,
    messageIndex: 0, firstLapIndex: 0, numLaps: 1, event: 'session', eventType: 'stop',
    ...(options.entry && { startPositionLat: semicircles(options.entry.latitude), startPositionLong: semicircles(options.entry.longitude) }),
    ...(options.exit && { endPositionLat: semicircles(options.exit.latitude), endPositionLong: semicircles(options.exit.longitude) }),
  });
  write(Profile.MesgNum.ACTIVITY, {
    timestamp: at(duration), totalTimerTime: duration, numSessions: 1, type: 'manual', event: 'activity', eventType: 'stop',
    localTimestamp: Math.round((at(duration).getTime() - FIT_EPOCH_MS) / 1000) + UTC_OFFSET_SECONDS,
  });
  return encoder.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = fileURLToPath(new URL('./synthetic-dive.fit', import.meta.url));
  writeFileSync(out, makeSyntheticDive());
  console.log(`wrote ${out}`);
}
