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
