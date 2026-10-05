// Importing a Provider's dives (ADR 0030), generic: what an adapter's `dives.list` and `dives.parse` give is decided
// here. Trust per dive by its evidence (sent by Dive Hub, from a dive computer, typed by hand) and per computer by the
// User; logbook entries match Dives here by local time and fill what they lack; computer dives become Recordings placed
// like a file's. A preview first (nothing stored), then an Import over one JSON Original per dive that the worker runs.
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import {
  connection, dive, diveSite, diveSiteExternalId, diver, diverExternalId, device, importJob, importOriginal, original, participant, push,
  recording, type ComputerChoice, type DiveImportMode, type ImportOutcome, type ProviderImportPlan, type UtcOffsetSource,
} from '../db/schema.js';
import { managedDiverIds, participantsOf } from '../dives/dive-service.js';
import { writeRevision, type Actor, type Changes } from '../dives/revisions.js';
import { placeLocalTime, wallClockMs, type PlacedTime } from '../dives/time-zone.js';
import type { ParsedRecording } from '../fit/fit-adapter.js';
import { PROCESS_IMPORT_TASK } from '../imports/import-service.js';
import { deviceDiver, placeRecording } from '../imports/placement.js';
import { entryMatches } from '../imports/matching.js';
import { siteRef } from '../sites/dive-site-link.js';
import type { BlobStore } from '../storage/blob-store.js';
import type { ConnectionService } from './connection-service.js';
import { loadOutgoingDive } from './outgoing-dive.js';
import { REFERENCE_PREFIX, type ImportContext, type ImportedDive, type ProviderAdapter } from './provider.js';
import { currentRemote, fingerprintNow } from './push-service.js';
import { named, ProviderServiceError, type ProviderRegistry } from './registry.js';

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
  | { kind: 'no_match' };

/** Everything one run needs to know, the same in the preview and in the worker. */
interface Run {
  userId: string;
  adapter: ProviderAdapter;
  diverId: string;
  connectionId: string | null;
  mode: DiveImportMode;
  windowMinutes: number;
  /** The choice for every computer found. */
  choices: Record<string, ComputerChoice>;
  managed: Set<string>;
}

