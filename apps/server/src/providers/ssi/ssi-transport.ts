// One call to SSI's app API, answered by the app's own rules (docs/research/2026-10-23-ssi-decompilation-review.md §3.2).
// Both the token and the password travel in the query string, so nothing here ever logs a URL or puts one into an
// error message.

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

export type Fetch = (url: string, init: {
  method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal;
}) => Promise<{
  status: number; text(): Promise<string>;
  /** Only read for a card image (ADR 0050). */
  arrayBuffer?(): Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null };
}>;

export class SsiError extends Error {
  constructor(
    /**
     * wrong_credentials: e-mail or password refused. signed_out: the token is no longer accepted.
     * refused: SSI answered but didn't save. unavailable: no answer, or an HTTP error. maintenance: HTTP 503.
     * bad_response: not what we expect.
     */
    readonly reason: 'wrong_credentials' | 'signed_out' | 'refused' | 'not_stored' | 'unavailable' | 'maintenance' | 'bad_response',
    detail: string,
  ) {
    super(`SSI ${reason}: ${detail}`);
  }
}

export interface SsiTransport {
  call(what: string, params: Record<string, string>, body?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createSsiTransport(options: { url: string; fetch: Fetch; timeoutMs: number }): SsiTransport {
  return {
    async call(what, params, body) {
      const url = `${options.url}?${new URLSearchParams({ ...APP_PARAMS, what, ...params })}`;
      let response: Awaited<ReturnType<Fetch>>;
      let text: string;
      try {
        response = await options.fetch(url, {
          method: body ? 'POST' : 'GET',
          headers: {
            'User-Agent': SSI_APP_USER_AGENT, Accept: 'application/json',
            ...(body && { 'Content-Type': 'application/x-www-form-urlencoded' }),
          },
          ...(body && { body: new URLSearchParams({ json_data: JSON.stringify(body) }).toString() }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        text = await response.text();
      } catch (error) {
        // The error of a failed fetch can quote the URL; keep only its kind.
        throw new SsiError('unavailable', `${what}: ${error instanceof Error ? error.name : 'network error'}`);
      }
      const data = parseJson(text);
      // The app reads a body status 401 as signed out under any HTTP status. A false `authenticated` is read the
      // same here, kept from the community report [S]; the app itself reads only `status` 401. While signing in
      // it means a refused password, which the caller decides.
      if (isObject(data) && (data.status === 401 || data.status === '401')) throw new SsiError('signed_out', what);
      if (what !== 'authenticate' && isObject(data) && data.authenticated === false) throw new SsiError('signed_out', what);
      if (response.status === 503) throw new SsiError('maintenance', `${what}: HTTP 503`);
      if (response.status < 200 || response.status >= 300) throw new SsiError('unavailable', `${what}: HTTP ${response.status}`);
      if (data === undefined) throw new SsiError('bad_response', `${what}: not JSON`);
      if (!isObject(data)) throw new SsiError('bad_response', `${what}: not an object`);
      return data;
    },
  };
}
