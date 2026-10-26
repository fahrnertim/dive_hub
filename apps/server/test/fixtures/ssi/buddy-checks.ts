// The owner's checks of SSI's buddy list, run by `round-trip.ts buddy …` (piece 5, buddies). Each step is announced
// in the session before it runs. Test entries are named "Dive Hub" / "test…"; the test dive is dated 2000-01-01 with
// notes "Dive Hub test", on the existing private test site. Output: key names, value types, entry IDs and yes/no only,
// never a real person's name, e-mail or account. Everything SSI answers goes to samples/private/ssi/buddies*.json
// (git-ignored): it holds the owner's buddy list.
//
// What the app sends (5.0.43 [R]): `save_buddy` with its whole buddy row as `json_data` (keys of `Buddy.toJson`), and it
// reads the saved entry back from `result.buddy`. The account of the buddy is `master_id` in that row.
import type { SsiClient } from '../../../src/providers/ssi/ssi-client.js';
import { createRecord, deleteRecord, withBuddies, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';
import { findDive, makeAsk, outcome, VISIBLE_SITE_ID, type Ask, type Raw } from './site-checks.js';

type Row = Record<string, unknown>;
type Log = (line: string) => void;

const FIRST = 'Dive Hub';
const TEST_DATE = '2000-01-01';
const NOTES = 'Dive Hub test';
const isObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the checks keep between steps, in samples/private/ssi/buddies.json. */
export interface BuddySaved {
  /** The list as `get_buddies` gave it before anything was written (the copy to restore from). */
  before: Row[];
  /** How the list writes its flags (`deleted`, `favorite`, …): the checks send them the same way. */
  flagStyle: 'boolean' | 'number' | 'string';
  withEmail?: string | undefined;
  nameOnly?: string | undefined;
  diveId?: string;
  /** Step `account`: the existing entry whose account was given to the e-mail entry, and its row before. */
  accountFrom?: { entryId: string; row: Row };
}

/** The keys of the app's buddy row (`Buddy.toJson`, without `internalPk`), in its order. */
const APP_KEYS = [
  'id', 'localRefId', 'address', 'dob', 'comment', 'added', 'email', 'firstname', 'gender', 'image', 'lastname', 'leader_nr',
  'leader_active', 'master_id', 'nickname', 'phone', 'deleted', 'needsUpload', 'confirmed', 'favorite',
] as const;
const FLAGS = new Set(['leader_active', 'deleted', 'needsUpload', 'confirmed', 'favorite']);

function flag(style: BuddySaved['flagStyle'], on: boolean) {
  if (style === 'number') return on ? 1 : 0;
  if (style === 'string') return on ? '1' : '0';
  return on;
}

/** A new or changed entry as the app sends it: the given values, the rest from `base` (an entry SSI returned) or empty. */
function appRow(style: BuddySaved['flagStyle'], values: Row, base: Row = {}): Row {
  const row: Row = {};
  for (const key of APP_KEYS) {
    if (key in values) row[key] = values[key];
    else if (key in base) row[key] = base[key];
    else row[key] = FLAGS.has(key) ? flag(style, false) : null;
  }
  row.needsUpload = flag(style, true);
  return row;
}

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array'
  : typeof v === 'string' && /^\d+$/.test(v) ? 'string(digits)' : typeof v === 'string' && v === '' ? 'string(empty)' : typeof v);

/** Per key, which value types occur in the list (never the values). */
function typesOf(rows: Row[]) {
  const types = new Map<string, Set<string>>();
  for (const row of rows) for (const [k, v] of Object.entries(row)) {
    if (!types.has(k)) types.set(k, new Set());
    types.get(k)!.add(typeOf(v));
  }
  return [...types].map(([k, s]) => `${k}: ${[...s].join('|')}`);
}

const has = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== 0 && v !== '0';
/** One entry without personal data: its ID, whether it has an account and an e-mail, its flags. */
const safe = (row: Row) => `entry ${String(row.id)}: account ${has(row.master_id) || has(row.buddy_master_id) ? 'yes' : 'no'}, e-mail ${has(row.email) ? 'yes' : 'no'}`
  + `, deleted ${JSON.stringify(row.deleted)}, confirmed ${JSON.stringify(row.confirmed)}`;
/** A test entry in full; one that carries an account holds a real person's details then, so only its key names. */
const shown = (row: Row) => (has(row.master_id) || has(row.buddy_master_id) ? `(an account's entry) keys ${Object.keys(row).join(', ')}` : JSON.stringify(row));

