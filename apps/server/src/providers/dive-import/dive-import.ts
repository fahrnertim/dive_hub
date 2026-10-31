// Importing a Provider's dives (ADR 0030), generic: what an adapter's `dives.list` and `dives.parse` give is decided
// here. Trust per dive by its evidence (sent by Dive Hub, from a dive computer, typed by hand) and per computer by the
// User; logbook entries match Dives here by local time and fill what they lack; computer dives become Recordings placed
// like a file's. A preview first (nothing stored), then an Import over one JSON Original per dive that the worker runs.
// A Provider whose dives come as files (`dives.file`, ADR 0062): each new dive's file is downloaded by the Import's
// worker, kept as its Original and placed like an upload, never replacing a Recording here; it is linked to the dive.
import { isDeepStrictEqual } from 'node:util';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db, Queryable, Tx } from '../../db/client.js';
import {
  connection, dive, diveSite, device, importJob, importOriginal, original, providerSiteData, push, user,
  recording, type ComputerChoice, type DiveImportMode, type ImportOutcome, type ProviderImportPlan, type UtcOffsetSource,
} from '../../db/schema.js';
import { writeRevision, type Actor } from '../../dives/revisions.js';
import type { PlacedTime } from '../../dives/time-zone.js';
import { errorMessage } from '../../errors.js';
import { createFileFormats, formatOf, type FileFormat } from '../../imports/formats.js';
import type { ParsedRecording } from '../../imports/parsed-recording.js';
import { PROCESS_IMPORT_TASK } from '../../imports/import-service.js';
import { deviceDiver, placeRecording } from '../../imports/placement.js';
import { DAY_MS, MAX_OFFSET_MS, entryMatches } from '../../imports/matching.js';
import { recordFindings } from './gone-dives.js';
import { probablyNoDive } from '../../dives/checks/logbook-check-rules.js';
import { siteRef } from '../../dives/dive-summary-view.js';
import { siteOutlook } from '../../sites/provider-sites.js';
import type { BlobStore } from '../../storage/blob-store.js';
import type { ConnectionService } from '../connection-service.js';
import { loadOutgoingDive } from '../push/outgoing-dive.js';
import { REFERENCE_PREFIX, ProviderError, localStartOf, recordedMode, type Capabilities, type DiveField, type ImportContext, type ImportedDive, type ProviderCylinder } from '../provider.js';
import { createDiveChanges, importsField, type ProviderContext } from './dive-changes.js';
import { currentRemote, fingerprintNow } from '../remote-state.js';
import { sameAtProvider, type SyncedField } from './three-way.js';
import { closeFields, entryOf, openFields, record as recordConflict, type StoredConflictField } from '../conflicts/conflict-service.js';
import { realClock, type Clock } from '../lease-service.js';
import { queueNow } from '../waiting-push/waiting-push-queue.js';
import { withRemembered } from '../list-entries.js';
import { named, ProviderServiceError, type ProviderRegistry } from '../registry.js';
import { renumber } from '../../dives/dive-numbers.js';

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
  | { kind: 'unchosen' }
  /** Entered by hand at a Provider whose dives come as files: no file is behind it. */
  | { kind: 'by_hand' };

/** An Import's Original read again by the worker: its dive to process, or the outcome it ends with already. */
type ReadOriginal =
  | { fileName: string; ended: ImportOutcome[number] }
  | { fileName: string; originalId: string; dive: ImportedDive; seen: boolean };

/** What changed at the Provider since Dive Hub last saw a linked dive, compared with the Dive here. */
type FoundChanges = NonNullable<Awaited<ReturnType<ReturnType<typeof createDiveChanges>['providerChangesOf']>>>;

/** The preview's count each assessment adds to; `unchosen` only comes unattended, and isn't counted. */
const COUNTED = {
  ours: 'ours', linked: 'linked', deleted: 'deleted', recording: 'recordings', link: 'link', decide: 'decide', create: 'create',
  no_match: 'noMatch', unchosen: null, by_hand: 'enteredByHand',
} as const satisfies Record<Assessment['kind'], string | null>;

/** The preview's site count a site's outlook adds to: a new one is created only where an admin allowed the site data. */
const siteCounted = (kind: string, allowed: boolean) =>
  kind === 'known' || kind === 'match' ? kind : kind === 'new' && allowed ? 'create' : 'missing';

