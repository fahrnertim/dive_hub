// An account export through the import pipeline (ADR 0044): thousands of files, a few of them dives. Only the dives are
// kept, the kinds of dive are asked about when there are several, and one Device's Recordings in a row stay apart.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { dive, importJob, original, recording } from '../src/db/schema.js';
import { createImportService, type ImportService } from '../src/imports/import-service.js';
import { createLocalBlobStore } from '../src/storage/blob-store.js';
import { makeSyntheticDive, makeSyntheticRun } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestAuth, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';
import { zipOf } from './zip.js';

const day = (n: number, hour = 9, minute = 0) => new Date(Date.UTC(2026, 2, n, hour, minute));
const buf = (data: Uint8Array) => Buffer.from(data);

describe.skipIf(!(await databaseReachable()))('an account export through the import pipeline (PostgreSQL)', () => {
  let t: TestDatabase;
  let db: Db;
  let imports: ImportService;
  let alice: string;
  let bob: string;

  const upload = async (name: string, data: Uint8Array, userId = alice) => {
    const created = await imports.createImport(userId, name, Readable.from([Buffer.from(data)]), 1 << 26);
    await imports.processImport(created.id); // what the worker does
    return created.id;
  };
  const importOf = async (id: string) => (await db.select().from(importJob).where(eq(importJob.id, id)))[0]!;
  const waitingUploads = () => readdir(join(t.dataDir, 'incoming'));
  const keptFiles = async () => (await readdir(join(t.dataDir, 'originals'), { recursive: true, withFileTypes: true }).catch(() => []))
    .filter((e) => e.isFile()).length;

  /** A small account export: the dives in a nested zip among other activities, with Garmin's JSON around it. */
  const exportOf = async (dives: Record<string, Uint8Array>) => zipOf({
    'customer_data/customer.json': '{"name":"x"}',
    'DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip': await zipOf({
      'diver@example.com_1.fit': buf(makeSyntheticRun()),
      ...Object.fromEntries(Object.entries(dives).map(([name, data]) => [name, buf(data)])),
      'diver@example.com_2.fit': buf(makeSyntheticRun(day(2, 18))),
    }),
    'DI_CONNECT/DI-DIVE/Dive-ACTIVITY1.json': '{"version":"v1","type":"ACTIVITY","data":{}}',
  });

  beforeAll(async () => {
    t = await createTestDatabase();
    db = t.db;
    const auth = createTestAuth(db);
    alice = (await createUser(auth, 'alice@example.com')).id;
    bob = (await createUser(auth, 'bob@example.com')).id;
    imports = createImportService({ db, blobs: createLocalBlobStore(t.dataDir) });
  });

  afterAll(async () => { await t?.drop(); });

  describe('an export with scuba dives only', () => {
    let id: string;
    beforeAll(async () => {
      id = await upload('export.zip', await exportOf({
        'diver@example.com_10.fit': makeSyntheticDive({ start: day(1), diveNumber: 1 }),
        'diver@example.com_11.fit': makeSyntheticDive({ start: day(1, 14), diveNumber: 2 }),
      }));
    });

    it('imports its dives straight away and says how many other files it left out', async () => {
      const done = await importOf(id);
      expect(done).toMatchObject({ status: 'done', found: { scuba: 2, apnea: 0, otherFiles: 4 } });
      expect(done.outcome.map((o) => [o.fileName, o.result])).toEqual([
        ['UploadedFiles_0-_Part1.zip/diver@example.com_10.fit', 'created'],
        ['UploadedFiles_0-_Part1.zip/diver@example.com_11.fit', 'created'],
      ]);
      expect(await db.select().from(dive)).toHaveLength(2);
    });

    it('keeps the dive files as Originals and nothing else', async () => {
      expect(await db.select().from(original)).toHaveLength(2);
      expect(await keptFiles()).toBe(2);
      expect(await waitingUploads()).toEqual([]);
    });

    it('finds the same dives unchanged when the export comes again', async () => {
      const again = await importOf(await upload('export-again.zip', await exportOf({
        'diver@example.com_10.fit': makeSyntheticDive({ start: day(1), diveNumber: 1 }),
        'diver@example.com_11.fit': makeSyntheticDive({ start: day(1, 14), diveNumber: 2 }),
      })));
      expect(again.outcome.map((o) => o.result)).toEqual(['unchanged', 'unchanged']);
      expect(await db.select().from(dive)).toHaveLength(2);
      expect(await keptFiles()).toBe(2);
    });
  });

  describe('a file that is no dive', () => {
    it('uploaded by itself is said to be no dive, and is not kept', async () => {
      const before = await keptFiles();
      const done = await importOf(await upload('run.fit', makeSyntheticRun()));
      expect(done).toMatchObject({ status: 'done', found: { scuba: 0, apnea: 0, otherFiles: 1 } });
      expect(done.outcome).toEqual([{ fileName: 'run.fit', result: 'skipped', reason: 'not_a_dive' }]);
      expect(await keptFiles()).toBe(before);
    });

    it('that is all an export holds: the Import says it found no dive file', async () => {
      const done = await importOf(await upload('no-dives.zip', await exportOf({})));
      expect(done.outcome).toEqual([{ fileName: 'no-dives.zip', result: 'skipped', reason: 'no_dive_file' }]);
      expect(done.found).toEqual({ scuba: 0, apnea: 0, otherFiles: 4 });
    });
  });

  describe('an export with scuba dives and apnea sessions', () => {
    const mixed = () => exportOf({
      'diver@example.com_20.fit': makeSyntheticDive({ start: day(5), diveNumber: 3 }),
      'diver@example.com_21.fit': makeSyntheticDive({ start: day(6), durationSeconds: 14 * 60, maxDepthM: 4.8, subSport: 'apneaDiving' }),
      'diver@example.com_22.fit': makeSyntheticDive({ start: day(7), durationSeconds: 6 * 60, maxDepthM: 4.3, subSport: 'apneaDiving' }),
    });

    it('waits for the User and says how many of each kind it found; nothing is written yet', async () => {
      const [dives, kept] = [await db.select().from(dive), await keptFiles()];
      const id = await upload('mixed.zip', await mixed());
      const waiting = await importOf(id);
      expect(waiting).toMatchObject({ status: 'awaiting_choice', found: { scuba: 1, apnea: 2, otherFiles: 4 }, outcome: [], kinds: null });
      expect(await db.select().from(dive)).toHaveLength(dives.length);
      expect(await keptFiles()).toBe(kept);
      expect(await waitingUploads()).toHaveLength(1);
      await imports.cancelImport(alice, id);
    });

    it('imports only the kinds the User chose; the others are not kept', async () => {
      const kept = await keptFiles();
      const id = await upload('scuba-only.zip', await mixed());
      expect(await imports.startImport(alice, id, ['scuba'])).toMatchObject({ status: 'pending', kinds: ['scuba'] });
      await imports.processImport(id);
      const done = await importOf(id);
      expect(done).toMatchObject({ status: 'done', kinds: ['scuba'], found: { scuba: 1, apnea: 2, otherFiles: 4 } });
      expect(done.outcome.map((o) => [o.fileName.split('/').pop(), o.result])).toEqual([['diver@example.com_20.fit', 'created']]);
      expect(await keptFiles()).toBe(kept + 1);
      expect((await db.select().from(recording)).filter((r) => r.summary.diveMode === 'apnea')).toEqual([]);
    });

    it('imports every kind when the User chose them all', async () => {
      const id = await upload('everything.zip', await mixed());
      await imports.startImport(alice, id, ['scuba', 'apnea']);
      await imports.processImport(id);
      expect((await importOf(id)).outcome.map((o) => o.result)).toEqual(['unchanged', 'created', 'created']);
      expect((await db.select().from(recording)).filter((r) => r.summary.diveMode === 'apnea')).toHaveLength(2);
    });

    it('starts only for the User it belongs to, once, and with a kind it found', async () => {
      const id = await upload('guarded.zip', await mixed());
      expect(await imports.startImport(bob, id, ['scuba'])).toBeNull();
      expect(await imports.cancelImport(bob, id)).toBeNull();
      expect((await importOf(id)).status).toBe('awaiting_choice');
      expect(await imports.startImport(alice, id, ['scuba'])).toMatchObject({ status: 'pending' });
      expect(await imports.startImport(alice, id, ['apnea'])).toBeNull();
      await imports.processImport(id);
    });

    it('is cancelled by the User: the upload is removed and nothing was written', async () => {
      const id = await upload('cancelled.zip', await mixed());
      const kept = await keptFiles();
      expect(await imports.cancelImport(alice, id)).toMatchObject({ status: 'cancelled' });
      expect(await waitingUploads()).toEqual([]);
      expect(await keptFiles()).toBe(kept);
      expect(await imports.startImport(alice, id, ['scuba'])).toBeNull();
    });

    it('is removed when nobody answers within seven days', async () => {
      const old = await upload('forgotten.zip', await mixed());
      const fresh = await upload('yesterday.zip', await mixed());
      const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
      await db.update(importJob).set({ createdAt: daysAgo(8) }).where(eq(importJob.id, old));
      await db.update(importJob).set({ createdAt: daysAgo(1) }).where(eq(importJob.id, fresh));
      expect(await imports.expireWaiting()).toBe(1);
      expect(await importOf(old)).toMatchObject({ status: 'cancelled', error: 'choice_expired', uploadStorageKey: null });
      expect((await importOf(fresh)).status).toBe('awaiting_choice');
      expect(await waitingUploads()).toHaveLength(1);
      await imports.cancelImport(alice, fresh);
    });
  });

  describe('two Recordings of one Device in a row', () => {
    it('stay two Dives when the second starts three minutes after the first ended', async () => {
      const done = await importOf(await upload('training.zip', await zipOf({
        'a.fit': buf(makeSyntheticDive({ start: day(10, 9, 0), durationSeconds: 7 * 60, maxDepthM: 5.8, diveNumber: 23 })),
        'b.fit': buf(makeSyntheticDive({ start: day(10, 9, 10), durationSeconds: 4 * 60, maxDepthM: 6.2, diveNumber: 24 })),
      })));
      expect(done.outcome.map((o) => o.result)).toEqual(['created', 'created']);
    });

    it('still attach a second computer on the same dive', async () => {
      const done = await importOf(await upload('backup.fit', makeSyntheticDive({
        serialNumber: 999, start: day(10, 9, 13), durationSeconds: 4 * 60, maxDepthM: 6.0,
      })));
      expect(done.outcome.map((o) => o.result)).toEqual(['attached']);
    });
  });

  describe('a dive file that cannot be read', () => {
    it('fails as that file and is not kept; the dives beside it are imported', async () => {
      const kept = await keptFiles();
      const broken = buf(makeSyntheticDive({ start: day(12) })).subarray(0, 400);
      const done = await importOf(await upload('half.zip', await zipOf({ 'broken.fit': broken, 'good.fit': buf(makeSyntheticDive({ start: day(13) })) })));
      expect(done.outcome.map((o) => [o.fileName, o.result, o.reason])).toEqual([['broken.fit', 'failed', 'file_failed'], ['good.fit', 'created', undefined]]);
      expect(await keptFiles()).toBe(kept + 1);
    });
  });
});

