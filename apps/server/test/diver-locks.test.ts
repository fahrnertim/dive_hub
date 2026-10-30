// Deleting or merging away an external Diver while a Dive takes it as a Participant: the two lock the Diver row, so
// no Participant is left pointing at a deleted Diver. Another connection holds the row to make the old race happen.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { user } from '../src/db/auth-schema.js';
import { dive, diver, diverManagement } from '../src/db/schema.js';
import { createDiverService } from '../src/divers/diver-service.js';
import { createDiveService } from '../src/dives/dive-service.js';
import { createTestDatabase, databaseReachable, listenToNoChanges, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('Diver locks', () => {
  let t: TestDatabase;
  let userId: string;
  let ownDiver: string;

  beforeAll(async () => {
    listenToNoChanges();
    t = await createTestDatabase();
    userId = (await t.db.insert(user).values({ name: 'ann', email: 'ann@example.com' }).returning({ id: user.id }))[0]!.id;
    ownDiver = (await t.db.insert(diver).values({ name: 'Ann' }).returning({ id: diver.id }))[0]!.id;
    await t.db.insert(diverManagement).values({ userId, diverId: ownDiver, isOwn: true });
  });
  afterAll(async () => { await t?.drop(); });

  const external = async (name: string) =>
    (await t.db.insert(diver).values({ name, createdBy: userId }).returning({ id: diver.id }))[0]!.id;
  const newDive = async () => (await t.db.insert(dive).values({
    diverId: ownDiver, startsAt: new Date(Date.UTC(2026, 1, 10, 10)), durationSeconds: 2700,
  }).returning({ id: dive.id, version: dive.version }))[0]!;

  /** Sessions of this database waiting for a lock. */
  async function waitingForLocks(n: number) {
    for (let i = 0; i < 400; i++) {
      const { rows } = await t.pool.query<{ n: number }>(
        "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");
      if (rows[0]!.n >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`fewer than ${n} sessions wait for a lock`);
  }

  /**
   * Holds the Diver row (as an update of its columns would) while `slow` runs into it, then runs `fast`, then lets go.
   * Before the locks, `slow` had passed its checks and `fast` slipped in between.
   */
  async function race(diverId: string, slow: () => Promise<unknown>, fast: () => Promise<unknown>) {
    const holder = await t.pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select 1 from diver where id = $1 for no key update', [diverId]);
      const first = slow().catch((error: unknown) => error);
      await waitingForLocks(1);
      const second = fast().catch((error: unknown) => error);
      await Promise.race([second, waitingForLocks(2)]);
      await holder.query('commit');
      return [await first, await second];
    } finally {
      holder.release();
    }
  }

  const participantsOfDeletedDivers = async () => (await t.db.execute<{ n: number }>(sql`
    select count(*)::int as n from participant p join diver d on d.id = p.diver_id where d.deleted_at is not null`)).rows[0]!.n;

  it('deleting an external Diver and adding it to a Dive never leave a Participant of a deleted Diver', async () => {
    const buddy = await external('Ben');
    const d = await newDive();
    await race(
      buddy,
      () => createDiverService(t.db).removeExternal({ userId, isAdmin: false }, buddy),
      () => createDiveService(t.db).setParticipants(userId, d.id, d.version, [{ diverId: buddy, role: 'buddy' }]),
    );
    expect(await participantsOfDeletedDivers()).toBe(0);
  });

  it('merging an external Diver away and adding it to a Dive never leave a Participant of a deleted Diver', async () => {
    const from = await external('Cem');
    const into = await external('Cem K.');
    const d = await newDive();
    await race(
      from,
      () => createDiverService(t.db).mergeExternal(userId, from, into),
      () => createDiveService(t.db).setParticipants(userId, d.id, d.version, [{ diverId: from, role: 'buddy' }]),
    );
    expect(await participantsOfDeletedDivers()).toBe(0);
  });
});
