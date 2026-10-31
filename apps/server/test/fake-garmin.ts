// An in-memory Garmin Personal API for tests: tests and the browser tests' server never reach Garmin. It answers like
// the real one as far as docs/references/garmin-connect-personal-api.md describes it, including the 406 for
// `Accept: application/json` on the token and download calls. Calls are recorded as method and path, never headers.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { zipOf } from './zip.js';

export interface FakeGarminDive {
  activityId: number;
  typeKey: string;
  startTimeLocal: string;
  manual?: boolean;
  fit: Uint8Array;
}

interface Account { key: string; guid: string; displayName: string; dives: FakeGarminDive[]; revoked: boolean }

export interface FakeGarmin {
  url: string;
  addAccount(a: { key: string; guid: string; displayName: string; dives: FakeGarminDive[] }): void;
  revoke(key: string): void;
  /** Every call as `METHOD path?query`. */
  calls: string[];
  close(): Promise<void>;
}

const jwtOf = (guid: string) => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  return `${part({ alg: 'RS256' })}.${part({ garmin_guid: guid, iat, exp: iat + 24 * 3600 })}.fake-signature`;
};

export async function createFakeGarmin(): Promise<FakeGarmin> {
  const accounts: Account[] = [];
  const tokens = new Map<string, Account>();
  const calls: string[] = [];

  const answer = (res: ServerResponse, status: number, body: string | Buffer, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type }).end(body);
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://fake');
    calls.push(`${req.method} ${url.pathname}${url.search}`);
    const auth = req.headers.authorization ?? '';
    if (url.pathname.startsWith('/personalapitoken-service/') || url.pathname.startsWith('/download-service/')) {
      if (req.headers.accept === 'application/json') return answer(res, 406, '{"errorId":"not-acceptable"}');
    }
    if (req.method === 'POST' && url.pathname === '/personalapitoken-service/personal-api/personal-api-key/token') {
      const account = accounts.find((a) => `ApiKey ${a.key}` === auth && !a.revoked);
      if (!account) return answer(res, 401, '{"errorId":"unauthorized"}');
      const jwt = jwtOf(account.guid);
      tokens.set(jwt, account);
      return answer(res, 200, jwt, 'text/plain');
    }
    const account = tokens.get(auth.replace(/^Bearer /, ''));
    if (!account || account.revoked) return answer(res, 401, '{"errorId":"unauthorized"}');
    if (url.pathname === '/activitylist-service/activities/search/activities') {
      if (url.searchParams.get('activityType') !== 'diving') return answer(res, 400, '{"errorId":"bad-request"}');
      const start = Number(url.searchParams.get('start') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 20);
      return answer(res, 200, JSON.stringify(account.dives.slice(start, start + limit).map((d) => activityOf(account, d))));
    }
    const file = /^\/download-service\/files\/activity\/(\d+)$/.exec(url.pathname);
    if (file) {
      const dive = account.dives.find((d) => String(d.activityId) === file[1]);
      if (!dive) return answer(res, 404, '{"errorId":"not-found"}');
      return answer(res, 200, await zipOf({ [`${dive.activityId}_ACTIVITY.fit`]: Buffer.from(dive.fit) }), 'application/x-zip-compressed');
    }
    return answer(res, 404, '{"errorId":"not-found"}');
  }

  const server = createServer((req, res) => { handle(req, res).catch(() => answer(res, 500, '{}')); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    addAccount: (a) => { accounts.push({ ...a, revoked: false }); },
    revoke: (key) => { for (const a of accounts) if (a.key === key) a.revoked = true; },
    calls,
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

/** A dive as the listing shows it (invented values; `maxDepth` in meters; the shape is from the owner's account of 2026-10-31). */
function activityOf(account: Account, d: FakeGarminDive) {
  const gmt = new Date(`${d.startTimeLocal.replace(' ', 'T')}Z`).toISOString().slice(0, 19).replace('T', ' ');
  return {
    activityId: d.activityId, activityName: 'Dive', startTimeLocal: d.startTimeLocal, startTimeGMT: gmt,
    activityType: { typeKey: d.typeKey }, duration: 2400.5, maxDepth: 18.4, avgDepth: 11.2,
    isManualActivity: d.manual ?? false, ownerDisplayName: account.displayName,
  };
}
