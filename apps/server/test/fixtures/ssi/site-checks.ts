// The owner's check of what SSI answers for sites, run by `round-trip.ts site probe` (Piece 4, private sites).
// It writes to the real SSI account: it creates one private site "Dive Hub test" at 0.001, 0.001 with `save_divesite`,
// reads it with `get_divesite` and `get_divelog`, deletes it again with `odin_dive_sites_deleted: 1` and looks whether
// it is gone. Output: key names, HTTP statuses and ID-like values only, never names, comments, URLs, tokens or passwords.
// The flags go as the numbers 0/1 (SSI takes the dive record's flags so; the owner's run of 2026-10-24 showed a boolean delete is not stored).
// Everything SSI answers goes to samples/private/ssi/site-probe.json (git-ignored).
// `site visible start | global | zip | finish` (at the end of this file) check, on the owner's account, that a private
// site is usable and not visible: start puts a test dive on the existing private test site (SSI cannot delete sites),
// global and zip look whether the site shows in the global feed and in APP_CACHE_SITES.zip, finish deletes the dive.
import { DEFAULT_SSI_URL } from '../../../src/providers/ssi/ssi-client.js';
import yauzl from 'yauzl';
import type { SsiClient, SsiRecord } from '../../../src/providers/ssi/ssi-client.js';
import { buildCreateRecord, buildDeleteRecord, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';
import { DEFAULT_SSI_SITES_URL } from '../../../src/providers/ssi/ssi-sites.js';
import { createSsiTransport, SSI_APP_USER_AGENT, SsiError, type Fetch } from '../../../src/providers/ssi/ssi-transport.js';

export interface SiteProbe {
  access: string;
  /** The account's `mid`. */
  accountId: string;
  /** A public site of the logbook. */
  siteId: string;
  log: (line: string) => void;
}

const NAME = 'Dive Hub test';
const UNKNOWN_ID = '999999999';
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIdValue = (v: unknown) => (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^\d+$/.test(v));
const idKey = (k: string) => /(^|_)(id|ids|mid|owner)$/.test(k) || k === 'dsid';

/** The site row the app sends (`siteUpload` in the write-bodies note), without `internalPk` and `needsUpload`. */
export function siteRow(accountId: string, id: string | null, deleted: boolean): Record<string, unknown> {
  return {
    odin_dive_sites_id: id === null ? null : Number(id),
    odin_dive_sites_name: NAME,
    bow: 'salt',
    odin_user_log_animal_ids: null,
    odin_dive_sites_lon: 0.001,
    odin_dive_sites_lat: 0.001,
    odin_dive_sites_meta_address: null,
    odin_dive_sites_meta_region: null,
    odin_dive_sites_meta_country: null,
    odin_countries_code_iso: null,
    odin_dive_sites_regions_name: null,
    odin_dive_sites_areas_name: null,
    odin_dive_sites_geo_locked: null,
    odin_dive_sites_is_private: 1,
    odin_dive_sites_alias_ids: null,
    odin_dive_sites_is_private_owner: Number(accountId),
    odin_dive_sites_deleted: deleted ? 1 : 0,
    alias_names_search: null,
    alias_names: null,
  };
}

/** Key names, and the values of keys that look like IDs (also inside objects one level down). */
function describe(data: Record<string, unknown>): string {
  const one = (k: string, v: unknown) => (idKey(k) && isIdValue(v) ? `${k}=${String(v)}` : k);
  return Object.entries(data).map(([k, v]) => (isObject(v)
    ? `${k}{${Object.entries(v).map(([k2, v2]) => one(k2, v2)).join(', ')}}`
    : one(k, v))).join(', ');
}

function findNewId(data: Record<string, unknown>): string | null {
  for (const level of [data, isObject(data.success) ? data.success : {}, isObject(data.result) ? data.result : {}]) {
    for (const key of ['odin_dive_sites_id', 'dsid', 'id']) {
      if (isIdValue(level[key]) && Number(level[key]) > 0) return String(level[key]);
    }
  }
  return null;
}

export type Answer = { httpStatus: number | undefined; data: Record<string, unknown> | null; error: string | null };
export type Ask = (what: string, params: Record<string, string>, body?: Record<string, unknown>) => Promise<Answer>;

/** The transport with the HTTP status of the last call; a refusal or an HTTP error is an outcome to print, not a reason to stop. */
export interface Raw { status?: number; contentType?: string | null; text?: string }
export function makeAsk(access: string, raw: Raw = {}): Ask {
  let httpStatus: number | undefined;
  const transport = createSsiTransport({
    url: DEFAULT_SSI_URL, timeoutMs: 60_000,
    fetch: (async (url, init) => {
      const response = await fetch(url, init);
      httpStatus = response.status;
      raw.status = response.status;
      raw.contentType = response.headers.get('content-type');
      raw.text = await response.clone().text();
      return response;
    }) as Fetch,
  });
  return async (what, params, body) => {
    httpStatus = undefined;
    try {
      const data = await transport.call(what, { token: access, ...params }, body);
      return { httpStatus, data, error: null };
    } catch (error) {
      return { httpStatus, data: null, error: error instanceof SsiError ? error.reason : 'error' };
    }
  };
}

export const outcome = (r: Answer) => `HTTP ${r.httpStatus ?? 'none'}${r.error ? `, error ${r.error}` : ''}`;

async function logbookSites(ask: Ask) {
  const r = await ask('get_divelog', {});
  const sites = Array.isArray(r.data?.logbook_sites) ? r.data.logbook_sites.filter(isObject) : [];
  return { r, sites };
}

// The transport rejects get_divesite's answer, an array of one row, as bad_response (see `site get`); the row is not in `answer` then.
async function getSite(ask: Ask, log: (line: string) => void, label: string, id: string) {
  const r = await ask('get_divesite', { dsid: id });
  const d = r.data;
  // The site may sit at the top of the answer or one level down.
  const nested = d ? Object.values(d).find((v): v is Record<string, unknown> => isObject(v) && 'odin_dive_sites_id' in v) : undefined;
  const src = nested ?? d;
  const values = src && {
    odin_dive_sites_id: src.odin_dive_sites_id, is_private: src.odin_dive_sites_is_private,
    is_private_owner: src.odin_dive_sites_is_private_owner, deleted: src.odin_dive_sites_deleted,
  };
  log(`  get_divesite ${label}: ${outcome(r)}; keys: ${d ? Object.keys(d).join(', ') : '-'}`
    + (nested ? `; site keys: ${Object.keys(nested).join(', ')}` : '')
    + (values ? `; values: ${JSON.stringify(values)}` : ''));
  return { httpStatus: r.httpStatus, error: r.error, answer: d };
}

async function inLogbook(ask: Ask, log: (line: string) => void, label: string, id: string) {
  const { r, sites } = await logbookSites(ask);
  const found = sites.find((s) => String(s.odin_dive_sites_id) === id) ?? null;
  const where = found
    ? `IS in logbook_sites (is_private ${JSON.stringify(found.odin_dive_sites_is_private)}, owner ${JSON.stringify(found.odin_dive_sites_is_private_owner)}; keys: ${Object.keys(found).join(', ')})`
    : 'is NOT in logbook_sites';
  log(`  get_divelog ${label}: ${outcome(r)}; ${sites.length} logbook_sites; site ${id} ${where}`);
  return { found, siteCount: sites.length, error: r.error };
}

/** The new site ID: from the answer, else from the logbook by name and position (the answer may not carry it). */
async function learnNewId(ask: Ask, log: (line: string) => void, created: Answer, known: Set<string>): Promise<string | null> {
  const fromAnswer = created.data ? findNewId(created.data) : null;
  if (fromAnswer) {
    log(`  NEW SITE ID: ${fromAnswer}`);
    return fromAnswer;
  }
  const { sites } = await logbookSites(ask);
  // Earlier test sites stay at SSI for good, so only a site that was not in the logbook before the create counts.
  const hit = sites.find((s) => !known.has(String(s.odin_dive_sites_id)) && s.odin_dive_sites_name === NAME && Math.abs(Number(s.odin_dive_sites_lat) - 0.001) < 1e-6);
  const id = hit && isIdValue(hit.odin_dive_sites_id) ? String(hit.odin_dive_sites_id) : null;
  log(id ? `  the answer has no site ID; found in logbook_sites by name and position: ${id}` : '  no site ID in the answer, none found in logbook_sites');
  return id;
}

/** Step 4 and its checks; runs also when a read failed. */
async function deleteAndCheck(ask: Ask, o: SiteProbe, id: string, results: Record<string, unknown>) {
  o.log(`4. save_divesite (delete ${id}, odin_dive_sites_deleted: 1)`);
  const deleted = await ask('save_divesite', {}, siteRow(o.accountId, id, true));
  o.log(`  answer: ${outcome(deleted)}; ${deleted.data ? describe(deleted.data) : '-'}`);
  results.delete = { httpStatus: deleted.httpStatus, error: deleted.error, answer: deleted.data };
  results.getAfterDelete = await getSite(ask, o.log, `${id} after delete`, id);
  const after = await inLogbook(ask, o.log, 'after delete', id);
  results.logbookAfterDelete = after;
  o.log(after.found || deleted.error
    ? `*** SITE ${id} MAY STILL EXIST: tell the owner before anything else runs; delete it by hand ***`
    : `site ${id} is gone from logbook_sites`);
}

export async function runSiteProbe(o: SiteProbe): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = { app: '5.0.43', at: new Date().toISOString() };
  const ask = makeAsk(o.access);

  const known = new Set((await logbookSites(ask)).sites.map((s) => String(s.odin_dive_sites_id)));
  const row = siteRow(o.accountId, null, false);
  o.log(`1. save_divesite (create). Keys sent: ${Object.keys(row).join(', ')}`);
  o.log(`   private flag key: odin_dive_sites_is_private = 1; owner key: odin_dive_sites_is_private_owner = account ${o.accountId}`);
  const created = await ask('save_divesite', {}, row);
  o.log(`  answer: ${outcome(created)}; ${created.data ? describe(created.data) : '-'}`);
  results.create = { sentKeys: Object.keys(row), httpStatus: created.httpStatus, error: created.error, answer: created.data };
  const id = await learnNewId(ask, o.log, created, known);
  if (!id) {
    o.log('STOP: save_divesite gives no way to learn the new site ID. Check the MySSI app for a site "Dive Hub test" at 0.001, 0.001 and delete it by hand.');
    return results;
  }
  o.log(`*** CREATED SITE ID ${id}: if the run stops before step 4 ends, delete it by hand (save_divesite with this ID and odin_dive_sites_deleted: 1) ***`);
  results.newId = id;

  try {
    o.log('2. get_divesite (dsid)');
    results.getNew = await getSite(ask, o.log, `new ${id}`, id);
    results.getPublic = await getSite(ask, o.log, `public ${o.siteId}`, o.siteId);
    results.getUnknown = await getSite(ask, o.log, `unknown ${UNKNOWN_ID}`, UNKNOWN_ID);
    o.log('3. get_divelog');
    results.logbookAfterCreate = await inLogbook(ask, o.log, 'after create', id);
  } catch (error) {
    o.log(`  a read failed (${error instanceof Error ? error.name : 'error'}); deleting the site anyway`);
    results.readFailed = true;
  } finally {
    await deleteAndCheck(ask, o, id, results);
  }
  return results;
}

