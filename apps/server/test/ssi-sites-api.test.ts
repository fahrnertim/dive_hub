// SSI's sites (piece 4): the logbook's privacy, `get_divesite`, `save_divesite`, against the fake SSI. The adapter marks
// a site private to the account, drops another account's, finds a site by its ID, makes a private site; a dive import
// stores an own private site private, without a Revision for its ID, and settles SSI's flag on IDs held here.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diveSiteExternalId, providerSiteData } from '../src/db/schema.js';
import { createSsiAdapter } from '../src/providers/ssi/ssi-adapter.js';
import { createSsiClient, SsiError } from '../src/providers/ssi/ssi-client.js';
import { ssiSiteRow } from '../src/providers/ssi/ssi-site-record.js';
import { accountOf, storeId } from '../src/sites/site-ids.js';
import { createFakeSsi, handTypedDive, type FakeSsiSite } from './fake-ssi.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

const ACCOUNT_A = 5_012_047;
const ACCOUNT_B = 6_100_001;
const URL_ = 'https://ssi.invalid/app/a21.php';

const site = (id: number, name: string, lat: number, extra: Partial<FakeSsiSite> = {}): FakeSsiSite =>
  ({ odin_dive_sites_id: id, odin_dive_sites_name: name, odin_dive_sites_lat: lat, odin_dive_sites_lon: 20, odin_countries_code_iso: 'EG', ...extra });

/** The keys of `siteUpload` (docs/research/2026-10-22-ssi-write-bodies.md) without the app-internal `internalPk` and `needsUpload`. */
const SITE_UPLOAD_KEYS = [
  'odin_dive_sites_id', 'odin_dive_sites_name', 'bow', 'odin_user_log_animal_ids', 'odin_dive_sites_lon', 'odin_dive_sites_lat',
  'odin_dive_sites_meta_address', 'odin_dive_sites_meta_region', 'odin_dive_sites_meta_country', 'odin_countries_code_iso',
  'odin_dive_sites_regions_name', 'odin_dive_sites_areas_name', 'odin_dive_sites_geo_locked', 'odin_dive_sites_is_private',
  'odin_dive_sites_alias_ids', 'odin_dive_sites_is_private_owner', 'odin_dive_sites_deleted', 'alias_names_search', 'alias_names',
];

