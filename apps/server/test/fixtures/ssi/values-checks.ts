// The owner's checks of the dive values Dive Hub sends both ways (dive type, tank, lead, surface interval, pressure curve,
// heart rate, CNS), run by `round-trip.ts values start | finish`.
// It writes to the real SSI account: two throwaway dives dated 2000-01-02 (10:00 and 14:00, notes "Dive Hub test"), which
// `finish` deletes again. It prints only the two test dives' values, never those of other dives.
import type { SsiClient, SsiRecord } from '../../../src/providers/ssi/ssi-client.js';
import { compareReadBack, buildCreateRecord, buildDeleteRecord, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';

const NOTES = 'Dive Hub test – values, delete me';
const GAS = { o2: 21, he: 0 };
const minutes = (m: number) => m * 60_000;

/** Dive A, an apnea session: 2 minutes to 10 m and back, heart rate 60, no gas. */
function apneaDive(siteSsiId: string): DiveForSsi {
  return {
    startsAt: new Date('2000-01-02T10:00:00Z'), utcOffsetSeconds: 0, durationSeconds: 120, maxDepthM: 10, avgDepthM: 5,
    waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes: NOTES, siteSsiId, participants: [], entry: null, exit: null,
    gases: [], gfLow: null, gfHigh: null, cnsStart: null, cnsEnd: null, device: null, cylinder: null, leadKg: null,
    diveMode: 'apnea', surfaceIntervalSeconds: null, avgHeartRate: 60,
    samples: {
      depth: { offsetsMs: [0, 30_000, 60_000, 90_000, 120_000], values: [0, 10, 10, 5, 0] },
      temperature: { offsetsMs: [0], values: [20] },
      heartRate: { offsetsMs: [0], values: [60] },
    },
  };
}

/** Dive B, scuba: 12 L steel at 232 bar, 200 to 50 bar, 6 kg, a surface interval of 90 min, heart rate 80, CNS 3 to 8. */
function scubaDive(siteSsiId: string): DiveForSsi {
  return {
    startsAt: new Date('2000-01-02T14:00:00Z'), utcOffsetSeconds: 0, durationSeconds: 1200, maxDepthM: 15, avgDepthM: 10,
    waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes: NOTES, siteSsiId, participants: [], entry: null, exit: null,
    gases: [GAS], gfLow: null, gfHigh: null, cnsStart: 3, cnsEnd: 8, device: null,
    cylinder: { volumeL: 12, material: 'steel', startPressureBar: 200, endPressureBar: 50, workingPressureBar: 232, gas: GAS },
    leadKg: 6, diveMode: 'open_circuit', surfaceIntervalSeconds: 5400, avgHeartRate: 80,
    samples: {
      depth: { offsetsMs: [0, minutes(2), minutes(10), minutes(18), minutes(20)], values: [0, 15, 15, 5, 0] },
      temperature: { offsetsMs: [0], values: [20] },
      tankPressure: { offsetsMs: [0, minutes(20)], values: [200, 50] },
      heartRate: { offsetsMs: [0], values: [80] },
      cns: { offsetsMs: [0, minutes(20)], values: [3, 8] },
    },
  };
}

/** The record keys the send writes since the dive type, tank, lead, surface interval and curves were added. */
const NEW_KEYS = [
  'odin_user_log_dive_type', 'odin_user_log_tank_vol_l', 'odin_user_log_tank_vol_cuft',
  'odin_user_log_pressure_start_bar', 'odin_user_log_pressure_end_bar', 'odin_user_log_pressure_start_psi', 'odin_user_log_pressure_end_psi',
  'odin_user_log_var_tanktype_id', 'odin_user_log_weight_kg', 'odin_user_log_weight_lb', 'odin_user_log_si_before',
  'odin_user_log_heartRateAvg', 'odin_user_log_heartRateMin', 'odin_user_log_heartRateMax',
];
const DATASET_KEYS = ['odin_user_log_tankPressureDataset', 'odin_user_log_heartRateDataset'];

const show = (v: unknown) => (v === undefined ? 'absent' : JSON.stringify(v));
const same = (a: unknown, b: unknown) => (a === null || a === undefined ? b === null || b === undefined || b === 0 : String(a) === String(b));

function parse(v: unknown): unknown {
  if (typeof v !== 'string' || v === '') return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

/** A dataset as its length and first and last value (the test dives only). */
function datasetSummary(v: unknown): string {
  const list = parse(v);
  if (!Array.isArray(list)) return show(v === undefined ? undefined : null);
  return `${list.length} values, first ${show(list[0])}, last ${show(list[list.length - 1])}`;
}

/** How many samples carry `pr`, `hb` and `cn`, and the first sample that has each. */
function sampleSummary(v: unknown): string {
  const list = parse(v);
  if (!Array.isArray(list)) return 'no samples';
  const rows = list as Record<string, unknown>[];
  return ['pr', 'hb', 'cn'].map((key) => {
    const withKey = rows.filter((s) => s[key] !== undefined);
    return `${key}: ${withKey.length} of ${rows.length}${withKey.length ? `, first ${show(withKey[0]![key])}` : ''}`;
  }).join('; ');
}

function reportKeys(log: (line: string) => void, sent: SsiRecord, stored: SsiRecord) {
  for (const key of NEW_KEYS) {
    log(`    ${key.replace('odin_user_log_', '')}: sent ${show(sent[key])}, stored ${show(stored[key])} ${same(sent[key], stored[key]) ? 'as sent' : 'DIFFERS'}`);
  }
  for (const key of DATASET_KEYS) {
    log(`    ${key.replace('odin_user_log_', '')}: sent ${datasetSummary(sent[key])}; stored ${datasetSummary(stored[key])}`);
  }
  log(`    diveSamples sent   ${sampleSummary(sent.odin_user_log_diveSamples)}`);
  log(`    diveSamples stored ${sampleSummary(stored.odin_user_log_diveSamples)}`);
}

export interface ValuesChecks {
  client: SsiClient;
  access: string;
  accountId: string;
  siteId: string;
  log: (line: string) => void;
}

const findIn = async (o: Pick<ValuesChecks, 'client' | 'access'>, id: string) =>
  (await o.client.logbook(o.access)).dives.find((d) => String(d.odin_user_log_id) === id);

/** Creates the two test dives, reads them back and prints whether each new key came back as sent. Returns their SSI IDs. */
export async function startValuesChecks(o: ValuesChecks): Promise<string[]> {
  const { client, access, accountId, log } = o;
  const before = await client.logbook(access);
  let number = Math.max(0, ...before.dives.map((d) => Number(d.odin_user_log_nr) || 0));
  const ids: string[] = [];
  for (const [name, dive] of [['A (apnea)', apneaDive(o.siteId)], ['B (scuba)', scubaDive(o.siteId)]] as const) {
    number += 1;
    const sent = buildCreateRecord(dive, { number, accountId, reference: `divehub-values-test-${name[0]}` });
    const { id } = await client.save(access, sent);
    ids.push(id);
    log(`created dive ${name}: SSI dive ${id} as number ${number}`);
    const stored = await findIn(o, id);
    if (!stored) {
      log('  read back: not found');
      continue;
    }
    log(`  read back: ${JSON.stringify(compareReadBack(sent, stored))}`);
    reportKeys(log, sent, stored);
  }
  return ids;
}

/** Deletes the test dives and checks they are gone from the logbook. */
export async function finishValuesChecks(o: Pick<ValuesChecks, 'client' | 'access' | 'log'>, ids: string[]): Promise<void> {
  for (const id of ids) {
    const stored = await findIn(o, id);
    if (!stored) {
      o.log(`SSI dive ${id}: not in the logbook`);
      continue;
    }
    if (!String(stored.odin_user_log_comment ?? '').startsWith('Dive Hub test')) {
      o.log(`SSI dive ${id}: is not a Dive Hub test dive, left alone`);
      continue;
    }
    await o.client.save(o.access, buildDeleteRecord(stored));
    o.log(`SSI dive ${id}: ${(await findIn(o, id)) ? 'still there after deleting, delete it in the app' : 'deleted'}`);
  }
}