const DAY_MS = 86_400_000;
const MAX_OFFSET_MS = 14 * 3600_000;
const keyOf = (d: { manufacturer: string; serialNumber: string }) => `${d.manufacturer}:${d.serialNumber}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createDiveImportService(deps: { db: Db; blobs: BlobStore; registry: ProviderRegistry; connections: ConnectionService }) {
  const { db, blobs, registry, connections } = deps;

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
  async function read(userId: string, connectionId: string, options: { recent?: boolean } = {}) {
    const row = await connections.own(userId, connectionId);
    const { adapter, list, parse } = importer(row.provider);
    if (row.importMode === 'off') throw new ProviderServiceError('provider_import_off', named(adapter));
    const listing = await connections.withAccess(row, (ctx) => list(ctx, options));
    const parsed = listing.records.map(({ remoteId, record }) => ({ remoteId, record, dive: parse(record, listing.context) }));
    return { row, adapter, context: listing.context, parsed };
  }

  /** The computers among the dives, with the User's choice kept on the Connection, else the suggestion. */
  async function computersOf(q: Db | Tx, run: Run, dives: ImportedDive[], saved: Record<string, ComputerChoice>) {
    const found = new Map<string, ComputerView>();
    for (const d of dives) {
      // A dive Dive Hub sent carries the computer of Dive Hub's own recording: not one found at the Provider.
      if (d.evidence !== 'computer' || !d.device || (await sentTo(q, run, d.remoteId))) continue;
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

  /** The Dive this remote dive is linked to now (by a Push), among the User's, or null. */
  async function linkedTo(q: Db | Tx, run: Run, remoteId: string) {
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
  async function sentTo(q: Db | Tx, run: Run, remoteId: string): Promise<string | null> {
    const rows = await q.select({ diveId: push.diveId, diverId: dive.diverId }).from(push).innerJoin(dive, eq(dive.id, push.diveId))
      .where(and(eq(push.provider, run.adapter.id), eq(push.remoteId, remoteId), eq(push.state, 'confirmed'), inArray(push.action, ['create', 'update'])));
    return rows.find((r) => run.managed.has(r.diverId))?.diveId ?? null;
  }

  /** Of these Dives, those that have a remote dive at the Provider now (they are another remote dive's already). */
  async function withRemote(q: Db | Tx, run: Run, diveIds: string[]) {
    if (diveIds.length === 0) return new Set<string>();
    const rows = await q.select().from(push).where(and(eq(push.provider, run.adapter.id), inArray(push.diveId, diveIds)))
      .orderBy(desc(push.createdAt), desc(push.id));
    return new Set(diveIds.filter((id) => currentRemote(rows.filter((p) => p.diveId === id))));
  }

  /** What the import does with one dive (the preview says it, the worker does it). */
  async function assess(q: Db | Tx, run: Run, d: ImportedDive): Promise<Assessment> {
    if (d.evidence === 'ours') {
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
    if (linked) return linked.deleted ? { kind: 'deleted' } : { kind: 'linked', diveId: linked.diveId };
    if (d.evidence === 'computer' && d.device && run.choices[keyOf(d.device)] !== 'entries') {
      const owner = await deviceDiver(q, d.device);
      if (owner === null || run.managed.has(owner)) return { kind: 'recording' };
    }
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
    const live = matches.filter((m) => !m.deletedAt && !taken.has(m.id));
    if (live.length === 1) return { kind: 'link', diveId: live[0]!.id };
    if (live.length > 1) {
      return {
        kind: 'decide',
        candidates: live.map((m) => ({
          diveId: m.id, number: m.number, startsAt: m.startsAt, utcOffsetSeconds: m.utcOffsetSeconds, utcOffsetSource: m.utcOffsetSource,
          durationSeconds: m.durationSeconds, maxDepthM: m.maxDepthM, site: m.siteId && m.siteName !== null ? { id: m.siteId, name: m.siteName } : null,
        })),
      };
    }
    // A Dive deleted here stays deleted (ADR 0026): its entry doesn't come back as a new Dive.
    if (matches.some((m) => m.deletedAt && !taken.has(m.id))) return { kind: 'deleted' };
    return run.mode === 'create' ? { kind: 'create' } : { kind: 'no_match' };
  }

  /** The start's instant: from the dive's position, else its site's at the Provider, else nearby Dives, else unknown. */
  const placeTime = (q: Db | Tx, run: Run, d: ImportedDive): Promise<PlacedTime> =>
    placeLocalTime(q, run.diverId, wallClockMs(d.localStart)!, [d.exit, d.entry, d.sitePosition]);

  /**
   * Fills what the Dive lacks from the Provider's dive (ADR 0030), overwriting nothing: the site (only one that already
   * has the Provider's site ID), the Participants (by their accounts at the Provider, when the Dive has none), the notes.
   * One Revision; whether anything changed.
   */
  async function fill(tx: Tx, run: Run, diveId: string, d: ImportedDive, actor: Actor): Promise<boolean> {
    const [current] = await tx.select().from(dive).where(eq(dive.id, diveId)).for('update');
    if (!current) return false;
    const changes: Changes = {};
    const columns: Partial<typeof dive.$inferInsert> = {};
    if (!current.siteId) {
      for (const [source, externalId] of Object.entries(d.siteIds)) {
        const [site] = await tx.select({ id: diveSite.id }).from(diveSiteExternalId)
          .innerJoin(diveSite, eq(diveSite.id, diveSiteExternalId.siteId))
          .where(and(eq(diveSiteExternalId.source, source as typeof diveSiteExternalId.$inferSelect.source),
            eq(diveSiteExternalId.externalId, externalId), isNull(diveSite.deletedAt)));
        if (!site) continue;
        columns.siteId = site.id;
        changes.site = { from: null, to: await siteRef(tx, site.id) };
        break;
      }
    }
    if (!current.notes?.trim() && d.notes) {
      columns.notes = d.notes;
      changes.notes = { from: current.notes, to: d.notes };
    }
    const source = run.adapter.accountSource;
    if (source && d.people.length > 0 && (await participantsOf(tx, diveId)).length === 0) {
      const divers = await tx.select({ diverId: diverExternalId.diverId }).from(diverExternalId)
        .innerJoin(diver, eq(diver.id, diverExternalId.diverId))
        .where(and(eq(diverExternalId.source, source), inArray(diverExternalId.externalId, d.people), isNull(diver.deletedAt)));
      const ids = [...new Set(divers.map((x) => x.diverId))].filter((id) => id !== current.diverId);
      if (ids.length > 0) {
        await tx.insert(participant).values(ids.map((diverId) => ({ diveId, diverId, role: 'buddy' as const })));
        changes.participants = { from: [], to: await participantsOf(tx, diveId) };
      }
    }
    if (Object.keys(changes).length === 0) return false;
    await tx.update(dive).set({ ...columns, version: sql`${dive.version} + 1`, updatedAt: new Date() }).where(eq(dive.id, diveId));
    await writeRevision(tx, 'dive', diveId, actor, 'fill', changes);
    return true;
  }

  /**
   * Links the Dive to the Provider's dive (a `link` Push), unless it has a remote dive there already: sending then updates
   * that dive instead of making another. `upToDate`: the Dive was made from it, so it shows up to date.
   */
  async function link(tx: Tx, run: Run, diveId: string, d: ImportedDive, upToDate: boolean) {
    if ((await withRemote(tx, run, [diveId])).size > 0) return;
    const loaded = await loadOutgoingDive(tx, run.userId, diveId);
    await tx.insert(push).values({
      diveId, connectionId: run.connectionId, userId: run.userId, provider: run.adapter.id, mode: run.adapter.dives!.mode,
      action: 'link', state: 'confirmed', remoteId: d.remoteId, remoteNumber: d.remoteNumber, diveVersion: loaded.row.version,
      fingerprint: upToDate ? fingerprintNow(run.adapter, loaded) : null,
    });
  }

  /** A Dive without a Recording from a logbook entry (ADR 0030): its values, marked as the Provider's. */
  async function createDive(tx: Tx, run: Run, d: ImportedDive, actor: Actor): Promise<string> {
    const time = await placeTime(tx, run, d);
    const [created] = await tx.insert(dive).values({
      diverId: run.diverId, startsAt: time.startsAt, utcOffsetSeconds: time.utcOffsetSeconds, utcOffsetSource: time.utcOffsetSource,
      durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, avgDepthM: d.avgDepthM, waterTemperatureC: d.waterTemperatureC,
      fromProvider: run.adapter.id,
    }).returning({ id: dive.id });
    await writeRevision(tx, 'dive', created!.id, actor, 'import-create', { fromProvider: { from: null, to: run.adapter.id } });
    await fill(tx, run, created!.id, d, actor);
    await link(tx, run, created!.id, d, true);
    return created!.id;
  }

  /** A computer's dive as a Recording, the way a FIT file's would be (ADR 0030). */
  function asRecording(run: Run, d: ImportedDive, time: PlacedTime): ParsedRecording {
    const series = (['depth', 'temperature', 'ndl'] as const).flatMap((channel) => {
      const s = d.samples[channel];
      return s ? [{ channel, offsetsMs: s.offsetsMs.map(Math.round), values: s.values }] : [];
    });
    const temperatures = d.samples.temperature?.values ?? [];
    const summary = {
      ...(d.gases.length > 0 && { gases: d.gases }),
      ...(d.gfLow !== null && { gfLow: d.gfLow }), ...(d.gfHigh !== null && { gfHigh: d.gfHigh }),
      ...((d.waterTemperatureC ?? (temperatures.length ? Math.min(...temperatures) : null)) !== null
        && { minTemperatureC: d.waterTemperatureC ?? Math.min(...temperatures) }),
      ...((d.maxTemperatureC ?? (temperatures.length ? Math.max(...temperatures) : null)) !== null
        && { maxTemperatureC: d.maxTemperatureC ?? Math.max(...temperatures) }),
      ...(d.cnsStart !== null && { cnsStart: d.cnsStart }), ...(d.cnsEnd !== null && { cnsEnd: d.cnsEnd }),
    };
    const depths = d.samples.depth?.values ?? [];
    return {
      device: d.device ? {
        manufacturer: d.device.manufacturer, serialNumber: d.device.serialNumber,
        ...(d.device.product && { product: d.device.product }), ...(d.device.firmware && { firmware: d.device.firmware }),
      } : undefined,
      recordingKey: `${run.adapter.id}:${d.remoteId}`,
      startsAt: time.startsAt, utcOffsetSeconds: time.utcOffsetSeconds ?? undefined, utcOffsetSource: time.utcOffsetSource,
      durationSeconds: d.durationSeconds,
      maxDepthM: d.maxDepthM ?? (depths.length ? Math.max(...depths) : undefined), avgDepthM: d.avgDepthM ?? undefined,
      entryPosition: d.entry ?? undefined, exitPosition: d.exit ?? undefined,
      summary, series, events: [],
    };
  }

  /** One dive of a running Import, in its own transaction. `seen`: its Original came with an earlier Import unchanged. */
  async function processDive(
    tx: Tx, run: Run, plan: ProviderImportPlan, d: ImportedDive, at: { importId: string; originalId: string; fileName: string; seen: boolean },
  ): Promise<ImportOutcome[number]> {
    const actor: Actor = { type: 'import', id: at.importId };
    const base = { fileName: at.fileName, remoteId: d.remoteId, ...(d.remoteNumber !== null && { remoteNumber: d.remoteNumber }) };
    const a = await assess(tx, run, d);
    switch (a.kind) {
      case 'ours': {
        // Sent by Dive Hub: already ours. One whose answer got lost is linked to its Dive, as sending would.
        const [own] = a.diveId ? await tx.select({ diverId: dive.diverId }).from(dive).where(and(eq(dive.id, a.diveId), isNull(dive.deletedAt))) : [];
        if (own && run.managed.has(own.diverId)) await link(tx, run, a.diveId!, d, false);
        return { ...base, result: 'skipped', reason: 'sent_by_dive_hub', ...(own && run.managed.has(own.diverId) && { diveId: a.diveId! }) };
      }
      case 'deleted':
        return { ...base, result: 'skipped', reason: 'deleted_earlier' };
      case 'linked': {
        if (at.seen) return { ...base, result: 'unchanged', diveId: a.diveId };
        return { ...base, result: (await fill(tx, run, a.diveId, d, actor)) ? 'updated' : 'unchanged', diveId: a.diveId };
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
          await fill(tx, run, placed.diveId, d, actor);
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
        // Several Dives and no decision that still fits (it turned ambiguous after the preview): left out.
        return { ...base, result: 'skipped', reason: 'ambiguous' };
      }
      case 'create':
        return { ...base, result: 'created', diveId: await createDive(tx, run, d, actor) };
      case 'no_match':
        return { ...base, result: 'skipped', reason: 'no_match' };
    }
  }

  async function runOf(q: Db | Tx, userId: string, adapter: ProviderAdapter, s: {
    diverId: string; connectionId: string | null; mode: DiveImportMode; windowMinutes: number; choices: Record<string, ComputerChoice>;
  }): Promise<Run> {
    return { userId, adapter, ...s, managed: await managedDiverIds(q, userId) };
  }

  return {
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
     * What the import would do now (ADR 0030): reads the account's dives (one paced action) and stores nothing. The
     * computers found with their choice, how many dives go which way, and the logbook entries the User decides.
     */
    async preview(userId: string, connectionId: string) {
      const { row, adapter, parsed } = await read(userId, connectionId);
      const dives = parsed.flatMap((p) => (p.dive ? [p.dive] : []));
      const run = await runOf(db, userId, adapter, {
        diverId: row.diverId, connectionId: row.id, mode: row.importMode, windowMinutes: row.importWindowMinutes, choices: {},
      });
      const computers = await computersOf(db, run, dives, row.importComputers);
      run.choices = Object.fromEntries(computers.map((c) => [c.key, c.choice]));
      const counts = { total: parsed.length, unreadable: parsed.length - dives.length, ours: 0, linked: 0, deleted: 0, recordings: 0, link: 0, decide: 0, create: 0, noMatch: 0 };
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
        else {
          counts.decide += 1;
          decisions.push({
            remoteId: d.remoteId, remoteNumber: d.remoteNumber, localStart: d.localStart, durationSeconds: d.durationSeconds,
            maxDepthM: d.maxDepthM, candidates: a.candidates,
          });
        }
      }
      return { mode: row.importMode, windowMinutes: row.importWindowMinutes, computers, counts, decisions };
    },

    /**
     * Starts the import (ADR 0030): reads the dives again (or the Provider's kept read), keeps the choice per computer on
     * the Connection, stores one Original per dive (its record as JSON, never the whole answer), and creates the Import
     * the worker runs, with the context and the decisions.
     */
    async start(userId: string, connectionId: string, given: { computers: Record<string, ComputerChoice>; decisions: Record<string, string> }) {
      const { row, adapter, context, parsed } = await read(userId, connectionId, { recent: true });
      const dives = parsed.flatMap((p) => (p.dive ? [p.dive] : []));
      const run = await runOf(db, userId, adapter, {
        diverId: row.diverId, connectionId: row.id, mode: row.importMode, windowMinutes: row.importWindowMinutes, choices: {},
      });
      const saved = { ...row.importComputers, ...given.computers };
      const computers = await computersOf(db, run, dives, saved);
      const choices = Object.fromEntries(computers.map((c) => [c.key, c.choice]));
      const stored = await Promise.all(parsed.map(async ({ remoteId, record }) => ({
        remoteId, blob: await blobs.putOriginal(Buffer.from(JSON.stringify(record), 'utf8')),
      })));
      const plan: ProviderImportPlan = {
        context: pick(context), computers: choices, decisions: given.decisions, mode: row.importMode,
        windowMinutes: row.importWindowMinutes, diverId: row.diverId,
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
      });
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
  sites: Object.fromEntries(Object.entries(c.sites).map(([k, s]) => [k, { name: s.name, latitude: s.latitude, longitude: s.longitude }])),
});

export type DiveImportService = ReturnType<typeof createDiveImportService>;
