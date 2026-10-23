// A Dive as SSI's dive record (ADR 0024). Pure: no database, no network. Field names and quirks come from
// the app's own dive row (ssi-dive-row.ts); the code is our own.
//
// SSI expects the whole record on every save (the app's 345 keys plus date and entry time, unused ones null). A create sends our values
// on top of empty defaults; an update re-sends SSI's current record with our values on top, so fields
// edited in the app survive; a delete re-sends it with `deleted` set.
import { createHash } from 'node:crypto';
import type { SiteWaterType } from '../../vocabulary.js';
import type { OutgoingDive, Series } from '../provider.js';
import type { SsiRecord } from './ssi-client.js';
import { asBool, DIVE_ROW, SENT_KEYS } from './ssi-dive-row.js';
import { keepTraining, ssiDiveType } from './ssi-dive-type.js';

export type { Series };

/** What of a Dive goes to SSI: the outgoing Dive with its site's SSI ID. Times are ours; SSI keeps local wall-clock time. */
export type DiveForSsi = Omit<OutgoingDive, 'siteIds'> & { siteSsiId: string };

/** Our own fields of SSI's record, by the name the read-back reports them under. */
export const COMPARED_FIELDS = [
  'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC', 'maxTemperatureC', 'notes', 'site', 'gas', 'device', 'profile',
  'buddies', 'diveType', 'tankVolumeL', 'startPressureBar', 'endPressureBar', 'leadKg', 'surfaceInterval', 'heartRate',
] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export const SAMPLE_INTERVAL_MS = 5000;
const M_TO_FT = 3.28084;

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const ft = (m: number | null) => (m === null ? null : round(m * M_TO_FT, 1));
const fahrenheit = (c: number | null) => (c === null ? null : round(c * 1.8 + 32, 1));
const KG_TO_LB = 2.20462;
const BAR_TO_PSI = 14.5038;
const TANK_TYPE_IDS = { steel: 19, aluminium: 20 } as const;
const orNull = (v: number | null | undefined, digits: number) => (v === null || v === undefined ? null : round(v, digits));
const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock time of the dive: SSI has no time zone. Without a known offset, UTC. */
export function localTime(at: Date, utcOffsetSeconds: number | null) {
  const local = new Date(at.getTime() + (utcOffsetSeconds ?? 0) * 1000);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  return { date, time, dateTime: `${date} ${time}` };
}

/**
 * Whether an update would change the start time SSI has for the dive, which removes a dive centre's verification of
 * that entry there (ADR 0038, 0043). `previous` is the record sent last; without it (a dive linked at SSI and never
 * sent) what SSI has isn't known, and the answer is yes, so the User is warned rather than surprised.
 */
export function startChangesAtSsi(previous: Record<string, unknown> | null, dive: { startsAt: Date; utcOffsetSeconds: number | null }): boolean {
  const sent = previous?.odin_user_log_datetime;
  if (typeof sent !== 'string') return true;
  return sent.replace('T', ' ').slice(0, 16) !== localTime(dive.startsAt, dive.utcOffsetSeconds).dateTime;
}

/**
 * A number in the samples string with a decimal point, as the app itself sends them. The app (5.0.43) reads any
 * number there; older community notes (divesend) say its strict decoding refused `0` for `0.0`. [R]
 */
const decimal = (v: number | null) => (v === null ? 'null' : Number.isInteger(v) ? v.toFixed(1) : String(round(v, 2)));

/** Linear interpolation of a series at `t`, or the last value before it for step-like channels. */
function valueAt(series: Series | undefined, t: number, mode: 'linear' | 'hold'): number | null {
  if (!series || series.offsetsMs.length === 0) return null;
  const { offsetsMs: o, values: v } = series;
  if (t <= o[0]!) return v[0]!;
  if (t >= o[o.length - 1]!) return v[v.length - 1]!;
  let lo = 0;
  let hi = o.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (o[mid]! <= t) lo = mid; else hi = mid;
  }
  if (mode === 'hold' || o[hi] === o[lo]) return v[lo]!;
  return v[lo]! + ((t - o[lo]!) / (o[hi]! - o[lo]!)) * (v[hi]! - v[lo]!);
}

// Phase flags of SSI's samples (`mf`), as its app sets them.
const FLAG_DIVE = 0x08000000;
const FLAG_AT_DEPTH = 0x00010000;
const FLAG_SURFACED = 0x04000000;

