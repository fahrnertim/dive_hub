// A Diver's body weight (ADR 0031, slice A part 3): dated kilograms, seen and set only by the Users who manage the Diver.
// Other Users, and everyone for an external Diver, get "not found"; the weights go with the Diver.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('body weight of a Diver', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const cookies: Record<string, string> = {};
  let timDiver: string;

  const as = (who: string) => async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: cookies[who]!, origin: BASE_URL }, ...(payload && { payload }) });
  const weights = (diverId: string) => `/api/divers/${diverId}/body-weights`;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    for (const who of ['tim', 'bob']) {
      await createUser(ctx.auth, `${who}@example.com`);
      cookies[who] = await signIn(ctx.app, `${who}@example.com`);
    }
    timDiver = ((await (await as('tim')('GET', '/api/divers')).json()) as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('starts with none, keeps one value per date and lists the newest first', async () => {
    const tim = as('tim');
    expect((await tim('GET', weights(timDiver))).json()).toEqual([]);
    expect((await tim('PUT', `${weights(timDiver)}/2026-03-01`, { kg: 81.5 })).statusCode).toBe(204);
    expect((await tim('PUT', `${weights(timDiver)}/2026-09-15`, { kg: 83 })).statusCode).toBe(204);
    expect((await tim('PUT', `${weights(timDiver)}/2026-03-01`, { kg: 82 })).statusCode).toBe(204);
    expect((await tim('GET', weights(timDiver))).json()).toEqual([{ date: '2026-09-15', kg: 83 }, { date: '2026-03-01', kg: 82 }]);
  });

  it('removes one date and says so when it was not there', async () => {
    const tim = as('tim');
    expect((await tim('DELETE', `${weights(timDiver)}/2026-09-15`)).statusCode).toBe(204);
    expect((await tim('GET', weights(timDiver))).json()).toEqual([{ date: '2026-03-01', kg: 82 }]);
    expect((await tim('DELETE', `${weights(timDiver)}/2026-09-15`)).statusCode).toBe(404);
  });

  it('refuses a weight no person has and a date that is no date', async () => {
    const tim = as('tim');
    for (const kg of [0, 19.9, 400.1]) {
      expect((await tim('PUT', `${weights(timDiver)}/2026-04-01`, { kg })).statusCode, `${kg} kg`).toBe(400);
    }
    expect((await tim('PUT', `${weights(timDiver)}/2026-02-30`, { kg: 80 })).statusCode).toBe(400);
    expect((await tim('PUT', `${weights(timDiver)}/yesterday`, { kg: 80 })).statusCode).toBe(400);
    expect((await tim('GET', weights(timDiver))).json()).toEqual([{ date: '2026-03-01', kg: 82 }]);
  });

  it('is invisible and untouchable for a User who does not manage the Diver', async () => {
    const bob = as('bob');
    for (const [method, url, payload] of [
      ['GET', weights(timDiver)], ['PUT', `${weights(timDiver)}/2026-05-01`, { kg: 70 }], ['DELETE', `${weights(timDiver)}/2026-03-01`],
    ] as const) {
      const answer = await bob(method, url, payload);
      expect(answer.statusCode, `${method}`).toBe(404);
      expect(answer.json()).toMatchObject({ code: 'diver_not_found' });
    }
    expect(JSON.stringify((await bob('GET', `/api/divers/${timDiver}/details`)).json())).not.toMatch(/weight|kg/i);
    expect(JSON.stringify((await as('tim')('GET', '/api/divers')).json())).not.toMatch(/weight/i);
    expect((await as('tim')('GET', weights(timDiver))).json()).toEqual([{ date: '2026-03-01', kg: 82 }]);
  });

  it('has none for an external Diver, whoever asks', async () => {
    const created = await as('tim')('POST', '/api/external-divers', { name: 'Samuel Dreier' });
    const external = (created.json() as { id: string }).id;
    for (const who of ['tim', 'bob']) {
      expect((await as(who)('GET', weights(external))).statusCode).toBe(404);
      expect((await as(who)('PUT', `${weights(external)}/2026-05-01`, { kg: 75 })).statusCode).toBe(404);
    }
  });

  it('goes with the Diver', async () => {
    const tim = as('tim');
    const child = (await tim('POST', '/api/divers', { name: 'Lina' })).json() as { id: string };
    await tim('PUT', `${weights(child.id)}/2026-06-01`, { kg: 31 });
    expect((await tim('GET', weights(child.id))).json()).toEqual([{ date: '2026-06-01', kg: 31 }]);
    expect((await tim('DELETE', `/api/divers/${child.id}`)).statusCode).toBe(204);
    expect((await t.db.execute(sql`select count(*)::int as n from diver_body_weight where diver_id = ${child.id}::uuid`)).rows).toEqual([{ n: 0 }]);
  });
});
