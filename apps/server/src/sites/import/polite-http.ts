// Requests to public open-data services, as their usage policies ask (ADR 0021): a User-Agent that names
// Dive Hub and how to reach its makers (Wikimedia's policy), one request at a time, and after 429/406/504
// a pause (Retry-After, else 30 s, as the Overpass guidance says) and one more try.
import type { ImportSource } from '../sources.js';
import { SiteSourceError } from './site-source.js';

export const PROJECT_URL = 'https://github.com/fahrnertim/dive_hub';

/** `DiveHub (+https://github.com/…; ops@example.org)`: never anything about the instance or its Users. */
export const userAgent = (contact?: string) => `DiveHub (+${PROJECT_URL}${contact ? `; ${contact}` : ''})`;

export type Fetch = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface PoliteHttpOptions {
  fetch?: Fetch;
  contact?: string | undefined;
  /** Waits between tries; tests pass one that doesn't. */
  sleep?: (ms: number) => Promise<void>;
  /** Gives up on a request after this long (the services' own query limits are shorter). */
  timeoutMs?: number;
}

const RETRY_STATUSES = new Set([429, 406, 503, 504]);
const DEFAULT_PAUSE_MS = 30_000;
const MAX_PAUSE_MS = 120_000;

type Init = { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string };
/** Answers as text; `bytes` for a binary answer (SSI's zip). */
export type PoliteHttp = ((source: ImportSource, url: string, init: Init) => Promise<string>) & {
  bytes(source: ImportSource, url: string, init: Init): Promise<Buffer>;
};

export function createPoliteHttp(options: PoliteHttpOptions = {}): PoliteHttp {
  const fetchImpl: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 300_000;
  const agent = userAgent(options.contact);

  const request = async (source: ImportSource, url: string, init: Init) => {
    for (let attempt = 1; ; attempt++) {
      let response: Awaited<ReturnType<Fetch>>;
      try {
        response = await fetchImpl(url, {
          ...init, headers: { ...init.headers, 'User-Agent': agent }, signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new SiteSourceError(source, 'unavailable', error instanceof Error ? error.message : String(error));
      }
      if (response.status >= 200 && response.status < 300) return response;
      if (RETRY_STATUSES.has(response.status) && attempt === 1) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_PAUSE_MS) : DEFAULT_PAUSE_MS);
        continue;
      }
      throw new SiteSourceError(source, response.status === 429 ? 'rate_limited' : 'unavailable', `HTTP ${response.status}`);
    }
  };
  const read = async <T>(source: ImportSource, body: () => Promise<T>): Promise<T> => {
    try {
      return await body();
    } catch (error) {
      // The connection broke or the timeout hit while the answer was arriving.
      throw new SiteSourceError(source, 'unavailable', error instanceof Error ? error.message : String(error));
    }
  };
  return Object.assign(
    async (source: ImportSource, url: string, init: Init) => {
      const response = await request(source, url, init);
      return read(source, () => response.text());
    },
    {
      async bytes(source: ImportSource, url: string, init: Init) {
        const response = await request(source, url, init);
        return read(source, async () => Buffer.from(await response.arrayBuffer()));
      },
    },
  );
}