async function list(ask: Ask, log: Log, label: string): Promise<Row[]> {
  const r = await ask('get_buddies', {});
  const rows = Array.isArray(r.data?.user_buddies) ? r.data.user_buddies.filter(isObject) : [];
  log(`  get_buddies ${label}: ${outcome(r)}; keys ${r.data ? Object.keys(r.data).join(', ') : '-'}; ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`);
  if (r.error) throw new Error(`get_buddies failed (${r.error})`);
  return rows;
}

/** The entry in `save_buddy`'s answer: `result.buddy`, an array of one (checked 2026-10-27). */
const savedEntry = (data: Row | null): Row | null => {
  const buddy = isObject(data?.result) ? data.result.buddy : null;
  const first: unknown = Array.isArray(buddy) ? buddy[0] : buddy;
  return isObject(first) ? first : null;
};
const byId = (rows: Row[], id: string | undefined) => (id ? rows.find((row) => String(row.id) === id) : undefined);
const isTest = (row: Row | undefined) => row !== undefined && row.firstname === FIRST && String(row.lastname ?? '').startsWith('test');

/** `buddy read`: the list (read-only), its key names and value types; keeps a copy to restore from. */
export async function runBuddyRead(o: { access: string; log: Log }): Promise<BuddySaved> {
  const ask = makeAsk(o.access);
  const rows = await list(ask, o.log, 'before');
  for (const line of typesOf(rows)) o.log(`    ${line}`);
  for (const row of rows) o.log(`    ${safe(row)}`);
  const deleted = rows.map((row) => row.deleted).find((v) => v !== null && v !== undefined);
  const flagStyle = typeof deleted === 'number' ? 'number' : typeof deleted === 'string' ? 'string' : 'boolean';
  o.log(`  flags are written as ${flagStyle}s; the checks send them so`);
  // The dive read's list, to compare: is it the same list?
  const book = await ask('get_divelog', {});
  const fromLogbook = Array.isArray(book.data?.logbook_buddies) ? book.data.logbook_buddies.filter(isObject) : [];
  const same = fromLogbook.length === rows.length && fromLogbook.every((b) => byId(rows, String(b.id)));
  o.log(`  get_divelog's logbook_buddies: ${fromLogbook.length} entries; ${same ? 'the same IDs' : 'NOT the same IDs'} as get_buddies`);
  return { before: rows, flagStyle };
}

/** `buddy search <text>` (read-only): what `search_buddy` answers, and whether it finds accounts outside the list. */
export async function runBuddySearch(o: { access: string; text: string; saved: BuddySaved; log: Log }): Promise<unknown> {
  const raw: Raw = {};
  const r = await makeAsk(o.access, raw)('search_buddy', { string: o.text });
  o.log(`  search_buddy: ${outcome(r)}; content-type ${raw.contentType ?? '-'}; ${raw.text?.length ?? 0} characters`);
  let body: unknown;
  try {
    body = JSON.parse(raw.text ?? '');
  } catch {
    o.log('  the answer is not JSON');
    return { status: raw.status, text: raw.text };
  }
  // The results may be the answer itself, or one list inside it.
  const results = Array.isArray(body) ? body : isObject(body) ? Object.values(body).find(Array.isArray) ?? [] : [];
  o.log(`  shape: ${Array.isArray(body) ? 'array' : isObject(body) ? `object with keys ${Object.keys(body).join(', ')}` : typeof body}; ${results.length} result(s)`);
  const rows = results.filter(isObject);
  for (const line of typesOf(rows)) o.log(`    ${line}`);
  const accounts = new Set(o.saved.before.flatMap((b) => [b.master_id, b.buddy_master_id]).filter(has).map(String));
  const accountOf = (row: Row) => [row.master_id, row.buddy_master_id, row.mid, row.user_master_id].find(has);
  const inList = rows.filter((row) => accounts.has(String(accountOf(row)))).length;
  const withAccount = rows.filter((row) => accountOf(row) !== undefined).length;
  o.log(`  ${withAccount} result(s) carry an account; ${inList} of them are in your list, ${withAccount - inList} are not`);
  return body;
}

