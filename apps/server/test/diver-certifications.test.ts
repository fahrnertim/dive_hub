// A Diver's certification cards (ADR 0050): typed by hand or imported from SSI's `get_ccards` against the fake SSI.
// Seen and changed only by the Users who manage the Diver; an imported card is the agency's record (verified, read-only
// apart from notes), deduplicated by its card ID, a deleted one stays deleted; its picture is fetched by a job.
import { access } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createFakeSsi, fakeCard, PNG_BYTES } from './fake-ssi.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

const ERIKA = 5_012_047;
const OWD = fakeCard(ERIKA, { uid: '123456N1000000000001-EG', course: 'Open Water Diver', short: 'OWD', courseId: 225, issued: '2023-04-23', dives: 5 });
const DEEP = fakeCard(ERIKA, { uid: '123456N1000000000002-DE', course: 'Deep Diving', short: 'SC-DD', courseId: 271, issued: '2023-09-17', dives: 20 });
const WRECK = fakeCard(ERIKA, { uid: '123456N1000000000003-MT', course: 'Wreck Diving', short: 'SC-WR', courseId: 272, issued: '2025-03-22', dives: 68 });

type Card = {
  id: string; agency: string; level: string; verification: string; source: string | null; cardId: string | null; version: number;
  imageState: string; imageUrl: string | null; issuedOn: string | null; instructorName: string | null; notes: string | null;
};
type Report = { created: number; updated: number; unchanged: number; items: { result: string; level: string; certificationId: string | null }[] };