describe('SSI\'s sites through the adapter', () => {
  async function setUp() {
    const fake = createFakeSsi({
      accounts: [
        { email: 'a@example.com', password: 'ssi-password', accountId: ACCOUNT_A },
        { email: 'b@example.com', password: 'ssi-password', accountId: ACCOUNT_B },
      ],
      sites: [
        site(100, 'Public Reef', 10),
        site(200, 'Own Private', 11, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_A }),
        site(300, 'Their Private', 12, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_B }),
      ],
    });
    const client = createSsiClient({ url: URL_, fetch: fake.fetch });
    const adapter = createSsiAdapter({ client });
    const { account, access } = await adapter.signIn({ kind: 'password', login: 'a@example.com', password: 'ssi-password' });
    return { fake, client, adapter, access, ctx: { connectionId: 'c1', accountId: account.id, access } };
  }

  it('lists the logbook\'s sites without another account\'s private one, and marks the own private one', async () => {
    const { adapter, ctx } = await setUp();
    const found = await adapter.diveSites!.find(ctx);
    expect(found.map((s) => [s.id, s.visibility])).toEqual([['100', 'public'], ['200', 'private']]);
    expect(found[0]).toMatchObject({ name: 'Public Reef', latitude: 10, longitude: 20, country: 'EG', waterType: null });
  });

  it('gets a site by its ID: public, private to the account, or unknown', async () => {
    const { adapter, ctx, fake } = await setUp();
    fake.sites[0]!.bow = 'fresh';
    expect(await adapter.diveSites!.get!(ctx, '100')).toMatchObject({ id: '100', name: 'Public Reef', visibility: 'public', waterType: 'fresh' });
    expect(await adapter.diveSites!.get!(ctx, '200')).toMatchObject({ id: '200', visibility: 'private' });
    expect(await adapter.diveSites!.get!(ctx, '999')).toBeNull();
    fake.sites.push(site(150, 'Gone Reef', 13, { odin_dive_sites_deleted: 1 }));
    expect(await adapter.diveSites!.get!(ctx, '150')).toBeNull();
    expect(fake.calls.filter((c) => c.what === 'get_divesite')).toHaveLength(4);
  });

  it('does not use another account\'s private site it gets', async () => {
    const { adapter, ctx } = await setUp();
    expect(await adapter.diveSites!.get!(ctx, '300')).toBeNull();
  });

  it('says "unknown" when the row SSI answers has no private flag', async () => {
    const { fake, ctx } = await setUp();
    const withoutFlag: typeof fake.fetch = async (url, init) => {
      const answer = await fake.fetch(url, init);
      if (new URL(url).searchParams.get('what') !== 'get_divesite' || answer.status !== 200) return answer;
      const [row] = JSON.parse(await answer.text()) as Record<string, unknown>[];
      delete row!.odin_dive_sites_is_private;
      return { status: 200, text: async () => JSON.stringify([row]) };
    };
    const adapter = createSsiAdapter({ client: createSsiClient({ url: URL_, fetch: withoutFlag }) });
    expect(await adapter.diveSites!.get!(ctx, '100')).toMatchObject({ visibility: 'unknown' });
  });

  it('accepts one row in an array and nothing else from get_divesite', async () => {
    const { access } = await setUp();
    const answering = (body: string, status = 200) => createSsiClient({ url: URL_, fetch: async () => ({ status, text: async () => body }) });
    expect(await answering('[{"odin_dive_sites_id":1}]').site(access, '1')).toEqual({ odin_dive_sites_id: 1 });
    expect(await answering('{"error":"nope"}', 404).site(access, '1')).toBeNull();
    for (const body of ['[]', '[{"a":1},{"a":2}]', '{"odin_dive_sites_id":1}', '[1]', '"x"']) {
      await expect(answering(body).site(access, '1'), body).rejects.toBeInstanceOf(SsiError);
    }
  });

  it('creates a private site of the account and answers its ID', async () => {
    const { adapter, ctx, fake } = await setUp();
    const id = await adapter.diveSites!.create!(ctx, { name: 'New Reef', position: { latitude: 12.5, longitude: 34.5 }, country: 'EG', waterType: 'salt' });
    expect(fake.calls.filter((c) => c.what === 'save_divesite')).toEqual([{ what: 'save_divesite', method: 'POST' }]);
    const stored = fake.sites.find((s) => String(s.odin_dive_sites_id) === id)!;
    expect(stored).toMatchObject({
      odin_dive_sites_name: 'New Reef', odin_dive_sites_lat: 12.5, odin_dive_sites_lon: 34.5, bow: 'salt',
      odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_A,
    });
    // The new site is in the logbook as the account's own private site.
    expect((await adapter.diveSites!.find(ctx)).find((s) => s.id === id)).toMatchObject({ visibility: 'private', waterType: 'salt' });
    expect(await adapter.diveSites!.get!(ctx, id)).toMatchObject({ visibility: 'private' });
  });

  it('falls back to success.New for the new ID, and refuses an answer without one', async () => {
    const { access } = await setUp();
    const answering = (body: object) => createSsiClient({ url: URL_, fetch: async () => ({ status: 200, text: async () => JSON.stringify(body) }) });
    const row = ssiSiteRow({ name: 'X', position: { latitude: 1, longitude: 2 }, country: null, waterType: null }, '5012047');
    expect(await answering({ odin_dive_sites_id: 77 }).saveSite(access, row)).toBe('77');
    expect(await answering({ success: { New: { odin_dive_sites_id: 78 } } }).saveSite(access, row)).toBe('78');
    await expect(answering({ ok: 'update saved' }).saveSite(access, row)).rejects.toMatchObject({ reason: 'refused' });
  });

  it('sends the app\'s site row: every siteUpload key, private to the account', () => {
    const row = ssiSiteRow({ name: 'New Reef', position: { latitude: 12.5, longitude: 34.5 }, country: 'EG', waterType: 'fresh' }, '5012047');
    expect(Object.keys(row).sort()).toEqual([...SITE_UPLOAD_KEYS].sort());
    expect(row).toMatchObject({
      odin_dive_sites_id: null, odin_dive_sites_name: 'New Reef', bow: 'fresh', odin_dive_sites_lat: 12.5, odin_dive_sites_lon: 34.5,
      odin_countries_code_iso: 'EGY', odin_dive_sites_is_private: true, odin_dive_sites_is_private_owner: 5_012_047, odin_dive_sites_deleted: false,
    });
    const nulls = Object.entries(row).filter(([, v]) => v === null).map(([k]) => k).sort();
    expect(nulls).toEqual(['alias_names', 'alias_names_search', 'odin_dive_sites_alias_ids', 'odin_dive_sites_areas_name',
      'odin_dive_sites_geo_locked', 'odin_dive_sites_id', 'odin_dive_sites_meta_address', 'odin_dive_sites_meta_country',
      'odin_dive_sites_meta_region', 'odin_dive_sites_regions_name', 'odin_user_log_animal_ids']);
    expect(ssiSiteRow({ name: 'X', position: { latitude: 1, longitude: 2 }, country: null, waterType: null }, '1').bow).toBeNull();
  });
});

