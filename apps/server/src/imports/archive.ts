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
  maxEntries: 50_000,
  maxEntryBytes: 64 * 1024 * 1024, // a single dive file is far smaller
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxDepth: 3,
  maxCompressionRatio: 200,
};

export interface ExtractedFile {
  name: string;
  data: Buffer;
}

export class ArchiveLimitError extends Error {}

export function looksLikeZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

/** Returns every file inside the archive at `path` that `accepts` recognises by its content, descending into nested zips. */
export async function extractFiles(path: string, accepts: (data: Uint8Array) => boolean, limits = DEFAULT_LIMITS): Promise<ExtractedFile[]> {
  const state = { entries: 0, totalBytes: 0 };
  const tempDir = await mkdtemp(join(tmpdir(), 'divehub-zip-'));
  try {
    return await walk(path, '', 1, accepts, limits, state, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function walk(
  path: string,
  prefix: string,
  depth: number,
  accepts: (data: Uint8Array) => boolean,
  limits: ArchiveLimits,
  state: { entries: number; totalBytes: number },
  tempDir: string,
): Promise<ExtractedFile[]> {
  if (depth > limits.maxDepth) throw new ArchiveLimitError('Archive nesting too deep');
  const zip = await yauzl.openPromise(path, { decodeStrings: true, validateEntrySizes: true, strictFileNames: false });
  const found: ExtractedFile[] = [];
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName.endsWith('/')) continue;
      state.entries++;
      if (state.entries > limits.maxEntries) throw new ArchiveLimitError('Too many files in archive');
      if (entry.uncompressedSize > limits.maxEntryBytes && !/\.zip$/i.test(entry.fileName)) continue;
      const ratio = entry.compressedSize > 0 ? entry.uncompressedSize / entry.compressedSize : 0;
      if (ratio > limits.maxCompressionRatio) throw new ArchiveLimitError('Suspicious compression ratio');
      state.totalBytes += entry.uncompressedSize;
      if (state.totalBytes > limits.maxTotalBytes) throw new ArchiveLimitError('Archive too large when unpacked');

      const name = prefix + entry.fileName.split('/').pop();
      if (/\.zip$/i.test(entry.fileName)) {
        // Nested archives can be large: stream them to disk instead of memory.
        const nested = join(tempDir, `${randomUUID()}.zip`);
        await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(nested));
        found.push(...(await walk(nested, `${name}/`, depth + 1, accepts, limits, state, tempDir)));
        await rm(nested, { force: true });
        continue;
      }
      const data = await readEntry(await zip.openReadStreamPromise(entry));
      if (accepts(data)) found.push({ name, data });
    }
  } finally {
    zip.close();
  }
  return found;
}

async function readEntry(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
