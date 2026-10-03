// Deciding about Recordings and Divers through the HTTP API (ADR 0016): Duplicate candidates,
// splitting a Recording off, managed Divers, Devices and moving Dives between Divers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Candidate = { id: string; reason: string; recording: { id: string; device: { serialNumber: string } | null }; dives: { id: string }[] };
type Dive = { id: string; diverId: string; version: number; values: { durationSeconds: number }; recordings: { id: string; isPrimary: boolean }[] };
type Diver = { id: string; name: string; isOwn: boolean; diveCount: number; deviceCount: number };
type Device = { id: string; serialNumber: string; diverId: string; recordingCount: number };

describe.skipIf(!(await databaseReachable()))('deciding about Recordings and Divers', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let other: string;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie = tim, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie = tim, payload?: object) =>
    (await call(method, url, cookie, payload)).json() as T;

  async function upload(fileName: string, data: Uint8Array, cookie = tim) {
    const { payload, headers } = multipartFile(fileName, data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(response.json().id);
    return (await call('GET', `/api/imports/${response.json().id}`, cookie)).json().outcome[0] as {
      result: string; diveId?: string; recordingId: string; reason?: string;
    };
  }

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

  describe('Duplicate candidates', () => {
    let morning: string;
    let candidate: Candidate;

    beforeAll(async () => {
      morning = (await upload('morning.fit', makeSyntheticDive({ serialNumber: 111 }))).diveId!;
      // A backup computer whose max depth disagrees too much: a Duplicate candidate for the morning Dive.
      const backup = await upload('backup.fit', makeSyntheticDive({
        serialNumber: 999, start: new Date('2026-01-15T09:01:00Z'), durationSeconds: 29 * 60, maxDepthM: 30,
      }));
      expect(backup).toMatchObject({ result: 'duplicate-candidate', reason: 'max_depth_differs' });
    });

    it('are listed with the Recording and the Dives it might belong to', async () => {
      const open = await json<Candidate[]>('GET', '/api/duplicate-candidates');
      expect(open).toHaveLength(1);
      candidate = open[0]!;
      expect(candidate).toMatchObject({ reason: 'max_depth_differs', recording: { device: { serialNumber: '999' } } });
      expect(candidate.dives.map((d) => d.id)).toEqual([morning]);
    });

    it('are not shown to other Users, and can\'t be decided by them', async () => {
      expect(await json<Candidate[]>('GET', '/api/duplicate-candidates', other)).toEqual([]);
      expect((await call('POST', `/api/duplicate-candidates/${candidate.id}/discard`, other)).statusCode).toBe(404);
    });

    it('can be discarded, and then a re-import doesn\'t ask again', async () => {
      expect((await call('POST', `/api/duplicate-candidates/${candidate.id}/discard`)).statusCode).toBe(200);
      expect(await json<Candidate[]>('GET', '/api/duplicate-candidates')).toEqual([]);
      expect(await json<Candidate[]>('GET', '/api/duplicate-candidates?status=discarded')).toHaveLength(1);
      // The same backup Recording again (newer file): updated in place, no new question.
      const again = await upload('backup-again.fit', makeSyntheticDive({
        serialNumber: 999, start: new Date('2026-01-15T09:01:00Z'), durationSeconds: 29 * 60, maxDepthM: 30.5,
      }));
      expect(again.result).toBe('updated');
      expect(await json<Candidate[]>('GET', '/api/duplicate-candidates')).toEqual([]);
    });

    it('can be reopened and added to a candidate Dive, which records it', async () => {
      expect((await call('POST', `/api/duplicate-candidates/${candidate.id}/reopen`)).statusCode).toBe(200);
      const wrong = await call('POST', `/api/duplicate-candidates/${candidate.id}/attach`, tim, { diveId: '00000000-0000-7000-8000-000000000000' });
      expect(wrong.json().code).toBe('not_a_candidate');
      const done = await call('POST', `/api/duplicate-candidates/${candidate.id}/attach`, tim, { diveId: morning });
      expect(done.json()).toEqual({ diveId: morning });
      const d = await json<Dive>('GET', `/api/dives/${morning}`);
      expect(d.recordings.map((r) => r.id)).toContain(candidate.recording.id);
      const [latest] = await json<{ cause: string }[]>('GET', `/api/dives/${morning}/revisions`);
      expect(latest!.cause).toBe('attach');
      // Decided once is decided.
      expect((await call('POST', `/api/duplicate-candidates/${candidate.id}/new-dive`)).json().code).toBe('candidate_resolved');
    });

    it('can become a Dive of their own', async () => {
      const deep = await upload('deep.fit', makeSyntheticDive({
        serialNumber: 999, start: new Date('2026-02-01T09:00:00Z'), maxDepthM: 18.5, diveNumber: 50,
      }));
      expect(deep.result).toBe('created'); // a second, unrelated Dive first
      const odd = await upload('odd.fit', makeSyntheticDive({
        serialNumber: 777, start: new Date('2026-02-01T09:01:00Z'), maxDepthM: 40, diveNumber: 51,
      }));
      expect(odd.result).toBe('duplicate-candidate');
      const [c] = await json<Candidate[]>('GET', '/api/duplicate-candidates');
      const { diveId } = await json<{ diveId: string }>('POST', `/api/duplicate-candidates/${c!.id}/new-dive`);
      const d = await json<Dive>('GET', `/api/dives/${diveId}`);
      expect(d.recordings).toEqual([expect.objectContaining({ id: odd.recordingId, isPrimary: true })]);
    });
  });

  describe('splitting a Recording off', () => {
    it('makes a new Dive from it; the old Dive\'s values follow its remaining Recording', async () => {
      const main = await upload('trip-main.fit', makeSyntheticDive({ serialNumber: 111, start: new Date('2026-03-01T09:00:00Z') }));
      const backup = await upload('trip-backup.fit', makeSyntheticDive({
        serialNumber: 999, start: new Date('2026-03-01T09:02:00Z'), durationSeconds: 29 * 60, maxDepthM: 18.2,
      }));
      expect(backup).toMatchObject({ result: 'attached', diveId: main.diveId });
      let d = await json<Dive>('GET', `/api/dives/${main.diveId}`);

      // The Primary recording goes: the backup takes over.
      const { diveId: split } = await json<{ diveId: string }>('POST', `/api/recordings/${main.recordingId}/detach`, tim, { version: d.version });
      d = await json<Dive>('GET', `/api/dives/${main.diveId}`);
      expect(d.recordings).toEqual([expect.objectContaining({ id: backup.recordingId, isPrimary: true })]);
      expect(d.values.durationSeconds).toBe(29 * 60);
      const created = await json<Dive>('GET', `/api/dives/${split}`);
      expect(created).toMatchObject({ diverId: d.diverId, values: { durationSeconds: 1800 } });

      // The last Recording of a Dive stays.
      const last = await call('POST', `/api/recordings/${backup.recordingId}/detach`, tim, { version: d.version });
      expect(last.json().code).toBe('last_recording');
      expect((await call('POST', `/api/recordings/${backup.recordingId}/detach`, other, { version: d.version })).statusCode).toBe(404);
    });
  });

  describe('Divers and Devices', () => {
    let own: Diver;
    let kid: Diver;

    it('starts with the User\'s own Diver; more can be added and renamed', async () => {
      own = (await json<Diver[]>('GET', '/api/divers'))[0]!;
      expect(own).toMatchObject({ isOwn: true, name: 'tim' });
      kid = (await call('POST', '/api/divers', tim, { name: 'Kid' })).json() as Diver;
      expect(kid).toMatchObject({ name: 'Kid', isOwn: false, diveCount: 0 });
      expect(await json<Diver>('PATCH', `/api/divers/${kid.id}`, tim, { name: 'Mia' })).toMatchObject({ name: 'Mia' });
      expect((await json<Diver[]>('GET', '/api/divers')).map((d) => d.name)).toEqual(['tim', 'Mia']);
      expect(await json<Diver[]>('GET', '/api/divers', other)).toHaveLength(1);
      expect((await call('PATCH', `/api/divers/${kid.id}`, other, { name: 'Mine' })).statusCode).toBe(404);
    });

    it('sends future Imports from a reassigned Device to the new Diver; past Dives stay', async () => {
      const devices = await json<Device[]>('GET', '/api/devices');
      const watch = devices.find((d) => d.serialNumber === '111')!;
      const before = await json<{ id: string; diverId: string }[]>('GET', '/api/dives');
      expect((await call('PATCH', `/api/devices/${watch.id}`, tim, { diverId: kid.id })).statusCode).toBe(204);
      expect(await json<{ id: string; diverId: string }[]>('GET', '/api/dives')).toEqual(before);

      const lent = await upload('lent.fit', makeSyntheticDive({ serialNumber: 111, start: new Date('2026-04-01T09:00:00Z') }));
      expect((await json<Dive>('GET', `/api/dives/${lent.diveId}`)).diverId).toBe(kid.id);
      expect((await json<{ id: string }[]>('GET', `/api/dives?diverId=${kid.id}`)).map((d) => d.id)).toEqual([lent.diveId]);
      expect((await call('PATCH', `/api/devices/${watch.id}`, other, { diverId: kid.id })).statusCode).toBe(404);
    });

    it('moves a single Dive to another Diver the User manages', async () => {
      const [mine] = await json<{ id: string }[]>('GET', `/api/dives?diverId=${own.id}`);
      const d = await json<Dive>('GET', `/api/dives/${mine!.id}`);
      const moved = await json<Dive>('POST', `/api/dives/${d.id}/move`, tim, { diverId: kid.id, version: d.version });
      expect(moved.diverId).toBe(kid.id);
      const [latest] = await json<{ cause: string }[]>('GET', `/api/dives/${d.id}/revisions`);
      expect(latest!.cause).toBe('move');
      const [otherOwn] = await json<Diver[]>('GET', '/api/divers', other);
      expect((await call('POST', `/api/dives/${d.id}/move`, tim, { diverId: otherOwn!.id, version: moved.version })).json().code).toBe('diver_not_found');
    });

    it('deletes only empty Divers, never the own one', async () => {
      expect((await call('DELETE', `/api/divers/${kid.id}`)).json().code).toBe('diver_not_empty');
      expect((await call('DELETE', `/api/divers/${own.id}`)).json().code).toBe('own_diver');
      const empty = (await call('POST', '/api/divers', tim, { name: 'Guest' })).json() as Diver;
      expect((await call('DELETE', `/api/divers/${empty.id}`)).statusCode).toBe(204);
    });
  });
});
