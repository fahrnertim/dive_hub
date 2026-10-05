// Push requirements (ADR 0029): a Provider declares what an export needs, blocking or advisory; the generic layer
// checks it against Dive Hub's own data, lists what is unmet in the status (without calling the Provider), refuses only
// blocking ones and records who an advisory one left out. The ledger adapter (test only) has a blocking diver_mapping
// and an advisory site_external_id; SSI the other way round.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeLedger, type FakeLedger } from './fake-ledger-provider.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Unmet = Record<string, unknown> & { type: string; severity: string };
type Status = { unmet: Unmet[]; current: { upToDate: boolean } | null; pushes: { state: string; leftOut: unknown[] | null }[] };

describe.skipIf(!(await databaseReachable()))('Push requirements', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ledger: FakeLedger;
  let tim: string;
  let timDiver: string;
  let diveId: string;
  let bob: { id: string };

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const status = async (provider: string) => (await call('GET', `/api/dives/${diveId}/providers/${provider}`)).json() as Status;
  const dive = async () => (await call('GET', `/api/dives/${diveId}`)).json() as { version: number };

  beforeAll(async () => {
    t = await createTestDatabase();
    ledger = createFakeLedger();
    ctx = await createTestApp(t, { extraProviders: [ledger.adapter] });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    timDiver = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    const { payload, headers } = multipartFile('main.fit', makeSyntheticDive({ serialNumber: 111 }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    diveId = (await call('GET', `/api/imports/${created.json().id}`)).json().outcome[0].diveId;
    await call('POST', '/api/connections/ledger', { diverId: timDiver, token: 'ledger-token-1', keepSignedIn: false });
    await call('POST', '/api/connections/ssi', { diverId: timDiver, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false });
    bob = (await call('POST', '/api/external-divers', { name: 'Bob' })).json();
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('hands each Provider\'s requirements to clients, with how a site ID may be typed', async () => {
    const providers = (await call('GET', '/api/providers')).json() as { id: string; data: { dives: { export: { requirements: unknown[] } } } }[];
    const of = (id: string) => providers.find((p) => p.id === id)!.data.dives.export.requirements;
    expect(of('ssi')).toEqual([
      {
        type: 'site_external_id', severity: 'blocking', description: expect.any(String), source: 'ssi',
        typed: true, pattern: '^[1-9]\\d{0,9}$', prefixes: ['site:'], roles: null,
      },
      {
        type: 'diver_mapping', severity: 'advisory', description: expect.any(String), source: 'ssi',
        typed: null, pattern: null, prefixes: null, roles: ['buddy', 'guide', 'instructor'],
      },
    ]);
    expect(of('ledger')).toMatchObject([
      { type: 'site_external_id', severity: 'advisory', source: 'wikidata', typed: false },
      { type: 'diver_mapping', severity: 'blocking', source: 'padi', roles: ['buddy', 'guide', 'instructor'] },
    ]);
  });

  it('lists what is unmet from Dive Hub\'s data alone: no site first, then each Participant without a reference', async () => {
    const calls = ctx.fakeSsi.calls.length;
    expect((await status('ssi')).unmet).toEqual([{ type: 'site_external_id', severity: 'blocking', source: 'ssi', siteId: null }]);
    await call('PUT', `/api/dives/${diveId}/participants`, { version: (await dive()).version, participants: [{ diverId: bob.id, role: 'guide' }] });
    expect((await status('ledger')).unmet).toEqual([
      { type: 'site_external_id', severity: 'advisory', source: 'wikidata', siteId: null },
      { type: 'diver_mapping', severity: 'blocking', source: 'padi', diverId: bob.id, diverName: 'Bob', role: 'guide', fixes: ['diver_external_id'] },
    ]);
    const site = (await call('POST', '/api/dive-sites', { name: 'Reef' })).json() as { id: string };
    await call('PATCH', `/api/dives/${diveId}`, { version: (await dive()).version, siteId: site.id });
    expect((await status('ssi')).unmet).toEqual([
      { type: 'site_external_id', severity: 'blocking', source: 'ssi', siteId: site.id },
      { type: 'diver_mapping', severity: 'advisory', source: 'ssi', diverId: bob.id, diverName: 'Bob', role: 'guide', fixes: ['diver_external_id'] },
    ]);
    expect(ctx.fakeSsi.calls.length).toBe(calls);
  });

  it('refuses to send while a blocking one is unmet, with the list, and records nothing', async () => {
    const refused = await call('POST', `/api/dives/${diveId}/providers/ledger`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: 'provider_requirements_unmet', provider: 'ledger', providerName: 'Ledger',
      unmet: [{ type: 'site_external_id', severity: 'advisory' }, { type: 'diver_mapping', severity: 'blocking', diverId: bob.id }],
    });
    expect((await status('ledger')).pushes).toEqual([]);
    expect(ledger.dives.size).toBe(0);
  });

  it('sends once it is met; an advisory one unmet is sent without, and the Push says who was left out', async () => {
    expect((await call('PUT', `/api/divers/${bob.id}/external-ids/padi`, { externalId: '77' })).statusCode).toBe(204);
    const sent = await call('POST', `/api/dives/${diveId}/providers/ledger`, {});
    expect(sent.json()).toMatchObject({ outcome: 'created', status: { unmet: [{ type: 'site_external_id', severity: 'advisory' }] } });
    expect([...ledger.dives.values()][0]).toMatchObject({ participants: ['77'] });

    // SSI: the site ID is met by the site's route; Bob has no SSI account, so he is left out.
    const { siteId } = (await status('ssi')).unmet[0] as unknown as { siteId: string };
    await call('PUT', `/api/dive-sites/${siteId}/external-ids/ssi`, { externalId: '3314' });
    const toSsi = (await call('POST', `/api/dives/${diveId}/providers/ssi`, {})).json() as { outcome: string; status: Status };
    expect(toSsi.outcome).toBe('created');
    expect(toSsi.status.pushes[0]).toMatchObject({ state: 'confirmed', leftOut: [{ diverId: bob.id, name: 'Bob', reason: 'no_reference' }] });
  });

  it('counts Participants in "outdated" where the Provider takes them', async () => {
    expect((await status('ledger')).current).toMatchObject({ upToDate: true });
    const kid = (await call('POST', '/api/external-divers', { name: 'Kid' })).json() as { id: string };
    await call('PUT', `/api/divers/${kid.id}/external-ids/padi`, { externalId: '78' });
    await call('PUT', `/api/dives/${diveId}/participants`, {
      version: (await dive()).version, participants: [{ diverId: bob.id, role: 'guide' }, { diverId: kid.id, role: 'buddy' }],
    });
    expect((await status('ledger')).current).toMatchObject({ upToDate: false });
  });
});
