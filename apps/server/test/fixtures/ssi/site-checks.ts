// The owner's check of what SSI answers for sites, run by `round-trip.ts site probe` (Piece 4, private sites).
// It writes to the real SSI account: it creates one private site "Dive Hub test" at 0.001, 0.001 with `save_divesite`,
// reads it with `get_divesite` and `get_divelog`, deletes it again with `odin_dive_sites_deleted: 1` and looks whether
// it is gone. Output: key names, HTTP statuses and ID-like values only, never names, comments, URLs, tokens or passwords.
// The flags go as the numbers 0/1 (SSI takes the dive record's flags so; the owner's run of 2026-10-24 showed a boolean delete is not stored).
// Everything SSI answers goes to samples/private/ssi/site-probe.json (git-ignored).
import { DEFAULT_SSI_URL } from '../../../src/providers/ssi/ssi-client.js';
import { createSsiTransport, SsiError, type Fetch } from '../../../src/providers/ssi/ssi-transport.js';

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

type Answer = { httpStatus: number | undefined; data: Record<string, unknown> | null; error: string | null };
type Ask = (what: string, params: Record<string, string>, body?: Record<string, unknown>) => Promise<Answer>;

/** The transport with the HTTP status of the last call; a refusal or an HTTP error is an outcome to print, not a reason to stop. */
interface Raw { status?: number; contentType?: string | null; text?: string }
function makeAsk(access: string, raw: Raw = {}): Ask {
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

const outcome = (r: Answer) => `HTTP ${r.httpStatus ?? 'none'}${r.error ? `, error ${r.error}` : ''}`;

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
