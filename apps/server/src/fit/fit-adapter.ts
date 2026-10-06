// FIT parsing behind our own interface (ADR 0006): the published image uses fit-file-parser (MIT);
// Garmin's official SDK is only used in tests to cross-check results.
// One format, two dialects (ADR 0037): Garmin's own files, and the Suunto app's export, which has no dive_summary,
// dive_settings or serial number and keeps its summary in `session` and developer fields.
import FitParser from 'fit-file-parser';
import type { RecordingSummary } from '../db/schema.js';
import { stripUndefined, type ParsedDevice, type ParsedEvent, type ParsedRecording, type ParsedSeries, type Position } from '../imports/parsed-recording.js';
import { suuntoFitKey } from '../suunto/suunto-json.js';
import { diveModeFromSuuntoFit } from '../suunto/suunto-vocabulary.js';
import { circuitFromFit, decoModelFromFit, diveModeFromFit, waterTypeFromFit } from './fit-vocabulary.js';

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
/** A position from a FIT lat/long pair; the parser already converted semicircles to degrees. */
const position = (lat: unknown, long: unknown): Position | undefined => {
  const latitude = num(lat);
  const longitude = num(long);
  if (latitude === undefined || longitude === undefined || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { latitude, longitude };
};
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
  const product = (manufacturer === 'garmin' && productId !== undefined && GARMIN_PRODUCTS[productId])
    || str(fileId.product_name) || (productId !== undefined ? String(productId) : undefined);
  const device: ParsedDevice | undefined =
    serial === undefined
      ? undefined
      : {
          manufacturer,
          serialNumber: String(serial),
          ...(product !== undefined && { product }),
          ...(firmware !== undefined && { firmware: String(firmware) }),
        };
  const suunto = manufacturer === 'suunto';

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

  // Source values without a word in our vocabulary are kept as extras, not dropped or guessed.
  const extras: Record<string, string> = {};
  const mapped = <T>(field: string, raw: string | undefined, map: (v: string | undefined) => T | undefined) => {
    const value = map(raw);
    if (raw !== undefined && value === undefined) extras[field] = raw;
    return value;
  };

  // Suunto's developer field `dive_mode` stands where Garmin writes a sub-sport.
  const suuntoMode = suunto ? num(session.dive_mode) : undefined;
  const diveMode = suuntoMode === undefined
    ? mapped('sub_sport', str(session.sub_sport), diveModeFromFit)
    : mapped('dive_mode', String(suuntoMode), () => diveModeFromSuuntoFit(suuntoMode));
  // Suunto counts dives within a series, starting at 1 again: not a logbook number (ADR 0037).
  const inSeries = suunto ? num(session.dive_number) ?? num(session.dive_number_in_series) : undefined;
  if (inSeries !== undefined) extras['session.dive_number'] = String(inSeries);
  // Without a dive_summary (Suunto), the session carries the dive's own summary values.
  const summarised = (field: string) => num(diveSummary[field]) ?? num(session[field]);

  const summary: RecordingSummary = stripUndefined({
    diveNumber: suunto ? undefined : num(diveSummary.dive_number),
    diveMode,
    decoModel: mapped('dive_settings.model', str(settings.model), decoModelFromFit),
    gfLow: num(settings.gf_low),
    gfHigh: num(settings.gf_high),
    waterType: mapped('dive_settings.water_type', str(settings.water_type), waterTypeFromFit),
    waterDensity: num(settings.water_density),
    gases: (m.dive_gas ?? [])
      .filter((g) => g.status !== 'disabled')
      .map((g) => stripUndefined({
        o2: num(g.oxygen_content) ?? 21, he: num(g.helium_content) ?? 0,
        circuit: mapped('dive_gas.mode', str(g.mode), circuitFromFit),
      })),
    minTemperatureC: num(session.min_temperature) ?? (temps.length ? Math.min(...temps) : undefined),
    maxTemperatureC: num(session.max_temperature) ?? (temps.length ? Math.max(...temps) : undefined),
    avgHeartRate: num(session.avg_heart_rate),
    surfaceIntervalSeconds: summarised('surface_interval'),
    cnsStart: summarised('start_cns'),
    cnsEnd: summarised('end_cns'),
    n2Start: summarised('start_n2'),
    n2End: summarised('end_n2'),
    // FIT's `o2_toxicity` is the oxygen dose in OTU.
    otuEnd: summarised('o2_toxicity'),
    avgAscentRateMps: num(diveSummary.avg_ascent_rate),
  });
  if (Object.keys(extras).length > 0) summary.extras = extras;

  const durationSeconds = num(session.total_elapsed_time) ?? (records.length ? (series[0]?.offsetsMs.at(-1) ?? 0) / 1000 : 0);
  // The computer's own maximum can lie between two samples. Suunto repeats it as a float developer field that the parser
  // lets win over the native one: back to the centimetres it was written with.
  const sessionMax = num(session.max_depth);
  const maxDepthM = num(diveSummary.max_depth) ?? (sessionMax !== undefined ? Math.round(sessionMax * 1000) / 1000 : undefined)
    ?? (depths.length ? Math.max(...depths) : undefined);
  // A Suunto FIT without a serial number: the app's JSON export of the same dive has one, and the same start second,
  // duration and maximum depth (ADR 0037).
  const suuntoWithoutDevice = suunto && !device;
  return {
    device,
    recordingKey: device
      ? `${device.manufacturer}:${device.serialNumber}:${start / 1000}`
      : suuntoWithoutDevice ? suuntoFitKey(start / 1000, durationSeconds, maxDepthM) : `fit:${manufacturer}:${start / 1000}`,
    ...(suuntoWithoutDevice && { fullerCopyLike: `suunto:%:${start / 1000}` }),
    startsAt,
    utcOffsetSeconds,
    durationSeconds,
    maxDepthM,
    avgDepthM: summarised('avg_depth'),
    entryPosition: position(session.start_position_lat, session.start_position_long),
    exitPosition: position(session.end_position_lat, session.end_position_long),
    summary,
    series,
    events,
  };
}
