// The provider layer is generic (ADR 0027): a second, test-only Provider with token sign-in and hand-over delivery runs
// through the same routes as SSI. Capabilities reach clients, Connections and Pushes work without an ID back, what the
// Provider doesn't offer is refused, deleting a Dive leaves it alone, and actions on one Connection are paced (across
// app instances: leases.test.ts).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connection, push } from '../src/db/schema.js';
import { createFakeHandover, type FakeHandover } from './fake-handover-provider.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

describe.skipIf(!(await databaseReachable()))('the provider layer', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fake: FakeHandover;
  let tim: string;
  let diverId: string;
  let diveId: string;
  /** More Dives of the same Diver: actions on one Dive are refused while one runs, actions on one Connection queue. */
  let others: string[];
  const bodies: string[] = [];

  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => {
    const response = await ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
    bodies.push(response.body);
    return response;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    fake = createFakeHandover();
    ctx = await createTestApp(t, { extraProviders: [fake.adapter] });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    diverId = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    const upload = async (name: string, start: string) => {
      const { payload, headers } = multipartFile(name, makeSyntheticDive({ serialNumber: 111, start: new Date(start) }));
      const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
      await ctx.imports.processImport(created.json().id);
      return (await call('GET', `/api/imports/${created.json().id}`)).json().outcome[0].diveId as string;
    };
    diveId = await upload('main.fit', '2026-01-15T09:00:00Z');
    others = [await upload('b.fit', '2026-01-16T09:00:00Z'), await upload('c.fit', '2026-01-17T09:00:00Z')];
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('hands every Provider\'s capabilities to clients', async () => {
    expect((await call('GET', '/api/providers')).json()).toEqual([
      expect.objectContaining({ id: 'ssi', name: 'SSI', notices: ['shows_unconfirmed'] }),
      {
        id: 'handover', name: 'Hand-over',
        signIn: { kind: 'token', login: null, canKeepPassword: false },
        data: { dives: { export: { operations: ['create'], findBy: [], delivery: 'handed_over', needsSiteIdFrom: null, readBackFields: [] }, import: null }, diveSites: null },
        notices: [], limits: { pauseMs: 500 },
      },
    ]);
  });

  it('connects with a token, and refuses what its sign-in kind doesn\'t take', async () => {
    expect((await call('POST', '/api/connections/handover', { diverId, token: 'nope', keepSignedIn: false })).json())
      .toMatchObject({ code: 'provider_wrong_credentials', provider: 'handover', providerName: 'Hand-over' });
    expect((await call('POST', '/api/connections/handover', { diverId, token: 'handover-token-1', keepSignedIn: true })).statusCode).toBe(400);
    expect((await call('POST', '/api/connections/handover', { diverId, login: 'erika', password: 'x', keepSignedIn: false })).statusCode).toBe(400);
    const response = await call('POST', '/api/connections/handover', { diverId, token: 'handover-token-1', keepSignedIn: false });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ provider: 'handover', accountId: 'h-77', accountLabel: 'Logbook of Erika', state: 'active' });
    expect((await call('POST', '/api/connections/nowhere', { diverId, token: 'x', keepSignedIn: false })).statusCode).toBe(400);
  });

  it('hands a Dive over without an ID, so sending again hands it over again, and nothing can be updated or deleted', async () => {
    expect((await call('GET', `/api/dives/${diveId}/providers`)).json()).toMatchObject([
      { provider: 'ssi', connection: null }, { provider: 'handover', connection: { state: 'active' }, siteExternalId: null, current: null },
    ]);
    const first = await call('POST', `/api/dives/${diveId}/providers/handover`, {});
    expect(first.json()).toMatchObject({ outcome: 'created', status: { current: null, pushes: [{ action: 'create', state: 'handed_over', remoteId: null }] } });
    expect((await call('POST', `/api/dives/${diveId}/providers/handover`, {})).json()).toMatchObject({ outcome: 'created' });
    expect(fake.received).toHaveLength(2);
    expect(await t.db.select({ mode: push.mode }).from(push).where(eq(push.provider, 'handover'))).toEqual([{ mode: 'qr' }, { mode: 'qr' }]);
    expect((await call('DELETE', `/api/dives/${diveId}/providers/handover`)).json()).toMatchObject({ code: 'provider_unsupported', provider: 'handover' });
    expect((await call('GET', `/api/dives/${diveId}/providers/handover/sites`)).json()).toMatchObject({ code: 'provider_unsupported' });
  });

  it('paces actions on one Connection by its Provider\'s pause', async () => {
    const before = ctx.pauses.length;
    const sent = await Promise.all([diveId, ...others].map((id) => call('POST', `/api/dives/${id}/providers/handover`, {})));
    expect(sent.map((r) => r.json().outcome)).toEqual(['created', 'created', 'created']);
    expect(fake.received).toHaveLength(5);
    // Each action waits what is left of the 500 ms after the one before it.
    expect(ctx.pauses.slice(before).every((ms) => ms > 0 && ms <= 500)).toBe(true);
    expect(ctx.pauses.length - before).toBeGreaterThanOrEqual(2);
    // The same Dive twice at once, and two app instances: leases.test.ts.
  });

  it('needs a new token once the old one expired, since nothing renews a token', async () => {
    fake.expireTokens();
    expect((await call('POST', `/api/dives/${diveId}/providers/handover`, {})).json()).toMatchObject({ code: 'provider_sign_in_needed' });
    const [row] = await t.db.select().from(connection).where(eq(connection.provider, 'handover'));
    expect(row!.state).toBe('needs_sign_in');
    fake.tokens.set('handover-token-2', { accountId: 'h-77', label: 'Logbook of Erika' });
    expect((await call('POST', `/api/connections/${row!.id}/sign-in`, { token: 'handover-token-2', keepSignedIn: false })).json())
      .toMatchObject({ state: 'active' });
    expect((await call('POST', `/api/dives/${diveId}/providers/handover`, {})).json()).toMatchObject({ outcome: 'created' });
  });

  it('deletes a Dive here without asking a Provider that has no copy it could delete', async () => {
    const { version } = (await call('GET', `/api/dives/${diveId}`)).json();
    expect((await call('DELETE', `/api/dives/${diveId}`, { version, alsoAt: ['handover'] })).json()).toEqual({ providers: [] });
    expect((await call('GET', '/api/dives/deleted')).json().dives[0]).toMatchObject({ id: diveId, stillAt: [] });
  });

  it('never answers with a token', () => {
    for (const body of bodies) expect(body).not.toMatch(/handover-token-\d/);
  });
});