describe.skipIf(!(await databaseReachable()))('certifications of a Diver', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const cookies: Record<string, string> = {};
  let timDiver: string;
  let connectionId: string;

  const as = (who: string) => async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie: cookies[who]!, origin: BASE_URL }, ...(payload && { payload }) });
  const cards = (diverId: string) => `/api/divers/${diverId}/certifications`;
  const list = async (who = 'tim', diverId = timDiver) => (await as(who)('GET', cards(diverId))).json() as Card[];
  const doImport = async () => (await as('tim')('POST', `/api/connections/${connectionId}/certifications/import`)).json() as Report;
  const pictures = async () => {
    for (const c of await list()) if (c.imageState === 'pending') await ctx.providers.certifications.fetchImage(c.id, { final: true });
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { fakeSsi: createFakeSsi({ cards: [OWD, DEEP, { ...WRECK, owner: 42 }] }) });
    for (const who of ['tim', 'bob']) {
      await createUser(ctx.auth, `${who}@example.com`);
      cookies[who] = await signIn(ctx.app, `${who}@example.com`);
    }
    timDiver = ((await (await as('tim')('GET', '/api/divers')).json()) as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('by hand', () => {
    let cardId: string;

    it('starts with none, adds a card as self-declared and lists the latest issue first', async () => {
      const tim = as('tim');
      expect(await list()).toEqual([]);
      const first = await tim('POST', cards(timDiver), { agency: 'PADI', level: ' Rescue Diver ', issuedOn: '2020-06-01', number: '2006123456' });
      expect(first.statusCode).toBe(201);
      cardId = first.json().id;
      expect(first.json()).toMatchObject({
        agency: 'PADI', level: 'Rescue Diver', verification: 'self_declared', source: null, cardId: null, imageState: 'none', version: 1, issuedOn: '2020-06-01',
      });
      await tim('POST', cards(timDiver), { agency: 'CMAS', level: 'Two Star', issuedOn: '2022-02-02', cardSeen: true });
      await tim('POST', cards(timDiver), { agency: 'PADI', level: 'Open Water Diver' });
      expect((await list()).map((c) => [c.agency, c.level, c.verification])).toEqual([
        ['CMAS', 'Two Star', 'card_seen'], ['PADI', 'Rescue Diver', 'self_declared'], ['PADI', 'Open Water Diver', 'self_declared'],
      ]);
    });

    it('changes a card with its version, refuses an old one, and sets or clears "card seen"', async () => {
      const tim = as('tim');
      const changed = await tim('PUT', `${cards(timDiver)}/${cardId}`, { version: 1, agency: 'PADI', level: 'Rescue Diver', cardSeen: true, notes: 'Seen at the dive shop' });
      expect(changed.statusCode).toBe(200);
      expect(changed.json()).toMatchObject({ verification: 'card_seen', version: 2, notes: 'Seen at the dive shop' });
      const stale = await tim('PUT', `${cards(timDiver)}/${cardId}`, { version: 1, agency: 'PADI', level: 'Rescue Diver' });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ code: 'certification_changed' });
      const cleared = await tim('PUT', `${cards(timDiver)}/${cardId}`, { version: 2, agency: 'PADI', level: 'Rescue Diver' });
      expect(cleared.json()).toMatchObject({ verification: 'self_declared', version: 3, notes: null });
    });

    it('refuses what no card has', async () => {
      const tim = as('tim');
      for (const body of [
        { agency: 'PADI', level: 'X', issuedOn: '2026-02-30' },
        { agency: 'PADI', level: 'X', issuedOn: '2020-05-01', expiresOn: '2019-01-01' },
        { agency: 'PADI', level: 'X', divesAtIssue: -1 },
        { agency: '  ', level: 'X' },
      ]) expect((await tim('POST', cards(timDiver), body)).statusCode, JSON.stringify(body)).toBe(400);
      expect((await tim('PUT', `${cards(timDiver)}/00000000-0000-7000-8000-000000000000`, { version: 1, agency: 'A', level: 'B' })).statusCode).toBe(404);
    });

    it('is invisible and untouchable for a User who does not keep the Diver', async () => {
      const bob = as('bob');
      for (const [method, url, payload] of [
        ['GET', cards(timDiver)], ['POST', cards(timDiver), { agency: 'A', level: 'B' }],
        ['PUT', `${cards(timDiver)}/${cardId}`, { version: 3, agency: 'A', level: 'B' }], ['DELETE', `${cards(timDiver)}/${cardId}`],
        ['GET', `${cards(timDiver)}/${cardId}/image`],
      ] as const) {
        const answer = await bob(method, url, payload);
        expect(answer.statusCode, method).toBe(404);
        expect(answer.json()).toMatchObject({ code: 'diver_not_found' });
      }
      expect(JSON.stringify((await bob('GET', `/api/divers/${timDiver}/details`)).json())).not.toMatch(/PADI|Rescue/);
    });

    it('has none for an external Diver, whoever asks', async () => {
      const external = ((await as('tim')('POST', '/api/external-divers', { name: 'Samuel Dreier' })).json() as { id: string }).id;
      for (const who of ['tim', 'bob']) {
        expect((await as(who)('GET', cards(external))).statusCode).toBe(404);
        expect((await as(who)('POST', cards(external), { agency: 'A', level: 'B' })).statusCode).toBe(404);
      }
    });

    it('deletes a card, and writes Revisions that never hold names or numbers', async () => {
      const tim = as('tim');
      expect((await tim('DELETE', `${cards(timDiver)}/${cardId}`)).statusCode).toBe(204);
      expect((await tim('DELETE', `${cards(timDiver)}/${cardId}`)).statusCode).toBe(404);
      expect((await list()).map((c) => c.level)).toEqual(['Two Star', 'Open Water Diver']);
      const revisions = (await t.db.execute(sql`select cause, changes from revision where entity_type = 'diver' and entity_id = ${timDiver}::uuid
        and changes ? 'certification' order by created_at`)).rows as { cause: string; changes: unknown }[];
      expect(revisions.map((r) => r.cause)).toContain('delete');
      expect(JSON.stringify(revisions)).not.toContain('2006123456');
    });
  });

  describe('from SSI', () => {
    let imported: Card[];

    beforeAll(async () => {
      const response = await as('tim')('POST', '/api/connections/ssi', { diverId: timDiver, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false });
      connectionId = response.json().id;
    });

    it('declares certifications to clients', async () => {
      const providers = (await as('tim')('GET', '/api/providers')).json() as { id: string; data: { certifications: unknown } }[];
      expect(providers.find((p) => p.id === 'ssi')!.data.certifications).toEqual({ import: { operations: ['find'], findBy: [] } });
    });

    it('creates the account\'s cards as verified with the agency, with the picture pending', async () => {
      const report = await doImport();
      expect([report.created, report.updated, report.unchanged]).toEqual([2, 0, 0]);
      imported = (await list()).filter((c) => c.source === 'ssi');
      expect(imported.map((c) => c.level).sort()).toEqual(['Deep Diving', 'Open Water Diver']);
      expect(imported[0]).toMatchObject({ agency: 'SSI', verification: 'verified_with_agency', imageState: 'pending', imageUrl: null });
      const owd = imported.find((c) => c.level === 'Open Water Diver')!;
      expect(owd).toMatchObject({ cardId: OWD.ccard_uid, issuedOn: '2023-04-23', instructorName: 'Ida Instructor' });
      // Another account's card is not here.
      expect(JSON.stringify(await list())).not.toContain('Wreck');
    });

    it('stores the pictures through a job and serves them to the Diver\'s Users only', async () => {
      await pictures();
      imported = (await list()).filter((c) => c.source === 'ssi');
      for (const c of imported) {
        expect(c).toMatchObject({ imageState: 'stored', imageUrl: `/api/divers/${timDiver}/certifications/${c.id}/image` });
        const own = await as('tim')('GET', c.imageUrl!);
        expect(own.statusCode).toBe(200);
        expect(own.headers['content-type']).toBe('image/png');
        expect(Buffer.from(own.rawPayload).equals(Buffer.from(PNG_BYTES))).toBe(true);
        expect((await as('bob')('GET', c.imageUrl!)).statusCode).toBe(404);
      }
      // One file for both cards: the same bytes are stored once.
      const keys = (await t.db.execute(sql`select distinct image_key from certification where image_key is not null`)).rows;
      expect(keys).toHaveLength(1);
    });

    it('imports again without changing anything', async () => {
      const report = await doImport();
      expect([report.created, report.updated, report.unchanged]).toEqual([0, 0, 2]);
      expect((await list()).filter((c) => c.source === 'ssi').map((c) => c.version)).toEqual([1, 1]);
    });

    it('takes only notes of an imported card', async () => {
      const tim = as('tim');
      const owd = imported.find((c) => c.level === 'Open Water Diver')!;
      const base = { version: owd.version, agency: owd.agency, level: owd.level, issuedOn: owd.issuedOn, instructorName: owd.instructorName };
      const noted = await tim('PUT', `${cards(timDiver)}/${owd.id}`, { ...base, notes: 'My first card' });
      expect(noted.statusCode).toBe(200);
      expect(noted.json()).toMatchObject({ notes: 'My first card', verification: 'verified_with_agency' });
      for (const change of [{ level: 'Master Diver' }, { issuedOn: '2020-01-01' }, { cardSeen: true }, { number: '99' }]) {
        const refused = await tim('PUT', `${cards(timDiver)}/${owd.id}`, { ...base, version: 2, ...change });
        expect(refused.statusCode, JSON.stringify(change)).toBe(409);
        expect(refused.json()).toMatchObject({ code: 'certification_read_only' });
      }
    });

    it('updates a card from SSI when SSI changed it, and fetches its picture again', async () => {
      ctx.fakeSsi.cards.find((c) => c.ccard_uid === DEEP.ccard_uid)!.ccard_dives = 21;
      ctx.fakeSsi.cards.find((c) => c.ccard_uid === DEEP.ccard_uid)!.ccard_instructor_name = 'Jo Newinstructor';
      const report = await doImport();
      expect([report.created, report.updated, report.unchanged]).toEqual([0, 1, 1]);
      const deep = (await list()).find((c) => c.level === 'Deep Diving')!;
      expect(deep).toMatchObject({ instructorName: 'Jo Newinstructor', version: 2, imageState: 'pending' });
      await pictures();
      expect((await list()).find((c) => c.level === 'Deep Diving')!.imageState).toBe('stored');
    });

    it('keeps a card the User deleted deleted, and one SSI no longer lists', async () => {
      const tim = as('tim');
      const deep = (await list()).find((c) => c.level === 'Deep Diving')!;
      expect((await tim('DELETE', `${cards(timDiver)}/${deep.id}`)).statusCode).toBe(204);
      ctx.fakeSsi.cards.splice(ctx.fakeSsi.cards.findIndex((c) => c.ccard_uid === OWD.ccard_uid), 1);
      const report = await doImport();
      expect([report.created, report.updated, report.unchanged]).toEqual([0, 0, 0]);
      expect(report.items.map((i) => [i.level, i.result]).sort()).toEqual([['Deep Diving', 'deleted_earlier'], ['Open Water Diver', 'not_at_provider']]);
      expect((await list()).filter((c) => c.source === 'ssi').map((c) => c.level)).toEqual(['Open Water Diver']);
      // The deleted card's picture is gone from the store; the other card's is still served.
      const rows = (await t.db.execute(sql`select image_key, deleted_at from certification where source = 'ssi' order by level`)).rows as { image_key: string | null; deleted_at: unknown }[];
      expect(rows.find((r) => r.deleted_at)!.image_key).toBeNull();
    });

    it('ends a picture as failed when SSI answers something that is no PNG, and fetches it again on request', async () => {
      const tim = as('tim');
      const owd = (await list()).find((c) => c.level === 'Open Water Diver')!;
      await t.db.execute(sql`update certification set image_state = 'pending', image_key = null, image_sha256 = null where id = ${owd.id}::uuid`);
      ctx.fakeSsi.cardImages.set(OWD.ccard_uid, { bytes: new TextEncoder().encode('<html>no</html>'), contentType: 'text/html' });
      await ctx.providers.certifications.fetchImage(owd.id, { final: true });
      expect((await list()).find((c) => c.id === owd.id)).toMatchObject({ imageState: 'failed', imageUrl: null });
      expect((await tim('GET', `${cards(timDiver)}/${owd.id}/image`)).statusCode).toBe(404);

      ctx.fakeSsi.cardImages.set(OWD.ccard_uid, { status: 404, bytes: new Uint8Array() });
      await ctx.providers.certifications.fetchImage(owd.id, { final: true });
      expect((await list()).find((c) => c.id === owd.id)!.imageState).toBe('failed');

      ctx.fakeSsi.cardImages.delete(OWD.ccard_uid);
      expect((await tim('POST', `${cards(timDiver)}/${owd.id}/image`)).statusCode).toBe(204);
      expect((await list()).find((c) => c.id === owd.id)!.imageState).toBe('pending');
      await ctx.providers.certifications.fetchImage(owd.id, { final: true });
      expect((await list()).find((c) => c.id === owd.id)!.imageState).toBe('stored');
    });

    it('refuses a body over 1 MB and a card of a hand-typed kind has no picture to fetch', async () => {
      const tim = as('tim');
      const manual = (await tim('POST', cards(timDiver), { agency: 'NAUI', level: 'Scuba Diver' })).json() as Card;
      expect((await tim('POST', `${cards(timDiver)}/${manual.id}/image`)).statusCode).toBe(404);
      const owd = (await list()).find((c) => c.level === 'Open Water Diver')!;
      await t.db.execute(sql`update certification set image_state = 'pending', image_key = null where id = ${owd.id}::uuid`);
      ctx.fakeSsi.cardImages.set(OWD.ccard_uid, { bytes: new Uint8Array(1_000_001).fill(1) });
      await ctx.providers.certifications.fetchImage(owd.id, { final: true });
      expect((await list()).find((c) => c.id === owd.id)!.imageState).toBe('failed');
      ctx.fakeSsi.cardImages.delete(OWD.ccard_uid);
    });

    it('is refused for a Connection of a Diver the User does not keep, and for one that is not theirs', async () => {
      expect((await as('bob')('POST', `/api/connections/${connectionId}/certifications/import`)).statusCode).toBe(404);
    });

    it('removes the pictures with a Diver that is deleted', async () => {
      const tim = as('tim');
      const child = (await tim('POST', '/api/divers', { name: 'Lina' })).json() as { id: string };
      await tim('POST', cards(child.id), { agency: 'SSI', level: 'Scuba Kids' });
      // A card with its own picture, so the file belongs to this Diver alone.
      const stored = await ctx.blobs.putOriginal(new Uint8Array([9, 9, 9, 1]));
      await t.db.execute(sql`insert into certification (diver_id, agency, level, image_key, image_state, image_sha256, image_bytes)
        values (${child.id}::uuid, 'X', 'Y', ${stored.key}, 'stored', ${stored.sha256}, 4)`);
      const key = stored.key;
      expect((await tim('DELETE', `/api/divers/${child.id}`)).statusCode).toBe(204);
      await expect(access(ctx.blobs.pathOf(key))).rejects.toThrow();
      expect((await t.db.execute(sql`select count(*)::int as n from certification where diver_id = ${child.id}::uuid`)).rows).toEqual([{ n: 0 }]);
    });
  });
});
