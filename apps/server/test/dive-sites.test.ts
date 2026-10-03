// Dive sites through the HTTP API (ADR 0020): shared by every User, edited by anyone under a version,
// deleted by their creator or an admin while unused; positions from the Device; a Dive's site.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Position = { latitude: number; longitude: number };
type Site = {
  id: string; name: string; position: Position | null; country: string | null; waterBody: string | null;
  description: string | null; version: number; canDelete: boolean; diveCount: number; distanceM?: number;
};
type Dive = { id: string; version: number; site: { id: string; name: string } | null; position: Position | null };
type Revision = { cause: string; actor: { type: string }; changes: Record<string, { from: unknown; to: unknown }> };

/** The house reef at Dahab, and the lighthouse a few kilometres away. */
const HOUSE_REEF = { latitude: 28.4950, longitude: 34.5160 };
const LIGHTHOUSE = { latitude: 28.5003, longitude: 34.5197 };
const metresNorth = (p: Position, m: number) => ({ latitude: p.latitude + m / 111_195, longitude: p.longitude });

describe.skipIf(!(await databaseReachable()))('Dive sites', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let anna: string;
  let admin: string;

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const call = (method: Method, url: string, cookie = tim, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: Method, url: string, cookie = tim, payload?: object) =>
    (await call(method, url, cookie, payload)).json() as T;
  const createSite = (body: object, cookie = tim) => json<Site>('POST', '/api/dive-sites', cookie, body);

  async function upload(fileName: string, data: Uint8Array, cookie = tim) {
    const { payload, headers } = multipartFile(fileName, data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(response.json().id);
    return (await call('GET', `/api/imports/${response.json().id}`, cookie)).json().outcome[0] as { result: string; diveId: string };
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
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

  describe('shared by every User', () => {
    it('a site one User creates is there for every other User', async () => {
      const created = await call('POST', '/api/dive-sites', tim, {
        name: 'Lighthouse', position: LIGHTHOUSE, country: 'EG', waterBody: 'Red Sea', description: 'Shore entry by the café',
      });
      expect(created.statusCode).toBe(201);
      const site = created.json() as Site;
      expect(site).toMatchObject({ name: 'Lighthouse', position: LIGHTHOUSE, country: 'EG', waterBody: 'Red Sea', version: 1, canDelete: true, diveCount: 0 });

      const seen = await json<Site>('GET', `/api/dive-sites/${site.id}`, anna);
      expect(seen).toMatchObject({ name: 'Lighthouse', canDelete: false });
      expect((await json<Site[]>('GET', '/api/dive-sites', anna)).map((s) => s.id)).toContain(site.id);
    });

    it('any User edits a site, naming the version they started from', async () => {
      const site = await createSite({ name: 'Blu Hole', position: null, country: null, waterBody: null, description: null });
      const fixed = await call('PATCH', `/api/dive-sites/${site.id}`, anna, { version: site.version, name: 'Blue Hole' });
      expect(fixed.statusCode).toBe(200);
      expect(fixed.json()).toMatchObject({ name: 'Blue Hole', version: 2 });

      // Tim still has the old version open: his edit is refused instead of silently undoing Anna's.
      const stale = await call('PATCH', `/api/dive-sites/${site.id}`, tim, { version: site.version, country: 'EG' });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ code: 'site_changed' });
    });

    it('refuses half a position, a position off the globe and an unknown country format', async () => {
      for (const body of [
        { name: 'X', position: { latitude: 28.5 } },
        { name: 'X', position: { latitude: 91, longitude: 0 } },
        { name: 'X', position: { latitude: 0, longitude: 181 } },
        { name: 'X', country: 'Egypt' },
        { name: '' },
      ]) {
        const response = await call('POST', '/api/dive-sites', tim, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it('only the creator or an admin deletes a site', async () => {
      const site = await createSite({ name: 'Short-lived' });
      const byAnna = await call('DELETE', `/api/dive-sites/${site.id}`, anna);
      expect(byAnna.statusCode).toBe(403);
      expect(byAnna.json()).toMatchObject({ code: 'site_not_deletable' });
      expect((await json<Site>('GET', `/api/dive-sites/${site.id}`, admin)).canDelete).toBe(true);
      expect((await call('DELETE', `/api/dive-sites/${site.id}`, admin)).statusCode).toBe(204);
      expect((await call('GET', `/api/dive-sites/${site.id}`, tim)).json()).toMatchObject({ code: 'site_not_found' });
      expect((await json<Site[]>('GET', '/api/dive-sites')).map((s) => s.id)).not.toContain(site.id);
    });

    it('needs a signed-in User', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/dive-sites' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('nearby', () => {
    it('lists the sites within a distance of a position, nearest first, with how far each is', async () => {
      const origin = { latitude: -33.8, longitude: 151.3 };
      const near = await createSite({ name: 'Near', position: metresNorth(origin, 300) });
      const nearer = await createSite({ name: 'Nearer', position: metresNorth(origin, 50) });
      await createSite({ name: 'Far', position: metresNorth(origin, 5000) });
      await createSite({ name: 'Nowhere in particular' });

      const found = await json<Site[]>('GET', `/api/dive-sites?latitude=${origin.latitude}&longitude=${origin.longitude}&within=2000`);
      expect(found.map((s) => s.id)).toEqual([nearer.id, near.id]);
      expect(found[0]!.distanceM).toBeCloseTo(50, -1);
      expect(found[1]!.distanceM).toBeCloseTo(300, -1);
    });

    it('finds sites on the other side of the date line', async () => {
      const west = await createSite({ name: 'Taveuni west', position: { latitude: -16.8, longitude: 179.999 } });
      const found = await json<Site[]>('GET', '/api/dive-sites?latitude=-16.8&longitude=-179.999&within=1000');
      expect(found.map((s) => s.id)).toEqual([west.id]);
    });

    it('searches names and bodies of water', async () => {
      const lake = await createSite({ name: 'Kohlbachmühle', waterBody: 'Attersee' });
      expect((await json<Site[]>('GET', '/api/dive-sites?q=atters')).map((s) => s.id)).toEqual([lake.id]);
      expect((await json<Site[]>('GET', '/api/dive-sites?q=kohlbach')).map((s) => s.id)).toEqual([lake.id]);
    });
  });

  describe('a Dive at a site', () => {
    let reef: Site;
    let diveId: string;
    const getDive = (id = diveId, cookie = tim) => json<Dive>('GET', `/api/dives/${id}`, cookie);

    beforeAll(async () => {
      reef = await createSite({ name: 'House reef', position: HOUSE_REEF, country: 'EG' }, anna);
    });

    it('a new Dive is linked to the only site within 200 m of where it ended, by the Import', async () => {
      const exit = metresNorth(HOUSE_REEF, 120);
      const outcome = await upload('reef.fit', makeSyntheticDive({ serialNumber: 501, start: new Date('2026-03-01T08:00:00Z'), exit }));
      expect(outcome.result).toBe('created');
      diveId = outcome.diveId;
      const d = await getDive();
      expect(d.site).toEqual({ id: reef.id, name: 'House reef' });
      expect(d.position!.latitude).toBeCloseTo(exit.latitude, 6);

      const [latest] = await json<Revision[]>('GET', `/api/dives/${diveId}/revisions`);
      expect(latest).toMatchObject({ cause: 'auto-site', actor: { type: 'import' } });
      expect(latest!.changes.site).toEqual({ from: null, to: { id: reef.id, name: 'House reef' } });
    });

    it('is not linked when two sites are that close, or none', async () => {
      const spot = { latitude: 12.1, longitude: -68.9 };
      await createSite({ name: 'Twin A', position: metresNorth(spot, 50) });
      await createSite({ name: 'Twin B', position: metresNorth(spot, -50) });
      const twins = await upload('twins.fit', makeSyntheticDive({ serialNumber: 502, start: new Date('2026-03-02T08:00:00Z'), exit: spot }));
      expect((await getDive(twins.diveId)).site).toBeNull();

      const lonely = await upload('lonely.fit', makeSyntheticDive({ serialNumber: 503, start: new Date('2026-03-03T08:00:00Z'), exit: { latitude: 0.5, longitude: 0.5 } }));
      expect((await getDive(lonely.diveId)).site).toBeNull();
      const noPosition = await upload('none.fit', makeSyntheticDive({ serialNumber: 504, start: new Date('2026-03-04T08:00:00Z') }));
      expect(await getDive(noPosition.diveId)).toMatchObject({ site: null, position: null });
    });

    it('uses the entry position when the Device recorded no exit', async () => {
      const entry = { latitude: 36.1, longitude: 14.2 };
      const outcome = await upload('entry.fit', makeSyntheticDive({ serialNumber: 505, start: new Date('2026-03-05T08:00:00Z'), entry }));
      const { position } = await getDive(outcome.diveId);
      expect(position!.latitude).toBeCloseTo(entry.latitude, 6); // FIT stores semicircles
      expect(position!.longitude).toBeCloseTo(entry.longitude, 6);
    });

    it('the Diver sets or clears the site with the Dive\'s version, and the history names it', async () => {
      const other = await createSite({ name: 'Canyon' });
      const before = await getDive();
      const moved = await call('PATCH', `/api/dives/${diveId}`, tim, { version: before.version, siteId: other.id });
      expect(moved.statusCode).toBe(200);
      expect((moved.json() as Dive).site).toEqual({ id: other.id, name: 'Canyon' });

      const stale = await call('PATCH', `/api/dives/${diveId}`, tim, { version: before.version, siteId: null });
      expect(stale.json()).toMatchObject({ code: 'dive_changed' });

      const cleared = await call('PATCH', `/api/dives/${diveId}`, tim, { version: before.version + 1, siteId: null });
      expect((cleared.json() as Dive).site).toBeNull();
      const [latest] = await json<Revision[]>('GET', `/api/dives/${diveId}/revisions`);
      expect(latest).toMatchObject({ cause: 'edit', changes: { site: { from: { id: other.id, name: 'Canyon' }, to: null } } });

      const unknown = await call('PATCH', `/api/dives/${diveId}`, tim, { version: before.version + 2, siteId: '00000000-0000-7000-8000-000000000000' });
      expect(unknown.json()).toMatchObject({ code: 'site_not_found' });
      await call('PATCH', `/api/dives/${diveId}`, tim, { version: before.version + 2, siteId: reef.id });
    });

    it('a site with Dives can\'t be deleted, and counts only the User\'s own Dives', async () => {
      const refused = await call('DELETE', `/api/dive-sites/${reef.id}`, anna);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'site_in_use' });
      expect(await json<Site>('GET', `/api/dive-sites/${reef.id}`, tim)).toMatchObject({ diveCount: 1, inUse: true });
      expect(await json<Site>('GET', `/api/dive-sites/${reef.id}`, anna)).toMatchObject({ diveCount: 0, inUse: true });
    });

    it('another User\'s Dive position stays private', async () => {
      expect((await call('GET', `/api/dives/${diveId}`, anna)).statusCode).toBe(404);
    });

    it('Recordings imported before positions were kept get them from their Original, once', async () => {
      const exit = { latitude: 47.9, longitude: 13.55 };
      const outcome = await upload('old.fit', makeSyntheticDive({ serialNumber: 506, start: new Date('2026-03-06T08:00:00Z'), exit }));
      // As a database from before ADR 0020 has it: no positions, never read for them.
      await t.pool.query(`update recording set exit_latitude = null, exit_longitude = null, positions_read_at = null
        where dive_id = $1`, [outcome.diveId]);
      expect((await getDive(outcome.diveId)).position).toBeNull();

      expect(await ctx.imports.backfillPositions()).toBe(1);
      const { position } = await getDive(outcome.diveId);
      expect(position!.latitude).toBeCloseTo(exit.latitude, 6);
      expect(await ctx.imports.backfillPositions()).toBe(0);
    });

    it('the logbook shows each Dive\'s site, filters by site and finds Dives by the site\'s name', async () => {
      type Page = { dives: { id: string; site: { id: string; name: string } | null }[]; total: number };
      const all = await json<Page>('GET', '/api/dives');
      expect(all.dives.find((d) => d.id === diveId)!.site).toEqual({ id: reef.id, name: 'House reef' });

      const atReef = await json<Page>('GET', `/api/dives?siteId=${reef.id}`);
      expect(atReef).toMatchObject({ total: 1, dives: [{ id: diveId }] });
      const found = await json<Page>('GET', '/api/dives?q=house');
      expect(found.dives.map((d) => d.id)).toEqual([diveId]);
    });
  });
});
