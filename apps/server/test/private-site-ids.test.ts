// Private SSI site IDs (ADR 0057, piece 4): no User sees another SSI account's private site ID through any reader (the
// site page and list, the MCP site tools, a dive import, a merge's history, the site import), and a send picks the ID by
// the rule (the remote dive's, else public, else the account's private one). Two Users, each with a Diver connected to
// their own SSI account (fake). Site S has the public ID 100 and A's private 200; site T only A's private 300.
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/db/client.js';
import { dive, diveSiteExternalId } from '../src/db/schema.js';
import { getSite, searchSites } from '../src/mcp/tools-sites.js';
import { loadOutgoingDive } from '../src/providers/outgoing-dive.js';
import type { SiteSourceAdapter, SourceSite } from '../src/sites/import/site-source.js';
import { siteForProvider } from '../src/sites/provider-sites.js';
import { accountOf, storeId } from '../src/sites/site-ids.js';
import { createFakeSsi, handTypedDive } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, unreachable, type TestDatabase,
} from './support.js';

const ACCOUNT_A = 5_012_047;
const ACCOUNT_B = 6_100_001;

type ExternalId = { source: string; externalId: string; privateTo: { diverId: string } | null };
type Site = { id: string; name: string; version: number; externalIds: ExternalId[] };
type Revision = { cause: string; changes: Record<string, unknown> };

