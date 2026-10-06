// Hand-made Suunto dives in the shape the Suunto app exports (ADR 0037; docs/references/suunto-formats.md): the JSON
// (`DeviceLog`, SI units) and the thin FIT of the same dive. No personal data and nothing taken from a real file; the FIT
// is built with Garmin's FIT SDK (a dev-only dependency, ADR 0006).
import { Encoder, Profile, type Mesg } from '@garmin/fitsdk';

export interface SuuntoDiveOptions {
  /** The D5's serial number; `null` writes a log without one. */
  serialNumber?: string | null;
  /** The start, to the millisecond as the JSON has it; the FIT cuts it to the second. */
  start?: Date;
  durationSeconds?: number;
  maxDepthM?: number;
  /** Oxygen fraction of the one gas. */
  oxygen?: number;
  utcOffsetMinutes?: number;
  /** Whether a tank pod sent pressures. */
  tankPod?: boolean;
  /** Seconds between samples. */
  sampleInterval?: number;
  /** [minute, metres] waypoints instead of the default profile. */
  waypoints?: [number, number][];
  /** The lowest no-decompression time shown, seconds; 0 puts the dive into decompression with a 3 m ceiling. */
  minNoDecTime?: number;
}

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

function shape(options: SuuntoDiveOptions) {
  const start = options.start ?? new Date('2026-02-10T09:00:00.280Z');
  const duration = options.durationSeconds ?? 30 * 60;
  const interval = options.sampleInterval ?? 10;
  const bottom = (options.maxDepthM ?? 21.4) - 0.3;
  /** Down in two minutes, the bottom with slight waves, up at about 8 m/min, three minutes at 5 m, a slow last stretch. */
  const defaultDepth = (t: number): number => {
    const up = duration - 420 - ((bottom - 5) / 8) * 60;
    if (t < 120) return 1.3 + ((bottom - 1.3) * t) / 120;
    if (t < up) return bottom - 0.3 * Math.sin(t / 60);
    if (t < duration - 420) return bottom - ((bottom - 5) * (t - up)) / (duration - 420 - up);
    if (t < duration - 60) return 5 + 0.1 * Math.sin(t / 20);
    return Math.max(0.2, 5 - (4.8 * (t - (duration - 60))) / 60);
  };
  const along = (t: number): number => {
    const w = options.waypoints!;
    const k = Math.max(1, w.findIndex(([m]) => m * 60 >= t));
    const [m0, d0] = w[k - 1]!;
    const [m1, d1] = w[Math.min(k, w.length - 1)]!;
    return m1 === m0 ? d1 : d0 + ((d1 - d0) * (Math.min(t, m1 * 60) - m0 * 60)) / ((m1 - m0) * 60);
  };
  const depthAt = options.waypoints ? along : defaultDepth;
  const times: number[] = [];
  for (let t = 0.5; t <= duration + 0.6; t += interval) times.push(round(t, 1));
  const depths = times.map((t) => round(depthAt(t), 2));
  // The computer's own maximum lies a little deeper than the deepest sample.
  const maxDepth = round(Math.max(...depths) + 0.09, 2);
  const avgDepth = round(depths.reduce((a, b) => a + b, 0) / depths.length, 2);
  return { start, duration, interval, times, depths, maxDepth, avgDepth, oxygen: options.oxygen ?? 0.32 };
}

