// A Dive as SSI's dive record (ADR 0024). Pure: no database, no network. Field names and quirks come from
// the community projects' captures (docs/research/2026-10-04-ssi-api.md); the code is our own.
//
// SSI expects the whole record on every save (about 340 keys, unused ones null). A create sends our values
// on top of empty defaults; an update re-sends SSI's current record with our values on top, so fields
// edited in the app survive; a delete re-sends it with `deleted` set.
import { createHash } from 'node:crypto';
import type { SiteWaterType } from '../vocabulary.js';
import type { SsiRecord } from './ssi-client.js';

export interface Series {
  offsetsMs: number[];
  values: number[];
}

/** What of a Dive goes to SSI. Times are ours (UTC + offset); SSI keeps local wall-clock time. */
export interface DiveForSsi {
  startsAt: Date;
  utcOffsetSeconds: number | null;
  durationSeconds: number;
  maxDepthM: number | null;
  avgDepthM: number | null;
  /** Lowest water temperature, as on the Dive. */
  waterTemperatureC: number | null;
  maxTemperatureC: number | null;
  /** The Dive site's water type (ADR 0025); SSI knows fresh and salt, so brackish sends nothing. */
  waterType: SiteWaterType | null;
  notes: string | null;
  siteSsiId: string;
  entry: { latitude: number; longitude: number } | null;
  exit: { latitude: number; longitude: number } | null;
  /** The first gas is the one SSI's single-gas fields describe. */
  gases: { o2: number; he: number }[];
  gfLow: number | null;
  gfHigh: number | null;
  cnsStart: number | null;
  cnsEnd: number | null;
  device: { manufacturer: string; product: string | null; serialNumber: string; firmware: string | null } | null;
  samples: { depth?: Series | undefined; temperature?: Series | undefined; ndl?: Series | undefined };
}

/** Our own fields of SSI's record, by the name the read-back reports them under. */
export const COMPARED_FIELDS = [
  'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC', 'maxTemperatureC', 'notes', 'site', 'gas', 'device', 'profile',
] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export const SAMPLE_INTERVAL_MS = 5000;
const M_TO_FT = 3.28084;

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const ft = (m: number | null) => (m === null ? null : round(m * M_TO_FT, 1));
const fahrenheit = (c: number | null) => (c === null ? null : round(c * 1.8 + 32, 1));
const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock time of the dive: SSI has no time zone. Without a known offset, UTC. */
export function localTime(at: Date, utcOffsetSeconds: number | null) {
  const local = new Date(at.getTime() + (utcOffsetSeconds ?? 0) * 1000);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  return { date, time, dateTime: `${date} ${time}` };
}

/**
 * A number SSI's app reads as a floating-point value: always with a decimal point. Its strict JSON
 * decoding refuses `0` where it expects `0.0` (divesend's notes), and JSON.stringify drops the ".0".
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
}

/** The profile on SSI's 5 s grid: depth interpolated, temperature and NDL held from the last reading. */
export function resample(samples: DiveForSsi['samples'], durationSeconds: number): SsiSample[] {
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
      o: false, dr: false, rv: 3,
    });
    previous = d;
  }
  return out;
}

/** The samples as SSI stores them: a JSON string, with decimals where its app expects them. */
export function samplesJson(samples: SsiSample[]): string {
  return `[${samples.map((s) =>
    `{"n":${s.n},"t":${s.t},"d":${decimal(s.d)},"s":${decimal(s.s)},"te":${decimal(s.te)},"ndl":${s.ndl},`
    + `"gs":${decimal(s.gs)},"gn":${decimal(s.gn)},"a":${s.a},"mf":${s.mf},"o":${s.o},"dr":${s.dr},"rv":${decimal(s.rv)}}`).join(',')}]`;
}
const listJson = (values: (number | null)[]) => `[${values.map(decimal).join(',')}]`;

const WATER_TYPE_IDS: Partial<Record<SiteWaterType, number>> = { fresh: 4, salt: 5 };

