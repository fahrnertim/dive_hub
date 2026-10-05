// External site IDs and the admin's Site import through the HTTP API (ADR 0021, 0025), with stand-in Sources:
// who may import, what ODbL and SSI need, what an import creates, re-imports leaving User edits alone,
// references and offers on hand-made sites, failures, the site's history, the SSI site ID, maximum depth
// and water type.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ImportArea, ImportedValues, SiteSourceAdapter, SourceSite } from '../src/sites/import/site-source.js';
import { SiteSourceError } from '../src/sites/import/site-source.js';
import { createPoliteHttp } from '../src/sites/import/polite-http.js';
import { createSsiSiteSource } from '../src/providers/ssi/ssi-sites.js';
import type { ImportSource } from '../src/sites/sources.js';
import { ssiSitesZip } from './zip.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

type Position = { latitude: number; longitude: number };
type ExternalId = {
  source: string; name: string; externalId: string; url: string | null; providesData: boolean; attribution: { text: string; url: string } | null;
  offered: Partial<ImportedValues> | null;
};
type Site = {
  id: string; name: string; position: Position | null; country: string | null; waterBody: string | null; description: string | null;
  maxDepthM: number | null; waterType: string | null; ssiSiteId: string | null; externalIds: ExternalId[]; version: number; canDelete: boolean;
};
type SiteImport = {
  id: string; status: string; sources: string[]; area: ImportArea; language: string; createSites: boolean;
  counts: Record<string, number> | null; findings: { kind: string; name: string; nearName?: string; distanceM?: number; siteId: string; source?: string }[];
  failureCode: string | null; progress: { step: string; done: number; total: number };
};
type Revision = { cause: string; actor: { type: string; name: string | null }; changes: Record<string, { from: unknown; to: unknown }> };

const HOUSE_REEF = { latitude: 28.4950, longitude: 34.5160 };
const metresNorth = (m: number, from = HOUSE_REEF) => ({ latitude: from.latitude + m / 111_195, longitude: from.longitude });
const EGYPT: ImportArea = { kind: 'country', country: 'EG' };

