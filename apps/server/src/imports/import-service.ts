import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import type { Db } from '../db/client.js';
import { importJob, importOriginal, original, recording, type ImportOutcome } from '../db/schema.js';
import type { Actor } from '../dives/revisions.js';
import { positionColumns } from '../sites/dive-site-link.js';
import type { BlobStore } from '../storage/blob-store.js';
import { extractFiles, looksLikeZip, type ExtractedFile } from './archive.js';
import { createFileFormats, formatOf, type FileFormat } from './formats.js';
import type { ParsedRecording } from './parsed-recording.js';
import { placeRecording } from './placement.js';

export const PROCESS_IMPORT_TASK = 'process_import';
/** Reads positions for Recordings imported before they were kept (ADR 0020); queued at worker start. */
export const BACKFILL_POSITIONS_TASK = 'backfill_positions';

/** The upload is neither a dive file in a format we read nor a zip archive. Stored as the Import's error code. */
export class UnsupportedFileError extends Error {
  constructor() { super('Unsupported file: expected a dive file (FIT, Suunto JSON) or a zip archive'); }
}

export interface ImportServiceDeps {
  db: Db;
  blobs: BlobStore;
  /** The file formats read (ADR 0037); all of them unless a test narrows it. */
  formats?: FileFormat[];
  /**
   * Runs an Import of a Provider's dives (ADR 0030; src/providers/dive-import.ts), whose Originals were stored when it
   * started. Without it, such an Import fails.
   */
  providerImports?: () => { process(job: typeof importJob.$inferSelect): Promise<ImportOutcome> };
  /** Runs once an Import is done, for its User: the dive assessment catches up (ADR 0036). */
  afterImport?: (userId: string) => Promise<void>;
}

export function createImportService({ db, blobs, formats = createFileFormats(), providerImports, afterImport }: ImportServiceDeps) {
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
   * Worker task: unpack, store Originals, parse, and place each Recording; an import of a Provider's dives runs over the
   * Originals it stored (ADR 0030). Returns the outcome, whose failures carry the parser's detail (`message`) for the
   * server log; the API never shows it.
   */
  async function processImport(importId: string): Promise<ImportOutcome> {
    const [job] = await db.select().from(importJob).where(eq(importJob.id, importId));
    if (!job || job.status === 'done') return [];
    await db.update(importJob).set({ status: 'processing' }).where(eq(importJob.id, importId));
    const actor: Actor = { type: 'import', id: importId };

    if (job.provider) {
      try {
        if (!providerImports) throw new Error('This server runs no imports from Providers');
        const outcome = await providerImports().process(job);
        await db.update(importJob).set({ status: 'done', outcome, finishedAt: new Date() }).where(eq(importJob.id, importId));
        await afterImport?.(job.userId);
        return outcome;
      } catch (error) {
        await db.update(importJob).set({ status: 'failed', error: (error as Error).message, finishedAt: new Date() }).where(eq(importJob.id, importId));
        throw error;
      }
    }

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
        outcome.push({ fileName: job.uploadName, result: 'skipped', reason: 'no_dive_file' });
      }
      await db
        .update(importJob)
        .set({ status: 'done', outcome, finishedAt: new Date(), uploadStorageKey: null })
        .where(eq(importJob.id, importId));
      await blobs.delete(job.uploadStorageKey!);
      await afterImport?.(job.userId);
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
    if (formatOf(formats, data)) return [{ name, data }];
    if (looksLikeZip(data)) return extractFiles(blobs.pathOf(key), (entry) => formatOf(formats, entry) !== undefined);
    throw new UnsupportedFileError();
  }

  async function processFile(userId: string, importId: string, file: ExtractedFile, actor: Actor): Promise<ImportOutcome> {
    const format = formatOf(formats, file.data);
    if (!format) throw new UnsupportedFileError();
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
            userId, sha256: stored.sha256, mediaType: format.mediaType,
            sizeBytes: stored.sizeBytes, fileName: file.name, storageKey: stored.key,
          })
          .returning())[0]!;
      await tx.insert(importOriginal).values({ importId, originalId: orig.id }).onConflictDoNothing();

      if (existing) {
        const known = await tx.select({ id: recording.id, diveId: recording.diveId, deletedAt: recording.deletedAt }).from(recording)
          .where(eq(recording.originalId, orig.id));
        if (known.length > 0) {
          // A Recording on a Dive the User deleted stays deleted (ADR 0026).
          return known.map((r) => (r.deletedAt
            ? { fileName: file.name, result: 'skipped' as const, reason: 'deleted_earlier' as const, recordingId: r.id }
            : { fileName: file.name, result: 'unchanged' as const, recordingId: r.id, ...(r.diveId && { diveId: r.diveId }) }));
        }
      }

      const parsed = await format.parse(file.data);
      if (parsed.length === 0) return [{ fileName: file.name, result: 'skipped' as const, reason: 'not_a_dive' as const }];
      const results: ImportOutcome = [];
      const parser = { name: format.parser, version: format.parserVersion };
      for (const rec of parsed) {
        results.push(await placeRecording(tx, { userId, importId, originalId: orig.id, fileName: file.name, actor, parser }, rec));
      }
      return results;
    });
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
          const data = await blobs.read(r.storageKey);
          parsed = (await formatOf(formats, data)?.parse(data))?.find((p) => p.recordingKey === r.recordingKey);
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

export type ImportService = ReturnType<typeof createImportService>;