export interface SsiSample {
  n: number; t: number; d: number; s: number; te: number | null; ndl: number;
  gs: number; gn: number; a: number; mf: number; o: boolean; dr: boolean; rv: number;
  /** Tank pressure (bar) of tank `t`, heart rate (bpm) and CNS (%), where the Recording has them. */
  pr?: { t: number; v: number }; hb?: number; cn?: number;
}

/** Tank pressure, heart rate and CNS at `t`, each only where the Recording has the series. */
function vitals(samples: DiveForSsi['samples'], t: number): Pick<SsiSample, 'pr' | 'hb' | 'cn'> {
  const pressure = valueAt(samples.tankPressure, t, 'linear');
  const heartRate = valueAt(samples.heartRate, t, 'hold');
  const cns = valueAt(samples.cns, t, 'hold');
  return {
    // The first tank; whether the app counts from 0 is unconfirmed.
    ...(pressure === null ? {} : { pr: { t: 0, v: round(pressure, 1) } }),
    ...(heartRate === null ? {} : { hb: Math.round(heartRate) }),
    ...(cns === null ? {} : { cn: Math.round(cns) }),
  };
}

/**
 * The profile on SSI's 5 s grid: depth and tank pressure interpolated, temperature, NDL, heart rate and CNS held from
 * the last reading. A series that ends early holds its last value. `closedCircuit` is a rebreather dive.
 */
export function resample(samples: DiveForSsi['samples'], durationSeconds: number, closedCircuit = false): SsiSample[] {
  const depth = samples.depth;
  if (!depth || depth.offsetsMs.length === 0) return [];
  const end = Math.max(durationSeconds * 1000, depth.offsetsMs[depth.offsetsMs.length - 1]!);
  const out: SsiSample[] = [];
  let atDepth = false;
  let previous = 0;
  for (let t = 0, n = 1; t <= end; t += SAMPLE_INTERVAL_MS, n++) {
    const d = round(Math.max(0, valueAt(depth, t, 'linear') ?? 0), 2);
    const temperature = valueAt(samples.temperature, t, 'hold');
    const ndlSeconds = valueAt(samples.ndl, t, 'hold');
    // Hysteresis as in SSI's own samples: "at depth" from 8.5 m down, until back above 6 m.
    if (d >= 8.5) atDepth = true; else if (d < 6) atDepth = false;
    out.push({
      n, t, d,
      // m/min, ascending positive.
      s: n === 1 ? 0 : round(((previous - d) / SAMPLE_INTERVAL_MS) * 60_000, 1),
      te: temperature === null ? null : round(temperature, 1),
      ndl: ndlSeconds === null ? 99 : Math.max(0, Math.min(99, Math.floor(ndlSeconds / 60))),
      gs: 0, gn: 0, a: 0,
      mf: FLAG_DIVE | (atDepth ? FLAG_AT_DEPTH : 0) | (d <= 1 ? FLAG_SURFACED : 0),
      // Open circuit, as the app sets it for every sample of a dive without a rebreather.
      o: !closedCircuit, dr: false, rv: 3,
      ...vitals(samples, t),
    });
    previous = d;
  }
  return out;
}

/** The samples as SSI stores them: a JSON string, with decimals where its app expects them. */
export function samplesJson(samples: SsiSample[]): string {
  return `[${samples.map((s) =>
    `{"n":${s.n},"t":${s.t},"d":${decimal(s.d)},"s":${decimal(s.s)},"te":${decimal(s.te)},"ndl":${s.ndl},`
    + `"gs":${decimal(s.gs)},"gn":${decimal(s.gn)},"a":${s.a},"mf":${s.mf},"o":${s.o},"dr":${s.dr},"rv":${decimal(s.rv)}`
    + `${s.pr ? `,"pr":{"t":${s.pr.t},"v":${decimal(s.pr.v)}}` : ''}${s.hb === undefined ? '' : `,"hb":${s.hb}`}${s.cn === undefined ? '' : `,"cn":${s.cn}`}}`).join(',')}]`;
}
const listJson = (values: (number | null)[]) => `[${values.map(decimal).join(',')}]`;

/** One value per sample, or null when no sample has the value. */
const dataset = (samples: SsiSample[], pick: (s: SsiSample) => number | undefined) =>
  samples.some((s) => pick(s) !== undefined) ? listJson(samples.map((s) => pick(s) ?? null)) : null;

const WATER_TYPE_IDS: Partial<Record<SiteWaterType, number>> = { fresh: 4, salt: 5 };

