// SSI as a Provider (ADR 0024, 0027, 0029, 0030): what is SSI's own. Signing in, its logbook, its dive record, the ±2 min
// match, its dive numbers, the SSI site ID, buddies as entries of the User's own buddy list, and its dives to import. Everything SSI answers is turned into typed values here; no `odin_*` field is
// read outside this folder. Connections, Pushes, pacing and the routes are the generic layer's.
import {
  ProviderError, type ActionContext, type Capabilities, type Delivered, type DiveExportAction, type OutgoingDive,
  type ProviderAdapter, type RemoteDive,
} from '../provider.js';
import { SsiError, type SsiBuddy, type SsiClient, type SsiLogbook, type SsiRecord } from './ssi-client.js';
import {
  buddyIdsOf, COMPARED_FIELDS, compareReadBack, createRecord, deleteRecord, fingerprint, localTime, startChangesAtSsi, updateRecord, withBuddies,
  type DiveForSsi,
} from './ssi-record.js';
import { contextOf, parseSsiDive, ssiOrigin, SSI_PARSER } from './ssi-import.js';

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
        requirements: [
          { type: 'site_external_id', severity: 'blocking', source: 'ssi', description: 'SSI needs the dive site\'s SSI site ID.' },
          {
            type: 'diver_mapping', severity: 'advisory', source: 'ssi', roles: ['buddy', 'guide', 'instructor'],
            description: 'SSI lists buddies from your SSI buddy list, found by their SSI account; one without an account is left out.',
          },
        ],
        readBackFields: [...COMPARED_FIELDS],
      },
      // `list`: the whole logbook, profiles included, in one read (ADR 0030).
      import: { operations: ['list'] },
    },
    // `find`: the sites of the User's logbook; `list`: SSI's whole site list for the admin's Site import (ssi-sites.ts).
    diveSites: { import: { operations: ['find', 'list'], findBy: ['position'] } },
    // `find`: the account's buddy list (no call to add an entry is known).
    buddies: { import: { operations: ['find'] } },
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

/**
 * The entries of the User's buddy list for the dive's Participants, found by their SSI account (ADR 0029); those not in
 * the list are left out.
 */
function buddiesFor(dive: OutgoingDive, list: SsiBuddy[]) {
  const ids: number[] = [];
  const leftOut: { diverId: string; reason: 'not_at_provider' }[] = [];
  for (const p of dive.participants) {
    const entry = p.ids.ssi ? list.find((b) => b.account === p.ids.ssi) : undefined;
    if (!entry) leftOut.push({ diverId: p.diverId, reason: 'not_at_provider' });
    else if (!ids.includes(entry.id)) ids.push(entry.id);
  }
  return { ids, leftOut };
}

/**
 * One call to SSI, for the server log: which call, for which Connection (null while signing in), how it ended and how
 * long it took. Never the token, password or URL. Shows when Dive Hub used an account at SSI.
 */
export interface SsiCallLog {
  call: 'authenticate' | 'get_divelog' | 'save_divelog';
  connectionId: string | null;
  /** `ok`, or the reason SSI's client gave (`unavailable`, `signed_out`, …). */
  outcome: 'ok' | SsiError['reason'] | 'error';
  /** For a failed call: what went wrong, with SSI's own error text when it sent one (never a token or URL). */
  detail?: string;
  ms: number;
}

export function createSsiAdapter(deps: { client: SsiClient; now?: () => number; onCall?: (call: SsiCallLog) => void }): ProviderAdapter {
  const { client } = deps;
  const now = deps.now ?? Date.now;

  /** One call to SSI, reported to `onCall`; SSI's client errors become the generic layer's reasons. */
  async function called<T>(call: SsiCallLog['call'], connectionId: string | null, run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const report = (outcome: SsiCallLog['outcome'], detail?: string) =>
      deps.onCall?.({ call, connectionId, outcome, ms: Math.round(performance.now() - started), ...(detail && { detail }) });
    try {
      const result = await run();
      report('ok');
      return result;
    } catch (error) {
      if (error instanceof SsiError) report(error.reason, error.message.slice(0, 300));
      else report('error');
      throw error instanceof SsiError ? new ProviderError(error.reason, error.message) : error;
    }
  }
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
      read ??= called('get_divelog', ctx.connectionId, () => client.logbook(ctx.access)).then((l) => keep(ctx.connectionId, l));
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
    const { id } = await called('save_divelog', ctx.connectionId, () => client.save(ctx.access, sent));
    const after = keep(ctx.connectionId, await called('get_divelog', ctx.connectionId, () => client.logbook(ctx.access)));
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
        const { dives, buddies } = await logbook.recent();
        // SSI's dive number is the client's choice: the highest in the logbook + 1.
        const number = Math.max(0, ...dives.map((r) => numberOf(r.odin_user_log_nr) ?? 0)) + 1;
        const { ids, leftOut } = buddiesFor(dive, buddies);
        const record = withBuddies(createRecord(forSsi(dive), { number, accountId: ctx.accountId, reference }), ids);
        return { ...(await saveAndReadBack(ctx, record, number)), leftOut };
      },
      async update(remoteId, dive, previous) {
        const remote = await byId(remoteId);
        if (!remote) return null;
        const { ids, leftOut } = buddiesFor(dive, (await logbook.current()).buddies);
        // Buddies set in SSI's app stay; those Dive Hub sent before are replaced by those it sends now.
        const sentBefore = buddyIdsOf(previous);
        const kept = buddyIdsOf(remote).filter((id) => !sentBefore.includes(id) && !ids.includes(id));
        const record = withBuddies(updateRecord(remote, forSsi(dive)), [...ids, ...kept]);
        return { ...(await saveAndReadBack(ctx, record, numberOf(remote.odin_user_log_nr))), leftOut };
      },
      async remove(remoteId) {
        const remote = await byId(remoteId);
        if (!remote) return 'gone';
        await called('save_divelog', ctx.connectionId, () => client.save(ctx.access, deleteRecord(remote)));
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
      const account = await called('authenticate', null, () => client.signIn(input.login, input.password));
      return { account: { id: account.accountId, label: account.email }, access: account.token };
    },
    dives: {
      mode: 'api', fingerprint: (dive) => fingerprint(forSsi(dive)), open,
      updateRemovesVerification: (dive, previous) => startChangesAtSsi(previous, dive),
      async list(ctx, options) {
        const read = logbookOf(ctx);
        const logbook = await (options?.recent ? read.recent() : read.current());
        return {
          records: logbook.dives.flatMap((r) => { const id = idOf(r.odin_user_log_id); return id ? [{ remoteId: id, record: r }] : []; }),
          context: contextOf(logbook),
        };
      },
      parse: parseSsiDive,
      origin: ssiOrigin,
      parser: SSI_PARSER,
    },
    diveSites: {
      find: async (ctx) => (await logbookOf(ctx).recent()).sites
        .map(({ id, name, latitude, longitude, country }) => ({ id, name, latitude, longitude, country })),
    },
    buddies: {
      find: async (ctx) => (await logbookOf(ctx).recent()).buddies.map(({ id, ...b }) => ({ remoteId: String(id), ...b })),
    },
  };
}
