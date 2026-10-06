// SSI's private app API, the one the MySSI app uses (ADR 0024). What we rely on, and what to do when it changes:
// docs/references/ssi-app-api.md (keep it current with this file).
// Undocumented: one endpoint, the action in `what=`. Sign-in exchanges e-mail and password for a token, and
// every later call carries the token. Both travel in the query string, so nothing here ever logs a URL or
// puts one into an error message.

import type { SiteWaterType } from '../../vocabulary.js';
import { WATER_OF_BOW } from './ssi-sites.js';

/** The client label and version the Android app sends; SSI's API expects them on every call. */
const APP_PARAMS = { ssiapp: '0815_ADR', version: 'ADR_4.1.272-ssi', lang: 'en', context: 's' } as const;
export const DEFAULT_SSI_URL = 'https://api.divessi.com/app/a21.php';

export type Fetch = (url: string, init: {
  method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal;
}) => Promise<{ status: number; text(): Promise<string> }>;

/** An SSI dive record: a flat object of `odin_user_log_*` fields (about 340 of them). */
export type SsiRecord = Record<string, unknown>;

export interface SsiAccount {
  token: string;
  /** SSI's user master ID: the person's SSI account. */
  accountId: string;
  email: string;
}

/** A dive site from the User's own SSI logbook (the sites of their SSI dives). */
export interface SsiLogbookSite {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** As SSI gives it: ISO alpha-2 or alpha-3, or a country name. */
  country: string | null;
  /** From SSI's `bow` (body of water): salt or fresh; artificial or missing is null (as in ssi-sites.ts). */
  waterType: SiteWaterType | null;
}

/**
 * An entry in the account's own buddy list (checked 2026-10-05, docs/references/ssi-app-api.md): a dive lists these
 * entry IDs. Only the name and the buddy's SSI account are read; the rest of what SSI keeps (birth date, e-mail, phone,
 * address, picture) is dropped here.
 */
export interface SsiBuddy {
  id: number;
  name: string;
  /** The buddy's SSI account (`buddy_master_id`); null without one. */
  account: string | null;
}

export interface SsiLogbook {
  /** Dives that aren't deleted; SSI leaves deleted ones out. */
  dives: SsiRecord[];
  sites: SsiLogbookSite[];
  buddies: SsiBuddy[];
}

export class SsiError extends Error {
  constructor(
    /**
     * wrong_credentials: e-mail or password refused. signed_out: the token is no longer accepted.
     * refused: SSI answered but didn't save. unavailable: no answer, or an HTTP error. bad_response: not what we expect.
     */
    readonly reason: 'wrong_credentials' | 'signed_out' | 'refused' | 'unavailable' | 'bad_response',
    detail: string,
  ) {
    super(`SSI ${reason}: ${detail}`);
  }
}

export interface SsiClient {
  signIn(email: string, password: string): Promise<SsiAccount>;
  logbook(token: string): Promise<SsiLogbook>;
  /** Creates a dive (`odin_user_log_id: null`) or updates one; returns SSI's dive ID. */
  save(token: string, record: SsiRecord): Promise<{ id: string }>;
}

export interface SsiClientOptions {
  url?: string | undefined;
  fetch?: Fetch;
  /** Sent as User-Agent: Dive Hub says who it is (ADR 0024). */
  userAgent: string;
  timeoutMs?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const idText = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? String(v)
  : typeof v === 'string' && /^[1-9]\d*$/.test(v) ? v : null);
const numberOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null);

