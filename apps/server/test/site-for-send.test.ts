// The send finds or creates the Dive's site at the Provider (piece 4): a Dive at a site with a position and no SSI site
// ID is sent with a logbook site nearby (stored public or private as SSI marks it), else with a private site the send
// makes there (stored private). A retried send, a Push run and a failed dive save make no second site (Review Focus 2);
// a User managing two Divers with their own SSI accounts never sends one's private ID for the other (Review Focus 3).
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dive, diveSiteExternalId } from '../src/db/schema.js';
import { siteForSend } from '../src/providers/site-for-send.js';
import { createSsiAdapter } from '../src/providers/ssi/ssi-adapter.js';
import { createSsiClient } from '../src/providers/ssi/ssi-client.js';
import { accountOf, storeId } from '../src/sites/site-ids.js';
import { createFakeSsi, type FakeSsiSite } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase } from './support.js';

const ACCOUNT_X = 5_012_047;
const ACCOUNT_Y = 6_100_001;
/** About 55 m north. */
const NEAR = 0.0005;

describe.skipIf(!(await databaseReachable()))('the send finds or creates the site', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  const divers = { x: '', y: '' };
  const accounts = { x: '', y: '' };
  let connectionX = '';
  let day = 1;

  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  /** A Dive of the Diver on a day of its own (no other dive at SSI at the same time). */
  const newDive = async (who: 'x' | 'y' = 'x') => {
    const start = new Date(Date.UTC(2000, 0, day++, 9));
    const { payload, headers } = multipartFile(`${start.getTime()}.fit`, makeSyntheticDive({ start, serialNumber: 4242 }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    const id = ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: { diveId: string }[] }).outcome[0]!.diveId;
    if (who === 'y') await t.db.update(dive).set({ diverId: divers.y }).where(eq(dive.id, id));
    return id;
  };
  const newSite = async (name: string, latitude: number) =>
    ((await call('POST', '/api/dive-sites', { name, position: { latitude, longitude: 30 }, waterType: 'salt' })).json() as { id: string }).id;
  const atSite = (diveId: string, siteId: string) => t.db.update(dive).set({ siteId }).where(eq(dive.id, diveId));
  const ssiSite = (id: number, name: string, latitude: number, extra: Partial<FakeSsiSite> = {}) => ctx.fakeSsi.sites.push({
    odin_dive_sites_id: id, odin_dive_sites_name: name, odin_dive_sites_lat: latitude, odin_dive_sites_lon: 30, odin_countries_code_iso: 'EGY', ...extra,
  });
  const send = (diveId: string, body: object = {}) => call('POST', `/api/dives/${diveId}/providers/ssi`, body);
  const rowsOf = (siteId: string) => t.db.select({ externalId: diveSiteExternalId.externalId, accountId: diveSiteExternalId.accountId })
    .from(diveSiteExternalId).where(eq(diveSiteExternalId.siteId, siteId));
  const siteSaves = () => ctx.fakeSsi.calls.filter((c) => c.what === 'save_divesite').length;
  /** The SSI site ID the dive at SSI points at. */
  const ssiSiteOf = (remoteId: string) => String(ctx.fakeSsi.dives.get(Number(remoteId))!.odin_user_log_dive_sites_id);
  const sentId = async (diveId: string) => {
    const status = (await call('GET', `/api/dives/${diveId}/providers/ssi`)).json() as { current: { remoteId: string } | null };
    return status.current!.remoteId;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      fakeSsi: createFakeSsi({
        accounts: [
          { email: 'x@example.com', password: 'ssi-password', accountId: ACCOUNT_X },
          { email: 'y@example.com', password: 'ssi-password', accountId: ACCOUNT_Y },
        ],
        sites: [],
      }),
    });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    divers.x = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    divers.y = ((await call('POST', '/api/divers', { name: 'Lena' })).json() as { id: string }).id;
    for (const who of ['x', 'y'] as const) {
      const connection = (await call('POST', '/api/connections/ssi', {
        diverId: divers[who], login: `${who}@example.com`, password: 'ssi-password', keepSignedIn: true,
      })).json() as { id: string };
      if (who === 'x') connectionX = connection.id;
      accounts[who] = (await accountOf(t.db, divers[who], 'ssi'))!;
    }
  });
  beforeEach(() => {
    ctx.fakeSsi.calls.length = 0;
    ctx.fakeSsi.dropSaves = false;
    ctx.fakeSsi.expireAfterSiteSave = false;
    // SSI's logbook read is kept for two minutes; each test changes the fake's sites behind Dive Hub's back.
    ctx.ssiClock.advance(3 * 60_000);
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('sends with a public logbook site nearby, stored public, without making a site', async () => {
    const site = await newSite('Blue Hole', 10);
    ssiSite(4001, 'Blue Hole', 10 + NEAR);
    const diveId = await newDive();
    await atSite(diveId, site);
    const status = (await call('GET', `/api/dives/${diveId}/providers/ssi`)).json() as { unmet: unknown[] };
    expect(status.unmet).toEqual([expect.objectContaining({ type: 'site_external_id', siteId: site, bySend: true })]);
    const response = await send(diveId);
    expect(response.json()).toMatchObject({ outcome: 'created' });
    expect(await rowsOf(site)).toEqual([{ externalId: '4001', accountId: null }]);
    expect(ssiSiteOf(await sentId(diveId))).toBe('4001');
    expect(siteSaves()).toBe(0);
  });

  it('stores the account\'s own private logbook site private', async () => {
    const site = await newSite('Coral Garden', 11);
    ssiSite(4002, 'Coral Garden', 11 + NEAR, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_X });
    const diveId = await newDive();
    await atSite(diveId, site);
    expect((await send(diveId)).json()).toMatchObject({ outcome: 'created' });
    expect(await rowsOf(site)).toEqual([{ externalId: '4002', accountId: accounts.x }]);
    expect(ssiSiteOf(await sentId(diveId))).toBe('4002');
  });

  it('makes a private site at SSI when none is nearby, stores it private and sends with it', async () => {
    const site = await newSite('Lonely Reef', 12);
    const diveId = await newDive();
    await atSite(diveId, site);
    expect((await send(diveId)).json()).toMatchObject({ outcome: 'created' });
    expect(siteSaves()).toBe(1);
    const made = ctx.fakeSsi.sites.at(-1)!;
    expect(made).toMatchObject({ odin_dive_sites_name: 'Lonely Reef', odin_dive_sites_lat: 12, odin_dive_sites_lon: 30, odin_dive_sites_is_private: 1 });
    const id = String(made.odin_dive_sites_id);
    expect(await rowsOf(site)).toEqual([{ externalId: id, accountId: accounts.x }]);
    expect(ssiSiteOf(await sentId(diveId))).toBe(id);
  });

  it('stores a logbook site nearby without the private flag of SSI private, never public', async () => {
    const site = await newSite('Flagless Reef', 19);
    ssiSite(4010, 'Flagless Reef', 19 + NEAR, { odin_dive_sites_is_private: null });
    const diveId = await newDive();
    await atSite(diveId, site);
    expect((await send(diveId)).json()).toMatchObject({ outcome: 'created' });
    expect(await rowsOf(site)).toEqual([{ externalId: '4010', accountId: accounts.x }]);
    expect(siteSaves()).toBe(0);
  });

  it('makes one site for two sends of different Dives at one new site at the same time', async () => {
    const site = await newSite('Twice Reef', 20);
    const adapter = createSsiAdapter({ client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: ctx.fakeSsi.fetch }) });
    const { account, access } = await adapter.signIn({ kind: 'password', login: 'x@example.com', password: 'ssi-password' });
    const once = () => siteForSend(t.db, {
      adapter, context: { connectionId: connectionX, accountId: account.id, access }, diverId: divers.x, siteId: site, source: 'ssi',
      actor: { type: 'user', id: 'tim' },
    });
    expect((await Promise.all([once(), once()])).sort()).toEqual(['created', 'had']);
    expect(siteSaves()).toBe(1);
    expect(await rowsOf(site)).toEqual([{ externalId: String(ctx.fakeSsi.sites.at(-1)!.odin_dive_sites_id), accountId: accounts.x }]);
  });

  it('skips a logbook site nearby whose ID another site here holds, and makes one', async () => {
    const site = await newSite('Canyon', 13);
    const other = await newSite('Canyon North', 13.5);
    await t.db.transaction((tx) => storeId(tx, { siteId: other, source: 'ssi', externalId: '4004', accountId: null, actor: null }));
    ssiSite(4004, 'Canyon', 13 + NEAR);
    const diveId = await newDive();
    await atSite(diveId, site);
    expect((await send(diveId)).json()).toMatchObject({ outcome: 'created' });
    expect(siteSaves()).toBe(1);
    const [row] = await rowsOf(site);
    expect(row).toMatchObject({ accountId: accounts.x });
    expect(row!.externalId).not.toBe('4004');
  });

  it('makes no second site when SSI signs out after making it and the send is retried', async () => {
    const site = await newSite('Retry Reef', 14);
    const diveId = await newDive();
    await atSite(diveId, site);
    ctx.fakeSsi.expireAfterSiteSave = true;
    expect((await send(diveId)).json()).toMatchObject({ outcome: 'created' });
    expect(ctx.fakeSsi.calls.filter((c) => c.what === 'authenticate')).toHaveLength(1);
    expect(siteSaves()).toBe(1);
    const [row] = await rowsOf(site);
    expect(ssiSiteOf(await sentId(diveId))).toBe(row!.externalId);
  });

  it('makes one site for a Push run of two Dives at one new site', async () => {
    const site = await newSite('Run Reef', 15);
    const first = await newDive();
    const second = await newDive();
    await atSite(first, site);
    await atSite(second, site);
    const started = await call('POST', `/api/connections/${connectionX}/push-runs`, { dives: { ids: [first, second] } });
    expect(started.statusCode).toBe(202);
    while (await ctx.providers.pushRuns.step(started.json().id));
    expect(siteSaves()).toBe(1);
    const [row] = await rowsOf(site);
    expect(ssiSiteOf(await sentId(first))).toBe(row!.externalId);
    expect(ssiSiteOf(await sentId(second))).toBe(row!.externalId);
  });

  it('keeps the made site\'s ID when the dive save fails, and the next send makes none', async () => {
    const site = await newSite('Failing Reef', 16);
    const diveId = await newDive();
    await atSite(diveId, site);
    ctx.fakeSsi.dropSaves = true;
    expect((await send(diveId)).json()).toMatchObject({ code: 'provider_not_stored' });
    ctx.fakeSsi.dropSaves = false;
    const [row] = await rowsOf(site);
    expect(row).toMatchObject({ accountId: accounts.x });
    expect((await send(diveId)).json()).toMatchObject({ outcome: 'created' });
    expect(siteSaves()).toBe(1);
    expect(ssiSiteOf(await sentId(diveId))).toBe(row!.externalId);
  });

  it('never sends one managed Diver\'s private ID for another: the other\'s send makes its own', async () => {
    const site = await newSite('Twin Reef', 17);
    ssiSite(4008, 'Twin Reef', 17, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_X });
    await t.db.transaction((tx) => storeId(tx, { siteId: site, source: 'ssi', externalId: '4008', accountId: accounts.x, actor: null }));
    const diveId = await newDive('y');
    await atSite(diveId, site);
    expect((await send(diveId)).json()).toMatchObject({ outcome: 'created' });
    expect(siteSaves()).toBe(1);
    const own = (await rowsOf(site)).find((r) => r.accountId === accounts.y)!;
    expect(own.externalId).not.toBe('4008');
    expect((await rowsOf(site)).find((r) => r.accountId === accounts.x)).toEqual({ externalId: '4008', accountId: accounts.x });
    const sent = ctx.fakeSsi.dives.get(Number(await sentId(diveId)))!;
    expect(sent.odin_user_log_user_master_id).toBe(ACCOUNT_Y);
    expect(String(sent.odin_user_log_dive_sites_id)).toBe(own.externalId);
  });

  it('updates a dive whose site at SSI is the site\'s private ID with that ID, though a public one exists', async () => {
    const site = await newSite('Duo Reef', 18);
    ssiSite(4091, 'Duo Reef', 18);
    ssiSite(4092, 'Duo Reef', 18 + NEAR, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_X });
    await t.db.transaction(async (tx) => {
      await storeId(tx, { siteId: site, source: 'ssi', externalId: '4091', accountId: null, actor: null });
      await storeId(tx, { siteId: site, source: 'ssi', externalId: '4092', accountId: accounts.x, actor: null });
    });
    const diveId = await newDive();
    await atSite(diveId, site);
    expect((await send(diveId)).json()).toMatchObject({ outcome: 'created' });
    const remoteId = await sentId(diveId);
    expect(ssiSiteOf(remoteId)).toBe('4091');
    // The User moves the dive to the private site in SSI's app, then changes the notes here.
    ctx.fakeSsi.dives.get(Number(remoteId))!.odin_user_log_dive_sites_id = 4092;
    ctx.ssiClock.advance(3 * 60_000);
    const { version } = (await call('GET', `/api/dives/${diveId}`)).json() as { version: number };
    expect((await call('PATCH', `/api/dives/${diveId}`, { version, notes: 'Turtles' })).statusCode).toBe(200);
    const updated = (await send(diveId)).json() as { outcome: string; taken: string[]; deferred: string[] };
    expect(updated).toMatchObject({ outcome: 'updated', deferred: [] });
    expect(updated.taken).not.toContain('site');
    expect(ssiSiteOf(remoteId)).toBe('4092');
    expect(await t.db.select().from(diveSiteExternalId).where(and(eq(diveSiteExternalId.siteId, site), eq(diveSiteExternalId.externalId, '4092'))))
      .toHaveLength(1);
  });
});