/** Fields of SSI's record that Dive Hub fills from the Dive. On an update, null leaves SSI's value. */
export function ownFields(d: DiveForSsi): SsiRecord {
  const time = localTime(d.startsAt, d.utcOffsetSeconds);
  const samples = resample(d.samples, d.durationSeconds, d.diveMode === 'ccr' || d.diveMode === 'scr');
  const gas = d.gases[0];
  const nitrox = gas !== undefined && gas.he === 0 && gas.o2 > 21;
  const minutes = Math.round(d.durationSeconds / 60);
  const tank = d.cylinder;
  const startBar = orNull(tank?.startPressureBar, 0);
  const endBar = orNull(tank?.endPressureBar, 0);
  const material = tank?.material;
  const heart = d.samples.heartRate?.values ?? [];
  const siSeconds = d.surfaceIntervalSeconds === null ? null : Math.round(d.surfaceIntervalSeconds);
  return {
    odin_user_log_datetime: time.dateTime,
    odin_user_log_date: time.date,
    odin_user_log_entry_time: time.time,
    odin_user_log_divetime: minutes,
    odin_user_log_depth_m: d.maxDepthM === null ? null : round(d.maxDepthM, 1),
    odin_user_log_depth_ft: ft(d.maxDepthM),
    odin_user_log_avg_depth_m: d.avgDepthM === null ? null : round(d.avgDepthM, 1),
    odin_user_log_avg_depth_ft: ft(d.avgDepthM),
    odin_user_log_watertemp_c: d.waterTemperatureC === null ? null : round(d.waterTemperatureC, 1),
    odin_user_log_watertemp_f: fahrenheit(d.waterTemperatureC),
    odin_user_log_watertemp_max_c: d.maxTemperatureC === null ? null : round(d.maxTemperatureC, 1),
    odin_user_log_watertemp_max_f: fahrenheit(d.maxTemperatureC),
    odin_user_log_var_watertype_id: d.waterType ? WATER_TYPE_IDS[d.waterType] ?? null : null,
    odin_user_log_dive_sites_id: Number(d.siteSsiId),
    odin_user_log_dive_type: ssiDiveType(d.diveMode, d.gases.length),
    odin_user_log_tank_vol_l: orNull(tank?.volumeL, 1),
    odin_user_log_tank_vol_cuft: tank?.volumeL != null && tank.workingPressureBar != null
      ? round((tank.volumeL * tank.workingPressureBar) / 1.01325 / 28.3168, 1) : null,
    odin_user_log_pressure_start_bar: startBar,
    odin_user_log_pressure_start_psi: startBar === null ? null : round(startBar * BAR_TO_PSI, 0),
    odin_user_log_pressure_end_bar: endBar,
    odin_user_log_pressure_end_psi: endBar === null ? null : round(endBar * BAR_TO_PSI, 0),
    odin_user_log_var_tanktype_id: material === 'steel' || material === 'aluminium' ? TANK_TYPE_IDS[material] : null,
    odin_user_log_weight_kg: orNull(d.leadKg, 1),
    odin_user_log_weight_lb: d.leadKg === null ? null : round(d.leadKg * KG_TO_LB, 1),
    // SSI's si_before is in seconds; the app takes 3 to 1440 minutes (180 to 86 400 s) and throws anything else away.
    odin_user_log_si_before: siSeconds !== null && siSeconds >= 180 && siSeconds <= 86_400 ? siSeconds : null,
    odin_user_log_heartRateAvg: d.avgHeartRate !== null ? Math.round(d.avgHeartRate)
      : heart.length ? Math.round(heart.reduce((a, b) => a + b, 0) / heart.length) : null,
    odin_user_log_heartRateMin: heart.length ? Math.round(Math.min(...heart)) : null,
    odin_user_log_heartRateMax: heart.length ? Math.round(Math.max(...heart)) : null,
    odin_user_log_comment: d.notes,
    odin_user_log_ean: gas === undefined ? null : nitrox,
    odin_user_log_ean_percent: gas === undefined ? null : nitrox ? Math.round(gas.o2) : 0,
    odin_user_log_gf_set: d.gfLow !== null && d.gfHigh !== null ? `${d.gfLow} / ${d.gfHigh}` : null,
    odin_user_log_gf_set_1: d.gfLow,
    odin_user_log_gf_set_2: d.gfHigh,
    odin_user_log_cns_start: d.cnsStart,
    odin_user_log_cns_end: d.cnsEnd,
    odin_user_log_pos_start_latitude: d.entry?.latitude ?? null,
    odin_user_log_pos_start_longitude: d.entry?.longitude ?? null,
    odin_user_log_pos_end_latitude: d.exit?.latitude ?? null,
    odin_user_log_pos_end_longitude: d.exit?.longitude ?? null,
    // The serial binds the dive to a device record at SSI; without one the app shows its own brand.
    odin_user_log_divecomputer_serial_nr: d.device?.serialNumber ?? null,
    odin_user_log_divecomputer_manufacturer: d.device?.manufacturer ?? null,
    odin_user_log_divecomputer_name: d.device ? d.device.product ?? d.device.manufacturer : null,
    odin_user_log_divecomputer_ref: d.device?.product ?? null,
    odin_user_log_divecomputer_firmware: d.device?.firmware ?? null,
    odin_user_log_divecomputer_imported: d.device ? true : null,
    odin_user_log_depthDataset: samples.length ? listJson(samples.map((s) => s.d)) : null,
    odin_user_log_tempDataset: samples.length ? listJson(samples.map((s) => s.te)) : null,
    odin_user_log_tankPressureDataset: dataset(samples, (s) => s.pr?.v),
    odin_user_log_heartRateDataset: dataset(samples, (s) => s.hb),
    odin_user_log_gfSurfDataset: samples.length ? listJson(samples.map((s) => s.gs)) : null,
    odin_user_log_gfnowDataset: samples.length ? listJson(samples.map((s) => s.gn)) : null,
    odin_user_log_diveSamples: samples.length ? samplesJson(samples) : null,
  };
}

