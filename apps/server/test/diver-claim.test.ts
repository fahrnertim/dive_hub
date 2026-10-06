// A buddy who becomes a User (ADR 0028, amended): Tim imported Samuel from his SSI buddy list (an external Diver on his
// dive); Samuel signs up and connects his SSI account. Signing in proves it's his: he is asked, then the external Diver
// merges into his own. A Diver another User keeps is never taken. Admins merge an external Diver by hand.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeSsi } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase } from './support.js';

const TIM_SSI = 5_012_047;
const SAMUEL_SSI = 4_109_908;

describe.skipIf(!(await databaseReachable()))('claiming an external Diver', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const cookies: Record<string, string> = {};
  let diveId: string;
  let samuelExternal: string;

  const as = (who: string) => async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: cookies[who]!, origin: BASE_URL }, ...(payload && { payload }) });
  const ownDiver = async (who: string) => ((await (await as(who)('GET', '/api/divers')).json()) as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
  const connect = async (who: string, login: string, extra: object = {}) => as(who)('POST', '/api/connections/ssi', {
    diverId: await ownDiver(who), login, password: 'ssi-password', keepSignedIn: false, ...extra,
  });

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, {
      fakeSsi: createFakeSsi({
        accounts: [
          { email: 'tim@example.com', password: 'ssi-password', accountId: TIM_SSI },
          { email: 'samuel@example.com', password: 'ssi-password', accountId: SAMUEL_SSI },
          { email: 'carla@example.com', password: 'ssi-password', accountId: 3_000_001 },
        ],
        buddies: [{ owner: TIM_SSI, id: 2_271_970, buddy_master_id: SAMUEL_SSI, firstname: 'Samuel', lastname: 'Dreier', email: 's@example.com', dob: '1990-01-01', phone: '0', city: 'x' }],
      }),
    });
    for (const who of ['tim', 'samuel', 'carla', 'admin']) {
      await createUser(ctx.auth, `${who}@example.com`, who === 'admin' ? 'admin' : 'user');
      cookies[who] = await signIn(ctx.app, `${who}@example.com`);
    }
    const tim = as('tim');
    const { payload, headers } = multipartFile('dive.fit', makeSyntheticDive());
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: cookies.tim! } });
    await ctx.imports.processImport(created.json().id);
    diveId = (await tim('GET', `/api/imports/${created.json().id}`)).json().outcome[0].diveId;
    const connection = (await connect('tim', 'tim@example.com')).json() as { id: string };
    samuelExternal = ((await tim('POST', `/api/connections/${connection.id}/buddies/import`, { accounts: [String(SAMUEL_SSI)] })).json() as {
      buddies: { diver: { id: string } }[];
    }).buddies[0]!.diver.id;
    const version = ((await tim('GET', `/api/dives/${diveId}`)).json() as { version: number }).version;
    await tim('PUT', `/api/dives/${diveId}/participants`, { version, participants: [{ diverId: samuelExternal, role: 'buddy' }] });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('asks the account\'s person first, naming the external Diver and how many dives it is on', async () => {
    const answer = await connect('samuel', 'samuel@example.com');
    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'provider_account_held', provider: 'ssi', diver: { id: samuelExternal, name: 'Samuel Dreier', dives: 1 } });
    expect((await as('samuel')('GET', '/api/connections')).json()).toEqual([]);
  });

  it('merges the external Diver into theirs when they claim it: the dives list them, the account is theirs', async () => {
    const samuel = await ownDiver('samuel');
    expect((await connect('samuel', 'samuel@example.com', { claim: true })).statusCode).toBe(201);
    const dive = (await as('tim')('GET', `/api/dives/${diveId}`)).json() as { participants: { diverId: string }[] };
    expect(dive.participants).toEqual([expect.objectContaining({ diverId: samuel, role: 'buddy' })]);
    const others = (await as('tim')('GET', '/api/external-divers')).json() as { divers: { id: string }[] };
    expect(others.divers.map((d) => d.id)).not.toContain(samuelExternal);
    // Tim's buddy list now finds Samuel's own Diver by the account.
    const [connection] = (await as('tim')('GET', '/api/connections')).json() as { id: string }[];
    const buddies = (await as('tim')('GET', `/api/connections/${connection!.id}/buddies`)).json() as { buddies: { diver: { id: string } | null }[] };
    expect(buddies.buddies[0]!.diver?.id).toBe(samuel);
  });

  it('never takes a Diver another User keeps', async () => {
    const carla = await ownDiver('carla');
    await as('carla')('PUT', `/api/divers/${carla}/external-ids/ssi`, { externalId: '3000002' });
    // Carla's account at SSI is held by her own Diver; someone else connecting it can't claim it.
    ctx.fakeSsi.accounts.push({ email: 'mallory@example.com', password: 'ssi-password', accountId: 3_000_002 });
    await createUser(ctx.auth, 'mallory@example.com');
    cookies.mallory = await signIn(ctx.app, 'mallory@example.com');
    expect((await connect('mallory', 'mallory@example.com', { claim: true })).json()).toMatchObject({ code: 'provider_account_taken' });
  });

  it('lets admins merge an external Diver into another by hand, and nobody else', async () => {
    const ulla = ((await as('tim')('POST', '/api/external-divers', { name: 'Ulla' })).json() as { id: string }).id;
    const samuel = await ownDiver('samuel');
    expect((await as('tim')('POST', `/api/admin/divers/${ulla}/merge`, { into: samuel })).statusCode).toBe(403);
    expect((await as('admin')('POST', `/api/admin/divers/${samuel}/merge`, { into: ulla })).json()).toMatchObject({ code: 'diver_not_external' });
    expect((await as('admin')('POST', `/api/admin/divers/${ulla}/merge`, { into: samuel })).json()).toEqual({ dives: 0 });
    const found = (await as('tim')('GET', '/api/divers/search?q=Ulla')).json() as { divers: unknown[] };
    expect(found.divers).toEqual([]);
  });
});
