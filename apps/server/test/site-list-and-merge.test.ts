// The Dive sites list with paging, sorting and filters, and merging duplicate sites (ADR 0022),
// through the HTTP API: who may merge, what the kept site ends up with, what moves, histories,
// versions, chains, and imports following a merge.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportedValues, SiteSourceAdapter, SourceSite } from '../src/sites/import/site-source.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, unreachable, type TestDatabase } from './support.js';

type Position = { latitude: number; longitude: number };
type Site = {
  id: string; name: string; position: Position | null; country: string | null; waterBody: string | null; description: string | null;
  maxDepthM: number | null; ssiSiteId: string | null; externalIds: { source: string; externalId: string; providesData: boolean }[];
  version: number; diveCount: number; mergedInto: string | null;
};
type Page = { sites: Site[]; total: number };
type Revision = { cause: string; actor: { type: string; name: string | null }; changes: Record<string, { from: unknown; to: unknown }> };

const HOUSE_REEF = { latitude: 28.4950, longitude: 34.5160 };
const metresNorth = (m: number, from = HOUSE_REEF) => ({ latitude: from.latitude + m / 111_195, longitude: from.longitude });

describe.skipIf(!(await databaseReachable()))('Dive sites: the list and merging', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let anna: string;
  let admin: string;
  let osmAnswer: SourceSite[] = [];
  const osm: SiteSourceAdapter = { source: 'osm', fetch: async () => osmAnswer };
  const wikidata: SiteSourceAdapter = { source: 'wikidata', fetch: async () => [] };

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const call = (method: Method, url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: Method, url: string, cookie: string, payload?: object) => (await call(method, url, cookie, payload)).json() as T;
  const createSite = (body: object, cookie = tim) => json<Site>('POST', '/api/dive-sites', cookie, body);
  const names = (page: Page) => page.sites.map((s) => s.name);

  let serial = 900;
  /** A Dive of `cookie`'s User at `siteId`. */
  async function diveAt(siteId: string, cookie: string) {
    const { payload, headers } = multipartFile('d.fit', makeSyntheticDive({ serialNumber: serial++, start: new Date(Date.UTC(2026, 0, 1, serial % 24)) }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(created.json().id);
    const diveId = (await json<{ outcome: { diveId: string }[] }>('GET', `/api/imports/${created.json().id}`, cookie)).outcome[0]!.diveId;
    const dive = await json<{ version: number }>('GET', `/api/dives/${diveId}`, cookie);
    await call('PATCH', `/api/dives/${diveId}`, cookie, { version: dive.version, siteId });
    return diveId;
  }
  const merge = (id: string, into: Site, cookie: string, version?: number) =>
    call('POST', `/api/dive-sites/${id}/merge`, cookie, { intoId: into.id, intoVersion: into.version, ...(version !== undefined && { version }) });

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { siteSources: { osm, wikidata, ssi: unreachable('ssi') } });
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'anna@example.com');
    await createUser(ctx.auth, 'admin@example.com', 'admin');
    tim = await signIn(ctx.app, 'tim@example.com');
    anna = await signIn(ctx.app, 'anna@example.com');
    admin = await signIn(ctx.app, 'admin@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('the list', () => {
    let alpha: Site;
    let bravo: Site;
    beforeAll(async () => {
      alpha = await createSite({ name: 'Alpha Reef', country: 'MT' });
      bravo = await createSite({ name: 'bravo wall', country: 'EG' });
      await createSite({ name: 'Charlie Cave', country: 'AT' });
      await diveAt(bravo.id, tim);
      await diveAt(bravo.id, tim);
      await diveAt(alpha.id, tim);
    });

    it('comes in pages, by name, with the total', async () => {
      const first = await json<Page>('GET', '/api/dive-sites?limit=2', tim);
      expect(first).toMatchObject({ total: 3 });
      expect(names(first)).toEqual(['Alpha Reef', 'bravo wall']);
      expect(names(await json<Page>('GET', '/api/dive-sites?limit=2&offset=2', tim))).toEqual(['Charlie Cave']);
    });

    it('sorts by country or by the User\'s dives there', async () => {
      expect(names(await json<Page>('GET', '/api/dive-sites?sort=country', tim))).toEqual(['Charlie Cave', 'bravo wall', 'Alpha Reef']);
      expect(names(await json<Page>('GET', '/api/dive-sites?sort=diveCount&order=desc', tim))).toEqual(['bravo wall', 'Alpha Reef', 'Charlie Cave']);
      // Anna has no dives anywhere: then the name decides.
      expect(names(await json<Page>('GET', '/api/dive-sites?sort=diveCount&order=desc', anna))).toEqual(['Alpha Reef', 'bravo wall', 'Charlie Cave']);
    });

    it('filters by country, by words, and by the User\'s own dives', async () => {
      expect(await json<Page>('GET', '/api/dive-sites?country=EG', tim)).toMatchObject({ total: 1, sites: [{ name: 'bravo wall' }] });
      expect(names(await json<Page>('GET', '/api/dive-sites?q=cave', tim))).toEqual(['Charlie Cave']);
      expect(names(await json<Page>('GET', '/api/dive-sites?mine=true', tim))).toEqual(['Alpha Reef', 'bravo wall']);
      expect(await json<Page>('GET', '/api/dive-sites?mine=true', anna)).toEqual({ sites: [], total: 0 });
    });

    it('lists sites near a position nearest first', async () => {
      const near = await createSite({ name: 'Zulu Point', position: metresNorth(100) });
      const far = await createSite({ name: 'Yankee Point', position: metresNorth(900) });
      const found = await json<Page>('GET', `/api/dive-sites?latitude=${HOUSE_REEF.latitude}&longitude=${HOUSE_REEF.longitude}&within=1000`, tim);
      expect(found.sites.map((s) => s.id)).toEqual([near.id, far.id]);
      expect(found.total).toBe(2);
    });
  });

  describe('merging', () => {
    it('keeps the kept site\'s values, fills its gaps, and moves every Dive there, also other Users\'', async () => {
      const kept = await createSite({ name: 'Lighthouse', position: metresNorth(10_000), country: 'EG' });
      const duplicate = await createSite({ name: 'Light House', position: metresNorth(10_050), country: 'IL', waterBody: 'Red Sea', maxDepthM: 28, waterType: 'salt', ssiSiteId: '3314', description: 'Steps by the café' }, anna);
      const timsDive = await diveAt(duplicate.id, tim);
      const annasDive = await diveAt(duplicate.id, anna);

      // Any User merges, here Tim a site Anna created.
      const merged = await merge(duplicate.id, kept, tim, duplicate.version);
      expect(merged.statusCode).toBe(200);
      expect(merged.json()).toMatchObject({
        id: kept.id, name: 'Lighthouse', position: metresNorth(10_000), country: 'EG',
        waterBody: 'Red Sea', maxDepthM: 28, waterType: 'salt', ssiSiteId: '3314', description: 'Steps by the café', version: kept.version + 1, diveCount: 1,
      });

      const timsNow = await json<{ site: { id: string } | null; waterType: string | null }>('GET', `/api/dives/${timsDive}`, tim);
      expect(timsNow.site?.id).toBe(kept.id);
      // The Dive's water type is its site's (ADR 0025), so it came along with the filled gap.
      expect(timsNow.waterType).toBe('salt');
      expect((await json<{ site: { id: string } | null }>('GET', `/api/dives/${annasDive}`, anna)).site?.id).toBe(kept.id);
      // Anna's Dive tells her what happened, without naming Tim.
      const [annasLatest] = await json<Revision[]>('GET', `/api/dives/${annasDive}/revisions`, anna);
      expect(annasLatest).toMatchObject({ cause: 'site-merge', actor: { type: 'system' }, changes: { site: { from: { id: duplicate.id, name: 'Light House' }, to: { id: kept.id, name: 'Lighthouse' } } } });
    });

    it('leaves the merged site out of every list, and leads its link to the kept site', async () => {
      const kept = await createSite({ name: 'Canyon', position: metresNorth(20_000) });
      const duplicate = await createSite({ name: 'The Canyon', position: metresNorth(20_020) });
      await merge(duplicate.id, kept, tim, duplicate.version);

      expect(await json<Site>('GET', `/api/dive-sites/${duplicate.id}`, tim)).toMatchObject({ id: duplicate.id, mergedInto: kept.id });
      expect(names(await json<Page>('GET', '/api/dive-sites?q=canyon', tim))).toEqual(['Canyon']);
      const near = await json<Page>('GET', `/api/dive-sites?latitude=${metresNorth(20_000).latitude}&longitude=${HOUSE_REEF.longitude}&within=200`, tim);
      expect(near.sites.map((s) => s.id)).toEqual([kept.id]);
      expect((await call('PATCH', `/api/dive-sites/${duplicate.id}`, tim, { version: duplicate.version + 1, name: 'x' })).statusCode).toBe(404);
      expect((await call('DELETE', `/api/dive-sites/${duplicate.id}`, admin)).statusCode).toBe(404);
    });

    it('writes the merge into both sites\' histories', async () => {
      const kept = await createSite({ name: 'Eel Garden', position: metresNorth(30_000) });
      const duplicate = await createSite({ name: 'Eel Gardens', position: metresNorth(30_010), maxDepthM: 20 }, anna);
      await merge(duplicate.id, kept, tim, duplicate.version);

      const [keptLatest] = await json<Revision[]>('GET', `/api/dive-sites/${kept.id}/revisions`, tim);
      expect(keptLatest).toMatchObject({
        cause: 'merge', actor: { type: 'you' },
        changes: { mergedSite: { from: null, to: { id: duplicate.id, name: 'Eel Gardens' } }, maxDepthM: { from: null, to: 20 } },
      });
      const [mergedLatest] = await json<Revision[]>('GET', `/api/dive-sites/${duplicate.id}/revisions`, anna);
      expect(mergedLatest).toMatchObject({ cause: 'merge', actor: { type: 'user', name: null }, changes: { mergedInto: { from: null, to: { id: kept.id, name: 'Eel Garden' } } } });
    });

    it('re-points earlier merges, so a link never leads to a merged site', async () => {
      const a = await createSite({ name: 'Ras A' });
      const b = await createSite({ name: 'Ras B' });
      const c = await createSite({ name: 'Ras C' });
      await merge(a.id, b, tim, a.version);
      const bNow = await json<Site>('GET', `/api/dive-sites/${b.id}`, tim);
      await merge(b.id, c, tim, bNow.version);
      expect((await json<Site>('GET', `/api/dive-sites/${a.id}`, tim)).mergedInto).toBe(c.id);
    });

    it('refuses stale versions, a site merged into itself, and a site already merged', async () => {
      const kept = await createSite({ name: 'Gota Abu Ramada' });
      const duplicate = await createSite({ name: 'Abu Ramada' });
      const renamed = await json<Site>('PATCH', `/api/dive-sites/${kept.id}`, anna, { version: kept.version, name: 'Gota Abu Ramada South' });

      const staleKept = await merge(duplicate.id, kept, tim, duplicate.version);
      expect(staleKept.statusCode).toBe(409);
      expect(staleKept.json().code).toBe('site_changed');
      expect((await merge(duplicate.id, renamed, tim, duplicate.version - 1)).json().code).toBe('site_changed');
      expect((await merge(kept.id, renamed, tim, renamed.version)).statusCode).toBe(400);

      expect((await merge(duplicate.id, renamed, tim, duplicate.version)).statusCode).toBe(200);
      const keptNow = await json<Site>('GET', `/api/dive-sites/${kept.id}`, tim);
      expect((await merge(duplicate.id, keptNow, tim, duplicate.version)).statusCode).toBe(404);
    });
  });

  describe('External IDs and imports', () => {
    const fromOsm = (id: string, v: Partial<ImportedValues>): SourceSite => ({
      source: 'osm', externalId: id, sameAs: {},
      values: { name: 'x', position: null, country: null, waterBody: null, description: null, maxDepthM: null, waterType: null, ...v },
    });
    const runImport = async () => {
      const started = await call('POST', '/api/admin/site-imports', admin, { sources: ['osm'], area: { kind: 'world' }, language: 'en', confirmOdbl: true });
      await ctx.siteImports.run(started.json().id);
      return json<{ counts: Record<string, number> }>('GET', `/api/admin/site-imports/${started.json().id}`, admin);
    };

    it('move to the kept site where it has none from that Source, so its Attribution follows', async () => {
      osmAnswer = [fromOsm('node/1', { name: 'Shark Observatory', position: metresNorth(40_000), maxDepthM: 60 })];
      await runImport();
      const imported = (await json<Page>('GET', '/api/dive-sites?q=shark%20obs', tim)).sites[0]!;
      const ours = await createSite({ name: 'Shark Obs', position: metresNorth(40_500) });

      const kept = (await merge(imported.id, ours, tim, imported.version)).json() as Site;
      expect(kept).toMatchObject({ id: ours.id, maxDepthM: 60, externalIds: [{ source: 'osm', externalId: 'node/1', providesData: true }] });

      // The next import merges against the kept site, per field: its own name stays, the new depth follows.
      osmAnswer = [fromOsm('node/1', { name: 'Shark Observatory', position: metresNorth(40_000), maxDepthM: 65 })];
      expect((await runImport()).counts).toMatchObject({ updated: 1, created: 0 });
      expect(await json<Site>('GET', `/api/dive-sites/${ours.id}`, tim)).toMatchObject({ name: 'Shark Obs', maxDepthM: 65 });
    });

    it('stay on the merged site when the kept one has its own, and imports never bring the merged site back', async () => {
      osmAnswer = [
        fromOsm('node/2', { name: 'Nöhmer', position: metresNorth(50_000) }),
        fromOsm('node/3', { name: 'Attersee - Nöhmer', position: metresNorth(50_020) }),
      ];
      await runImport();
      const [first, second] = (await json<Page>('GET', '/api/dive-sites?q=n%C3%B6hmer', tim)).sites;
      const kept = (await merge(second!.id, first!, tim, second!.version)).json() as Site;
      expect(kept.externalIds.map((e) => e.externalId)).toEqual([first!.name === 'Nöhmer' ? 'node/2' : 'node/3']);

      const again = await runImport();
      expect(again.counts).toMatchObject({ created: 0, skippedMerged: 1 });
      expect((await json<Page>('GET', '/api/dive-sites?q=n%C3%B6hmer', tim)).total).toBe(1);
    });
  });
});
