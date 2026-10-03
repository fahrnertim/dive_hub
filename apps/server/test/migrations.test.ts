// A migration that changes after a database applied it never runs again there, so the server
// reports it at start (it happened in slice 5: a dev server applied 0004 before its data step was added).
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findChangedMigrations } from '../src/db/migrate.js';
import { createTestDatabase, databaseReachable, type TestDatabase } from './support.js';

const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));

describe.skipIf(!(await databaseReachable()))('applied migrations', () => {
  let t: TestDatabase;
  let copy: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    copy = await mkdtemp(join(tmpdir(), 'divehub-migrations-'));
    await cp(migrations, copy, { recursive: true });
  });
  afterAll(async () => {
    await t?.drop();
    if (copy) await rm(copy, { recursive: true, force: true });
  });

  it('match their files when nothing changed', async () => {
    expect(await findChangedMigrations(t.pool, migrations)).toEqual([]);
  });

  it('are reported by name when a file changed after it was applied', async () => {
    await appendFile(join(copy, '0002_password_reset.sql'), '\n-- an edit made after the fact\n');
    expect(await findChangedMigrations(t.pool, copy)).toEqual(['0002_password_reset']);
  });
});
