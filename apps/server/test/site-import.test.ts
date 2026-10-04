// External site IDs and the admin's Site import through the HTTP API (ADR 0021), with stand-in Sources:
// who may import, what ODbL needs, what an import creates, re-imports leaving User edits alone,
// references on hand-made sites, failures, the site's history, the SSI site ID and maximum depth.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ImportArea, ImportedValues, SiteSourceAdapter, SourceSite } from '../src/sites/import/site-source.js';
import { SiteSourceError } from '../src/sites/import/site-source.js';
import type { ImportSource } from '../src/sites/sources.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

type Position = { latitude: number; longitude: number };
type ExternalId = { source: string; name: string; externalId: string; url: string | null; providesData: boolean; attribution: { text: string; url: string } | null };
type Site = {
  id: string; name: string; position: Position | null; country: string | null; waterBody: string | null; description: string | null;
  maxDepthM: number | null; ssiSiteId: string | null; externalIds: ExternalId[]; version: number; canDelete: boolean;
};
type SiteImport = {
  id: string; status: string; sources: string[]; area: ImportArea; language: string;
  counts: Record<string, number> | null; findings: { kind: string; name: string; nearName: string; distanceM: number }[];
  failureCode: string | null; progress: { step: string; done: number; total: number };
};
type Revision = { cause: string; actor: { type: string; name: string | null }; changes: Record<string, { from: unknown; to: unknown }> };

const HOUSE_REEF = { latitude: 28.4950, longitude: 34.5160 };
const metresNorth = (m: number, from = HOUSE_REEF) => ({ latitude: from.latitude + m / 111_195, longitude: from.longitude });
const EGYPT: ImportArea = { kind: 'country', country: 'EG' };

const values = (v: Partial<ImportedValues>): ImportedValues => ({
  name: 'House Reef', position: HOUSE_REEF, country: 'EG', waterBody: null, description: null, maxDepthM: null, ...v,
});

