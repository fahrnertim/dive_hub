// A migration that changes after a database applied it never runs again there, so the server
// reports it at start (it happened in slice 5: a dev server applied 0004 before its data step was added).
// Migrations that convert data get a test that stops before them, adds old data, then applies them.
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findChangedMigrations, migrateDatabase } from '../src/db/migrate.js';
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

/** A copy of the migrations that ends before `tag`. */
async function migrationsBefore(tag: string) {
  const folder = await mkdtemp(join(tmpdir(), 'divehub-migrations-'));
  await cp(migrations, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === tag));
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}

describe.skipIf(!(await databaseReachable()))('0011 and 0012: the water type moves from the Dive to its site (ADR 0025)', () => {
  let t: TestDatabase;
  let before: string;
  beforeAll(async () => {
    before = await migrationsBefore('0011_site_water_type_ssi_import');
    t = await createTestDatabase({ migrationsFolder: before });
  });
  afterAll(async () => {
    await t?.drop();
    if (before) await rm(before, { recursive: true, force: true });
  });

  it("drops the Dive's water type and its Overrides, keeps the other Overrides and old Revisions, and lets references keep an offer", async () => {
    const q = (sql: string, params: unknown[] = []) => t.pool.query(sql, params);
    const diver = (await q(`insert into diver (name) values ('Erika') returning id`)).rows[0].id as string;
    const dive = (await q(`insert into dive (diver_id, starts_at, duration_seconds, water_type, overrides)
      values ($1, now(), 1800, 'salt', '{waterType,number}') returning id`, [diver])).rows[0].id as string;
    await q(`insert into revision (entity_type, entity_id, actor_type, actor_id, cause, changes)
      values ('dive', $1, 'user', 'u1', 'edit', '{"waterType": {"from": "fresh", "to": "salt"}}')`, [dive]);

    await migrateDatabase(t.db, t.pool, migrations);

    const { rows: [after] } = await q('select overrides from dive where id = $1', [dive]);
    expect(after.overrides).toEqual(['number']);
    const columns = (await q(`select table_name, column_name from information_schema.columns where column_name = 'water_type'`)).rows;
    expect(columns).toEqual([{ table_name: 'dive_site', column_name: 'water_type' }]);
    const { rows: [revision] } = await q('select changes from revision where entity_id = $1', [dive]);
    expect(revision.changes).toEqual({ waterType: { from: 'fresh', to: 'salt' } });

    const site = (await q(`insert into dive_site (name, water_type) values ('Hausreef', 'salt') returning id`)).rows[0].id as string;
    await q(`insert into dive_site_external_id (site_id, source, external_id, provides_data, imported) values ($1, 'ssi', '3314', false, '{"name": "Hausreef"}')`, [site]);
    await expect(q(`insert into dive_site_external_id (site_id, source, external_id, provides_data) values ($1, 'osm', 'node/1', true)`, [site])).rejects.toThrow(/imported_ck/);
    await expect(q(`update dive_site set water_type = 'en13319' where id = $1`, [site])).rejects.toThrow(/water_type_ck/);
  });
});

describe.skipIf(!(await databaseReachable()))('0013: Providers as adapters (ADR 0027)', () => {
  let t: TestDatabase;
  let before: string;
  beforeAll(async () => {
    before = await migrationsBefore('0013_provider_layer');
    t = await createTestDatabase({ migrationsFolder: before });
  });
  afterAll(async () => {
    await t?.drop();
    if (before) await rm(before, { recursive: true, force: true });
  });

  it('drops the old token and password so the Connection signs in again, and renames what Pushes stored', async () => {
    const q = (sql: string, params: unknown[] = []) => t.pool.query(sql, params);
    const user = (await q(`insert into "user" (name, email, email_verified) values ('Erika', 'erika@example.com', true) returning id`)).rows[0].id as string;
    const diver = (await q(`insert into diver (name) values ('Erika') returning id`)).rows[0].id as string;
    const dive = (await q(`insert into dive (diver_id, starts_at, duration_seconds) values ($1, now(), 1800) returning id`, [diver])).rows[0].id as string;
    const conn = (await q(`insert into connection (user_id, diver_id, target, account_id, account_email, keep_signed_in, token, password)
      values ($1, $2, 'ssi', '5012047', 'erika@example.com', true, 'v1.a.b', 'v1.c.d') returning id`, [user, diver])).rows[0].id as string;
    const pushOf = async (state: string, action: string, code: string | null) => (await q(`insert into push (dive_id, connection_id, target, mode, action, state, dive_version, error_code)
      values ($1, $2, 'ssi', 'api', $3, $4, 1, $5) returning id`, [dive, conn, action, state, code])).rows[0].id as string;
    const goneUpdate = await pushOf('failed', 'update', 'ssi_dive_gone');
    const goneDelete = await pushOf('confirmed', 'delete', 'ssi_dive_gone');
    const outage = await pushOf('failed', 'create', 'ssi_unavailable');
    const noSite = await pushOf('failed', 'create', 'ssi_site_missing');

    await migrateDatabase(t.db, t.pool, migrations);

    const { rows: [after] } = await q('select provider, account_label, credentials, state, keep_signed_in from connection where id = $1', [conn]);
    expect(after).toEqual({ provider: 'ssi', account_label: 'erika@example.com', credentials: null, state: 'needs_sign_in', keep_signed_in: false });
    const pushes = Object.fromEntries((await q('select id, provider, error_code, remote_gone from push')).rows.map((r) => [r.id, r]));
    expect(pushes[goneUpdate]).toMatchObject({ provider: 'ssi', error_code: 'provider_dive_gone', remote_gone: true });
    expect(pushes[goneDelete]).toMatchObject({ error_code: null, remote_gone: true });
    expect(pushes[outage]).toMatchObject({ error_code: 'provider_unavailable', remote_gone: false });
    expect(pushes[noSite]).toMatchObject({ error_code: 'provider_site_id_missing' });
    expect((await q(`select 1 from pg_type where typname = 'target'`)).rows).toEqual([]);
  });
});
