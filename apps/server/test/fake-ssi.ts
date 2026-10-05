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
}

export interface FakeSsi {
  fetch: Fetch;
  accounts: FakeSsiAccount[];
  /** Stored dives by SSI dive ID, deleted ones included (with odin_user_log_deleted: 1). */
  dives: Map<number, SsiRecord>;
  sites: FakeSsiSite[];
  /** Every call: its action and whether it carried a token (never the password). */
  calls: { what: string; method: string }[];
  /** Makes every token issued so far invalid, as when SSI's tokens expire. */
  expireTokens(): void;
  /** While set, every call answers with this HTTP status. */
  failWith: number | null;
  /** Adds a dive as if it had been logged in the SSI app. */
  addDive(accountId: number, values: SsiRecord): number;
}

export function createFakeSsi(options: { accounts?: FakeSsiAccount[]; sites?: FakeSsiSite[] } = {}): FakeSsi {
  const tokens = new Map<string, number>();
  let nextToken = 1;
  let nextDiveId = 27_000_001;
  const fake: FakeSsi = {
    accounts: options.accounts ?? [{ email: 'erika@example.com', password: 'ssi-password', accountId: 5_012_047 }],
    sites: options.sites ?? [
      { odin_dive_sites_id: 3314, odin_dive_sites_name: 'Hausreef', odin_dive_sites_lat: 27.29, odin_dive_sites_lon: 33.82, odin_countries_code_iso: 'EG' },
    ],
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
        return answer({ verified_dives: 0, logbook_details: own, logbook_sites: fake.sites, logbook_buddies: [] });
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
        return answer({ ok: stored.odin_user_log_deleted === 1 ? 'deleted' : 'updated', error: '', temp_id: '', odin_user_log_id: Number(id) });
      }
      return answer({ error: `unknown action ${what}` }, 400);
    },
  };
  return fake;
}
