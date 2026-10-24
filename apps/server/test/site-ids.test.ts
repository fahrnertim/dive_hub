// The site IDs of one Source, public and private (ADR 0057): who sees which, which one a send uses, and the one
// module that reads and writes the table.
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diveSite, diveSiteExternalId, diver, diverExternalId, revision } from '../src/db/schema.js';
import { SiteError } from '../src/sites/site-error.js';
import {
  accountOf, accountsOfUser, clearId, holderOf, idsOf, nearbyMatch, pickId, settleVisibility, storeId, type SiteIdRow,
} from '../src/sites/site-ids.js';
import { createTestDatabase, databaseReachable, type TestDatabase } from './support.js';

const row = (externalId: string, accountId: string | null): SiteIdRow => ({ source: 'ssi', externalId, accountId, providesData: false, imported: null });

describe('pickId', () => {
  const mine = 'account-1';
  it("takes the remote dive's site ID when it is one of the rows, public or private", () => {
    expect(pickId([row('1', null), row('2', mine)], 'ssi', mine, '2')).toBe('2');
    expect(pickId([row('1', null), row('2', mine)], 'ssi', mine, '1')).toBe('1');
  });
  it('takes the public ID, else the private one', () => {
    expect(pickId([row('2', mine), row('1', null)], 'ssi', mine)).toBe('1');
    expect(pickId([row('2', mine)], 'ssi', mine)).toBe('2');
    expect(pickId([], 'ssi', mine)).toBeNull();
  });
  it('ignores a remote that is not among the rows', () => {
    expect(pickId([row('1', null), row('2', mine)], 'ssi', mine, '9')).toBe('1');
  });
  it("never takes another account's row, nor another Source's", () => {
    expect(pickId([row('3', 'account-2')], 'ssi', mine, '3')).toBeNull();
    expect(pickId([row('3', 'account-2'), row('2', mine)], 'ssi', mine)).toBe('2');
    expect(pickId([{ ...row('1', null), source: 'osm' }], 'ssi', mine)).toBeNull();
    expect(pickId([row('2', mine)], 'ssi', null)).toBeNull();
  });
});

describe('nearbyMatch', () => {
  const remote = (externalId: string, name: string, metres: number) => ({ externalId, name, latitude: 10 + metres / 111_195, longitude: 20 });
  const site = { name: 'Blue Hole', position: { latitude: 10, longitude: 20 } };
  it('matches within 100 m with a matching name', () => {
    expect(nearbyMatch(site, [remote('1', 'The Blue Hole', 99)])?.externalId).toBe('1');
  });
  it('does not match at 101 m, with another name, or without a position', () => {
    expect(nearbyMatch(site, [remote('1', 'The Blue Hole', 101)])).toBeUndefined();
    expect(nearbyMatch(site, [remote('1', 'Reef', 10)])).toBeUndefined();
    expect(nearbyMatch(site, [{ externalId: '1', name: 'Blue Hole', latitude: null, longitude: null }])).toBeUndefined();
  });
  it('takes the nearer of two matches', () => {
    expect(nearbyMatch(site, [remote('far', 'Blue Hole', 80), remote('near', 'Blue Hole', 20)])?.externalId).toBe('near');
  });
});

