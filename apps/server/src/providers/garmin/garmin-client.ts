// Garmin's Personal API (docs/references/garmin-connect-personal-api.md): a personal key becomes a 24-hour bearer
// token, the token reads the dive listing and the original file (a zip holding one FIT). The key and the token are
// never part of an error message.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eachFile } from '../../imports/archive.js';

export const DEFAULT_GARMIN_URL = 'https://personal.connectapi.garmin.com';
const PAGE_SIZE = 100;

export interface GarminToken {
  jwt: string;
  /** The JWT's `exp`, in ms since the epoch. */
  expiresAt: number;
  /** The JWT's `garmin_guid`: the person's Garmin account. */
  accountId: string;
}

export interface GarminActivity {
  activityId: number;
  startTimeLocal: string;
  startTimeGMT: string;
  typeKey: string;
  duration: number | null;
  /** As Garmin sends it in the listing, meters. */
  maxDepth: number | null;
  /** Entered by hand in Garmin Connect (`isManualActivity`): no file behind it. */
  manual: boolean;
  ownerDisplayName: string | null;
}

export interface GarminClient {
  token(key: string): Promise<GarminToken>;
  dives(token: string): Promise<GarminActivity[]>;
  /** The unzipped FIT of an activity; null when the zip Garmin sends holds none or can't be read (no file is behind it). */
  file(token: string, activityId: string): Promise<Uint8Array | null>;
}

export type GarminErrorReason = 'wrong_credentials' | 'unavailable' | 'bad_response';

export class GarminError extends Error {
  constructor(readonly reason: GarminErrorReason, message: string) {
    super(message);
  }
}

export function createGarminClient(opts: { url: string; fetch?: typeof fetch }): GarminClient {
  const doFetch = opts.fetch ?? fetch;

  async function call(path: string, headers: Record<string, string>, isTokenCall = false): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(new URL(path, opts.url), { method: isTokenCall ? 'POST' : 'GET', headers: { Accept: '*/*', ...headers } });
    } catch {
      throw new GarminError('unavailable', 'Garmin could not be reached');
    }
    if (res.ok) return res;
    if (res.status === 401 || res.status === 403) throw new GarminError('wrong_credentials', `Garmin refused the ${isTokenCall ? 'key' : 'token'} (${res.status})`);
    if (res.status === 429 || res.status >= 500) throw new GarminError('unavailable', `Garmin answered ${res.status}`);
    throw new GarminError('bad_response', `Garmin answered ${res.status}`);
  }

  /** An answer's body: one that breaks off is Garmin not answering, as a dropped call is. */
  async function bodyOf<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch {
      throw new GarminError('unavailable', "Garmin's answer broke off");
    }
  }

  return {
    async token(key) {
      const res = await call('/personalapitoken-service/personal-api/personal-api-key/token', { Authorization: `ApiKey ${key}` }, true);
      return readToken((await bodyOf(() => res.text())).trim());
    },

    async dives(token) {
      const all: GarminActivity[] = [];
      for (let start = 0; ; start += PAGE_SIZE) {
        const res = await call(`/activitylist-service/activities/search/activities?activityType=diving&start=${start}&limit=${PAGE_SIZE}`, bearer(token));
        const page: unknown = await res.json().catch(() => null);
        if (!Array.isArray(page)) throw new GarminError('bad_response', 'Garmin sent no dive list');
        const activities = page.map(readActivity);
        // A page that starts like the one before: Garmin ignores `start`, and the listing would never end.
        if (start > 0 && activities[0]?.activityId === all[start - PAGE_SIZE]?.activityId) {
          throw new GarminError('bad_response', 'Garmin sent the same page of the dive list again');
        }
        all.push(...activities);
        if (page.length < PAGE_SIZE) return all;
      }
    },

    async file(token, activityId) {
      const res = await call(`/download-service/files/activity/${encodeURIComponent(activityId)}`, bearer(token));
      return fitOf(new Uint8Array(await bodyOf(() => res.arrayBuffer())));
    },
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function readToken(jwt: string): GarminToken {
  try {
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown; garmin_guid?: unknown };
    if (typeof claims.exp === 'number' && typeof claims.garmin_guid === 'string' && claims.garmin_guid) {
      return { jwt, expiresAt: claims.exp * 1000, accountId: claims.garmin_guid };
    }
  } catch { /* falls through */ }
  throw new GarminError('bad_response', 'Garmin sent no readable token');
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

function readActivity(raw: unknown): GarminActivity {
  const a = (raw ?? {}) as Record<string, unknown>;
  const typeKey = str((a.activityType as Record<string, unknown> | undefined)?.typeKey);
  const activityId = num(a.activityId);
  const startTimeLocal = str(a.startTimeLocal);
  const startTimeGMT = str(a.startTimeGMT);
  if (activityId === null || !typeKey || !startTimeLocal || !startTimeGMT) throw new GarminError('bad_response', 'Garmin sent an unreadable dive');
  return {
    activityId, startTimeLocal, startTimeGMT, typeKey, duration: num(a.duration), maxDepth: num(a.maxDepth),
    manual: a.isManualActivity === true, ownerDisplayName: str(a.ownerDisplayName),
  };
}

/** The first `.fit` in the downloaded zip, read through the archive limits; null when there is none or the zip can't be read. */
async function fitOf(zip: Uint8Array): Promise<Uint8Array | null> {
  const dir = await mkdtemp(join(tmpdir(), 'divehub-garmin-'));
  try {
    const path = join(dir, 'download.zip');
    await writeFile(path, zip);
    let fit: Uint8Array | null = null;
    try {
      await eachFile(path, async (entry) => {
        if (!fit && /\.fit$/i.test(entry.name)) fit = await entry.read();
      });
    } catch {
      return null;
    }
    return fit;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
