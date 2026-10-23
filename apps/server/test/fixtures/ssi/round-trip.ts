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
// write, number, omitted and expired sign in when SSI_EMAIL and SSI_PASSWORD are set, else use the token kept by "read".
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { runNumberChecks } from './number-checks.js';
import { userAgent } from '../../../src/sites/import/polite-http.js';
import { createSsiClient, SsiError, type SsiRecord } from '../../../src/providers/ssi/ssi-client.js';
import { compareReadBack, createRecord, deleteRecord, updateRecord, writableRecord, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';

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
  cnsStart: null, cnsEnd: null, device: null,
  samples: { depth: { offsetsMs: [0, 20_000, 40_000, 60_000], values: [0, 1, 1, 0] }, temperature: { offsetsMs: [0], values: [20] } },
});

await mkdir(out, { recursive: true });

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
  const sent = createRecord(dive, { number, accountId: account.accountId, reference: 'divehub-round-trip-test' });
  const { id } = await client.save(account.token, sent);
  console.log(`created SSI dive ${id} as number ${number}`);
  const find = async () => (await client.logbook(account.token)).dives.find((d) => String(d.odin_user_log_id) === id);
  const stored = await find();
  await save('created', stored ?? null);
  console.log(stored ? `read back: ${JSON.stringify(compareReadBack(sent, stored))}` : 'read back: not found');
  await wait('Look at the dive in the MySSI app (pull to refresh): listed as unconfirmed? Does it open, with the chart? Does the list stay?');
  const updated = updateRecord(stored as SsiRecord, { ...dive, notes: 'Dive Hub test – updated, delete me' });
  await client.save(account.token, updated);
  await save('updated', (await find()) ?? null);
  await wait('Check the notes changed in the app.');
  await client.save(account.token, deleteRecord((await find()) as SsiRecord));
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
  const { id } = await client.save(account.token, createRecord(dive, { number, accountId: account.accountId, reference: 'divehub-omitted-test' }));
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
  await client.save(account.token, updateRecord(stored, { ...testDive('Dive Hub test – updated'), notes: 'Dive Hub test – updated' }));
  const after = await find();
  await save('omitted-after', after ?? null);
  console.log(`gear note set after the update: ${gearSet(after) ? 'yes' : 'no'}`);
  await client.save(account.token, deleteRecord((after ?? stored) as SsiRecord));
  console.log((await find()) ? 'still there' : 'deleted');
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
  console.log('Usage: round-trip.ts read | token | write [--pause] | number [--pause] | number --dive <SSI dive ID> --to <n> | omitted start | omitted finish | expired');
}
