import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import type { Db, Tx } from '../db/client.js';
import {
  device,
  dive,
  diverManagement,
  duplicateCandidate,
  importJob,
  importOriginal,
  original,
  recording,
  recordingEvent,
  sampleSeries,
  type ImportOutcome,
} from '../db/schema.js';
import { attachRecording, createDiveFromRecording, refreshFromPrimary } from '../dives/dive-service.js';
import { writeRevision, type Actor } from '../dives/revisions.js';
import { linkNearbySite, positionColumns } from '../sites/dive-site-link.js';
import { createFitAdapter, looksLikeFit, type FitAdapter, type ParsedRecording } from '../fit/fit-adapter.js';
import type { BlobStore } from '../storage/blob-store.js';
import { extractFitFiles, looksLikeZip, type ExtractedFile } from './archive.js';
import { decideMatch, overlapWindow } from './matching.js';

export const PROCESS_IMPORT_TASK = 'process_import';
/** Reads positions for Recordings imported before they were kept (ADR 0020); queued at worker start. */
export const BACKFILL_POSITIONS_TASK = 'backfill_positions';

/** The upload is neither a FIT file nor a zip archive. Stored as the Import's error code. */
export class UnsupportedFileError extends Error {
  constructor() { super('Unsupported file: expected a FIT file or a zip archive'); }
}

export interface ImportServiceDeps {
  db: Db;
  blobs: BlobStore;
  fit?: FitAdapter;
}


