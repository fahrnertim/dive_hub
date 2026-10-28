// SSI as a Provider through the HTTP API (ADR 0024, 0027, data model scenario 4), against the fake SSI:
// connecting, sending a Dive, updating it in place, linking, deleting, an expired token, an outage, and the three-way
// send (ADR 0056): a change made in SSI's app comes back, a removal goes out, a Conflict is asked or waits.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connection, cylinder, dive, diverExternalId, providerConflict, push, pushRun, revision, user } from '../src/db/schema.js';
import type { ProviderAdapter } from '../src/providers/provider.js';
import { createSecretBox } from '../src/secrets/secret-box.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, TEST_ENCRYPTION_KEY, type TestDatabase,
} from './support.js';

const SSI = { login: 'erika@example.com', password: 'ssi-password' };
/** What a Connection keeps, opened with the tests' key. */
const credentials = (row: typeof connection.$inferSelect) =>
  JSON.parse(createSecretBox(TEST_ENCRYPTION_KEY).open(row.credentials!, `connection:${row.id}`)) as { access: string | null; password: string | null };

type Status = {
  connection: { id: string; state: string } | null; unmet: { type: string; siteId?: string | null }[];
  current: { remoteId: string; remoteNumber: number | null; upToDate: boolean } | null;
  pushes: { action: string; state: string; remoteId: string | null; failureCode: string | null; differences: unknown[] | null }[];
};

