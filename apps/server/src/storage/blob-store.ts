import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface StoredBlob {
  key: string;
  sha256: string;
  sizeBytes: number;
}

export class UploadTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Upload exceeds the limit of ${limitBytes} bytes`);
  }
}

/**
 * Files on a mounted volume (ADR 0004). Originals are content-addressed (`originals/ab/cd/<sha256>`)
 * and never changed; uploads wait in `incoming/` until the worker has processed them.
 * Kept behind this interface so S3-compatible storage can be added later.
 */
export interface BlobStore {
  putIncoming(stream: Readable, maxBytes: number): Promise<StoredBlob>;
  putOriginal(data: Uint8Array): Promise<StoredBlob>;
  read(key: string): Promise<Buffer>;
  /** The first bytes, at most `bytes` of them: enough to tell what a file is without reading it whole. */
  head(key: string, bytes: number): Promise<Buffer>;
  sizeOf(key: string): Promise<number>;
  pathOf(key: string): string;
  delete(key: string): Promise<void>;
}

export function createLocalBlobStore(root: string): BlobStore {
  const pathOf = (key: string) => join(root, ...key.split('/'));

  return {
    pathOf,

    async putIncoming(stream, maxBytes) {
      const key = `incoming/${randomUUID()}`;
      const target = pathOf(key);
      await mkdir(dirname(target), { recursive: true });
      const hash = createHash('sha256');
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) stream.destroy(new UploadTooLargeError(maxBytes));
        else hash.update(chunk);
      });
      try {
        await pipeline(stream, createWriteStream(target, { flags: 'wx' }));
      } catch (error) {
        await rm(target, { force: true });
        throw error;
      }
      return { key, sha256: hash.digest('hex'), sizeBytes: size };
    },

    async putOriginal(data) {
      const sha256 = createHash('sha256').update(data).digest('hex');
      const key = `originals/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
      const target = pathOf(key);
      const exists = await stat(target).then(() => true, () => false);
      if (!exists) {
        await mkdir(dirname(target), { recursive: true });
        const tmp = `${target}.${randomUUID()}.tmp`;
        await pipeline(
          (async function* () { yield data; })(),
          createWriteStream(tmp, { flags: 'wx' }),
        );
        await rename(tmp, target);
      }
      return { key, sha256, sizeBytes: data.byteLength };
    },

    read: (key) => readFile(pathOf(key)),
    async head(key, bytes) {
      const file = await open(pathOf(key), 'r');
      try {
        const { buffer, bytesRead } = await file.read(Buffer.alloc(bytes), 0, bytes, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await file.close();
      }
    },
    sizeOf: async (key) => (await stat(pathOf(key))).size,
    delete: (key) => rm(pathOf(key), { force: true }),
  };
}