const looksLikeState = (k: string) => idKey(k) || /private|deleted|owner/.test(k);
const shown = (k: string, v: unknown) => (looksLikeState(k) && (isIdValue(v) || typeof v === 'boolean' || v === null) ? `${k}=${String(v)}` : k);

/**
 * `site get <id>`: read-only. Calls get_divesite and prints what came back without the transport's parsing: the transport
 * answers `bad_response` for a body that is not JSON or whose top level is not an object (an array, a number, a string).
 */
export async function runSiteGet(o: Pick<SiteProbe, 'access' | 'log'> & { id: string }): Promise<void> {
  const raw: Raw = {};
  const ask = makeAsk(o.access, raw);
  const r = await ask('get_divesite', { dsid: o.id });
  let parsed: unknown;
  let json = false;
  try {
    parsed = JSON.parse(raw.text ?? '');
    json = true;
  } catch { /* not JSON */ }
  o.log(`get_divesite ${o.id}: HTTP ${raw.status ?? 'none'}; content-type ${raw.contentType ?? 'none'}; body length ${raw.text?.length ?? 0}; JSON: ${json ? 'yes' : 'no'}; transport: ${r.error ?? 'ok'}`);
  if (!json) return;
  const type = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed;
  o.log(`  top level: ${type}`);
  const describeObject = (obj: Record<string, unknown>) => Object.entries(obj).map(([k, v]) => shown(k, v)).join(', ');
  if (isObject(parsed)) o.log(`  keys: ${describeObject(parsed)}`);
  else if (Array.isArray(parsed)) {
    o.log(`  length ${parsed.length}`);
    parsed.filter(isObject).slice(0, 3).forEach((item, i) => o.log(`  [${i}] keys: ${describeObject(item)}`));
  }
}

