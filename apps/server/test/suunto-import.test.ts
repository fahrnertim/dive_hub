// Suunto files through the import pipeline against PostgreSQL (ADR 0037; docs/spec/data-model.md, scenario 1): the same
// dive from a Garmin and a Suunto on one Dive, the JSON replacing the FIT's Recording, re-imports, zips, an unknown Device,
// and the dive assessment on a Suunto Recording. Skipped when no database is reachable.
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import yazl from 'yazl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssessmentService, read as readAssessment } from '../src/assessment/assessment-service.js';
import type { Db } from '../src/db/client.js';
import { device, dive, duplicateCandidate, original, recording, recordingEvent, revision, sampleSeries } from '../src/db/schema.js';
import { createImportService, type ImportService } from '../src/imports/import-service.js';
import { createLocalBlobStore } from '../src/storage/blob-store.js';
import { makeSuuntoAppFit, makeSuuntoJson, type SuuntoDiveOptions } from './fixtures/suunto-dive.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { createTestAuth, createTestDatabase, createUser, databaseReachable, type TestDatabase } from './support.js';

const zipOf = (entries: Record<string, Uint8Array>): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, data] of Object.entries(entries)) zip.addBuffer(Buffer.from(data), name);
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });

type Outcome = { fileName: string; result: string; reason?: string; diveId?: string; recordingId?: string }[];

