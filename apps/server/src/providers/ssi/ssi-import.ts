// SSI's dives as ImportedDives (ADR 0030). Pure: no database, no network. What SSI returns for a dive is in the SSI
// reference ("A dive as SSI returns it"); fields a dive synced by SSI's own app may carry are read defensively.
import { REFERENCE_PREFIX, type DiveOrigin, type ImportContext, type ImportedDive, type ProviderCylinder, type Series } from '../provider.js';
import type { SsiLogbook, SsiRecord } from './ssi-client.js';
import { alpha2Of } from '../../sites/countries.js';
import { buddyIdsOf, SAMPLE_INTERVAL_MS } from './ssi-record.js';

/** The parser a Recording made from an SSI dive names (data model: Recording). */
export const SSI_PARSER = { name: 'ssi-app-api', version: '1' };

const numberOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v
  : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
/** SSI stores "nothing" as 0 in places: a depth, a temperature or a position of 0 counts as none. */
const positive = (v: unknown) => { const n = numberOf(v); return n !== null && n !== 0 ? n : null; };
const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null);

/** The context of a logbook (ADR 0030): buddy-list entry → SSI account, SSI site → name and position. No names of people. */
export function contextOf(logbook: SsiLogbook): ImportContext {
  return {
    people: Object.fromEntries(logbook.buddies.flatMap((b) => (b.account ? [[String(b.id), b.account]] : []))),
    sites: Object.fromEntries(logbook.sites.map((s) => [s.id, {
      name: s.name, latitude: s.latitude, longitude: s.longitude,
      // SSI gives alpha-3, alpha-2 or a country's name.
      country: alpha2Of(s.country) ?? (s.country && /^[A-Za-z]{2}$/.test(s.country) ? s.country.toUpperCase() : null),
      waterType: s.waterType,
    }])),
  };
}

