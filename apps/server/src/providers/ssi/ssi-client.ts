// SSI's private app API, the one the MySSI app uses (ADR 0024). What we rely on, and what to do when it changes:
// docs/references/ssi-app-api.md (keep it current with this file).
// Undocumented: one endpoint, the action in `what=`. Sign-in exchanges e-mail and password for a token, and
// every later call carries the token. Both travel in the query string, so nothing here ever logs a URL or
// puts one into an error message.

import type { SiteWaterType } from '../../vocabulary.js';
import { WATER_OF_BOW } from './ssi-sites.js';

// What SSI's Android app sends on every call (the owner's capture, 2026-10-10, app 5.0.43): its label and version, and
// since 5.0 four fields about the phone. Dive Hub is no phone and says so there; SSI stores saves all the same.
const APP_PARAMS = {
  ssiapp: '0815_ADR', version: 'ADR_5.0.43-ssi', appVersion: '5.0.43-ssi', lang: 'en', context: 's',
  device: 'divehub', deviceName: 'Dive Hub', manufacturer: 'Dive Hub', osVersion: '36', platform: 'ADR', brand: 'SSI',
} as const;
/**
 * The User-Agent of SSI's app (ADR 0049). Since October 2026 SSI stores a save only when it comes with this form of
 * User-Agent (any `Dart/<version> (dart:io)`); for any other it answers "added to Log" with an invented dive ID and
 * stores nothing. Dive Hub's own name (ADR 0024) is one of the others.
 */
export const SSI_APP_USER_AGENT = 'Dart/3.12 (dart:io)';
export const DEFAULT_SSI_URL = 'https://api.divessi.com/app/a21.php';
export const DEFAULT_CARD_IMAGE_BASE = 'https://my.divessi.com/cert';
/** A card's picture is a PNG of about 200 KB (the capture of 2026-10-10); anything over this is not one. */
export const MAX_CARD_IMAGE_BYTES = 1_000_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type Fetch = (url: string, init: {
  method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal;
}) => Promise<{
  status: number; text(): Promise<string>;
  /** Only read for a card image (ADR 0050). */
  arrayBuffer?(): Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null };
}>;

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
 * entry IDs. Read are the name, the buddy's SSI account and what their buddy code says (first and last name, e-mail,
 * leader number: ADR 0043); the rest of what SSI keeps (birth date, phone, address, picture, comment) is dropped here.
 */
export interface SsiBuddy {
  id: number;
  name: string;
  /** The buddy's SSI account (`buddy_master_id`); null without one. */
  account: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  /** `leader_nr`; null when empty or 0. Whether `leader_active` matters for the code is unknown, so it isn't read. */
  leaderNumber?: string | null;
}

/** A certification card of the account (`get_ccards`, ADR 0050); values as SSI gives them, tidied to text. */
export interface SsiCard {
  id: string;
  courseName: string;
  courseShort: string | null;
  category: string | null;
  courseId: string | null;
  dives: number | null;
  issueDate: string | null;
  expireDate: string | null;
  instructorName: string | null;
  instructorNumber: string | null;
  centreName: string | null;
  centreNumber: string | null;
  centreCity: string | null;
  centreCountry: string | null;
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
    readonly reason: 'wrong_credentials' | 'signed_out' | 'refused' | 'not_stored' | 'unavailable' | 'bad_response',
    detail: string,
  ) {
    super(`SSI ${reason}: ${detail}`);
  }
}

export interface SsiClient {
  signIn(email: string, password: string): Promise<SsiAccount>;
  logbook(token: string): Promise<SsiLogbook>;
  /** The account's certification cards (ADR 0050). */
  cards(token: string): Promise<SsiCard[]>;
  /** The address of a card's picture, from its card ID. */
  cardImageUrl(cardId: string): string;
  /** A card's picture, public by card ID (no token), as PNG bytes; SsiError when it isn't one or is too big. */
  cardImage(url: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  /** Creates a dive (`odin_user_log_id: null`) or updates one; returns SSI's dive ID. */
  save(token: string, record: SsiRecord): Promise<{ id: string }>;
}

export interface SsiClientOptions {
  url?: string | undefined;
  /** Where cards' pictures are (`<base>/<card ID>`); default `https://my.divessi.com/cert`. */
  cardImageBase?: string | undefined;
  fetch?: Fetch;
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
  const cardImageBase = (options.cardImageBase ?? DEFAULT_CARD_IMAGE_BASE).replace(/\/+$/, '');

