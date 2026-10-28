// Importing a Provider's dives (ADR 0030), generic: what an adapter's `dives.list` and `dives.parse` give is decided
// here. Trust per dive by its evidence (sent by Dive Hub, from a dive computer, typed by hand) and per computer by the
// User; logbook entries match Dives here by local time and fill what they lack; computer dives become Recordings placed
// like a file's. A preview first (nothing stored), then an Import over one JSON Original per dive that the worker runs.
import { isDeepStrictEqual } from 'node:util';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import {
  connection, dive, diveSite, device, importJob, importOriginal, original, providerSiteData, push, user,
  recording, type ComputerChoice, type DiveImportMode, type ImportOutcome, type ProviderImportPlan, type UtcOffsetSource,
} from '../db/schema.js';
import { writeRevision, type Actor } from '../dives/revisions.js';
import { wallClockMs, type PlacedTime } from '../dives/time-zone.js';
import type { ParsedRecording } from '../imports/parsed-recording.js';
import { PROCESS_IMPORT_TASK } from '../imports/import-service.js';
import { deviceDiver, placeRecording } from '../imports/placement.js';
import { entryMatches } from '../imports/matching.js';
import { recordFindings } from './gone-dives.js';
import { probablyNoDive } from '../dives/logbook-check-rules.js';
import { siteOutlook } from '../sites/provider-sites.js';
import type { BlobStore } from '../storage/blob-store.js';
import type { ConnectionService } from './connection-service.js';
import { loadOutgoingDive } from './outgoing-dive.js';
import { REFERENCE_PREFIX, type DiveField, type ImportContext, type ImportedDive, type ProviderCylinder } from './provider.js';
import { createDiveChanges, importsField, type ProviderRun } from './dive-changes.js';
import { currentRemote, fingerprintNow } from './remote-state.js';
import { same, type SyncedField } from './three-way.js';
import { closeFields, entryOf, openFields, record as recordConflict, type StoredConflictField } from './conflicts.js';
import { queueNow } from './waiting-push-queue.js';
import { withRemembered } from './list-entries.js';
import { named, ProviderServiceError, type ProviderRegistry } from './registry.js';
import { renumber } from '../dives/dive-numbers.js';

/** A dive computer found at the Provider, and how its dives are used. */
export interface ComputerView {
  /** `manufacturer:serial`, the key of the choice. */
  key: string;
  manufacturer: string;
  product: string | null;
  serialNumber: string;
  dives: number;
  choice: ComputerChoice;
  /** Recordings, unless Dive Hub has this Device from files already (its files are better). */
  suggested: ComputerChoice;
  /** Dive Hub has recordings of this Device from files. */
  fromFiles: boolean;
  /** The Device belongs to a Diver this User doesn't keep: its dives come in as logbook entries (ADR 0030). */
  otherDiver: boolean;
}

/** A field changed both at the Provider and here since Dive Hub last saw the dive: the User chooses whose value stays. */
export interface ConflictView {
  remoteId: string;
  remoteNumber: number | null;
  diveId: string;
  number: number | null;
  startsAt: Date;
  utcOffsetSeconds: number | null;
  utcOffsetSource: UtcOffsetSource;
  field: SyncedField;
  /** A site's or people's names, a local time, a number; for `cylinder` the tank's values. */
  hub: string | number | string[] | ProviderCylinder | null;
  provider: string | number | string[] | ProviderCylinder | null;
}

/** A Dive here that a Provider's logbook entry may be. */
export interface CandidateView {
  diveId: string;
  number: number | null;
  startsAt: Date;
  utcOffsetSeconds: number | null;
  utcOffsetSource: UtcOffsetSource;
  durationSeconds: number;
  maxDepthM: number | null;
  site: { id: string; name: string } | null;
  /** Probably no dive (a Recording under 2 minutes above 3 m): the reason the User is asked about a single Dive (ADR 0030). */
  probablyNoDive: boolean;
}

/** What the import would do with one dive (ADR 0030). */
type Assessment =
  | { kind: 'ours'; diveId: string | null }
  | { kind: 'linked'; diveId: string }
  | { kind: 'deleted' }
  | { kind: 'recording' }
  | { kind: 'link'; diveId: string }
  | { kind: 'decide'; candidates: CandidateView[] }
  | { kind: 'create' }
  | { kind: 'no_match' }
  /** Unattended: from a dive computer the User hasn't chosen for yet. */
  | { kind: 'unchosen' };

/** What changed at the Provider since Dive Hub last saw a linked dive, compared with the Dive here. */
type FoundChanges = NonNullable<Awaited<ReturnType<ReturnType<typeof createDiveChanges>['changesOf']>>>;

