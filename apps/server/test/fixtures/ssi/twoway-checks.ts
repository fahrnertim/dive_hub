// The owner's check that a change made in SSI's app survives a send and that a removal reaches SSI, run by
// `round-trip.ts twoway start | send | clear | finish`. It writes to the real SSI account: one throwaway dive dated
// 2000-01-04 10:00 (notes "Dive Hub test", lead 6 kg), which `finish` deletes again. It prints only that dive's keys.
// It runs the push service's comparison (`planSend`, no database) with the base saved by `start` and sends with
// `buildUpdateRecord(…, leave)` plus the client's save, as clear-checks.ts does (not through the adapter).
import type { SsiClient, SsiRecord } from '../../../src/providers/ssi/ssi-client.js';
import { contextOf, parseSsiDive } from '../../../src/providers/ssi/ssi-import.js';
import { buildCreateRecord, buildDeleteRecord, buildUpdateRecord, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';
import { comparableOf, planSend, SYNCED_FIELDS, type Comparable } from '../../../src/providers/dive-import/three-way.js';

const NOTES = 'Dive Hub test';
const GAS = { o2: 21, he: 0 };
const twowayDive = (siteSsiId: string): DiveForSsi => ({
  startsAt: new Date('2000-01-04T10:00:00Z'), utcOffsetSeconds: 0, durationSeconds: 1200, maxDepthM: 15, avgDepthM: 8,
  waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes: NOTES, siteSsiId, participants: [], entry: null, exit: null,
  gases: [GAS], gfLow: null, gfHigh: null, cnsStart: null, cnsEnd: null, device: null, cylinder: null,
  leadKg: 6, diveMode: 'open_circuit', surfaceIntervalSeconds: null, avgHeartRate: null,
  samples: { depth: { offsetsMs: [0, 120_000, 600_000, 1_080_000, 1_200_000], values: [0, 15, 15, 5, 0] }, temperature: { offsetsMs: [0], values: [20] } },
});

export interface TwowayChecks {
  client: SsiClient;
  access: string;
  log: (line: string) => void;
}
/** What `start` keeps: the dive's SSI ID and the record SSI stored (the base, as a Push's payload is). */
export interface TwowaySaved { id: string; base: SsiRecord }

const findIn = async (o: Pick<TwowayChecks, 'client' | 'access'>, id: string) =>
  (await o.client.logbook(o.access)).dives.find((d) => String(d.odin_user_log_id) === id);
const show = (v: unknown) => (v === undefined || v === null || v === '' ? 'none' : JSON.stringify(v));
const stateOf = (r: SsiRecord) => `notes ${show(r.odin_user_log_comment)}, lead ${show(r.odin_user_log_weight_kg)} kg`;

/** Creates the test dive and returns what to keep. */
export async function startTwoway(o: TwowayChecks & { accountId: string; siteId: string }): Promise<TwowaySaved> {
  const before = await o.client.logbook(o.access);
  const number = Math.max(0, ...before.dives.map((d) => Number(d.odin_user_log_nr) || 0)) + 1;
  const { id } = await o.client.save(o.access, buildCreateRecord(twowayDive(o.siteId), { number, accountId: o.accountId, reference: 'divehub-twoway-test' }));
  const stored = await findIn(o, id);
  if (!stored) throw new Error(`dive ${id} is not in the logbook`);
  o.log(`created SSI dive ${id} as number ${number}; stored: ${stateOf(stored)}`);
  return { id, base: stored };
}

/**
 * Compares the dive at SSI now with the base and the hub (the base with lead 8 kg, and `hubNotes`), prints the plan,
 * sends with its `leave` (taken fields go out as SSI has them, as the push service takes them first) and prints the
 * stored notes and lead. Returns the record SSI stores now, the next base.
 */
export async function sendTwoway(o: TwowayChecks, saved: TwowaySaved, hubNotes: string | null): Promise<TwowaySaved> {
  const logbook = await o.client.logbook(o.access);
  const context = contextOf(logbook);
  const remote = logbook.dives.find((d) => String(d.odin_user_log_id) === saved.id);
  if (!remote) throw new Error(`dive ${saved.id} is not in the logbook`);
  const provider = parseSsiDive(remote, context, saved.id);
  const baseDive = parseSsiDive(saved.base, context, saved.id);
  if (!provider || !baseDive) throw new Error('the dive could not be read');
  const base = comparableOf(baseDive);
  const hub: Comparable = { ...base, notes: hubNotes, lead: 8 };
  const plan = planSend({ fields: SYNCED_FIELDS, base, provider: comparableOf(provider), hub, choices: {}, open: [], onConflict: 'ask' });
  o.log(`plan: take ${JSON.stringify(plan.take)}, clear ${JSON.stringify(plan.clear)}, keep ${JSON.stringify(plan.keep)}, conflicts ${JSON.stringify(plan.conflicts)}`);
  if (plan.conflicts.length) throw new Error('a conflict: nothing sent');
  const dive: DiveForSsi = { ...twowayDive(String(remote.odin_user_log_dive_sites_id ?? '')), leadKg: 8, notes: hubNotes };
  // A taken field becomes the Dive's here before the send, as the push service does.
  if (plan.take.includes('notes')) dive.notes = provider.notes;
  if (plan.take.includes('lead')) dive.leadKg = provider.leadKg;
  await o.client.save(o.access, buildUpdateRecord(remote, dive, { keep: plan.keep, clear: plan.clear }));
  const after = await findIn(o, saved.id);
  if (!after) throw new Error(`dive ${saved.id} is gone from the logbook`);
  o.log(`stored after the send: ${stateOf(after)}`);
  return { id: saved.id, base: after };
}

/** Deletes the test dive (only if it is one: notes start with "Dive Hub test", or none on the test date) and checks it is gone. */
export async function finishTwoway(o: TwowayChecks, id: string): Promise<void> {
  const stored = await findIn(o, id);
  if (!stored) {
    o.log(`SSI dive ${id}: not in the logbook`);
    return;
  }
  // `clear` removes the notes, so a dive without notes on the test date is still ours.
  const notes = String(stored.odin_user_log_comment ?? '');
  const ours = notes.startsWith(NOTES) || (notes === '' && String(stored.odin_user_log_datetime ?? '').startsWith('2000-01-04'));
  if (!ours) {
    o.log(`SSI dive ${id}: is not a Dive Hub test dive, left alone (delete it in the app)`);
    return;
  }
  await o.client.save(o.access, buildDeleteRecord(stored));
  o.log(`SSI dive ${id}: ${(await findIn(o, id)) ? 'still there after deleting, delete it in the app' : 'deleted'}`);
}