/** `site delete <id>`: deletes a leftover test site, only one named "Dive Hub test" and private to the account. */
export async function runSiteDelete(o: Pick<SiteProbe, 'access' | 'accountId' | 'log'> & { id: string }): Promise<Record<string, unknown>> {
  const ask = makeAsk(o.access);
  const { sites } = await logbookSites(ask);
  const entry = sites.find((s) => String(s.odin_dive_sites_id) === o.id);
  const isPrivate = entry && (entry.odin_dive_sites_is_private === 1 || entry.odin_dive_sites_is_private === '1' || entry.odin_dive_sites_is_private === true);
  const owned = entry && String(entry.odin_dive_sites_is_private_owner) === o.accountId;
  if (!entry || entry.odin_dive_sites_name !== NAME || !isPrivate || !owned) {
    throw new Error(`Refused: site ${o.id} is not in the logbook as a private "${NAME}" of this account (listed: ${entry ? 'yes' : 'no'}).`);
  }
  const row = siteRow(o.accountId, o.id, true);
  o.log(`save_divesite (delete ${o.id}, odin_dive_sites_deleted: 1). Keys sent: ${Object.keys(row).join(', ')}`);
  const deleted = await ask('save_divesite', {}, row);
  const site = isObject(deleted.data?.result) && isObject(deleted.data.result.site) ? deleted.data.result.site : null;
  o.log(`  answer: ${outcome(deleted)}; ${deleted.data ? describe(deleted.data) : '-'}`);
  o.log(`  result.site.odin_dive_sites_deleted: ${site ? JSON.stringify(site.odin_dive_sites_deleted) : 'no result.site'}`);
  const after = await inLogbook(ask, o.log, 'after delete', o.id);
  o.log(after.found ? `  still listed, deleted flag: ${JSON.stringify(after.found.odin_dive_sites_deleted)}` : `  site ${o.id} is gone from logbook_sites`);
  return { sentKeys: Object.keys(row), httpStatus: deleted.httpStatus, error: deleted.error, answer: deleted.data, logbookAfter: after };
}

