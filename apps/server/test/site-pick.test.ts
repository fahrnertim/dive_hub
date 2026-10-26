// Picking or typing a site's ID through the Connection (piece 4, Task 5): the Provider is asked about the ID first.
// Public → stored public (with a Revision); the account's own private → stored private; another account's private or an
// unknown or deleted ID → provider_site_unknown, nothing stored; a Provider that doesn't say, or can't be asked → private,
// never public (Review Focus 4). Clearing removes only the account's private row.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { diveSiteExternalId, revision } from '../src/db/schema.js';
import { accountOf, storeId } from '../src/sites/site-ids.js';
import { createFakeSsi, type FakeSsiSite } from './fake-ssi.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

const ACCOUNT_X = 5_012_047;
const ACCOUNT_Y = 6_100_001;

describe.skipIf(!(await databaseReachable()))('picking a site ID through the Connection', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let ann: string;
  let connectionTim = '';
  let account = '';
  let n = 0;

  const call = (method: 'GET' | 'PUT', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const newSite = async (name: string) =>
    ((await ctx.app.inject({
      method: 'POST', url: '/api/dive-sites', headers: { cookie: tim, origin: BASE_URL },
      payload: { name, position: { latitude: 30 + n++, longitude: 30 }, waterType: 'salt' },
    })).json() as { id: string }).id;
  const ssiSite = (id: number, extra: Partial<FakeSsiSite> = {}) => ctx.fakeSsi.sites.push({
    odin_dive_sites_id: id, odin_dive_sites_name: `Reef ${id}`, odin_dive_sites_lat: 10, odin_dive_sites_lon: 30, odin_countries_code_iso: 'EGY', ...extra,
  });
  const pick = (siteId: string, externalId: string | null, cookie = tim, connection = connectionTim) =>
    call('PUT', `/api/connections/${connection}/dive-sites/${siteId}`, cookie, { externalId });
  const rowsOf = (siteId: string) => t.db.select({ externalId: diveSiteExternalId.externalId, accountId: diveSiteExternalId.accountId })
    .from(diveSiteExternalId).where(eq(diveSiteExternalId.siteId, siteId));
  const revisionsOf = async (siteId: string) =>
    (await t.db.select().from(revision).where(and(eq(revision.entityType, 'dive_site'), eq(revision.entityId, siteId)))).filter((r) => r.cause === 'edit');

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      fakeSsi: createFakeSsi({
        accounts: [
          { email: 'tim@example.com', password: 'ssi-password', accountId: ACCOUNT_X },
          { email: 'ann@example.com', password: 'ssi-password', accountId: ACCOUNT_Y },
        ],
        sites: [],
      }),
    });
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'ann@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    const diverOf = async (cookie: string) => ((await call('GET', '/api/divers', cookie)).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    const connect = async (cookie: string, login: string) => {
      const diverId = await diverOf(cookie);
      const made = await ctx.app.inject({
        method: 'POST', url: '/api/connections/ssi', headers: { cookie, origin: BASE_URL },
        payload: { diverId, login, password: 'ssi-password', keepSignedIn: true },
      });
      return { id: (made.json() as { id: string }).id, diverId };
    };
    const own = await connect(tim, 'tim@example.com');
    connectionTim = own.id;
    account = (await accountOf(t.db, own.diverId, 'ssi'))!;
    await connect(ann, 'ann@example.com');
  });
  beforeEach(() => {
    ctx.fakeSsi.failWith = null;
    ctx.fakeSsi.calls.length = 0;
    // SSI's logbook read is kept for two minutes; each test changes the fake's sites behind Dive Hub's back.
    ctx.ssiClock.advance(3 * 60_000);
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('stores an ID SSI calls public as a public ID, with a Revision', async () => {
    const site = await newSite('Public');
    ssiSite(4101, { odin_dive_sites_is_private: 0 });
    const response = await pick(site, '4101');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ externalId: '4101', private: false });
    expect(await rowsOf(site)).toEqual([{ externalId: '4101', accountId: null }]);
    expect(await revisionsOf(site)).toHaveLength(1);
  });

  it('takes the form SSI shows the ID in', async () => {
    const site = await newSite('Typed');
    ssiSite(4102, { odin_dive_sites_is_private: 0 });
    expect((await pick(site, 'site:4102')).json()).toEqual({ externalId: '4102', private: false });
    expect(await rowsOf(site)).toEqual([{ externalId: '4102', accountId: null }]);
  });

  it('stores the account\'s own private site as private to the account, without a Revision', async () => {
    const site = await newSite('Mine');
    ssiSite(4103, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_X });
    expect((await pick(site, '4103')).json()).toEqual({ externalId: '4103', private: true });
    expect(await rowsOf(site)).toEqual([{ externalId: '4103', accountId: account }]);
    expect(await revisionsOf(site)).toHaveLength(0);
  });

  it('refuses another account\'s private site, an unknown ID and a deleted site, and stores nothing', async () => {
    const site = await newSite('Nobody');
    ssiSite(4104, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_Y });
    ssiSite(4105, { odin_dive_sites_is_private: 0, odin_dive_sites_deleted: 1 });
    for (const id of ['4104', '4999', '4105']) {
      const response = await pick(site, id);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'provider_site_unknown', provider: 'ssi', providerName: 'SSI' });
    }
    expect(await rowsOf(site)).toEqual([]);
    expect(await t.db.select().from(diveSiteExternalId).where(eq(diveSiteExternalId.externalId, '4104'))).toEqual([]);
  });

  it('stores a site SSI gives no private flag for as private, never public', async () => {
    const site = await newSite('Flagless');
    ssiSite(4106, { odin_dive_sites_is_private: null });
    expect((await pick(site, '4106')).json()).toEqual({ externalId: '4106', private: true });
    expect(await rowsOf(site)).toEqual([{ externalId: '4106', accountId: account }]);
  });

  it('stores the ID private, never public, when SSI can\'t be asked', async () => {
    const site = await newSite('Offline');
    ssiSite(4107, { odin_dive_sites_is_private: 0 });
    ctx.fakeSsi.failWith = 503;
    expect((await pick(site, '4107')).json()).toEqual({ externalId: '4107', private: true });
    expect(await rowsOf(site)).toEqual([{ externalId: '4107', accountId: account }]);
  });

  it('refuses an ID another site holds', async () => {
    const site = await newSite('Second');
    const holder = await newSite('Holder');
    ssiSite(4108, { odin_dive_sites_is_private: 0 });
    await t.db.transaction((tx) => storeId(tx, { siteId: holder, source: 'ssi', externalId: '4108', accountId: null, actor: null }));
    const response = await pick(site, '4108');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'external_id_taken' });
    expect(await rowsOf(site)).toEqual([]);
  });

  it('clears the account\'s private ID only, and nothing when there is none', async () => {
    const site = await newSite('Clearing');
    await t.db.transaction(async (tx) => {
      await storeId(tx, { siteId: site, source: 'ssi', externalId: '4109', accountId: null, actor: null });
      await storeId(tx, { siteId: site, source: 'ssi', externalId: '4110', accountId: account, actor: null });
    });
    expect((await pick(site, null)).json()).toEqual({ externalId: null, private: false });
    expect(await rowsOf(site)).toEqual([{ externalId: '4109', accountId: null }]);
    expect((await pick(site, null)).statusCode).toBe(200);
    expect(await rowsOf(site)).toEqual([{ externalId: '4109', accountId: null }]);
    expect(ctx.fakeSsi.calls.filter((c) => c.what === 'get_divesite')).toEqual([]);
  });

  it('is for the User\'s own Connections and live sites', async () => {
    const site = await newSite('Guarded');
    ssiSite(4111, { odin_dive_sites_is_private: 0 });
    const response = await pick(site, '4111', ann);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'connection_not_found' });
    expect((await pick('00000000-0000-4000-8000-000000000000', '4111')).json()).toMatchObject({ code: 'site_not_found' });
    expect(await rowsOf(site)).toEqual([]);
  });
});
