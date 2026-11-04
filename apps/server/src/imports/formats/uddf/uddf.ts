// UDDF dive logs (ADR 0003: a lenient reader; docs/references/uddf.md): any namespace, any element order, no schema
// validation. SI units throughout (m, K, Pa, s, m³). The Oceanic+ app's export is UDDF with quirks of its own
// (docs/references/oceanic-plus.md), handled where they apply.
import type { RecordingSummary, UtcOffsetSource } from '../../../db/schema.js';
import { errorMessage } from '../../../errors.js';
import type { DiveMode } from '../../../vocabulary.js';
import { ParseError, stripUndefined, type ParsedEvent, type ParsedRecording, type ParsedSeries, type Position } from '../../parsed-recording.js';
import { at, child, childrenOf, parseXml, type XmlElement } from './xml.js';

export interface UddfAdapter {
  readonly parser: string;
  readonly parserVersion: string;
  /** Returns the dives in a UDDF file; an empty list when it holds none. */
  parse(data: Uint8Array): Promise<ParsedRecording[]>;
}

/** A logbook of a few hundred dives is a few tens of megabytes; anything far larger is not parsed. */
const MAX_BYTES = 32 * 1024 * 1024;
/** Tank pressures read for a dive without tank data: a crafted file could name a new tank in every waypoint. */
const MAX_TANKS = 8;
const PROLOG_BYTES = 4096;
/** Fewer Oceanic+ waypoints are no profile: the app writes two made-up ones (start and deepest point) for a breath-hold session. */
const MIN_WAYPOINTS = 3;

/** A document whose root element is `uddf`, with any prefix; only the prolog's first bytes are read. */
export function looksLikeUddf(data: Uint8Array): boolean {
  if (data.length > MAX_BYTES) return false;
  // TextDecoder drops a byte order mark itself.
  const head = new TextDecoder('utf-8').decode(data.subarray(0, PROLOG_BYTES));
  const prolog = /^(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->)*/.exec(head)![0];
  return /^<(?:[A-Za-z_][\w.-]*:)?uddf[\s>/]/.test(head.slice(prolog.length));
}

const PA_TO_BAR = 1e-5;
const KELVIN = 273.15;
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const num = (e: XmlElement | undefined): number | undefined => {
  if (!e?.text) return undefined;
  const n = Number(e.text);
  return Number.isFinite(n) ? n : undefined;
};
const str = (e: XmlElement | undefined) => (e?.text ? e.text : undefined);
const celsius = (k: number | undefined) => (k === undefined ? undefined : round(k - KELVIN, 1));
const bar = (pa: number | undefined, digits = 2) => (pa === undefined ? undefined : round(pa * PA_TO_BAR, digits));

type Dialect = 'oceanicplus' | 'uddf';

/**
 * A UDDF time. With an offset it is an instant and the offset is the dive's; with `Z` an instant whose local offset
 * isn't known; with neither a wall-clock time, kept as if UTC (ADR 0030: `unknown`). Oceanic+ writes the offset's
 * hours in the minutes' place (`-00:04` for UTC−4): no zone is a few minutes off UTC, so that is read as hours.
 */
function time(text: string | undefined, dialect: Dialect): { ms: number; utcOffsetSeconds: number | undefined; source: UtcOffsetSource } | undefined {
  if (!text) return undefined;
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(text);
  const zoned = offset !== null || /z$/i.test(text);
  const wall = offset ? text.slice(0, offset.index) : text.replace(/z$/i, '');
  const wallMs = Date.parse(`${wall}Z`);
  if (Number.isNaN(wallMs)) return undefined;
  if (!offset) return { ms: wallMs, utcOffsetSeconds: undefined, source: zoned ? 'device' : 'unknown' };
  let hours = Number(offset[2]);
  let minutes = Number(offset[3]);
  if (dialect === 'oceanicplus' && hours === 0 && minutes > 0 && minutes <= 14) [hours, minutes] = [minutes, 0];
  const seconds = (hours * 60 + minutes) * 60 * (offset[1] === '-' ? -1 : 1);
  return { ms: wallMs - seconds * 1000, utcOffsetSeconds: seconds, source: 'device' };
}

interface Mix { o2: number; he: number }

/** What a file says once for all its dives: who wrote it, its sites and its mixes. */
interface Context {
  dialect: Dialect;
  generator: string | undefined;
  sites: Map<string, Position>;
  mixes: Map<string, Mix>;
}

