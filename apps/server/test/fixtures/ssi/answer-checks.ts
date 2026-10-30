// The owner's check of what SSI's save answers (piece 7, fewer reads), run by `round-trip.ts answer`.
// It writes to the real SSI account: one throwaway dive dated 2000-01-05 12:00 (notes "Dive Hub test"), created and
// updated as SSI's app (its User-Agent), and one dated 2000-01-05 14:00 created with another User-Agent (ADR 0049: SSI
// is expected to answer it without storing it). Both are deleted at the end if SSI has them. It prints key names, IDs
// and the test dives' comparisons only; the raw answers go to samples/private/ssi/answer.json.
import { createSsiClient, type SsiClient, type SsiRecord } from '../../../src/providers/ssi/ssi-client.js';
import { compareReadBack, buildCreateRecord, buildDeleteRecord, buildUpdateRecord, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';

const NOTES = 'Dive Hub test – answer, delete me';
const FOREIGN_USER_AGENT = 'DiveHub-check/1.0';
const pause = () => new Promise((r) => setTimeout(r, 3000));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function testDive(at: string, siteSsiId: string): DiveForSsi {
  return {
    startsAt: new Date(at), utcOffsetSeconds: 0, durationSeconds: 120, maxDepthM: 2, avgDepthM: 1,
    waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes: NOTES, siteSsiId, participants: [], entry: null, exit: null,
    gases: [{ o2: 21, he: 0 }], gfLow: null, gfHigh: null, cnsStart: null, cnsEnd: null, device: null, cylinder: null, leadKg: null,
    diveMode: null, surfaceIntervalSeconds: null, avgHeartRate: null,
    samples: { depth: { offsetsMs: [0, 30_000, 90_000, 120_000], values: [0, 2, 2, 0] }, temperature: { offsetsMs: [0], values: [20] } },
  };
}

/** A client whose save answers are kept raw; `userAgent` replaces the app's. */
function recording(userAgent?: string) {
  const answers: unknown[] = [];
  const client = createSsiClient({
    fetch: async (url, init) => {
      const headers = userAgent ? { ...init.headers, 'User-Agent': userAgent } : init.headers;
      const response = await fetch(url, { ...init, headers });
      const text = await response.text();
      if (url.includes('what=save_divelog')) {
        try {
          answers.push(JSON.parse(text));
        } catch {
          answers.push({ notJson: text.length });
        }
      }
      return new Response(text, { status: response.status, headers: response.headers });
    },
  });
  return { client, answers };
}

const sampleCount = (v: unknown) => {
  if (typeof v !== 'string' || !v) return 0;
  try {
    const list = JSON.parse(v) as unknown;
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
};

/** The answer's shape and, when it carries a dive, how it compares with what was sent. */
function describe(label: string, answer: unknown, sent: SsiRecord, log: (s: string) => void) {
  if (!isObject(answer)) return log(`${label}: answer is not an object`), null;
  const success = isObject(answer.success) ? answer.success : null;
  const result = isObject(answer.result) ? answer.result : null;
  log(`${label}: keys ${Object.keys(answer).join(', ')}${success ? `; success: ${Object.keys(success).join(', ')}` : ''}`
    + `${result ? `; result: ${Object.keys(result).join(', ')}` : '; no result'}`);
  log(`  ok ${JSON.stringify((success ?? answer).ok ?? null)}, id ${JSON.stringify((success ?? answer).odin_user_log_id ?? null)}`
    + `, potential_duplicate ${JSON.stringify(result?.potential_duplicate ?? null)}`);
  const list = result?.dive;
  const dive = Array.isArray(list) && isObject(list[0]) ? list[0] : null;
  if (!dive) return log(`  result.dive: ${list === undefined ? 'absent' : JSON.stringify(list).slice(0, 80)}`), null;
  log(`  result.dive: ${(list as unknown[]).length} record(s), ${Object.keys(dive).length} keys; id ${JSON.stringify(dive.odin_user_log_id)}, `
    + `number ${JSON.stringify(dive.odin_user_log_nr)}, reference ${JSON.stringify(dive.odin_user_log_divecomputer_dive_ref)}, `
    + `samples ${sampleCount(dive.odin_user_log_diveSamples)} (sent ${sampleCount(sent.odin_user_log_diveSamples)})`);
  log(`  compared with what was sent: ${JSON.stringify(compareReadBack(sent, dive))}`);
  return dive;
}

/** Keys whose values differ between the answer's dive and the logbook's record (names only). */
function keyDifferences(answer: SsiRecord, stored: SsiRecord) {
  const keys = new Set([...Object.keys(answer), ...Object.keys(stored)]);
  const onlyAnswer: string[] = [];
  const onlyStored: string[] = [];
  const differ: string[] = [];
  for (const k of keys) {
    if (!(k in stored)) onlyAnswer.push(k);
    else if (!(k in answer)) onlyStored.push(k);
    else if (JSON.stringify(answer[k]) !== JSON.stringify(stored[k]) && String(answer[k] ?? '') !== String(stored[k] ?? '')) differ.push(k);
  }
  return { onlyAnswer, onlyStored, differ };
}

export async function runAnswerChecks(o: { access: string; accountId: string; siteId: string; log: (s: string) => void }) {
  const { access, accountId, siteId, log } = o;
  const app = recording();
  const foreign = recording(FOREIGN_USER_AGENT);
  const find = async (client: SsiClient, id: string) => (await client.logbook(access)).dives.find((d) => String(d.odin_user_log_id) === id);
  const report: Record<string, unknown> = {};

  const before = await app.client.logbook(access);
  const number = Math.max(0, ...before.dives.map((d) => Number(d.odin_user_log_nr) || 0)) + 1;
  await pause();

  // 1. A create as the app.
  const created = buildCreateRecord(testDive('2000-01-05T12:00:00Z', siteId), { number, accountId, reference: 'divehub-answer-test' });
  const { id } = await app.client.save(access, created);
  log(`created SSI dive ${id} as number ${number} (app User-Agent)`);
  const createDive = describe('create answer', app.answers[0], created, log);
  await pause();
  const stored = await find(app.client, id);
  log(`logbook has it: ${stored ? 'yes' : 'no'}${stored ? `; read-back compared with what was sent: ${JSON.stringify(compareReadBack(created, stored))}` : ''}`);
  if (createDive && stored) log(`  answer vs logbook: ${JSON.stringify(keyDifferences(createDive, stored))}`);
  report.create = { id, answer: app.answers[0], stored: stored ?? null };
  await pause();

  // 2. An update as the app.
  if (stored) {
    const updated = buildUpdateRecord(stored, { ...testDive('2000-01-05T12:00:00Z', siteId), notes: `${NOTES} (updated)` });
    await app.client.save(access, updated);
    const updateDive = describe('update answer', app.answers[1], updated, log);
    await pause();
    const after = await find(app.client, id);
    log(`after the update, read-back compared with what was sent: ${after ? JSON.stringify(compareReadBack(updated, after)) : 'not found'}`);
    if (updateDive && after) log(`  answer vs logbook: ${JSON.stringify(keyDifferences(updateDive, after))}`);
    report.update = { answer: app.answers[1], stored: after ?? null };
    await pause();
  }

  // 3. A create with another User-Agent.
  const foreignRecord = buildCreateRecord(testDive('2000-01-05T14:00:00Z', siteId), { number: number + 1, accountId, reference: 'divehub-answer-foreign' });
  let foreignId: string | null = null;
  try {
    foreignId = (await foreign.client.save(access, foreignRecord)).id;
    log(`create with User-Agent "${FOREIGN_USER_AGENT}" answered dive ID ${foreignId}`);
  } catch (error) {
    log(`create with User-Agent "${FOREIGN_USER_AGENT}" refused: ${(error as Error).message}`);
  }
  describe('foreign create answer', foreign.answers[0], foreignRecord, log);
  await pause();
  const logbook = await app.client.logbook(access);
  const foreignStored = logbook.dives.find((d) => (foreignId && String(d.odin_user_log_id) === foreignId) || d.odin_user_log_divecomputer_dive_ref === 'divehub-answer-foreign');
  log(`logbook has the foreign create: ${foreignStored ? `yes (${String(foreignStored.odin_user_log_id)})` : 'no'}`);
  report.foreign = { id: foreignId, answer: foreign.answers[0] ?? null, stored: foreignStored ?? null };
  await pause();

  // 4. Clean up: only test dives.
  const ours = logbook.dives.filter((d) => String(d.odin_user_log_comment ?? '').startsWith('Dive Hub test – answer')
    && String(d.odin_user_log_datetime).startsWith('2000-01-05'));
  for (const d of ours) {
    await app.client.save(access, buildDeleteRecord(d));
    log(`deleted SSI dive ${String(d.odin_user_log_id)}`);
    await pause();
  }
  const left = (await app.client.logbook(access)).dives.filter((d) => ours.some((x) => x.odin_user_log_id === d.odin_user_log_id));
  log(left.length ? `still there: ${left.map((d) => String(d.odin_user_log_id)).join(', ')}` : 'all test dives gone');
  return report;
}
