import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { runMigrations as runWorkerMigrations } from 'graphile-worker';
import type { Db } from './client.js';

const MIGRATION_LOCK = 4_242_001;

/**
 * Applies our migrations and Graphile Worker's schema. A PostgreSQL advisory lock ensures only
 * one process migrates when the app and a separate worker start together (ADR 0004).
 */
export async function migrateDatabase(db: Db, pool: pg.Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await migrate(db, {
      migrationsFolder,
    });
    await runWorkerMigrations({ pgPool: pool });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}

/**
 * Applied migrations whose file differs from what the database ran (by Drizzle's hash). An applied
 * migration never runs again, so an edit after the fact silently never reaches that database;
 * the server reports these at start. Typical cause: a dev server migrated a freshly generated file
 * before its hand-written part was added.
 */
export async function findChangedMigrations(pool: pg.Pool, migrationsFolder: string): Promise<string[]> {
  const files = readMigrationFiles({ migrationsFolder });
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  const { rows } = await pool.query<{ hash: string; created_at: string }>('select hash, created_at from drizzle.__drizzle_migrations');
  const applied = new Map(rows.map((r) => [Number(r.created_at), r.hash]));
  return files.flatMap((file, i) => {
    const hash = applied.get(file.folderMillis);
    return hash !== undefined && hash !== file.hash ? [journal.entries[i]!.tag] : [];
  });
}
