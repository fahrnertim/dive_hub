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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { userAgent } from '../../../src/sites/import/polite-http.js';
import { createSsiClient, type SsiRecord } from '../../../src/providers/ssi/ssi-client.js';
import { compareReadBack, createRecord, deleteRecord, updateRecord, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';

const out = fileURLToPath(new URL('../../../../../samples/private/ssi/', import.meta.url));
const tokenFile = `${out}token.json`;
const mode = process.argv[2];
const pause = process.argv.includes('--pause');
const client = createSsiClient({ userAgent: userAgent(process.env.DIVEHUB_CONTACT) });
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

await mkdir(out, { recursive: true });

if (mode === 'read') {
  const account = await signIn();
  await writeFile(tokenFile, JSON.stringify({ token: account.token, at: new Date().toISOString() }));
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
  const account = await signIn();
  const dive: DiveForSsi = {
    startsAt: new Date('2000-01-01T12:00:00Z'), utcOffsetSeconds: 0, durationSeconds: 60, maxDepthM: 1, avgDepthM: 0.5,
    waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes: 'Dive Hub test – delete me',
    siteSsiId: process.env.SSI_SITE_ID ?? '', participants: [], entry: null, exit: null, gases: [{ o2: 21, he: 0 }], gfLow: null, gfHigh: null,
    cnsStart: null, cnsEnd: null, device: null,
    samples: { depth: { offsetsMs: [0, 20_000, 40_000, 60_000], values: [0, 1, 1, 0] }, temperature: { offsetsMs: [0], values: [20] } },
  };
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
} else {
  console.log('Usage: round-trip.ts read | token | write [--pause]');
}
