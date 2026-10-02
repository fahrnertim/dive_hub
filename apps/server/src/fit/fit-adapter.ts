// FIT parsing behind our own interface (ADR 0006): the published image uses fit-file-parser (MIT);
// Garmin's official SDK is only used in tests to cross-check results.
import FitParser from 'fit-file-parser';
import type { RecordingSummary } from '../db/schema.js';

export interface ParsedDevice {
  manufacturer: string;
  product?: string;
  serialNumber: string;
  firmware?: string;
}

export interface ParsedSeries {
  channel: string;
  /** Offsets from the Recording start, in milliseconds. */
  offsetsMs: number[];
  values: number[];
}

export interface ParsedEvent {
  offsetMs: number;
  type: string;
  data: Record<string, unknown>;
}

export interface ParsedRecording {
  device: ParsedDevice | undefined;
  /** Identity for re-imports, stable across copies of the same file. */
  recordingKey: string;
  startsAt: Date;
  utcOffsetSeconds: number | undefined;
  durationSeconds: number;
  maxDepthM: number | undefined;
  avgDepthM: number | undefined;
  summary: RecordingSummary;
  series: ParsedSeries[];
  events: ParsedEvent[];
}

export interface FitAdapter {
  readonly parser: string;
  readonly parserVersion: string;
  /** Returns the dives in a FIT file; an empty list when the file holds no dive. */
  parse(data: Uint8Array): Promise<ParsedRecording[]>;
}

/** FIT files start with a header whose bytes 8–11 are ".FIT". */
export function looksLikeFit(data: Uint8Array): boolean {
  return (
    data.length >= 14 &&
    data[8] === 0x2e &&
    data[9] === 0x46 &&
    data[10] === 0x49 &&
    data[11] === 0x54
  );
}

const GARMIN_PRODUCTS: Record<number, string> = {
  4222: 'Descent Mk3',
};

/** Record fields copied into Sample series: FIT field name → channel name. Units after parser conversion. */
const RECORD_CHANNELS: Record<string, string> = {
  depth: 'depth', // m
  temperature: 'temperature', // °C
  heart_rate: 'heartRate', // bpm
  po2: 'po2', // bar
  ndl_time: 'ndl', // s
  cns_load: 'cns', // %
  n2_load: 'n2', // %
  time_to_surface: 'tts', // s
  next_stop_depth: 'nextStopDepth', // m
  next_stop_time: 'nextStopTime', // s
  ascent_rate: 'ascentRate', // m/s
};

type FitMessage = Record<string, unknown>;
type FitMessages = Record<string, FitMessage[] | undefined>;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const date = (v: unknown): Date | undefined => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : undefined);

function parseWithFitFileParser(data: Uint8Array): Promise<{ messages: FitMessages }> {
  const parser = new FitParser({
    force: true,
    mode: 'list',
    lengthUnit: 'm',
    temperatureUnit: 'celsius',
    speedUnit: 'm/s',
  });
  return new Promise((resolve, reject) => {
    parser.parse(Buffer.from(data), (error, result) => {
      if (error) reject(new Error(String(error)));
      else resolve(result as unknown as { messages: FitMessages });
    });
  });
}

export function createFitAdapter(): FitAdapter {
  return {
    parser: 'fit-file-parser',
    parserVersion: '6.1.2',
    async parse(data) {
      if (!looksLikeFit(data)) throw new Error('Not a FIT file');
      const { messages } = await parseWithFitFileParser(data);
      const recording = toRecording(messages);
      return recording ? [recording] : [];
    },
  };
}

