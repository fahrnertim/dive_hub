// The send's own fix for buddies (piece 5): before a Dive goes out, the entries of the User's SSI buddy list for its
// Participants are settled by SSI account only. An entry with the account is remembered; a from-scratch entry gets the
// account later; a Diver with an account and no entry gets one added; nothing is ever added from scratch on a send.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dive, diver } from '../src/db/schema.js';
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
  let connectionId = '';

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
  const send = async (diveId: string, body: object = {}) => {
    const response = await call('POST', `/api/dives/${diveId}/providers/ssi`, body);
    if (response.statusCode !== 200) throw new Error(response.body);
    return response.json() as Sent & { outcome: string };
  };
  const saves = () => ctx.fakeSsi.calls.filter((c) => c.what === 'save_buddy').map((c) => c.body as Record<string, unknown>);
  const carried = async (diveId: string) => {
    const status = (await call('GET', `/api/dives/${diveId}/providers/ssi`)).json() as { current: { remoteId: string } };
    return ctx.fakeSsi.dives.get(Number(status.current.remoteId))!.odin_user_log_buddy_ids;
  };
  const remembered = async (diverId: string) => (await rememberedFor(t.db, (await listAccountOf(t.db, owner, 'ssi'))!, [diverId])).get(diverId);
  const listAccount = async () => (await listAccountOf(t.db, owner, 'ssi'))!;
  /** Reads the list as the list page does, so the adapter keeps it for two minutes. */
  const readList = async () => expect((await call('GET', `/api/connections/${connectionId}/buddies`)).statusCode).toBe(200);
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
    connectionId = (await call('POST', '/api/connections/ssi', { diverId: owner, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: true })).json().id;
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

  it('keeps a Participant known only through a remembered entry over updates', async () => {
    ctx.fakeSsi.buddies.push(entry(5, 0, 'Pia', 'Pol'));
    const pia = await person('Pia Pol');
    await remember(t.db, (await listAccountOf(t.db, owner, 'ssi'))!, pia, '5');
    const diveId = await prepare(pia);
    await send(diveId);
    expect(await carried(diveId)).toEqual([5]);
    for (const notes of ['first', 'second']) {
      const { version } = (await call('GET', `/api/dives/${diveId}`)).json() as { version: number };
      await call('PATCH', `/api/dives/${diveId}`, { version, notes });
      ctx.ssiClock.advance(3 * 60_000);
      expect(await send(diveId)).toMatchObject({ outcome: 'updated' });
      expect(await carried(diveId)).toEqual([5]);
    }
    expect(((await call('GET', `/api/dives/${diveId}`)).json() as { participants: { diverId: string }[] }).participants.map((p) => p.diverId)).toEqual([pia]);
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

  it('adds a new entry for a corrected account and leaves the old entry in the list', async () => {
    const before = nextAccount++;
    const after = nextAccount++;
    ctx.fakeSsi.profiles.set(after, { firstname: 'Kim', lastname: 'Aal' });
    ctx.fakeSsi.buddies.push(entry(11, before, 'Kim', 'Aal'));
    const kim = await person('Kim Aal', after);
    await remember(t.db, (await listAccountOf(t.db, owner, 'ssi'))!, kim, '11');
    const diveId = await prepare(kim);
    await send(diveId);
    expect(saves()).toHaveLength(1);
    expect(saves()[0]).toMatchObject({ id: null, master_id: after });
    const made = ctx.fakeSsi.buddies.find((b) => b.buddy_master_id === after)!;
    expect(made.id).not.toBe(11);
    expect(await remembered(kim)).toBe(String(made.id));
    expect(ctx.fakeSsi.buddies.find((b) => b.id === 11)!.buddy_master_id).toBe(before);
  });

  it('reports an added entry when the answer is exists', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.profiles.set(account, { firstname: 'Uli', lastname: 'Voss' });
    const uli = await person('Uli Voss', account);
    const diveId = await prepare(uli);
    const { startsAt } = (await call('GET', `/api/dives/${diveId}`)).json().values;
    const local = new Date(Date.parse(startsAt.at) + ((startsAt.utcOffsetSeconds ?? 0) + 60) * 1000).toISOString().slice(0, 16).replace('T', ' ');
    ctx.fakeSsi.addDive(ERIKA, { odin_user_log_nr: 7, odin_user_log_datetime: local, odin_user_log_depth_m: 18, odin_user_log_divetime: 31 });
    ctx.ssiClock.advance(3 * 60_000);
    const sent = await send(diveId);
    expect(sent.outcome).toBe('exists');
    expect(sent.buddies?.added).toEqual([{ diverId: uli, name: 'Uli Voss' }]);
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

  it('carries the entry remembered for a Diver merged into the Participant', async () => {
    ctx.fakeSsi.buddies.push(entry(12, 0, 'Mia', 'Merz'));
    const gone = await person('Mia M.');
    const kept = await person('Mia Merz');
    await remember(t.db, await listAccount(), gone, '12');
    // As divers/merge.ts leaves it: deleted with merged_into, its remembered entry kept.
    await t.db.update(diver).set({ deletedAt: new Date(), mergedInto: kept }).where(eq(diver.id, gone));
    const diveId = await prepare(kept);
    await send(diveId);
    expect(saves()).toHaveLength(0);
    expect(await carried(diveId)).toEqual([12]);
    expect(await remembered(kept)).toBe('12');
  });

  it('sends the Dive without the Participant whose entry SSI refuses to save', async () => {
    const account = nextAccount++;
    const lena = await person('Lena Fehl', account);
    ctx.fakeSsi.buddies.push(entry(14, nextAccount, 'Ina', 'Da'));
    const ina = await person('Ina Da', nextAccount++);
    const diveId = await prepare(lena, ina);
    ctx.fakeSsi.failBuddySaves = true;
    try {
      const sent = await send(diveId);
      expect(sent.outcome).toBe('created');
      expect(sent.status.pushes[0]!.leftOut).toEqual([expect.objectContaining({ diverId: lena })]);
      expect(await carried(diveId)).toEqual([14]);
      expect(await remembered(lena)).toBeUndefined();
    } finally {
      ctx.fakeSsi.failBuddySaves = false;
    }
  });

  it('adds by account when the remembered entry is gone by the time it gets the account', async () => {
    const account = nextAccount++;
    ctx.fakeSsi.profiles.set(account, { firstname: 'Eva', lastname: 'Weg' });
    const gone = entry(15, 0, 'Eva', 'Weg');
    ctx.fakeSsi.buddies.push(gone);
    const eva = await person('Eva Weg', account);
    await remember(t.db, await listAccount(), eva, '15');
    const diveId = await prepare(eva);
    // The kept list still has the entry; SSI has deleted it since, so giving it the account finds none.
    await readList();
    gone.deleted = 1;
    await send(diveId);
    const made = ctx.fakeSsi.buddies.find((b) => b.buddy_master_id === account)!;
    expect(made.id).not.toBe(15);
    expect(saves()).toEqual([expect.objectContaining({ id: null, master_id: account })]);
    expect(await remembered(eva)).toBe(String(made.id));
    expect(await carried(diveId)).toEqual([made.id]);
  });

  it('forgets a remembered entry only when a fresh read misses it too', async () => {
    await readList();
    // Added by another process: in SSI's list and remembered, but not in the list the adapter keeps.
    ctx.fakeSsi.buddies.push(entry(16, 0, 'Nia', 'Neu'));
    const nia = await person('Nia Neu');
    await remember(t.db, await listAccount(), nia, '16');
    const diveId = await prepare(nia);
    await send(diveId);
    expect(await remembered(nia)).toBe('16');
    expect(await carried(diveId)).toEqual([16]);
  });

  it('names an added entry after the Diver when SSI answers it without a name', async () => {
    // No profile: SSI answers the entry of the account before it has the name.
    const ola = await person('Ola Ohne', nextAccount++);
    const diveId = await prepare(ola);
    const sent = await send(diveId);
    expect(sent.buddies?.added).toEqual([{ diverId: ola, name: 'Ola Ohne' }]);
  });
});
