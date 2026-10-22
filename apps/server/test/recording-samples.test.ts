// The samples of a Recording through the HTTP API: which channels, how many points, and who may ask.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Samples = { recordingId: string; series: { channel: string; offsetsMs: number[]; values: number[] }[] };

describe.skipIf(!(await databaseReachable()))('the samples of a Recording', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let recordingId: string;

  const get = (url: string, cookie = ann) => ctx.app.inject({ method: 'GET', url, headers: { cookie } });

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'ann@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    const { payload, headers } = multipartFile('ann.fit', makeSyntheticDive({ serialNumber: 321 }));
    const sent = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
    await ctx.imports.processImport(sent.json().id);
    recordingId = (await get(`/api/imports/${sent.json().id}`)).json().outcome[0].recordingId;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('answers every channel, with the Recording named', async () => {
    const answer = (await get(`/api/recordings/${recordingId}/samples`)).json() as Samples;
    expect(answer.recordingId).toBe(recordingId);
    expect(answer.series.map((s) => s.channel)).toContain('depth');
    expect(answer.series.length).toBeGreaterThan(1);
  });

  it('answers only the channels asked for, ignoring blanks', async () => {
    const answer = (await get(`/api/recordings/${recordingId}/samples?channels=depth,%20`)).json() as Samples;
    expect(answer.series.map((s) => s.channel)).toEqual(['depth']);
  });

  it('reduces a series to at most maxPoints', async () => {
    const all = (await get(`/api/recordings/${recordingId}/samples?channels=depth`)).json() as Samples;
    const few = (await get(`/api/recordings/${recordingId}/samples?channels=depth&maxPoints=4`)).json() as Samples;
    expect(all.series[0]!.values.length).toBeGreaterThan(4);
    expect(few.series[0]!.values.length).toBeLessThanOrEqual(4);
    expect(few.series[0]!.offsetsMs).toHaveLength(few.series[0]!.values.length);
  });

  it('knows nothing of a Recording that does not exist', async () => {
    expect((await get('/api/recordings/00000000-0000-4000-8000-000000000000/samples')).statusCode).toBe(404);
  });
});