describe.skipIf(!(await databaseReachable()))('an Import that waits for a choice, through the API', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let cookie: string;
  let stranger: string;
  const inject = (method: 'GET' | 'POST', url: string, payload?: object, as = cookie) =>
    ctx.app.inject({ method, url, headers: { cookie: as, origin: BASE_URL }, ...(payload && { payload }) });
  const mixedUpload = async () => {
    const { payload, headers } = multipartFile('export.zip', await zipOf({
      'scuba.fit': buf(makeSyntheticDive({ start: day(20) })),
      'apnea.fit': buf(makeSyntheticDive({ start: day(21), durationSeconds: 600, maxDepthM: 5, subSport: 'apneaDiving' })),
      'run.fit': buf(makeSyntheticRun()),
    }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie, origin: BASE_URL } });
    await ctx.imports.processImport(created.json().id);
    return created.json().id as string;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'diver@example.com');
    await createUser(ctx.auth, 'stranger@example.com');
    cookie = await signIn(ctx.app, 'diver@example.com');
    stranger = await signIn(ctx.app, 'stranger@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('says what the upload holds, and imports the kinds it is started with', async () => {
    const id = await mixedUpload();
    expect((await inject('GET', `/api/imports/${id}`)).json()).toMatchObject({
      status: 'awaiting_choice', found: { scuba: 1, apnea: 1, otherFiles: 1 }, kinds: null, outcome: [],
    });
    const started = await inject('POST', `/api/imports/${id}/start`, { kinds: ['apnea'] });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ status: 'pending', kinds: ['apnea'] });
    await ctx.imports.processImport(id);
    const done = (await inject('GET', `/api/imports/${id}`)).json();
    expect(done).toMatchObject({ status: 'done', kinds: ['apnea'], found: { scuba: 1, apnea: 1, otherFiles: 1 } });
    expect(done.outcome).toEqual([expect.objectContaining({ fileName: 'apnea.fit', result: 'created' })]);
    expect((await inject('GET', '/api/dives')).json().total).toBe(1);
  });

  it('refuses a start without a kind, with an unknown kind, twice, or by another User', async () => {
    const id = await mixedUpload();
    expect((await inject('POST', `/api/imports/${id}/start`, { kinds: [] })).statusCode).toBe(400);
    expect((await inject('POST', `/api/imports/${id}/start`, { kinds: ['snorkelling'] })).statusCode).toBe(400);
    const other = await inject('POST', `/api/imports/${id}/start`, { kinds: ['scuba'] }, stranger);
    expect([other.statusCode, other.json().code]).toEqual([409, 'import_not_waiting']);
    expect((await inject('POST', `/api/imports/${id}/cancel`, undefined, stranger)).statusCode).toBe(409);
    expect((await inject('POST', `/api/imports/${id}/start`, { kinds: ['scuba'] })).statusCode).toBe(202);
    expect((await inject('POST', `/api/imports/${id}/start`, { kinds: ['scuba'] })).statusCode).toBe(409);
    await ctx.imports.processImport(id);
  });

  it('is cancelled, and can then not be started', async () => {
    const id = await mixedUpload();
    const cancelled = await inject('POST', `/api/imports/${id}/cancel`);
    expect(cancelled.json()).toMatchObject({ status: 'cancelled', errorCode: null, outcome: [] });
    expect((await inject('POST', `/api/imports/${id}/start`, { kinds: ['scuba'] })).json().code).toBe('import_not_waiting');
  });

  it('says so when it ended because nobody answered', async () => {
    const id = await mixedUpload();
    await t.db.update(importJob).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(importJob.id, id));
    await ctx.imports.expireWaiting();
    expect((await inject('GET', `/api/imports/${id}`)).json()).toMatchObject({ status: 'cancelled', errorCode: 'choice_expired' });
  });
});