const values = (v: Partial<ImportedValues>): ImportedValues => ({
  name: 'House Reef', position: HOUSE_REEF, country: 'EG', waterBody: null, description: null, maxDepthM: null, waterType: null, ...v,
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
  const ssi = standIn('ssi');
  let admin: string;
  let tim: string;
  let anna: string;

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const call = (method: Method, url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: Method, url: string, cookie: string, payload?: object) => (await call(method, url, cookie, payload)).json() as T;
  const siteNamed = async (name: string, cookie = tim) =>
    (await json<{ sites: Site[] }>('GET', `/api/dive-sites?q=${encodeURIComponent(name)}`, cookie)).sites.find((s) => s.name === name);

  /** Starts a Site import as the admin and runs it the way the worker would. */
  async function runImport(body: object = { sources: ['osm'], area: EGYPT, language: 'en', confirmOdbl: true }) {
    const started = await call('POST', '/api/admin/site-imports', admin, body);
    expect(started.statusCode).toBe(202);
    await ctx.siteImports.run(started.json().id);
    return json<SiteImport>('GET', `/api/admin/site-imports/${started.json().id}`, admin);
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { siteSources: { osm: osm.adapter, wikidata: wikidata.adapter, ssi: ssi.adapter } });
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
    ssi.answers([]);
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
        attribution: { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' }, offered: null,
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

    it('offer what the Source has, and any User takes it: empty fields fill, filled ones stay (ADR 0025)', async () => {
      const ours = (await siteNamed('Hausriff'))!;
      expect(ours.externalIds[0]!.offered).toMatchObject({ name: 'Hausriff Nord', maxDepthM: 20, description: null });

      const stale = await call('POST', `/api/dive-sites/${ours.id}/adopt`, anna, { source: 'osm', version: ours.version - 1 });
      expect(stale.statusCode).toBe(409);
      const taken = await call('POST', `/api/dive-sites/${ours.id}/adopt`, anna, { source: 'osm', version: ours.version });
      expect(taken.statusCode).toBe(200);
      expect(taken.json()).toMatchObject({ name: 'Hausriff', description: 'Our notes', maxDepthM: 20, version: ours.version + 1 });
      expect(taken.json().externalIds).toEqual([expect.objectContaining({
        source: 'osm', providesData: true, offered: null, attribution: expect.objectContaining({ text: '© OpenStreetMap contributors' }),
      })]);
      const [latest] = await json<Revision[]>('GET', `/api/dive-sites/${ours.id}/revisions`, tim);
      expect(latest).toMatchObject({ cause: 'adopt', actor: { type: 'user', name: null } });
      expect(latest!.changes).toEqual({ adopted: { from: null, to: { source: 'osm', externalId: 'node/301' } }, country: { from: null, to: 'EG' }, maxDepthM: { from: null, to: 20 } });

      const again = await call('POST', `/api/dive-sites/${ours.id}/adopt`, anna, { source: 'osm', version: ours.version + 1 });
      expect(again.statusCode).toBe(404);
      expect(again.json().code).toBe('site_offer_not_found');

      // From now on imports keep the taken fields current, as on any imported site.
      osm.answers([{ id: 'node/301', v: { name: 'Hausriff Nord', position: metresNorth(50_030), maxDepthM: 21 } }]);
      await runImport();
      expect(await json<Site>('GET', `/api/dive-sites/${ours.id}`, tim)).toMatchObject({ name: 'Hausriff', maxDepthM: 21, description: 'Our notes' });
    });
  });

  describe('importing from SSI (ADR 0025)', () => {
    const SSI = { sources: ['ssi'], area: EGYPT, language: 'en', confirmSsi: true };

    it('needs the admin to confirm that SSI gives no licence, and records when', async () => {
      const refused = await call('POST', '/api/admin/site-imports', admin, { ...SSI, confirmSsi: undefined });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().code).toBe('ssi_not_confirmed');
      const done = await runImport(SSI);
      expect(done).toMatchObject({ status: 'done', sources: ['ssi'], createSites: true });
      const { rows } = await t.pool.query('select ssi_confirmed_at, odbl_confirmed_at from site_import where id = $1', [done.id]);
      expect(rows[0].ssi_confirmed_at).toBeInstanceOf(Date);
      expect(rows[0].odbl_confirmed_at).toBeNull();
    });

    it('creates sites that say "From SSI" without a link, with their water type', async () => {
      ssi.answers([{ id: '9101', v: { name: 'Coral Garden', position: metresNorth(70_000), waterType: 'salt' } }]);
      const done = await runImport(SSI);
      expect(done.counts).toMatchObject({ created: 1 });
      const garden = (await siteNamed('Coral Garden'))!;
      expect(garden).toMatchObject({ waterType: 'salt', ssiSiteId: '9101', country: 'EG' });
      expect(garden.externalIds).toEqual([{ source: 'ssi', name: 'SSI', externalId: '9101', url: null, providesData: true, attribution: null, offered: null }]);
      const [created] = await json<Revision[]>('GET', `/api/dive-sites/${garden.id}/revisions`, tim);
      expect(created).toMatchObject({ actor: { type: 'site_import', name: 'SSI' }, changes: expect.objectContaining({ waterType: { from: null, to: 'salt' }, ssiSiteId: { from: null, to: '9101' } }) });
    });

    it('turns an SSI ID a User typed on an imported site into one that provides data', async () => {
      osm.answers([{ id: 'node/501', v: { name: 'Fanous', position: metresNorth(80_000) } }]);
      await runImport();
      const fanous = (await siteNamed('Fanous'))!;
      await call('PATCH', `/api/dive-sites/${fanous.id}`, tim, { version: fanous.version, ssiSiteId: '9201' });
      ssi.answers([{ id: '9201', v: { name: 'Fanous', position: metresNorth(80_000), waterType: 'salt' } }]);
      await runImport(SSI);
      const after = (await siteNamed('Fanous'))!;
      expect(after.waterType).toBe('salt');
      expect(after.externalIds.find((e) => e.source === 'ssi')).toMatchObject({ providesData: true, offered: null });
    });

    it('offers SSI\'s data on a hand-made site with a typed SSI ID, and lists it for the admin', async () => {
      const ours = await json<Site>('POST', '/api/dive-sites', tim, { name: 'Unser Riff', position: metresNorth(90_000), ssiSiteId: '9301' });
      ssi.answers([{ id: '9301', v: { name: 'Our Reef', position: metresNorth(90_005), waterType: 'salt' } }]);
      const done = await runImport(SSI);
      expect(done.counts).toMatchObject({ offered: 1, created: 0 });
      expect(done.findings).toContainEqual({ kind: 'offer', siteId: ours.id, name: 'Unser Riff', source: 'ssi' });
      const after = await json<Site>('GET', `/api/dive-sites/${ours.id}`, tim);
      expect(after).toMatchObject({ name: 'Unser Riff', waterType: null, version: ours.version });
      expect(after.externalIds).toEqual([expect.objectContaining({ source: 'ssi', providesData: false, offered: expect.objectContaining({ name: 'Our Reef', waterType: 'salt' }) })]);

      const taken = await json<Site>('POST', `/api/dive-sites/${ours.id}/adopt`, tim, { source: 'ssi', version: after.version });
      expect(taken).toMatchObject({ name: 'Unser Riff', waterType: 'salt', ssiSiteId: '9301' });
      expect(taken.externalIds).toEqual([expect.objectContaining({ source: 'ssi', providesData: true, offered: null })]);
    });

    it('creates no sites when the admin says so, but still fills those in the hub', async () => {
      ssi.answers([
        { id: '9101', v: { name: 'Coral Garden', position: metresNorth(70_000), waterType: 'brackish' } },
        { id: '9401', v: { name: 'Nowhere Reef', position: metresNorth(-70_000) } },
      ]);
      const done = await runImport({ ...SSI, createSites: false });
      expect(done).toMatchObject({ createSites: false, counts: expect.objectContaining({ created: 0, skippedNew: 1, updated: 1 }) });
      expect(await siteNamed('Nowhere Reef')).toBeUndefined();
      expect((await siteNamed('Coral Garden'))!.waterType).toBe('brackish');
    });

    it('reads SSI\'s real file format end to end, and keeps nothing it must not', async () => {
      const zip = await ssiSitesZip();
      const http = createPoliteHttp({
        fetch: async () => ({
          status: 200, headers: { get: () => null }, text: async () => '',
          arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer,
        }),
      });
      const real = await createTestApp(t, { siteSources: { osm: osm.adapter, wikidata: wikidata.adapter, ssi: createSsiSiteSource(http, 'https://ssi.invalid/sites.zip') } });
      try {
        const started = await real.app.inject({ method: 'POST', url: '/api/admin/site-imports', headers: { cookie: admin, origin: BASE_URL }, payload: { ...SSI, area: { kind: 'country', country: 'PW' } } });
        await real.siteImports.run(started.json().id);
        const corner = (await siteNamed('Blue Corner'))!;
        expect(corner).toMatchObject({ country: 'PW', waterType: 'salt', ssiSiteId: '7003', description: null });
        const { rows } = await t.pool.query(`select count(*)::int as n from dive_site_external_id e join dive_site s on s.id = e.site_id
          where e.imported::text like '%203.0.113.45%' or s.description like '%203.0.113.45%'`);
        expect(rows[0].n).toBe(0);
      } finally {
        await real.app.close();
      }
    });
  });

  describe('the water type of a site (ADR 0025)', () => {
    it('any User sets fresh, salt or brackish; the device-only words are refused', async () => {
      const lake = await json<Site>('POST', '/api/dive-sites', tim, { name: 'Gosausee', waterType: 'fresh' });
      expect(lake.waterType).toBe('fresh');
      const edited = await json<Site>('PATCH', `/api/dive-sites/${lake.id}`, anna, { version: lake.version, waterType: 'brackish' });
      expect(edited).toMatchObject({ waterType: 'brackish', version: lake.version + 1 });
      const [latest] = await json<Revision[]>('GET', `/api/dive-sites/${lake.id}/revisions`, tim);
      expect(latest!.changes).toEqual({ waterType: { from: 'fresh', to: 'brackish' } });
      for (const word of ['en13319', 'custom', 'salty']) {
        expect((await call('PATCH', `/api/dive-sites/${lake.id}`, tim, { version: edited.version, waterType: word })).statusCode).toBe(400);
      }
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
      expect(site.externalIds).toEqual([{ source: 'ssi', name: 'SSI', externalId: '3314', url: null, providesData: false, attribution: null, offered: null }]);

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
