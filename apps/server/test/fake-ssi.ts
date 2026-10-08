// An in-memory SSI app API for tests (ADR 0024): tests and the browser tests' server never reach SSI.
// It answers like the real one as far as the community projects describe it (docs/research/2026-10-04-ssi-api.md),
// including what SSI does to stored values: minutes only, serial numbers without leading zeros.
import type { Fetch, SsiRecord } from '../src/providers/ssi/ssi-client.js';

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

export interface FakeSsi {
  fetch: Fetch;
  accounts: FakeSsiAccount[];
  /** Stored dives by SSI dive ID, deleted ones included (with odin_user_log_deleted: 1). */
  dives: Map<number, SsiRecord>;
  sites: FakeSsiSite[];
  /** Every account's buddy list entries. */
  buddies: FakeSsiBuddy[];
  /** Every call: its action and whether it carried a token (never the password). */
  calls: { what: string; method: string }[];
  /** Makes every token issued so far invalid, as when SSI's tokens expire. */
  expireTokens(): void;
  /** While set, every call answers with this HTTP status. */
  failWith: number | null;
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

export function createFakeSsi(options: { accounts?: FakeSsiAccount[]; sites?: FakeSsiSite[]; buddies?: FakeSsiBuddy[] } = {}): FakeSsi {
  const tokens = new Map<string, number>();
  let nextToken = 1;
  let nextDiveId = 27_000_001;
  const fake: FakeSsi = {
    accounts: options.accounts ?? [{ email: 'erika@example.com', password: 'ssi-password', accountId: 5_012_047 }],
    sites: options.sites ?? [
      { odin_dive_sites_id: 3314, odin_dive_sites_name: 'Hausreef', odin_dive_sites_lat: 27.29, odin_dive_sites_lon: 33.82, odin_countries_code_iso: 'EG' },
    ],
    buddies: options.buddies ?? [],
    dives: new Map(),
    calls: [],
    failWith: null,
    expireTokens: () => tokens.clear(),
    addDive(accountId, values) {
      const id = nextDiveId++;
      fake.dives.set(id, { ...values, odin_user_log_id: id, odin_user_log_user_master_id: accountId, odin_user_log_deleted: 0 });
      return id;
    },
    fetch: async (url, init) => {
      const params = new URL(url).searchParams;
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
      if (accountId === undefined) return answer({ authenticated: false, authenticated_message: 'Please log in again', error_message: 'token' });

      if (what === 'get_divelog') {
        const own = [...fake.dives.values()].filter((d) => d.odin_user_log_user_master_id === accountId && d.odin_user_log_deleted !== 1);
        // The real logbook lists the sites of the account's dives; the fake's account has dived at all of them.
        const buddies = fake.buddies.filter((b) => b.owner === accountId)
          .map(({ owner: _owner, ...b }) => ({ ...b, master_id: b.buddy_master_id, forename: b.firstname, confirmed: 1, deleted: 0, favorite: 0 }));
        return answer({ verified_dives: 0, logbook_details: own, logbook_sites: fake.sites, logbook_buddies: buddies });
      }
      if (what === 'save_divelog' && init.method === 'POST') {
        const record = JSON.parse(new URLSearchParams(init.body ?? '').get('json_data') ?? '{}') as SsiRecord;
        const stored: SsiRecord = {
          ...record,
          // SSI keeps minutes and drops leading zeros of serial numbers.
          odin_user_log_datetime: typeof record.odin_user_log_datetime === 'string' ? record.odin_user_log_datetime.slice(0, 16) : null,
          odin_user_log_divecomputer_serial_nr: typeof record.odin_user_log_divecomputer_serial_nr === 'string'
            ? record.odin_user_log_divecomputer_serial_nr.replace(/^0+(?=.)/, '') : null,
          odin_user_log_confirmed: false,
          odin_user_log_verified: false,
          odin_user_log_user_master_id: accountId,
        };
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
