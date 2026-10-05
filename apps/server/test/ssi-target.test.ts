// SSI as a Provider through the HTTP API (ADR 0024, 0027, data model scenario 4), against the fake SSI:
// connecting, sending a Dive, updating it in place, linking, deleting, an expired token, an outage.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connection, diverExternalId, push } from '../src/db/schema.js';
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
        { id: '3314', name: 'Hausreef', latitude: 27.29, longitude: 33.82, country: 'EG', distanceM: null },
      ]);
      const site = (await call('POST', '/api/dive-sites', tim, { name: 'Hausreef', position: { latitude: 27.29, longitude: 33.82 }, waterType: 'salt' })).json();
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

    it('keeps other Users out', async () => {
      expect((await call('GET', `/api/dives/${diveId}/providers/ssi`, other)).statusCode).toBe(404);
      expect((await call('POST', `/api/dives/${diveId}/providers/ssi`, other, {})).statusCode).toBe(404);
      const conn = (await status()).connection!;
      expect((await call('DELETE', `/api/connections/${conn.id}`, other)).statusCode).toBe(404);
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