  async function call(what: string, params: Record<string, string>, body?: SsiRecord): Promise<Record<string, unknown>> {
    const url = `${base}?${new URLSearchParams({ ...APP_PARAMS, what, ...params })}`;
    let response: Awaited<ReturnType<Fetch>>;
    try {
      response = await fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          'User-Agent': SSI_APP_USER_AGENT, Accept: 'application/json',
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
        const leader = typeof b.leader_nr === 'number' ? String(b.leader_nr) : text(b.leader_nr);
        return name ? [{
          id: Number(id), name, account: idText(b.buddy_master_id),
          firstName: text(b.firstname) || null, lastName: text(b.lastname) || null, email: text(b.email) || null,
          leaderNumber: leader && leader !== '0' ? leader : null,
        }] : [];
      });
      return { dives, sites, buddies };
    },

    async cards(token) {
      const data = await call('get_ccards', { token });
      if (data.authenticated === false) throw new SsiError('signed_out', 'get_ccards');
      if (!Array.isArray(data.ccard_list)) throw new SsiError('bad_response', 'get_ccards: no ccard_list');
      const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' && v > 0 ? String(v) : null);
      const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !v.startsWith('0000') ? v.slice(0, 10) : null);
      return data.ccard_list.filter(isObject).flatMap((c): SsiCard[] => {
        const id = text(c.ccard_uid);
        const courseName = text(c.ccard_course_name);
        // A card ID goes into an address: only what SSI prints on a card.
        if (!id || !courseName || !/^[A-Za-z0-9._-]{4,64}$/.test(id)) return [];
        return [{
          id, courseName, courseShort: text(c.ccard_course_short), category: text(c.ccard_cat), courseId: text(c.ccard_course_id),
          dives: typeof c.ccard_dives === 'number' && Number.isInteger(c.ccard_dives) && c.ccard_dives >= 0 ? c.ccard_dives : null,
          issueDate: date(c.ccard_issue_date), expireDate: date(c.ccard_expire_date),
          instructorName: text(c.ccard_instructor_name), instructorNumber: text(c.ccard_instructor_number),
          centreName: text(c.ccard_divecenter_name), centreNumber: text(c.ccard_divecenter_number),
          centreCity: text(c.ccard_divecenter_city), centreCountry: text(c.ccard_divecenter_country),
        }];
      });
    },

    cardImageUrl: (cardId) => `${cardImageBase}/${encodeURIComponent(cardId)}`,

    async cardImage(url) {
      let response: Awaited<ReturnType<Fetch>>;
      try {
        response = await fetchImpl(url, { method: 'GET', headers: { 'User-Agent': SSI_APP_USER_AGENT, Accept: 'image/png' }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        // The address holds the card ID; keep only the kind of failure.
        throw new SsiError('unavailable', `card image: ${error instanceof Error ? error.name : 'network error'}`);
      }
      if (response.status < 200 || response.status >= 300) throw new SsiError('unavailable', `card image: HTTP ${response.status}`);
      const type = response.headers?.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (type !== 'image/png') throw new SsiError('bad_response', 'card image: not image/png');
      if (Number(response.headers?.get('content-length') ?? 0) > MAX_CARD_IMAGE_BYTES) throw new SsiError('bad_response', 'card image: too big');
      if (!response.arrayBuffer) throw new SsiError('bad_response', 'card image: no body');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_CARD_IMAGE_BYTES) throw new SsiError('bad_response', 'card image: too big');
      if (bytes.byteLength < PNG_MAGIC.length || PNG_MAGIC.some((b, i) => bytes[i] !== b)) throw new SsiError('bad_response', 'card image: not a PNG');
      return { bytes, mediaType: 'image/png' };
    },

    async save(token, record) {
      const data = await call('save_divelog', { token }, record);
      if (data.authenticated === false) throw new SsiError('signed_out', 'save_divelog');
      // An update answers with the usual answer wrapped in `success`: { success: { ok, error, odin_user_log_id }, result }
      // (checked 2026-10-06); a create answers it as it is.
      const answer = isObject(data.success) ? data.success : data;
      const id = idText(answer.odin_user_log_id);
      // An update SSI stored answers with the dive's own ID. Another one is SSI's answer to a client it doesn't store
      // saves for: "added to Log" with an invented ID (ADR 0049).
      const sent = idText(record.odin_user_log_id);
      if (id && sent && id !== sent) throw new SsiError('not_stored', `save_divelog: SSI answered another dive ID than the one saved; nothing was stored (ok: ${JSON.stringify(answer.ok ?? null)})`);
      if (id) return { id };
      // SSI's reason, else which fields it sent instead (names only; values may hold personal data).
      const reason = typeof answer.error === 'string' && answer.error ? answer.error
        : `no dive id in the answer (ok: ${JSON.stringify(answer.ok ?? null)}, fields: ${Object.keys(data).join(', ')}${answer === data ? '' : ` / success: ${Object.keys(answer).join(', ')}`})`;
      throw new SsiError('refused', `save_divelog: ${reason}`);
    },
  };
}
