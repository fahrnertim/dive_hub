// Cylinders on a Dive through the HTTP API (ADR 0045, slice 2): set as one list with the Dive's edit, part of its
// version and its history; "same as last dive"; and the Cylinders an import makes from a tank pod's data.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cylinder, revision } from '../src/db/schema.js';
import { makeSuuntoJson } from './fixtures/suunto-dive.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Cylinder = {
  volumeL: number | null; workingPressureBar: number | null; material: string | null; gas: { o2: number; he: number } | null;
  startPressureBar: number | null; endPressureBar: number | null; fromPod: boolean;
  series: { recordingId: string; channel: string } | null;
};
type DiveView = {
  id: string; version: number; cylinders: Cylinder[]; recordings: { id: string }[];
  sac: { litresPerMinute: number; barPerMinute: number | null } | null; sacMissing: string | null;
};
type RevisionView = { cause: string; actor: { type: string }; changes: Record<string, { from: unknown; to: unknown }> };

describe.skipIf(!(await databaseReachable()))('Cylinders on a Dive', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let other: string;

  const inject = (method: 'GET' | 'PATCH' | 'POST', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const getDive = async (id: string, cookie = tim) => (await inject('GET', `/api/dives/${id}`, cookie)).json() as DiveView;
  const history = async (id: string) => (await inject('GET', `/api/dives/${id}/revisions`, tim)).json() as RevisionView[];
  const setCylinders = async (id: string, cylinders: object[], cookie = tim) =>
    inject('PATCH', `/api/dives/${id}`, cookie, { version: (await getDive(id)).version, cylinders });

  async function upload(fileName: string, data: Uint8Array, cookie = tim) {
    const { payload, headers } = multipartFile(fileName, data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(response.json().id);
    const done = (await inject('GET', `/api/imports/${response.json().id}`, cookie)).json();
    return done.outcome[0] as { result: string; diveId: string; recordingId: string };
  }
  const day = (d: number, time = '09:00:00') => new Date(`2026-02-${String(d).padStart(2, '0')}T${time}Z`);
  /** A Dive from a Garmin file: no tank pod. */
  const garminDive = async (d: number, serialNumber = 111) => (await upload(`garmin-${d}.fit`, makeSyntheticDive({ serialNumber, start: day(d) }))).diveId;

  const steel12 = {
    volumeL: 12, workingPressureBar: 232, material: 'steel', gas: { o2: 32, he: 0 }, startPressureBar: 205, endPressureBar: 60,
  };
  const stage = { volumeL: 7, workingPressureBar: 200, material: 'aluminium', gas: { o2: 50, he: 0 }, startPressureBar: 200, endPressureBar: 180 };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'other@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    other = await signIn(ctx.app, 'other@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('typed by the User', () => {
    let diveId: string;
    beforeAll(async () => {
      diveId = await garminDive(1);
    });

    it('a Dive from a file without pod data has none', async () => {
      expect((await getDive(diveId)).cylinders).toEqual([]);
    });

    it('are set as one list with the Dive\'s edit, in their order: the version goes up and the history has one entry', async () => {
      const before = await getDive(diveId);
      const response = await inject('PATCH', `/api/dives/${diveId}`, tim, { version: before.version, cylinders: [steel12, stage] });
      expect(response.statusCode).toBe(200);
      const after = response.json() as DiveView;
      expect(after.version).toBe(before.version + 1);
      expect(after.cylinders).toEqual([
        { ...steel12, fromPod: false, series: null },
        { ...stage, fromPod: false, series: null },
      ]);
      expect((await getDive(diveId)).cylinders).toEqual(after.cylinders);
      const [latest] = await history(diveId);
      expect(latest).toMatchObject({ cause: 'edit', actor: { type: 'user' } });
      expect(latest!.changes).toEqual({ cylinders: { from: [], to: after.cylinders } });
    });

    it('stay when an edit doesn\'t name them, and the same list again changes nothing', async () => {
      const before = await getDive(diveId);
      await inject('PATCH', `/api/dives/${diveId}`, tim, { version: before.version, notes: 'Wreck, good visibility' });
      const noted = await getDive(diveId);
      expect(noted.cylinders).toEqual(before.cylinders);
      const entries = (await history(diveId)).length;
      expect((await setCylinders(diveId, [steel12, stage])).statusCode).toBe(200);
      expect((await getDive(diveId)).version).toBe(noted.version);
      expect(await history(diveId)).toHaveLength(entries);
    });

    it('a value left out is unknown, and an empty list takes them all away', async () => {
      const set = (await setCylinders(diveId, [{ volumeL: 10 }])).json() as DiveView;
      expect(set.cylinders).toEqual([{
        volumeL: 10, workingPressureBar: null, material: null, gas: null, startPressureBar: null, endPressureBar: null, fromPod: false, series: null,
      }]);
      expect(((await setCylinders(diveId, [])).json() as DiveView).cylinders).toEqual([]);
      await setCylinders(diveId, [steel12]);
    });

    it('are refused as a whole when one doesn\'t fit', async () => {
      const refused = async (cylinder: object) => {
        const response = await setCylinders(diveId, [steel12, cylinder]);
        return [response.statusCode, response.json().code];
      };
      expect(await refused({ ...stage, startPressureBar: 50, endPressureBar: 180 })).toEqual([400, 'cylinder_invalid']);
      expect(await refused({ ...stage, gas: { o2: 50, he: 60 } })).toEqual([400, 'cylinder_invalid']);
      expect((await refused({ ...stage, volumeL: -7 }))[0]).toBe(400);
      expect((await refused({ ...stage, material: 'wood' }))[0]).toBe(400);
      expect((await getDive(diveId)).cylinders).toHaveLength(1);
    });

    it('are refused when the Dive changed meanwhile, and for a User who doesn\'t manage its Diver', async () => {
      const { version } = await getDive(diveId);
      const stale = await inject('PATCH', `/api/dives/${diveId}`, tim, { version: version - 1, cylinders: [] });
      expect([stale.statusCode, stale.json().code]).toEqual([409, 'dive_changed']);
      const theirs = await inject('PATCH', `/api/dives/${diveId}`, other, { version, cylinders: [] });
      expect(theirs.statusCode).toBe(404);
      expect((await getDive(diveId)).cylinders).toHaveLength(1);
    });
  });

  describe('made by an import from a tank pod\'s data', () => {
    let diveId: string;
    let recordingId: string;
    const pod = () => ({ recordingId, channel: 'tankPressure' });

    it('a new Dive gets the pod\'s Cylinder: its size, gas and pressures, tied to its series and marked as from the pod', async () => {
      ({ diveId, recordingId } = await upload('suunto.json', makeSuuntoJson({ start: day(3), serialNumber: '900000000001' })));
      const d = await getDive(diveId);
      expect(d.cylinders).toEqual([{
        volumeL: 12, workingPressureBar: null, material: null, gas: { o2: 32, he: 0 },
        startPressureBar: expect.closeTo(200.4, 2), endPressureBar: expect.closeTo(50.1, 2), fromPod: true, series: pod(),
      }]);
      // One entry in the history says the Dive was made, with its Cylinders.
      const entries = await history(diveId);
      expect(entries.filter((e) => e.changes.cylinders)).toHaveLength(1);
      expect(entries.find((e) => e.changes.cylinders)).toMatchObject({ cause: 'import-create', actor: { type: 'import' }, changes: { cylinders: { from: [] } } });
    });

    it('a file without pod data makes none', async () => {
      const { diveId: plain } = await upload('no-pod.json', makeSuuntoJson({ start: day(4), serialNumber: '900000000001', tankPod: false }));
      expect((await getDive(plain)).cylinders).toEqual([]);
    });

    it('the User changes it like any other: it stays from the pod while it keeps the pod\'s series', async () => {
      const [made] = (await getDive(diveId)).cylinders;
      const changed = (await setCylinders(diveId, [{ ...made, workingPressureBar: 232, material: 'steel', series: pod() }])).json() as DiveView;
      expect(changed.cylinders[0]).toMatchObject({ workingPressureBar: 232, material: 'steel', fromPod: true, series: pod() });
      const untied = (await setCylinders(diveId, [{ ...made, series: null }])).json() as DiveView;
      expect(untied.cylinders[0]).toMatchObject({ fromPod: false, series: null });
    });

    it('the same file again, or a re-export, neither adds a Cylinder nor changes one', async () => {
      const before = (await getDive(diveId)).cylinders;
      await upload('again.json', makeSuuntoJson({ start: day(3), serialNumber: '900000000001' }));
      const log = JSON.parse(new TextDecoder().decode(makeSuuntoJson({ start: day(3), serialNumber: '900000000001' })));
      log.DeviceLog.Header.Diving.Conservatism = 2;
      expect(await upload('re-export.json', new TextEncoder().encode(JSON.stringify(log)))).toMatchObject({ result: 'updated', diveId });
      expect((await getDive(diveId)).cylinders).toEqual(before);
    });

    it('a Cylinder is tied to a pressure series of the Dive\'s Recordings only, and each series to one Cylinder', async () => {
      const tie = async (...series: object[]) => {
        const response = await setCylinders(diveId, series.map((s) => ({ ...steel12, series: s })));
        return [response.statusCode, response.json().code];
      };
      expect(await tie({ recordingId, channel: 'depth' })).toEqual([400, 'cylinder_series_not_found']);
      expect(await tie({ recordingId, channel: 'tankPressure:2' })).toEqual([400, 'cylinder_series_not_found']);
      const elsewhere = await upload('other-dive.json', makeSuuntoJson({ start: day(5), serialNumber: '900000000001' }));
      expect(await tie({ recordingId: elsewhere.recordingId, channel: 'tankPressure' })).toEqual([400, 'cylinder_series_not_found']);
      expect(await tie(pod(), pod())).toEqual([400, 'cylinder_invalid']);
      expect((await tie(pod()))[0]).toBe(200);
      // Tied by the User, not made from the pod.
      expect((await getDive(diveId)).cylinders[0]).toMatchObject({ fromPod: false, series: pod() });
    });

    it('a Dive that has Cylinders keeps them when a Recording with pod data attaches; one without gets the pod\'s', async () => {
      const typed = await garminDive(6);
      await setCylinders(typed, [steel12]);
      const attached = await upload('backup-6.json', makeSuuntoJson({ start: day(6), serialNumber: '900000000001' }));
      expect(attached).toMatchObject({ result: 'attached', diveId: typed });
      expect((await getDive(typed)).cylinders).toEqual([{ ...steel12, fromPod: false, series: null }]);

      const bare = await garminDive(7);
      const second = await upload('backup-7.json', makeSuuntoJson({ start: day(7), serialNumber: '900000000001' }));
      expect(second).toMatchObject({ result: 'attached', diveId: bare });
      expect((await getDive(bare)).cylinders).toMatchObject([{ volumeL: 12, fromPod: true, series: { recordingId: second.recordingId, channel: 'tankPressure' } }]);
      expect((await history(bare))[0]).toMatchObject({ cause: 'auto-attach', changes: { cylinders: { from: [] } } });
    });

    it('a Recording split off takes its series along: the Cylinder stays without it, and the new Dive gets the pod\'s', async () => {
      const dived = await garminDive(8);
      const suunto = await upload('backup-8.json', makeSuuntoJson({ start: day(8), serialNumber: '900000000001' }));
      const { version } = await getDive(dived);
      const split = await inject('POST', `/api/recordings/${suunto.recordingId}/detach`, tim, { version });
      expect(split.statusCode).toBe(200);
      expect((await getDive(dived)).cylinders).toMatchObject([{ volumeL: 12, fromPod: false, series: null }]);
      expect((await history(dived))[0]).toMatchObject({ cause: 'detach', changes: { cylinders: { from: [{ fromPod: true }], to: [{ fromPod: false, series: null }] } } });
      const created = (split.json() as { diveId: string }).diveId;
      expect((await getDive(created)).cylinders).toMatchObject([{ fromPod: true, series: { recordingId: suunto.recordingId, channel: 'tankPressure' } }]);
    });
  });

  describe('made by an import without a pressure series', () => {
    /** A Suunto file whose samples carry no pressures; `gas` replaces what its summary says of the one gas. */
    const withoutSeries = (d: number, gas?: object) => {
      const log = JSON.parse(new TextDecoder().decode(makeSuuntoJson({ start: day(d), serialNumber: '900000000007' })));
      for (const sample of log.DeviceLog.Samples) delete sample.Cylinders;
      const gases = log.DeviceLog.Header.Diving.Gases;
      if (gas) gases[0] = { ...Object.fromEntries(Object.entries(gases[0]).filter(([k]) => !/Pressure|TankSize|Transmitter/.test(k))), ...gas };
      return new TextEncoder().encode(JSON.stringify(log));
    };

    it('a tank whose pressures the file only sums up becomes a Cylinder, not tied and not from the pod', async () => {
      const { diveId } = await upload('summed-up.json', withoutSeries(12));
      expect((await getDive(diveId)).cylinders).toEqual([{
        volumeL: 12, workingPressureBar: null, material: null, gas: { o2: 32, he: 0 },
        startPressureBar: expect.closeTo(200.4, 2), endPressureBar: expect.closeTo(50.1, 2), fromPod: false, series: null,
      }]);
      expect((await history(diveId)).find((e) => e.changes.cylinders)).toMatchObject({ cause: 'import-create', actor: { type: 'import' } });
    });

    it('one pressure is enough', async () => {
      const { diveId } = await upload('start-only.json', withoutSeries(13, { StartPressure: 21000000 }));
      expect((await getDive(diveId)).cylinders).toMatchObject([{ volumeL: null, gas: { o2: 32, he: 0 }, startPressureBar: 210, endPressureBar: null }]);
    });

    it('a gas without a pressure makes none, whatever else the computer knows of its tank', async () => {
      const { diveId } = await upload('size-only.json', withoutSeries(14, { TankSize: 0.012 }));
      expect((await getDive(diveId)).cylinders).toEqual([]);
    });
  });

  describe('when a re-export no longer has the pressure series', () => {
    it('the Cylinder stays, without its tie and its mark, and can be changed', async () => {
      const first = await upload('with-pod.json', makeSuuntoJson({ start: day(16), serialNumber: '900000000008' }));
      expect((await getDive(first.diveId)).cylinders).toMatchObject([{ fromPod: true, series: { channel: 'tankPressure' } }]);
      const again = await upload('without-pod.json', makeSuuntoJson({ start: day(16), serialNumber: '900000000008', tankPod: false }));
      expect(again).toMatchObject({ result: 'updated', diveId: first.diveId });

      expect((await getDive(first.diveId)).cylinders).toMatchObject([{ volumeL: 12, startPressureBar: expect.closeTo(200.4, 2), fromPod: false, series: null }]);
      const entries = (await history(first.diveId)).filter((e) => e.changes.cylinders);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ cause: 'reimport', actor: { type: 'import' }, changes: { cylinders: { from: [{ fromPod: true }], to: [{ series: null }] } } });
      expect((await setCylinders(first.diveId, [{ ...steel12, gas: { o2: 36, he: 0 } }])).statusCode).toBe(200);
    });
  });

  describe('a Dive imported before Cylinders were kept', () => {
    let diveId: string;
    let recordingId: string;

    it('gets its pod\'s Cylinder once, by the hub itself, with an entry in its history', async () => {
      ({ diveId, recordingId } = await upload('earlier.json', makeSuuntoJson({ start: day(20), serialNumber: '900000000009' })));
      // As it was before this was built: no Cylinders, and a history that never spoke of any.
      await t.db.delete(cylinder).where(eq(cylinder.diveId, diveId));
      await t.db.update(revision).set({ changes: sql`${revision.changes} - 'cylinders'` }).where(eq(revision.entityId, diveId));
      const { version } = await getDive(diveId);

      expect(await ctx.imports.fillCylinders()).toBe(1);
      const d = await getDive(diveId);
      expect(d.version).toBe(version + 1);
      expect(d.cylinders).toMatchObject([{ volumeL: 12, gas: { o2: 32, he: 0 }, fromPod: true, series: { recordingId, channel: 'tankPressure' } }]);
      expect((await history(diveId))[0]).toMatchObject({ cause: 'fill', actor: { type: 'system' }, changes: { cylinders: { from: [] } } });
      expect(await ctx.imports.fillCylinders()).toBe(0);
    });

    it('stays without them once the User removed them', async () => {
      expect((await setCylinders(diveId, [])).statusCode).toBe(200);
      expect(await ctx.imports.fillCylinders()).toBe(0);
      expect((await getDive(diveId)).cylinders).toEqual([]);
    });
  });

  describe('when two Dives are merged', () => {
    it('the kept Dive takes the other\'s Cylinders where it has none, and keeps its own otherwise', async () => {
      const merge = async (d: number, own: object[], theirs: object[]) => {
        const kept = await garminDive(d);
        const second = (await upload(`later-${d}.fit`, makeSyntheticDive({ serialNumber: 222, start: day(d, '14:00:00') }))).diveId;
        expect(second).not.toBe(kept);
        if (own.length > 0) await setCylinders(kept, own);
        await setCylinders(second, theirs);
        const response = await inject('POST', `/api/dives/${kept}/merge`, tim, {
          version: (await getDive(kept)).version, otherId: second, otherVersion: (await getDive(second)).version,
        });
        expect(response.statusCode).toBe(200);
        return response.json() as DiveView;
      };
      const taken = await merge(10, [], [steel12]);
      expect(taken.cylinders).toEqual([{ ...steel12, fromPod: false, series: null }]);
      expect((await history(taken.id))[0]).toMatchObject({ cause: 'merge', changes: { cylinders: { from: [], to: [{ volumeL: 12 }] } } });
      expect((await merge(11, [stage], [steel12])).cylinders).toEqual([{ ...stage, fromPod: false, series: null }]);
    });
  });

  describe('the cylinder catalogue', () => {
    it('lists common cylinders with the values picking one fills in', async () => {
      const response = await inject('GET', '/api/cylinder-catalogue', tim);
      expect(response.statusCode).toBe(200);
      const catalogue = response.json() as { id: string; volumeL: number; workingPressureBar: number; material: string }[];
      expect(new Set(catalogue.map((c) => c.id)).size).toBe(catalogue.length);
      // Luxfer's AL80: 11.1 L of water at 3000 psi; a 12 L steel cylinder at 232 bar; a twin counts both.
      expect(catalogue.find((c) => c.id === 'al80')).toEqual({ id: 'al80', tradeName: 'AL80', twin: false, volumeL: 11.1, workingPressureBar: 207, material: 'aluminium' });
      expect(catalogue.find((c) => c.id === 'steel-12-232')).toEqual({ id: 'steel-12-232', tradeName: null, twin: false, volumeL: 12, workingPressureBar: 232, material: 'steel' });
      expect(catalogue.find((c) => c.id === 'twin-steel-12-232')).toMatchObject({ twin: true, volumeL: 24, workingPressureBar: 232, material: 'steel' });
    });

    it('each entry is a Cylinder the API takes', async () => {
      const catalogue = (await inject('GET', '/api/cylinder-catalogue', tim)).json() as { volumeL: number; workingPressureBar: number; material: string }[];
      const diveId = await garminDive(25);
      const response = await setCylinders(diveId, catalogue.slice(0, 12).map(({ volumeL, workingPressureBar, material }) => ({ volumeL, workingPressureBar, material })));
      expect(response.statusCode).toBe(200);
    });
  });

  describe('"same as last dive"', () => {
    const sameAsLast = (id: string, cookie = tim) => inject('GET', `/api/dives/${id}/same-as-last`, cookie);

    it('gives the Cylinders of the Diver\'s previous Dive without their pressures and their series', async () => {
      const previous = await garminDive(20);
      const pod = await upload('pod-21.json', makeSuuntoJson({ start: day(21), serialNumber: '900000000001' }));
      const next = await garminDive(22);
      await setCylinders(previous, [steel12, stage]);
      const { startPressureBar: _s, endPressureBar: _e, ...steelOnly } = steel12;
      const { startPressureBar: _s2, endPressureBar: _e2, ...stageOnly } = stage;
      expect((await sameAsLast(pod.diveId)).json()).toEqual({ diveId: previous, cylinders: [steelOnly, stageOnly] });
      // The Dive before is the one with the pod: its Cylinder comes as a plain one.
      expect((await sameAsLast(next)).json()).toEqual({
        diveId: pod.diveId, cylinders: [{ volumeL: 12, workingPressureBar: null, material: null, gas: { o2: 32, he: 0 } }],
      });
      // Nothing was filled: the Dive asked about still has what it had.
      expect((await getDive(next)).cylinders).toEqual([]);
    });

    it('gives none for a Diver\'s first Dive, and nothing to a User who doesn\'t manage the Diver', async () => {
      const first = await upload('theirs.fit', makeSyntheticDive({ serialNumber: 333, start: day(20) }), other);
      expect((await sameAsLast(first.diveId, other)).json()).toEqual({ diveId: null, cylinders: [] });
      expect((await sameAsLast(first.diveId)).statusCode).toBe(404);
    });
  });

  describe('SAC on this dive (slice 3)', () => {
    let diveId: string;
    beforeAll(async () => {
      diveId = await garminDive(27);
    });

    it('a Dive without Cylinders has none, and nothing is missing', async () => {
      expect(await getDive(diveId)).toMatchObject({ sac: null, sacMissing: null });
    });

    it('says what is missing when a Cylinder lacks a pressure', async () => {
      const { endPressureBar: _e, ...noEnd } = stage;
      const response = await setCylinders(diveId, [steel12, noEnd]);
      expect(response.json()).toMatchObject({ sac: null, sacMissing: 'cylinder_incomplete' });
      expect(await getDive(diveId)).toMatchObject({ sac: null, sacMissing: 'cylinder_incomplete' });
    });

    it('is computed from the Cylinders, the average depth and the duration, and follows an edit of them', async () => {
      // 12 L of air from 201 to 51 bar is 1725.6 L with real gas (worked in sac.test.ts): over 40 minutes at an
      // average of 10 m that is 21.57 L/min and 1.88 bar/min; over 30 minutes at 20 m, 19.17 L/min.
      const air12 = { volumeL: 12, startPressureBar: 201, endPressureBar: 51 };
      const first = await inject('PATCH', `/api/dives/${diveId}`, tim, {
        version: (await getDive(diveId)).version, set: { durationSeconds: 40 * 60, maxDepthM: 25, avgDepthM: 10 }, cylinders: [air12],
      });
      expect(first.statusCode).toBe(200);
      const { sac, sacMissing } = await getDive(diveId);
      expect(sacMissing).toBeNull();
      expect(sac!.litresPerMinute).toBeCloseTo(21.57, 1);
      expect(sac!.barPerMinute).toBe(1.88);

      await inject('PATCH', `/api/dives/${diveId}`, tim, { version: (await getDive(diveId)).version, set: { durationSeconds: 30 * 60, avgDepthM: 20 } });
      expect((await getDive(diveId)).sac!.litresPerMinute).toBeCloseTo(19.17, 1);

      await inject('PATCH', `/api/dives/${diveId}`, tim, { version: (await getDive(diveId)).version, set: { durationSeconds: 10 * 60 } });
      expect(await getDive(diveId)).toMatchObject({ sac: null, sacMissing: 'too_short' });
    });
  });
});
