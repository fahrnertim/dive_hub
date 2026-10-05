// Importing dives from SSI (ADR 0030), against a fake SSI logbook: dives typed by hand (one matching a Dive here, some
// new, one at a position, one near other dives, one with nothing to tell its time zone), one synced from a dive computer,
// one Dive Hub sent, and ambiguous ones. The preview, the start, the worker's run, running it again, sending a linked
// Dive, the computer's own file and a hand-typed dive's file becoming primary, deleted Dives, the modes, and that
// nothing personal of a buddy is stored.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importJob, original } from '../src/db/schema.js';
import { createFakeSsi, computerDive, handTypedDive, type FakeSsiBuddy } from './fake-ssi.js';
import { makeSyntheticDive, type SyntheticDiveOptions } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

const ERIKA = 5_012_047;
const KAI: FakeSsiBuddy = {
  owner: ERIKA, id: 3_786_888, buddy_master_id: 4_989_164, firstname: 'Kai', lastname: 'Lund',
  email: 'kai@example.com', dob: '1980-01-02', phone: '+49 170 000000', city: 'Kiel',
};

type Outcome = { result: string; reason?: string; diveId?: string; remoteId?: string };
type DiveView = {
  id: string; version: number; values: { number: number | null; startsAt: { at: string; utcOffsetSeconds: number | null }; maxDepthM: number | null };
  utcOffsetSource: string; fromProvider: string | null; notes: string | null; site: { name: string } | null;
  participants: { name: string }[]; recordings: { isPrimary: boolean; parser: string; device: { serialNumber: string } | null }[];
};
type Preview = {
  computers: { key: string; dives: number; choice: string; suggested: string; fromFiles: boolean }[];
  counts: Record<string, number>;
  decisions: { remoteId: string; candidates: { diveId: string }[] }[];
};

