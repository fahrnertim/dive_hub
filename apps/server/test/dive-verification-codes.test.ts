// A Dive and SSI's verification (ADR 0043): the Dive shows the code of every centre of its site that has one, and its
// state at SSI says whether an update would remove the dive centre's verification there (ADR 0038). Placeholders only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeSsi } from './fake-ssi.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import { startChangesAtSsi } from '../src/providers/ssi/ssi-record.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Dive = { version: number; values: { startsAt: { at: string } }; verificationCodes: { centre: { id: string; name: string; displayName: string }; provider: string; text: string }[] };
type Status = { current: { upToDate: boolean; updateRemovesVerification: boolean } | null };

describe('whether an update changes the start time SSI has', () => {
  const at = new Date('2026-05-01T08:30:00Z');
  it('compares the minute sent last with the minute to send, in the dive\'s local time', () => {
    expect(startChangesAtSsi({ odin_user_log_datetime: '2026-05-01 10:30' }, { startsAt: at, utcOffsetSeconds: 7200 })).toBe(false);
    expect(startChangesAtSsi({ odin_user_log_datetime: '2026-05-01 10:30:00' }, { startsAt: at, utcOffsetSeconds: 7200 })).toBe(false);
    expect(startChangesAtSsi({ odin_user_log_datetime: '2026-05-01 10:31' }, { startsAt: at, utcOffsetSeconds: 7200 })).toBe(true);
  });
  it('says yes when it isn\'t known what SSI has: a dive linked there and never sent', () => {
    expect(startChangesAtSsi(null, { startsAt: at, utcOffsetSeconds: 7200 })).toBe(true);
    expect(startChangesAtSsi({}, { startsAt: at, utcOffsetSeconds: 7200 })).toBe(true);
  });
});

describe.skipIf(!(await databaseReachable()))('a Dive and SSI\'s verification', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let diveId: string;
  let siteId: string;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: tim, origin: BASE_URL }, ...(payload && { payload }) });
  const dive = async () => (await call('GET', `/api/dives/${diveId}`)).json() as Dive;
  const status = async () => (await call('GET', `/api/dives/${diveId}/providers/ssi`)).json() as Status;
  const centre = async (body: object) => (await call('POST', '/api/dive-centres', body)).json() as { id: string };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { fakeSsi: createFakeSsi({}) });
    await createUser(ctx.auth, 'tim@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    const timDiver = ((await call('GET', '/api/divers')).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    const { payload, headers } = multipartFile('main.fit', makeSyntheticDive({ serialNumber: 111 }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(created.json().id);
    diveId = (await call('GET', `/api/imports/${created.json().id}`)).json().outcome[0].diveId;
    await call('POST', '/api/connections/ssi', { diverId: timDiver, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false });
    siteId = ((await call('POST', '/api/dive-sites', { name: 'Hausreef' })).json() as { id: string }).id;
    await call('PUT', `/api/dive-sites/${siteId}/external-ids/ssi`, { externalId: '3314' });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('shows no code without a site, nor at a site without a centre that has a number', async () => {
    expect((await dive()).verificationCodes).toEqual([]);
    await call('PATCH', `/api/dives/${diveId}`, { version: (await dive()).version, siteId });
    await centre({ name: 'Ohne Nummer', siteIds: [siteId] });
    expect((await dive()).verificationCodes).toEqual([]);
  });

  it('shows the code of each centre of its site that has a number, by the centre\'s name', async () => {
    const b = await centre({ name: 'Beispiel Zwei, Musterstadt', externalIds: [{ source: 'ssi', externalId: '700002' }], siteIds: [siteId] });
    const a = await centre({ name: 'Beispiel Eins', externalIds: [{ source: 'ssi', externalId: '700001' }], siteIds: [siteId] });
    await centre({ name: 'Anderswo', externalIds: [{ source: 'ssi', externalId: '700003' }] });
    expect((await dive()).verificationCodes).toEqual([
      { kind: 'centre', diver: null, centre: { id: a.id, name: 'Beispiel Eins', displayName: 'Beispiel Eins' }, provider: 'ssi', text: 'center;700001;name:Beispiel Eins' },
      { kind: 'centre', diver: null, centre: { id: b.id, name: 'Beispiel Zwei, Musterstadt', displayName: 'Beispiel Zwei' }, provider: 'ssi', text: 'center;700002;name:Beispiel Zwei, Musterstadt' },
    ]);
  });

  it('says an update removes the verification at SSI only when it changes the start time there', async () => {
    const sent = (await call('POST', `/api/dives/${diveId}/providers/ssi`, {})).json() as { outcome: string; status: Status };
    expect(sent.outcome).toBe('created');
    expect(sent.status.current).toMatchObject({ upToDate: true, updateRemovesVerification: false });

    await call('PATCH', `/api/dives/${diveId}`, { version: (await dive()).version, notes: 'Schön.' });
    expect((await status()).current).toMatchObject({ upToDate: false, updateRemovesVerification: false });

    const before = await dive();
    const later = new Date(new Date(before.values.startsAt.at).getTime() + 10 * 60_000).toISOString();
    const edited = await call('PATCH', `/api/dives/${diveId}`, { version: before.version, set: { startsAt: { ...before.values.startsAt, at: later } } });
    expect(edited.statusCode).toBe(200);
    expect((await status()).current).toMatchObject({ upToDate: false, updateRemovesVerification: true });

    ctx.ssiClock.advance(5 * 60_000);
    const updated = (await call('POST', `/api/dives/${diveId}/providers/ssi`, {})).json() as { outcome: string; status: Status };
    expect(updated.outcome).toBe('updated');
    expect(updated.status.current).toMatchObject({ upToDate: true, updateRemovesVerification: false });
  });
});