function toRecording(m: FitMessages): ParsedRecording | undefined {
  const session = m.session?.[0];
  const sport = str(session?.sport) ?? str(m.sport?.[0]?.sport);
  if (!session || sport !== 'diving') return undefined;

  const startsAt = date(session.start_time);
  if (!startsAt) throw new Error('Dive session has no start time');

  const fileId = m.file_id?.[0] ?? {};
  const creator = m.device_info?.find((d) => d.device_index === 'creator') ?? m.device_info?.[0] ?? {};
  const serial = num(fileId.serial_number) ?? num(creator.serial_number);
  const manufacturer = str(fileId.manufacturer) ?? str(creator.manufacturer) ?? 'unknown';
  const productId = num(fileId.product) ?? num(creator.product);
  const firmware = num(creator.software_version);
  const device: ParsedDevice | undefined =
    serial === undefined
      ? undefined
      : {
          manufacturer,
          serialNumber: String(serial),
          ...(productId !== undefined && {
            product: (manufacturer === 'garmin' && GARMIN_PRODUCTS[productId]) || String(productId),
          }),
          ...(firmware !== undefined && { firmware: String(firmware) }),
        };

  // Local offset = activity.local_timestamp − activity.timestamp (the parser returns both as Dates).
  const activity = m.activity?.[0];
  const local = date(activity?.local_timestamp);
  const utc = date(activity?.timestamp);
  const utcOffsetSeconds = local && utc ? Math.round((local.getTime() - utc.getTime()) / 1000) : undefined;

  // Garmin writes one dive_summary for the session and one per lap; the session one is complete.
  const diveSummary =
    m.dive_summary?.find((s) => s.reference_mesg === 'session') ?? m.dive_summary?.[0] ?? {};
  const settings = m.dive_settings?.[0] ?? {};

  const records = m.record ?? [];
  const start = startsAt.getTime();
  const series = Object.entries(RECORD_CHANNELS)
    .map(([field, channel]): ParsedSeries => {
      const offsetsMs: number[] = [];
      const values: number[] = [];
      for (const r of records) {
        const t = date(r.timestamp);
        const v = num(r[field]);
        if (t && v !== undefined) {
          offsetsMs.push(t.getTime() - start);
          values.push(v);
        }
      }
      return { channel, offsetsMs, values };
    })
    .filter((s) => s.values.length > 0);

  const depths = series.find((s) => s.channel === 'depth')?.values ?? [];
  const temps = series.find((s) => s.channel === 'temperature')?.values ?? [];

  const events: ParsedEvent[] = (m.event ?? []).flatMap((e) => {
    const t = date(e.timestamp);
    const type = str(e.event);
    if (!t || !type) return [];
    return [{
      offsetMs: t.getTime() - start,
      type,
      data: { eventType: e.event_type, data: e.data },
    }];
  });

  const summary: RecordingSummary = stripUndefined({
    diveNumber: num(diveSummary.dive_number),
    diveMode: str(session.sub_sport),
    decoModel: str(settings.model),
    gfLow: num(settings.gf_low),
    gfHigh: num(settings.gf_high),
    waterType: str(settings.water_type),
    waterDensity: num(settings.water_density),
    gases: (m.dive_gas ?? [])
      .filter((g) => g.status !== 'disabled')
      .map((g) => stripUndefined({ o2: num(g.oxygen_content) ?? 21, he: num(g.helium_content) ?? 0, mode: str(g.mode) })),
    minTemperatureC: num(session.min_temperature) ?? (temps.length ? Math.min(...temps) : undefined),
    maxTemperatureC: num(session.max_temperature) ?? (temps.length ? Math.max(...temps) : undefined),
    avgHeartRate: num(session.avg_heart_rate),
    surfaceIntervalSeconds: num(diveSummary.surface_interval),
    cnsStart: num(diveSummary.start_cns),
    cnsEnd: num(diveSummary.end_cns),
    n2Start: num(diveSummary.start_n2),
    n2End: num(diveSummary.end_n2),
    avgAscentRateMps: num(diveSummary.avg_ascent_rate),
    hasEndPosition: session.end_position_lat !== undefined,
  });

  return {
    device,
    recordingKey: device
      ? `${device.manufacturer}:${device.serialNumber}:${start / 1000}`
      : `fit:${manufacturer}:${start / 1000}`,
    startsAt,
    utcOffsetSeconds,
    durationSeconds: num(session.total_elapsed_time) ?? (records.length ? (series[0]?.offsetsMs.at(-1) ?? 0) / 1000 : 0),
    maxDepthM: num(diveSummary.max_depth) ?? (depths.length ? Math.max(...depths) : undefined),
    avgDepthM: num(diveSummary.avg_depth),
    summary,
    series,
    events,
  };
}

/** Optional properties whose value may be undefined become truly optional (exactOptionalPropertyTypes). */
type WithoutUndefined<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

function stripUndefined<T extends Record<string, unknown>>(o: T): WithoutUndefined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as WithoutUndefined<T>;
}
