// Buddies at SSI (ADR 0029), against the fake SSI with a buddy list: importing the list (only names and SSI accounts
// are kept), Participants sent as entry IDs from the User's own list, one not in it left out, an update that keeps
// buddies set in SSI's app, the read-back, and "outdated".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeSsi, type FakeSsiBuddy } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

const ERIKA = 5_012_047;
const person = (id: number, account: number, firstname: string, lastname: string): FakeSsiBuddy => ({
  owner: ERIKA, id, buddy_master_id: account, firstname, lastname,
  email: `${firstname.toLowerCase()}@example.com`, dob: '1980-01-02', phone: '+49 170 000000', city: 'Kiel',
});
/** A professional: SSI keeps a leader number for him. */
const KAI = { ...person(3_786_888, 4_989_164, 'Kai', 'Lund'), leader_nr: '54321' };
const ZOE = person(2_555_555, 4_700_000, 'Zoe', 'Zett');
const MIA = person(2_826_964, 4_512_484, 'Mia', 'Stone');
/** Typed in lower case at SSI, as some entries are. */
const SAM = person(2_271_970, 4_109_908, 'samuel', 'dreier');

type Buddy = { name: string; account: string | null; diver: { id: string; name: string } | null };
type Status = { unmet: { type: string }[]; current: { remoteId: string; upToDate: boolean } | null; pushes: { leftOut: unknown[] | null; differences: unknown[] | null }[] };

