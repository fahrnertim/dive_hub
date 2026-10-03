import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The auth secret signs session cookies. Operators may set DIVEHUB_AUTH_SECRET; otherwise one is
 * generated on first start and kept in the data directory, so a fresh install needs no extra step.
 */
export async function loadAuthSecret(configured: string | undefined, dataDir: string): Promise<string> {
  if (configured) return configured;
  const file = join(dataDir, 'auth-secret');
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dataDir, { recursive: true });
  const secret = randomBytes(32).toString('base64url');
  // 'wx' fails if another process created the file meanwhile; then use theirs.
  await writeFile(file, `${secret}\n`, { flag: 'wx', mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  return (await readFile(file, 'utf8')).trim();
}
