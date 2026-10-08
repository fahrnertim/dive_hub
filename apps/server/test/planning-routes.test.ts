// The Tools page's gas numbers and bottom time over HTTP (ADR 0032, slice 21): computed on request, nothing stored.
// The figures themselves are tested in planning-*.test.ts; here: what the routes take, default and say.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase } from './support.js';

type Used<T> = { value: T; source: string };

describe.skipIf(!(await databaseReachable()))('gas numbers and bottom time', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const cookies: Record<string, string> = {};
  let timDiver: string;

  const get = (who: string, url: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie: cookies[who]!, origin: BASE_URL } });
  const upload = async (who: string, data: Uint8Array) => {
    const { payload, headers } = multipartFile('dive.fit', data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: cookies[who]! } });
    await ctx.imports.processImport(response.json().id);
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    for (const who of ['tim', 'bob']) {
      await createUser(ctx.auth, `${who}@example.com`);
      cookies[who] = await signIn(ctx.app, `${who}@example.com`);
    }
    timDiver = ((await (await get('tim', '/api/divers')).json()) as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('gas numbers', () => {
    it('answers MOD at both limits, rounded down, with the ppO2 at a depth, the best mix, EAD and END', async () => {
      const r = await get('tim', '/api/tools/gas?o2=32&depth=30');
      expect(r.statusCode).toBe(200);
      // See planning-gas.test.ts: 33.44 m and 39.66 m, rounded down to a tenth; 1.289 bar; 34 %; EAD 24.42 m; END 30 m (oxygen narcotic).
      expect(r.json()).toMatchObject({
        gas: { o2: 32, he: 0 }, hypoxic: false,
        ppO2Limits: { working: 1.4, contingency: 1.6 },
        modWorkingM: 33.4, modContingencyM: 39.6,
        atDepth: { depthM: 30, ppO2: 1.29, bestMixPercent: 34, eadM: 24.4, endM: 30 },
        conditions: { water: 'salt', altitudeM: 0 },
        oxygenNarcotic: true,
      });
    });

    it('takes water, altitude and the ppO2 limits, and answers without a depth', async () => {
      const r = await get('tim', '/api/tools/gas?o2=32&water=fresh&altitude=900&ppo2Working=1.3&ppo2Contingency=1.5');
      // (1.3 / 0.32 − 0.9097) × 10.1972 = 32.15 m, rounded down; (1.5 / 0.32 − 0.9097) × 10.1972 = 38.52 m.
      expect(r.json()).toMatchObject({ modWorkingM: 32.1, modContingencyM: 38.5, atDepth: null });
    });

    it('counts oxygen as not narcotic when asked', async () => {
      const r = await get('tim', '/api/tools/gas?o2=21&he=35&depth=40&oxygenNarcotic=false');
      // See planning-gas.test.ts: 17.81 m.
      expect(r.json()).toMatchObject({ atDepth: { endM: 17.8 }, oxygenNarcotic: false });
    });

    it('calls a mix below 18 % hypoxic at the surface and refuses one below 16 %', async () => {
      expect((await get('tim', '/api/tools/gas?o2=17&he=40')).json()).toMatchObject({ hypoxic: true });
      const refused = await get('tim', '/api/tools/gas?o2=15&he=50');
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ code: 'gas_not_breathable' });
      expect((await get('tim', '/api/tools/gas?o2=60&he=50')).statusCode).toBe(400);
    });

    it('wants a signed-in User', async () => {
      const r = await ctx.app.inject({ method: 'GET', url: '/api/tools/gas?o2=32', headers: { origin: BASE_URL } });
      expect(r.statusCode).toBe(401);
    });
  });

  describe('bottom time', () => {
    const al80 = 'volume=11.1&pressure=201';
    type BottomTimeView = {
      status: string; reason?: string; minutes?: number; binding?: string[]; ppO2AboveWorking?: boolean; modM?: number | null;
      limits?: { ndl: number; oxygen: number; gas: number | null };
      used: { gfHigh: Used<number>; sacLpm: Used<number>; water: Used<string>; altitudeM: Used<number>; reserveBar: Used<number> };
      recentDiveEndedAt: string | null;
    };
    const bottomTime = async (who: string, query: string) => (await get(who, `/api/tools/bottom-time?${query}`)).json() as BottomTimeView;

    it('without a Diver uses the stated defaults and says that they are defaults', async () => {
      const r = await bottomTime('tim', `depth=30&o2=32&${al80}`);
      expect(r.status).toBe('ok');
      expect(r.used).toEqual({
        gfHigh: { value: 85, source: 'default' }, sacLpm: { value: 20, source: 'default' }, water: { value: 'salt', source: 'default' },
        altitudeM: { value: 0, source: 'default' }, reserveBar: { value: 50, source: 'default' },
      });
      expect(r.limits!.gas).not.toBeNull();
      expect(r.binding!.length).toBeGreaterThan(0);
      expect(r.recentDiveEndedAt).toBeNull();
    });

    it('takes what the caller gives, and says so', async () => {
      const r = await bottomTime('tim', `depth=30&o2=32&${al80}&gfHigh=70&sac=15&water=fresh&altitude=300&reserve=60`);
      expect(r.used).toEqual({
        gfHigh: { value: 70, source: 'request' }, sacLpm: { value: 15, source: 'request' }, water: { value: 'fresh', source: 'request' },
        altitudeM: { value: 300, source: 'request' }, reserveBar: { value: 60, source: 'request' },
      });
      // A lower GF high gives a shorter limit than the default's.
      const base = await bottomTime('tim', `depth=30&o2=32&${al80}`);
      expect(r.limits!.ndl).toBeLessThan(base.limits!.ndl);
    });

    it('has no gas limit without a Cylinder', async () => {
      const r = await bottomTime('tim', 'depth=30&o2=32');
      expect(r.limits!.gas).toBeNull();
    });

    it('answers "outside recreational limits" with the reason instead of a number', async () => {
      expect(await bottomTime('tim', 'depth=42&o2=21')).toMatchObject({ status: 'outside_limits', reason: 'depth' });
      const beyond = await bottomTime('tim', 'depth=36&o2=40');
      expect(beyond).toMatchObject({ status: 'outside_limits', reason: 'mod' });
      expect(beyond.modM).toBeCloseTo(29.7, 1);
      expect(await bottomTime('tim', 'depth=30&o2=21&he=35')).toMatchObject({ status: 'outside_limits', reason: 'gas' });
    });

    it("starts from the Diver's latest GF and the median SAC of their Recordings, and says where they came from", async () => {
      await upload('tim', makeSyntheticDive({ serialNumber: 801, start: new Date('2026-01-10T09:00:00Z'), avgVolumeSac: 14 }));
      await upload('tim', makeSyntheticDive({ serialNumber: 801, start: new Date('2026-01-11T09:00:00Z'), avgVolumeSac: 18 }));
      await upload('tim', makeSyntheticDive({ serialNumber: 801, start: new Date('2026-01-12T09:00:00Z'), avgVolumeSac: 30 }));
      // The synthetic file says GF 40/85 everywhere; the newest Recording is the one that counts, so make it say 70.
      await t.pool.query(`update recording set summary = jsonb_set(summary, '{gfHigh}', '70')
        where id = (select id from recording where recording_key like 'garmin:801:%' order by starts_at desc limit 1)`);
      const r = await bottomTime('tim', `depth=30&o2=32&${al80}&diverId=${timDiver}`);
      expect(r.used.gfHigh).toEqual({ value: 70, source: 'recording' });
      expect(r.used.sacLpm).toEqual({ value: 18, source: 'recordings' });
    });

    it('warns when the Diver has a Dive from the last 48 hours', async () => {
      const ago = new Date(Date.now() - 2 * 3600_000);
      await upload('tim', makeSyntheticDive({ serialNumber: 802, start: ago, durationSeconds: 30 * 60 }));
      const r = await bottomTime('tim', `depth=30&o2=32&${al80}&diverId=${timDiver}`);
      expect(Math.abs(new Date(r.recentDiveEndedAt!).getTime() - (ago.getTime() + 30 * 60_000))).toBeLessThan(5_000);
    });

    it("uses the planned site's water, brackish counted as salt", async () => {
      const site = async (name: string, waterType: string) =>
        (await ctx.app.inject({ method: 'POST', url: '/api/dive-sites', headers: { cookie: cookies.tim!, origin: BASE_URL }, payload: { name, waterType } })).json() as { id: string };
      const lake = await site('Lake', 'fresh');
      const estuary = await site('Estuary', 'brackish');
      expect((await bottomTime('tim', `depth=18&o2=32&siteId=${lake.id}`)).used.water).toEqual({ value: 'fresh', source: 'site' });
      expect((await bottomTime('tim', `depth=18&o2=32&siteId=${estuary.id}`)).used.water).toEqual({ value: 'salt', source: 'site' });
    });

    it('does not tell another User about a Diver', async () => {
      const r = await get('bob', `/api/tools/bottom-time?depth=30&o2=32&diverId=${timDiver}`);
      expect(r.statusCode).toBe(404);
      expect(r.json()).toMatchObject({ code: 'diver_not_found' });
    });
  });
});
