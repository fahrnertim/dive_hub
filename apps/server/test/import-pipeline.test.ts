// Integration test of the import pipeline against PostgreSQL (docs/spec/data-model.md, scenario 1).
// Uses a throwaway database on the server from TEST_DATABASE_URL / DATABASE_URL; skipped when unreachable.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import yazl from 'yazl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { dive, original, recording, revision, sampleSeries } from '../src/db/schema.js';
import { DEV_USER_ID, ensureDevUser } from '../src/dev-user.js';
import { createImportService, type ImportService } from '../src/imports/import-service.js';
import { createLocalBlobStore } from '../src/storage/blob-store.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://divehub:divehub-dev@127.0.0.1:5432/divehub';
const dbName = `divehub_test_${process.pid}_${Date.now()}`;

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: baseUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const zipOf = (entries: Record<string, Uint8Array>): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, data] of Object.entries(entries)) zip.addBuffer(Buffer.from(data), name);
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });

describe.skipIf(!(await reachable()))('import pipeline (PostgreSQL)', () => {
  let admin: pg.Client;
  let db: Db;
  let pool: pg.Pool;
  let imports: ImportService;
  let dataDir: string;

  const runImport = async (name: string, data: Uint8Array) => {
    const created = await imports.createImport(DEV_USER_ID, name, Readable.from([Buffer.from(data)]), 1 << 26);
    await imports.processImport(created.id); // what the worker does
    const [{ outcome, status }] = (await pool.query('select outcome, status from import where id = $1', [created.id])).rows;
    expect(status).toBe('done');
    return outcome as { result: string; diveId?: string; recordingId?: string }[];
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(baseUrl);
    url.pathname = `/${dbName}`;
    ({ db, pool } = createDb(url.toString()));
    await migrateDatabase(db, pool, fileURLToPath(new URL('../drizzle', import.meta.url)));
    await ensureDevUser(db);
    dataDir = await mkdtemp(join(tmpdir(), 'divehub-test-'));
    imports = createImportService({ db, blobs: createLocalBlobStore(dataDir) });
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  const garmin = makeSyntheticDive();

  it('creates a Dive with its Recording, samples, Original and Revision', async () => {
    const [result] = await runImport('dive.fit', garmin);
    expect(result).toMatchObject({ result: 'created' });
    const [d] = await db.select().from(dive).where(eq(dive.id, result!.diveId!));
    expect(d).toMatchObject({ number: 42, utcOffsetSeconds: 7200, primaryRecordingId: result!.recordingId });
    expect(d!.maxDepthM).toBeCloseTo(18.5, 2);
    const series = await db.select().from(sampleSeries).where(eq(sampleSeries.recordingId, result!.recordingId!));
    expect(series.map((s) => s.channel).sort()).toEqual(['depth', 'heartRate', 'po2', 'temperature']);
    expect(series.find((s) => s.channel === 'depth')!.values).toHaveLength(901);
    expect(await db.select().from(revision).where(eq(revision.entityId, d!.id))).toHaveLength(1);
    expect(await db.select().from(original)).toHaveLength(1);
    // The upload is gone from incoming/, the Original is stored by hash.
    expect(await readdir(join(dataDir, 'incoming'))).toEqual([]);
  });

  it('recognises the same file again (USB copy vs Export Original) as unchanged', async () => {
    const [result] = await runImport('again.fit', garmin);
    expect(result).toMatchObject({ result: 'unchanged' });
    expect(await db.select().from(dive)).toHaveLength(1);
  });

  it('unpacks a zip with a nested zip and still finds nothing new', async () => {
    const inner = await zipOf({ '123_ACTIVITY.fit': garmin, 'notes.txt': new TextEncoder().encode('x') });
    const outer = await zipOf({ 'DI_CONNECT/UploadedFiles_0_Part1.zip': inner });
    const outcome = await runImport('export.zip', outer);
    expect(outcome).toEqual([expect.objectContaining({ result: 'unchanged' })]);
  });

  it('auto-attaches a backup computer recording of the same dive', async () => {
    const backup = makeSyntheticDive({
      serialNumber: 999, start: new Date('2026-01-15T09:02:00Z'), durationSeconds: 29 * 60, maxDepthM: 18.2,
    });
    const [result] = await runImport('backup.fit', backup);
    expect(result).toMatchObject({ result: 'attached' });
    expect(await db.select().from(dive)).toHaveLength(1);
    const recs = await db.select().from(recording).where(eq(recording.diveId, result!.diveId!));
    expect(recs).toHaveLength(2);
  });

  it('creates a separate Dive for a later dive', async () => {
    const later = makeSyntheticDive({ start: new Date('2026-01-15T13:00:00Z'), diveNumber: 43 });
    const [result] = await runImport('later.fit', later);
    expect(result).toMatchObject({ result: 'created' });
    expect(await db.select().from(dive)).toHaveLength(2);
  });
});
