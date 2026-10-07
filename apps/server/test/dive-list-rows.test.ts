// The logbook list's rows and "Show only" filters (ADR 0040, amending ADR 0017): what a row says, the filters, their counts.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { user } from '../src/db/auth-schema.js';
import { connection, dive, diveFinding, push, recording } from '../src/db/schema.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Row = {
  id: string; number: number | null; recordings: number; fromProvider: string | null; surfaceIntervalSeconds: number | null;
  gases: { o2: number; he: number }[]; participants: { diverId: string; name: string; role: string }[];
  site: { name: string } | null; findings: number;
};
type Counts = { noRecording: number; noSite: number; withFindings: number; notAtProvider: number };
type List = {
  dives: Row[]; total: number; counts: Counts;
  totals: { dives: number; durationSeconds: number; deepestM: number | null; lastDiveAt: string | null };
  months: { month: string; dives: number; durationSeconds: number }[];
};

describe.skipIf(!(await databaseReachable()))('the logbook list: rows and "show only" filters', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let ann: string;
  let other: string;
  let annDiver: string;
  let lena: string;
  let tom: string;
  // Four Dives: reef (recording, site, buddies, linked), entry (no recording, no site, from SSI), deep (recording,
  // finding, link deleted again), late (recording, no site, no link, in April).
  const id: Record<'reef' | 'entry' | 'deep' | 'late', string> = { reef: '', entry: '', deep: '', late: '' };

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const list = async (query = '', cookie = ann) => (await call('GET', `/api/dives${query}`, cookie)).json() as List;
  const ids = (l: List) => l.dives.map((d) => d.id);

  const importDive = async (start: Date, maxDepthM: number, diveNumber: number) => {
    const { payload, headers } = multipartFile(`dive-${diveNumber}.fit`, makeSyntheticDive({ serialNumber: 7, start, maxDepthM, diveNumber }));
    const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: ann } });
    await ctx.imports.processImport(created.json().id);
    return (await call('GET', `/api/imports/${created.json().id}`, ann)).json().outcome[0].diveId as string;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'other@example.com');
    ann = await signIn(ctx.app, 'ann@example.com');
    other = await signIn(ctx.app, 'other@example.com');
    annDiver = ((await call('GET', '/api/divers', ann)).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    lena = (await call('POST', '/api/external-divers', ann, { name: 'Lena Meier' })).json().id;
    tom = (await call('POST', '/api/external-divers', ann, { name: 'Tom Keller' })).json().id;
    const site = (await call('POST', '/api/dive-sites', ann, { name: 'Lighthouse', position: { latitude: 35.9, longitude: 14.4 } })).json() as { id: string };

    id.reef = await importDive(new Date(Date.UTC(2026, 1, 10, 10)), 12, 7);
    id.deep = await importDive(new Date(Date.UTC(2026, 1, 20, 11)), 40, 77);
    id.late = await importDive(new Date(Date.UTC(2026, 3, 2, 10)), 16, 31);
    const [entry] = await t.db.insert(dive).values({
      diverId: annDiver, startsAt: new Date(Date.UTC(2026, 1, 10, 14)), durationSeconds: 2700, maxDepthM: 20, fromProvider: 'ssi',
    }).returning({ id: dive.id });
    id.entry = entry!.id;

    await call('PATCH', `/api/dives/${id.reef}`, ann, { version: (await call('GET', `/api/dives/${id.reef}`, ann)).json().version, siteId: site.id });
    await call('PUT', `/api/dives/${id.reef}/participants`, ann, {
      version: (await call('GET', `/api/dives/${id.reef}`, ann)).json().version,
      participants: [{ diverId: tom, role: 'guide' }, { diverId: lena, role: 'buddy' }],
    });
    // What the computer said about the reef dive: its gas and the time since the dive before.
    const [rec] = await t.db.select().from(recording).where(eq(recording.diveId, id.reef));
    await t.db.update(recording).set({ summary: { ...rec!.summary, gases: [{ o2: 32, he: 0 }], surfaceIntervalSeconds: 13500 } }).where(eq(recording.id, rec!.id));
    await t.db.insert(diveFinding).values({ diveId: id.deep, rule: 'ascent_rate', severity: 'caution', values: {}, engineVersion: 1 });

    // Connected to SSI; the reef dive is linked, the deep dive was linked and then deleted there.
    const [owner] = await t.db.select({ id: user.id }).from(user).where(eq(user.email, 'ann@example.com'));
    const [conn] = await t.db.insert(connection).values({
      userId: owner!.id, diverId: annDiver, provider: 'ssi', accountId: '1', accountLabel: 'ann@example.com', keepSignedIn: false,
    }).returning({ id: connection.id });
    const sent = (diveId: string, action: 'link' | 'delete', at: string) => t.db.insert(push).values({
      diveId, connectionId: conn!.id, userId: owner!.id, provider: 'ssi', mode: 'api', action, state: 'confirmed',
      remoteId: '9', diveVersion: 1, createdAt: new Date(at),
    });
    await sent(id.reef, 'link', '2026-03-01T00:00:00Z');
    await sent(id.deep, 'link', '2026-03-01T00:00:00Z');
    await sent(id.deep, 'delete', '2026-03-02T00:00:00Z');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('says in a row what makes the dive this dive', async () => {
    const rows = Object.fromEntries((await list()).dives.map((d) => [d.id, d]));
    expect(rows[id.reef]).toMatchObject({
      recordings: 1, fromProvider: null, gases: [{ o2: 32, he: 0 }], surfaceIntervalSeconds: 13500, site: { name: 'Lighthouse' },
      // Buddies first, then the others; each in name order.
      participants: [{ diverId: lena, name: 'Lena Meier', role: 'buddy' }, { diverId: tom, name: 'Tom Keller', role: 'guide' }],
    });
    expect(rows[id.entry]).toMatchObject({ recordings: 0, fromProvider: 'ssi', gases: [], surfaceIntervalSeconds: null, participants: [] });
    expect(rows[id.deep]!.findings).toBeGreaterThan(0); // the assessment found some in a 40 m dive, too
  });

  it('counts what each filter would show, for the Diver and the search, whatever filters are applied', async () => {
    const all = await list();
    expect(all.counts).toEqual({ noRecording: 1, noSite: 3, withFindings: 1, notAtProvider: 3 });
    expect((await list('?only=no-site,no-recording')).counts).toEqual(all.counts);
    // Searching narrows the counts: only the Lighthouse dive matches.
    expect((await list('?q=lighthouse')).counts).toEqual({ noRecording: 0, noSite: 0, withFindings: 0, notAtProvider: 0 });
    expect((await list(`?diverId=${lena}`)).counts).toEqual({ noRecording: 0, noSite: 0, withFindings: 0, notAtProvider: 0 });
  });

  it('shows only the dives that fit every chosen filter', async () => {
    expect(ids(await list('?only=no-recording'))).toEqual([id.entry]);
    expect(new Set(ids(await list('?only=no-site')))).toEqual(new Set([id.entry, id.deep, id.late]));
    expect(ids(await list('?only=with-findings'))).toEqual([id.deep]);
    // Not at SSI: no link, or the link was deleted again. The dive from SSI itself has none from Dive Hub.
    expect(new Set(ids(await list('?only=not-at-provider')))).toEqual(new Set([id.entry, id.deep, id.late]));
    expect(ids(await list('?only=no-site,with-findings'))).toEqual([id.deep]);
    const narrowed = await list('?only=no-site&limit=1&offset=1');
    expect(narrowed.total).toBe(3);
    expect(narrowed.dives).toHaveLength(1);
  });

  it('refuses a filter it does not know', async () => {
    expect((await call('GET', '/api/dives?only=no-number', ann)).statusCode).toBe(400);
    expect((await call('GET', '/api/dives?only=no-site,', ann)).statusCode).toBe(400);
  });

  it('has no "not at provider" without a connection', async () => {
    expect((await list('', other)).counts).toEqual({ noRecording: 0, noSite: 0, withFindings: 0, notAtProvider: 0 });
  });

  it('totals the logbook for the Diver and groups by month while sorted by date', async () => {
    const l = await list();
    expect(l.totals).toMatchObject({ dives: 4, deepestM: 40, lastDiveAt: expect.stringMatching(/^2026-04-02T10:00:00/) });
    expect(l.totals.durationSeconds).toBeGreaterThan(2700);
    expect(l.months.map((m) => [m.month, m.dives])).toEqual([['2026-04', 1], ['2026-02', 3]]);
    // Only the months of this page; their figures cover the whole month, not the page's share.
    const second = await list('?limit=1&offset=3');
    expect(second.months.map((m) => [m.month, m.dives])).toEqual([['2026-02', 3]]);
    expect((await list('?sort=maxDepth')).months).toEqual([]);
    expect((await list('?only=no-recording')).months.map((m) => [m.month, m.dives])).toEqual([['2026-02', 1]]);
  });

  it('pages by 25 unless asked otherwise', async () => {
    const filler = await t.db.insert(dive).values(Array.from({ length: 22 }, (_, i) => ({
      diverId: annDiver, startsAt: new Date(Date.UTC(2025, 0, 1 + i, 9)), durationSeconds: 1800,
    }))).returning({ id: dive.id });
    const l = await list();
    expect(l.total).toBe(26);
    expect(l.dives).toHaveLength(25);
    for (const f of filler) await t.db.delete(dive).where(eq(dive.id, f.id));
  });
});
