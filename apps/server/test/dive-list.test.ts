// The logbook list through the HTTP API (ADR 0017): pages, sorting, search, scoping.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Summary = { id: string; number: number | null; maxDepthM: number | null; startsAt: string };
type List = { dives: Summary[]; total: number };

describe.skipIf(!(await databaseReachable()))('the logbook list', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let other: string;

  const list = async (query = '', cookie = ann) =>
    (await ctx.app.inject({ method: 'GET', url: `/api/dives${query}`, headers: { cookie } })).json() as List;
  const numbers = (l: List) => l.dives.map((d) => d.number);

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'other@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    other = await signIn(ctx.app, 'other@example.com');
    // Five dives a day apart: numbers 1–5, depths 12, 30, 18, 25, 8 m.
    const depths = [12, 30, 18, 25, 8];
    for (const [i, maxDepthM] of depths.entries()) {
      const { payload, headers } = multipartFile(`dive-${i + 1}.fit`, makeSyntheticDive({
        serialNumber: 100, start: new Date(Date.UTC(2026, 2, 1 + i, 9)), maxDepthM, diveNumber: i + 1,
      }));
      const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
      await ctx.imports.processImport(created.json().id);
    }
    // Notes on dive 3, with characters that mean something in LIKE patterns.
    const third = (await list('?q=3')).dives[0]!;
    const full = (await ctx.app.inject({ method: 'GET', url: `/api/dives/${third.id}`, headers: { cookie: ann } })).json();
    await ctx.app.inject({
      method: 'PATCH', url: `/api/dives/${third.id}`, headers: { cookie: ann, origin: BASE_URL },
      payload: { version: full.version, notes: 'Turtle at 100% visibility' },
    });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('lists the newest first, a page at a time, with the total', async () => {
    expect(numbers(await list())).toEqual([5, 4, 3, 2, 1]);
    const page = await list('?limit=2&offset=2');
    expect(numbers(page)).toEqual([3, 2]);
    expect(page.total).toBe(5);
  });

  it('sorts by number, depth and duration, both ways', async () => {
    expect(numbers(await list('?sort=number&order=asc'))).toEqual([1, 2, 3, 4, 5]);
    expect(numbers(await list('?sort=maxDepth&order=desc'))).toEqual([2, 4, 3, 1, 5]);
    expect(numbers(await list('?sort=maxDepth&order=asc'))).toEqual([5, 1, 3, 4, 2]);
  });

  it('finds a dive by its number or by words from its notes', async () => {
    expect(numbers(await list('?q=4'))).toEqual([4]);
    expect(numbers(await list('?q=turtle'))).toEqual([3]);
    expect(numbers(await list(`?q=${encodeURIComponent('100%')}`))).toEqual([3]); // % is a letter here
    expect(await list(`?q=${encodeURIComponent('1_0')}`)).toMatchObject({ dives: [], total: 0 }); // so is _
  });

  it('shows nothing of other Users', async () => {
    expect(await list('', other)).toMatchObject({ dives: [], total: 0 });
    expect((await list('?q=turtle', other)).total).toBe(0);
  });

  it('refuses a page size beyond the limit', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/dives?limit=1000', headers: { cookie: ann } });
    expect(response.statusCode).toBe(400);
  });
});
