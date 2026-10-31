// A Recording's summary keeps FIT's gas consumption (ADR 0032, slice 21).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase } from './support.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';

describe.skipIf(!(await databaseReachable()))('gas consumption of a Recording', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    cookie = await signIn(ctx.app, 'tim@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it("keeps the computer's SAC and RMV from a FIT file", async () => {
    const { payload, headers } = multipartFile('old.fit', makeSyntheticDive({ serialNumber: 700, avgVolumeSac: 16.5, avgRmv: 20 }));
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(response.json().id);
    const summaryOf = async () => (await t.pool.query(`select summary from recording where recording_key like 'garmin:700:%'`)).rows[0].summary;
    expect(await summaryOf()).toMatchObject({ sacLpm: 16.5, rmvLpm: 20 });
  });
});
