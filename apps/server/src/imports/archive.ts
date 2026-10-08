// Unpacks uploaded archives (Garmin "Export Original" zip, account export with nested zips).
// Archives are containers, not Originals: only the files inside are kept (docs/glossary.md).
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

export interface ArchiveLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  maxCompressionRatio: number;
}

export const DEFAULT_LIMITS: ArchiveLimits = {
  // An account export holds every file a watch ever synced, about 6,000 a year (ADR 0044). They are read one at a time.
  maxEntries: 500_000,
  maxEntryBytes: 64 * 1024 * 1024, // a single dive file is far smaller
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxDepth: 3,
  maxCompressionRatio: 200,
};

/** One file inside an archive, handed over while the archive is open. */
export interface ArchiveEntry {
  /** Its place among the archive's files, the same on every walk of the same archive. */
  index: number;
  /** For display only, never a path: the base name, after the names of the nested zips it lies in. */
  name: string;
  sizeBytes: number;
  /** Its bytes; only while the visit of this entry runs. */
  read(): Promise<Buffer>;
}

export class ArchiveLimitError extends Error {}

export function looksLikeZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

/**
 * Visits every file inside the archive at `path`, one after the other, descending into nested zips. Nothing is kept:
 * a visit that wants a file's bytes reads them and lets them go (ADR 0044).
 */
export async function eachFile(path: string, visit: (entry: ArchiveEntry) => Promise<void>, limits = DEFAULT_LIMITS): Promise<void> {
  const state = { entries: 0, totalBytes: 0, index: 0 };
  const tempDir = await mkdtemp(join(tmpdir(), 'divehub-zip-'));
  try {
    await walk(path, '', 1, visit, limits, state, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function walk(
  path: string,
  prefix: string,
  depth: number,
  visit: (entry: ArchiveEntry) => Promise<void>,
  limits: ArchiveLimits,
  state: { entries: number; totalBytes: number; index: number },
  tempDir: string,
): Promise<void> {
  if (depth > limits.maxDepth) throw new ArchiveLimitError('Archive nesting too deep');
  const zip = await yauzl.openPromise(path, { decodeStrings: true, validateEntrySizes: true, strictFileNames: false });
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName.endsWith('/')) continue;
      state.entries++;
      if (state.entries > limits.maxEntries) throw new ArchiveLimitError('Too many files in archive');
      const nestedZip = /\.zip$/i.test(entry.fileName);
      if (entry.uncompressedSize > limits.maxEntryBytes && !nestedZip) continue;
      const ratio = entry.compressedSize > 0 ? entry.uncompressedSize / entry.compressedSize : 0;
      if (ratio > limits.maxCompressionRatio) throw new ArchiveLimitError('Suspicious compression ratio');
      state.totalBytes += entry.uncompressedSize;
      if (state.totalBytes > limits.maxTotalBytes) throw new ArchiveLimitError('Archive too large when unpacked');

      // Never a path: what the zip calls its entries decides nothing about where anything is written.
      const name = prefix + entry.fileName.split(/[\/]/).pop();
      if (nestedZip) {
        // Nested archives can be large: stream them to disk instead of memory.
        const nested = join(tempDir, `${randomUUID()}.zip`);
        await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(nested));
        try {
          await walk(nested, `${name}/`, depth + 1, visit, limits, state, tempDir);
        } finally {
          await rm(nested, { force: true });
        }
        continue;
      }
      await visit({
        index: state.index++, name, sizeBytes: entry.uncompressedSize,
        read: async () => readEntry(await zip.openReadStreamPromise(entry)),
      });
    }
  } finally {
    zip.close();
  }
}

async function readEntry(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
