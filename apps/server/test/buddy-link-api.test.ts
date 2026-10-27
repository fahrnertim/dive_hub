// Link or add an entry of the User's SSI buddy list for a Diver (piece 5): the list sorted by who matches, a link of an
// entry with or without an account, an add of a typed person or a scanned code, an import of an entry without an
// account, and that another User sees none of it.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { diver as diverTable } from '../src/db/schema.js';
import { listAccountOf, rememberedFor } from '../src/providers/list-entries.js';
import { createFakeSsi, type FakeSsiBuddy } from './fake-ssi.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

const ERIKA = 5_012_047;
const entry = (id: number, account: number, firstname: string, lastname: string, email = ''): FakeSsiBuddy => ({
  owner: ERIKA, id, buddy_master_id: account, firstname, lastname, email, dob: '0000-00-00', phone: ' ', city: '',
});

type View = { entryId: string; name: string; account: string | null; diver: { id: string; name: string } | null; matches: boolean };

describe.skipIf(!(await databaseReachable()))('link or add a list entry for a Diver', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let other: string;
  let owner: string;
  let connectionId: string;
  let nextEntry = 100;
  let nextAccount = 4_800_000;

  const as = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => as(tim, method, url, payload);
  const person = async (name: string) => ((await call('POST', '/api/external-divers', { name })).json() as { id: string }).id;
  const list = async (forDiver?: string) => {
    const response = await call('GET', `/api/connections/${connectionId}/buddies${forDiver ? `?for=${forDiver}` : ''}`);
    return { body: response.body, buddies: (response.json() as { buddies: View[] }).buddies };
  };
  const saves = () => ctx.fakeSsi.calls.filter((c) => c.what === 'save_buddy').map((c) => c.body as Record<string, unknown>);
  const details = async (id: string, cookie = tim) =>
    (await ctx.app.inject({ method: 'GET', url: `/api/divers/${id}/details`, headers: { cookie } })).json() as
      { email: string | null; name: string; firstName: string | null; lastName: string | null; accounts: { source: string; externalId: string }[] };
  const remembered = async (diverId: string) => (await rememberedFor(t.db, (await listAccountOf(t.db, owner, 'ssi'))!, [diverId])).get(diverId);

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { fakeSsi: createFakeSsi({ accounts: [{ email: 'erika@example.com', password: 'ssi-password', accountId: ERIKA }] }) });
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'other@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    other = await signIn(ctx.app, 'other@example.com');
    owner = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    connectionId = (await call('POST', '/api/connections/ssi', { diverId: owner, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: true })).json().id;
  });
  beforeEach(() => {
    // SSI's reads are kept for two minutes; each test changes the fake's list behind Dive Hub's back.
    ctx.ssiClock.advance(3 * 60_000);
    ctx.fakeSsi.calls.length = 0;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('lists matching entries first, without e-mail', async () => {
    ctx.fakeSsi.buddies.push(entry(1, 0, 'Anna', 'Alt'), entry(2, 0, 'samuel', 'dreier'), entry(3, 0, 'Zoe', 'Zed'));
    const samuel = await person('Samuel Dreier');
    const { body, buddies } = await list(samuel);
    const mine = buddies.filter((b) => ['1', '2', '3'].includes(b.entryId));
    expect(mine.map((b) => b.name)).toEqual(['samuel dreier', 'Anna Alt', 'Zoe Zed']);
    expect(mine.map((b) => b.matches)).toEqual([true, false, false]);
    expect(buddies[0]!.entryId).toBe('2');
    expect(body).not.toContain('"email"');
    expect((await list()).buddies.every((b) => !b.matches)).toBe(true);
  });

  it('matches by e-mail, ignoring case and spaces', async () => {
    ctx.fakeSsi.buddies.push(entry(4, 0, 'Quite', 'Different', 'Mail@Example.com'));
    const mail = await person('Someone Else');
    await call('PATCH', `/api/divers/${mail}/details`, { email: ' mail@example.com ' });
    const { buddies } = await list(mail);
    expect(buddies.find((b) => b.entryId === '4')!.matches).toBe(true);
  });

  it('links an entry without an account and remembers it', async () => {
    const id = nextEntry++;
    ctx.fakeSsi.buddies.push(entry(id, 0, 'Nora', 'Null'));
    const nora = await person('Nora Null');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/link`, { entryId: String(id), diverId: nora });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ diverId: nora });
    expect(await remembered(nora)).toBe(String(id));
    expect((await details(nora)).accounts).toEqual([]);
    const shown = (await list()).buddies.find((b) => b.entryId === String(id))!;
    expect(shown).toMatchObject({ account: null, diver: { id: nora, name: 'Nora Null' } });
  });

  it('still shows an entry as linked when it got an account no Diver has', async () => {
    const id = nextEntry++;
    const linked = entry(id, 0, 'Rita', 'Spät');
    ctx.fakeSsi.buddies.push(linked);
    const rita = await person('Rita Spät');
    await call('POST', `/api/connections/${connectionId}/buddies/link`, { entryId: String(id), diverId: rita });
    // The account came later, given at SSI: no Diver here has it.
    const account = nextAccount++;
    linked.buddy_master_id = account;
    ctx.ssiClock.advance(3 * 60_000);
    expect((await list()).buddies.find((b) => b.entryId === String(id))).toMatchObject({ account: String(account), diver: { id: rita } });
    // So the Import makes no second Diver of it.
    const imported = await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: [String(account)] });
    expect(imported.json()).toMatchObject({ created: 0 });
  });

  it('shows an entry remembered for a merged-away Diver as linked to the Diver it went into', async () => {
    const id = nextEntry++;
    ctx.fakeSsi.buddies.push(entry(id, 0, 'Mara', 'Mohn'));
    const gone = await person('Mara M.');
    const kept = await person('Mara Mohn');
    await call('POST', `/api/connections/${connectionId}/buddies/link`, { entryId: String(id), diverId: gone });
    // As divers/merge.ts leaves it: deleted with merged_into, its remembered entry kept.
    await t.db.update(diverTable).set({ deletedAt: new Date(), mergedInto: kept }).where(eq(diverTable.id, gone));
    expect((await list()).buddies.find((b) => b.entryId === String(id))).toMatchObject({ diver: { id: kept, name: 'Mara Mohn' } });
  });

  it('answers provider_buddy_not_found for an entry not in the list', async () => {
    const nora = await person('Nobody Here');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/link`, { entryId: '987654', diverId: nora });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('provider_buddy_not_found');
  });

  it('links an entry with an account: the Diver gets the account', async () => {
    const account = nextAccount++;
    const id = nextEntry++;
    ctx.fakeSsi.buddies.push(entry(id, account, 'Ida', 'Ahorn'));
    const ida = await person('Ida Ahorn');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/link`, { entryId: String(id), diverId: ida });
    expect(response.statusCode).toBe(200);
    expect((await details(ida)).accounts).toEqual([{ source: 'ssi', externalId: String(account) }]);
    expect(await remembered(ida)).toBe(String(id));
  });

  it('answers diver_external_id_taken when another Diver has the entry\'s account', async () => {
    const account = nextAccount++;
    const id = nextEntry++;
    ctx.fakeSsi.buddies.push(entry(id, account, 'Ben', 'Birke'));
    const holder = await person('Ben Birke');
    await call('PUT', `/api/divers/${holder}/external-ids/ssi`, { externalId: String(account) });
    const another = await person('Benny B');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/link`, { entryId: String(id), diverId: another });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'diver_external_id_taken', diver: { id: holder, name: 'Ben Birke' } });
    expect(await remembered(another)).toBeUndefined();
  });

  it('adds a typed person, fills what the Diver lacks, shared with every User', async () => {
    const diver = await person('Samuel Dreier');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/add`, {
      diverId: diver, firstName: 'Dive Hub', lastName: 'test', email: 't@example.com',
    });
    expect(response.statusCode).toBe(200);
    expect(saves()).toHaveLength(1);
    expect(saves()[0]).toMatchObject({ id: null, firstname: 'Dive Hub', lastname: 'test', email: 't@example.com' });
    const made = ctx.fakeSsi.buddies.find((b) => b.firstname === 'Dive Hub')!;
    expect(response.json()).toEqual({ added: { diverId: diver, name: 'Dive Hub test' }, knownAs: null });
    expect(await remembered(diver)).toBe(String(made.id));
    expect(await details(diver, other)).toMatchObject({ name: 'Samuel Dreier', email: 't@example.com', firstName: 'Dive Hub', lastName: 'test' });
  });

  it('adds a person without an e-mail', async () => {
    const diver = await person('Lone Wolf');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/add`, { diverId: diver, firstName: 'Lone', lastName: 'Wolf', email: null });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ added: { diverId: diver, name: 'Lone Wolf' }, knownAs: null });
    expect((await details(diver)).email).toBeNull();
  });

  it('adds a scanned code: the Diver gets the account, the entry is added by account', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.profiles.set(account, { firstname: 'Skan', lastname: 'Code' });
    const diver = await person('Skan Code');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/add`, {
      diverId: diver, firstName: 'Skan', lastName: 'Code', email: 'skan@example.com', account: String(account),
    });
    expect(response.statusCode).toBe(200);
    expect(saves()).toHaveLength(1);
    expect(saves()[0]).toMatchObject({ id: null, master_id: account });
    expect((await details(diver)).accounts).toEqual([{ source: 'ssi', externalId: String(account) }]);
    expect(await remembered(diver)).toBe(String(ctx.fakeSsi.buddies.find((b) => b.buddy_master_id === account)!.id));
  });

  it('says whom SSI knows a scanned account as when the name differs', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.profiles.set(account, { firstname: 'Real', lastname: 'Person' });
    const diver = await person('Someone Typed');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/add`, { diverId: diver, firstName: 'Someone', lastName: 'Typed', account: String(account) });
    expect(response.json()).toEqual({ added: { diverId: diver, name: 'Real Person' }, knownAs: 'Real Person' });
  });

  it('does not count an answered entry without a name as another name', async () => {
    const account = nextAccount++;
    const diver = await person('Not Yet Filled');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/add`, { diverId: diver, firstName: 'Not', lastName: 'Filled', account: String(account) });
    expect(response.json()).toMatchObject({ added: { name: '' }, knownAs: null });
  });

  it('an add for an account already in the list links that entry', async () => {
    const account = nextAccount++;
    const id = nextEntry++;
    ctx.fakeSsi.buddies.push(entry(id, account, 'Vera', 'Vogel'));
    const diver = await person('Vera Vogel');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/add`, {
      diverId: diver, firstName: 'Vera', lastName: 'Vogel', account: String(account),
    });
    expect(response.statusCode).toBe(200);
    expect(saves()).toHaveLength(0);
    expect(response.json()).toEqual({ added: { diverId: diver, name: 'Vera Vogel' }, knownAs: null });
    expect(await remembered(diver)).toBe(String(id));
  });

  it('refuses an account that is not digits', async () => {
    const diver = await person('Bad Code');
    const response = await call('POST', `/api/connections/${connectionId}/buddies/add`, { diverId: diver, firstName: 'Bad', lastName: 'Code', account: '12ab' });
    expect(response.statusCode).toBe(400);
  });

  it('imports an entry without an account as a Diver and remembers it', async () => {
    const id = nextEntry++;
    ctx.fakeSsi.buddies.push(entry(id, 0, 'Imo', 'Port', 'imo@example.com'));
    const first = await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: [], entries: [String(id)] });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ created: 1 });
    const shown = (first.json() as { buddies: View[] }).buddies.find((b) => b.entryId === String(id))!;
    expect(shown.diver?.name).toBe('Imo Port');
    expect(await remembered(shown.diver!.id)).toBe(String(id));
    expect(await details(shown.diver!.id)).toMatchObject({ email: 'imo@example.com', firstName: 'Imo', lastName: 'Port' });
    // Once remembered, a second import makes no second Diver.
    ctx.ssiClock.advance(3 * 60_000);
    const again = await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: [], entries: [String(id)] });
    expect(again.json()).toMatchObject({ created: 0 });
  });

  it('another User gets connection_not_found and sees no remembered entry', async () => {
    const diver = await person('Hidden Link');
    const id = nextEntry++;
    ctx.fakeSsi.buddies.push(entry(id, 0, 'Hidden', 'Link'));
    await call('POST', `/api/connections/${connectionId}/buddies/link`, { entryId: String(id), diverId: diver });
    const base = `/api/connections/${connectionId}/buddies`;
    for (const response of [
      await as(other, 'GET', `${base}?for=${diver}`),
      await as(other, 'POST', `${base}/link`, { entryId: String(id), diverId: diver }),
      await as(other, 'POST', `${base}/add`, { diverId: diver, firstName: 'A', lastName: 'B' }),
      await as(other, 'POST', `${base}/import`, { accounts: [], entries: [String(id)] }),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('connection_not_found');
    }
    expect(saves()).toHaveLength(0);
  });
});