export function createImportService({ db, blobs, fit = createFitAdapter() }: ImportServiceDeps) {
  /** Stores the upload and creates the Import; its job is enqueued in the same transaction (ADR 0010). */
  async function createImport(userId: string, fileName: string, stream: Readable, maxBytes: number) {
    const upload = await blobs.putIncoming(stream, maxBytes);
    try {
      return await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(importJob)
          .values({ userId, uploadName: fileName, uploadSha256: upload.sha256, uploadStorageKey: upload.key })
          .returning();
        await tx.execute(
          sql`select graphile_worker.add_job(${PROCESS_IMPORT_TASK}, json_build_object('importId', ${created!.id}::text))`,
        );
        return created!;
      });
    } catch (error) {
      await blobs.delete(upload.key);
      throw error;
    }
  }

  /**
   * Worker task: unpack, store Originals, parse, and place each Recording. Returns the outcome, whose
   * failures carry the parser's detail (`message`) for the server log; the API never shows it.
   */
  async function processImport(importId: string): Promise<ImportOutcome> {
    const [job] = await db.select().from(importJob).where(eq(importJob.id, importId));
    if (!job || job.status === 'done') return [];
    await db.update(importJob).set({ status: 'processing' }).where(eq(importJob.id, importId));
    const actor: Actor = { type: 'import', id: importId };

    try {
      const files = await unpack(job.uploadStorageKey!, job.uploadName);
      const outcome: ImportOutcome = [];
      for (const file of files) {
        try {
          outcome.push(...(await processFile(job.userId, importId, file, actor)));
        } catch (error) {
          outcome.push({ fileName: file.name, result: 'failed', reason: 'file_failed', message: (error as Error).message });
        }
      }
      if (files.length === 0) {
        outcome.push({ fileName: job.uploadName, result: 'skipped', reason: 'no_fit_file' });
      }
      await db
        .update(importJob)
        .set({ status: 'done', outcome, finishedAt: new Date(), uploadStorageKey: null })
        .where(eq(importJob.id, importId));
      await blobs.delete(job.uploadStorageKey!);
      return outcome;
    } catch (error) {
      await db
        .update(importJob)
        .set({ status: 'failed', error: error instanceof UnsupportedFileError ? 'unsupported_file' : (error as Error).message, finishedAt: new Date() })
        .where(eq(importJob.id, importId));
      throw error;
    }
  }

  async function unpack(key: string, name: string): Promise<ExtractedFile[]> {
    const data = await blobs.read(key);
    if (looksLikeFit(data)) return [{ name, data }];
    if (looksLikeZip(data)) return extractFitFiles(blobs.pathOf(key));
    throw new UnsupportedFileError();
  }

  async function processFile(userId: string, importId: string, file: ExtractedFile, actor: Actor): Promise<ImportOutcome> {
    const stored = await blobs.putOriginal(file.data);
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(original)
        .where(and(eq(original.userId, userId), eq(original.sha256, stored.sha256)));
      const orig =
        existing ??
        (await tx
          .insert(original)
          .values({
            userId, sha256: stored.sha256, mediaType: 'application/vnd.ant.fit',
            sizeBytes: stored.sizeBytes, fileName: file.name, storageKey: stored.key,
          })
          .returning())[0]!;
      await tx.insert(importOriginal).values({ importId, originalId: orig.id }).onConflictDoNothing();

      if (existing) {
        const known = await tx.select({ id: recording.id, diveId: recording.diveId }).from(recording)
          .where(and(eq(recording.originalId, orig.id), isNull(recording.deletedAt)));
        if (known.length > 0) {
          return known.map((r) => ({
            fileName: file.name, result: 'unchanged' as const, recordingId: r.id, ...(r.diveId && { diveId: r.diveId }),
          }));
        }
      }

      const parsed = await fit.parse(file.data);
      if (parsed.length === 0) return [{ fileName: file.name, result: 'skipped' as const, reason: 'not_a_dive' as const }];
      const results: ImportOutcome = [];
      for (const rec of parsed) results.push(await placeRecording(tx, userId, importId, orig.id, file.name, rec, actor));
      return results;
    });
  }

  async function placeRecording(
    tx: Tx, userId: string, importId: string, originalId: string, fileName: string, rec: ParsedRecording, actor: Actor,
  ): Promise<ImportOutcome[number]> {
    // A User only ever writes to the logbooks of Divers they manage.
    const managed = await managedDivers(tx, userId);
    const diverId = await resolveDiver(tx, userId, rec, managed);
    if (!diverId) return { fileName, result: 'skipped', reason: 'not_your_diver' };
    const deviceId = rec.device ? await resolveDevice(tx, diverId, rec) : null;
    const values = {
      deviceId, originalId, importId, recordingKey: rec.recordingKey,
      parser: fit.parser, parserVersion: fit.parserVersion,
      startsAt: rec.startsAt, utcOffsetSeconds: rec.utcOffsetSeconds ?? null,
      durationSeconds: rec.durationSeconds, maxDepthM: rec.maxDepthM ?? null, avgDepthM: rec.avgDepthM ?? null,
      ...positionColumns(rec), summary: rec.summary, updatedAt: new Date(),
    };

    // Same Recording seen before (e.g. a re-export with a different file hash): update in place.
    const [known] = await tx.select().from(recording)
      .where(and(eq(recording.recordingKey, rec.recordingKey), isNull(recording.deletedAt)));
    if (known) {
      if (!(await recordingIsManaged(tx, known, userId, managed))) return { fileName, result: 'skipped', reason: 'not_your_diver' };
      await tx.update(recording).set(values).where(eq(recording.id, known.id));
      await writeSamples(tx, known.id, rec, true);
      await writeRevision(tx, 'recording', known.id, actor, 'reimport', { originalId: { from: known.originalId, to: originalId } });
      // If it is a Dive's Primary recording, the Dive's values without Override follow the new data.
      const [owner] = await tx.select({ id: dive.id }).from(dive).where(eq(dive.primaryRecordingId, known.id));
      if (owner) await refreshFromPrimary(tx, owner.id, actor, 'reimport');
      return { fileName, result: 'updated', recordingId: known.id, ...(known.diveId && { diveId: known.diveId }) };
    }

    const [created] = await tx.insert(recording).values(values).returning();
    await writeSamples(tx, created!.id, rec, false);

    const window = overlapWindow(rec);
    const candidates = await tx
      .select({ id: dive.id, startsAt: dive.startsAt, durationSeconds: dive.durationSeconds, maxDepthM: dive.maxDepthM })
      .from(dive)
      .where(and(
        eq(dive.diverId, diverId), isNull(dive.deletedAt),
        lte(dive.startsAt, window.to), gte(dive.startsAt, new Date(window.from.getTime() - 24 * 3600_000)),
      ));
    const decision = decideMatch(rec, candidates.map((c) => ({ ...c, maxDepthM: c.maxDepthM ?? undefined })));

    if (decision.kind === 'create') {
      const newDiveId = await createDiveFromRecording(tx, created!, diverId, actor, 'import-create');
      await linkNearbySite(tx, newDiveId, created!, actor);
      return { fileName, result: 'created', diveId: newDiveId, recordingId: created!.id };
    }
    if (decision.kind === 'attach') {
      await attachRecording(tx, decision.diveId, created!.id, actor, 'auto-attach');
      return { fileName, result: 'attached', diveId: decision.diveId, recordingId: created!.id };
    }
    await tx.insert(duplicateCandidate).values({
      recordingId: created!.id, candidateDiveIds: decision.diveIds, reason: decision.reason,
    });
    return { fileName, result: 'duplicate-candidate', recordingId: created!.id, reason: decision.reason };
  }

  /**
   * Recordings go to the Diver their Device is assigned to; unknown Devices default to the User's own
   * Diver. Null when the Device belongs to a Diver this User doesn't manage.
   */
  async function resolveDiver(tx: Tx, userId: string, rec: ParsedRecording, managed: Set<string>): Promise<string | null> {
    if (rec.device) {
      const [known] = await tx.select({ diverId: device.diverId }).from(device).where(and(
        eq(device.manufacturer, rec.device.manufacturer), eq(device.serialNumber, rec.device.serialNumber),
        isNull(device.deletedAt),
      ));
      if (known) return managed.has(known.diverId) ? known.diverId : null;
    }
    const [own] = await tx.select({ diverId: diverManagement.diverId }).from(diverManagement)
      .where(and(eq(diverManagement.userId, userId), eq(diverManagement.isOwn, true)));
    if (!own) throw new Error('User has no own Diver');
    return own.diverId;
  }

  async function resolveDevice(tx: Tx, diverId: string, rec: ParsedRecording): Promise<string> {
    const d = rec.device!;
    const [known] = await tx.select().from(device).where(and(
      eq(device.manufacturer, d.manufacturer), eq(device.serialNumber, d.serialNumber), isNull(device.deletedAt),
    ));
    if (known) {
      if (d.firmware && d.firmware !== known.firmware) {
        await tx.update(device).set({ firmware: d.firmware, updatedAt: new Date() }).where(eq(device.id, known.id));
      }
      return known.id;
    }
    const [created] = await tx.insert(device).values({
      diverId, manufacturer: d.manufacturer, serialNumber: d.serialNumber,
      product: d.product ?? null, firmware: d.firmware ?? null,
    }).returning();
    return created!.id;
  }

  /**
   * Recordings imported before positions were kept get them from their Original (ADR 0020). Each
   * Recording is read once: also when its Original fails to parse, it is marked as read.
   * Returns how many Recordings were read.
   */
  async function backfillPositions(): Promise<number> {
    let read = 0;
    for (;;) {
      const batch = await db.select({ id: recording.id, recordingKey: recording.recordingKey, storageKey: original.storageKey })
        .from(recording).innerJoin(original, eq(original.id, recording.originalId))
        .where(and(isNull(recording.positionsReadAt), isNull(recording.deletedAt)))
        .limit(50);
      if (batch.length === 0) return read;
      for (const r of batch) {
        let parsed: ParsedRecording | undefined;
        try {
          parsed = (await fit.parse(await blobs.read(r.storageKey))).find((p) => p.recordingKey === r.recordingKey);
        } catch {
          parsed = undefined; // a missing or unreadable Original: nothing to learn, don't try again
        }
        await db.update(recording)
          .set(positionColumns(parsed ?? { entryPosition: undefined, exitPosition: undefined }))
          .where(eq(recording.id, r.id));
        read++;
      }
    }
  }

  return { createImport, processImport, backfillPositions };
}

