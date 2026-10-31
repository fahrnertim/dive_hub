import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGarminClient, GarminError } from '../src/providers/garmin/garmin-client.js';
import { createFakeGarmin, type FakeGarmin, type FakeGarminDive } from './fake-garmin.js';

const fit = new Uint8Array(readFileSync(new URL('./fixtures/synthetic-dive.fit', import.meta.url)));
const KEY = 'GCDC_secret-key-1234';
const dive = (n: number): FakeGarminDive => ({ activityId: 1000 + n, typeKey: 'single_gas_diving', startTimeLocal: '2026-10-01 10:00:00', fit });

let garmin: FakeGarmin;
beforeEach(async () => {
  garmin = await createFakeGarmin();
});
afterEach(() => garmin.close());

const setup = (dives: FakeGarminDive[]) => {
  garmin.addAccount({ key: KEY, guid: 'guid-1', displayName: 'Ida Diver', dives });
  return createGarminClient({ url: garmin.url });
};

describe('Garmin client', () => {
  it('trades a key for a token whose account is the garmin_guid', async () => {
    const token = await setup([]).token(KEY);
    expect(token.accountId).toBe('guid-1');
    const exp = JSON.parse(Buffer.from(token.jwt.split('.')[1]!, 'base64url').toString()).exp as number;
    expect(token.expiresAt).toBe(exp * 1000);
  });

  it('sends Accept */* on the token and the download', async () => {
    const client = setup([dive(1)]);
    const token = await client.token(KEY); // the fake answers 406 to anything else
    await expect(client.file(token.jwt, '1001')).resolves.toBeDefined();
  });

  it('reads every page of the dive listing', async () => {
    const client = setup(Array.from({ length: 230 }, (_, i) => dive(i)));
    const token = await client.token(KEY);
    const list = await client.dives(token.jwt);
    expect(list).toHaveLength(230);
    expect(list[0]).toMatchObject({ activityId: 1000, typeKey: 'single_gas_diving', manual: false, ownerDisplayName: 'Ida Diver', maxDepth: 18.4 });
    expect(garmin.calls.filter((c) => c.includes('/activities?')).map((c) => /start=(\d+)/.exec(c)![1])).toEqual(['0', '100', '200']);
  });

  it('answers the FIT inside the downloaded zip', async () => {
    const client = setup([dive(1)]);
    const token = await client.token(KEY);
    expect(Buffer.from(await client.file(token.jwt, '1001')).equals(Buffer.from(fit))).toBe(true);
  });

  it('a revoked key is wrong_credentials', async () => {
    const client = setup([]);
    garmin.revoke(KEY);
    const error = await client.token(KEY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarminError);
    expect((error as GarminError).reason).toBe('wrong_credentials');
    expect((error as GarminError).message).not.toContain(KEY);
  });

  it('429 on a download is unavailable', async () => {
    const client = createGarminClient({ url: garmin.url, fetch: async () => new Response('', { status: 429 }) });
    const error = await client.file('jwt', '1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarminError);
    expect((error as GarminError).reason).toBe('unavailable');
  });

  it('a download whose answer breaks off is unavailable', async () => {
    const broken = () => new ReadableStream({ start(c) { c.error(new Error('connection reset')); } });
    const client = createGarminClient({ url: garmin.url, fetch: async () => new Response(broken(), { status: 200 }) });
    for (const call of [() => client.file('jwt', '1'), () => client.token(KEY)]) {
      const error = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GarminError);
      expect((error as GarminError).reason).toBe('unavailable');
    }
  });

  it('a listing that answers the same page again is refused, not read forever', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      activityId: 5000 + i, startTimeLocal: '2026-10-01 10:00:00', startTimeGMT: '2026-10-01 08:00:00', activityType: { typeKey: 'single_gas_diving' },
    }));
    let pages = 0;
    const client = createGarminClient({ url: garmin.url, fetch: async () => { pages += 1; return Response.json(page); } });
    const error = await client.dives('jwt').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarminError);
    expect((error as GarminError).reason).toBe('bad_response');
    expect(pages).toBe(2);
  });
});
