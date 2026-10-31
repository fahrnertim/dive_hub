// The PostgreSQL advisory lock the Provider actions share (ADR 0057): the site find-or-make and the buddy list.
import pg from 'pg';
import type { Db } from '../db/client.js';
import { LeaseBusy, MAX_WAIT_MS, POLL_MS, type Clock } from './lease-service.js';

/**
 * Runs `fn` holding a PostgreSQL advisory lock on `key`, on a connection of its own and outside any transaction: one
 * holder per key at a time in every app process (keys such as a site's find-or-make, which can't be undone at the
 * Provider, or an account's buddy list). The lock goes with the session, so a crashed process leaves none behind. A
 * waiter holds no connection: it tries the lock, gives the connection back and looks again every POLL_MS, for up to
 * MAX_WAIT_MS (then LeaseBusy). The holder keeps its one connection until `fn` ends. Needs a pool: on a single Client advisory locks are re-entrant per
 * session and would exclude nothing.
 */
export async function locked<T>(db: Db, key: string, source: string, clock: Clock, fn: () => Promise<T>): Promise<T> {
  const client = (db as Db & { $client: unknown }).$client;
  if (!(client instanceof pg.Pool)) throw new Error('The advisory lock needs a pg.Pool: advisory locks are re-entrant on a single connection');
  const started = clock.now();
  let session: pg.PoolClient;
  for (;;) {
    const candidate = await client.connect();
    try {
      const { rows } = await candidate.query<{ got: boolean }>('select pg_try_advisory_lock(hashtext($1)) as got', [key]);
      if (rows[0]?.got) { session = candidate; break; }
    } catch (error) {
      candidate.release(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    candidate.release();
    if (clock.now() - started + POLL_MS > MAX_WAIT_MS) throw new LeaseBusy(source);
    await clock.sleep(POLL_MS);
  }
  // A session whose unlock failed may still hold the lock: the pool destroys it instead of handing it out again.
  let broken: Error | undefined;
  const unlock = () =>
    session.query('select pg_advisory_unlock(hashtext($1))', [key]).catch((error: unknown) => {
      broken = error instanceof Error ? error : new Error(String(error));
      return Promise.reject(broken);
    });
  try {
    let result: T;
    try {
      result = await fn();
    } catch (error) {
      await unlock().catch(() => undefined);
      throw error;
    }
    await unlock();
    return result;
  } finally {
    session.release(broken);
  }
}