describe.skipIf(!(await databaseReachable()))('Suunto files through the import pipeline (PostgreSQL)', () => {
  let t: TestDatabase;
  let db: Db;
  let pool: pg.Pool;
  let imports: ImportService;
  let tim: string;
  let bob: string;

  const runImport = async (name: string, data: Uint8Array, userId = tim) => {
    const created = await imports.createImport(userId, name, Readable.from([Buffer.from(data)]), 1 << 26);
    await imports.processImport(created.id);
    const [{ outcome, status }] = (await pool.query('select outcome, status from import where id = $1', [created.id])).rows;
    expect(status).toBe('done');
    return outcome as Outcome;
  };
  const recordingsOf = (diveId: string) => db.select().from(recording).where(eq(recording.diveId, diveId));
  const day = (d: number, time = '09:00:00.280') => new Date(`2026-03-${String(d).padStart(2, '0')}T${time}Z`);

  beforeAll(async () => {
    t = await createTestDatabase();
    ({ db, pool } = t);
    const auth = createTestAuth(db);
    tim = (await createUser(auth, 'tim@example.com')).id;
    bob = (await createUser(auth, 'bob@example.com')).id;
    const assessments = createAssessmentService(db);
    imports = createImportService({ db, blobs: createLocalBlobStore(t.dataDir), afterImport: (userId) => assessments.refreshUser(userId) });
  });

  afterAll(async () => {
    await t?.drop();
  });

  describe('a Suunto JSON export by itself', () => {
    const options: SuuntoDiveOptions = { start: day(1), serialNumber: '900000000001' };
    let diveId: string;
    let recordingId: string;

    it('becomes a Dive with a Recording, its Device, its channels and its events', async () => {
      const [result] = await runImport('ScubaDiving_2026-03-01T16_00_00.json', makeSuuntoJson(options));
      expect(result).toMatchObject({ result: 'created' });
      ({ diveId, recordingId } = result as { diveId: string; recordingId: string });
      const [d] = await db.select().from(dive).where(eq(dive.id, diveId));
      // The offset is the file's (+01:00), whatever the file's name says; Suunto's number in a series is no dive number.
      expect(d).toMatchObject({ utcOffsetSeconds: 3600, utcOffsetSource: 'device', number: null, primaryRecordingId: recordingId });
      expect(d!.maxDepthM).toBeCloseTo(21.49, 2);
      const [rec] = await recordingsOf(diveId);
      expect(rec).toMatchObject({ parser: 'suunto-json', parserVersion: '1', recordingKey: `suunto:900000000001:${Math.floor(day(1).getTime() / 1000)}` });
      expect(rec!.summary).toMatchObject({ decoModel: 'suunto_fused2_rgbm', sacLpm: 17.5, gases: [{ o2: 32, tankVolumeL: 12 }] });
      const [dev] = await db.select().from(device).where(eq(device.id, rec!.deviceId!));
      expect(dev).toMatchObject({ manufacturer: 'suunto', serialNumber: '900000000001', product: 'Suunto D5', firmware: '3.0.1' });
      const channels = (await db.select().from(sampleSeries).where(eq(sampleSeries.recordingId, recordingId))).map((s) => s.channel).sort();
      expect(channels).toEqual(['ceiling', 'depth', 'ndl', 'tankPressure', 'temperature', 'tts']);
      expect((await db.select().from(recordingEvent).where(eq(recordingEvent.recordingId, recordingId))).length).toBeGreaterThan(10);
      const [o] = await db.select().from(original).where(eq(original.id, rec!.originalId));
      expect(o).toMatchObject({ mediaType: 'application/json', fileName: 'ScubaDiving_2026-03-01T16_00_00.json' });
    });

    it('is assessed: the profile rules on 10 s samples, the computer\'s events beside', async () => {
      const [d] = await db.select().from(dive).where(eq(dive.id, diveId));
      const a = await readAssessment(db, d!);
      expect(a).toMatchObject({ current: true, applies: true, recordingId, sampleIntervalS: 10 });
      expect(a.findings).toEqual([]);
      expect(a.computerEvents.map((e) => e.event)).toEqual([
        'ascent_critical', 'safety_stop_mandatory', 'deep_stop_started', 'deep_stop_broken', 'safety_stop_started', 'tank_pressure_low',
      ]);
    });

    it('is unchanged when the same file comes again', async () => {
      expect(await runImport('again.json', makeSuuntoJson(options))).toEqual([expect.objectContaining({ result: 'unchanged', recordingId })]);
    });

    it('is updated in place when the app exports it differently', async () => {
      const log = JSON.parse(new TextDecoder().decode(makeSuuntoJson(options))) as { DeviceLog: { Header: { Diving: { Conservatism: number } } } };
      log.DeviceLog.Header.Diving.Conservatism = 2;
      const [result] = await runImport('re-export.json', new TextEncoder().encode(JSON.stringify(log)));
      expect(result).toMatchObject({ result: 'updated', recordingId, diveId });
      expect((await recordingsOf(diveId))[0]!.summary.conservatism).toBe(2);
      expect(await recordingsOf(diveId)).toHaveLength(1);
    });

    it('is not another User\'s to import: the Device belongs to a Diver they don\'t manage', async () => {
      const later = makeSuuntoJson({ start: day(1, '14:00:00.000'), serialNumber: '900000000001' });
      expect(await runImport('theirs.json', later, bob)).toEqual([expect.objectContaining({ result: 'skipped', reason: 'not_your_diver' })]);
    });
  });

  describe('the FIT and the JSON of one dive', () => {
    it('the JSON replaces the FIT\'s Recording in place: one Dive, one Recording, both Originals kept', async () => {
      const options: SuuntoDiveOptions = { start: day(2), serialNumber: '900000000001' };
      const [first] = await runImport('dive.fit', makeSuuntoAppFit(options));
      expect(first).toMatchObject({ result: 'created' });
      const [thin] = await recordingsOf(first!.diveId!);
      expect(thin).toMatchObject({ parser: 'fit-file-parser', deviceId: null });
      expect(thin!.recordingKey).toMatch(/^suunto:fit:/);

      const [second] = await runImport('dive.json', makeSuuntoJson(options));
      expect(second).toMatchObject({ result: 'updated', recordingId: first!.recordingId, diveId: first!.diveId });
      const recs = await recordingsOf(first!.diveId!);
      expect(recs).toHaveLength(1);
      expect(recs[0]).toMatchObject({ parser: 'suunto-json', recordingKey: `suunto:900000000001:${Math.floor(day(2).getTime() / 1000)}` });
      expect(recs[0]!.deviceId).not.toBeNull();
      expect(recs[0]!.originalId).not.toBe(thin!.originalId);
      expect(await db.select().from(original).where(eq(original.id, thin!.originalId))).toHaveLength(1);
      const channels = (await db.select().from(sampleSeries).where(eq(sampleSeries.recordingId, recs[0]!.id))).map((s) => s.channel);
      expect(channels).toContain('tankPressure');
      // The Dive follows its Primary recording, and the change is in the Recording's history.
      const [d] = await db.select().from(dive).where(eq(dive.id, first!.diveId!));
      expect(d!.startsAt.toISOString()).toBe(day(2).toISOString());
      const history = await db.select().from(revision).where(eq(revision.entityId, recs[0]!.id));
      expect(history.map((r) => r.cause)).toContain('reimport');

      // The FIT again, now that the JSON is here: nothing changes, and it says why.
      expect(await runImport('dive-again.fit', makeSuuntoAppFit(options))).toEqual([
        expect.objectContaining({ result: 'skipped', reason: 'fuller_copy_here', recordingId: first!.recordingId, diveId: first!.diveId }),
      ]);
      expect(await recordingsOf(first!.diveId!)).toHaveLength(1);
    });

    it('the FIT after the JSON changes nothing', async () => {
      const options: SuuntoDiveOptions = { start: day(3), serialNumber: '900000000001' };
      const [first] = await runImport('dive.json', makeSuuntoJson(options));
      expect(first).toMatchObject({ result: 'created' });
      expect(await runImport('dive.fit', makeSuuntoAppFit(options))).toEqual([
        expect.objectContaining({ result: 'skipped', reason: 'fuller_copy_here', recordingId: first!.recordingId }),
      ]);
      const recs = await recordingsOf(first!.diveId!);
      expect(recs).toHaveLength(1);
      expect(recs[0]!.parser).toBe('suunto-json');
    });

    it('both in one zip, with a file that is neither, end in one Recording', async () => {
      const options: SuuntoDiveOptions = { start: day(4), serialNumber: '900000000001' };
      const archive = await zipOf({
        'export/a.fit': makeSuuntoAppFit(options), 'export/b.json': makeSuuntoJson(options),
        'export/settings.json': new TextEncoder().encode('{"theme":"dark"}'), 'export/readme.txt': new TextEncoder().encode('x'),
      });
      const outcome = await runImport('suunto.zip', archive);
      expect(outcome.map((o) => [o.fileName, o.result])).toEqual([['a.fit', 'created'], ['b.json', 'updated']]);
      expect(await recordingsOf(outcome[0]!.diveId!)).toHaveLength(1);
    });

    it('a FIT-only dive has no Device and goes to the User\'s own Diver; a buddy\'s same-second dive is its own', async () => {
      const [mine] = await runImport('mine.fit', makeSuuntoAppFit({ start: day(5), maxDepthM: 18 }));
      expect(mine).toMatchObject({ result: 'created' });
      expect((await recordingsOf(mine!.diveId!))[0]!.deviceId).toBeNull();
      // Bob's D5 started in the same second: his own Dive, not a clash of keys.
      const [his] = await runImport('his.fit', makeSuuntoAppFit({ start: day(5), maxDepthM: 17.2 }), bob);
      expect(his).toMatchObject({ result: 'created' });
      expect(his!.diveId).not.toBe(mine!.diveId);
    });
  });

  describe('the same dive from a Garmin and a Suunto (scenario 1)', () => {
    it('attaches the Suunto Recording to the Garmin\'s Dive, which stays primary', async () => {
      const [garmin] = await runImport('garmin.fit', makeSyntheticDive({ start: new Date('2026-03-10T09:00:00Z'), maxDepthM: 21.2, serialNumber: 7001 }));
      expect(garmin).toMatchObject({ result: 'created' });
      const [suunto] = await runImport('suunto.json', makeSuuntoJson({ start: day(10, '09:00:20.280'), serialNumber: '900000000001' }));
      expect(suunto).toMatchObject({ result: 'attached', diveId: garmin!.diveId });
      const [d] = await db.select().from(dive).where(eq(dive.id, garmin!.diveId!));
      expect(d!.primaryRecordingId).toBe(garmin!.recordingId);
      expect((await recordingsOf(garmin!.diveId!)).map((r) => r.parser).sort()).toEqual(['fit-file-parser', 'suunto-json']);
    });

    it('still attaches when the Suunto\'s clock is three minutes off, and keeps its own start time', async () => {
      const [garmin] = await runImport('garmin.fit', makeSyntheticDive({ start: new Date('2026-03-11T09:00:00Z'), maxDepthM: 21.2, serialNumber: 7001 }));
      const start = day(11, '09:03:00.280');
      const [suunto] = await runImport('suunto.json', makeSuuntoJson({ start, serialNumber: '900000000001' }));
      expect(suunto).toMatchObject({ result: 'attached', diveId: garmin!.diveId });
      const [rec] = await db.select().from(recording).where(eq(recording.id, suunto!.recordingId!));
      expect(rec!.startsAt.toISOString()).toBe(start.toISOString());
    });

    it('still attaches when the Suunto\'s clock is so far off that the dives only meet within the tolerance', async () => {
      // The Garmin's dive ends at 09:30; the Suunto says it started at 09:33.
      const [garmin] = await runImport('garmin.fit', makeSyntheticDive({ start: new Date('2026-03-12T09:00:00Z'), maxDepthM: 21.2, serialNumber: 7001 }));
      const [suunto] = await runImport('suunto.json', makeSuuntoJson({ start: day(12, '09:33:00.280'), serialNumber: '900000000001' }));
      expect(suunto).toMatchObject({ result: 'attached', diveId: garmin!.diveId });
    });

    it('makes a Duplicate candidate of one Suunto Recording that overlaps two Dives', async () => {
      // The Garmin has two dives with a surface break longer than the matching tolerance; the Suunto recorded one dive.
      const [first] = await runImport('one.fit', makeSyntheticDive({ start: new Date('2026-03-13T09:00:00Z'), durationSeconds: 10 * 60, maxDepthM: 21.2, serialNumber: 7001 }));
      const [second] = await runImport('two.fit', makeSyntheticDive({ start: new Date('2026-03-13T09:17:00Z'), durationSeconds: 12 * 60, maxDepthM: 21.2, serialNumber: 7001 }));
      expect([first!.result, second!.result]).toEqual(['created', 'created']);
      const [suunto] = await runImport('suunto.json', makeSuuntoJson({ start: day(13), serialNumber: '900000000001' }));
      expect(suunto).toMatchObject({ result: 'duplicate-candidate', reason: 'overlaps_several_dives' });
      const [candidate] = await db.select().from(duplicateCandidate).where(eq(duplicateCandidate.recordingId, suunto!.recordingId!));
      expect([...candidate!.candidateDiveIds].sort()).toEqual([first!.diveId!, second!.diveId!].sort());
      const [rec] = await db.select().from(recording).where(eq(recording.id, suunto!.recordingId!));
      expect(rec!.diveId).toBeNull();
    });

    it('a Suunto arriving first is primary; the Garmin attaches to its Dive', async () => {
      const [suunto] = await runImport('suunto.fit', makeSuuntoAppFit({ start: day(14) }));
      const [garmin] = await runImport('garmin.fit', makeSyntheticDive({ start: new Date('2026-03-14T09:00:30Z'), maxDepthM: 21.2, serialNumber: 7001 }));
      expect(garmin).toMatchObject({ result: 'attached', diveId: suunto!.diveId });
    });
  });

  describe('what an Import reports', () => {
    it('a zip without a dive file says so in the new word', async () => {
      const archive = await zipOf({ 'notes.txt': new TextEncoder().encode('x'), 'other.json': new TextEncoder().encode('{"a":1}') });
      expect(await runImport('nothing.zip', archive)).toEqual([expect.objectContaining({ result: 'skipped', reason: 'no_dive_file' })]);
    });

    it('a JSON file that is no Suunto log is an unsupported file', async () => {
      const created = await imports.createImport(tim, 'other.json', Readable.from([Buffer.from('{"a":1}')]), 1 << 20);
      await expect(imports.processImport(created.id)).rejects.toThrow(/Unsupported file/);
      const [{ status, error }] = (await pool.query('select status, error from import where id = $1', [created.id])).rows;
      expect([status, error]).toEqual(['failed', 'unsupported_file']);
    });

    it('a Suunto log cut off in the middle fails as that file, not as the Import', async () => {
      const broken = makeSuuntoJson({ start: day(20) }).slice(0, 4000);
      expect(await runImport('broken.json', broken)).toEqual([expect.objectContaining({ result: 'failed', reason: 'file_failed' })]);
    });
  });
});