describe.skipIf(!(await databaseReachable()))('private SSI site IDs', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ssiAnswer: SourceSite[] = [];
  const ssiSource: SiteSourceAdapter = { source: 'ssi', fetch: async () => ssiAnswer };
  const users = { a: '', b: '', admin: '' };
  const cookies = { a: '', b: '', admin: '' };
  const divers = { a: '', b: '' };
  const accounts = { a: '', b: '' };
  let connectionB = '';
  let s: Site;
  let tSite: Site;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const site = async (name: string, position: { latitude: number; longitude: number }) =>
    (await call('POST', '/api/dive-sites', cookies.a, { name, position })).json() as Site;
  const siteAs = async (who: 'a' | 'b', id: string) => (await call('GET', `/api/dive-sites/${id}`, cookies[who])).json() as Site;
  const ids = (x: Site) => x.externalIds.map((e) => e.externalId).sort();
  const store = (siteId: string, externalId: string, accountId: string | null) => t.db.transaction((tx) => storeId(tx, {
    siteId, source: 'ssi', externalId, accountId, actor: null, providesData: true,
    imported: { name: 'From SSI', position: null, country: null, waterBody: null, description: null, maxDepthM: null, waterType: null },
  }));
  const upload = async (who: 'a' | 'b', start: string) => {
    const { payload, headers } = multipartFile(`${start}.fit`, makeSyntheticDive({ start: new Date(start), serialNumber: who === 'a' ? 1111 : 2222 }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: cookies[who] } });
    await ctx.imports.processImport(created.json().id);
    return ((await call('GET', `/api/imports/${created.json().id}`, cookies[who])).json() as { outcome: { diveId: string }[] }).outcome[0]!.diveId;
  };
  const atSite = (diveId: string, siteId: string) => t.db.update(dive).set({ siteId }).where(eq(dive.id, diveId));
  const ssiIdOf = async (userId: string, diveId: string, remoteSiteIds?: { ssi: string }) =>
    (await loadOutgoingDive(t.db, userId, diveId, remoteSiteIds ? { remoteSiteIds } : {})).outgoing.siteIds.ssi ?? null;
  const toolContext = (who: 'a' | 'b') => ({ tx: t.db as unknown as Tx, userId: users[who], diverIds: [divers[who]], positions: false });

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      siteSources: { osm: unreachable('osm'), wikidata: unreachable('wikidata'), ssi: ssiSource },
      fakeSsi: createFakeSsi({
        accounts: [
          { email: 'a@example.com', password: 'ssi-password', accountId: ACCOUNT_A },
          { email: 'b@example.com', password: 'ssi-password', accountId: ACCOUNT_B },
        ],
        sites: [{ odin_dive_sites_id: 300, odin_dive_sites_name: 'Tee Reef', odin_dive_sites_lat: 11, odin_dive_sites_lon: 21, odin_countries_code_iso: 'EG' }],
      }),
    });
    for (const who of ['a', 'b', 'admin'] as const) {
      users[who] = (await createUser(ctx.auth, `${who}@example.com`, who === 'admin' ? 'admin' : 'user')).id;
      cookies[who] = await signIn(ctx.app, `${who}@example.com`);
    }
    for (const who of ['a', 'b'] as const) {
      divers[who] = ((await call('GET', '/api/divers', cookies[who])).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
      const connection = (await call('POST', '/api/connections/ssi', cookies[who], {
        diverId: divers[who], login: `${who}@example.com`, password: 'ssi-password', keepSignedIn: false,
      })).json() as { id: string };
      if (who === 'b') connectionB = connection.id;
      accounts[who] = (await accountOf(t.db, divers[who], 'ssi'))!;
    }
    s = await site('Ess Reef', { latitude: 10, longitude: 20 });
    tSite = await site('Tee Reef', { latitude: 11, longitude: 21 });
    await store(s.id, '100', null);
    await store(s.id, '200', accounts.a);
    await store(tSite.id, '300', accounts.a);
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('shows a site\'s private ID only to the Users of its account', async () => {
    expect((await siteAs('b', s.id)).externalIds).toEqual([expect.objectContaining({ externalId: '100', privateTo: null })]);
    expect((await siteAs('a', s.id)).externalIds).toEqual([
      expect.objectContaining({ externalId: '100', privateTo: null }),
      expect.objectContaining({ externalId: '200', privateTo: { diverId: divers.a } }),
    ]);
    expect(ids(await siteAs('b', tSite.id))).toEqual([]);
  });

  it('leaves another account\'s private IDs out of the site list', async () => {
    const list = (await call('GET', '/api/dive-sites?limit=200', cookies.b)).json() as { sites: Site[] };
    const all = list.sites.flatMap(ids);
    expect(all).toContain('100');
    expect(all).not.toContain('200');
    expect(all).not.toContain('300');
    const own = (await call('GET', '/api/dive-sites?limit=200', cookies.a)).json() as { sites: Site[] };
    expect(own.sites.flatMap(ids)).toEqual(expect.arrayContaining(['100', '200', '300']));
  });

  it('leaves another account\'s private IDs out of the MCP site tools', async () => {
    const search = async (who: 'a' | 'b') => (await searchSites.run(toolContext(who), { dived_only: false, detail: 'detailed', limit: 50 } as never)).output as {
      sites: { id: string; sources?: string[] }[];
    };
    const sourcesAt = (out: { sites: { id: string; sources?: string[] }[] }, id: string) => out.sites.find((x) => x.id === id)!.sources;
    expect(sourcesAt(await search('b'), tSite.id)).toEqual([]);
    expect(sourcesAt(await search('a'), tSite.id)).toEqual(['SSI']);
    const got = async (who: 'a' | 'b', id: string) => ((await getSite.run(toolContext(who), { site_id: id })).output as { sources: unknown[] }).sources;
    expect(await got('b', tSite.id)).toEqual([]);
    expect(await got('b', s.id)).toHaveLength(1);
    expect(await got('a', tSite.id)).toHaveLength(1);
  });

  it('sends with the account\'s ID by the rule, never another account\'s', async () => {
    const aAtT = await upload('a', '2026-04-01T08:00:00Z');
    const aAtS = await upload('a', '2026-04-02T08:00:00Z');
    const bAtT = await upload('b', '2026-04-03T08:00:00Z');
    await atSite(aAtT, tSite.id);
    await atSite(aAtS, s.id);
    await atSite(bAtT, tSite.id);
    expect(await ssiIdOf(users.b, bAtT)).toBeNull();
    expect(await ssiIdOf(users.a, aAtT)).toBe('300');
    expect(await ssiIdOf(users.a, aAtS)).toBe('100');
    expect(await ssiIdOf(users.a, aAtS, { ssi: '200' })).toBe('200');
    await t.db.update(dive).set({ siteId: null }).where(eq(dive.id, bAtT));
  });

  it('finds the site of another account\'s private ID in a dive import, writing nothing for it', async () => {
    await call('PATCH', `/api/connections/${connectionB}`, cookies.b, { diveImport: { mode: 'create' } });
    ctx.fakeSsi.addDive(ACCOUNT_B, handTypedDive({ at: '2026-05-01 10:00', depthM: 12, minutes: 30, siteId: 300, nr: 1 }));
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionB}/dive-import`, cookies.b, { computers: [], decisions: [] });
    expect(started.statusCode).toBe(202);
    await ctx.imports.processImport(started.json().id);
    const done = (await call('GET', `/api/imports/${started.json().id}`, cookies.b)).json() as { outcome: { result: string; diveId?: string }[] };
    const created = done.outcome.find((o) => o.result === 'created')!;
    const view = (await call('GET', `/api/dives/${created.diveId}`, cookies.b)).json() as { site: { id: string } | null };
    expect(view.site?.id).toBe(tSite.id);
    const rows = await t.db.select().from(diveSiteExternalId).where(and(eq(diveSiteExternalId.source, 'ssi'), eq(diveSiteExternalId.externalId, '300')));
    expect(rows).toEqual([expect.objectContaining({ siteId: tSite.id, accountId: accounts.a })]);
    expect(ids(await siteAs('b', tSite.id))).toEqual([]);
  });

  it('merges by Source and account: the kept site\'s row wins, private rows move without a Revision', async () => {
    const kept = await site('Kept', { latitude: 30, longitude: 30 });
    const gone = await site('Gone', { latitude: 30.001, longitude: 30 });
    await store(kept.id, '101', null);
    await store(kept.id, '201', accounts.a);
    await store(gone.id, '301', accounts.a);
    await store(gone.id, '401', accounts.b);
    const k = await siteAs('a', kept.id);
    const g = await siteAs('a', gone.id);
    const merged = await call('POST', `/api/dive-sites/${gone.id}/merge`, cookies.a, { intoId: kept.id, version: g.version, intoVersion: k.version });
    expect(merged.statusCode).toBe(200);
    expect(ids(await siteAs('a', kept.id))).toEqual(['101', '201']);
    expect(ids(await siteAs('b', kept.id))).toEqual(['101', '401']);
    const left = await t.db.select().from(diveSiteExternalId).where(eq(diveSiteExternalId.siteId, gone.id));
    expect(left.map((r) => r.externalId)).toEqual(['301']);
    const revisions = (await call('GET', `/api/dive-sites/${kept.id}/revisions`, cookies.a)).json() as Revision[];
    const merge = revisions.find((r) => r.cause === 'merge')!;
    expect(merge.changes).not.toHaveProperty('ssiSiteId');
    expect(JSON.stringify(merge)).not.toMatch(/"(201|301|401)"/);
  });

  it('keeps a Provider\'s private site for the account, without naming its ID in the site\'s history', async () => {
    const actor = { type: 'user' as const, id: users.b };
    const provider = (externalId: string, latitude: number) => ({
      source: 'ssi' as const, externalId, name: 'Bee Reef', position: { latitude, longitude: 50 }, country: null, waterType: null,
      account: accounts.b, private: true,
    });
    // A site here with A's private ID at SSI still matches for B: A's ID doesn't block it.
    const near = await site('Bee Reef', { latitude: 50, longitude: 50 });
    await store(near.id, '600', accounts.a);
    const matched = await t.db.transaction((tx) => siteForProvider(tx, provider('601', 50), { allowCreate: false, userId: users.b, actor }));
    expect(matched).toBe(near.id);
    const created = (await t.db.transaction((tx) => siteForProvider(tx, provider('602', 51), { allowCreate: true, userId: users.b, actor })))!;
    const rows = await t.db.select().from(diveSiteExternalId).where(and(eq(diveSiteExternalId.source, 'ssi'), inArray(diveSiteExternalId.externalId, ['601', '602'])));
    expect(rows.map((r) => [r.externalId, r.siteId, r.accountId]).sort()).toEqual([['601', near.id, accounts.b], ['602', created, accounts.b]]);
    for (const id of [near.id, created]) {
      const history = (await call('GET', `/api/dive-sites/${id}/revisions`, cookies.b)).json() as Revision[];
      expect(JSON.stringify(history)).not.toMatch(/"60[12]"|ssiSiteId/);
    }
    expect(ids(await siteAs('a', created))).toEqual([]);
  });

  it('makes a private ID public when a site import finds SSI published it', async () => {
    const u = await site('You Reef', { latitude: 40, longitude: 40 });
    await store(u.id, '500', accounts.a);
    ssiAnswer = [{
      source: 'ssi', externalId: '500', sameAs: {},
      values: { name: 'You Reef', position: { latitude: 40, longitude: 40 }, country: 'EG', waterBody: null, description: null, maxDepthM: null, waterType: null },
    }];
    const started = await call('POST', '/api/admin/site-imports', cookies.admin, {
      sources: ['ssi'], area: { kind: 'country', country: 'EG' }, language: 'en', confirmSsi: true,
    });
    expect(started.statusCode).toBe(202);
    await ctx.siteImports.run(started.json().id);
    const done = (await call('GET', `/api/admin/site-imports/${started.json().id}`, cookies.admin)).json() as { status: string };
    expect(done.status).toBe('done');
    const [row] = await t.db.select().from(diveSiteExternalId).where(eq(diveSiteExternalId.externalId, '500'));
    expect(row).toMatchObject({ siteId: u.id, accountId: null });
    expect(ids(await siteAs('b', u.id))).toEqual(['500']);
  });
});
