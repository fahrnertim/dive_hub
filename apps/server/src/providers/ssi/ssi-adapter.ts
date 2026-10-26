// SSI as a Provider (ADR 0024, 0027, 0029, 0030): what is SSI's own. Signing in, its logbook, its dive record, the ±2 min
// match, its dive numbers, the SSI site ID, buddies as entries of the User's own buddy list, and its dives to import. Everything SSI answers is turned into typed values here; no `odin_*` field is
// read outside this folder. Connections, Pushes, pacing and the routes are the generic layer's.
import {
  DIVE_FIELDS, ProviderError, type ActionContext, type Capabilities, type Delivered, type DiveExportAction, type OutgoingDive,
  type ProviderAdapter, type RemoteDive,
} from '../provider.js';
import { accountOnlyRow, newEntryRow, withAccountRow } from './ssi-buddy-row.js';
import { SsiError, type SsiBuddy, type SsiClient, type SsiLogbook, type SsiRecord } from './ssi-client.js';
import {
  buddyIdsOf, COMPARED_FIELDS, compareReadBack, createRecord, deleteRecord, fingerprint, localTime, startChangesAtSsi, updateRecord, withBuddies, writableRecord,
  type DiveForSsi,
} from './ssi-record.js';
import { contextOf, parseSsiDive, ssiOrigin, SSI_PARSER } from './ssi-import.js';
import { readSsiSite, ssiSiteRow, visibilityFor } from './ssi-site-record.js';

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
          {
            type: 'site_external_id', severity: 'blocking', source: 'ssi', createdBySend: true,
            description: 'SSI needs the dive site\'s SSI site ID; sending finds the site in your SSI logbook or creates it there as a private site.',
          },
          {
            type: 'diver_mapping', severity: 'advisory', source: 'ssi', roles: ['buddy', 'guide', 'instructor'],
            description: 'SSI lists buddies from your SSI buddy list; one who isn\'t there is added when their SSI account is known, else left out until you link or add them.',
          },
        ],
        readBackFields: [...COMPARED_FIELDS],
        // ADR 0048, the owner's checks of 2026-10-10: SSI keeps the number a create or an update carries, and takes one
        // twice without a word, so the adapter looks itself. Not checked: a verified dive, so a change may remove it.
        numbers: { set: ['create', 'update'], changeRemovesVerification: true },
      },
      // `list`: the whole logbook, profiles included, in one read (ADR 0030).
      import: { operations: ['list'] },
      // Every dive value travels both ways: the send carries it, the import reads it (ADR 0057).
      fields: Object.fromEntries(DIVE_FIELDS.map((field) => [field, ['import', 'export']])),
    },
    // `find`: the sites of the User's logbook; `list`: SSI's whole site list for the admin's Site import (ssi-sites.ts).
    diveSites: { import: { operations: ['find', 'list'], findBy: ['position'] } },
    // `find`: the buddy list (`get_buddies`). Export: `save_buddy` makes an entry, or gives one an account (piece 5).
    buddies: { import: { operations: ['find'] }, export: { operations: ['add', 'setAccount'] } },
    // `find`: the account's certification cards (`get_ccards`, ADR 0050); no call to change a card is known or wanted.
    certifications: { import: { operations: ['find'] } },
  },
  notices: ['shows_unconfirmed', 'presents_as_app'],
  limits: { pauseMs: 2000, run: { pauseMs: 5000, maxDives: 100 } },
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
    // The entry remembered for the Participant, if it is still in the list; else the one with their account.
    const remembered = p.entries?.ssi ? list.find((b) => String(b.id) === p.entries!.ssi) : undefined;
    const entry = remembered ?? (p.ids.ssi ? list.find((b) => b.account === p.ids.ssi) : undefined);
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
  call: 'authenticate' | 'get_divelog' | 'save_divelog' | 'get_ccards' | 'get_divesite' | 'save_divesite' | 'get_buddies' | 'save_buddy';
  connectionId: string | null;
  /** `ok`, or the reason SSI's client gave (`unavailable`, `signed_out`, …). */
  outcome: 'ok' | SsiError['reason'] | 'error';
  /** For a failed call: what went wrong, with SSI's own error text when it sent one (never a token or URL). */
  detail?: string;
  ms: number;
}

/** An entry of the buddy list as the Provider's typed value; the row for a save back stays here. */
const remoteBuddy = ({ id, row: _row, ...b }: SsiBuddy) => ({ remoteId: String(id), ...b });