async function writeSamples(tx: Tx, recordingId: string, rec: ParsedRecording, replace: boolean) {
  if (replace) {
    await tx.delete(sampleSeries).where(eq(sampleSeries.recordingId, recordingId));
    await tx.delete(recordingEvent).where(eq(recordingEvent.recordingId, recordingId));
  }
  if (rec.series.length > 0) {
    await tx.insert(sampleSeries).values(rec.series.map((s) => ({
      recordingId, channel: s.channel, offsetsMs: s.offsetsMs, values: s.values,
    })));
  }
  if (rec.events.length > 0) {
    await tx.insert(recordingEvent).values(rec.events.map((e) => ({
      recordingId, offsetMs: e.offsetMs, type: e.type, data: e.data,
    })));
  }
}

async function managedDivers(tx: Tx, userId: string): Promise<Set<string>> {
  const rows = await tx.select({ id: diverManagement.diverId }).from(diverManagement).where(eq(diverManagement.userId, userId));
  return new Set(rows.map((r) => r.id));
}

/** Whether an existing Recording is in a logbook this User manages (via its Dive, else its Device, else its Original). */
async function recordingIsManaged(
  tx: Tx, rec: typeof recording.$inferSelect, userId: string, managed: Set<string>,
): Promise<boolean> {
  if (rec.diveId) {
    const [d] = await tx.select({ diverId: dive.diverId }).from(dive).where(eq(dive.id, rec.diveId));
    return !!d && managed.has(d.diverId);
  }
  if (rec.deviceId) {
    const [d] = await tx.select({ diverId: device.diverId }).from(device).where(eq(device.id, rec.deviceId));
    return !!d && managed.has(d.diverId);
  }
  const [o] = await tx.select({ userId: original.userId }).from(original).where(eq(original.id, rec.originalId));
  return o?.userId === userId;
}

export type ImportService = ReturnType<typeof createImportService>;
