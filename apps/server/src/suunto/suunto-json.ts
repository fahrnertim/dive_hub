// The Suunto app's JSON export of a dive (ADR 0037; docs/references/suunto-formats.md): the computer's own log as
// `{"DeviceLog": {"Header", "Samples", "Device"}}`, in SI units (Pa, K, m³, m³/s, fractions, seconds).
// Read from a Suunto D5's exports; what other models write differently is noted where it is handled.
import type { RecordingSummary, UtcOffsetSource } from '../db/schema.js';
import { stripUndefined, type ParsedDevice, type ParsedEvent, type ParsedRecording, type ParsedSeries } from '../imports/parsed-recording.js';
import { SUUNTO_EVENT_TYPES, decoModelFromSuunto, diveModeFromSuunto } from './suunto-vocabulary.js';

export interface SuuntoJsonAdapter {
  readonly parser: string;
  readonly parserVersion: string;
  /** Returns the dive in a Suunto JSON export; an empty list when the log holds no dive. */
  parse(data: Uint8Array): Promise<ParsedRecording[]>;
}

/** A dive log is tens of kilobytes; anything far larger is not parsed. */
const MAX_BYTES = 32 * 1024 * 1024;
const BOM = [0xef, 0xbb, 0xbf];
const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/** A JSON text whose first member is `DeviceLog`: the log is the object's only member, so it is always first. */
export function looksLikeSuuntoJson(data: Uint8Array): boolean {
  if (data.length > MAX_BYTES) return false;
  let i = BOM.every((b, at) => data[at] === b) ? BOM.length : 0;
  const skipWhitespace = () => { while (i < data.length && WHITESPACE.has(data[i]!)) i++; };
  skipWhitespace();
  if (data[i++] !== 0x7b) return false; // {
  skipWhitespace();
  const key = '"DeviceLog"';
  for (let k = 0; k < key.length; k++) if (data[i++] !== key.charCodeAt(k)) return false;
  skipWhitespace();
  return data[i] === 0x3a; // :
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const scaled = (v: unknown, factor: number, digits: number) => { const n = num(v); return n === undefined ? undefined : round(n * factor, digits); };

const PA_TO_BAR = 1e-5;
const KELVIN = 273.15;

/**
 * An ISO time as Suunto writes it. With an offset it is an instant and the offset is the dive's; with `Z` an instant
 * whose local offset isn't known; with neither a wall-clock time, kept as if UTC (ADR 0030: `unknown`).
 */
function time(value: unknown): { ms: number; utcOffsetSeconds: number | undefined; source: UtcOffsetSource } | undefined {
  const text = str(value);
  if (!text) return undefined;
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(text);
  const zoned = offset !== null || /z$/i.test(text);
  const ms = Date.parse(zoned ? text : `${text}Z`);
  if (Number.isNaN(ms)) return undefined;
  if (!offset) return { ms, utcOffsetSeconds: undefined, source: zoned ? 'device' : 'unknown' };
  const seconds = (Number(offset[2]) * 60 + Number(offset[3])) * 60 * (offset[1] === '-' ? -1 : 1);
  return { ms, utcOffsetSeconds: seconds, source: 'device' };
}

export function createSuuntoJsonAdapter(): SuuntoJsonAdapter {
  return {
    parser: 'suunto-json',
    parserVersion: '1',
    async parse(data) {
      if (!looksLikeSuuntoJson(data)) throw new Error('Not a Suunto JSON export');
      let root: unknown;
      try {
        root = JSON.parse(new TextDecoder('utf-8', { ignoreBOM: false }).decode(data));
      } catch (error) {
        throw new Error(`Suunto JSON export is not valid JSON: ${(error as Error).message}`);
      }
      const log = obj(obj(root)?.DeviceLog);
      if (!log) throw new Error('Suunto JSON export has no DeviceLog');
      const recording = toRecording(log);
      return recording ? [recording] : [];
    },
  };
}

function toRecording(log: Json): ParsedRecording | undefined {
  const header = obj(log.Header) ?? {};
  const samples = list(log.Samples).map(obj).filter((s): s is Json => s !== undefined);
  // The app writes every workout's log this way; one without a depth is not a dive.
  if (!samples.some((s) => num(s.Depth) !== undefined) && !obj(header.Diving)) return undefined;

  const start = time(header.DateTime);
  if (!start) throw new Error('Suunto dive log has no start time');
  const diving = obj(header.Diving) ?? {};
  const offsetOf = (s: Json) => { const t = time(s.TimeISO8601); return t ? t.ms - start.ms : undefined; };

  const duration = num(header.Duration) ?? num(header.DiveTime)
    ?? Math.max(0, ...samples.map((s) => offsetOf(s) ?? 0)) / 1000;

  const info = obj(log.Device) ?? obj(header.Device) ?? {};
  const serial = str(info.SerialNumber) ?? (num(info.SerialNumber) !== undefined ? String(info.SerialNumber) : undefined);
  const device: ParsedDevice | undefined = serial === undefined ? undefined : stripUndefined({
    manufacturer: 'suunto', serialNumber: serial, product: str(info.Name), firmware: str(obj(info.Info)?.SW),
  });

  // Each value sample carries every channel; a channel that is null or absent in a sample has no value there.
  const series: ParsedSeries[] = [];
  const channel = (name: string, read: (s: Json) => number | undefined, keep: (offsetMs: number) => boolean = () => true) => {
    const offsetsMs: number[] = [];
    const values: number[] = [];
    for (const s of samples) {
      const at = offsetOf(s);
      const value = read(s);
      if (at === undefined || value === undefined || !keep(at)) continue;
      offsetsMs.push(at);
      values.push(value);
    }
    if (values.length > 0) series.push({ channel: name, offsetsMs, values });
  };
  channel('depth', (s) => num(s.Depth));
  channel('temperature', (s) => { const k = num(s.Temperature); return k === undefined ? undefined : round(k - KELVIN, 1); });
  // −1 marks "no value"; 0 is the moment the dive needs decompression stops.
  channel('ndl', (s) => { const v = num(s.NoDecTime); return v === undefined || v < 0 ? undefined : v; });
  channel('tts', (s) => num(s.TimeToSurface));
  channel('ceiling', (s) => num(s.Ceiling));
  // A transmitter keeps sending after surfacing: readings later than one sample interval past the end are not the dive's.
  const interval = num(header.SampleInterval) ?? 10;
  const duringDive = (offsetMs: number) => offsetMs <= (duration + interval) * 1000;
  const gasNumbers = [...new Set(samples.flatMap((s) => list(s.Cylinders).map((c) => num(obj(c)?.GasNumber) ?? 1)))].sort((a, b) => a - b);
  gasNumbers.forEach((gasNumber, index) => channel(
    index === 0 ? 'tankPressure' : `tankPressure:${gasNumber}`,
    (s) => scaled(list(s.Cylinders).map(obj).find((c) => (num(c?.GasNumber) ?? 1) === gasNumber)?.Pressure, PA_TO_BAR, 2),
    duringDive,
  ));

  // A D5 writes `Events`, an Ocean `DiveEvents` (docs/references/suunto-formats.md).
  const seen = new Set<string>();
  const events: ParsedEvent[] = samples.flatMap((s) => {
    const at = offsetOf(s);
    if (at === undefined) return [];
    return [...list(s.Events), ...list(s.DiveEvents)].flatMap((entry): ParsedEvent[] => {
      const e = obj(entry) ?? {};
      const gasSwitch = obj(e.GasSwitch);
      if (gasSwitch) return [{ offsetMs: at, type: 'gas_switch', data: stripUndefined({ gasNumber: num(gasSwitch.GasNumber) }) }];
      for (const [kind, type] of Object.entries(SUUNTO_EVENT_TYPES)) {
        const detail = obj(e[kind]);
        const name = str(detail?.Type);
        if (!detail || !name) continue;
        const active = detail.Active !== false;
        // A notice for a stop the diver drifts in and out of switches on again and again: only the first is the computer
        // noting it. Alarms and warnings count every time.
        const repeat = kind === 'Notify' && active && seen.has(`${type}:${name}`);
        if (active) seen.add(`${type}:${name}`);
        return [{ offsetMs: at, type, data: { name, active, ...(repeat && { repeat }) } }];
      }
      return [];
    });
  });

  // Source values without a word in our vocabulary are kept as extras, not dropped or guessed.
  const extras: Record<string, string> = {};
  const mapped = <T>(field: string, raw: string | undefined, map: (v: string | undefined) => T | undefined) => {
    const value = map(raw);
    if (raw !== undefined && value === undefined) extras[field] = raw;
    return value;
  };
  // Suunto counts dives within a series of repetitive dives, starting at 1 again: not a logbook number (ADR 0037).
  const inSeries = num(diving.NumberInSeries);
  if (inSeries !== undefined) extras['Diving.NumberInSeries'] = String(inSeries);

  const temps = series.find((s) => s.channel === 'temperature')?.values ?? [];
  const depths = series.find((s) => s.channel === 'depth')?.values ?? [];
  const startTissue = obj(diving.StartTissue) ?? {};
  const endTissue = obj(diving.EndTissue) ?? {};
  const summary: RecordingSummary = stripUndefined({
    diveMode: mapped('Diving.DiveMode', str(diving.DiveMode), diveModeFromSuunto),
    decoModel: mapped('Diving.Algorithm', str(diving.Algorithm), decoModelFromSuunto),
    conservatism: num(diving.Conservatism),
    surfacePressureBar: scaled(diving.SurfacePressure, PA_TO_BAR, 3),
    // An Ocean's log has no gases in its header (only gas switches in the samples): its mix stays unknown here.
    gases: list(diving.Gases).map(obj).filter((g): g is Json => g !== undefined).map((g) => stripUndefined({
      o2: scaled(g.Oxygen, 100, 1) ?? 21, he: scaled(g.Helium, 100, 1) ?? 0,
      tankVolumeL: scaled(g.TankSize, 1000, 2),
      // A gas without a transmitter has no pressures; some exports write 0 for that.
      startPressureBar: positive(scaled(g.StartPressure, PA_TO_BAR, 1)),
      endPressureBar: positive(scaled(g.EndPressure, PA_TO_BAR, 1)),
    })),
    minTemperatureC: temps.length ? Math.min(...temps) : undefined,
    maxTemperatureC: temps.length ? Math.max(...temps) : undefined,
    surfaceIntervalSeconds: num(diving.SurfaceTime),
    cnsStart: scaled(startTissue.CNS, 100, 1),
    cnsEnd: scaled(endTissue.CNS, 100, 1),
    otuStart: scaled(startTissue.OTU, 1, 1),
    otuEnd: scaled(endTissue.OTU, 1, 1),
    // m³/s at the surface → L/min.
    sacLpm: positive(scaled(obj(header.Ventilation)?.Avg, 60_000, 1)),
  });
  if (summary.gases?.length === 0) delete summary.gases;
  if (Object.keys(extras).length > 0) summary.extras = extras;

  const depth = obj(header.Depth) ?? {};
  const maxDepthM = num(depth.Max) ?? (depths.length ? Math.max(...depths) : undefined);
  const startSecond = Math.floor(start.ms / 1000);
  // The app's FIT export of this dive has the same start second, duration and maximum depth, and no serial number.
  const fitKey = suuntoFitKey(startSecond, duration, maxDepthM);
  return {
    device,
    recordingKey: device ? `suunto:${device.serialNumber}:${startSecond}` : `suunto:json:${fitKey.slice('suunto:fit:'.length)}`,
    replacesKey: fitKey,
    startsAt: new Date(start.ms),
    utcOffsetSeconds: start.utcOffsetSeconds,
    utcOffsetSource: start.source,
    durationSeconds: duration,
    maxDepthM,
    avgDepthM: num(depth.Avg),
    entryPosition: undefined,
    exitPosition: undefined,
    summary,
    series,
    events,
  };
}

const positive = (v: number | undefined) => (v !== undefined && v > 0 ? v : undefined);

/** The key of a Suunto FIT without a serial number (ADR 0037): what the app writes the same in both of its exports. */
export function suuntoFitKey(startSecond: number, durationSeconds: number, maxDepthM: number | undefined): string {
  return `suunto:fit:${startSecond}:${Math.round(durationSeconds)}:${maxDepthM === undefined ? 'x' : Math.round(maxDepthM * 100)}`;
}
