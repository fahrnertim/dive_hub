// SSI as a Target (ADR 0024): a User's Connections to SSI, and Pushes of their Dives through SSI's app API.
// A Connection belongs to one User and one of their Divers (whose SSI account it is). Pushes create, update,
// link or delete the SSI copy of a Dive; each is recorded with SSI's ID and number and what SSI stored.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  connection, device, dive, diveSite, diveSiteExternalId, diver, diverExternalId, push, recording, sampleSeries,
  type PushDifference,
} from '../db/schema.js';
import { managedDiverIds } from '../dives/dive-service.js';
import type { ProblemCode } from '../http/problems.js';
import type { SecretBox } from '../secrets/secret-box.js';
import { SsiError, type SsiClient, type SsiLogbookSite, type SsiRecord } from './ssi-client.js';
import {
  compareReadBack, createRecord, deleteRecord, fingerprint, localTime, updateRecord, type DiveForSsi, type Series,
} from './ssi-record.js';

export class SsiServiceError extends Error {
  constructor(readonly code: ProblemCode) {
    super(code);
  }
}

export interface ConnectInput {
  diverId: string;
  email: string;
  password: string;
  /** Store the password (encrypted) so Dive Hub can sign in again by itself when SSI's token expires. */
  keepSignedIn: boolean;
}

type ConnectionRow = typeof connection.$inferSelect;
type PushRow = typeof push.$inferSelect;

/** A dive already in the User's SSI logbook at the same time, offered instead of creating a second one. */
export interface ExistingSsiDive {
  remoteId: string;
  number: number | null;
  /** Local time as SSI keeps it, "YYYY-MM-DD HH:MM". */
  startsAt: string | null;
  maxDepthM: number | null;
  durationMinutes: number | null;
}

export type SendResult =
  | { result: 'created' | 'updated' | 'linked'; push: PushRow }
  | { result: 'exists'; existing: ExistingSsiDive };

/** Two dives this close in time (minutes) count as the same descent. */
const SAME_DIVE_MINUTES = 2;
const SUGGESTIONS = 20;

const tokenPurpose = (id: string) => `ssi-token:${id}`;
const passwordPurpose = (id: string) => `ssi-password:${id}`;
const reference = (diveId: string) => `divehub-${diveId}`;

const PROBLEM_OF: Record<SsiError['reason'], ProblemCode> = {
  wrong_credentials: 'ssi_wrong_credentials', signed_out: 'ssi_sign_in_needed', refused: 'ssi_refused',
  unavailable: 'ssi_unavailable', bad_response: 'ssi_unavailable',
};
const asProblem = (error: unknown) => (error instanceof SsiError ? new SsiServiceError(PROBLEM_OF[error.reason]) : error);

/** Minutes since 1970 of SSI's "YYYY-MM-DD HH:MM" (local time, compared with local time). */
function ssiMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T+](\d{2}):(\d{2})/.exec(value);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) / 60_000 : null;
}
const numberOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const idOf = (v: unknown) => (v === null || v === undefined ? null : String(v));

function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** The record as stored on the Push: without the sample datasets, which the fingerprint covers. */
const withoutDatasets = (record: SsiRecord) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => !/Dataset$|diveSamples$/.test(k)));

/**
 * The SSI dive a Dive currently has, from its Pushes (newest first): the last confirmed one with an ID,
 * unless a later delete or a "gone from SSI" came after it.
 */
export function currentRemote(pushes: PushRow[]): PushRow | null {
  for (const p of pushes) {
    if (p.errorCode === 'ssi_dive_gone') return null;
    if (p.state !== 'confirmed') continue;
    if (p.action === 'delete') return null;
    if (p.remoteId) return p;
  }
  return null;
}

