// An Oceanic+ logbook export through the import pipeline (docs/references/oceanic-plus.md): the bare UDDF file and the
// app's zip with it in `exports/` are the same dives, and coming again changes nothing.
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { cylinder, dive, duplicateCandidate, importJob, recording } from '../src/db/schema.js';
import { createImportService, type ImportService } from '../src/imports/import-service.js';
import { createLocalBlobStore } from '../src/storage/blob-store.js';
import { makeOceanicPlusUddf } from './fixtures/oceanic-plus-uddf.js';
import { createTestAuth, createTestDatabase, createUser, databaseReachable, listenToNoChanges, type TestDatabase } from './support.js';
import { zipOf } from './zip.js';

const exported = readFileSync(new URL('../../web/e2e/fixtures/oceanic-plus.uddf', import.meta.url));

describe.skipIf(!(await databaseReachable()))('an Oceanic+ export through the import pipeline (PostgreSQL)', () => {
  let t: TestDatabase;
  let db: Db;
  let imports: ImportService;
  let alice: string;

  /** Uploads, chooses both kinds when asked (the export holds scuba dives and a breath-hold session), and processes. */
  const upload = async (name: string, data: Buffer) => {
    const created = await imports.createImport(alice, name, Readable.from([data]), 1 << 26);
    await imports.processImport(created.id);
    if ((await importOf(created.id)).status === 'awaiting_choice') {
      await imports.startImport(alice, created.id, ['scuba', 'apnea']);
      await imports.processImport(created.id);
    }
    return importOf(created.id);
  };
  const importOf = async (id: string) => (await db.select().from(importJob).where(eq(importJob.id, id)))[0]!;
  const divesAndCylinders = async () => ({
    dives: (await db.select().from(dive)).map(({ updatedAt: _, ...d }) => d).sort((a, b) => a.id.localeCompare(b.id)),
    cylinders: (await db.select().from(cylinder)).sort((a, b) => a.diveId.localeCompare(b.diveId) || a.position - b.position),
  });

  beforeAll(async () => {
    t = await createTestDatabase();
    db = t.db;
    alice = (await createUser(createTestAuth(db), 'alice@example.com')).id;
    imports = createImportService({ db, blobs: createLocalBlobStore(t.dataDir) });
    listenToNoChanges();
  });

  afterAll(async () => { await t?.drop(); });

  it('imports the file: three scuba dives and one breath-hold session, keyed by the app\'s dive ids', async () => {
    const done = await upload('logbook.uddf', exported);
    expect(done).toMatchObject({ status: 'done', found: { scuba: 3, apnea: 1, otherFiles: 0 } });
    expect(done.outcome.map((o) => o.result)).toEqual(['created', 'created', 'created', 'created']);
    const recs = await db.select().from(recording);
    expect(recs.map((r) => r.recordingKey).every((k) => /^oceanicplus:[0-9a-f]{24}$/.test(k))).toBe(true);
    const apnea = recs.filter((r) => r.summary.diveMode === 'apnea');
    expect(apnea).toHaveLength(1);
    expect(await db.select().from(dive)).toHaveLength(4);
    // A breath-hold session has no tank data: no Cylinder, not a made-up one of air.
    expect(await db.select().from(cylinder).where(eq(cylinder.diveId, apnea[0]!.diveId!))).toEqual([]);
    expect((await db.select().from(cylinder)).map((c) => c.o2).sort()).toEqual([21, 31, 32]);
  });

  it('finds the same dives unchanged when the file comes again', async () => {
    const again = await upload('logbook-again.uddf', exported);
    expect(again.outcome.map((o) => o.result)).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged']);
    expect(await db.select().from(dive)).toHaveLength(4);
  });

  it('finds them by the app\'s dive ids in a later export, whose bytes differ: updated in place, no new dive', async () => {
    const before = await divesAndCylinders();
    const later = await upload('logbook-later.uddf', Buffer.concat([exported, Buffer.from('\n<!-- exported again -->\n')]));
    // A new file is a new source, so its Recordings are refreshed; the Dives read from them stay the same.
    expect(later.outcome.map((o) => o.result)).toEqual(['updated', 'updated', 'updated', 'updated']);
    expect(await divesAndCylinders()).toEqual(before);
  });

  it('reads the app\'s zip as it is, with the file in exports/, and finds the same dives', async () => {
    const before = await divesAndCylinders();
    const done = await upload('export.zip', await zipOf({ 'exports/logbook.uddf': exported }));
    // An archive's entry is shown by its base name, and a zip is a new file whose Recordings are refreshed in place.
    expect(done.outcome.map((o) => [o.fileName, o.result])).toEqual(Array(4).fill(['logbook.uddf', 'updated']));
    expect(await divesAndCylinders()).toEqual(before);
  });
});

describe.skipIf(!(await databaseReachable()))('two back-to-back Oceanic+ dives from one export (PostgreSQL)', () => {
  let t: TestDatabase;
  let db: Db;
  let imports: ImportService;
  let alice: string;

  const backToBack = makeOceanicPlusUddf([
    {
      id: '0123456789abcdef01234567',
      local: '2023-05-19T10:53:15.000',
      offset: '+00:02',
      waypoints: [[0, 0, undefined], [15, 3.0, 300.15], [90, 18.3, 299.15]],
      greatestDepth: 18.3,
      duration: 1690,
      lowestTemperature: 299.15,
    },
    {
      id: '0123456789abcdef01234568',
      local: '2023-05-19T11:21:27.000',
      offset: '+00:02',
      waypoints: [[0, 0, undefined], [15, 2.5, 300.15], [60, 7.0, 299.65]],
      greatestDepth: 7.0,
      duration: 1562,
      lowestTemperature: 299.65,
    },
  ]);

  beforeAll(async () => {
    t = await createTestDatabase();
    db = t.db;
    alice = (await createUser(createTestAuth(db), 'alice@example.com')).id;
    imports = createImportService({ db, blobs: createLocalBlobStore(t.dataDir) });
    listenToNoChanges();
  });

  afterAll(async () => { await t?.drop(); });

  it('makes two Dives: distinct keys of one Source are two dives, not a duplicate candidate', async () => {
    const created = await imports.createImport(alice, 'logbook.uddf', Readable.from([backToBack]), 1 << 26);
    await imports.processImport(created.id);
    const done = (await db.select().from(importJob).where(eq(importJob.id, created.id)))[0]!;
    expect(done.outcome.map((o) => o.result)).toEqual(['created', 'created']);
    expect(await db.select().from(dive)).toHaveLength(2);
    expect(await db.select().from(duplicateCandidate)).toEqual([]);
  });
});
