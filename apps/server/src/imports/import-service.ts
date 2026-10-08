import { and, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import type { Db } from '../db/client.js';
import { DIVE_KINDS, importJob, importOriginal, original, recording, type DiveKind, type ImportFound, type ImportOutcome } from '../db/schema.js';
import type { Actor } from '../dives/revisions.js';
import { positionColumns } from '../sites/dive-site-link.js';
import type { BlobStore } from '../storage/blob-store.js';
import { DEFAULT_LIMITS, eachFile, looksLikeZip, type ArchiveEntry } from './archive.js';
import { createFileFormats, formatOf, type FileFormat } from './formats.js';
import type { ParsedRecording } from './parsed-recording.js';
import { placeRecording } from './placement.js';

export const PROCESS_IMPORT_TASK = 'process_import';
/** Reads positions for Recordings imported before they were kept (ADR 0020); queued at worker start. */
export const BACKFILL_POSITIONS_TASK = 'backfill_positions';

/** An Import that waits for the User's choice of kinds is ended after this long, and its upload removed (ADR 0044). */
export const CHOICE_WAIT_DAYS = 7;
export const EXPIRE_WAITING_IMPORTS_TASK = 'expire_waiting_imports';

/** The kind a User chooses by (ADR 0044): an apnea session, or a dive with a gas. */
export const kindOf = (rec: ParsedRecording): DiveKind => (rec.summary.diveMode === 'apnea' ? 'apnea' : 'scuba');

/** One file of an upload: the upload itself, or a file inside the archive it is. */
type UploadedFile = Pick<ArchiveEntry, 'index' | 'name' | 'read'>;
interface FileToPlace { name: string; data: Buffer }

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
    if (!job || job.status === 'done' || job.status === 'awaiting_choice' || job.status === 'cancelled') return [];
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
      const upload = await openUpload(job.uploadStorageKey!, job.uploadName);
      // First read everything and write nothing: which files are dives, and of which kinds (ADR 0044).
      const found: ImportFound = { scuba: 0, apnea: 0, otherFiles: 0 };
      const toPlace = new Set<number>();
      const chosen = new Set<DiveKind>(job.kinds ?? DIVE_KINDS);
      await upload.each(async (file) => {
        const data = await file.read();
        const format = formatOf(formats, data);
        let kinds: DiveKind[] = [];
        try {
          kinds = format ? (await format.parse(data)).map(kindOf) : [];
        } catch {
          toPlace.add(file.index); // reported as failed below, with the parser's words
          return;
        }
        for (const kind of kinds) found[kind]++;
        if (kinds.length === 0) found.otherFiles++;
        else if (kinds.some((k) => chosen.has(k))) toPlace.add(file.index);
      });

      // Several kinds and nobody asked yet: the User chooses; until then nothing but the upload is here.
      if (!job.kinds && DIVE_KINDS.filter((k) => found[k] > 0).length > 1) {
        await db.update(importJob).set({ status: 'awaiting_choice', found }).where(eq(importJob.id, importId));
        return [];
      }

      const outcome: ImportOutcome = [];
      await upload.each(async (file) => {
        if (!toPlace.has(file.index)) return;
        try {
          outcome.push(...(await processFile(job.userId, importId, { name: file.name, data: await file.read() }, actor, chosen)));
        } catch (error) {
          outcome.push({ fileName: file.name, result: 'failed', reason: 'file_failed', message: (error as Error).message });
        }
      });
      if (outcome.length === 0) {
        // One file that is no dive is named; an archive without any says so once.
        outcome.push(upload.archive || found.otherFiles === 0
          ? { fileName: job.uploadName, result: 'skipped', reason: 'no_dive_file' }
          : { fileName: job.uploadName, result: 'skipped', reason: 'not_a_dive' });
      }
      await db
        .update(importJob)
        .set({ status: 'done', outcome, found, finishedAt: new Date(), uploadStorageKey: null })
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

  /**
   * The files of an upload, one at a time and as often as asked: the upload itself when it is a dive file, the files
   * inside when it is an archive. Never the whole upload in memory unless it is one file of a dive file's size.
   */
  async function openUpload(key: string, name: string): Promise<{ archive: boolean; each(visit: (file: UploadedFile) => Promise<void>): Promise<void> }> {
    if (looksLikeZip(await blobs.head(key, 4))) return { archive: true, each: (visit) => eachFile(blobs.pathOf(key), visit) };
    if ((await blobs.sizeOf(key)) > DEFAULT_LIMITS.maxEntryBytes) throw new UnsupportedFileError();
    const data = await blobs.read(key);
    if (!formatOf(formats, data)) throw new UnsupportedFileError();
    return { archive: false, each: (visit) => visit({ index: 0, name, read: async () => data }) };
  }

  /**
   * The User's answer to a waiting Import: these kinds of dive are imported, the others left out. Null when there is no
   * such Import of this User's waiting, or it found none of the kinds.
   */
  async function startImport(userId: string, importId: string, kinds: readonly DiveKind[]) {
    return db.transaction(async (tx) => {
      const [waiting] = await tx.select().from(importJob)
        .where(and(eq(importJob.id, importId), eq(importJob.userId, userId), eq(importJob.status, 'awaiting_choice'))).for('update');
      const wanted = DIVE_KINDS.filter((k) => kinds.includes(k) && (waiting?.found?.[k] ?? 0) > 0);
      if (!waiting || wanted.length === 0) return null;
      const [started] = await tx.update(importJob).set({ status: 'pending', kinds: wanted }).where(eq(importJob.id, importId)).returning();
      await tx.execute(sql`select graphile_worker.add_job(${PROCESS_IMPORT_TASK}, json_build_object('importId', ${importId}::text))`);
      return started!;
    });
  }

  /** Ends a waiting Import and removes its upload; nothing of it was written. Null when this User has no such Import. */
  async function cancelImport(userId: string, importId: string) {
    const [cancelled] = await endWaiting(and(eq(importJob.id, importId), eq(importJob.userId, userId))!, null);
    return cancelled ?? null;
  }

  /** Worker task: Imports nobody answered for seven days are ended, so no upload lies here for good. Returns how many. */
  async function expireWaiting(now = new Date()): Promise<number> {
    return (await endWaiting(lt(importJob.createdAt, new Date(now.getTime() - CHOICE_WAIT_DAYS * 86_400_000)), 'choice_expired')).length;
  }

  async function endWaiting(which: SQL, error: 'choice_expired' | null) {
    const waiting = await db.select({ id: importJob.id, key: importJob.uploadStorageKey }).from(importJob)
      .where(and(eq(importJob.status, 'awaiting_choice'), which));
    const ended: (typeof importJob.$inferSelect)[] = [];
    for (const w of waiting) {
      // Only what still waits: a start that came first wins, and its upload stays.
      const [row] = await db.update(importJob).set({ status: 'cancelled', error, finishedAt: new Date(), uploadStorageKey: null })
        .where(and(eq(importJob.id, w.id), eq(importJob.status, 'awaiting_choice'))).returning();
      if (!row) continue;
      if (w.key) await blobs.delete(w.key);
      ended.push(row);
    }
    return ended;
  }

  /** Stores one dive file and places its Recordings of the chosen kinds. A file is kept only once a dive was read from it (ADR 0044). */
  async function processFile(userId: string, importId: string, file: FileToPlace, actor: Actor, chosen: ReadonlySet<DiveKind>): Promise<ImportOutcome> {
    const format = formatOf(formats, file.data);
    if (!format) throw new UnsupportedFileError();
    const parsed = (await format.parse(file.data)).filter((rec) => chosen.has(kindOf(rec)));
    if (parsed.length === 0) return [];
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

  return { createImport, processImport, startImport, cancelImport, expireWaiting, backfillPositions };
}

export type ImportService = ReturnType<typeof createImportService>;
