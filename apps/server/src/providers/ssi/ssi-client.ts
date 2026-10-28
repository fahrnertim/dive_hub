// SSI's private app API, the one the MySSI app uses (ADR 0024). What we rely on, and what to do when it changes:
// docs/references/ssi-app-api.md (keep it current with this file).
// Undocumented: one endpoint, the action in `what=`. Sign-in exchanges e-mail and password for a token, and
// every later call carries the token. The transport (ssi-transport.ts) makes the calls and reads SSI's answers.

import type { SiteWaterType } from '../../vocabulary.js';
import { rowOf, type SsiBuddyRow } from './ssi-buddy-row.js';
import { readSsiSite } from './ssi-site-record.js';
import { createSsiTransport, SSI_APP_USER_AGENT, SsiError, type Fetch } from './ssi-transport.js';

export { SSI_APP_USER_AGENT };
export const DEFAULT_SSI_URL = 'https://api.divessi.com/app/a21.php';
export const DEFAULT_CARD_IMAGE_BASE = 'https://my.divessi.com/cert';
/** A card's picture is a PNG of about 200 KB (the capture of 2026-10-10); anything over this is not one. */
export const MAX_CARD_IMAGE_BYTES = 1_000_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type { Fetch };

/** An SSI dive record: a flat object of `odin_user_log_*` fields (345 of them, plus date and entry time). */
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
  /** SSI's private flag; null when the row doesn't have it (then nothing is known about the site's privacy). */
  private: boolean | null;
  /** The account (SSI's `mid`) the site is private to (`_is_private` set); null for a public site. */
  privateOwner: string | null;
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
  /** The app's keys as SSI returned them, for a save back (`save_buddy`). Never leaves `providers/ssi/`. */
  row: SsiBuddyRow;
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

export { SsiError };

