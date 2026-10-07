// The Dives before and after one in the logbook's order (ADR 0042): the same filters and sort as the list, without a page.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dive } from '../src/db/schema.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

type Neighbours = { previous: { id: string } | null; next: { id: string } | null; position: number | null; total: number };

describe.skipIf(!(await databaseReachable()))('neighbours of a Dive in the logbook list', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let other: string;
  let siteId: string;
  // Oldest to newest: a (depth 10, no site), b (30, site), c (20, site), d (40, no site).
  const id: Record<'a' | 'b' | 'c' | 'd', string> = { a: '', b: '', c: '', d: '' };

  const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const neighbours = async (of: string, query = '', cookie = ann) => {
    const response = await call('GET', `/api/dives/${of}/neighbours${query}`, cookie);
    return { status: response.statusCode, body: response.json() as Neighbours };
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'other@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    other = await signIn(ctx.app, 'other@example.com');
    const diverId = ((await call('GET', '/api/divers', ann)).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    const site = (await call('POST', '/api/dive-sites', ann, { name: 'Lighthouse', position: { latitude: 35.9, longitude: 14.4 } })).json() as { id: string };
    siteId = site.id;
    const make = async (day: number, maxDepthM: number, siteId?: string) =>
      (await t.db.insert(dive).values({
        diverId, startsAt: new Date(Date.UTC(2026, 1, day, 10)), durationSeconds: 2400, maxDepthM, ...(siteId && { siteId }),
      }).returning({ id: dive.id }))[0]!.id;
    id.a = await make(1, 10);
    id.b = await make(2, 30, site.id);
    id.c = await make(3, 20, site.id);
    id.d = await make(4, 40);
  });

  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('follows the list order: newest first by default, so "next" is the older dive', async () => {
    const { body } = await neighbours(id.c);
    expect(body).toEqual({ previous: { id: id.d }, next: { id: id.b }, position: 2, total: 4 });
  });

  it('has no previous at the top of the list and no next at its end', async () => {
    expect((await neighbours(id.d)).body).toMatchObject({ previous: null, next: { id: id.c }, position: 1 });
    expect((await neighbours(id.a)).body).toMatchObject({ previous: { id: id.b }, next: null, position: 4 });
  });

  it('follows the sort and its direction', async () => {
    expect((await neighbours(id.c, '?sort=maxDepth&order=asc')).body).toMatchObject({ previous: { id: id.a }, next: { id: id.b }, position: 2 });
    expect((await neighbours(id.c, '?order=asc')).body).toMatchObject({ previous: { id: id.b }, next: { id: id.d } });
  });

  it('follows the filters and the search, and counts only what they show', async () => {
    expect((await neighbours(id.d, '?only=no-site')).body).toEqual({ previous: null, next: { id: id.a }, position: 1, total: 2 });
    expect((await neighbours(id.c, `?siteId=${siteId}`)).body).toEqual({ previous: null, next: { id: id.b }, position: 1, total: 2 });
  });

  it('says nothing about a Dive the list does not show', async () => {
    expect((await neighbours(id.b, '?only=no-site')).body).toEqual({ previous: null, next: null, position: null, total: 2 });
  });

  it('answers 404 for a Dive of someone else, and 400 for a filter it does not know', async () => {
    expect((await neighbours(id.c, '', other)).status).toBe(404);
    expect((await neighbours(id.c, '?only=nonsense')).status).toBe(400);
  });
});