function contextOf(root: XmlElement): Context {
  const generator = child(root, 'generator');
  const homepage = str(at(generator, 'manufacturer', 'contact', 'homepage'));
  const name = str(child(generator, 'name')) ?? str(at(generator, 'manufacturer', 'name'));
  const dialect: Dialect = /oceanic/i.test(`${homepage ?? ''} ${name ?? ''}`) ? 'oceanicplus' : 'uddf';
  const label = dialect === 'oceanicplus' ? 'Oceanic+' : name;
  const version = str(child(generator, 'version'));

  const sites = new Map<string, Position>();
  for (const site of childrenOf(child(root, 'divesite'), 'site')) {
    const geography = child(site, 'geography');
    const latitude = num(child(geography, 'latitude'));
    const longitude = num(child(geography, 'longitude'));
    const id = site.attributes.id;
    if (!id || latitude === undefined || longitude === undefined) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) continue;
    sites.set(id, { latitude, longitude });
  }

  const mixes = new Map<string, Mix>();
  for (const mix of childrenOf(child(root, 'gasdefinitions'), 'mix')) {
    const id = mix.attributes.id;
    if (!id) continue;
    mixes.set(id, { o2: round((num(child(mix, 'o2')) ?? 0.21) * 100, 1), he: round((num(child(mix, 'he')) ?? 0) * 100, 1) });
  }
  return { dialect, generator: label === undefined ? undefined : [label, version].filter(Boolean).join(' '), sites, mixes };
}

/** Every `dive`, wherever the repetition groups put it. */
const divesOf = (root: XmlElement) => childrenOf(child(root, 'profiledata'), 'repetitiongroup').flatMap((g) => childrenOf(g, 'dive'));

export function createUddfAdapter(): UddfAdapter {
  return {
    parser: 'uddf',
    parserVersion: '2',
    async parse(data) {
      if (!looksLikeUddf(data)) throw new ParseError('Not a UDDF file');
      let root: XmlElement;
      try {
        root = parseXml(new TextDecoder('utf-8', { fatal: true }).decode(data));
      } catch (error) {
        throw new ParseError(`UDDF file is not readable XML: ${errorMessage(error)}`, { cause: error });
      }
      const context = contextOf(root);
      return divesOf(root).map((dive) => toRecording(dive, context));
    },
  };
}

const DIVE_MODES: Record<string, DiveMode> = { opencircuit: 'open_circuit', closedcircuit: 'ccr', semiclosedcircuit: 'scr', apnoe: 'apnea', apnea: 'apnea' };

/** A waypoint's readings: UDDF element → channel, unit conversion. Tank pressures are read apart, per tank. */
const WAYPOINT_CHANNELS: [string, string, (v: number) => number][] = [
  ['depth', 'depth', (v) => v],
  ['temperature', 'temperature', (v) => celsius(v)!],
  ['heartrate', 'heartRate', (v) => v],
  ['calculatedpo2', 'po2', (v) => bar(v)!],
  ['nodecotime', 'ndl', (v) => v],
];

function samplesOf(dive: XmlElement, dialect: Dialect) {
  const declared = childrenOf(dive, 'tankdata').map((t) => t.attributes.id).filter((id): id is string => !!id);
  const waypoints = childrenOf(child(dive, 'samples'), 'waypoint')
    .map((w) => ({ w, ms: num(child(w, 'divetime')) }))
    .filter((x): x is { w: XmlElement; ms: number } => x.ms !== undefined)
    .map(({ w, ms }) => ({ w, ms: Math.round(ms * 1000) }));
  const profiled = dialect !== 'oceanicplus' || waypoints.length >= MIN_WAYPOINTS;

  const series: ParsedSeries[] = [];
  const push = (channel: string, read: (w: XmlElement) => number | undefined) => {
    const offsetsMs: number[] = [];
    const values: number[] = [];
    for (const { w, ms } of waypoints) {
      const value = read(w);
      if (value === undefined) continue;
      offsetsMs.push(ms);
      values.push(value);
    }
    if (profiled && values.length > 0) series.push({ channel, offsetsMs, values });
  };
  for (const [element, channel, convert] of WAYPOINT_CHANNELS) {
    push(channel, (w) => { const v = num(child(w, element)); return v === undefined ? undefined : convert(v); });
  }
  // The dive's own tanks; without tank data, the first few named in the waypoints.
  const pressures = new Map(waypoints.map(({ w }) => [w, new Map(childrenOf(w, 'tankpressure').map((p) => [p.attributes.ref ?? '', bar(num(p))]))]));
  const tanks = declared.length > 0 ? declared : firstOf(MAX_TANKS, waypoints.flatMap(({ w }) => [...pressures.get(w)!.keys()]));
  tanks.forEach((ref, index) => push(index === 0 ? 'tankPressure' : `tankPressure:${index + 1}`, (w) => pressures.get(w)!.get(ref)));

  // The mix a dive starts on is no switch; every later one is.
  const events: ParsedEvent[] = waypoints.flatMap(({ w, ms }) => {
    const ref = child(w, 'switchmix')?.attributes.ref;
    return profiled && ref && ms > 0 ? [{ offsetMs: ms, type: 'gas_switch', data: { mix: ref } }] : [];
  });
  const mode = waypoints.map(({ w }) => child(w, 'divemode')?.attributes.type).find(Boolean);
  const mixes = waypoints.map(({ w }) => child(w, 'switchmix')?.attributes.ref).filter((r): r is string => !!r);
  const lastMs = waypoints.reduce((most, x) => Math.max(most, x.ms), 0);
  return { series, events, mode, mixes, lastMs };
}

