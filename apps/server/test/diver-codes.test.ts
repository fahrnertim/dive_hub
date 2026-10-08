// Buddy and professional codes (ADR 0043, slice 3): a Diver's first and last name, e-mail and leader number, seen by
// every User; the codes built from them; a scanned or pasted person's code finding its Diver by the SSI account; and
// the professional's code on every Dive the person is a Participant on. Placeholders only, never a real person's code.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diver, revision } from '../src/db/schema.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Details = {
  id: string; name: string; external: boolean; canEdit: boolean;
  firstName: string | null; lastName: string | null; email: string | null; leaderNumber: string | null;
  accounts: { source: string; externalId: string }[];
  codes: { kind: string; provider: string; text: string }[];
};
type Read = {
  kind: string;
  existing: { id: string; name: string; canEdit: boolean; changes: { field: string; from: string | null; to: string }[] } | null;
  candidates: { id: string; name: string }[];
};
type DiveView = { version: number; verificationCodes: { kind: string; centre: object | null; diver: { id: string; name: string } | null; provider: string; text: string }[] };

const KAI_BUDDY = 'buddy;4989164;firstName:Kai;lastName:Lund;email:kai@example.com';
const KAI_PRO = `${KAI_BUDDY};leaderNr:54321`;

describe.skipIf(!(await databaseReachable()))('buddy and professional codes', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let anna: string;
  let timDiver: string;
  let annaDiver: string;
  let diveId: string;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: Parameters<typeof call>[0], url: string, cookie: string, payload?: object) =>
    (await call(method, url, cookie, payload)).json() as T;
  const ownDiver = async (cookie: string) => (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers', cookie)).find((d) => d.isOwn)!.id;
  const external = async (name: string, cookie = tim) => (await json<{ id: string }>('POST', '/api/external-divers', cookie, { name })).id;
  const details = (id: string, cookie = tim) => json<Details>('GET', `/api/divers/${id}/details`, cookie);
  const read = (text: string, cookie = tim) => json<Read>('POST', '/api/verification-codes/read', cookie, { text });
  const getDive = () => json<DiveView>('GET', `/api/dives/${diveId}`, tim);

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'anna@example.com');
    await createUser(ctx.auth, 'admin@example.com', 'admin');
    tim = await signIn(ctx.app, 'tim@example.com');
    anna = await signIn(ctx.app, 'anna@example.com');
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

  describe('a Diver\'s details', () => {
    it('start empty, without a code', async () => {
      const bob = await external('Bob Miller');
      expect(await details(bob)).toEqual({
        id: bob, name: 'Bob Miller', external: true, canEdit: true,
        firstName: null, lastName: null, email: null, leaderNumber: null, accounts: [], codes: [],
      });
    });

    it('are set on an external Diver by any User, and give the buddy code once the SSI account is there too', async () => {
      const bob = await external('Bob Example');
      const set = await call('PATCH', `/api/divers/${bob}/details`, anna, { firstName: ' Bob ', lastName: 'Example', email: 'bob@example.com' });
      expect(set.statusCode).toBe(200);
      expect(set.json()).toMatchObject({ firstName: 'Bob', lastName: 'Example', email: 'bob@example.com', codes: [] });
      await call('PUT', `/api/divers/${bob}/external-ids/ssi`, tim, { externalId: '4000001' });
      expect(await details(bob)).toMatchObject({
        accounts: [{ source: 'ssi', externalId: '4000001' }],
        codes: [{ kind: 'buddy', provider: 'ssi', text: 'buddy;4000001;firstName:Bob;lastName:Example;email:bob@example.com' }],
      });
    });

    it('add the professional\'s code with a leader number, and lose it when the number is cleared', async () => {
      const pia = await external('Pia Pro');
      await call('PUT', `/api/divers/${pia}/external-ids/ssi`, tim, { externalId: '4000002' });
      await call('PATCH', `/api/divers/${pia}/details`, tim, { firstName: 'Pia', lastName: 'Pro', email: 'pia@example.com', leaderNumber: '777' });
      expect((await details(pia)).codes.map((c) => c.kind)).toEqual(['buddy', 'professional']);
      expect((await details(pia)).codes[1]!.text).toBe('buddy;4000002;firstName:Pia;lastName:Pro;email:pia@example.com;leaderNr:777');
      const cleared = await json<Details>('PATCH', `/api/divers/${pia}/details`, tim, { leaderNumber: null });
      expect(cleared).toMatchObject({ firstName: 'Pia', leaderNumber: null });
      expect(cleared.codes.map((c) => c.kind)).toEqual(['buddy']);
    });

    it('of a Diver with a logbook are seen by every User and changed only by its Users', async () => {
      expect((await call('PATCH', `/api/divers/${annaDiver}/details`, anna, { firstName: 'Anna', lastName: 'Beispiel', email: 'anna.dives@example.com' })).statusCode).toBe(200);
      expect(await details(annaDiver, tim)).toMatchObject({ external: false, canEdit: false, email: 'anna.dives@example.com' });
      const refused = await call('PATCH', `/api/divers/${annaDiver}/details`, tim, { email: 'other@example.com' });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ code: 'diver_not_editable' });
      expect((await details(annaDiver, anna)).canEdit).toBe(true);
    });

    it('refuse what could not stand in a code', async () => {
      const bob = await external('Bob Strict');
      for (const body of [
        { firstName: 'Bo;b' }, { lastName: 'a\nb' }, { email: 'not an address' }, { email: 'a;b@example.com' },
        { leaderNumber: '12;3' }, { leaderNumber: '1 2' }, { firstName: 'x'.repeat(101) },
      ]) {
        expect((await call('PATCH', `/api/divers/${bob}/details`, tim, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await call('GET', '/api/divers/018f0000-0000-7000-8000-000000000000/details', tim)).statusCode).toBe(404);
    });

    it('write a Revision that names the changed fields but never holds the e-mail', async () => {
      const bob = await external('Bob History');
      await call('PATCH', `/api/divers/${bob}/details`, tim, { firstName: 'Bob', email: 'bob.history@example.com' });
      const rows = await t.db.select().from(revision).where(eq(revision.entityId, bob)).orderBy(revision.at, revision.id);
      const edit = [...rows].reverse().find((r) => r.cause === 'edit')!;
      expect(edit.changes).toEqual({ firstName: { from: null, to: 'Bob' }, email: { from: false, to: true } });
      expect(JSON.stringify(rows)).not.toContain('bob.history@example.com');
    });
  });

  describe('reading a person\'s code', () => {
    it('says that no Diver has the account, and lists the Divers of that name the User could give it to', async () => {
      const namesake = await external('kai lund', anna);
      await external('Kai Other');
      const answer = await read(KAI_BUDDY);
      expect(answer).toMatchObject({ kind: 'buddy', accountId: '4989164', firstName: 'Kai', lastName: 'Lund', email: 'kai@example.com', existing: null });
      expect(answer.candidates).toEqual([{ id: namesake, name: 'kai lund' }]);
    });

    it('still refuses a text that is no code', async () => {
      const refused = await call('POST', '/api/verification-codes/read', tim, { text: 'buddy;x' });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ code: 'code_not_recognised' });
    });
  });

  describe('taking a person\'s code', () => {
    let kai: string;

    it('makes a new external Diver named after the code when no Diver has the account', async () => {
      const taken = await call('POST', '/api/divers/from-code', tim, { text: KAI_BUDDY, create: true });
      expect(taken.statusCode).toBe(201);
      const created = taken.json() as Details;
      kai = created.id;
      expect(created).toMatchObject({
        name: 'Kai Lund', external: true, firstName: 'Kai', lastName: 'Lund', email: 'kai@example.com', leaderNumber: null,
        accounts: [{ source: 'ssi', externalId: '4989164' }], codes: [{ kind: 'buddy', text: KAI_BUDDY }],
      });
    });

    it('then finds that Diver by the account, with what the code would change', async () => {
      const answer = await read(KAI_PRO, anna);
      expect(answer.kind).toBe('professional');
      expect(answer.existing).toEqual({ id: kai, name: 'Kai Lund', canEdit: true, changes: [{ field: 'leaderNumber', from: null, to: '54321' }] });
      expect(answer.candidates).toEqual([]);
      expect((await read(KAI_BUDDY)).existing).toMatchObject({ id: kai, changes: [] });
    });

    it('fills the Diver that has the account instead of making a second one, and keeps its name', async () => {
      await call('PATCH', `/api/external-divers/${kai}`, tim, { name: 'Kai L.' });
      const taken = await call('POST', '/api/divers/from-code', anna, { text: KAI_PRO.replace('kai@example.com', 'kai.lund@example.com') });
      expect(taken.statusCode).toBe(200);
      expect(taken.json()).toMatchObject({ id: kai, name: 'Kai L.', email: 'kai.lund@example.com', leaderNumber: '54321' });
      expect((taken.json() as Details).codes.map((c) => c.kind)).toEqual(['buddy', 'professional']);
      const found = await json<{ divers: { id: string }[] }>('GET', '/api/divers/search?q=Kai%20L', tim);
      expect(found.divers.filter((d) => d.id === kai)).toHaveLength(1);
    });

    it('keeps a leader number when a buddy code, which has none, is taken later', async () => {
      const taken = await json<Details>('POST', '/api/divers/from-code', tim, { text: KAI_BUDDY });
      expect(taken).toMatchObject({ id: kai, email: 'kai@example.com', leaderNumber: '54321' });
    });

    it('gives the account and the details to a Diver the User chose, when that Diver has no SSI account', async () => {
      const mia = await external('Mia');
      const taken = await call('POST', '/api/divers/from-code', tim, { text: 'buddy;4512484;firstName:Mia;lastName:Stone;email:mia@example.com', diverId: mia });
      expect(taken.statusCode).toBe(200);
      expect(taken.json()).toMatchObject({ id: mia, name: 'Mia', firstName: 'Mia', lastName: 'Stone', accounts: [{ source: 'ssi', externalId: '4512484' }] });
    });

    it('asks which Diver when no Diver has the account and none was chosen', async () => {
      const undecided = await call('POST', '/api/divers/from-code', tim, { text: 'buddy;4100000;firstName:Uwe;lastName:Offen;email:uwe@example.com' });
      expect(undecided.statusCode).toBe(409);
      expect(undecided.json()).toMatchObject({ code: 'diver_choice_needed' });
    });

    it('refuses a chosen Diver when another Diver has the account, naming that one', async () => {
      const other = await external('Somebody Else');
      const refused = await call('POST', '/api/divers/from-code', tim, { text: KAI_BUDDY, diverId: other });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'diver_external_id_taken', diver: { id: kai, name: 'Kai L.' } });
    });

    it('refuses a chosen Diver that has another SSI account', async () => {
      const refused = await call('POST', '/api/divers/from-code', tim, { text: 'buddy;4200000;firstName:Kai;lastName:Lund;email:kai@example.com', diverId: kai });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'diver_has_other_account' });
    });

    it('refuses the code of a Diver whose logbook another User keeps, and a centre\'s code', async () => {
      await call('PUT', `/api/divers/${annaDiver}/external-ids/ssi`, anna, { externalId: '4300000' });
      const foreign = await call('POST', '/api/divers/from-code', tim, { text: 'buddy;4300000;firstName:Anna;lastName:Beispiel;email:new@example.com' });
      expect(foreign.statusCode).toBe(403);
      expect((await details(annaDiver)).email).toBe('anna.dives@example.com');
      expect((await read('buddy;4300000;firstName:Anna;lastName:Beispiel;email:new@example.com')).existing).toMatchObject({ id: annaDiver, canEdit: false });
      const centre = await call('POST', '/api/divers/from-code', tim, { text: 'center;700001;name:Beispiel Eins' });
      expect(centre.statusCode).toBe(400);
      expect(centre.json()).toMatchObject({ code: 'code_not_a_person' });
      expect((await call('POST', '/api/divers/from-code', tim, { text: 'nothing' })).json()).toMatchObject({ code: 'code_not_recognised' });
    });

    it('shows a professional\'s code on every Dive they are a Participant on, whatever their role', async () => {
      expect((await getDive()).verificationCodes).toEqual([]);
      const mia = (await json<{ divers: { id: string; name: string }[] }>('GET', '/api/divers/search?q=Mia', tim)).divers.find((d) => d.name === 'Mia')!.id;
      await call('PUT', `/api/dives/${diveId}/participants`, tim, {
        version: (await getDive()).version, participants: [{ diverId: kai, role: 'buddy' }, { diverId: mia, role: 'guide' }],
      });
      expect((await getDive()).verificationCodes).toEqual([
        { kind: 'professional', centre: null, diver: { id: kai, name: 'Kai L.' }, provider: 'ssi', text: KAI_PRO },
      ]);
    });

    it('moves what the code said to the kept Diver when an admin merges two, where that one lacks it, and leaves none on the merged one', async () => {
      const admin = await signIn(ctx.app, 'admin@example.com');
      const twin = (await json<Details>('POST', '/api/divers/from-code', tim, { text: 'buddy;4800000;firstName:Uta;lastName:Zwei;email:uta@example.com;leaderNr:99', create: true })).id;
      const kept = await external('Uta');
      await call('PATCH', `/api/divers/${kept}/details`, tim, { firstName: 'Uta-Maria' });
      expect((await call('POST', `/api/admin/divers/${twin}/merge`, admin, { into: kept })).statusCode).toBe(200);
      expect(await details(kept)).toMatchObject({
        firstName: 'Uta-Maria', lastName: 'Zwei', email: 'uta@example.com', leaderNumber: '99', accounts: [{ source: 'ssi', externalId: '4800000' }],
      });
      const [gone] = await t.db.select().from(diver).where(eq(diver.id, twin));
      expect(gone).toMatchObject({ mergedInto: kept, firstName: null, lastName: null, email: null, leaderNumber: null });
    });

    it('forgets the details of an external Diver that is deleted', async () => {
      const temp = (await json<Details>('POST', '/api/divers/from-code', tim, { text: 'buddy;4900000;firstName:Till;lastName:Weg;email:till@example.com', create: true })).id;
      expect((await call('DELETE', `/api/external-divers/${temp}`, tim)).statusCode).toBe(204);
      const [gone] = await t.db.select().from(diver).where(eq(diver.id, temp));
      expect(gone).toMatchObject({ firstName: null, lastName: null, email: null });
      expect(gone!.deletedAt).not.toBeNull();
    });

    it('never shows the Dive\'s own Diver\'s code there', async () => {
      await call('PUT', `/api/divers/${timDiver}/external-ids/ssi`, tim, { externalId: '4400000' });
      await call('PATCH', `/api/divers/${timDiver}/details`, tim, { firstName: 'Tim', lastName: 'Test', email: 'tim.dives@example.com', leaderNumber: '888' });
      expect((await getDive()).verificationCodes.map((c) => c.diver?.id)).toEqual([kai]);
    });
  });
});