/** SSI's maintenance (HTTP 503) is, for the generic layer, SSI being unavailable. */
const providerReason = (error: SsiError) => (error.reason === 'maintenance' ? 'unavailable' : error.reason);

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
      throw error instanceof SsiError ? new ProviderError(providerReason(error), error.message) : error;
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

  /** The last buddy list read per Connection, kept like the logbook; any `save_buddy` drops it. */
  const buddySnapshots = new Map<string, { at: number; buddies: SsiBuddy[] }>();

  /**
   * Reads the buddy list (`get_buddies`) at most once per action. `recent` may answer with a read from moments ago;
   * `current` always reads, because a save back sends SSI's own row.
   */
  function buddyListOf(ctx: ActionContext) {
    let read: Promise<SsiBuddy[]> | null = null;
    const current = () => {
      read ??= called('get_buddies', ctx.connectionId, () => client.buddies(ctx.access)).then((buddies) => {
        buddySnapshots.set(ctx.connectionId, { at: now(), buddies });
        return buddies;
      });
      return read;
    };
    const recent = () => {
      if (!read) {
        const kept = buddySnapshots.get(ctx.connectionId);
        if (kept && now() - kept.at < SNAPSHOT_MS) read = Promise.resolve(kept.buddies);
      }
      return current();
    };
    return { recent, current };
  }

  /** Saves a buddy row; the kept list is out of date after it. */
  async function saveBuddy(ctx: ActionContext, row: Parameters<SsiClient['saveBuddy']>[1]) {
    try {
      return await called('save_buddy', ctx.connectionId, () => client.saveBuddy(ctx.access, row));
    } finally {
      buddySnapshots.delete(ctx.connectionId);
    }
  }

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
    // SSI can answer a save with a dive ID and store nothing (ADR 0049): a dive that isn't in the logbook right after is
    // not a sent dive. Our reference finds it should it turn up later.
    if (!stored) throw new ProviderError('not_stored', 'save_divelog: SSI answered with a dive ID, but the dive is not in the logbook; nothing was stored');
    return { remoteId: id, remoteNumber: number, payload: withoutDatasets(sent), differences: compareReadBack(sent, stored) };
  }

  function open(ctx: ActionContext): DiveExportAction {
    const logbook = logbookOf(ctx);
    const buddyList = buddyListOf(ctx);
    const byId = async (remoteId: string) => (await logbook.current()).dives.find((r) => idOf(r.odin_user_log_id) === remoteId);
    /** Another dive of the logbook just read that has this number: SSI would take it twice. */
    const holderOf = async (number: number, except: string) =>
      (await logbook.current()).dives.find((r) => numberOf(r.odin_user_log_nr) === number && idOf(r.odin_user_log_id) !== except);
    return {
      async find(dive, reference) {
        const { dives } = await logbook.recent();
        // A dive sent before whose answer got lost carries our reference.
        const ours = dives.find((r) => r.odin_user_log_divecomputer_dive_ref === reference);
        const at = ssiMinutes(localTime(dive.startsAt, dive.utcOffsetSeconds).dateTime)!;
        const same = dives.find((r) => { const m = ssiMinutes(r.odin_user_log_datetime); return m !== null && Math.abs(m - at) <= SAME_DIVE_MINUTES; });
        return { ours: ours ? remoteDive(ours) : null, sameTime: same ? remoteDive(same) : null };
      },
      async create(dive, reference, wanted) {
        const { dives } = await logbook.recent();
        // SSI's dive number is the client's choice: Dive Hub's when it is asked to and no dive in the logbook has it
        // (a duplicate is never made), else the highest in the logbook + 1.
        const taken = wanted != null && dives.some((r) => numberOf(r.odin_user_log_nr) === wanted);
        const number = wanted != null && !taken ? wanted : Math.max(0, ...dives.map((r) => numberOf(r.odin_user_log_nr) ?? 0)) + 1;
        const { ids, leftOut } = buddiesFor(dive, await buddyList.recent());
        const record = withBuddies(createRecord(forSsi(dive), { number, accountId: ctx.accountId, reference }), ids);
        return { ...(await saveAndReadBack(ctx, record, number)), leftOut };
      },
      async current(remoteId) {
        const read = await logbook.current();
        const record = read.dives.find((r) => idOf(r.odin_user_log_id) === remoteId);
        if (!record) return null;
        const context = contextOf(read, ctx.accountId, await buddyList.current());
        const parsed = parseSsiDive(record, context, remoteId);
        return parsed ? { dive: parsed, context, record } : null;
      },
      async update(remoteId, dive, previous, wanted, leave) {
        const remote = await byId(remoteId);
        if (!remote) return null;
        const { ids: sent, leftOut } = buddiesFor(dive, await buddyList.current());
        // Buddies kept as the Provider has them: its IDs go back unchanged and Dive Hub's are not added.
        const asTheyAre = leave?.keep.includes('buddies') ?? false;
        // Cleared: none stays, not even those SSI holds that Dive Hub never sent.
        const cleared = leave?.clear.includes('buddies') ?? false;
        const ids = asTheyAre ? [] : cleared ? [] : sent;
        // Buddies set in SSI's app stay; those Dive Hub sent before are replaced by those it sends now.
        const sentBefore = asTheyAre ? [] : buddyIdsOf(previous);
        const kept = cleared ? [] : buddyIdsOf(remote).filter((id) => !sentBefore.includes(id) && !ids.includes(id));
        // The number there stays unless Dive Hub's is asked for and no other dive has it.
        const number = wanted != null && !(await holderOf(wanted, remoteId)) ? wanted : numberOf(remote.odin_user_log_nr);
        const record = { ...withBuddies(updateRecord(remote, forSsi(dive), leave), [...ids, ...kept]), odin_user_log_nr: number };
        return { ...(await saveAndReadBack(ctx, record, number)), leftOut };
      },
      async setNumber(remoteId, number, sharedWith) {
        const remote = await byId(remoteId);
        if (!remote) return null;
        // Another dive has it: only the one named (the swap's next step, ADR 0052) may, and only that one.
        const holders = (await logbook.current()).dives.filter((r) => numberOf(r.odin_user_log_nr) === number && idOf(r.odin_user_log_id) !== remoteId);
        const holder = holders.find((r) => idOf(r.odin_user_log_id) !== sharedWith);
        if (holder) return { result: 'taken', by: remoteDive(holder) };
        // SSI's own record back with only the number changed: nothing of Dive Hub's newer values goes along.
        const record = { ...writableRecord(remote), odin_user_log_nr: number };
        const { id } = await called('save_divelog', ctx.connectionId, () => client.save(ctx.access, record));
        const after = keep(ctx.connectionId, await called('get_divelog', ctx.connectionId, () => client.logbook(ctx.access)));
        const stored = after.dives.find((r) => idOf(r.odin_user_log_id) === id);
        if (!stored || numberOf(stored.odin_user_log_nr) !== number) throw new ProviderError('not_stored', 'save_divelog: SSI answered, but the dive does not have the number saved');
        return { result: 'set', remoteNumber: number };
      },
      async heldNumbers() {
        // The logbook as SSI has it now: a preview's read is the next save's too (kept for a minute, as for any action).
        return (await logbook.recent()).dives.map(remoteDive);
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
        const buddies = await (options?.recent ? buddyListOf(ctx).recent() : buddyListOf(ctx).current());
        return {
          records: logbook.dives.flatMap((r) => { const id = idOf(r.odin_user_log_id); return id ? [{ remoteId: id, record: r }] : []; }),
          context: contextOf(logbook, ctx.accountId, buddies),
        };
      },
      parse: parseSsiDive,
      origin: ssiOrigin,
      parser: SSI_PARSER,
    },
    diveSites: {
      // Another account's private site is dropped: Dive Hub can't use it and never keeps it.
      // A row without SSI's private flag is `unknown`, never public.
      find: async (ctx) => (await logbookOf(ctx).recent()).sites.flatMap((site) => {
        const { id, name, latitude, longitude, country, waterType } = site;
        const visibility = visibilityFor(site, ctx.accountId);
        return visibility ? [{ id, name, latitude, longitude, country, waterType, visibility }] : [];
      }),
      async get(ctx, id) {
        const record = await called('get_divesite', ctx.connectionId, () => client.site(ctx.access, id));
        const site = readSsiSite(record);
        if (!site || site.deleted || site.id !== id) return null;
        const visibility = visibilityFor(site, ctx.accountId);
        const { name, latitude, longitude, country, waterType } = site;
        return visibility ? { id, name, latitude, longitude, country, waterType, visibility } : null;
      },
      create: (ctx, site) => called('save_divesite', ctx.connectionId, () => client.saveSite(ctx.access, ssiSiteRow(site, ctx.accountId))),
    },
    buddies: {
      find: async (ctx) => (await buddyListOf(ctx).recent()).map(remoteBuddy),
      // With an account only that and the flags go: SSI fills the entry itself and answers an existing entry of the account
      // by that entry. Without, the app's whole row from scratch (docs/research/2026-10-27-ssi-buddy-checks.md).
      async add(ctx, person) {
        return remoteBuddy(await saveBuddy(ctx, person.account ? accountOnlyRow(person.account) : newEntryRow(person)));
      },
      async setAccount(ctx, entryId, account) {
        // The entry as SSI has it now goes back whole, so nothing of it changes but the account.
        const entry = (await buddyListOf(ctx).current()).find((b) => String(b.id) === entryId);
        if (!entry) throw new ProviderError('not_found', `get_buddies: no entry ${entryId} in the list`);
        return remoteBuddy(await saveBuddy(ctx, withAccountRow(entry.row, account)));
      },
    },
    certifications: {
      find: async (ctx) => (await called('get_ccards', ctx.connectionId, () => client.cards(ctx.access))).map((c) => ({
        remoteId: c.id, agency: 'SSI', level: c.courseName, courseId: c.courseId, category: c.category, issuedOn: c.issueDate,
        expiresOn: c.expireDate, divesAtIssue: c.dives, instructorName: c.instructorName, instructorNumber: c.instructorNumber,
        centreName: c.centreName, centreNumber: c.centreNumber, centreCity: c.centreCity, centreCountry: c.centreCountry,
        imageUrl: client.cardImageUrl(c.id),
      })),
      image: async (url) => {
        try {
          return await client.cardImage(url);
        } catch (error) {
          if (error instanceof SsiError) throw new ProviderError(providerReason(error), error.message.slice(0, 300));
          throw error;
        }
      },
    },
  };
}