/** Every key the app's save sends (ssi-dive-row.ts), with the value an empty dive has. */
function emptyRecord(): SsiRecord {
  const record: SsiRecord = Object.fromEntries(SENT_KEYS.map((k) => [k, null]));
  return Object.assign(record, {
    odin_user_log_dive_type: 0, odin_user_log_deleted: false, odin_user_log_diveComputer: '',
    odin_user_log_buddy_ids: [], localBuddyIds: [], odin_user_log_animal_ids: [], odin_user_log_gear: [],
    odin_user_log_apple_watch: false, odin_user_log_dive_on_own_risk: false,
    needsUpload: false, needsVerificationUpload: false, needsUnverifyUpload: false,
  });
}

/** A new SSI dive. `number` is SSI's own dive number (the next in the User's SSI logbook). */
export function createRecord(d: DiveForSsi, ids: { number: number; accountId: string; reference: string }): SsiRecord {
  return {
    ...emptyRecord(), ...ownFields(d),
    // A new dive without a known type is open circuit.
    odin_user_log_dive_type: ssiDiveType(d.diveMode, d.gases.length) ?? 0,
    odin_user_log_nr: ids.number, internalPk: ids.number, odin_user_log_user_master_id: Number(ids.accountId),
    odin_user_log_divecomputer_dive_ref: ids.reference,
  };
}

/** SSI's read side names two freediving fields differently (a stray `x_`). */
const READ_ALIASES: Record<string, string> = {
  odin_user_log_frd_suit: 'x_odin_user_log_frd_suit',
  odin_user_log_frdwater_body_id: 'x_odin_user_log_frdwater_body_id',
};

/** SSI's current record reduced to the keys its save takes, so nothing read-only goes back. */
export function writableRecord(remote: SsiRecord): SsiRecord {
  const record = emptyRecord();
  const booleans = new Set(DIVE_ROW.filter(([, type]) => type === 'bool').map(([key]) => key));
  for (const key of SENT_KEYS) {
    const alias = READ_ALIASES[key];
    if (key in remote) record[key] = remote[key] ?? null;
    if ((record[key] === null || record[key] === undefined) && alias && alias in remote) record[key] = remote[alias];
    if (booleans.has(key)) record[key] = asBool(record[key]);
  }
  return record;
}

/** SSI's current record with the Dive's values on top; where the Dive has nothing, SSI's value stays. */
export function updateRecord(remote: SsiRecord, d: DiveForSsi): SsiRecord {
  const fields = ownFields(d);
  // A training variant SSI holds (7 for apnea 6) and its extended-range type (2, 3) stay.
  fields.odin_user_log_dive_type = keepTraining(remote.odin_user_log_dive_type, asNumber(fields.odin_user_log_dive_type));
  const own = Object.entries(fields).filter(([, v]) => v !== null);
  return { ...writableRecord(remote), ...Object.fromEntries(own), odin_user_log_id: remote.odin_user_log_id };
}

/** SSI's record marked deleted (SSI keeps it, hidden; its app has no way back). */
export function deleteRecord(remote: SsiRecord): SsiRecord {
  return { ...writableRecord(remote), odin_user_log_deleted: true };
}

/**
 * The record with these entries of the User's buddy list on the dive (ADR 0029). SSI keeps them as numbers. Every
 * Participant goes as a buddy: SSI has no other place for a guide or an instructor.
 */