function gasesOf(dive: XmlElement, mixes: Map<string, Mix>, switched: string[], dialect: Dialect): RecordingSummary['gases'] {
  const tanks = childrenOf(dive, 'tankdata').map((tank) => {
    const mix = mixes.get(child(tank, 'link')?.attributes.ref ?? '') ?? { o2: 21, he: 0 };
    const volume = num(child(tank, 'tankvolume'));
    const begin = positive(bar(num(child(tank, 'tankpressurebegin')), 1));
    const end = positive(bar(num(child(tank, 'tankpressureend')), 1));
    // In Oceanic+, the same pressure at the start and the end is a filled-in default (220/220), not a reading.
    const read = dialect !== 'oceanicplus' || begin === undefined || begin !== end;
    return stripUndefined({
      ...mix,
      tankVolumeL: volume === undefined || volume <= 0 ? undefined : round(volume * 1000, 2),
      startPressureBar: read ? begin : undefined,
      endPressureBar: read ? end : undefined,
    });
  });
  if (tanks.length > 0) return tanks;
  const used = [...new Set(switched)].flatMap((ref) => { const mix = mixes.get(ref); return mix ? [mix] : []; });
  return used.length > 0 ? used : undefined;
}

function toRecording(dive: XmlElement, context: Context): ParsedRecording {
  const before = child(dive, 'informationbeforedive');
  const after = child(dive, 'informationafterdive');
  const start = time(str(child(before, 'datetime')), context.dialect);
  if (!start) throw new ParseError('UDDF dive has no start time');

  const { series, events, mode, mixes, lastMs } = samplesOf(dive, context.dialect);
  const depths = series.find((s) => s.channel === 'depth')?.values ?? [];
  const temps = series.find((s) => s.channel === 'temperature')?.values ?? [];
  const durationSeconds = num(child(after, 'diveduration')) ?? lastMs / 1000;
  const maxDepthM = num(child(after, 'greatestdepth')) ?? largest(depths);
  const site = childrenOf(before, 'link').map((l) => context.sites.get(l.attributes.ref ?? '')).find(Boolean);

  // Values without a place in a Recording are kept as extras, not dropped.
  // A rating or lead of 0 is the app's default, not a value.
  const notes = childrenOf(child(after, 'notes'), 'para').map((p) => p.text).filter(Boolean).join('\n\n');
  const extras: Record<string, string> = stripUndefined({
    rating: positive(num(at(after, 'rating', 'ratingvalue')))?.toString(),
    leadKg: positive(num(at(after, 'equipmentused', 'leadquantity')))?.toString(),
    notes: notes || undefined,
    generator: context.generator,
    diveMode: mode && !DIVE_MODES[mode] ? mode : undefined,
  }) as Record<string, string>;
  const lowest = celsius(num(child(after, 'lowesttemperature')));
  const summary: RecordingSummary = stripUndefined({
    diveNumber: num(child(before, 'divenumber')),
    diveMode: mode ? DIVE_MODES[mode] : undefined,
    gases: gasesOf(dive, context.mixes, mixes, context.dialect),
    minTemperatureC: lowest ?? smallest(temps),
    maxTemperatureC: largest(temps),
    surfaceIntervalSeconds: num(at(before, 'surfaceintervalbeforedive', 'passedtime')),
  });
  if (Object.keys(extras).length > 0) summary.extras = extras;

  const startSecond = Math.floor(start.ms / 1000);
  // Oceanic+ ids look like database ids (`dive_` and 24 hex digits) and are the app's own; other programs' ids hold
  // only within one file (ADR 0003), so their dives are known by when they started, how long and how deep.
  const appId = /^dive_([0-9a-f]{24})$/i.exec(dive.attributes.id ?? '')?.[1];
  const recordingKey = context.dialect === 'oceanicplus' && appId
    ? `oceanicplus:${appId.toLowerCase()}`
    : `uddf:${startSecond}:${Math.round(durationSeconds)}:${maxDepthM === undefined ? 'x' : Math.round(maxDepthM * 100)}`;

  return {
    device: undefined,
    recordingKey,
    startsAt: new Date(start.ms),
    utcOffsetSeconds: start.utcOffsetSeconds,
    utcOffsetSource: start.source,
    durationSeconds,
    maxDepthM,
    avgDepthM: num(child(after, 'averagedepth')),
    entryPosition: site,
    exitPosition: undefined,
    summary,
    series,
    events,
  };
}

const positive = (v: number | undefined) => (v !== undefined && v > 0 ? v : undefined);
// Not Math.max(...values): a long profile would overflow the call stack.
const largest = (values: number[]) => (values.length ? values.reduce((a, b) => Math.max(a, b)) : undefined);
const smallest = (values: number[]) => (values.length ? values.reduce((a, b) => Math.min(a, b)) : undefined);
/** The first `count` distinct values, in order. */
function firstOf(count: number, values: string[]): string[] {
  const seen = new Set<string>();
  for (const v of values) { if (seen.size >= count) break; seen.add(v); }
  return [...seen];
}