function position(lat: unknown, lon: unknown) {
  const latitude = positive(lat);
  const longitude = positive(lon);
  return latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

/** A JSON string SSI keeps (`diveSamples`, `…Dataset`) as what it holds; null when empty or unreadable. */
function json(v: unknown): unknown {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string' || v.trim() === '') return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

/** The profile: SSI's samples (every 5 s, `t` in ms), else its depth and temperature datasets on the same grid. */
function samplesOf(r: SsiRecord): ImportedDive['samples'] {
  const series = () => ({ offsetsMs: [] as number[], values: [] as number[] });
  const depth = series();
  const temperature = series();
  const ndl = series();
  const samples = json(r.odin_user_log_diveSamples);
  if (Array.isArray(samples) && samples.length > 0) {
    samples.forEach((s: unknown, i) => {
      if (typeof s !== 'object' || s === null) return;
      const o = s as Record<string, unknown>;
      const t = numberOf(o.t) ?? i * SAMPLE_INTERVAL_MS;
      const d = numberOf(o.d);
      if (d !== null) { depth.offsetsMs.push(t); depth.values.push(d); }
      const te = numberOf(o.te);
      if (te !== null) { temperature.offsetsMs.push(t); temperature.values.push(te); }
      // SSI's no-deco limit is in minutes, at most 99 (which also stands for "none"); ours is in seconds.
      const limit = numberOf(o.ndl);
      if (limit !== null && limit < 99) { ndl.offsetsMs.push(t); ndl.values.push(limit * 60); }
    });
  } else {
    const fill = (target: Series, values: unknown) => {
      if (!Array.isArray(values)) return;
      values.forEach((v, i) => { const n = numberOf(v); if (n !== null) { target.offsetsMs.push(i * SAMPLE_INTERVAL_MS); target.values.push(n); } });
    };
    fill(depth, json(r.odin_user_log_depthDataset));
    fill(temperature, json(r.odin_user_log_tempDataset));
  }
  const some = (s: Series) => (s.values.length > 0 ? s : undefined);
  return { depth: some(depth), temperature: some(temperature), ndl: some(ndl) };
}

/** The dive computer SSI names, if it names one with a serial number. SSI drops leading zeros of serial numbers. */
function deviceOf(r: SsiRecord): ImportedDive['device'] {
  const serialNumber = text(r.odin_user_log_divecomputer_serial_nr);
  const manufacturer = text(r.odin_user_log_divecomputer_manufacturer);
  if (!serialNumber || !manufacturer) return deviceOfRef(r);
  const product = text(r.odin_user_log_divecomputer_ref) ?? text(r.odin_user_log_divecomputer_name) ?? text(r.odin_user_log_divecomputer_productname);
  return {
    // Our Devices name manufacturers as FIT files do (lower case), so a computer seen at SSI is the one its files find.
    manufacturer: manufacturer.toLowerCase(), serialNumber, firmware: text(r.odin_user_log_divecomputer_firmware),
    product: product && product.toLowerCase() !== manufacturer.toLowerCase() ? product : null,
  };
}

/**
 * An older shape (SSI's iOS app 4.1.203, early 2025, seen 2026-10-06): serial number, manufacturer and name empty, the
 * computer only in `divecomputer_ref` as "Manufacturer Model_Serial" ("Mares Puck4_2418005226"). The same Device as the
 * newer shape names.
 */
function deviceOfRef(r: SsiRecord): ImportedDive['device'] {
  const m = /^(\S+)(?:\s+(.+?))?_([A-Za-z0-9-]+)$/.exec(text(r.odin_user_log_divecomputer_ref) ?? '');
  if (!m) return null;
  return { manufacturer: m[1]!.toLowerCase(), product: m[2] ?? null, serialNumber: m[3]!, firmware: text(r.odin_user_log_divecomputer_firmware) };
}

/**
 * Who made and who confirmed an SSI dive: its creation time (a text as SSI keeps it, or seconds since 1970), and whether the
 * dive centre or the dive leader signed it. The names stay out.
 */
export function ssiOrigin(r: SsiRecord): DiveOrigin {
  const made = r.odin_user_log_crdate;
  const seconds = typeof made === 'number' ? made : null;
  const flag = (v: unknown) => v === true || v === 1 || v === '1';
  const id = (v: unknown) => { const n = numberOf(v); return n !== null && n !== 0; };
  return {
    createdAt: seconds !== null ? new Date(seconds * 1000).toISOString() : text(made),
    confirmedByCentre: flag(r.odin_user_log_divecenter_confirmed) || id(r.odin_user_log_divecenter_confirmed_id),
    confirmedByLeader: flag(r.odin_user_log_leader_confirmed) || id(r.odin_user_log_leader_confirmed_id),
  };
}

/** SSI's tank types (`tanktype` in `get_divelog_vars`, SSI reference): 19 "steel", 20 "alu". */
const MATERIAL_OF_TANK_TYPE: Record<number, ProviderCylinder['material']> = { 19: 'steel', 20: 'aluminium' };

/**
 * The one tank SSI's record describes (ADR 0031, 0045): its volume and its start and end pressure as typed there, the
 * material by its tank type, and the dive's gas. None without a volume or a pressure: a gas or a tank type alone is no tank.
 */
function cylinderOf(r: SsiRecord, gas: ProviderCylinder['gas']): ProviderCylinder | null {
  const volumeL = positive(r.odin_user_log_tank_vol_l);
  const startPressureBar = positive(r.odin_user_log_pressure_start_bar);
  const endPressureBar = positive(r.odin_user_log_pressure_end_bar);
  if (volumeL === null && startPressureBar === null && endPressureBar === null) return null;
  const material = MATERIAL_OF_TANK_TYPE[numberOf(r.odin_user_log_var_tanktype_id) ?? 0] ?? null;
  return { volumeL, material, startPressureBar, endPressureBar, gas };
}

/** SSI's dive record in typed values; null when it has no start time. */
export function parseSsiDive(r: SsiRecord, context: ImportContext, givenId?: string): ImportedDive | null {
  const remoteId = text(r.odin_user_log_id) ?? givenId ?? null;
  const start = text(r.odin_user_log_datetime)?.replace('T', ' ').replace('+', ' ');
  if (!remoteId || !start || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(start)) return null;
  const reference = text(r.odin_user_log_divecomputer_dive_ref);
  const samples = samplesOf(r);
  const device = deviceOf(r);
  // "Imported from a computer" alone proves nothing: Dive Hub's uploads set it too (SSI reference, 2026-10-06).
  const evidence = reference?.startsWith(REFERENCE_PREFIX) ? 'ours' : samples.depth && device ? 'computer' : 'logbook';
  const minutes = numberOf(r.odin_user_log_divetime);
  const profileEnd = samples.depth ? samples.depth.offsetsMs[samples.depth.offsetsMs.length - 1]! / 1000 : 0;
  const siteId = numberOf(r.odin_user_log_dive_sites_id);
  const site = siteId !== null && siteId > 0 ? context.sites[String(siteId)] : undefined;
  const nitrox = numberOf(r.odin_user_log_ean) === 1;
  const o2 = numberOf(r.odin_user_log_ean_percent);
  const gases = nitrox && o2 !== null && o2 > 21 ? [{ o2, he: 0 }] : numberOf(r.odin_user_log_ean) === 0 ? [{ o2: 21, he: 0 }] : [];
  const gfLow = numberOf(r.odin_user_log_gf_set_1);
  const gfHigh = numberOf(r.odin_user_log_gf_set_2);
  return {
    remoteId, remoteNumber: numberOf(r.odin_user_log_nr), evidence, reference: reference && reference.startsWith(REFERENCE_PREFIX) ? reference : null,
    localStart: start.slice(0, 19).trim(),
    durationSeconds: evidence === 'computer' && profileEnd > 0 ? profileEnd : (minutes ?? 0) * 60,
    maxDepthM: positive(r.odin_user_log_depth_m), avgDepthM: positive(r.odin_user_log_avg_depth_m),
    waterTemperatureC: positive(r.odin_user_log_watertemp_c), maxTemperatureC: positive(r.odin_user_log_watertemp_max_c),
    entry: position(r.odin_user_log_pos_start_latitude, r.odin_user_log_pos_start_longitude),
    exit: position(r.odin_user_log_pos_end_latitude, r.odin_user_log_pos_end_longitude),
    siteIds: siteId !== null && siteId > 0 ? { ssi: String(siteId) } : {},
    sitePosition: site && site.latitude !== null && site.longitude !== null ? { latitude: site.latitude, longitude: site.longitude } : null,
    device: evidence === 'logbook' ? null : device,
    samples: evidence === 'logbook' ? {} : samples,
    gases,
    gfLow: gfLow !== null && gfLow > 0 ? gfLow : null, gfHigh: gfHigh !== null && gfHigh > 0 ? gfHigh : null,
    cnsStart: numberOf(r.odin_user_log_cns_start), cnsEnd: numberOf(r.odin_user_log_cns_end),
    people: [...new Set(buddyIdsOf(r).flatMap((id) => { const account = context.people[String(id)]; return account ? [account] : []; }))],
    notes: text(r.odin_user_log_comment),
    cylinder: cylinderOf(r, gases[0] ?? null),
  };
}