describe.skipIf(!(await databaseReachable()))('importing dives from SSI', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let connectionId: string;
  const remote: Record<string, string> = {};
  const fit: Record<string, string> = {};
  let outcome: Outcome[];

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const upload = async (name: string, options: SyntheticDiveOptions) => {
    const { payload, headers } = multipartFile(`${name}.fit`, makeSyntheticDive(options));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    return ((await call('GET', `/api/imports/${created.json().id}`)).json() as { outcome: Outcome[] }).outcome[0]!;
  };
  const diveOf = async (id: string) => (await call('GET', `/api/dives/${id}`)).json() as DiveView;
  const status = async (id: string) => (await call('GET', `/api/dives/${id}/providers/ssi`)).json() as { current: { remoteId: string; upToDate: boolean } | null };
  const preview = async () => (await call('GET', `/api/connections/${connectionId}/dive-import`)).json() as Preview;
  /** Starts the import, runs it as the worker would, and answers its outcome by SSI dive. */
  const runImport = async (body: { computers?: { key: string; choice: string }[]; decisions?: { remoteId: string; choice: string }[] } = {}) => {
    ctx.ssiClock.advance(5 * 60_000);
    const started = await call('POST', `/api/connections/${connectionId}/dive-import`, { computers: [], decisions: [], ...body });
    expect(started.statusCode).toBe(202);
    await ctx.imports.processImport(started.json().id);
    const done = (await call('GET', `/api/imports/${started.json().id}`)).json() as { status: string; provider: string; outcome: Outcome[] };
    expect(done).toMatchObject({ status: 'done', provider: 'ssi' });
    return done.outcome;
  };
  const of = (name: string) => outcome.find((o) => o.remoteId === remote[name])!;
  const diveCount = async () => ((await call('GET', '/api/dives?limit=200')).json() as { total: number }).total;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { fakeSsi: createFakeSsi({ buddies: [KAI] }) });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    const own = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    connectionId = (await call('POST', '/api/connections/ssi', {
      diverId: own, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false,
    })).json().id;
    // Hausreef is here with its SSI site ID; Kai is a Diver here with his SSI account.
    const site = (await call('POST', '/api/dive-sites', { name: 'Hausreef' })).json() as { id: string };
    await call('PUT', `/api/dive-sites/${site.id}/external-ids/ssi`, { externalId: '3314' });
    await call('POST', `/api/connections/${connectionId}/buddies/import`, { accounts: ['4989164'] });

    // Dives here from files (UTC+2): one on 15 January, two on 1 February 40 minutes apart, one on 1 March.
    fit.a = (await upload('a', {})).diveId!;
    fit.b = (await upload('b', { serialNumber: 2222, start: new Date('2026-02-01T08:00:00Z'), diveNumber: 43 })).diveId!;
    fit.c = (await upload('c', { serialNumber: 2222, start: new Date('2026-02-01T08:40:00Z'), diveNumber: 44 })).diveId!;
    fit.d = (await upload('d', { serialNumber: 2222, start: new Date('2026-03-01T08:00:00Z'), durationSeconds: 600, diveNumber: 45 })).diveId!;

    // Erika's SSI logbook.
    const add = (name: string, record: Record<string, unknown>) => { remote[name] = String(ctx.fakeSsi.addDive(ERIKA, record)); };
    add('matching', handTypedDive({ at: '2026-01-15 11:05', depthM: 18, minutes: 30, siteId: 3314, buddies: [KAI.id], comment: 'Turtle at the wall', nr: 80 }));
    add('atSite', handTypedDive({ at: '2025-08-10 10:00', depthM: 20, minutes: 45, siteId: 3314, nr: 70, tempC: 27 }));
    add('nearby', handTypedDive({ at: '2025-08-12 09:00', depthM: 15, minutes: 50, nr: 72 }));
    add('nowhere', handTypedDive({ at: '2024-02-01 09:00', depthM: 12, minutes: 40, nr: 50 }));
    add('computer', computerDive({ at: '2025-08-11 14:00', depthM: 22, minutes: 40, manufacturer: 'Garmin', product: 'Descent Mk3', serial: '3333', siteId: 3314, nr: 71 }));
    add('ours', { ...handTypedDive({ at: '2025-09-01 10:00', depthM: 10, minutes: 30 }), odin_user_log_divecomputer_dive_ref: 'divehub-0190a3f2-0000-7000-8000-000000000001' });
    add('between', handTypedDive({ at: '2026-02-01 10:20', depthM: 18, minutes: 30, nr: 81 }));
    add('turnsAmbiguous', handTypedDive({ at: '2026-03-01 10:05', depthM: 18, minutes: 10, nr: 82 }));
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('the setting', () => {
    it('is off at first, and a preview says so', async () => {
      expect((await call('GET', '/api/connections')).json()[0].diveImport).toEqual({ mode: 'off', windowMinutes: 15 });
      expect((await call('GET', `/api/connections/${connectionId}/dive-import`)).json()).toMatchObject({ code: 'provider_import_off', provider: 'ssi' });
    });

    it('takes the mode and one of the matching windows', async () => {
      expect((await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'create', windowMinutes: 30 } })).json())
        .toMatchObject({ diveImport: { mode: 'create', windowMinutes: 30 } });
      expect((await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { windowMinutes: 20 } })).statusCode).toBe(400);
    });

    it('declares the import to clients', async () => {
      const providers = (await call('GET', '/api/providers')).json() as { id: string; data: { dives: { import: unknown } } }[];
      expect(providers.find((p) => p.id === 'ssi')!.data.dives.import).toEqual({ operations: ['list'], findBy: [] });
    });
  });

  describe('the preview', () => {
    it('lists the computer and says what would happen to each dive, storing nothing', async () => {
      const before = await diveCount();
      const p = await preview();
      expect(p.computers).toEqual([expect.objectContaining({ key: 'garmin:3333', dives: 1, choice: 'recordings', suggested: 'recordings', fromFiles: false })]);
      expect(p.counts).toMatchObject({ total: 8, ours: 1, recordings: 1, link: 2, create: 3, decide: 1, noMatch: 0, linked: 0 });
      expect(p.decisions).toEqual([expect.objectContaining({ remoteId: remote.between })]);
      expect(p.decisions[0]!.candidates.map((c) => c.diveId).sort()).toEqual([fit.b, fit.c].sort());
      expect(await diveCount()).toBe(before);
      expect(await t.db.select().from(importJob).where(eq(importJob.provider, 'ssi'))).toEqual([]);
    });
  });

  describe('running it', () => {
    beforeAll(async () => {
      // Between the preview and the start, a second dive here makes one entry ambiguous.
      fit.e = (await upload('e', { serialNumber: 2222, start: new Date('2026-03-01T08:20:00Z'), durationSeconds: 600, diveNumber: 46 })).diveId!;
      outcome = await runImport({
        computers: [{ key: 'garmin:3333', choice: 'recordings' }], decisions: [{ remoteId: remote.between!, choice: fit.b! }],
      });
    });

    it('links the entry matching a Dive here and fills what it lacked: site, buddy, notes', async () => {
      expect(of('matching')).toMatchObject({ result: 'linked', diveId: fit.a });
      const a = await diveOf(fit.a!);
      expect(a).toMatchObject({ site: { name: 'Hausreef' }, notes: 'Turtle at the wall', participants: [{ name: 'Kai Lund' }] });
      // Dive Hub's values stay: the recording's, not SSI's rounded ones.
      expect(a.values.maxDepthM).toBeCloseTo(18.5, 1);
      // Linked, not sent: our values aren't at SSI yet.
      expect(await status(fit.a!)).toMatchObject({ current: { remoteId: remote.matching, upToDate: false } });
    });

    it('makes a Dive without a Recording from an entry with no Dive here, its time zone from the SSI site', async () => {
      const id = of('atSite').diveId!;
      expect(of('atSite').result).toBe('created');
      const d = await diveOf(id);
      expect(d).toMatchObject({
        recordings: [], fromProvider: 'ssi', utcOffsetSource: 'position', site: { name: 'Hausreef' },
        values: { number: null, startsAt: { at: '2025-08-10T07:00:00.000Z', utcOffsetSeconds: 3 * 3600 }, maxDepthM: 20 },
      });
      // Made from SSI's dive: up to date there.
      expect(await status(id)).toMatchObject({ current: { remoteId: remote.atSite, upToDate: true } });
    });

    it('takes the time zone of nearby dives, or keeps the wall-clock time when nothing tells it', async () => {
      expect(await diveOf(of('nearby').diveId!)).toMatchObject({
        utcOffsetSource: 'nearby', values: { startsAt: { at: '2025-08-12T06:00:00.000Z', utcOffsetSeconds: 3 * 3600 } },
      });
      expect(await diveOf(of('nowhere').diveId!)).toMatchObject({
        utcOffsetSource: 'unknown', values: { startsAt: { at: '2024-02-01T09:00:00.000Z', utcOffsetSeconds: null } },
      });
    });

    it('makes a computer\'s dive a Recording, with its Device, placed like a file', async () => {
      expect(of('computer')).toMatchObject({ result: 'created' });
      const d = await diveOf(of('computer').diveId!);
      expect(d.recordings).toEqual([expect.objectContaining({ isPrimary: true, parser: 'ssi-app-api', device: expect.objectContaining({ serialNumber: '3333' }) })]);
      expect(d).toMatchObject({ utcOffsetSource: 'position', values: { startsAt: { at: '2025-08-11T11:00:00.000Z', utcOffsetSeconds: 3 * 3600 } } });
      expect(await status(d.id)).toMatchObject({ current: { remoteId: remote.computer, upToDate: true } });
      const devices = (await call('GET', '/api/devices')).json() as { manufacturer: string; serialNumber: string }[];
      expect(devices).toEqual(expect.arrayContaining([expect.objectContaining({ manufacturer: 'garmin', serialNumber: '3333' })]));
    });

    it('never imports back what Dive Hub sent', () => {
      expect(of('ours')).toMatchObject({ result: 'skipped', reason: 'sent_by_dive_hub' });
    });

    it('follows the decision for an ambiguous entry, and leaves out one that turned ambiguous after the preview', async () => {
      expect(of('between')).toMatchObject({ result: 'linked', diveId: fit.b });
      expect(of('turnsAmbiguous')).toMatchObject({ result: 'skipped', reason: 'ambiguous' });
      expect(await status(fit.c!)).toMatchObject({ current: null });
    });

    it('stores one Original per dive, as JSON, and no buddy\'s personal data anywhere', async () => {
      const json = await t.db.select().from(original).where(eq(original.mediaType, 'application/json'));
      expect(json).toHaveLength(8);
      const [job] = await t.db.select().from(importJob).where(eq(importJob.provider, 'ssi'));
      expect(job!.plan!.context.people).toEqual({ [KAI.id]: '4989164' });
      const stored = JSON.stringify([job, ...(await Promise.all(json.map((o) => ctx.blobs.read(o.storageKey).then(String))))]);
      for (const secret of [KAI.firstname, KAI.email, KAI.phone, KAI.dob, KAI.city]) expect(stored).not.toContain(secret);
    });
  });

  describe('afterwards', () => {
    it('can run again: nothing new, linked dives unchanged, the ambiguous one asked again', async () => {
      const before = await diveCount();
      const p = await preview();
      expect(p.counts).toMatchObject({ linked: 5, recordings: 1, decide: 1, ours: 1, create: 0, link: 0 });
      const again = await runImport();
      expect(again.filter((o) => o.result === 'unchanged')).toHaveLength(6);
      expect(await diveCount()).toBe(before);
    });

    it('sends a linked Dive as an update of SSI\'s dive, not a second one', async () => {
      const count = ctx.fakeSsi.dives.size;
      const sent = (await call('POST', `/api/dives/${fit.a}/providers/ssi`, {})).json() as { outcome: string; status: { current: { remoteId: string } } };
      expect(sent).toMatchObject({ outcome: 'updated', status: { current: { remoteId: remote.matching } } });
      expect(ctx.fakeSsi.dives.size).toBe(count);
    });

    it('makes the computer\'s own file primary over SSI\'s copy when it comes in', async () => {
      const id = of('computer').diveId!;
      expect((await upload('computer', { serialNumber: 3333, start: new Date('2025-08-11T11:00:00Z'), diveNumber: 71 }))).toMatchObject({ result: 'attached', diveId: id });
      const d = await diveOf(id);
      expect(d.recordings.find((r) => r.isPrimary)!.parser).not.toBe('ssi-app-api');
      expect(d).toMatchObject({ utcOffsetSource: 'device', values: { number: 71 } });
      // Now Dive Hub has the computer from files: its SSI dives are suggested as logbook entries; the choice kept stays.
      expect((await preview()).computers[0]).toMatchObject({ choice: 'recordings', suggested: 'entries', fromFiles: true });
    });

    it('makes a file\'s Recording primary on a Dive that had none', async () => {
      const id = of('atSite').diveId!;
      expect(await upload('atSite', { serialNumber: 5555, start: new Date('2025-08-10T07:00:00Z'), diveNumber: 70 })).toMatchObject({ result: 'attached', diveId: id });
      expect(await diveOf(id)).toMatchObject({ utcOffsetSource: 'device', values: { number: 70 }, recordings: [{ isPrimary: true }] });
    });

    it('keeps a Dive deleted here deleted', async () => {
      const id = of('nearby').diveId!;
      expect((await call('DELETE', `/api/dives/${id}`, { version: (await diveOf(id)).version })).statusCode).toBe(200);
      outcome = await runImport();
      expect(of('nearby')).toMatchObject({ result: 'skipped', reason: 'deleted_earlier' });
    });

    it('only adds to Dives here when told so', async () => {
      await call('PATCH', `/api/connections/${connectionId}`, { diveImport: { mode: 'add' } });
      remote.late = String(ctx.fakeSsi.addDive(ERIKA, handTypedDive({ at: '2025-10-01 10:00', depthM: 12, minutes: 40 })));
      expect((await preview()).counts).toMatchObject({ noMatch: 1, create: 0 });
      outcome = await runImport();
      expect(of('late')).toMatchObject({ result: 'skipped', reason: 'no_match' });
    });
  });
});