const keyOf = (d: { manufacturer: string; serialNumber: string }) => `${d.manufacturer}:${d.serialNumber}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createDiveImportService(deps: {
  db: Db; blobs: BlobStore; registry: ProviderRegistry; connections: ConnectionService; clock?: Clock;
  /** The file formats a Provider's dive files are read with (ADR 0037); all of them unless a test narrows it. */
  formats?: FileFormat[];
}) {
  const { db, blobs, registry, connections } = deps;
  const formats = deps.formats ?? createFileFormats();
  const clock = deps.clock ?? realClock;
  const { contextOf, providerSitesOf, settleSiteVisibility, placeTime, providerChangesOf, takeChanges, fillFromProvider, shown, conflictFields } = createDiveChanges({ db, blobs });

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

  /** `read`, with the readable dives and their context, no computer chosen yet: what preview and start begin with. */
  async function readWithContext(userId: string, connectionId: string, options: { recent?: boolean } = {}) {
    const { row, adapter, context, parsed } = await read(userId, connectionId, options);
    const dives = parsed.flatMap((p) => (p.dive ? [p.dive] : []));
    const pc = await contextOf(db, userId, adapter, {
      diverId: row.diverId, connectionId: row.id, mode: row.importMode, windowMinutes: row.importWindowMinutes, choices: {}, context,
    });
    return { row, adapter, context, parsed, dives, pc };
  }

  /** The computers among the dives, with the User's choice kept on the Connection, else the suggestion. */
  async function computersOf(q: Queryable, pc: ProviderContext, dives: ImportedDive[], saved: Record<string, ComputerChoice>) {
    const found = new Map<string, ComputerView>();
    for (const d of dives) {
      // A dive Dive Hub sent, or one linked to a Dive that has this computer's Recording, carries what Dive Hub has or
      // sent: not a computer found there.
      if (d.evidence !== 'computer' || !d.device || (await sentTo(q, pc, d.remoteId))) continue;
      const linked = await linkedTo(q, pc, d.remoteId);
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
        choice: saved[key] ?? suggested, suggested, fromFiles: !!fromFile, otherDiver: owner !== null && !pc.managed.has(owner),
      });
    }
    return [...found.values()].sort((a, b) => b.dives - a.dives || a.key.localeCompare(b.key));
  }

  /** Whether the Dive has a live Recording from this computer (a file's or a Provider's copy). */
  async function hasRecordingOf(q: Queryable, diveId: string, d: { manufacturer: string; serialNumber: string }) {
    const [row] = await q.select({ id: recording.id }).from(recording).innerJoin(device, eq(device.id, recording.deviceId))
      .where(and(eq(recording.diveId, diveId), isNull(recording.deletedAt), eq(device.manufacturer, d.manufacturer), eq(device.serialNumber, d.serialNumber)))
      .limit(1);
    return !!row;
  }

  /** The Dive this remote dive is linked to now (by a Push), among the User's, or null. */
  async function linkedTo(q: Queryable, pc: ProviderContext, remoteId: string) {
    const rows = await q.selectDistinct({ diveId: push.diveId }).from(push)
      .where(and(eq(push.provider, pc.adapter.id), eq(push.remoteId, remoteId)));
    for (const { diveId } of rows) {
      const pushes = await q.select().from(push).where(and(eq(push.diveId, diveId), eq(push.provider, pc.adapter.id)))
        .orderBy(desc(push.createdAt), desc(push.id));
      if (currentRemote(pushes)?.remoteId !== remoteId) continue;
      const [d] = await q.select({ diverId: dive.diverId, deletedAt: dive.deletedAt }).from(dive).where(eq(dive.id, diveId));
      if (d && pc.managed.has(d.diverId)) return { diveId, deleted: d.deletedAt !== null };
    }
    return null;
  }

  /**
   * The Dive whose values Dive Hub sent to this remote dive (a confirmed create or update Push), among the User's: the
   * remote dive is Dive Hub's own then, like one carrying our reference (ADR 0030).
   */
  async function sentTo(q: Queryable, pc: ProviderContext, remoteId: string): Promise<string | null> {
    const rows = await q.select({ diveId: push.diveId, diverId: dive.diverId }).from(push).innerJoin(dive, eq(dive.id, push.diveId))
      .where(and(eq(push.provider, pc.adapter.id), eq(push.remoteId, remoteId), eq(push.state, 'confirmed'), inArray(push.action, ['create', 'update'])));
    return rows.find((r) => pc.managed.has(r.diverId))?.diveId ?? null;
  }

  /** Whether the Dive is live and one of the User's (a Dive our reference names may be gone, or another User's). */
  async function ownsLive(q: Queryable, pc: ProviderContext, diveId: string) {
    const [own] = await q.select({ diverId: dive.diverId }).from(dive).where(and(eq(dive.id, diveId), isNull(dive.deletedAt)));
    return !!own && pc.managed.has(own.diverId);
  }

  /** The live Recording made from this remote dive before, if any. */
  async function recordingOf(q: Queryable, pc: ProviderContext, remoteId: string) {
    const [row] = await q.select({ id: recording.id, diveId: recording.diveId }).from(recording)
      .where(and(eq(recording.recordingKey, `${pc.adapter.id}:${remoteId}`), isNull(recording.deletedAt)));
    return row ?? null;
  }

  /** Of these Dives, those that have a remote dive at the Provider now (they are another remote dive's already). */
  async function withRemote(q: Queryable, pc: ProviderContext, diveIds: string[]) {
    if (diveIds.length === 0) return new Set<string>();
    const rows = await q.select().from(push).where(and(eq(push.provider, pc.adapter.id), inArray(push.diveId, diveIds)))
      .orderBy(desc(push.createdAt), desc(push.id));
    return new Set(diveIds.filter((id) => currentRemote(rows.filter((p) => p.diveId === id))));
  }

  /**
   * What the import does with one dive (the preview says it, the worker does it). `unattended`: a computer's dive whose
   * computer has no choice in `run.choices` waits for the User (Recordings or entries could go wrong, hard to undo).
   */
  async function assess(q: Queryable, pc: ProviderContext, d: ImportedDive, unattended = false): Promise<Assessment> {
    // Dives that come as files (ADR 0062) are matched by placing the file, like an upload: no computer to choose for.
    if (pc.adapter.dives?.file) {
      if (d.evidence === 'logbook') return { kind: 'by_hand' };
      const linked = await linkedTo(q, pc, d.remoteId);
      if (linked?.deleted) return { kind: 'deleted' };
      return linked ? { kind: 'linked', diveId: linked.diveId } : { kind: 'recording' };
    }
    if (d.evidence === 'ours') {
      // The Dive it is linked to now, when that isn't the one our reference names: the Dive it was sent from was merged
      // into another, which took the link (ADR 0038). Changes made at the Provider then come back to that Dive.
      const now = await linkedTo(q, pc, d.remoteId);
      if (now && !now.deleted) return { kind: 'ours', diveId: now.diveId };
      const id = d.reference?.slice(REFERENCE_PREFIX.length) ?? '';
      return { kind: 'ours', diveId: uuid.test(id) ? id : null };
    }
    const sent = await sentTo(q, pc, d.remoteId);
    if (sent) return { kind: 'ours', diveId: sent };
    // A Recording made from it before is placed again: changed at the Provider, it is updated in place.
    if (await recordingOf(q, pc, d.remoteId)) return { kind: 'recording' };
    const linked = await linkedTo(q, pc, d.remoteId);
    if (linked?.deleted) return { kind: 'deleted' };
    if (d.evidence === 'computer' && d.device && pc.choices[keyOf(d.device)] !== 'entries') {
      const owner = await deviceDiver(q, d.device);
      // Linked already (made from it as a logbook entry, before its computer was recognised): its profile still comes in,
      // unless the Dive has that computer's Recording (its own file) already.
      const usable = owner === null || pc.managed.has(owner);
      if (usable && (!linked || !(await hasRecordingOf(q, linked.diveId, d.device)))) {
        return unattended && !(keyOf(d.device) in pc.choices) ? { kind: 'unchosen' } : { kind: 'recording' };
      }
    }
    if (linked) return { kind: 'linked', diveId: linked.diveId };
    const local = localStartOf(d);
    const rows = await q.select({
      id: dive.id, number: dive.number, startsAt: dive.startsAt, utcOffsetSeconds: dive.utcOffsetSeconds,
      utcOffsetSource: dive.utcOffsetSource, durationSeconds: dive.durationSeconds, maxDepthM: dive.maxDepthM,
      deletedAt: dive.deletedAt, siteId: dive.siteId, siteName: diveSite.name,
    }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
      .where(and(
        eq(dive.diverId, pc.diverId),
        gte(dive.startsAt, new Date(local - DAY_MS - MAX_OFFSET_MS)), lte(dive.startsAt, new Date(local + DAY_MS + MAX_OFFSET_MS)),
      ));
    const matches = entryMatches(local, rows, pc.windowMinutes);
    const taken = await withRemote(q, pc, matches.map((m) => m.id));
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
          durationSeconds: m.durationSeconds, maxDepthM: m.maxDepthM, site: siteRef(m.siteId, m.siteName),
          probablyNoDive: noDive.has(m.id),
        })),
      };
    }
    // A Dive deleted here stays deleted (ADR 0026): its entry doesn't come back as a new Dive.
    if (matches.some((m) => m.deletedAt && !taken.has(m.id))) return { kind: 'deleted' };
    return pc.mode === 'create' ? { kind: 'create' } : { kind: 'no_match' };
  }

  /**
   * Links the Dive to the Provider's dive (a `link` Push), unless it has a remote dive there already: sending then updates
   * that dive instead of making another. `upToDate`: the Dive was made from it, so it shows up to date. `deleted`: the
   * Dive may be one deleted here (a file's dive on it, so the next fetch finds it deleted).
   */
  async function link(
    tx: Tx, pc: ProviderContext, diveId: string, d: Pick<ImportedDive, 'remoteId' | 'remoteNumber'>, upToDate: boolean, options: { deleted?: boolean } = {},
  ) {
    if ((await withRemote(tx, pc, [diveId])).size > 0) return;
    const loaded = await loadOutgoingDive(tx, pc.userId, diveId, options);
    await tx.insert(push).values({
      diveId, connectionId: pc.connectionId, userId: pc.userId, provider: pc.adapter.id, mode: recordedMode(pc.adapter),
      action: 'link', state: 'confirmed', remoteId: d.remoteId, remoteNumber: d.remoteNumber, diveVersion: loaded.row.version,
      fingerprint: upToDate ? fingerprintNow(pc.adapter, loaded) : null,
    });
  }

  /** A Dive without a Recording from a logbook entry (ADR 0030): its values, marked as the Provider's. */
  async function createDive(tx: Tx, pc: ProviderContext, d: ImportedDive, actor: Actor): Promise<string> {
    const time = await placeTime(tx, pc, d);
    const [created] = await tx.insert(dive).values({
      diverId: pc.diverId, startsAt: time.startsAt, utcOffsetSeconds: time.utcOffsetSeconds, utcOffsetSource: time.utcOffsetSource,
      durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, avgDepthM: d.avgDepthM, waterTemperatureC: d.waterTemperatureC,
      fromProvider: pc.adapter.id,
    }).returning({ id: dive.id });
    await writeRevision(tx, 'dive', created!.id, actor, 'import-create', { fromProvider: { from: null, to: pc.adapter.id } });
    await fillFromProvider(tx, pc, created!.id, d, actor);
    await link(tx, pc, created!.id, d, true);
    await renumber(tx, [pc.diverId]);
    return created!.id;
  }

  /** The dive mode, surface interval and average heart rate a Provider names, where it names them and lets them in. */
  function summaryValuesOf(pc: ProviderContext, d: ImportedDive) {
    return {
      ...(d.diveMode !== null && importsField(pc, 'diveType') && { diveMode: d.diveMode }),
      ...(d.surfaceIntervalSeconds !== null && importsField(pc, 'surfaceInterval') && { surfaceIntervalSeconds: d.surfaceIntervalSeconds }),
      ...(d.avgHeartRate !== null && importsField(pc, 'heartRate') && { avgHeartRate: d.avgHeartRate }),
    };
  }

  /** A value the Provider names, where its `dives.fields` let that field in; else null. */
  const ifImported = <T>(pc: ProviderContext, field: DiveField, value: T | null): T | null => (importsField(pc, field) ? value : null);

  const CHANNEL_FIELD = { depth: 'profile', temperature: 'profile', ndl: 'profile', tankPressure: 'tankPressure', heartRate: 'heartRate', cns: 'cns' } as const;

  /** A computer's dive as a Recording, the way a FIT file's would be (ADR 0030); only the values the Provider's `dives.fields` let in. */
  function asRecording(pc: ProviderContext, d: ImportedDive, time: PlacedTime): ParsedRecording {
    const series = (['depth', 'temperature', 'ndl', 'tankPressure', 'heartRate', 'cns'] as const).flatMap((channel) => {
      const s = importsField(pc, CHANNEL_FIELD[channel]) ? d.samples[channel] : undefined;
      return s ? [{ channel, offsetsMs: s.offsetsMs.map(Math.round), values: s.values }] : [];
    });
    const temperatures = series.find((s) => s.channel === 'temperature')?.values ?? [];
    const cns = importsField(pc, 'cns');
    // The Provider's own values only where they come in; else what the profile (when it comes in) says.
    const minTemperatureC = ifImported(pc, 'waterTemperatureC', d.waterTemperatureC) ?? (temperatures.length ? Math.min(...temperatures) : null);
    const maxTemperatureC = ifImported(pc, 'maxTemperatureC', d.maxTemperatureC) ?? (temperatures.length ? Math.max(...temperatures) : null);
    const summary = {
      ...(d.gases.length > 0 && importsField(pc, 'gas') && { gases: d.gases }),
      ...(d.gfLow !== null && { gfLow: d.gfLow }), ...(d.gfHigh !== null && { gfHigh: d.gfHigh }),
      ...(minTemperatureC !== null && { minTemperatureC }),
      ...(maxTemperatureC !== null && { maxTemperatureC }),
      ...(cns && d.cnsStart !== null && { cnsStart: d.cnsStart }), ...(cns && d.cnsEnd !== null && { cnsEnd: d.cnsEnd }),
      ...summaryValuesOf(pc, d),
    };
    const depths = series.find((s) => s.channel === 'depth')?.values ?? [];
    const device = importsField(pc, 'device') ? d.device : null;
    return {
      device: device ? {
        manufacturer: device.manufacturer, serialNumber: device.serialNumber,
        ...(device.product && { product: device.product }), ...(device.firmware && { firmware: device.firmware }),
      } : undefined,
      recordingKey: `${pc.adapter.id}:${d.remoteId}`,
      startsAt: time.startsAt, utcOffsetSeconds: time.utcOffsetSeconds ?? undefined, utcOffsetSource: time.utcOffsetSource,
      durationSeconds: d.durationSeconds,
      maxDepthM: ifImported(pc, 'maxDepthM', d.maxDepthM) ?? (depths.length ? Math.max(...depths) : undefined), avgDepthM: d.avgDepthM ?? undefined,
      entryPosition: d.entry ?? undefined, exitPosition: d.exit ?? undefined,
      summary, series, events: [],
    };
  }

  /**
   * The changes with the fields of the Dive's open entry at the Provider held (ADR 0056, "while it is open the base
   * stays"): never taken, nor "changed only here" because a newer Original moved the base; a Conflict while the two
   * sides differ. `open`: the entry's fields the comparison covers; `equal`: those whose two sides are now the same.
   */
  async function held(q: Queryable, pc: ProviderContext, diveId: string, d: ImportedDive, found: FoundChanges) {
    const open = (await openFields(q, diveId, pc.adapter.id, d.remoteId)).filter((f) => found.here.fields.includes(f));
    // As a send: a Provider without a site never clears one here.
    const clash = open.filter((f) => !(f === 'site' && found.provider.site === null) && !sameAtProvider(f, found.provider, found.here.hub));
    return {
      take: found.take.filter((f) => !open.includes(f)), conflicts: [...found.conflicts.filter((f) => !open.includes(f)), ...clash], open,
      equal: open.filter((f) => sameAtProvider(f, found.provider, found.here.hub)),
    };
  }

  /**
   * Fields of an open entry the User kept Dive Hub's value for: the Dive is queued as a send with that choice, through
   * the Dive's Connection (the one its current remote dive was made through). Whether it was queued: without such a
   * Connection nothing can send the choice, and the fields stay open.
   */
  async function queueKept(tx: Tx, pc: ProviderContext, diveId: string, remoteId: string, fields: SyncedField[]): Promise<boolean> {
    if (fields.length === 0) return false;
    const pushes = await tx.select().from(push).where(and(eq(push.diveId, diveId), eq(push.provider, pc.adapter.id)))
      .orderBy(desc(push.createdAt), desc(push.id));
    const current = currentRemote(pushes);
    if (current?.remoteId !== remoteId || !current.connectionId) return false;
    // Only a Connection still the Dive's Diver's decides, as in `noteSent` (ADR 0056): another one queues nothing.
    const [own] = await tx.select({ id: connection.id }).from(connection).innerJoin(dive, eq(dive.diverId, connection.diverId))
      .where(and(eq(connection.id, current.connectionId), eq(dive.id, diveId)));
    if (!own) return false;
    await queueNow(tx, diveId, pc.adapter.id, current.connectionId, { conflicts: Object.fromEntries(fields.map((f) => [f, 'hub' as const])) }, new Date(clock.now()));
    return true;
  }

  /**
   * Conflicts an unattended import found and nobody chose for: Dive Hub's values stay and the Dive's entry waits in
   * "Needs your decision", the fields merged into an open one (one entry per Dive and Provider, no run). An entry that
   * would be the same is left as it is, so it isn't raised twice.
   */
  async function waitForUser(tx: Tx, pc: ProviderContext, diveId: string, d: ImportedDive, found: FoundChanges, fields: SyncedField[]) {
    if (fields.length === 0 || !pc.connectionId) return;
    const now = await conflictFields(pc, fields, found.here, found.provider);
    const before = await entryOf(tx, diveId, pc.adapter.id);
    const kept = before?.remoteId === d.remoteId ? before.fields.filter((f) => !fields.includes(f.field)) : [];
    const merged = [...kept, ...now];
    const byField = (list: StoredConflictField[]) => list.toSorted((a, b) => a.field.localeCompare(b.field));
    if (before?.remoteId === d.remoteId && isDeepStrictEqual(byField(before.fields), byField(merged))) return;
    await recordConflict(tx, { diveId, provider: pc.adapter.id, connectionId: pc.connectionId, remoteId: d.remoteId, fields: merged, runId: null, foundAt: new Date(clock.now()) });
  }

  /**
   * The Provider's changes since Dive Hub last saw the dive, taken where the Dive here kept its value, and where the User
   * chose the Provider's in a conflict; then what is still empty is filled. Whether anything changed.
   */
  async function sync(tx: Tx, pc: ProviderContext, plan: ProviderImportPlan, diveId: string, d: ImportedDive, importId: string, actor: Actor) {
    const found = await providerChangesOf(tx, pc, diveId, d, importId);
    let fields: SyncedField[] = [];
    if (found) {
      const { take, conflicts, open, equal } = await held(tx, pc, diveId, d, found);
      const choice = (f: SyncedField) => plan.conflicts?.[`${d.remoteId}:${f}`];
      fields = [...take, ...conflicts.filter((f) => choice(f) === 'provider')];
      // The User's choice for a field of the open entry settles it there: asked once, not twice. Keeping Dive Hub's
      // value queues the Dive, due now, as every choice in "Needs your decision" does (ADR 0056); it settles the field
      // only when the Dive was queued. A field whose two sides became equal needs no choice.
      const kept = open.filter((f) => choice(f) === 'hub');
      const queued = await queueKept(tx, pc, diveId, d.remoteId, kept);
      await closeFields(tx, diveId, pc.adapter.id,
        open.filter((f) => choice(f) === 'provider' || (queued && kept.includes(f)) || (choice(f) === undefined && equal.includes(f))));
      if (plan.unattended) await waitForUser(tx, pc, diveId, d, found, conflicts.filter((f) => choice(f) === undefined));
    }
    const taken = fields.length > 0 && (await takeChanges(tx, pc, diveId, d, fields, actor)).length > 0;
    const filled = await fillFromProvider(tx, pc, diveId, d, actor);
    return taken || filled;
  }

  /** The Dive a Provider's dive is linked to already (sent from here, linked, or a Recording of it), for comparing. */
  async function diveOfLinked(pc: ProviderContext, a: Assessment, d: ImportedDive): Promise<string | null> {
    if (a.kind === 'linked') return a.diveId;
    if (a.kind === 'ours' && a.diveId) return (await ownsLive(db, pc, a.diveId)) ? a.diveId : null;
    if (a.kind === 'recording') return (await recordingOf(db, pc, d.remoteId))?.diveId ?? null;
    return null;
  }

  /**
   * A preview's counts of how the dives go (`dives` oldest first) and the logbook entries the User decides. Changed:
   * linked dives changed at the Provider since Dive Hub last saw them (ADR 0030, amended); a field of the Dive's open
   * entry is shown as a Conflict, never as a change to take.
   */
  async function previewDives(pc: ProviderContext, parsed: number, dives: ImportedDive[]) {
    const counts = {
      total: parsed, unreadable: parsed - dives.length, ours: 0, linked: 0, deleted: 0, recordings: 0, link: 0, decide: 0, create: 0, noMatch: 0,
      enteredByHand: 0, changed: 0,
    };
    const conflicts: ConflictView[] = [];
    const decisions: { remoteId: string; remoteNumber: number | null; localStart: string; durationSeconds: number; maxDepthM: number | null; candidates: CandidateView[] }[] = [];
    for (const d of dives) {
      const a = await assess(db, pc, d);
      const counted = COUNTED[a.kind];
      if (counted) counts[counted] += 1;
      if (a.kind === 'decide') {
        decisions.push({
          remoteId: d.remoteId, remoteNumber: d.remoteNumber, localStart: d.localStart, durationSeconds: d.durationSeconds,
          maxDepthM: d.maxDepthM, candidates: a.candidates,
        });
      }
      const diveId = await diveOfLinked(pc, a, d);
      const found = diveId ? await providerChangesOf(db, pc, diveId, d) : null;
      if (!diveId || !found) continue;
      const { take, conflicts: clashes } = await held(db, pc, diveId, d, found);
      if (take.length > 0) counts.changed += 1;
      for (const field of clashes) {
        conflicts.push({
          remoteId: d.remoteId, remoteNumber: d.remoteNumber, diveId, number: found.here.row.number, field,
          startsAt: found.here.row.startsAt, utcOffsetSeconds: found.here.row.utcOffsetSeconds, utcOffsetSource: found.here.row.utcOffsetSource,
          hub: await shown(pc, field, found.here.hub, found.here.row.siteId), provider: await shown(pc, field, found.provider, null),
        });
      }
    }
    return { counts, decisions, conflicts };
  }

  /** The sites the dives name (not those Dive Hub sent), each once: here already, the same as one here, or new. */
  async function previewSites(pc: ProviderContext, dives: ImportedDive[]) {
    const sites = { known: 0, match: 0, create: 0, missing: 0 };
    const seen = new Set<string>();
    for (const d of dives) {
      if (d.evidence === 'ours') continue;
      for (const site of await providerSitesOf(db, pc, d)) {
        const key = `${site.source}:${site.externalId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const { kind } = site.name ? await siteOutlook(db, site) : { kind: 'taken' as const };
        sites[siteCounted(kind, pc.sitesAllowed)] += 1;
      }
    }
    return sites;
  }

  const fileBase = (pc: ProviderContext, remoteId: string) => ({ fileName: `${pc.adapter.id}-dive-${remoteId}`, remoteId });

  /**
   * When an Import of dives that come as files starts (ADR 0062): the dives new here, whose files the worker downloads
   * (oldest first); the others end as they were found: linked already, deleted here, entered by hand. Nothing is
   * downloaded here, so starting answers at once.
   */
  async function sortFiles(pc: ProviderContext, parsed: { remoteId: string; dive: ImportedDive | null }[]) {
    const ended: ImportOutcome = [];
    const wanted: ImportedDive[] = [];
    for (const { remoteId, dive: d } of parsed) {
      const a = d ? await assess(db, pc, d) : null;
      if (!d || !a) ended.push({ ...fileBase(pc, remoteId), result: 'skipped', reason: 'not_a_dive' });
      else if (a.kind === 'recording') wanted.push(d);
      else if (a.kind === 'linked') ended.push({ ...fileBase(pc, remoteId), result: 'unchanged', diveId: a.diveId });
      else if (a.kind === 'deleted') ended.push({ ...fileBase(pc, remoteId), result: 'skipped', reason: 'deleted_earlier' });
      else if (a.kind === 'by_hand') ended.push({ ...fileBase(pc, remoteId), result: 'skipped', reason: 'entered_by_hand' });
    }
    wanted.sort((x, y) => x.localStart.localeCompare(y.localStart));
    return { files: wanted.map((d) => d.remoteId), ended };
  }

  /**
   * The worker's part for dives that come as files (ADR 0062): each new dive's file downloaded, one after another (the
   * adapter keeps the pause), and placed. A failed download ends that dive only, and the next fetch tries it again; a
   * refused sign-in ends the Import (the Connection needs one).
   */
  async function placeFiles(job: typeof importJob.$inferSelect, pc: ProviderContext, remoteIds: string[]) {
    const outcome: ImportOutcome = [];
    if (remoteIds.length === 0) return outcome;
    const file = pc.adapter.dives!.file!;
    const row = job.connectionId ? await connections.own(job.userId, job.connectionId).catch(() => null) : null;
    for (const remoteId of remoteIds) {
      const got = row
        ? await connections.withAccess(row, async (ctx) => {
          try {
            return await file(ctx, remoteId);
          } catch (error) {
            if (!(error instanceof ProviderError) || error.reason === 'signed_out' || error.reason === 'wrong_credentials') throw error;
            return error;
          }
        })
        : new ProviderError('unavailable', 'the Connection is gone');
      if (got instanceof ProviderError) {
        outcome.push(got.reason === 'bad_response'
          ? { ...fileBase(pc, remoteId), result: 'skipped', reason: 'no_dive_file', message: errorMessage(got) }
          : { ...fileBase(pc, remoteId), result: 'failed', reason: 'unavailable', message: errorMessage(got) });
        continue;
      }
      outcome.push(...(await placeFile(job, pc, remoteId, got)));
    }
    return outcome;
  }

  /**
   * One downloaded file: read through the file formats, kept as its Original (once per content, only when it holds a
   * dive) and its Recordings placed like an upload's, a Recording here already kept as it is. The Dive is then linked to
   * the Provider's dive, so the next fetch finds it linked and doesn't download it again; one on a Dive deleted here is
   * linked to that Dive, so the next fetch finds it deleted (ADR 0026).
   */
  async function placeFile(job: typeof importJob.$inferSelect, pc: ProviderContext, remoteId: string, f: { bytes: Uint8Array; mediaType: string; fileName: string }) {
    const actor: Actor = { type: 'import', id: job.id };
    const base = { fileName: f.fileName, remoteId };
    const ref = { remoteId, remoteNumber: null };
    try {
      const format = formatOf(formats, f.bytes);
      const parsed = format ? await format.parse(f.bytes) : [];
      if (!format || parsed.length === 0) return [{ ...base, result: 'skipped', reason: format ? 'not_a_dive' : 'no_dive_file' }] satisfies ImportOutcome;
      const parser = { name: format.parser, version: format.parserVersion };
      const blob = await blobs.putOriginal(f.bytes);
      return await db.transaction(async (tx) => {
        const [existing] = await tx.select({ id: original.id, fileName: original.fileName }).from(original)
          .where(and(eq(original.userId, job.userId), eq(original.sha256, blob.sha256)));
        const originalId = existing?.id ?? (await tx.insert(original).values({
          userId: job.userId, sha256: blob.sha256, mediaType: f.mediaType, sizeBytes: blob.sizeBytes, fileName: f.fileName, storageKey: blob.key,
        }).returning({ id: original.id }))[0]!.id;
        await tx.insert(importOriginal).values({ importId: job.id, originalId }).onConflictDoNothing();
        const fileName = existing?.fileName ?? f.fileName;
        const placed: ImportOutcome = [];
        for (const rec of parsed) {
          const one = await placeRecording(tx, { userId: job.userId, importId: job.id, originalId, fileName, actor, parser, diverId: pc.diverId, keepKnown: true }, rec);
          if (one.diveId) {
            await link(tx, pc, one.diveId, ref, one.result === 'created');
          } else if (one.reason === 'deleted_earlier' && one.recordingId) {
            const [gone] = await tx.select({ diveId: recording.diveId }).from(recording).where(eq(recording.id, one.recordingId));
            if (gone?.diveId) await link(tx, pc, gone.diveId, ref, false, { deleted: true });
          }
          placed.push({ ...one, fileName, remoteId });
        }
        return placed;
      });
    } catch (error) {
      return [{ ...base, result: 'failed', reason: 'file_failed', message: errorMessage(error) }] satisfies ImportOutcome;
    }
  }

  /** One dive of a running Import, in its own transaction. `seen`: its Original came with an earlier Import unchanged. */
  async function processDive(
    tx: Tx, pc: ProviderContext, plan: ProviderImportPlan, d: ImportedDive, at: { importId: string; originalId: string; fileName: string; seen: boolean },
  ): Promise<ImportOutcome[number]> {
    const actor: Actor = { type: 'import', id: at.importId };
    const base = { fileName: at.fileName, remoteId: d.remoteId, ...(d.remoteNumber !== null && { remoteNumber: d.remoteNumber }) };
    const a = await assess(tx, pc, d, plan.unattended);
    switch (a.kind) {
      case 'ours': {
        // Sent by Dive Hub: already ours. One whose answer got lost is linked to its Dive, as sending would.
        const diveId = a.diveId;
        if (!diveId || !(await ownsLive(tx, pc, diveId))) return { ...base, result: 'skipped', reason: 'sent_by_dive_hub' };
        await link(tx, pc, diveId, d, false);
        // Changed in the Provider's app since it was sent: the Dive takes it, as for any linked dive.
        if (await sync(tx, pc, plan, diveId, d, at.importId, actor)) return { ...base, result: 'updated', diveId };
        return { ...base, result: 'skipped', reason: 'sent_by_dive_hub', diveId };
      }
      case 'deleted':
        return { ...base, result: 'skipped', reason: 'deleted_earlier' };
      case 'linked': {
        // Filled where still empty, also when unchanged: what Dive Hub can fill may have grown (a site an admin allowed).
        return { ...base, result: (await sync(tx, pc, plan, a.diveId, d, at.importId, actor)) ? 'updated' : 'unchanged', diveId: a.diveId };
      }
      case 'recording': {
        const known = await recordingOf(tx, pc, d.remoteId);
        if (known && at.seen) return { ...base, result: 'unchanged', recordingId: known.id, ...(known.diveId && { diveId: known.diveId }) };
        const placed = await placeRecording(tx, {
          userId: pc.userId, importId: at.importId, originalId: at.originalId, fileName: at.fileName, actor,
          parser: pc.adapter.dives!.parser ?? { name: pc.adapter.id, version: '1' }, diverId: pc.diverId,
        }, asRecording(pc, d, await placeTime(tx, pc, d)));
        if (placed.diveId && placed.result !== 'skipped') {
          await sync(tx, pc, plan, placed.diveId, d, at.importId, actor);
          await link(tx, pc, placed.diveId, d, placed.result === 'created');
        }
        return { ...placed, ...base };
      }
      case 'link':
        await fillFromProvider(tx, pc, a.diveId, d, actor);
        await link(tx, pc, a.diveId, d, false);
        return { ...base, result: 'linked', diveId: a.diveId };
      case 'decide': {
        const choice = plan.decisions[d.remoteId];
        if (choice === 'leave_out') return { ...base, result: 'skipped', reason: 'left_out' };
        if (choice === 'new' && pc.mode === 'create') return { ...base, result: 'created', diveId: await createDive(tx, pc, d, actor) };
        if (choice && a.candidates.some((c) => c.diveId === choice)) {
          await fillFromProvider(tx, pc, choice, d, actor);
          await link(tx, pc, choice, d, false);
          return { ...base, result: 'linked', diveId: choice };
        }
        // No decision that still fits (it turned ambiguous after the preview, or the User wasn't asked yet): left out.
        return { ...base, result: 'skipped', reason: 'ambiguous' };
      }
      case 'create':
        return { ...base, result: 'created', diveId: await createDive(tx, pc, d, actor) };
      case 'no_match':
        return { ...base, result: 'skipped', reason: 'no_match' };
      case 'unchosen':
        return { ...base, result: 'skipped', reason: 'no_computer_choice' };
      case 'by_hand':
        return { ...base, result: 'skipped', reason: 'entered_by_hand' };
    }
  }

  return {
    /** Providers whose dives can be imported, and whether an admin allowed creating sites from their site data. */
    async siteData() {
      const rows = await db.select({ provider: providerSiteData.provider, allowedAt: providerSiteData.allowedAt, allowedBy: user.name })
        .from(providerSiteData).leftJoin(user, eq(user.id, providerSiteData.allowedBy));
      // Only a Provider whose dives carry a site (a Garmin dive comes from its file and declares no fields) has site data.
      const withSites = ({ capabilities }: { capabilities: Capabilities }) => {
        const fields = capabilities.data.dives?.fields;
        return !fields || !!fields.site?.includes('import');
      };
      return registry.list().filter((a) => a.capabilities.data.dives?.import?.operations.includes('list') && withSites(a)).map((a) => {
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
     * What the import would do now (ADR 0030): reads the account's dives (one paced action) and imports nothing. The
     * computers found with their choice, how many dives go which way, and the logbook entries the User decides. It does
     * store what the fresh listing shows gone (ADR 0051), as findings.
     */
    async preview(userId: string, connectionId: string) {
      const { row, parsed, dives, pc } = await readWithContext(userId, connectionId);
      // Dives whose remote dive isn't in this fresh, complete listing (ADR 0051): stored as findings, nothing else changes.
      const goneDives = await recordFindings(db, row, parsed);
      const computers = await computersOf(db, pc, dives, row.importComputers);
      pc.choices = Object.fromEntries(computers.map((c) => [c.key, c.choice]));
      dives.sort((x, y) => x.localStart.localeCompare(y.localStart));
      const { counts, decisions, conflicts } = await previewDives(pc, parsed.length, dives);
      const sites = await previewSites(pc, dives);
      return { mode: row.importMode, windowMinutes: row.importWindowMinutes, computers, counts, sites, sitesAllowed: pc.sitesAllowed, decisions, conflicts, goneDives };
    },

    /**
     * Starts the import (ADR 0030): reads the dives again (or the Provider's kept read), keeps the choice per computer on
     * the Connection, stores one Original per dive (its record as JSON, never the whole answer; for dives that come as
     * files none: the worker downloads the new dives' files), and creates the Import
     * the worker runs, with the context and the decisions. `unattended` (a scheduled fetch, ADR 0056): a fresh read that
     * also finds gone dives, as a preview's (ADR 0051); only the computers the User chose for keep a choice, so the
     * others' dives wait (`no_computer_choice`), and Conflicts wait in "Needs your decision".
     */
    async start(userId: string, connectionId: string, given: {
      computers: Record<string, ComputerChoice>; decisions: Record<string, string>; conflicts?: Record<string, 'hub' | 'provider'>;
      unattended?: boolean;
    }) {
      const { row, adapter, context, parsed, dives, pc } = await readWithContext(userId, connectionId, { recent: !given.unattended });
      if (given.unattended) await recordFindings(db, row, parsed);
      const saved = { ...row.importComputers, ...given.computers };
      const computers = (await computersOf(db, pc, dives, saved)).filter((c) => !given.unattended || saved[c.key] !== undefined);
      const choices = Object.fromEntries(computers.map((c) => [c.key, c.choice]));
      // Dives that come as files (ADR 0062): the worker downloads the new ones; their files are the Originals, never their records.
      const sorted = adapter.dives?.file ? await sortFiles(pc, parsed) : null;
      const stored = sorted ? [] : await Promise.all(parsed.map(async ({ remoteId, record }) => ({
        remoteId, blob: await blobs.putOriginal(Buffer.from(JSON.stringify(record), 'utf8')),
      })));
      const plan: ProviderImportPlan = {
        context: pick(context), computers: choices, decisions: given.decisions, conflicts: given.conflicts ?? {}, mode: row.importMode,
        windowMinutes: row.importWindowMinutes, diverId: row.diverId, ...(given.unattended && { unattended: true }),
        ...(sorted && { files: sorted.files, ended: sorted.ended }),
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
      const pc = await contextOf(db, job.userId, adapter, {
        diverId: plan.diverId, connectionId: job.connectionId, mode: plan.mode, windowMinutes: plan.windowMinutes, choices: plan.computers,
        context: plan.context,
      });
      await db.transaction((tx) => settleSiteVisibility(tx, pc));
      if (adapter.dives?.file) return [...(plan.ended ?? []), ...(await placeFiles(job, pc, plan.files ?? []))];
      const rows = await db.select({ id: original.id, storageKey: original.storageKey, fileName: original.fileName })
        .from(importOriginal).innerJoin(original, eq(original.id, importOriginal.originalId))
        .where(eq(importOriginal.importId, job.id));
      const readOriginal = async (o: (typeof rows)[number]): Promise<ReadOriginal> => {
        const fileName = o.fileName ?? o.id;
        try {
          const d = parse(JSON.parse((await blobs.read(o.storageKey)).toString('utf8')) as Record<string, unknown>, plan.context);
          if (!d) return { fileName, ended: { fileName, result: 'skipped', reason: 'not_a_dive' } };
          const [earlier] = await db.select({ id: importOriginal.importId }).from(importOriginal)
            .innerJoin(importJob, eq(importJob.id, importOriginal.importId))
            .where(and(eq(importOriginal.originalId, o.id), sql`${importOriginal.importId} <> ${job.id}`, eq(importJob.status, 'done'))).limit(1);
          return { fileName, originalId: o.id, dive: d, seen: !!earlier };
        } catch (error) {
          return { fileName, ended: { fileName, result: 'failed', reason: 'file_failed', message: errorMessage(error) } };
        }
      };
      const items: ReadOriginal[] = [];
      for (const o of rows) items.push(await readOriginal(o));
      const startOf = (item: ReadOriginal) => ('dive' in item ? item.dive.localStart : '');
      items.sort((a, b) => startOf(a).localeCompare(startOf(b)));
      const outcome: ImportOutcome = [];
      for (const item of items) {
        if ('ended' in item) { outcome.push(item.ended); continue; }
        const { dive: d, ...at } = item;
        try {
          outcome.push(await db.transaction((tx) => processDive(tx, pc, plan, d, { importId: job.id, ...at })));
        } catch (error) {
          outcome.push({ fileName: item.fileName, result: 'failed', reason: 'file_failed', message: errorMessage(error), remoteId: d.remoteId });
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