const DAY_MS = 86_400_000;
const MAX_OFFSET_MS = 14 * 3600_000;
const keyOf = (d: { manufacturer: string; serialNumber: string }) => `${d.manufacturer}:${d.serialNumber}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createDiveImportService(deps: { db: Db; blobs: BlobStore; registry: ProviderRegistry; connections: ConnectionService }) {
  const { db, blobs, registry, connections } = deps;
  const { runOf, sitesOf, settle, placeTime, changesOf, takeChanges, fill, shown, conflictFields } = createDiveChanges({ db, blobs });

  /** The Provider's dive import, or `provider_unsupported`. */
  function importer(provider: string) {
    const adapter = registry.get(provider);
    const dives = adapter.dives;
    if (!dives?.list || !dives.parse || !adapter.capabilities.data.dives?.import?.operations.includes('list')) {
      throw new ProviderServiceError('provider_unsupported', named(adapter));
    }
    return { adapter, list: dives.list, parse: dives.parse };
  }

  /** The Connection's account's dives, read in one paced action, each parsed (null: not a dive Dive Hub can read). */
  async function read(userId: string, connectionId: string, options: { recent?: boolean; whateverTheMode?: boolean } = {}) {
    const row = await connections.own(userId, connectionId);
    const { adapter, list, parse } = importer(row.provider);
    if (row.importMode === 'off' && !options.whateverTheMode) throw new ProviderServiceError('provider_import_off', named(adapter));
    const listing = await connections.withAccess(row, (ctx) => list(ctx, options));
    // The entries without an account remembered for the Connection's account, so the dives' people can be Divers.
    const context = await withRemembered(db, row.diverId, adapter.accountSource, listing.context);
    const parsed = listing.records.map(({ remoteId, record }) => ({ remoteId, record, dive: parse(record, context) }));
    return { row, adapter, context, parsed };
  }

  /** The computers among the dives, with the User's choice kept on the Connection, else the suggestion. */
  async function computersOf(q: Db | Tx, run: ProviderRun, dives: ImportedDive[], saved: Record<string, ComputerChoice>) {
    const found = new Map<string, ComputerView>();
    for (const d of dives) {
      // A dive Dive Hub sent, or one linked to a Dive that has this computer's Recording, carries what Dive Hub has or
      // sent: not a computer found there.
      if (d.evidence !== 'computer' || !d.device || (await sentTo(q, run, d.remoteId))) continue;
      const linked = await linkedTo(q, run, d.remoteId);
      if (linked && (await hasRecordingOf(q, linked.diveId, d.device))) continue;
      const key = keyOf(d.device);
      const known = found.get(key);
      if (known) { known.dives += 1; continue; }
      const [fromFile] = await q.select({ id: recording.id }).from(recording)
        .innerJoin(device, eq(device.id, recording.deviceId)).innerJoin(importJob, eq(importJob.id, recording.importId))
        .where(and(eq(device.manufacturer, d.device.manufacturer), eq(device.serialNumber, d.device.serialNumber),
          isNull(device.deletedAt), isNull(importJob.provider)))
        .limit(1);
      const owner = await deviceDiver(q, d.device);
      const suggested: ComputerChoice = fromFile ? 'entries' : 'recordings';
      found.set(key, {
        key, manufacturer: d.device.manufacturer, product: d.device.product, serialNumber: d.device.serialNumber, dives: 1,
        choice: saved[key] ?? suggested, suggested, fromFiles: !!fromFile, otherDiver: owner !== null && !run.managed.has(owner),
      });
    }
    return [...found.values()].sort((a, b) => b.dives - a.dives || a.key.localeCompare(b.key));
  }

  /** Whether the Dive has a live Recording from this computer (a file's or a Provider's copy). */
  async function hasRecordingOf(q: Db | Tx, diveId: string, d: { manufacturer: string; serialNumber: string }) {
    const [row] = await q.select({ id: recording.id }).from(recording).innerJoin(device, eq(device.id, recording.deviceId))
      .where(and(eq(recording.diveId, diveId), isNull(recording.deletedAt), eq(device.manufacturer, d.manufacturer), eq(device.serialNumber, d.serialNumber)))
      .limit(1);
    return !!row;
  }

  /** The Dive this remote dive is linked to now (by a Push), among the User's, or null. */
  async function linkedTo(q: Db | Tx, run: ProviderRun, remoteId: string) {
    const rows = await q.selectDistinct({ diveId: push.diveId }).from(push)
      .where(and(eq(push.provider, run.adapter.id), eq(push.remoteId, remoteId)));
    for (const { diveId } of rows) {
      const pushes = await q.select().from(push).where(and(eq(push.diveId, diveId), eq(push.provider, run.adapter.id)))
        .orderBy(desc(push.createdAt), desc(push.id));
      if (currentRemote(pushes)?.remoteId !== remoteId) continue;
      const [d] = await q.select({ diverId: dive.diverId, deletedAt: dive.deletedAt }).from(dive).where(eq(dive.id, diveId));
      if (d && run.managed.has(d.diverId)) return { diveId, deleted: d.deletedAt !== null };
    }
    return null;
  }

  /**
   * The Dive whose values Dive Hub sent to this remote dive (a confirmed create or update Push), among the User's: the
   * remote dive is Dive Hub's own then, like one carrying our reference (ADR 0030).
   */
  async function sentTo(q: Db | Tx, run: ProviderRun, remoteId: string): Promise<string | null> {
    const rows = await q.select({ diveId: push.diveId, diverId: dive.diverId }).from(push).innerJoin(dive, eq(dive.id, push.diveId))
      .where(and(eq(push.provider, run.adapter.id), eq(push.remoteId, remoteId), eq(push.state, 'confirmed'), inArray(push.action, ['create', 'update'])));
    return rows.find((r) => run.managed.has(r.diverId))?.diveId ?? null;
  }

  /** Of these Dives, those that have a remote dive at the Provider now (they are another remote dive's already). */
  async function withRemote(q: Db | Tx, run: ProviderRun, diveIds: string[]) {
    if (diveIds.length === 0) return new Set<string>();
    const rows = await q.select().from(push).where(and(eq(push.provider, run.adapter.id), inArray(push.diveId, diveIds)))
      .orderBy(desc(push.createdAt), desc(push.id));
    return new Set(diveIds.filter((id) => currentRemote(rows.filter((p) => p.diveId === id))));
  }

  /**
   * What the import does with one dive (the preview says it, the worker does it). `unattended`: a computer's dive whose
   * computer has no choice in `run.choices` waits for the User (Recordings or entries could go wrong, hard to undo).
   */
  async function assess(q: Db | Tx, run: ProviderRun, d: ImportedDive, unattended = false): Promise<Assessment> {
    if (d.evidence === 'ours') {
      // The Dive it is linked to now, when that isn't the one our reference names: the Dive it was sent from was merged
      // into another, which took the link (ADR 0038). Changes made at the Provider then come back to that Dive.
      const now = await linkedTo(q, run, d.remoteId);
      if (now && !now.deleted) return { kind: 'ours', diveId: now.diveId };
      const id = d.reference?.slice(REFERENCE_PREFIX.length) ?? '';
      return { kind: 'ours', diveId: uuid.test(id) ? id : null };
    }
    const sent = await sentTo(q, run, d.remoteId);
    if (sent) return { kind: 'ours', diveId: sent };
    // A Recording made from it before is placed again: changed at the Provider, it is updated in place.
    const [asRecording] = await q.select({ id: recording.id }).from(recording)
      .where(and(eq(recording.recordingKey, `${run.adapter.id}:${d.remoteId}`), isNull(recording.deletedAt)));
    if (asRecording) return { kind: 'recording' };
    const linked = await linkedTo(q, run, d.remoteId);
    if (linked?.deleted) return { kind: 'deleted' };
    if (d.evidence === 'computer' && d.device && run.choices[keyOf(d.device)] !== 'entries') {
      const owner = await deviceDiver(q, d.device);
      // Linked already (made from it as a logbook entry, before its computer was recognised): its profile still comes in,
      // unless the Dive has that computer's Recording (its own file) already.
      const usable = owner === null || run.managed.has(owner);
      if (usable && (!linked || !(await hasRecordingOf(q, linked.diveId, d.device)))) {
        return unattended && !(keyOf(d.device) in run.choices) ? { kind: 'unchosen' } : { kind: 'recording' };
      }
    }
    if (linked) return { kind: 'linked', diveId: linked.diveId };
    const local = wallClockMs(d.localStart)!;
    const rows = await q.select({
      id: dive.id, number: dive.number, startsAt: dive.startsAt, utcOffsetSeconds: dive.utcOffsetSeconds,
      utcOffsetSource: dive.utcOffsetSource, durationSeconds: dive.durationSeconds, maxDepthM: dive.maxDepthM,
      deletedAt: dive.deletedAt, siteId: dive.siteId, siteName: diveSite.name,
    }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
      .where(and(
        eq(dive.diverId, run.diverId),
        gte(dive.startsAt, new Date(local - DAY_MS - MAX_OFFSET_MS)), lte(dive.startsAt, new Date(local + DAY_MS + MAX_OFFSET_MS)),
      ));
    const matches = entryMatches(local, rows, run.windowMinutes);
    const taken = await withRemote(q, run, matches.map((m) => m.id));
    const free = matches.filter((m) => !m.deletedAt && !taken.has(m.id));
    // A probable non-dive doesn't count as a match (ADR 0030, amended); where nothing else is in the window, the User
    // decides about it instead of the entry linking to it by itself.
    const withRecording = new Set(free.length === 0 ? [] : (await q.selectDistinct({ diveId: recording.diveId }).from(recording)
      .where(and(inArray(recording.diveId, free.map((m) => m.id)), isNull(recording.deletedAt)))).map((r) => r.diveId));
    const noDive = new Set(free.filter((m) => probablyNoDive({ ...m, recordings: withRecording.has(m.id) ? 1 : 0 })).map((m) => m.id));
    const real = free.filter((m) => !noDive.has(m.id));
    const live = real.length > 0 ? real : free;
    if (real.length === 1) return { kind: 'link', diveId: live[0]!.id };
    if (live.length > 0) {
      return {
        kind: 'decide',
        candidates: live.map((m) => ({
          diveId: m.id, number: m.number, startsAt: m.startsAt, utcOffsetSeconds: m.utcOffsetSeconds, utcOffsetSource: m.utcOffsetSource,
          durationSeconds: m.durationSeconds, maxDepthM: m.maxDepthM, site: m.siteId && m.siteName !== null ? { id: m.siteId, name: m.siteName } : null,
          probablyNoDive: noDive.has(m.id),
        })),
      };
    }
    // A Dive deleted here stays deleted (ADR 0026): its entry doesn't come back as a new Dive.
    if (matches.some((m) => m.deletedAt && !taken.has(m.id))) return { kind: 'deleted' };
    return run.mode === 'create' ? { kind: 'create' } : { kind: 'no_match' };
  }

  /**
   * Links the Dive to the Provider's dive (a `link` Push), unless it has a remote dive there already: sending then updates
   * that dive instead of making another. `upToDate`: the Dive was made from it, so it shows up to date.
   */
  async function link(tx: Tx, run: ProviderRun, diveId: string, d: ImportedDive, upToDate: boolean) {
    if ((await withRemote(tx, run, [diveId])).size > 0) return;
    const loaded = await loadOutgoingDive(tx, run.userId, diveId);
    await tx.insert(push).values({
      diveId, connectionId: run.connectionId, userId: run.userId, provider: run.adapter.id, mode: run.adapter.dives!.mode,
      action: 'link', state: 'confirmed', remoteId: d.remoteId, remoteNumber: d.remoteNumber, diveVersion: loaded.row.version,
      fingerprint: upToDate ? fingerprintNow(run.adapter, loaded) : null,
    });
  }

  /** A Dive without a Recording from a logbook entry (ADR 0030): its values, marked as the Provider's. */
  async function createDive(tx: Tx, run: ProviderRun, d: ImportedDive, actor: Actor): Promise<string> {
    const time = await placeTime(tx, run, d);
    const [created] = await tx.insert(dive).values({
      diverId: run.diverId, startsAt: time.startsAt, utcOffsetSeconds: time.utcOffsetSeconds, utcOffsetSource: time.utcOffsetSource,
      durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, avgDepthM: d.avgDepthM, waterTemperatureC: d.waterTemperatureC,
      fromProvider: run.adapter.id,
    }).returning({ id: dive.id });
    await writeRevision(tx, 'dive', created!.id, actor, 'import-create', { fromProvider: { from: null, to: run.adapter.id } });
    await fill(tx, run, created!.id, d, actor);
    await link(tx, run, created!.id, d, true);
    await renumber(tx, [run.diverId]);
    return created!.id;
  }

  /** The dive mode, surface interval and average heart rate a Provider names, where it names them and lets them in. */
  function summaryValuesOf(run: ProviderRun, d: ImportedDive) {
    return {
      ...(d.diveMode !== null && importsField(run, 'diveType') && { diveMode: d.diveMode }),
      ...(d.surfaceIntervalSeconds !== null && importsField(run, 'surfaceInterval') && { surfaceIntervalSeconds: d.surfaceIntervalSeconds }),
      ...(d.avgHeartRate !== null && importsField(run, 'heartRate') && { avgHeartRate: d.avgHeartRate }),
    };
  }

  /** A value the Provider names, where its `dives.fields` let that field in; else null. */
  const ifImported = <T>(run: ProviderRun, field: DiveField, value: T | null): T | null => (importsField(run, field) ? value : null);

  const CHANNEL_FIELD = { depth: 'profile', temperature: 'profile', ndl: 'profile', tankPressure: 'tankPressure', heartRate: 'heartRate', cns: 'cns' } as const;

  /** A computer's dive as a Recording, the way a FIT file's would be (ADR 0030); only the values the Provider's `dives.fields` let in. */
  function asRecording(run: ProviderRun, d: ImportedDive, time: PlacedTime): ParsedRecording {
    const series = (['depth', 'temperature', 'ndl', 'tankPressure', 'heartRate', 'cns'] as const).flatMap((channel) => {
      const s = importsField(run, CHANNEL_FIELD[channel]) ? d.samples[channel] : undefined;
      return s ? [{ channel, offsetsMs: s.offsetsMs.map(Math.round), values: s.values }] : [];
    });
    const temperatures = series.find((s) => s.channel === 'temperature')?.values ?? [];
    const cns = importsField(run, 'cns');
    // The Provider's own values only where they come in; else what the profile (when it comes in) says.
    const minTemperatureC = ifImported(run, 'waterTemperatureC', d.waterTemperatureC) ?? (temperatures.length ? Math.min(...temperatures) : null);
    const maxTemperatureC = ifImported(run, 'maxTemperatureC', d.maxTemperatureC) ?? (temperatures.length ? Math.max(...temperatures) : null);
    const summary = {
      ...(d.gases.length > 0 && importsField(run, 'gas') && { gases: d.gases }),
      ...(d.gfLow !== null && { gfLow: d.gfLow }), ...(d.gfHigh !== null && { gfHigh: d.gfHigh }),
      ...(minTemperatureC !== null && { minTemperatureC }),
      ...(maxTemperatureC !== null && { maxTemperatureC }),
      ...(cns && d.cnsStart !== null && { cnsStart: d.cnsStart }), ...(cns && d.cnsEnd !== null && { cnsEnd: d.cnsEnd }),
      ...summaryValuesOf(run, d),
    };
    const depths = series.find((s) => s.channel === 'depth')?.values ?? [];
    const device = importsField(run, 'device') ? d.device : null;
    return {
      device: device ? {
        manufacturer: device.manufacturer, serialNumber: device.serialNumber,
        ...(device.product && { product: device.product }), ...(device.firmware && { firmware: device.firmware }),
      } : undefined,
      recordingKey: `${run.adapter.id}:${d.remoteId}`,
      startsAt: time.startsAt, utcOffsetSeconds: time.utcOffsetSeconds ?? undefined, utcOffsetSource: time.utcOffsetSource,
      durationSeconds: d.durationSeconds,
      maxDepthM: ifImported(run, 'maxDepthM', d.maxDepthM) ?? (depths.length ? Math.max(...depths) : undefined), avgDepthM: d.avgDepthM ?? undefined,
      entryPosition: d.entry ?? undefined, exitPosition: d.exit ?? undefined,
      summary, series, events: [],
    };
  }

  /**
   * The changes with the fields of the Dive's open entry at the Provider held (ADR 0056, "while it is open the base
   * stays"): never taken, nor "changed only here" because a newer Original moved the base; a Conflict while the two
   * sides differ. `open`: the entry's fields the comparison covers.
   */
  async function held(q: Db | Tx, run: ProviderRun, diveId: string, d: ImportedDive, found: FoundChanges) {
    const open = (await openFields(q, diveId, run.adapter.id, d.remoteId)).filter((f) => found.here.fields.includes(f));
    // As a send: a Provider without a site never clears one here.
    const clash = open.filter((f) => !(f === 'site' && found.provider.site === null) && !same(f, found.provider, found.here.hub));
    return {
      take: found.take.filter((f) => !open.includes(f)), conflicts: [...found.conflicts.filter((f) => !open.includes(f)), ...clash], open,
    };
  }

  /**
   * Fields of an open entry the User kept Dive Hub's value for: the Dive is queued as a send with that choice, through
   * the Dive's Connection (the one its current remote dive was made through); none when it has no such Connection.
   */
  async function queueKept(tx: Tx, run: ProviderRun, diveId: string, remoteId: string, fields: SyncedField[]) {
    if (fields.length === 0) return;
    const pushes = await tx.select().from(push).where(and(eq(push.diveId, diveId), eq(push.provider, run.adapter.id)))
      .orderBy(desc(push.createdAt), desc(push.id));
    const current = currentRemote(pushes);
    if (current?.remoteId !== remoteId || !current.connectionId) return;
    // Only a Connection still the Dive's Diver's decides, as in `noteSent` (ADR 0056): another one queues nothing.
    const [own] = await tx.select({ id: connection.id }).from(connection).innerJoin(dive, eq(dive.diverId, connection.diverId))
      .where(and(eq(connection.id, current.connectionId), eq(dive.id, diveId)));
    if (!own) return;
    await queueNow(tx, diveId, run.adapter.id, current.connectionId, { conflicts: Object.fromEntries(fields.map((f) => [f, 'hub' as const])) });
  }

  /**
   * Conflicts an unattended import found and nobody chose for: Dive Hub's values stay and the Dive's entry waits in
   * "Needs your decision", the fields merged into an open one (one entry per Dive and Provider, no run). An entry that
   * would be the same is left as it is, so it isn't raised twice.
   */
  async function waitForUser(tx: Tx, run: ProviderRun, diveId: string, d: ImportedDive, found: FoundChanges, fields: SyncedField[]) {
    if (fields.length === 0 || !run.connectionId) return;
    const now = await conflictFields(run, fields, found.here, found.provider);
    const before = await entryOf(tx, diveId, run.adapter.id);
    const kept = before?.remoteId === d.remoteId ? before.fields.filter((f) => !fields.includes(f.field)) : [];
    const merged = [...kept, ...now];
    const byField = (list: StoredConflictField[]) => list.toSorted((a, b) => a.field.localeCompare(b.field));
    if (before?.remoteId === d.remoteId && isDeepStrictEqual(byField(before.fields), byField(merged))) return;
    await recordConflict(tx, { diveId, provider: run.adapter.id, connectionId: run.connectionId, remoteId: d.remoteId, fields: merged, runId: null });
  }

  /**
   * The Provider's changes since Dive Hub last saw the dive, taken where the Dive here kept its value, and where the User
   * chose the Provider's in a conflict; then what is still empty is filled. Whether anything changed.
   */
  async function sync(tx: Tx, run: ProviderRun, plan: ProviderImportPlan, diveId: string, d: ImportedDive, importId: string, actor: Actor) {
    const found = await changesOf(tx, run, diveId, d, importId);
    let fields: SyncedField[] = [];
    if (found) {
      const { take, conflicts, open } = await held(tx, run, diveId, d, found);
      const choice = (f: SyncedField) => plan.conflicts?.[`${d.remoteId}:${f}`];
      fields = [...take, ...conflicts.filter((f) => choice(f) === 'provider')];
      // The User's choice for a field of the open entry settles it there: asked once, not twice. Keeping Dive Hub's
      // value queues the Dive, due now, as every choice in "Needs your decision" does (ADR 0056).
      await closeFields(tx, diveId, run.adapter.id, open.filter((f) => choice(f) !== undefined));
      await queueKept(tx, run, diveId, d.remoteId, open.filter((f) => choice(f) === 'hub'));
      if (plan.unattended) await waitForUser(tx, run, diveId, d, found, conflicts.filter((f) => choice(f) === undefined));
    }
    const taken = fields.length > 0 && (await takeChanges(tx, run, diveId, d, fields, actor)).length > 0;
    const filled = await fill(tx, run, diveId, d, actor);
    return taken || filled;
  }

  /** The Dive a Provider's dive is linked to already (sent from here, linked, or a Recording of it), for comparing. */
  async function diveOfLinked(run: ProviderRun, a: Assessment, d: ImportedDive): Promise<string | null> {
    if (a.kind === 'linked') return a.diveId;
    if (a.kind === 'ours' && a.diveId) {
      const [own] = await db.select({ diverId: dive.diverId }).from(dive).where(and(eq(dive.id, a.diveId), isNull(dive.deletedAt)));
      return own && run.managed.has(own.diverId) ? a.diveId : null;
    }
    if (a.kind === 'recording') {
      const [rec] = await db.select({ diveId: recording.diveId }).from(recording)
        .where(and(eq(recording.recordingKey, `${run.adapter.id}:${d.remoteId}`), isNull(recording.deletedAt)));
      return rec?.diveId ?? null;
    }
    return null;
  }

  /** One dive of a running Import, in its own transaction. `seen`: its Original came with an earlier Import unchanged. */
  async function processDive(
    tx: Tx, run: ProviderRun, plan: ProviderImportPlan, d: ImportedDive, at: { importId: string; originalId: string; fileName: string; seen: boolean },
  ): Promise<ImportOutcome[number]> {
    const actor: Actor = { type: 'import', id: at.importId };
    const base = { fileName: at.fileName, remoteId: d.remoteId, ...(d.remoteNumber !== null && { remoteNumber: d.remoteNumber }) };
    const a = await assess(tx, run, d, plan.unattended);
    switch (a.kind) {
      case 'ours': {
        // Sent by Dive Hub: already ours. One whose answer got lost is linked to its Dive, as sending would.
        const [own] = a.diveId ? await tx.select({ diverId: dive.diverId }).from(dive).where(and(eq(dive.id, a.diveId), isNull(dive.deletedAt))) : [];
        if (!own || !run.managed.has(own.diverId)) return { ...base, result: 'skipped', reason: 'sent_by_dive_hub' };
        await link(tx, run, a.diveId!, d, false);
        // Changed in the Provider's app since it was sent: the Dive takes it, as for any linked dive.
        if (await sync(tx, run, plan, a.diveId!, d, at.importId, actor)) return { ...base, result: 'updated', diveId: a.diveId! };
        return { ...base, result: 'skipped', reason: 'sent_by_dive_hub', diveId: a.diveId! };
      }
      case 'deleted':
        return { ...base, result: 'skipped', reason: 'deleted_earlier' };
      case 'linked': {
        // Filled where still empty, also when unchanged: what Dive Hub can fill may have grown (a site an admin allowed).
        return { ...base, result: (await sync(tx, run, plan, a.diveId, d, at.importId, actor)) ? 'updated' : 'unchanged', diveId: a.diveId };
      }
      case 'recording': {
        const [known] = await tx.select({ id: recording.id, diveId: recording.diveId }).from(recording)
          .where(and(eq(recording.recordingKey, `${run.adapter.id}:${d.remoteId}`), isNull(recording.deletedAt)));
        if (known && at.seen) return { ...base, result: 'unchanged', recordingId: known.id, ...(known.diveId && { diveId: known.diveId }) };
        const placed = await placeRecording(tx, {
          userId: run.userId, importId: at.importId, originalId: at.originalId, fileName: at.fileName, actor,
          parser: run.adapter.dives!.parser ?? { name: run.adapter.id, version: '1' }, diverId: run.diverId,
        }, asRecording(run, d, await placeTime(tx, run, d)));
        if (placed.diveId && placed.result !== 'skipped') {
          await sync(tx, run, plan, placed.diveId, d, at.importId, actor);
          await link(tx, run, placed.diveId, d, placed.result === 'created');
        }
        return { ...placed, ...base };
      }
      case 'link':
        await fill(tx, run, a.diveId, d, actor);
        await link(tx, run, a.diveId, d, false);
        return { ...base, result: 'linked', diveId: a.diveId };
      case 'decide': {
        const choice = plan.decisions[d.remoteId];
        if (choice === 'leave_out') return { ...base, result: 'skipped', reason: 'left_out' };
        if (choice === 'new' && run.mode === 'create') return { ...base, result: 'created', diveId: await createDive(tx, run, d, actor) };
        if (choice && a.candidates.some((c) => c.diveId === choice)) {
          await fill(tx, run, choice, d, actor);
          await link(tx, run, choice, d, false);
          return { ...base, result: 'linked', diveId: choice };
        }
        // No decision that still fits (it turned ambiguous after the preview, or the User wasn't asked yet): left out.
        return { ...base, result: 'skipped', reason: 'ambiguous' };
      }
      case 'create':
        return { ...base, result: 'created', diveId: await createDive(tx, run, d, actor) };
      case 'no_match':
        return { ...base, result: 'skipped', reason: 'no_match' };
      case 'unchosen':
        return { ...base, result: 'skipped', reason: 'no_computer_choice' };
    }
  }

  return {
    /** Providers whose dives can be imported, and whether an admin allowed creating sites from their site data. */
    async siteData() {
      const rows = await db.select({ provider: providerSiteData.provider, allowedAt: providerSiteData.allowedAt, allowedBy: user.name })
        .from(providerSiteData).leftJoin(user, eq(user.id, providerSiteData.allowedBy));
      return registry.list().filter((a) => a.capabilities.data.dives?.import?.operations.includes('list')).map((a) => {
        const row = rows.find((r) => r.provider === a.id);
        return { provider: a.id, name: a.capabilities.name, allowedAt: row?.allowedAt ?? null, allowedBy: row?.allowedBy ?? null };
      });
    },

    /** An admin allows (having confirmed the explanation) or stops creating sites from a Provider's site data. */
    async allowSiteData(adminId: string, provider: string, allowed: boolean) {
      importer(provider);
      if (!allowed) {
        await db.delete(providerSiteData).where(eq(providerSiteData.provider, provider));
        return;
      }
      await db.insert(providerSiteData).values({ provider, allowedBy: adminId }).onConflictDoNothing();
    },

    /** Throws what `settings` would refuse (the Provider can't import), writing nothing. */
    async checkSettings(userId: string, connectionId: string) {
      importer((await connections.own(userId, connectionId)).provider);
    },

    /** What an import of the Connection's dives may do (ADR 0030). */
    async settings(userId: string, connectionId: string, set: {
      mode?: DiveImportMode | undefined; windowMinutes?: number | undefined; computers?: Record<string, ComputerChoice> | undefined;
    }) {
      const row = await connections.own(userId, connectionId);
      importer(row.provider);
      await db.update(connection).set({
        ...(set.mode && { importMode: set.mode }), ...(set.windowMinutes && { importWindowMinutes: set.windowMinutes }),
        ...(set.computers && { importComputers: { ...row.importComputers, ...set.computers } }), updatedAt: new Date(),
      }).where(eq(connection.id, row.id));
    },

    /**
     * How each dive at the Provider came about and when it starts (one paced action, nothing stored, whatever the import
     * mode): to find why a dive's time differs from a computer's. Oldest first; no names.
     */
    async diveTimes(userId: string, connectionId: string) {
      const { row, adapter, parsed } = await read(userId, connectionId, { whateverTheMode: true });
      const origin = adapter.dives?.origin;
      const dives = parsed.flatMap((p) => (p.dive ? [{
        remoteId: p.dive.remoteId, remoteNumber: p.dive.remoteNumber, localStart: p.dive.localStart,
        durationSeconds: p.dive.durationSeconds, maxDepthM: p.dive.maxDepthM, madeBy: p.dive.evidence,
        ...(origin ? origin(p.record) : { createdAt: null, confirmedByCentre: false, confirmedByLeader: false }),
      }] : []));
      return { provider: row.provider, dives: dives.sort((a, b) => a.localStart.localeCompare(b.localStart)) };
    },

    /**
     * What the import would do now (ADR 0030): reads the account's dives (one paced action) and stores nothing. The
     * computers found with their choice, how many dives go which way, and the logbook entries the User decides.
     */
    async preview(userId: string, connectionId: string) {
      const { row, adapter, context, parsed } = await read(userId, connectionId);
      const dives = parsed.flatMap((p) => (p.dive ? [p.dive] : []));
      const run = await runOf(db, userId, adapter, {
        diverId: row.diverId, connectionId: row.id, mode: row.importMode, windowMinutes: row.importWindowMinutes, choices: {}, context,
      });
      // Dives whose remote dive isn't in this fresh, complete listing (ADR 0051): stored as findings, nothing else changes.
      const goneDives = await recordFindings(db, row, parsed);
      const computers = await computersOf(db, run, dives, row.importComputers);
      run.choices = Object.fromEntries(computers.map((c) => [c.key, c.choice]));
      const counts = { total: parsed.length, unreadable: parsed.length - dives.length, ours: 0, linked: 0, deleted: 0, recordings: 0, link: 0, decide: 0, create: 0, noMatch: 0, changed: 0 };
      const conflicts: ConflictView[] = [];
      const decisions: { remoteId: string; remoteNumber: number | null; localStart: string; durationSeconds: number; maxDepthM: number | null; candidates: CandidateView[] }[] = [];
      for (const d of dives.sort((a, b) => a.localStart.localeCompare(b.localStart))) {
        const a = await assess(db, run, d);
        if (a.kind === 'ours') counts.ours += 1;
        else if (a.kind === 'linked') counts.linked += 1;
        else if (a.kind === 'deleted') counts.deleted += 1;
        else if (a.kind === 'recording') counts.recordings += 1;
        else if (a.kind === 'link') counts.link += 1;
        else if (a.kind === 'create') counts.create += 1;
        else if (a.kind === 'no_match') counts.noMatch += 1;
        else if (a.kind === 'decide') {
          counts.decide += 1;
          decisions.push({
            remoteId: d.remoteId, remoteNumber: d.remoteNumber, localStart: d.localStart, durationSeconds: d.durationSeconds,
            maxDepthM: d.maxDepthM, candidates: a.candidates,
          });
        }
        // Changed at the Provider since Dive Hub last saw it (ADR 0030, amended).
        const diveId = await diveOfLinked(run, a, d);
        const found = diveId ? await changesOf(db, run, diveId, d) : null;
        if (!found) continue;
        // A field of the Dive's open entry is shown as a Conflict, never as a change to take.
        const { take, conflicts: clashes } = await held(db, run, diveId!, d, found);
        if (take.length > 0) counts.changed += 1;
        for (const field of clashes) {
          conflicts.push({
            remoteId: d.remoteId, remoteNumber: d.remoteNumber, diveId: diveId!, number: found.here.row.number, field,
            startsAt: found.here.row.startsAt, utcOffsetSeconds: found.here.row.utcOffsetSeconds, utcOffsetSource: found.here.row.utcOffsetSource,
            hub: await shown(run, field, found.here.hub, found.here.row.siteId), provider: await shown(run, field, found.provider, null),
          });
        }
      }
      // The sites the dives name (not those Dive Hub sent): here already, the same as one here, or new.
      const sites = { known: 0, match: 0, create: 0, missing: 0 };
      const seen = new Set<string>();
      for (const d of dives) {
        if (d.evidence === 'ours') continue;
        for (const site of await sitesOf(db, run, d)) {
          const key = `${site.source}:${site.externalId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const outlook = site.name ? await siteOutlook(db, site) : { kind: 'taken' as const };
          if (outlook.kind === 'known') sites.known += 1;
          else if (outlook.kind === 'match') sites.match += 1;
          else if (outlook.kind === 'new' && run.sitesAllowed) sites.create += 1;
          else sites.missing += 1;
        }
      }
      return { mode: row.importMode, windowMinutes: row.importWindowMinutes, computers, counts, sites, sitesAllowed: run.sitesAllowed, decisions, conflicts, goneDives };
    },

    /**
     * Starts the import (ADR 0030): reads the dives again (or the Provider's kept read), keeps the choice per computer on
     * the Connection, stores one Original per dive (its record as JSON, never the whole answer), and creates the Import
     * the worker runs, with the context and the decisions. `unattended` (a scheduled fetch, ADR 0056): a fresh read that
     * also finds gone dives, as a preview's (ADR 0051); only the computers the User chose for keep a choice, so the
     * others' dives wait (`no_computer_choice`), and Conflicts wait in "Needs your decision".
     */
    async start(userId: string, connectionId: string, given: {
      computers: Record<string, ComputerChoice>; decisions: Record<string, string>; conflicts?: Record<string, 'hub' | 'provider'>;
      unattended?: boolean;
    }) {
      const { row, adapter, context, parsed } = await read(userId, connectionId, { recent: !given.unattended });
      if (given.unattended) await recordFindings(db, row, parsed);
      const dives = parsed.flatMap((p) => (p.dive ? [p.dive] : []));
      const run = await runOf(db, userId, adapter, {
        diverId: row.diverId, connectionId: row.id, mode: row.importMode, windowMinutes: row.importWindowMinutes, choices: {}, context,
      });
      const saved = { ...row.importComputers, ...given.computers };
      const computers = (await computersOf(db, run, dives, saved)).filter((c) => !given.unattended || saved[c.key] !== undefined);
      const choices = Object.fromEntries(computers.map((c) => [c.key, c.choice]));
      const stored = await Promise.all(parsed.map(async ({ remoteId, record }) => ({
        remoteId, blob: await blobs.putOriginal(Buffer.from(JSON.stringify(record), 'utf8')),
      })));
      const plan: ProviderImportPlan = {
        context: pick(context), computers: choices, decisions: given.decisions, conflicts: given.conflicts ?? {}, mode: row.importMode,
        windowMinutes: row.importWindowMinutes, diverId: row.diverId, ...(given.unattended && { unattended: true }),
      };
      return db.transaction(async (tx) => {
        await tx.update(connection).set({ importComputers: saved, updatedAt: new Date() }).where(eq(connection.id, row.id));
        const [created] = await tx.insert(importJob).values({
          userId, uploadName: adapter.capabilities.name, provider: adapter.id, connectionId: row.id, plan,
        }).returning();
        for (const { remoteId, blob } of stored) {
          const [existing] = await tx.select({ id: original.id }).from(original).where(and(eq(original.userId, userId), eq(original.sha256, blob.sha256)));
          const originalId = existing?.id ?? (await tx.insert(original).values({
            userId, sha256: blob.sha256, mediaType: 'application/json', sizeBytes: blob.sizeBytes,
            fileName: `${adapter.id}-dive-${remoteId}.json`, storageKey: blob.key,
          }).returning({ id: original.id }))[0]!.id;
          await tx.insert(importOriginal).values({ importId: created!.id, originalId }).onConflictDoNothing();
        }
        // One import of a Connection at a time: a second one waits in the same queue, so a dive is never made twice.
        await tx.execute(sql`select graphile_worker.add_job(${PROCESS_IMPORT_TASK}, json_build_object('importId', ${created!.id}::text),
          queue_name => ${`dive-import:${row.id}`})`);
        return created!;
      });
    },

    /**
     * The worker's part (ADR 0010): each Original of the Import, read and parsed again, processed in its own transaction
     * in the order the dives were made. Returns the outcome.
     */
    async process(job: typeof importJob.$inferSelect): Promise<ImportOutcome> {
      const plan = job.plan!;
      const { adapter, parse } = importer(job.provider!);
      const run = await runOf(db, job.userId, adapter, {
        diverId: plan.diverId, connectionId: job.connectionId, mode: plan.mode, windowMinutes: plan.windowMinutes, choices: plan.computers,
        context: plan.context,
      });
      await db.transaction((tx) => settle(tx, run));
      const rows = await db.select({ id: original.id, storageKey: original.storageKey, fileName: original.fileName })
        .from(importOriginal).innerJoin(original, eq(original.id, importOriginal.originalId))
        .where(eq(importOriginal.importId, job.id));
      const items = [];
      for (const o of rows) {
        const fileName = o.fileName ?? o.id;
        try {
          const dive_ = parse(JSON.parse((await blobs.read(o.storageKey)).toString('utf8')) as Record<string, unknown>, plan.context);
          const [earlier] = await db.select({ id: importOriginal.importId }).from(importOriginal)
            .innerJoin(importJob, eq(importJob.id, importOriginal.importId))
            .where(and(eq(importOriginal.originalId, o.id), sql`${importOriginal.importId} <> ${job.id}`, eq(importJob.status, 'done'))).limit(1);
          items.push({ o, fileName, dive: dive_, seen: !!earlier });
        } catch (error) {
          items.push({ o, fileName, dive: null, seen: false, error: error as Error });
        }
      }
      items.sort((a, b) => (a.dive?.localStart ?? '').localeCompare(b.dive?.localStart ?? ''));
      const outcome: ImportOutcome = [];
      for (const item of items) {
        if (!item.dive) {
          outcome.push(item.error
            ? { fileName: item.fileName, result: 'failed', reason: 'file_failed', message: item.error.message }
            : { fileName: item.fileName, result: 'skipped', reason: 'not_a_dive' });
          continue;
        }
        const d = item.dive;
        try {
          outcome.push(await db.transaction((tx) => processDive(tx, run, plan, d, {
            importId: job.id, originalId: item.o.id, fileName: item.fileName, seen: item.seen,
          })));
        } catch (error) {
          outcome.push({ fileName: item.fileName, result: 'failed', reason: 'file_failed', message: (error as Error).message, remoteId: d.remoteId });
        }
      }
      return outcome;
    },
  };
}

/** The context as kept on the Import: accounts and sites only, whatever else an adapter might add left behind. */
const pick = (c: ImportContext): ImportContext => ({
  people: Object.fromEntries(Object.entries(c.people).map(([k, v]) => [k, String(v)])),
  // Diver IDs, no names of people.
  remembered: Object.fromEntries(Object.entries(c.remembered ?? {}).map(([k, v]) => [k, String(v)])),
  sites: Object.fromEntries(Object.entries(c.sites).map(([k, s]) => [k, { name: s.name, latitude: s.latitude, longitude: s.longitude, country: s.country, waterType: s.waterType ?? null, ...(s.private && { private: s.private }) }])),
});

export type DiveImportService = ReturnType<typeof createDiveImportService>;
