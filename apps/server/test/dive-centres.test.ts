// Dive centres (ADR 0043): shared like Dive sites, with an SSI centre number as an External ID, linked to the Dive
// sites they are responsible for; the SSI verification code is built from number and name. Placeholders only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { revision } from '../src/db/schema.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

type Centre = {
  id: string; name: string; displayName: string; version: number; canDelete: boolean;
  externalIds: { source: string; name: string; externalId: string }[];
  sites: { id: string; name: string }[];
  verificationCode: { provider: string; text: string } | null;
};

describe.skipIf(!(await databaseReachable()))('Dive centres', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let anna: string;
  let admin: string;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const centre = async (body: object, cookie = tim) => (await call('POST', '/api/dive-centres', cookie, body)).json() as Centre;
  const get = async (id: string, cookie = tim) => (await call('GET', `/api/dive-centres/${id}`, cookie)).json() as Centre;
  const site = async (name: string) => ((await call('POST', '/api/dive-sites', tim, { name })).json() as { id: string; version: number });
  const setNumber = (id: string, externalId: string | null, cookie = tim) =>
    call('PUT', `/api/dive-centres/${id}/external-ids/ssi`, cookie, { externalId });
  const history = (id: string) => t.db.select().from(revision).where(eq(revision.entityId, id)).orderBy(revision.at, revision.id);

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'anna@example.com');
    await createUser(ctx.auth, 'admin@example.com', 'admin');
    tim = await signIn(ctx.app, 'tim@example.com');
    anna = await signIn(ctx.app, 'anna@example.com');
    admin = await signIn(ctx.app, 'admin@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('is created by a User with a name only, and every User sees it; it has no code without a number', async () => {
    const answer = await call('POST', '/api/dive-centres', tim, { name: '  Tauchbasis Beispiel ' });
    expect(answer.statusCode).toBe(201);
    const created = answer.json() as Centre;
    expect(created).toMatchObject({ name: 'Tauchbasis Beispiel', version: 1, externalIds: [], sites: [], verificationCode: null, canDelete: true });
    expect(await get(created.id, anna)).toMatchObject({ name: 'Tauchbasis Beispiel', canDelete: false });
    expect((await call('POST', '/api/dive-centres', tim, { name: '   ' })).statusCode).toBe(400);
  });

  it('with its SSI centre number has the verification code, built from number and name', async () => {
    const created = await centre({ name: 'Example Divers GmbH, Musterstadt', externalIds: [{ source: 'ssi', externalId: '700001' }] });
    expect(created.externalIds).toEqual([{ source: 'ssi', name: 'SSI', externalId: '700001' }]);
    expect(created.verificationCode).toEqual({ provider: 'ssi', text: 'center;700001;name:Example Divers GmbH, Musterstadt' });
  });

  it('has a display name by the rule of the Source its name comes from: the town SSI adds is left off; the name stays whole', async () => {
    const typed = await centre({ name: 'Example Divers GmbH, Musterstadt' });
    expect(typed).toMatchObject({ name: 'Example Divers GmbH, Musterstadt', displayName: 'Example Divers GmbH, Musterstadt' });
    const withNumber = (await setNumber(typed.id, '700090')).json();
    expect(withNumber).toMatchObject({ name: 'Example Divers GmbH, Musterstadt', displayName: 'Example Divers GmbH' });
    expect(withNumber.verificationCode.text).toBe('center;700090;name:Example Divers GmbH, Musterstadt');
  });

  it('is renamed by any User with the version they saw; the code follows the name', async () => {
    const created = await centre({ name: 'Alt', externalIds: [{ source: 'ssi', externalId: '700002' }] });
    const renamed = await call('PATCH', `/api/dive-centres/${created.id}`, anna, { version: created.version, name: 'Neu' });
    expect(renamed.json()).toMatchObject({ name: 'Neu', version: 2, verificationCode: { text: 'center;700002;name:Neu' } });
    const stale = await call('PATCH', `/api/dive-centres/${created.id}`, tim, { version: created.version, name: 'Anders' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'centre_changed' });
  });

  it('gets, changes and loses its number on its own route, as a bare number or a whole code, with the version left alone', async () => {
    const created = await centre({ name: 'Nummern' });
    expect((await setNumber(created.id, '700010', anna)).json()).toMatchObject({ version: 1, verificationCode: { text: 'center;700010;name:Nummern' } });
    expect((await setNumber(created.id, 'center;700011;name:Whatever SSI says')).json()).toMatchObject({
      name: 'Nummern', externalIds: [{ externalId: '700011' }],
    });
    expect((await setNumber(created.id, null)).json()).toMatchObject({ externalIds: [], verificationCode: null });
    expect((await setNumber(created.id, '70-12')).json()).toMatchObject({ code: 'invalid_input' });
    expect((await setNumber('00000000-0000-7000-8000-000000000000', '7')).json()).toMatchObject({ code: 'centre_not_found' });
  });

  it('refuses a number another centre has, and names that centre', async () => {
    const first = await centre({ name: 'Erste', externalIds: [{ source: 'ssi', externalId: '700020' }] });
    const second = await centre({ name: 'Zweite' });
    const taken = await setNumber(second.id, '700020');
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'centre_external_id_taken', centre: { id: first.id, name: 'Erste' } });
    const created = await call('POST', '/api/dive-centres', tim, { name: 'Dritte', externalIds: [{ source: 'ssi', externalId: '700020' }] });
    expect(created.json()).toMatchObject({ code: 'centre_external_id_taken', centre: { id: first.id } });
    const list = (await call('GET', '/api/dive-centres?q=Dritte', tim)).json() as { total: number };
    expect(list.total).toBe(0);
  });

  it('is linked to Dive sites and unlinked again, by any User, as often as asked', async () => {
    const reef = await site('Hausriff');
    const wreck = await site('Wrack');
    const created = await centre({ name: 'Mit Plätzen', siteIds: [reef.id] });
    expect(created.sites).toEqual([{ id: reef.id, name: 'Hausriff' }]);
    for (let i = 0; i < 2; i += 1) {
      const linked = await call('PUT', `/api/dive-centres/${created.id}/sites/${wreck.id}`, anna);
      expect(linked.json()).toMatchObject({ version: 1, sites: [{ name: 'Hausriff' }, { name: 'Wrack' }] });
    }
    for (let i = 0; i < 2; i += 1) {
      expect((await call('DELETE', `/api/dive-centres/${created.id}/sites/${reef.id}`, anna)).json()).toMatchObject({ sites: [{ name: 'Wrack' }] });
    }
    expect((await call('PUT', `/api/dive-centres/${created.id}/sites/00000000-0000-7000-8000-000000000000`, tim)).json()).toMatchObject({ code: 'site_not_found' });
  });

  it('is listed by name, found by words of it and by a Dive site', async () => {
    const lake = await site('See');
    const a = await centre({ name: 'Listen Alpha', siteIds: [lake.id] });
    await centre({ name: 'Listen Beta' });
    const found = (await call('GET', '/api/dive-centres?q=listen', anna)).json() as { centres: Centre[]; total: number };
    expect(found.total).toBe(2);
    expect(found.centres.map((c) => c.name)).toEqual(['Listen Alpha', 'Listen Beta']);
    const paged = (await call('GET', '/api/dive-centres?q=listen&limit=1&offset=1', anna)).json() as { centres: Centre[]; total: number };
    expect(paged).toMatchObject({ total: 2, centres: [{ name: 'Listen Beta' }] });
    const atLake = (await call('GET', `/api/dive-centres?siteId=${lake.id}`, anna)).json() as { centres: Centre[] };
    expect(atLake.centres.map((c) => c.id)).toEqual([a.id]);
  });

  it('is deleted by its creator or an admin only; its links go, its number is free again, the site stays', async () => {
    const reef = await site('Bleibt');
    const created = await centre({ name: 'Weg', externalIds: [{ source: 'ssi', externalId: '700030' }], siteIds: [reef.id] });
    expect((await call('DELETE', `/api/dive-centres/${created.id}`, anna)).json()).toMatchObject({ code: 'centre_not_deletable' });
    expect((await call('DELETE', `/api/dive-centres/${created.id}`, admin)).statusCode).toBe(204);
    expect((await call('GET', `/api/dive-centres/${created.id}`, tim)).statusCode).toBe(404);
    expect((await call('GET', `/api/dive-sites/${reef.id}`, tim)).statusCode).toBe(200);
    expect((await call('GET', `/api/dive-centres?siteId=${reef.id}`, tim)).json()).toMatchObject({ total: 0 });
    expect((await centre({ name: 'Nachfolger', externalIds: [{ source: 'ssi', externalId: '700030' }] })).externalIds).toHaveLength(1);
  });

  it('keeps a history: create, rename, number, links and delete each write a Revision', async () => {
    const reef = await site('Historie');
    const created = await centre({ name: 'Chronik' });
    await call('PATCH', `/api/dive-centres/${created.id}`, tim, { version: 1, name: 'Chronik 2' });
    await setNumber(created.id, '700040');
    await call('PUT', `/api/dive-centres/${created.id}/sites/${reef.id}`, tim);
    await call('DELETE', `/api/dive-centres/${created.id}/sites/${reef.id}`, tim);
    await call('DELETE', `/api/dive-centres/${created.id}`, tim);
    const rows = await history(created.id);
    expect(rows.map((r) => [r.entityType, r.cause, Object.keys(r.changes)])).toEqual([
      ['dive_centre', 'create', ['name']],
      ['dive_centre', 'edit', ['name']],
      ['dive_centre', 'edit', ['ssiCentreNumber']],
      ['dive_centre', 'edit', ['site']],
      ['dive_centre', 'edit', ['site']],
      ['dive_centre', 'delete', ['deletedAt']],
    ]);
  });

  it('follows its Dive site when sites are merged, and loses the link when the site is deleted', async () => {
    const a = await site('Doppelt A');
    const b = await site('Doppelt B');
    const c = await site('Gelöscht');
    const created = await centre({ name: 'Zieht um', siteIds: [a.id, c.id] });
    const both = await centre({ name: 'An beiden', siteIds: [a.id, b.id] });
    const merged = await call('POST', `/api/dive-sites/${a.id}/merge`, tim, { intoId: b.id, version: a.version, intoVersion: b.version });
    expect(merged.statusCode).toBe(200);
    expect((await call('DELETE', `/api/dive-sites/${c.id}`, tim)).statusCode).toBe(204);
    expect((await get(created.id)).sites).toEqual([{ id: b.id, name: 'Doppelt B' }]);
    expect((await get(both.id)).sites).toEqual([{ id: b.id, name: 'Doppelt B' }]);
  });

  it('reads a pasted code: what it is and its fields, and the centre that already has the number', async () => {
    const read = (text: string) => call('POST', '/api/verification-codes/read', anna, { text });
    expect((await read('center;700050;name:Example Divers GmbH, Musterstadt')).json()).toEqual({
      kind: 'centre', centreNumber: '700050', name: 'Example Divers GmbH, Musterstadt', existing: null,
    });
    const known = await centre({ name: 'Schon da', externalIds: [{ source: 'ssi', externalId: '700051' }] });
    expect((await read('center;700051;name:Schon da e.K.')).json()).toMatchObject({ kind: 'centre', existing: { id: known.id, name: 'Schon da' } });
    expect((await read('buddy;1234567;firstName:Erika;lastName:Mustermann;email:erika@example.com;leaderNr:54321')).json()).toEqual({
      kind: 'professional', accountId: '1234567', firstName: 'Erika', lastName: 'Mustermann', email: 'erika@example.com', leaderNumber: '54321',
      existing: null, candidates: [],
    });
    const unknown = await read('https://example.com');
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ code: 'code_not_recognised' });
  });

  it('needs a signed-in User', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/dive-centres' })).statusCode).toBe(401);
  });
});