/** `buddy add`: one entry with name and e-mail but no account, one with a name only; what SSI answers and keeps. */
export async function runBuddyAdd(o: { access: string; email: string; saved: BuddySaved; log: Log }): Promise<BuddySaved> {
  const ask = makeAsk(o.access);
  const style = o.saved.flagStyle;
  const saved = { ...o.saved };
  const add = async (label: string, values: Row) => {
    const r = await ask('save_buddy', {}, appRow(style, { id: null, localRefId: null, firstname: FIRST, ...values }));
    const result = isObject(r.data?.result) ? r.data.result : null;
    const entry = savedEntry(r.data);
    o.log(`  save_buddy ${label}: ${outcome(r)}; answer keys ${r.data ? Object.keys(r.data).join(', ') : '-'}`
      + `${result ? `; result keys ${Object.keys(result).join(', ')}` : ''}`);
    if (r.data && !entry) o.log(`    answer: ${JSON.stringify(r.data).slice(0, 600)}`);
    if (entry) o.log(`    result.buddy: ${shown(entry)}`);
    return entry?.id !== undefined && entry.id !== null ? String(entry.id) : null;
  };
  const known = new Set(o.saved.before.map((b) => String(b.id)));
  saved.withEmail = (await add('name and e-mail', { lastname: 'test e-mail', email: o.email })) ?? undefined;
  saved.nameOnly = (await add('name only', { lastname: 'test name only' })) ?? undefined;
  const after = await list(ask, o.log, 'after');
  // An answer without an ID: the new entries are found in the list by name.
  for (const [key, lastname] of [['withEmail', 'test e-mail'], ['nameOnly', 'test name only']] as const) {
    saved[key] ??= after.find((b) => !known.has(String(b.id)) && b.firstname === FIRST && b.lastname === lastname)?.id?.toString();
    const row = byId(after, saved[key]);
    o.log(row ? `  ${lastname}: IS in the list as ${shown(row)}` : `  ${lastname}: is NOT in the list`);
  }
  o.log(`  entries not in the list before: ${after.filter((b) => !known.has(String(b.id))).map((b) => String(b.id)).join(', ') || 'none'}`);
  return saved;
}

/** `buddy update`: the e-mail entry sent again with another last name; is it the same entry, with the new name? */
export async function runBuddyUpdate(o: { access: string; saved: BuddySaved; log: Log }): Promise<void> {
  const ask = makeAsk(o.access);
  const current = byId(await list(ask, o.log, 'before'), o.saved.withEmail);
  if (!isTest(current)) throw new Error(`Refused: entry ${o.saved.withEmail ?? '-'} is not a test entry in the list.`);
  const r = await ask('save_buddy', {}, appRow(o.saved.flagStyle, { lastname: 'test updated' }, current));
  const entry = savedEntry(r.data);
  o.log(`  save_buddy update: ${outcome(r)}; result.buddy ${entry ? `id ${String(entry.id)}, lastname ${JSON.stringify(entry.lastname)}` : '-'}`);
  const after = await list(ask, o.log, 'after');
  const row = byId(after, o.saved.withEmail);
  o.log(row ? `  entry ${o.saved.withEmail}: lastname now ${JSON.stringify(row.lastname)}` : `  entry ${o.saved.withEmail} is NOT in the list any more`);
  o.log(`  entries named "${FIRST}": ${after.filter((b) => b.firstname === FIRST).length}`);
}

const testDive = (): DiveForSsi => ({
  startsAt: new Date(`${TEST_DATE}T12:00:00Z`), utcOffsetSeconds: 0, durationSeconds: 60, maxDepthM: 1, avgDepthM: 0.5,
  waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes: NOTES,
  siteSsiId: VISIBLE_SITE_ID, participants: [], entry: null, exit: null, gases: [{ o2: 21, he: 0 }], gfLow: null, gfHigh: null,
  cnsStart: null, cnsEnd: null, device: null, cylinder: null, leadKg: null, diveMode: null, surfaceIntervalSeconds: null, avgHeartRate: null,
  samples: { depth: { offsetsMs: [0, 20_000, 40_000, 60_000], values: [0, 1, 1, 0] }, temperature: { offsetsMs: [0], values: [20] } },
});