/** A Source that answers with what the test put there, and remembers what it was asked. */
function standIn(source: ImportSource) {
  const asked: { area: ImportArea; language: string }[] = [];
  let answer: SourceSite[] | Error = [];
  const adapter: SiteSourceAdapter = {
    source,
    async fetch(area, language) {
      asked.push({ area, language });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return {
    adapter, asked,
    answers(sites: { id: string; v?: Partial<ImportedValues>; sameAs?: SourceSite['sameAs'] }[]) {
      answer = sites.map((s) => ({ source, externalId: s.id, values: values(s.v ?? {}), sameAs: s.sameAs ?? {} }));
    },
    fails(error: Error) { answer = error; },
  };
}

describe.skipIf(!(await databaseReachable()))('Site import and external site IDs', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const osm = standIn('osm');
  const wikidata = standIn('wikidata');
  let admin: string;
  let tim: string;
  let anna: string;

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const call = (method: Method, url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: Method, url: string, cookie: string, payload?: object) => (await call(method, url, cookie, payload)).json() as T;
  const siteNamed = async (name: string, cookie = tim) =>
    (await json<Site[]>('GET', `/api/dive-sites?q=${encodeURIComponent(name)}`, cookie)).find((s) => s.name === name);

  /** Starts a Site import as the admin and runs it the way the worker would. */
  async function runImport(body: object = { sources: ['osm'], area: EGYPT, language: 'en', confirmOdbl: true }) {
    const started = await call('POST', '/api/admin/site-imports', admin, body);
    expect(started.statusCode).toBe(202);
    await ctx.siteImports.run(started.json().id);
    return json<SiteImport>('GET', `/api/admin/site-imports/${started.json().id}`, admin);
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { siteSources: { osm: osm.adapter, wikidata: wikidata.adapter } });
    await createUser(ctx.auth, 'admin@example.com', 'admin');
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'anna@example.com');
    admin = await signIn(ctx.app, 'admin@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    anna = await signIn(ctx.app, 'anna@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });
  beforeEach(() => {
    osm.answers([]);
    wikidata.answers([]);
  });

  describe('starting an import', () => {
    it('is for admins only', async () => {
      const refused = await call('POST', '/api/admin/site-imports', tim, { sources: ['wikidata'], area: EGYPT, language: 'en' });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe('admins_only');
      expect((await call('GET', '/api/admin/site-imports', tim)).statusCode).toBe(403);
    });

    it('needs the admin to confirm the ODbL explanation before importing from OpenStreetMap', async () => {
      const refused = await call('POST', '/api/admin/site-imports', admin, { sources: ['osm', 'wikidata'], area: EGYPT, language: 'en' });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().code).toBe('odbl_not_confirmed');
      // Wikidata is CC0: nothing to confirm.
      const done = await runImport({ sources: ['wikidata'], area: EGYPT, language: 'en' });
      expect(done.status).toBe('done');
    });

    it('runs one import at a time', async () => {
      const first = await call('POST', '/api/admin/site-imports', admin, { sources: ['wikidata'], area: { kind: 'world' }, language: 'en' });
      expect(first.statusCode).toBe(202);
      expect(first.json()).toMatchObject({ status: 'queued', progress: { step: 'waiting' } });
      const second = await call('POST', '/api/admin/site-imports', admin, { sources: ['wikidata'], area: { kind: 'world' }, language: 'en' });
      expect(second.statusCode).toBe(409);
      expect(second.json().code).toBe('site_import_running');
      await ctx.siteImports.run(first.json().id);
      expect((await call('POST', '/api/admin/site-imports', admin, { sources: ['wikidata'], area: { kind: 'world' }, language: 'en' })).statusCode).toBe(202);
      await ctx.siteImports.run((await json<{ imports: SiteImport[] }>('GET', '/api/admin/site-imports', admin)).imports[0]!.id);
    });

    it('refuses an area that is no area', async () => {
      const upsideDown = await call('POST', '/api/admin/site-imports', admin, {
        sources: ['wikidata'], area: { kind: 'box', south: 30, west: 10, north: 20, east: 12 }, language: 'en',
      });
      expect(upsideDown.statusCode).toBe(400);
      expect((await call('POST', '/api/admin/site-imports', admin, { sources: [], area: EGYPT, language: 'en' })).statusCode).toBe(400);
    });
  });

  describe('what an import creates', () => {
    it('creates sites from the Sources, each showing where it comes from', async () => {
      osm.answers([{ id: 'node/101', v: { name: 'Canyon', position: metresNorth(5000), maxDepthM: 52, description: 'Swim through the canyon' } }]);
      wikidata.answers([{ id: 'Q101', v: { name: 'Blue Hole', position: metresNorth(-9000), waterBody: 'Red Sea' } }]);
      const done = await runImport({ sources: ['osm', 'wikidata'], area: EGYPT, language: 'de', confirmOdbl: true });

      expect(done).toMatchObject({ status: 'done', sources: ['osm', 'wikidata'], language: 'de', failureCode: null });
      expect(done.counts).toMatchObject({ created: 2, updated: 0 });
      expect(osm.asked.at(-1)).toEqual({ area: EGYPT, language: 'de' });
      expect(wikidata.asked.at(-1)).toEqual({ area: EGYPT, language: 'de' });

      const canyon = (await siteNamed('Canyon'))!;
      expect(canyon).toMatchObject({ maxDepthM: 52, description: 'Swim through the canyon', country: 'EG', ssiSiteId: null });
      expect(canyon.externalIds).toEqual([{
        source: 'osm', name: 'OpenStreetMap', externalId: 'node/101', url: 'https://www.openstreetmap.org/node/101', providesData: true,
        attribution: { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
      }]);
      const blueHole = (await siteNamed('Blue Hole'))!;
      expect(blueHole.externalIds).toEqual([expect.objectContaining({ source: 'wikidata', url: 'https://www.wikidata.org/wiki/Q101', providesData: true, attribution: null })]);
    });

    it('gives imported sites no creator: only admins delete them', async () => {
      const canyon = (await siteNamed('Canyon'))!;
      expect(canyon.canDelete).toBe(false);
      expect((await siteNamed('Canyon', admin))!.canDelete).toBe(true);
    });

    it('shows the import in the site\'s history', async () => {
      const canyon = (await siteNamed('Canyon'))!;
      const history = await json<Revision[]>('GET', `/api/dive-sites/${canyon.id}/revisions`, anna);
      expect(history).toEqual([expect.objectContaining({
        cause: 'create', actor: { type: 'site_import', name: 'OpenStreetMap, Wikidata' },
        changes: expect.objectContaining({ name: { from: null, to: 'Canyon' }, osmId: { from: null, to: 'node/101' } }),
      })]);
    });

    it('reports new sites close to sites that were there before', async () => {
      const ours = await json<Site>('POST', '/api/dive-sites', tim, { name: 'Napoleon Reef', position: metresNorth(20_000) });
      osm.answers([{ id: 'node/102', v: { name: 'Lighthouse', position: metresNorth(20_150) } }]);
      const done = await runImport();
      expect(done.findings).toEqual([expect.objectContaining({ kind: 'near', name: 'Lighthouse', nearName: 'Napoleon Reef', distanceM: 150 })]);
      expect((await json<Site>('GET', `/api/dive-sites/${ours.id}`, tim)).externalIds).toEqual([]);
    });
  });

  describe('a re-import', () => {
    it('follows the Source where Users changed nothing, and keeps what they changed', async () => {
      osm.answers([{ id: 'node/201', v: { name: 'Lighthouse Point', position: metresNorth(30_000) } }]);
      await runImport();
      const site = (await siteNamed('Lighthouse Point'))!;
      const renamed = await call('PATCH', `/api/dive-sites/${site.id}`, tim, { version: site.version, name: 'Lighthouse Pt.' });
      expect(renamed.statusCode).toBe(200);

      osm.answers([{ id: 'node/201', v: { name: 'Lighthouse Point North', position: metresNorth(30_040), maxDepthM: 24 } }]);
      const done = await runImport();
      expect(done.counts).toMatchObject({ updated: 1, created: 0 });

      const after = await json<Site>('GET', `/api/dive-sites/${site.id}`, tim);
      expect(after).toMatchObject({ name: 'Lighthouse Pt.', position: metresNorth(30_040), maxDepthM: 24, version: site.version + 2 });
      const [latest] = await json<Revision[]>('GET', `/api/dive-sites/${site.id}/revisions`, tim);
      expect(latest).toMatchObject({ cause: 'update', actor: { type: 'site_import' } });
      expect(Object.keys(latest!.changes).sort()).toEqual(['maxDepthM', 'position']);
    });

    it('leaves an unchanged site without a new version or Revision', async () => {
      osm.answers([{ id: 'node/201', v: { name: 'Lighthouse Point North', position: metresNorth(30_040), maxDepthM: 24 } }]);
      const site = (await siteNamed('Lighthouse Pt.'))!;
      const done = await runImport();
      expect(done.counts).toMatchObject({ kept: 0, updated: 0, unchanged: 1 });
      expect((await json<Site>('GET', `/api/dive-sites/${site.id}`, tim)).version).toBe(site.version);
    });

    it('never brings back a site deleted in the hub', async () => {
      osm.answers([{ id: 'node/202', v: { name: 'Old Jetty', position: metresNorth(40_000) } }]);
      await runImport();
      const jetty = (await siteNamed('Old Jetty', admin))!;
      expect((await call('DELETE', `/api/dive-sites/${jetty.id}`, admin)).statusCode).toBe(204);
      const done = await runImport();
      expect(done.counts).toMatchObject({ skippedDeleted: 1, created: 0 });
      expect(await siteNamed('Old Jetty')).toBeUndefined();
    });
  });

  describe('hand-made sites', () => {
    it('are linked as a reference when an object close by has the same name, and keep everything Users wrote', async () => {
      const ours = await json<Site>('POST', '/api/dive-sites', tim, { name: 'Hausriff', position: metresNorth(50_000), description: 'Our notes' });
      osm.answers([{ id: 'node/301', v: { name: 'Hausriff', position: metresNorth(50_030), description: 'OSM text', maxDepthM: 18 } }]);
      const done = await runImport();
      expect(done.counts).toMatchObject({ linked: 1, created: 0 });

      const after = await json<Site>('GET', `/api/dive-sites/${ours.id}`, tim);
      expect(after).toMatchObject({ description: 'Our notes', maxDepthM: null, position: metresNorth(50_000) });
      expect(after.externalIds).toEqual([expect.objectContaining({ source: 'osm', externalId: 'node/301', providesData: false })]);
      const [latest] = await json<Revision[]>('GET', `/api/dive-sites/${ours.id}/revisions`, tim);
      expect(latest).toMatchObject({ cause: 'link', actor: { type: 'site_import' }, changes: { osmId: { from: null, to: 'node/301' } } });

      // Later imports still leave it alone.
      osm.answers([{ id: 'node/301', v: { name: 'Hausriff Nord', position: metresNorth(50_030), maxDepthM: 20 } }]);
      await runImport();
      expect(await json<Site>('GET', `/api/dive-sites/${ours.id}`, tim)).toMatchObject({ name: 'Hausriff', maxDepthM: null });
    });
  });

  describe('when a Source fails', () => {
    it('marks the import failed with the reason, changes nothing, and lets the next one start', async () => {
      osm.fails(new SiteSourceError('osm', 'unavailable', 'HTTP 504'));
      wikidata.answers([{ id: 'Q401', v: { name: 'Should not appear', position: metresNorth(60_000) } }]);
      const failed = await runImport({ sources: ['osm', 'wikidata'], area: EGYPT, language: 'en', confirmOdbl: true });
      expect(failed).toMatchObject({ status: 'failed', failureCode: 'source_unavailable', counts: null });
      expect(await siteNamed('Should not appear')).toBeUndefined();

      osm.fails(new SiteSourceError('osm', 'rate_limited', 'HTTP 429'));
      expect((await runImport()).failureCode).toBe('source_rate_limited');
    });

    it('marks an import a crash left running as failed', async () => {
      const started = await call('POST', '/api/admin/site-imports', admin, { sources: ['wikidata'], area: EGYPT, language: 'en' });
      await t.pool.query(`update site_import set status = 'running' where id = $1`, [started.json().id]);
      await ctx.siteImports.failInterrupted();
      expect(await json<SiteImport>('GET', `/api/admin/site-imports/${started.json().id}`, admin)).toMatchObject({ status: 'failed', failureCode: 'site_import_interrupted' });
    });
  });

  describe('the SSI site ID and maximum depth, by hand', () => {
    it('any User sets an SSI site ID in the site form; it shows as an External ID', async () => {
      const site = await json<Site>('POST', '/api/dive-sites', tim, { name: 'Ras Mohammed', ssiSiteId: '3314', maxDepthM: 40 });
      expect(site).toMatchObject({ ssiSiteId: '3314', maxDepthM: 40 });
      expect(site.externalIds).toEqual([{ source: 'ssi', name: 'SSI', externalId: '3314', url: null, providesData: false, attribution: null }]);

      const changed = await call('PATCH', `/api/dive-sites/${site.id}`, anna, { version: site.version, ssiSiteId: '3315', maxDepthM: null });
      expect(changed.json()).toMatchObject({ ssiSiteId: '3315', maxDepthM: null, version: site.version + 1 });

      const history = await json<Revision[]>('GET', `/api/dive-sites/${site.id}/revisions`, tim);
      // Tim sees his own edit as his, and Anna's without her name (ADR 0020: Users don't see who else edits).
      expect(history.map((r) => [r.cause, r.actor])).toEqual([['edit', { type: 'user', name: null }], ['create', { type: 'you', name: null }]]);
      expect(history[0]!.changes).toEqual({ ssiSiteId: { from: '3314', to: '3315' }, maxDepthM: { from: 40, to: null } });

      const cleared = await call('PATCH', `/api/dive-sites/${site.id}`, tim, { version: site.version + 1, ssiSiteId: null });
      expect(cleared.json()).toMatchObject({ ssiSiteId: null, externalIds: [] });
    });

    it('refuses an SSI site ID another site already has', async () => {
      await json<Site>('POST', '/api/dive-sites', tim, { name: 'Shark Reef', ssiSiteId: '5000' });
      const other = await json<Site>('POST', '/api/dive-sites', tim, { name: 'Yolanda Reef' });
      const taken = await call('PATCH', `/api/dive-sites/${other.id}`, tim, { version: other.version, ssiSiteId: '5000' });
      expect(taken.statusCode).toBe(409);
      expect(taken.json().code).toBe('external_id_taken');
      expect((await call('POST', '/api/dive-sites', tim, { name: 'Jackfish Alley', ssiSiteId: '5000' })).statusCode).toBe(409);
    });

    it('refuses what is no SSI site ID or no depth', async () => {
      expect((await call('POST', '/api/dive-sites', tim, { name: 'X', ssiSiteId: 'site:12' })).statusCode).toBe(400);
      expect((await call('POST', '/api/dive-sites', tim, { name: 'X', maxDepthM: -5 })).statusCode).toBe(400);
      expect((await call('POST', '/api/dive-sites', tim, { name: 'X', maxDepthM: 401 })).statusCode).toBe(400);
    });
  });
});