/** Fields of SSI's record that Dive Hub fills from the Dive. On an update, null leaves SSI's value. */
export function ownFields(d: DiveForSsi): SsiRecord {
  const time = localTime(d.startsAt, d.utcOffsetSeconds);
  const samples = resample(d.samples, d.durationSeconds);
  const gas = d.gases[0];
  const nitrox = gas !== undefined && gas.he === 0 && gas.o2 > 21;
  const minutes = Math.round(d.durationSeconds / 60);
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
    odin_user_log_comment: d.notes,
    odin_user_log_ean: gas === undefined ? null : nitrox ? 1 : 0,
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
    odin_user_log_gfSurfDataset: samples.length ? listJson(samples.map((s) => s.gs)) : null,
    odin_user_log_gfnowDataset: samples.length ? listJson(samples.map((s) => s.gn)) : null,
    odin_user_log_diveSamples: samples.length ? samplesJson(samples) : null,
  };
}

/** Keys that are only SSI app bookkeeping or confirmations; an update takes SSI's values for them. */
const XR = ['divetype_id', 'planned_bottom_time', 'total_deco_time', 'planned_depth', 'planned_deco_time', 'back', 'back_tanktype_id',
  'deco_tanktype_id', 'back_vol_l', 'back_vol_cuft', 'back_ean', 'back_tmx', 'back_o2', 'back_he', 'back_start_bar', 'back_end_bar',
  'back_start_psi', 'back_end_psi', 'sac_bottom_l', 'sac_bottom_psi', 'sac_deco_l', 'sac_deco_psi',
  ...[1, 2, 3].flatMap((i) => ['', '_tanktype_id', '_vol_l', '_vol_cuft', '_o2', '_he', '_start_bar', '_end_bar', '_start_psi', '_end_psi',
    ...(i < 3 ? ['_ean', '_tmx'] : ['_ean_o2'])].map((s) => `deco${i}${s}`))].map((k) => `odin_user_log_xr_${k}`);
const SCR = ['unit_id', 'total_deco_time', 'sac_bailout_l', 'sac_bailout_psi', 'sac_deco_l', 'sac_deco_psi', 'start_time', 'end_time', 'oc',
  ...['bottom', 'deco'].flatMap((g) => ['_tanktype_id', '_tank_vol_l', '_tank_vol_cuft', '_o2', '_setpoint', '_start_bar', '_start_psi', '_end_bar', '_end_psi'].map((s) => `${g}${s}`)),
  'deco'].map((k) => `odin_user_log_scr_${k}`);
const CCR = ['unit_id', 'total_deco_time', 'sac_bailout_l', 'sac_bailout_psi', 'sac_deco_l', 'sac_deco_psi', 'bottom_tank_vol_cuft', 'diluent_gas',
  ...['diluent', 'o2'].flatMap((g) => ['_tanktype_id', '_tank_vol_l', '_tank_vol_cuft', '_start_bar', '_start_psi', '_end_bar', '_end_psi'].map((s) => `${g}${s}`)),
  'diluent_o2', 'diluent_he',
  ...['01', '02', '03'].flatMap((i) => ['', '_tanktype_id', '_tank_vol_l', '_tank_vol_cuft', '_o2', '_he', '_start_bar', '_start_psi', '_end_bar', '_end_psi'].map((s) => `bailout${i}${s}`)),
].map((k) => `odin_user_log_ccr_${k}`);
const FREEDIVING = [
  'frd_weight_kg', 'frd_weight_lb', 'frd_neutral_m', 'frd_neutral_ft', 'frd_divetype_id', 'frd_suit', 'frd_NOTES', 'frdwater_body_id', 'frddisc',
  ...['STA', 'STATT', 'WAPN', 'DYN', 'DYNTT', 'FIM', 'CWT', 'CNF', 'VWT', 'FRC', 'DNF'].flatMap((d) => {
    const parts: Record<string, string[]> = {
      STA: ['', '_WU', '_MAX', '_CT'], STATT: ['', '_RP', '_MAX'], WAPN: ['', '_WU', '_RP', '_MAX'], DYN: ['', '_WU', '_MAX_m', '_MAX_ft'],
      DYNTT: ['', '_RP', '_MAX_m', '_MAX_ft'], FRC: ['', '_RP', '_MAX_m', '_MAX_ft'], DNF: ['', '_WU', '_MAX_m', '_MAX_ft'],
    };
    return (parts[d] ?? ['', '_WU', '_MAX_m', '_MAX_ft', '_TIME']).map((s) => `frddisc_${d}${s}`);
  }),
].map((k) => `odin_user_log_${k}`);

