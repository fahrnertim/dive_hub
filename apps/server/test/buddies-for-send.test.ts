// The send's own fix for buddies (piece 5): before a Dive goes out, the entries of the User's SSI buddy list for its
// Participants are settled by SSI account only. An entry with the account is remembered; a from-scratch entry gets the
// account later; a Diver with an account and no entry gets one added; nothing is ever added from scratch on a send.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dive } from '../src/db/schema.js';
import { foldName } from '../src/providers/buddies-for-send.js';
import { listAccountOf, remember, rememberedFor } from '../src/providers/list-entries.js';
import { createFakeSsi, type FakeSsiBuddy } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase } from './support.js';

const ERIKA = 5_012_047;
const entry = (id: number, account: number, firstname: string, lastname: string): FakeSsiBuddy => ({
  owner: ERIKA, id, buddy_master_id: account, firstname, lastname, email: '', dob: '0000-00-00', phone: ' ', city: '',
});

type Sent = { buddies?: { added: { diverId: string; name: string }[]; knownAs: { diverId: string; diverName: string; name: string }[] } | null; status: { pushes: { leftOut: { diverId: string; reason: string }[] | null }[] } };

describe.skipIf(!(await databaseReachable()))('the send settles the buddy list', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let owner: string;
  let day = 1;
  let nextAccount = 4_600_000;
  let site = '';

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const newDive = async () => {
    const start = new Date(Date.UTC(2001, 0, day++, 9));
    const { payload, headers } = multipartFile(`${start.getTime()}.fit`, makeSyntheticDive({ start, serialNumber: 4242 }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    const id = ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: { diveId: string }[] }).outcome[0]!.diveId;
    const { version } = (await call('GET', `/api/dives/${id}`)).json() as { version: number };
    await call('PATCH', `/api/dives/${id}`, { version, siteId: site });
    return id;
  };
  /** An external Diver, with an SSI account when `account` is given. */
  const person = async (name: string, account?: number) => {
    const id = ((await call('POST', '/api/external-divers', { name })).json() as { id: string }).id;
    if (account) await call('PUT', `/api/divers/${id}/external-ids/ssi`, { externalId: String(account) });
    return id;
  };
  const withOn = async (diveId: string, people: { diverId: string; role: string }[]) => {
    const { version } = (await call('GET', `/api/dives/${diveId}`)).json() as { version: number };
    expect((await call('PUT', `/api/dives/${diveId}/participants`, { version, participants: people })).statusCode).toBe(200);
  };
  const send = async (diveId: string) => { const r = await call("POST", `/api/dives/${diveId}/providers/ssi`, {}); if (r.statusCode !== 200) throw new Error(r.body); return r.json() as Sent & { outcome: string }; };
  const saves = () => ctx.fakeSsi.calls.filter((c) => c.what === 'save_buddy').map((c) => c.body as Record<string, unknown>);
  const carried = async (diveId: string) => {
    const status = (await call('GET', `/api/dives/${diveId}/providers/ssi`)).json() as { current: { remoteId: string } };
    return ctx.fakeSsi.dives.get(Number(status.current.remoteId))!.odin_user_log_buddy_ids;
  };
  const remembered = async (diverId: string) => (await rememberedFor(t.db, (await listAccountOf(t.db, owner, 'ssi'))!, [diverId])).get(diverId);
  /** A fresh Dive with these Participants (as buddies), the fake's calls cleared. */
  const prepare = async (...ids: string[]) => {
    const diveId = await newDive();
    await withOn(diveId, ids.map((diverId) => ({ diverId, role: 'buddy' })));
    ctx.fakeSsi.calls.length = 0;
    return diveId;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { fakeSsi: createFakeSsi({ accounts: [{ email: 'erika@example.com', password: 'ssi-password', accountId: ERIKA }] }) });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    owner = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    await call('POST', '/api/connections/ssi', { diverId: owner, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: true });
    // The site has its SSI ID, so only the buddies are in question.
    site = ((await call('POST', '/api/dive-sites', { name: 'Hausreef' })).json() as { id: string }).id;
    await call('PUT', `/api/dive-sites/${site}/external-ids/ssi`, { externalId: '3314' });
  });
  beforeEach(() => {
    // SSI's reads are kept for two minutes; each test changes the fake's list behind Dive Hub's back.
    ctx.ssiClock.advance(3 * 60_000);
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('folds a name: trimmed, lower case, without accents', () => {
    expect(foldName('  Zoë Ähre ')).toBe('zoe ahre');
  });

  it('adds an entry by SSI account and remembers it', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.profiles.set(account, { firstname: 'Lena', lastname: 'Berg' });
    const lena = await person('Lena Berg', account);
    const diveId = await prepare(lena);
    const sent = await send(diveId);
    expect(saves()).toHaveLength(1);
    expect(saves()[0]).toMatchObject({ id: null, master_id: account, needsUpload: 1, deleted: 0 });
    const made = ctx.fakeSsi.buddies.find((b) => b.buddy_master_id === account)!;
    expect(await carried(diveId)).toEqual([made.id]);
    expect(await remembered(lena)).toBe(String(made.id));
    expect(sent.buddies).toEqual({ added: [{ diverId: lena, name: 'Lena Berg' }], knownAs: [] });
  });

  it('remembers the entry that has the account and adds nothing', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.buddies.push(entry(9, account, 'Ina', 'Roth'));
    const ina = await person('Ina Roth', account);
    const diveId = await prepare(ina);
    const sent = await send(diveId);
    expect(saves()).toHaveLength(0);
    expect(await remembered(ina)).toBe('9');
    expect(await carried(diveId)).toEqual([9]);
    expect(sent.buddies ?? null).toBeNull();
  });

  it('gives a from-scratch entry the account later', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.profiles.set(account, { firstname: 'Dora', lastname: 'Dee' });
    ctx.fakeSsi.buddies.push(entry(2, 0, 'Dora', 'Dee'));
    const dora = await person('Dora Dee', account);
    await remember(t.db, (await listAccountOf(t.db, owner, 'ssi'))!, dora, '2');
    const diveId = await prepare(dora);
    await send(diveId);
    expect(saves()).toHaveLength(1);
    expect(saves()[0]).toMatchObject({ id: 2, master_id: account });
    expect(ctx.fakeSsi.buddies.filter((b) => b.buddy_master_id === account)).toHaveLength(1);
    expect(await carried(diveId)).toEqual([2]);
    expect(await remembered(dora)).toBe('2');
  });

  it('prefers the entry with the account over a remembered one without', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.buddies.push(entry(3, 0, 'Ole', 'Nord'), entry(10, account, 'Ole', 'Nord'));
    const ole = await person('Ole Nord', account);
    await remember(t.db, (await listAccountOf(t.db, owner, 'ssi'))!, ole, '3');
    const diveId = await prepare(ole);
    await send(diveId);
    expect(saves()).toHaveLength(0);
    expect(await remembered(ole)).toBe('10');
    expect(ctx.fakeSsi.buddies.some((b) => b.id === 3)).toBe(true);
    expect(await carried(diveId)).toEqual([10]);
  });

  it('forgets a remembered entry SSI no longer lists', async () => {
    ctx.fakeSsi.buddies.push({ ...entry(4, 0, 'Gone', 'Away'), deleted: 1 });
    const gone = await person('Gone Away');
    await remember(t.db, (await listAccountOf(t.db, owner, 'ssi'))!, gone, '4');
    const diveId = await prepare(gone);
    // Without an account and an entry the Dive can't be sent with this Participant: it is left out, not refused.
    const sent = await send(diveId);
    expect(await remembered(gone)).toBeUndefined();
    expect(saves()).toHaveLength(0);
    expect(sent.status.pushes[0]!.leftOut).toEqual([expect.objectContaining({ diverId: gone, reason: 'no_reference' })]);
  });

  // A Diver is on a Dive once (its primary key), so "twice" is a second send of the same Dive.
  it('adds one entry for a Diver across two sends', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.profiles.set(account, { firstname: 'Pia', lastname: 'Kern' });
    const pia = await person('Pia Kern', account);
    const diveId = await prepare(pia);
    await send(diveId);
    const second = await send(diveId);
    expect(saves()).toHaveLength(1);
    expect(second.buddies ?? null).toBeNull();
  });

  it('says whom SSI knows the account as when the names differ', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.profiles.set(account, { firstname: 'Samuel', lastname: 'Dreier' });
    const lena = await person('Lena Berg', account);
    const diveId = await prepare(lena);
    const sent = await send(diveId);
    expect(sent.buddies?.knownAs).toEqual([{ diverId: lena, diverName: 'Lena Berg', name: 'Samuel Dreier' }]);
    expect(await remembered(lena)).toBeDefined();
  });

  it('never adds from scratch on a send', async () => {
    const nobody = await person('No Account');
    const diveId = await prepare(nobody);
    const sent = await send(diveId);
    expect(saves()).toHaveLength(0);
    expect(sent.status.pushes[0]!.leftOut).toEqual([expect.objectContaining({ diverId: nobody, reason: 'no_reference' })]);
    expect(await remembered(nobody)).toBeUndefined();
    expect((await t.db.select().from(dive).where(eq(dive.id, diveId)))[0]).toBeDefined();
  });
});