describe.skipIf(!(await databaseReachable()))('a dive import and SSI\'s private flag', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const cookies = { a: '', b: '', admin: '' };
  const connections = { a: '', b: '' };
  const accounts = { a: '', b: '' };
  const users = { a: '', b: '', admin: '' };
  let tee: { id: string };
  let published: { id: string };

  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, who: 'a' | 'b' | 'admin', payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: cookies[who], origin: BASE_URL }, ...(payload && { payload }) });
  const makeSite = async (name: string, latitude: number) =>
    (await call('POST', '/api/dive-sites', 'admin', { name, position: { latitude, longitude: 20 } })).json() as { id: string };
  const store = (siteId: string, externalId: string, accountId: string | null) => t.db.transaction((tx) => storeId(tx, {
    siteId, source: 'ssi', externalId, accountId, actor: null,
  }));
  const rowOf = async (externalId: string) =>
    (await t.db.select().from(diveSiteExternalId).where(and(eq(diveSiteExternalId.source, 'ssi'), eq(diveSiteExternalId.externalId, externalId))))[0];
  const runImport = async (who: 'a' | 'b') => {
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connections[who]}/dive-import`, who, { computers: [], decisions: [] });
    expect(started.statusCode).toBe(202);
    await ctx.imports.processImport(started.json().id);
    const done = (await call('GET', `/api/imports/${started.json().id}`, who)).json() as { status: string; outcome: { result: string; diveId?: string }[] };
    expect(done.status).toBe('done');
    return done.outcome;
  };
  const preview = async (who: 'a' | 'b') =>
    (await call('GET', `/api/connections/${connections[who]}/dive-import`, who)).json() as {
      counts: { changed: number }; conflicts: unknown[]; sites: Record<string, number>; sitesAllowed: boolean;
    };
  // What the site's history records as changed (not its own random IDs, which may hold any digits).
  const revisionsOf = async (siteId: string) => JSON.stringify((await call('GET', `/api/dive-sites/${siteId}/revisions`, 'admin')).json<{ changes: unknown }[]>().map((r) => r.changes));

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      fakeSsi: createFakeSsi({
        accounts: [
          { email: 'a@example.com', password: 'ssi-password', accountId: ACCOUNT_A },
          { email: 'b@example.com', password: 'ssi-password', accountId: ACCOUNT_B },
        ],
        sites: [
          site(300, 'Tee Reef', 11),
          site(400, 'Own Private', 12, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_A }),
          site(500, 'Published', 13),
          site(600, 'Theirs', 14, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_B }),
          // Rows without SSI's private flag: what they are isn't known.
          site(700, 'Flagless', 15, { odin_dive_sites_is_private: null }),
          site(800, 'Flagless Held', 16, { odin_dive_sites_is_private: null }),
        ],
      }),
    });
    for (const who of ['a', 'b', 'admin'] as const) {
      users[who] = (await createUser(ctx.auth, `${who}@example.com`, who === 'admin' ? 'admin' : 'user')).id;
      cookies[who] = await signIn(ctx.app, `${who}@example.com`);
    }
    for (const who of ['a', 'b'] as const) {
      const diverId = ((await call('GET', '/api/divers', who)).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
      connections[who] = (await call('POST', '/api/connections/ssi', who, {
        diverId, login: `${who}@example.com`, password: 'ssi-password', keepSignedIn: false,
      })).json().id;
      await call('PATCH', `/api/connections/${connections[who]}`, who, { diveImport: { mode: 'create' } });
      accounts[who] = (await accountOf(t.db, diverId, 'ssi'))!;
    }
    // Tee Reef is here with A's private ID 300, which B's SSI logbook lists as public.
    tee = await makeSite('Tee Reef', 11);
    await store(tee.id, '300', accounts.a);
    // Published was A's private site here; SSI lists it as public now.
    published = await makeSite('Published', 13);
    await store(published.id, '500', accounts.a);
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('leaves a dive of B at a site that holds another account\'s private ID unchanged on every re-import', async () => {
    ctx.fakeSsi.addDive(ACCOUNT_B, handTypedDive({ at: '2026-05-01 10:00', depthM: 12, minutes: 30, siteId: 300, nr: 1 }));
    const first = await preview('b');
    expect(first.sites).toMatchObject({ known: 1, missing: 0 });
    const created = (await runImport('b')).find((o) => o.result === 'created')!;
    expect(((await call('GET', `/api/dives/${created.diveId}`, 'b')).json() as { site: { id: string } | null }).site?.id).toBe(tee.id);
    for (let i = 0; i < 2; i += 1) {
      const again = await preview('b');
      expect(again.counts).toMatchObject({ changed: 0 });
      expect(again.conflicts).toEqual([]);
      expect(again.sites).toMatchObject({ known: 1, missing: 0 });
      expect((await runImport('b')).map((o) => o.result)).not.toContain('created');
    }
    expect(await rowOf('300')).toMatchObject({ siteId: tee.id, accountId: accounts.a });
  });

  it('keeps the site count of the preview right when a private-held ID is known and creating sites is allowed', async () => {
    await t.db.insert(providerSiteData).values({ provider: 'ssi', allowedBy: users.admin });
    const view = await preview('b');
    expect(view).toMatchObject({ sitesAllowed: true, sites: { known: 1, create: 0, missing: 0 } });
  });

  it('stores a site SSI marks private and own as the account\'s private ID, without a Revision for the ID', async () => {
    ctx.fakeSsi.addDive(ACCOUNT_A, handTypedDive({ at: '2026-05-02 10:00', depthM: 12, minutes: 30, siteId: 400, nr: 1 }));
    const created = (await runImport('a')).find((o) => o.result === 'created')!;
    const view = (await call('GET', `/api/dives/${created.diveId}`, 'a')).json() as { site: { id: string; name: string } | null };
    expect(view.site?.name).toBe('Own Private');
    expect(await rowOf('400')).toMatchObject({ siteId: view.site!.id, accountId: accounts.a });
    expect(await revisionsOf(view.site!.id)).not.toContain('400');
  });

  it('stores a logbook site without the private flag of SSI as the private ID of the account, and leaves a public ID of one alone', async () => {
    const held = await makeSite('Flagless Held', 16);
    await store(held.id, '800', null);
    ctx.fakeSsi.addDive(ACCOUNT_A, handTypedDive({ at: '2026-05-04 10:00', depthM: 12, minutes: 30, siteId: 700, nr: 3 }));
    ctx.fakeSsi.addDive(ACCOUNT_A, handTypedDive({ at: '2026-05-05 10:00', depthM: 12, minutes: 30, siteId: 800, nr: 4 }));
    const outcome = await runImport('a');
    const site = (await call('GET', `/api/dives/${outcome.find((o) => o.result === 'created')!.diveId}`, 'a')).json() as { site: { id: string } | null };
    expect(await rowOf('700')).toMatchObject({ accountId: accounts.a });
    expect(site.site).not.toBeNull();
    expect(await rowOf('800')).toMatchObject({ siteId: held.id, accountId: null });
  });

  it('never stores a site SSI lists as private to another account', async () => {
    ctx.fakeSsi.addDive(ACCOUNT_A, handTypedDive({ at: '2026-05-03 10:00', depthM: 12, minutes: 30, siteId: 600, nr: 2 }));
    const created = (await runImport('a')).find((o) => o.result === 'created')!;
    expect(((await call('GET', `/api/dives/${created.diveId}`, 'a')).json() as { site: unknown }).site).toBeNull();
    expect(await rowOf('600')).toBeUndefined();
  });

  it('clears the account on a private ID SSI now lists as public (Review Focus 5)', async () => {
    await t.db.update(diveSiteExternalId).set({ accountId: accounts.a }).where(eq(diveSiteExternalId.externalId, '500'));
    expect(await rowOf('500')).toMatchObject({ accountId: accounts.a });
    await runImport('a');
    expect(await rowOf('500')).toMatchObject({ siteId: published.id, accountId: null });
    // After that every User sees it.
    const seenByB = (await call('GET', `/api/dive-sites/${published.id}`, 'b')).json() as { externalIds: { externalId: string }[] };
    expect(seenByB.externalIds.map((e) => e.externalId)).toEqual(['500']);
  });
});