describe.skipIf(!(await databaseReachable()))('buddies at SSI', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let connectionId: string;
  let diveId: string;
  let kai: string;
  let mia: string;
  let bob: string;
  const bodies: string[] = [];

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => {
    const response = await ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
    bodies.push(response.body);
    return response;
  };
  const status = async () => (await call('GET', `/api/dives/${diveId}/providers/ssi`)).json() as Status;
  const buddies = async () => ((await call('GET', `/api/connections/${connectionId}/buddies`)).json() as { buddies: Buddy[] }).buddies;
  const setParticipants = async (ids: string[]) => call('PUT', `/api/dives/${diveId}/participants`, {
    version: ((await call('GET', `/api/dives/${diveId}`)).json() as { version: number }).version,
    participants: ids.map((diverId) => ({ diverId, role: 'buddy' })),
  });
  /** Not through `call`: a Diver's details hold the e-mail, which no other answer may. */
  const details = async (id: string) => (await ctx.app.inject({ method: 'GET', url: `/api/divers/${id}/details`, headers: { cookie: tim } })).json() as Record<string, unknown>;
  const ssiDive = (remoteId: string) => ctx.fakeSsi.dives.get(Number(remoteId))!;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { fakeSsi: createFakeSsi({ buddies: [KAI, MIA, SAM, ZOE, { ...person(1_111_111, 7_777_777, 'Other', 'List'), owner: 42 }] }) });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    const timDiver = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    const { payload, headers } = multipartFile('main.fit', makeSyntheticDive({ serialNumber: 111 }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    diveId = (await call('GET', `/api/imports/${created.json().id}`)).json().outcome[0].diveId;
    connectionId = (await call('POST', '/api/connections/ssi', {
      diverId: timDiver, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false,
    })).json().id;
    const site = (await call('POST', '/api/dive-sites', { name: 'Hausreef' })).json() as { id: string };
    await call('PUT', `/api/dive-sites/${site.id}/external-ids/ssi`, { externalId: '3314' });
    await call('PATCH', `/api/dives/${diveId}`, { version: ((await call('GET', `/api/dives/${diveId}`)).json()).version, siteId: site.id });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('the buddy list', () => {
    it('declares buddies to clients as a list it can read', async () => {
      const providers = (await call('GET', '/api/providers')).json() as { id: string; data: { buddies: unknown } }[];
      expect(providers.find((p) => p.id === 'ssi')!.data.buddies).toEqual({ import: { operations: ['find'], findBy: [] } });
    });

    it('reads the account\'s own list: names and SSI accounts only', async () => {
      expect(await buddies()).toEqual([
        { name: 'Kai Lund', account: '4989164', diver: null },
        { name: 'Mia Stone', account: '4512484', diver: null },
        { name: 'samuel dreier', account: '4109908', diver: null },
        { name: 'Zoe Zett', account: '4700000', diver: null },
      ]);
    });

    it('imports chosen entries as external Divers with their SSI account, and skips those already here', async () => {
      const answer = await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: ['4989164'] });
      expect(answer.json()).toMatchObject({ created: 1, buddies: [{ name: 'Kai Lund', diver: { name: 'Kai Lund' } }, { name: 'Mia Stone', diver: null }, { diver: null }, { diver: null }] });
      kai = (answer.json() as { buddies: Buddy[] }).buddies[0]!.diver!.id;
      expect((await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: ['4989164'] })).json()).toMatchObject({ created: 0 });
      const found = (await call('GET', '/api/external-divers?q=kai')).json() as { divers: { id: string; accounts: string[] }[] };
      expect(found.divers).toEqual([expect.objectContaining({ id: kai, accounts: ['ssi'] })]);
    });

    it('capitalizes a name SSI has all in lower case when importing it', async () => {
      const answer = await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: ['4109908'] });
      expect((answer.json() as { buddies: Buddy[] }).buddies[2]).toMatchObject({ name: 'samuel dreier', diver: { name: 'Samuel Dreier' } });
    });

    it('brings along what the buddy code says: first and last name as SSI spells them, the e-mail and a leader number (ADR 0043)', async () => {
      expect(await details(kai)).toMatchObject({
        firstName: 'Kai', lastName: 'Lund', email: 'kai@example.com', leaderNumber: '54321',
        codes: [{ kind: 'buddy' }, { kind: 'professional', text: 'buddy;4989164;firstName:Kai;lastName:Lund;email:kai@example.com;leaderNr:54321' }],
      });
      const sam = (await buddies())[2]!.diver!.id;
      expect(await details(sam)).toMatchObject({ name: 'Samuel Dreier', firstName: 'samuel', lastName: 'dreier', leaderNumber: null });
    });

    it('fills what a Diver already here lacks when their entry is imported, and overwrites nothing', async () => {
      const zoe = ((await call('POST', '/api/external-divers', { name: 'Zoe' })).json() as { id: string }).id;
      await ctx.app.inject({ method: 'PUT', url: `/api/divers/${zoe}/external-ids/ssi`, headers: { cookie: tim, origin: BASE_URL }, payload: { externalId: '4700000' } });
      await ctx.app.inject({ method: 'PATCH', url: `/api/divers/${zoe}/details`, headers: { cookie: tim, origin: BASE_URL }, payload: { firstName: 'Zoë' } });
      const answer = (await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: ['4700000'] })).json() as { created: number; updated: number };
      expect(answer).toMatchObject({ created: 0, updated: 1 });
      expect(await details(zoe)).toMatchObject({ name: 'Zoe', firstName: 'Zoë', lastName: 'Zett', email: 'zoe@example.com' });
      expect((await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: ['4700000'] })).json()).toMatchObject({ created: 0, updated: 0 });
    });

    it('links an entry to a Diver already here by setting the Diver\'s SSI account', async () => {
      mia = ((await call('POST', '/api/external-divers', { name: 'Mia' })).json() as { id: string }).id;
      expect((await call('PUT', `/api/divers/${mia}/external-ids/ssi`, { externalId: '4512484' })).statusCode).toBe(204);
      expect((await buddies())[1]).toEqual({ name: 'Mia Stone', account: '4512484', diver: { id: mia, name: 'Mia' } });
    });
  });

  describe('sending', () => {
    it('puts Participants on the SSI dive as entries of the User\'s list, and leaves out one who isn\'t in it', async () => {
      bob = ((await call('POST', '/api/external-divers', { name: 'Bob' })).json() as { id: string }).id;
      await call('PUT', `/api/divers/${bob}/external-ids/ssi`, { externalId: '9999999' });
      await setParticipants([kai, mia, bob]);
      // Bob has an SSI account, so nothing is unmet here; only SSI's list can tell he isn't in it.
      expect((await status()).unmet).toEqual([]);
      const sent = (await call('POST', `/api/dives/${diveId}/providers/ssi`, {})).json() as { status: Status };
      const remoteId = sent.status.current!.remoteId;
      expect(ssiDive(remoteId).odin_user_log_buddy_ids).toEqual([KAI.id, MIA.id]);
      expect(sent.status.pushes[0]).toMatchObject({ leftOut: [{ diverId: bob, name: 'Bob', reason: 'not_at_provider' }], differences: [] });
      expect(sent.status.current!.upToDate).toBe(true);
    });

    it('marks the Dive changed when its Participants change, and on update keeps buddies set in SSI\'s app', async () => {
      const remoteId = (await status()).current!.remoteId;
      // In SSI's app, someone else from the list is added to the dive.
      ssiDive(remoteId).odin_user_log_buddy_ids = [KAI.id, MIA.id, 1_234_567];
      ctx.ssiClock.advance(5 * 60_000);
      await setParticipants([mia]);
      expect((await status()).current!.upToDate).toBe(false);
      expect((await call('POST', `/api/dives/${diveId}/providers/ssi`, {})).json()).toMatchObject({ outcome: 'updated' });
      expect(ssiDive(remoteId).odin_user_log_buddy_ids).toEqual([MIA.id, 1_234_567]);
      expect((await status()).current!.upToDate).toBe(true);
    });

    it('never answers more of a buddy than the name and what their code says: no birth date, phone or town, and the e-mail only inside a code', async () => {
      for (const body of bodies) {
        for (const b of [KAI, MIA]) for (const secret of [b.dob, b.phone, b.city, 'Other']) expect(body).not.toContain(secret);
        // The e-mail is in a Diver's details and in a professional's code on a Dive (ADR 0043), nowhere else.
        if (!body.includes('"verificationCodes"')) expect(body).not.toContain(KAI.email);
        expect(body).not.toContain(MIA.email);
      }
      const stored = JSON.stringify((await ctx.app.inject({ method: 'GET', url: `/api/divers/${kai}/details`, headers: { cookie: tim } })).json());
      for (const secret of [KAI.dob, KAI.phone, KAI.city]) expect(stored).not.toContain(secret);
    });
  });
});