const NULL_FIELDS = [
  'odin_user_log_rating', 'odin_user_log_airtemp_c', 'odin_user_log_airtemp_f', 'odin_user_log_pressure_start_bar',
  'odin_user_log_pressure_start_psi', 'odin_user_log_pressure_end_bar', 'odin_user_log_pressure_end_psi', 'odin_user_log_leader_nr',
  'odin_user_log_var_divetype_id', 'odin_user_log_var_water_body_id', 'odin_user_log_var_entry_id', 'odin_user_log_var_current_id',
  'odin_user_log_var_surface_id', 'odin_user_log_var_weather_id', 'odin_user_log_var_tanktype_id', 'odin_user_log_vis_m', 'odin_user_log_vis_ft',
  'odin_user_log_weight_kg', 'odin_user_log_weight_lb', 'odin_user_log_tank_vol_l', 'odin_user_log_tank_vol_cuft',
  'odin_user_log_var_specialdive_id', 'odin_user_log_amv_l', 'odin_user_log_amv_psi',
  'odin_user_log_divecenter_confirmed', 'odin_user_log_divecenter_confirmed_id', 'odin_user_log_divecenter_confirmed_name',
  'odin_user_log_divecenter_confirmed_logo', 'odin_user_log_leader_confirmed_id', 'odin_user_log_leader_confirmed_name',
  'odin_user_log_user_confirmed_id', 'odin_user_log_user_confirmed_name', 'odin_user_log_transferDate', 'odin_user_log_confirmed',
  'odin_user_log_verified', 'timestamp',
  'odin_user_log_diveComputerData', 'odin_user_log_divecomputer_id', 'odin_user_log_divecomputer_ble_id',
  'odin_user_log_divecomputer_raw_data_header', 'odin_user_log_divecomputer_raw_data_details', 'odin_user_log_divecomputer_productname',
  'log_divecomputer_bottomtimer', 'log_divecomputer_max_sensor_depth', 'odin_user_log_divecomputer_dive_ref',
  'odin_user_log_alarmDataset', 'odin_user_log_deepestDecoDataset', 'odin_user_log_tankPressureDataset', 'odin_user_log_freeDiveSessionCharts',
  'odin_user_log_pressureDataset', 'odin_user_log_locationDataset',
  'odin_user_log_si_before', 'odin_user_log_gf_end', 'odin_user_log_otu_start', 'odin_user_log_otu_end',
  'odin_user_log_deco_dive', 'odin_user_log_deco_time', 'odin_user_log_deco_gas', 'odin_user_log_deco_gas_tanktype_id',
  'odin_user_log_deco_gas_tank_vol_l', 'odin_user_log_deco_gas_tank_vol_cuft', 'odin_user_log_deco_gas_o2', 'odin_user_log_deco_gas_start_bar',
  'odin_user_log_deco_gas_end_bar', 'odin_user_log_deco_gas_start_psi', 'odin_user_log_deco_gas_end_psi',
  'odin_user_log_alarm_fast_ascent', 'odin_user_log_alarm_deco_stop', 'odin_user_log_alarm_deco_violation',
  'log_linked_facility_id', 'log_linked_brevet_rule_id', 'odin_user_log_gearconfiguration_id',
  'log_extended_data_cleanup_weight_kg', 'log_extended_data_cleanup_weight_lb',
  'odin_user_log_apple_watch_log_id', 'odin_user_log_apple_watch_id', 'odin_user_log_apple_watch_app_version', 'odin_user_log_apple_watch_os_version',
  'odin_user_log_heartRateMin', 'odin_user_log_heartRateMax', 'odin_user_log_heartRateAvg', 'odin_user_log_heartRateDataset',
  'odin_user_log_batteryLevelDataset', 'odin_user_log_batteryLevelStart', 'odin_user_log_batteryLevelEnd', 'odin_user_log_accelerationDataset',
  'odin_user_log_gyroDataset', 'odin_user_log_dive_on_own_risk_os_app', 'odin_user_log_housing_local_dive_media',
  'localSiteId', 'odin_user_log_crdate', 'reset_profile_divelog_number_with_deletion', 'uploadError',
  ...XR, ...SCR, ...CCR, ...FREEDIVING,
];

