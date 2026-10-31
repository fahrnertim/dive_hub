// The owner's check of which empty value SSI stores as "cleared" per key on an update, run by
// `round-trip.ts clear start | finish`. It writes to the real SSI account: one throwaway dive dated 2000-01-03 10:00
// (notes "Dive Hub test"), which `finish` deletes again. It prints only that dive's keys, never those of other dives.
import type { SsiClient, SsiRecord } from '../../../src/providers/ssi/ssi-client.js';
import { buildCreateRecord, buildDeleteRecord, buildUpdateRecord, writableRecord, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';

const NOTES = 'Dive Hub test – clear, delete me';
const TEXT_KEYS = ['odin_user_log_comment'];
const NUMBER_KEYS = [
  'odin_user_log_weight_kg', 'odin_user_log_weight_lb', 'odin_user_log_tank_vol_l', 'odin_user_log_tank_vol_cuft',
  'odin_user_log_pressure_start_bar', 'odin_user_log_pressure_end_bar', 'odin_user_log_pressure_start_psi', 'odin_user_log_pressure_end_psi',
  'odin_user_log_var_tanktype_id', 'odin_user_log_avg_depth_m', 'odin_user_log_avg_depth_ft', 'odin_user_log_watertemp_c', 'odin_user_log_watertemp_f',
];
const KEYS = [...TEXT_KEYS, ...NUMBER_KEYS];

const GAS = { o2: 21, he: 0 };
const clearDive = (siteSsiId: string): DiveForSsi => ({
  startsAt: new Date('2000-01-03T10:00:00Z'), utcOffsetSeconds: 0, durationSeconds: 1200, maxDepthM: 15, avgDepthM: 8,
  waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes: NOTES, siteSsiId, participants: [], entry: null, exit: null,
  gases: [GAS], gfLow: null, gfHigh: null, cnsStart: null, cnsEnd: null, device: null,
  cylinder: { volumeL: 12, material: 'steel', startPressureBar: 200, endPressureBar: 50, workingPressureBar: 232, gas: GAS },
  leadKg: 6, diveMode: 'open_circuit', surfaceIntervalSeconds: null, avgHeartRate: null,
  samples: { depth: { offsetsMs: [0, 120_000, 600_000, 1_080_000, 1_200_000], values: [0, 15, 15, 5, 0] }, temperature: { offsetsMs: [0], values: [20] } },
});

const show = (v: unknown) => (v === undefined ? 'absent' : JSON.stringify(v));
/** What counts as "still stored": anything but absent, null, "" or 0. */
const isSet = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== 0 && v !== '0';
const short = (key: string) => key.replace('odin_user_log_', '');

export interface ClearChecks {
  client: SsiClient;
  access: string;
  accountId: string;
  siteId: string;
  log: (line: string) => void;
}

const findIn = async (o: Pick<ClearChecks, 'client' | 'access'>, id: string) =>
  (await o.client.logbook(o.access)).dives.find((d) => String(d.odin_user_log_id) === id);

/** Creates the test dive, updates it with empty values (null, then "", then 0) and prints per key what SSI stored. Returns its SSI ID. */
export async function startClearChecks(o: ClearChecks): Promise<string> {
  const { client, access, accountId, log } = o;
  const dive = clearDive(o.siteId);
  const before = await client.logbook(access);
  const number = Math.max(0, ...before.dives.map((d) => Number(d.odin_user_log_nr) || 0)) + 1;
  const { id } = await client.save(access, buildCreateRecord(dive, { number, accountId, reference: 'divehub-clear-test' }));
  log(`created SSI dive ${id} as number ${number}`);
  let stored = await findIn(o, id);
  if (!stored) throw new Error(`dive ${id} is not in the logbook`);
  log('  after the create:');
  for (const key of KEYS) log(`    ${short(key)}: stored ${show(stored[key])}`);

  const rounds: Array<{ name: string; value: unknown; keys: string[] }> = [
    { name: 'null', value: null, keys: KEYS },
    { name: '""', value: '', keys: KEYS },
    { name: '0', value: 0, keys: NUMBER_KEYS },
  ];
  let remaining = KEYS.filter((k) => isSet(stored![k]));
  for (const round of rounds) {
    const keys = round.keys.filter((k) => remaining.includes(k));
    if (!keys.length) break;
    const sent: SsiRecord = { ...writableRecord(stored), ...Object.fromEntries(keys.map((k) => [k, round.value])), odin_user_log_id: stored.odin_user_log_id };
    await client.save(access, sent);
    const after = await findIn(o, id);
    if (!after) throw new Error(`dive ${id} is gone from the logbook`);
    stored = after;
    log(`  update with ${round.name}:`);
    for (const key of keys) log(`    ${short(key)}: sent ${show(round.value)}, stored ${show(stored[key])} ${isSet(stored[key]) ? 'KEPT' : 'cleared'}`);
    remaining = remaining.filter((k) => isSet(stored![k]));
  }
  // The notes may be cleared: put them back so that `finish` recognizes the dive as a test dive.
  if (!String(stored.odin_user_log_comment ?? '').startsWith('Dive Hub test')) {
    await client.save(access, buildUpdateRecord(stored, { ...dive, notes: NOTES }));
    log('  notes put back so that finish can delete the dive');
  }
  return id;
}

/** Deletes the test dive and checks it is gone from the logbook. */
export async function finishClearChecks(o: Pick<ClearChecks, 'client' | 'access' | 'log'>, id: string): Promise<void> {
  const stored = await findIn(o, id);
  if (!stored) {
    o.log(`SSI dive ${id}: not in the logbook`);
    return;
  }
  if (!String(stored.odin_user_log_comment ?? '').startsWith('Dive Hub test')) {
    o.log(`SSI dive ${id}: is not a Dive Hub test dive, left alone (delete it in the app)`);
    return;
  }
  await o.client.save(o.access, buildDeleteRecord(stored));
  o.log(`SSI dive ${id}: ${(await findIn(o, id)) ? 'still there after deleting, delete it in the app' : 'deleted'}`);
}
