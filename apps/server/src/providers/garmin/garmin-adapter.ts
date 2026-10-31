// Garmin as an import-only Provider (ADR 0062, 0027, 0030): the User's own personal API key is the sign-in, the listing gives
// the preview its dives, and each dive's original FIT file is fetched by `file` for the generic import to place like an
// upload. Garmin is never sent to, so the adapter has no `open`, `mode` or `fingerprint`. The key and the token appear
// in no log and no error message.
import { diveModeFromFit } from '../../imports/formats/fit/fit-vocabulary.js';
import { ProviderError, type ActionContext, type Capabilities, type ImportedDive, type ProviderAdapter } from '../provider.js';
import { GarminError, type GarminActivity, type GarminClient, type GarminToken } from './garmin-client.js';

/** Where the User creates a key at Garmin Connect. */
export const GARMIN_KEY_PAGE = 'https://connect.garmin.com/app/settings/personalApiToken';
/** The pause between two downloads: Garmin publishes no limits. */
export const DEFAULT_PAUSE_MS = 1000;
/** A token is traded again this long before it expires. */
const TOKEN_MARGIN_MS = 60_000;

export const garminCapabilities = (pauseMs: number): Capabilities => ({
  name: 'Garmin',
  signIn: { kind: 'token', createUrl: GARMIN_KEY_PAGE, expires: true },
  // Everything of a dive comes from its FIT file, so no Provider fields are declared (ADR 0062).
  data: { dives: { import: { operations: ['list'] }, fields: {} } },
  notices: [],
  limits: { pauseMs, run: null, fetchEveryMinutes: 60 },
});

const providerError = (error: GarminError, signingIn: boolean) =>
  new ProviderError(error.reason === 'wrong_credentials' && !signingIn ? 'signed_out' : error.reason, error.message, { cause: error });

/** A listing record as the activity it was made from (it holds nothing else). */
const activityOf = (record: Record<string, unknown>) => record as unknown as GarminActivity;

export function createGarminAdapter(deps: {
  client: GarminClient; pauseMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number;
}): ProviderAdapter {
  const { client } = deps;
  const pauseMs = deps.pauseMs ?? DEFAULT_PAUSE_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const now = deps.now ?? Date.now;

  /** The token traded for a key, kept in memory until a minute before it expires. */
  const tokens = new Map<string, GarminToken>();
  let lastDownloadAt: number | null = null;

  /** Runs a call, turning Garmin's errors into the generic layer's. */
  async function called<T>(run: () => Promise<T>, signingIn = false): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw error instanceof GarminError ? providerError(error, signingIn) : error;
    }
  }

  /** The token for a key: the kept one, or a new one traded for the key (`reused`: it was kept). */
  async function tokenOf(key: string): Promise<{ jwt: string; reused: boolean }> {
    const kept = tokens.get(key);
    if (kept && now() < kept.expiresAt - TOKEN_MARGIN_MS) return { jwt: kept.jwt, reused: true };
    tokens.delete(key);
    const token = await called(() => client.token(key));
    tokens.set(key, token);
    return { jwt: token.jwt, reused: false };
  }

  /**
   * A call with the key's token. When Garmin refuses a kept token (`signed_out`), it is dropped and the call runs once more
   * with a new one, so a key revoked at Garmin is found at once. Any other failure (429, 5xx, unreadable) is not retried.
   */
  async function withToken<T>(context: ActionContext, run: (jwt: string) => Promise<T>): Promise<T> {
    const { jwt, reused } = await tokenOf(context.access);
    try {
      return await called(() => run(jwt));
    } catch (error) {
      if (!(error instanceof ProviderError && error.reason === 'signed_out')) throw error;
      tokens.delete(context.access);
      if (!reused) throw error;
      return withToken(context, run);
    }
  }

  return {
    id: 'garmin',
    capabilities: garminCapabilities(pauseMs),
    async signIn(input) {
      if (input.kind !== 'token') throw new ProviderError('wrong_credentials', 'Garmin signs in with a personal API key');
      const key = input.token.trim();
      const token = await called(() => client.token(key), true);
      // The listing names the account's owner; a failed read only leaves the label general.
      const owner = (await client.dives(token.jwt).catch(() => []))[0]?.ownerDisplayName;
      return { account: { id: token.accountId, label: owner ?? 'Garmin' }, access: key };
    },
    dives: {
      async list(context) {
        const activities = await withToken(context, (jwt) => client.dives(jwt));
        return {
          records: activities.map((a) => ({ remoteId: String(a.activityId), record: { ...a } })),
          context: { people: {}, sites: {} },
        };
      },
      parse(record) {
        const a = activityOf(record);
        const dive: ImportedDive = {
          // Entered by hand in Garmin Connect: no computer recorded it, so no file is behind it.
          remoteId: String(a.activityId), remoteNumber: null, evidence: a.manual ? 'logbook' : 'computer', reference: null,
          localStart: a.startTimeLocal, sitePosition: null, people: [],
          durationSeconds: a.duration ?? 0, maxDepthM: a.maxDepth, avgDepthM: null, waterTemperatureC: null, maxTemperatureC: null,
          notes: null, siteIds: {}, entry: null, exit: null, gases: [], gfLow: null, gfHigh: null, cnsStart: null, cnsEnd: null,
          device: null, samples: {}, cylinder: null, leadKg: null, diveMode: diveModeFromFit(a.typeKey) ?? null,
          surfaceIntervalSeconds: null, avgHeartRate: null,
        };
        return dive;
      },
      async file(context, remoteId) {
        if (lastDownloadAt !== null && now() - lastDownloadAt < pauseMs) await sleep(pauseMs - (now() - lastDownloadAt));
        try {
          return {
            bytes: await withToken(context, (jwt) => client.file(jwt, remoteId)),
            mediaType: 'application/vnd.ant.fit', fileName: `${remoteId}.fit`,
          };
        } finally {
          lastDownloadAt = now();
        }
      },
    },
  };
}