describe.skipIf(!(await databaseReachable()))('SSI as a Provider', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let other: string;
  let timDiver: string;
  let otherDiver: string;
  let diveId: string;
  let secondDiveId: string;
  let hausreefId: string;
  /** Every response body, to check that no secret ever comes back. */
  const bodies: string[] = [];

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) => {
    const response = await ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
    bodies.push(response.body);
    return response;
  };
  const status = async (id = diveId) => (await call('GET', `/api/dives/${id}/providers/ssi`, tim)).json() as Status;
  const send = (body: object = {}, id = diveId) => call('POST', `/api/dives/${id}/providers/ssi`, tim, body);
  const ssiDive = (id: string) => ctx.fakeSsi.dives.get(Number(id))!;

  async function upload(cookie: string, fileName: string, data: Uint8Array): Promise<string> {
    const { payload, headers } = multipartFile(fileName, data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(response.json().id);
    return (await call('GET', `/api/imports/${response.json().id}`, cookie)).json().outcome[0].diveId;
  }
  const ownDiver = async (cookie: string) => ((await call('GET', '/api/divers', cookie)).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'other@example.com', 'admin');
    tim = await signIn(ctx.app, 'tim@example.com');
    other = await signIn(ctx.app, 'other@example.com');
    timDiver = await ownDiver(tim);
    otherDiver = await ownDiver(other);
    diveId = await upload(tim, 'main.fit', makeSyntheticDive({ serialNumber: 111 }));
    secondDiveId = await upload(tim, 'second.fit', makeSyntheticDive({ serialNumber: 111, start: new Date('2026-01-16T09:00:00Z') }));
  });
  afterAll(async () => t?.drop());

  describe('connecting', () => {
    it('refuses a wrong password, another User\'s Diver, and keeping a password the server can\'t encrypt', async () => {
      expect((await call('POST', '/api/connections/ssi', tim, { diverId: timDiver, ...SSI, password: 'wrong', keepSignedIn: false })).json())
        .toMatchObject({ code: 'provider_wrong_credentials', provider: 'ssi', providerName: 'SSI' });
      expect((await call('POST', '/api/connections/ssi', tim, { diverId: otherDiver, ...SSI, keepSignedIn: false })).statusCode).toBe(404);
      const noKey = await createTestApp(t, { encryptionKey: null });
      const providers = await noKey.app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: tim } });
      expect(providers.json()).toMatchObject([{ id: 'ssi', signIn: { kind: 'password', login: 'email', canKeepPassword: false } }]);
      expect((await noKey.app.inject({ method: 'GET', url: '/api/connections', headers: { cookie: tim } })).json()).toEqual([]);
      const keep = await noKey.app.inject({
        method: 'POST', url: '/api/connections/ssi', headers: { cookie: tim, origin: BASE_URL }, payload: { diverId: timDiver, ...SSI, keepSignedIn: true },
      });
      expect(keep.json()).toMatchObject({ code: 'encryption_key_missing' });
      expect(await t.db.select().from(connection)).toEqual([]);
    });

    it('signs in once, keeps only the token (encrypted), and records the SSI account on the Diver', async () => {
      const response = await call('POST', '/api/connections/ssi', tim, { diverId: timDiver, ...SSI, keepSignedIn: false });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ provider: 'ssi', diverId: timDiver, accountId: '5012047', accountLabel: SSI.login, keepSignedIn: false, state: 'active' });
      const [row] = await t.db.select().from(connection);
      expect(row!.credentials).toMatch(/^v1\./);
      expect(credentials(row!)).toMatchObject({ access: expect.stringMatching(/^token-/), password: null });
      expect(await t.db.select({ id: diverExternalId.externalId }).from(diverExternalId).where(eq(diverExternalId.diverId, timDiver)))
        .toEqual([{ id: '5012047' }]);
    });

    it('refuses a second Connection for the Diver, and the same SSI account for another Diver', async () => {
      expect((await call('POST', '/api/connections/ssi', tim, { diverId: timDiver, ...SSI, keepSignedIn: false })).json())
        .toMatchObject({ code: 'provider_already_connected' });
      expect((await call('POST', '/api/connections/ssi', other, { diverId: otherDiver, ...SSI, keepSignedIn: false })).json())
        .toMatchObject({ code: 'provider_account_taken' });
    });
  });

  describe('sending a Dive', () => {
    it('needs the Dive site\'s SSI site ID, and suggests sites from the User\'s SSI logbook', async () => {
      expect(await status()).toMatchObject({ connection: { state: 'active' }, unmet: [{ type: 'site_external_id', siteId: null }], current: null, pushes: [] });
      expect((await send()).json()).toMatchObject({ code: 'provider_requirements_unmet', unmet: [{ type: 'site_external_id' }] });
      expect((await call('GET', `/api/dives/${diveId}/providers/ssi/sites`, tim)).json()).toEqual([
        { id: '3314', name: 'Hausreef', latitude: 27.29, longitude: 33.82, country: 'EG', distanceM: null, visibility: expect.any(String), waterType: null },
      ]);
      const site = (await call('POST', '/api/dive-sites', tim, { name: 'Hausreef', position: { latitude: 27.29, longitude: 33.82 }, waterType: 'salt' })).json();
      hausreefId = site.id;
      await call('PUT', `/api/dive-sites/${site.id}/external-ids/ssi`, tim, { externalId: '3314' });
      for (const id of [diveId, secondDiveId]) {
        const { version } = (await call('GET', `/api/dives/${id}`, tim)).json();
        expect((await call('PATCH', `/api/dives/${id}`, tim, { version, siteId: site.id })).statusCode).toBe(200);
      }
      expect((await call('GET', `/api/dives/${diveId}/providers/ssi/sites`, tim)).json()[0]).toMatchObject({ id: '3314', distanceM: 0 });
    });

    it('creates the SSI dive with the profile, reads it back, and keeps SSI\'s ID and number', async () => {
      const response = await send();
      expect(response.json()).toMatchObject({ outcome: 'created', existing: null, status: { current: { remoteNumber: 1, upToDate: true } } });
      const s = await status();
      expect(s.pushes).toEqual([expect.objectContaining({ action: 'create', state: 'confirmed', differences: [] })]);
      const stored = ssiDive(s.current!.remoteId);
      expect(stored).toMatchObject({
        odin_user_log_nr: 1, odin_user_log_dive_sites_id: 3314, odin_user_log_ean_percent: 32, odin_user_log_gf_set: '40 / 85',
        odin_user_log_divecomputer_serial_nr: '111', odin_user_log_divecomputer_dive_ref: `divehub-${diveId}`,
        odin_user_log_var_watertype_id: 5, odin_user_log_confirmed: false,
      });
      expect(JSON.parse(stored.odin_user_log_diveSamples as string).length).toBeGreaterThan(300);
    });

    it('is outdated when the Dive changes, and updates the same SSI dive, keeping what was edited in the SSI app', async () => {
      const { version } = (await call('GET', `/api/dives/${diveId}`, tim)).json();
      await call('PATCH', `/api/dives/${diveId}`, tim, { version, notes: 'Turtle at the wall' });
      const before = await status();
      expect(before.current!.upToDate).toBe(false);
      ssiDive(before.current!.remoteId).odin_user_log_rating = 5;
      expect((await send()).json()).toMatchObject({ outcome: 'updated', status: { current: { upToDate: true, remoteId: before.current!.remoteId } } });
      expect(ssiDive(before.current!.remoteId)).toMatchObject({ odin_user_log_comment: 'Turtle at the wall', odin_user_log_rating: 5, odin_user_log_nr: 1 });
      expect([...ctx.fakeSsi.dives.values()].filter((d) => d.odin_user_log_deleted !== 1)).toHaveLength(1);
    });

    it('offers a dive already in SSI at the same time, and links to it or creates a second one on request', async () => {
      // Logged in the SSI app a minute later than the computer's start, in local time.
      const { startsAt } = (await call('GET', `/api/dives/${secondDiveId}`, tim)).json().values;
      const local = new Date(Date.parse(startsAt.at) + ((startsAt.utcOffsetSeconds ?? 0) + 60) * 1000).toISOString().slice(0, 16).replace('T', ' ');
      const existing = ctx.fakeSsi.addDive(5_012_047, { odin_user_log_nr: 7, odin_user_log_datetime: local, odin_user_log_depth_m: 18, odin_user_log_divetime: 31 });
      // Logged a while after the last send, so Dive Hub's kept logbook read is old enough to read again (ADR 0027).
      ctx.ssiClock.advance(3 * 60_000);
      expect((await send({}, secondDiveId)).json()).toMatchObject({
        outcome: 'exists', existing: { remoteId: String(existing), number: 7, startsAt: local, maxDepthM: 18, durationMinutes: 31 },
      });
      expect((await status(secondDiveId)).pushes).toEqual([]);
      expect((await send({ onExisting: 'link' }, secondDiveId)).json()).toMatchObject({
        outcome: 'linked', status: { current: { remoteId: String(existing), remoteNumber: 7, upToDate: false } },
      });
      expect((await send({}, secondDiveId)).json()).toMatchObject({ outcome: 'updated', status: { current: { remoteId: String(existing), upToDate: true } } });
    });

    it('asks the User to sign in again when the token expired and no password is kept; then keeps signing in by itself', async () => {
      ctx.fakeSsi.expireTokens();
      expect((await send()).json()).toMatchObject({ code: 'provider_sign_in_needed' });
      const conn = (await status()).connection!;
      expect(conn.state).toBe('needs_sign_in');
      expect((await call('POST', `/api/connections/${conn.id}/sign-in`, tim, { password: 'wrong', keepSignedIn: true })).json())
        .toMatchObject({ code: 'provider_wrong_credentials', provider: 'ssi', providerName: 'SSI' });
      expect((await call('POST', `/api/connections/${conn.id}/sign-in`, tim, { password: SSI.password, keepSignedIn: true })).json())
        .toMatchObject({ state: 'active', keepSignedIn: true });
      const [row] = await t.db.select().from(connection);
      expect(credentials(row!).password).toBe(SSI.password);
      ctx.fakeSsi.expireTokens();
      const signIns = ctx.fakeSsi.calls.filter((c) => c.what === 'authenticate').length;
      expect((await send()).json()).toMatchObject({ outcome: 'updated' });
      expect(ctx.fakeSsi.calls.filter((c) => c.what === 'authenticate')).toHaveLength(signIns + 1);
    });

    it('records an outage as a failed Push and tells the client', async () => {
      ctx.fakeSsi.failWith = 503;
      const response = await send();
      ctx.fakeSsi.failWith = null;
      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ code: 'provider_unavailable' });
      expect((await status()).current).not.toBeNull();
    });

    it('records a save SSI answers without storing it as a failed Push with its own reason, and the dive stays as it was sent', async () => {
      const before = (await status()).current!;
      ctx.fakeSsi.dropSaves = true;
      const response = await send();
      ctx.fakeSsi.dropSaves = false;
      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ code: 'provider_not_stored', provider: 'ssi' });
      const after = await status();
      expect(after.current).toMatchObject({ remoteId: before.remoteId });
      expect(after.pushes[0]).toMatchObject({ state: 'failed', failureCode: 'provider_not_stored' });
    });
    it('with the Connection numbering as Dive Hub does, "Set number" gives the SSI dive the Dive\'s number and nothing else', async () => {
      const connectionId = (await status()).connection!.id;
      expect((await call('PATCH', `/api/divers/${timDiver}`, tim, { divesBefore: 10 })).statusCode).toBe(200);
      expect((await call('PATCH', `/api/connections/${connectionId}`, tim, { diveNumbers: { follow: true } })).statusCode).toBe(200);
      type Numbered = { current: { remoteId: string; remoteNumber: number; number: { wanted: number; differs: boolean; canSet: boolean } } };
      const before = (await status() as unknown as Numbered).current;
      expect(before.number).toMatchObject({ wanted: 11, differs: true, canSet: true });
      const comment = ssiDive(before.remoteId).odin_user_log_comment;

      expect((await call('POST', `/api/dives/${diveId}/providers/ssi/number`, tim)).statusCode).toBe(200);
      expect(ssiDive(before.remoteId)).toMatchObject({ odin_user_log_nr: 11, odin_user_log_comment: comment });
      const after = await status();
      expect((after as unknown as Numbered).current).toMatchObject({ remoteNumber: 11, number: { differs: false } });
      expect(after.pushes[0]).toMatchObject({ action: 'number', state: 'confirmed' });

      await call('PATCH', `/api/connections/${connectionId}`, tim, { diveNumbers: { follow: false } });
      await call('PATCH', `/api/divers/${timDiver}`, tim, { divesBefore: 0 });
    });

    it('deletes the SSI dive there, and creates a new one when sent again', async () => {
      const remoteId = (await status()).current!.remoteId;
      const after = (await call('DELETE', `/api/dives/${diveId}/providers/ssi`, tim)).json() as Status;
      expect(after.current).toBeNull();
      expect(after.pushes[0]).toMatchObject({ action: 'delete', state: 'confirmed' });
      expect(ssiDive(remoteId).odin_user_log_deleted).toBe(1);
      expect((await call('DELETE', `/api/dives/${diveId}/providers/ssi`, tim)).json()).toMatchObject({ code: 'provider_not_sent' });
      expect((await send()).json()).toMatchObject({ outcome: 'created', status: { current: { remoteNumber: 8 } } });
    });

    it('notices a dive deleted in the SSI app', async () => {
      const remoteId = (await status()).current!.remoteId;
      ssiDive(remoteId).odin_user_log_deleted = 1;
      expect((await send()).json()).toMatchObject({ code: 'provider_dive_gone' });
      expect((await status()).current).toBeNull();
    });

    /** A new upload on its own day, at the site of the others, ready to send. */
    const newDive = async (start: Date, subSport?: 'apneaDiving') => {
      const id = await upload(tim, `${start.getTime()}.fit`, makeSyntheticDive({ serialNumber: 111, start, ...(subSport && { subSport }) }));
      const { version } = (await call('GET', `/api/dives/${id}`, tim)).json();
      expect((await call('PATCH', `/api/dives/${id}`, tim, { version, siteId: hausreefId })).statusCode).toBe(200);
      return id;
    };

    it('sends the dive type, the tank, the lead, the surface interval, heart rate and tank pressure', async () => {
      const id = await newDive(new Date('2026-02-10T09:00:00Z'));
      const { version } = (await call('GET', `/api/dives/${id}`, tim)).json();
      const tank = { volumeL: 12, workingPressureBar: 232, material: 'steel', gas: { o2: 32, he: 0 }, startPressureBar: 200, endPressureBar: 50 };
      expect((await call('PATCH', `/api/dives/${id}`, tim, { version, cylinders: [tank], lead: [{ amountKg: 6 }] })).statusCode).toBe(200);
      expect((await send({}, id)).json()).toMatchObject({ outcome: 'created' });
      const s = await status(id);
      expect(s.pushes[0]).toMatchObject({ state: 'confirmed', differences: [] });
      const stored = ssiDive(s.current!.remoteId);
      expect(stored).toMatchObject({
        odin_user_log_dive_type: 0, odin_user_log_tank_vol_l: 12, odin_user_log_pressure_start_bar: 200, odin_user_log_var_tanktype_id: 19,
        odin_user_log_weight_kg: 6, odin_user_log_si_before: 86_400, odin_user_log_heartRateAvg: 80,
      });
      expect(String(stored.odin_user_log_diveSamples)).toContain('"hb":80');
    });

    it('an apnea session goes to SSI as a freedive', async () => {
      const id = await newDive(new Date('2026-02-11T09:00:00Z'), 'apneaDiving');
      expect((await send({}, id)).json()).toMatchObject({ outcome: 'created' });
      expect(ssiDive((await status(id)).current!.remoteId)).toMatchObject({ odin_user_log_dive_type: 6 });
    });

    it('keeps other Users out', async () => {
      expect((await call('GET', `/api/dives/${diveId}/providers/ssi`, other)).statusCode).toBe(404);
      expect((await call('POST', `/api/dives/${diveId}/providers/ssi`, other, {})).statusCode).toBe(404);
      const conn = (await status()).connection!;
      expect((await call('DELETE', `/api/connections/${conn.id}`, other)).statusCode).toBe(404);
    });
  });

  describe('the three-way send (ADR 0056)', () => {
    let day = 1;
    const patch = async (id: string, changes: object) => {
      const { version } = (await call('GET', `/api/dives/${id}`, tim)).json();
      expect((await call('PATCH', `/api/dives/${id}`, tim, { version, ...changes })).statusCode).toBe(200);
    };
    /** A Dive sent to SSI with these values: its ID and SSI's dive ID. */
    const sentDive = async (values: object = {}) => {
      const id = await upload(tim, `three-way-${day}.fit`, makeSyntheticDive({ serialNumber: 111, start: new Date(Date.UTC(2026, 5, day++, 9)) }));
      await patch(id, { siteId: hausreefId, ...values });
      expect((await send({}, id)).json()).toMatchObject({ outcome: 'created' });
      return { id, remoteId: (await status(id)).current!.remoteId };
    };
    /** Changed in SSI's app, as the browser tests' helper does. */
    const setInSsi = (remoteId: string, set: Record<string, unknown>) => Object.assign(ssiDive(remoteId), set);
    const values = async (id: string) => (await call('GET', `/api/dives/${id}`, tim)).json() as {
      notes: string | null; site: { id: string } | null; cylinders: { volumeL: number | null }[]; lead: { amountKg: number }[];
    };
    const saves = () => ctx.fakeSsi.calls.filter((c) => c.what === 'save_divelog').length;
    const updates = async (id: string) => t.db.select().from(revision)
      .where(and(eq(revision.entityType, 'dive'), eq(revision.entityId, id), eq(revision.cause, 'update')));

    it("a note changed in SSI's app comes back and the lead changed here goes out; one save, one Revision 'Updated from its source', the Dive up to date", async () => {
      const { id, remoteId } = await sentDive({ notes: 'Reef', lead: [{ amountKg: 6 }] });
      setInSsi(remoteId, { odin_user_log_comment: 'Reef, a turtle' });
      await patch(id, { lead: [{ amountKg: 8 }] });
      const before = saves();
      const answer = (await send({}, id)).json();
      expect(answer).toMatchObject({ outcome: 'updated', taken: ['notes'], deferred: [], status: { current: { upToDate: true }, conflicts: null } });
      expect(saves()).toBe(before + 1);
      expect(ssiDive(remoteId)).toMatchObject({ odin_user_log_comment: 'Reef, a turtle', odin_user_log_weight_kg: 8 });
      expect((await values(id)).notes).toBe('Reef, a turtle');
      const taken = await updates(id);
      expect(taken).toHaveLength(1);
      expect(taken[0]!.actorType).toBe('user');
      expect(Object.keys(taken[0]!.changes)).toEqual(['notes']);
    });

    it('a note removed here is removed at SSI', async () => {
      const { id, remoteId } = await sentDive({ notes: 'Strong current' });
      await patch(id, { notes: null });
      expect((await send({}, id)).json()).toMatchObject({ outcome: 'updated', taken: [] });
      expect(ssiDive(remoteId).odin_user_log_comment).toBeNull();
    });

    it("a note removed in SSI's app is removed here", async () => {
      const { id, remoteId } = await sentDive({ notes: 'Strong current' });
      setInSsi(remoteId, { odin_user_log_comment: '' });
      expect((await send({}, id)).json()).toMatchObject({ outcome: 'updated', taken: ['notes'] });
      expect((await values(id)).notes).toBeNull();
      expect(ssiDive(remoteId).odin_user_log_comment || null).toBeNull();
    });

    it("a tank removed in SSI's app removes the Dive's one Cylinder; one from a Recording is sent again", async () => {
      const tank = { volumeL: 12, workingPressureBar: 232, material: 'steel', gas: { o2: 32, he: 0 }, startPressureBar: 200, endPressureBar: 50 };
      const noTank = { odin_user_log_tank_vol_l: null, odin_user_log_pressure_start_bar: null, odin_user_log_pressure_end_bar: null };
      const typed = await sentDive({ cylinders: [tank] });
      setInSsi(typed.remoteId, noTank);
      expect((await send({}, typed.id)).json()).toMatchObject({ outcome: 'updated', taken: ['cylinder'] });
      expect((await values(typed.id)).cylinders).toEqual([]);

      const recorded = await sentDive({ cylinders: [tank] });
      const [row] = await t.db.select({ recordingId: dive.primaryRecordingId }).from(dive).where(eq(dive.id, recorded.id));
      await t.db.update(cylinder).set({ recordingId: row!.recordingId, channel: 'tankPressure' }).where(eq(cylinder.diveId, recorded.id));
      setInSsi(recorded.remoteId, noTank);
      expect((await send({}, recorded.id)).json()).toMatchObject({ outcome: 'updated', taken: [], deferred: [] });
      expect((await values(recorded.id)).cylinders).toHaveLength(1);
      expect(ssiDive(recorded.remoteId)).toMatchObject({ odin_user_log_tank_vol_l: 12, odin_user_log_pressure_start_bar: 200 });
    });

    it('a site removed at SSI is sent again', async () => {
      const { id, remoteId } = await sentDive();
      setInSsi(remoteId, { odin_user_log_dive_sites_id: 0 });
      expect((await send({}, id)).json()).toMatchObject({ outcome: 'updated', taken: [] });
      expect(ssiDive(remoteId).odin_user_log_dive_sites_id).toBe(3314);
      expect((await values(id)).site?.id).toBe(hausreefId);
    });

    it("a site changed in SSI's app to one Dive Hub doesn't know (no site data from SSI) stays as SSI has it and is deferred", async () => {
      ctx.fakeSsi.sites.push({ odin_dive_sites_id: 4410, odin_dive_sites_name: 'Elphinstone', odin_dive_sites_lat: 25.31, odin_dive_sites_lon: 34.86, odin_countries_code_iso: 'EG' });
      const { id, remoteId } = await sentDive({ notes: 'Reef' });
      setInSsi(remoteId, { odin_user_log_dive_sites_id: 4410 });
      const answer = (await send({}, id)).json();
      expect(answer).toMatchObject({ outcome: 'updated', taken: [], deferred: ['site'] });
      expect(ssiDive(remoteId).odin_user_log_dive_sites_id).toBe(4410);
      expect((await values(id)).site?.id).toBe(hausreefId);
      expect(await updates(id)).toEqual([]);
    });

    it('changed on both sides: nothing is sent, the answer lists the conflict with both values', async () => {
      const { id, remoteId } = await sentDive({ notes: 'Reef' });
      setInSsi(remoteId, { odin_user_log_comment: 'Reef in SSI' });
      await patch(id, { notes: 'Reef here' });
      const pushes = (await status(id)).pushes.length;
      const before = saves();
      const response = await send({}, id);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ outcome: 'conflicts', conflicts: [{ field: 'notes', hub: 'Reef here', provider: 'Reef in SSI' }] });
      expect(saves()).toBe(before);
      expect((await status(id)).pushes).toHaveLength(pushes);
      expect(ssiDive(remoteId).odin_user_log_comment).toBe('Reef in SSI');
    });

    it("with choices, SSI's value is taken and Dive Hub's sent, in one save", async () => {
      const { id, remoteId } = await sentDive({ notes: 'Reef', lead: [{ amountKg: 6 }] });
      setInSsi(remoteId, { odin_user_log_comment: 'Reef in SSI', odin_user_log_weight_kg: 7 });
      await patch(id, { notes: 'Reef here', lead: [{ amountKg: 8 }] });
      expect((await send({}, id)).json()).toMatchObject({ outcome: 'conflicts', conflicts: [{ field: 'notes' }, { field: 'lead', hub: 8, provider: 7 }] });
      const before = saves();
      expect((await send({ conflicts: { notes: 'provider', lead: 'hub' } }, id)).json()).toMatchObject({ outcome: 'updated', taken: ['notes'] });
      expect(saves()).toBe(before + 1);
      expect((await values(id)).notes).toBe('Reef in SSI');
      expect(ssiDive(remoteId)).toMatchObject({ odin_user_log_comment: 'Reef in SSI', odin_user_log_weight_kg: 8 });
    });

    it('a Dive linked without a base sends its values and fills its empty notes from SSI, no conflict', async () => {
      const id = await upload(tim, 'three-way-linked.fit', makeSyntheticDive({ serialNumber: 111, start: new Date(Date.UTC(2026, 6, 1, 9)) }));
      await patch(id, { siteId: hausreefId, lead: [{ amountKg: 5 }] });
      const { startsAt } = (await call('GET', `/api/dives/${id}`, tim)).json().values;
      const local = new Date(Date.parse(startsAt.at) + (startsAt.utcOffsetSeconds ?? 0) * 1000).toISOString().slice(0, 16).replace('T', ' ');
      const remoteId = String(ctx.fakeSsi.addDive(5_012_047, {
        odin_user_log_nr: 40, odin_user_log_datetime: local, odin_user_log_depth_m: 18, odin_user_log_divetime: 31,
        odin_user_log_comment: 'Logged in the app', odin_user_log_weight_kg: 9,
      }));
      ctx.ssiClock.advance(3 * 60_000);
      expect((await send({ onExisting: 'link' }, id)).json()).toMatchObject({ outcome: 'linked' });
      expect((await send({}, id)).json()).toMatchObject({ outcome: 'updated', taken: ['notes'] });
      expect((await values(id)).notes).toBe('Logged in the app');
      expect(ssiDive(remoteId)).toMatchObject({ odin_user_log_comment: 'Logged in the app', odin_user_log_weight_kg: 5, odin_user_log_dive_sites_id: 3314 });
    });

    it("a run's conflict: sent without the field, an entry waits; the next send from the Dive's page asks it, and with a choice closes the entry", async () => {
      const { id, remoteId } = await sentDive({ notes: 'Reef', lead: [{ amountKg: 6 }] });
      setInSsi(remoteId, { odin_user_log_comment: 'Reef in SSI' });
      await patch(id, { notes: 'Reef here', lead: [{ amountKg: 8 }] });
      const [{ id: userId }] = (await t.db.select({ id: user.id }).from(user).where(eq(user.email, 'tim@example.com'))) as [{ id: string }];
      const connectionId = (await status(id)).connection!.id;
      const [run] = await t.db.insert(pushRun).values({
        userId, connectionId, provider: 'ssi', diverId: timDiver, updates: true, updatesRemovingVerification: false, leftOut: {} as typeof pushRun.$inferInsert['leftOut'],
      }).returning();
      const sent = await ctx.providers.pushes.send(userId, id, 'ssi', { onConflict: 'defer', runId: run!.id });
      expect(sent).toMatchObject({ result: 'updated', taken: [], deferred: ['notes'] });
      expect(ssiDive(remoteId)).toMatchObject({ odin_user_log_comment: 'Reef in SSI', odin_user_log_weight_kg: 8 });
      expect(await t.db.select().from(providerConflict).where(eq(providerConflict.diveId, id))).toMatchObject([
        { remoteId, runId: run!.id, fields: [{ field: 'notes', hub: 'Reef here', provider: 'Reef in SSI' }] },
      ]);
      const [stored] = await t.db.select().from(providerConflict).where(eq(providerConflict.diveId, id));
      expect(stored!.fields).toEqual([{ field: 'notes', hub: 'Reef here', provider: 'Reef in SSI', compared: { provider: 'Reef in SSI', siteSource: 'ssi' } }]);
      expect((await status(id) as unknown as { conflicts: unknown }).conflicts).toEqual([{ field: 'notes', hub: 'Reef here', provider: 'Reef in SSI' }]);
      // Edited again here: the page shows the Dive's value now, SSI's as the run found it.
      await patch(id, { notes: 'Reef changed' });
      expect((await status(id) as unknown as { conflicts: unknown }).conflicts).toEqual([{ field: 'notes', hub: 'Reef changed', provider: 'Reef in SSI' }]);

      expect((await send({}, id)).json()).toMatchObject({ outcome: 'conflicts' });
      expect((await send({}, id)).json().conflicts).toEqual([{ field: 'notes', hub: 'Reef changed', provider: 'Reef in SSI' }]);
      expect((await send({ conflicts: { notes: 'hub' } }, id)).json()).toMatchObject({ outcome: 'updated', status: { conflicts: null } });
      expect(ssiDive(remoteId).odin_user_log_comment).toBe('Reef changed');
      expect(await t.db.select().from(providerConflict).where(eq(providerConflict.diveId, id))).toEqual([]);
    });

    it("a field the Provider doesn't export stays as SSI has it", async () => {
      // The same SSI, but its notes only come in (a test adapter's fields).
      const notesIn = (a: ProviderAdapter): ProviderAdapter => {
        const dives = a.capabilities.data.dives!;
        return { ...a, capabilities: { ...a.capabilities, data: { ...a.capabilities.data, dives: { ...dives, fields: { ...dives.fields, notes: ['import'] } } } } };
      };
      const narrow = await createTestApp(t, { fakeSsi: ctx.fakeSsi, ssi: notesIn, clock: ctx.clock });
      const { id, remoteId } = await sentDive({ notes: 'Reef' });
      setInSsi(remoteId, { odin_user_log_comment: 'Reef in SSI' });
      await patch(id, { notes: 'Reef here', lead: [{ amountKg: 4 }] });
      const answer = await narrow.app.inject({ method: 'POST', url: `/api/dives/${id}/providers/ssi`, headers: { cookie: tim, origin: BASE_URL }, payload: {} });
      expect(answer.json()).toMatchObject({ outcome: 'updated', taken: [], deferred: ['notes'] });
      expect(ssiDive(remoteId)).toMatchObject({ odin_user_log_comment: 'Reef in SSI', odin_user_log_weight_kg: 4 });
      expect((await values(id)).notes).toBe('Reef here');
      await narrow.app.close();
    });

    it('a send retried after signing in takes nothing twice', async () => {
      const { id, remoteId } = await sentDive({ notes: 'Reef' });
      setInSsi(remoteId, { odin_user_log_comment: 'Reef, a turtle' });
      const signIns = ctx.fakeSsi.calls.filter((c) => c.what === 'authenticate').length;
      ctx.fakeSsi.expireAfterRead = true;
      expect((await send({}, id)).json()).toMatchObject({ outcome: 'updated', taken: ['notes'], status: { current: { upToDate: true } } });
      expect(ctx.fakeSsi.calls.filter((c) => c.what === 'authenticate')).toHaveLength(signIns + 1);
      expect(await updates(id)).toHaveLength(1);
      expect((await values(id)).notes).toBe('Reef, a turtle');
      expect(ssiDive(remoteId).odin_user_log_comment).toBe('Reef, a turtle');
    });
  });

  it('never answers with the password or a token', () => {
    for (const body of bodies) {
      expect(body).not.toContain(SSI.password);
      expect(body).not.toMatch(/token-\d/);
    }
  });

  it('disconnecting forgets the secrets; the history stays', async () => {
    const conn = (await status()).connection!;
    expect((await call('DELETE', `/api/connections/${conn.id}`, tim)).statusCode).toBe(204);
    expect(await t.db.select().from(connection)).toEqual([]);
    const s = await status();
    expect(s.connection).toBeNull();
    expect(s.pushes.length).toBeGreaterThan(3);
    expect((await send()).json()).toMatchObject({ code: 'provider_not_connected' });
  });

  it('deleting a User takes their Connections and the Pushes of their Dives along', async () => {
    await call('POST', '/api/connections/ssi', tim, { diverId: timDiver, ...SSI, keepSignedIn: false });
    const me = (await call('GET', '/api/me', tim)).json();
    const response = await call('DELETE', `/api/users/${me.user.id}`, other, { confirmEmail: 'tim@example.com' });
    expect(response.statusCode, response.body).toBe(204);
    expect(await t.db.select().from(push)).toEqual([]);
    expect(await t.db.select().from(connection)).toEqual([]);
    expect(await t.db.select().from(diverExternalId)).toEqual([]);
  });
});