/** `buddy dive`: a test dive with both test entries as buddies; which IDs SSI keeps on it. */
export async function runBuddyDive(o: { client: SsiClient; access: string; accountId: string; saved: BuddySaved; log: Log }): Promise<BuddySaved> {
  const ids = [o.saved.withEmail, o.saved.nameOnly].filter((id): id is string => id !== undefined).map(Number);
  if (ids.length === 0) throw new Error('No test entries: run `buddy add` first.');
  const before = await o.client.logbook(o.access);
  const number = Math.max(0, ...before.dives.map((d) => Number(d.odin_user_log_nr) || 0)) + 1;
  const record = withBuddies(createRecord(testDive(), { number, accountId: o.accountId, reference: 'divehub-buddy-test' }), ids);
  const { id } = await o.client.save(o.access, record);
  const stored = await findDive(o.client, o.access, id);
  o.log(`created SSI dive ${id} as number ${number}; sent buddy IDs ${JSON.stringify(ids)}; stored ${stored ? JSON.stringify(stored.odin_user_log_buddy_ids) : '(dive NOT in the logbook)'}`);
  o.log('Look in the MySSI app: both test entries in the buddy list, and on the dive. Then run `buddy account <entry ID>`.');
  return { ...o.saved, diveId: id };
}

/**
 * `buddy account <entry ID>`: the e-mail test entry gets the account of an existing entry. Is it kept on the test
 * entry, and is the existing entry unchanged? Its row before is kept, to restore it with `buddy restore`.
 */
export async function runBuddyAccount(o: { access: string; who: string; saved: BuddySaved; log: Log }): Promise<BuddySaved> {
  const ask = makeAsk(o.access);
  const rows = await list(ask, o.log, 'before');
  const test = byId(rows, o.saved.withEmail);
  // An entry ID, or the entry's first and last name, ignoring case (SSI keeps some in lower case; found here, never printed).
  const named = rows.filter((b) => `${String(b.firstname ?? '')} ${String(b.lastname ?? '')}`.trim().toLowerCase() === o.who.trim().toLowerCase());
  const real = /^\d+$/.test(o.who) ? byId(rows, o.who) : named.length === 1 ? named[0] : undefined;
  if (!isTest(test)) throw new Error(`Refused: entry ${o.saved.withEmail ?? '-'} is not a test entry in the list.`);
  if (!real || isTest(real)) throw new Error(`Refused: no single existing entry of your list is "${o.who}" (${named.length} by that name).`);
  const entryId = String(real.id);
  const account = real.master_id ?? real.buddy_master_id;
  if (!has(account)) throw new Error(`Refused: entry ${entryId} has no account.`);
  const saved = { ...o.saved, accountFrom: { entryId: entryId, row: real } };
  const r = await ask('save_buddy', {}, appRow(o.saved.flagStyle, { master_id: account }, test));
  const entry = savedEntry(r.data);
  o.log(`  save_buddy with an account: ${outcome(r)}; result.buddy ${entry ? `id ${String(entry.id)}; ${shown(entry)}` : `- (answer ${JSON.stringify(r.data).slice(0, 300)})`}`);
  const after = await list(ask, o.log, 'after');
  o.log(`  test entry ${o.saved.withEmail}: ${testEntryAfter(byId(after, o.saved.withEmail), String(account))}`);
  o.log(`  existing entry ${entryId}: ${realEntryAfter(real, byId(after, entryId))}`);
  o.log(`  entries with that account: ${after.filter((b) => String(b.master_id ?? b.buddy_master_id) === String(account)).map((b) => String(b.id)).join(', ')}`);
  return saved;
}

function testEntryAfter(row: Row | undefined, account: string) {
  if (!row) return 'is NOT in the list any more';
  const kept = String(row.master_id ?? row.buddy_master_id) === account;
  const state = kept ? 'SET to that account' : has(row.master_id) ? 'set to ANOTHER account' : 'not set';
  return `account ${state}; names now ${JSON.stringify([row.firstname, row.lastname])}`;
}

/** Which keys of a row differ from the copy taken before (null: the entry is gone). */
const changedKeys = (before: Row, after: Row | undefined) =>
  after ? Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])) : null;

function realEntryAfter(before: Row, after: Row | undefined) {
  const changed = changedKeys(before, after);
  if (changed === null) return 'is NOT in the list any more';
  return changed.length ? `CHANGED in: ${changed.join(', ')} (run \`buddy restore\`)` : 'unchanged';
}