export interface SsiClient {
  signIn(email: string, password: string): Promise<SsiAccount>;
  logbook(token: string): Promise<SsiLogbook>;
  /** The account's certification cards (ADR 0050). */
  cards(token: string): Promise<SsiCard[]>;
  /** The address of a card's picture, from its card ID. */
  cardImageUrl(cardId: string): string;
  /** A card's picture, public by card ID (no token), as PNG bytes; SsiError when it isn't one or is too big. */
  cardImage(url: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  /**
   * Creates a dive (`odin_user_log_id: null`) or updates one; returns SSI's dive ID and the record SSI answers it with
   * (`result.dive[0]`, null when the answer carries none or another dive's).
   */
  save(token: string, record: SsiRecord): Promise<{ id: string; stored: SsiRecord | null }>;
  /** One site by its ID (`get_divesite`); null when SSI doesn't know it (HTTP 404). */
  site(token: string, id: string): Promise<SsiRecord | null>;
  /** Creates a site (`odin_dive_sites_id: null`) from the app's site row; returns SSI's site ID. Sites can't be deleted at SSI. */
  saveSite(token: string, row: SsiRecord): Promise<string>;
  /** The account's buddy list (`get_buddies`); entries flagged deleted are left out. */
  buddies(token: string): Promise<SsiBuddy[]>;
  /** Saves a buddy row (`save_buddy`: a new entry with `id: null`, else that entry) and answers the entry as SSI keeps it. */
  saveBuddy(token: string, row: Partial<SsiBuddyRow>): Promise<SsiBuddy>;
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

/** The record a stored save's answer carries in `result.dive[0]`, when it is the answered dive's (checked 2026-10-28). */
function storedRecord(result: unknown, id: string): SsiRecord | null {
  const first: unknown = isObject(result) && Array.isArray(result.dive) ? result.dive[0] : null;
  return isObject(first) && idText(first.odin_user_log_id) === id ? first as SsiRecord : null;
}

/** One entry of the buddy list (`get_buddies`, `logbook_buddies`); a deleted entry, or one with neither name nor account, is none. */
function readBuddy(b: unknown): SsiBuddy[] {
  if (!isObject(b)) return [];
  const id = idText(b.id);
  if (!id || b.deleted === 1 || b.deleted === '1' || b.deleted === true) return [];
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const name = [text(b.firstname), text(b.lastname)].filter(Boolean).join(' ') || text(b.nickname);
  const leader = typeof b.leader_nr === 'number' ? String(b.leader_nr) : text(b.leader_nr);
  // `buddy_master_id` is the buddy's account (0: none); `master_id` is the same, as the app writes it.
  const account = idText(b.buddy_master_id) ?? idText(b.master_id);
  if (!name && !account) return [];
  return [{
    id: Number(id), name, account,
    firstName: text(b.firstname) || null, lastName: text(b.lastname) || null, email: text(b.email) || null,
    leaderNumber: leader && leader !== '0' ? leader : null, row: rowOf(b),
  }];
}

export function createSsiClient(options: SsiClientOptions): SsiClient {
  const fetchImpl: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  const base = options.url ?? DEFAULT_SSI_URL;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const cardImageBase = (options.cardImageBase ?? DEFAULT_CARD_IMAGE_BASE).replace(/\/+$/, '');

  const transport = createSsiTransport({ url: base, fetch: fetchImpl, timeoutMs });
  const { call } = transport;

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
      if (!Array.isArray(data.logbook_details)) throw new SsiError('bad_response', 'get_divelog: no logbook_details');
      const dives = data.logbook_details.filter(isObject)
        .filter((d) => d.odin_user_log_deleted !== 1 && d.odin_user_log_deleted !== true);
      const sites = (Array.isArray(data.logbook_sites) ? data.logbook_sites : []).flatMap((row): SsiLogbookSite[] => {
        const site = readSsiSite(row);
        if (!site || site.deleted) return [];
        const { id, name, latitude, longitude, country, waterType, privateOwner } = site;
        return [{ id, name, latitude, longitude, country, waterType, private: site.private, privateOwner }];
      });
      const buddies = (Array.isArray(data.logbook_buddies) ? data.logbook_buddies : []).flatMap(readBuddy);
      return { dives, sites, buddies };
    },

    async buddies(token) {
      const data = await call('get_buddies', { token });
      if (!Array.isArray(data.user_buddies)) throw new SsiError('bad_response', 'get_buddies: no user_buddies');
      return data.user_buddies.flatMap(readBuddy);
    },

    async saveBuddy(token, row) {
      const data = await call('save_buddy', { token }, row);
      // The app reads the saved entry from `result.buddy`, an array of one (checked 2026-10-27).
      const result = isObject(data.result) ? data.result : null;
      const saved = Array.isArray(result?.buddy) ? readBuddy(result.buddy[0]) : [];
      if (saved[0]) return saved[0];
      const reason = typeof data.error === 'string' && data.error ? data.error : `no buddy in the answer (fields: ${Object.keys(data).join(', ')})`;
      throw new SsiError('bad_response', `save_buddy: ${reason}`);
    },

    async cards(token) {
      const data = await call('get_ccards', { token });
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
      // An update answers with the usual answer wrapped in `success`: { success: { ok, error, odin_user_log_id }, result }
      // (checked 2026-10-06); a create answers it as it is.
      const answer = isObject(data.success) ? data.success : data;
      const id = idText(answer.odin_user_log_id);
      // An update SSI stored answers with the dive's own ID. Another one is SSI's answer to a client it doesn't store
      // saves for: "added to Log" with an invented ID (ADR 0049).
      const sent = idText(record.odin_user_log_id);
      if (id && sent && id !== sent) throw new SsiError('not_stored', `save_divelog: SSI answered another dive ID than the one saved; nothing was stored (ok: ${JSON.stringify(answer.ok ?? null)})`);
      if (id) return { id, stored: storedRecord(data.result, id) };
      // SSI's reason, else which fields it sent instead (names only; values may hold personal data).
      const reason = typeof answer.error === 'string' && answer.error ? answer.error
        : `no dive id in the answer (ok: ${JSON.stringify(answer.ok ?? null)}, fields: ${Object.keys(data).join(', ')}${answer === data ? '' : ` / success: ${Object.keys(answer).join(', ')}`})`;
      throw new SsiError('refused', `save_divelog: ${reason}`);
    },

    async site(token, id) {
      return transport.lookup('get_divesite', { token, dsid: id });
    },

    async saveSite(token, row) {
      const data = await call('save_divesite', { token }, row);
      // The new ID is at the top level; `success.New` holds it too (checked 2026-10-24).
      const created = isObject(data.success) && isObject(data.success.New) ? data.success.New : null;
      const id = idText(data.odin_dive_sites_id) ?? idText(created?.odin_dive_sites_id);
      if (id) return id;
      // SSI's reason, else which fields it sent instead (names only).
      const reason = typeof data.error === 'string' && data.error ? data.error : `no site id in the answer (fields: ${Object.keys(data).join(', ')})`;
      throw new SsiError('refused', `save_divesite: ${reason}`);
    },
  };
}
