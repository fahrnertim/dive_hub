// Keeping a Dive through the HTTP API (ADR 0015): Overrides, resetting them, the Primary recording,
// re-imports, concurrent edits and the history. Scenario 1 of the data model: a main computer and a backup.
// The water type comes from the Dive site, with a hint when the computer was set to other water (ADR 0025).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type DiveView = {
  id: string; version: number; notes: string | null; overrides: string[];
  waterType: string | null; waterMismatch: { computer: string; site: string; depthPercent: number | null } | null;
  values: Record<string, unknown> & { maxDepthM: number; durationSeconds: number; startsAt: { at: string; utcOffsetSeconds: number | null } };
  fromRecording: Record<string, unknown> & { maxDepthM: number; durationSeconds: number };
  recordings: { id: string; isPrimary: boolean; summary: Record<string, unknown> }[];
};
type RevisionView = { cause: string; actor: { type: string; name: string | null }; changes: Record<string, { from: unknown; to: unknown }> };

describe.skipIf(!(await databaseReachable()))('keeping a Dive', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let other: string;
  let diveId: string;
  let mainId: string;
  let backupId: string;

  const inject = (method: 'GET' | 'PATCH' | 'PUT', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const getDive = async (cookie = tim) => (await inject('GET', `/api/dives/${diveId}`, cookie)).json() as DiveView;
  const history = async () => (await inject('GET', `/api/dives/${diveId}/revisions`, tim)).json() as RevisionView[];
  const edit = (body: object, cookie = tim) => inject('PATCH', `/api/dives/${diveId}`, cookie, body);

  async function upload(cookie: string, fileName: string, data: Uint8Array) {
    const { payload, headers } = multipartFile(fileName, data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(response.json().id);
    return (await inject('GET', `/api/imports/${response.json().id}`, cookie)).json();
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'other@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    other = await signIn(ctx.app, 'other@example.com');
    const main = await upload(tim, 'main.fit', makeSyntheticDive({ serialNumber: 111 }));
    const backup = await upload(tim, 'backup.fit', makeSyntheticDive({
      serialNumber: 999, start: new Date('2026-01-15T09:02:00Z'), durationSeconds: 29 * 60, maxDepthM: 18.2,
    }));
    diveId = main.outcome[0].diveId;
    mainId = main.outcome[0].recordingId;
    backupId = backup.outcome[0].recordingId;
    expect(backup.outcome[0]).toMatchObject({ result: 'attached', diveId });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('shows the Primary recording\'s values, none overridden, and the device summary in our vocabulary', async () => {
    const d = await getDive();
    expect(d.overrides).toEqual([]);
    expect(d.values).toEqual(d.fromRecording);
    expect(d.values.maxDepthM).toBeCloseTo(18.5, 2);
    expect(d.values).toMatchObject({ number: 42, durationSeconds: 1800 });
    expect(d.recordings.map((r) => [r.id, r.isPrimary])).toEqual([[mainId, true], [backupId, false]]);
    // The computer's salinity setting stays with the Recording; without a site the Dive has no water type.
    expect(d.recordings[0]!.summary).toMatchObject({ decoModel: 'buhlmann_zhl16c', waterType: 'salt', waterDensity: 1025 });
    expect(d.values).not.toHaveProperty('waterType');
    expect(d).toMatchObject({ waterType: null, waterMismatch: null });
  });

  it('turns edited values into Overrides, in one Revision, and moves the version on', async () => {
    const before = await getDive();
    const response = await edit({ version: before.version, set: { maxDepthM: 19 }, notes: 'Turtle at the wreck' });
    expect(response.statusCode).toBe(200);
    const d = response.json() as DiveView;
    expect(d).toMatchObject({ overrides: ['maxDepthM'], notes: 'Turtle at the wreck', version: before.version + 1 });
    expect(d.values.maxDepthM).toBe(19);
    expect(d.fromRecording.maxDepthM).toBeCloseTo(18.5, 2);

    const [latest] = await history();
    expect(latest).toMatchObject({ cause: 'edit', actor: { type: 'user', name: 'tim' } });
    expect(Object.keys(latest!.changes).sort()).toEqual(['maxDepthM', 'notes', 'overrides']);
    expect(latest!.changes.maxDepthM!.to).toBe(19);
  });

  it('refuses an edit made on an outdated version and changes nothing', async () => {
    const d = await getDive();
    const response = await edit({ version: d.version - 1, set: { durationSeconds: 60 } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('dive_changed');
    expect((await getDive()).values.durationSeconds).toBe(1800);
  });

  it('changes nothing, and writes no Revision, when nothing differs', async () => {
    const d = await getDive();
    const count = (await history()).length;
    const same = (await edit({ version: d.version, notes: d.notes })).json() as DiveView;
    expect(same.version).toBe(d.version);
    expect(await history()).toHaveLength(count);
  });

  it('lets values without Override follow a new Primary recording, and keeps Overrides', async () => {
    const d = await getDive();
    const response = await inject('PUT', `/api/dives/${diveId}/primary-recording`, tim, { recordingId: backupId, version: d.version });
    expect(response.statusCode).toBe(200);
    const after = response.json() as DiveView;
    expect(after.values.durationSeconds).toBe(29 * 60);
    expect(after.values.startsAt.at).toBe('2026-01-15T09:02:00.000Z');
    expect(after.values.maxDepthM).toBe(19); // still the Override
    expect(after.fromRecording.maxDepthM).toBeCloseTo(18.2, 2);
    expect((await history())[0]).toMatchObject({ cause: 'primary-change' });
  });

  it('gives a reset value back to the Primary recording', async () => {
    const d = await getDive();
    const after = (await edit({ version: d.version, reset: ['maxDepthM'] })).json() as DiveView;
    expect(after.overrides).toEqual([]);
    expect(after.values.maxDepthM).toBeCloseTo(18.2, 2);
  });

  it('keeps the UTC offset with an overridden start time', async () => {
    const d = await getDive();
    const after = (await edit({ version: d.version, set: { startsAt: { at: '2026-01-15T08:30:00Z', utcOffsetSeconds: 3600 } } })).json() as DiveView;
    expect(after.overrides).toEqual(['startsAt']);
    expect(after.values.startsAt).toEqual({ at: '2026-01-15T08:30:00.000Z', utcOffsetSeconds: 3600 });
  });

  it('stores "no value" as no value, not as 0 or an empty text', async () => {
    const d = await getDive();
    const after = (await edit({ version: d.version, set: { avgDepthM: null, waterTemperatureC: null }, notes: null })).json() as DiveView;
    expect(after.values).toMatchObject({ avgDepthM: null, waterTemperatureC: null });
    expect(after.notes).toBeNull();
    // Put the notes back for the tests after this one.
    await edit({ version: after.version, notes: 'Turtle at the wreck', reset: ['avgDepthM', 'waterTemperatureC'] });
  });

  it('refuses an average depth deeper than the max depth', async () => {
    const d = await getDive();
    const response = await edit({ version: d.version, set: { avgDepthM: 30 } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('dive_values_inconsistent');
  });

  it('refuses a Primary recording from another Dive', async () => {
    const d = await getDive();
    const elsewhere = await upload(tim, 'later.fit', makeSyntheticDive({ serialNumber: 111, start: new Date('2026-01-16T09:00:00Z') }));
    const response = await inject('PUT', `/api/dives/${diveId}/primary-recording`, tim, {
      recordingId: elsewhere.outcome[0].recordingId, version: d.version,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('recording_not_on_dive');
  });

  it('lets a re-import update values without Override, and leaves Overrides alone', async () => {
    const d = await getDive();
    await inject('PUT', `/api/dives/${diveId}/primary-recording`, tim, { recordingId: mainId, version: d.version });
    // The same main-computer dive again (same Recording key), now with a deeper max depth.
    const again = await upload(tim, 'main-again.fit', makeSyntheticDive({ serialNumber: 111, maxDepthM: 21 }));
    expect(again.outcome[0]).toMatchObject({ result: 'updated', recordingId: mainId });
    const after = await getDive();
    expect(after.values.maxDepthM).toBeCloseTo(21, 2);
    expect(after.values.startsAt.at).toBe('2026-01-15T08:30:00.000Z'); // the Override stays
    expect((await history())[0]).toMatchObject({ cause: 'reimport', actor: { type: 'import', name: 'main-again.fit' } });
  });

  it('is only for Users who manage the Diver', async () => {
    const d = await getDive();
    expect((await edit({ version: d.version, notes: 'mine now' }, other)).statusCode).toBe(404);
    expect((await inject('GET', `/api/dives/${diveId}/revisions`, other)).statusCode).toBe(404);
    expect((await inject('PUT', `/api/dives/${diveId}/primary-recording`, other, { recordingId: backupId, version: d.version })).statusCode).toBe(404);
    expect((await getDive()).notes).toBe('Turtle at the wreck');
  });

  describe('the water type comes from the Dive site (ADR 0025)', () => {
    const site = async (waterType: string | null) => (await ctx.app.inject({
      method: 'POST', url: '/api/dive-sites', headers: { cookie: tim, origin: BASE_URL }, payload: { name: `Site ${waterType}`, waterType },
    })).json() as { id: string };
    const atSite = async (siteId: string | null) => {
      const d = await getDive();
      expect((await edit({ version: d.version, siteId })).statusCode).toBe(200);
      return getDive();
    };

    it('is the site\'s, and says so when the computer was set to other water', async () => {
      // The synthetic computer was set to salt water (1025 kg/m³).
      const lake = await atSite((await site('fresh')).id);
      expect(lake.waterType).toBe('fresh');
      expect(lake.waterMismatch).toEqual({ computer: 'salt', site: 'fresh', depthPercent: -2.4 });

      const sea = await atSite((await site('salt')).id);
      expect(sea).toMatchObject({ waterType: 'salt', waterMismatch: null });

      const lagoon = await atSite((await site('brackish')).id);
      expect(lagoon.waterMismatch).toEqual({ computer: 'salt', site: 'brackish', depthPercent: null });

      const unknown = await atSite((await site(null)).id);
      expect(unknown).toMatchObject({ waterType: null, waterMismatch: null });
      expect(await atSite(null)).toMatchObject({ waterType: null, waterMismatch: null });
    });

    it('is no Dive value: setting it on the Dive changes nothing, resetting it is refused', async () => {
      const d = await getDive();
      // Unknown fields are dropped (Fastify's default), so an old client's water type does nothing.
      const ignored = (await edit({ version: d.version, set: { waterType: 'fresh' } })).json() as DiveView;
      expect(ignored).toMatchObject({ version: d.version, overrides: d.overrides, waterType: d.waterType });
      expect((await edit({ version: d.version, reset: ['waterType'] })).statusCode).toBe(400);
    });
  });
});
