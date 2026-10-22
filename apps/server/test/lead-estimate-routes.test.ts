// The lead estimate over HTTP (ADR 0031, slice 20b): GET /api/divers/{id}/lead-estimate loads the Diver's Dives, Cylinders
// and body weight, calls the engine and stores nothing. The engine's figures are tested in lead-estimate.test.ts; here:
// who may ask, what is loaded, what is left out, what the route takes and says.
// Expected values are worked by hand from the engine's rules (research note "Proposed estimator"; data model scenario 5):
//   scenario 5: 10 kg carried, too heavy by 2 kg, 5 mm wetsuit, salt water, AL80 -> in the same conditions 8 kg needed;
//   rule of thumb: 10 % of 82 kg = 8.2 kg for 5 mm in salt water with an AL80, rounded to 0.5 kg -> 8; range +-3 kg -> 5.2..11.2 -> 5..11;
//   imperial: 8 kg = 17.64 lb -> 18; range 6.5..9.5 kg (+-1.5 for one or two dives) = 14.3..20.9 lb -> 14..21.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase } from './support.js';

type Estimate = {
  unit: 'kg' | 'lb';
  total: number | null;
  range: { low: number; high: number } | null;
  confidence: 'low' | 'medium' | 'high';
  basis:
    | { kind: 'dives'; dives: { diveId: string; startsAt: string; number: number | null; carried: number; needed: number; weight: number }[]; personal: number }
    | { kind: 'rule_of_thumb'; rule: number; personalOffset: number | null; offsetFromSuits: number }
    | null;
  adjustments: { kind: string; amount: number }[];
  missing: { kind: string }[];
  reserve: { bar: number; fromDives: boolean };
  leftOut: { noWaterType: number };
  weightCheck: { steps: string[]; reserveBar: number };
};