export function createSsiService(deps: { db: Db; client: SsiClient; secrets: SecretBox }) {
  const { db, client, secrets } = deps;
  /** Dives being sent right now in this process: a second request waits for nothing and is refused. */
  const busy = new Set<string>();

  async function managedOrThrow(userId: string, diverId: string) {
    if (!(await managedDiverIds(db, userId)).has(diverId)) throw new SsiServiceError('diver_not_found');
  }

  async function ownConnection(userId: string, connectionId: string): Promise<ConnectionRow> {
    const [row] = await db.select().from(connection).where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
    if (!row) throw new SsiServiceError('connection_not_found');
    return row;
  }

  /** Signs in and keeps the new token (and the password, if the User chose to). */
  async function storeSignIn(id: string, token: string, password: string, keepSignedIn: boolean) {
    await db.update(connection).set({
      token: secrets.seal(token, tokenPurpose(id)),
      password: keepSignedIn ? secrets.seal(password, passwordPurpose(id)) : null,
      keepSignedIn, state: 'active', lastUsedAt: new Date(), updatedAt: new Date(),
    }).where(eq(connection.id, id));
  }

  /**
   * Runs `fn` with the Connection's token. When SSI no longer accepts it, Dive Hub signs in again by itself if
   * the password is kept; otherwise the Connection needs the User to sign in again.
   */
  async function withToken<T>(conn: ConnectionRow, fn: (token: string) => Promise<T>): Promise<T> {
    const needsSignIn = async () => {
      await db.update(connection).set({ state: 'needs_sign_in', token: null, updatedAt: new Date() }).where(eq(connection.id, conn.id));
      return new SsiServiceError('ssi_sign_in_needed');
    };
    if (conn.state === 'needs_sign_in' && !conn.password) throw new SsiServiceError('ssi_sign_in_needed');
    let token = conn.token ? secrets.open(conn.token, tokenPurpose(conn.id)) : null;
    for (let attempt = 1; ; attempt++) {
      if (!token) {
        if (!conn.password) throw await needsSignIn();
        try {
          const account = await client.signIn(conn.accountEmail, secrets.open(conn.password, passwordPurpose(conn.id)));
          token = account.token;
          await db.update(connection).set({ token: secrets.seal(token, tokenPurpose(conn.id)), state: 'active', updatedAt: new Date() })
            .where(eq(connection.id, conn.id));
        } catch (error) {
          // The kept password no longer works (changed at SSI): the User has to sign in.
          if (error instanceof SsiError && error.reason === 'wrong_credentials') throw await needsSignIn();
          throw asProblem(error);
        }
      }
      try {
        const result = await fn(token);
        await db.update(connection).set({ lastUsedAt: new Date(), state: 'active' }).where(eq(connection.id, conn.id));
        return result;
      } catch (error) {
        if (!(error instanceof SsiError && error.reason === 'signed_out') || attempt > 1) throw asProblem(error);
        token = null;
      }
    }
  }

  /** The Dive and what goes to SSI, if the User manages its Diver. */
  async function loadDive(userId: string, diveId: string) {
    const [row] = await db.select().from(dive).where(and(eq(dive.id, diveId), isNull(dive.deletedAt)));
    if (!row || !(await managedDiverIds(db, userId)).has(row.diverId)) throw new SsiServiceError('dive_not_found');
    const [rec] = row.primaryRecordingId
      ? await db.select().from(recording).where(eq(recording.id, row.primaryRecordingId)) : [];
    const [dev] = rec?.deviceId ? await db.select().from(device).where(eq(device.id, rec.deviceId)) : [];
    const series = rec
      ? await db.select().from(sampleSeries).where(and(eq(sampleSeries.recordingId, rec.id), inArray(sampleSeries.channel, ['depth', 'temperature', 'ndl'])))
      : [];
    const channel = (name: string): Series | undefined => {
      const s = series.find((x) => x.channel === name);
      return s ? { offsetsMs: s.offsetsMs, values: s.values } : undefined;
    };
    const [ssiSite] = row.siteId
      ? await db.select({ externalId: diveSiteExternalId.externalId }).from(diveSiteExternalId)
        .where(and(eq(diveSiteExternalId.siteId, row.siteId), eq(diveSiteExternalId.source, 'ssi')))
      : [];
    const [site] = row.siteId
      ? await db.select({ latitude: diveSite.latitude, longitude: diveSite.longitude, waterType: diveSite.waterType }).from(diveSite).where(eq(diveSite.id, row.siteId))
      : [];
    const summary = rec?.summary ?? {};
    const forSsi: DiveForSsi = {
      startsAt: row.startsAt, utcOffsetSeconds: row.utcOffsetSeconds, durationSeconds: row.durationSeconds,
      maxDepthM: row.maxDepthM, avgDepthM: row.avgDepthM, waterTemperatureC: row.waterTemperatureC,
      // The Dive's water is its site's (ADR 0025), not the computer's setting.
      maxTemperatureC: summary.maxTemperatureC ?? null, waterType: site?.waterType ?? null, notes: row.notes,
      siteSsiId: ssiSite?.externalId ?? '',
      entry: rec?.entryLatitude != null && rec.entryLongitude != null ? { latitude: rec.entryLatitude, longitude: rec.entryLongitude } : null,
      exit: rec?.exitLatitude != null && rec.exitLongitude != null ? { latitude: rec.exitLatitude, longitude: rec.exitLongitude } : null,
      gases: (summary.gases ?? []).map(({ o2, he }) => ({ o2, he })),
      gfLow: summary.gfLow ?? null, gfHigh: summary.gfHigh ?? null, cnsStart: summary.cnsStart ?? null, cnsEnd: summary.cnsEnd ?? null,
      device: dev ? { manufacturer: dev.manufacturer, product: dev.product, serialNumber: dev.serialNumber, firmware: dev.firmware } : null,
      samples: { depth: channel('depth'), temperature: channel('temperature'), ndl: channel('ndl') },
    };
    const sitePosition = site?.latitude != null && site.longitude != null ? { latitude: site.latitude, longitude: site.longitude } : null;
    // Where to look for SSI sites: the Dive site, else where the Device placed the dive.
    return { row, forSsi, siteSsiId: ssiSite?.externalId ?? null, position: sitePosition ?? forSsi.exit ?? forSsi.entry };
  }

  async function connectionFor(userId: string, diverId: string) {
    const [row] = await db.select().from(connection)
      .where(and(eq(connection.userId, userId), eq(connection.diverId, diverId), eq(connection.target, 'ssi')));
    return row ?? null;
  }

  async function pushesOf(diveId: string) {
    return db.select().from(push).where(eq(push.diveId, diveId)).orderBy(desc(push.createdAt), desc(push.id));
  }

  async function record(values: Omit<typeof push.$inferInsert, 'target' | 'mode'>) {
    const [row] = await db.insert(push).values({ target: 'ssi', mode: 'api', ...values }).returning();
    return row!;
  }

  /** Reads the dive back after saving and lists what SSI stored differently (null: not found again). */
  async function readBack(token: string, remoteId: string, sent: SsiRecord): Promise<PushDifference[] | null> {
    const stored = (await client.logbook(token)).dives.find((r) => idOf(r.odin_user_log_id) === remoteId);
    return stored ? compareReadBack(sent, stored) : null;
  }

  /** Runs one SSI action on a Dive at a time. */
  async function exclusive<T>(diveId: string, fn: () => Promise<T>): Promise<T> {
    if (busy.has(diveId)) throw new SsiServiceError('ssi_busy');
    busy.add(diveId);
    try {
      return await fn();
    } finally {
      busy.delete(diveId);
    }
  }

  return {
    /** Whether the server can keep passwords (DIVEHUB_ENCRYPTION_KEY is set). */
    canKeepPasswords: secrets.available,

    /** The User's SSI Connections, one per Diver at most. */
    async connections(userId: string) {
      return db.select({
        id: connection.id, diverId: connection.diverId, diverName: diver.name, accountId: connection.accountId,
        accountEmail: connection.accountEmail, keepSignedIn: connection.keepSignedIn, state: connection.state,
        lastUsedAt: connection.lastUsedAt, createdAt: connection.createdAt,
      }).from(connection).innerJoin(diver, eq(diver.id, connection.diverId))
        .where(and(eq(connection.userId, userId), eq(connection.target, 'ssi'))).orderBy(connection.createdAt);
    },

    /** Signs in to SSI once and keeps the Connection; the SSI account becomes the Diver's External ID. */
    async connect(userId: string, input: ConnectInput): Promise<string> {
      await managedOrThrow(userId, input.diverId);
      if (input.keepSignedIn && !secrets.available) throw new SsiServiceError('encryption_key_missing');
      if (await connectionFor(userId, input.diverId)) throw new SsiServiceError('ssi_already_connected');
      const account = await client.signIn(input.email, input.password).catch((error: unknown) => { throw asProblem(error); });
      const id = randomUUID();
      await db.transaction(async (tx) => {
        const [taken] = await tx.select().from(diverExternalId)
          .where(and(eq(diverExternalId.source, 'ssi'), eq(diverExternalId.externalId, account.accountId)));
        if (taken && taken.diverId !== input.diverId) throw new SsiServiceError('ssi_account_taken');
        if (!taken) {
          // A Diver has one SSI account: connecting another replaces the one it had.
          await tx.delete(diverExternalId).where(and(eq(diverExternalId.diverId, input.diverId), eq(diverExternalId.source, 'ssi')));
          await tx.insert(diverExternalId).values({ diverId: input.diverId, source: 'ssi', externalId: account.accountId });
        }
        await tx.insert(connection).values({
          id, userId, diverId: input.diverId, target: 'ssi', accountId: account.accountId, accountEmail: account.email,
          keepSignedIn: input.keepSignedIn,
          token: secrets.seal(account.token, tokenPurpose(id)),
          password: input.keepSignedIn ? secrets.seal(input.password, passwordPurpose(id)) : null,
          lastUsedAt: new Date(),
        });
      });
      return id;
    },

    /** Signs in again with the Connection's e-mail, e.g. after SSI's token expired; may change the choice to keep the password. */
    async signInAgain(userId: string, connectionId: string, password: string, keepSignedIn: boolean) {
      const conn = await ownConnection(userId, connectionId);
      if (keepSignedIn && !secrets.available) throw new SsiServiceError('encryption_key_missing');
      const account = await client.signIn(conn.accountEmail, password).catch((error: unknown) => { throw asProblem(error); });
      if (account.accountId !== conn.accountId) throw new SsiServiceError('ssi_other_account');
      await storeSignIn(conn.id, account.token, password, keepSignedIn);
    },

    /** Forgets the token and password. Pushes stay in the Dives' history; SSI keeps its dives. */
    async disconnect(userId: string, connectionId: string) {
      await ownConnection(userId, connectionId);
      await db.delete(connection).where(eq(connection.id, connectionId));
    },

    /** A Dive's state at SSI: its Connection, the SSI site ID, the current SSI dive and every Push. */
    async status(userId: string, diveId: string) {
      const { row, forSsi, siteSsiId } = await loadDive(userId, diveId);
      const conn = await connectionFor(userId, row.diverId);
      const pushes = await pushesOf(diveId);
      const current = currentRemote(pushes);
      return {
        connection: conn ? { id: conn.id, state: conn.state, accountEmail: conn.accountEmail } : null,
        siteId: row.siteId,
        siteSsiId,
        current: current ? {
          remoteId: current.remoteId!, remoteNumber: current.remoteNumber, sentAt: current.createdAt,
          upToDate: current.fingerprint !== null && current.fingerprint === fingerprint(forSsi),
        } : null,
        pushes,
      };
    },

    /** Dive sites of the User's SSI logbook, nearest to the Dive first (to pick the SSI site ID from). */
    async siteSuggestions(userId: string, diveId: string): Promise<(SsiLogbookSite & { distanceM: number | null })[]> {
      const { row, position } = await loadDive(userId, diveId);
      const conn = await connectionFor(userId, row.diverId);
      if (!conn) throw new SsiServiceError('ssi_not_connected');
      const { sites } = await withToken(conn, (token) => client.logbook(token));
      return sites
        .map((s) => ({ ...s, distanceM: position && s.latitude !== null && s.longitude !== null ? Math.round(distanceM(position, s as { latitude: number; longitude: number })) : null }))
        .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) || a.name.localeCompare(b.name))
        .slice(0, SUGGESTIONS);
    },

    /**
     * Sends the Dive: updates the SSI dive it already has, or creates one. Before creating, a dive at the same time
     * in the User's SSI logbook is offered instead (`exists`), unless `onExisting` says to link to it or to create anyway.
     */
    async send(userId: string, diveId: string, onExisting?: 'link' | 'create'): Promise<SendResult> {
      const { row, forSsi, siteSsiId } = await loadDive(userId, diveId);
      const conn = await connectionFor(userId, row.diverId);
      if (!conn) throw new SsiServiceError('ssi_not_connected');
      if (!siteSsiId) throw new SsiServiceError('ssi_site_missing');
      return exclusive(diveId, () => withToken(conn, async (token) => {
        const base = { diveId, connectionId: conn.id, userId, diveVersion: row.version, remoteReference: reference(diveId) };
        const logbook = await client.logbook(token);
        const current = currentRemote(await pushesOf(diveId));
        const fail = async (action: 'create' | 'update', error: unknown) => {
          const problem = asProblem(error);
          await record({ ...base, action, state: 'failed', errorCode: problem instanceof SsiServiceError ? problem.code : 'internal_error' });
          throw problem;
        };

        if (current) {
          const remote = logbook.dives.find((r) => idOf(r.odin_user_log_id) === current.remoteId);
          if (!remote) {
            await record({ ...base, action: 'update', state: 'failed', remoteId: current.remoteId, errorCode: 'ssi_dive_gone' });
            throw new SsiServiceError('ssi_dive_gone');
          }
          const sent = updateRecord(remote, forSsi);
          await client.save(token, sent).catch((error: unknown) => fail('update', error));
          const differences = await readBack(token, current.remoteId!, sent);
          return {
            result: 'updated', push: await record({
              ...base, action: 'update', state: 'confirmed', remoteId: current.remoteId, remoteNumber: numberOf(remote.odin_user_log_nr),
              fingerprint: fingerprint(forSsi), payload: withoutDatasets(sent), differences,
            }),
          };
        }

        // A dive sent before whose answer got lost carries our reference; it is ours.
        const ours = logbook.dives.find((r) => r.odin_user_log_divecomputer_dive_ref === reference(diveId));
        const at = ssiMinutes(localTime(forSsi.startsAt, forSsi.utcOffsetSeconds).dateTime)!;
        const same = ours ?? (onExisting === 'create' ? undefined
          : logbook.dives.find((r) => { const m = ssiMinutes(r.odin_user_log_datetime); return m !== null && Math.abs(m - at) <= SAME_DIVE_MINUTES; }));
        if (same && !ours && onExisting !== 'link') {
          return {
            result: 'exists', existing: {
              remoteId: idOf(same.odin_user_log_id)!, number: numberOf(same.odin_user_log_nr),
              startsAt: typeof same.odin_user_log_datetime === 'string' ? same.odin_user_log_datetime.slice(0, 16) : null,
              maxDepthM: numberOf(same.odin_user_log_depth_m), durationMinutes: numberOf(same.odin_user_log_divetime),
            },
          };
        }
        if (same) {
          // Linked, not sent: our values aren't there yet, so the Dive shows as changed until it is updated.
          return {
            result: 'linked', push: await record({
              ...base, action: 'link', state: 'confirmed', remoteId: idOf(same.odin_user_log_id), remoteNumber: numberOf(same.odin_user_log_nr),
              fingerprint: ours ? fingerprint(forSsi) : null,
            }),
          };
        }

        const number = Math.max(0, ...logbook.dives.map((r) => numberOf(r.odin_user_log_nr) ?? 0)) + 1;
        const sent = createRecord(forSsi, { number, accountId: conn.accountId, reference: reference(diveId) });
        const { id } = await client.save(token, sent).catch((error: unknown) => fail('create', error));
        const differences = await readBack(token, id, sent);
        return {
          result: 'created', push: await record({
            ...base, action: 'create', state: 'confirmed', remoteId: id, remoteNumber: number,
            fingerprint: fingerprint(forSsi), payload: withoutDatasets(sent), differences,
          }),
        };
      }));
    },

    /** Deletes the Dive's SSI copy there (SSI hides it; its app has no way back). The Dive stays in the hub. */
    async remove(userId: string, diveId: string): Promise<PushRow> {
      const { row } = await loadDive(userId, diveId);
      const conn = await connectionFor(userId, row.diverId);
      if (!conn) throw new SsiServiceError('ssi_not_connected');
      const current = currentRemote(await pushesOf(diveId));
      if (!current) throw new SsiServiceError('ssi_not_sent');
      return exclusive(diveId, () => withToken(conn, async (token) => {
        const base = { diveId, connectionId: conn.id, userId, diveVersion: row.version, remoteId: current.remoteId, remoteNumber: current.remoteNumber };
        const remote = (await client.logbook(token)).dives.find((r) => idOf(r.odin_user_log_id) === current.remoteId);
        if (!remote) {
          // Already deleted in the SSI app: nothing left to delete.
          return record({ ...base, action: 'delete', state: 'confirmed', errorCode: 'ssi_dive_gone' });
        }
        try {
          await client.save(token, deleteRecord(remote));
        } catch (error) {
          const problem = asProblem(error);
          await record({ ...base, action: 'delete', state: 'failed', errorCode: problem instanceof SsiServiceError ? problem.code : 'internal_error' });
          throw problem;
        }
        return record({ ...base, action: 'delete', state: 'confirmed' });
      }));
    },
  };
}

export type SsiService = ReturnType<typeof createSsiService>;
