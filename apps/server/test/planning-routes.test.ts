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
      used: {
        gfHigh: Used<number>; sacLpm: Used<number> & { basedOn?: number }; water: Used<string>; altitudeM: Used<number>;
        gasRule: Used<{ kind: string; bar: number | null }>;
      };
      ascentPressureBar: number | null;
      recentDiveEndedAt: string | null;
    };
    const bottomTime = async (who: string, query: string) => (await get(who, `/api/tools/bottom-time?${query}`)).json() as BottomTimeView;

    it('without a Diver uses the stated defaults and says that they are defaults', async () => {
      const r = await bottomTime('tim', `depth=30&o2=32&${al80}`);
      expect(r.status).toBe('ok');
      expect(r.used).toEqual({
        gfHigh: { value: 85, source: 'default' }, sacLpm: { value: 20, source: 'default' }, water: { value: 'salt', source: 'default' },
        altitudeM: { value: 0, source: 'default' }, gasRule: { value: { kind: 'rock_bottom', bar: null }, source: 'default' },
      });
      expect(r.limits!.gas).not.toBeNull();
      expect(r.ascentPressureBar).toBeGreaterThanOrEqual(50);
      expect(r.binding!.length).toBeGreaterThan(0);
      expect(r.recentDiveEndedAt).toBeNull();
    });

    it('takes what the caller gives, and says so', async () => {
      const r = await bottomTime('tim', `depth=30&o2=32&${al80}&gfHigh=70&sac=15&water=fresh&altitude=300&rule=reserve&bar=60`);
      expect(r.used).toEqual({
        gfHigh: { value: 70, source: 'request' }, sacLpm: { value: 15, source: 'request' }, water: { value: 'fresh', source: 'request' },
        altitudeM: { value: 300, source: 'request' }, gasRule: { value: { kind: 'reserve', bar: 60 }, source: 'request' },
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

    it("starts from the Diver's latest GF and the planning SAC of their Dives, and says where they came from", async () => {
      // Fewer than 5 Dives with a SAC: the default stands, and says how many there were.
      await upload('tim', makeSyntheticDive({ serialNumber: 801, start: new Date('2026-01-10T09:00:00Z'), avgVolumeSac: 14 }));
      await upload('tim', makeSyntheticDive({ serialNumber: 801, start: new Date('2026-01-11T09:00:00Z'), avgVolumeSac: 18 }));
      await upload('tim', makeSyntheticDive({ serialNumber: 801, start: new Date('2026-01-12T09:00:00Z'), avgVolumeSac: 30 }));
      expect((await bottomTime('tim', `depth=30&o2=32&${al80}&diverId=${timDiver}`)).used.sacLpm).toEqual({ value: 20, source: 'default', basedOn: 3 });
      await upload('tim', makeSyntheticDive({ serialNumber: 801, start: new Date('2026-01-13T09:00:00Z'), avgVolumeSac: 16 }));
      await upload('tim', makeSyntheticDive({ serialNumber: 801, start: new Date('2026-01-14T09:00:00Z'), avgVolumeSac: 20 }));
      // The synthetic file says GF 40/85 everywhere; the newest Recording is the one that counts, so make it say 70.
      await t.pool.query(`update recording set summary = jsonb_set(summary, '{gfHigh}', '70')
        where id = (select id from recording where recording_key like 'garmin:801:%' order by starts_at desc limit 1)`);
      const r = await bottomTime('tim', `depth=30&o2=32&${al80}&diverId=${timDiver}`);
      expect(r.used.gfHigh).toEqual({ value: 70, source: 'recording' });
      // 14, 16, 18, 20, 30: the 85th percentile is at rank 3.4, 20 + 0.4 × 10 = 24.
      expect(r.used.sacLpm).toEqual({ value: 24, source: 'logbook', basedOn: 5 });
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
  describe('gas plan', () => {
    type PlanView = {
      status: string; reason?: string; levelIndex?: number | null; fits?: boolean; controllingIndex?: number;
      leaveLastLevelAtMinute?: number; runtimeMinutes?: number;
      rule?: { kind: string; bar: number | null };
      used?: { water: Used<string>; altitudeM: Used<number>; gasRule: Used<{ kind: string; bar: number | null }>; descentRateMPerMin: Used<number>; ascentRateMPerMin: Used<number> };
      segments?: { kind: string; fromDepthM: number; depthM: number; minutes: number }[];
      divers?: {
        name: string; sacLpm: Used<number> & { basedOn?: number }; litres: number; endPressureBar: number; ascentPressureBar: number;
        turnPressureBar: number | null; rockBottom: { depthM: number; pressureBar: number }[]; controlling: boolean; recentDiveEndedAt: string | null;
        pressuresBar: number[];
      }[];
    };
    const plan = async (who: string, body: Record<string, unknown>) => ctx.app.inject({
      method: 'POST', url: '/api/tools/gas-plan', headers: { cookie: cookies[who]!, origin: BASE_URL }, payload: { o2: 21, water: 'fresh', ...body },
    });
    const levels = [{ depth: 20, minutes: 20 }];
    const typed = (name: string, extra: Record<string, unknown> = {}) => ({ name, volume: 12, pressure: 200, sac: 20, ...extra });

    it('plans typed Divers and says where each value came from; rock bottom is the default rule', async () => {
      const r = await plan('tim', { levels, divers: [typed('Tim'), typed('Ann', { sac: 15 })] });
      expect(r.statusCode).toBe(200);
      const body = r.json() as PlanView;
      expect(body).toMatchObject({ status: 'ok', fits: true, controllingIndex: 0, rule: { kind: 'rock_bottom', bar: null } });
      expect(body.used).toMatchObject({ water: { value: 'fresh', source: 'request' }, gasRule: { value: { kind: 'rock_bottom', bar: null }, source: 'default' } });
      // planning-gas-plan.test.ts holds the figures: 1413 L for a SAC of 20 at 20 m for 20 minutes in fresh water.
      expect(body.divers![0]).toMatchObject({ name: 'Tim', sacLpm: { value: 20, source: 'request' }, controlling: true, turnPressureBar: null });
      expect(body.divers![0]!.litres).toBeCloseTo(1413, 0);
      expect(body.divers![1]!.litres).toBeCloseTo(1060, 0);
      expect(body.divers![0]!.rockBottom).toHaveLength(1);
    });

    it('takes the rule and its pressure', async () => {
      const r = (await (await plan('tim', { levels, divers: [typed('Tim')], rule: 'ascent_pressure', bar: 100 })).json()) as PlanView;
      expect(r.used!.gasRule).toEqual({ value: { kind: 'ascent_pressure', bar: 100 }, source: 'request' });
      expect(r.divers![0]!.ascentPressureBar).toBe(100);
      const turn = (await (await plan('tim', { levels, divers: [typed('Tim'), typed('Ann', { volume: 10 })], rule: 'thirds' })).json()) as PlanView;
      expect(turn.divers![0]!.turnPressureBar).not.toBeNull();
    });

    it("starts a managed Diver's SAC from their planning SAC and leaves other Divers' values out", async () => {
      // The five Dives with a SAC uploaded for the bottom time above: the 85th percentile is 24 L/min.
      const r = (await (await plan('tim', { levels, divers: [{ name: 'Tim', diverId: timDiver, volume: 12, pressure: 200 }] })).json()) as PlanView;
      expect(r.divers![0]!.sacLpm).toEqual({ value: 24, source: 'logbook', basedOn: 5 });
      // Typed SAC wins; a Diver without a SAC and without a logbook gets 20 L/min marked as a default.
      const typedSac = (await (await plan('tim', { levels, divers: [{ name: 'Tim', diverId: timDiver, volume: 12, pressure: 200, sac: 18 }] })).json()) as PlanView;
      expect(typedSac.divers![0]!.sacLpm).toEqual({ value: 18, source: 'request' });
      const unnamed = (await (await plan('tim', { levels, divers: [{ name: 'Guest', volume: 12, pressure: 200 }] })).json()) as PlanView;
      expect(unnamed.divers![0]!.sacLpm).toEqual({ value: 20, source: 'default' });
    });

    it("takes any Diver of the instance by id, and reads nothing of a Diver the User doesn't manage", async () => {
      // Every User sees every Diver by name (ADR 0028); the planning SAC and the last Dive stay with those who manage the Diver.
      const r = await plan('bob', { levels, divers: [{ name: 'Tim', diverId: timDiver, volume: 12, pressure: 200 }] });
      expect(r.statusCode).toBe(200);
      const [tim] = (r.json() as PlanView).divers!;
      expect(tim).toMatchObject({ name: 'Tim', sacLpm: { value: 20, source: 'default' }, recentDiveEndedAt: null });
      expect(tim!.sacLpm.basedOn).toBeUndefined();
    });

    it('takes the rates of descent and ascent, and says where they came from', async () => {
      const usual = (await (await plan('tim', { levels, divers: [typed('Tim')] })).json()) as PlanView;
      expect(usual.used).toMatchObject({ descentRateMPerMin: { value: 18, source: 'default' }, ascentRateMPerMin: { value: 9, source: 'default' } });
      const slow = (await (await plan('tim', { levels, divers: [typed('Tim')], descentRate: 10, ascentRate: 6 })).json()) as PlanView;
      expect(slow.used).toMatchObject({ descentRateMPerMin: { value: 10, source: 'request' }, ascentRateMPerMin: { value: 6, source: 'request' } });
      // planning-gas-plan.test.ts: 2 + 20 + 20/6 + 3 minutes.
      expect(slow.runtimeMinutes).toBeCloseTo(28.3, 1);
      expect(slow.segments!.map((s) => s.kind)).toEqual(['descent', 'level', 'ascent', 'safety_stop', 'ascent']);
      expect(slow.divers![0]!.pressuresBar).toHaveLength(6);
      expect((await plan('tim', { levels, divers: [typed('Tim')], ascentRate: 40 })).statusCode).toBe(400);
    });

    it('answers "outside recreational limits" with the reason and the level, and no numbers', async () => {
      const r = (await (await plan('tim', { levels: [{ depth: 20, minutes: 5 }, { depth: 42, minutes: 5 }], divers: [typed('Tim')] })).json()) as PlanView;
      expect(r).toMatchObject({ status: 'outside_limits', reason: 'depth', levelIndex: 1 });
      expect(r.divers).toBeUndefined();
    });

    it('refuses a plan without levels or Divers', async () => {
      expect((await plan('tim', { levels: [], divers: [typed('Tim')] })).statusCode).toBe(400);
      expect((await plan('tim', { levels, divers: [] })).statusCode).toBe(400);
      expect((await plan('tim', { levels: 'nonsense', divers: [typed('Tim')] })).statusCode).toBe(400);
    });

    it('takes the plan as a JSON body, not in the query', async () => {
      const query = `levels=${encodeURIComponent(JSON.stringify(levels))}&divers=${encodeURIComponent(JSON.stringify([typed('Tim')]))}&o2=21`;
      expect((await get('tim', `/api/tools/gas-plan?${query}`)).statusCode).toBe(404);
    });
  });
});
