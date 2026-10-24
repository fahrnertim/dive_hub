// An in-memory SSI app API for tests (ADR 0024): tests and the browser tests' server never reach SSI.
// It answers like the real one as far as the community projects describe it (docs/research/2026-10-04-ssi-api.md),
// including what SSI does to stored values: minutes only, serial numbers without leading zeros.
import type { Fetch, SsiRecord } from '../src/providers/ssi/ssi-client.js';
import { DIVE_ROW } from '../src/providers/ssi/ssi-dive-row.js';

export interface FakeSsiAccount {
  email: string;
  password: string;
  accountId: number;
}

export interface FakeSsiSite {
  odin_dive_sites_id: number;
  odin_dive_sites_name: string;
  odin_dive_sites_lat: number;
  odin_dive_sites_lon: number;
  odin_countries_code_iso: string;
  /** Body of water: salt, fresh or artificial. */
  bow?: string;
  /** Private to `odin_dive_sites_is_private_owner` (SSI answers flags as 0/1). */
  odin_dive_sites_is_private?: number | boolean;
  odin_dive_sites_is_private_owner?: number;
  odin_dive_sites_deleted?: number;
}

/** An entry in an account's SSI buddy list, with the personal data SSI keeps (which Dive Hub must never store). */
export interface FakeSsiBuddy {
  /** The account whose list it is in. */
  owner: number;
  id: number;
  /** The buddy's own SSI account; SSI writes it into master_id too. */
  buddy_master_id: number;
  firstname: string;
  lastname: string;
  email: string;
  dob: string;
  phone: string;
  city: string;
  /** Set for a professional. */
  leader_nr?: string;
}

/** A certification card of an account, as `get_ccards` lists it (invented values; the shape is from the capture of 2026-10-10). */
export interface FakeSsiCard {
  /** The account whose cards they are. */
  owner: number;
  ccard_uid: string;
  ccard_course_name: string;
  ccard_course_short: string;
  ccard_cat: string;
  ccard_course_id: number;
  ccard_dives: number;
  ccard_issue_date: string;
  ccard_expire_date: string | null;
  ccard_instructor_number: number;
  ccard_instructor_name: string;
  ccard_divecenter_number: number;
  ccard_divecenter_name: string;
  ccard_divecenter_city: string;
  ccard_divecenter_country: string;
}

/** A card with invented values; `uid` and `course` differ per card. */
export function fakeCard(owner: number, v: { uid: string; course: string; short: string; courseId: number; issued: string; dives?: number }): FakeSsiCard {
  return {
    owner, ccard_uid: v.uid, ccard_course_name: v.course, ccard_course_short: v.short, ccard_cat: 'scubadiving', ccard_course_id: v.courseId,
    ccard_dives: v.dives ?? 12, ccard_issue_date: v.issued, ccard_expire_date: null, ccard_instructor_number: 77001,
    ccard_instructor_name: 'Ida Instructor', ccard_divecenter_number: 123456, ccard_divecenter_name: 'Blue Hole Divers',
    ccard_divecenter_city: 'Dahab', ccard_divecenter_country: 'Egypt',
  };
}

/** A real 1 × 1 PNG: the browser tests show it, so a browser must be able to decode it. */
export const PNG_BYTES = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64',
));

export interface FakeSsi {
  fetch: Fetch;
  /** Every account's certification cards (`get_ccards`). */
  cards: FakeSsiCard[];
  /** Answers for `my.divessi.com/cert/<uid>`: by default the same small PNG for every card. */
  cardImages: Map<string, { status?: number; contentType?: string; bytes: Uint8Array }>;
  accounts: FakeSsiAccount[];
  /** Stored dives by SSI dive ID, deleted ones included (with odin_user_log_deleted: 1). */
  dives: Map<number, SsiRecord>;
  sites: FakeSsiSite[];
  /** Every account's buddy list entries. */
  buddies: FakeSsiBuddy[];
  /** Every call: its action and whether it carried a token (never the password). */
  calls: { what: string; method: string }[];
  /** Makes every token issued so far invalid, as when SSI's tokens expire; with an account ID only that account's. */
  expireTokens(accountId?: number): void;
  /** While set, every call answers with this HTTP status. */
  failWith: number | null;
  /** How a call with an unknown (expired) token is answered; null: `authenticated: false` at 200. */
  expiredAnswer: { status: number; body: unknown } | null;
  /** Answer saves as SSI does for a client that isn't its app: with an invented dive ID, storing nothing. */
  dropSaves: boolean;
  /** While set, every token expires right after the next logbook read, as when one runs out in the middle of an action. */
  expireAfterRead: boolean;
  /** While set, every token expires right after the next site save, as when one runs out between a site and its dive. */
  expireAfterSiteSave: boolean;
  /** Adds a dive as if it had been logged in the SSI app. */
  addDive(accountId: number, values: SsiRecord): number;
}

