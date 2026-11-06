// A generic UDDF file through the import pipeline (ADR 0003, ADR 0037): its key is built from the dive's values, so a
// re-export that rounds them differently gets a new key and must still find the same Dive.
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { dive, duplicateCandidate, importJob, recording } from '../src/db/schema.js';
import { createImportService, type ImportService } from '../src/imports/import-service.js';
import { createLocalBlobStore } from '../src/storage/blob-store.js';
import { createTestAuth, createTestDatabase, createUser, databaseReachable, listenToNoChanges, type TestDatabase } from './support.js';

/** A dive from another program: no Device, no tank, keyed by its start, duration and maximum depth. */
const uddf = (maxDepthM: string) => new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?>
<uddf version="3.2.3" xmlns="http://www.streit.cc/uddf/3.2/">
  <generator><name>Some Logbook</name><version>2.1</version></generator>
  <profiledata><repetitiongroup id="rg1"><dive id="d1">
    <informationbeforedive><datetime>2026-05-02T09:30:00+02:00</datetime></informationbeforedive>
    <samples>
      <waypoint><divetime>0</divetime><depth>0</depth></waypoint>
      <waypoint><divetime>900</divetime><depth>${maxDepthM}</depth></waypoint>
      <waypoint><divetime>1800</divetime><depth>0.5</depth></waypoint>
    </samples>
    <informationafterdive><greatestdepth>${maxDepthM}</greatestdepth><diveduration>1800</diveduration></informationafterdive>
  </dive></repetitiongroup></profiledata>
</uddf>`);

describe.skipIf(!(await databaseReachable()))('a generic UDDF file through the import pipeline (PostgreSQL)', () => {
  let t: TestDatabase;
  let db: Db;
  let imports: ImportService;
  let alice: string;

  const runImport = async (name: string, data: Uint8Array) => {
    const created = await imports.createImport(alice, name, Readable.from([data]), 1 << 26);
    await imports.processImport(created.id);
    const done = (await db.select().from(importJob).where(eq(importJob.id, created.id)))[0]!;
    return done.outcome;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    db = t.db;
    alice = (await createUser(createTestAuth(db), 'alice@example.com')).id;
    imports = createImportService({ db, blobs: createLocalBlobStore(t.dataDir) });
    listenToNoChanges();
  });

  afterAll(async () => { await t?.drop(); });

  it('keeps one Dive when a differently-rounded re-export changes its content-derived key', async () => {
    const [first] = await runImport('dive.uddf', uddf('18.5'));
    expect(first).toMatchObject({ result: 'created' });
    const [again] = await runImport('dive-again.uddf', uddf('18.52'));
    expect(again).toMatchObject({ result: 'attached', diveId: first!.diveId });
    expect(await db.select().from(dive).where(eq(dive.id, first!.diveId!))).toHaveLength(1);
    expect(await db.select().from(duplicateCandidate)).toEqual([]);
    const keys = (await db.select().from(recording)).map((r) => r.recordingKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});