// ---- `site visible`: the private test site is usable and not visible ---------------------------------------------------

/** The existing private test site "Dive Hub test" of the owner's account. SSI sites cannot be deleted, so this one is reused. */
export const VISIBLE_SITE_ID = '1083262';
const TEST_DATE = '2000-01-01';

export interface SiteVisibleSaved { siteId: string; diveId: string; startedAt: string }

const visibleDive = (siteSsiId: string): DiveForSsi => ({
  startsAt: new Date(`${TEST_DATE}T12:00:00Z`), utcOffsetSeconds: 0, durationSeconds: 60, maxDepthM: 1, avgDepthM: 0.5,
  waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes: NAME,
  siteSsiId, participants: [], entry: null, exit: null, gases: [{ o2: 21, he: 0 }], gfLow: null, gfHigh: null,
  cnsStart: null, cnsEnd: null, device: null, cylinder: null, leadKg: null, diveMode: null, surfaceIntervalSeconds: null, avgHeartRate: null,
  samples: { depth: { offsetsMs: [0, 20_000, 40_000, 60_000], values: [0, 1, 1, 0] }, temperature: { offsetsMs: [0], values: [20] } },
});

export const findDive = async (client: SsiClient, access: string, id: string) =>
  (await client.logbook(access)).dives.find((d) => String(d.odin_user_log_id) === id);

/** `site visible start`: one dive (2000-01-01 12:00, notes "Dive Hub test") on the test site, through Dive Hub's own record code. */
export async function runSiteVisibleStart(
  o: { client: SsiClient; access: string; accountId: string; log: (line: string) => void },
): Promise<SiteVisibleSaved> {
  const ask = makeAsk(o.access);
  const before = await o.client.logbook(o.access);
  const number = Math.max(0, ...before.dives.map((d) => Number(d.odin_user_log_nr) || 0)) + 1;
  const startedAt = new Date().toISOString();
  const { id } = await o.client.save(o.access, buildCreateRecord(visibleDive(VISIBLE_SITE_ID), { number, accountId: o.accountId, reference: 'divehub-site-visible-test' }));
  o.log(`created SSI dive ${id} as number ${number} on site ${VISIBLE_SITE_ID}; started at ${startedAt}`);
  const stored = await findDive(o.client, o.access, id);
  o.log(stored ? `  the dive is in the logbook; its site ID: ${String(stored.odin_user_log_dive_sites_id)}` : '  the dive is NOT in the logbook');
  await inLogbook(ask, o.log, 'after start', VISIBLE_SITE_ID);
  return { siteId: VISIBLE_SITE_ID, diveId: id, startedAt };
}