/** A dive typed by hand in SSI's app: rounded values, no profile, no computer (ADR 0030). */
export function handTypedDive(v: {
  at: string; depthM: number; minutes: number; siteId?: number; buddies?: number[]; comment?: string; nr?: number; tempC?: number;
}): SsiRecord {
  return {
    odin_user_log_nr: v.nr ?? null, odin_user_log_datetime: v.at, odin_user_log_date: v.at.slice(0, 10), odin_user_log_entry_time: v.at.slice(11, 16),
    odin_user_log_divetime: v.minutes, odin_user_log_depth_m: v.depthM, odin_user_log_avg_depth_m: 0,
    odin_user_log_watertemp_c: v.tempC ?? 0, odin_user_log_dive_sites_id: v.siteId ?? 0, odin_user_log_buddy_ids: v.buddies ?? [],
    odin_user_log_comment: v.comment ?? '', odin_user_log_divecomputer_serial_nr: null, odin_user_log_divecomputer_imported: 0,
    odin_user_log_diveSamples: '', odin_user_log_depthDataset: '', odin_user_log_divecomputer_dive_ref: null,
  };
}

/**
 * A dive synced to SSI from a dive computer by SSI's app: a profile every 5 s and the computer's serial number. A square
 * profile: down in a minute, `depthM` until a minute before the end. Field shapes as in dive #91 (SSI reference).
 */
export function computerDive(v: {
  at: string; depthM: number; minutes: number; manufacturer: string; product: string; serial: string; siteId?: number; nr?: number;
}): SsiRecord {
  const end = v.minutes * 60_000;
  const samples = [];
  for (let t = 0, n = 1; t <= end; t += 5000, n++) {
    const d = Math.min(v.depthM, (t / 60_000) * v.depthM, ((end - t) / 60_000) * v.depthM);
    samples.push(`{"n":${n},"t":${t},"d":${d.toFixed(1)},"s":0.0,"te":24.0,"ndl":${t < end / 2 ? 40 : 99},"gs":0.0,"gn":0.0,"a":0,"mf":134217728,"o":false,"dr":false,"rv":3.0}`);
  }
  return {
    ...handTypedDive({ at: v.at, depthM: v.depthM, minutes: v.minutes, ...(v.siteId && { siteId: v.siteId }), ...(v.nr && { nr: v.nr }) }),
    odin_user_log_divecomputer_serial_nr: v.serial, odin_user_log_divecomputer_manufacturer: v.manufacturer,
    odin_user_log_divecomputer_name: v.product, odin_user_log_divecomputer_imported: 1, odin_user_log_watertemp_c: 24,
    odin_user_log_diveSamples: `[${samples.join(',')}]`, odin_user_log_ean: 1, odin_user_log_ean_percent: 32,
  };
}

