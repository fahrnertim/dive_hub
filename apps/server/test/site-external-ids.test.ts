// A Dive site's External ID typed by a User (ADR 0021, 0029): its own route, only for Sources Users may type, the
// forms they copy accepted, unique per Source, in the site's history, and the site's version left alone.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

type Site = { id: string; version: number; externalIds: { source: string; externalId: string; providesData: boolean }[] };
type SiteRevision = { cause: string; actor: { type: string }; changes: Record<string, { from: unknown; to: unknown }> };

describe.skipIf(!(await databaseReachable()))('a Dive site\'s External ID', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let anna: string;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const site = async (name: string) => (await call('POST', '/api/dive-sites', tim, { name })).json() as Site;
  const setId = (id: string, source: string, externalId: string | null, cookie = tim) =>
    call('PUT', `/api/dive-sites/${id}/external-ids/${source}`, cookie, { externalId });

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'anna@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    anna = await signIn(ctx.app, 'anna@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('is set by any User, in the form SSI\'s QR code shows it, without changing the site\'s version', async () => {
    const reef = await site('Hausriff');
    const answer = await setId(reef.id, 'ssi', 'site:3314', anna);
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({
      version: reef.version, externalIds: [{ source: 'ssi', externalId: '3314', providesData: false }],
    });
    expect(answer.json()).not.toHaveProperty('ssiSiteId');
    const [latest] = (await call('GET', `/api/dive-sites/${reef.id}/revisions`, tim)).json() as SiteRevision[];
    expect(latest).toMatchObject({ cause: 'edit', actor: { type: 'user' }, changes: { ssiSiteId: { from: null, to: '3314' } } });
  });

  it('changes and clears, and refuses an ID another site has', async () => {
    const a = await site('A');
    const b = await site('B');
    await setId(a.id, 'ssi', '501');
    expect((await setId(b.id, 'ssi', '501')).json()).toMatchObject({ code: 'external_id_taken' });
    expect((await setId(a.id, 'ssi', '502')).json()).toMatchObject({ externalIds: [{ externalId: '502' }] });
    expect((await setId(a.id, 'ssi', null)).json()).toMatchObject({ externalIds: [] });
    expect((await setId(b.id, 'ssi', '501')).statusCode).toBe(200);
  });

  it('refuses Sources Users don\'t type and IDs of the wrong form; the site\'s edit no longer takes one', async () => {
    const c = await site('C');
    expect((await setId(c.id, 'osm', 'node/1')).json()).toMatchObject({ code: 'site_source_not_typed' });
    expect((await setId(c.id, 'ssi', 'site:abc')).json()).toMatchObject({ code: 'invalid_input' });
    // Fields the API doesn't know are dropped (Fastify's default), so the old `ssiSiteId` sets nothing.
    expect((await call('PATCH', `/api/dive-sites/${c.id}`, tim, { version: c.version, ssiSiteId: '3' })).json()).toMatchObject({ externalIds: [] });
    expect((await setId('00000000-0000-7000-8000-000000000000', 'ssi', '7')).json()).toMatchObject({ code: 'site_not_found' });
  });
});