/** `buddy restore`: the existing entry of step `account` saved back as it was, only if it changed. */
export async function runBuddyRestore(o: { access: string; saved: BuddySaved; log: Log }): Promise<void> {
  const from = o.saved.accountFrom;
  if (!from) throw new Error('Nothing to restore: `buddy account` did not run.');
  const ask = makeAsk(o.access);
  const now = byId(await list(ask, o.log, 'before'), from.entryId);
  if (now && Object.keys(from.row).every((k) => JSON.stringify(from.row[k]) === JSON.stringify(now[k]))) {
    o.log(`  entry ${from.entryId} is as it was; nothing to restore`);
    return;
  }
  const r = await ask('save_buddy', {}, appRow(o.saved.flagStyle, {}, from.row));
  o.log(`  save_buddy restore: ${outcome(r)}`);
  const after = byId(await list(ask, o.log, 'after'), from.entryId);
  const still = after ? Object.keys(from.row).filter((k) => JSON.stringify(from.row[k]) !== JSON.stringify(after[k])) : null;
  o.log(still === null ? `  entry ${from.entryId} is NOT in the list` : still.length ? `  entry ${from.entryId} still differs in: ${still.join(', ')}` : `  entry ${from.entryId} restored`);
}

/** `buddy finish`: deletes the test dive, then the test entries (sent with `deleted` set); are they gone? */
export async function runBuddyFinish(o: { client: SsiClient; access: string; saved: BuddySaved; log: Log }): Promise<void> {
  if (o.saved.diveId) await deleteTestDive(o.client, o.access, o.saved.diveId, o.log);
  await deleteTestEntries(o);
}

async function deleteTestDive(client: SsiClient, access: string, id: string, log: Log) {
  const stored = await findDive(client, access, id);
  if (!stored) {
    log(`dive ${id} is not in the logbook (already gone)`);
    return;
  }
  const dated = String(stored.odin_user_log_date ?? stored.odin_user_log_datetime ?? '').startsWith(TEST_DATE);
  if (String(stored.odin_user_log_comment ?? '') !== NOTES || !dated) throw new Error(`Refused: dive ${id} is not a test dive.`);
  await client.save(access, deleteRecord(stored));
  log(await findDive(client, access, id) ? `dive ${id} is STILL there` : `dive ${id} is gone`);
}

/**
 * Takes the account given in step `account` off a test entry before it is deleted, so the delete can't reach the real
 * person's entry; stops (false) if that entry is gone or the account stayed.
 */
async function unlinked(ask: Ask, o: { saved: BuddySaved; log: Log }, row: Row): Promise<boolean> {
  const r = await ask('save_buddy', {}, appRow(o.saved.flagStyle, { master_id: 0 }, row));
  const rows = await list(ask, o.log, 'after taking the account off');
  const test = byId(rows, String(row.id));
  const realId = o.saved.accountFrom?.entryId;
  o.log(`  save_buddy without the account: ${outcome(r)}; test entry account now ${has(test?.master_id) ? 'STILL set' : 'off'}`
    + `${realId ? `; existing entry ${realId} ${byId(rows, realId) ? 'still listed' : 'NOT listed'}` : ''}`);
  if (has(test?.master_id) || (realId && !byId(rows, realId))) {
    o.log(`  entry ${String(row.id)} not deleted: look at the list in SSI's app first`);
    return false;
  }
  return true;
}

async function deleteTestEntries(o: { access: string; saved: BuddySaved; log: Log }) {
  const ask = makeAsk(o.access);
  const rows = await list(ask, o.log, 'before');
  for (const id of [o.saved.withEmail, o.saved.nameOnly]) {
    const row = byId(rows, id);
    if (!row) { o.log(`  entry ${id ?? '-'}: not in the list`); continue; }
    // A test entry is one the checks made: not in the list before them (step `account` may have given it a real name).
    if (o.saved.before.some((b) => String(b.id) === id)) { o.log(`  entry ${id}: was in the list before the checks; left alone`); continue; }
    if (has(row.master_id) && !(await unlinked(ask, o, row))) continue;
    const r = await ask('save_buddy', {}, appRow(o.saved.flagStyle, { master_id: 0, deleted: flag(o.saved.flagStyle, true) }, row));
    o.log(`  save_buddy delete ${String(row.id)}: ${outcome(r)}`);
  }
  const after = await list(ask, o.log, 'after');
  for (const id of [o.saved.withEmail, o.saved.nameOnly]) {
    const row = byId(after, id);
    o.log(row ? `  entry ${id}: STILL listed (deleted ${JSON.stringify(row.deleted)})` : `  entry ${id}: gone from the list`);
  }
  if (o.saved.accountFrom) {
    const real = byId(after, o.saved.accountFrom.entryId);
    o.log(real ? `  existing entry ${o.saved.accountFrom.entryId} is still listed` : `  existing entry ${o.saved.accountFrom.entryId} is NOT listed: run \`buddy restore\``);
  }
}
