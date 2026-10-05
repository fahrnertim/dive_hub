// SSI as a Provider (ADR 0024, 0027): what is SSI's own. Signing in, its logbook, its dive record, the ±2 min match,
// its dive numbers and the SSI site ID. Everything SSI answers is turned into typed values here; no `odin_*` field is
// read outside this folder. Connections, Pushes, pacing and the routes are the generic layer's.
import {
  ProviderError, type ActionContext, type Capabilities, type Delivered, type DiveExportAction, type OutgoingDive,
  type ProviderAdapter, type RemoteDive,
} from '../provider.js';
import { SsiError, type SsiClient, type SsiLogbook, type SsiRecord } from './ssi-client.js';
import {
  COMPARED_FIELDS, compareReadBack, createRecord, deleteRecord, fingerprint, localTime, updateRecord, type DiveForSsi,
} from './ssi-record.js';

/** Two dives this close in time (minutes) count as the same descent. */
const SAME_DIVE_MINUTES = 2;
/** How long the logbook read after a save serves as the next action's read (ADR 0027). */
const SNAPSHOT_MS = 2 * 60_000;

export const SSI_CAPABILITIES: Capabilities = {
  name: 'SSI',
  signIn: { kind: 'password', login: 'email' },
  data: {
    dives: {
      export: {
        operations: ['create', 'update', 'delete', 'link', 'find', 'readBack'],
        findBy: ['reference', 'time'],
        delivery: 'confirmed',
        needsSiteIdFrom: 'ssi',
        readBackFields: [...COMPARED_FIELDS],
      },
    },
    // `find`: the sites of the User's logbook; `list`: SSI's whole site list for the admin's Site import (ssi-sites.ts).
    diveSites: { import: { operations: ['find', 'list'], findBy: ['position'] } },
  },
  notices: ['shows_unconfirmed'],
  limits: { pauseMs: 2000 },
};

/** Minutes since 1970 of SSI's "YYYY-MM-DD HH:MM" (local time, compared with local time). */
function ssiMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T+](\d{2}):(\d{2})/.exec(value);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) / 60_000 : null;
}
const numberOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const idOf = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** SSI's record as a remote dive. */
const remoteDive = (r: SsiRecord): RemoteDive => ({
  remoteId: idOf(r.odin_user_log_id)!, number: numberOf(r.odin_user_log_nr),
  startsAt: typeof r.odin_user_log_datetime === 'string' ? r.odin_user_log_datetime.slice(0, 16) : null,
  maxDepthM: numberOf(r.odin_user_log_depth_m), durationMinutes: numberOf(r.odin_user_log_divetime),
});

/** The record as stored on the Push: without the sample datasets, which the fingerprint covers. */
const withoutDatasets = (record: SsiRecord) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => !/Dataset$|diveSamples$/.test(k)));

const forSsi = (dive: OutgoingDive): DiveForSsi => {
  const { siteIds, ...rest } = dive;
  return { ...rest, siteSsiId: siteIds.ssi ?? '' };
};

/** SSI's client errors as the generic layer's reasons; anything else passes through. */
async function asProvider<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw error instanceof SsiError ? new ProviderError(error.reason, error.message) : error;
  }
}