export function withBuddies(record: SsiRecord, entryIds: number[]): SsiRecord {
  return { ...record, odin_user_log_buddy_ids: entryIds };
}

/** Entry IDs on a record, as numbers (anything else SSI might hold there is left out). */
export function buddyIdsOf(record: SsiRecord | null | undefined): number[] {
  const ids = record?.odin_user_log_buddy_ids;
  return Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

/**
 * What was pushed, reduced to what matters for "changed since": a hash of our own fields and the SSI accounts of the
 * Participants (their entry IDs are only known with the buddy list, which the status doesn't read).
 */
export function fingerprint(d: DiveForSsi): string {
  const buddies = d.participants.flatMap((p) => (p.ids.ssi ? [p.ids.ssi] : [])).sort();
  return createHash('sha256').update(JSON.stringify({ ...ownFields(d), buddies })).digest('base64url');
}

export interface ReadBackDifference {
  field: ComparedField;
  sent: string | number | null;
  stored: string | number | null;
}

const asNumber = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const asText = (v: unknown) => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
const datasetLength = (v: unknown) => {
  if (typeof v !== 'string' || v === '') return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
};

/**
 * Fields SSI stored differently from what we sent, read back after saving. SSI keeps minutes (time and
 * duration), so those compare to the minute; numbers within 0.06 (surface interval and heart rate within 1); serial numbers without leading zeros
 * (SSI drops them); the profile by its number of samples.
 */
export function compareReadBack(sent: SsiRecord, stored: SsiRecord): ReadBackDifference[] {
  const differences: ReadBackDifference[] = [];
  const check = (field: ComparedField, a: string | number | null, b: string | number | null, same: boolean) => {
    if (!same) differences.push({ field, sent: a, stored: b });
  };
  const num = (field: ComparedField, key: string, tolerance = 0.06) => {
    const a = asNumber(sent[key]);
    const b = asNumber(stored[key]);
    // SSI stores "nothing" as 0 in places.
    check(field, a, b, a === null ? b === null || b === 0 : b !== null && Math.abs(a - b) < tolerance);
  };
  const sentTime = asText(sent.odin_user_log_datetime)?.slice(0, 16) ?? null;
  const storedTime = asText(stored.odin_user_log_datetime)?.replace('T', ' ').replace('+', ' ').slice(0, 16) ?? null;
  check('startsAt', sentTime, storedTime, sentTime === storedTime);
  num('durationSeconds', 'odin_user_log_divetime');
  num('maxDepthM', 'odin_user_log_depth_m');
  num('avgDepthM', 'odin_user_log_avg_depth_m');
  num('waterTemperatureC', 'odin_user_log_watertemp_c');
  num('maxTemperatureC', 'odin_user_log_watertemp_max_c');
  num('diveType', 'odin_user_log_dive_type');
  num('tankVolumeL', 'odin_user_log_tank_vol_l');
  num('startPressureBar', 'odin_user_log_pressure_start_bar');
  num('endPressureBar', 'odin_user_log_pressure_end_bar');
  num('leadKg', 'odin_user_log_weight_kg');
  num('surfaceInterval', 'odin_user_log_si_before', 1.01);
  num('heartRate', 'odin_user_log_heartRateAvg', 1.01);
  const notesA = asText(sent.odin_user_log_comment);
  const notesB = asText(stored.odin_user_log_comment);
  check('notes', notesA, notesB, (notesA ?? '').trim() === (notesB ?? '').trim());
  const siteA = asText(sent.odin_user_log_dive_sites_id);
  const siteB = asText(stored.odin_user_log_dive_sites_id);
  check('site', siteA, siteB, siteA === siteB);
  num('gas', 'odin_user_log_ean_percent');
  const serial = (v: unknown) => asText(v)?.replace(/^0+(?=.)/, '') ?? null;
  check('device', serial(sent.odin_user_log_divecomputer_serial_nr), serial(stored.odin_user_log_divecomputer_serial_nr),
    serial(sent.odin_user_log_divecomputer_serial_nr) === serial(stored.odin_user_log_divecomputer_serial_nr));
  const samplesA = datasetLength(sent.odin_user_log_depthDataset);
  const samplesB = datasetLength(stored.odin_user_log_depthDataset);
  check('profile', samplesA, samplesB, samplesA === samplesB);
  const buddies = (r: SsiRecord) => buddyIdsOf(r).sort((a, b) => a - b).join(', ') || null;
  check('buddies', buddies(sent), buddies(stored), buddies(sent) === buddies(stored));
  return differences;
}
