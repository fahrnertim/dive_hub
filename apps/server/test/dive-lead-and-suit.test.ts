// Lead, weighting feedback and the exposure suit on a Dive through the HTTP API (ADR 0031, slice A): the Dive's own
// values, set with its edit, part of its version and its history; "same as last dive" carries suit and lead.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type LeadEntry = { amountKg: number; placement: string | null };
type Suit = { type: string; thicknessMm: number | null; hood: boolean | null; undergarment: string | null };
type DiveView = {
  id: string; version: number; lead: LeadEntry[]; leadTotalKg: number | null;
  weightingFeedback: { felt: string; amountKg: number | null } | null; suit: Suit | null;
};
type RevisionView = { cause: string; actor: { type: string }; changes: Record<string, { from: unknown; to: unknown }> };

describe.skipIf(!(await databaseReachable()))('Lead, weighting feedback and exposure suit on a Dive', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let other: string;

  const inject = (method: 'GET' | 'PATCH' | 'POST', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const getDive = async (id: string, cookie = tim) => (await inject('GET', `/api/dives/${id}`, cookie)).json() as DiveView;
  const history = async (id: string) => (await inject('GET', `/api/dives/${id}/revisions`, tim)).json() as RevisionView[];
  const edit = async (id: string, values: object, cookie = tim) =>
    inject('PATCH', `/api/dives/${id}`, cookie, { version: (await getDive(id)).version, ...values });

  async function upload(fileName: string, data: Uint8Array, cookie = tim) {
    const { payload, headers } = multipartFile(fileName, data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(response.json().id);
    const done = (await inject('GET', `/api/imports/${response.json().id}`, cookie)).json();
    return done.outcome[0] as { result: string; diveId: string; recordingId: string };
  }
  const day = (d: number, time = '09:00:00') => new Date(`2026-02-${String(d).padStart(2, '0')}T${time}Z`);
  const garminDive = async (d: number, serialNumber = 111) => (await upload(`garmin-${d}.fit`, makeSyntheticDive({ serialNumber, start: day(d) }))).diveId;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'other@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    other = await signIn(ctx.app, 'other@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('lead', () => {
    let diveId: string;
    beforeAll(async () => {
      diveId = await garminDive(1);
    });

    it('is unknown on a Dive nobody logged it for', async () => {
      expect(await getDive(diveId)).toMatchObject({ lead: [], leadTotalKg: null });
    });

    it('is set as placed entries with the Dive\'s edit: the total is their sum, the version goes up and the history has one entry', async () => {
      const before = await getDive(diveId);
      const lead = [{ amountKg: 6, placement: 'belt' }, { amountKg: 1.5, placement: 'trim' }, { amountKg: 0.5, placement: null }];
      const response = await inject('PATCH', `/api/dives/${diveId}`, tim, { version: before.version, lead });
      expect(response.statusCode).toBe(200);
      const after = response.json() as DiveView;
      expect(after.version).toBe(before.version + 1);
      expect(after.lead).toEqual(lead);
      expect(after.leadTotalKg).toBe(8);
      expect(await getDive(diveId)).toMatchObject({ lead, leadTotalKg: 8 });
      const [latest] = await history(diveId);
      expect(latest).toMatchObject({ cause: 'edit', actor: { type: 'user' } });
      expect(latest!.changes).toEqual({ lead: { from: [], to: lead } });
    });

    it('stays when an edit doesn\'t name it, and the same list again changes nothing', async () => {
      const before = await getDive(diveId);
      await edit(diveId, { notes: 'Calm, no current' });
      const noted = await getDive(diveId);
      expect(noted.lead).toEqual(before.lead);
      const entries = (await history(diveId)).length;
      expect((await edit(diveId, { lead: before.lead })).statusCode).toBe(200);
      expect((await getDive(diveId)).version).toBe(noted.version);
      expect(await history(diveId)).toHaveLength(entries);
    });

    it('one entry of 0 means no lead, an empty list unknown again; a placement left out is not given', async () => {
      expect((await edit(diveId, { lead: [{ amountKg: 0 }] })).json()).toMatchObject({ lead: [{ amountKg: 0, placement: null }], leadTotalKg: 0 });
      expect((await edit(diveId, { lead: [] })).json()).toMatchObject({ lead: [], leadTotalKg: null });
      expect((await edit(diveId, { lead: [{ amountKg: 4.8, placement: 'integrated' }] })).json()).toMatchObject({ leadTotalKg: 4.8 });
    });

    it('is refused as a whole when an entry doesn\'t fit, when the Dive changed meanwhile, and for a User who doesn\'t manage its Diver', async () => {
      const status = async (lead: object[]) => (await edit(diveId, { lead })).statusCode;
      expect(await status([{ amountKg: 4 }, { amountKg: -1 }])).toBe(400);
      expect(await status([{ amountKg: 4, placement: 'pocket' }])).toBe(400);
      expect(await status([{ placement: 'belt' }])).toBe(400);
      const { version } = await getDive(diveId);
      const stale = await inject('PATCH', `/api/dives/${diveId}`, tim, { version: version - 1, lead: [] });
      expect([stale.statusCode, stale.json().code]).toEqual([409, 'dive_changed']);
      expect((await inject('PATCH', `/api/dives/${diveId}`, other, { version, lead: [] })).statusCode).toBe(404);
      expect((await getDive(diveId)).lead).toEqual([{ amountKg: 4.8, placement: 'integrated' }]);
    });
  });

  describe('weighting feedback', () => {
    let diveId: string;
    beforeAll(async () => {
      diveId = await garminDive(2);
    });

    it('says how the weighting felt, with by how much where the User says so; one entry in the history', async () => {
      expect((await getDive(diveId)).weightingFeedback).toBeNull();
      const set = await edit(diveId, { weightingFeedback: { felt: 'too_heavy', amountKg: 1 } });
      expect(set.statusCode).toBe(200);
      expect((set.json() as DiveView).weightingFeedback).toEqual({ felt: 'too_heavy', amountKg: 1 });
      expect((await history(diveId))[0]!.changes).toEqual({ weightingFeedback: { from: null, to: { felt: 'too_heavy', amountKg: 1 } } });
      expect(((await edit(diveId, { weightingFeedback: { felt: 'too_light' } })).json() as DiveView).weightingFeedback).toEqual({ felt: 'too_light', amountKg: null });
      expect(((await edit(diveId, { weightingFeedback: { felt: 'right' } })).json() as DiveView).weightingFeedback).toEqual({ felt: 'right', amountKg: null });
    });

    it('stays when an edit doesn\'t name it, and is taken away with null', async () => {
      await edit(diveId, { lead: [{ amountKg: 8, placement: 'belt' }] });
      expect((await getDive(diveId)).weightingFeedback).toEqual({ felt: 'right', amountKg: null });
      expect(((await edit(diveId, { weightingFeedback: null })).json() as DiveView).weightingFeedback).toBeNull();
    });

    it('is refused with an amount for weighting that felt right, with an amount below 0, and with a word of its own', async () => {
      const refused = async (weightingFeedback: object) => {
        const response = await edit(diveId, { weightingFeedback });
        return [response.statusCode, response.json().code];
      };
      expect(await refused({ felt: 'right', amountKg: 1 })).toEqual([400, 'weighting_feedback_invalid']);
      expect((await refused({ felt: 'too_heavy', amountKg: -1 }))[0]).toBe(400);
      expect((await refused({ felt: 'perfect' }))[0]).toBe(400);
      expect((await getDive(diveId)).weightingFeedback).toBeNull();
    });
  });

  describe('exposure suit', () => {
    let diveId: string;
    const suitAfter = async (suit: object | null) => ((await edit(diveId, { suit })).json() as DiveView).suit;
    beforeAll(async () => {
      diveId = await garminDive(3);
    });

    it('is unknown until set; a wetsuit has a thickness and may have a hood, with one entry in the history', async () => {
      expect((await getDive(diveId)).suit).toBeNull();
      const wetsuit = { type: 'wetsuit', thicknessMm: 7, hood: true, undergarment: null };
      expect(await suitAfter({ type: 'wetsuit', thicknessMm: 7, hood: true })).toEqual(wetsuit);
      expect((await history(diveId))[0]!.changes).toEqual({ suit: { from: null, to: wetsuit } });
      expect((await getDive(diveId)).suit).toEqual(wetsuit);
    });

    it('a drysuit has an undergarment, a value left out is unknown, and "none" is a dive without a suit', async () => {
      expect(await suitAfter({ type: 'drysuit', undergarment: 'heavy', hood: false })).toEqual({ type: 'drysuit', thicknessMm: null, hood: false, undergarment: 'heavy' });
      expect(await suitAfter({ type: 'semidry' })).toEqual({ type: 'semidry', thicknessMm: null, hood: null, undergarment: null });
      expect(await suitAfter({ type: 'none' })).toEqual({ type: 'none', thicknessMm: null, hood: null, undergarment: null });
      expect(await suitAfter(null)).toBeNull();
    });

    it('is refused with a thickness for a suit that has none, an undergarment under anything but a drysuit, or a type of its own', async () => {
      const refused = async (suit: object) => {
        const response = await edit(diveId, { suit });
        return [response.statusCode, response.json().code];
      };
      expect(await refused({ type: 'drysuit', thicknessMm: 4 })).toEqual([400, 'suit_invalid']);
      expect(await refused({ type: 'skin', thicknessMm: 1 })).toEqual([400, 'suit_invalid']);
      expect(await refused({ type: 'wetsuit', undergarment: 'light' })).toEqual([400, 'suit_invalid']);
      expect((await refused({ type: 'tuxedo' }))[0]).toBe(400);
      expect((await refused({ thicknessMm: 5 }))[0]).toBe(400);
      expect((await getDive(diveId)).suit).toBeNull();
    });

    it('lead, feedback and suit set in one edit make one entry in the history', async () => {
      const before = await getDive(diveId);
      const entries = (await history(diveId)).length;
      const response = await edit(diveId, {
        lead: [{ amountKg: 8, placement: 'belt' }], weightingFeedback: { felt: 'right' }, suit: { type: 'wetsuit', thicknessMm: 5, hood: false },
      });
      expect((response.json() as DiveView).version).toBe(before.version + 1);
      const revisions = await history(diveId);
      expect(revisions).toHaveLength(entries + 1);
      expect(Object.keys(revisions[0]!.changes).sort()).toEqual(['lead', 'suit', 'weightingFeedback']);
    });
  });

  describe('when two Dives are merged', () => {
    it('the kept Dive takes the other\'s lead, feedback and suit where it has none, and keeps its own otherwise', async () => {
      const wetsuit = { type: 'wetsuit', thicknessMm: 5, hood: null, undergarment: null };
      const theirs = { lead: [{ amountKg: 8, placement: 'belt' }], weightingFeedback: { felt: 'too_light', amountKg: 1 }, suit: wetsuit };
      const merge = async (d: number, own: object) => {
        const kept = await garminDive(d);
        const second = (await upload(`later-${d}.fit`, makeSyntheticDive({ serialNumber: 222, start: day(d, '14:00:00') }))).diveId;
        expect(second).not.toBe(kept);
        if (Object.keys(own).length > 0) await edit(kept, own);
        await edit(second, theirs);
        const response = await inject('POST', `/api/dives/${kept}/merge`, tim, {
          version: (await getDive(kept)).version, otherId: second, otherVersion: (await getDive(second)).version,
        });
        expect(response.statusCode).toBe(200);
        return response.json() as DiveView;
      };
      const taken = await merge(20, {});
      expect(taken).toMatchObject({ ...theirs, leadTotalKg: 8 });
      expect((await history(taken.id))[0]).toMatchObject({
        cause: 'merge',
        changes: { lead: { from: [], to: theirs.lead }, weightingFeedback: { from: null, to: theirs.weightingFeedback }, suit: { from: null, to: wetsuit } },
      });
      const own = { lead: [{ amountKg: 0, placement: null }], suit: { type: 'none', thicknessMm: null, hood: null, undergarment: null } };
      expect(await merge(21, own)).toMatchObject({ ...own, weightingFeedback: theirs.weightingFeedback });
    });
  });

  describe('"same as last dive"', () => {
    const sameAsLast = async (id: string, cookie = tim) => inject('GET', `/api/dives/${id}/same-as-last`, cookie);

    it('gives the suit and the lead of the Diver\'s previous Dive, not how its weighting felt, and changes nothing', async () => {
      const previous = await garminDive(10);
      const next = await garminDive(11);
      const lead = [{ amountKg: 6, placement: 'belt' }, { amountKg: 2, placement: 'trim' }];
      const suit = { type: 'drysuit', thicknessMm: null, hood: true, undergarment: 'medium' };
      await edit(previous, { lead, suit, weightingFeedback: { felt: 'too_heavy', amountKg: 2 } });
      const before = await getDive(next);
      const answer = (await sameAsLast(next)).json();
      expect(answer).toMatchObject({ diveId: previous, lead, suit });
      expect(answer).not.toHaveProperty('weightingFeedback');
      expect(await getDive(next)).toMatchObject({ version: before.version, lead: [], suit: null });
    });

    it('gives no lead and no suit where the previous Dive has none, and for a Diver\'s first Dive', async () => {
      const after = await garminDive(12);
      await edit(after, { lead: [{ amountKg: 4 }] });
      expect((await sameAsLast(await garminDive(13))).json()).toMatchObject({ lead: [{ amountKg: 4, placement: null }], suit: null });
      const first = await upload('theirs.fit', makeSyntheticDive({ serialNumber: 333, start: day(5) }), other);
      expect((await sameAsLast(first.diveId, other)).json()).toMatchObject({ diveId: null, lead: [], suit: null });
    });
  });
});