export function createSsiAdapter(deps: { client: SsiClient; now?: () => number }): ProviderAdapter {
  const { client } = deps;
  const now = deps.now ?? Date.now;
  /** The last logbook read per Connection, kept briefly so the next action doesn't read it again. */
  const snapshots = new Map<string, { at: number; logbook: SsiLogbook }>();

  const keep = (connectionId: string, logbook: SsiLogbook) => {
    snapshots.set(connectionId, { at: now(), logbook });
    return logbook;
  };
  const fresh = (connectionId: string) => {
    const kept = snapshots.get(connectionId);
    if (kept && now() - kept.at < SNAPSHOT_MS) return kept.logbook;
    snapshots.delete(connectionId);
    return null;
  };

  /**
   * Reads the logbook at most once per action. `recent` may answer with a read-back of the last two minutes (finding
   * a dive, picking the next number); `current` always reads, because an update or delete writes SSI's record back.
   */
  function logbookOf(ctx: ActionContext) {
    let read: Promise<SsiLogbook> | null = null;
    const current = () => {
      read ??= asProvider(client.logbook(ctx.access)).then((l) => keep(ctx.connectionId, l));
      return read;
    };
    const recent = () => {
      if (!read) {
        const kept = fresh(ctx.connectionId);
        if (kept) read = Promise.resolve(kept);
      }
      return current();
    };
    return { recent, current };
  }

  /** Saves, then reads the dive back and lists what SSI stored differently (null: not found again). */
  async function saveAndReadBack(ctx: ActionContext, sent: SsiRecord, number: number | null): Promise<Delivered> {
    const { id } = await asProvider(client.save(ctx.access, sent));
    const after = keep(ctx.connectionId, await asProvider(client.logbook(ctx.access)));
    const stored = after.dives.find((r) => idOf(r.odin_user_log_id) === id);
    return { remoteId: id, remoteNumber: number, payload: withoutDatasets(sent), differences: stored ? compareReadBack(sent, stored) : null };
  }

  function open(ctx: ActionContext): DiveExportAction {
    const logbook = logbookOf(ctx);
    const byId = async (remoteId: string) => (await logbook.current()).dives.find((r) => idOf(r.odin_user_log_id) === remoteId);
    return {
      async find(dive, reference) {
        const { dives } = await logbook.recent();
        // A dive sent before whose answer got lost carries our reference.
        const ours = dives.find((r) => r.odin_user_log_divecomputer_dive_ref === reference);
        const at = ssiMinutes(localTime(dive.startsAt, dive.utcOffsetSeconds).dateTime)!;
        const same = dives.find((r) => { const m = ssiMinutes(r.odin_user_log_datetime); return m !== null && Math.abs(m - at) <= SAME_DIVE_MINUTES; });
        return { ours: ours ? remoteDive(ours) : null, sameTime: same ? remoteDive(same) : null };
      },
      async create(dive, reference) {
        const { dives } = await logbook.recent();
        // SSI's dive number is the client's choice: the highest in the logbook + 1.
        const number = Math.max(0, ...dives.map((r) => numberOf(r.odin_user_log_nr) ?? 0)) + 1;
        return saveAndReadBack(ctx, createRecord(forSsi(dive), { number, accountId: ctx.accountId, reference }), number);
      },
      async update(remoteId, dive) {
        const remote = await byId(remoteId);
        if (!remote) return null;
        return saveAndReadBack(ctx, updateRecord(remote, forSsi(dive)), numberOf(remote.odin_user_log_nr));
      },
      async remove(remoteId) {
        const remote = await byId(remoteId);
        if (!remote) return 'gone';
        await asProvider(client.save(ctx.access, deleteRecord(remote)));
        const kept = snapshots.get(ctx.connectionId);
        if (kept) kept.logbook = { ...kept.logbook, dives: kept.logbook.dives.filter((r) => idOf(r.odin_user_log_id) !== remoteId) };
        return 'deleted';
      },
      // Read afresh, like a delete: a kept logbook could still list a dive just deleted in SSI's app.
      exists: async (remoteId) => !!(await byId(remoteId)),
    };
  }

  return {
    id: 'ssi',
    capabilities: SSI_CAPABILITIES,
    accountSource: 'ssi',
    async signIn(input) {
      if (input.kind !== 'password') throw new ProviderError('wrong_credentials', 'SSI signs in with e-mail and password');
      const account = await asProvider(client.signIn(input.login, input.password));
      return { account: { id: account.accountId, label: account.email }, access: account.token };
    },
    dives: { mode: 'api', fingerprint: (dive) => fingerprint(forSsi(dive)), open },
    diveSites: { find: async (ctx) => (await logbookOf(ctx).recent()).sites },
  };
}