export function createSsiClient(options: SsiClientOptions): SsiClient {
  const fetchImpl: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  const base = options.url ?? DEFAULT_SSI_URL;
  const timeoutMs = options.timeoutMs ?? 60_000;

  async function call(what: string, params: Record<string, string>, body?: SsiRecord): Promise<Record<string, unknown>> {
    const url = `${base}?${new URLSearchParams({ ...APP_PARAMS, what, ...params })}`;
    let response: Awaited<ReturnType<Fetch>>;
    try {
      response = await fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          'User-Agent': options.userAgent, Accept: 'application/json',
          ...(body && { 'Content-Type': 'application/x-www-form-urlencoded' }),
        },
        ...(body && { body: new URLSearchParams({ json_data: JSON.stringify(body) }).toString() }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // The error of a failed fetch can quote the URL; keep only its kind.
      throw new SsiError('unavailable', `${what}: ${error instanceof Error ? error.name : 'network error'}`);
    }
    if (response.status < 200 || response.status >= 300) throw new SsiError('unavailable', `${what}: HTTP ${response.status}`);
    let data: unknown;
    try {
      data = JSON.parse(await response.text());
    } catch {
      throw new SsiError('bad_response', `${what}: not JSON`);
    }
    if (!isObject(data)) throw new SsiError('bad_response', `${what}: not an object`);
    return data;
  }

  return {
    async signIn(email, password) {
      const data = await call('authenticate', { l: email, p: password });
      const token = typeof data.token === 'string' ? data.token : null;
      const accountId = idText(data.mid);
      if (data.authenticated !== true || !token) throw new SsiError('wrong_credentials', 'authenticate refused');
      if (!accountId) throw new SsiError('bad_response', 'authenticate: no account id');
      return { token, accountId, email: typeof data.authenticated_email === 'string' ? data.authenticated_email : email };
    },

    async logbook(token) {
      const data = await call('get_divelog', { token });
      if (data.authenticated === false) throw new SsiError('signed_out', 'get_divelog');
      if (!Array.isArray(data.logbook_details)) throw new SsiError('bad_response', 'get_divelog: no logbook_details');
      const dives = data.logbook_details.filter(isObject)
        .filter((d) => d.odin_user_log_deleted !== 1 && d.odin_user_log_deleted !== true);
      const sites = (Array.isArray(data.logbook_sites) ? data.logbook_sites : []).filter(isObject).flatMap((s) => {
        const id = idText(s.odin_dive_sites_id);
        const name = typeof s.odin_dive_sites_name === 'string' ? s.odin_dive_sites_name : null;
        if (!id || !name || s.odin_dive_sites_deleted === 1) return [];
        const latitude = numberOrNull(s.odin_dive_sites_lat);
        const longitude = numberOrNull(s.odin_dive_sites_lon);
        const country = [s.odin_countries_code_iso, s.odin_dive_sites_country_iso3, s.odin_dive_sites_meta_country]
          .find((c): c is string => typeof c === 'string' && c.length > 0) ?? null;
        const waterType = typeof s.bow === 'string' ? WATER_OF_BOW[s.bow] ?? null : null;
        return [{ id, name, latitude: latitude !== null && longitude !== null ? latitude : null, longitude: latitude !== null ? longitude : null, country, waterType }];
      });
      const buddies = (Array.isArray(data.logbook_buddies) ? data.logbook_buddies : []).filter(isObject).flatMap((b) => {
        const id = idText(b.id);
        if (!id || b.deleted === 1 || b.deleted === '1') return [];
        const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
        const name = [text(b.firstname), text(b.lastname)].filter(Boolean).join(' ') || text(b.nickname);
        return name ? [{ id: Number(id), name, account: idText(b.buddy_master_id) }] : [];
      });
      return { dives, sites, buddies };
    },

    async save(token, record) {
      const data = await call('save_divelog', { token }, record);
      if (data.authenticated === false) throw new SsiError('signed_out', 'save_divelog');
      // An update answers with the usual answer wrapped in `success`: { success: { ok, error, odin_user_log_id }, result }
      // (checked 2026-10-06); a create answers it as it is.
      const answer = isObject(data.success) ? data.success : data;
      const id = idText(answer.odin_user_log_id);
      if (id) return { id };
      // SSI's reason, else which fields it sent instead (names only; values may hold personal data).
      const reason = typeof answer.error === 'string' && answer.error ? answer.error
        : `no dive id in the answer (ok: ${JSON.stringify(answer.ok ?? null)}, fields: ${Object.keys(data).join(', ')}${answer === data ? '' : ` / success: ${Object.keys(answer).join(', ')}`})`;
      throw new SsiError('refused', `save_divelog: ${reason}`);
    },
  };
}
