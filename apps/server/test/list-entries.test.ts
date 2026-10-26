// Remembered list entries (ADR 0057, piece 5): which entry of an account's own list (SSI's buddy list) stands for which
// Diver. One entry per account and Diver, an entry ID once per account; the last link wins; no Revision is written.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountListEntry, diver, diverExternalId, revision } from '../src/db/schema.js';
import { forget, listAccountOf, remember, rememberedEntries, rememberedFor } from '../src/providers/list-entries.js';
import { createTestDatabase, databaseReachable, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('remembered list entries', () => {
  let t: TestDatabase;
  const divers: string[] = [];
  const accounts: string[] = [];

  beforeAll(async () => {
    t = await createTestDatabase();
    for (const name of ['Tim', 'Anna', 'Ben']) {
      divers.push((await t.db.insert(diver).values({ name }).returning({ id: diver.id }))[0]!.id);
    }
    // Tim and Anna have SSI accounts; Ben has none.
    for (const [i, externalId] of ['111', '222'].entries()) {
      accounts.push((await t.db.insert(diverExternalId).values({ diverId: divers[i]!, source: 'ssi', externalId }).returning({ id: diverExternalId.id }))[0]!.id);
    }
  });
  afterAll(async () => { await t?.drop(); });

  it('finds the list owner account of a Diver at a source', async () => {
    expect(await listAccountOf(t.db, divers[0]!, 'ssi')).toBe(accounts[0]);
    expect(await listAccountOf(t.db, divers[2]!, 'ssi')).toBeNull();
    expect(await listAccountOf(t.db, divers[0]!, 'padi')).toBeNull();
  });

  it('remembers one entry per account and Diver', async () => {
    const [a] = accounts, [d1] = divers;
    await remember(t.db, a!, d1!, '11');
    await remember(t.db, a!, d1!, '12');
    expect(await rememberedFor(t.db, a!, [d1!])).toEqual(new Map([[d1, '12']]));
    expect(await rememberedFor(t.db, a!, [])).toEqual(new Map());
    await forget(t.db, a!, d1!);
    expect(await rememberedFor(t.db, a!, [d1!])).toEqual(new Map());
  });

  it('moves an entry to the Diver it is linked to last', async () => {
    const [a] = accounts, [d1, d2] = divers;
    await remember(t.db, a!, d1!, '11');
    await remember(t.db, a!, d2!, '11');
    expect(await rememberedEntries(t.db, a!)).toEqual(new Map([['11', d2]]));
    expect(await rememberedFor(t.db, a!, [d1!, d2!])).toEqual(new Map([[d2, '11']]));
    await forget(t.db, a!, d2!);
  });

  it('keeps lists of two accounts apart', async () => {
    const [a, b] = accounts, [d1, d2] = divers;
    await remember(t.db, a!, d1!, '11');
    await remember(t.db, b!, d2!, '11');
    expect(await rememberedEntries(t.db, a!)).toEqual(new Map([['11', d1]]));
    expect(await rememberedEntries(t.db, b!)).toEqual(new Map([['11', d2]]));
    await forget(t.db, a!, d1!);
    await forget(t.db, b!, d2!);
  });

  it('goes with the account', async () => {
    const extra = (await t.db.insert(diverExternalId).values({ diverId: divers[2]!, source: 'ssi', externalId: '333' }).returning({ id: diverExternalId.id }))[0]!.id;
    await remember(t.db, extra, divers[0]!, '5');
    await t.db.delete(diverExternalId).where(eq(diverExternalId.id, extra));
    expect(await t.db.select().from(accountListEntry).where(eq(accountListEntry.accountId, extra))).toEqual([]);
  });

  it('writes no Revision', async () => {
    const count = async () => (await t.db.select().from(revision)).length;
    const before = await count();
    await remember(t.db, accounts[0]!, divers[0]!, '21');
    await remember(t.db, accounts[0]!, divers[1]!, '21');
    await forget(t.db, accounts[0]!, divers[1]!);
    expect(await count()).toBe(before);
  });
});