/** The Suunto app's JSON export of a D5 dive. */
export function makeSuuntoJson(options: SuuntoDiveOptions = {}): Uint8Array {
  const s = shape(options);
  const offsetMinutes = options.utcOffsetMinutes ?? 60;
  const iso = (seconds: number) => {
    const local = new Date(s.start.getTime() + seconds * 1000 + offsetMinutes * 60_000).toISOString().replace('Z', '');
    const sign = offsetMinutes < 0 ? '-' : '+';
    const abs = Math.abs(offsetMinutes);
    return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  };
  const pod = options.tankPod ?? true;
  const pressureAt = (t: number) => Math.round((200 - (150 * Math.min(t, s.duration)) / s.duration) * 100) * 1000; // Pa
  const minNdl = options.minNoDecTime ?? 480;
  const bottomEnd = s.times[s.depths.indexOf(Math.max(...s.depths))]!;
  const noDecAt = (t: number) => (t < 60 ? 6000 : Math.max(minNdl, Math.round(6000 - ((6000 - minNdl) * Math.min(t, bottomEnd)) / bottomEnd)));

  const values = s.times.map((t, i) => ({
    Ceiling: minNdl === 0 && noDecAt(t) === 0 ? 3 : 0,
    Cylinders: pod ? [{ GasNumber: 1, Pressure: pressureAt(t) }] : undefined,
    Depth: s.depths[i],
    DeviceInternalAbsPressure: i === 0 ? null : 96000,
    GasTime: pod && i > 5 ? 3000 - Math.round(t) : null,
    NoDecTime: noDecAt(t),
    Temperature: round(292.15 - t / 1800, 2),
    TimeToSurface: Math.round(s.depths[i]! * 6),
    Ventilation: pod && i > 5 ? 0.0003 : null,
    TimeISO8601: iso(t),
  }));
  const event = (seconds: number, ...entries: Record<string, unknown>[]) => ({ Events: entries, TimeISO8601: iso(seconds) });
  const state = (Type: string, Active: boolean) => ({ State: { Active, Type } });
  const stop = s.duration - 400;
  const events = [
    event(0, { GasSwitch: { GasNumber: 1 } }, state('Dive Active', true), state('Below Surface', true)),
    event(300.4, { Notify: { Active: true, Type: 'Safety Stop Ahead' } }),
    event(stop - 200.2, { Alarm: { Active: true, Type: 'Ascent Speed' } }, { Warning: { Active: true, Type: 'Mandatory Safety Stop' } }),
    event(stop - 196.3, { Alarm: { Active: false, Type: 'Ascent Speed' } }),
    event(stop - 150.1, { Notify: { Active: true, Type: 'Deep Stop' } }),
    event(stop - 140.6, { Warning: { Active: true, Type: 'Deep Stop Broken' } }, { Warning: { Active: true, Type: 'Deep Stop Penalty' } }),
    event(stop + 0.3, { Notify: { Active: true, Type: 'Safety Stop' } }),
    event(stop + 60.2, { Notify: { Active: false, Type: 'Safety Stop' } }),
    event(stop + 63.7, { Notify: { Active: true, Type: 'Safety Stop' } }),
    event(stop + 200.9, { Warning: { Active: true, Type: 'Tank Pressure' } }),
    event(stop + 240.1, { Notify: { Active: false, Type: 'Safety Stop Ahead' } }, { Notify: { Active: false, Type: 'Safety Stop' } }),
    event(s.duration - 9.6, { Notify: { Active: true, Type: 'NoFly Time' } }, state('Surface Calculation', true), state('Below Surface', false)),
  ];
  // The app writes value samples and event entries in time order, as separate entries.
  const offset = (e: { TimeISO8601: string }) => Date.parse(e.TimeISO8601);
  const samples = [...events, ...values].sort((a, b) => offset(a) - offset(b));

  const device = {
    Info: { BSL: '3.0.1', BatteryAtEnd: 'Charge: 90%, Voltage: 4.1V', BatteryAtStart: 'Charge: 95%, Voltage: 4.2V', HW: '68.6.0', SW: '3.0.1' },
    Name: 'Suunto D5',
    ...(options.serialNumber !== null && { SerialNumber: options.serialNumber ?? '111122223333' }),
  };
  const tissue = (CNS: number, OTU: number) => ({ CNS, Helium: Array(15).fill(0), Nitrogen: Array(15).fill(79000), OLF: CNS, OTU, RgbmHelium: 1, RgbmNitrogen: 1 });
  return new TextEncoder().encode(JSON.stringify({
    DeviceLog: {
      Header: {
        Activity: 'Air/Nitrox', ActivityType: 51, DateTime: iso(0), Depth: { Avg: s.avgDepth, Max: s.maxDepth }, Device: device,
        Diving: {
          Algorithm: 'Suunto Fused2 RGBM', AlgorithmAscentTime: 180, AlgorithmBottomMixture: { Helium: 0, Oxygen: s.oxygen },
          AlgorithmBottomTime: 1200, Altitude: 0, AscentMode: 'Follow ceiling', Conservatism: 1, DaysInSeries: 2, DeepStopEnabled: true,
          DesaturationTime: 40000, DiveMode: s.oxygen > 0.21 ? 'Nitrox' : 'Air', EndTissue: tissue(0.087, 21.26),
          Gases: [{
            Helium: 0, Oxygen: s.oxygen, PO2: 140000, State: 'Primary',
            ...(pod
              ? { EndPressure: 5010000, StartPressure: 20040000, TankFillPressure: 20000000, TankSize: 0.012, TransmitterID: '0000000000' }
              : { EndPressure: 0, StartPressure: 0 }),
          }],
          LastDecoStopDepth: 3, MiniLock: false, NoFlyTime: 3000, NumberInSeries: 1, PreviousDiveDepth: 12, SafetyStopTime: 180,
          StartTissue: tissue(0.012, 3), SurfacePressure: 101300, SurfaceTime: 7200,
        },
        Duration: s.duration, PauseDuration: 10, SampleInterval: s.interval, ...(pod && { Ventilation: { Avg: 0.000291 } }),
      },
      Samples: samples,
      Windows: [],
      Device: device,
    },
  }));
}

