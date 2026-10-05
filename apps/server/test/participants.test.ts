// Divers seen by every User by name, external Divers shared like Dive sites, and Participants on Dives (ADR 0028).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Found = { id: string; name: string; managed: boolean; external: boolean };
type External = { id: string; name: string; accounts: string[]; inUse: boolean; canDelete: boolean };
type Participant = { diverId: string; name: string; role: string };
type DiveView = { id: string; version: number; participants: Participant[] };
type RevisionView = { cause: string; changes: Record<string, { from: unknown; to: unknown }> };

describe.skipIf(!(await databaseReachable()))('Divers and Participants', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let anna: string;
  let admin: string;
  let timDiver: string;
  let annaDiver: string;
  let diveId: string;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: Parameters<typeof call>[0], url: string, cookie: string, payload?: object) =>
    (await call(method, url, cookie, payload)).json() as T;
  const ownDiver = async (cookie: string) => (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers', cookie)).find((d) => d.isOwn)!.id;
  const getDive = () => json<DiveView>('GET', `/api/dives/${diveId}`, tim);
  const setParticipants = async (participants: { diverId: string; role: string }[], cookie = tim) =>
    call('PUT', `/api/dives/${diveId}/participants`, cookie, { version: (await getDive()).version, participants });
  const external = (name: string, cookie = tim) => json<External>('POST', '/api/external-divers', cookie, { name });

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'anna@example.com');
    await createUser(ctx.auth, 'admin@example.com', 'admin');
    tim = await signIn(ctx.app, 'tim@example.com');
    anna = await signIn(ctx.app, 'anna@example.com');
    admin = await signIn(ctx.app, 'admin@example.com');
    timDiver = await ownDiver(tim);
    annaDiver = await ownDiver(anna);
    const { payload, headers } = multipartFile('main.fit', makeSyntheticDive({ serialNumber: 111 }));
    const imported = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(imported.json().id);
    diveId = (await json<{ outcome: { diveId: string }[] }>('GET', `/api/imports/${imported.json().id}`, tim)).outcome[0]!.diveId;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('finding Divers', () => {
    it('finds every Diver of the instance by name, and says which are the User\'s own and which are external', async () => {
      const bob = await external('Bob Miller', anna);
      const found = await json<{ divers: Found[] }>('GET', '/api/divers/search?q=', tim);
      expect(found.divers).toEqual(expect.arrayContaining([
        { id: timDiver, name: 'tim', managed: true, external: false },
        { id: annaDiver, name: 'anna', managed: false, external: false },
        { id: bob.id, name: 'Bob Miller', managed: false, external: true },
      ]));
      expect((await json<{ divers: Found[] }>('GET', '/api/divers/search?q=mill', tim)).divers.map((d) => d.name)).toEqual(['Bob Miller']);
      // Nothing but the name: no counts, accounts or personal data of other Users' Divers.
      expect(Object.keys(found.divers[0]!).sort()).toEqual(['external', 'id', 'managed', 'name']);
    });

    it('keeps external Divers out of the User\'s own Divers', async () => {
      expect((await json<{ name: string }[]>('GET', '/api/divers', tim)).map((d) => d.name)).toEqual(['tim']);
    });
  });

  describe('external Divers', () => {
    it('are created and renamed by any User, with a Revision', async () => {
      const carla = await external('Carla', tim);
      expect(carla).toEqual({ id: expect.any(String), name: 'Carla', accounts: [], inUse: false, canDelete: true });
      const renamed = await json<External>('PATCH', `/api/external-divers/${carla.id}`, anna, { name: 'Carla Diaz' });
      expect(renamed).toMatchObject({ name: 'Carla Diaz', canDelete: false });
      const list = await json<{ divers: External[]; total: number }>('GET', '/api/external-divers?q=carla', anna);
      expect(list).toEqual({ divers: [renamed], total: 1 });
    });

    it('are deleted by their creator or an admin, and only while no Dive lists them', async () => {
      const dora = await external('Dora', tim);
      expect((await call('DELETE', `/api/external-divers/${dora.id}`, anna)).json()).toMatchObject({ code: 'diver_not_deletable' });
      expect((await setParticipants([{ diverId: dora.id, role: 'buddy' }])).statusCode).toBe(200);
      expect((await call('DELETE', `/api/external-divers/${dora.id}`, tim)).json()).toMatchObject({ code: 'diver_in_use' });
      await setParticipants([]);
      expect((await call('DELETE', `/api/external-divers/${dora.id}`, admin)).statusCode).toBe(204);
      expect((await json<{ divers: Found[] }>('GET', '/api/divers/search?q=dora', tim)).divers).toEqual([]);
    });

    it('get an account at a service by hand, unless another Diver has it', async () => {
      const eve = await external('Eve', tim);
      const fred = await external('Fred', tim);
      expect((await call('PUT', `/api/divers/${eve.id}/external-ids/ssi`, anna, { externalId: '4109908' })).statusCode).toBe(204);
      expect((await json<{ divers: External[] }>('GET', '/api/external-divers?q=eve', tim)).divers[0]!.accounts).toEqual(['ssi']);
      expect((await call('PUT', `/api/divers/${fred.id}/external-ids/ssi`, tim, { externalId: '4109908' })).json())
        .toMatchObject({ code: 'diver_external_id_taken', diver: { id: eve.id, name: 'Eve' } });
      expect((await call('PUT', `/api/divers/${fred.id}/external-ids/ssi`, tim, { externalId: 'abc' })).statusCode).toBe(400);
      expect((await call('PUT', `/api/divers/${eve.id}/external-ids/ssi`, tim, { externalId: null })).statusCode).toBe(204);
      expect((await call('PUT', `/api/divers/${fred.id}/external-ids/ssi`, tim, { externalId: '4109908' })).statusCode).toBe(204);
    });

    it('on a Diver someone manages, only that User sets the account', async () => {
      expect((await call('PUT', `/api/divers/${annaDiver}/external-ids/padi`, tim, { externalId: '12345' })).json())
        .toMatchObject({ code: 'diver_not_editable' });
      expect((await call('PUT', `/api/divers/${annaDiver}/external-ids/padi`, anna, { externalId: '12345' })).statusCode).toBe(204);
    });
  });

  describe('Participants', () => {
    it('are set as one list with the Dive\'s version: any Diver, as buddy, guide or instructor', async () => {
      const bob = (await json<{ divers: Found[] }>('GET', '/api/divers/search?q=bob', tim)).divers[0]!;
      const before = await getDive();
      expect(before.participants).toEqual([]);
      const answer = await setParticipants([{ diverId: bob.id, role: 'buddy' }, { diverId: annaDiver, role: 'instructor' }]);
      expect(answer.statusCode).toBe(200);
      const after = answer.json() as DiveView;
      expect(after.version).toBe(before.version + 1);
      expect(after.participants).toEqual([
        { diverId: bob.id, name: 'Bob Miller', role: 'buddy' },
        { diverId: annaDiver, name: 'anna', role: 'instructor' },
      ]);
      const [latest] = await json<RevisionView[]>('GET', `/api/dives/${diveId}/revisions`, tim);
      expect(latest).toMatchObject({
        cause: 'edit',
        changes: { participants: { from: [], to: [{ diverId: bob.id, name: 'Bob Miller', role: 'buddy' }, { diverId: annaDiver, name: 'anna', role: 'instructor' }] } },
      });
    });

    it('refuses an old version, the Dive\'s own Diver, a Diver twice, an unknown Diver, and another User\'s Dive', async () => {
      const { version } = await getDive();
      expect((await call('PUT', `/api/dives/${diveId}/participants`, tim, { version: version - 1, participants: [] })).json())
        .toMatchObject({ code: 'dive_changed' });
      expect((await setParticipants([{ diverId: timDiver, role: 'buddy' }])).json()).toMatchObject({ code: 'participant_invalid' });
      expect((await setParticipants([{ diverId: annaDiver, role: 'buddy' }, { diverId: annaDiver, role: 'guide' }])).json())
        .toMatchObject({ code: 'participant_invalid' });
      expect((await setParticipants([{ diverId: '00000000-0000-7000-8000-000000000000', role: 'buddy' }])).json())
        .toMatchObject({ code: 'diver_not_found' });
      expect((await call('PUT', `/api/dives/${diveId}/participants`, anna, { version, participants: [] })).statusCode).toBe(404);
      expect((await getDive()).version).toBe(version);
    });

    it('keep a Diver someone manages from being deleted', async () => {
      const kid = await json<{ id: string }>('POST', '/api/divers', anna, { name: 'Kid' });
      await setParticipants([{ diverId: kid.id, role: 'buddy' }]);
      expect((await call('DELETE', `/api/divers/${kid.id}`, anna)).json()).toMatchObject({ code: 'diver_not_empty' });
    });
  });
});
