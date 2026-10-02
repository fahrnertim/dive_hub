import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(databaseUrl: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // An idle client losing its connection must not crash the process; the pool replaces it.
  pool.on('error', (error) => console.error('PostgreSQL pool error', error));
  return { db: drizzle(pool, { schema }), pool };
}