export function createFakeSsi(options: { accounts?: FakeSsiAccount[]; sites?: FakeSsiSite[]; buddies?: FakeSsiBuddy[]; cards?: FakeSsiCard[] } = {}): FakeSsi {
  const tokens = new Map<string, number>();
  let nextToken = 1;
  let nextDiveId = 27_000_001;
  let nextSiteId = 9_000_001;
  const fake: FakeSsi = {
    accounts: options.accounts ?? [{ email: 'erika@example.com', password: 'ssi-password', accountId: 5_012_047 }],
    sites: options.sites ?? [
      { odin_dive_sites_id: 3314, odin_dive_sites_name: 'Hausreef', odin_dive_sites_lat: 27.29, odin_dive_sites_lon: 33.82, odin_countries_code_iso: 'EG' },
    ],
    buddies: options.buddies ?? [],
    cards: options.cards ?? [],
    cardImages: new Map(),
    dives: new Map(),
    calls: [],
    failWith: null,
    expiredAnswer: null,
    dropSaves: false,
    expireAfterRead: false,
    expireAfterSiteSave: false,
    expireTokens: (accountId) => {
      for (const [token, owner] of tokens) if (accountId === undefined || owner === accountId) tokens.delete(token);
    },
    addDive(accountId, values) {
      const id = nextDiveId++;
      fake.dives.set(id, { ...values, odin_user_log_id: id, odin_user_log_user_master_id: accountId, odin_user_log_deleted: 0 });
      return id;
    },
    fetch: async (url, init) => {
      const address = new URL(url);
      // A card's picture: public by card ID, no token, no `what` (SSI's `my.divessi.com/cert/<uid>`).
      const picture = /\/cert\/([^/]+)$/.exec(address.pathname);
      if (picture) {
        fake.calls.push({ what: 'card_image', method: init.method });
        const given = fake.cardImages.get(decodeURIComponent(picture[1]!));
        const body = given ?? { bytes: PNG_BYTES };
        return {
          status: body.status ?? 200, text: async () => '',
          arrayBuffer: async () => body.bytes.buffer.slice(body.bytes.byteOffset, body.bytes.byteOffset + body.bytes.byteLength) as ArrayBuffer,
          headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? body.contentType ?? 'image/png'
            : name.toLowerCase() === 'content-length' ? String(body.bytes.byteLength) : null) },
        };
      }
      const params = address.searchParams;
      const what = params.get('what') ?? '';
      fake.calls.push({ what, method: init.method });
      const answer = (body: unknown, status = 200) => ({ status, text: async () => JSON.stringify(body) });
      if (fake.failWith !== null) return { status: fake.failWith, text: async () => '<html>error</html>' };
      if (params.get('ssiapp') === null) return answer({ error: 'no app' }, 400);

      if (what === 'authenticate') {
        const account = fake.accounts.find((a) => a.email === params.get('l') && a.password === params.get('p'));
        if (!account) return answer({ authenticated: false, error_message: 'Wrong e-mail or password' });
        const token = `token-${nextToken++}`;
        tokens.set(token, account.accountId);
        return answer({ authenticated: true, token, mid: account.accountId, authenticated_email: account.email });
      }
      const accountId = tokens.get(params.get('token') ?? '');
      if (accountId === undefined && fake.expiredAnswer) {
        const given = fake.expiredAnswer;
        return { status: given.status, text: async () => (typeof given.body === 'string' ? given.body : JSON.stringify(given.body)) };
      }
      if (accountId === undefined) return answer({ authenticated: false, authenticated_message: 'Please log in again', error_message: 'token' });

      if (what === 'get_divelog') {
        const own = [...fake.dives.values()].filter((d) => d.odin_user_log_user_master_id === accountId && d.odin_user_log_deleted !== 1);
        // The real logbook lists the sites of the account's dives; the fake's account has dived at all of them.
        const buddies = fake.buddies.filter((b) => b.owner === accountId)
          .map(({ owner: _owner, ...b }) => ({ ...b, master_id: b.buddy_master_id, forename: b.firstname, confirmed: 1, deleted: 0, favorite: 0 }));
        if (fake.expireAfterRead) {
          fake.expireAfterRead = false;
          tokens.clear();
        }
        return answer({ verified_dives: 0, logbook_details: own, logbook_sites: fake.sites, logbook_buddies: buddies });
      }
      if (what === 'get_divesite') {
        const found = fake.sites.find((s) => String(s.odin_dive_sites_id) === params.get('dsid'));
        // The real SSI answers one row in an array, flags as 0/1; an unknown ID is a 404 (checked 2026-10-24).
        if (!found) return answer({ error: 'not found' }, 404);
        return answer([{
          ...found, odin_dive_sites_is_private: found.odin_dive_sites_is_private ? 1 : 0,
          odin_dive_sites_is_private_owner: found.odin_dive_sites_is_private_owner ?? null, odin_dive_sites_deleted: found.odin_dive_sites_deleted ?? 0,
        }]);
      }
      if (what === 'save_divesite' && init.method === 'POST') {
        const row = JSON.parse(new URLSearchParams(init.body ?? '').get('json_data') ?? '{}') as Record<string, unknown>;
        if (row.odin_dive_sites_id !== null && row.odin_dive_sites_id !== undefined) return answer({ ok: '', error: 'only new sites are made here' });
        const id = nextSiteId++;
        const created = {
          ...row, odin_dive_sites_id: id, odin_dive_sites_is_private: row.odin_dive_sites_is_private ? 1 : 0, odin_dive_sites_deleted: 0,
          odin_countries_code_iso: row.odin_countries_code_iso ?? '',
        } as unknown as FakeSsiSite;
        fake.sites.push(created);
        if (fake.expireAfterSiteSave) {
          fake.expireAfterSiteSave = false;
          tokens.clear();
        }
        // The new ID is at the top level, in `success.New` and in `result.site` (checked 2026-10-24).
        return answer({ ok: 'saved', odin_dive_sites_id: id, success: { New: { odin_dive_sites_id: id } }, result: { site: created } });
      }
      if (what === 'get_ccards') {
        const own = fake.cards.filter((c) => c.owner === accountId).map(({ owner: _owner, ...c }) => ({
          ...c, ccard_cat_title: `course_cat_${c.ccard_cat}`, ccard_image_back: 'https://cdn.invalid/cards/back.jpg',
          ccard_image_front: `https://cdn.invalid/cards/1000/${c.ccard_course_short}.jpg`, ccard_image_front_thumb: `https://cdn.invalid/cards/200/${c.ccard_course_short}.jpg`,
        }));
        return answer({ ccard_amount: own.length, ccard_list: own, cat_array: ['scubadiving', 'freediving', 'other'] });
      }
      if (what === 'save_divelog' && init.method === 'POST') {
        const record = JSON.parse(new URLSearchParams(init.body ?? '').get('json_data') ?? '{}') as SsiRecord;
        const stored: SsiRecord = {
          ...record,
          // Our assumption of SSI's read side: booleans come back as 1/0 [T] (docs/research/2026-10-23-ssi-foundation-checks.md).
          ...Object.fromEntries(DIVE_ROW.filter(([key, type]) => type === 'bool' && typeof record[key] === 'boolean')
            .map(([key]) => [key, record[key] === true ? 1 : 0])),
          // SSI keeps minutes and drops leading zeros of serial numbers.
          odin_user_log_datetime: typeof record.odin_user_log_datetime === 'string' ? record.odin_user_log_datetime.slice(0, 16) : null,
          odin_user_log_divecomputer_serial_nr: typeof record.odin_user_log_divecomputer_serial_nr === 'string'
            ? record.odin_user_log_divecomputer_serial_nr.replace(/^0+(?=.)/, '') : null,
          odin_user_log_confirmed: false,
          odin_user_log_verified: false,
          odin_user_log_user_master_id: accountId,
        };
        // Since October 2026 SSI stores a save only from its own app's User-Agent; any other gets the answer of a create
        // with an invented ID, for an update too, and nothing is stored (the owner's account, 2026-10-10).
        if (fake.dropSaves || !/^Dart\/\d+\.\d+ \(dart:io\)$/.test(init.headers['User-Agent'] ?? '')) {
          return answer({ ok: 'added to Log', error: '', temp_id: '', odin_user_log_id: String(900_000_000 + (nextDiveId++ % 100_000_000)) });
        }
        const id = record.odin_user_log_id;
        if (id === null || id === undefined) {
          const created = nextDiveId++;
          fake.dives.set(created, { ...stored, odin_user_log_id: created });
          return answer({ ok: 'added to Log', error: '', temp_id: null, odin_user_log_id: created });
        }
        const existing = fake.dives.get(Number(id));
        if (!existing || existing.odin_user_log_user_master_id !== accountId) return answer({ ok: '', error: 'not found' });
        fake.dives.set(Number(id), { ...stored, odin_user_log_id: Number(id) });
        // An update answers with the usual answer wrapped in `success`, as the real SSI does (checked 2026-10-06).
        const ok = stored.odin_user_log_deleted === 1 ? 'deleted' : 'updated';
        return answer({ success: { ok, error: '', temp_id: '', odin_user_log_id: Number(id) }, result: ok });
      }
      return answer({ error: `unknown action ${what}` }, 400);
    },
  };
  return fake;
}
