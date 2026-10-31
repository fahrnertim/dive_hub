// The owner's checks against the real SSI with their own account (ADR 0024, research note "Checks for the owner").
// Run by hand only; tests never reach SSI. Everything it writes goes to samples/private/ssi/ (git-ignored):
// SSI's answers contain personal data. Nothing here prints the password or the token.
//
//   SSI_EMAIL=… SSI_PASSWORD=… pnpm --filter @dive-hub/server exec tsx test/fixtures/ssi/round-trip.ts read
//     signs in, reads the logbook, saves the answers; and keeps the token to check its age later
//   … round-trip.ts token
//     tries the kept token again (no sign-in) and says how old it is: run after 1 h, 1 day, 1 week
//   … round-trip.ts write
//     creates a throwaway dive (2000-01-01 12:00, 1 m, 1 min, notes "Dive Hub test"), reads it back, updates
//     its notes, reads back, deletes it. Look at it in the MySSI app between the steps with --pause.
//   … round-trip.ts number [--pause]   (needs SSI_SITE_ID too; ADR 0048, the dive numbers checks)
//     creates throwaway dives in 2000, tries to change a number on an update, to give one number twice on an update
//     and on a create, deletes them and prints which other dives' numbers moved.
//   … round-trip.ts number --dive <SSI dive ID> --to <n>
//     a verified dive, only if you want to risk one: prints ssiOrigin and number, saves it with number n, prints both again.
//   … round-trip.ts omitted start | omitted finish   (needs SSI_SITE_ID for start)
//     start creates a throwaway dive; add a gear note to it in the MySSI app; finish saves an update that leaves the gear
//     note's key out, says whether the note survived (yes/no, never the text), and deletes the dive.
//   … round-trip.ts expired
//     calls get_divelog with the kept token and prints its age, the HTTP status and the answer's key names (no values).
//   … round-trip.ts values start | values finish [<SSI dive ID> <SSI dive ID>]   (needs SSI_SITE_ID for start)
//     start creates two throwaway dives dated 2000-01-02 (10:00 an apnea dive, 14:00 a scuba dive with tank, lead, surface
//     interval, pressure curve, heart rate and CNS), prints their SSI IDs, the read-back comparison and, for each new key,
//     what was sent and what SSI stored (only these two dives). Look at them in the MySSI app, then run finish: it deletes
//     the dives and checks they are gone. The IDs come from the arguments, else from samples/private/ssi/values.json
//     (saved by start); it only deletes a dive whose notes start with "Dive Hub test".
//   … round-trip.ts clear start | clear finish   (needs SSI_SITE_ID for start)
//     start creates one throwaway dive dated 2000-01-03 (lead, tank, average depth, water temperature), updates it up to
//     three times with null, then "", then 0 for those keys and prints, per key, what was sent and what SSI stored (only this
//     dive); the SSI ID goes to samples/private/ssi/clear.json. finish deletes the dive (only if its notes start with
//     "Dive Hub test") and checks it is gone.
//   … round-trip.ts twoway start | send | clear | finish   (needs SSI_SITE_ID for start)
//     start creates one throwaway dive dated 2000-01-04 10:00 (notes "Dive Hub test", lead 6 kg) and keeps its SSI ID and
//     stored record as the base in samples/private/ssi/twoway.json. Change its notes in the MySSI app, then run send:
//     it compares the dive at SSI with the base and the hub (lead 8 kg), prints the lists of the send plan, sends with the
//     plan's leave and prints the stored notes and lead (expected: take notes, the lead goes out). clear sends with the
//     notes removed here and prints the stored notes (expected: none). finish deletes the dive (only if it is a test
//     dive) and checks it is gone.
//   … round-trip.ts site probe   (needs SSI_SITE_ID, a public site; Piece 4, private sites)
//     creates one private site "Dive Hub test" at 0.001, 0.001 with save_divesite, reads it with get_divesite and get_divelog
//     (also a public site and an unknown ID), deletes it with odin_dive_sites_deleted and checks it is gone. Prints key names,
//     HTTP statuses and IDs only; the answers go to samples/private/ssi/site-probe.json. If a step fails the new ID is printed.
//   … round-trip.ts site get <id>     read-only: get_divesite raw (HTTP status, content-type, body length, JSON shape, key names).
//   … round-trip.ts site delete <id>   deletes a leftover site, only one named "Dive Hub test" and private to the account.
//   … round-trip.ts site visible start   (Piece 4: a private site is usable and not visible; the site is the existing test site 1083262)
//     creates one throwaway dive (2000-01-01 12:00, notes "Dive Hub test") on site 1083262 through Dive Hub's own record code;
//     keeps the site ID, the dive ID and the start time in samples/private/ssi/site-visible.json. SSI cannot delete sites.
//   … round-trip.ts site visible global   get_divesites_global from just before start's time, paged to the end: is the site there?
//     Prints the last_sync value and format used; reads only. Also get_divelog's entry for the site.
//   … round-trip.ts site visible zip   downloads APP_CACHE_SITES.zip (no sign-in): is the site in it, when was the file created?
//   … round-trip.ts site visible finish   deletes the dive (only a "Dive Hub test" dive dated 2000-01-01), checks it is gone; the site stays.
//   … round-trip.ts buddy read | search <text> | add | update | dive | account <entry ID or name> | restore | finish   (piece 5)
//     read: get_buddies (read-only), key names and value types, a copy kept to restore from. search: search_buddy
//     (read-only), how many results and how many are outside the list. add (needs BUDDY_TEST_EMAIL): one entry with name
//     and e-mail, one with a name only. update: the e-mail entry gets another last name. dive: a 2000-01-01 test dive with
//     both. account: the e-mail entry gets the account of an existing entry; is that entry unchanged? restore: puts it
//     back if not. finish: deletes the dive and the test entries. See buddy-checks.ts.
//   … round-trip.ts answer   (piece 7, fewer reads; the site is the test site 1083262 unless SSI_SITE_ID is set)
//     what SSI's save answers: creates and updates a throwaway dive (2000-01-05 12:00, "Dive Hub test") as the app, then
//     creates one (14:00) with another User-Agent (ADR 0049); prints whether each answer carries result.dive with samples,
//     how it compares with what was sent and with the logbook, whether the foreign create was stored; deletes the test dives.
// write, number, omitted, values, clear, twoway, site, buddy, answer and expired sign in when SSI_EMAIL and SSI_PASSWORD are set, else use the token kept by "read".
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { finishClearChecks, startClearChecks } from './clear-checks.js';
import { finishTwoway, sendTwoway, startTwoway, type TwowaySaved } from './twoway-checks.js';
import {
  runSiteDelete, runSiteGet, runSiteProbe, runSiteVisibleFinish, runSiteVisibleGlobal, runSiteVisibleStart, runSiteVisibleZip,
  type SiteVisibleSaved,
} from './site-checks.js';
import { runNumberChecks } from './number-checks.js';
import {
  runBuddyAccount, runBuddyAdd, runBuddyCreate, runBuddyDive, runBuddyFinish, runBuddyRead, runBuddyRestore, runBuddySearch, runBuddyUpdate,
  type BuddySaved,
} from './buddy-checks.js';
import { finishValuesChecks, startValuesChecks } from './values-checks.js';
import { runAnswerChecks } from './answer-checks.js';
import { userAgent } from '../../../src/sites/import/polite-http.js';
import { createSsiClient, SsiError, type SsiRecord } from '../../../src/providers/ssi/ssi-client.js';
import { compareReadBack, buildCreateRecord, buildDeleteRecord, buildUpdateRecord, writableRecord, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';

const out = fileURLToPath(new URL('../../../../../samples/private/ssi/', import.meta.url));
const tokenFile = `${out}token.json`;
const mode = process.argv[2];
const pause = process.argv.includes('--pause');
const client = createSsiClient({});
const save = async (name: string, value: unknown) => {
  await writeFile(`${out}${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`  saved samples/private/ssi/${name}.json`);
};
const wait = async (what: string) => {
  if (!pause) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`  ${what} Press Enter to go on.`);
  rl.close();
};

async function signIn() {
  const email = process.env.SSI_EMAIL;
  const password = process.env.SSI_PASSWORD;
  if (!email || !password) throw new Error('Set SSI_EMAIL and SSI_PASSWORD');
  const account = await client.signIn(email, password);
  console.log(`signed in: SSI account ${account.accountId}`);
  return account;
}

/** Signs in when SSI_EMAIL and SSI_PASSWORD are set, else uses the token (and account ID) that "read" kept. */
async function access() {
  if (process.env.SSI_EMAIL && process.env.SSI_PASSWORD) return signIn();
  let kept: { token?: string; accountId?: string };
  try {
    kept = JSON.parse(await readFile(tokenFile, 'utf8')) as typeof kept;
  } catch {
    throw new Error('Set SSI_EMAIL and SSI_PASSWORD, or run "read" first to keep a token');
  }
  if (!kept.token || !kept.accountId) throw new Error('The kept token has no account ID: run "read" again');
  console.log(`using the kept token: SSI account ${kept.accountId}`);
  return { token: kept.token, accountId: kept.accountId };
}

const testDive = (notes: string): DiveForSsi => ({
  startsAt: new Date('2000-01-01T12:00:00Z'), utcOffsetSeconds: 0, durationSeconds: 60, maxDepthM: 1, avgDepthM: 0.5,
  waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes,
  siteSsiId: process.env.SSI_SITE_ID ?? '', participants: [], entry: null, exit: null, gases: [{ o2: 21, he: 0 }], gfLow: null, gfHigh: null,
  cnsStart: null, cnsEnd: null, device: null, cylinder: null, leadKg: null, diveMode: null, surfaceIntervalSeconds: null, avgHeartRate: null,
  samples: { depth: { offsetsMs: [0, 20_000, 40_000, 60_000], values: [0, 1, 1, 0] }, temperature: { offsetsMs: [0], values: [20] } },
});

await mkdir(out, { recursive: true });

/** The buddy checks (piece 5); each step keeps what the next needs in samples/private/ssi/buddies.json. */
async function buddyMode(step: string | undefined, arg: string) {
  const account = await access();
  const o = { client, access: account.token, accountId: account.accountId, log: console.log };
  const kept = async () => JSON.parse(await readFile(`${out}buddies.json`, 'utf8')) as BuddySaved;
  if (step === 'read') await save('buddies', await runBuddyRead(o));
  else if (step === 'search' && arg) await save('buddies-search', await runBuddySearch({ ...o, text: arg, saved: await kept() }));
  else if (step === 'add') {
    const email = process.env.BUDDY_TEST_EMAIL;
    if (!email) throw new Error('Set BUDDY_TEST_EMAIL: the e-mail of the test entry');
    await save('buddies', await runBuddyAdd({ ...o, email, saved: await kept() }));
  } else if (step === 'update') await runBuddyUpdate({ ...o, saved: await kept() });
  else if (step === 'dive') await save('buddies', await runBuddyDive({ ...o, saved: await kept() }));
  else if (step === 'account' && arg) await save('buddies', await runBuddyAccount({ ...o, who: arg, saved: await kept() }));
  else if (step === 'create' && arg) await runBuddyCreate({ ...o, who: arg, saved: await kept() });
  else if (step === 'restore') await runBuddyRestore({ ...o, saved: await kept() });
  else if (step === 'finish') await runBuddyFinish({ ...o, saved: await kept() });
  else throw new Error('buddy read | search <text> | add | update | dive | account <entry ID or name> | create <entry ID or name> | restore | finish');
}

if (mode === 'read') {
  const account = await signIn();
  await writeFile(tokenFile, JSON.stringify({ token: account.token, accountId: account.accountId, at: new Date().toISOString() }));
  const logbook = await client.logbook(account.token);
  console.log(`logbook: ${logbook.dives.length} dives, ${logbook.sites.length} sites`);
  await save('logbook', logbook);
} else if (mode === 'token') {
  const { token, at } = JSON.parse(await readFile(tokenFile, 'utf8')) as { token: string; at: string };
  const hours = ((Date.now() - Date.parse(at)) / 3_600_000).toFixed(1);
  try {
    await client.logbook(token);
    console.log(`the token from ${at} (${hours} h ago) still works`);
  } catch (error) {
    console.log(`the token from ${at} (${hours} h ago) no longer works: ${(error as Error).message}`);
  }
} else if (mode === 'write') {
  const account = await access();
  const dive = testDive('Dive Hub test – delete me');
  if (!dive.siteSsiId) throw new Error('Set SSI_SITE_ID to a site ID from your SSI logbook (see logbook.json after "read")');
  const before = await client.logbook(account.token);
  const number = Math.max(0, ...before.dives.map((d) => Number(d.odin_user_log_nr) || 0)) + 1;
  const sent = buildCreateRecord(dive, { number, accountId: account.accountId, reference: 'divehub-round-trip-test' });
  const { id } = await client.save(account.token, sent);
  console.log(`created SSI dive ${id} as number ${number}`);
  const find = async () => (await client.logbook(account.token)).dives.find((d) => String(d.odin_user_log_id) === id);
  const stored = await find();
  await save('created', stored ?? null);
  console.log(stored ? `read back: ${JSON.stringify(compareReadBack(sent, stored))}` : 'read back: not found');
  await wait('Look at the dive in the MySSI app (pull to refresh): listed as unconfirmed? Does it open, with the chart? Does the list stay?');
  const updated = buildUpdateRecord(stored as SsiRecord, { ...dive, notes: 'Dive Hub test – updated, delete me' });
  await client.save(account.token, updated);
  await save('updated', (await find()) ?? null);
  await wait('Check the notes changed in the app.');
  await client.save(account.token, buildDeleteRecord((await find()) as SsiRecord));
  console.log((await find()) ? 'still there after deleting!' : 'deleted');
  await wait('Check the dive is gone from the app.');
} else if (mode === 'number') {
  const account = await access();
  const arg = (name: string) => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  await runNumberChecks({
    client, access: account.token, accountId: account.accountId, siteId: process.env.SSI_SITE_ID, log: console.log, wait,
    ...(arg('--dive') && { dive: { id: arg('--dive')!, to: Number(arg('--to')) } }),
  });
} else if (mode === 'omitted' && process.argv[3] === 'start') {
  const account = await access();
  const dive = testDive('Dive Hub test – delete me');
  if (!dive.siteSsiId) throw new Error('Set SSI_SITE_ID to a site ID from your SSI logbook (see logbook.json after "read")');
  const before = await client.logbook(account.token);
  const number = Math.max(0, ...before.dives.map((d) => Number(d.odin_user_log_nr) || 0)) + 1;
  const { id } = await client.save(account.token, buildCreateRecord(dive, { number, accountId: account.accountId, reference: 'divehub-omitted-test' }));
  await save('omitted', { id });
  console.log(`created SSI dive ${id} as number ${number}`);
  console.log(`Add a gear note to dive ${id} in the MySSI app, then run \`omitted finish\`.`);
} else if (mode === 'omitted' && process.argv[3] === 'finish') {
  const account = await access();
  const { id } = JSON.parse(await readFile(`${out}omitted.json`, 'utf8')) as { id: string };
  const find = async () => (await client.logbook(account.token)).dives.find((d) => String(d.odin_user_log_id) === id);
  const gearSet = (r: SsiRecord | undefined) => {
    const value = r?.odin_user_log_gear_details;
    return value !== undefined && value !== null && value !== '';
  };
  const stored = await find();
  if (!stored) throw new Error(`dive ${id} is not in the logbook`);
  await save('omitted-before', stored);
  console.log(`gear note set before the update: ${gearSet(stored) ? 'yes' : 'no'}`);
  await client.save(account.token, buildUpdateRecord(stored, { ...testDive('Dive Hub test – updated'), notes: 'Dive Hub test – updated' }));
  const after = await find();
  await save('omitted-after', after ?? null);
  console.log(`gear note set after the update: ${gearSet(after) ? 'yes' : 'no'}`);
  await client.save(account.token, buildDeleteRecord((after ?? stored) as SsiRecord));
  console.log((await find()) ? 'still there' : 'deleted');
} else if (mode === 'values' && process.argv[3] === 'start') {
  const account = await access();
  const siteId = process.env.SSI_SITE_ID;
  if (!siteId) throw new Error('Set SSI_SITE_ID to a site ID from your SSI logbook (see logbook.json after "read")');
  const ids = await startValuesChecks({ client, access: account.token, accountId: account.accountId, siteId, log: console.log });
  await save('values', { ids });
  console.log(`Look at SSI dives ${ids.join(' and ')} in the MySSI app (pull to refresh), then run \`values finish\`.`);
} else if (mode === 'values' && process.argv[3] === 'finish') {
  const account = await access();
  const given = process.argv.slice(4).filter((a) => /^\d+$/.test(a));
  const ids = given.length ? given : (JSON.parse(await readFile(`${out}values.json`, 'utf8')) as { ids: string[] }).ids;
  await finishValuesChecks({ client, access: account.token, log: console.log }, ids);
} else if (mode === 'clear' && process.argv[3] === 'start') {
  const account = await access();
  const siteId = process.env.SSI_SITE_ID;
  if (!siteId) throw new Error('Set SSI_SITE_ID to a site ID from your SSI logbook (see logbook.json after "read")');
  const id = await startClearChecks({ client, access: account.token, accountId: account.accountId, siteId, log: console.log });
  await save('clear', { id });
  console.log(`Run \`clear finish\` to delete SSI dive ${id}.`);
} else if (mode === 'clear' && process.argv[3] === 'finish') {
  const account = await access();
  const { id } = JSON.parse(await readFile(`${out}clear.json`, 'utf8')) as { id: string };
  await finishClearChecks({ client, access: account.token, log: console.log }, id);
} else if (mode === 'twoway' && process.argv[3] === 'start') {
  const account = await access();
  const siteId = process.env.SSI_SITE_ID;
  if (!siteId) throw new Error('Set SSI_SITE_ID to a site ID from your SSI logbook (see logbook.json after "read")');
  const saved = await startTwoway({ client, access: account.token, accountId: account.accountId, siteId, log: console.log });
  await save('twoway', saved);
  console.log(`Change the notes of SSI dive ${saved.id} in the MySSI app (for example to "Dive Hub test, changed in the app"), then run \`twoway send\`.`);
} else if (mode === 'twoway' && (process.argv[3] === 'send' || process.argv[3] === 'clear')) {
  const account = await access();
  const saved = JSON.parse(await readFile(`${out}twoway.json`, 'utf8')) as TwowaySaved;
  const next = await sendTwoway({ client, access: account.token, log: console.log }, saved, process.argv[3] === 'send' ? 'Dive Hub test' : null);
  await save('twoway', next);
  console.log(process.argv[3] === 'send' ? 'Next: `twoway clear`.' : 'Check the notes are gone in the MySSI app, then run `twoway finish`.');
} else if (mode === 'twoway' && process.argv[3] === 'finish') {
  const account = await access();
  const { id } = JSON.parse(await readFile(`${out}twoway.json`, 'utf8')) as TwowaySaved;
  await finishTwoway({ client, access: account.token, log: console.log }, id);
} else if (mode === 'site' && process.argv[3] === 'probe') {
  const account = await access();
  const siteId = process.env.SSI_SITE_ID;
  if (!siteId) throw new Error('Set SSI_SITE_ID to a public site ID from your SSI logbook (see logbook.json after "read")');
  await save('site-probe', await runSiteProbe({ access: account.token, accountId: account.accountId, siteId, log: console.log }));
} else if (mode === 'site' && process.argv[3] === 'get' && /^\d+$/.test(process.argv[4] ?? '')) {
  const account = await access();
  await runSiteGet({ access: account.token, id: process.argv[4]!, log: console.log });
} else if (mode === 'site' && process.argv[3] === 'delete' && /^\d+$/.test(process.argv[4] ?? '')) {
  const account = await access();
  await save('site-delete', await runSiteDelete({ access: account.token, accountId: account.accountId, id: process.argv[4]!, log: console.log }));
} else if (mode === 'site' && process.argv[3] === 'visible' && process.argv[4] === 'start') {
  const account = await access();
  await save('site-visible', await runSiteVisibleStart({ client, access: account.token, accountId: account.accountId, log: console.log }));
  console.log('Look at the dive in the MySSI app (the site shows on it), then run `site visible global`.');
} else if (mode === 'site' && process.argv[3] === 'visible' && process.argv[4] === 'global') {
  const account = await access();
  const saved = JSON.parse(await readFile(`${out}site-visible.json`, 'utf8')) as SiteVisibleSaved;
  await save('site-visible-global', await runSiteVisibleGlobal({ access: account.token, saved, log: console.log }));
} else if (mode === 'site' && process.argv[3] === 'visible' && process.argv[4] === 'zip') {
  const saved = JSON.parse(await readFile(`${out}site-visible.json`, 'utf8')) as SiteVisibleSaved;
  await save('site-visible-zip', await runSiteVisibleZip({ saved, log: console.log }));
} else if (mode === 'site' && process.argv[3] === 'visible' && process.argv[4] === 'finish') {
  const account = await access();
  const saved = JSON.parse(await readFile(`${out}site-visible.json`, 'utf8')) as SiteVisibleSaved;
  await runSiteVisibleFinish({ client, access: account.token, saved, log: console.log });
} else if (mode === 'buddy') {
  await buddyMode(process.argv[3], process.argv.slice(4).join(' '));
} else if (mode === 'answer') {
  const account = await access();
  await save('answer', await runAnswerChecks({ access: account.token, accountId: account.accountId, siteId: process.env.SSI_SITE_ID ?? '1083262', log: console.log }));
} else if (mode === 'expired') {
  const { token, at } = JSON.parse(await readFile(tokenFile, 'utf8')) as { token: string; at: string };
  const hours = ((Date.now() - Date.parse(at)) / 3_600_000).toFixed(1);
  const seen: { httpStatus?: number; keys?: string[]; status?: unknown; authenticated?: unknown } = {};
  const spy = createSsiClient({
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      const text = await response.text();
      seen.httpStatus = response.status;
      try {
        const data = JSON.parse(text) as Record<string, unknown>;
        seen.keys = Object.keys(data);
        seen.status = data.status;
        seen.authenticated = data.authenticated;
      } catch { /* not JSON: only the HTTP status is kept */ }
      return new Response(text, { status: response.status, headers: response.headers });
    },
  });
  let outcome = 'accepted';
  try {
    await spy.logbook(token);
  } catch (error) {
    outcome = error instanceof SsiError ? error.reason : 'error';
  }
  const result = { tokenAt: at, ageHours: Number(hours), outcome, ...seen };
  console.log(`token from ${at} (${hours} h old): ${outcome}; HTTP ${seen.httpStatus}; keys: ${(seen.keys ?? []).join(', ')}; `
    + `status: ${JSON.stringify(seen.status)}; authenticated: ${JSON.stringify(seen.authenticated)}`);
  await save('expired', result);
} else {
  console.log('Usage: round-trip.ts read | token | write [--pause] | number [--pause] | number --dive <SSI dive ID> --to <n> | omitted start | omitted finish | values start | values finish [<SSI dive ID>…] | clear start | clear finish | twoway start | twoway send | twoway clear | twoway finish | site probe | site get <id> | site delete <id> | site visible start | site visible global | site visible zip | site visible finish | buddy read | buddy search <text> | buddy add | buddy update | buddy dive | buddy account <entry ID or name> | buddy restore | buddy finish | expired');
}