interface Format { name: string; value: (t: Date) => string }
const pad = (n: number) => String(n).padStart(2, '0');
const dateTime = (t: Date) => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
// The app's format is not known; each is tried and the first that returns rows is used (and printed).
const FORMATS: Format[] = [
  { name: 'unix seconds', value: (t) => String(Math.floor(t.getTime() / 1000)) },
  { name: 'YYYY-MM-DD HH:MM:SS', value: dateTime },
  { name: 'ISO 8601', value: (t) => t.toISOString() },
];

/** The rows of a get_divesites_global page: the first array of objects at the top level, or the top level itself. */
function pageRows(text: string | undefined): { rows: Record<string, unknown>[]; keys: string; shape: string } {
  let data: unknown;
  try {
    data = JSON.parse(text ?? '');
  } catch {
    return { rows: [], keys: '-', shape: 'not JSON' };
  }
  if (Array.isArray(data)) return { rows: data.filter(isObject), keys: '-', shape: 'array' };
  if (!isObject(data)) return { rows: [], keys: '-', shape: typeof data };
  const list = Object.values(data).find((v) => Array.isArray(v) && v.some(isObject)) as unknown[] | undefined;
  return { rows: list ? list.filter(isObject) : [], keys: Object.keys(data).join(', '), shape: 'object' };
}

/** The first format of `last_sync` for which the feed returns a row (all are tried and printed), or null. */
async function acceptedFormat(ask: Ask, raw: Raw, at: Date, why: string, log: (line: string) => void): Promise<Format | null> {
  for (const f of FORMATS) {
    const r = await ask('get_divesites_global', { last_sync: f.value(at), offset: '0', limit: '1' });
    const page = pageRows(raw.text);
    log(`last_sync ${why}, as ${f.name}: ${outcome(r)}; shape ${page.shape}; keys: ${page.keys}; ${page.rows.length} row(s) with limit 1`);
    if (page.rows.length > 0) return f;
  }
  return null;
}

/** The feed from `lastSync` to its end (10,000 rows a page): the row of the site, if there, and the row count. */
async function readFeed(ask: Ask, raw: Raw, lastSync: string, siteId: string, log: (line: string) => void) {
  const limit = 10_000;
  let total = 0;
  let found: Record<string, unknown> | null = null;
  for (let offset = 0, pages = 0; pages < 50; offset += limit, pages++) {
    const r = await ask('get_divesites_global', { last_sync: lastSync, offset: String(offset), limit: String(limit) });
    const { rows } = pageRows(raw.text);
    total += rows.length;
    found = found ?? rows.find((s) => String(s.odin_dive_sites_id) === siteId) ?? null;
    log(`  page offset ${offset}: ${outcome(r)}; ${rows.length} row(s)`);
    if (r.error || rows.length < limit) break;
  }
  return { total, found };
}

/** `site visible global`: the global feed from just before start's time, paged to the end; is the test site there? */
export async function runSiteVisibleGlobal(
  o: { access: string; saved: SiteVisibleSaved; log: (line: string) => void },
): Promise<Record<string, unknown>> {
  const raw: Raw = {};
  const ask = makeAsk(o.access, raw);
  // The site was created on 2026-10-24, before start; if start's time leaves it out, a time before its creation is used.
  const attempts = [
    { why: "just before start's time", at: new Date(new Date(o.saved.startedAt).getTime() - 60_000) },
    { why: "before the site's creation on 2026-10-24 (start's time left it out)", at: new Date('2026-10-23T00:00:00Z') },
  ];
  const results: Record<string, unknown> = {};
  for (const attempt of attempts) {
    const format = await acceptedFormat(ask, raw, attempt.at, attempt.why, o.log);
    if (!format) {
      o.log('  no format returned rows; trying the next time');
      continue;
    }
    const lastSync = format.value(attempt.at);
    o.log(`  using last_sync ${lastSync} (${format.name}), ${attempt.why}`);
    const { total, found } = await readFeed(ask, raw, lastSync, o.saved.siteId, o.log);
    o.log(`  ${total} site(s) in the feed; site ${o.saved.siteId} ${found ? 'IS in the global feed' : 'is NOT in the global feed'}`);
    if (found) {
      o.log(`  entry: is_private ${JSON.stringify(found.odin_dive_sites_is_private)}, owner ${JSON.stringify(found.odin_dive_sites_is_private_owner)}, deleted ${JSON.stringify(found.odin_dive_sites_deleted)}; keys: ${Object.keys(found).join(', ')}`);
    }
    results[attempt.why] = { lastSync, format: format.name, total, inFeed: found !== null };
    if (found) break;
  }
  const book = await inLogbook(makeAsk(o.access), o.log, 'for comparison', o.saved.siteId);
  results.logbook = { found: book.found !== null, isPrivate: book.found?.odin_dive_sites_is_private, owner: book.found?.odin_dive_sites_is_private_owner };
  return results;
}