/** The Suunto app's FIT export of the same dive: what `makeSuuntoJson` holds, less almost everything. */
export function makeSuuntoAppFit(options: SuuntoDiveOptions = {}): Uint8Array {
  const s = shape(options);
  const start = new Date(Math.floor(s.start.getTime() / 1000) * 1000);
  const at = (seconds: number) => new Date(start.getTime() + Math.floor(seconds) * 1000);
  const end = at(s.duration);

  const developerDataIdMesg = { developerDataIndex: 0, applicationId: Array.from(new TextEncoder().encode('SuuntoFitExport1')) };
  const field = (fieldDefinitionNumber: number, fieldName: string, fitBaseTypeId: number, units?: string) => ({
    developerDataIdMesg,
    fieldDescriptionMesg: { developerDataIndex: 0, fieldDefinitionNumber, fieldName, fitBaseTypeId, ...(units && { units }) },
  });
  const fieldDescriptions = {
    0: field(5, 'max_depth', 136, 'm'), 1: field(6, 'dive_number_in_series', 2), 2: field(7, 'dive_mode', 0), 3: field(8, 'surface_time', 136, 's'),
  };
  const encoder = new Encoder({ fieldDescriptions } as unknown as ConstructorParameters<typeof Encoder>[0]);
  const write = (mesgNum: number | undefined, fields: Record<string, unknown>) => encoder.onMesg(mesgNum!, fields as Mesg);

  // No serial number, no device_info, no sport, dive_settings or dive_summary.
  write(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'suunto', product: 39, productName: 'Suunto D5', timeCreated: end });
  write(Profile.MesgNum.DEVELOPER_DATA_ID, developerDataIdMesg);
  for (const { fieldDescriptionMesg } of Object.values(fieldDescriptions)) write(Profile.MesgNum.FIELD_DESCRIPTION, fieldDescriptionMesg);
  write(Profile.MesgNum.DIVE_GAS, { messageIndex: 0, oxygenContent: Math.round(s.oxygen * 100), heliumContent: 0, status: 'enabled' });
  write(Profile.MesgNum.EVENT, { timestamp: start, event: 'timer', eventType: 'start', data: 0 });
  // Depth and whole degrees every sample; the app leaves the last sample out.
  s.times.slice(0, -1).forEach((t, i) => write(Profile.MesgNum.RECORD, {
    timestamp: at((s.start.getTime() % 1000) / 1000 + t), depth: s.depths[i], temperature: Math.round(19 - t / 1800),
  }));
  write(Profile.MesgNum.EVENT, { timestamp: end, event: 'timer', eventType: 'stop', data: 0 });
  write(Profile.MesgNum.SESSION, {
    timestamp: end, startTime: start, event: 'session', eventType: 'stop', sport: 'diving',
    totalTimerTime: s.duration, totalElapsedTime: s.duration, trainingStressScore: 20, diveNumber: 1, surfaceInterval: 7200,
    endCns: 9, o2Toxicity: 21, avgDepth: s.avgDepth, maxDepth: s.maxDepth,
    developerFields: { 0: s.maxDepth, 1: 1, 2: s.oxygen > 0.21 ? 7 : 3, 3: 7200 },
  });
  write(Profile.MesgNum.ACTIVITY, {
    timestamp: end, numSessions: 1, type: 'manual', event: 'activity', eventType: 'stop',
    localTimestamp: Math.round((end.getTime() - FIT_EPOCH_MS) / 1000) + (options.utcOffsetMinutes ?? 60) * 60,
  });
  return encoder.close();
}