/** Every key SSI's save expects, with the value an empty dive has. */
function emptyRecord(): SsiRecord {
  const record: SsiRecord = Object.fromEntries(NULL_FIELDS.map((k) => [k, null]));
  return Object.assign(record, {
    odin_user_log_id: null, odin_user_log_nr: null, internalPk: null, odin_user_log_user_master_id: null,
    odin_user_log_dive_type: 0, odin_user_log_deleted: 0, odin_user_log_diveComputer: '',
    odin_user_log_buddy_ids: [], localBuddyIds: [], odin_user_log_animal_ids: [], odin_user_log_gear: [],
    odin_user_log_apple_watch: 0, odin_user_log_dive_on_own_risk: 0,
    needsUpload: false, needsVerificationUpload: false, needsUnverifyUpload: false,
  }, Object.fromEntries(Object.keys(ownFields(EMPTY_DIVE)).map((k) => [k, null])));
}

const EMPTY_DIVE: DiveForSsi = {
  startsAt: new Date(0), utcOffsetSeconds: 0, durationSeconds: 0, maxDepthM: null, avgDepthM: null, waterTemperatureC: null,
  maxTemperatureC: null, waterType: null, notes: null, siteSsiId: '1', entry: null, exit: null, gases: [], gfLow: null, gfHigh: null,
  cnsStart: null, cnsEnd: null, device: null, samples: {},
};

/** A new SSI dive. `number` is SSI's own dive number (the next in the User's SSI logbook). */
export function createRecord(d: DiveForSsi, ids: { number: number; accountId: string; reference: string }): SsiRecord {
  return {
    ...emptyRecord(), ...ownFields(d),
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
  for (const key of Object.keys(record)) {
    const alias = READ_ALIASES[key];
    if (key in remote) record[key] = remote[key];
    if ((record[key] === null || record[key] === undefined) && alias && alias in remote) record[key] = remote[alias];
  }
  return record;
}

/** SSI's current record with the Dive's values on top; where the Dive has nothing, SSI's value stays. */
export function updateRecord(remote: SsiRecord, d: DiveForSsi): SsiRecord {
  const own = Object.entries(ownFields(d)).filter(([, v]) => v !== null);
  return { ...writableRecord(remote), ...Object.fromEntries(own), odin_user_log_id: remote.odin_user_log_id };
}

/** SSI's record marked deleted (SSI keeps it, hidden; its app has no way back). */
export function deleteRecord(remote: SsiRecord): SsiRecord {
  return { ...writableRecord(remote), odin_user_log_deleted: 1 };
}

/** What was pushed, reduced to what matters for "changed since": a hash of our own fields. */
export function fingerprint(d: DiveForSsi): string {
  return createHash('sha256').update(JSON.stringify(ownFields(d))).digest('base64url');
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
 * duration), so those compare to the minute; numbers within 0.06; serial numbers without leading zeros
 * (SSI drops them); the profile by its number of samples.
 */
export function compareReadBack(sent: SsiRecord, stored: SsiRecord): ReadBackDifference[] {
  const differences: ReadBackDifference[] = [];
  const check = (field: ComparedField, a: string | number | null, b: string | number | null, same: boolean) => {
    if (!same) differences.push({ field, sent: a, stored: b });
  };
  const num = (field: ComparedField, key: string) => {
    const a = asNumber(sent[key]);
    const b = asNumber(stored[key]);
    // SSI stores "nothing" as 0 in places.
    check(field, a, b, a === null ? b === null || b === 0 : b !== null && Math.abs(a - b) < 0.06);
  };
  const sentTime = asText(sent.odin_user_log_datetime)?.slice(0, 16) ?? null;
  const storedTime = asText(stored.odin_user_log_datetime)?.replace('T', ' ').replace('+', ' ').slice(0, 16) ?? null;
  check('startsAt', sentTime, storedTime, sentTime === storedTime);
  num('durationSeconds', 'odin_user_log_divetime');
  num('maxDepthM', 'odin_user_log_depth_m');
  num('avgDepthM', 'odin_user_log_avg_depth_m');
  num('waterTemperatureC', 'odin_user_log_watertemp_c');
  num('maxTemperatureC', 'odin_user_log_watertemp_max_c');
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
  return differences;
}