/** `site visible zip`: APP_CACHE_SITES.zip, no sign-in: is the site in it, and when was the file created? */
export async function runSiteVisibleZip(o: { saved: SiteVisibleSaved; log: (line: string) => void }): Promise<Record<string, unknown>> {
  let bytes: Buffer;
  try {
    const response = await fetch(DEFAULT_SSI_SITES_URL, { headers: { 'User-Agent': SSI_APP_USER_AGENT, Accept: 'application/zip' } });
    o.log(`APP_CACHE_SITES.zip: HTTP ${response.status}; last-modified ${response.headers.get('last-modified') ?? 'none'}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`APP_CACHE_SITES.zip: download failed (${error instanceof Error ? error.name : "error"})`, { cause: error });
  }
  o.log(`  ${bytes.length} bytes`);
  const file = await yauzl.fromBufferPromise(bytes, { decodeStrings: true, validateEntrySizes: true, strictFileNames: false });
  let text = '';
  try {
    for await (const entry of file.eachEntry()) {
      if (!/\.json$/i.test(entry.fileName)) continue;
      const chunks: Buffer[] = [];
      for await (const chunk of await file.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
      text = Buffer.concat(chunks).toString('utf8');
      break;
    }
  } finally {
    file.close();
  }
  const data = JSON.parse(text) as Record<string, unknown>;
  const sites = Array.isArray(data.divesites) ? data.divesites.filter(isObject) : [];
  const entry = sites.find((s) => String(s.odin_dive_sites_id) === o.saved.siteId) ?? null;
  o.log(`  created ${JSON.stringify(data.created)}; ${sites.length} site(s); site ${o.saved.siteId} ${entry ? 'IS in the zip' : 'is NOT in the zip'}`);
  if (entry) o.log(`  entry: is_private ${JSON.stringify(entry.odin_dive_sites_is_private)}, owner ${JSON.stringify(entry.odin_dive_sites_is_private_owner)}`);
  return { created: data.created, siteCount: sites.length, inZip: entry !== null };
}

/** `site visible finish`: deletes the test dive (only a "Dive Hub test" dive dated 2000-01-01), checks it is gone; the site stays. */
export async function runSiteVisibleFinish(
  o: { client: SsiClient; access: string; saved: SiteVisibleSaved; log: (line: string) => void },
): Promise<void> {
  const stored: SsiRecord | undefined = await findDive(o.client, o.access, o.saved.diveId);
  if (stored) {
    const dated = String(stored.odin_user_log_date ?? stored.odin_user_log_datetime ?? '').startsWith(TEST_DATE);
    if (String(stored.odin_user_log_comment ?? '') !== NAME || !dated) {
      throw new Error(`Refused: dive ${o.saved.diveId} is not a "${NAME}" dive dated ${TEST_DATE}.`);
    }
    await o.client.save(o.access, buildDeleteRecord(stored));
    const left = await findDive(o.client, o.access, o.saved.diveId);
    o.log(left ? `dive ${o.saved.diveId} is STILL there after deleting` : `dive ${o.saved.diveId} is gone`);
  } else {
    o.log(`dive ${o.saved.diveId} is not in the logbook (already gone)`);
  }
  o.log(`site ${o.saved.siteId} stays: SSI sites cannot be deleted (odin_dive_sites_deleted is ignored; the app has no delete)`);
}