describe.skipIf(!(await databaseReachable()))('the lead estimate of a Diver', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const cookies: Record<string, string> = {};
  const divers: Record<string, string> = {};
  let redSea: string;

  const call = (who: string | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { origin: BASE_URL, ...(who && { cookie: cookies[who]! }) }, ...(payload && { payload }) });
  const AL80 = '[{"volumeL":11.1,"material":"aluminium"}]';
  const WETSUIT_5 = 'suit=wetsuit&suitThicknessMm=5&suitHood=false';
  /** The planned conditions of a 5 mm wetsuit in salt water with an AL80; `null` takes a parameter away. */
  const query = (over: Record<string, string | null> = {}) =>
    new URLSearchParams(Object.entries({ water: 'salt', cylinders: AL80, ...Object.fromEntries(new URLSearchParams(WETSUIT_5)), ...over })
      .filter((entry): entry is [string, string] => entry[1] !== null)).toString();
  const estimate = (who: string, diverId: string, q = query()) => call(who, 'GET', `/api/divers/${diverId}/lead-estimate?${q}`);

  async function importedDive(who: string, day: number) {
    const { payload, headers } = multipartFile(`garmin-${day}.fit`, makeSyntheticDive({
      serialNumber: 100 + (who === 'tim' ? 0 : 1), start: new Date(`2026-02-${String(day).padStart(2, '0')}T09:00:00Z`),
    }));
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: cookies[who]! } });
    await ctx.imports.processImport(response.json().id);
    const done = (await call(who, 'GET', `/api/imports/${response.json().id}`)).json();
    return done.outcome[0].diveId as string;
  }
  async function edit(who: string, diveId: string, values: object) {
    const { version } = (await call(who, 'GET', `/api/dives/${diveId}`)).json() as { version: number };
    const response = await call(who, 'PATCH', `/api/dives/${diveId}`, { version, ...values });
    expect(response.statusCode).toBe(200);
  }
  const al80Dive = { volumeL: 11.1, workingPressureBar: 207, material: 'aluminium', gas: { o2: 21, he: 0 }, startPressureBar: 200, endPressureBar: null };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    for (const who of ['tim', 'bob']) {
      await createUser(ctx.auth, `${who}@example.com`);
      cookies[who] = await signIn(ctx.app, `${who}@example.com`);
      divers[who] = ((await (await call(who, 'GET', '/api/divers')).json()) as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    }
    redSea = (await call('tim', 'POST', '/api/dive-sites', { name: 'Red Sea reef', waterType: 'salt' })).json().id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('who may ask', () => {
    it('wants a signed-in User', async () => {
      expect((await call(null, 'GET', `/api/divers/${divers.tim}/lead-estimate?${query()}`)).statusCode).toBe(401);
    });

    it('answers diver_not_found for a User who does not manage the Diver, as for body weights, and for a Diver that does not exist', async () => {
      for (const id of [divers.tim!, '00000000-0000-7000-8000-000000000000']) {
        const response = await estimate('bob', id);
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ code: 'diver_not_found' });
      }
    });
  });

  describe('a Diver with no history', () => {
    it('without body weight has no number: it says what is missing and still asks for a weight check', async () => {
      const response = await estimate('tim', divers.tim!);
      expect(response.statusCode).toBe(200);
      const body = response.json() as Estimate;
      expect(body).toMatchObject({ total: null, range: null, basis: null, adjustments: [], confidence: 'low', unit: 'kg' });
      expect(body.missing).toEqual([{ kind: 'body_weight' }]);
      expect(body.weightCheck.steps).toEqual(['eye_level_empty_bc', 'neutral_at_5m_at_reserve']);
      expect(body.weightCheck.reserveBar).toBe(50);
    });

    it('with body weight gives the rule of thumb with a wide range, the latest weight counting', async () => {
      await call('tim', 'PUT', `/api/divers/${divers.tim}/body-weights/2026-03-01`, { kg: 70 });
      await call('tim', 'PUT', `/api/divers/${divers.tim}/body-weights/2026-09-15`, { kg: 82 });
      const body = (await estimate('tim', divers.tim!)).json() as Estimate;
      expect(body).toMatchObject({ total: 8, range: { low: 5, high: 11 }, confidence: 'low', reserve: { bar: 50, fromDives: false } });
      expect(body.basis).toMatchObject({ kind: 'rule_of_thumb', rule: 8.2, personalOffset: null, offsetFromSuits: 0 });
      expect(body.missing).toEqual([]);
      expect(body.leftOut).toEqual({ noWaterType: 0 });
    });
  });

  describe('from the Diver\'s own Dives', () => {
    let first: string;
    let noSite: string;

    beforeAll(async () => {
      first = await importedDive('tim', 1);
      await edit('tim', first, {
        siteId: redSea, lead: [{ amountKg: 10, placement: 'belt' }], weightingFeedback: { felt: 'too_heavy', amountKg: 2 },
        suit: { type: 'wetsuit', thicknessMm: 5, hood: false }, cylinders: [al80Dive],
      });
    });

    it('rests on a Dive with the same suit, corrected by its feedback, and links it (scenario 5)', async () => {
      const body = (await estimate('tim', divers.tim!)).json() as Estimate;
      expect(body).toMatchObject({ total: 8, confidence: 'medium' });
      expect(body.basis).toMatchObject({ kind: 'dives', dives: [{ diveId: first, carried: 10, needed: 8, weight: expect.any(Number) as number }] });
      expect(body.range).toEqual({ low: 6.5, high: 9.5 });
      expect(body.adjustments.map((a) => a.kind)).toEqual(['cylinder', 'water']);
    });

    it('leaves out a Dive without a site (its water is not known) and counts it as left out', async () => {
      noSite = await importedDive('tim', 2);
      await edit('tim', noSite, { lead: [{ amountKg: 4, placement: null }], suit: { type: 'wetsuit', thicknessMm: 5, hood: false }, cylinders: [al80Dive] });
      const body = (await estimate('tim', divers.tim!)).json() as Estimate;
      expect(body.total).toBe(8);
      expect(body.basis).toMatchObject({ kind: 'dives', dives: [{ diveId: first }] });
      expect((body.basis as { dives: unknown[] }).dives).toHaveLength(1);
      expect(body.leftOut).toEqual({ noWaterType: 1 });
    });

    it('leaves out a deleted Dive', async () => {
      const { version } = (await call('tim', 'GET', `/api/dives/${first}`)).json() as { version: number };
      const response = await call('tim', 'DELETE', `/api/dives/${first}`, { version });
      expect(response.statusCode).toBeLessThan(300);
      const body = (await estimate('tim', divers.tim!)).json() as Estimate;
      expect(body.basis).toMatchObject({ kind: 'rule_of_thumb' });
    });

    it('does not take another User\'s Dives', async () => {
      const bobs = await importedDive('bob', 1);
      await edit('bob', bobs, {
        siteId: redSea, lead: [{ amountKg: 3, placement: null }], suit: { type: 'wetsuit', thicknessMm: 5, hood: false }, cylinders: [al80Dive],
      });
      const body = (await estimate('tim', divers.tim!)).json() as Estimate;
      expect(body.basis).toMatchObject({ kind: 'rule_of_thumb' });
      expect((await estimate('bob', divers.bob!)).json()).toMatchObject({ missing: [{ kind: 'body_weight' }] });
    });

    it('says pounds rounded to whole pounds when asked, with the same unrounded kilograms behind it', async () => {
      const again = await importedDive('tim', 3);
      await edit('tim', again, {
        siteId: redSea, lead: [{ amountKg: 10, placement: 'belt' }], weightingFeedback: { felt: 'too_heavy', amountKg: 2 },
        suit: { type: 'wetsuit', thicknessMm: 5, hood: false }, cylinders: [al80Dive],
      });
      const body = (await estimate('tim', divers.tim!, query({ unit: 'lb' }))).json() as Estimate;
      expect(body).toMatchObject({ unit: 'lb', total: 18, range: { low: 14, high: 21 } });
      expect(body.basis).toMatchObject({ kind: 'dives', dives: [{ diveId: again, carried: 22, needed: 17.6 }] });
    });
  });

  describe('what it takes', () => {
    it('refuses what is not a plan: no water, no Cylinder, a Cylinder that is not data, a thickness for a drysuit', async () => {
      const refused = async (q: string) => {
        const response = await estimate('tim', divers.tim!, q);
        return [response.statusCode, (response.json() as { code: string }).code];
      };
      expect(await refused(`suit=wetsuit&cylinders=${encodeURIComponent(AL80)}`)).toEqual([400, 'invalid_input']);
      expect(await refused(query({ cylinders: '[]' }))).toEqual([400, 'invalid_input']);
      expect(await refused(query({ cylinders: 'not json' }))).toEqual([400, 'invalid_input']);
      expect(await refused(query({ cylinders: '[{"volumeL":0}]' }))).toEqual([400, 'invalid_input']);
      expect(await refused(query({ water: 'lava' }))).toEqual([400, 'invalid_input']);
      expect(await refused(query({ suit: 'drysuit', suitThicknessMm: '4' }))).toEqual([400, 'suit_invalid']);
      expect(await refused(query({ suit: 'wetsuit', suitUndergarment: 'light' }))).toEqual([400, 'suit_invalid']);
    });

    it('takes a drysuit with an undergarment, a Cylinder without a material and twin cylinders, and says the material is missing', async () => {
      const response = await estimate('tim', divers.tim!, query({
        suit: 'drysuit', suitThicknessMm: null, suitUndergarment: 'medium', suitHood: 'true', cylinders: '[{"volumeL":12},{"volumeL":12,"material":"steel"}]',
      }));
      expect(response.statusCode).toBe(200);
      const body = response.json() as Estimate;
      expect(body.total).not.toBeNull();
      expect(body.missing).toContainEqual({ kind: 'cylinder_material', diveIds: [], planned: true });
    });
  });
});