describe.skipIf(!(await databaseReachable()))('the site ID table', () => {
  let t: TestDatabase;
  let tim: string;
  let anna: string;
  let timDiver: string;
  let annaDiver: string;
  let timAccount: string;
  let annaAccount: string;

  const newSite = async (name: string) => (await t.db.insert(diveSite).values({ name }).returning({ id: diveSite.id }))[0]!.id;
  const revisions = async (siteId: string) => t.db.select().from(revision).where(and(eq(revision.entityType, 'dive_site'), eq(revision.entityId, siteId)));
  const actor = () => ({ type: 'user' as const, id: tim });

  beforeAll(async () => {
    t = await createTestDatabase();
    const user = async (email: string) => (await t.pool.query(`insert into "user" (name, email, email_verified) values ($1, $1, true) returning id`, [email])).rows[0].id as string;
    tim = await user('tim@example.com');
    anna = await user('anna@example.com');
    timDiver = (await t.db.insert(diver).values({ name: 'Tim' }).returning({ id: diver.id }))[0]!.id;
    annaDiver = (await t.db.insert(diver).values({ name: 'Anna' }).returning({ id: diver.id }))[0]!.id;
    await t.pool.query(`insert into diver_management (user_id, diver_id, is_own) values ($1, $2, true), ($3, $4, true)`, [tim, timDiver, anna, annaDiver]);
    timAccount = (await t.db.insert(diverExternalId).values({ diverId: timDiver, source: 'ssi', externalId: '111' }).returning({ id: diverExternalId.id }))[0]!.id;
    annaAccount = (await t.db.insert(diverExternalId).values({ diverId: annaDiver, source: 'ssi', externalId: '222' }).returning({ id: diverExternalId.id }))[0]!.id;
  });
  afterAll(async () => { await t?.drop(); });

  it('finds the account of a Diver and the accounts of the Divers a User manages', async () => {
    expect(await accountOf(t.db, timDiver, 'ssi')).toBe(timAccount);
    expect(await accountOf(t.db, timDiver, 'osm')).toBeNull();
    expect(await accountsOfUser(t.db, tim, 'ssi')).toEqual([timAccount]);
    expect(await accountsOfUser(t.db, anna)).toEqual([annaAccount]);
  });

  it('stores a public ID with a Revision and a private one without', async () => {
    const a = await newSite('Public');
    const b = await newSite('Private');
    await t.db.transaction(async (tx) => {
      await storeId(tx, { siteId: a, source: 'ssi', externalId: '10', accountId: null, actor: actor() });
      await storeId(tx, { siteId: b, source: 'ssi', externalId: '11', accountId: timAccount, actor: actor() });
    });
    expect(await revisions(a)).toHaveLength(1);
    expect((await revisions(a))[0]!.changes).toEqual({ ssiSiteId: { from: null, to: '10' } });
    expect(await revisions(b)).toHaveLength(0);
  });

  it('replaces the row of the same site, Source and account, and clears it', async () => {
    const s = await newSite('Replaced');
    await t.db.transaction(async (tx) => {
      await storeId(tx, { siteId: s, source: 'ssi', externalId: '20', accountId: timAccount, actor: null });
      await storeId(tx, { siteId: s, source: 'ssi', externalId: '21', accountId: timAccount, actor: null });
    });
    expect((await idsOf(t.db, [s], [timAccount])).get(s)).toMatchObject([{ externalId: '21', accountId: timAccount }]);
    expect(await t.db.transaction((tx) => clearId(tx, s, 'ssi', timAccount, actor()))).toBe('21');
    expect((await idsOf(t.db, [s], [timAccount])).get(s)).toBeUndefined();
    expect(await t.db.transaction((tx) => clearId(tx, s, 'ssi', timAccount, actor()))).toBeNull();
  });

  it("refuses an ID another site holds, and an account of another Source", async () => {
    const a = await newSite('Holder');
    const b = await newSite('Wanter');
    await t.db.transaction((tx) => storeId(tx, { siteId: a, source: 'ssi', externalId: '30', accountId: annaAccount, actor: null }));
    await expect(t.db.transaction((tx) => storeId(tx, { siteId: b, source: 'ssi', externalId: '30', accountId: null, actor: actor() })))
      .rejects.toMatchObject({ code: 'external_id_taken' });
    await expect(t.db.transaction((tx) => storeId(tx, { siteId: b, source: 'ssi', externalId: '30', accountId: timAccount, actor: null })))
      .rejects.toBeInstanceOf(SiteError);
    await expect(t.db.transaction((tx) => storeId(tx, { siteId: b, source: 'osm', externalId: 'node/1', accountId: timAccount, actor: null })))
      .rejects.toThrow();
    expect(await holderOf(t.db, 'ssi', '30')).toEqual({ siteId: a, accountId: annaAccount, deleted: false });
    expect(await holderOf(t.db, 'ssi', '999')).toBeNull();
  });

  it("returns the public rows and only the given accounts' private ones", async () => {
    const s = await newSite('Visible');
    await t.db.transaction(async (tx) => {
      await storeId(tx, { siteId: s, source: 'ssi', externalId: '40', accountId: null, actor: null });
      await storeId(tx, { siteId: s, source: 'ssi', externalId: '41', accountId: timAccount, actor: null });
      await storeId(tx, { siteId: s, source: 'ssi', externalId: '42', accountId: annaAccount, actor: null });
    });
    const ids = (accounts: string[]) => idsOf(t.db, [s], accounts).then((m) => (m.get(s) ?? []).map((r) => r.externalId).sort());
    expect(await ids([])).toEqual(['40']);
    expect(await ids([timAccount])).toEqual(['40', '41']);
    expect(await ids([timAccount, annaAccount])).toEqual(['40', '41', '42']);
    expect((await idsOf(t.db, [], [timAccount])).size).toBe(0);
  });

  it("settles visibility to what the Source says, for the account only", async () => {
    const [a, b, c] = [await newSite('Settle A'), await newSite('Settle B'), await newSite('Settle C')];
    await t.db.transaction(async (tx) => {
      await storeId(tx, { siteId: a!, source: 'ssi', externalId: '50', accountId: null, actor: null });
      await storeId(tx, { siteId: b!, source: 'ssi', externalId: '51', accountId: timAccount, actor: null });
      await storeId(tx, { siteId: c!, source: 'ssi', externalId: '52', accountId: annaAccount, actor: null });
    });
    const rows = async () => Object.fromEntries((await t.db.select().from(diveSiteExternalId).where(inArray(diveSiteExternalId.siteId, [a!, b!, c!]))).map((r) => [r.externalId, r.accountId]));
    await t.db.transaction((tx) => settleVisibility(tx, 'ssi', timAccount, [
      { externalId: '50', private: true }, { externalId: '51', private: false }, { externalId: '52', private: false },
    ]));
    expect(await rows()).toEqual({ '50': timAccount, '51': null, '52': annaAccount });
    await t.db.transaction((tx) => settleVisibility(tx, 'ssi', timAccount, [{ externalId: '99', private: true }, { externalId: '52', private: true }]));
    expect(await rows()).toEqual({ '50': timAccount, '51': null, '52': annaAccount });
  });
});
